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


def extrude(profile: Sketch | Face | Wire, amount: float, *, both: bool = False, taper: float = 0.0,
            direction: VectorLike | None = None) -> Part:
    """Extrude a sketch, a planar face or a closed wire (see :meth:`Sketch.extrude`)."""
    return _as_sketch(profile).extrude(amount, both=both, taper=taper, direction=direction)


def revolve(profile: Sketch | Face | Wire, axis: Axis | None = None, angle: float = 360.0) -> Part:
    """Revolve a sketch about an axis (see :meth:`Sketch.revolve`)."""
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


def loft(sections: Sequence[Sketch | Face | Wire], *, ruled: bool = False, smooth: bool = True) -> Part:
    """A solid through a sequence of cross sections.

    Args:
        sections: Two or more sections (sketches, planar faces or closed wires), in order.
        ruled: Straight transitions between neighbouring sections.
        smooth: With more than two sections, pass through them with a cubic surface
            (``False``: quadratic).
    """
    if len(sections) < 2:
        raise ValueError("loft needs at least two sections")
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
    sk = _as_sketch(profile)
    edges = _path_edges(path)
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


def mirror(shape: Shape, plane: Plane = Plane.YZ) -> Any:
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
