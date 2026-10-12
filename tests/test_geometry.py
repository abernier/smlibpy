import math

import pytest

from smlibpy import Axis, Location, Plane, Pos, Rot, Vector, X, Y, Z


def test_vector_algebra():
    a, b = Vector(1, 2, 3), Vector(4, 5, 6)
    assert a + b == Vector(5, 7, 9)
    assert b - a == Vector(3, 3, 3)
    assert a * 2 == Vector(2, 4, 6)
    assert a.dot(b) == 32
    assert Vector(1, 0, 0).cross(Vector(0, 1, 0)) == Vector(0, 0, 1)
    assert Vector(3, 4).length == 5
    assert Vector(0, 2, 0).normalized() == Vector(0, 1, 0)
    assert Vector(1, 0, 0).angle_to((0, 1, 0)) == pytest.approx(90)
    assert Vector((1, 2)) == Vector(1, 2, 0)


def test_locations_compose_right_to_left():
    loc = Pos(10, 0, 0) * Rot(z=90)
    assert loc * Vector(1, 0, 0) == Vector(10, 1, 0)
    assert (loc.inverse() * loc) == Location()
    assert Rot(z=90).rotation == Vector(0, 0, 90)


def test_rotation_about_axis():
    p = Vector(2, 0, 0).rotate(Axis((1, 0, 0), (0, 0, 1)), 180)
    assert p == Vector(0, 0, 0)


def test_named_planes_keep_y_up_on_side_views():
    for plane in (Plane.front, Plane.back, Plane.left, Plane.right):
        assert plane.y_dir == Vector(0, 0, 1)
    assert Plane.top.z_dir == Vector(0, 0, 1)
    assert Plane.bottom.z_dir == Vector(0, 0, -1)
    assert Plane.XY.x_dir == Vector(1, 0, 0)


def test_plane_default_x_dir_is_stable():
    assert Plane((0, 0, 0), z_dir=(0, -1, 0)) == Plane.front
    assert Plane((0, 0, 0), z_dir=(1, 0, 0)) == Plane.right


def test_plane_coordinates():
    p = Plane.XZ.offset(5)
    assert p.origin == Vector(0, -5, 0)
    q = p.from_local((1, 2, 0))
    assert p.to_local(q) == Vector(1, 2, 0)
    assert p.location * Vector(1, 2, 0) == q


def test_axis_helpers():
    assert X.is_parallel((-1, 0, 0))
    assert Z.distance_to((3, 4, 10)) == pytest.approx(5)
    assert Y.position_along((0, 7, 0)) == pytest.approx(7)
