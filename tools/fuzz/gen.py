"""Seeded generator of small models for the fuzz run (tools/fuzz/fuzz.py).

A case is JSON: ``{"id", "kind", ...}`` with its shapes as expressions:

    ["box", l, w, h]  ["cyl", r, h]  ["cone", r1, r2, h]  ["sph", r]  ["tor", R, r]
    ["rot", e, "X" | "Y" | "Z", degrees]  ["tr", e, x, y, z]  ["fuse" | "cut" | "int", a, b]

Kinds: ``csg`` (two bodies A and B: their union, intersection, both differences and the cells of
their merge), ``fillet`` and ``chamfer`` (a base body, an edge selection drawn by ``mode`` and
``pick``, a size as a fraction of what the edges allow), ``shell`` (openings, a thickness),
``offset`` (a distance) and ``slice`` (a plane through the body, tilted or not).

Placements are biased toward the degenerate ones that break Booleans (flush, touching, centred,
on a face) over generic ones; the same seed gives the same cases on every machine.
"""

from __future__ import annotations

import json
import random
import sys

SIZES = [4, 5, 6, 8, 10, 12, 16, 20]
RADII = [1.5, 2, 2.5, 3, 4, 5, 6]
#: The mix of kinds of a run, per 41 cases (seed 7 and 8 runs: 410 cases).
MIX = {"csg": 16, "fillet": 6, "chamfer": 4, "shell": 6, "offset": 5, "slice": 4}


def prim(rng: random.Random) -> tuple[list, tuple[float, float, float]]:
    """A primitive and its half extents."""
    t = rng.choices(["box", "cyl", "cone", "sph", "tor"], [4, 4, 1.5, 1.5, 1])[0]
    if t == "box":
        e: list = ["box", rng.choice(SIZES), rng.choice(SIZES), rng.choice(SIZES)]
        half = (e[1] / 2, e[2] / 2, e[3] / 2)
    elif t == "cyl":
        r, h = rng.choice(RADII), rng.choice(SIZES + [30])
        e = ["cyl", r, h]
        half = (r, r, h / 2)
    elif t == "cone":
        r1, r2, h = rng.choice(RADII), rng.choice([0] + RADII), rng.choice(SIZES)
        if r1 == r2:
            r2 = 0
        e = ["cone", r1, r2, h]
        half = (max(r1, r2), max(r1, r2), h / 2)
    elif t == "sph":
        r = rng.choice(RADII + [8, 10])
        e = ["sph", r]
        half = (r, r, r)
    else:
        big = rng.choice([5, 6, 8, 10])
        r = rng.choice([x for x in RADII if x < big])
        e = ["tor", big, r]
        half = (big + r, big + r, r)
    # the primitive's own axis along Z, X or Y
    ax = rng.choices(["Z", "X", "Y"], [3, 2, 1])[0]
    if ax == "X":
        e = ["rot", e, "Y", 90]
        half = (half[2], half[1], half[0])
    elif ax == "Y":
        e = ["rot", e, "X", 90]
        half = (half[0], half[2], half[1])
    return e, half


def coord(rng: random.Random, lo: float, hi: float, h: float) -> tuple[float, str]:
    """The centre coordinate of an operand of half size ``h`` against [lo, hi]."""
    kind = rng.choices(["flushmin", "flushmax", "touchmin", "touchmax", "center", "onface", "generic", "inset"],
                       [2, 2, 1, 1, 3, 1.5, 3, 1.5])[0]
    if kind == "flushmin":
        return lo + h, kind
    if kind == "flushmax":
        return hi - h, kind
    if kind == "touchmin":
        return lo - h, kind
    if kind == "touchmax":
        return hi + h, kind
    if kind == "center":
        return (lo + hi) / 2, kind
    if kind == "onface":
        return rng.choice([lo, hi]), kind
    if kind == "inset":
        return rng.choice([lo + h + 1, hi - h - 1, lo + 1, hi - 1]), kind
    return round(rng.uniform(lo - h * 0.8, hi + h * 0.8), 3) + 0.0137, kind


def placed(rng: random.Random, half_a: tuple[float, float, float]) -> tuple[list, tuple, list[str]]:
    """A primitive placed against a body of half extents ``half_a`` centred at the origin."""
    e, h = prim(rng)
    xyz, kinds = [], []
    for i in range(3):
        c, kd = coord(rng, -half_a[i], half_a[i], h[i])
        xyz.append(round(c, 6))
        kinds.append(kd)
    if any(abs(c) > 1e-12 for c in xyz):
        e = ["tr", e, *xyz]
    return e, h, kinds


def base(rng: random.Random, simple_p: float = 0.45) -> tuple[list, tuple, list[str]]:
    """A base body: one primitive, or two combined."""
    a, ha = prim(rng)
    if rng.random() < simple_p:
        return a, ha, ["prim"]
    b, _, kinds = placed(rng, ha)
    op = rng.choices(["fuse", "cut"], [1, 1])[0]
    return [op, a, b], ha, kinds


def gen(seed: int, counts: dict[str, int]) -> list[dict]:
    """The cases of a seed: ``counts`` of each kind, in the order of ``counts``."""
    rng = random.Random(seed)
    cases = []
    n = 0
    for kind, cnt in counts.items():
        for _ in range(cnt):
            cid = f"{kind}-{seed}-{n}"
            n += 1
            if kind == "csg":
                a, ha, ka = base(rng, 0.6)
                b, _, kb = placed(rng, ha)
                cases.append({"id": cid, "kind": kind, "A": a, "B": b, "tags": ka + kb})
            elif kind in ("fillet", "chamfer"):
                bs, _, tg = base(rng, 0.5)
                mode = rng.choices(["all", "subset", "one", "disjoint"], [2, 4, 2, 1])[0]
                f = rng.choices([0.15, 0.3, 0.45, 0.7, 0.9, 0.97, 0.995], [1, 1, 1, 1, 2, 2, 2])[0]
                cases.append({"id": cid, "kind": kind, "base": bs, "mode": mode, "pick": rng.randrange(1 << 30),
                              "frac": f, "tags": tg})
            elif kind == "shell":
                bs, _, tg = base(rng, 0.5)
                nopen = rng.choices([0, 1, 2], [2, 3, 1])[0]
                f = rng.choices([0.05, 0.1, 0.2, 0.4, 0.7, 0.9, 0.98], [1, 2, 2, 2, 1, 1, 1])[0]
                cases.append({"id": cid, "kind": kind, "base": bs, "nopen": nopen, "pick": rng.randrange(1 << 30),
                              "frac": f, "tags": tg})
            elif kind == "offset":
                bs, _, tg = base(rng, 0.5)
                f = rng.choice([-0.9, -0.6, -0.3, -0.1, 0.05, 0.1, 0.3, 0.6, 1.0])
                cases.append({"id": cid, "kind": kind, "base": bs, "frac": f, "tags": tg})
            elif kind == "slice":
                bs, h, tg = base(rng, 0.3)
                ax = rng.choice(["X", "Y", "Z"])
                i = "XYZ".index(ax)
                c, kd = coord(rng, -h[i], h[i], 0.0)
                tilt = rng.choice([0, 0, 0, 30, 45])
                cases.append({"id": cid, "kind": kind, "base": bs, "axis": ax, "at": round(c, 6), "tilt": tilt,
                              "tags": tg + [kd]})
    return cases


def counts(n: int) -> dict[str, int]:
    """The counts of each kind for about ``n`` cases, in the proportions of MIX."""
    total = sum(MIX.values())
    return {kind: max(1, round(n * share / total)) for kind, share in MIX.items()}


if __name__ == "__main__":
    seed = int(sys.argv[1])
    mix = json.loads(sys.argv[2]) if len(sys.argv) > 2 else counts(410)
    json.dump(gen(seed, mix), sys.stdout)
