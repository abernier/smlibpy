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
    round: it turns where the edges meet). A closed path it cannot sweep so (the fuse where the
    halves of a loop closed with a kink cross) is swept in pieces as before 0.5.0, where that puts
    the profile on the path. Faces without area that a fuse leaves are taken out (or the sweep
    raises ``ModelingError``). The corners of a planar path of several edges are mitered, the
    profile placed as on any other path.

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
    # the pieces a path was swept in before 0.5.0: its edges, or the halves of a closed edge
    whole = edges[0] if len(edges) == 1 and edges[0].is_closed else None
    pieces = _halves(whole) if whole is not None else edges
    halved = len(edges) == 1 and edges[0].is_closed and (planar or not tangent_closure)
    if halved:
        # The kernel sweeps a profile along a closed single-edge path inside out (it caps the
        # ends where they meet); along the same path in two halves it works.
        edges = pieces
    if sharp_corners is None:
        sharp_corners = planar
    if sharp_corners and len(edges) > 1:
        if not planar:
            raise ValueError("sharp-cornered sweeps need a planar path")
        return _mitred_sweep(sk, edges, closed, orient and not translational)
    t0 = _tangent(edges[0], 0.0)
    axes, anchor = _profile_frame(sk, t0)
    local = sk._transformed(_inverse(_placement(axes, anchor)))
    if orient and not translational:
        axes = _turn(axes[:, 2], t0) @ axes
    hint = "the profile may be too large for the path's curvature"
    try:
        return _carried_sweep(sk, local, edges, axes, anchor, halved, tangent_closure, translational, hint)
    except ModelingError as err:
        if len(pieces) < 2:
            raise
        if closed:
            # A closed path the kernel cannot sweep carried along (the fuse where the halves of a
            # loop closed with a kink cross fails for some loops) is swept as before 0.5.0; a round
            # profile also turned about its center (the same profile, its seam elsewhere: the fuse
            # goes for most loops where it failed with the seam where it was).
            try:
                out = _former_sweep(sk, anchor, pieces, orient, translational, hint)
            except ModelingError:
                out = None
            if out is None and _round(sk, anchor):
                tries = [(edges, angle) for angle in _SEAM_TURNS]
                if halved and not tangent_closure and whole is not None:
                    # (a loop closed with a kink also split elsewhere than halfway: the same body)
                    tries += [(_halves(whole, at), 0.0) for at in (0.4, 0.6)]
                for split, angle in tries:
                    try:
                        turned = local.rotate(Axis((0, 0, 0), (0, 0, 1)), angle) if angle else local
                        out = _carried_sweep(sk, turned, split, axes, anchor, halved, tangent_closure, translational, hint)
                        break
                    except ModelingError:
                        pass
            if out is None:
                raise err from None
            return out
        # An open path of several edges the kernel cannot sweep so (a circle along a 3D fillet
        # polyline joined into one curve fails at random) is swept edge by edge, each edge turned
        # afresh, as before the profile was carried along.
        try:
            out = _afresh_sweep(local, edges, axes, orient, translational, hint)
        except ModelingError:
            raise err from None
        if not _round(sk, anchor):
            warnings.warn(f"sweep: the profile could not be carried along the path ({err}); each of its "
                          f"{len(edges)} edges was swept turned to its own start instead, so the profile turns "
                          "where they meet", RuntimeWarning, stacklevel=2)
        return out


# How far a round profile is turned about its center (degrees) where a closed path fails with it as
# it is: with its seam turned by one of these (or the loop split elsewhere), most random loops
# closed with a kink that failed go (circles of radius 1.5 along 60 random loops: all 60, 37 before
# 0.5.0).
_SEAM_TURNS = (20.0, -20.0, 45.0, -45.0, 70.0, -70.0, 100.0, -100.0, 135.0, -135.0)


def _carried_sweep(sk: Sketch, local: Sketch, edges: list[Edge], axes: np.ndarray, anchor: np.ndarray, halved: bool,
                   tangent_closure: bool, translational: bool, hint: str) -> Part:
    """A profile carried along a path: tangent edges in one go, the frame carried across corners."""
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
        tube = _swept(local, chain, _placement(axes, chain.point_at(0.0).to_tuple()), translational, cap=False)
        with kernel_call("sweep", hint):
            k.stitch_into_solid(tube._brep)
        return _sound(Part._wrap(tube._copy_brep()), hint)
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
    return out if len(chains) < 2 else _sound(out, hint)  # type: ignore[arg-type,return-value]


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
# that turns back, it returned no closed solid. And it moves the profile by the center of its box
# along the world axes, so an asymmetric profile turned off them went beside the path. So the path
# is swept in a frame of its own (its plane horizontal, its start along X) with the profile turned
# as on any other path, and the body is placed back.
def _path_normal(edges: list[Edge]) -> np.ndarray:
    """The normal of a planar path's plane: up (or towards +Y, +X) where that is not ambiguous."""
    a = np.array([e.point_at(t).to_tuple() for e in edges for t in _PLANARITY_SAMPLES])
    _, _, vt = np.linalg.svd(a - a.mean(axis=0))
    n = vt[2] / np.linalg.norm(vt[2])
    for i in (2, 1, 0):
        if abs(n[i]) > 1e-9:
            return n if n[i] > 0 else -n
    return n


def _mitred_sweep(sk: Sketch, edges: list[Edge], closed: bool, turn: bool) -> Part:
    """A profile swept along a planar path of several edges with mitered corners."""
    hint = "the profile may be too large for the path's corners"
    t0 = _tangent(edges[0], 0.0)
    normal = _path_normal(edges)
    frame = np.column_stack([t0, np.cross(normal, t0), normal])  # the path's own: start along x, plane xy
    start = np.array(edges[0].point_at(0.0).to_tuple())
    to_path = _inverse(_placement(frame, start))
    path = [e._transformed(to_path) for e in edges]
    axes, anchor = _profile_frame(sk, t0)
    local = sk._transformed(_inverse(_placement(axes, anchor)))
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
    placed = local._transformed(_placement(rot, (0.0, 0.0, 0.0)))
    # The kernel puts the center of the profile's box along the frame's axes on the path: the
    # profile's own anchor, unless it is turned off them (by the smallest rotation to a path that
    # does not start along X, Y or Z) and not symmetric. Then the path is moved by the difference:
    # along its normal, and to the side (its offset curve).
    mid = np.array(placed.bbox().center.to_tuple())
    if abs(mid[1]) > 1e-9 * max(1.0, sk.bbox().diagonal):
        offset = _offset_path(path, float(mid[1]), closed)
        if offset is None:
            warnings.warn("sweep: the profile sits on this path by the center of its box along the path's "
                          "plane, not its own: the path's edges cannot be offset (only lines and arcs can)",
                          RuntimeWarning, stacklevel=3)
        else:
            path = offset
    if abs(mid[2]) > 1e-9 * max(1.0, sk.bbox().diagonal):
        path = [e._transformed(_placement(np.eye(3), (0.0, 0.0, float(mid[2])))) for e in path]
    curves = [c for f in placed.faces() for w in f.wires() for c in w._copy_curves()]
    path_curves = [e._copy_curve() for e in path]
    try:
        with kernel_call("sweep", hint):
            b = k.sweep_along_planar_path(curves, path_curves, move_profile=True)
    finally:
        for c in curves:
            ext.delete_curve(c)
    return _require_solid(Part._wrap(b), "sweep", hint)._transformed(_placement(frame, start))


def _kernel_turn(normal: np.ndarray, t0: np.ndarray) -> np.ndarray:
    """How the kernel's planar-path sweep turns a profile of this normal in the world's frame
    (PositionProfileCurves): by the smallest rotation to X, then X to the path's start ``t0`` with
    Y to the world Z crossed with it (to Y where it runs mostly along Z)."""
    x = _unit(t0)
    ref = np.array((0.0, 1.0, 0.0)) if abs(x[2]) > abs(x[0]) and abs(x[2]) > abs(x[1]) else np.cross((0.0, 0.0, 1.0), x)
    y = _unit(ref - np.dot(ref, x) * x)
    return np.column_stack([x, y, np.cross(x, y)]) @ _turn(normal, (1.0, 0.0, 0.0))


def _offset_path(path: list[Edge], d: float, closed: bool) -> list[Edge] | None:
    """A path in the XY plane of lines and arcs offset by ``d`` to the left (along Z x the
    tangent), the offset edges extended or cut back to where they meet at corners. None where an
    edge is neither, an arc would lose its radius, or offset edges do not meet at a corner."""
    from .curves import Line, ThreePointArc

    left = lambda t: np.array((-t[1], t[0]))  # noqa: E731
    xy = lambda v: np.array(v.to_tuple()[:2])  # noqa: E731
    items: list[list[Any]] = []  # [kind, start, end, center, radius, ccw]
    for e in path:
        t0, t1 = _tangent(e, 0.0)[:2], _tangent(e, 1.0)[:2]
        p, q = xy(e.start), xy(e.end)
        if e.geom_type == "line":
            items.append(["line", p + d * left(t0), q + d * left(t1), None, None, None])
        elif e.geom_type == "circle":
            c, r = xy(e.arc_center), e.radius
            ccw = (p - c)[0] * t0[1] - (p - c)[1] * t0[0] > 0
            r2 = r - d if ccw else r + d
            if not r2 > 1e-9 * r:
                return None
            items.append(["arc", c + (p - c) * r2 / r, c + (q - c) * r2 / r, c, r2, ccw])
        else:
            return None
    joints = list(range(len(items) - 1)) + ([len(items) - 1] if closed else [])
    for i in joints:
        a, b = items[i], items[(i + 1) % len(items)]
        if np.linalg.norm(_tangent(path[i], 1.0) - _tangent(path[(i + 1) % len(path)], 0.0)) <= 1e-6:
            a[2] = b[1] = 0.5 * (a[2] + b[1])  # (tangent: the offset ends meet)
            continue
        corner = _meet(a, b, 0.5 * (a[2] + b[1]))
        if corner is None:
            return None
        a[2], b[1] = corner, corner
    out: list[Edge] = []
    for kind, p, q, c, r, ccw in items:
        if np.linalg.norm(q - p) <= 1e-9 * max(1.0, np.linalg.norm(p)):
            return None
        if kind == "line":
            out.append(Line((p[0], p[1], 0.0), (q[0], q[1], 0.0)))
            continue
        a0, a1 = (math.atan2(*(v - c)[::-1]) for v in (p, q))
        span = (a1 - a0) % (2 * math.pi) if ccw else -((a0 - a1) % (2 * math.pi))
        m = c + r * np.array((math.cos(a0 + span / 2), math.sin(a0 + span / 2)))
        out.append(ThreePointArc((p[0], p[1], 0.0), (m[0], m[1], 0.0), (q[0], q[1], 0.0)))
    return out


def _meet(a: list[Any], b: list[Any], near: np.ndarray) -> np.ndarray | None:
    """Where the line or circle of offset edge a meets that of b, nearest to ``near``."""

    def line(item: list[Any]) -> tuple[np.ndarray, np.ndarray]:
        return item[1], item[2] - item[1]

    if a[0] == "line" and b[0] == "line":
        (p, u), (q, v) = line(a), line(b)
        det = u[0] * v[1] - u[1] * v[0]
        if abs(det) <= 1e-12 * np.linalg.norm(u) * np.linalg.norm(v):
            return None
        s = ((q - p)[0] * v[1] - (q - p)[1] * v[0]) / det
        return p + s * u
    if a[0] == "arc" and b[0] == "arc":
        c1, r1, c2, r2 = a[3], a[4], b[3], b[4]
        dist = np.linalg.norm(c2 - c1)
        if not dist > 0 or dist > r1 + r2 or dist < abs(r1 - r2):
            return None
        x = (dist * dist + r1 * r1 - r2 * r2) / (2 * dist)
        h = math.sqrt(max(r1 * r1 - x * x, 0.0))
        e = (c2 - c1) / dist
        base = c1 + x * e
        cands = [base + h * np.array((-e[1], e[0])), base - h * np.array((-e[1], e[0]))]
    else:
        ln, arc = (a, b) if a[0] == "line" else (b, a)
        (p, u), c, r = line(ln), arc[3], arc[4]
        A, B, C = u @ u, 2 * u @ (p - c), (p - c) @ (p - c) - r * r
        disc = B * B - 4 * A * C
        if disc < 0:
            return None
        cands = [p + s * u for s in ((-B + math.sqrt(disc)) / (2 * A), (-B - math.sqrt(disc)) / (2 * A))]
    return min(cands, key=lambda v: float(np.linalg.norm(v - near)))


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


def chamfer(edges: Any, length: float) -> Part | Sketch:
    """Bevel edges of the part they belong to (see :meth:`Part.chamfer`), or corners of the
    sketch they belong to (see :meth:`Sketch.chamfer`)."""
    sk = _owner_sketch(edges)
    if sk is not None:
        return sk.chamfer(length, edges)
    return _owner_part(edges).chamfer(edges, length)


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


def shell(part: Part, thickness: float, openings: Any = None, *, outward: bool = False) -> Part:
    """Hollow out a part (see :meth:`Part.shell`)."""
    return part.shell(thickness, openings, outward=outward)


def offset(shape: Part | Sketch, distance: float, **kwargs: Any) -> Any:
    """Grow or shrink a part or a sketch by ``distance`` (for a sketch also
    ``corners="round" | "sharp" | "chamfer"``, see :meth:`Sketch.offset`)."""
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


def thicken(surface: Shell | Face, thickness: float) -> Part:
    """Turn a face or sheet into a solid of ``thickness``."""
    if isinstance(surface, Part) or not isinstance(surface, (Shell, Face)):
        raise TypeError(f"thicken takes a face or a sheet (Shell, Sketch), not a {type(surface).__name__}; "
                        f"use shell() or offset() for parts")
    sh = surface.to_shell() if isinstance(surface, Face) else surface
    return sh.thicken(thickness)
