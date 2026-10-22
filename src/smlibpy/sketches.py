"""2D constructors. Every sketch is built in the world XY plane, centered on the origin
unless ``align`` says otherwise; place it with ``.on(...)``, ``Plane * sketch`` or
``Pos(...) * sketch``.

The shapes share their option names: ``rotation`` (degrees counterclockwise about the
shape's center), ``align``, and for shapes with corners ``fillet`` (round every corner with
this radius) and ``chamfer`` (bevel every corner by this length). Outlines that are awkward
as combinations of shapes are drawn with :class:`~smlibpy.Profile`.
"""

from __future__ import annotations

import math
from typing import Any, Sequence

from ._kernel import k, kernel_call
from ._planar import Arc2, Corner, GeometryError, Line2, Seg, assemble, cis, describe, fmt, signed_area, simplify
from .align import Align, AlignLike, alignment_offset
from .curves import CenterArc, Line, Polyline
from .geometry import Location, Plane, VectorLike, Z, _vec
from .shapes import Edge, Sketch, Wire, _transform_curve

__all__ = [
    "Rectangle",
    "RoundedRectangle",
    "Circle",
    "Ellipse",
    "Polygon",
    "RegularPolygon",
    "Triangle",
    "Trapezoid",
    "Slot",
    "ArcSlot",
    "Stroke",
    "Hull",
    "make_face",
]


def _aligned(s: Sketch, align: AlignLike, default_centered: bool = True) -> Sketch:
    if align is None:
        return s
    if isinstance(align, str):
        align = Align(align.lower())
    if align is Align.CENTER and default_centered:
        return s
    off = alignment_offset(s.bbox(), align, dims=2)
    if off.length == 0:
        return s
    return s.translate(off)


def _from_curves(curves: list, align: AlignLike = Align.CENTER, default_centered: bool = True) -> Sketch:
    with kernel_call("sketch"):
        b = k.create_planar_faces(curves)
    return _aligned(Sketch._wrap(b, Plane.XY), align, default_centered)


def _corner_options(what: str, fillet: float, chamfer: float) -> Corner | None:
    if fillet and chamfer:
        raise ValueError(f"{what}: give fillet= or chamfer=, not both")
    if fillet < 0 or chamfer < 0:
        raise ValueError(f"{what}: fillet and chamfer must not be negative")
    if fillet:
        return Corner("fillet", float(fillet), f"fillet={fmt(fillet)}")
    if chamfer:
        return Corner("chamfer", float(chamfer), f"chamfer={fmt(chamfer)}")
    return None


def _polygon_sketch(what: str, pts: Sequence[complex], *, fillet: float = 0.0, chamfer: float = 0.0,
                    rotation: float = 0.0) -> Sketch:
    """A straight-edged region through ``pts`` (rotated about the origin), its corners
    rounded or beveled, with exact lines and arcs."""
    from ._regions import Frame, build

    corner = _corner_options(what, fillet, chamfer)
    rot = cis(math.radians(rotation)) if rotation else 1 + 0j
    pts = [p * rot for p in pts]
    size = max(1.0, *(abs(p) for p in pts))
    tol = 1e-9 * size
    clean = [p for i, p in enumerate(pts) if abs(p - pts[i - 1]) > tol]
    if len(clean) < 3:
        raise ValueError(f"{what}: a polygon needs at least three distinct points")
    segs: list[Seg] = [Line2(a, b) for a, b in zip(clean, clean[1:] + clean[:1])]
    segs, _ = simplify(segs, [""] * len(segs), True, tol)
    area = signed_area(segs)
    if abs(area) <= tol * size:
        raise ValueError(f"{what}: the points lie on one line, so the polygon has no area")
    if area < 0:
        segs = [s.reversed() for s in reversed(segs)]
    if corner is not None:
        corners = {i: corner for i in range(len(segs))}
        try:
            segs, _ = assemble(segs, [""] * len(segs), corners, True, tol, what=lambda i, s=segs: describe(s[i]))
        except GeometryError as e:
            raise ValueError(f"{what}: {e}") from None
        segs, _ = simplify(segs, [""] * len(segs), True, tol)
    return build([(segs, [])], Frame(Plane.XY), name=what)


def Rectangle(width: float, height: float, *, fillet: float = 0.0, chamfer: float = 0.0, rotation: float = 0.0,
              align: AlignLike = Align.CENTER) -> Sketch:
    """A ``width`` (X) by ``height`` (Y) rectangle.

    ``fillet`` rounds the four corners with that radius, ``chamfer`` bevels them by that
    length (at most half the shorter side). ``rotation`` turns it about its center (degrees
    counterclockwise); ``align`` then works on the turned outline.
    """
    if width <= 0 or height <= 0:
        raise ValueError("rectangle sides must be positive")
    _corner_options("Rectangle", fillet, chamfer)
    limit = min(width, height) / 2
    for name, value in (("fillet", fillet), ("chamfer", chamfer)):
        if value > limit + 1e-12 * max(1.0, limit):
            raise ValueError(f"Rectangle: {name}={fmt(value)} is more than half the shorter side ({fmt(limit)})")
    if not (fillet or chamfer or rotation):
        with kernel_call("Rectangle"):
            curves = k.create_rectangle((0.0, 0.0, 0.0), float(width), float(height))
        return _from_curves(curves, align)
    w, h = width / 2, height / 2
    s = _polygon_sketch("Rectangle", [complex(-w, -h), complex(w, -h), complex(w, h), complex(-w, h)],
                        fillet=min(fillet, limit), chamfer=min(chamfer, limit), rotation=rotation)
    return _aligned(s, align)


def RoundedRectangle(width: float, height: float, radius: float, *, align: AlignLike = Align.CENTER) -> Sketch:
    """A rectangle with rounded corners; the same as ``Rectangle(width, height, fillet=radius)``."""
    if radius <= 0:
        return Rectangle(width, height, align=align)
    if 2 * radius > min(width, height) + 1e-12:
        raise ValueError("corner radius is larger than half the shorter side")
    return Rectangle(width, height, fillet=radius, align=align)


def Circle(radius: float, *, align: AlignLike = Align.CENTER) -> Sketch:
    """A disk of ``radius``."""
    if radius <= 0:
        raise ValueError("radius must be positive")
    with kernel_call("Circle"):
        c = k.create_circle((0.0, 0.0, 0.0), float(radius))
    return _from_curves([c], align)


def Ellipse(x_radius: float, y_radius: float, *, rotation: float = 0.0, align: AlignLike = Align.CENTER) -> Sketch:
    """An ellipse with semi-axes ``x_radius`` and ``y_radius``, turned by ``rotation``
    degrees about its center."""
    if not (x_radius > 0 and y_radius > 0):
        raise ValueError(f"Ellipse: the radii must be positive (got {x_radius}, {y_radius})")
    with kernel_call("Ellipse"):
        c = k.create_ellipse((0.0, 0.0, 0.0), float(x_radius), float(y_radius))
    if rotation:
        c = _transform_curve(c, Location.about(Z, rotation).matrix)
    return _from_curves([c], align)


def Polygon(*points: VectorLike, fillet: float = 0.0, chamfer: float = 0.0, align: AlignLike = None) -> Sketch:
    """The polygon through the points (closed automatically). Points stay where they are
    unless ``align`` is given. ``fillet`` rounds every corner with that radius, ``chamfer``
    bevels every corner by that length."""
    pts = [_vec(p) for p in (points[0] if len(points) == 1 else points)]  # type: ignore[arg-type]
    if len(pts) < 3:
        raise ValueError("a polygon needs at least three points")
    if not (fillet or chamfer):
        w = Polyline(*pts, close=True)
        return _from_curves(w._copy_curves(), align, default_centered=False)
    if any(abs(p.z) > 1e-9 * max(1.0, abs(p.x), abs(p.y)) for p in pts):
        raise ValueError("Polygon: corner options need 2D points (z = 0); place the sketch with .on(plane)")
    s = _polygon_sketch("Polygon", [complex(p.x, p.y) for p in pts], fillet=fillet, chamfer=chamfer)
    return _aligned(s, align, default_centered=False)


def RegularPolygon(radius: float, sides: int, *, inscribed: bool = False, fillet: float = 0.0, chamfer: float = 0.0,
                   rotation: float = 0.0, align: AlignLike = Align.CENTER) -> Sketch:
    """A regular polygon with ``sides`` corners.

    ``radius`` is the distance to the corners, or to the middle of the sides when
    ``inscribed`` is true (handy for hexagons measured across flats: ``radius = flats / 2``).
    ``fillet`` and ``chamfer`` round or bevel every corner.
    """
    if sides < 3:
        raise ValueError("a polygon needs at least three sides")
    r = radius / math.cos(math.pi / sides) if inscribed else radius
    pts = [(r * math.cos(math.radians(rotation) + 2 * math.pi * i / sides),
            r * math.sin(math.radians(rotation) + 2 * math.pi * i / sides)) for i in range(sides)]
    if fillet or chamfer:
        return _aligned(_polygon_sketch("RegularPolygon", [complex(*p) for p in pts], fillet=fillet, chamfer=chamfer),
                        align)
    return _aligned(Polygon(*pts), align)


def Triangle(width: float, height: float, *, apex: float | None = None, fillet: float = 0.0, chamfer: float = 0.0,
             rotation: float = 0.0, align: AlignLike = Align.CENTER) -> Sketch:
    """A triangle with a base of ``width`` along X and its top corner ``height`` above it.

    ``apex`` is the x position of the top corner measured from the left end of the base:
    the middle by default (an isosceles triangle), ``0`` for a right angle at the left end,
    ``width`` for one at the right end. The triangle is centered on its bounding box;
    ``fillet`` and ``chamfer`` round or bevel the three corners.
    """
    if not (width > 0 and height > 0):
        raise ValueError(f"Triangle: width and height must be positive (got {width}, {height})")
    a = width / 2 if apex is None else float(apex)
    xs = (0.0, width, a)
    cx = (min(xs) + max(xs)) / 2
    pts = [complex(-cx, -height / 2), complex(width - cx, -height / 2), complex(a - cx, height / 2)]
    return _aligned(_polygon_sketch("Triangle", pts, fillet=fillet, chamfer=chamfer, rotation=rotation), align)


def Trapezoid(width: float, height: float, left_angle: float, right_angle: float | None = None, *,
              fillet: float = 0.0, chamfer: float = 0.0, rotation: float = 0.0,
              align: AlignLike = Align.CENTER) -> Sketch:
    """A trapezoid with a base of ``width``; the side angles are measured inside the base
    corners (``right_angle`` defaults to ``left_angle``). ``fillet`` and ``chamfer`` round or
    bevel the four corners."""
    ra = left_angle if right_angle is None else right_angle
    for name, ang in (("left_angle", left_angle), ("right_angle", ra)):
        if not 0 < ang < 180:
            raise ValueError(f"Trapezoid: {name} must be between 0 and 180 degrees (got {ang})")
    if not (width > 0 and height > 0):
        raise ValueError(f"Trapezoid: width and height must be positive (got {width}, {height})")
    dl = height / math.tan(math.radians(left_angle))
    dr = height / math.tan(math.radians(ra))
    if dl + dr >= width:
        raise ValueError("the sides cross below the given height")
    pts = [(-width / 2, -height / 2), (width / 2, -height / 2), (width / 2 - dr, height / 2), (-width / 2 + dl, height / 2)]
    if fillet or chamfer or rotation:
        return _aligned(_polygon_sketch("Trapezoid", [complex(*p) for p in pts], fillet=fillet, chamfer=chamfer,
                                        rotation=rotation), align)
    return _aligned(Polygon(*pts), align)


def Slot(length: float, width: float, *, rotation: float = 0.0, align: AlignLike = Align.CENTER) -> Sketch:
    """An obround slot ``length`` long overall (round ends included) and ``width`` wide, along
    X. For a slot between two centers use ``Stroke(Line(a, b), width)``; for one along an
    arc, :func:`ArcSlot`."""
    if length <= width:
        return Circle(width / 2, align=align)
    r = width / 2
    a = length / 2 - r
    edges = [Line((-a, -r), (a, -r)), CenterArc((a, 0), r, -90, 180), Line((a, r), (-a, r)), CenterArc((-a, 0), r, 90, 180)]
    s = _from_curves(Wire._raw(edges)._copy_curves(), Align.CENTER)
    if rotation:
        s = s.rotate(Z, rotation)
    return _aligned(s, align)


def ArcSlot(radius: float, width: float, angle: float, *, rotation: float = 0.0, align: AlignLike = None) -> Sketch:
    """A slot along an arc around the origin: its centerline has ``radius`` and runs
    counterclockwise over ``angle`` degrees from the X axis (turned by ``rotation``); it is
    ``width`` wide with round ends. The arc's center stays on the origin unless ``align``
    is given."""
    from ._regions import Frame, build

    if not (radius > 0 and width > 0):
        raise ValueError(f"ArcSlot: radius and width must be positive (got {radius}, {width})")
    h = width / 2
    if h >= radius:
        raise ValueError(f"ArcSlot: a slot {fmt(width)} wide needs a centerline radius above {fmt(h)} (the inner edge "
                         f"would pass the center)")
    if not 0 < angle < 360:
        raise ValueError(f"ArcSlot: the angle is between 0 and 360 degrees (got {angle})")
    caps = 2 * math.degrees(math.asin(h / radius))
    if angle + caps >= 360 - 1e-9:
        raise ValueError(f"ArcSlot: at radius {fmt(radius)} and width {fmt(width)} the round ends meet for angles above "
                         f"{fmt(360 - caps)}; use a smaller angle, or a ring: Circle(r + w/2) - Circle(r - w/2)")
    a0, sweep = math.radians(rotation), math.radians(angle)
    a1 = a0 + sweep
    c0, c1 = radius * cis(a0), radius * cis(a1)
    loop: list[Seg] = [Arc2(0j, radius + h, a0, sweep), Arc2(c1, h, a1, math.pi),
                       Arc2(0j, radius - h, a1, -sweep), Arc2(c0, h, a0 + math.pi, math.pi)]
    return _aligned(build([(loop, [])], Frame(Plane.XY), name="ArcSlot"), align, default_centered=False)


def Stroke(path: Edge | Wire, width: float, *, ends: str = "round", corners: str = "round") -> Sketch:
    """The region a pen ``width`` wide covers along a path: a slot between two centers
    (``Stroke(Line(a, b), 6)``), a slot along an arc, a rib from its centerline, a groove along a
    spline. Lines and arcs give exact lines and arcs; splines and ellipses their offsets
    (:meth:`Edge.offset`), within 1e-6 of the path's size.

    ``ends``: ``"round"`` (half circles, the default) or ``"flat"`` (cut square at the end
    points). ``corners``: how the outside of a bend is shaped, ``"round"``, ``"sharp"`` or
    ``"chamfer"``. A closed path makes a ring. The path stays where it is (in its plane).
    """
    from ._regions import stroke

    return stroke(path, float(width), ends, corners)


def Hull(*items: Any) -> Sketch:
    """The convex hull of points and shapes: the smallest convex region around them, as if a
    string were pulled tight around them. Around circles and arcs the outline follows the
    arcs exactly, joined by tangent lines.

    ``items``: points (tuples, Vectors, Vertices), edges, wires, sketches or faces, or lists
    of them. ``Hull(Circle(10), Pos(60, 0) * Circle(6))`` is a lever outline.
    """
    from ._regions import hull

    return hull(items)


def make_face(outer: Wire | Edge, *holes: Wire | Edge) -> Sketch:
    """The planar region inside a closed wire, minus the regions inside ``holes``."""
    w = outer if isinstance(outer, Wire) else Wire([outer])
    s = Sketch._from_wires([w])
    for h in holes:
        s = s - Sketch._from_wires([h if isinstance(h, Wire) else Wire([h])], s.plane)
    return s
