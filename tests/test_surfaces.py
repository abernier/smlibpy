import math

import numpy as np
import pytest

from smlibpy import *
from smlibpy._kernel import ext


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


def _cloud(count=2000, seed=7):
    rng = np.random.default_rng(seed)
    xy = rng.uniform(-10, 10, (count, 2))
    z = 0.02 * (xy[:, 0] ** 2 - xy[:, 1] ** 2) + 0.5 * np.sin(xy[:, 0] / 2)
    return np.column_stack([xy, z]), rng


def test_surface_fitted_to_a_cloud_of_points():
    cloud, rng = _cloud()
    s = surface(cloud)
    assert isinstance(s, Shell) and s.faces()[0].geom_type == "bspline"
    assert max(s.distance_to(p) for p in cloud[::40]) < 0.005
    # the smallest rectangle around the points: the square of the cloud, not a turned one
    box = s.bbox()
    assert box.min.x == pytest.approx(-10, abs=0.1) and box.max.x == pytest.approx(10, abs=0.1)
    assert box.min.y == pytest.approx(-10, abs=0.1) and box.max.y == pytest.approx(10, abs=0.1)
    # noisy points: the surface follows the shape, not the noise
    noisy = cloud + np.column_stack([np.zeros((len(cloud), 2)), rng.normal(0, 0.05, len(cloud))])
    smooth = surface(noisy, smoothing=0.01)
    assert np.mean([smooth.distance_to(p) for p in cloud[::40]]) < 0.02  # (the noise: 0.05)
    # points as a list of vectors; control points by hand (along the longer side first)
    few = surface([Vector(*p) for p in cloud[:300]], controls=(6, 5))
    poles = ext.surface_data(few.faces()[0]._f.surface(), True)["poles"]
    assert len(poles) == 30


def test_surface_of_a_cloud_faces_up():
    xy = np.random.default_rng(3).uniform(-10, 10, (500, 2))
    cloud = np.column_stack([xy, 2 * np.exp(-(xy ** 2).sum(axis=1) / 50)])  # a bump: up at its top
    turn_x = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]])  # (90 degrees about X: the cloud stands in XZ)
    turn_y = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])  # (90 degrees about Y: in YZ)
    for points, up in [(cloud, Z), (cloud * [1, 1, -1], Z), (cloud @ turn_x.T, Y), (-(cloud @ turn_x.T), Y),
                       (cloud @ turn_y.T, X), (-(cloud @ turn_y.T), X)]:
        f = surface(points).faces()[0]
        top = max(points, key=lambda p: abs(Vector(*p).dot(up.direction)))  # (the point of the bump)
        assert f.normal_at(top).dot(up.direction) > 0.99


def test_surface_of_a_sparse_noisy_cloud_neither_folds_nor_overshoots():
    # (fitting the parameters to the points again let the noise fold the surface over, and too
    # little smoothing let the corners, where there are few points, fly off)
    rng = np.random.default_rng(4)
    xy = rng.uniform((-30, -20), (30, 20), (260, 2))

    def wave(x, y):
        return 7 * math.sin(x / 11) * math.cos(y / 13) + 0.004 * x * x

    noisy = np.column_stack([xy, [wave(x, y) + rng.normal(0, 0.6) for x, y in xy]])
    f = surface(noisy).faces()[0]
    grid = [(x, y, wave(x, y)) for x in np.linspace(-29, 29, 24) for y in np.linspace(-19, 19, 16)]
    assert min(f.normal_at(p).z for p in grid) > 0.5  # no fold: the normal stays up everywhere
    assert f.bbox().max.z < max(p[2] for p in grid) + 1.0 and f.bbox().min.z > min(p[2] for p in grid) - 1.0
    assert np.mean([f.distance_to(p) for p in grid]) < 0.35


def test_surface_cloud_checks():
    cloud, _ = _cloud(100)
    with pytest.raises(ValueError, match="line"):
        surface([(0, 0, 0), (1, 0, 0), (2, 0, 0), (3, 0, 0)])
    with pytest.raises(ValueError, match="at least 4"):
        surface([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
    with pytest.raises(ValueError, match="controls"):
        surface(cloud, controls=3)
    with pytest.raises(ValueError, match="smoothing"):
        surface(cloud, smoothing=2)
    grid = [[(x, y, 0) for x in range(5)] for y in range(5)]
    with pytest.raises(ValueError, match="clouds"):
        surface(grid, controls=5)


def test_surface_fillet_between_two_sheets():
    floor = Rectangle(40, 40).faces()[0]  # normal +Z
    wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]
    ny = wall.normal_at().y
    for sides in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        blend = surface_fillet(floor, wall, 5, sides=sides)
        assert blend.area == pytest.approx(math.pi / 2 * 5 * 40, rel=1e-6)
        c = blend.center()  # a quarter circle's centroid: 2 r / pi from its centre
        assert c.z == pytest.approx(sides[0] * (5 - 10 / math.pi), abs=1e-6)
        assert c.y == pytest.approx(sides[1] * ny * (5 - 10 / math.pi), abs=1e-6)
    # the same faces again (the kernel changes the surfaces it blends: copies are blended)
    assert surface_fillet(floor, wall, 5).area == pytest.approx(math.pi / 2 * 5 * 40, rel=1e-6)


def test_surface_fillet_between_crossing_pipes():
    a = Cylinder(5, 60).faces().cylinders()[0]
    b = Cylinder(4, 60).rotate(Axis.X, 90).faces().cylinders()[0]
    blend = surface_fillet(a, b, 1.5, sides=(1, 1))
    assert len(blend.faces()) == 2
    for e in blend.edges():
        p = e.point_at(0.5)
        on_a = abs(math.hypot(p.x, p.y) - 5)
        on_b = abs(math.hypot(p.x, p.z) - 4)
        if e.length > 5:  # the rails, along the pipes (the ends are short arcs across)
            assert min(on_a, on_b) < 1e-5


def test_surface_fillet_checks():
    floor = Rectangle(40, 40).faces()[0]
    with pytest.raises(ValueError, match="positive"):
        surface_fillet(floor, floor, 0)
    with pytest.raises(ValueError, match="sides"):
        surface_fillet(floor, floor, 1, sides=(1, 0))
    with pytest.raises(TypeError, match="faces"):
        surface_fillet(Box(1, 1, 1), floor, 1)
    with pytest.raises(ModelingError, match="meet"):  # parallel planes: nowhere to roll
        surface_fillet(floor, Rectangle(40, 40).translate((0, 0, 50)).faces()[0], 1)
