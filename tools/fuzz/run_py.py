"""Fuzz runner for smlibpy: each case in a forked copy of the process, every operation's result
streamed back as a JSON line, so that a crash or a hang is put on the operation that was running.

The kernel runs in the case's process (``GUARD_SECONDS = 0``): a crash of the kernel ends the
case, not this runner, and is seen as such rather than as the guard's ModelingError. Each case
records the parameters it resolved (the edges it rounded, its openings, its distances) in a
``resolve`` record, which the WebAssembly runner (run_wasm.ts) takes over.

usage: python tools/fuzz/run_py.py CASES.json OUT.jsonl [--timeout S] [--only ID,ID]
(Linux and macOS: it forks.)
"""

from __future__ import annotations

import json
import math
import os
import select
import time
import warnings
from typing import Any, Callable

AXES = "XYZ"


def build(e: list) -> Any:
    """The body of a shape expression (see gen.py)."""
    from smlibpy import X, Y, Z, Box, Cone, Cylinder, Sphere, Torus

    t = e[0]
    if t == "box":
        return Box(e[1], e[2], e[3])
    if t == "cyl":
        return Cylinder(e[1], e[2])
    if t == "cone":
        return Cone(e[1], e[2], e[3])
    if t == "sph":
        return Sphere(e[1])
    if t == "tor":
        return Torus(e[1], e[2])
    if t == "rot":
        return build(e[1]).rotate({"X": X, "Y": Y, "Z": Z}[e[2]], e[3])
    if t == "tr":
        return build(e[1]).translate(e[2], e[3], e[4])
    a, b = build(e[1]), build(e[2])
    return {"fuse": a.fuse, "cut": a.cut, "int": a.intersect}[t](b)


def metrics(p: Any) -> dict:
    """What a result is: face and edge counts, validity, volume, area, box."""
    m: dict = {}
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        try:
            m["nf"] = len(p.faces())
            m["ne"] = len(p.edges())
        except Exception as ex:
            m["nf_err"] = repr(ex)[:80]
        if m.get("nf", 1) == 0:
            return {**m, "v": 0.0, "valid": False, "empty": True}
        try:
            m["valid"] = bool(p.is_valid())
        except Exception as ex:
            m["valid_err"] = repr(ex)[:80]
        try:
            m["v"] = float(p.volume)
            m["a"] = float(p.area)
        except Exception as ex:
            m["v_err"] = repr(ex)[:120]
        try:
            bb = p.bbox()
            m["bb"] = [*bb.min.to_tuple(), *bb.max.to_tuple()]
        except Exception as ex:
            m["bb_err"] = repr(ex)[:80]
        m["warn"] = len(w)
    return m


def key(s: Any) -> list[float]:
    c = s.center()
    return [round(c.x, 5), round(c.y, 5), round(c.z, 5)]


def nearest(items: Any, pts: list) -> list:
    """The items whose centres lie nearest the points (how a resolved selection is found again)."""
    return [min(items, key=lambda s: sum((a - b) ** 2 for a, b in zip(key(s), p))) for p in pts]


class Minstd:
    """The Park-Miller generator (the same draws in Python and TypeScript)."""

    def __init__(self, s: int):
        self.s = (s % 2147483646) + 1

    def __call__(self) -> float:
        self.s = (self.s * 48271) % 2147483647
        return self.s / 2147483647


def edge_limit(edges: list) -> float:
    """What the selected edges allow a fillet or chamfer: half the shortest edge or face span."""
    lim = math.inf
    for e in edges:
        lim = min(lim, e.length / 2)
        for f in e.faces():
            bb = f.bbox()
            dims = [d for d in (bb.max - bb.min).to_tuple() if d > 1e-6]
            if dims:
                lim = min(lim, min(dims) / 2)
    return lim


def run_case(case: dict, emit: Callable[[dict], None], resolved: dict | None = None) -> None:
    """Runs one case, emitting a record per operation (``start`` first, then its result)."""
    from smlibpy import ModelingError, Part, Plane

    kind = case["kind"]

    def op(name: str, fn: Callable[[], Any]) -> Any:
        emit({"op": name, "start": True})
        t0 = time.perf_counter()
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                p = fn()
            rec = {"op": name, "ok": True}
            if isinstance(p, Part):
                rec.update(metrics(p))
            elif isinstance(p, dict):
                rec.update(p)
        except (ModelingError, ValueError, TypeError, RuntimeError, AttributeError) as ex:
            p = None
            rec = {"op": name, "ok": False, "err": type(ex).__name__, "msg": str(ex)[:300]}
        rec["ms"] = round((time.perf_counter() - t0) * 1000, 1)
        emit(rec)
        return p

    if kind == "csg":
        A = op("A", lambda: build(case["A"]))
        B = op("B", lambda: build(case["B"]))
        if A is None or B is None or not A.is_valid() or not B.is_valid():
            return
        for name, fn in (("U", lambda: A + B), ("I", lambda: A & B), ("D", lambda: A - B), ("E", lambda: B - A)):
            op(name, fn)

        def cells() -> dict:
            m = A.merge(B)
            cs = m.cells()
            return {"ncells": len(cs), "cellv": [float(c.volume) for c in cs], "mv": float(m.volume)}

        op("M", cells)
        return
    P = op("base", lambda: build(case["base"]))
    if P is None or not P.is_valid():
        return
    R = resolved or {}
    if kind in ("fillet", "chamfer"):
        if "edges" in R:
            if not R["edges"]:
                return
            sel, size = nearest(P.edges(), R["edges"]), R["size"]
        else:
            es = sorted(P.edges(), key=lambda e: key(e) + [round(e.length, 5)])
            if not es:  # (a sphere or a torus: nothing to round)
                emit({"op": "resolve", "edges": [], "size": 0.0, "lim": 0.0, "nsel": 0, "nall": 0})
                return
            rng = Minstd(case["pick"])
            mode = case["mode"]
            if mode == "all":
                sel = es
            elif mode == "one":
                sel = [es[int(rng() * len(es))]]
            elif mode == "subset":
                sel = [e for e in es if rng() < 0.5] or [es[0]]
            else:  # disjoint: edges that share no vertex
                sel, used = [], set()
                for e in es:
                    vs = {tuple(key(v)) for v in e.vertices()}
                    if rng() < 0.6 and not (vs & used):
                        sel.append(e)
                        used |= vs
                sel = sel or [es[0]]
            lim = edge_limit(sel)
            lim = lim if math.isfinite(lim) else 1.0
            size = round(case["frac"] * lim, 6)
            emit({"op": "resolve", "edges": [key(e) for e in sel], "size": size, "lim": lim, "nsel": len(sel),
                  "nall": len(es)})
        if kind == "fillet":
            op("F", lambda: P.fillet(sel, size))
        else:
            op("C", lambda: P.chamfer(sel, size))
    elif kind == "shell":
        if "faces" in R:
            opens, t = (nearest(P.faces(), R["faces"]) if R["faces"] else []), R["t"]
        else:
            fs = sorted(P.faces(), key=lambda f: key(f) + [round(f.area, 5)])
            rng = Minstd(case["pick"])
            opens = []
            for _ in range(case["nopen"]):
                f = fs[int(rng() * len(fs))]
                if f not in opens:
                    opens.append(f)
            bb = P.bbox()
            t = round(case["frac"] * min((bb.max - bb.min).to_tuple()) / 2, 6)
            emit({"op": "resolve", "faces": [key(f) for f in opens], "t": t,
                  "open_types": [f.geom_type for f in opens]})
        op("S", lambda: P.shell(t, opens or None))
    elif kind == "offset":
        if "d" in R:
            d = R["d"]
        else:
            bb = P.bbox()
            d = round(case["frac"] * min((bb.max - bb.min).to_tuple()) / 2, 6)
            emit({"op": "resolve", "d": d})
        O = op("O", lambda: P.offset(d))
        if O is not None and d > 0:
            op("O2", lambda: O.offset(-d))
    elif kind == "slice":
        i = AXES.index(case["axis"])
        n = [0.0, 0.0, 0.0]
        n[i] = 1.0
        if case["tilt"]:
            n[(i + 1) % 3] = math.tan(math.radians(case["tilt"]))
        o = [0.0, 0.0, 0.0]
        o[i] = case["at"]
        pl = Plane(o, z_dir=n)
        op("above", lambda: P.split(pl, "above"))
        op("below", lambda: P.split(pl, "below"))
        op("sec", lambda: {"sa": float(P.section(pl).area)})


def _child(case: dict, w: int, resolved: dict | None) -> None:  # pragma: no cover - the forked case
    import smlibpy.defeature

    smlibpy.defeature.GUARD_SECONDS = 0  # (the kernel here: its crash ends this case)

    def emit(rec: dict) -> None:
        os.write(w, (json.dumps(rec) + "\n").encode())

    try:
        run_case(case, emit, resolved)
        emit({"op": "done"})
    except BaseException as ex:  # an error of the harness or of smlibpy that is no ModelingError
        emit({"op": "harness_error", "err": type(ex).__name__, "msg": str(ex)[:300]})
    os._exit(0)


def run_one(case: dict, timeout: float, resolved: dict | None = None) -> dict:
    """One case's result: its records, its fate (exit, crash, hang) and the operation it was in."""
    r, w = os.pipe()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        pid = os.fork()
    if pid == 0:  # pragma: no cover
        os.close(r)
        _child(case, w, resolved)
    os.close(w)
    buf = b""
    deadline = time.monotonic() + timeout
    hung = False
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            os.kill(pid, 9)
            hung = True
            break
        ready, _, _ = select.select([r], [], [], min(left, 1.0))
        if ready:
            chunk = os.read(r, 65536)
            if not chunk:
                break
            buf += chunk
    os.close(r)
    _, status = os.waitpid(pid, 0)
    recs = [json.loads(line) for line in buf.decode().splitlines() if line.strip()]
    res: dict = {"id": case["id"], "kind": case["kind"], "recs": recs}
    if hung:
        res["fate"] = "hang"
    elif os.WIFSIGNALED(status):
        res["fate"] = "crash"
        res["signal"] = os.WTERMSIG(status)
    else:
        res["fate"] = "exit"
    started = [x["op"] for x in recs if x.get("start")]
    finished = {x["op"] for x in recs if not x.get("start")}
    pending = [s for s in started if s not in finished]
    if pending:
        res["in_op"] = pending[-1]
    return res


def drive(cases: list[dict], out: str, timeout: float, deadline: float | None = None) -> int:
    """Runs the cases into ``out`` (JSON lines); stops before a case once ``deadline`` (a
    time.monotonic()) has passed. The number of cases run."""
    import smlibpy  # noqa: F401 - (loaded once, before the forks)

    n = 0
    with open(out, "w") as fo:
        for case in cases:
            if deadline is not None and time.monotonic() > deadline:
                break
            fo.write(json.dumps(run_one(case, timeout)) + "\n")
            fo.flush()
            n += 1
    return n


def resolved_of(results: str) -> dict:
    """The parameters each case resolved (``resolve`` records), by case id."""
    out = {}
    for line in open(results):
        r = json.loads(line)
        for x in r["recs"]:
            if x.get("op") == "resolve":
                out[r["id"]] = {k: v for k, v in x.items() if k != "op"}
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cases")
    ap.add_argument("out")
    ap.add_argument("--timeout", type=float, default=60)
    ap.add_argument("--only")
    a = ap.parse_args()
    all_cases = json.load(open(a.cases))
    if a.only:
        ids = set(a.only.split(","))
        all_cases = [c for c in all_cases if c["id"] in ids]
    drive(all_cases, a.out, a.timeout)
