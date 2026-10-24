"""3D primitives and hole tools.

Primitives are centered on the origin by default; ``align`` changes that per axis.
Hole tools point down (-Z) from the origin so that ``part - Hole(...).on(face)`` drills
into the face.
"""

from __future__ import annotations

import math
from typing import Any

from ._kernel import k, kernel_call
from .align import Align, AlignLike, alignment_offset
from .geometry import Z
from .shapes import _WHOLE_TURN, Part

__all__ = ["Box", "Cylinder", "Cone", "Sphere", "Torus", "Wedge", "AnnularSector", "Pyramid", "Hole",
           "CounterBoreHole", "CounterSinkHole"]


def _aligned(p: Part, align: AlignLike, partial: bool = False) -> Part:
    """``p`` aligned by its bounding box. The whole primitives are made centered; a ``partial`` one (a
    sector) is made as the sector of the centered whole one, and centered by its own box."""
    if align is None or (not partial and (align == Align.CENTER or align == "center")):
        return p
    off = alignment_offset(p.bbox(), align)
    return p.translate(off) if off.length > 0 else p


def _arc(arc_size: float, what: str, name: str = "arc_size") -> float | None:
    """The angle of a sector (degrees), None for a whole turn: within 0.01 degrees of 360 (as revolve:
    the kernel's sectors between 359.99 and 360 are not closed solids)."""
    a = float(arc_size)
    if not 0 < a <= 360 + 1e-9:
        raise ValueError(f"{what}: {name} must be more than 0 and at most 360 degrees, got {arc_size!r}")
    return None if a > 360 - _WHOLE_TURN else a


def Box(length: float, width: float, height: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A box of ``length`` (X) by ``width`` (Y) by ``height`` (Z)."""
    if min(length, width, height) <= 0:
        raise ValueError("box dimensions must be positive")
    with kernel_call("Box"):
        b = k.create_box((-length / 2, -width / 2, -height / 2), float(length), float(width), float(height))
    return _aligned(Part._wrap(b), align)


def Cylinder(radius: float, height: float, *, arc_size: float = 360.0, align: AlignLike = Align.CENTER) -> Part:
    """A cylinder along Z.

    ``arc_size`` (degrees, at most 360) makes a sector: the part of the cylinder from the +X axis
    counter-clockwise about +Z (planes on its two sides). Like every primitive it is centered by its
    bounding box, so a sector's axis moves off Z; ``align=None`` keeps it on Z (the sector of the
    centered cylinder).
    """
    if radius <= 0 or height <= 0:
        raise ValueError("radius and height must be positive")
    a = _arc(arc_size, "Cylinder")
    with kernel_call("Cylinder"):
        if a is None:
            b = k.create_cylinder((0.0, 0.0, -height / 2), float(radius), float(height))
        else:
            b = k.create_partial_cylinder((0.0, 0.0, -height / 2), float(radius), float(height), 0.0, a)
    return _aligned(Part._wrap(b), align, a is not None)


def Cone(bottom_radius: float, top_radius: float, height: float, *, arc_size: float = 360.0,
         align: AlignLike = Align.CENTER) -> Part:
    """A cone (or frustum) along Z; one of the radii may be zero. ``arc_size`` makes a sector, as for
    :func:`Cylinder`."""
    if height <= 0 or bottom_radius < 0 or top_radius < 0 or bottom_radius == top_radius == 0:
        raise ValueError("invalid cone dimensions")
    a = _arc(arc_size, "Cone")
    with kernel_call("Cone"):
        if a is None:
            b = k.create_cone((0.0, 0.0, -height / 2), float(bottom_radius), float(top_radius), float(height))
        else:
            b = k.create_partial_cone((0.0, 0.0, -height / 2), float(bottom_radius), float(top_radius),
                                      float(height), 0.0, a)
    return _aligned(Part._wrap(b), align, a is not None)


def Sphere(radius: float, *, arc_size1: float = -90.0, arc_size2: float = 90.0, arc_size3: float = 360.0,
           align: AlignLike = Align.CENTER) -> Part:
    """A sphere, or a part of one.

    ``arc_size1`` and ``arc_size2`` are the latitudes (degrees, -90 at the bottom pole to 90 at the
    top) it reaches from and to: planes parallel to XY cut it there. ``arc_size3`` (at most 360) is the
    longitude it spans, from the +X axis counter-clockwise about +Z (planes through the Z axis on its
    sides). A part of a sphere is centered by its bounding box; ``align=None`` keeps the sphere's center
    at the origin.
    """
    if radius <= 0:
        raise ValueError("radius must be positive")
    lo, hi = float(arc_size1), float(arc_size2)
    if not -90 <= lo < hi <= 90:
        raise ValueError(f"Sphere: need -90 <= arc_size1 < arc_size2 <= 90 (latitudes in degrees), got "
                         f"{arc_size1!r} and {arc_size2!r}")
    a = _arc(arc_size3, "Sphere", "arc_size3")
    if lo > -90 or hi < 90:
        return _aligned(_zone(float(radius), lo, hi, a), align, True)
    with kernel_call("Sphere"):
        if a is None:
            b = k.create_sphere((0.0, 0.0, 0.0), float(radius))
        else:
            b = k.create_partial_sphere((0.0, 0.0, 0.0), float(radius), 0.0, a)
    return _aligned(Part._wrap(b), align, a is not None)


def _zone(radius: float, lo: float, hi: float, arc: float | None) -> Part:
    """The part of a sphere between two latitudes (degrees), over ``arc`` of longitude (None: all of it):
    its section on the +X side of the XZ plane revolved about Z (a sphere, planar ends)."""
    from .curves import Line, ThreePointArc
    from .geometry import Plane
    from .shapes import Wire
    from .sketches import make_face

    def at(deg: float) -> tuple[float, float]:
        if deg <= -90:
            return 0.0, -radius
        if deg >= 90:
            return 0.0, radius
        t = math.radians(deg)
        return radius * math.cos(t), radius * math.sin(t)

    (x0, z0), (x1, z1) = at(lo), at(hi)
    edges = [ThreePointArc((x0, z0), at((lo + hi) / 2), (x1, z1))]
    if x1 > 0:
        edges.append(Line((x1, z1), (0.0, z1)))
    edges.append(Line((0.0, z1), (0.0, z0)))
    if x0 > 0:
        edges.append(Line((0.0, z0), (x0, z0)))
    return make_face(Wire(edges)).on(Plane.XZ).revolve(Z, 360.0 if arc is None else arc)


def Torus(major_radius: float, minor_radius: float, *, minor_start_angle: float = 0.0,
          minor_end_angle: float = 360.0, major_angle: float = 360.0, align: AlignLike = Align.CENTER) -> Part:
    """A torus around Z.

    ``major_angle`` (degrees, at most 360) makes a sector of it, from the +X axis counter-clockwise
    about +Z, with round ends. ``minor_start_angle`` and ``minor_end_angle`` (degrees) keep the part of
    the tube's circle between them, as build123d does: measured in the tube's section from the side
    away from the axis (0) towards +Z (90), the section a slice of the circle from its center (cones,
    planes or cylinders where the slice's straight sides go round). A part of a torus is centered by its
    bounding box (``align=None`` keeps the torus's center at the origin)::

        top_half = Torus(20, 5, minor_start_angle=0, minor_end_angle=180)
        bead = Torus(20, 5, minor_start_angle=-90, minor_end_angle=90)   # the outer half
    """
    if minor_radius <= 0 or major_radius <= minor_radius:
        raise ValueError("need 0 < minor_radius < major_radius")
    a = _arc(major_angle, "Torus", "major_angle")
    lo, hi = float(minor_start_angle), float(minor_end_angle)
    if not (math.isfinite(lo) and math.isfinite(hi) and 0 < hi - lo <= 360 + 1e-9):
        raise ValueError(f"Torus: minor_end_angle must lie more than 0 and at most 360 degrees past minor_start_angle, "
                         f"got {minor_start_angle!r} and {minor_end_angle!r}")
    whole = hi - lo > 360 - _WHOLE_TURN
    if a is not None or not whole:
        from .geometry import Plane
        from .sketches import Circle

        # (the kernel's partial torus is a surface of revolution; the revolve gives a torus)
        section = Circle(float(minor_radius)) if whole else _slice(float(minor_radius), lo, hi)
        part = section.translate(float(major_radius), 0).on(Plane.XZ).revolve(Z, 360.0 if a is None else a)
        return _aligned(part, align, True)
    with kernel_call("Torus"):
        b = k.create_torus((0.0, 0.0, 0.0), float(major_radius), float(minor_radius))
    return _aligned(Part._wrap(b), align)


def _slice(radius: float, lo: float, hi: float) -> Any:
    """The slice of a circle about the origin from angle ``lo`` to ``hi`` (degrees, counter-clockwise
    from +X), its straight sides to the center, as a sketch."""
    from .curves import Line, ThreePointArc
    from .shapes import Wire
    from .sketches import make_face

    def at(deg: float) -> tuple[float, float]:
        t = math.radians(deg)
        return radius * math.cos(t), radius * math.sin(t)

    p, m, q = at(lo), at((lo + hi) / 2), at(hi)
    return make_face(Wire([ThreePointArc(p, m, q), Line(q, (0.0, 0.0)), Line((0.0, 0.0), p)]))


def Pyramid(length: float, width: float, height: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A pyramid: a ``length`` (X) by ``width`` (Y) rectangle at the bottom, its apex ``height`` (Z)
    above the rectangle's center; five planes. Centered by its bounding box."""
    if not (length > 0 and width > 0 and height > 0):
        raise ValueError("pyramid length, width and height must be positive")
    with kernel_call("Pyramid"):
        b = k.create_pyramid((0.0, 0.0, -height / 2), float(length), float(height))
    part = Part._wrap(b)
    if width != length:
        part = part.scale((1.0, float(width) / float(length), 1.0))
    return _aligned(part, align)


def Wedge(length: float, width: float, height: float, top_length: float = 0.0, *, align: AlignLike = Align.CENTER) -> Part:
    """A ramp: a ``length`` (X) by ``width`` (Y) base whose high side, ``height`` tall, is the
    face at x = -length/2; the slope runs down towards +X. ``top_length`` gives a flat top of
    that length, measured from the -X end."""
    from .sketches import Polygon
    from .geometry import Plane

    if not (length > 0 and width > 0 and height > 0):
        raise ValueError("wedge length, width and height must be positive")
    if not 0 <= top_length < length:
        raise ValueError("wedge top_length must be at least 0 and less than the length")
    pts = [(-length / 2, 0), (length / 2, 0), (-length / 2 + top_length, height), (-length / 2, height)] \
        if top_length > 0 else [(-length / 2, 0), (length / 2, 0), (-length / 2, height)]
    profile = Polygon(*pts).on(Plane.XZ)
    part = profile.extrude(width / 2, both=True).translate(0, 0, -height / 2)
    return _aligned(part, align)


def AnnularSector(inner_radius: float, outer_radius: float, height: float, arc_size: float, *,
                  align: AlignLike = Align.CENTER) -> Part:
    """A sector of a tube along Z: between ``inner_radius`` and ``outer_radius`` from the Z axis,
    ``height`` tall, ``arc_size`` degrees (at most 360: a whole tube) from the +X axis counter-clockwise
    about +Z. An ``inner_radius`` of 0 gives a sector of a cylinder. Centered by its bounding box;
    ``align=None`` keeps the axis on Z (z from -height/2 to height/2)."""
    if not (0 <= inner_radius < outer_radius and height > 0):
        raise ValueError("AnnularSector: need 0 <= inner_radius < outer_radius and a positive height")
    a = _arc(arc_size, "AnnularSector")
    if inner_radius == 0:
        return Cylinder(outer_radius, height, arc_size=arc_size, align=align)
    from .geometry import Plane
    from .sketches import Polygon

    # The section revolved (cylinders and planes). The kernel's cylindrical box makes the same body,
    # but does not return for a whole turn, and its cylinders (SmCylinder) go to STEP files as B-splines.
    h = height / 2
    section = Polygon((inner_radius, -h), (outer_radius, -h), (outer_radius, h), (inner_radius, h)).on(Plane.XZ)
    return _aligned(section.revolve(Z, 360.0 if a is None else a), align, a is not None)


def Hole(radius: float, depth: float) -> Part:
    """A drilling tool: a cylinder from the origin down to ``-depth``."""
    return Cylinder(radius, depth, align=(Align.CENTER, Align.CENTER, Align.MAX))


def CounterBoreHole(radius: float, counter_bore_radius: float, counter_bore_depth: float, depth: float) -> Part:
    """A drilling tool with a counterbore at the top."""
    return Hole(radius, depth) + Hole(counter_bore_radius, counter_bore_depth)


def CounterSinkHole(radius: float, counter_sink_radius: float, depth: float, angle: float = 82.0) -> Part:
    """A drilling tool with a conical countersink of included ``angle`` at the top."""
    h = (counter_sink_radius - radius) / math.tan(math.radians(angle / 2))
    sink = Cone(radius, counter_sink_radius, h, align=(Align.CENTER, Align.CENTER, Align.MAX))
    return Hole(radius, depth) + sink
