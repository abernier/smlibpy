"""2D constructors. Every sketch is built in the world XY plane, centered on the origin
unless ``align`` says otherwise; place it with ``.on(...)``, ``Plane * sketch`` or
``Pos(...) * sketch``.
"""

from __future__ import annotations

import math
from typing import Sequence

from ._kernel import k, kernel_call
from .align import Align, AlignLike, alignment_offset
from .curves import CenterArc, Line, Polyline
from .geometry import Plane, Vector, VectorLike, _vec
from .shapes import Edge, Sketch, Wire

__all__ = [
    "Rectangle",
    "RoundedRectangle",
    "Circle",
    "Ellipse",
    "Polygon",
    "RegularPolygon",
    "Slot",
    "Trapezoid",
    "make_face",
]


def _aligned(s: Sketch, align: AlignLike, default_centered: bool = True) -> Sketch:
    if align is None or (align == Align.CENTER and default_centered) or align == "center":
        return s
    off = alignment_offset(s.bbox(), align, dims=2)
    if off.length == 0:
        return s
    return s.translate(off)


def _from_curves(curves: list, align: AlignLike = Align.CENTER, default_centered: bool = True) -> Sketch:
    with kernel_call("sketch"):
        b = k.create_planar_faces(curves)
    return _aligned(Sketch._wrap(b, Plane.XY), align, default_centered)


def Rectangle(width: float, height: float, *, align: AlignLike = Align.CENTER) -> Sketch:
    """A ``width`` (X) by ``height`` (Y) rectangle."""
    if width <= 0 or height <= 0:
        raise ValueError("rectangle sides must be positive")
    with kernel_call("Rectangle"):
        curves = k.create_rectangle((0.0, 0.0, 0.0), float(width), float(height))
    return _from_curves(curves, align)


def RoundedRectangle(width: float, height: float, radius: float, *, align: AlignLike = Align.CENTER) -> Sketch:
    """A rectangle with rounded corners."""
    if radius <= 0:
        return Rectangle(width, height, align=align)
    if 2 * radius > min(width, height) + 1e-12:
        raise ValueError("corner radius is larger than half the shorter side")
    w, h, r = width / 2, height / 2, radius
    edges: list[Edge] = []
    corners = [((w - r, h - r), 0), ((-w + r, h - r), 90), ((-w + r, -h + r), 180), ((w - r, -h + r), 270)]
    pts = [((w, -h + r), (w, h - r)), ((w - r, h), (-w + r, h)), ((-w, h - r), (-w, -h + r)), ((-w + r, -h), (w - r, -h))]
    for (a, b), (c, ang) in zip(pts, corners):
        if Vector(a).distance_to(b) > 1e-12:
            edges.append(Line(a, b))
        edges.append(CenterArc(c, r, ang, ang + 90))
    return _from_curves(Wire._raw(edges)._copy_curves(), align)


def Circle(radius: float, *, align: AlignLike = Align.CENTER) -> Sketch:
    """A disk of ``radius``."""
    if radius <= 0:
        raise ValueError("radius must be positive")
    with kernel_call("Circle"):
        c = k.create_circle((0.0, 0.0, 0.0), float(radius))
    return _from_curves([c], align)


def Ellipse(x_radius: float, y_radius: float, *, align: AlignLike = Align.CENTER) -> Sketch:
    """An ellipse with semi-axes ``x_radius`` and ``y_radius``."""
    with kernel_call("Ellipse"):
        c = k.create_ellipse((0.0, 0.0, 0.0), float(x_radius), float(y_radius))
    return _from_curves([c], align)


def Polygon(*points: VectorLike, align: AlignLike = None) -> Sketch:
    """The polygon through the points (closed automatically). Points stay where they are
    unless ``align`` is given."""
    pts = [_vec(p) for p in (points[0] if len(points) == 1 else points)]  # type: ignore[arg-type]
    if len(pts) < 3:
        raise ValueError("a polygon needs at least three points")
    w = Polyline(*pts, close=True)
    return _from_curves(w._copy_curves(), align, default_centered=False)


def RegularPolygon(radius: float, sides: int, *, inscribed: bool = False, rotation: float = 0.0,
                   align: AlignLike = Align.CENTER) -> Sketch:
    """A regular polygon with ``sides`` corners.

    ``radius`` is the distance to the corners, or to the middle of the sides when
    ``inscribed`` is true (handy for hexagons measured across flats: ``radius = flats / 2``).
    """
    if sides < 3:
        raise ValueError("a polygon needs at least three sides")
    r = radius / math.cos(math.pi / sides) if inscribed else radius
    pts = [(r * math.cos(math.radians(rotation) + 2 * math.pi * i / sides),
            r * math.sin(math.radians(rotation) + 2 * math.pi * i / sides)) for i in range(sides)]
    return _aligned(Polygon(*pts), align)


def Slot(length: float, width: float, *, rotation: float = 0.0, align: AlignLike = Align.CENTER) -> Sketch:
    """An obround slot ``length`` long overall (round ends included) and ``width`` wide."""
    if length <= width:
        return Circle(width / 2, align=align)
    r = width / 2
    a = length / 2 - r
    edges = [Line((-a, -r), (a, -r)), CenterArc((a, 0), r, -90, 90), Line((a, r), (-a, r)), CenterArc((-a, 0), r, 90, 270)]
    s = _from_curves(Wire._raw(edges)._copy_curves(), Align.CENTER)
    if rotation:
        from .geometry import Z

        s = s.rotate(Z, rotation)
    return _aligned(s, align)


def Trapezoid(width: float, height: float, left_angle: float, right_angle: float | None = None,
              *, align: AlignLike = Align.CENTER) -> Sketch:
    """A trapezoid with a base of ``width``; the side angles are measured inside the base corners."""
    ra = left_angle if right_angle is None else right_angle
    dl = height / math.tan(math.radians(left_angle))
    dr = height / math.tan(math.radians(ra))
    if dl + dr >= width:
        raise ValueError("the sides cross below the given height")
    pts = [(-width / 2, -height / 2), (width / 2, -height / 2), (width / 2 - dr, height / 2), (-width / 2 + dl, height / 2)]
    return _aligned(Polygon(*pts), align)


def make_face(outer: Wire | Edge, *holes: Wire | Edge) -> Sketch:
    """The planar region inside a closed wire, minus the regions inside ``holes``."""
    w = outer if isinstance(outer, Wire) else Wire([outer])
    s = Sketch._from_wires([w])
    for h in holes:
        s = s - Sketch._from_wires([h if isinstance(h, Wire) else Wire([h])], s.plane)
    return s
