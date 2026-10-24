"""Operations as functions.

Each function is also available as a method (``extrude(sketch, 5)`` is
``sketch.extrude(5)``). The functions read naturally when the target is implied
by a selection: ``fillet(part.edges().parallel_to(Z), 2)`` returns the filleted part
the edges belong to.
"""

from __future__ import annotations

import math
import numbers
import warnings
from typing import Any, Callable, Literal, Sequence, TypeVar, overload

import numpy as np

from ._kernel import BrepHandle, KernelError, ModelingError, _traced, ext, k, kernel_call
from .geometry import Axis, Plane, Vector, VectorLike, Z, _direction, _vec
from .shapes import (Edge, Face, Part, Shape, ShapeList, Shell, Sketch, Vertex, Wire, _analytic_revolve, _as_plane,
                     _flatten_edges, _flatten_faces, _freed, _require_solid, _revolve_axis_angle)

__all__ = [
    "extrude",
    "revolve",
    "loft",
    "sweep",
    "swing",
    "fillet",
    "chamfer",
    "shell",
    "offset",
    "mirror",
    "split",
    "merge",
    "section",
    "thicken",
]


def _as_sketch(profile: Any) -> Sketch:
    if isinstance(profile, Sketch):
        return profile
    if isinstance(profile, Face):
        return profile.to_sketch()
    if isinstance(profile, ShapeList):
        return _as_sketch(profile.one())
    if isinstance(profile, (Wire, Edge)):
        w = profile if isinstance(profile, Wire) else Wire([profile])
        return w.to_sketch()
    raise TypeError(f"expected a sketch, face or closed wire, got {type(profile).__name__}")


def _open_curve(profile: Any) -> Wire | None:
    """The profile as a wire if it is an open curve (which makes surfaces, not solids)."""
    if isinstance(profile, ShapeList) and profile and all(isinstance(e, Edge) for e in profile):
        profile = Wire(list(profile))
    if isinstance(profile, Edge):
        return None if profile.is_closed else Wire([profile])
    if isinstance(profile, Wire):
        return None if profile.is_closed else profile
    return None


def _curve_direction(w: Wire) -> Vector:
    pts = [w.point_at(i / 16) for i in range(17)]
    import numpy as np

    a = np.array([p.to_tuple() for p in pts])
    a = a - a.mean(axis=0)
    _, sv, vt = np.linalg.svd(a)
    if sv[1] > 1e-9 * max(1.0, sv[0]):
        n = Vector(vt[2])
        return n if n.z >= 0 else -n
    return Vector(0, 0, 1)


_S = TypeVar("_S", bound=Shape)


# (the overloads tell type checkers what a sketch or face gives: a Part; smlibwasm's TypeScript has
# the same)
@overload
def extrude(profile: Sketch | Face, amount: float, *, both: bool = ..., taper: float = ...,
            direction: Axis | VectorLike | None = ..., corners: str = ...) -> Part: ...
@overload
def extrude(profile: Sketch | Face | Wire | Edge, amount: float, *, both: bool = ..., taper: float = ...,
            direction: Axis | VectorLike | None = ..., corners: str = ...) -> Part | Shell: ...
def extrude(profile: Sketch | Face | Wire | Edge, amount: float, *, both: bool = False, taper: float = 0.0,
            direction: Axis | VectorLike | None = None, corners: str = "sharp") -> Part | Shell:
    """Extrude a sketch, a planar face or a closed wire into a solid (see :meth:`Sketch.extrude`).

    An open curve extrudes into a surface (a :class:`Shell`), along ``direction`` (an axis or a
    vector) or the normal of the curve's plane; it takes no ``taper`` (``ValueError``).
    """
    w = _open_curve(profile)
    if w is not None:
        if taper:
            # (it was ignored before 0.5.0)
            raise ValueError("extrude: an open curve extrudes into a surface without a taper; taper= needs a region "
                             "(a sketch, a planar face or a closed wire)")
        d = _direction(direction, "extrude") if direction is not None else _curve_direction(w)
        if both:
            w = w.translate(-d * abs(amount))
            amount = 2 * abs(amount)
        sign = 1.0 if amount > 0 else -1.0
        with kernel_call("extrude"), _freed(w._copy_curves()) as curves:
            b = k.linear_sweep(curves, (d * sign).to_tuple(), abs(float(amount)), cap_ends=False)
        return Shell._wrap(b)
    return _as_sketch(profile).extrude(amount, both=both, taper=taper, direction=direction, corners=corners)


@overload
def revolve(profile: Sketch | Face, axis: Axis | None = ..., angle: float = ...) -> Part: ...
@overload
def revolve(profile: Sketch | Face | Wire | Edge, axis: Axis | None = ..., angle: float = ...) -> Part | Shell: ...
def revolve(profile: Sketch | Face | Wire | Edge, axis: Axis | None = None, angle: float = 360.0) -> Part | Shell:
    """Revolve a sketch about an axis into a solid (see :meth:`Sketch.revolve`).

    An open curve revolves into a surface of revolution (a :class:`Shell`).
    """
    w = _open_curve(profile)
    if w is not None:
        ax, angle = _revolve_axis_angle(axis if axis is not None else Z, angle)
        with kernel_call("revolve", "the axis must not cross the curve"), _freed(w._copy_curves()) as curves:
            b = k.rotational_sweep(curves, ax.origin.to_tuple(), ax.direction.to_tuple(), float(angle), cap_ends=False)
        return _analytic_revolve(b, Shell)
    return _as_sketch(profile).revolve(axis, angle)


def _section_loops(section: Any) -> tuple[Wire, list[Wire]]:
    """Outer loop and holes of a loft section."""
    if isinstance(section, ShapeList):
        section = section.one()
    if isinstance(section, Sketch):
        faces = section.faces()
        if len(faces) != 1:
            raise ValueError("a loft section must be a single region")
        section = faces[0]
    if isinstance(section, Face):
        loops = section.wires()
        return loops[0], [w.reversed() for w in loops[1:]]  # holes turned like the outline
    if isinstance(section, Wire):
        return section, []
    if isinstance(section, Edge):
        return Wire([section]), []
    raise TypeError(f"cannot loft through a {type(section).__name__}")


def _loft_solid(loops: Sequence[Wire], degree: int, ends: _LoftEnds | None = None) -> Part:
    counts: list[int] = []
    curves: list[Any] = []
    for w in loops:
        c = w._copy_curves()
        curves.extend(c)
        counts.append(len(c))
    hint = "sections should be closed, ordered and not intersect each other"
    if ends is not None:
        with _freed(curves):
            return _require_solid(ends.skin(curves, counts, degree, True, hint), "loft", hint)  # type: ignore[arg-type]
    with kernel_call("loft", hint), _freed(curves):
        b = k.create_skin_primitive(counts, curves, degree, True)
    return _require_solid(Part._wrap(b), "loft", hint)


class _LoftEnds:
    """How a loft meets its ends (``ext.skin``): the directions it leaves the first section in and
    reaches the last in (unit vectors, faces that end there to continue, or None), or closed (from the
    last section on to the first)."""

    __slots__ = ("start", "end", "closed")

    def __init__(self, start: Vector | Face | None, end: Vector | Face | None, closed: bool):
        self.start, self.end, self.closed = start, end, closed

    def degree(self, n: int, ruled: bool, smooth: bool) -> int:
        """The degree of the skin through ``n`` sections: each tangent is one more condition (two
        sections and both tangents: cubic), a closed one runs through n + 1."""
        if ruled:
            return 1
        conditions = n + (1 if self.closed else 0) + (self.start is not None) + (self.end is not None)
        return min(3 if smooth else 2, conditions - 1)

    def skin(self, curves: list[Any], counts: list[int], degree: int, cap: bool, hint: str) -> Part | Shell:
        """The skin through the sections (kernel curves, ``counts`` each), checked: the kernel drops the
        tangents silently where it cannot meet them."""
        start = list(self.start.to_tuple()) if isinstance(self.start, Vector) else []
        end = list(self.end.to_tuple()) if isinstance(self.end, Vector) else []
        start_face = self.start._f if isinstance(self.start, Face) else None
        end_face = self.end._f if isinstance(self.end, Face) else None
        with kernel_call("loft", hint):
            b, d0, d1 = ext.skin(curves, counts, degree, start, end, self.closed, cap, start_face, end_face)
        body = Part._wrap(b) if cap else Shell._wrap(b)
        for which, dev, given in (("leave the first section along start_tangent", d0, self.start),
                                  ("reach the last section along end_tangent", d1, self.end)):
            # (tangent to a face whose direction across the section is no affine map of the point there,
            # a freeform face, the strip follows it at the section's control points only)
            if dev > (_FACE_ANGLE if isinstance(given, Face) else _TANGENT_ANGLE):
                raise ModelingError(f"loft: the kernel cannot {which} (it runs {math.degrees(dev):.3g} degrees off "
                                    "it there); turn the tangent more across the section, or add a section")
        return body


# How far (radians) a loft may run off the asked-for tangent at its ends: a direction, a face.
_TANGENT_ANGLE = 1e-6
_FACE_ANGLE = 1e-3


def _loft_ends(sections: Sequence[Any], start_tangent: Any, end_tangent: Any, closed: bool,
               ruled: bool) -> _LoftEnds | None:
    """The ends ``start_tangent``, ``end_tangent`` and ``closed`` ask for (None for none)."""
    if start_tangent is None and end_tangent is None and not closed:
        return None
    if closed and (start_tangent is not None or end_tangent is not None):
        raise ValueError("loft: a closed loft has no ends; start_tangent and end_tangent need closed=False")
    if closed and len(sections) < 3:
        raise ValueError("loft: a closed loft needs three sections or more")
    if ruled and not closed:
        raise ValueError("loft: a ruled loft runs straight to its ends; start_tangent and end_tangent need "
                         "ruled=False")
    dirs: list[Vector | Face | None] = []
    for name, value, section in (("start_tangent", start_tangent, sections[0]), ("end_tangent", end_tangent,
                                                                                  sections[-1])):
        if value is None:
            dirs.append(None)
            continue
        if isinstance(value, ShapeList) and len(value) == 1 and isinstance(value[0], Face):
            value = value[0]
        if isinstance(value, Face):
            # (the loft continues the face, which ends at the section: the section lies on it)
            loop = _open_curve(section) or _section_loops(section)[0]
            size = max(1.0, loop.bbox().diagonal, value.bbox().diagonal)
            off = max(value.distance_to(loop.point_at(i / 16)) for i in range(17))
            if off > 1e-6 * size:
                raise ValueError(f"loft: {name} is a face the loft continues, so the section must lie on it (where "
                                 f"the face ends); it lies {off:.3g} off the face")
            dirs.append(value)
            continue
        d = _direction(value, f"loft: {name}")
        normal = _section_normal(section)
        if normal is not None and abs(d.dot(normal)) <= 1e-9:
            raise ValueError(f"loft: {name} lies in the plane of the section; it must run across it")
        dirs.append(d)
    return _LoftEnds(dirs[0], dirs[1], closed)


def _section_normal(section: Any) -> Vector | None:
    """The unit normal of a planar section (None where it does not lie in a plane, or is straight)."""
    w = _open_curve(section)
    if w is None:
        w = _section_loops(section)[0]
    pts = np.array([w.point_at(i / 32).to_tuple() for i in range(33)])
    _, sv, vt = np.linalg.svd(pts - pts.mean(axis=0))
    if sv[1] <= 1e-9 * max(1.0, sv[0]) or sv[2] > 1e-9 * max(1.0, sv[0]):
        return None
    return Vector(*vt[2])


@overload
def loft(sections: Sequence[Sketch | Face], *, ruled: bool = ..., smooth: bool = ...,
         start_tangent: Axis | VectorLike | Face | None = ..., end_tangent: Axis | VectorLike | Face | None = ...,
         closed: bool = ..., rails: Edge | Wire | Sequence[Edge | Wire] | None = ...) -> Part: ...
@overload
def loft(sections: Sequence[Sketch | Face | Wire | Edge], *, ruled: bool = ..., smooth: bool = ...,
         start_tangent: Axis | VectorLike | Face | None = ..., end_tangent: Axis | VectorLike | Face | None = ...,
         closed: bool = ..., rails: Edge | Wire | Sequence[Edge | Wire] | None = ...) -> Part | Shell: ...
def loft(sections: Sequence[Sketch | Face | Wire | Edge], *, ruled: bool = False, smooth: bool = True,
         start_tangent: Axis | VectorLike | Face | None = None, end_tangent: Axis | VectorLike | Face | None = None,
         closed: bool = False, rails: Edge | Wire | Sequence[Edge | Wire] | None = None) -> Part | Shell:
    """A solid through a sequence of cross sections, or a surface through open curves.

    ``start_tangent`` and ``end_tangent`` set the direction the loft leaves its first section in and
    reaches its last in, so that it meets the bodies there smoothly; a face there (one that ends at
    the section) makes the loft continue it::

        neck = loft([Circle(10), Circle(4).moved(Location((0, 0, 30)))], start_tangent=Z, end_tangent=Z)
        cap = loft([top_rim, Circle(4).moved(Location((0, 0, 30)))], start_tangent=can.faces().cylinders()[0])

    ``rails`` are curves a loft of open sections runs along from its first section to its last,
    through every section (guide curves): the surface passes through them as through the sections::

        panel = loft([s0, s1, s2], rails=[keel, chine])

    Args:
        sections: Two or more sections in order: sketches, planar faces or closed wires
            for a solid; open edges or wires for a surface (a :class:`Shell`). Sections
            with holes make a hollow solid; every section needs the same number of holes.
        ruled: Straight transitions between neighbouring sections.
        smooth: With four or more sections, pass through them with a cubic surface
            (``False``: quadratic). Three sections always give a quadratic one.
        start_tangent: The direction (an axis or a vector) the loft leaves the first section in:
            across it, usually along its normal (``Z`` for a section in the XY plane, as an extrusion
            of it leaves it). Only the direction counts. The loft is cubic then. Or a face that ends
            at the first section (the section lies on it, usually along its edge): the loft leaves the
            section continuing the face, tangent to it all along the section (within 1e-6 radians
            where the face is a plane, a cylinder, a cone or a sphere about the section, 1e-3 on others).
        end_tangent: The direction the loft reaches the last section in, or a face that ends at the
            last section, which the loft runs into tangentially.
        closed: Run on from the last section through the first again, smoothly (three sections or
            more): a ring without ends.
        rails: A curve (an edge or a wire) or a list of them that run from the first section to the
            last and cross every section once, for open sections (a surface): the loft passes through
            them exactly, as through the sections (a Gordon surface through the sections and the
            rails, cubic or as near as the counts allow). Where no rail runs along the sections'
            starts or their ends, the loft's border there runs smoothly through them. Sections and
            rails must be smooth curves (each is joined into one). Not with ``ruled``, the tangents
            or ``closed``; closed sections along rails are not supported.
    """
    if len(sections) < 2:
        raise ValueError("loft needs at least two sections")
    if rails is not None:
        if ruled or closed or start_tangent is not None or end_tangent is not None:
            raise ValueError("loft: rails= makes the loft run through the rails; it takes no ruled=, closed=, "
                             "start_tangent= or end_tangent=")
        return _rail_loft(sections, rails)
    ends = _loft_ends(sections, start_tangent, end_tangent, closed, ruled)
    opened = [_open_curve(s) for s in sections]
    if all(w is not None for w in opened) and ends is not None:
        counts = [len(w.edges()) for w in opened]  # type: ignore[union-attr]
        curves = [c for w in opened for c in w._copy_curves()]  # type: ignore[union-attr]
        with _freed(curves):
            return ends.skin(curves, counts, ends.degree(len(sections), ruled, smooth), False,
                             "curves should run in the same direction")
    if all(w is not None for w in opened):
        # One skin for single curves and chains alike, so that ruled and smooth hold for both
        # (the kernel's skin surface has no degree). With the default degree it is the same
        # surface as that skin.
        counts = [len(w.edges()) for w in opened]  # type: ignore[union-attr]
        curves = [c for w in opened for c in w._copy_curves()]  # type: ignore[union-attr]
        degree = 1 if ruled else min(3 if smooth else 2, len(sections) - 1)
        try:
            with kernel_call("loft", "curves should run in the same direction"):
                return Shell._wrap(k.create_skin_primitive(counts, curves, degree, False))
        finally:
            for c in curves:
                ext.delete_curve(c)
    if any(w is not None for w in opened):
        raise ValueError("loft sections must be all closed (solid) or all open (surface)")
    loops = [_section_loops(s) for s in sections]
    degree = 1 if ruled else min(3 if smooth else 2, len(sections) - 1)
    if ends is not None:
        degree = ends.degree(len(sections), ruled, smooth)
    result = _loft_solid([outer for outer, _ in loops], degree, ends)
    holes = [h for _, h in loops]
    if any(holes):
        if len({len(h) for h in holes}) != 1:
            raise ValueError("loft: every section needs the same number of holes (a hole runs through the "
                             "whole loft)")
        for first in holes[0]:
            chain = [first]
            for hs in holes[1:]:  # the hole of the next section nearest to this one
                c = chain[-1].center()
                chain.append(min(hs, key=lambda w: w.center().distance_to(c)))
            result = result - _loft_solid(chain, degree, ends)
    return result


# -- lofts along rails and two-rail sweeps (Gordon surfaces) -----------------------------------------
# The kernel's own rails (SmBSplineSurface::CreateSkinnedSurface) need as many sections as the rails
# have control points, and its two-rail sweep (CreateSweepSurface) misses its rails (0.31 with its
# default 4 control points between profiles, 1.6e-4 with 1024). A Gordon surface (NLib's
# N_CreateGordonSrf) passes through a whole network of curves: the sections one way, the rails the
# other. It is open both ways: through closed sections it had a crease where they are joined round
# (22 degrees), so rails take open sections (surfaces) only.
def _one_edge(x: Any, what: str) -> Edge:
    """An edge, or a wire (or the outline of a sketch or face) joined into one edge."""
    if isinstance(x, ShapeList):
        x = x.one() if len(x) == 1 else Wire(list(x))
    if isinstance(x, (Sketch, Face)):
        x = _section_loops(x)[0]
    if isinstance(x, Wire):
        return x.to_edge()
    if isinstance(x, Edge):
        return x
    raise TypeError(f"{what} is an edge or a wire, got {type(x).__name__}")


def _crossed_at(a: Edge, b: Edge, tol: float, what: str) -> float:
    """The fraction of ``a``'s length where ``b`` crosses it (the one crossing; ValueError where there
    is none)."""
    params = a.intersection_params(b, tolerance=tol)
    if not params:
        raise ValueError(f"{what}: the curves do not cross (within {tol:.3g})")
    return float(params[0])


# How close (a fraction of the network's size) the curves a Gordon surface is made of follow the
# sections and rails, and how far they may stay off (a corner in a section or a rail: no smooth
# curve follows it).
_NETWORK_FIT = 1e-8
_NETWORK_OFF = 1e-6


def _reparametrized(edges: list[Edge], marks: list[list[float]], targets: list[float], size: float,
                    what: str) -> list[Any]:
    """Cubic B-splines (kernel curves, parameters 0 to 1, one knot vector for all) along the edges, each
    at its edge's fraction ``marks[e][k]`` of its length at the parameter ``targets[k]`` (both
    increasing, from 0 to 1), smoothly between (a monotone cubic of the parameter): fitted through
    points at common parameters, more of them until each is within 1e-8 of ``size`` of its edge
    (ModelingError where 512 leave one more than 1e-6 of it off: a corner)."""
    from .curves import _basis
    from .shapes import _canonical_curve

    maps = [_monotone_cubic(list(zip(targets, m))) for m in marks]  # (parameter -> fraction)
    n = 32
    while True:
        ts = [i / n for i in range(n + 1)]
        knots = np.array([0.0] * 4 + [sum(ts[j + 1:j + 4]) / 3 for j in range(len(ts) - 4)] + [1.0] * 4)
        a = np.array([_basis(knots, 3, t) for t in ts])
        mids = [np.array(_basis(knots, 3, 0.5 * (ts[k_] + ts[k_ + 1]))) for k_ in range(n)]
        poles, worst = [], 0.0
        for e, f in zip(edges, maps):
            q = np.array([e.point_at(min(1.0, max(0.0, f(t)))).to_tuple() for t in ts])
            p = np.linalg.solve(a, q)
            poles.append(p)
            for k_ in range(n):
                g = min(1.0, max(0.0, f(0.5 * (ts[k_] + ts[k_ + 1]))))
                worst = max(worst, float(np.linalg.norm(mids[k_] @ p - np.array(e.point_at(g).to_tuple()))))
        if worst <= _NETWORK_FIT * size or n >= 512:
            break
        n *= 2
    if worst > _NETWORK_OFF * size:
        raise ModelingError(f"{what}: the sections and rails must be smooth curves; a smooth curve stays "
                            f"{worst:.3g} off one of them (a corner: loft the parts between corners on their own)")
    out: list[Any] = []
    with kernel_call(what):
        try:
            for p in poles:
                out.append(_canonical_curve(p, list(knots), 3, None))
        except BaseException:
            for c in out:
                ext.delete_curve(c)
            raise
    return out


def _gordon(us: list[Edge], vs: list[Edge], size: float, what: str,
            v_marks: list[list[float]] | None = None) -> Shell:
    """The sheet through a network of curves (``ext.gordon``): the sections ``us`` one way and the rails
    ``vs`` the other, the first and last of each its borders, every section crossing every rail once
    (``v_marks``: where, as fractions of each rail's length, where known). The curves are made to cross
    at common parameters first: section i at the same parameter of every rail, rail j at the same of
    every section (their means; smoothly between). The kernel's own adjustment (CreateGordonSurface)
    left a rail 0.29 off the surface between sections."""
    tol = 1e-6 * size

    def marks(a: Edge, others: list[Edge]) -> list[float]:
        return [0.0 if j == 0 else 1.0 if j == len(others) - 1 else
                _crossed_at(a, b, tol, f"{what}: a section and a rail") for j, b in enumerate(others)]

    u_marks = [marks(u, vs) for u in us]  # (where each section crosses the rails)
    if v_marks is None:
        v_marks = [marks(v, us) for v in vs]  # (where each rail crosses the sections)
    for name, ms in (("rails along a section", u_marks), ("sections along a rail", v_marks)):
        if any(any(not b > a for a, b in zip(m, m[1:])) for m in ms):
            raise ValueError(f"{what}: the {name} must follow each other in the same order on every one")
    u_at = [sum(m[j] for m in u_marks) / len(us) for j in range(len(vs))]
    v_at = [sum(m[i] for m in v_marks) / len(vs) for i in range(len(us))]
    curves_u = _reparametrized(us, u_marks, u_at, size, what)
    with _freed(curves_u):
        curves_v = _reparametrized(vs, v_marks, v_at, size, what)
        with _freed(curves_v), kernel_call(what, "every section must cross every rail once, and the sections and "
                                           "rails must run in order"):
            return Shell._wrap(ext.gordon(curves_u, v_at, curves_v, u_at))


def _rail_loft(sections: Sequence[Any], rails: Any) -> Shell:
    """:func:`loft` along ``rails``: a Gordon surface through the open sections and the rails."""
    from .curves import Spline

    rails = [rails] if isinstance(rails, (Edge, Wire)) else list(rails)
    if not rails:
        raise ValueError("loft: rails= needs one curve or more")
    opened = [_open_curve(s) for s in sections]
    if not all(w is not None for w in opened):
        raise ValueError("loft: rails= takes open sections (edges or wires: a surface through them and the rails); "
                         "closed sections along rails are not supported")
    secs = [_one_edge(w, "a section") for w in opened]
    rs = [_one_edge(r, "a rail") for r in rails]
    size = max(1.0, *(e.bbox().diagonal for e in secs + rs))
    tol = 1e-6 * size
    # each rail from its crossing with the first section to that with the last (it may run on beyond)
    trimmed = []
    for i, r in enumerate(rs):
        a, b = (_crossed_at(r, sec, tol, f"loft: rail {i + 1} and section {j + 1}")
                for j, sec in ((0, secs[0]), (len(secs) - 1, secs[-1])))
        if a > b:
            r, a, b = r.reversed(), 1.0 - a, 1.0 - b
        for j, sec in enumerate(secs[1:-1], 1):
            _crossed_at(r, sec, tol, f"loft: rail {i + 1} and section {j + 1}")
        trimmed.append(r if a <= 1e-12 and b >= 1 - 1e-12 else r.trim(a, b))
    # the rails in their order across the sections; the borders through the sections' ends where no
    # rail runs along them
    at = [_crossed_at(secs[0], r, tol, f"loft: section 1 and rail {i + 1}") for i, r in enumerate(trimmed)]
    rs = [r for _, r in sorted(zip(at, trimmed), key=lambda x: x[0])]
    at = sorted(at)
    if at[0] > 1e-9:
        rs.insert(0, Spline(*(s.start for s in secs)))
    if at[-1] < 1 - 1e-9:
        rs.append(Spline(*(s.end for s in secs)))
    return _gordon(secs, rs, size, "loft")


# The fewest and most profiles placed along the rails of a two-rail sweep (:func:`_rail_sweep`), and
# how close (a fraction of the size) the surface through them passes the profile placed half way between
# two of them.
_RAIL_PROFILES = (8, 256)
_RAIL_FIT = 1e-6


def _rail_sweep(w: Wire, edges: list[Edge], rails: Any) -> Shell:
    """:func:`sweep` along the path and a second rail (``rails``): the open profile, which runs from the
    path to the rail, moved, turned and scaled (the same in every direction) so that its ends stay on both,
    the frame turning with the line from the path to the rail and the rails' mean direction; the surface
    through it placed at evenly spaced fractions of the rails' lengths (more of them until the profile
    placed half way between two lies on the surface within 1e-6 of the size) and through the two rails."""
    rs = [rails] if isinstance(rails, (Edge, Wire)) else list(rails)
    if len(rs) != 1:
        raise ValueError("sweep: rails= is the second rail, one curve (the path is the first)")
    path = _one_edge(Wire._raw(edges) if len(edges) > 1 else edges[0], "sweep: the path")
    rail = _one_edge(rs[0], "sweep: the rail")
    prof = _one_edge(w, "sweep: the profile")
    size = max(1.0, *(e.bbox().diagonal for e in (path, rail, prof)))
    tol = 1e-6 * size
    if not (path.distance_to(prof.start) <= tol and rail.distance_to(prof.end) <= tol):
        if path.distance_to(prof.end) <= tol and rail.distance_to(prof.start) <= tol:
            prof = prof.reversed()
        else:
            raise ValueError("sweep: with rails= the profile runs from the path to the rail: its start on the path "
                             "and its end on the rail (or the other way round)")
    a, b = path.param_at_point(prof.start), rail.param_at_point(prof.end)
    path = path if a <= 1e-12 else path.trim(a, 1.0)
    rail = rail if b <= 1e-12 else rail.trim(b, 1.0)

    def frame(f: float) -> tuple[np.ndarray, np.ndarray, float]:
        p, q = np.array(path.point_at(f).to_tuple()), np.array(rail.point_at(f).to_tuple())
        chord = q - p
        reach = float(np.linalg.norm(chord))
        m = _unit(path.tangent_at(f).to_tuple()) + _unit(rail.tangent_at(f).to_tuple())
        x = chord / max(reach, 1e-300)
        z = m - np.dot(m, x) * x
        if not reach > tol or not np.linalg.norm(z) > 1e-9:
            raise ValueError(f"sweep: at {f:.4g} of the rails' lengths the path and the rail meet, or the line between "
                             "them runs along them; the rails must stay apart, across the way they run")
        z = _unit(z)
        return np.column_stack([x, np.cross(z, x), z]), p, reach

    axes0, p0, reach0 = frame(0.0)
    local = prof._transformed(_inverse(_placement(axes0, p0)))

    def placed(f: float) -> Edge:
        axes, p, reach = frame(f)
        m = _placement(axes, p)
        m[:3, :3] *= reach / reach0
        return local._transformed(m)

    n = _RAIL_PROFILES[0]
    while True:
        fs = [i / n for i in range(n + 1)]
        sheet = _gordon([placed(f) for f in fs], [path, rail], size, "sweep", [fs, fs])
        face = sheet.faces()[0]
        off = max(face.distance_to(placed((i + 0.5) / n).point_at(j / 8)) for i in range(n) for j in range(1, 8))
        if off <= _RAIL_FIT * size:
            return sheet
        if n >= _RAIL_PROFILES[1]:
            raise ModelingError(f"sweep: the surface along the rails stays {off:.3g} off the profile between the "
                                f"{n + 1} places it was put at; the rails turn too fast for it")
        n *= 2


def _path_edges(path: Any) -> list[Edge]:
    if isinstance(path, Edge):
        return [path]
    if isinstance(path, Wire):
        edges = list(path.edges())
    elif isinstance(path, ShapeList):
        edges = list(Wire(list(path))._edges)
    else:
        raise TypeError(f"a sweep path is an edge or a wire, got {type(path).__name__}")
    for a, b in zip(edges, edges[1:]):
        if not a.end.is_close(b.start, 1e-6 * max(1.0, a.length, b.length)):
            raise ValueError(f"the sweep path is not connected: a gap of {a.end.distance_to(b.start):.4g} "
                             f"between {a!r} and {b!r}")
    return edges


def _oriented_to(sk: Sketch, tangent: Vector) -> Sketch:
    """The sketch turned (by the smallest rotation about its center) to face along ``tangent``."""
    n = sk.plane.z_dir
    if n.dot(tangent) < 0:
        n = -n
    angle = n.angle_to(tangent)
    if angle < 1e-9:
        return sk
    axis = n.cross(tangent).normalized()
    return sk.rotate(Axis(sk.bbox().center, axis), angle)


# -- the frame a profile is swept in ---------------------------------------------------------------
# The kernel moves a profile to the start of the path by the center of the profile's box along the
# world axes. Turned to face along an oblique path, an asymmetric profile has a box along the world
# axes whose center is not its own: a triangle swept along (1, 1, 1) started 1.6667 before the
# path. So the profile is swept in its own frame, in its plane with its box along the axes there,
# along the path brought into that frame, and the body is placed back. Along a path of several
# edges, each piece starts in the frame the piece before ended in (turned at a corner by the
# smallest rotation from one tangent to the next), not turned afresh from the sketch: a rectangle
# turned by 90 degrees at the joints of a 3D path otherwise.
def _unit(v: Any) -> np.ndarray:
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def _turn(a: np.ndarray, b: np.ndarray, axis: np.ndarray | None = None) -> np.ndarray:
    """The rotation (3 x 3) that turns direction a into direction b: the smallest one, or about
    ``axis`` (perpendicular to both) when given, also by half a turn."""
    a, b = _unit(a), _unit(b)
    if axis is None:
        axis = np.cross(a, b)
        if np.linalg.norm(axis) < 1e-12:
            if np.dot(a, b) > 0:
                return np.eye(3)
            axis = np.cross(a, (1.0, 0.0, 0.0) if abs(a[0]) < 0.9 else (0.0, 1.0, 0.0))
    axis = _unit(axis)
    angle = math.atan2(float(np.dot(np.cross(a, b), axis)), float(np.dot(a, b)))
    kx = np.array([[0.0, -axis[2], axis[1]], [axis[2], 0.0, -axis[0]], [-axis[1], axis[0], 0.0]])
    return np.eye(3) + math.sin(angle) * kx + (1.0 - math.cos(angle)) * (kx @ kx)


def _placement(axes: np.ndarray, origin: Any) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = axes
    m[:3, 3] = origin
    return m


def _inverse(m: np.ndarray) -> np.ndarray:
    out = np.eye(4)
    out[:3, :3] = m[:3, :3].T
    out[:3, 3] = -m[:3, :3].T @ m[:3, 3]
    return out


def _tangent(edge: Edge, t: float) -> np.ndarray:
    return _unit(edge.tangent_at(t).to_tuple())


def _profile_frame(sk: Sketch, tangent: np.ndarray, anchor: Any = None) -> tuple[np.ndarray, np.ndarray]:
    """The axes of the profile's plane (x: the world X axis seen in the plane, Y where X is its
    normal; z: the normal, the way the path starts) and the anchor (``anchor=`` of :func:`sweep`): by
    default the center of the profile's box along them (for a sketch in the XY plane, the center of
    its bounding box)."""
    n = _unit(sk.plane.z_dir.to_tuple())
    if np.dot(n, tangent) < 0:
        n = -n
    ref = np.array((1.0, 0.0, 0.0)) if abs(n[0]) < 0.9 else np.array((0.0, 1.0, 0.0))
    x = _unit(ref - np.dot(ref, n) * n)
    axes = np.column_stack([x, np.cross(n, x), n])
    origin = np.array(sk.plane.origin.to_tuple())
    if anchor is not None and not (isinstance(anchor, str) and anchor == "center"):
        p = origin if isinstance(anchor, str) and anchor == "origin" else None
        return axes, _anchor_point(anchor, p, origin, n, sk.bbox().diagonal)
    center = np.array(sk._transformed(_inverse(_placement(axes, origin))).bbox().center.to_tuple())
    center[2] = 0.0
    return axes, origin + axes @ center


def _anchor_point(anchor: Any, given: np.ndarray | None, origin: np.ndarray, normal: np.ndarray, size: float
                  ) -> np.ndarray:
    """The point ``anchor=`` names ('origin': ``given``, the plane's origin; else a point, which must lie
    in the profile's plane through ``origin`` with ``normal``)."""
    if given is None:
        if isinstance(anchor, str):
            raise ValueError(f"sweep: anchor is 'center', 'origin' or a point, got {anchor!r}")
        try:
            given = np.array(Vector(anchor.point if isinstance(anchor, Vertex) else anchor).to_tuple(), dtype=float)
        except (TypeError, ValueError):
            raise TypeError(f"sweep: anchor is 'center', 'origin' or a point, got {type(anchor).__name__}") from None
    off = float(np.dot(given - origin, normal))
    if abs(off) > 1e-6 * max(1.0, size, float(np.linalg.norm(given - origin))):
        raise ValueError(f"sweep: the anchor {_fmt(given)} lies {abs(off):.6g} off the profile's plane; it is a point of "
                         "that plane (the point of the profile that goes on the path)")
    return given - off * normal


# The point of a profile in its own frame that goes on the path (``ext.curve_sweep``'s reference).
_AT_ORIGIN = [0.0, 0.0, 0.0]


def _swept(sk: Sketch | Wire, edge: Edge, placement: np.ndarray, translational: bool, cap: bool = True,
           law: _Law | None = None, span: tuple[float, float] = (0.0, 1.0),
           scale: Callable[[float], float] | None = None) -> Part | Shell:
    """A profile in its own frame (``sk``: in the XY plane, its anchor at the origin; a sketch, or an
    open wire for a surface) swept along an edge, placed by ``placement`` at the edge's start. With
    ``law`` the profile's x axis follows it along the edge, with ``scale`` the profile's scale about its
    anchor (``span``: where the edge lies along the whole path, as fractions of its length; both are
    functions of the fraction)."""
    local = edge._transformed(_inverse(placement))
    s0 = 1.0
    if scale is not None:
        s0 = scale(span[0])
        sk = sk.scale(s0)  # (the kernel's scale law starts at 1)
    curves = ([c for f in sk.faces() for w in f.wires() for c in w._copy_curves()] if isinstance(sk, Sketch)
              else sk._copy_curves())
    path_curve = local._copy_curve()
    hint = "the profile may be too large for the path's curvature"
    try:
        # (the profile's anchor, the origin of its frame, on the path: the kernel put the middle of the box
        # of the profile curves' control points there, a little beside it for arcs that do not span whole
        # quadrants)
        if law is None and scale is None:
            with kernel_call("sweep", hint):
                b = ext.curve_sweep(curves, path_curve, cap, True, False, translational, None, None, _AT_ORIGIN)
        elif law is None:
            grow = scale
            rules = list(_scale_curves(path_curve, span, lambda f: grow(f) / s0))
            with _freed(rules), kernel_call("sweep", hint):
                b = ext.curve_sweep(curves, path_curve, cap, True, False, translational, rules[0], rules[1], _AT_ORIGIN)
        else:
            ts, xs = law.axes(path_curve, placement, span)
            scales = [] if scale is None else [scale(f) / s0 for f in _fractions(path_curve, ts, span)]
            with kernel_call("sweep", hint):
                b = ext.oriented_sweep(curves, path_curve, ts, xs.ravel().tolist(), cap, scales)
    finally:
        ext.delete_curve(path_curve)
        for c in curves:
            ext.delete_curve(c)
    body = Part._wrap(b) if cap else Shell._wrap(b)
    return body._transformed(placement)


# -- the profile's attitude along the path (up=, twist=, helices) ----------------------------------
# The kernel's sweep carries its frame along the path from one point to the next by the smallest turn
# (a rotation-minimizing frame): along a planar path the profile keeps its attitude to the plane, but
# along a helix it rolls about the path by some 30 degrees a turn (ai/todo/features.md, 10). A frame
# law gives the profile's x axis at every point instead (`ext.oriented_sweep`): kept at its angle to
# `up` (the component of `up` across the path), to the path's principal normal ('frenet'), or carried
# by the smallest turn as the kernel does, each turned on by `twist` along the path's length. Along a
# helix the default is its axis as `up`.
class _Law:
    """How the profile's x axis runs along a path: ``mode`` 'up' (at a fixed angle to ``up`` made
    perpendicular to the path), 'frenet' (to the principal normal) or 'rmf' (carried by the smallest
    turn), turned on by ``twist(s)`` radians at the fraction ``s`` of the path's length. ``explicit``:
    asked for (an implicit law, a helix's axis, falls back to the kernel's frame)."""

    __slots__ = ("mode", "up", "twist", "explicit", "theta0", "end_x", "closing")

    def __init__(self, mode: str, up: np.ndarray | None, twist: Any, explicit: bool, closing: bool = False):
        self.mode, self.up, self.twist, self.explicit = mode, up, twist, explicit
        self.closing = closing  # (an implicit law that makes the profile meet itself round a loop with corners)
        self.theta0: float | None = None  # ('up', 'frenet') the profile's angle to the base direction
        self.end_x: np.ndarray | None = None  # (world) the x axis where the last piece swept ended

    def _base(self, d: list[np.ndarray], tangent: np.ndarray, up: np.ndarray | None, size: float,
              place: np.ndarray | None = None) -> np.ndarray:
        """The base direction (across the path) at a point of it: ``d`` the point and its first two
        derivatives, ``up`` in the same frame, ``size`` the path's (``place``: the frame's placement in
        the world, for messages)."""
        where = _fmt(d[0] if place is None else place[:3, :3] @ d[0] + place[:3, 3])
        if self.mode == "up":
            b = up - np.dot(up, tangent) * tangent  # type: ignore[operator]
            if not np.linalg.norm(b) > 1e-9:
                raise ValueError(f"sweep: the path runs along up= at {where}; the profile's attitude to it is not "
                                 "defined there (pick another up=, or twist= alone)")
            return _unit(b)
        b = d[2] - np.dot(d[2], tangent) * tangent  # (frenet: towards the center of curvature)
        if not np.linalg.norm(b) > 1e-9 * np.dot(d[1], d[1]) / max(size, 1e-300):  # (curvature |b| / |d1|^2)
            raise ValueError(f"sweep: the path runs straight at {where}; up='frenet' needs a path that bends "
                             "everywhere (pick up= a direction)")
        return _unit(b)

    def axes(self, c: Any, place: np.ndarray, span: tuple[float, float]) -> tuple[list[float], np.ndarray]:
        """The parameters of the kernel curve ``c`` (a piece of the path in the profile's frame at its
        start: the x axis there is (1, 0, 0), ``place`` puts that frame in the world) at which the
        profile's x axis is given, and the x axes there. Records the x axis at the end (world)."""
        ts = _sample_parameters(c)
        theta0 = self.theta0
        for rounds in range(_REFINE + 1):
            self.theta0 = theta0
            xs = self._axes(c, ts, place, span)
            # (more samples where the x axis turns by more than 1/64 of a turn from one to the next)
            far = [i for i in range(len(ts) - 1) if float(np.dot(xs[i], xs[i + 1])) < math.cos(math.pi / 32)]
            if not far:
                break
            if rounds == _REFINE:
                raise self._spin(c, ts, xs, far, place)
            ts = sorted(ts + [0.5 * (ts[i] + ts[i + 1]) for i in far])
        self.end_x = place[:3, :3] @ xs[-1]
        return [float(t) for t in ts], xs

    def _spin(self, c: Any, ts: list[float], xs: np.ndarray, far: list[int], place: np.ndarray) -> ValueError:
        """The error for an x axis that turns faster than samples 2**_REFINE times as dense as the first
        follow it (half a turn within a ten-thousandth of the path, where 'frenet' passes a point at
        which the path nearly straightens, or 'up' one at which it nearly runs along up)."""
        i = max(far, key=lambda j: math.acos(max(-1.0, min(1.0, float(np.dot(xs[j], xs[j + 1]))))))
        angle = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(xs[i], xs[i + 1]))))))
        p = place[:3, :3] @ np.asarray(ext.curve_eval(c, 0.5 * (ts[i] + ts[i + 1]), 0)[0], dtype=float) + place[:3, 3]
        step = ext.curve_length(c, float(ts[i]), float(ts[i + 1]))
        why = {"frenet": "the path nearly straightens there, and up='frenet' follows its principal normal round; "
                         "pick up= a direction",
               "up": "the path nearly runs along up= there, and the profile keeps its attitude to it; pick up= a "
                     "direction the path does not run along",
               "rmf": "twist= turns it that fast; twist it more slowly"}[self.mode]
        return ValueError(f"sweep: the profile would spin about the path at {_fmt(p)}: it turns by {angle:.3g} degrees "
                          f"within {step:.3g} of it ({why})")

    def _axes(self, c: Any, ts: list[float], place: np.ndarray, span: tuple[float, float]) -> np.ndarray:
        d = [[np.asarray(v, dtype=float) for v in ext.curve_eval(c, t, 2)] for t in ts]
        tangents = np.array([_unit(x[1]) for x in d])
        speed = np.array([np.linalg.norm(x[1]) for x in d])
        run = np.concatenate([[0.0], np.cumsum(0.5 * (speed[1:] + speed[:-1]) * np.diff(ts))])
        s = span[0] + (span[1] - span[0]) * run / run[-1]
        x0 = np.array((1.0, 0.0, 0.0))
        size = max(float(np.ptp(np.array([x[0] for x in d]), axis=0).max()), 1e-300)
        if self.mode == "rmf":
            base = _rotation_minimizing(np.array([x[0] for x in d]), tangents, x0)
            if _closes(d, tangents):
                # (closed without a corner: the turn the frame gains around the loop spread along it,
                # as the kernel spreads it, so that the ends meet)
                gain = _signed_angle(base[-1], base[0], tangents[0])
                base = np.array([_turned(b, t, gain * f) for b, t, f in zip(base, tangents, run / run[-1])])
            angles = [self.twist(si) - self.twist(span[0]) for si in s]
        else:
            up = place[:3, :3].T @ self.up if self.up is not None else None
            base = np.array([self._base(x, t, up, size, place) for x, t in zip(d, tangents)])
            if self.theta0 is None:
                self.theta0 = _signed_angle(base[0], x0, tangents[0]) - self.twist(span[0])
            angles = [self.theta0 + self.twist(si) for si in s]
        return np.array([_turned(b, t, a) for b, t, a in zip(base, tangents, angles)])

    def start_axes(self, e: Edge, s: float) -> np.ndarray:
        """('up', 'frenet') The profile's axes at the start of the edge (world): x as the law gives it."""
        c = e._copy_curve()
        try:
            d = [np.asarray(v, dtype=float) for v in ext.curve_eval(c, float(c.parameter_range()[0]), 2)]
        finally:
            ext.delete_curve(c)
        tangent = _unit(d[1])
        b = self._base(d, tangent, self.up, max(e.length, 1e-300))
        x = _turned(b, tangent, (self.theta0 or 0.0) + self.twist(s))
        return np.column_stack([x, np.cross(tangent, x), tangent])


# How often the samples of a frame law are doubled where the profile's x axis turns by more than 1/64
# of a turn between two of them (64 a piece of the path at least, so 16384 then).
_REFINE = 8


def _fmt(p: np.ndarray) -> str:
    return "(" + ", ".join(f"{float(v):.6g}" for v in p) + ")"


def _turned(v: np.ndarray, axis: np.ndarray, angle: float) -> np.ndarray:
    """``v`` (perpendicular to the unit ``axis``) turned about it by ``angle`` (radians)."""
    return math.cos(angle) * v + math.sin(angle) * np.cross(axis, v)


def _signed_angle(a: np.ndarray, b: np.ndarray, axis: np.ndarray) -> float:
    """The angle (radians) that turns a into b about ``axis``."""
    return math.atan2(float(np.dot(np.cross(a, b), axis)), float(np.dot(a, b)))


def _sample_parameters(c: Any) -> list[float]:
    """Parameters of a kernel curve to give the profile's x axis at: four (at least) in each knot span,
    64 at least in all (a helix of the kernel has about 32 spans a turn)."""
    t0, t1 = (float(t) for t in c.parameter_range())
    knots = sorted({float(k_) for k_ in ext.curve_data(c, True)["knots"] if t0 < k_ < t1})
    bounds = [t0] + knots + [t1]
    per = max(4, math.ceil(64 / (len(bounds) - 1)))
    ts = [a + (b - a) * j / per for a, b in zip(bounds, bounds[1:]) for j in range(per)]
    return ts + [t1]


def _rotation_minimizing(points: np.ndarray, tangents: np.ndarray, x0: np.ndarray) -> np.ndarray:
    """The x axes of a frame carried along points with tangents by the smallest turns (the double
    reflection method of Wang, Juettler, Zheng and Liu 2008), from ``x0``."""
    out = [_unit(x0 - np.dot(x0, tangents[0]) * tangents[0])]
    for i in range(len(points) - 1):
        v1 = points[i + 1] - points[i]
        c1 = float(np.dot(v1, v1))
        r = out[-1]
        if c1 > 0:
            r_l = r - (2.0 / c1) * np.dot(v1, r) * v1
            t_l = tangents[i] - (2.0 / c1) * np.dot(v1, tangents[i]) * v1
            v2 = tangents[i + 1] - t_l
            c2 = float(np.dot(v2, v2))
            r = r_l - (2.0 / c2) * np.dot(v2, r_l) * v2 if c2 > 0 else r_l
        t = tangents[i + 1]
        out.append(_unit(r - np.dot(r, t) * t))
    return np.array(out)


def _closes(d: list[list[np.ndarray]], tangents: np.ndarray) -> bool:
    """Whether samples of a curve end where they start, in the same direction."""
    size = float(np.ptp(np.array([x[0] for x in d]), axis=0).max())
    return bool(np.linalg.norm(d[-1][0] - d[0][0]) <= 1e-6 * max(1.0, size)
                and np.linalg.norm(tangents[-1] - tangents[0]) <= 1e-6)


# -- the profile's scale along the path (scale=) ------------------------------------------------------
# The kernel's curve sweep scales the profile by a law it reads off two curves (the distance of a scale
# curve from a reference curve, divided by that at the start, at the path's parameters; sampled at 30
# points at least and interpolated cubically), ext.oriented_sweep by values at the path's parameters.
# The law is given along the path's length, so it is sampled by arc length.
def _scale_law(scale: Any) -> Callable[[float], float] | None:
    """The scale ``scale=`` asks for as a function of the fraction of the path's length (None for none):
    ``(start, end)`` changes evenly along the length, ``[(t, s), ...]`` passes through the points (a
    piecewise cubic that does not overshoot them), a function is called."""
    if scale is None:
        return None
    if callable(scale):
        f: Callable[[float], float] = lambda s: float(scale(s))  # noqa: E731
    else:
        what = (f"sweep: scale is (start, end), [(t, s), ...] or a function of the fraction of the path's length, "
                f"got {scale!r}")
        try:
            items = list(scale)
        except TypeError:
            raise TypeError(what) from None
        if len(items) == 2 and all(isinstance(v, numbers.Real) for v in items):
            a, b = float(items[0]), float(items[1])
            f = lambda s: a + (b - a) * s  # noqa: E731
        else:
            try:
                pts = [(float(t), float(v)) for t, v in items]
            except (TypeError, ValueError):
                raise TypeError(what) from None
            if len(pts) < 2 or pts[0][0] != 0.0 or pts[-1][0] != 1.0 or any(
                    not q[0] > p[0] for p, q in zip(pts, pts[1:])):
                raise ValueError("sweep: the points of a scale run from t = 0 to t = 1, t increasing")
            f = _monotone_cubic(pts)
    for i in range(65):
        v = f(i / 64)
        if not (math.isfinite(v) and v > 0):
            raise ValueError(f"sweep: the scale must be positive along the whole path; it is {v:g} at {i / 64:g} of "
                             "its length")
    return f


def _monotone_cubic(pts: list[tuple[float, float]]) -> Callable[[float], float]:
    """The piecewise cubic through the points (t, s) whose slopes keep it between neighbouring points
    (Fritsch and Carlson 1980, the end slopes as scipy's PCHIP takes them): it does not overshoot, so a
    scale through positive points stays positive."""
    t = [p[0] for p in pts]
    y = [p[1] for p in pts]
    n = len(pts)
    h = [t[i + 1] - t[i] for i in range(n - 1)]
    d = [(y[i + 1] - y[i]) / h[i] for i in range(n - 1)]
    m = [d[0]] * n
    if n > 2:
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

        def end(h0: float, h1: float, d0: float, d1: float) -> float:
            v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
            if v * d0 <= 0:
                return 0.0
            if d0 * d1 <= 0 and abs(v) > 3 * abs(d0):
                return 3 * d0
            return v

        m[0] = end(h[0], h[1], d[0], d[1])
        m[-1] = end(h[-1], h[-2], d[-1], d[-2])

    def at(s: float) -> float:
        i = max(0, min(n - 2, next((j for j in range(n - 1) if s < t[j + 1]), n - 2)))
        u = (s - t[i]) / h[i]
        h00, h10 = (1 + 2 * u) * (1 - u) ** 2, u * (1 - u) ** 2
        h01, h11 = u * u * (3 - 2 * u), u * u * (u - 1)
        return h00 * y[i] + h10 * h[i] * m[i] + h01 * y[i + 1] + h11 * h[i] * m[i + 1]

    return at


def _fractions(c: Any, ts: list[float], span: tuple[float, float]) -> list[float]:
    """The fractions of the whole path's length at the parameters ``ts`` (increasing, from the start of
    the kernel curve ``c`` to its end) of a piece of it that lies at ``span`` of the path."""
    t0, t1 = float(ts[0]), float(ts[-1])
    total = ext.curve_length(c, t0, t1)
    return [span[0] + (span[1] - span[0]) * (ext.curve_length(c, t0, float(t)) / total if t > t0 else 0.0)
            for t in ts]


def _scale_curves(c: Any, span: tuple[float, float], ratio: Callable[[float], float]) -> tuple[Any, Any]:
    """The reference and scale curves (kernel curves, the caller deletes them) that make the kernel's
    sweep along the kernel curve ``c`` (a piece of the path at ``span``) scale the profile by
    ``ratio`` (a function of the fraction of the path's length, 1 at the start of the piece): the Z
    axis from -1 to 2, and a cubic through (ratio, 0, z) at parameters evenly apart along the length,
    z running from 0 to 1 with the parameter (its distance from the Z axis is the ratio). 65 such
    points, twice as many (up to 257) while the cubic between them is more than 1e-7 of the scale off
    the law: the kernel reads the law at the path's parameters, which run unevenly along the length
    of most paths (a spline with points unevenly apart: 1.4e-3 off near its start with 65)."""
    from .curves import _basis
    from .shapes import _canonical_curve

    t0, t1 = (float(t) for t in c.parameter_range())
    length = ext.curve_length(c, t0, t1)

    def fraction(u: float) -> float:
        return span[0] + (span[1] - span[0]) * (ext.curve_length(c, t0, u) / length if u > t0 else 0.0)

    def solve(n: int) -> tuple[list[float], np.ndarray]:
        u = [t0] + [float(ext.curve_parameter_at_length(c, t0, length * i / n)[0]) for i in range(1, n)] + [t1]
        q = np.array([(ratio(span[0] + (span[1] - span[0]) * i / n), 0.0, (u[i] - t0) / (t1 - t0))
                      for i in range(n + 1)])
        knots = np.array([t0] * 4 + u[1:-1] + [t1] * 4)

        def slope(i0: int, i1: int, i2: int, at: int) -> np.ndarray:  # (of the parabola through three points)
            ua, ub, uc, x = u[i0], u[i1], u[i2], u[at]
            return (q[i0] * (2 * x - ub - uc) / ((ua - ub) * (ua - uc))
                    + q[i1] * (2 * x - ua - uc) / ((ub - ua) * (ub - uc))
                    + q[i2] * (2 * x - ua - ub) / ((uc - ua) * (uc - ub)))

        a = np.zeros((n + 3, n + 3))
        b = np.zeros((n + 3, 3))
        a[0], b[0] = _basis(knots, 3, u[0]), q[0]
        a[1], b[1] = _basis(knots, 3, u[0], deriv=1), slope(0, 1, 2, 0)
        for i in range(1, n):
            a[i + 1], b[i + 1] = _basis(knots, 3, u[i]), q[i]
        a[n + 1], b[n + 1] = _basis(knots, 3, u[n], deriv=1), slope(n - 2, n - 1, n, n)
        a[n + 2], b[n + 2] = _basis(knots, 3, u[n]), q[n]
        return [float(k_) for k_ in knots], np.linalg.solve(a, b)

    n = 64
    while True:
        knots, poles = solve(n)
        if n >= _SCALE_SAMPLES:
            break
        # the cubic's ratio half way between its points (by parameter) against the law there
        top = max(abs(float(v)) for v in poles[:, 0])
        mids = [0.5 * (knots[i] + knots[i + 1]) for i in range(3, len(knots) - 4)]
        off = max(abs(float(_basis(np.array(knots), 3, m) @ poles[:, 0]) - ratio(fraction(m))) for m in mids)
        if off <= 1e-7 * max(top, 1e-300):
            break
        n *= 2
    with kernel_call("sweep"):
        rule = _canonical_curve(poles, knots, 3, None)
        try:
            reference = _canonical_curve(np.array([(0.0, 0.0, -1.0), (0.0, 0.0, 2.0)]), [0.0, 0.0, 1.0, 1.0], 1, None)
        except BaseException:
            ext.delete_curve(rule)
            raise
    return reference, rule


# The most points (+ 1) a scale law is read at for the kernel's sweep (``_scale_curves``): it samples the
# scale curve 10 times a knot, and its sweep with 513 took 60 times as long as with 257.
_SCALE_SAMPLES = 256


def _frame_law(up: Any, twist: Any, orient: bool, translational: bool) -> _Law | None:
    """The frame law ``up=`` and ``twist=`` ask for (None for neither)."""
    if callable(twist):
        law_twist = lambda s: math.radians(float(twist(s)))  # noqa: E731
    else:
        try:
            total = float(twist)
        except (TypeError, ValueError):
            raise TypeError(f"sweep: twist is an angle in degrees or a function of the fraction of the path's "
                            f"length, got {type(twist).__name__}") from None
        if not math.isfinite(total):
            raise ValueError("sweep: twist must be a finite angle (degrees)")
        law_twist = (lambda s: math.radians(total) * s) if total else None  # noqa: E731
    if up is None and law_twist is None:
        return None
    if translational or not orient:
        raise ValueError("sweep: up= and twist= turn the profile along the path; they need orient=True and "
                         "translational=False")
    if up is None:
        mode, vec = "rmf", None
    elif isinstance(up, str):
        if up != "frenet":
            raise ValueError(f"sweep: up is an axis, a vector or 'frenet', got {up!r}")
        mode, vec = "frenet", None
    else:
        mode, vec = "up", np.array(_direction(up, "sweep: up").to_tuple())
    return _Law(mode, vec, law_twist or (lambda s: 0.0), explicit=True)


def _open_frame(w: Wire, t0: np.ndarray, anchor: Any = None) -> tuple[np.ndarray, np.ndarray]:
    """For an open profile: the axes of its plane (z its normal, the way the path starts ``t0``; a
    straight profile: the normal of the plane that holds it and ``t0``) and its anchor (``anchor=`` of
    :func:`sweep`: by default the center of its box along those axes)."""
    pts = np.array([w.point_at(i / 32).to_tuple() for i in range(33)])
    _, sv, vt = np.linalg.svd(pts - pts.mean(axis=0))
    if sv[1] > 1e-9 * max(1.0, sv[0]):
        n = _unit(vt[2])
    else:  # (straight)
        d = _unit(vt[0])
        n = t0 - np.dot(t0, d) * d
        if not np.linalg.norm(n) > 1e-9:
            raise ValueError("sweep: an open straight profile that runs along the path's start makes no surface")
        n = _unit(n)
    if np.dot(n, t0) < 0:
        n = -n
    ref = np.array((1.0, 0.0, 0.0)) if abs(n[0]) < 0.9 else np.array((0.0, 1.0, 0.0))
    x = _unit(ref - np.dot(ref, n) * n)
    axes = np.column_stack([x, np.cross(n, x), n])
    origin = pts[0]
    if anchor is not None and not (isinstance(anchor, str) and anchor == "center"):
        given = np.zeros(3) if isinstance(anchor, str) and anchor == "origin" else None
        return axes, _anchor_point(anchor, given, origin, n, w.bbox().diagonal)
    center = np.array(w._transformed(_inverse(_placement(axes, origin))).bbox().center.to_tuple())
    return axes, origin + axes @ center


def _framed_surface(w: Wire, edge: Edge, law: _Law, scale: Callable[[float], float] | None = None,
                    anchor: Any = None) -> Shell:
    """An open profile swept along one edge into a surface, its attitude given by ``law``: turned by
    the smallest rotation from the normal of its plane to the path's start (a straight profile: from
    the normal of the plane that holds it and the path's start tangent), its anchor on the path."""
    t0 = _tangent(edge, 0.0)
    axes, at = _open_frame(w, t0, anchor)
    local = w._transformed(_inverse(_placement(axes, at)))
    axes = _turn(axes[:, 2], t0) @ axes
    law.theta0 = None
    start = _placement(axes, edge.point_at(0.0).to_tuple())
    return _swept(local, edge, start, False, cap=False, law=law, scale=scale)  # type: ignore[return-value]


def _comes_round(local: Sketch, turn: float) -> bool:
    """Whether the profile (about its anchor at the origin) turned by ``turn`` degrees is itself
    again (the ends of a closed path meet)."""
    r = turn % 360.0
    if min(r, 360.0 - r) < 1e-6:
        return True
    turned = local.rotate(Axis((0, 0, 0), (0, 0, 1)), turn)
    return bool((local ^ turned).area <= 1e-9 * local.area)


def _closing_gain(chains: list[list[Edge]], axes: np.ndarray) -> float:
    """The angle (radians, about the path's start) by which a profile's x axis comes back turned round a
    closed path of ``chains`` (runs of tangent edges, corners between them) when it is carried along it
    by the smallest turns from ``axes`` (its axes at the start): the turn that ``twist`` must add along
    the path for the ends to meet."""
    t0 = _tangent(chains[0][0], 0.0)
    x = axes[:, 0]
    t_prev = t0
    for chain in chains:
        for e in chain:
            c = e._copy_curve()
            try:
                d = [[np.asarray(v, dtype=float) for v in ext.curve_eval(c, t, 1)] for t in _sample_parameters(c)]
            finally:
                ext.delete_curve(c)
            tangents = np.array([_unit(q[1]) for q in d])
            x = _turn(t_prev, tangents[0]) @ x  # (at a corner, the smallest turn)
            x = _rotation_minimizing(np.array([q[0] for q in d]), tangents, x)[-1]
            t_prev = tangents[-1]
    x = _turn(t_prev, t0) @ x
    return _signed_angle(x, axes[:, 0], t0)


def _helix_axis(edges: list[Edge]) -> np.ndarray | None:
    """The direction of the axis a path winds about at a constant pitch (a helix, also a conical one), or
    None (``ext.helix_axis``: the curves' points to within 1e-5 of their size)."""
    curves = [e._copy_curve() for e in edges]
    try:
        found = ext.helix_axis(curves, 1e-5)
    finally:
        for c in curves:
            ext.delete_curve(c)
    return None if found is None else _unit(found[1])


def _carried(edge: Edge, placement: np.ndarray, translational: bool, size: float) -> np.ndarray:
    """The axes a sweep along ``edge`` from ``placement`` ends with. Along a planar edge they
    turn about its plane's normal as its tangent does (the kernel's frame keeps the normal);
    along a twisted path they are read off a ribbon swept the same way (the kernel's frame is not
    the rotation-minimizing one there: along a helix it turns some 40 degrees a turn)."""
    axes = placement[:3, :3]
    if translational:
        return axes
    ts, te = _tangent(edge, 0.0), _tangent(edge, 1.0)
    pts = np.array([edge.point_at(i / 16).to_tuple() for i in range(17)])
    _, sv, vt = np.linalg.svd(pts - pts.mean(axis=0))
    if sv[2] <= 1e-9 * max(1.0, sv[0]):  # planar
        if sv[1] <= 1e-9 * max(1.0, sv[0]):  # straight
            return axes
        return _turn(ts, te, vt[2]) @ axes
    from .curves import Line

    local = edge._transformed(_inverse(placement))
    marker = Line((0.0, 0.0, 0.0), (size, 0.0, 0.0))
    curves = [marker._copy_curve()]
    path_curve = local._copy_curve()
    try:
        with kernel_call("sweep"):
            ribbon = Shell._wrap(ext.curve_sweep(curves, path_curve, False, True, False, False, None, None))
    finally:
        ext.delete_curve(path_curve)
        ext.delete_curve(curves[0])
    p0, p1 = (np.array(local.point_at(t).to_tuple()) for t in (0.0, 1.0))
    edges = list(ribbon.edges())
    first = min(edges, key=lambda e: float(np.linalg.norm(np.array(e.center().to_tuple()) - p0)))
    last = min(edges, key=lambda e: float(np.linalg.norm(np.array(e.center().to_tuple()) - p1)))
    # the marker's start at the start of the ribbon, and where the ribbon's side from it ends
    a = min((np.array(v.to_tuple()) for v in (first.start, first.end)), key=lambda v: float(v[0]))
    ends = [np.array(v.to_tuple()) for v in (last.start, last.end)]
    side = next(e for e in edges if e is not first and e is not last
                and min(np.linalg.norm(np.array(v.to_tuple()) - a) for v in (e.start, e.end)) < 1e-6 * max(1.0, size))
    tip = max((np.array(v.to_tuple()) for v in (side.start, side.end)), key=lambda v: float(np.linalg.norm(v - a)))
    far = min(range(2), key=lambda i: float(np.linalg.norm(ends[i] - tip)))
    # The kernel's frame carries the marker (the profile's x axis) from the start to the end; with the
    # tangent there, that is the turn the whole profile takes (also one not square to the path, as with
    # orient=False: its axes are turned as they are, not made square to the path).
    b = _unit(axes @ (ends[1 - far] - ends[far]))
    c = float(np.dot(axes[:, 0], ts))
    if abs(c) > 1 - 1e-9:  # (the x axis along the path: no turn about it is seen)
        return _turn(ts, te) @ axes
    m0 = _unit(axes[:, 0] - c * ts)
    m1 = b - c * te
    m1 = _unit(m1 - np.dot(m1, te) * te)
    f0 = np.column_stack([m0, np.cross(ts, m0), ts])
    f1 = np.column_stack([m1, np.cross(te, m1), te])
    return f1 @ f0.T @ axes


def _round(sk: Sketch, anchor: np.ndarray) -> bool:
    """Whether the profile turns into itself about its anchor: circles about it."""
    edges = sk.edges()
    tol = 1e-9 * max(1.0, sk.bbox().diagonal)
    return bool(edges) and all(e.geom_type == "circle" and e.is_closed
                               and float(np.linalg.norm(np.array(e.arc_center.to_tuple()) - anchor)) <= tol for e in edges)


def _g1_chains(edges: list[Edge]) -> list[list[Edge]]:
    """The edges in runs that meet tangentially (within 1e-6 rad); a new run at each corner."""
    chains = [[edges[0]]]
    for e in edges[1:]:
        if np.linalg.norm(_tangent(chains[-1][-1], 1.0) - _tangent(e, 0.0)) <= 1e-6:
            chains[-1].append(e)
        else:
            chains.append([e])
    return chains


def _joined(chain: list[Edge]) -> Edge:
    """A run of edges as one edge (one B-spline curve): swept in one go, it has no joints."""
    if len(chain) == 1:
        return chain[0]
    curves = [e._copy_curve() for e in chain]
    try:
        with kernel_call("sweep"):
            return Edge._from_curve(ext.join_curves(curves))
    finally:
        for c in curves:
            ext.delete_curve(c)


@overload
def sweep(profile: Sketch | Face, path: Edge | Wire, *, orient: bool = ..., translational: bool = ...,
          sharp_corners: bool | None = ..., up: Axis | VectorLike | str | None = ...,
          twist: float | Callable[[float], float] = ...,
          scale: tuple[float, float] | Sequence[tuple[float, float]] | Callable[[float], float] | None = ...,
          anchor: str | VectorLike | Vertex = ..., rails: Edge | Wire | None = ...) -> Part: ...
@overload
def sweep(profile: Sketch | Face | Wire | Edge, path: Edge | Wire, *, orient: bool = ..., translational: bool = ...,
          sharp_corners: bool | None = ..., up: Axis | VectorLike | str | None = ...,
          twist: float | Callable[[float], float] = ...,
          scale: tuple[float, float] | Sequence[tuple[float, float]] | Callable[[float], float] | None = ...,
          anchor: str | VectorLike | Vertex = ..., rails: Edge | Wire | None = ...) -> Part | Shell: ...
def sweep(profile: Sketch | Face | Wire | Edge, path: Edge | Wire, *, orient: bool = True, translational: bool = False,
          sharp_corners: bool | None = None, up: Axis | VectorLike | str | None = None,
          twist: float | Callable[[float], float] = 0.0,
          scale: tuple[float, float] | Sequence[tuple[float, float]] | Callable[[float], float] | None = None,
          anchor: str | VectorLike | Vertex = "center", rails: Edge | Wire | None = None) -> Part | Shell:
    """Sweep a profile along a path.

    The profile is moved so that the center of its box (along the axes of its plane) sits at the
    start of the path and (with ``orient``) turned to face along the path, so profiles can be
    drawn anywhere, usually in the XY plane::

        tube = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)))
        rail = sweep(Rectangle(4, 2), Helix(pitch=10, height=40, radius=20))

    ``anchor`` puts another point of the profile on the path: ``"origin"`` (the origin of the
    sketch's plane) or a point of the profile's plane::

        lip = sweep(Rectangle(4, 2, align=(Align.MIN, Align.MIN)), rim, anchor=(0, 0))  # its corner

    Edges of a path that meet tangentially are swept as one; at a corner of a path that is not
    planar, the profile goes on turned by the smallest rotation from one tangent to the next. Where
    the kernel cannot sweep an open path of several edges so, each edge is swept on its own, turned
    to its own start, and the pieces are fused (with a ``RuntimeWarning`` unless the profile is
    round: it turns where the edges meet). A closed path it cannot sweep so (the fuse where the
    halves of a loop closed with a kink cross) is swept in pieces as before 0.5.0, where that puts
    the profile on the path. Faces without area that a fuse leaves are taken out (or the sweep
    raises ``ModelingError``). The corners of a planar path of several edges are mitered, the
    profile placed as on any other path; where they cannot be (arcs that meet at a corner), the path
    is swept piece by piece, with a ``RuntimeWarning``.

    Along the path the profile turns as little as it can (a rotation-minimizing frame: on a planar
    path it keeps its attitude to the plane), except along a helix (also a conical one), where it
    keeps its attitude to the helix's axis, as a thread or a flat spring wire does. ``up`` and
    ``twist`` set the attitude instead::

        rail = sweep(Rectangle(4, 2), path, up=Z)           # stays upright: its angle to Z kept
        bar = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, 100)), twist=180)  # a half turn

    ``scale`` grows or shrinks the profile along the path, about the point that sits on it::

        horn = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)), scale=(1, 3))
        spring = sweep(Circle(1), Helix(pitch=8, height=40, radius=15), scale=[(0, 1), (0.5, 1.5), (1, 1)])

    A single line or arc is swept as an extrusion or a revolve (planes, cylinders, cones, spheres and
    tori, not B-spline surfaces); a profile that reaches across the axis of an arc raises
    ``ModelingError`` (it would sweep through itself).

    Args:
        profile: A sketch (holes allowed), a planar face or a closed wire.
        path: An edge, or a wire of connected edges.
        orient: Turn the profile to be perpendicular to the path at its start.
        translational: Keep the profile's orientation fixed instead of turning it with the path.
        sharp_corners: For paths of several edges: miter the corners of a planar path
            (default for planar paths); ``False`` sweeps the path piece by piece (each run of
            tangent edges in one go) and joins the pieces.
        up: An axis or a direction the profile keeps its attitude to: along the whole path it stands
            at the angle it starts at to ``up`` made perpendicular to the path (the path must not
            run along ``up``). ``"frenet"``: to the path's principal normal (towards the center of
            its curvature; the path must bend everywhere). Default: the axis of a helical path, the
            smallest turn on others.
        twist: Degrees the profile turns about the path on top of that, spread evenly along its
            length; or a function of the fraction of the length (0 at the start, 1 at the end) that
            gives the angle in degrees there (the profile starts turned by ``twist(0)``). Along a
            closed path the profile must come round into itself (a whole number of turns, or of its
            symmetry).
        scale: The profile's scale along the path, about the point of it that sits on the path:
            ``(start, end)`` changes evenly along the length; ``[(t, s), ...]`` passes through the
            scales ``s`` at the fractions ``t`` of the length (from 0 to 1; a smooth curve that does
            not overshoot them); a function of the fraction gives it. Positive everywhere; along a
            closed path the same at both ends. Planar paths of several edges are then swept piece by
            piece (``sharp_corners=False``).
        anchor: The point of the profile that goes on the path (and that ``scale`` scales about):
            ``"center"`` (the center of its box along the axes of its plane), ``"origin"`` (the
            origin of the sketch's plane, :attr:`Sketch.plane`: (0, 0) of a ``Polygon`` or
            ``Profile`` drawn on XY, the middle of a centered shape such as ``Circle``, moved with
            it; for a face, a wire or an edge the point (0, 0, 0)), or a point (a vector or a
            vertex) of the profile's plane.
        rails: A second rail (an edge or a wire; the path is the first) for an open profile that
            runs from the path to it: the profile is moved, turned and scaled (the same in every
            direction) so that its ends stay on both, and the surface (a :class:`Shell`) passes
            through both rails exactly. The profile's frame turns with the line from the path to
            the rail and with the rails' mean direction; the rails are matched by the fraction of
            their lengths, from where the profile meets them to their ends. Not with ``orient``,
            ``translational``, ``sharp_corners``, ``up``, ``twist``, ``scale`` or ``anchor``,
            which the rails decide::

                hood = sweep(ThreePointArc((0, 0, 0), (10, 0, 4), (20, 0, 0)), left, rails=right)
    """
    if isinstance(anchor, str) and anchor not in ("center", "origin"):
        raise ValueError(f"sweep: anchor is 'center', 'origin' or a point, got {anchor!r}")
    edges = _path_edges(path)
    if rails is not None:
        w = _open_curve(profile)
        if w is None:
            raise ValueError("sweep: rails= sweeps an open profile (an edge or a wire from the path to the rail) into a "
                             "surface; closed profiles along two rails are not supported")
        if (not orient or translational or sharp_corners is not None or up is not None or scale is not None
                or not (isinstance(anchor, str) and anchor == "center")
                or callable(twist) or float(twist) != 0.0):
            raise ValueError("sweep: with rails= the path and the rail hold the profile's ends, which sets its "
                             "attitude, size and place; it takes no orient=, translational=, sharp_corners=, up=, "
                             "twist=, scale= or anchor=")
        return _rail_sweep(w, edges, rails)
    law = _frame_law(up, twist, orient, translational)
    grow = _scale_law(scale)
    planar = _is_planar_path(edges)
    if (law is None or law.mode == "rmf") and orient and not translational and not planar:
        # (along a helix the profile keeps its attitude to the axis: the base of a twist too)
        axis = _helix_axis(edges)
        if axis is not None:
            law = _Law("up", axis, law.twist if law is not None else (lambda s: 0.0), law is not None)
    w = _open_curve(profile)
    if w is not None:
        # an open profile sweeps into a surface (also along a closed edge: only solids come out
        # inside out there)
        if len(edges) != 1:
            raise ValueError("surface sweeps need a single-edge path")
        if law is not None:
            return _framed_surface(w, edges[0], law, grow, anchor)  # type: ignore[return-value]
        at = _open_frame(w, _tangent(edges[0], 0.0), anchor)[1]
        if grow is not None:  # (about its anchor, which goes on the path)
            w = w.scale(grow(0.0), Vector(*at))
        pc = edges[0]._copy_curve()
        curves = w._copy_curves()
        try:
            rules = [] if grow is None else list(_scale_curves(pc, (0.0, 1.0), lambda f: grow(f) / grow(0.0)))
            try:
                with kernel_call("sweep"):
                    b = ext.curve_sweep(curves, pc, False, True, orient, translational, *(rules or [None, None]),
                                        [float(v) for v in at])
            finally:
                for c in rules:
                    ext.delete_curve(c)
        finally:
            ext.delete_curve(pc)
            for c in curves:
                ext.delete_curve(c)
        return Shell._wrap(b)  # type: ignore[return-value]
    sk = _as_sketch(profile)
    if isinstance(anchor, str) and anchor == "origin" and not isinstance(profile, Sketch):
        anchor = (0.0, 0.0, 0.0)  # (a face, a wire or an edge: the point (0, 0, 0))
    if len(edges) == 1 and law is None and grow is None:
        out = _analytic_sweep(sk, edges[0], orient and not translational, anchor)
        if out is not None:
            return out
    closed = edges[0].start.is_close(edges[-1].end, 1e-6 * max(1.0, edges[0].length))
    tangent_closure = closed and np.linalg.norm(_tangent(edges[-1], 1.0) - _tangent(edges[0], 0.0)) <= 1e-6
    # the pieces a path was swept in before 0.5.0: its edges, or the halves of a closed edge
    whole = edges[0] if len(edges) == 1 and edges[0].is_closed else None
    pieces = _halves(whole) if whole is not None else edges
    halved = len(edges) == 1 and edges[0].is_closed and (planar or not tangent_closure)
    if halved:
        # The kernel sweeps a profile along a closed single-edge path inside out (it caps the
        # ends where they meet); along the same path in two halves it works.
        edges = pieces
    asked = sharp_corners
    if sharp_corners is None:
        sharp_corners = planar and law is None and grow is None
    mitre_error: ModelingError | None = None
    if sharp_corners and len(edges) > 1:
        if not planar:
            raise ValueError("sharp-cornered sweeps need a planar path")
        if law is not None:
            raise ValueError("sweep: mitered corners keep the profile square to the path's plane; up= and twist= "
                             "need sharp_corners=False")
        if grow is not None:
            raise ValueError("sweep: mitered corners keep the profile's size; scale= needs sharp_corners=False")
        try:
            return _mitred_sweep(sk, edges, closed, orient and not translational, anchor)
        except ModelingError as err:
            if asked:
                raise
            mitre_error = err  # (arcs that meet at a corner: the kernel's planar-path sweep gives no solid)
    t0 = _tangent(edges[0], 0.0)
    axes, own = _profile_frame(sk, t0, anchor)
    local = sk._transformed(_inverse(_placement(axes, own)))
    if orient and not translational:
        axes = _turn(axes[:, 2], t0) @ axes
    if law is not None and closed:
        turn = math.degrees(law.twist(1.0) - law.twist(0.0))
        if not _comes_round(local, turn):
            raise ValueError(f"sweep: along a closed path the profile must come round into itself; twisted by {turn:g} "
                             "degrees it does not (twist by whole turns, or by a turn of its symmetry)")
    if grow is not None and closed and not math.isclose(grow(0.0), grow(1.0), rel_tol=1e-9):
        raise ValueError(f"sweep: along a closed path the profile must come round into itself; scaled from "
                         f"{grow(0.0):g} to {grow(1.0):g} it does not (end with the scale it starts with)")
    if (closed and not tangent_closure and not planar and orient and not translational
            and (law is None or law.mode == "rmf") and not _round(sk, own)):
        # Round a loop with a corner that is not planar, the frame carried by the smallest turns comes
        # back turned about the path (as the earth's axis turns round a loop of latitude): the profile
        # did not meet itself where the loop closes. The turn is spread along the length, as along a
        # closed path without a corner.
        gain = _closing_gain([[e] for e in edges] if halved else _g1_chains(edges), axes)
        if abs(gain) > 1e-9:
            base = law.twist if law is not None else (lambda s: 0.0)
            law = _Law("rmf", None, lambda s: base(s) + gain * s, law.explicit if law is not None else False,
                       closing=True)
    hint = "the profile may be too large for the path's curvature"
    try:
        out = _carried_sweep(sk, local, edges, axes, own, halved, tangent_closure, translational, hint, law, grow)
    except ModelingError as err:
        if mitre_error is not None:
            raise mitre_error from None
        if law is not None and law.explicit:
            raise
        if law is not None:
            if law.closing and halved and whole is not None:
                # (the halves of a loop closed with a kink fuse where they meet tangentially: elsewhere than
                # halfway too, the same body)
                for at in (0.4, 0.6):
                    try:
                        return _carried_sweep(sk, local, _halves(whole, at), axes, own, halved, tangent_closure,
                                              translational, hint, law, grow)
                    except ModelingError:
                        pass
            # (an implicit law, a helix's axis or the turn that closes a loop, that the kernel cannot sweep:
            # its own frame, as before 0.5.0)
            try:
                out = _carried_sweep(sk, local, edges, axes, own, halved, tangent_closure, translational, hint,
                                     scale=grow)
            except ModelingError:
                raise err from None
            if law.closing:
                warnings.warn(f"sweep: the profile could not be made to meet itself where the loop closes ({err}); "
                              "it turns about the path as the kernel's frame turns it", RuntimeWarning, stacklevel=2)
            elif not _round(sk, own):
                warnings.warn(f"sweep: the profile could not keep its attitude to the helix's axis ({err}); it "
                              "turns about the path as the kernel's frame turns it", RuntimeWarning, stacklevel=2)
            return out
        if len(pieces) < 2:
            out = None if closed else _split_sweep(sk, local, edges[0], axes, own, translational, hint, grow)
            if out is not None:
                return out
            bent = _bend_error(err, local, edges, hint)
            if bent is err:
                raise
            raise bent from err
        if closed:
            # A closed path the kernel cannot sweep carried along (the fuse where the halves of a
            # loop closed with a kink cross fails for some loops) is swept as before 0.5.0; a round
            # profile also turned about its center (the same profile, its seam elsewhere: the fuse
            # goes for most loops where it failed with the seam where it was).
            try:
                out = None if grow is not None else _former_sweep(sk, own, pieces, orient, translational, hint)
            except ModelingError:
                out = None
            if out is None and _round(sk, own):
                tries: list[tuple[Any, float]] = [(edges, angle) for angle in _SEAM_TURNS]
                if halved and not tangent_closure and whole is not None:
                    # (a loop closed with a kink also split elsewhere than halfway, the profile's seam turned
                    # too: the same body)
                    tries += [(at, angle) for at in _SEAM_SPLITS for angle in (0.0, 45.0, -45.0)]
                for split, angle in tries:
                    try:
                        turned = local.rotate(Axis((0, 0, 0), (0, 0, 1)), angle) if angle else local
                        if isinstance(split, float):
                            split = _halves(whole, split)  # type: ignore[arg-type]
                        out = _carried_sweep(sk, turned, split, axes, own, halved, tangent_closure, translational,
                                             hint, scale=grow)
                        break
                    except ModelingError:
                        pass
            if out is None:
                raise _bend_error(err, local, edges, hint) from None
            return out
        # An open path of several edges the kernel cannot sweep so (a circle along a 3D fillet
        # polyline joined into one curve fails at random) is swept edge by edge, each edge turned
        # afresh, as before the profile was carried along.
        try:
            out = _afresh_sweep(local, edges, axes, orient, translational, hint, grow)
        except ModelingError:
            raise _bend_error(err, local, edges, hint) from None
        if not _round(sk, own):
            warnings.warn(f"sweep: the profile could not be carried along the path ({err}); each of its "
                          f"{len(edges)} edges was swept turned to its own start instead, so the profile turns "
                          "where they meet", RuntimeWarning, stacklevel=2)
        return out
    if mitre_error is not None:
        warnings.warn(f"sweep: the corners of this planar path cannot be mitered ({mitre_error}); it was swept "
                      "piece by piece instead, as with sharp_corners=False", RuntimeWarning, stacklevel=2)
    return out


def _analytic_sweep(sk: Sketch, edge: Edge, turn: bool, anchor: Any = None) -> Part | None:
    """A profile swept along a single line as an extrusion, along a single arc (or circle) as a revolve:
    planes, cylinders, cones, spheres and tori, where the kernel's curve sweep makes B-spline surfaces
    (that a path split into several edges did not: the type of the faces depended on how the path was
    split). The profile placed as on any other path (``turn``: turned to face along the path). None for
    other edges, an arc without ``turn``, and where the kernel cannot make it. Raises where the profile
    reaches across the arc's axis (it would sweep through itself)."""
    kind = edge.geom_type
    if kind not in ("line", "circle") or (kind == "circle" and not turn):
        return None
    t0 = _tangent(edge, 0.0)
    axes, own = _profile_frame(sk, t0, anchor)
    local = sk._transformed(_inverse(_placement(axes, own)))
    if turn:
        axes = _turn(axes[:, 2], t0) @ axes
    elif abs(float(np.dot(axes[:, 2], t0))) <= 1e-9:
        return None  # (the profile's plane along the path)
    start = np.array(edge.point_at(0.0).to_tuple())
    placed = local._transformed(_placement(axes, start))
    if kind == "circle":
        center = np.array(edge.arc_center.to_tuple())
        axis = Axis(tuple(center), tuple(_unit(np.cross(start - center, t0))))
        try:
            placed._check_axis_beside(axis, False)
        except ModelingError:
            raise ModelingError(f"sweep: the profile reaches across the axis of the arc (radius {edge.radius:.6g}), so "
                                "it would sweep through itself; use a smaller profile or a larger radius") from None
    try:
        if kind == "line":
            out = placed.extrude(edge.length, direction=Vector(*t0))
        else:
            angle = 360.0 if edge.is_closed else math.degrees(edge.length / edge.radius)
            out = placed.revolve(axis, angle)
    except (ModelingError, KernelError):
        return None
    out.name, out.color = None, None
    return out


# How far a round profile is turned about its center (degrees) where a closed path fails with it as
# it is: with its seam turned by one of these (or the loop split elsewhere), most random loops
# closed with a kink that failed go (circles of radius 1.5 along 60 random loops: all 60, 37 before
# 0.5.0).
_SEAM_TURNS = (20.0, -20.0, 45.0, -45.0, 70.0, -70.0, 100.0, -100.0, 135.0, -135.0)
# Where else (fractions of its length) a loop closed with a kink is split into the two pieces that are
# fused, each with the round profile's seam as it is and turned by 45 degrees either way: 2 more of 30
# hard loops go, in both builds. (Which tries go depends on rounding: the native build and smlibwasm
# differ on 4 of 60 such loops, also with fused multiply-adds turned off natively.)
_SEAM_SPLITS = (0.4, 0.6, 0.3, 0.7)


def _bend_error(err: ModelingError, local: Sketch, edges: list[Edge], hint: str) -> ModelingError:
    """A sweep's error about the path's curvature with the numbers: where the path bends most
    tightly and how far the profile reaches from it (the same error where that is not known)."""
    if hint not in str(err):
        return err
    try:
        r, t, e = min(((*e._min_radius(), e) for e in edges), key=lambda x: x[0])
        reach = max(q.point_at(i / 16).length for q in local.edges() for i in range(17))
    except (ModelingError, ValueError):
        return err
    if not math.isfinite(r):
        return err
    p = e.point_at(t)
    detail = (f"the path bends with a radius of {r:.4g} at ({p.x:.4g}, {p.y:.4g}, {p.z:.4g}) (Edge.min_radius), and "
              f"the profile reaches {reach:.4g} from the path")
    if isinstance(err, KernelError):
        return _traced(KernelError(err.operation, err.detail, err.status, f"{err.hint}: {detail}" if err.hint else detail),
                       err)
    return ModelingError(f"{err}: {detail}")


def _carried_sweep(sk: Sketch, local: Sketch, edges: list[Edge], axes: np.ndarray, anchor: np.ndarray, halved: bool,
                   tangent_closure: bool, translational: bool, hint: str, law: _Law | None = None,
                   scale: Callable[[float], float] | None = None) -> Part:
    """A profile carried along a path: tangent edges in one go, the frame carried across corners (or,
    with ``law``, given by it), scaled by ``scale``."""
    chains = [[e] for e in edges] if halved else _g1_chains(edges)
    if tangent_closure and len(edges) == 1 and _round(sk, anchor):
        # A profile that turns into itself along a smooth closed edge: in two halves, as before
        # (exact; swept in one go and closed, a circle came out up to 5e-5 short). Not the halves
        # of edges joined into one curve: the kernel cannot sweep a circle along most halves of a
        # closed 3D fillet polyline (SM_ERR), and in one go it can.
        chains = [[e] for e in _halves(edges[0])]
    elif tangent_closure and len(chains) == 1:
        # A closed path without a corner: swept in one go and closed where its ends meet (the
        # kernel spreads the turn of its frame around such a path, so they meet; in two halves a
        # rectangle turned by 10 degrees at the halfway point and 44 at the start).
        chain = _joined(edges)
        if law is not None:
            law.theta0 = None
        tube = _swept(local, chain, _placement(axes, chain.point_at(0.0).to_tuple()), translational, cap=False, law=law,
                      scale=scale)
        with kernel_call("sweep", hint):
            k.stitch_into_solid(tube._brep)
        return _sound(Part._wrap(tube._copy_brep()), hint)
    chains = [_joined(c) for c in chains]
    size = sk.bbox().diagonal
    lengths = [e.length for e in chains]
    if law is not None:
        law.theta0 = None
    out: Part | None = None
    for i, e in enumerate(chains):
        span = (sum(lengths[:i]) / sum(lengths), sum(lengths[: i + 1]) / sum(lengths))
        if i and law is not None and law.mode != "rmf":
            axes = law.start_axes(e, span[0])  # (the law's own attitude, also after a corner)
        elif i:
            if law is not None:  # (carried as the kernel carries it, the twist on top)
                te = _tangent(chains[i - 1], 1.0)
                axes = np.column_stack([law.end_x, np.cross(te, law.end_x), te])
            else:
                axes = _carried(chains[i - 1], placement, translational, size)
            if not translational:  # (at a corner, the smallest turn from one tangent to the next)
                axes = _turn(_tangent(chains[i - 1], 1.0), _tangent(e, 0.0)) @ axes
        placement = _placement(axes, e.point_at(0.0).to_tuple())
        piece = _swept(local, e, placement, translational, law=law, span=span, scale=scale)
        piece = _require_solid(piece, "sweep", hint)  # type: ignore[arg-type]
        out = piece if out is None else out + piece
    return out if len(chains) < 2 else _sound(out, hint)  # type: ignore[arg-type,return-value]


def _split_sweep(sk: Sketch, local: Sketch, edge: Edge, axes: np.ndarray, own: np.ndarray, translational: bool,
                 hint: str, scale: Callable[[float], float] | None) -> Part | None:
    """A long edge that the kernel cannot sweep in one go with its own frame: in 2, 4 or 8 pieces, the
    frame carried from one to the next (they meet tangentially, so the profile does not turn there),
    fused. NLib places at most about 1000 sections along a path (the kernel's own frame, as orient=False
    keeps it, failed along more than some 60 turns of a helix). None where the profile does not fit the
    path's curvature (that is what the failure says then) or no split goes."""
    try:
        r = edge._min_radius()[0]
        reach = max(q.point_at(i / 16).length for q in local.edges() for i in range(17))
    except (ModelingError, ValueError):
        return None
    if not (math.isfinite(r) and r > reach):
        return None
    for n in (2, 4, 8):
        try:
            return _carried_sweep(sk, local, _split(edge, n), axes, own, True, False, translational, hint, scale=scale)
        except ModelingError:
            continue
    return None


def _split(edge: Edge, n: int) -> list[Edge]:
    """An edge as ``n`` edges of equal length, end to end."""
    c = edge._copy_curve()
    try:
        t0, t1 = (float(t) for t in c.parameter_range())
        total = ext.curve_length(c, t0, t1)
        ts = [t0] + [float(ext.curve_parameter_at_length(c, t0, total * i / n)[0]) for i in range(1, n)] + [t1]
        return [Edge._from_curve(ext.trimmed_curve(c, a, b)) for a, b in zip(ts, ts[1:])]
    finally:
        ext.delete_curve(c)


def _afresh_sweep(local: Sketch, pieces: list[Edge], axes: np.ndarray, orient: bool, translational: bool,
                  hint: str, scale: Callable[[float], float] | None = None) -> Part:
    """The pieces swept on their own and fused, each turned afresh: by the smallest rotation from
    the path's start tangent, either way along it, to the piece's own (the profile does not keep
    its orientation where they meet; the way pieces were swept before the frame was carried)."""
    t0 = _tangent(pieces[0], 0.0)
    lengths = [e.length for e in pieces]
    out: Part | None = None
    for i, e in enumerate(pieces):
        turned = axes
        if orient and not translational:
            t = _tangent(e, 0.0)
            turned = _turn(t0 if np.dot(t0, t) >= 0 else -t0, t) @ axes
        span = (sum(lengths[:i]) / sum(lengths), sum(lengths[: i + 1]) / sum(lengths))
        piece = _swept(local, e, _placement(turned, e.point_at(0.0).to_tuple()), translational, span=span, scale=scale)
        piece = _require_solid(piece, "sweep", hint)  # type: ignore[arg-type]
        out = piece if out is None else out + piece
    return _sound(out, hint)  # type: ignore[arg-type]


def _former_sweep(sk: Sketch, anchor: np.ndarray, pieces: list[Edge], orient: bool, translational: bool,
                  hint: str) -> Part | None:
    """The pieces swept as before 0.5.0, with the same kernel calls: the sketch turned to the path's
    start (by the smallest rotation, about the center of its box), turned from there to each
    piece's start and swept with the kernel's anchor (the center of the turned profile's box along
    the world axes), the pieces fused. None where that anchor is not the profile's own (a profile
    not symmetric about it, turned off the axes): the profile went beside the path there."""

    def turned(s: Sketch, own: np.ndarray, e: Edge) -> tuple[Sketch, np.ndarray]:
        # the sketch turned to the start of e as _oriented_to turns it, and the point own with it
        if not orient or translational:
            return s, own
        n, t = _unit(s.plane.z_dir.to_tuple()), _tangent(e, 0.0)
        center = np.array(s.bbox().center.to_tuple())
        rot = _turn(n if np.dot(n, t) >= 0 else -n, t)
        return _oriented_to(s, e.tangent_at(0.0)), center + rot @ (own - center)

    tol = 1e-6 * max(1.0, sk.bbox().diagonal)
    start, start_anchor = turned(sk, np.asarray(anchor, dtype=float), pieces[0])
    swept: list[Part] = []
    for e in pieces:
        s, own = turned(start, start_anchor, e)
        if np.linalg.norm(np.array(s.bbox().center.to_tuple()) - own) > tol:
            return None
        curves = [c for f in s.faces() for w in f.wires() for c in w._copy_curves()]
        path_curve = e._copy_curve()
        try:
            with kernel_call("sweep", hint):
                b = ext.curve_sweep(curves, path_curve, True, True, False, translational, None, None)
        finally:
            ext.delete_curve(path_curve)
            for c in curves:
                ext.delete_curve(c)
        swept.append(_require_solid(Part._wrap(b), "sweep", hint))
    out = swept[0]
    for p in swept[1:]:
        out = out + p
    return _sound(out, hint)


# A face of a fused sweep encloses no area when its area is below this times the square of the
# body's size.
_SLIVER_AREA = 1e-9


def _sound(part: Part, hint: str) -> Part:
    """A sweep that was fused or stitched from pieces, checked as ``is_valid()`` checks it (the
    gaps between its faces measured), and without faces that enclose no area: the fuse of the
    halves of a loop closed with a kink left such faces where the loop closes (where the end caps
    of the halves and the surfaces of both tubes meet at a point), in 25 of about 100 random
    loops, and some of them a shell of their own inside the solid, which STEP writes as a void (and
    OpenCASCADE then reads the body inside out). They are taken out and the faces around them
    stitched together again; where that fails the sweep raises ``ModelingError``."""
    problem = part._solid_problem(gaps=True)
    if problem is not None:
        raise ModelingError(f"sweep: the kernel returned a body that is {problem}; {hint}")
    size = part._extent()
    regions = [r for r in ext.brep_dump(part._brep, False)["regions"] if not r["infinite"]]
    try:
        faces = part.faces()
        slivers = [f for f in faces if not f.area > _SLIVER_AREA * size ** 2]
    except KernelError as err:
        raise ModelingError(f"sweep: a face of the fused pieces cannot be measured ({err}); {hint}") from None
    if not slivers and len(regions) == 1 and len(regions[0]["shells"]) == 1:
        return part
    what = (f"{len(slivers)} face(s) that enclose no area" if slivers else
            f"{sum(len(r['shells']) for r in regions)} shells")
    if not slivers:
        raise ModelingError(f"sweep: the fused pieces came out as a body of {what}; {hint}")
    reach = max(10.0 * max(f.bbox().diagonal for f in slivers), 1e-7 * size)
    try:
        with kernel_call("remove slivers"):
            out = Part._wrap(ext.remove_slivers(part._brep, [f._f for f in slivers], reach))
        if out._solid_problem(gaps=True) is not None:
            raise ModelingError("not a valid solid")
        regions = [r for r in ext.brep_dump(out._brep, False)["regions"] if not r["infinite"]]
        if len(regions) != 1 or len(regions[0]["shells"]) != 1:
            raise ModelingError("not one shell")
        if abs(out.volume - part.volume) > 1e-6 * part.volume:
            raise ModelingError("another volume")
        if any(not f.area > _SLIVER_AREA * size ** 2 for f in out.faces()):
            raise ModelingError("faces without area left")
    except ModelingError as err:
        raise ModelingError(f"sweep: the fused pieces have {what}, and they cannot be taken out ({err}); "
                            f"{hint}") from None
    return out


# -- planar paths with mitered corners -----------------------------------------------------------
# The kernel's sweep along a planar path of several edges (SmApiCreateSweepAlongPlanarPath) puts
# the profile on each edge in a frame made from the world's axes: x along the edge, y the world Z
# axis crossed with the edge (the world Y axis where the edge runs mostly along Z). Only in a
# horizontal plane do those frames turn about the path's normal from edge to edge, so that the
# mitered pieces meet: on a path in the YZ plane, and with a triangle on a path in the XZ plane
# that turns back, it returned no closed solid. So the path is swept in a frame of its own (its plane
# horizontal, its start along X) with the profile turned as on any other path, and the body is
# placed back. The kernel moved the profile by the middle of its box (of its curves' control points)
# along the world axes, so an asymmetric profile turned off them went beside the path (and an arc
# that does not span whole quadrants a little); the profile's anchor is given to it instead (kernel
# patch: ``ext.planar_path_sweep``'s reference).
def _path_normal(edges: list[Edge]) -> np.ndarray:
    """The normal of a planar path's plane: up (or towards +Y, +X) where that is not ambiguous."""
    a = np.array([e.point_at(t).to_tuple() for e in edges for t in _PLANARITY_SAMPLES])
    _, _, vt = np.linalg.svd(a - a.mean(axis=0))
    n = vt[2] / np.linalg.norm(vt[2])
    for i in (2, 1, 0):
        if abs(n[i]) > 1e-9:
            return n if n[i] > 0 else -n
    return n


def _mitred_sweep(sk: Sketch, edges: list[Edge], closed: bool, turn: bool, anchor: Any = None) -> Part:
    """A profile swept along a planar path of several edges with mitered corners."""
    hint = "the profile may be too large for the path's corners"
    t0 = _tangent(edges[0], 0.0)
    normal = _path_normal(edges)
    frame = np.column_stack([t0, np.cross(normal, t0), normal])  # the path's own: start along x, plane xy
    start = np.array(edges[0].point_at(0.0).to_tuple())
    to_path = _inverse(_placement(frame, start))
    path = [e._transformed(to_path) for e in edges]
    axes, own = _profile_frame(sk, t0, anchor)
    local = sk._transformed(_inverse(_placement(axes, own)))
    if turn:
        rot = frame.T @ _turn(axes[:, 2], t0) @ axes
        if local.plane.z_dir.z < 0:
            # (the kernel turns a profile to face the way the path starts: half a turn about the
            # path's normal, as it did in the world's frame)
            rot = np.diag([-1.0, -1.0, 1.0]) @ rot
    else:
        # (the kernel turns the profile itself, also with orient=False or translational=True: as
        # it did in the world's frame)
        rot = frame.T @ _kernel_turn(_unit(sk.plane.z_dir.to_tuple()), t0) @ axes
    placed = local._transformed(_placement(rot, (0.0, 0.0, 0.0)))  # (its anchor at the origin)
    curves = [c for f in placed.faces() for w in f.wires() for c in w._copy_curves()]
    with _freed(curves), _freed([e._copy_curve() for e in path]) as path_curves, kernel_call("sweep", hint):
        b = ext.planar_path_sweep(curves, path_curves, _AT_ORIGIN)
    return _require_solid(Part._wrap(b), "sweep", hint)._transformed(_placement(frame, start))


def _kernel_turn(normal: np.ndarray, t0: np.ndarray) -> np.ndarray:
    """How the kernel's planar-path sweep turns a profile of this normal in the world's frame
    (PositionProfileCurves): by the smallest rotation to X, then X to the path's start ``t0`` with
    Y to the world Z crossed with it (to Y where it runs mostly along Z)."""
    x = _unit(t0)
    ref = np.array((0.0, 1.0, 0.0)) if abs(x[2]) > abs(x[0]) and abs(x[2]) > abs(x[1]) else np.cross((0.0, 0.0, 1.0), x)
    y = _unit(ref - np.dot(ref, x) * x)
    return np.column_stack([x, y, np.cross(x, y)]) @ _turn(normal, (1.0, 0.0, 0.0))


def _halves(edge: Edge, at: float = 0.5) -> list[Edge]:
    """A closed edge as two edges, split halfway along it (or at the fraction ``at`` of its length)."""
    c = edge._copy_curve()
    try:
        t0, t1 = c.parameter_range()
        u, _ = ext.curve_parameter_at_length(c, t0, at * ext.curve_length(c, t0, t1))
        tm = float(u)
        return [Edge._from_curve(ext.trimmed_curve(c, t0, tm)), Edge._from_curve(ext.trimmed_curve(c, tm, t1))]
    finally:
        ext.delete_curve(c)


# Where a planar path's plane is fitted: its ends, and 16 points between them off the halves and
# quarters.
_PLANARITY_SAMPLES = (0.0, 1.0) + tuple((i + 0.381966) / 16 for i in range(16))


def _is_planar_path(edges: list[Edge]) -> bool:
    """Whether the path lies in a plane: its curves' control points do (a NURBS curve lies in a plane
    exactly where its control points do). Points sampled along it lie in a plane for 3D paths too: a
    chain of helices with an even number of turns each (8 or 16 between samples) was taken for planar
    and went to the mitered sweep, which gave no closed solid for other profiles than circles."""
    poles: list[Any] = []
    for e in edges:
        c = e._copy_curve()
        try:
            poles.extend(ext.curve_data(c, True)["poles"])
        finally:
            ext.delete_curve(c)
    a = np.array(poles, dtype=float)
    a = a - a.mean(axis=0)
    s = np.linalg.svd(a, compute_uv=False)
    return bool(len(s) < 3 or s[-1] <= 1e-7 * max(1.0, s[0]))


@overload
def swing(profile: Sketch | Face, outline: Sketch | Face | Wire | Edge) -> Part: ...
@overload
def swing(profile: Sketch | Face | Wire | Edge, outline: Sketch | Face | Wire | Edge) -> Part | Shell: ...
def swing(profile: Sketch | Face | Wire | Edge, outline: Sketch | Face | Wire | Edge) -> Part | Shell:
    """Swing a profile around an outline: a revolve about Z whose circle is the outline.

    Args:
        profile: Drawn as for a lathe (see :func:`revolve`): in the XZ plane (``Plane.front``), x the
            distance from the Z axis (at least 0), z the height. A region (a sketch, a planar face or a
            closed wire) gives a solid; its edges on the Z axis swing to nothing and are left out, its
            holes are swung and cut out. An open curve gives a surface (a :class:`Shell`).
        outline: A closed curve around the Z axis in a plane parallel to XY (its height does not
            matter), such as ``Ellipse(30, 20)`` or a ``RoundedRectangle``: a single region or a closed
            wire or edge. Every ray from the Z axis must cross it once.

    At each height the section is the outline scaled about the Z axis so that it passes through the
    profile's point on the +X side: the cut of the result by the XZ plane on the +X side is the
    profile. A circle around the origin gives the revolve. The faces are exact (NURBS products of
    the two curves).
    """
    loop, reach = _swing_outline(outline)
    w = _open_curve(profile)
    if w is not None:
        b = _swung(w, loop, reach, "swing", "the profile and outline curves must be B-splines (lines, arcs, splines)")
        with kernel_call("swing"):
            k.stitch_into_solid(b._brep)
        return b
    sk = _as_sketch(profile)
    hint = "the outline must go around the Z axis once and the profile lie beside it (x >= 0) in the XZ plane"
    result: Part | None = None
    for f in sk.faces():
        loops = f.wires()
        piece = _swung_solid(loops[0], loop, reach, hint)
        for h in loops[1:]:
            piece = piece - _swung_solid(h, loop, reach, hint)
        result = piece if result is None else result + piece
    if result is None:
        raise ValueError("swing: the sketch is empty")
    _require_solid(result, "swing", hint)
    result.name, result.color = sk.name, sk.color
    return result


def _swing_samples(e: Edge) -> list[float]:
    return [0.0, 1.0] if e.geom_type == "line" else [i / 48 for i in range(49)]


def _swing_outline(outline: Any) -> tuple[Wire, float]:
    """The outline as a closed wire, and how far from the Z axis it crosses the +X axis. Raises where it
    is not a closed curve in a plane parallel to XY that every ray from the Z axis crosses once."""
    if isinstance(outline, ShapeList):
        outline = outline.one()
    if isinstance(outline, Sketch):
        faces = outline.faces()
        if len(faces) != 1:
            raise ValueError(f"swing: the outline must be one closed curve, got a sketch of {len(faces)} regions")
        outline = faces[0]
    if isinstance(outline, Face):
        loops = outline.wires()
        if len(loops) != 1:
            raise ValueError("swing: the outline must be one closed curve, got a region with holes")
        w = loops[0]
    elif isinstance(outline, Edge):
        w = Wire([outline])
    elif isinstance(outline, Wire):
        w = outline
    else:
        raise TypeError(f"swing: the outline is a sketch, face, wire or edge, got {type(outline).__name__}")
    if not w.is_closed:
        raise ValueError("swing: the outline must be a closed curve")
    box = w.bbox()
    tol = 1e-7 * max(1.0, box.diagonal)
    if box.size.z > tol:
        raise ValueError("swing: the outline must lie in a plane parallel to XY")
    turn, steps, reach = 0.0, [], None
    for e in w.edges():
        ts = _swing_samples(e)
        pts = [e.point_at(t) for t in ts]
        for (t0, p0), (t1, p1) in zip(zip(ts, pts), zip(ts[1:], pts[1:])):
            if math.hypot(p0.x, p0.y) <= tol or math.hypot(p1.x, p1.y) <= tol:
                raise ValueError("swing: the outline must go around the Z axis, not through it")
            step = math.atan2(p0.x * p1.y - p0.y * p1.x, p0.x * p1.x + p0.y * p1.y)
            steps.append(step)
            turn += step
            if reach is None and (p0.y < 0) != (p1.y < 0):
                x = _crossing(e, t0, t1)
                reach = x if x > 0 else None
    if abs(abs(turn) - 2 * math.pi) > 1e-6:
        raise ValueError("swing: the outline must go once around the Z axis")
    if any(step * turn <= 0 for step in steps):
        raise ValueError("swing: every ray from the Z axis must cross the outline once (it turns back around "
                         "the axis, or runs straight away from it)")
    if reach is None or not reach > tol:
        raise ValueError("swing: the outline must cross the +X axis")
    return w, reach


def _crossing(e: Edge, t0: float, t1: float) -> float:
    """x where the edge crosses y = 0 between fractions t0 and t1 (where y changes sign)."""
    below = e.point_at(t0).y < 0
    for _ in range(64):
        tm = 0.5 * (t0 + t1)
        if (e.point_at(tm).y < 0) == below:
            t0 = tm
        else:
            t1 = tm
    return e.point_at(0.5 * (t0 + t1)).x


def _swing_profile(loop: Wire, what: str) -> list[Edge]:
    """The edges of a profile loop or curve that do not lie on the Z axis; raises where it is not in the
    XZ plane beside the axis."""
    box = loop.bbox()
    tol = 1e-7 * max(1.0, box.diagonal)
    if box.size.y > tol or abs(box.min.y) > tol:
        raise ValueError(f"{what}: the profile must lie in the XZ plane (draw it in XY, x the distance from the "
                         f"Z axis and y the height, and place it with .on(Plane.front))")
    if box.min.x < -tol:
        raise ValueError(f"{what}: the profile must lie beside the Z axis (x >= 0), it reaches x = {box.min.x:.6g}")
    edges = [e for e in loop.edges() if any(abs(e.point_at(t).x) > tol for t in _swing_samples(e) + [0.5])]
    if not edges:
        raise ValueError(f"{what}: the profile lies on the Z axis")
    return edges


def _swung(profile: Wire, outline: Wire, reach: float, what: str, hint: str) -> Shell:
    """The swung faces of a profile curve around the outline, not stitched."""
    edges = _swing_profile(profile, what)
    with kernel_call(what, hint), _freed([e._copy_curve() for e in edges]) as pc, \
            _freed(outline._copy_curves()) as oc:
        b = ext.swung(pc, oc, 1.0 / reach)
    return Shell._wrap(b)


def _swung_solid(loop: Wire, outline: Wire, reach: float, hint: str) -> Part:
    shell = _swung(loop, outline, reach, "swing", hint)
    with kernel_call("swing", hint):
        _, is_solid, _, _, _ = k.stitch_into_solid(shell._brep)
    if not is_solid:
        raise ModelingError(f"swing: the swung faces do not close into a solid; {hint}")
    return _require_solid(Part._wrap(shell._copy_brep()), "swing", hint)


@overload
def fillet(edges: Vertex | Sequence[Vertex], radius: float) -> Sketch: ...
@overload
def fillet(edges: Any, radius: float | tuple[float, float] | Sequence[float], **kwargs: Any) -> Part: ...
def fillet(edges: Any, radius: float | tuple[float, float] | Sequence[float], **kwargs: Any) -> Part | Sketch:
    """Round edges of the part they belong to (see :meth:`Part.fillet`), or corners of the
    sketch they belong to: ``fillet(s.vertices().concave(), 2)`` (see :meth:`Sketch.fillet`)."""
    sk = _owner_sketch(edges)
    if sk is not None:
        return sk.fillet(radius, edges)  # type: ignore[arg-type]
    return _owner_part(edges).fillet(edges, radius, **kwargs)


@overload
def chamfer(edges: Vertex | Sequence[Vertex], length: float) -> Sketch: ...
@overload
def chamfer(edges: Any, length: float, **kwargs: Any) -> Part: ...
def chamfer(edges: Any, length: float, **kwargs: Any) -> Part | Sketch:
    """Bevel edges of the part they belong to (see :meth:`Part.chamfer`), or corners of the
    sketch they belong to (see :meth:`Sketch.chamfer`)."""
    sk = _owner_sketch(edges)
    if sk is not None:
        return sk.chamfer(length, edges)
    return _owner_part(edges).chamfer(edges, length, **kwargs)


def _owner_sketch(items: Any) -> Sketch | None:
    """The sketch that vertices belong to (None if the items are not vertices)."""
    from .shapes import Vertex

    flat = [items] if isinstance(items, Vertex) else list(items) if isinstance(items, (list, tuple)) else None
    if not flat or not all(isinstance(v, Vertex) for v in flat):
        return None
    owner = flat[0]._owner
    if not isinstance(owner, Sketch) or any(v._owner is not owner for v in flat):
        raise ValueError("these vertices do not all belong to one sketch; call sketch.fillet(radius, vertices) "
                         "or sketch.chamfer(length, vertices)")
    return owner


def _owner_part(items: Any) -> Part:
    flat = _flatten_edges(items) if not isinstance(items, Face) else [items]
    owner = getattr(flat[0], "_owner", None) if flat else None
    if not isinstance(owner, Part):
        raise ValueError("these edges do not belong to a part; call part.fillet(edges, ...) instead")
    return owner


def shell(part: Part, thickness: float, openings: Any = None, *, outward: bool = False, corners: str | None = None,
          walls: Any = None) -> Part:
    """Hollow out a part (see :meth:`Part.shell`)."""
    return part.shell(thickness, openings, outward=outward, corners=corners, walls=walls)


@overload
def offset(shape: Sketch, distance: float, **kwargs: Any) -> Sketch: ...
@overload
def offset(shape: Part, distance: float, **kwargs: Any) -> Part: ...
@overload
def offset(shape: Shell | Face, distance: float, **kwargs: Any) -> Shell: ...
@overload
def offset(shape: Wire, distance: float, **kwargs: Any) -> Wire: ...
@overload
def offset(shape: Edge, distance: float, **kwargs: Any) -> Edge: ...
def offset(shape: Part | Sketch | Shell | Face | Wire | Edge, distance: float,
           **kwargs: Any) -> Part | Sketch | Shell | Wire | Edge:
    """Grow or shrink a part or a sketch by ``distance`` (also ``corners``: for a part
    ``"sharp" | "round"``, see :meth:`Part.offset`; for a sketch ``"round" | "sharp" | "chamfer"``,
    see :meth:`Sketch.offset`), move a sheet or a face along its normals (:meth:`Shell.offset`,
    :meth:`Face.offset`: a sheet), or move a wire or an edge sideways (:meth:`Wire.offset`,
    :meth:`Edge.offset`)."""
    if not callable(getattr(shape, "offset", None)):
        raise TypeError(f"offset takes a part, a sketch, a sheet (Shell), a face, a wire or an edge, not a "
                        f"{type(shape).__name__}")
    return shape.offset(distance, **kwargs)


def mirror(shape: _S, plane: Plane = Plane.XZ) -> _S:
    """A mirrored copy of a shape."""
    return shape.mirror(plane)


@overload
def split(part: Part, plane: Plane | Face | Shell, keep: Literal["both"]) -> tuple[Part, Part]: ...
@overload
def split(part: Part, plane: Plane | Face | Shell, keep: Literal["above", "below"] = ...) -> Part: ...
def split(part: Part, plane: Plane | Face | Shell, keep: str = "above") -> Part | tuple[Part, Part]:
    """Cut a part with a plane or along a sheet (see :meth:`Part.split`)."""
    return part.split(plane, keep)


def merge(*parts: Part | Sequence[Part]) -> Part:
    """Parts as one part made of cells: overlaps become cells of their own, touching cells share
    their faces (see :meth:`Part.merge`; ``cells()`` gives them as parts)."""
    flat: list[Any] = []
    for p in parts:
        flat.extend([p] if isinstance(p, Shape) else list(p))
    if len(flat) < 2:
        raise ValueError(f"merge needs two or more parts, got {len(flat)}")
    if not isinstance(flat[0], Part):
        raise TypeError(f"merge takes parts, not a {type(flat[0]).__name__}")
    return flat[0].merge(*flat[1:])


def section(part: Part, plane: Plane | Face = Plane.XY) -> Sketch:
    """Cross-section of a part (see :meth:`Part.section`)."""
    return part.section(plane)


def thicken(surface: Shell | Face, thickness: float, *, both: bool = False) -> Part:
    """Turn a face or sheet into a solid of ``thickness`` (``both``: half of it to each side; see
    :meth:`Shell.thicken`)."""
    if isinstance(surface, Part) or not isinstance(surface, (Shell, Face)):
        raise TypeError(f"thicken takes a face or a sheet (Shell, Sketch), not a {type(surface).__name__}; "
                        f"use shell() or offset() for parts")
    sh = surface.to_shell() if isinstance(surface, Face) else surface
    return sh.thicken(thickness, both=both)
