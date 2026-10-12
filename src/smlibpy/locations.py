"""Patterns of locations. Multiply a pattern with a shape to get one copy per location::

    holes = GridLocations(20, 20, 3, 2) * Circle(2)       # six circles
    bolts = PolarLocations(30, 6) * Cylinder(3, 10)       # six cylinders on a circle
    part -= (GridLocations(40, 30, 2, 2) * Hole(3, 10)).on(top_face)
"""

from __future__ import annotations

import math
from typing import Any, Iterable

from .geometry import Location, Plane, Pos, Rot, Vector, VectorLike, _vec
from .shapes import Face, Shape, ShapeList, Vertex, _as_plane

__all__ = ["Locations", "GridLocations", "PolarLocations", "HexLocations"]


class Locations(list[Location]):
    """A list of locations. ``Locations((0, 0), (10, 5), ...)`` takes points, locations,
    planes, faces (their center planes) or vertices."""

    def __init__(self, *items: Any):
        locs: list[Location] = []
        for it in items:
            if isinstance(it, Location):
                locs.append(it)
            elif isinstance(it, Plane):
                locs.append(it.location)
            elif isinstance(it, (Face, ShapeList)) and not isinstance(it, Locations):
                if isinstance(it, ShapeList):
                    locs.extend(_as_plane(f).location for f in it)
                else:
                    locs.append(it.plane.location)
            elif isinstance(it, Vertex):
                locs.append(Pos(it.point))
            elif isinstance(it, Locations):
                locs.extend(it)
            else:
                locs.append(Pos(_vec(it)))
        super().__init__(locs)

    def __mul__(self, other: Any) -> Any:  # type: ignore[override]
        if isinstance(other, Location):
            return Locations(*(l * other for l in self))
        if isinstance(other, Locations):
            return Locations(*(a * b for a in self for b in other))
        if isinstance(other, Shape):
            return ShapeList(l * other for l in self)
        if isinstance(other, Iterable):
            return ShapeList(l * o for l in self for o in other)
        return NotImplemented

    def __rmul__(self, other: Any) -> Any:  # type: ignore[override]
        if isinstance(other, (Location, Plane)):
            base = other if isinstance(other, Location) else other.location
            return Locations(*(base * l for l in self))
        return NotImplemented

    def on(self, target: Any) -> Locations:
        """The pattern placed onto a plane or face."""
        return _as_plane(target).location * self

    @property
    def points(self) -> list[Vector]:
        return [l.position for l in self]

    def __repr__(self) -> str:
        return f"Locations({len(self)} locations)"


def GridLocations(x_spacing: float, y_spacing: float, x_count: int, y_count: int, *, centered: bool = True) -> Locations:
    """A rectangular grid in the XY plane, centered on the origin unless ``centered=False``."""
    if x_count < 1 or y_count < 1:
        raise ValueError("counts must be at least 1")
    x0 = -x_spacing * (x_count - 1) / 2 if centered else 0.0
    y0 = -y_spacing * (y_count - 1) / 2 if centered else 0.0
    return Locations(*(Pos(x0 + i * x_spacing, y0 + j * y_spacing) for j in range(y_count) for i in range(x_count)))


def PolarLocations(radius: float, count: int, *, start_angle: float = 0.0, angular_range: float = 360.0,
                   rotate: bool = True) -> Locations:
    """``count`` locations on a circle of ``radius`` in the XY plane.

    With ``rotate`` the copies turn with the pattern (their X axis points outward).
    A full circle (``angular_range=360``) spaces them evenly without repeating the start.
    """
    if count < 1:
        raise ValueError("count must be at least 1")
    full = abs(abs(angular_range) - 360.0) < 1e-9
    step = angular_range / count if full else (angular_range / (count - 1) if count > 1 else 0.0)
    locs = []
    for i in range(count):
        a = start_angle + i * step
        p = Pos(radius * math.cos(math.radians(a)), radius * math.sin(math.radians(a)))
        locs.append(p * Rot(z=a) if rotate else p)
    return Locations(*locs)


def HexLocations(spacing: float, x_count: int, y_count: int, *, centered: bool = True) -> Locations:
    """A honeycomb pattern: rows ``spacing`` apart along X, every other row shifted by half."""
    dy = spacing * math.sqrt(3) / 2
    pts = []
    for j in range(y_count):
        for i in range(x_count):
            pts.append((i * spacing + (spacing / 2 if j % 2 else 0.0), j * dy))
    if centered and pts:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        pts = [(x - cx, y - cy) for x, y in pts]
    return Locations(*pts)
