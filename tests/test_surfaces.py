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


def test_directions_take_an_axis():
    # An Axis such as Z gives its direction wherever a direction is asked for, as in the
    # selectors; silhouette, project, extrude and Helix took only vectors.
    torus = Torus(28, 9)
    assert (sorted(e.length for e in torus.silhouette(Z))
            == pytest.approx(sorted(e.length for e in torus.silhouette((0, 0, 1)))))
    box = Box(40, 30, 10)
    circle = Circle(5).on(Plane.XY.offset(30)).edges()[0]
    assert (sorted(e.length for e in box.project(circle, -Z))
            == pytest.approx(sorted(e.length for e in box.project(circle, (0, 0, -1)))))
    slant = Axis((5, 5, 5), (0, 1, 2))  # only the direction counts
    assert Circle(5).extrude(20, direction=slant).volume == pytest.approx(math.pi * 25 * 20 * 2 / math.sqrt(5))
    assert extrude(Line((0, 0), (10, 0)), 5, direction=Y).area == pytest.approx(50)
    assert Helix(5, 20, 10, direction=X).end == Helix(5, 20, 10, direction=(1, 0, 0)).end
    for call in (lambda: Sphere(5).silhouette((0, 0, 0)), lambda: box.project(circle, (0, 0, 0))):
        with pytest.raises(ValueError, match="the direction must not be zero"):
            call()


def test_intersection_curves_come_once_where_faces_lie_in_one_plane():
    # Both bottoms lie in z = 0: the kernel finds the arc there twice (the other way round
    # also the two lines on it). The total length shows any repeat, however the curves are cut.
    a = Box(60, 44, 28, align=Align.MIN)
    b = Cylinder(19, 44, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(56.2, 3.8, 0)
    line = 3.8 + math.sqrt(19 ** 2 - 3.8 ** 2)  # along x = 60 and y = 0 at z = 0
    arc = 19 * (math.pi / 2 + 2 * math.asin(3.8 / 19))  # the circle inside the box, at z = 0 and 28
    for curves in (a.intersection_curves(b), b.intersection_curves(a)):
        assert sum(c.length for c in curves) == pytest.approx(2 * arc + 2 * 28 + 2 * line, rel=1e-6)
    box = Box(20, 20, 20)
    shared = box.intersection_curves(box.translate(20, 0, 0))  # the face x = 10: its 4 sides
    assert sum(c.length for c in shared) == pytest.approx(80)
