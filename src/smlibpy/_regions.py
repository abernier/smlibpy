"""Sketch-level 2D operations on exact lines and arcs.

A sketch's faces are read as loops of :mod:`._planar` segments in the local coordinates of
the sketch plane (outer loops counterclockwise, holes clockwise), changed there, and built
again from exact kernel lines and circles. Splines and ellipses travel along as
:class:`~._planar.Curve2` and are handed back unchanged.

Also here: the operands of the 2D Booleans, rebuilt from their curves (the kernel's planar
Boolean is unreliable on bodies that were moved, see ``ai/plan/2d.md``).
"""

from __future__ import annotations

import cmath
import math
from typing import Any, Iterable, Sequence

from ._kernel import KernelError, ModelingError, ext, k, kernel_call
from ._planar import (SMOOTH, TAU, Arc2, Corner, Curve2, GeometryError, Line2, NeedBooleans, Piece, Seg, _Site, assemble,
                      band_piece, convex_hull, corner_piece, cross, describe, disk, distance, dot, extent, first_crossing,
                      fmt, hull_sites, is_smooth, offset_chain, orient_ccw, overlap, reflect, segment_intersections, signed_area,
                      simplify, sweep_piece, turn, unit)
from .geometry import Axis, Location, Plane, Vector, _vec
from .shapes import Edge, Face, Part, Shape, ShapeList, Sketch, Vertex, Wire, _as_plane, _bodies

Loops = list[tuple[list[Seg], list[list[Seg]]]]  # per face: outer loop, holes


# -----------------------------------------------------------------------------
# the frame of a sketch plane
# -----------------------------------------------------------------------------
class Frame:
    """A plane with the conversions between world points and local complex numbers."""

    __slots__ = ("plane",)

    def __init__(self, plane: Plane):
        self.plane = plane

    def local(self, v: Any) -> complex:
        p = self.plane.to_local(v)
        return complex(p.x, p.y)

    def height(self, v: Any) -> float:
        return self.plane.to_local(v).z

    def world(self, z: complex) -> Vector:
        return self.plane.from_local((z.real, z.imag, 0.0))

    def direction(self, v: Vector) -> complex:
        return complex(v.dot(self.plane.x_dir), v.dot(self.plane.y_dir))

    def fp(self, z: complex) -> str:
        """A local point as world coordinates, for messages."""
        w = self.world(z)
        if abs(w.z) < 1e-9:
            return f"({fmt(w.x)}, {fmt(w.y)})"
        return f"({fmt(w.x)}, {fmt(w.y)}, {fmt(w.z)})"


# -----------------------------------------------------------------------------
# edges <-> segments
# -----------------------------------------------------------------------------
def _arc_from(c: complex, r: float, p0: complex, p1: complex, t0: complex, closed: bool) -> Arc2:
    sign = 1.0 if cross(p0 - c, t0) > 0 else -1.0
    a0 = cmath.phase(p0 - c)
    if closed:
        return Arc2(c, r, a0, sign * TAU)
    delta = (sign * (cmath.phase(p1 - c) - a0)) % TAU
    if delta < 1e-12:
        delta = TAU
    return Arc2(c, r, a0, sign * delta)


def _circumcenter(a: complex, b: complex, c: complex) -> complex | None:
    d = 2.0 * cross(b - a, c - a)
    if abs(d) < 1e-14 * max(1.0, abs(b - a) * abs(c - a)):
        return None
    ab, ac = abs(b - a) ** 2, abs(c - a) ** 2
    return a + complex((c - a).imag * ab - (b - a).imag * ac, (b - a).real * ac - (c - a).real * ab) / d


def seg_of_edge(e: Edge, fr: Frame) -> Seg:
    """The edge as an exact line or arc in the frame, or as a :class:`Curve2`. Straight and
    circular B-spline edges (left by a mirror or an offset) become lines and arcs."""
    p0, p1 = fr.local(e.start), fr.local(e.end)
    kind = e.geom_type
    if kind == "line":
        return Line2(p0, p1)
    if kind == "circle":
        d = e._circle()
        c = fr.local(Vector(d["placement"]["origin"]))
        return _arc_from(c, float(d["radius"]), p0, p1, fr.direction(e.tangent_at(0.0)), e.is_closed)
    if kind == "bspline":
        if e._is_straight():
            return Line2(p0, p1)
        samples = [fr.local(e.point_at(i / 8)) for i in range(9)]
        closed = abs(p1 - p0) <= 1e-9 * max(1.0, abs(p0))
        c = _circumcenter(samples[0], samples[3], samples[6]) if closed else _circumcenter(samples[0], samples[4], samples[8])
        if c is not None:
            r = abs(samples[0] - c)
            if all(abs(abs(s - c) - r) <= 1e-9 * max(1.0, r) for s in samples):
                return _arc_from(c, r, p0, p1, fr.direction(e.tangent_at(0.0)), closed)
    pts = tuple(fr.local(e.point_at(i / 32)) for i in range(33))
    return Curve2(e, p0, p1, unit(fr.direction(e.tangent_at(0.0))), unit(fr.direction(e.tangent_at(1.0))), e.length, pts)


def curve_of(s: Seg, fr: Frame) -> Any:
    """A new kernel curve for a segment (the caller owns it)."""
    if isinstance(s, Line2):
        with kernel_call("sketch"):
            return k.create_line_segment(fr.world(s.a).to_tuple(), fr.world(s.b).to_tuple())
    if isinstance(s, Arc2):
        from .curves import _arc_curve

        return _arc_curve(Vector(s.c.real, s.c.imag, 0.0), s.r, math.degrees(s.a0), math.degrees(s.sweep), fr.plane)
    assert isinstance(s, Curve2)
    return s.edge._copy_curve()


def edges_of(segs: Sequence[Seg], fr: Frame) -> list[Edge]:
    return [Edge._from_curve(curve_of(s, fr)) for s in segs]


def _oriented(loop: list[Seg], sign: float) -> list[Seg]:
    if signed_area(loop) * sign < 0:
        return [s.reversed() for s in reversed(loop)]
    return loop


def sketch_loops(sk: Sketch) -> tuple[Frame, Loops]:
    """The faces of a sketch as loops of segments in its plane (outer counterclockwise,
    holes clockwise). Cached on the sketch, which never changes."""
    cached = getattr(sk, "_loops", None)
    if cached is not None:
        return cached
    fr = Frame(sk.plane)
    faces: Loops = []
    size = max(1.0, sk.bbox().diagonal) if sk.faces() else 1.0
    for f in sk.faces():
        loops = [[seg_of_edge(e, fr) for e in w.edges()] for w in f.wires()]
        loops = [lp for lp in loops if lp]
        if not loops:
            continue
        for lp in loops:
            for s in lp:
                for p in (s.start, s.end):
                    if abs(fr.height(fr.world(p))) > 1e-6 * size:  # pragma: no cover - guarded below
                        raise GeometryError("the sketch does not lie in its plane")
        faces.append((_oriented(loops[0], 1.0), [_oriented(h, -1.0) for h in loops[1:]]))
    for f in sk.faces():
        for v in f.vertices():
            if abs(fr.height(v.point)) > 1e-6 * size:
                raise ModelingError("the sketch's faces do not lie in its plane (a Polygon of 3D points?); draw it "
                                    "with 2D points and place it with .on(plane)")
        break
    try:
        sk._loops = (fr, faces)
    except AttributeError:  # pragma: no cover
        pass
    return fr, faces


def build(faces: Loops, fr: Frame, like: Sketch | None = None, name: str = "sketch") -> Sketch:
    """A sketch from loops of segments (outer counterclockwise, holes clockwise)."""
    breps: list[Any] = []
    try:
        for outer, holes in faces:
            curves: list[Any] = []
            try:
                for s in [*outer, *(s for h in holes for s in h)]:
                    curves.append(curve_of(s, fr))
                with kernel_call(name, "the outline must not cross itself"):
                    breps.append(k.create_planar_faces(curves))
            except BaseException:
                for c in curves:
                    ext.delete_curve(c)
                raise
        if not breps:
            empty = like if like is not None else None
            if empty is not None:
                with kernel_call(name):
                    return empty._like(ext.copy_faces(empty._brep, []))
            raise ModelingError(f"{name}: the result is empty")
        if len(breps) == 1:
            brep = breps.pop()
        else:
            with kernel_call(name):
                brep = ext.combine(breps)
    finally:
        for b in breps:
            ext.delete_brep(b)
    if like is not None:
        return Sketch._wrap(brep, fr.plane, name=like.name, color=like.color)
    return Sketch._wrap(brep, fr.plane)


def region(loop: list[Seg], fr: Frame) -> Sketch:
    return build([(orient_ccw(loop), [])], fr)


def has_curves(faces: Loops) -> bool:
    return any(isinstance(s, Curve2) for outer, holes in faces for lp in [outer, *holes] for s in lp)


def tol_of(faces: Loops) -> float:
    segs = [s for outer, holes in faces for lp in [outer, *holes] for s in lp]
    return 1e-9 * extent(segs) if segs else 1e-9


# -----------------------------------------------------------------------------
# corners: convexity, fillets, chamfers
# -----------------------------------------------------------------------------
def _corner_points(items: Any, fr: Frame, what: str) -> list[complex]:
    out: list[complex] = []
    if isinstance(items, (Vertex, Vector)) or (isinstance(items, (tuple, list)) and items
                                              and isinstance(items[0], (int, float))):
        items = [items]
    for it in items:
        if isinstance(it, Vertex):
            p = it.point
        elif isinstance(it, (Edge, Face, Wire)) or isinstance(it, Shape):
            raise TypeError(f"{what}: the corners are given as vertices or points, not as a {type(it).__name__} "
                            f"(use sketch.vertices() and its selectors)")
        else:
            p = _vec(it)
        out.append(fr.local(p))
    return out


def corner_kind(sk: Sketch, point: Vector) -> str:
    """``"convex"``, ``"concave"`` or ``"smooth"`` for the corner of a sketch at ``point``."""
    fr, faces = sketch_loops(sk)
    v = fr.local(point)
    tol = max(1e-6, tol_of(faces) * 1e3)
    for outer, holes in faces:
        for lp in [outer, *holes]:
            for i, s in enumerate(lp):
                if abs(s.start - v) <= tol:
                    if len(lp) == 1:
                        return "smooth"
                    sn, cs = turn(lp[i - 1], s)
                    if abs(sn) < 1e-9:
                        return "smooth" if cs > 0 else "convex"
                    return "convex" if sn > 0 else "concave"
    raise ValueError(f"{fr.fp(v)} is not a corner of this sketch")


def round_corners(sk: Sketch, size: float, vertices: Any, kind: str) -> Sketch:
    """Fillet (``kind="fillet"``, ``size`` = radius) or chamfer (``size`` = length) corners
    of a sketch: all sharp ones, or those at ``vertices``."""
    what = kind
    unit_name = "radius" if kind == "fillet" else "length"
    fr, faces = sketch_loops(sk)
    if not faces:
        raise ModelingError(f"{what}: the sketch is empty")
    tol = tol_of(faces)
    vtol = max(1e-6, tol * 1e3)
    targets = None if vertices is None else _corner_points(vertices, fr, what)
    if targets is not None and not targets:
        raise ValueError(f"{what}: no corners given (the selection is empty)")
    used = [False] * (len(targets) if targets else 0)
    count = 0
    new_faces: Loops = []
    for outer, holes in faces:
        loops: list[list[Seg]] = []
        for lp in [outer, *holes]:
            corners: dict[int, Corner] = {}
            n = len(lp)
            for i in range(n):
                s1, s2 = lp[i - 1], lp[i]
                v = s2.start
                if targets is not None:
                    hits = [j for j, t in enumerate(targets) if abs(t - v) <= vtol]
                    if not hits:
                        continue
                    for j in hits:
                        used[j] = True
                if n == 1 or is_smooth(s1, s2):
                    if targets is not None:
                        raise ModelingError(f"{what}: the corner at {fr.fp(v)} is smooth (its edges meet tangentially), "
                                            f"so there is nothing to {'round' if kind == 'fillet' else 'bevel'}; leave it "
                                            f"out (select corners with .vertices().convex() or .concave())")
                    continue
                for s in (s1, s2):
                    if isinstance(s, Curve2):
                        if targets is None:
                            raise ModelingError(f"{what}: the corner at {fr.fp(v)} joins {describe(s, fr.fp)}; {what} "
                                                f"works on corners between lines and arcs. Pass the corners to change: "
                                                f"sketch.{what}({fmt(size)}, sketch.vertices().filter(...))")
                        raise ModelingError(f"{what}: the corner at {fr.fp(v)} joins {describe(s, fr.fp)}; {what} works "
                                            f"on corners between lines and arcs")
                corners[i] = Corner(kind, size, f"{unit_name} {fmt(size)}")
                count += 1
            try:
                new, labels = assemble(lp, [""] * n, corners, True, tol, what=lambda j, lp=lp: describe(lp[j], fr.fp),
                                       fp=fr.fp)
            except GeometryError as e:
                raise ModelingError(f"{what}: {e}") from None
            new, _ = simplify(new, labels, True, tol)
            loops.append(new)
        new_faces.append((loops[0], loops[1:]))
    if targets is not None and not all(used):
        missing = [fr.fp(t) for t, u in zip(targets, used) if not u]
        corners_at = sorted({fr.fp(s.start) for outer, holes in faces for lp in [outer, *holes] for s in lp})
        more = ", ..." if len(corners_at) > 12 else ""
        raise ModelingError(f"{what}: {', '.join(missing)} {'is' if len(missing) == 1 else 'are'} not a corner of the "
                            f"sketch; its corners are at {', '.join(corners_at[:12])}{more}")
    if count == 0:
        raise ModelingError(f"{what}: the sketch has no sharp corners to {'round' if kind == 'fillet' else 'bevel'}")
    return build(new_faces, fr, like=sk, name=what)


# -----------------------------------------------------------------------------
# offset
# -----------------------------------------------------------------------------
CORNER_STYLES = ("round", "sharp", "chamfer")


def _loops_cross(faces: Loops, tol: float) -> bool:
    loops = [lp for outer, holes in faces for lp in [outer, *holes]]
    for lp in loops:
        if first_crossing(lp, True, tol) is not None:
            return True
    for i in range(len(loops)):
        for j in range(i + 1, len(loops)):
            for a in loops[i]:
                for b in loops[j]:
                    if segment_intersections(a, b, tol) or overlap(a, b, tol) > tol:
                        return True
    return False


def union_all(sketches: list[Sketch]) -> Sketch:
    items = list(sketches)
    while len(items) > 1:
        items = [items[i] + items[i + 1] if i + 1 < len(items) else items[i] for i in range(0, len(items), 2)]
    return items[0]


def offset_region(sk: Sketch, distance: float, corners: str) -> Sketch | None:
    """The sketch grown (``distance`` > 0) or shrunk, with exact lines and arcs; None when
    the sketch has curves that are neither (the caller offsets those with the kernel).

    The offset is built directly from the moved segments where every loop stays a simple
    loop of its own; otherwise (a part grows into another, a neck closes, an arc collapses)
    from Booleans of the strips the boundary sweeps. Either result is checked: every edge
    must lie at the offset distance from the original boundary, on the right side.
    """
    fr, faces = sketch_loops(sk)
    if not faces:
        raise ModelingError("offset: the sketch is empty")
    if has_curves(faces):
        return None
    tol = tol_of(faces)
    d = float(distance)
    try:
        new_faces: Loops = []
        for outer, holes in faces:
            o = offset_chain(outer, -d, corners, True, tol)
            hs = [offset_chain(h, -d, corners, True, tol) for h in holes]
            if signed_area(o) <= 0 or any(signed_area(h) >= 0 for h in hs):
                raise NeedBooleans("a loop turns inside out")
            if signed_area(o) + sum(signed_area(h) for h in hs) <= tol * extent(o):
                raise NeedBooleans("a face vanishes")
            new_faces.append((o, hs))
        if _loops_cross(new_faces, tol):
            raise NeedBooleans("loops cross")
        result = build(new_faces, fr, like=sk, name="offset")
        if _offset_valid(result, sk, faces, d, corners):
            return result
    except NeedBooleans:
        pass
    pieces: list[Piece] = []
    for outer, holes in faces:
        for lp in [outer, *holes]:
            for i, s in enumerate(lp):
                pieces += corner_piece(lp[i - 1], s, -d, corners)
                pieces += sweep_piece(s, -d)
    tool = union_all([build([pc], fr, name="offset") for pc in pieces])
    result = sk + tool if d > 0 else sk - tool
    result = Sketch._wrap(result._copy_brep(), sk.plane, name=sk.name, color=sk.color)
    if not result.faces():
        raise ModelingError(f"offset: shrinking by {fmt(-d)} removes the whole region; use a smaller distance")
    if not _offset_valid(result, sk, faces, d, corners):
        raise ModelingError(f"offset: the kernel could not build a reliable offset by {fmt(d)} of this sketch (an edge "
                            f"of the result is not at that distance from the outline); try a slightly different "
                            f"distance or corners='round'")
    return result


def _offset_valid(result: Sketch, original: Sketch, faces: Loops, d: float, corners: str) -> bool:
    """Every edge of an offset lies at the distance from the original boundary that its
    corner style allows, on the side the offset moves to."""
    rfr, rfaces = sketch_loops(result)
    segs = [s for outer, holes in faces for lp in [outer, *holes] for s in lp]
    a = abs(d)
    size = extent(segs) + a
    tol = 1e-6 * max(1.0, size)
    low = a - tol
    if corners == "chamfer":
        widest = 0.0
        for outer, holes in faces:
            for lp in [outer, *holes]:
                for i, s in enumerate(lp):
                    sn, cs = turn(lp[i - 1], s)
                    if sn * -d < 0 and abs(sn) >= SMOOTH:
                        widest = max(widest, abs(cmath.phase(complex(cs, sn))))
        low = a * math.cos(widest / 2) - tol
    if not rfaces:
        return False
    for outer, holes in rfaces:
        for lp in [outer, *holes]:
            for rs in lp:
                for f in (0.25, 0.5, 0.75):
                    q = rs.at(rs.length * f)
                    dist = min(distance(s, q) for s in segs)
                    if dist < low or (corners != "sharp" and dist > a + tol):
                        return False
                    inside = original.distance_to(rfr.world(q)) <= tol
                    if inside != (d < 0):
                        return False
    return True


# -----------------------------------------------------------------------------
# mirror
# -----------------------------------------------------------------------------
def _mirror_plane(sk: Sketch, about: Any) -> Plane:
    if isinstance(about, Axis):
        n = sk.plane.z_dir
        d = about.direction
        if not d.is_perpendicular(n, 1e-6):
            raise ValueError("mirror: the axis must lie in the sketch plane (its direction is not parallel to the plane); "
                             "pass a Plane to mirror in 3D")
        if abs(sk.plane.distance_to(about.origin)) > 1e-6 * max(1.0, sk.bbox().diagonal):
            raise ValueError(f"mirror: the axis does not lie in the sketch plane (its origin is "
                             f"{fmt(sk.plane.distance_to(about.origin))} away from it)")
        return Plane(about.origin, d, d.cross(n).normalized())
    return _as_plane(about)


def mirror_sketch(sk: Sketch, about: Any) -> Sketch:
    """The sketch mirrored in a plane, or about an axis in its own plane. Lines stay lines
    and arcs stay arcs; the normal is mirrored too, so an axis in the sketch plane leaves the
    sketch facing the same way (and ``mirror`` commutes with ``extrude``)."""
    mp = _mirror_plane(sk, about)
    fr, faces = sketch_loops(sk)
    n = mp.z_dir
    o = mp.origin

    def refl_point(v: Vector) -> Vector:
        return v - n * (2.0 * (v - o).dot(n))

    def refl_dir(v: Vector) -> Vector:
        return v - n * (2.0 * v.dot(n))

    p = sk.plane
    new_plane = Plane(refl_point(p.origin), refl_dir(p.x_dir), refl_dir(p.z_dir))
    nf = Frame(new_plane)
    m = Location(_reflection_matrix(mp))

    def flip(s: Seg) -> Seg:
        if isinstance(s, Curve2):
            e = s.edge.moved(m)
            return Curve2(e, s.start_.conjugate(), s.end_.conjugate(), s.t0_.conjugate(), s.t1_.conjugate(), s.length_,
                          tuple(q.conjugate() for q in s.points))
        return s.reflected(0j, 1 + 0j)

    def loop(lp: list[Seg]) -> list[Seg]:
        return [flip(s).reversed() for s in reversed(lp)]

    new_faces = [(loop(outer), [loop(h) for h in holes]) for outer, holes in faces]
    if not new_faces:
        return Sketch._wrap(sk._copy_brep(), new_plane, name=sk.name, color=sk.color)
    out = build(new_faces, nf, name="mirror")
    out.name, out.color = sk.name, sk.color
    return out


def _reflection_matrix(plane: Plane) -> Any:
    import numpy as np

    nn = np.array(plane.z_dir.to_tuple())
    oo = np.array(plane.origin.to_tuple())
    mm = np.eye(4)
    mm[:3, :3] -= 2.0 * np.outer(nn, nn)
    mm[:3, 3] = 2.0 * nn * oo.dot(nn)
    return mm


# -----------------------------------------------------------------------------
# paths: stroke
# -----------------------------------------------------------------------------
def path_frame(edges: Sequence[Edge]) -> Frame:
    """The plane of a planar path: world XY at its height when it is level, else the plane
    the path lies in."""
    pts = [p for e in edges for p in (e.start, e.end, e.point_at(0.5))]
    zs = [p.z for p in pts]
    size = max(1.0, max(abs(c) for p in pts for c in p))
    if max(zs) - min(zs) <= 1e-9 * size:
        return Frame(Plane((0, 0, zs[0])))
    from .shapes import _fit_plane

    pl = _fit_plane(pts, closed=False)
    if any(abs(pl.distance_to(p)) > 1e-7 * size for p in pts):
        raise ValueError("Stroke: the path does not lie in a plane")
    return Frame(pl)


def path_segments(path: Any, what: str) -> tuple[Frame, list[Seg]]:
    if isinstance(path, Edge):
        edges = [path]
    elif isinstance(path, Wire):
        edges = list(path.edges())
    elif isinstance(path, ShapeList) and all(isinstance(e, Edge) for e in path):
        edges = list(Wire(list(path)).edges())
    else:
        hint = " (call .wire() on a Profile)" if type(path).__name__ == "Profile" else ""
        raise TypeError(f"{what}: the path is an Edge or a Wire, not a {type(path).__name__}{hint}")
    fr = path_frame(edges)
    segs = [seg_of_edge(e, fr) for e in edges]
    for i, s in enumerate(segs):
        if isinstance(s, Curve2):
            raise ModelingError(f"{what}: edge {i + 1} of the path is a {s.edge.geom_type}; {what} works on paths "
                                f"of lines and arcs")
    size = extent(segs)
    for i in range(1, len(segs)):
        gap = abs(segs[i].start - segs[i - 1].end)
        if gap > 1e-6 * size:
            raise ModelingError(f"{what}: the path has a gap of {fmt(gap)} between edge {i} and edge {i + 1}")
    return fr, segs


def stroke(path: Any, width: float, ends: str, corners: str) -> Sketch:
    if not width > 0:
        raise ValueError(f"Stroke: the width must be positive (got {width})")
    if ends not in ("round", "flat"):
        raise ValueError(f"Stroke: ends is 'round' or 'flat', not {ends!r}")
    if corners not in CORNER_STYLES:
        raise ValueError(f"Stroke: corners is 'round', 'sharp' or 'chamfer', not {corners!r}")
    fr, segs = path_segments(path, "Stroke")
    h = width / 2.0
    tol = 1e-9 * extent(segs)
    closed = abs(segs[-1].end - segs[0].start) <= 1e-6 * extent(segs)
    if closed:
        loop = orient_ccw(list(segs))
        inner_area = signed_area(loop)
        if inner_area <= tol:
            raise ModelingError("Stroke: the closed path encloses no area")
        base = region(loop, fr)
        outer = base.offset(h, corners=corners)
        try:
            inner = base.offset(-h, corners=corners)
        except ModelingError:
            return outer
        return outer - inner
    try:
        right = offset_chain(segs, -h, corners, False, tol)
        left = offset_chain(segs, h, corners, False, tol)
        p0, p1 = segs[0].start, segs[-1].end
        t0, t1 = segs[0].t0, segs[-1].t1
        if ends == "round":
            cap_end: Seg = Arc2(p1, h, cmath.phase(-1j * t1), math.pi)
            cap_start: Seg = Arc2(p0, h, cmath.phase(1j * t0), math.pi)
        else:
            cap_end = Line2(right[-1].end, left[-1].end)
            cap_start = Line2(left[0].start, right[0].start)
        loop = [*right, cap_end, *[s.reversed() for s in reversed(left)], cap_start]
        if first_crossing(loop, True, tol) is not None or signed_area(loop) <= 0:
            raise NeedBooleans("the band crosses itself")
        loop, _ = simplify(loop, [""] * len(loop), True, tol)
        return build([(loop, [])], fr, name="Stroke")
    except NeedBooleans:
        pass
    pieces: list[Piece] = []
    for i, s in enumerate(segs):
        if i:
            for e in (h, -h):
                pieces += corner_piece(segs[i - 1], s, e, corners)
        pieces += band_piece(s, h)
    if ends == "round":
        pieces += [(disk(segs[0].start, h), []), (disk(segs[-1].end, h), [])]
    return union_all([build([pc], fr, name="Stroke") for pc in pieces])


# -----------------------------------------------------------------------------
# hull
# -----------------------------------------------------------------------------
def _flatten(items: Iterable[Any]) -> list[Any]:
    out: list[Any] = []
    for it in items:
        if isinstance(it, (ShapeList, list)) and not (it and isinstance(it[0], (int, float))):
            out.extend(_flatten(it))
        else:
            out.append(it)
    return out


def hull(items: Sequence[Any]) -> Sketch:
    flat = _flatten(items)
    if not flat:
        raise ValueError("Hull: nothing given; pass points, edges, wires or sketches")
    planes = [it.plane for it in flat if isinstance(it, Sketch)]
    fr = Frame(planes[0] if planes else Plane.XY)
    sites: list[_Site] = []
    size = 1.0
    for it in flat:
        if isinstance(it, Part):
            raise TypeError("Hull: a Part has no outline in a plane; use part.section(plane) or a face")
        if isinstance(it, Sketch):
            if not it.plane.is_coplanar(fr.plane, 1e-6 * max(1.0, it.bbox().diagonal)):
                raise ValueError("Hull: the sketches lie in different planes")
            f2, faces = sketch_loops(it)
            for outer, _ in faces:
                segs = [_to_frame(s, f2, fr) for s in outer]
                sites += hull_sites(segs)
        elif isinstance(it, Face):
            sites += hull_sites([seg_of_edge(e, fr) for e in it.outer_wire().edges()])
        elif isinstance(it, Wire):
            sites += hull_sites([seg_of_edge(e, fr) for e in it.edges()])
        elif isinstance(it, Edge):
            sites += hull_sites([seg_of_edge(it, fr)])
        else:
            p = it.point if isinstance(it, Vertex) else _vec(it)
            if abs(fr.height(p)) > 1e-6 * max(1.0, abs(p.x), abs(p.y), abs(p.z)):
                raise ValueError(f"Hull: the point ({fmt(p.x)}, {fmt(p.y)}, {fmt(p.z)}) is not in the plane of the hull")
            sites.append(_Site(fr.local(p), 0.0))
    size = max([1.0] + [abs(s.c) + s.r for s in sites])
    try:
        loop = convex_hull(sites, 1e-9 * size)
    except GeometryError as e:
        raise ModelingError(f"Hull: {e}") from None
    return build([(loop, [])], fr, name="Hull")


def _to_frame(s: Seg, a: Frame, b: Frame) -> Seg:
    """A segment of frame ``a`` in the coordinates of frame ``b`` (coplanar frames)."""
    if a.plane == b.plane:
        return s
    o = b.local(a.world(0j))
    rot = b.local(a.world(1 + 0j)) - o
    if isinstance(s, (Line2, Arc2)):
        return s.moved(rot / abs(rot), o)
    raise GeometryError("hull works on lines and circular arcs")


# -----------------------------------------------------------------------------
# operands of the 2D Booleans
# -----------------------------------------------------------------------------
def rebuilt_brep(sk: Sketch) -> Any | None:
    """A new body with the sketch's faces built again from copies of their curves, or None
    when a face does not rebuild (a loop that touches itself). The kernel's planar Boolean
    can fail, or return a wrong union, on bodies that were moved; rebuilt ones are reliable."""
    pieces: list[Any] = []
    try:
        for f in sk.faces():
            curves: list[Any] = []
            try:
                for w in f.wires():
                    curves.extend(w._copy_curves())
                pieces.append(k.create_planar_faces(curves))
            except RuntimeError:
                for c in curves:
                    ext.delete_curve(c)
                return None
        if not pieces:
            return None
        if len(pieces) == 1:
            return pieces.pop()
        return ext.combine(pieces)
    finally:
        for b in pieces:
            ext.delete_brep(b)
