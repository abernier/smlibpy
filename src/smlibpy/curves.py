"""Curve constructors: lines, arcs, splines, helices.

All return :class:`~smlibpy.Edge` (one curve) or :class:`~smlibpy.Wire` (a chain).
Points may be given as 2-tuples (z = 0), 3-tuples or :class:`~smlibpy.Vector`.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

from ._kernel import KernelError, ext, k, kernel_call
from .geometry import Axis, Location, Plane, Vector, VectorLike, _vec
from .shapes import Edge, Vertex, Wire, _canonical_curve, _transform_curve

__all__ = [
    "Line",
    "Polyline",
    "PolarLine",
    "CenterArc",
    "ThreePointArc",
    "RadiusArc",
    "SagittaArc",
    "TangentArc",
    "Spline",
    "Bezier",
    "Helix",
    "EllipticalArc",
    "FilletPolyline",
]


def _pts(points: Sequence[VectorLike]) -> list[Vector]:
    if len(points) == 1 and not isinstance(points[0], (int, float)) and len(points[0]) > 3:  # type: ignore[arg-type]
        points = list(points[0])  # type: ignore[assignment]
    return [_vec(p) for p in points]


def Line(start: VectorLike, end: VectorLike) -> Edge:
    """A straight edge from ``start`` to ``end``."""
    a, b = _vec(start), _vec(end)
    if a.is_close(b, 1e-12):
        raise ValueError("a line needs two distinct points")
    with kernel_call("Line"):
        return Edge._from_curve(k.create_line_segment(a.to_tuple(), b.to_tuple()))


def PolarLine(start: VectorLike, length: float, angle: float, plane: Plane = Plane.XY) -> Edge:
    """A line of ``length`` leaving ``start`` at ``angle`` degrees from the plane's X axis."""
    a = _vec(start)
    d = plane.x_dir * math.cos(math.radians(angle)) + plane.y_dir * math.sin(math.radians(angle))
    return Line(a, a + d * length)


def Polyline(*points: VectorLike, close: bool = False) -> Wire:
    """Straight segments through the points. ``close=True`` connects the last point to the first."""
    pts = _pts(points)
    if len(pts) < 2:
        raise ValueError("a polyline needs at least two points")
    if close and not pts[0].is_close(pts[-1]):
        pts.append(pts[0])
    edges = [Line(a, b) for a, b in zip(pts, pts[1:]) if not a.is_close(b, 1e-12)]
    return Wire._raw(edges)


def _placed(curve: object, plane: Plane) -> Edge:
    if plane == Plane.XY:
        return Edge._from_curve(curve)
    return Edge._from_curve(_transform_curve(curve, plane.location.matrix))


def CenterArc(
    center: VectorLike,
    radius: float,
    start_angle: float,
    end_angle: float,
    plane: Plane = Plane.XY,
) -> Edge:
    """An arc around ``center`` from ``start_angle`` to ``end_angle`` (degrees, counterclockwise
    from the plane's X axis). ``CenterArc(c, r, 0, 360)`` is a full circle.

    ``center`` is given in plane coordinates.
    """
    if radius <= 0:
        raise ValueError("radius must be positive")
    c = _vec(center)
    sweep = end_angle - start_angle
    with kernel_call("CenterArc"):
        # A true circle (exact radius/center queries, CIRCLE in STEP), started at the
        # start angle and trimmed by angle: the circle's parameter is linear in angle.
        curve = k.create_circle((0.0, 0.0, 0.0), float(radius))
        lo, hi = curve.parameter_range()
        a0 = start_angle if sweep >= 0 else end_angle
        if a0 % 360.0:
            k.rotate(curve, (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), float(a0))
        span = min(abs(sweep), 360.0)
        if span < 360.0 - 1e-12:
            whole = curve
            curve = ext.trimmed_curve(whole, lo, lo + (hi - lo) * span / 360.0)
            ext.delete_curve(whole)
        if sweep < 0:
            ext.reverse_curve(curve)
    loc = plane.location * Location(c)
    return Edge._from_curve(_transform_curve(curve, loc.matrix))


def ThreePointArc(start: VectorLike, through: VectorLike, end: VectorLike) -> Edge:
    """The circular arc from ``start`` through ``through`` to ``end``."""
    a, b, c = _vec(start), _vec(through), _vec(end)
    ab, ac = b - a, c - a
    n = ab.cross(ac)
    if n.length < 1e-12 * max(1.0, ab.length * ac.length):
        raise ValueError("the three points are collinear")
    n = n.normalized()
    # circumcenter
    ab2, ac2 = ab.dot(ab), ac.dot(ac)
    center = a + (ab.cross(n) * ac2 - ac.cross(n) * ab2) / (2.0 * ab.cross(ac).dot(n)) * -1.0
    radius = center.distance_to(a)
    x = (a - center).normalized()
    plane = Plane(center, x, n)
    end_local = plane.to_local(c)
    ang = math.degrees(math.atan2(end_local.y, end_local.x)) % 360.0
    if ang < 1e-9:
        ang = 360.0
    return CenterArc((0, 0, 0), radius, 0.0, ang, plane)


def RadiusArc(start: VectorLike, end: VectorLike, radius: float, plane: Plane = Plane.XY) -> Edge:
    """The shorter arc of ``radius`` from ``start`` to ``end`` in ``plane``.

    A positive radius bulges to the left of the direction start→end, a negative one to
    the right.
    """
    a, b = _vec(start), _vec(end)
    chord = b - a
    half = chord.length / 2.0
    r = abs(radius)
    if r < half - 1e-12:
        raise ValueError(f"radius {r} is too small for points {chord.length} apart")
    h = math.sqrt(max(r * r - half * half, 0.0))
    mid = (a + b) / 2.0
    left = plane.z_dir.cross(chord).normalized()
    sagitta = r - h
    side = left if radius > 0 else -left
    return ThreePointArc(a, mid + side * sagitta, b)


def SagittaArc(start: VectorLike, end: VectorLike, sagitta: float, plane: Plane = Plane.XY) -> Edge:
    """An arc from ``start`` to ``end`` whose middle is ``sagitta`` away from the chord
    (positive to the left of start→end)."""
    a, b = _vec(start), _vec(end)
    mid = (a + b) / 2.0
    left = plane.z_dir.cross(b - a).normalized()
    return ThreePointArc(a, mid + left * sagitta, b)


def TangentArc(start: VectorLike, end: VectorLike, tangent: VectorLike) -> Edge:
    """An arc from ``start`` to ``end`` leaving ``start`` along ``tangent``."""
    a, b, t = _vec(start), _vec(end), _vec(tangent).normalized()
    chord = b - a
    n = t.cross(chord)
    if n.length < 1e-12:
        return Line(a, b)
    n = n.normalized()
    inward = n.cross(t)  # towards the center
    r = chord.dot(chord) / (2.0 * chord.dot(inward))
    center = a + inward * r
    rr = abs(r)
    mid_dir = ((a + b) / 2.0 - center)
    if mid_dir.length < 1e-12:
        mid_dir = t * (1 if r > 0 else -1)
    # the arc goes the short or long way depending on the tangent
    m1 = center + mid_dir.normalized() * rr
    m2 = center - mid_dir.normalized() * rr
    mid = m1 if (m1 - a).dot(t) > 0 or (m2 - a).dot(t) <= 0 else m2
    return ThreePointArc(a, mid, b)


def EllipticalArc(
    center: VectorLike,
    x_radius: float,
    y_radius: float,
    start_angle: float = 0.0,
    end_angle: float = 360.0,
    plane: Plane = Plane.XY,
) -> Edge:
    """An ellipse (or elliptical arc) around ``center`` in ``plane``."""
    with kernel_call("EllipticalArc"):
        curve = k.create_ellipse((0.0, 0.0, 0.0), float(x_radius), float(y_radius))
    e = Edge._from_curve(_transform_curve(curve, (plane.location * Location(_vec(center))).matrix))
    if abs((end_angle - start_angle) % 360.0) < 1e-12:
        return e
    # trim by angle: find the parameters at the requested angles
    pts = [plane.from_local(_vec(center) + (x_radius * math.cos(math.radians(a)), y_radius * math.sin(math.radians(a)), 0))
           for a in (start_angle, end_angle)]
    c = e._curve()
    t0 = k.curve_closest_point(c, pts[0].to_tuple())[1]
    t1 = k.curve_closest_point(c, pts[1].to_tuple())[1]
    if t1 <= t0:
        lo, hi = c.parameter_range()
        t1 += hi - lo
    with kernel_call("EllipticalArc"):
        return Edge._from_curve(ext.trimmed_curve(c, float(t0), float(t1)))


# -----------------------------------------------------------------------------
# NURBS curves
# -----------------------------------------------------------------------------
def _basis(knots: np.ndarray, p: int, u: float, deriv: int = 0) -> np.ndarray:
    """Values (or derivatives) of all B-spline basis functions of degree ``p`` at ``u``."""
    n = len(knots) - p - 1
    # span
    if u >= knots[n]:
        span = n - 1
    else:
        span = int(np.searchsorted(knots, u, side="right") - 1)
        span = max(p, min(span, n - 1))
    N = np.zeros(len(knots) - 1)
    N[span] = 1.0
    out = None
    for d in range(1, p + 1):
        nn = np.zeros(len(knots) - 1 - d)
        for i in range(len(nn)):
            a = 0.0
            den = knots[i + d] - knots[i]
            if den > 0:
                a += ((u - knots[i]) / den if not (deriv and d == p) else d / den) * N[i]
            den = knots[i + d + 1] - knots[i + 1]
            if den > 0:
                a += ((knots[i + d + 1] - u) / den if not (deriv and d == p) else -d / den) * N[i + 1]
            nn[i] = a
        N = nn
        out = N
    assert out is not None
    return out[:n]


def _interpolate(points: list[Vector], t0: Vector | None, t1: Vector | None, closed: bool) -> Edge:
    """Cubic interpolation through ``points`` with end tangent conditions."""
    Q = np.array([p.to_tuple() for p in points], dtype=float)
    if closed:
        if not points[0].is_close(points[-1]):
            Q = np.vstack([Q, Q[:1]])
        if t0 is None and t1 is None:
            d = Q[1] - Q[-2]
            t0 = t1 = Vector(d)
    chords = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    if np.any(chords < 1e-12):
        raise ValueError("spline points must be distinct")
    total = chords.sum()
    # centripetal parameters reduce overshoot on uneven spacing
    w = np.sqrt(chords)
    u = np.concatenate([[0.0], np.cumsum(w) / w.sum()])
    n = len(Q) - 1

    def bessel(i0: int, i1: int, i2: int, at: int) -> np.ndarray:
        # derivative at u[at] of the parabola through three points
        ua, ub, uc = u[i0], u[i1], u[i2]
        A, B, C = Q[i0], Q[i1], Q[i2]
        x = u[at]
        return (A * (2 * x - ub - uc) / ((ua - ub) * (ua - uc)) + B * (2 * x - ua - uc) / ((ub - ua) * (ub - uc))
                + C * (2 * x - ua - ub) / ((uc - ua) * (uc - ub)))

    if n == 1:
        D0 = Q[1] - Q[0] if t0 is None else np.array(t0.normalized().to_tuple()) * total
        D1 = Q[1] - Q[0] if t1 is None else np.array(t1.normalized().to_tuple()) * total
    else:
        D0 = bessel(0, 1, 2, 0) if t0 is None else np.array(t0.normalized().to_tuple()) * total
        D1 = bessel(n - 2, n - 1, n, n) if t1 is None else np.array(t1.normalized().to_tuple()) * total
    p = 3
    knots = np.concatenate([[0.0] * 4, u[1:-1], [1.0] * 4])
    m = n + 3
    A = np.zeros((m, m))
    B = np.zeros((m, 3))
    rows = 0
    A[rows] = _basis(knots, p, 0.0)
    B[rows] = Q[0]
    rows += 1
    A[rows] = _basis(knots, p, 0.0, deriv=1)
    B[rows] = D0
    rows += 1
    for i in range(1, n):
        A[rows] = _basis(knots, p, u[i])
        B[rows] = Q[i]
        rows += 1
    A[rows] = _basis(knots, p, 1.0, deriv=1)
    B[rows] = D1
    rows += 1
    A[rows] = _basis(knots, p, 1.0)
    B[rows] = Q[n]
    P = np.linalg.solve(A, B)
    with kernel_call("Spline"):
        return Edge._from_curve(_canonical_curve(P, list(knots), p, None))


def Spline(
    *points: VectorLike,
    tangents: tuple[VectorLike | None, VectorLike | None] | None = None,
    closed: bool = False,
) -> Edge:
    """A smooth cubic curve through the points.

    Args:
        points: Two or more points.
        tangents: Optional ``(start_tangent, end_tangent)`` directions; either may be None.
        closed: Make a closed loop (smooth at the join).
    """
    pts = _pts(points)
    if len(pts) < 2:
        raise ValueError("a spline needs at least two points")
    t0 = t1 = None
    if tangents is not None:
        t0 = _vec(tangents[0]) if tangents[0] is not None else None
        t1 = _vec(tangents[1]) if tangents[1] is not None else None
    if len(pts) == 2 and t0 is None and t1 is None and not closed:
        return Line(pts[0], pts[1])
    return _interpolate(pts, t0, t1, closed)


def Bezier(*control_points: VectorLike, weights: Sequence[float] | None = None) -> Edge:
    """A Bézier curve (rational if ``weights`` are given) from its control points."""
    pts = _pts(control_points)
    if len(pts) < 2:
        raise ValueError("a Bézier curve needs at least two control points")
    p = len(pts) - 1
    knots = [0.0] * (p + 1) + [1.0] * (p + 1)
    with kernel_call("Bezier"):
        return Edge._from_curve(_canonical_curve(np.array([q.to_tuple() for q in pts]), knots, p,
                                                 list(weights) if weights is not None else None))


def Helix(
    pitch: float,
    height: float,
    radius: float,
    *,
    center: VectorLike = (0, 0, 0),
    direction: VectorLike = (0, 0, 1),
    end_radius: float | None = None,
    left_handed: bool = False,
) -> Edge:
    """A helix around ``direction`` through ``center``.

    ``end_radius`` makes a conical helix; ``pitch`` is the rise per turn.
    """
    if pitch <= 0 or height <= 0 or radius <= 0:
        raise ValueError("pitch, height and radius must be positive")
    turns = height / pitch
    with kernel_call("Helix"):
        curve = k.create_helix((0.0, 0.0, 0.0), float(height), float(radius),
                               float(end_radius if end_radius is not None else radius), float(turns),
                               right_handed=not left_handed)
    plane = Plane(_vec(center), z_dir=_vec(direction))
    return Edge._from_curve(_transform_curve(curve, plane.location.matrix))


def FilletPolyline(*points: VectorLike, radius: float, close: bool = False) -> Wire:
    """A polyline whose corners are rounded with ``radius``."""
    return Polyline(*points, close=close).fillet(radius)


# -----------------------------------------------------------------------------
# Corner rounding for wires
# -----------------------------------------------------------------------------
def _fillet_wire(wire: Wire, radius: float, vertices: Iterable[VectorLike | Vertex] | None) -> Wire:
    edges = list(wire.edges())
    n = len(edges)
    closed = wire.is_closed
    targets = None
    if vertices is not None:
        targets = [_vec(v.point if isinstance(v, Vertex) else v) for v in vertices]

    corners = []  # (index of incoming edge, index of outgoing edge)
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        a, b = edges[i], edges[j]
        if a.geom_type != "line" or b.geom_type != "line":
            continue
        corner = a.end
        if targets is not None and not any(corner.is_close(t, 1e-6) for t in targets):
            continue
        u, w = a.direction, b.direction
        if u.is_parallel(w):
            continue
        corners.append((i, j))

    # Each rounded corner moves the end of its incoming and the start of its outgoing line.
    setback_end = [0.0] * n
    setback_start = [0.0] * n
    arcs: dict[int, Edge] = {}
    for i, j in corners:
        u, w = edges[i].direction, edges[j].direction
        phi = math.radians(u.angle_to(w))
        d = radius * math.tan(phi / 2.0)
        v = edges[i].end
        p1 = v - u * d
        p2 = v + w * d
        bis = (w - u).normalized()
        center = v + bis * (radius / math.cos(phi / 2.0))
        mid = center + (v - center).normalized() * radius
        setback_end[i] = d
        setback_start[j] = d
        arcs[i] = ThreePointArc(p1, mid, p2)

    out: list[Edge] = []
    for i, e in enumerate(edges):
        if setback_start[i] or setback_end[i]:
            length = e.length
            if setback_start[i] + setback_end[i] > length + 1e-9:
                raise ValueError(f"fillet radius {radius} is too large for the edge {e!r}")
            if setback_start[i] + setback_end[i] < length - 1e-9:
                d = e.direction
                out.append(Line(e.start + d * setback_start[i], e.end - d * setback_end[i]))
        else:
            out.append(e)
        if i in arcs:
            out.append(arcs[i])
    return Wire._raw(out)
