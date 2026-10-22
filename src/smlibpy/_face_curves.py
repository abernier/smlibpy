"""Curves on faces: the parts of a projection seen from the curve (``Part.project(...,
nearest=True)``) and drawings wrapped onto faces (``Face.wrap``).

A projection onto a body along a direction (SmBrep::CreateParallelProjectionCurves) gives pieces on
every face the direction meets: the near side, the far side and faces seen edge-on. The near ones
are what a light along the direction from the curve paints: a point of a piece counts where the
ray from its point of the curve meets the body there first. Pieces are cut where that changes.

A wrapped drawing keeps its lengths along the two parameter lines of the face through the point it
is placed at: x is the length along one, y along the other. On planes, cylinders and other faces
whose parameter lines keep their lengths everywhere (as a label on a can) the drawing keeps all its
lengths; on a cone or a doubly curved face only along those two lines. The face's own parameters
are not used as lengths: on analytic faces they are those of the surface's NURBS form, whose speed
varies (SmSurface::LiftCurve of a line of a cylinder's parameter plane is no helix: 0.16 off).
"""

from __future__ import annotations

import bisect
from typing import Any, Sequence

import numpy as np

from ._kernel import ModelingError, ext, k, kernel_call
from .geometry import Vector, VectorLike, _vec
from .shapes import Edge, Face, ShapeList, Vertex, _Body

# -----------------------------------------------------------------------------
# what the projection reaches first
# -----------------------------------------------------------------------------
_SAMPLES = 17


def visible_pieces(body: _Body, source: Edge, pieces: Sequence[tuple[Edge, Face]], d: Vector,
                   size: float) -> list[Edge]:
    """The parts of projected pieces (each with its face) that the projection of ``source`` along
    ``d`` reaches first."""
    from .curves import Line

    tol = 1e-6 * size
    reach = 4.0 * size

    def seen(q: Vector, face: Face) -> bool:
        if abs(face.normal_at(q).dot(d)) < 1e-9:  # a face seen edge-on there gets nothing
            return False
        back = Line(q + d * tol, q - d * reach)
        ss = [(q - c).dot(d) for c in source.intersections(back, tolerance=10 * tol)]
        ss = [s for s in ss if s >= -10 * tol]
        if not ss:
            return True  # (where the point came from is not found: kept)
        s = min(ss)
        c = q - d * s
        return not any(h.distance < s - 10 * tol for h in body.raycast(c, d))

    out: list[Edge] = []
    for e, face in pieces:
        fs = [(i + 0.5) / _SAMPLES for i in range(_SAMPLES)]
        vis = [seen(e.point_at(f), face) for f in fs]
        if all(vis):
            out.append(e)
            continue
        if not any(vis):
            continue
        cuts, states = [0.0], [vis[0]]
        for i in range(_SAMPLES - 1):
            if vis[i] != vis[i + 1]:
                a, b = fs[i], fs[i + 1]
                for _ in range(40):
                    m = (a + b) / 2
                    if seen(e.point_at(m), face) == vis[i]:
                        a = m
                    else:
                        b = m
                cuts.append((a + b) / 2)
                states.append(vis[i + 1])
        cuts.append(1.0)
        for f0, f1, state in zip(cuts, cuts[1:], states):
            if state and f1 - f0 > 1e-9:
                out.append(e if (f0, f1) == (0.0, 1.0) else e.trim(f0, f1))
    return out


# -----------------------------------------------------------------------------
# wrapping
# -----------------------------------------------------------------------------
_GAUSS = [(-0.9061798459386640, 0.2369268850561891), (-0.5384693101056831, 0.4786286704993665),
          (0.0, 0.5688888888888889), (0.5384693101056831, 0.4786286704993665),
          (0.9061798459386640, 0.2369268850561891)]


def _derivatives(srf: Any, uv: Sequence[tuple[float, float]]) -> dict[str, np.ndarray]:
    return ext.surface_derivatives(srf, np.array(uv, dtype=float).reshape(-1, 2))


class _ArcMap:
    """Length along a parameter line of a surface: the parameter at a length from a start (cubic
    Hermite in the length between 512 nodes; the lengths by 5-point Gauss per interval)."""

    def __init__(self, srf: Any, along_u: bool, fixed: float, lo: float, hi: float, start: float, closed: bool):
        n = 512
        self.t = [lo + (hi - lo) * i / n for i in range(n + 1)]
        uv = []
        for i in range(n):
            a, b = self.t[i], self.t[i + 1]
            for x, _ in _GAUSS:
                t = (a + b) / 2 + (b - a) / 2 * x
                uv.append((t, fixed) if along_u else (fixed, t))
        nodes = [(t, fixed) if along_u else (fixed, t) for t in self.t]
        key = "du" if along_u else "dv"
        speeds = np.linalg.norm(_derivatives(srf, uv)[key], axis=1)
        self.speed = [float(s) for s in np.linalg.norm(_derivatives(srf, nodes)[key], axis=1)]
        self.length = [0.0]
        for i in range(n):
            h = (self.t[i + 1] - self.t[i]) / 2
            s = sum(w * float(speeds[5 * i + j]) for j, (_, w) in enumerate(_GAUSS))
            self.length.append(self.length[-1] + h * s)
        self.srf, self.along_u, self.fixed, self.lo, self.hi, self.closed = srf, along_u, fixed, lo, hi, closed
        self.total = self.length[-1]
        self.s0 = self._length_at(start)

    def _length_at(self, t: float) -> float:
        i = min(max(bisect.bisect_right(self.t, t) - 1, 0), len(self.t) - 2)
        a = self.t[i]
        if t <= a:
            return self.length[i]
        ps = [(a + t) / 2 + (t - a) / 2 * x for x, _ in _GAUSS]
        uv = [(p, self.fixed) if self.along_u else (self.fixed, p) for p in ps]
        sp = np.linalg.norm(_derivatives(self.srf, uv)["du" if self.along_u else "dv"], axis=1)
        return self.length[i] + (t - a) / 2 * sum(w * float(s) for (_, w), s in zip(_GAUSS, sp))

    def param(self, s: float) -> float | None:
        """The parameter at length ``s`` from the start (negative: back), None off the surface."""
        L = self.s0 + s
        if self.closed and self.total > 0:
            L %= self.total
        elif L < -1e-9 * max(1.0, self.total) or L > self.total * (1 + 1e-12) + 1e-9:
            return None
        L = min(max(L, 0.0), self.total)
        i = min(max(bisect.bisect_right(self.length, L) - 1, 0), len(self.length) - 2)
        L0, L1 = self.length[i], self.length[i + 1]
        t0, t1 = self.t[i], self.t[i + 1]
        h = L1 - L0
        if h <= 0:
            return t0
        x = (L - L0) / h
        s0, s1 = self.speed[i], self.speed[i + 1]
        if s0 <= 1e-12 * h or s1 <= 1e-12 * h:  # (a pole of the surface: linear there)
            return t0 + (t1 - t0) * x
        m0, m1 = h / s0, h / s1  # dt/dL, scaled to the interval
        h00, h10 = 2 * x ** 3 - 3 * x ** 2 + 1, x ** 3 - 2 * x ** 2 + x
        h01, h11 = -2 * x ** 3 + 3 * x ** 2, x ** 3 - x ** 2
        return h00 * t0 + h10 * m0 + h01 * t1 + h11 * m1


def _closed(srf: Any, along_u: bool, lo: float, hi: float, other_lo: float, other_hi: float, tol: float) -> bool:
    """Whether the surface meets itself across the parameter range (a cylinder around)."""
    uv = []
    for j in range(5):
        o = other_lo + (other_hi - other_lo) * j / 4
        uv += [(lo, o), (hi, o)] if along_u else [(o, lo), (o, hi)]
    p = _derivatives(srf, uv)["point"]
    return all(float(np.linalg.norm(p[2 * j] - p[2 * j + 1])) <= tol for j in range(5))


def wrap(face: Face, shape: Any, at: VectorLike | Vertex | None, direction: VectorLike | None) -> ShapeList[Edge]:
    """The edges of a drawing on XY wrapped onto the face (see :meth:`Face.wrap`)."""
    if isinstance(shape, Edge):
        edges = [shape]
    elif hasattr(shape, "edges"):
        edges = list(shape.edges())
    else:
        edges = [x for it in shape for x in ([it] if isinstance(it, Edge) else getattr(it, "edges", lambda: [it])())]
    if not edges or not all(isinstance(e, Edge) for e in edges):
        raise TypeError(f"wrap takes an edge, a wire, a sketch or a list of edges, not {type(shape).__name__}")
    f = face._f
    srf = f.surface()
    (u0, v0), (u1, v1) = f.uv_domain()
    size = max(1.0, face.bbox().diagonal)
    tol = 1e-7 * size
    if at is None:  # (the middle of the face's parameters: on its surface, maybe in a hole)
        ua, va = (u0 + u1) / 2, (v0 + v1) / 2
    else:
        p = _vec(at.point if isinstance(at, Vertex) else at)
        q, uvs, _ = k.surface_closest_point(srf, p.to_tuple())
        off = Vector(q.x, q.y, q.z).distance_to(p)
        if off > 1e-6 * size:
            raise ValueError(f"wrap: at must be a point of the face's surface; ({p.x:g}, {p.y:g}, {p.z:g}) is "
                             f"{off:.6g} from it")
        ua, va = uvs[0].x, uvs[0].y
    der = _derivatives(srf, [(ua, va)])
    su, sv = Vector(*der["du"][0]), Vector(*der["dv"][0])
    n = Vector(f.outward_normal_at_uv(ua, va))
    if su.length <= 1e-12 or sv.length <= 1e-12:
        raise ModelingError("wrap: the face has no directions at that point (a pole of its surface); place the "
                            "drawing elsewhere with at=")
    dd = su if direction is None else _vec(direction)
    dt = dd - n * dd.dot(n)
    if dt.length <= 1e-9 * dd.length:
        raise ValueError("wrap: the direction is normal to the face there; give a direction along the face")
    x_along_u = abs(dt.dot(su.normalized())) >= abs(dt.dot(sv.normalized()))
    sx = 1.0 if dt.dot(su if x_along_u else sv) > 0 else -1.0
    ex, ey = (su, sv) if x_along_u else (sv, su)
    sy = 1.0 if (ex * sx).cross(ey).dot(n) > 0 else -1.0  # (seen from outside: x right, y up)
    closed_u = _closed(srf, True, u0, u1, v0, v1, 1e-9 * size)
    closed_v = _closed(srf, False, v0, v1, u0, u1, 1e-9 * size)
    mu = _ArcMap(srf, True, va, u0, u1, ua, closed_u)
    mv = _ArcMap(srf, False, ua, v0, v1, va, closed_v)

    def mapped(xs: Sequence[float], ys: Sequence[float]) -> tuple[np.ndarray, list[bool]]:
        uv, ok = [], []
        for x, y in zip(xs, ys):
            a, b = (mu.param(sx * x), mv.param(sy * y)) if x_along_u else (mu.param(sy * y), mv.param(sx * x))
            ok.append(a is not None and b is not None)
            uv.append((a if a is not None else ua, b if b is not None else va))
        return _derivatives(srf, uv)["point"], ok

    out = ShapeList()
    for e in edges:
        for w in _wrapped_edge(e, mapped, tol):
            with kernel_call("Face.wrap"):
                pieces = ext.trim_to_face(f, [w._curve()], 100 * tol)
            out.extend(Edge._from_curve(c) for c in pieces)
    return out


def _wrapped_edge(e: Edge, mapped: Any, tol: float) -> list[Edge]:
    """Curves through the mapped points of an edge (split where it leaves the surface, the ends of
    each part on the surface's border), each within ``tol`` of the mapping: cubic interpolation
    through samples, twice as many until the middles between them are within the tolerance."""
    from .curves import _interpolate

    curve = e._curve()
    t0, t1 = e._range()
    if e._rev:
        t0, t1 = t1, t0

    def points(ts: Sequence[float]) -> tuple[np.ndarray, list[bool]]:
        qs = [curve.evaluate(t) for t in ts]
        return mapped([q[0] for q in qs], [q[1] for q in qs])

    def border(good: float, bad: float) -> float:
        for _ in range(50):
            m = (good + bad) / 2
            if points([m])[1][0]:
                good = m
            else:
                bad = m
        return good

    n = 16
    while True:
        ts = [t0 + (t1 - t0) * i / n for i in range(n + 1)]
        P, ok = points(ts)
        runs: list[list[int]] = []
        for i, good in enumerate(ok):
            if good and runs and runs[-1][-1] == i - 1:
                runs[-1].append(i)
            elif good:
                runs.append([i])
        parts: list[tuple[list[float], list[np.ndarray]]] = []  # (parameters, points) of each part on the surface
        for run in runs:
            us = [ts[i] for i in run]
            ps = [P[i] for i in run]
            if run[0] > 0:
                u = border(ts[run[0]], ts[run[0] - 1])
                us.insert(0, u)
                ps.insert(0, points([u])[0][0])
            if run[-1] < n:
                u = border(ts[run[-1]], ts[run[-1] + 1])
                us.append(u)
                ps.append(points([u])[0][0])
            keep = [0] + [i for i in range(1, len(ps)) if float(np.linalg.norm(ps[i] - ps[i - 1])) > 1e-3 * tol]
            us, ps = [us[i] for i in keep], [ps[i] for i in keep]
            if len(ps) >= 2:
                parts.append((us, ps))
        out: list[Edge] = []
        worst = 0.0
        for us, ps in parts:
            with kernel_call("Face.wrap"):
                c = _interpolate([Vector(*q) for q in ps], None, None, False) if len(ps) > 2 else \
                    Edge._from_curve(k.create_line_segment(tuple(ps[0]), tuple(ps[1])))
            out.append(c)
            mids = [(a + b) / 2 for a, b in zip(us, us[1:])]
            Q, okm = points(mids)
            for q, good in zip(Q, okm):
                if good:
                    worst = max(worst, c.distance_to(Vector(*q)))
        if worst <= tol:
            return out
        if n >= 4096:
            raise ModelingError(f"wrap: the wrapped curve comes no closer than {worst:.3g} to the face's mapping of "
                                f"{e!r}")
        n *= 2
