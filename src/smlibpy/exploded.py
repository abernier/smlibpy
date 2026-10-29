"""Exploded views of assemblies: each part moved by its offset, the assembly axes between the
places where the parts touch, numbered balloons and a parts list, drawn in software like
:func:`render`.

The axes are found, not given: two parts that touch in the assembled model and move by
different offsets get an axis from where they touch, moved with the one, to the same place
moved with the other. Where they touch is the centroid of their contact area, measured on the
tessellated faces with the kernel's point classification.
"""

from __future__ import annotations

import math
import os
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Literal, NamedTuple

import numpy as np

from .geometry import Vector
from .pictures import Picture

__all__ = ["AssemblyAxis", "assembly_axes", "render_exploded"]

_AXIS_INK = np.array([85, 89, 94]) / 255
_BALLOON_INK = np.array([31, 78, 121]) / 255
_QUANTITY_INK = np.array([100, 100, 100]) / 255


class AssemblyAxis(NamedTuple):
    """Where two parts of an assembly touch, and the axis an exploded view draws there (see
    :func:`assembly_axes`).

    Attributes:
        first: The index of the one part in the list given.
        second: The index of the other part (larger than ``first``).
        contact: The centroid of the area where the two parts touch, in the assembled model.
        area: That area, in square millimeters (0 where the parts touch only along a line or at
            a point; ``contact`` is then a point where they touch).
        start: ``contact`` moved by the first part's offset.
        end: ``contact`` moved by the second part's offset.
    """

    first: int
    second: int
    contact: Vector
    area: float
    start: Vector
    end: Vector


def assembly_axes(parts: Iterable[Any], offsets: Mapping[Any, Any] | Sequence[Any], *,
                  tolerance: float = 0.01) -> list[AssemblyAxis]:
    """The assembly axes of an exploded view: one for every two parts that touch in the
    assembled model and move by different offsets.

    Parts touch where their surfaces come within ``tolerance`` of each other, or where one
    reaches into the other. The axis runs from the centroid of the contact area moved by the
    first part's offset to the same point moved by the second's: the way the two parts come
    together. Parts that move by the same offset get no axis.

    Args:
        parts: The parts, assembled (in their places in the finished model).
        offsets: How far each part moves out: a list of vectors in the order of the parts, or a
            mapping from part names (``Part.named``) or from the parts themselves to vectors.
            Parts a mapping leaves out stay where they are.
        tolerance: The gap, in millimeters, under which two surfaces count as touching.

    Returns:
        The axes as :class:`AssemblyAxis` values, ordered by ``first``, then ``second``.

    Raises:
        TypeError: An item is not a part.
        ValueError: Fewer than two parts, an offset list of another length than the parts, a
            mapping that names a part that is not there, or a part that touches no other one
            (an exploded view starts from the assembled model: move it into place).
    """
    plist, offs = _inputs(parts, offsets, "assembly_axes")
    tol = _tolerance(tolerance, "assembly_axes")
    return _axes(plist, offs, tol, "assembly_axes")


def render_exploded(parts: Iterable[Any], offsets: Mapping[Any, Any] | Sequence[Any], *,
                    path: str | os.PathLike[str] | None = None,
                    view: Literal["iso", "front", "back", "left", "right", "top", "bottom"] | dict[str, Any]
                    | tuple[float, float, float] = "iso",
                    size: tuple[int, int] = (1200, 800), order: Sequence[str] | None = None, axes: bool = True,
                    balloons: bool = True, background: Any = "white", zoom: float = 1.0, supersample: int = 2,
                    tolerance: float = 0.01) -> Picture:
    """An exploded view of an assembly: each part moved by its offset and rendered as
    :func:`render` does, the assembly axes dashed, a numbered balloon on each part that shows and
    a parts list beside the picture.

    The axes are those of :func:`assembly_axes`, drawn over the parts; two that fall on the
    same pixels are drawn once. A balloon points at a pixel near the middle of what shows of its
    part (a part hidden behind others gets none, and keeps its row in the list). The balloons
    stand in two columns left and right of the parts, in the order of their targets, swapped
    while that makes the leaders cross less or run shorter. Parts of the same name share a
    number; the list gives each name once, with how many parts have it. Text is in the
    library's own capitals, as in the other pictures.

    Args:
        parts: The parts, assembled (in their places in the finished model). Their names
            (``Part.named``) are the rows of the list; an unnamed part is ``"part <n>"``.
        offsets: How far each part moves out: a list of vectors in the order of the parts, or a
            mapping from part names or from the parts themselves to vectors. Parts a mapping
            leaves out stay where they are.
        path: Also write the PNG to this file.
        view: The camera, as for :func:`render` (a name, ``{"azimuth", "elevation"}``,
            ``{"direction", "up"}`` or the direction towards the camera).
        size: Width and height of the whole picture in pixels, the parts list included.
        order: The names in the order they are numbered (the order of assembly, say); every
            name of the parts once. By default the order in which the names first come.
        axes: Draw the assembly axes.
        balloons: Draw the balloons and the parts list.
        background: Background color.
        zoom: Factor on the scale that fits the moved parts into the space left by the balloons.
        supersample: As for :func:`render` (1 to 4).
        tolerance: The gap under which two surfaces touch (see :func:`assembly_axes`).

    Returns:
        A :class:`Picture`, as :func:`render` gives: the PNG's bytes, ``.pixels`` and ``.frame``
        (the frame of the moved parts' view, the balloons and the list drawn over it).

    Raises:
        TypeError: An item is not a part.
        ValueError: The checks of :func:`assembly_axes`; an ``order`` that misses a name of the
            parts, names one twice or names one that is not there; balloons that do not fit in
            the picture's height (give a larger size).
    """
    from .colors import to_rgb
    from .pictures import _Camera, _Canvas, _fit, _Options, _png, _Scene, _view

    plist, offs = _inputs(parts, offsets, "render_exploded")
    tol = _tolerance(tolerance, "render_exploded")
    w, h = int(size[0]), int(size[1])
    if w < 1 or h < 1:
        raise ValueError(f"render_exploded: size must be positive, got {size!r}")
    k = int(supersample)
    if not 1 <= k <= 4:
        raise ValueError(f"render_exploded: supersample must be 1 to 4, got {supersample!r}")
    if not zoom > 0:
        raise ValueError(f"render_exploded: zoom must be positive, got {zoom!r}")
    k = max(1, min(k, int(math.sqrt((1 << 24) / (w * h)))))
    names = [p.name if p.name else f"part {i + 1}" for i, p in enumerate(plist)]
    rows = _rows(names, order)
    number = {name: n + 1 for n, (name, _) in enumerate(rows)}

    bg = np.array(to_rgb(background), dtype=np.float64)
    moved = [p.translate(*o) for p, o in zip(plist, offs, strict=True)]
    cam = _Camera.of(view)
    scene = _Scene(moved, None, "native")
    lay = _Layout(w, h, rows if balloons else [])
    frame = _fit(scene, cam, max(lay.view_w - 2 * lay.column, 1), h, zoom)
    frame["mid_x"] += (w - lay.view_w) / 2 / frame["scale"]  # the parts in the middle of the space left of the list
    opts = _Options(k=k, bg=bg, edges=True, lines=False, xray=False, alpha=0.42, section=None, markers=[],
                    annotate=False)
    img = _view(scene, cam, w, h, opts, frame)

    cv = _Canvas(w, h, k, cam, frame, bg)
    cv.img[:] = np.repeat(np.repeat(img, k, axis=0), k, axis=1).reshape(-1, 3)
    if axes:
        found = _axes(plist, offs, tol, "render_exploded")
        segs = [(*_pixel(cv, a.start), *_pixel(cv, a.end)) for a in found]
        _dashed(cv, _distinct(segs, 4.0 * lay.u), _AXIS_INK, lay)
    if balloons:
        owners = _owners(scene, cam, w, h, frame)
        targets = _targets(owners, len(plist), lay.u)
        shown = owners >= 0
        if shown.any():
            xs = np.nonzero(shown)[1]
            silhouette = (float(xs.min()), float(xs.max()))
        else:
            silhouette = (lay.view_w / 2, lay.view_w / 2)
        items = [(t, number[names[i]]) for i, t in enumerate(targets) if t is not None]
        _draw_balloons(cv, _place(items, silhouette, lay), lay)
        _draw_list(cv, rows, lay)
    out = cv.finish()
    pixels = np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)
    pic = Picture(_png(pixels), pixels, dict(frame))
    if path is not None:
        pic.save(path)
    return pic


# -----------------------------------------------------------------------------
# inputs
# -----------------------------------------------------------------------------
def _inputs(parts: Any, offsets: Any, fn: str) -> tuple[list[Any], list[np.ndarray]]:
    from .pictures import _vec3
    from .shapes import Part

    plist = [parts] if isinstance(parts, Part) else list(parts)
    for p in plist:
        if not isinstance(p, Part):
            raise TypeError(f"{fn} takes parts, not a {type(p).__name__}")
    if len(plist) < 2:
        raise ValueError(f"{fn}: an exploded view needs two parts or more, got {len(plist)}")
    if isinstance(offsets, Mapping):
        offs = [np.zeros(3) for _ in plist]
        names = [p.name for p in plist]
        for key, value in offsets.items():
            if isinstance(key, str):
                hit = [i for i, n in enumerate(names) if n == key]
                if not hit:
                    known = ", ".join(sorted({repr(n) for n in names if n})) or "none"
                    raise ValueError(f"{fn}: no part is named {key!r}; the names are {known}")
            else:
                hit = [i for i, p in enumerate(plist) if p is key]
                if not hit:
                    raise ValueError(f"{fn}: an offset is given for a {type(key).__name__} that is not one of the "
                                     f"parts; key the mapping by the parts given, or by their names")
            for i in hit:
                offs[i] = _vec3(value)
        return plist, offs
    if isinstance(offsets, (str, bytes)) or not isinstance(offsets, Iterable):
        raise TypeError(f"{fn}: offsets are a list of vectors, one per part, or a mapping from names or parts to "
                        f"vectors, not a {type(offsets).__name__}")
    items = list(offsets)
    if len(items) != len(plist):
        raise ValueError(f"{fn}: {len(items)} offsets for {len(plist)} parts; give one per part, in their order, "
                         f"or a mapping by name")
    return plist, [_vec3(v) for v in items]


def _tolerance(tolerance: float, fn: str) -> float:
    tol = float(tolerance)
    if not (math.isfinite(tol) and tol > 0):
        raise ValueError(f"{fn}: the tolerance must be positive, got {tolerance!r}")
    return tol


def _rows(names: list[str], order: Sequence[str] | None) -> list[tuple[str, int]]:
    """The parts list: (name, how many parts have it), numbered in this order."""
    count: dict[str, int] = {}
    for n in names:
        count[n] = count.get(n, 0) + 1
    if order is None:
        return list(count.items())
    if isinstance(order, str):
        raise TypeError("render_exploded: order is a list of names, not one string")
    wanted = [str(n) for n in order]
    unknown = [n for n in wanted if n not in count]
    if unknown:
        raise ValueError(f"render_exploded: order names {', '.join(map(repr, unknown))}, which no part has; the "
                         f"names are {', '.join(map(repr, count))}")
    twice = sorted({n for n in wanted if wanted.count(n) > 1})
    if twice:
        raise ValueError(f"render_exploded: order names {', '.join(map(repr, twice))} more than once")
    missing = [n for n in count if n not in wanted]
    if missing:
        raise ValueError(f"render_exploded: order leaves out {', '.join(map(repr, missing))}; give every name once")
    return [(n, count[n]) for n in wanted]


# -----------------------------------------------------------------------------
# contacts and axes
# -----------------------------------------------------------------------------
def _axes(parts: list[Any], offs: list[np.ndarray], tol: float, fn: str) -> list[AssemblyAxis]:
    boxes = [_box(p) for p in parts]
    touched = [False] * len(parts)
    out = []
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            contact = _contact(parts[i], parts[j], boxes[i], boxes[j], tol)
            if contact is None:
                continue
            touched[i] = touched[j] = True
            if np.linalg.norm(offs[i] - offs[j]) <= 1e-9:
                continue
            c, area = contact
            out.append(AssemblyAxis(i, j, Vector(*c), area, Vector(*(c + offs[i])), Vector(*(c + offs[j]))))
    alone = [i for i, t in enumerate(touched) if not t]
    if alone:
        said = ", ".join(f"{i} ({parts[i].name!r})" if parts[i].name else str(i) for i in alone)
        raise ValueError(f"{fn}: part {said} touches no other part within {tol:g} mm; the parts are given assembled "
                         f"and moved by the offsets: put it in its place, or raise the tolerance")
    return out


def _box(part: Any) -> tuple[np.ndarray, np.ndarray]:
    b = part.bbox()
    return np.array(b.min.to_tuple()), np.array(b.max.to_tuple())


def _contact(a: Any, b: Any, box_a: Any, box_b: Any, tol: float) -> tuple[np.ndarray, float] | None:
    """Where two parts touch: the centroid of the contact area and the area, or None."""
    lo, hi = np.maximum(box_a[0], box_b[0]) - tol, np.minimum(box_a[1], box_b[1]) + tol
    if (lo > hi).any() or a.distance_to(b) > tol:
        return None
    best: tuple[np.ndarray, float] | None = None
    for p, q in ((a, b), (b, a)):
        found = _touching(p, q, lo, hi, tol)
        if found is not None and (best is None or found[1] > best[1]):
            best = found
    if best is None:  # along a line or at a point
        return np.array(a.closest_points(b).point.to_tuple()), 0.0
    return best


def _touching(p: Any, q: Any, lo: np.ndarray, hi: np.ndarray, tol: float) -> tuple[np.ndarray, float] | None:
    """The area of p's surface that lies on or in q, and its centroid: the triangles of p's
    faces (in the box where the two meet) whose corners q classifies as on or inside it."""
    span = hi - lo
    sizes = sorted(float(s) for s in span if s > 4 * tol) or [float(span.max())]
    edge = max(sizes[0] / 8, 10 * tol)
    chord = max(tol / 4, float(span.max()) / 4000)
    tris = []
    for face in p.faces():
        fb = face.bbox()
        f_lo, f_hi = np.array(fb.min.to_tuple()), np.array(fb.max.to_tuple())
        if (f_lo > hi).any() or (f_hi < lo).any():
            continue
        # fine where the face is about the size of the contact, at most some 3600 triangles on a large one
        m = face.mesh(chord, max_edge=max(edge, float(np.linalg.norm(f_hi - f_lo)) / 60))
        if not len(m.triangles):
            continue
        v = m.vertices
        near = ((v >= lo) & (v <= hi)).all(axis=1)
        on = np.zeros(len(v), dtype=bool)
        idx = np.flatnonzero(near)
        if len(idx):
            on[idx] = [r[0] != "outside" for r in q._classify([tuple(c) for c in v[idx]], tol)]
        keep = on[m.triangles].all(axis=1)
        if keep.any():
            tris.append(v[m.triangles[keep]])
    if not tris:
        return None
    t = np.concatenate(tris)
    area = 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    total = float(area.sum())
    if total <= 0:
        return None
    return (area[:, None] * t.mean(axis=1)).sum(axis=0) / total, total


# -----------------------------------------------------------------------------
# drawing
# -----------------------------------------------------------------------------
class _Layout:
    """Sizes in output pixels: the font scale, the balloons, the parts list at the right."""

    def __init__(self, w: int, h: int, rows: list[tuple[str, int]]):
        from .pictures import _text_width

        self.w, self.h = w, h
        self.u = max(1, round(min(w, h) / 600))
        self.s = self.u + 1  # the font scale
        s = self.s
        widest = max([_text_width(str(n + 1), s) for n in range(len(rows))] or [0])
        self.r = max(7 * s, widest / 2 + 3 * s)  # balloon radius
        self.column = 2 * self.r + 10 * s if rows else 0  # kept free beside the parts for the balloons
        self.row_h = 2 * self.r + 3 * s
        if rows:
            names = max(_text_width(n.upper(), s) for n, _ in rows)
            counts = max(_text_width(f"×{c}", s) for _, c in rows)
            self.list_w = int(2 * self.r + 4 * s + names + 10 * s + counts + 8 * s)
        else:
            self.list_w = 0
        self.view_w = w - self.list_w


def _pixel(cv: Any, p: Vector) -> tuple[float, float]:
    x, y, _ = cv.screen(np.array([p.to_tuple()]))
    return float(x[0]) / cv.k, float(y[0]) / cv.k


def _distinct(segs: list[tuple[float, float, float, float]], tol: float) -> list[tuple[float, float, float, float]]:
    """The segments without those shorter than ``tol``; segments on one line (within ``tol``)
    that overlap or meet become one, so that their dashes do not run into each other."""
    kept: list[tuple[float, float, float, float]] = []
    for s in segs:
        if math.hypot(s[2] - s[0], s[3] - s[1]) < tol:
            continue
        merged = True
        while merged:
            merged = False
            for n, k in enumerate(kept):
                joined = _joined(k, s, tol)
                if joined is not None:
                    s = joined
                    del kept[n]
                    merged = True
                    break
        kept.append(s)
    return kept


def _joined(a: tuple[float, float, float, float], b: tuple[float, float, float, float],
            tol: float) -> tuple[float, float, float, float] | None:
    """The two segments as one when they lie on one line and overlap or meet, else None."""
    length = math.hypot(a[2] - a[0], a[3] - a[1])
    dx, dy = (a[2] - a[0]) / length, (a[3] - a[1]) / length
    off = [abs((x - a[0]) * dy - (y - a[1]) * dx) for x, y in ((b[0], b[1]), (b[2], b[3]))]
    if max(off) > tol:
        return None
    t_b = sorted(((b[0] - a[0]) * dx + (b[1] - a[1]) * dy, (b[2] - a[0]) * dx + (b[3] - a[1]) * dy))
    if t_b[0] > length + tol or t_b[1] < -tol:
        return None
    lo, hi = min(0.0, t_b[0]), max(length, t_b[1])
    return (a[0] + dx * lo, a[1] + dy * lo, a[0] + dx * hi, a[1] + dy * hi)


def _dashed(cv: Any, segs: list[tuple[float, float, float, float]], color: np.ndarray, lay: _Layout) -> None:
    from .pictures import _screen_lines

    dash, gap, k = 8.0 * lay.u, 6.0 * lay.u, cv.k
    pieces = []
    for x0, y0, x1, y1 in segs:
        length = math.hypot(x1 - x0, y1 - y0)
        t = 0.0
        while t < length:
            e = min(t + dash, length)
            pieces.append((k * (x0 + (x1 - x0) * t / length), k * (y0 + (y1 - y0) * t / length),
                           k * (x0 + (x1 - x0) * e / length), k * (y0 + (y1 - y0) * e / length)))
            t = e + gap
    _screen_lines(cv, pieces, color, 0.6 * lay.u * k)


def _owners(scene: Any, cam: Any, w: int, h: int, frame: dict[str, float]) -> np.ndarray:
    """Per pixel the index of the part seen there, -1 for the background."""
    from .pictures import _Canvas, _depth_fill, _Triangles

    tris, norms, owner = [], [], []
    for body, item in zip(scene.bodies, scene.owners, strict=True):
        t = body.tris
        if body.closed:
            t_keep = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]) @ cam.back >= 0
            t = t[t_keep]
            n = body.norms[t_keep][..., :3]
        else:
            n = body.norms[..., :3]
        tris.append(t)
        norms.append(n)
        owner.append(np.full(len(t), item))
    cv = _Canvas(w, h, 1, cam, frame, np.zeros(3))
    if not tris or not sum(len(t) for t in tris):
        return np.full((h, w), -1)
    t = np.concatenate(tris)
    sx, sy, sz = cv.screen(t.reshape(-1, 3))
    tri = _Triangles(sx.reshape(-1, 3), sy.reshape(-1, 3), sz.reshape(-1, 3), np.concatenate(norms),
                     np.zeros((len(t), 3)), np.ones(len(t)), cam)
    tbuf = _depth_fill(cv, tri)
    who = np.concatenate(owner)
    return np.where(tbuf >= 0, who[np.maximum(tbuf, 0)], -1).reshape(h, w)


def _targets(owners: np.ndarray, n: int, u: int) -> list[tuple[float, float] | None]:
    """Per part a pixel well inside what shows of it, near its middle; None when too little shows."""
    out: list[tuple[float, float] | None] = []
    m = 2 * u
    for i in range(n):
        mask = owners == i
        inner = mask.copy()
        inner[m:] &= mask[:-m]
        inner[:-m] &= mask[m:]
        inner[:, m:] &= mask[:, :-m]
        inner[:, :-m] &= mask[:, m:]
        ys, xs = np.nonzero(inner)
        if len(xs) < 12 * u * u:
            out.append(None)
            continue
        cx, cy = xs.mean(), ys.mean()
        j = int(np.argmin((xs - cx) ** 2 + (ys - cy) ** 2))
        out.append((float(xs[j]) + 0.5, float(ys[j]) + 0.5))
    return out


def _crosses(s: Any, t: Any) -> bool:
    """Whether two segments cross (their ends excluded)."""
    (p1, p2), (p3, p4) = s, t

    def orient(a: Any, b: Any, c: Any) -> float:
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    d1, d2, d3, d4 = orient(p3, p4, p1), orient(p3, p4, p2), orient(p1, p2, p3), orient(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def _place(items: list[tuple[tuple[float, float], int]], silhouette: tuple[float, float],
           lay: _Layout) -> list[tuple[tuple[float, float], int, float, float]]:
    """The balloons: (target, number, x, y), in a column left and one right of the parts, spread
    so that none overlaps another and leaders cross as little as can be had by swapping."""
    x0, x1 = silhouette
    mid = (x0 + x1) / 2
    r, pitch = lay.r, lay.row_h
    top, bottom = r + 2 * lay.s, lay.h - r - 2 * lay.s
    room = int((bottom - top) // pitch) + 1
    sides: dict[int, list[list[Any]]] = {-1: [], 1: []}
    for target, n in sorted(items, key=lambda it: it[0][0]):
        sides[1 if target[0] > mid else -1].append([target, n, target[1]])
    for a, b in ((-1, 1), (1, -1)):  # a column that is too long gives its innermost balloons to the other
        while len(sides[a]) > room and len(sides[b]) < room:
            sides[a].sort(key=lambda it: it[0][0])
            sides[b].append(sides[a].pop(-1 if a < 0 else 0))
    if len(sides[-1]) > room or len(sides[1]) > room:
        raise ValueError(f"render_exploded: {len(items)} balloons do not fit beside the parts in a picture "
                         f"{lay.h} pixels high; give a larger size")
    placed = []
    for side, col in sides.items():
        if not col:
            continue
        col.sort(key=lambda it: it[2])
        for i, it in enumerate(col):  # push down, then up again from the bottom
            it[2] = max(it[2], top if i == 0 else col[i - 1][2] + pitch)
        for i in range(len(col) - 1, -1, -1):
            it = col[i]
            it[2] = min(it[2], bottom if i == len(col) - 1 else col[i + 1][2] - pitch)
        bx = x0 - r - 5 * lay.s if side < 0 else x1 + r + 5 * lay.s
        bx = min(max(bx, r + 2.0), lay.view_w - r - 2.0)
        slots = [it[2] for it in col]

        def cost(order: list[int], col: list[list[Any]] = col, slots: list[float] = slots, bx: float = bx) -> float:
            legs = [((bx, slots[k]), col[i][0]) for k, i in enumerate(order)]
            n = sum(_crosses(a, b) for j, a in enumerate(legs) for b in legs[j + 1:])
            return n * 1e6 + sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in legs)

        order = list(range(len(col)))
        best, improved = cost(order), True
        while improved:  # swap two balloons while the leaders cross less, or run shorter
            improved = False
            for a in range(len(order)):
                for b in range(a + 1, len(order)):
                    trial = order[:]
                    trial[a], trial[b] = trial[b], trial[a]
                    c = cost(trial)
                    if c < best - 1e-6:
                        order, best, improved = trial, c, True
        placed += [(col[i][0], col[i][1], bx, slots[k]) for k, i in enumerate(order)]
    return placed


def _disc(cv: Any, x: float, y: float, radius: float, color: np.ndarray) -> None:
    """A filled disc, in output pixels."""
    k = cv.k
    cx, cy, rr = x * k, y * k, radius * k
    x0, x1 = max(int(cx - rr - 1), 0), min(int(cx + rr + 2), cv.W)
    y0, y1 = max(int(cy - rr - 1), 0), min(int(cy + rr + 2), cv.H)
    if x1 <= x0 or y1 <= y0:
        return
    gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    inside = (gx - cx) ** 2 + (gy - cy) ** 2 <= rr * rr
    img = cv.img.reshape(cv.H, cv.W, 3)
    img[y0:y1, x0:x1][inside] = color


def _balloon(cv: Any, x: float, y: float, n: int, lay: _Layout) -> None:
    from .pictures import _WHITE

    _disc(cv, x, y, lay.r, _BALLOON_INK)
    _disc(cv, x, y, lay.r - 0.6 * lay.s, _WHITE)
    cv.text(x, y - 3.5 * lay.s, str(n), _BALLOON_INK, lay.s, "middle")


def _draw_balloons(cv: Any, placed: list[tuple[tuple[float, float], int, float, float]], lay: _Layout) -> None:
    from .pictures import _screen_lines

    k = cv.k
    for (tx, ty), _, bx, by in placed:
        d = math.hypot(tx - bx, ty - by) or 1.0
        sx, sy = bx + (tx - bx) / d * lay.r, by + (ty - by) / d * lay.r
        _screen_lines(cv, [(sx * k, sy * k, tx * k, ty * k)], _BALLOON_INK, 0.4 * lay.u * k)
        _disc(cv, tx, ty, 1.5 * lay.u + 1, _BALLOON_INK)
    for _, n, bx, by in placed:
        _balloon(cv, bx, by, n, lay)


def _draw_list(cv: Any, rows: list[tuple[str, int]], lay: _Layout) -> None:
    from .pictures import _EDGE, _text_width

    s, r = lay.s, lay.r
    x = lay.view_w + 2 * s
    y = (lay.h - lay.row_h * len(rows)) / 2 + lay.row_h / 2
    right = lay.w - 6 * s
    for n, (name, count) in enumerate(rows):
        _balloon(cv, x + r, y, n + 1, lay)
        cv.text(x + 2 * r + 4 * s, y - 3.5 * s, name, _EDGE, s)
        quantity = f"×{count}"
        cv.text(right - _text_width(quantity, s), y - 3.5 * s, quantity, _QUANTITY_INK, s)
        y += lay.row_h

