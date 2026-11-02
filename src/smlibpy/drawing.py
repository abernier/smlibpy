"""2D drawings of parts: views with visible and hidden lines, as DXF or SVG.

A view is what :meth:`Part.outline` gives with ``hidden=True`` (the lines seen from one side,
and the ones behind the part), laid out in the drawing's plane (world XY) next to the other
views, as projections are arranged on a sheet: first-angle (ISO, Europe: the view from above
goes below the front view, the view from the left to its right) or third-angle (ASME, America:
the view from above goes above it, the view from the left to its left).
"""

from __future__ import annotations

import os
from typing import Any, Literal, NamedTuple, Sequence

import numpy as np

from .geometry import BoundBox, Location, Plane, Vector

__all__ = ["DrawingView", "drawing_views", "export_svg", "to_svg"]


class DrawingView(NamedTuple):
    """One view of a drawing (see :func:`drawing_views`).

    Attributes:
        name: ``"front"``, ``"back"``, ``"top"``, ``"bottom"``, ``"left"`` or ``"right"``.
        direction: Where the view looks from: the direction from the part towards the viewer.
        visible: The visible lines, standalone edges in the drawing's plane (world XY).
        hidden: The hidden lines (drawn dashed), likewise.
    """

    name: str
    direction: Vector
    visible: Any
    hidden: Any

    def bbox(self) -> BoundBox:
        """The box around the view's lines."""
        return (self.visible + self.hidden).bbox()


# name -> (direction towards the viewer, the drawing's x in the model, its y in the model)
_VIEWS = {
    "front": ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    "back": ((0, 1, 0), (-1, 0, 0), (0, 0, 1)),
    "top": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    "bottom": ((0, 0, -1), (1, 0, 0), (0, -1, 0)),
    "left": ((-1, 0, 0), (0, -1, 0), (0, 0, 1)),
    "right": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
}

# where each view goes next to the front view: (column, row), for first-angle projection; the
# third-angle projection swaps the sides (the back view stays at the far right)
_PLACES = {"front": (0, 0), "top": (0, -1), "bottom": (0, 1), "left": (1, 0), "right": (-1, 0), "back": (2, 0)}


def drawing_views(part: Any, views: Sequence[str] = ("front", "top", "left"), *,
                  projection: Literal["first-angle", "third-angle"] = "first-angle",
                  hidden: bool = True, tangent_edges: bool = False, gap: float | None = None) -> list[DrawingView]:
    """The views of a part for a 2D drawing, laid out in the world XY plane.

    Args:
        part: A part (or a shell), or a list of them (an assembly): drawn together, each body hiding
            the lines of the others behind it (bodies that overlap are not cut where they meet).
        views: The views, by where they look from: ``"front"`` (from -Y; the drawing's x is the
            model's X, its y the model's Z), ``"back"`` (from +Y), ``"top"`` (from +Z: X and Y),
            ``"bottom"`` (from -Z), ``"left"`` (from -X: -Y and Z) and ``"right"`` (from +X: Y
            and Z).
        projection: ``"first-angle"`` (ISO: the top view below the front view, the left view to
            its right) or ``"third-angle"`` (ASME: the top view above it, the left view to its
            left). The back view goes at the far right.
        hidden: Draw the hidden lines (``DrawingView.hidden``, dashed in DXF and SVG); ``False``
            leaves them empty.
        tangent_edges: Draw the edges between faces that meet tangentially (fillet tangent
            lines).
        gap: Space between the views. Default: a fifth of the part's largest extent.

    The views of the front row share its height (the model's Z), the views of its column the
    front view's x (the model's X). Write them with :func:`export_dxf` (layers VISIBLE and
    HIDDEN, the hidden lines dashed) or :func:`export_svg`.
    """
    from .shapes import ShapeList

    part = _drawn(part)
    if projection not in ("first-angle", "third-angle"):
        raise ValueError(f"drawing_views: projection must be 'first-angle' or 'third-angle', not {projection!r}")
    names = [views] if isinstance(views, str) else list(views)
    if not names:
        raise ValueError("drawing_views: name at least one view")
    for n in names:
        if n not in _VIEWS:
            raise ValueError(f"drawing_views: unknown view {n!r}; use {', '.join(_VIEWS)}")
    if len(set(names)) != len(names):
        raise ValueError("drawing_views: every view once")
    size = part.bbox().size
    if gap is None:
        gap = 0.2 * max(size.x, size.y, size.z, 1e-9)
    if not gap >= 0:
        raise ValueError("drawing_views: gap must not be negative")
    flip = -1 if projection == "third-angle" else 1
    # the views in the drawing's plane, at the model's coordinates
    raw: dict[str, tuple[Any, Any]] = {}
    for n in names:
        d, x, y = _VIEWS[n]
        plane = Plane((0, 0, 0), x_dir=x, z_dir=d)
        if hidden:
            seen, behind = part.outline(plane, hidden=True, tangent_edges=tangent_edges)
        else:
            seen, behind = part.outline(plane, tangent_edges=tangent_edges), ShapeList()
        to_xy = plane.location.inverse()
        raw[n] = (seen.moved(to_xy), behind.moved(to_xy))
    boxes = {n: (raw[n][0] + raw[n][1]).bbox() if len(raw[n][0]) + len(raw[n][1]) else None for n in names}
    # the front view stays where it is; the others move beside it, along the row or the column
    front = _box_of(part, "front") if boxes.get("front") is None else boxes["front"]
    out = []
    row_extent = [front.min.x, front.max.x]
    for n in sorted(names, key=lambda n: (abs(_PLACES[n][0]), abs(_PLACES[n][1]))):
        col, row = _PLACES[n]
        if n != "back":
            col *= flip
            row *= flip
        b = boxes[n] or _box_of(part, n)
        dx = dy = 0.0
        if col > 0:
            dx = row_extent[1] + gap - b.min.x
        elif col < 0:
            dx = row_extent[0] - gap - b.max.x
        if row > 0:
            dy = front.max.y + gap - b.min.y
        elif row < 0:
            dy = front.min.y - gap - b.max.y
        if col != 0:
            row_extent = [min(row_extent[0], b.min.x + dx), max(row_extent[1], b.max.x + dx)]
        place = Location(np.array([[1, 0, 0, dx], [0, 1, 0, dy], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float))
        seen, behind = raw[n]
        out.append(DrawingView(n, Vector(*_VIEWS[n][0]), seen.moved(place), behind.moved(place)))
    order = {n: i for i, n in enumerate(names)}
    return sorted(out, key=lambda v: order[v.name])


def _drawn(part: Any) -> Any:
    """The body :func:`drawing_views` draws: a part or shell, or the bodies of a list side by side in
    one (the kernel's hidden lines see them all)."""
    from ._kernel import ext, kernel_call
    from .shapes import ShapeList, Shell, _Body

    if isinstance(part, _Body):
        return part
    if not isinstance(part, (list, tuple, ShapeList)):
        raise TypeError(f"drawing_views draws parts and shells, not a {type(part).__name__}")
    bodies = list(part)
    for b in bodies:
        if not isinstance(b, _Body):
            raise TypeError(f"drawing_views draws parts and shells, not a {type(b).__name__}")
    if not bodies:
        raise ValueError("drawing_views: nothing to draw")
    if len(bodies) == 1:
        return bodies[0]
    with kernel_call("drawing_views"):
        return Shell._wrap(ext.combine([b._brep for b in bodies]))


def _box_of(part: Any, name: str) -> BoundBox:
    """The box of a view of the part's bounding box (for a view without lines)."""
    b = part.bbox()
    d, x, y = (np.array(v, dtype=float) for v in _VIEWS[name])
    corners = np.array([[px, py, pz] for px in (b.min.x, b.max.x) for py in (b.min.y, b.max.y)
                        for pz in (b.min.z, b.max.z)])
    u, v = corners @ x, corners @ y
    return BoundBox((u.min(), v.min(), 0), (u.max(), v.max(), 0))


# -----------------------------------------------------------------------------
# SVG
# -----------------------------------------------------------------------------
def _lines(shapes: Any) -> list[tuple[str, Any]]:
    """(kind, edge) for each edge to draw: ``"visible"`` or ``"hidden"``."""
    from .shapes import Edge, Face, Part, Wire, _Body

    out: list[tuple[str, Any]] = []

    def add(s: Any) -> None:
        if isinstance(s, Part):
            raise TypeError("export_svg draws 2D shapes, not a Part; draw drawing_views(part) or the edges of "
                            "part.outline(plane)")
        if isinstance(s, DrawingView):
            out.extend(("visible", e) for e in s.visible)
            out.extend(("hidden", e) for e in s.hidden)
        elif isinstance(s, Edge):
            out.append(("visible", s))
        elif isinstance(s, (Wire, Face, _Body)):
            out.extend(("visible", e) for e in s.edges())
        elif isinstance(s, (list, tuple)):
            for t in s:
                add(t)
        else:
            raise TypeError(f"export_svg cannot draw a {type(s).__name__}")

    add(shapes)
    return out


def _num(v: float) -> str:
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _path(e: Any) -> tuple[str, np.ndarray]:
    """SVG path data of an edge in the XY plane (y up in the model, down in the SVG): lines and
    circular arcs exactly (as the DXF writer finds them), other curves as polylines; and the
    points it runs through (for the drawing's box)."""
    from .dxf import _edge_points, _entity, _samples_for

    def pt(p: Any) -> str:
        return f"{_num(p[0])} {_num(-p[1])}"

    ent = _entity(e, lambda p: np.asarray(p, dtype=float)[:2], np.array([0.0, 0.0, 1.0]), 1.0)
    d = ent.data
    if ent.kind == "LINE":
        return f"M{pt(d['a'])} L{pt(d['b'])}", np.array([d["a"], d["b"]])
    if ent.kind in ("CIRCLE", "ARC"):
        c, r = np.asarray(d["c"]), float(d["r"])
        box = np.array([c - r, c + r])
        if ent.kind == "CIRCLE":  # (two halves: an SVG arc cannot close on itself)
            a, b = c + (r, 0.0), c - (r, 0.0)
            return f"M{pt(a)} A{_num(r)} {_num(r)} 0 1 0 {pt(b)} A{_num(r)} {_num(r)} 0 1 0 {pt(a)}", box
        a0, a1 = np.radians(d["a0"]), np.radians(d["a1"])
        a, b = c + r * np.array([np.cos(a0), np.sin(a0)]), c + r * np.array([np.cos(a1), np.sin(a1)])
        sweep = (d["a1"] - d["a0"]) % 360.0
        large = 1 if sweep > 180.0 else 0
        # the arc's own extent, not its circle's: its ends and the quadrant points it passes (a
        # shallow arc of a large radius would otherwise set the size of the whole drawing)
        reach = [a, b] + [c + r * np.array([np.cos(np.radians(q)), np.sin(np.radians(q))])
                          for q in (0.0, 90.0, 180.0, 270.0) if (q - d["a0"]) % 360.0 <= sweep]
        # (counterclockwise in the model: the SVG's negative direction, its y running down)
        return f"M{pt(a)} A{_num(r)} {_num(r)} 0 {large} 0 {pt(b)}", np.array(reach)
    p = _edge_points(e, max(_samples_for(e), 32))[:, :2]
    return "M" + " L".join(pt(q) for q in p), p


def to_svg(shapes: Any, *, margin: float | None = None, stroke: float | None = None) -> str:
    """An SVG drawing of drawing views (dashed hidden lines), edges, wires and the edges of
    faces and sketches, seen from +Z (their x and y; the SVG's y runs down). Lines and circular
    arcs are exact, other curves polylines. Lengths are in millimeters: the drawing prints at its
    true size.

    Args:
        shapes: :class:`DrawingView`, ``Edge``, ``Wire``, ``Face``, ``Sketch`` or a list of them.
        margin: Space around the lines. Default: 5 % of the drawing's size.
        stroke: Width of the visible lines (the hidden ones are 0.7 of it, dashed). Default:
            0.35 mm, or 1/500 of the drawing's size where that is smaller.
    """
    lines = _lines(shapes)
    if not lines:
        raise ValueError("export_svg: nothing to draw")
    paths = [(kind, *_path(e)) for kind, e in lines]
    pts = np.vstack([p for _, _, p in paths])
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    extent = float(max(hi[0] - lo[0], hi[1] - lo[1], 1e-9))
    if margin is None:
        margin = 0.05 * extent
    if stroke is None:
        stroke = min(0.35, extent / 500)
    if not (margin >= 0 and stroke > 0):
        raise ValueError("export_svg: margin must not be negative, stroke must be positive")
    x0, y0 = lo[0] - margin, -(hi[1] + margin)
    w, h = hi[0] - lo[0] + 2 * margin, hi[1] - lo[1] + 2 * margin
    dash = 6 * stroke
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg xmlns="http://www.w3.org/2000/svg" width="{_num(w)}mm" height="{_num(h)}mm" '
           f'viewBox="{_num(x0)} {_num(y0)} {_num(w)} {_num(h)}">',
           '<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">']
    for kind in ("hidden", "visible"):
        ds = [d for k_, d, _ in paths if k_ == kind]
        if not ds:
            continue
        style = (f'stroke-width="{_num(stroke)}"' if kind == "visible" else
                 f'stroke-width="{_num(0.7 * stroke)}" stroke-dasharray="{_num(dash)} {_num(dash / 2)}"')
        out.append(f'<path class="{kind}" {style} d="{" ".join(ds)}"/>')
    out.append("</g>")
    out.append("</svg>")
    return "\n".join(out) + "\n"


def export_svg(shapes: Any, path: str | os.PathLike[str], *, margin: float | None = None,
               stroke: float | None = None) -> None:
    """Write :func:`to_svg` of the shapes to a file."""
    text = to_svg(shapes, margin=margin, stroke=stroke)
    with open(os.fspath(path), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
