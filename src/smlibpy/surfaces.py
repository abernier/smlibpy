"""Surface modeling: freeform surfaces, stitching surfaces into solids.

Most surface work goes through the regular operations: extruding, revolving,
sweeping or lofting an *open* curve gives a surface (a :class:`~smlibpy.Shell`)
instead of a solid. This module adds surfaces through point grids, ruled surfaces
and stitching.
"""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np

from ._kernel import KernelError, ModelingError, ext, k, kernel_call
from .geometry import Vector, VectorLike, _vec
from .shapes import Edge, Face, Part, Shell, Wire, _bodies, _t

__all__ = ["surface", "ruled", "stitch", "surface_fillet"]


def _shell_of_surface(srf: Any) -> Shell:
    try:
        with kernel_call("surface"):
            b = ext.face_from_surface(srf)
    finally:
        ext.delete_surface(srf)
    return Shell._wrap(b)


def surface(points: Sequence[Sequence[VectorLike]] | Sequence[VectorLike] | np.ndarray, *, interpolate: bool = True,
            controls: int | tuple[int, int] | None = None, smoothing: float = 1e-3) -> Shell:
    """A freeform NURBS surface through a grid of points, or fitted to a cloud of points.

    Args:
        points: Rows of points, ``points[i][j]`` (a grid: all rows the same length, at least
            4 x 4: the surface is bicubic). Or a cloud: points in any order (a list of points, an
            ``(n, 3)`` array, at least 4), such as a scan; the surface approximates them.
        interpolate: Grids: pass through the points (default). ``False`` uses them as control
            points, which gives a smoother surface that only approaches them.
        controls: Clouds: control points of the surface per direction, a number or ``(along,
            across)`` (4 to 64), "along" the longer side of the cloud. Default: about one per 8
            points, shaped like the cloud. More follow finer detail, and noise.
        smoothing: Clouds: how much the surface resists bending, against how close it comes to
            the points: 0 to 1, default 1e-3. For noisy points raise it (0.1 to 1), or take fewer
            control points.

    A cloud must be a height field over its best-fit plane (no overhangs, nothing folded over).
    The surface spans the smallest rectangle around the points in that plane; where there are
    no points, the smoothing shapes it. Its normal points up (+Z); for a cloud that stands
    upright, to +Y, else to +X.
    """
    if _is_cloud(points):
        return _fit(points, controls, smoothing)
    if controls is not None:
        raise ValueError("surface: controls are for clouds of points; a grid sets its own")
    grid = np.asarray([[tuple(_vec(p)) for p in row] for row in points], dtype=float)
    if grid.ndim != 3 or grid.shape[0] < 4 or grid.shape[1] < 4:
        shape = "x".join(str(n) for n in grid.shape[:2]) if grid.ndim == 3 else "not a grid"
        raise ValueError(f"surface needs a grid of at least 4 x 4 points (bicubic), got {shape}; "
                         f"for a four-sided patch use ruled() between two lines")
    if not np.all(np.isfinite(grid)):
        raise ValueError("surface: the points must be finite numbers")
    rows, cols = grid.shape[:2]
    flat = [_t(p) for p in grid.reshape(-1, 3)]
    with kernel_call("surface"):
        if interpolate:
            srf = k.create_surface_from_ordered_points(flat, rows, cols)
        else:
            srf = k.create_surface_from_points(flat, rows, cols)
    return _shell_of_surface(srf)


def _is_cloud(points: Any) -> bool:
    """Points in any order (a list of points or an (n, 3) array) rather than rows of points."""
    if isinstance(points, np.ndarray):
        return points.ndim == 2
    items = list(points) if not isinstance(points, list) else points
    if not items:
        raise ValueError("surface needs points")
    first = items[0]
    if isinstance(first, Vector):
        return True
    try:
        return all(isinstance(x, (int, float, np.number)) for x in first)
    except TypeError:
        return False


def _fit(points: Any, controls: int | tuple[int, int] | None, smoothing: float) -> Shell:
    cloud = np.asarray([tuple(_vec(p)) for p in points], dtype=float)
    if cloud.ndim != 2 or len(cloud) < 4:
        raise ValueError(f"surface needs at least 4 points to fit, got {len(cloud)}")
    if not np.all(np.isfinite(cloud)):
        raise ValueError("surface: the points must be finite numbers")
    if controls is None:
        nu = nv = 0
    else:
        nu, nv = (controls, controls) if isinstance(controls, (int, np.integer)) else tuple(controls)
        if not (4 <= nu <= 64 and 4 <= nv <= 64):
            raise ValueError(f"surface: controls must be 4 to 64 per direction, got {controls}")
    if not 0 <= smoothing <= 1:
        raise ValueError(f"surface: smoothing must be 0 to 1, got {smoothing}")
    with kernel_call("surface", "the points may lie on a line, or be too few for the control points"):
        srf, _, _, _, _ = ext.fit_surface(cloud.ravel().tolist(), int(nu), int(nv), float(smoothing))
    return _shell_of_surface(srf)


def ruled(a: Edge | Wire, b: Edge | Wire) -> Shell:
    """The ruled surface between two curves (straight lines join matching points)."""
    ca = a if isinstance(a, Edge) else _single(a)
    cb = b if isinstance(b, Edge) else _single(b)
    c1, c2 = ca._copy_curve(), cb._copy_curve()
    try:
        with kernel_call("ruled"):
            srf = k.create_ruled_surface(c1, c2)
    finally:
        ext.delete_curve(c1)
        ext.delete_curve(c2)
    return _shell_of_surface(srf)


def _single(w: Wire) -> Edge:
    edges = w.edges()
    if len(edges) != 1:
        raise ValueError("expected a single curve; join the wire's edges into one spline first")
    return edges[0]


def stitch(*pieces: Shell | Face | Part | Sequence[Any], tolerance: float | None = None) -> Part | Shell:
    """Sew faces and sheets along their common edges.

    Returns a :class:`Part` when the result encloses a volume, otherwise a :class:`Shell`.
    ``tolerance`` is the largest gap to close (default: 1e-4 of the model size).
    """
    bodies = _bodies(pieces)
    if not bodies:
        raise ValueError("nothing to stitch")
    with kernel_call("stitch"):
        b = ext.combine([x._brep for x in bodies])
    shell = Shell._wrap(b)
    size = shell.bbox().diagonal
    gap = tolerance if tolerance is not None else max(size * 1e-4, 1e-7)
    with kernel_call("stitch", "the pieces may not meet within the tolerance"):
        _, is_solid, _, _, _ = k.stitch_into_solid(shell._brep)
        if not is_solid:
            k.stitch_into_shell(shell._brep, gap)
    part = Part._wrap(shell._copy_brep())
    if part.is_valid():
        return part
    return shell


def surface_fillet(a: Face | Shell, b: Face | Shell, radius: float, *, sides: tuple[int, int] = (1, 1)) -> Shell:
    """A round blend between the surfaces of two faces, as a sheet: for surfaces that are not the
    faces of one part, such as two sheets that cross (``fillet`` rounds the edges of a part).

    Args:
        a: The first face (or a sheet of one face). Its surface is blended, as far as the
            surface reaches: the blend may run past the face.
        b: The second face (or a sheet of one face), the same way.
        radius: The radius of the blend: of the ball that rolls between the two surfaces.
        sides: The side of each face the blend lies on: 1 the side its normal (``normal_at()``)
            points to, -1 the other. Two crossing surfaces leave four places for a ball to roll,
            one per combination.

    Returns:
        The blend, a sheet (:class:`Shell`) whose edges along its length lie on the two surfaces.
    """
    from .defeature import _guarded

    fa, fb = _one_face(a, "a"), _one_face(b, "b")
    if not radius > 0 or not math.isfinite(radius):
        raise ValueError(f"surface_fillet: the radius must be positive, got {radius}")
    if len(sides) != 2 or any(x not in (1, -1) for x in sides):
        raise ValueError(f"surface_fillet: sides must be two of 1 and -1, got {sides}")
    # (the kernel's sides are those of each surface's own normal, which a face may turn around)
    r1 = radius * sides[0] * (1 if fa._natural_is_outward() else -1)
    r2 = radius * sides[1] * (1 if fb._natural_is_outward() else -1)
    size = max(fa.bbox().union(fb.bbox()).diagonal, radius)
    tolerance = max(1e-7 * size, 1e-9)
    hint = "the surfaces may not meet, or not leave room for the radius on those sides"
    # (on copies: the kernel changes the surfaces it blends, and a second blend of the same
    # surfaces then fails)
    ca, cb = fa.to_shell(), fb.to_shell()
    sa, sb = ca.faces()[0]._f.surface(), cb.faces()[0]._f.surface()
    with kernel_call("surface_fillet", hint):
        brep = _guarded("surface_fillet", lambda: k.surface_surface_fillet(
            sa, sb, radius1=r1, radius2=r2, tolerance=tolerance, xsect_type=2))
    if brep is None:
        raise ModelingError(f"surface_fillet: the kernel made no blend; {hint}")
    shell = Shell._wrap(brep)
    if not shell.faces():
        raise ModelingError(f"surface_fillet: the kernel made no blend; {hint}")
    return shell


def _one_face(x: Any, name: str) -> Face:
    if isinstance(x, Face):
        return x
    if isinstance(x, Shell) and not isinstance(x, Part):
        faces = x.faces()
        if len(faces) == 1:
            return faces[0]
        raise ValueError(f"surface_fillet: {name} is a sheet of {len(faces)} faces; pass one of them")
    raise TypeError(f"surface_fillet takes faces (or sheets of one face), not a {type(x).__name__}")
