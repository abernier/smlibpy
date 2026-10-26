"""Code that rebuilds a fuzz case: the shape expressions as smlibpy calls, and a pytest stub that
runs the operation that failed (written next to a run's results for each new failure)."""

from __future__ import annotations

import math


def _num(x: float) -> str:
    return repr(float(x)) if not float(x).is_integer() else str(int(x))


def code(e: list) -> str:
    """A shape expression (gen.py) as smlibpy code."""
    t = e[0]
    if t == "box":
        return f"Box({_num(e[1])}, {_num(e[2])}, {_num(e[3])})"
    if t == "cyl":
        return f"Cylinder({_num(e[1])}, {_num(e[2])})"
    if t == "cone":
        return f"Cone({_num(e[1])}, {_num(e[2])}, {_num(e[3])})"
    if t == "sph":
        return f"Sphere({_num(e[1])})"
    if t == "tor":
        return f"Torus({_num(e[1])}, {_num(e[2])})"
    if t == "rot":
        return f"{code(e[1])}.rotate({e[2]}, {_num(e[3])})"
    if t == "tr":
        return f"{code(e[1])}.translate({_num(e[2])}, {_num(e[3])}, {_num(e[4])})"
    return f"({code(e[1])}).{ {'fuse': 'fuse', 'cut': 'cut', 'int': 'intersect'}[t] }({code(e[2])})"


def stub(case: dict, resolved: dict, op: str, what: str) -> str:
    """A pytest file that runs operation ``op`` of the case (``what``: how it failed)."""
    lines = [f'"""Fuzz case {case["id"]}, operation {op}: {what}."""', "",
             "import smlibpy.defeature", "from smlibpy import *", "",
             "smlibpy.defeature.GUARD_SECONDS = 0  # (the kernel in this process: a crash ends it)", "", "",
             "def _nearest(items, points):",
             "    return [min(items, key=lambda s: (s.center() - Vector(*p)).length) for p in points]", "", "",
             f"def test_{case['id'].replace('-', '_')}_{op}():"]
    kind = case["kind"]
    if kind == "csg":
        lines += [f"    A = {code(case['A'])}", f"    B = {code(case['B'])}"]
        body = {"U": "A + B", "I": "A & B", "D": "A - B", "E": "B - A", "M": "A.merge(B).cells()",
                "A": "A", "B": "B"}.get(op, "A + B")
        lines += [f"    result = {body}"]
        if op in ("U", "I", "D", "E"):
            lines += ["    a, b = A.volume, B.volume",
                      "    u, i = (A + B).volume, (A & B).volume",
                      "    assert abs(u + i - (a + b)) <= 1e-6 * (a + b)  # inclusion-exclusion"]
            if op == "D":
                lines += ["    assert abs(result.volume - (a - i)) <= 1e-6 * a"]
            if op == "E":
                lines += ["    assert abs(result.volume - (b - i)) <= 1e-6 * b"]
        return "\n".join(lines) + "\n"
    lines += [f"    P = {code(case['base'])}"]
    if kind in ("fillet", "chamfer"):
        lines += [f"    edges = _nearest(P.edges(), {resolved.get('edges', [])!r})",
                  f"    result = P.{kind}(edges, {resolved.get('size')!r})", "    assert result.is_valid()"]
    elif kind == "shell":
        faces = resolved.get("faces", [])
        openings = f"_nearest(P.faces(), {faces!r})" if faces else "None"
        lines += [f"    result = P.shell({resolved.get('t')!r}, {openings})", "    assert result.is_valid()"]
    elif kind == "offset":
        d = resolved.get("d")
        lines += [f"    result = P.offset({d!r})", "    assert result.is_valid()"]
        if op == "O2":
            lines += [f"    back = result.offset({-d!r})", "    assert abs(back.volume - P.volume) <= 1e-6 * P.volume"]
    elif kind == "slice":
        i = "XYZ".index(case["axis"])
        n = [0.0, 0.0, 0.0]
        n[i] = 1.0
        if case["tilt"]:
            n[(i + 1) % 3] = math.tan(math.radians(case["tilt"]))
        o = [0.0, 0.0, 0.0]
        o[i] = case["at"]
        lines += [f"    plane = Plane({tuple(o)!r}, z_dir={tuple(n)!r})",
                  "    above, below = P.split(plane, 'above'), P.split(plane, 'below')",
                  "    assert abs(above.volume + below.volume - P.volume) <= 1e-6 * P.volume"]
    return "\n".join(lines) + "\n"
