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
from .shapes import Edge, Face, Part, Shape, ShapeList, Shell, Sketch, Wire, _as_plane, _flatten_edges, _flatten_faces

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
        ax = axis if axis is not None else Z
        with kernel_call("revolve", "the axis must not cross the curve"):
            b = k.rotational_sweep(w._copy_curves(), ax.origin.to_tuple(), ax.direction.to_tuple(), float(angle),
                                   cap_ends=False)
        return Shell._wrap(b)
    return _as_sketch(profile).revolve(axis, angle)


def _section_curves(section: Any) -> tuple[list[Any], int]:
    """Outer-loop curves of a loft section and their count."""
    if isinstance(section, ShapeList):
        section = section.one()
    if isinstance(section, Sketch):
        faces = section.faces()
        if len(faces) != 1:
            raise ValueError("a loft section must be a single region")
        w = faces[0].outer_wire()
    elif isinstance(section, Face):
        w = section.outer_wire()
    elif isinstance(section, Wire):
        w = section
    elif isinstance(section, Edge):
        w = Wire([section])
    else:
        raise TypeError(f"cannot loft through a {type(section).__name__}")
    curves = w._copy_curves()
    return curves, len(curves)


def loft(sections: Sequence[Sketch | Face | Wire | Edge], *, ruled: bool = False, smooth: bool = True) -> Part | Shell:
    """A solid through a sequence of cross sections, or a surface through open curves.

    Args:
        sections: Two or more sections in order: sketches, planar faces or closed wires
            for a solid; open edges or wires for a surface (a :class:`Shell`).
        ruled: Straight transitions between neighbouring sections.
        smooth: With more than two sections, pass through them with a cubic surface
            (``False``: quadratic).
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
    counts: list[int] = []
    curves: list[Any] = []
    for s in sections:
        c, n = _section_curves(s)
        curves.extend(c)
        counts.append(n)
    if ruled:
        degree = 1
    else:
        degree = min(3 if smooth else 2, len(sections) - 1)
    with kernel_call("loft", "sections should be closed, ordered and not intersect each other"):
        b = k.create_skin_primitive(counts, curves, degree, True)
    return Part._wrap(b)


def _path_edges(path: Any) -> list[Edge]:
    if isinstance(path, Edge):
        return [path]
    if isinstance(path, Wire):
        return list(path.edges())
    if isinstance(path, ShapeList):
        return Wire(list(path))._edges  # type: ignore[return-value]
    raise TypeError(f"a sweep path is an edge or a wire, got {type(path).__name__}")


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
            try:
                with kernel_call("sweep", "the profile may be too large for the path's curvature"):
                    b = ext.curve_sweep(curves, path_curve, True, True, False, translational, None, None)
            finally:
                ext.delete_curve(path_curve)
            return Part._wrap(b)
        planar = _is_planar_path(edges)
        if sharp_corners is None:
            sharp_corners = planar
        if sharp_corners:
            if not planar:
                raise ValueError("sharp-cornered sweeps need a planar path")
            moved = [c for c in curves]
            path_curves = [e._copy_curve() for e in edges]
            with kernel_call("sweep", "the profile may be too large for the path's corners"):
                b = k.sweep_along_planar_path(moved, path_curves, move_profile=True)
            return Part._wrap(b)
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
    sh = surface.to_shell() if isinstance(surface, Face) else surface
    return sh.thicken(thickness)
