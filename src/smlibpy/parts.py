"""3D primitives and hole tools.

Primitives are centered on the origin by default; ``align`` changes that per axis.
Hole tools point down (-Z) from the origin so that ``part - Hole(...).on(face)`` drills
into the face.
"""

from __future__ import annotations

import math

from ._kernel import k, kernel_call
from .align import Align, AlignLike, alignment_offset
from .shapes import Part

__all__ = ["Box", "Cylinder", "Cone", "Sphere", "Torus", "Wedge", "Hole", "CounterBoreHole", "CounterSinkHole"]


def _aligned(p: Part, align: AlignLike) -> Part:
    if align is None or align == Align.CENTER or align == "center":
        return p
    off = alignment_offset(p.bbox(), align)
    return p.translate(off) if off.length > 0 else p


def Box(length: float, width: float, height: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A box of ``length`` (X) by ``width`` (Y) by ``height`` (Z)."""
    if min(length, width, height) <= 0:
        raise ValueError("box dimensions must be positive")
    with kernel_call("Box"):
        b = k.create_box((-length / 2, -width / 2, -height / 2), float(length), float(width), float(height))
    return _aligned(Part._wrap(b), align)


def Cylinder(radius: float, height: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A cylinder along Z."""
    if radius <= 0 or height <= 0:
        raise ValueError("radius and height must be positive")
    with kernel_call("Cylinder"):
        b = k.create_cylinder((0.0, 0.0, -height / 2), float(radius), float(height))
    return _aligned(Part._wrap(b), align)


def Cone(bottom_radius: float, top_radius: float, height: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A cone (or frustum) along Z; one of the radii may be zero."""
    if height <= 0 or bottom_radius < 0 or top_radius < 0 or bottom_radius == top_radius == 0:
        raise ValueError("invalid cone dimensions")
    with kernel_call("Cone"):
        b = k.create_cone((0.0, 0.0, -height / 2), float(bottom_radius), float(top_radius), float(height))
    return _aligned(Part._wrap(b), align)


def Sphere(radius: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A sphere."""
    if radius <= 0:
        raise ValueError("radius must be positive")
    with kernel_call("Sphere"):
        b = k.create_sphere((0.0, 0.0, 0.0), float(radius))
    return _aligned(Part._wrap(b), align)


def Torus(major_radius: float, minor_radius: float, *, align: AlignLike = Align.CENTER) -> Part:
    """A torus around Z."""
    if minor_radius <= 0 or major_radius <= minor_radius:
        raise ValueError("need 0 < minor_radius < major_radius")
    with kernel_call("Torus"):
        b = k.create_torus((0.0, 0.0, 0.0), float(major_radius), float(minor_radius))
    return _aligned(Part._wrap(b), align)


def Wedge(length: float, width: float, height: float, top_length: float = 0.0, *, align: AlignLike = Align.CENTER) -> Part:
    """A ramp: a ``length`` by ``width`` base rising to a top edge (or face of ``top_length``)
    at the back (+Y)."""
    from .sketches import Polygon
    from .geometry import Plane

    pts = [(-length / 2, 0), (length / 2, 0), (-length / 2 + top_length, height), (-length / 2, height)] \
        if top_length > 0 else [(-length / 2, 0), (length / 2, 0), (-length / 2, height)]
    profile = Polygon(*pts).on(Plane.XZ)
    part = profile.extrude(width, both=True).translate(0, 0, -height / 2)
    return _aligned(part, align)


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
