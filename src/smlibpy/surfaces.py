"""Surface modeling: freeform surfaces, stitching surfaces into solids.

Most surface work goes through the regular operations: extruding, revolving,
sweeping or lofting an *open* curve gives a surface (a :class:`~smlibpy.Shell`)
instead of a solid. This module adds surfaces through point grids, ruled surfaces
and stitching.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from ._kernel import KernelError, ext, k, kernel_call
from .geometry import VectorLike, _vec
from .shapes import Edge, Face, Part, Shell, Wire, _bodies, _t

__all__ = ["surface", "ruled", "stitch"]


def _shell_of_surface(srf: Any) -> Shell:
    try:
        with kernel_call("surface"):
            b = ext.face_from_surface(srf)
    finally:
        ext.delete_surface(srf)
    return Shell._wrap(b)


def surface(points: Sequence[Sequence[VectorLike]] | np.ndarray, *, interpolate: bool = True) -> Shell:
    """A freeform NURBS surface from a grid of points.

    Args:
        points: Rows of points, ``points[i][j]`` (all rows the same length, at least 4 x 4:
            the surface is bicubic).
        interpolate: Pass through the points (default). ``False`` uses them as control
            points, which gives a smoother surface that only approaches them.
    """
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
