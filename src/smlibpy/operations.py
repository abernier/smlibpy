"""Operations as functions.

Each function is also available as a method (``extrude(sketch, 5)`` is
``sketch.extrude(5)``). The functions read naturally when the target is implied
by a selection: ``fillet(part.edges().parallel_to(Z), 2)`` returns the filleted part
the edges belong to.
"""

from __future__ import annotations

import math
import warnings
from typing import Any, Sequence

import numpy as np

from ._kernel import BrepHandle, KernelError, ModelingError, ext, k, kernel_call
from .geometry import Axis, Plane, Vector, VectorLike, Z, _direction, _vec
from .shapes import (Edge, Face, Part, Shape, ShapeList, Shell, Sketch, Wire, _as_plane, _flatten_edges, _flatten_faces,
                     _require_solid, _revolve_axis_angle)

__all__ = [
    "extrude",
    "revolve",
    "loft",
    "sweep",
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


def extrude(profile: Sketch | Face | Wire | Edge, amount: float, *, both: bool = False, taper: float = 0.0,
            direction: Axis | VectorLike | None = None) -> Part | Shell:
    """Extrude a sketch, a planar face or a closed wire into a solid (see :meth:`Sketch.extrude`).

    An open curve extrudes into a surface (a :class:`Shell`), along ``direction`` (an axis or a
    vector) or the normal of the curve's plane.
    """
    w = _open_curve(profile)
    if w is not None:
        d = _direction(direction, "extrude") if direction is not None else _curve_direction(w)
        curves = w._copy_curves()
        start = 0.0
        if both:
            w = w.translate(-d * abs(amount))
            curves = w._copy_curves()
            amount = 2 * abs(amount)
        sign = 1.0 if amount > 0 else -1.0
        with kernel_call("extrude"):
            b = k.linear_sweep(curves, (d * sign).to_tuple(), abs(float(amount)), cap_ends=False)
        del start
        return Shell._wrap(b)
    return _as_sketch(profile).extrude(amount, both=both, taper=taper, direction=direction)


def revolve(profile: Sketch | Face | Wire | Edge, axis: Axis | None = None, angle: float = 360.0) -> Part | Shell:
    """Revolve a sketch about an axis into a solid (see :meth:`Sketch.revolve`).

    An open curve revolves into a surface of revolution (a :class:`Shell`).
    """
    w = _open_curve(profile)
    if w is not None:
        ax, angle = _revolve_axis_angle(axis if axis is not None else Z, angle)
        with kernel_call("revolve", "the axis must not cross the curve"):
            b = k.rotational_sweep(w._copy_curves(), ax.origin.to_tuple(), ax.direction.to_tuple(), float(angle),
                                   cap_ends=False)
        return Shell._wrap(b)
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


def _loft_solid(loops: Sequence[Wire], degree: int) -> Part:
    counts: list[int] = []
    curves: list[Any] = []
    for w in loops:
        c = w._copy_curves()
        curves.extend(c)
        counts.append(len(c))
    hint = "sections should be closed, ordered and not intersect each other"
    with kernel_call("loft", hint):
        b = k.create_skin_primitive(counts, curves, degree, True)
    return _require_solid(Part._wrap(b), "loft", hint)


def loft(sections: Sequence[Sketch | Face | Wire | Edge], *, ruled: bool = False, smooth: bool = True) -> Part | Shell:
    """A solid through a sequence of cross sections, or a surface through open curves.

    Args:
        sections: Two or more sections in order: sketches, planar faces or closed wires
            for a solid; open edges or wires for a surface (a :class:`Shell`). Sections
            with holes make a hollow solid; every section needs the same number of holes.
        ruled: Straight transitions between neighbouring sections.
        smooth: With four or more sections, pass through them with a cubic surface
            (``False``: quadratic). Three sections always give a quadratic one.
    """
    if len(sections) < 2:
        raise ValueError("loft needs at least two sections")
    opened = [_open_curve(s) for s in sections]
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
    result = _loft_solid([outer for outer, _ in loops], degree)
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
            result = result - _loft_solid(chain, degree)
    return result


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


def _profile_frame(sk: Sketch, tangent: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The axes of the profile's plane (x: the world X axis seen in the plane, Y where X is its
    normal; z: the normal, the way the path starts) and the anchor: the center of the profile's
    box along them. For a sketch in the XY plane, the center of its bounding box."""
    n = _unit(sk.plane.z_dir.to_tuple())
    if np.dot(n, tangent) < 0:
        n = -n
    ref = np.array((1.0, 0.0, 0.0)) if abs(n[0]) < 0.9 else np.array((0.0, 1.0, 0.0))
    x = _unit(ref - np.dot(ref, n) * n)
    axes = np.column_stack([x, np.cross(n, x), n])
    origin = np.array(sk.plane.origin.to_tuple())
    center = np.array(sk._transformed(_inverse(_placement(axes, origin))).bbox().center.to_tuple())
    center[2] = 0.0
    return axes, origin + axes @ center


def _swept(sk: Sketch, edge: Edge, placement: np.ndarray, translational: bool, cap: bool = True) -> Part | Shell:
    """A profile in its own frame (``sk``: in the XY plane, its anchor at the origin) swept along
    an edge, placed by ``placement`` at the edge's start."""
    local = edge._transformed(_inverse(placement))
    curves = [c for f in sk.faces() for w in f.wires() for c in w._copy_curves()]
    path_curve = local._copy_curve()
    hint = "the profile may be too large for the path's curvature"
    try:
        with kernel_call("sweep", hint):
            b = ext.curve_sweep(curves, path_curve, cap, True, False, translational, None, None)
    finally:
        ext.delete_curve(path_curve)
        for c in curves:
            ext.delete_curve(c)
    body = Part._wrap(b) if cap else Shell._wrap(b)
    return body._transformed(placement)


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
    x = axes @ (ends[1 - far] - ends[far])
    x = _unit(x - np.dot(x, te) * te)
    return np.column_stack([x, np.cross(te, x), te])


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


def sweep(profile: Sketch | Face | Wire, path: Edge | Wire, *, orient: bool = True, translational: bool = False,
          sharp_corners: bool | None = None) -> Part:
    """Sweep a profile along a path.

    The profile is moved so that the center of its box (along the axes of its plane) sits at the
    start of the path and (with ``orient``) turned to face along the path, so profiles can be
    drawn anywhere, usually in the XY plane::

        tube = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)))
        rail = sweep(Rectangle(4, 2), Helix(pitch=10, height=40, radius=20))

    Edges of a path that meet tangentially are swept as one; at a corner of a path that is not
    planar, the profile goes on turned by the smallest rotation from one tangent to the next. Where
    the kernel cannot sweep an open path of several edges so, each edge is swept on its own, turned
    to its own start, and the pieces are fused (with a ``RuntimeWarning`` unless the profile is
    round: it turns where the edges meet).

    Args:
        profile: A sketch (holes allowed), a planar face or a closed wire.
        path: An edge, or a wire of connected edges.
        orient: Turn the profile to be perpendicular to the path at its start.
        translational: Keep the profile's orientation fixed instead of turning it with the path.
        sharp_corners: For paths of several edges: miter the corners of a planar path
            (default for planar paths); ``False`` sweeps the path piece by piece (each run of
            tangent edges in one go) and joins the pieces.
    """
    edges = _path_edges(path)
    w = _open_curve(profile)
    if w is not None:
        # an open profile sweeps into a surface (also along a closed edge: only solids come out
        # inside out there)
        if len(edges) != 1:
            raise ValueError("surface sweeps need a single-edge path")
        pc = edges[0]._copy_curve()
        curves = w._copy_curves()
        try:
            with kernel_call("sweep"):
                b = ext.curve_sweep(curves, pc, False, True, orient, translational, None, None)
        finally:
            ext.delete_curve(pc)
            for c in curves:
                ext.delete_curve(c)
        return Shell._wrap(b)  # type: ignore[return-value]
    sk = _as_sketch(profile)
    closed = edges[0].start.is_close(edges[-1].end, 1e-6 * max(1.0, edges[0].length))
    tangent_closure = closed and np.linalg.norm(_tangent(edges[-1], 1.0) - _tangent(edges[0], 0.0)) <= 1e-6
    planar = _is_planar_path(edges)
    halved = len(edges) == 1 and edges[0].is_closed and (planar or not tangent_closure)
    if halved:
        # The kernel sweeps a profile along a closed single-edge path inside out (it caps the
        # ends where they meet); along the same path in two halves it works.
        edges = _halves(edges[0])
    if sharp_corners is None:
        sharp_corners = planar
    if sharp_corners and len(edges) > 1:
        if not planar:
            raise ValueError("sharp-cornered sweeps need a planar path")
        oriented = _oriented_to(sk, edges[0].tangent_at(0.0)) if orient and not translational else sk
        curves = [c for f in oriented.faces() for w in f.wires() for c in w._copy_curves()]
        path_curves = [e._copy_curve() for e in edges]
        hint = "the profile may be too large for the path's corners"
        try:
            with kernel_call("sweep", hint):
                b = k.sweep_along_planar_path(curves, path_curves, move_profile=True)
        finally:
            for c in curves:
                ext.delete_curve(c)
        return _require_solid(Part._wrap(b), "sweep", hint)
    t0 = _tangent(edges[0], 0.0)
    axes, anchor = _profile_frame(sk, t0)
    local = sk._transformed(_inverse(_placement(axes, anchor)))
    if orient and not translational:
        axes = _turn(axes[:, 2], t0) @ axes
    hint = "the profile may be too large for the path's curvature"
    try:
        return _carried_sweep(sk, local, edges, axes, anchor, halved, tangent_closure, translational, hint)
    except ModelingError as err:
        # An open path of several edges the kernel cannot sweep so (a circle along a 3D fillet
        # polyline joined into one curve fails at random) is swept edge by edge, each edge turned
        # afresh, as before the profile was carried along. Not closed paths: fused so, the pieces
        # of kinked loops crashed the kernel (4 of 60 random loops; carried, they raise).
        if closed or len(edges) < 2:
            raise
        try:
            out = _afresh_sweep(local, edges, axes, orient, translational, hint)
        except ModelingError:
            raise err from None
        if not _round(sk, anchor):
            warnings.warn(f"sweep: the profile could not be carried along the path ({err}); each of its "
                          f"{len(edges)} edges was swept turned to its own start instead, so the profile turns "
                          "where they meet", RuntimeWarning, stacklevel=2)
        return out


def _carried_sweep(sk: Sketch, local: Sketch, edges: list[Edge], axes: np.ndarray, anchor: np.ndarray, halved: bool,
                   tangent_closure: bool, translational: bool, hint: str) -> Part:
    """A profile carried along a path: tangent edges in one go, the frame carried across corners."""
    chains = [[e] for e in edges] if halved else _g1_chains(edges)
    if tangent_closure and len(chains) == 1 and _round(sk, anchor):
        # (a profile that turns into itself, as in two halves before: exact)
        chains = [[e] for e in _halves(_joined(edges))]
    elif tangent_closure and len(chains) == 1:
        # A closed path without a corner: swept in one go and closed where its ends meet (the
        # kernel spreads the turn of its frame around such a path, so they meet; in two halves a
        # rectangle turned by 10 degrees at the halfway point and 44 at the start).
        chain = _joined(edges)
        tube = _swept(local, chain, _placement(axes, chain.point_at(0.0).to_tuple()), translational, cap=False)
        with kernel_call("sweep", hint):
            k.stitch_into_solid(tube._brep)
        return _require_solid(Part._wrap(tube._copy_brep()), "sweep", hint)
    chains = [_joined(c) for c in chains]
    size = sk.bbox().diagonal
    out: Part | None = None
    for i, e in enumerate(chains):
        if i:
            axes = _carried(chains[i - 1], placement, translational, size)
            if not translational:
                axes = _turn(axes[:, 2], _tangent(e, 0.0)) @ axes
        placement = _placement(axes, e.point_at(0.0).to_tuple())
        piece = _require_solid(_swept(local, e, placement, translational), "sweep", hint)  # type: ignore[arg-type]
        out = piece if out is None else out + piece
    return out  # type: ignore[return-value]


def _afresh_sweep(local: Sketch, pieces: list[Edge], axes: np.ndarray, orient: bool, translational: bool,
                  hint: str) -> Part:
    """The pieces swept on their own and fused, each turned afresh: by the smallest rotation from
    the path's start tangent, either way along it, to the piece's own (the profile does not keep
    its orientation where they meet; the way pieces were swept before the frame was carried)."""
    t0 = _tangent(pieces[0], 0.0)
    out: Part | None = None
    for e in pieces:
        turned = axes
        if orient and not translational:
            t = _tangent(e, 0.0)
            turned = _turn(t0 if np.dot(t0, t) >= 0 else -t0, t) @ axes
        piece = _swept(local, e, _placement(turned, e.point_at(0.0).to_tuple()), translational)
        piece = _require_solid(piece, "sweep", hint)  # type: ignore[arg-type]
        out = piece if out is None else out + piece
    return out  # type: ignore[return-value]


def _halves(edge: Edge) -> list[Edge]:
    """A closed edge as two edges, split halfway along it."""
    c = edge._copy_curve()
    try:
        t0, t1 = c.parameter_range()
        u, _ = ext.curve_parameter_at_length(c, t0, 0.5 * ext.curve_length(c, t0, t1))
        tm = float(u)
        return [Edge._from_curve(ext.trimmed_curve(c, t0, tm)), Edge._from_curve(ext.trimmed_curve(c, tm, t1))]
    finally:
        ext.delete_curve(c)


# Where a path is tested for lying in a plane: its ends, and 16 points between them off the halves
# and quarters. At 0, 1/4, 1/2 and 3/4 of a closed edge, symmetric 3D loops lie in a plane
# (Spline(*pts, pts[0]) through (20 cos a, 20 sin a, 6 sin 2a)): taken for planar, their halves went
# to the planar-path sweep, which gave no closed solid.
_PLANARITY_SAMPLES = (0.0, 1.0) + tuple((i + 0.381966) / 16 for i in range(16))


def _is_planar_path(edges: list[Edge]) -> bool:
    a = np.array([e.point_at(t).to_tuple() for e in edges for t in _PLANARITY_SAMPLES])
    a = a - a.mean(axis=0)
    s = np.linalg.svd(a, compute_uv=False)
    return bool(s[-1] <= 1e-7 * max(1.0, s[0]))


def fillet(edges: Any, radius: float | tuple[float, float] | Sequence[float], **kwargs: Any) -> Part | Sketch:
    """Round edges of the part they belong to (see :meth:`Part.fillet`), or corners of the
    sketch they belong to: ``fillet(s.vertices().concave(), 2)`` (see :meth:`Sketch.fillet`)."""
    sk = _owner_sketch(edges)
    if sk is not None:
        return sk.fillet(radius, edges)  # type: ignore[arg-type]
    return _owner_part(edges).fillet(edges, radius, **kwargs)


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


def offset(shape: Part | Sketch | Shell | Face, distance: float, **kwargs: Any) -> Any:
    """Grow or shrink a part or a sketch by ``distance`` (also ``corners``: for a part
    ``"sharp" | "round"``, see :meth:`Part.offset`; for a sketch ``"round" | "sharp" | "chamfer"``,
    see :meth:`Sketch.offset`), or move a sheet or a face along its normals (:meth:`Shell.offset`,
    :meth:`Face.offset`: a sheet)."""
    if not callable(getattr(shape, "offset", None)):
        raise TypeError(f"offset takes a part, a sketch, a sheet (Shell) or a face, not a {type(shape).__name__}")
    return shape.offset(distance, **kwargs)


def mirror(shape: Shape, plane: Plane = Plane.XZ) -> Any:
    """A mirrored copy of a shape."""
    return shape.mirror(plane)


def split(part: Part, plane: Plane | Face, keep: str = "above") -> Any:
    """Cut a part with a plane (see :meth:`Part.split`)."""
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
