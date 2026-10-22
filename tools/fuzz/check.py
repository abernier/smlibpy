"""The invariants of fuzz results, and their classes per operation.

Each operation of a case is ``ok``, ``error`` (it raised, as smlibpy raises for what it cannot
do), ``silent`` (it returned a result that breaks an invariant: wrong without a word), or the
case's fate where it ended: ``crash``, ``hang``, ``trap`` (WebAssembly). The invariants:

- every result is a valid body, not empty where it must not be, within its box's volume;
- Booleans: |A u B| + |A n B| = |A| + |B|, |A - B| = |A| - |A n B|, max(|A|, |B|) <= |A u B| <=
  |A| + |B|, and the cells of A.merge(B) add up to |A u B| (1e-6);
- fillets, chamfers, shells and offsets of a single box, cylinder, sphere or torus: the exact
  volume (2e-6); a shell removes volume, offset(+d) grows and offset(-d) shrinks, and
  offset(+d).offset(-d) of a primitive is the primitive;
- slices: the parts above and below add up to the body.
"""

from __future__ import annotations

import collections
import json
import math
from typing import Any

PI = math.pi
SP = (10 - 3 * PI) / (3 * (4 - PI))  # the centroid of a fillet's spandrel, in units of r
#: The operations of each kind whose rates count.
MAIN = {"csg": ["U", "I", "D", "E", "M"], "fillet": ["F"], "chamfer": ["C"], "shell": ["S"], "offset": ["O", "O2"],
        "slice": ["above", "below", "sec"]}


def _only(e: list, kinds: tuple[str, ...]) -> list | None:
    """The primitive under rot/tr wrappers if the expression is nothing else."""
    while e[0] in ("rot", "tr"):
        e = e[1]
    return e if e[0] in kinds else None


def ops_of(r: dict) -> dict[str, dict]:
    return {x["op"]: x for x in r["recs"] if not x.get("start") and x.get("op") not in ("resolve", "done")}


def resolve_of(r: dict) -> dict:
    return next((x for x in r["recs"] if x.get("op") == "resolve"), {})


def close(a: float, b: float, rel: float = 1e-6, abs_: float = 1e-6) -> bool:
    return abs(a - b) <= max(rel * max(abs(a), abs(b)), abs_)


def _bbvol(bb: list[float]) -> float:
    return (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2])


def violations(case: dict, r: dict, resolved: dict | None = None) -> dict[str, list[str]]:
    """The invariants each operation of a case breaks: {op: [what]}."""
    ops = ops_of(r)
    v: dict[str, list[str]] = collections.defaultdict(list)
    for name, x in ops.items():
        if not x.get("ok") or name == "M" or ("v" not in x and not x.get("empty")):
            continue
        if x.get("empty"):
            if name in ("U", "A", "B", "base", "F", "C", "S", "O", "O2"):
                v[name].append("empty result returned")
            continue
        if x.get("valid") is False:
            v[name].append("invalid result returned")
        if "bb" in x and x.get("v") is not None and x["v"] > _bbvol(x["bb"]) * (1 + 1e-6) + 1e-9:
            v[name].append(f"volume {x['v']:.6g} > bbox volume {_bbvol(x['bb']):.6g}")
        if x.get("v") is not None and x["v"] < 0:
            v[name].append("negative volume")
    kind = case["kind"]

    def vol(n: str) -> float | None:
        return ops[n]["v"] if n in ops and ops[n].get("ok") and ops[n].get("v") is not None else None

    if kind == "csg":
        a, b, u, i, d, e = (vol(n) for n in ("A", "B", "U", "I", "D", "E"))
        if None not in (a, b, u, i) and not close(u + i, a + b, 1e-6, 1e-5):
            v["U"].append(f"|U|+|I|={u + i:.7g} != |A|+|B|={a + b:.7g}")
        if None not in (a, i, d) and not close(d, a - i, 1e-6, 1e-5):
            v["D"].append(f"|A-B|={d:.7g} != |A|-|I|={a - i:.7g}")
        if None not in (b, i, e) and not close(e, b - i, 1e-6, 1e-5):
            v["E"].append(f"|B-A|={e:.7g} != |B|-|I|={b - i:.7g}")
        if None not in (a, b, u) and (u > a + b + 1e-5 * (a + b) or u < max(a, b) - 1e-5 * (a + b)):
            v["U"].append(f"|U|={u:.7g} outside [max(|A|,|B|), |A|+|B|]")
        m = ops.get("M")
        if m and m.get("ok") and u is not None and "cellv" in m and not close(sum(m["cellv"]), u, 1e-6, 1e-5):
            v["M"].append(f"sum of cells {sum(m['cellv']):.7g} != |U| {u:.7g}")
    elif kind in ("fillet", "chamfer", "shell", "offset"):
        base = vol("base")
        bb = ops.get("base", {}).get("bb")
        res = resolve_of(r) or (resolved or {})
        out = {"fillet": "F", "chamfer": "C", "shell": "S", "offset": "O"}[kind]
        o = vol(out)
        if base is not None and o is not None and bb:
            exp = _exact(case, kind, res, bb, base, o, vol, v, out)
            if exp is not None and not close(o, exp, 2e-6, 1e-5):
                v[out].append(f"volume {o:.7g} != exact {exp:.7g} (rel {abs(o - exp) / exp:.2g})")
    elif kind == "slice":
        base, ab, be = vol("base"), vol("above"), vol("below")
        oa, ob = ops.get("above", {}), ops.get("below", {})
        if base is not None:
            if ab is not None and be is not None and not close(ab + be, base, 1e-6, 1e-5):
                v["above"].append(f"above+below {ab + be:.7g} != base {base:.7g}")
            if ab is None and "nothing" in oa.get("msg", "") and be is not None and not close(be, base, 1e-6, 1e-5):
                v["below"].append(f"nothing above but below {be:.7g} != base {base:.7g}")
            if be is None and "nothing" in ob.get("msg", "") and ab is not None and not close(ab, base, 1e-6, 1e-5):
                v["above"].append(f"nothing below but above {ab:.7g} != base {base:.7g}")
    return {k: x for k, x in v.items() if x}


def _exact(case: dict, kind: str, res: dict, bb: list[float], base: float, o: float, vol: Any,
           v: dict[str, list[str]], out: str) -> float | None:
    """The exact volume of a fillet, chamfer, shell or offset of a single primitive (None where
    there is no formula), and the sign checks of shells and offsets."""
    dims = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]]
    c = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2]
    boxp, cylp = _only(case["base"], ("box",)), _only(case["base"], ("cyl",))
    sphp, torp = _only(case["base"], ("sph",)), _only(case["base"], ("tor",))
    if kind == "offset":
        dd = res.get("d")
        if dd is None:
            return None
        if dd > 0 and o <= base:
            v[out].append("offset(+d) did not grow")
        if dd < 0 and o >= base:
            v[out].append("offset(-d) did not shrink")
        o2 = vol("O2")
        if o2 is not None and (boxp or cylp or sphp or torp) and not close(o2, base, 1e-6, 1e-5):
            v["O2"].append(f"offset(+d).offset(-d) {o2:.7g} != base {base:.7g}")
        if boxp:
            return math.prod(x + 2 * dd for x in dims)
        if cylp:
            return PI * (cylp[1] + dd) ** 2 * (cylp[2] + 2 * dd)
        if sphp:
            return 4 / 3 * PI * (sphp[1] + dd) ** 3
        if torp:
            return 2 * PI * PI * torp[1] * (torp[2] + dd) ** 2
        return None
    if kind == "shell":
        t, faces = res.get("t"), res.get("faces", [])
        if not t:
            return None
        if o >= base:
            v[out].append("shell did not remove volume")
        if boxp:
            opens = [0, 0, 0]
            for f in faces:
                ax = [j for j in range(3) if abs(abs(f[j] - c[j]) - dims[j] / 2) < 1e-4]
                if len(ax) != 1:
                    return None
                opens[ax[0]] += 1
            return math.prod(dims) - math.prod(dims[j] - t * (2 - opens[j]) for j in range(3))
        if cylp and all(ft == "plane" for ft in res.get("open_types", [])):
            R, h = cylp[1], cylp[2]
            return PI * R * R * h - PI * (R - t) ** 2 * (h - t * (2 - len(faces)))
        if sphp and not faces:
            return 4 / 3 * PI * (sphp[1] ** 3 - (sphp[1] - t) ** 3)
        if torp and not faces:
            return 2 * PI * PI * torp[1] * (torp[2] ** 2 - (torp[2] - t) ** 2)
        return None
    rr, sel = res.get("size"), res.get("edges", [])
    if not rr or not sel:
        return None
    if boxp:
        lens, verts, shared = [], set(), False
        for e in sel:
            ax = [j for j in range(3) if abs(abs(e[j] - c[j]) - dims[j] / 2) > 1e-4]
            lens.append(dims[ax[0]] if len(ax) == 1 else None)
            if len(ax) != 1:
                continue
            for sgn in (-1, 1):
                p = list(e)
                p[ax[0]] = c[ax[0]] + sgn * dims[ax[0]] / 2
                k = tuple(round(q, 4) for q in p)
                shared |= k in verts
                verts.add(k)
        if None in lens:
            return None
        a_, b_, c_ = dims
        if kind == "fillet":
            if len(sel) == 12:
                return a_ * b_ * c_ - (4 - PI) * rr * rr * (a_ + b_ + c_ - 6 * rr) - 8 * rr ** 3 * (1 - PI / 6)
            if not shared:
                return a_ * b_ * c_ - sum((1 - PI / 4) * rr * rr * L for L in lens)
        elif not shared:
            return a_ * b_ * c_ - sum(rr * rr / 2 * L for L in lens)
        return None
    if cylp:
        R, h = cylp[1], cylp[2]
        n = len(sel)
        if kind == "fillet":
            return PI * R * R * h - n * 2 * PI * (R - SP * rr) * (1 - PI / 4) * rr * rr
        return PI * R * R * h - n * 2 * PI * (R - rr / 3) * rr * rr / 2
    return None


def classify(case: dict, r: dict, resolved: dict | None = None) -> tuple[dict[str, str], dict[str, list[str]]]:
    """{op: class} (crash, hang, trap, error, silent, ok) and the violations."""
    ops = ops_of(r)
    viol = violations(case, r, resolved)
    cls = {}
    for name, x in ops.items():
        if name == "harness_error":
            cls[name] = "harness"
        elif not x.get("ok"):
            cls[name] = "trap" if x.get("trap") else "error"
        else:
            cls[name] = "silent" if viol.get(name) else "ok"
    if r.get("fate") in ("crash", "hang", "trap") and r.get("in_op"):
        cls[r["in_op"]] = r["fate"]
    return cls, viol


def summary(cases: dict[str, dict], results: list[dict], resolved: dict | None = None) -> dict:
    """Counts per kind and class over the main operations, and the cases that crashed, hung,
    trapped or broke an invariant: {"counts": {kind: {class: n}}, "bad": {"<id> <op>": class}}."""
    counts: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    bad = {}
    for r in results:
        case = cases[r["id"]]
        cls, _ = classify(case, r, (resolved or {}).get(r["id"]))
        for op in MAIN[case["kind"]]:
            if op in cls:
                counts[case["kind"]][cls[op]] += 1
                counts[case["kind"]]["n"] += 1
        for op, c in cls.items():
            if c in ("silent", "crash", "hang", "trap", "harness"):
                bad[f"{r['id']} {op}"] = c
    return {"counts": {k: dict(c) for k, c in counts.items()}, "bad": bad}


def rates(counts: dict[str, dict]) -> dict[str, float]:
    """The silent rate of each kind, in percent of its main operations."""
    return {k: 100.0 * c.get("silent", 0) / c["n"] for k, c in counts.items() if c.get("n")}


def divergence(cases: dict[str, dict], a: list[dict], b: list[dict], resolved: dict) -> dict[str, str]:
    """Operations whose class or volume differs between two runs (smlibpy and smlibwasm):
    {"<id> <op>": "class x/y" or "volume x/y"}. A crash and a trap count as the same; volumes
    agree within 1e-6."""
    out = {}
    bmap = {r["id"]: r for r in b}
    for ra in a:
        rb = bmap.get(ra["id"])
        if rb is None:
            continue
        case = cases[ra["id"]]
        ca, _ = classify(case, ra, resolved.get(ra["id"]))
        cb, _ = classify(case, rb, resolved.get(ra["id"]))
        oa, ob = ops_of(ra), ops_of(rb)
        for op in set(ca) | set(cb):
            if op in ("harness_error",):
                continue
            x, y = ca.get(op, "absent"), cb.get(op, "absent")
            norm = {"crash": "fail", "trap": "fail"}
            if norm.get(x, x) != norm.get(y, y):
                out[f"{ra['id']} {op}"] = f"class {x}/{y}"
                continue
            if x in ("ok", "silent"):
                va, vb = oa[op].get("v"), ob[op].get("v")
                if va is not None and vb is not None and abs(va - vb) > 1e-6 * max(1.0, abs(va)):
                    out[f"{ra['id']} {op}"] = f"volume {va:.9g}/{vb:.9g}"
    return out


def load(path: str) -> list[dict]:
    return [json.loads(line) for line in open(path) if line.strip()]
