"""Operations as functions.

Each function is also available as a method (``extrude(sketch, 5)`` is
``sketch.extrude(5)``). The functions read naturally when the target is implied
by a selection: ``fillet(part.edges().parallel_to(Z), 2)`` returns the filleted part
the edges belong to.
"""

from __future__ import annotations

from typing import Any, Sequence

from ._kernel import BrepHandle, KernelError, ext, k, kernel_call
from .geometry import Axis, Plane, Vector, VectorLike, Z, _vec
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
            direction: VectorLike | None = None) -> Part | Shell:
    """Extrude a sketch, a planar face or a closed wire into a solid (see :meth:`Sketch.extrude`).

    An open curve extrudes into a surface (a :class:`Shell`), along ``direction`` or the
    normal of the curve's plane.
    """
    w = _open_curve(profile)
    if w is not None:
        d = _vec(direction).normalized() if direction is not None else _curve_direction(w)
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
        if all(len(w.edges()) == 1 for w in opened):  # type: ignore[union-attr]
            curves = [w.edges()[0]._copy_curve() for w in opened]  # type: ignore[union-attr]
            try:
                with kernel_call("loft", "curves should run in the same direction"):
                    srf = k.create_skin_surface(curves)
            finally:
                for c in curves:
                    ext.delete_curve(c)
            from .surfaces import _shell_of_surface

            return _shell_of_surface(srf)
        counts = [len(w.edges()) for w in opened]  # type: ignore[union-attr]
        curves = [c for w in opened for c in w._copy_curves()]  # type: ignore[union-attr]
        degree = 1 if ruled else min(3 if smooth else 2, len(sections) - 1)
        with kernel_call("loft"):
            return Shell._wrap(k.create_skin_primitive(counts, curves, degree, False))
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


def sweep(profile: Sketch | Face | Wire, path: Edge | Wire, *, orient: bool = True, translational: bool = False,
          sharp_corners: bool | None = None) -> Part:
    """Sweep a profile along a path.

    The profile is moved so that its center sits at the start of the path and (with
    ``orient``) turned to face along the path, so profiles can be drawn anywhere,
    usually in the XY plane::

        tube = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)))
        rail = sweep(Rectangle(4, 2), Helix(pitch=10, height=40, radius=20))

    Args:
        profile: A sketch (holes allowed), a planar face or a closed wire.
        path: An edge, or a wire of connected edges.
        orient: Turn the profile to be perpendicular to the path at its start.
        translational: Keep the profile's orientation fixed instead of turning it with the path.
        sharp_corners: For paths of several edges: miter the corners of a planar path
            (default for planar paths); ``False`` sweeps each edge on its own and joins the pieces.
    """
    edges = _path_edges(path)
    if len(edges) == 1 and edges[0].is_closed and _open_curve(profile) is None:
        # The kernel sweeps a profile along a closed single-edge path inside out; along the
        # same path in two halves it works.
        edges = _halves(edges[0])
    w = _open_curve(profile)
    if w is not None:
        # an open profile sweeps into a surface
        pc = edges[0]._copy_curve()
        curves = w._copy_curves()
        if len(edges) != 1:
            raise ValueError("surface sweeps need a single-edge path")
        try:
            with kernel_call("sweep"):
                b = ext.curve_sweep(curves, pc, False, True, orient, translational, None, None)
        finally:
            ext.delete_curve(pc)
            for c in curves:
                ext.delete_curve(c)
        return Shell._wrap(b)  # type: ignore[return-value]
    sk = _as_sketch(profile)
    if orient and not translational:
        sk = _oriented_to(sk, edges[0].tangent_at(0.0))
    curves = [c for f in sk.faces() for w in f.wires() for c in w._copy_curves()]
    try:
        if len(edges) == 1:
            path_curve = edges[0]._copy_curve()
            hint = "the profile may be too large for the path's curvature"
            try:
                with kernel_call("sweep", hint):
                    b = ext.curve_sweep(curves, path_curve, True, True, False, translational, None, None)
            finally:
                ext.delete_curve(path_curve)
            return _require_solid(Part._wrap(b), "sweep", hint)
        planar = _is_planar_path(edges)
        if sharp_corners is None:
            sharp_corners = planar
        if sharp_corners:
            if not planar:
                raise ValueError("sharp-cornered sweeps need a planar path")
            moved = [c for c in curves]
            path_curves = [e._copy_curve() for e in edges]
            hint = "the profile may be too large for the path's corners"
            with kernel_call("sweep", hint):
                b = k.sweep_along_planar_path(moved, path_curves, move_profile=True)
            return _require_solid(Part._wrap(b), "sweep", hint)
    finally:
        for c in curves:
            ext.delete_curve(c)
    pieces = []
    for e in edges:
        pieces.append(sweep(sk, e, orient=orient, translational=translational))
    out = pieces[0]
    for p in pieces[1:]:
        out = out + p
    return out


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


def _is_planar_path(edges: list[Edge]) -> bool:
    pts = [e.point_at(t) for e in edges for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    import numpy as np

    a = np.array([p.to_tuple() for p in pts])
    a = a - a.mean(axis=0)
    s = np.linalg.svd(a, compute_uv=False)
    return bool(s[-1] <= 1e-7 * max(1.0, s[0]))


def fillet(edges: Any, radius: float | tuple[float, float] | Sequence[float], **kwargs: Any) -> Part:
    """Round edges of the part they belong to (see :meth:`Part.fillet`)."""
    return _owner_part(edges).fillet(edges, radius, **kwargs)


def chamfer(edges: Any, length: float) -> Part:
    """Bevel edges of the part they belong to (see :meth:`Part.chamfer`)."""
    return _owner_part(edges).chamfer(edges, length)


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
    """Grow or shrink a part or a sketch by ``distance``."""
    return shape.offset(distance, **kwargs)


def mirror(shape: Shape, plane: Plane = Plane.XZ) -> Any:
    """A mirrored copy of a shape."""
    return shape.mirror(plane)


def split(part: Part, plane: Plane | Face, keep: str = "above") -> Any:
    """Cut a part with a plane (see :meth:`Part.split`)."""
    return part.split(plane, keep)


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
