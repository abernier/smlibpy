"""Text: lettering as a sketch with the exact outlines of a font."""

from __future__ import annotations

import functools
import math
import os
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import regions
from ._kernel import k
from .align import Align, AlignLike, _one
from .font import Contour, Font, FontError, Point, Segment, load_font
from .geometry import Plane
from .shapes import Edge, Sketch, Wire, _canonical_curve

__all__ = ["Text"]

# A piece of a glyph outline in font units: ("line", a, b) or ("spline", degree, poles, knots).
Piece = tuple[Any, ...]

_SAMPLES = {2: 1, 3: 8, 4: 12}  # polygon points per segment (by point count) for nesting tests


def Text(
    text: str,
    size: float,
    *,
    font: str | os.PathLike[str] | Font | None = None,
    align: AlignLike = Align.CENTER,
    spacing: float = 0.0,
    line_spacing: float = 1.6,
    kerning: bool = True,
    path: Edge | Wire | None = None,
) -> Sketch:
    """Lettering as a sketch in the XY plane, with the exact outlines of the font.

    Args:
        text: The text; ``"\\n"`` starts a new line.
        size: Height of the capital letters (H, E, T) in mm, the nominal height of technical
            lettering: ``Text("H", 10)`` is 10 mm tall. Round letters overshoot it by a few
            percent; descenders go below the baseline.
        font: Path of a TrueType or OpenType font (``.ttf``, ``.otf``, ``.ttc``, ``.woff``,
            ``.woff2``), or a :class:`~smlibpy.font.Font` that ``load_font`` read. Default: the
            bundled Lato Regular.
        align: Placement of the text's layout box (from the start to the end of the longest line,
            and from the baseline of the last line to the cap height of the first). ``CENTER``
            centers it on the origin; ``MIN`` starts the text at x = 0 with the last baseline on
            y = 0; ``MAX`` ends it at x = 0 with the first cap height on y = 0. One value or one
            per axis; the lines of a block are aligned the same way (left, centered, right).
        spacing: Extra distance between neighbouring letters in mm (negative: closer).
        line_spacing: Distance between baselines as a multiple of ``size``.
        kerning: Apply the font's kerning pairs.
        path: An edge or wire in the XY plane to set one line of text along. Each letter stands
            upright on the path at the arc length of the middle of its advance, turned with the
            tangent; the text reads in the direction of the path and stands on its left side.
            ``align`` places it along the path (``MIN`` at its start) and across it (``MIN``:
            baseline on the path, ``CENTER``: the middle of the capitals, ``MAX``: their top).

    Returns:
        A ``Sketch`` on ``Plane.XY``: one face per separate piece of a letter, counters as holes.
        Outlines are exact: straight segments are lines, curved runs are B-splines through the
        font's on-curve points.

    Raises:
        ValueError: An empty text, a size that is not positive, a character the font does not
            have, a font file that cannot be read, or a path the text does not fit on.
    """
    if not isinstance(text, str):
        raise TypeError(f"Text: the text must be a string, not {type(text).__name__}")
    if not (isinstance(size, (int, float)) and math.isfinite(size) and size > 0):
        raise ValueError(f"Text: size must be a positive number (the height of capital letters in mm), got {size!r}")
    if not (math.isfinite(line_spacing) and line_spacing > 0):
        raise ValueError(f"Text: line_spacing must be positive (a multiple of size), got {line_spacing!r}")
    try:
        f = font if isinstance(font, Font) else load_font(font)
    except FontError as e:
        raise ValueError(f"Text: {e}") from None
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    bad = sorted({c for c in text if (ord(c) < 32 and c not in "\r\n") or 0x7F <= ord(c) < 0xA0})
    if bad:
        raise ValueError("Text: control characters cannot be drawn: " + ", ".join(f"U+{ord(c):04X}" for c in bad))
    missing = sorted({c for c in text if c not in "\r\n" and f.glyph_index(c) is None})
    if missing:
        shown = ", ".join(f"{c!r} (U+{ord(c):04X})" for c in missing[:8])
        raise ValueError(f"Text: the font {f.name} has no glyph for {shown}; pass font= with a font that has "
                         f"{'it' if len(missing) == 1 else 'them'}")
    scale = float(size) / f.cap_height
    laid = [_layout(f, line, scale, float(spacing), kerning) for line in lines]
    if not any(_has_ink(f, g) for line in laid for g, _ in line.glyphs):
        raise ValueError("Text: nothing to draw: the text is empty or only spaces")
    ax, ay = _alignment(align)
    if path is not None:
        placed = _along_path(f, laid, path, float(size), ax, ay)
    else:
        placed = _straight(laid, float(size), float(line_spacing), ax, ay)
    return _sketch(f, placed, scale)


# =============================================================================
# Layout
# =============================================================================
@dataclass
class _Line:
    glyphs: list[tuple[int, float]]  # glyph and the x of its origin in mm
    width: float  # from the first origin to the end of the last advance, in mm


def _layout(f: Font, line: str, scale: float, spacing: float, kerning: bool) -> _Line:
    gids = [f.glyph_index(c) for c in line]
    n = len(gids)
    adv = [f.advance(g) for g in gids]  # type: ignore[arg-type]
    place = [0.0] * n
    if kerning:
        for i in range(n - 1):
            pa = f.kerning(gids[i], gids[i + 1])  # type: ignore[arg-type]
            adv[i] += pa.advance1
            place[i] += pa.placement1
            adv[i + 1] += pa.advance2
            place[i + 1] += pa.placement2
    x = 0.0
    glyphs: list[tuple[int, float]] = []
    for i, g in enumerate(gids):
        glyphs.append((g, x + place[i] * scale))  # type: ignore[arg-type]
        x += adv[i] * scale + (spacing if i < n - 1 else 0.0)
    return _Line(glyphs, x)


def _alignment(align: AlignLike) -> tuple[Align | None, Align | None]:
    if align is None or isinstance(align, (Align, str)):
        a = _one(align)  # type: ignore[arg-type]
        return a, a
    items = list(align)  # type: ignore[arg-type]
    if not 1 <= len(items) <= 3:
        raise ValueError("Text: align takes one value or one per axis (x, y)")
    items += [Align.CENTER] * (2 - len(items))
    return _one(items[0]), _one(items[1])


@dataclass
class _Placed:
    glyph: int
    matrix: tuple[float, float, float, float]  # font units -> mm: x' = a*x + b*y, y' = c*x + d*y
    offset: tuple[float, float]


def _straight(laid: list[_Line], size: float, line_spacing: float, ax: Align | None,
              ay: Align | None) -> list[_Placed]:
    top, bottom = size, -(len(laid) - 1) * line_spacing * size
    dy = {Align.MIN: -bottom, Align.MAX: -top, Align.CENTER: -(top + bottom) / 2.0, None: 0.0}[ay]
    out = []
    for row, line in enumerate(laid):
        dx = {Align.MIN: 0.0, None: 0.0, Align.CENTER: -line.width / 2.0, Align.MAX: -line.width}[ax]
        y = -row * line_spacing * size + dy
        for g, x in line.glyphs:
            out.append(_Placed(g, (1.0, 0.0, 0.0, 1.0), (x + dx, y)))
    return out


def _along_path(f: Font, laid: list[_Line], path: Edge | Wire, size: float, ax: Align | None,
                ay: Align | None) -> list[_Placed]:
    if len(laid) > 1:
        raise ValueError("Text: a text along a path has one line; leave out the line breaks")
    if not isinstance(path, (Edge, Wire)):
        raise TypeError(f"Text: path must be an Edge or a Wire, not {type(path).__name__}")
    box = path.bbox()
    if abs(box.min.z) > 1e-9 * max(1.0, box.diagonal) or abs(box.max.z) > 1e-9 * max(1.0, box.diagonal):
        raise ValueError("Text: the path must lie in the XY plane; draw it there and place the text with .on()")
    line = laid[0]
    length = path.length
    if line.width > length * (1 + 1e-9):
        raise ValueError(f"Text: the text is {line.width:.6g} mm long but the path only {length:.6g} mm; "
                         "use a smaller size or a longer path")
    start = {Align.MIN: 0.0, None: 0.0, Align.CENTER: (length - line.width) / 2.0,
             Align.MAX: length - line.width}[ax]
    lift = {Align.MIN: 0.0, None: 0.0, Align.CENTER: -size / 2.0, Align.MAX: -size}[ay]
    out = []
    for g, x in line.glyphs:
        half = (f.advance(g) * size / f.cap_height) / 2.0
        s = min(max(start + x + half, 0.0), length)
        p = path.point_at(s / length)
        t = path.tangent_at(s / length)
        tx, ty = t.x, t.y
        norm = math.hypot(tx, ty)
        tx, ty = tx / norm, ty / norm
        nx, ny = -ty, tx  # left of the direction of travel
        # local (u, v) in mm -> p + t*(u - half) + n*(v + lift)
        ox = p.x - tx * half + nx * lift
        oy = p.y - ty * half + ny * lift
        out.append(_Placed(g, (tx, nx, ty, ny), (ox, oy)))
    return out


# =============================================================================
# Glyph outlines: exact pieces, nesting plan
# =============================================================================
@dataclass
class _Glyph:
    pieces: list[list[Piece]]  # per contour
    polygons: list[np.ndarray]  # per contour, for nesting and overlap tests
    plan: regions.Plan
    loops: list[int]  # the contours that make the outline


@functools.lru_cache(maxsize=4096)
def _glyph(f: Font, gid: int) -> _Glyph | None:
    contours = [c for c in f.outline(gid) if len(c) >= 1]
    pieces, polygons, areas = [], [], []
    for c in contours:
        area = sum(_segment_area(s) for s in c)
        poly = _polygon(c)
        if len(poly) < 3 or abs(area) <= 1e-12 * max(1.0, float(np.ptp(poly, axis=0).max()) ** 2):
            continue  # a contour without area draws nothing
        pieces.append(_pieces(c))
        polygons.append(poly)
        areas.append(area)
    if not pieces:
        return None
    p = regions.plan(polygons, "nonzero", areas)
    loops = p.keep if p.kind == "faces" else [i for o, hs in p.components for i in (o, *hs)]
    return _Glyph(pieces, polygons, p, loops)


def _has_ink(f: Font, gid: int) -> bool:
    return _glyph(f, gid) is not None


def _segment_area(seg: Segment) -> float:
    """Exact signed area contribution of a segment: 1/2 of the integral of x dy - y dx."""
    def c(a: Point, b: Point) -> float:
        return a[0] * b[1] - a[1] * b[0]

    if len(seg) == 2:
        return 0.5 * c(seg[0], seg[1])
    if len(seg) == 3:
        p0, p1, p2 = seg
        return (2 * c(p0, p1) + 2 * c(p1, p2) + c(p0, p2)) / 6.0
    p0, p1, p2, p3 = seg
    return (6 * c(p0, p1) + 3 * c(p0, p2) + c(p0, p3) + 3 * c(p1, p2) + 3 * c(p1, p3) + 6 * c(p2, p3)) / 20.0


def _polygon(contour: Contour) -> np.ndarray:
    pts: list[Point] = []
    for seg in contour:
        m = _SAMPLES[len(seg)]
        if len(seg) == 2:
            pts.append(seg[0])
            continue
        P = np.array(seg, dtype=float)
        deg = len(seg) - 1
        for i in range(m):
            t = i / m
            pts.append(tuple(_bezier(P, deg, t)))  # type: ignore[arg-type]
    return np.array(pts, dtype=float)


def _bezier(P: np.ndarray, deg: int, t: float) -> np.ndarray:
    s = 1.0 - t
    if deg == 2:
        return s * s * P[0] + 2 * s * t * P[1] + t * t * P[2]
    return s ** 3 * P[0] + 3 * s * s * t * P[1] + 3 * s * t * t * P[2] + t ** 3 * P[3]


def _cross(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _dist(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _on_segment(p: Point, a: Point, b: Point) -> bool:
    """``p`` on the segment from ``a`` to ``b`` (within rounding)."""
    ab = _dist(a, b)
    if ab == 0:
        return p == a
    if abs(_cross(a, b, p)) > 1e-12 * ab * ab:
        return False
    t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (ab * ab)
    return -1e-12 <= t <= 1 + 1e-12


def _straightened(seg: Segment) -> Segment:
    """A curve whose control points lie on its chord is a straight line."""
    if len(seg) > 2 and all(_on_segment(q, seg[0], seg[-1]) for q in seg[1:-1]) and seg[0] != seg[-1]:
        return (seg[0], seg[-1])
    return seg


def _joint_ratio(a: Segment, b: Segment) -> float | None:
    """Where the joint of two curves of one degree divides the line between the control points
    next to it, if the outline runs on smoothly there (None at a corner)."""
    if len(a) != len(b) or len(a) < 3:
        return None
    left, joint, right = a[-2], a[-1], b[1]
    u, v = _dist(left, joint), _dist(joint, right)
    if u == 0 or v == 0:
        return None
    if abs(_cross(left, joint, right)) > 1e-12 * u * v:
        return None
    if (joint[0] - left[0]) * (right[0] - joint[0]) + (joint[1] - left[1]) * (right[1] - joint[1]) <= 0:
        return None
    t = u / (u + v)
    return t if 1e-3 <= t <= 1 - 1e-3 else None


def _pieces(contour: Contour) -> list[Piece]:
    """Lines and B-splines of a closed contour: smooth runs of Béziers become one B-spline that
    passes through every on-curve point, collinear lines one line."""
    segs = [_straightened(s) for s in contour]
    n = len(segs)
    ratios = [_joint_ratio(segs[i], segs[(i + 1) % n]) for i in range(n)]
    if any(r is None for r in ratios):  # start after a corner, so no smooth run is cut in two
        first = next(i for i, r in enumerate(ratios) if r is None) + 1
        segs, ratios = segs[first:] + segs[:first], ratios[first:] + ratios[:first]
    out: list[Piece] = []
    run: list[Segment] = []
    run_ratios: list[float] = []
    for i, seg in enumerate(segs):
        if len(seg) == 2:
            if out and out[-1][0] == "line" and out[-1][2] == seg[0] and _continues(out[-1][1], out[-1][2], seg[1]):
                out[-1] = ("line", out[-1][1], seg[1])
            else:
                out.append(("line", seg[0], seg[1]))
            continue
        run.append(seg)
        r = ratios[i]
        if r is not None and i < n - 1 and len(segs[i + 1]) == len(seg):
            run_ratios.append(r)
            continue
        out.append(_spline(run, run_ratios))
        run, run_ratios = [], []
    if len(out) > 1 and out[0][0] == "line" and out[-1][0] == "line" and _continues(out[-1][1], out[-1][2], out[0][2]):
        out[0] = ("line", out[-1][1], out[0][2])
        out.pop()
    return out


def _continues(a: Point, b: Point, c: Point) -> bool:
    """The line a -> b goes on straight to c."""
    ab, bc = _dist(a, b), _dist(b, c)
    if ab == 0 or bc == 0:
        return False
    if abs(_cross(a, b, c)) > 1e-12 * ab * bc:
        return False
    return (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0


def _spline(run: list[Segment], ratios: list[float]) -> Piece:
    """One B-spline through a smooth run of Béziers of one degree (exactly the same curve)."""
    deg = len(run[0]) - 1
    poles: list[Point] = list(run[0][:-1])
    for seg in run[1:]:
        poles.extend(seg[1:-1])
    poles.append(run[-1][-1])
    spans = [1.0]
    for t in ratios:
        spans.append(spans[-1] * (1.0 - t) / t)
    total = sum(spans)
    knots = [0.0] * (deg + 1)
    acc = 0.0
    for d in spans[:-1]:
        acc += d
        knots.extend([acc / total] * (deg - 1))
    knots.extend([1.0] * (deg + 1))
    return ("spline", deg, tuple(poles), tuple(knots))


# =============================================================================
# Building the sketch
# =============================================================================
def _apply(m: tuple[float, float, float, float], o: tuple[float, float], s: float, p: Point) -> tuple[float, float, float]:
    x, y = p[0] * s, p[1] * s
    return (m[0] * x + m[1] * y + o[0], m[2] * x + m[3] * y + o[1], 0.0)


def _curves(pieces: list[Piece], m: tuple[float, float, float, float], o: tuple[float, float], s: float) -> list[Any]:
    out = []
    for piece in pieces:
        if piece[0] == "line":
            out.append(k.create_line_segment(_apply(m, o, s, piece[1]), _apply(m, o, s, piece[2])))
        else:
            _, deg, poles, knots = piece
            P = np.array([_apply(m, o, s, q) for q in poles])
            out.append(_canonical_curve(P, list(knots), deg, None))
    return out


def _sketch(f: Font, placed: list[_Placed], scale: float) -> Sketch:
    """The glyphs as one sketch: each glyph from its own loops, glyphs that overlap united."""
    items = []
    for p in placed:
        g = _glyph(f, p.glyph)
        if g is None:
            continue
        polys = [_moved(g.polygons[i], p, scale) for i in g.loops]
        lo = np.min([q.min(axis=0) for q in polys], axis=0)
        hi = np.max([q.max(axis=0) for q in polys], axis=0)
        items.append((p, g, polys, lo, hi))
    group = list(range(len(items)))  # union-find over glyphs that overlap

    def root(i: int) -> int:
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    for i, j in regions.overlapping_boxes([it[3] for it in items], [it[4] for it in items]):
        if _overlap(items[i][2], items[j][2]):
            group[root(j)] = root(i)
    hint = "the font's outlines for this glyph could not be built"
    pieces: dict[int, Sketch] = {}
    for i, (p, g, _, _, _) in enumerate(items):
        sk = regions.build(g.plan, lambda c, p=p, g=g: _curves(g.pieces[c], p.matrix, p.offset, scale),
                           Plane.XY, "Text", hint)
        r = root(i)
        pieces[r] = sk if r not in pieces else pieces[r] + sk
    return regions.union_disjoint(list(pieces.values()), Plane.XY, "Text")


def _moved(poly: np.ndarray, p: _Placed, scale: float) -> np.ndarray:
    a, b, c, d = p.matrix
    x, y = poly[:, 0] * scale, poly[:, 1] * scale
    return np.column_stack([a * x + b * y + p.offset[0], c * x + d * y + p.offset[1]])


def _overlap(a: list[np.ndarray], b: list[np.ndarray]) -> bool:
    """Whether the regions of two glyphs (their outline polygons) overlap."""
    for pa in a:
        for pb in b:
            if regions.polygons_cross(pa, pb):
                return True

    def inside(point: np.ndarray, polys: list[np.ndarray]) -> bool:
        hits = sum(bool(regions.point_in_polygon(point[None, :], q)[0]) for q in polys)
        return hits % 2 == 1

    return inside(b[0][0], a) or inside(a[0][0], b)
