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
from ._planar import (SMOOTH, TAU, Arc2, Corner, Curve2, GeometryError, Line2, NeedBooleans, Piece, Seg, _line_line, _Site,
                      assemble, band_piece, convex_hull, corner_piece, cross, describe, disk, distance, extent,
                      first_crossing, fmt, hull_sites, is_smooth, offset_chain, orient_ccw, overlap, polygon,
                      segment_intersections, signed_area, simplify, sweep_piece, turn, unit)
from .geometry import Axis, BoundBox, Location, Plane, Vector, _vec
from .shapes import Edge, Face, Part, Shape, ShapeList, Sketch, Vertex, Wire, _as_plane

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


class CurveCorners:
    """Fillets and chamfers at corners with curves (splines, ellipses) for ``_planar.assemble``,
    through the kernel: a fillet's center is where the offsets of the two curves toward the inside
    of the corner meet (``Edge.offset``), its ends the nearest points of the curves to it; a chamfer
    cuts back the length along each curve. (SMLib's own ``SmCurveFilletExecutive`` is unused and
    untested in the kernel and picks its side wrongly.)"""

    def __init__(self, fr: Frame, size: float):
        self.fr = fr
        self.size = max(1.0, size)

    def _edge(self, s: Seg) -> Edge:
        return s.edge if isinstance(s, Curve2) else Edge._from_curve(curve_of(s, self.fr))

    def piece(self, seg: Curve2, s0: float, s1: float) -> Seg:
        """The part of a curve segment between two lengths from its start."""
        if s0 <= 0 and s1 >= seg.length:
            return seg
        return seg_of_edge(seg.edge.trim(max(s0, 0.0) / seg.length, min(s1 / seg.length, 1.0)), self.fr)

    def _offset(self, e: Edge, d: float, at_end: bool) -> Edge | None:
        """The edge's offset toward the corner: of the whole edge, or of its part next to the corner
        where the edge bends too tightly farther away."""
        piece = e
        for i in range(8):
            try:
                return piece.offset(d, plane=self.fr.plane)
            except (ModelingError, ValueError):
                f = 0.5 ** (i + 1)
                piece = e.trim(1.0 - f, 1.0) if at_end else e.trim(0.0, f)
        return None

    def corner(self, kind: str, s1: Seg, s2: Seg, size: float) -> tuple[float, float, Seg]:
        sn, cs = turn(s1, s2)
        if abs(sn) < SMOOTH:
            raise GeometryError("the segments meet tangentially there, so there is no corner"
                                if cs > 0 else "the outline turns back on itself there")
        e1, e2 = self._edge(s1), self._edge(s2)
        l1, l2 = e1.length, e2.length
        fr = self.fr
        if kind == "chamfer":  # (a length beyond a segment: assemble reports that it does not fit)
            return size, size, Line2(fr.local(e1.point_at(max(0.0, 1.0 - size / l1))),
                                     fr.local(e2.point_at(min(1.0, size / l2))))
        side = 1.0 if sn > 0 else -1.0
        o1, o2 = self._offset(e1, side * size, True), self._offset(e2, side * size, False)
        best = None
        if o1 is not None and o2 is not None:
            for c in o1.intersections(o2):
                f1, f2 = e1.closest_point(c), e2.closest_point(c)
                if max(abs(f1.distance_to(c) - size), abs(f2.distance_to(c) - size)) > 1e-6 * self.size:
                    continue  # (a point of an end, not where the arc touches)
                back, ahead = (1.0 - e1.param_at_point(f1)) * l1, e2.param_at_point(f2) * l2
                if best is None or back + ahead < best[0] + best[1]:
                    best = (back, ahead, c, f1, f2)
        if best is None:
            raise GeometryError(f"no arc of radius {fmt(size)} touches both segments")
        _, _, c, f1, f2 = best
        # Newton on the center: its distances to the two curves become the radius (the offsets are
        # fitted within 1e-6 of the size; the curves' nearest points are exact)
        cl = fr.local(c)
        for _ in range(8):
            p1, p2 = fr.local(f1), fr.local(f2)
            d1, d2 = abs(cl - p1), abs(cl - p2)
            if max(abs(d1 - size), abs(d2 - size)) <= 1e-13 * self.size or d1 == 0 or d2 == 0:
                break
            n1, n2 = (cl - p1) / d1, (cl - p2) / d2
            det = cross(n1, n2)
            if abs(det) < 1e-12:
                break
            r1, r2 = size - d1, size - d2
            cl += complex((r1 * n2.imag - r2 * n1.imag) / det, (n1.real * r2 - n2.real * r1) / det)
            f1, f2 = e1.closest_point(fr.world(cl)), e2.closest_point(fr.world(cl))
        back, ahead = (1.0 - e1.param_at_point(f1)) * l1, e2.param_at_point(f2) * l2
        v1, v2 = fr.local(f1) - cl, fr.local(f2) - cl
        delta = cmath.phase(v2 / v1)
        if side > 0 and delta < 0:
            delta += TAU
        if side < 0 and delta > 0:
            delta -= TAU
        return back, ahead, Arc2(cl, size, cmath.phase(v1), delta)


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
    size = max(1.0, sk._loose_box().diagonal)
    for f in sk.faces():
        if any(abs(fr.height(v.point)) > 1e-6 * size for v in f.vertices()):
            raise ModelingError("the sketch's faces do not lie in its plane (a Polygon of 3D points?); draw it "
                                "with 2D points and place it with .on(plane)")
        loops = [lp for lp in ([seg_of_edge(e, fr) for e in w.edges()] for w in f.wires()) if lp]
        if loops:
            faces.append((_oriented(loops[0], 1.0), [_oriented(h, -1.0) for h in loops[1:]]))
    sk._loops = (fr, faces)
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
            if like is None:
                raise ModelingError(f"{name}: the result is empty")
            with kernel_call(name):
                return like._like(ext.copy_faces(like._brep, []))
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
            name = type(it).__name__
            raise TypeError(f"{what}: the corners are given as vertices or points, not as {'an' if name[0] in 'AEIOU' else 'a'} "
                            f"{name} (use sketch.vertices() and its selectors)")
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
                corners[i] = Corner(kind, size, f"{unit_name} {fmt(size)}")
                count += 1
            try:
                new, labels = assemble(lp, [""] * n, corners, True, tol, what=lambda j, lp=lp: describe(lp[j], fr.fp),
                                       fp=fr.fp, curves=CurveCorners(fr, tol * 1e9))
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
    except (NeedBooleans, KernelError):
        pass  # built from pieces below
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
        if abs(sk.plane.distance_to(about.origin)) > 1e-6 * max(1.0, sk._loose_box().diagonal):
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
    if any(isinstance(s, Curve2) for s in segs):
        return _stroke_curves(segs, fr, h, ends, corners)
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
    except (NeedBooleans, KernelError):
        pass  # built from pieces below
    pieces: list[Piece] = []
    for i, s in enumerate(segs):
        if i:
            for e in (h, -h):
                pieces += corner_piece(segs[i - 1], s, e, corners)
        pieces += band_piece(s, h)
    if ends == "round":
        pieces += [(disk(segs[0].start, h), []), (disk(segs[-1].end, h), [])]
    return union_all([build([pc], fr, name="Stroke") for pc in pieces])


def _stroke_curves(segs: list[Seg], fr: Frame, h: float, ends: str, corners: str) -> Sketch:
    """Stroke along an open path with splines or ellipses: the band between the path's offsets
    to both sides and the end caps; where that band runs into itself, the union of a band per
    edge, the wedges at the corners and the round ends."""
    size = real_size(segs)
    try:
        right = offset_curves(segs, fr, -h, corners, False, size, "Stroke", h, crossing=False)
        left = offset_curves(segs, fr, h, corners, False, size, "Stroke", h, crossing=False)
        p0, p1 = segs[0].start, segs[-1].end
        if ends == "round":
            cap_end = edges_of([Arc2(p1, h, cmath.phase(-1j * segs[-1].t1), math.pi)], fr)
            cap_start = edges_of([Arc2(p0, h, cmath.phase(1j * segs[0].t0), math.pi)], fr)
        else:
            cap_end = edges_of([Line2(fr.local(right[-1].end), fr.local(left[-1].end))], fr)
            cap_start = edges_of([Line2(fr.local(left[0].start), fr.local(right[0].start))], fr)
        loop = [*right, *cap_end, *[e.reversed() for e in reversed(left)], *cap_start]
        hit = chain_crossing(loop, True, size)
        if hit is None:
            return build([(orient_ccw([seg_of_edge(e, fr) for e in loop]), [])], fr, name="Stroke")
        problem = ModelingError(f"Stroke: the band runs into itself near {fr.fp(fr.local(hit))}")
    except (ModelingError, ValueError) as e:
        problem = e  # type: ignore[assignment]
    try:
        sketches: list[Sketch] = []
        for i, s in enumerate(segs):
            if i:
                for e in (h, -h):
                    sketches += [build([pc], fr, name="Stroke") for pc in _corner_wedge(segs[i - 1], s, e, corners)]
            if isinstance(s, Curve2):
                sketches += _curve_bands(s.edge, h, fr, size, i)
            else:
                sketches += [build([pc], fr, name="Stroke") for pc in band_piece(s, h)]
        if ends == "round":
            sketches += [build([(disk(segs[0].start, h), [])], fr, name="Stroke"),
                         build([(disk(segs[-1].end, h), [])], fr, name="Stroke")]
        return union_all(sketches)
    except (ModelingError, ValueError):
        raise problem from None


def _curve_bands(edge: Edge, h: float, fr: Frame, size: float, index: int, depth: int = 0) -> list[Sketch]:
    """The band within ``h`` of a curve, ends cut square: one band where it does not run into
    itself, else the bands of pieces (the curve cut where it crosses itself, then in halves)."""
    r = offset_curve_edge(edge, -h, fr, 1e-6 * size, "Stroke", index)
    lft = offset_curve_edge(edge, h, fr, 1e-6 * size, "Stroke", index)
    ends = edges_of([Line2(fr.local(r.end), fr.local(lft.end)), Line2(fr.local(lft.start), fr.local(r.start))], fr)
    loop = [r, ends[0], lft.reversed(), ends[1]]
    if chain_crossing(loop, True, size) is None:
        return [build([(orient_ccw([seg_of_edge(x, fr) for x in loop]), [])], fr, name="Stroke")]
    if depth >= 6:
        raise ModelingError(f"Stroke: the band along edge {index + 1} of the path runs into itself")
    pieces = _uncrossed(edge, 1e-9 * size) if depth == 0 else [edge]
    if len(pieces) == 1:
        pieces = list(edge.split(0.5))
    return [b for piece in pieces for b in _curve_bands(piece, h, fr, size, index, depth + 1)]


def _uncrossed(edge: Edge, tol: float) -> list[Edge]:
    """The edge cut where it crosses itself, into pieces that do not."""
    t0, t1 = edge._range()
    with kernel_call("Stroke"):
        sols = ext.self_intersections(edge._curve(), t0, t1, tol)
    cuts = sorted({edge._fraction(u) for s in sols for u in s["t"]})
    cuts = [f for f in cuts if 1e-9 < f < 1.0 - 1e-9]
    bounds = [0.0, *cuts, 1.0]
    return [edge.trim(a, b) for a, b in zip(bounds, bounds[1:]) if b - a > 1e-9] if cuts else [edge]


def _corner_wedge(s1: Seg, s2: Seg, e: float, corners: str) -> list[Piece]:
    """:func:`corner_piece` for corners at splines and ellipses: the offsets' ends are the corner
    moved ``e`` along the normals of the two tangents there."""
    if not (isinstance(s1, Curve2) or isinstance(s2, Curve2)):
        return corner_piece(s1, s2, e, corners)
    sn, cs = turn(s1, s2)
    if abs(sn) < SMOOTH and cs > 0:
        return []
    if sn * e >= 0 and abs(sn) >= SMOOTH:
        return []
    v = s1.end
    if abs(sn) < SMOOTH:
        return [(disk(v, abs(e)), [])]
    pe, qs = v + e * 1j * s1.t1, v + e * 1j * s2.t0
    if corners == "chamfer":
        return [(polygon(v, pe, qs), [])]
    if corners == "sharp":
        hits = _line_line(pe, s1.t1, qs, s2.t0)
        return [(polygon(v, pe, hits[0], qs), [])] if hits else [(disk(v, abs(e)), [])]
    d1, d2 = pe - v, qs - v
    sweep = cmath.phase(d2 / d1)
    if sn > 0 and sweep < 0:
        sweep += TAU
    if sn < 0 and sweep > 0:
        sweep -= TAU
    return [(orient_ccw([Line2(v, pe), Arc2(v, abs(e), cmath.phase(d1), sweep), Line2(qs, v)]), [])]


# -----------------------------------------------------------------------------
# offsets of wires and edges (Wire.offset, Edge.offset)
# -----------------------------------------------------------------------------
_OFFSET_REASONS = {
    "an arc collapses": "an arc collapses (the distance reaches past its center)",
    "the chain turns back": "the wire turns back on itself",
    "a segment vanishes": "an edge vanishes (the corners beside it cut it away)",
    "an arc vanishes": "an arc vanishes (the corners beside it cut it away)",
    "the offsets do not meet near the corner": "the edges at a corner no longer meet (an edge there is shorter than "
                                               "the distance)",
    "parallel tangents": "the sides of a corner run parallel and never meet",
}


def _offset_problem(what: str, distance: float, reason: str, closed: bool, where: str = "") -> str:
    region = ("; the offset of the region it bounds (Sketch.offset) merges and drops parts instead" if closed else "")
    at = f" at {where}" if where else ""
    return f"{what}: moved by {fmt(abs(distance))}, {_OFFSET_REASONS.get(reason, reason)}{at}; use a smaller distance{region}"


def wire_frame(edges: Sequence[Edge], plane: Any, what: str) -> Frame:
    """The plane of a planar wire, its normal telling left from right: ``plane`` (the wire must lie
    in a plane parallel to it), else XY at the wire's height for a level wire, else the plane the
    wire lies in with its normal toward +Z (+Y, then +X, for vertical planes)."""
    pts = [p for e in edges for p in (e.start, e.end, *(e.point_at(i / 8) for i in range(1, 8)))]
    size = max(1.0, max(abs(c) for p in pts for c in p))
    if plane is not None:
        pl = _as_plane(plane)
        hs = [pl.to_local(p).z for p in pts]
        if max(hs) - min(hs) > 1e-7 * size:
            raise ValueError(f"{what}: the wire does not lie in a plane parallel to the plane given (it reaches "
                             f"{fmt(max(hs) - min(hs))} along the plane's normal)")
        return Frame(pl.offset(hs[0]))
    zs = [p.z for p in pts]
    if max(zs) - min(zs) <= 1e-9 * size:
        return Frame(Plane((0, 0, zs[0])))
    a = pts[0]
    far = max(pts, key=lambda q: q.distance_to(a))
    u = (far - a).normalized()
    if all((q - a - u * (q - a).dot(u)).length <= 1e-9 * size for q in pts):
        raise ValueError(f"{what}: the wire is straight and not level, so it does not say which plane it moves in; "
                         f"pass plane=")
    from .shapes import _fit_plane

    pl = _fit_plane(pts, closed=False)
    if any(abs(pl.to_local(q).z) > 1e-7 * size for q in pts):
        raise ValueError(f"{what}: the wire does not lie in a plane")
    nz = pl.z_dir
    if nz.z < -1e-9 or (abs(nz.z) <= 1e-9 and (nz.y < -1e-9 or (abs(nz.y) <= 1e-9 and nz.x < 0))):
        pl = pl.flipped()
    return Frame(pl)


def real_size(segs: Sequence[Seg]) -> float:
    """The diagonal of the box around segments (in their plane)."""
    pts = [p for s in segs for p in s.sample(8)]
    xs, ys = [p.real for p in pts], [p.imag for p in pts]
    return max(math.hypot(max(xs) - min(xs), max(ys) - min(ys)), 1e-300)


def offset_wire(edges: list[Edge], distance: float, corners: str, plane: Any, what: str) -> list[Edge]:
    """The edges of a planar wire, end to end, moved ``distance`` sideways: an open wire to its
    left (seen from the normal of its plane), a closed one outward (see :meth:`Wire.offset`)."""
    fr = wire_frame(edges, plane, what)
    segs = [seg_of_edge(e, fr) for e in edges]
    size = real_size(segs)
    for i in range(1, len(segs)):
        gap = abs(segs[i].start - segs[i - 1].end)
        if gap > 1e-6 * max(1.0, size):
            raise ModelingError(f"{what}: the wire has a gap of {fmt(gap)} between edge {i} and edge {i + 1}")
    closed = abs(segs[-1].end - segs[0].start) <= 1e-6 * max(1.0, size)
    e = distance
    if closed:
        area = signed_area(segs)
        if abs(area) <= 1e-12 * size * size:
            raise ModelingError(f"{what}: the closed wire encloses no area, so it has no outside to move to")
        e = -distance if area > 0 else distance  # outward: to the right of a counterclockwise loop
    if any(isinstance(s, Curve2) for s in segs):
        return offset_curves(segs, fr, e, corners, closed, size, what, distance)
    tol = 1e-9 * max(1.0, size)
    try:
        out = offset_chain(segs, e, corners, closed, tol)
    except NeedBooleans as ex:
        raise ModelingError(_offset_problem(what, distance, str(ex), closed)) from None
    except GeometryError:  # (a side that shrinks to nothing, which leaves no direction to move it in)
        raise ModelingError(_offset_problem(what, distance, "a side of it shrinks to nothing", closed)) from None
    hit = first_crossing(out, closed, tol)
    if hit is not None and first_crossing(segs, closed, tol) is None:  # (a wire that crosses itself: its offset may)
        raise ModelingError(_crossing_problem(what, distance, fr.fp(hit[2]), closed))
    return edges_of(out, fr)


def _crossing_problem(what: str, distance: float, where: str, closed: bool) -> str:
    region = ("; the offset of the region it bounds (Sketch.offset) merges parts instead" if closed else "")
    return (f"{what}: moved by {fmt(abs(distance))}, the wire runs into itself near {where} (parts of it lie closer "
            f"together than the distance allows); use a smaller distance{region}")


def offset_curve_edge(edge: Edge, e: float, fr: Frame, tol: float, what: str, index: int | None) -> Edge:
    """An edge (a spline or an ellipse) moved ``e`` to its left in the frame's plane, by the
    kernel within ``tol``."""
    c = edge._copy_curve()
    try:
        with kernel_call(what, "the curve may have a corner inside; split it there first"):
            curve, dev, tight = ext.offset_curve(c, list(fr.plane.z_dir.to_tuple()), float(e), float(tol))
        point = Vector(c.evaluate(tight)) if curve is None else None
    finally:
        ext.delete_curve(c)
    name = f"edge {index + 1} ({edge.geom_type})" if index is not None else f"the {edge.geom_type}"
    if curve is None:
        assert point is not None
        r = edge.min_radius()
        raise ModelingError(f"{what}: {name} bends more tightly than the distance {fmt(abs(e))} near "
                            f"{fr.fp(fr.local(point))} on the side it moves to (its smallest radius of curvature is "
                            f"{fmt(r)}), so its offset would fold over itself there; use a smaller distance")
    moved = Edge._from_curve(curve)
    if not dev <= 10.0 * tol:
        raise ModelingError(f"{what}: the kernel's offset of {name} is {dev:.3g} off the distance (asked within "
                            f"{tol:.3g})")
    return moved


def offset_curves(segs: list[Seg], fr: Frame, e: float, corners: str, closed: bool, size: float, what: str,
                  distance: float, crossing: bool = True) -> list[Edge]:
    """:func:`offset_wire` for wires with splines or ellipses: lines and arcs moved exactly, the
    curves by the kernel; the corners that open filled (``corners``), those that close cut where
    the moved edges cross. With ``crossing``, checked not to run into itself (unless the wire
    itself does)."""
    approx = 1e-6 * size
    n = len(segs)
    moved: list[Edge] = []
    for i, s in enumerate(segs):
        if isinstance(s, (Line2, Arc2)):
            o = s.offset(e)
            if o is None:
                raise ModelingError(_offset_problem(what, distance, "an arc collapses", closed, fr.fp(s.at(s.length / 2))))
            moved.append(Edge._from_curve(curve_of(o, fr)))
        else:
            assert isinstance(s, Curve2)
            moved.append(offset_curve_edge(s.edge, e, fr, approx, what, i if n > 1 else None))
    lo, hi = [0.0] * n, [1.0] * n
    start_at: list[complex | None] = [None] * n
    end_at: list[complex | None] = [None] * n
    joins: dict[int, list[Edge]] = {}
    for i in range(n) if closed else range(1, n):
        s1, s2 = segs[i - 1], segs[i]
        sn, cs = turn(s1, s2)
        if abs(sn) < SMOOTH and cs > 0:
            continue
        v = s1.end
        if abs(sn) < SMOOTH:
            raise ModelingError(_offset_problem(what, distance, "the chain turns back", closed, fr.fp(v)))
        m1, m2 = moved[i - 1], moved[i]
        p, q = fr.local(m1.end), fr.local(m2.start)
        if sn * e < 0:  # the corner opens: fill it
            if corners == "round":
                d1, d2 = p - v, q - v
                sweep = cmath.phase(d2 / d1)
                if sn > 0 and sweep < 0:
                    sweep += TAU
                if sn < 0 and sweep > 0:
                    sweep -= TAU
                joins[i] = edges_of([Arc2(v, abs(e), cmath.phase(d1), sweep)], fr)
            elif corners == "chamfer":
                joins[i] = edges_of([Line2(p, q)], fr)
            else:  # sharp: the sides go on along their tangents until they meet
                hits = _line_line(p, s1.t1, q, s2.t0)
                if not hits:
                    raise ModelingError(_offset_problem(what, distance, "parallel tangents", closed, fr.fp(v)))
                mpt = hits[0]
                extra: list[Seg] = []
                if m1.geom_type == "line":
                    end_at[i - 1] = mpt
                else:
                    extra.append(Line2(p, mpt))
                if m2.geom_type == "line":
                    start_at[i % n] = mpt
                else:
                    extra.append(Line2(mpt, q))
                joins[i] = edges_of(extra, fr)
        else:  # the corner closes: cut both where they cross, nearest the corner
            a0, a1 = m1._range()
            b0, b1 = m2._range()
            other = m2._curve()
            if n == 1:
                # (a closed edge with a corner where it starts and ends: its end half crosses its start
                # half near the corner; the kernel finds no crossing of a curve with itself)
                a0, b1 = m1._param(0.5), m2._param(0.5)
                other = ext.copy_curve(other)
            try:
                with kernel_call(what):
                    sols = ext.intersect_curves(m1._curve(), a0, a1, other, b0, b1, approx)
            finally:
                if n == 1:
                    ext.delete_curve(other)
            wv = fr.world(v)
            best: tuple[float, float, float] | None = None
            for sol in sols:
                for u1, u2 in [sol["t"]] + ([sol["end"]] if sol["end"] is not None else []):
                    f1, f2 = m1._fraction(u1), m2._fraction(u2)
                    if f1 <= lo[i - 1] or f2 >= hi[i % n]:
                        continue
                    d = Vector(m1._curve().evaluate(u1)).distance_to(wv)
                    if best is None or d < best[0]:
                        best = (d, f1, f2)
            if best is None:
                raise ModelingError(_offset_problem(what, distance, "the offsets do not meet near the corner", closed,
                                                    fr.fp(v)))
            hi[i - 1], lo[i % n] = best[1], best[2]
    from .curves import Line

    out: list[Edge] = []
    for i in range(n):
        out.extend(joins.get(i, []))
        m = moved[i]
        if hi[i] - lo[i] <= 1e-9:
            raise ModelingError(_offset_problem(what, distance, "a segment vanishes", closed, fr.fp(segs[i].start)))
        sa, ea = start_at[i], end_at[i]
        if m.geom_type == "line" and (sa is not None or ea is not None):
            a = fr.world(sa) if sa is not None else m.point_at(lo[i])
            b = fr.world(ea) if ea is not None else m.point_at(hi[i])
            if (b - a).dot(m.end - m.start) <= 0:
                raise ModelingError(_offset_problem(what, distance, "a segment vanishes", closed, fr.fp(segs[i].start)))
            out.append(Line(a, b))
        elif lo[i] > 0.0 or hi[i] < 1.0:
            out.append(m.trim(lo[i], hi[i]))
        else:
            out.append(m)
    if crossing:
        hit = chain_crossing(out, closed, size)
        if hit is not None and chain_crossing(edges_of(segs, fr), closed, size) is None:
            raise ModelingError(_crossing_problem(what, distance, fr.fp(fr.local(hit)), closed))
    return out


def chain_crossing(edges: list[Edge], closed: bool, size: float) -> Vector | None:
    """A point where a chain of edges (end to end) runs into itself, or None. Next to the point
    where two edges meet, 1e-4 of each is left out (tangent joints touch along a stretch)."""
    tol = 1e-9 * max(size, 1e-300)
    n = len(edges)
    boxes = [e.bbox() for e in edges]
    pad = 10 * tol

    def apart(a: BoundBox, b: BoundBox) -> bool:
        return any(a.max[k] + pad < b.min[k] or b.max[k] + pad < a.min[k] for k in range(3))

    def meet(a: Edge, fa: tuple[float, float], b: Edge, fb: tuple[float, float]) -> list[Vector]:
        u0, u1 = sorted((a._param(fa[0]), a._param(fa[1])))
        w0, w1 = sorted((b._param(fb[0]), b._param(fb[1])))
        if not (u1 > u0 and w1 > w0):
            return []
        with kernel_call("offset"):
            return [Vector(s["point"]) for s in ext.intersect_curves(a._curve(), u0, u1, b._curve(), w0, w1, tol)]

    cut = 1e-4
    for i in range(n):
        if edges[i].geom_type not in ("line", "circle"):
            pts = edges[i].self_intersections(tolerance=tol)
            if pts:
                return pts[0]
        for j in range(i + 1, n):
            if apart(boxes[i], boxes[j]):
                continue
            fa, fb = (0.0, 1.0), (0.0, 1.0)
            if j == i + 1:
                fa, fb = (0.0, 1.0 - cut), (cut, 1.0)
            if closed and i == 0 and j == n - 1:
                fa, fb = (fa[0] + cut, fa[1]), (fb[0], fb[1] - cut)
            pts = meet(edges[i], fa, edges[j], fb)
            if pts:
                return pts[0]
    return None


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
    try:
        return _hull(items)
    except GeometryError as e:
        raise ModelingError(f"Hull: {e}") from None


def _hull(items: Sequence[Any]) -> Sketch:
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
            if not it.plane.is_coplanar(fr.plane, 1e-6 * max(1.0, it._loose_box().diagonal)):
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
    loop = convex_hull(sites, 1e-9 * size)
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
