"""Closed loops to a sketch: nesting, fill rules, holes.

Text and DXF drawings both arrive as closed loops of exact curves. Which loops bound material
and which bound holes follows a fill rule:

- ``"nonzero"`` (fonts): a point is inside where the loops around it do not cancel out, counting
  each loop by its turning sense;
- ``"evenodd"`` (drawings): a point is inside where an odd number of loops surrounds it, so a
  loop in a loop is a hole and a loop in a hole an island.

The decisions are made on polygons that follow the curves closely (:func:`plan`); the faces are
then built from the exact curves (:func:`build`). Loops that do not cross each other go to the
kernel in one call, which makes the faces and puts the holes in them. Loops that cross are
resolved with 2D Booleans.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

import numpy as np

from ._kernel import KernelError, ModelingError, ext, k, kernel_call
from .geometry import Plane

__all__ = ["Plan", "plan", "build", "polygons_cross", "point_in_polygon", "signed_area"]


@dataclass
class Plan:
    """How to make the region of a set of loops.

    ``kind`` is ``"faces"`` (the loops in ``keep`` do not cross: one kernel call makes the
    faces), ``"union"`` (each entry of ``components`` is an outer loop and its holes; the region
    is the union of these pieces) or ``"xor"`` (every loop is a region, combined by the even-odd
    rule).
    """

    kind: str
    keep: list[int] = field(default_factory=list)
    components: list[tuple[int, list[int]]] = field(default_factory=list)


def signed_area(polygon: np.ndarray) -> float:
    """Area of a closed polygon (counterclockwise positive)."""
    x, y = polygon[:, 0], polygon[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def point_in_polygon(points: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """For each point, whether it lies inside the closed polygon (crossing count)."""
    px = points[:, 0][:, None]
    py = points[:, 1][:, None]
    ax, ay = polygon[:, 0][None, :], polygon[:, 1][None, :]
    bx, by = np.roll(polygon[:, 0], -1)[None, :], np.roll(polygon[:, 1], -1)[None, :]
    straddles = (ay > py) != (by > py)
    with np.errstate(divide="ignore", invalid="ignore"):
        x_cross = ax + (py - ay) * (bx - ax) / (by - ay)
    hits = straddles & (px < x_cross)
    return (np.count_nonzero(hits, axis=1) % 2) == 1


def polygons_cross(a: np.ndarray, b: np.ndarray) -> bool:
    """True if the edges of two closed polygons cross or touch."""
    lo = np.maximum(a.min(axis=0), b.min(axis=0))
    hi = np.minimum(a.max(axis=0), b.max(axis=0))
    if np.any(lo > hi):
        return False
    a0, a1 = a, np.roll(a, -1, axis=0)
    b0, b1 = b, np.roll(b, -1, axis=0)
    # only the edges inside the common box can meet
    sa = np.all((np.minimum(a0, a1) <= hi) & (np.maximum(a0, a1) >= lo), axis=1)
    sb = np.all((np.minimum(b0, b1) <= hi) & (np.maximum(b0, b1) >= lo), axis=1)
    if not sa.any() or not sb.any():
        return False
    a0, a1, b0, b1 = a0[sa], a1[sa], b0[sb], b1[sb]

    def orient(p: np.ndarray, q: np.ndarray, r: np.ndarray) -> np.ndarray:
        return (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1]) - (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0])

    P, Q = a0[:, None, :], a1[:, None, :]
    R, S = b0[None, :, :], b1[None, :, :]
    d1, d2 = orient(P, Q, R), orient(P, Q, S)
    d3, d4 = orient(R, S, P), orient(R, S, Q)
    meet = (d1 * d2 <= 0) & (d3 * d4 <= 0)
    collinear = (d1 == 0) & (d2 == 0)
    if collinear.any():  # edges on one line meet only where their extents overlap
        overlap = np.all(np.maximum(np.minimum(P, Q), np.minimum(R, S))
                         <= np.minimum(np.maximum(P, Q), np.maximum(R, S)), axis=-1)
        meet = np.where(collinear, overlap, meet)
    return bool(meet.any())


def overlapping_boxes(lo: Sequence[np.ndarray], hi: Sequence[np.ndarray]) -> list[tuple[int, int]]:
    """The pairs of boxes (by index) that overlap: sorted by their left side and swept, so a
    drawing of many separate loops is not compared pair by pair."""
    order = sorted(range(len(lo)), key=lambda i: float(lo[i][0]))
    pairs = []
    for a, i in enumerate(order):
        for j in order[a + 1:]:
            if lo[j][0] > hi[i][0]:
                break
            if np.all(lo[i] <= hi[j]) and np.all(lo[j] <= hi[i]):
                pairs.append((i, j) if i < j else (j, i))
    return pairs


def _samples(polygon: np.ndarray, count: int = 5) -> np.ndarray:
    idx = np.linspace(0, len(polygon), count, endpoint=False).astype(int)
    return polygon[idx]


def plan(polygons: Sequence[np.ndarray], rule: str, areas: Sequence[float] | None = None) -> Plan:
    """Decide which loops bound the region (see :class:`Plan`).

    ``polygons`` follow the loops (closed, without repeating the first point); ``areas`` are
    their signed areas when known exactly (the polygons' areas otherwise).
    """
    n = len(polygons)
    if rule not in ("nonzero", "evenodd"):
        raise ValueError(f"unknown fill rule {rule!r}")
    if n == 0:
        return Plan("faces")
    area = [float(a) for a in areas] if areas is not None else [signed_area(p) for p in polygons]
    boxes = [(p.min(axis=0), p.max(axis=0)) for p in polygons]
    crossing = any(polygons_cross(polygons[i], polygons[j])
                   for i, j in overlapping_boxes([b[0] for b in boxes], [b[1] for b in boxes]))

    def contains(outer: int, inner: int) -> bool:
        if not (np.all(boxes[outer][0] <= boxes[inner][0]) and np.all(boxes[inner][1] <= boxes[outer][1])):
            return False
        inside = point_in_polygon(_samples(polygons[inner]), polygons[outer])
        return int(np.count_nonzero(inside)) * 2 > len(inside)

    order = sorted(range(n), key=lambda i: abs(area[i]))
    if not crossing:
        if rule == "evenodd":  # every loop changes inside and outside
            return Plan("faces", keep=list(range(n)))
        parent = [-1] * n
        for i in range(n):
            for j in order:  # the smallest loop around i is its parent
                if j != i and abs(area[j]) > abs(area[i]) and contains(j, i):
                    parent[i] = j
                    break
        winding: dict[int, int] = {-1: 0}

        def wind(i: int) -> int:
            if i not in winding:
                winding[i] = wind(parent[i]) + (1 if area[i] > 0 else -1)
            return winding[i]

        keep = [i for i in range(n) if (wind(i) != 0) != (wind(parent[i]) != 0)]
        return Plan("faces", keep=keep)
    if rule == "evenodd":
        return Plan("xor", keep=list(range(n)))
    # nonzero with crossing loops: outer loops turn like the largest one, holes the other way;
    # a hole belongs to the smallest outer loop around it.
    big = max(range(n), key=lambda i: abs(area[i]))
    sense = area[big] > 0
    outers = [i for i in range(n) if (area[i] > 0) == sense]
    holes_of: dict[int, list[int]] = {i: [] for i in outers}
    for h in range(n):
        if h in holes_of:
            continue
        around = [o for o in sorted(outers, key=lambda i: abs(area[i])) if abs(area[o]) > abs(area[h]) and contains(o, h)]
        if around:
            holes_of[around[0]].append(h)
        else:  # a loop turned the other way outside every outline is filled as well
            holes_of[h] = []
    return Plan("union", components=[(o, holes_of[o]) for o in holes_of])


def build(p: Plan, curves_of: Callable[[int], list[Any]], plane: Plane, what: str,
          hint: str = "the outlines must be planar and closed") -> Any:
    """The sketch of a plan. ``curves_of(i)`` returns new kernel curves of loop ``i``."""
    from .shapes import Sketch

    def faces(indices: Sequence[int]) -> Any:
        curves: list[Any] = []
        try:
            for i in indices:
                curves.extend(curves_of(i))
            with kernel_call(what, hint):
                return Sketch._wrap(k.create_planar_faces(curves), plane)
        except BaseException:
            for c in curves:  # not consumed on failure
                try:
                    ext.delete_curve(c)
                except Exception:  # pragma: no cover
                    pass
            raise

    if p.kind == "faces":
        if not p.keep:
            raise ModelingError(f"{what}: nothing to draw (the outlines enclose no area)")
        try:
            return faces(p.keep)
        except KernelError:
            if len(p.keep) == 1:
                raise
            # loops that touch upset the kernel's nesting: build each loop and combine them
            return _combined([faces([i]) for i in p.keep], what)
    if p.kind == "xor":
        result = None
        for i in p.keep:
            piece = faces([i])
            result = piece if result is None else result ^ piece
        return result
    pieces = [faces([outer, *holes]) for outer, holes in p.components]
    result = pieces[0]
    for piece in pieces[1:]:
        result = result + piece
    return result


def _combined(pieces: list[Any], what: str) -> Any:
    """Even-odd combination of single-loop regions that may touch."""
    result = pieces[0]
    for piece in pieces[1:]:
        result = result ^ piece
    return result


def union_disjoint(sketches: Sequence[Any], plane: Plane, what: str) -> Any:
    """One sketch holding the faces of sketches that do not overlap (no Booleans)."""
    from .shapes import Sketch

    if len(sketches) == 1:
        return sketches[0]
    with kernel_call(what):
        b = ext.combine([s._brep for s in sketches])
    return Sketch._wrap(b, plane)
