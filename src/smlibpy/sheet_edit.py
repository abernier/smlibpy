"""Editing sheets face by face: an edge matched to a curve, two faces merged into one.

``Shell.match_edge`` and ``Shell.merge_faces`` call these; see ``src/cpp/sheet_edit.cpp``.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from ._kernel import ModelingError, ext, kernel_call

if TYPE_CHECKING:
    from .shapes import Edge, Face, Shell, Wire


def _own_edge(body: Shell, edge: Any, what: str) -> Edge:
    """The sheet's edge for ``edge``: itself, or the edge of the sheet in its place (an edge of an
    earlier version of the sheet, matched by its ends and middle)."""
    from .shapes import Edge

    if not isinstance(edge, Edge):
        raise TypeError(f"{what}: edge must be an Edge, got {type(edge).__name__}")
    if edge._e is not None and edge._owner is not None and getattr(edge._owner, "_h", None) is body._h:
        return edge
    tol = 1e-6 * max(1.0, body.bbox().diagonal)
    ends = (edge.start, edge.end)
    m = edge.point_at(0.5)
    for g in body.edges():
        if (g.point_at(0.5) - m).length <= tol and min(
                (g.start - ends[0]).length + (g.end - ends[1]).length,
                (g.start - ends[1]).length + (g.end - ends[0]).length) <= 2 * tol:
            return g
    raise ValueError(f"{what}: {edge!r} is not an edge of this sheet")


def _own_face(body: Shell, face: Any, what: str) -> Face:
    from .shaping import _own_face as own

    return own(body, face, what)


def _target_curve(target: Any) -> Any:
    """A new kernel curve along an edge or a wire (a wire's edges joined into one)."""
    from .shapes import Edge, Wire

    if isinstance(target, Edge):
        return target._copy_curve()
    if isinstance(target, Wire):
        edges = target.edges()
        if len(edges) == 1:
            return edges[0]._copy_curve()
        if target.is_closed:
            raise ValueError("match_edge: the curve is a closed wire; an edge runs between two ends")
        curves = [e._copy_curve() for e in edges]
        try:
            with kernel_call("match_edge", "the wire's edges must join end to end"):
                return ext.join_curves(curves)
        finally:
            for c in curves:
                ext.delete_curve(c)
    raise TypeError(f"match_edge: the curve is an Edge or a Wire, got {type(target).__name__}")


def match_edge(body: Shell, edge: Any, target: Edge | Wire, extent: float) -> Any:
    """The Brep of ``body.match_edge(...)`` (see :meth:`Shell.match_edge`)."""
    what = "match_edge"
    e = _own_edge(body, edge, what)
    if not (isinstance(extent, (int, float)) and 0 < extent < 1):
        raise ValueError(f"match_edge: the extent is a part of the face across from the edge, above 0 and below 1; "
                         f"got {extent!r}")
    c = _target_curve(target)
    try:
        with kernel_call(what, "the faces must be bounded by the four sides of their surfaces (as surface(), loft, "
                               "ruled, fill and network make them), the edge one whole side of its face"):
            return ext.match_edge(body._brep, e._e, c, float(extent))
    finally:
        ext.delete_curve(c)


def merge_faces(body: Shell, a: Any, b: Any) -> Any:
    """``body.merge_faces(a, b)`` (see :meth:`Shell.merge_faces`): a Shell."""
    from .shapes import Shell
    from .surfaces import stitch

    what = "merge_faces"
    fa, fb = _own_face(body, a, what), _own_face(body, b, what)
    if fa == fb:
        raise ValueError("merge_faces: a and b are the same face")
    with kernel_call(what, "the faces must be bounded by the four sides of their surfaces and share one whole side"):
        merged = Shell._wrap(ext.merge_faces(fa._f, fb._f))
    faces = body.faces()
    others = [f for f in faces if f != fa and f != fb]
    if not others:
        return merged
    with kernel_call(what):
        rest = Shell._wrap(ext.copy_faces(body._brep, [f._f for f in others]))
    size = body.bbox().diagonal
    joined = stitch(rest, merged, tolerance=max(1e-5 * size, 1e-7))
    # the same border: free edges as long as before, and one face less
    before, after = _free_length(body), _free_length(joined)
    if len(joined.faces()) != len(faces) - 1 or not math.isclose(before, after, rel_tol=1e-6, abs_tol=1e-6 * size):
        raise ModelingError(f"merge_faces: the merged face could not be sewn to the sheet's other faces (free edges "
                            f"{before:.6g} long before, {after:.6g} after)")
    return joined


def _free_length(body: Any) -> float:
    return sum(e.length for e in body.edges() if len(e.faces()) == 1)


__all__: list[str] = []
