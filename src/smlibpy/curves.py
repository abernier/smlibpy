"""Curve constructors: lines, arcs, splines, helices.

All return :class:`~smlibpy.Edge` (one curve) or :class:`~smlibpy.Wire` (a chain).
Points may be given as 2-tuples (z = 0), 3-tuples or :class:`~smlibpy.Vector`.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

from ._kernel import KernelError, ext, k, kernel_call
from .geometry import Axis, Location, Plane, Vector, VectorLike, _direction, _vec
from .shapes import Edge, Shape, Vertex, Wire, _canonical_curve, _transform_curve

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
    "fit_curve",
    "Bezier",
    "Helix",
    "Spiral",
    "EllipticalArc",
    "ParabolicArc",
    "HyperbolicArc",
    "ConicArc",
    "FilletPolyline",
    "make_compatible",
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
    arc_size: float,
    plane: Plane = Plane.XY,
) -> Edge:
    """An arc around ``center`` starting at ``start_angle`` and spanning ``arc_size`` degrees
    (angles counterclockwise from the plane's X axis; a negative ``arc_size`` runs
    clockwise). ``CenterArc(c, r, 0, 360)`` is a full circle.

    ``center`` is given in plane coordinates.
    """
    if radius <= 0:
        raise ValueError("radius must be positive")
    if arc_size == 0:
        raise ValueError("CenterArc: arc_size must not be zero (360 is a full circle)")
    return Edge._from_curve(_arc_curve(_vec(center), float(radius), float(start_angle), float(arc_size), plane))


def _arc_curve(center: Vector, radius: float, start_angle: float, arc_size: float, plane: Plane) -> object:
    """A new kernel circle, or arc of one, around ``center`` (in plane coordinates) from
    ``start_angle`` over ``arc_size`` degrees. The caller owns the curve."""
    sweep = float(arc_size)
    end_angle = start_angle + sweep
    with kernel_call("CenterArc"):
        # A true circle (exact radius/center queries, CIRCLE in STEP), started at the start
        # angle and trimmed at the parameter of the end point. (The parameter of a rational
        # NURBS circle is not proportional to the angle.)
        curve = k.create_circle((0.0, 0.0, 0.0), float(radius))
        lo, hi = curve.parameter_range()
        a0 = start_angle if sweep >= 0 else end_angle
        if a0 % 360.0:
            k.rotate(curve, (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), float(a0))
        span = min(abs(sweep), 360.0)
        if span < 360.0 - 1e-9:
            a1 = math.radians(a0 + span)
            _, t_end, _ = k.curve_closest_point(curve, (radius * math.cos(a1), radius * math.sin(a1), 0.0))
            if t_end <= lo + 1e-12:
                t_end = hi
            whole = curve
            curve = ext.trimmed_curve(whole, lo, float(t_end))
            ext.delete_curve(whole)
        if sweep < 0:
            ext.reverse_curve(curve)
    loc = plane.location * Location(center)
    return _transform_curve(curve, loc.matrix)


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
    """An ellipse (or elliptical arc) around ``center`` in ``plane``.

    The angles are ellipse angles in degrees (the point at angle a is
    ``(x_radius cos a, y_radius sin a)``). The arc runs counterclockwise from ``start_angle``
    to ``end_angle``, also across 0 (300 to 60 passes through the X axis); equal angles give
    the whole ellipse.
    """
    span = (end_angle - start_angle) % 360.0
    with kernel_call("EllipticalArc"):
        curve = k.create_ellipse((0.0, 0.0, 0.0), float(x_radius), float(y_radius))
        if 1e-12 <= span < 360.0 - 1e-12:
            # A true ellipse over the arc's angles. They may run from -360 to 360, so an arc
            # across 0 starts below 0 and stays one curve: the whole ellipse starts at 0 and
            # cannot be trimmed across its start.
            start = start_angle % 360.0
            if start + span > 360.0:
                start -= 360.0
            whole = curve
            curve = ext.ellipse_arc(whole, float(start), float(start + span))
            ext.delete_curve(whole)
    return Edge._from_curve(_transform_curve(curve, (plane.location * Location(_vec(center))).matrix))


# -----------------------------------------------------------------------------
# Conics
# -----------------------------------------------------------------------------
def _conic(p0: Vector, p1: Vector, p2: Vector, w: float, plane: Plane, what: str) -> Edge:
    """The rational quadratic Bezier p0, p1, p2 (plane coordinates) with middle weight w, placed
    on the plane."""
    with kernel_call(what):
        curve = _canonical_curve(np.array([p0.to_tuple(), p1.to_tuple(), p2.to_tuple()]), [0.0] * 3 + [1.0] * 3, 2,
                                 None if w == 1.0 else [1.0, w, 1.0])
    return _placed(curve, plane)


def _finite(what: str, **values: float) -> None:
    for name, v in values.items():
        if isinstance(v, bool) or not isinstance(v, (int, float, np.integer, np.floating)) or not math.isfinite(v):
            raise ValueError(f"{what}: {name} must be a finite number, got {v!r}")


def ParabolicArc(vertex: VectorLike, focal_length: float, start: float, end: float, plane: Plane = Plane.XY) -> Edge:
    """A piece of the parabola ``y = x² / (4 focal_length)``: its vertex at ``vertex`` (in plane
    coordinates), opening along the plane's Y axis, from ``x = start`` to ``x = end`` (measured
    from the vertex along the plane's X axis). Exact: a quadratic B-spline. For reflectors, horns
    and nozzle contours; a negative focal length opens it along -Y.

    ``ParabolicArc((0, 0), 10, -20, 20)`` runs from (-20, 10) through (0, 0) to (20, 10); its
    focus is at (0, 10).
    """
    _finite("ParabolicArc", focal_length=focal_length, start=start, end=end)
    if focal_length == 0:
        raise ValueError("ParabolicArc: the focal length must not be zero")
    if start == end:
        raise ValueError("ParabolicArc: start and end must differ")
    v, f = _vec(vertex), float(focal_length)
    x0, x1 = float(start), float(end)
    return _conic(v + Vector(x0, x0 * x0 / (4 * f)), v + Vector((x0 + x1) / 2, x0 * x1 / (4 * f)),
                  v + Vector(x1, x1 * x1 / (4 * f)), 1.0, plane, "ParabolicArc")


def HyperbolicArc(center: VectorLike, x_radius: float, y_radius: float, start: float, end: float,
                  plane: Plane = Plane.XY) -> Edge:
    """A piece of the hyperbola ``x²/x_radius² - y²/y_radius² = 1``, the branch on the +X side of
    ``center`` (in plane coordinates), from ``y = start`` to ``y = end`` (measured from the center
    along the plane's Y axis). Exact: a rational quadratic B-spline. Its vertex is at
    ``(x_radius, 0)`` from the center and its asymptotes have the slopes ``±y_radius / x_radius``.

    ``HyperbolicArc((0, 0), 10, 20, -30, 30)`` revolved about the Y axis is a cooling tower with a
    waist of radius 10.
    """
    _finite("HyperbolicArc", x_radius=x_radius, y_radius=y_radius, start=start, end=end)
    if x_radius <= 0 or y_radius <= 0:
        raise ValueError("HyperbolicArc: x_radius and y_radius must be positive")
    if start == end:
        raise ValueError("HyperbolicArc: start and end must differ")
    a, b = float(x_radius), float(y_radius)
    t0, t1 = math.asinh(float(start) / b), math.asinh(float(end) / b)
    m, d = (t0 + t1) / 2, (t1 - t0) / 2
    c = _vec(center)
    # the tangents at the ends meet at the middle control point; the weight cosh of half the span
    return _conic(c + Vector(a * math.cosh(t0), b * math.sinh(t0)),
                  c + Vector(a * math.cosh(m) / math.cosh(d), b * math.sinh(m) / math.cosh(d)),
                  c + Vector(a * math.cosh(t1), b * math.sinh(t1)), math.cosh(d), plane, "HyperbolicArc")


def ConicArc(start: VectorLike, apex: VectorLike, end: VectorLike, rho: float = 0.5) -> Edge:
    """A conic arc from ``start`` to ``end``, tangent there to the lines toward ``apex`` (the
    point where the end tangents meet), with the fullness ``rho`` (0 < rho < 1): the arc passes
    ``rho`` of the way from the middle of the chord to the apex. 0.5 is a parabola, less an
    ellipse (flatter), more a hyperbola (closer to the apex). The rho conic of styling: a corner
    blend whose shape a single number sets. Exact: a rational quadratic B-spline.

    ``ConicArc((0, 0), (10, 0), (10, 10), 0.4142)`` is nearly the quarter circle of radius 10
    (exactly for rho = sqrt(2) - 1).
    """
    _finite("ConicArc", rho=rho)
    if not 0 < rho < 1:
        raise ValueError(f"ConicArc: rho is between 0 and 1 (0.5: a parabola), got {rho!r}")
    a, p, b = _vec(start), _vec(apex), _vec(end)
    if a.is_close(b, 1e-12) or (p - a).cross(b - a).length <= 1e-12 * max(1.0, (p - a).length * (b - a).length):
        raise ValueError("ConicArc: start, apex and end must not lie on one line")
    w = float(rho) / (1.0 - float(rho))
    with kernel_call("ConicArc"):
        return Edge._from_curve(_canonical_curve(np.array([a.to_tuple(), p.to_tuple(), b.to_tuple()]),
                                                 [0.0] * 3 + [1.0] * 3, 2, [1.0, w, 1.0]))


# -----------------------------------------------------------------------------
# NURBS curves
# -----------------------------------------------------------------------------
def _span(knots: Sequence[float], p: int, u: float) -> int:
    """The index of the knot span that holds ``u`` (the last span for the end of the range)."""
    n = len(knots) - p - 1
    if u >= knots[n]:
        return n - 1
    lo, hi = p, n
    while hi - lo > 1:  # knots[lo] <= u < knots[hi]
        mid = (lo + hi) // 2
        if u < knots[mid]:
            hi = mid
        else:
            lo = mid
    return lo


def _basis_ders(knots: Sequence[float], p: int, span: int, u: float, nd: int) -> list[list[float]]:
    """The p + 1 B-spline basis functions of degree ``p`` that are not zero in ``span`` and their
    derivatives up to the ``nd``-th at ``u``: ``ders[k][j]`` is the k-th derivative of the basis
    function of control point ``span - p + j`` (Piegl and Tiller, The NURBS Book, A2.3)."""
    ndu = [[0.0] * (p + 1) for _ in range(p + 1)]
    ndu[0][0] = 1.0
    left = [0.0] * (p + 1)
    right = [0.0] * (p + 1)
    for j in range(1, p + 1):
        left[j] = u - knots[span + 1 - j]
        right[j] = knots[span + j] - u
        saved = 0.0
        for r in range(j):
            ndu[j][r] = right[r + 1] + left[j - r]
            temp = ndu[r][j - 1] / ndu[j][r]
            ndu[r][j] = saved + right[r + 1] * temp
            saved = left[j - r] * temp
        ndu[j][j] = saved
    ders = [[0.0] * (p + 1) for _ in range(nd + 1)]
    for j in range(p + 1):
        ders[0][j] = ndu[j][p]
    for r in range(p + 1):
        a = [[0.0] * (p + 1), [0.0] * (p + 1)]
        s1, s2 = 0, 1
        a[0][0] = 1.0
        for k in range(1, nd + 1):
            d = 0.0
            rk, pk = r - k, p - k
            if r >= k:
                a[s2][0] = a[s1][0] / ndu[pk + 1][rk]
                d = a[s2][0] * ndu[rk][pk]
            j1 = 1 if rk >= -1 else -rk
            j2 = k - 1 if r - 1 <= pk else p - r
            for j in range(j1, j2 + 1):
                a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j]
                d += a[s2][j] * ndu[rk + j][pk]
            if r <= pk:
                a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r]
                d += a[s2][k] * ndu[r][pk]
            ders[k][r] = d
            s1, s2 = s2, s1
    f = float(p)
    for k in range(1, nd + 1):
        for j in range(p + 1):
            ders[k][j] *= f
        f *= p - k
    return ders


def _thomas(sub: list[float], diag: list[float], sup: list[float], rhs: list[list[float]]) -> list[list[float]]:
    """The solution of a tridiagonal system (row i: sub[i] x[i-1] + diag[i] x[i] + sup[i] x[i+1] =
    rhs[i], each rhs a row of numbers). Without pivoting: B-spline collocation matrices are totally
    positive (de Boor), so elimination in order is stable."""
    n = len(diag)
    c = [0.0] * n
    d = [list(r) for r in rhs]
    w = len(d[0]) if n else 0
    for i in range(n):
        m = diag[i] - (sub[i] * c[i - 1] if i else 0.0)
        c[i] = sup[i] / m if i + 1 < n else 0.0
        for q in range(w):
            d[i][q] = (d[i][q] - (sub[i] * d[i - 1][q] if i else 0.0)) / m
    for i in range(n - 2, -1, -1):
        for q in range(w):
            d[i][q] -= c[i] * d[i + 1][q]
    return d


def _interpolate(points: list[Vector], t0: Vector | None, t1: Vector | None, closed: bool) -> Edge:
    """Cubic interpolation through ``points``: with end tangent conditions, or, for a closed curve
    without tangents, periodic (curvature continuous at the seam as everywhere else). Only the
    basis functions that are not zero at each point are evaluated, and the system is tridiagonal
    (one row and column more for a closed curve): linear in the number of points."""
    Q = [list(p.to_tuple()) for p in points]
    if closed and not points[0].is_close(points[-1]):
        Q.append(list(Q[0]))
    periodic = closed and t0 is None and t1 is None
    if periodic and len(Q) < 4:
        raise ValueError("a closed spline needs at least three points")
    chords = [math.dist(a, b) for a, b in zip(Q, Q[1:])]
    if any(c < 1e-12 for c in chords):
        raise ValueError("spline points must be distinct")
    total = sum(chords)
    # centripetal parameters reduce overshoot on uneven spacing
    w = [math.sqrt(c) for c in chords]
    wsum = sum(w)
    u = [0.0]
    acc = 0.0
    for x in w[:-1]:
        acc += x
        u.append(acc / wsum)
    u.append(1.0)
    n = len(Q) - 1
    p = 3
    knots = [0.0] * 4 + u[1:-1] + [1.0] * 4
    m = n + 3  # control points
    P: list[list[float] | None] = [None] * m
    end0 = _basis_ders(knots, p, p, 0.0, 2)  # control points 0..3
    end1 = _basis_ders(knots, p, m - 1, 1.0, 2)  # control points m-4..m-1
    rows = [_basis_ders(knots, p, i + 3, u[i], 0)[0] for i in range(1, n)]  # row i: control points i..i+3
    P[0], P[m - 1] = Q[0], Q[n]

    if not periodic:
        def bessel(i0: int, i1: int, i2: int, at: int) -> list[float]:
            # derivative at u[at] of the parabola through three points
            ua, ub, uc = u[i0], u[i1], u[i2]
            x = u[at]
            fa = (2 * x - ub - uc) / ((ua - ub) * (ua - uc))
            fb = (2 * x - ua - uc) / ((ub - ua) * (ub - uc))
            fc = (2 * x - ua - ub) / ((uc - ua) * (uc - ub))
            return [Q[i0][q] * fa + Q[i1][q] * fb + Q[i2][q] * fc for q in range(3)]

        def given(t: Vector) -> list[float]:
            return [c * total for c in t.normalized().to_tuple()]

        chord = [Q[1][q] - Q[0][q] for q in range(3)]
        if n == 1:
            D0 = chord if t0 is None else given(t0)
            D1 = chord if t1 is None else given(t1)
        else:
            D0 = bessel(0, 1, 2, 0) if t0 is None else given(t0)
            D1 = bessel(n - 2, n - 1, n, n) if t1 is None else given(t1)
        # the end derivatives give the second and the second last control points
        P[1] = [(D0[q] - end0[1][0] * Q[0][q]) / end0[1][1] for q in range(3)]
        P[m - 2] = [(D1[q] - end1[1][3] * Q[n][q]) / end1[1][2] for q in range(3)]
        # control points 2 .. m-3 from the points 1 .. n-1
        sub, diag, sup, rhs = [], [], [], []
        for i in range(1, n):
            N = rows[i - 1]
            r = list(Q[i])
            if i == 1:
                r = [r[q] - N[0] * P[1][q] for q in range(3)]  # type: ignore[index]
            if i == n - 1:
                r = [r[q] - N[2] * P[m - 2][q] for q in range(3)]  # type: ignore[index]
            sub.append(N[0] if i > 1 else 0.0)
            diag.append(N[1])
            sup.append(N[2] if i < n - 1 else 0.0)
            rhs.append(r)
        if rhs:
            P[2:m - 2] = _thomas(sub, diag, sup, rhs)
    else:
        # Unknowns: control points 1 .. m-2 (y[0] .. y[k]); the first and last are the seam point.
        # Rows: the first and second derivatives equal at both ends of the seam, and the points
        # 1 .. n-1. Ordered as below the matrix is tridiagonal but for corners; the last unknown is
        # eliminated (Schur complement) and the rest solved by two tridiagonal solves.
        k = m - 3

        def seam(order: int) -> tuple[dict[int, float], list[float]]:
            row: dict[int, float] = {}
            rhs = [0.0, 0.0, 0.0]
            for j, cf in [(j, end0[order][j]) for j in range(4)] + [(m - 4 + j, -end1[order][j]) for j in range(4)]:
                if j in (0, m - 1):
                    rhs = [rhs[q] - cf * Q[0][q] for q in range(3)]
                elif cf:
                    row[j - 1] = row.get(j - 1, 0.0) + cf
            return row, rhs

        first, r_first = seam(1)  # y[0] and y[k]
        last, r_last = seam(2)  # y[0], y[1], y[k-1], y[k]
        sub, diag, sup, rhs, col = [0.0], [first.get(0, 0.0)], [0.0], [r_first], [first.get(k, 0.0)]
        for i in range(1, n):  # row i: y[i-1], y[i], y[i+1]
            N = rows[i - 1]
            sub.append(N[0])
            diag.append(N[1])
            sup.append(N[2] if i + 1 < k else 0.0)
            col.append(N[2] if i + 1 == k else 0.0)
            rhs.append(list(Q[i]))
        X = _thomas(sub, diag, sup, rhs)
        Z = _thomas(sub, diag, sup, [[c] for c in col])
        a_bb = last.get(k, 0.0) - sum(cf * Z[j][0] for j, cf in last.items() if j < k)
        if abs(a_bb) < 1e-300:
            raise ValueError("Spline: the closed curve through these points cannot be made")
        yk = [(r_last[q] - sum(cf * X[j][q] for j, cf in last.items() if j < k)) / a_bb for q in range(3)]
        for j in range(k):
            P[1 + j] = [X[j][q] - Z[j][0] * yk[q] for q in range(3)]
        P[m - 2] = yk
    with kernel_call("Spline"):
        return Edge._from_curve(_canonical_curve(np.array(P, dtype=float), knots, p, None))


def Spline(
    *points: VectorLike,
    tangents: tuple[VectorLike | None, VectorLike | None] | Sequence[VectorLike] | None = None,
    closed: bool = False,
) -> Edge:
    """A smooth cubic curve through the points.

    Args:
        points: Two or more points.
        tangents: Optional ``(start_tangent, end_tangent)`` directions; either may be None. Or one
            direction for every point (a list as long as the points): the curve passes through each
            point in its direction.
        closed: Make a closed loop (smooth at the join).
    """
    pts = _pts(points)
    if len(pts) < 2:
        raise ValueError("a spline needs at least two points")
    t0 = t1 = None
    if tangents is not None and len(tangents) == len(pts) and len(pts) > 2:
        return _through_tangents(pts, list(tangents), closed)
    if tangents is not None:
        if len(tangents) != 2:
            raise ValueError(f"Spline: tangents are (start, end) or one per point ({len(pts)}), got {len(tangents)}")
        t0 = _vec(tangents[0]) if tangents[0] is not None else None
        t1 = _vec(tangents[1]) if tangents[1] is not None else None
    if len(pts) == 2 and t0 is None and t1 is None and not closed:
        return Line(pts[0], pts[1])
    return _interpolate(pts, t0, t1, closed)


def _through_tangents(pts: list[Vector], tangents: list[VectorLike | None], closed: bool) -> Edge:
    """A cubic B-spline through the points in the direction given at each."""
    if any(t is None for t in tangents):
        raise ValueError("Spline: with a tangent for every point, none of them may be None")
    dirs = [_vec(t) for t in tangents]
    for i, d in enumerate(dirs):
        if d.length <= 0:
            raise ValueError(f"Spline: tangent {i + 1} has no direction")
    if closed and not pts[0].is_close(pts[-1]):
        pts, dirs = [*pts, pts[0]], [*dirs, dirs[0]]
    with kernel_call("Spline", "the points must be distinct"):
        curve, _, _ = ext.interpolate_tangents([c for p in pts for c in p], [c for d in dirs for c in d], 3)
    return Edge._from_curve(curve)


def fit_curve(
    points: Sequence[VectorLike] | np.ndarray,
    *,
    tolerance: float | None = None,
    degree: int = 3,
    tangents: tuple[VectorLike | None, VectorLike | None] | None = None,
    closed: bool = False,
) -> Edge:
    """A smooth curve near many points, with as few control points as keep it within
    ``tolerance`` of every one: for scanned or digitized outlines, sampled curves and long
    polylines, where :func:`Spline` passes through every point, follows every wiggle and needs a
    control point per point.

    Args:
        points: The points in order along the curve: a list of points or an (n, 2) or (n, 3) array
            (2D points lie at z = 0).
        tolerance: The largest distance from any point to the curve. Default: 1/1000 of the size
            of the points.
        degree: The highest degree of the curve, 2 to 9 (the fit starts at 2 and raises it as it
            needs).
        tangents: Optional ``(start, end)`` directions; either may be None. Not for closed curves.
        closed: A closed curve, through the first point again and tangent there.

    Few points (fewer than about six) give the curve through them (:func:`Spline`). Where no fit
    keeps within the tolerance, :class:`ModelingError` gives the distance it reached. ::

        outline = fit_curve(scan_points, tolerance=0.02)
        print(len(outline.nurbs().points), "control points")
    """
    from ._kernel import ModelingError

    if isinstance(points, np.ndarray):
        arr = np.asarray(points, dtype=float)
        if arr.ndim != 2 or arr.shape[1] not in (2, 3):
            raise ValueError(f"fit_curve: an array of points is n x 2 or n x 3, got shape {arr.shape}")
        pts = [Vector(*row) for row in arr]
    else:
        pts = [_vec(p) for p in points]
    if len(pts) < 2:
        raise ValueError("fit_curve needs at least two points")
    if not all(math.isfinite(c) for p in pts for c in p):
        raise ValueError("fit_curve: the points must be finite numbers")
    arr = np.array([p.to_tuple() for p in pts])
    size = float(np.linalg.norm(arr.max(axis=0) - arr.min(axis=0)))
    if size == 0:
        raise ValueError("fit_curve: the points all coincide")
    keep = [pts[0]]
    for p in pts[1:]:
        if p.distance_to(keep[-1]) > 1e-12 * size:
            keep.append(p)
    if closed and len(keep) > 2 and keep[-1].distance_to(keep[0]) <= 1e-12 * size:
        keep.pop()
    pts = keep
    tol = 1e-3 * size if tolerance is None else tolerance
    if not (isinstance(tol, (int, float)) and math.isfinite(tol) and tol > 0):
        raise ValueError(f"fit_curve: the tolerance must be positive, got {tolerance!r}")
    if not (isinstance(degree, (int, np.integer)) and 2 <= degree <= 9):
        raise ValueError(f"fit_curve: the degree is 2 to 9, got {degree!r}")
    if tangents is not None and len(tangents) != 2:
        raise ValueError("fit_curve: tangents are (start, end); for a direction at every point use Spline(..., "
                         "tangents=[...])")
    if closed and tangents is not None:
        raise ValueError("fit_curve: a closed curve takes no end tangents")
    t0 = list(_vec(tangents[0])) if tangents is not None and tangents[0] is not None else []
    t1 = list(_vec(tangents[1])) if tangents is not None and tangents[1] is not None else []
    try:
        with kernel_call("fit_curve"):
            curve, dev, _ = ext.approximate_points([c for p in pts for c in p], int(degree), float(tol), t0, t1,
                                                   bool(closed))
    except KernelError:
        # too few points for an approximation: the curve through them
        if len(pts) > 6:
            raise
        return Spline(*pts, tangents=tangents, closed=closed)
    edge = Edge._from_curve(curve)
    if dev > tol:
        raise ModelingError(f"fit_curve: the closest fit found passes {dev:.3g} from a point, more than the tolerance "
                            f"{tol:g}; use a larger tolerance or a higher degree")
    return edge


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
    direction: Axis | VectorLike = (0, 0, 1),
    end_radius: float | None = None,
    left_handed: bool = False,
) -> Edge:
    """A helix around ``direction`` through ``center``.

    ``direction`` is a vector or an axis (only its direction counts; ``center`` places the
    helix). ``end_radius`` makes a conical helix; ``pitch`` is the rise per turn. Any number of
    turns: beyond 120 the helix is fitted in pieces of whole turns, joined into one curve.
    """
    if pitch <= 0 or height <= 0 or radius <= 0:
        raise ValueError("pitch, height and radius must be positive")
    turns = height / pitch
    r1 = float(end_radius if end_radius is not None else radius)
    with kernel_call("Helix"):
        curve = _helix_curve(float(pitch), float(height), float(radius), r1, float(turns), not left_handed)
    plane = Plane(_vec(center), z_dir=_direction(direction, "Helix"))
    return Edge._from_curve(_transform_curve(curve, plane.location.matrix))


def Spiral(start_radius: float, end_radius: float, turns: float, plane: Plane = Plane.XY, *,
           clockwise: bool = False) -> Edge:
    """A flat (Archimedean) spiral around the plane's origin: its radius grows (or shrinks) evenly
    with the angle from ``start_radius`` to ``end_radius`` over ``turns`` turns. It starts on the
    plane's X axis and turns counterclockwise seen from the plane's normal (``clockwise=True``:
    the other way). Either radius may be 0 (a spiral from or to the center). For spiral springs,
    scroll grooves and coils; a B-spline within 1e-4 of the exact spiral, as :func:`Helix`, of any
    number of turns.

    ``Spiral(2, 20, 5)`` runs from (2, 0) to (20, 0) in five turns, 9/5 = 3.6 apart.
    """
    _finite("Spiral", start_radius=start_radius, end_radius=end_radius, turns=turns)
    if start_radius < 0 or end_radius < 0:
        raise ValueError("Spiral: the radii must not be negative")
    if start_radius == end_radius:
        raise ValueError("Spiral: start_radius and end_radius must differ (equal ones go round one circle again and "
                         "again; use CenterArc)")
    if turns <= 0:
        raise ValueError("Spiral: turns must be positive")
    # The kernel's helix of a tiny height (at least 1e-7 a piece) flattened onto the plane: its
    # control points moved to z = 0, the exact projection of a curve within the tolerance of the helix,
    # whose projection is the spiral. The kernel takes radii from 1e-7: a spiral from or to the
    # center starts or ends at its first or last control point, moved there.
    r0, r1, n = float(start_radius), float(end_radius), float(turns)
    height = 2e-7 * max(1.0, n)
    with kernel_call("Spiral"):
        curve = _helix_curve(height / n, height, max(r0, 1e-7), max(r1, 1e-7), n, not clockwise)
        d = ext.curve_data(curve)
        ext.delete_curve(curve)
        poles = np.array(d["poles"], dtype=float)
        poles[:, 2] = 0.0
        if r0 == 0:
            poles[0, :2] = 0.0
        if r1 == 0:
            poles[-1, :2] = 0.0
        flat = _canonical_curve(poles, d["knots"], d["degree"], d["weights"])
    return _placed(flat, plane)


_HELIX_PIECE_TURNS = 100  # (the kernel fits at most 124.25 turns in one go)


def _helix_curve(pitch: float, height: float, r0: float, r1: float, turns: float, right_handed: bool) -> object:
    """The kernel's helix along +Z from the origin; above 120 turns, pieces of whole turns (each
    starts where the one before ends, on +X) joined into one B-spline. The caller owns the curve."""
    if turns <= 120:
        return k.create_helix((0.0, 0.0, 0.0), height, r0, r1, turns, right_handed=right_handed)
    counts = [float(_HELIX_PIECE_TURNS)] * int(turns // _HELIX_PIECE_TURNS)
    rest = turns - _HELIX_PIECE_TURNS * len(counts)
    if rest >= 1.0:
        counts.append(rest)
    else:
        counts[-1] += rest  # (no sliver of a turn at the end)
    pieces = []
    try:
        z = 0.0
        for i, n in enumerate(counts):
            h = height - z if i == len(counts) - 1 else n * pitch  # (the last one ends at the height exactly)
            ra, rb = r0 + (r1 - r0) * z / height, r0 + (r1 - r0) * (z + h) / height
            pieces.append(k.create_helix((0.0, 0.0, z), h, ra, rb, n, right_handed=right_handed))
            z += h
        return ext.join_curves(pieces)
    finally:
        for c in pieces:
            ext.delete_curve(c)


def FilletPolyline(*points: VectorLike, radius: float, close: bool = False) -> Wire:
    """A polyline whose corners are rounded with ``radius``."""
    return Polyline(*points, close=close).fillet(radius)


# -----------------------------------------------------------------------------
# Corner rounding for wires
# -----------------------------------------------------------------------------
def _fp(v: Vector) -> str:
    from ._planar import fmt

    return f"({fmt(v.x)}, {fmt(v.y)})" if abs(v.z) < 1e-9 else f"({fmt(v.x)}, {fmt(v.y)}, {fmt(v.z)})"


def _fillet_wire(wire: Wire, radius: float, vertices: Iterable[VectorLike | Vertex] | None) -> Wire:
    """Round the corners of a wire (Wire.fillet): a planar wire's corners between lines and arcs
    exactly in its plane (as Sketch.fillet), a wire that is not planar its corners between lines.
    Corners that cannot be rounded raise, named or not; points that are not corners raise."""
    from ._kernel import ModelingError
    from ._planar import Corner, GeometryError, assemble, describe, fmt, is_smooth
    from ._regions import CurveCorners, curve_of, real_size, seg_of_edge, wire_frame

    if not radius > 0:
        raise ValueError("fillet: the radius must be positive")
    edges = list(wire.edges())
    n = len(edges)
    closed = wire.is_closed
    pts = [p for e in edges for p in (e.start, e.end)]
    size = max(1.0, max(abs(c) for p in pts for c in p))
    vtol = 1e-6 * size
    joints = list(range(n if closed else n - 1))  # corner i: where edges[i] ends and edges[i + 1] starts
    chosen = set(joints)
    if vertices is not None:
        targets = [_vec(v.point if isinstance(v, Vertex) else v) for v in vertices]
        if not targets:
            raise ValueError("fillet: no corners given (the selection is empty)")
        chosen = set()
        missing = []
        for t in targets:
            hits = [i for i in joints if edges[i].end.distance_to(t) <= vtol]
            if not hits:
                missing.append(t)
            chosen.update(hits)
        if missing:
            ends = [e for e in (wire.start, wire.end) if not closed and any(e.distance_to(t) <= vtol for t in missing)]
            if ends:
                raise ModelingError(f"fillet: {_fp(ends[0])} is an end of the open wire, not a corner")
            corners_at = [_fp(edges[i].end) for i in joints]
            more = ", ..." if len(corners_at) > 12 else ""
            listed = f"its corners are at {', '.join(corners_at[:12])}{more}" if corners_at else "it has no corners"
            raise ModelingError(f"fillet: {', '.join(_fp(t) for t in missing)} {'is' if len(missing) == 1 else 'are'} "
                                f"not a corner of the wire; {listed}")
    named = vertices is not None
    hint = "" if named else f"; name the corners to round: wire.fillet({fmt(radius)}, [corner points])"
    try:
        fr = wire_frame(edges, None, "fillet")
    except ValueError:
        fr = None  # not planar (or straight)

    if fr is not None:
        segs = [seg_of_edge(e, fr) for e in edges]
        tol = 1e-9 * max(1.0, real_size(segs))
        corners: dict[int, Corner] = {}
        for i in sorted(chosen):
            j = (i + 1) % n
            s1, s2 = segs[i], segs[j]
            if n == 1 or is_smooth(s1, s2):
                if named:
                    raise ModelingError(f"fillet: the corner at {fr.fp(s2.start)} is smooth (its edges meet "
                                        f"tangentially), so there is nothing to round; leave it out")
                continue
            corners[j] = Corner("fillet", radius, f"radius {fmt(radius)}")
        if not corners:
            return Wire._raw(edges)
        try:
            new, _ = assemble(segs, [""] * n, corners, closed, tol, what=lambda j: describe(segs[j], fr.fp), fp=fr.fp,
                              curves=CurveCorners(fr, real_size(segs)))
        except GeometryError as e:
            raise ValueError(f"fillet: {e}") from None
        kept = {id(sg): e for sg, e in zip(segs, edges)}
        out = [kept[id(sg)] if id(sg) in kept else Edge._from_curve(curve_of(sg, fr)) for sg in new]
        if closed and 0 in corners:
            out = out[1:] + out[:1]  # (the wire starts where it did: the arc of the corner at its start goes last)
        return Wire._raw(out)

    # A wire that is not planar: corners between lines, each in the plane of its two lines.
    corner_list = []  # (index of incoming edge, index of outgoing edge)
    for i in sorted(chosen):
        j = (i + 1) % n
        a, b = edges[i], edges[j]
        u, w = a.tangent_at(1.0), b.tangent_at(0.0)
        if u.cross(w).length < 1e-9 and u.dot(w) > 0:
            if named:
                raise ModelingError(f"fillet: the corner at {_fp(a.end)} is smooth (its edges meet tangentially), so "
                                    f"there is nothing to round; leave it out")
            continue
        if not a._is_straight() or not b._is_straight():
            other = a if not a._is_straight() else b
            raise ModelingError(f"fillet: the corner at {_fp(a.end)} joins a {other.geom_type} edge of a wire that is "
                                f"not planar; fillet rounds the corners of such wires between lines only{hint}")
        if u.is_parallel(w):
            raise ModelingError(f"fillet: the wire turns back on itself at {_fp(a.end)}, so there is no corner to "
                                f"round")
        corner_list.append((i, j))

    # Each rounded corner moves the end of its incoming and the start of its outgoing line.
    setback_end = [0.0] * n
    setback_start = [0.0] * n
    arcs: dict[int, Edge] = {}
    for i, j in corner_list:
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


def make_compatible(*edges: Edge | Iterable[Edge]) -> list[Edge]:
    """Copies of the curves as B-splines of one degree and one knot vector, with the same shapes:
    their control points correspond one to one, as surfaces through the curves (a loft, a skin)
    need them in other systems. Lines and arcs become B-splines too (arcs rational ones).

    Args:
        edges: Two or more edges (or lists of them).
    """
    flat: list[Edge] = []
    for e in edges:
        flat.extend([e] if isinstance(e, (Edge, Shape)) else list(e))
    for e in flat:
        if not isinstance(e, Edge):
            hint = " (pass wire.edges())" if isinstance(e, Wire) else ""
            raise TypeError(f"make_compatible takes edges, not a {type(e).__name__}{hint}")
    if len(flat) < 2:
        raise ValueError(f"make_compatible needs two or more edges, got {len(flat)}")
    curves = []
    try:
        for e in flat:  # every curve a B-spline of its own (a line or an arc is one of its own kind)
            c = e._copy_curve()
            if ext.curve_kind(c) != "bspline":
                d = ext.curve_data(c, True)
                ext.delete_curve(c)
                c = _canonical_curve(np.asarray(d["poles"], dtype=float), d["knots"], d["degree"], d["weights"])
            curves.append(c)
        with kernel_call("make_compatible"):
            k.make_curves_compatible(curves)
    except BaseException:
        for c in curves:
            ext.delete_curve(c)
        raise
    return [Edge._from_curve(c) for c in curves]
