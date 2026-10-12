import math

import pytest

from smlibpy import *


def test_open_curves_make_surfaces():
    arc = ThreePointArc((0, 0, 0), (10, 5, 0), (20, 0, 0))
    wall = extrude(arc, 10)
    assert isinstance(wall, Shell)
    assert wall.area == pytest.approx(arc.length * 10, rel=1e-6)

    vase = revolve(Line((5, 0, 0), (5, 0, 10)), Z)
    assert vase.area == pytest.approx(2 * math.pi * 5 * 10, rel=1e-6)

    patch = loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5))])
    assert patch.area == pytest.approx(10 * math.hypot(10, 5), rel=1e-6)


def test_surface_through_points_and_thicken():
    pts = [[(x * 10, y * 10, 3 * math.sin(x / 2) * math.cos(y / 2)) for x in range(6)] for y in range(5)]
    s = surface(pts)
    assert s.faces()[0].geom_type == "bspline"
    for row in pts:
        for p in row:
            assert s.distance_to(p) < 1e-6
    solid = s.thicken(1.0)
    assert solid.is_valid()
    assert solid.volume == pytest.approx(s.area, rel=2e-2)


def test_stitch_faces_into_a_solid():
    box = Box(10, 10, 10)
    part = stitch([f.to_shell() for f in box.faces()])
    assert isinstance(part, Part)
    assert part.volume == pytest.approx(1000)


def test_queries():
    assert Sphere(5).silhouette((0, 0, 1))[0].length == pytest.approx(2 * math.pi * 5, rel=1e-6)
    pts = Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0)))
    assert pts == [Vector(5, 5, 0)]
    curves = Box(10, 10, 10).intersection_curves(Cylinder(3, 20))
    assert len(curves) == 2 and all(c.geom_type in ("circle", "bspline") for c in curves)
    assert Box(10, 10, 10).distance_to(Box(10, 10, 10).translate(15, 0, 0)) == pytest.approx(5)
