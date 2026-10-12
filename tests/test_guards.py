"""Regression tests: features refuse broken input and do not return broken bodies."""

import math

import numpy as np
import pytest
from pytest import approx

from smlibpy import *
from smlibpy._kernel import k
from smlibpy.shapes import Part


def _raw_union(a, b):
    """The kernel's union without smlibpy's checks (an invalid body for tangent operands)."""
    return Part._wrap(k.boolean(a._copy_brep(), b._copy_brep(), operation=k.BooleanOp.UNION))


# -- validity -----------------------------------------------------------------------------
def test_is_valid_needs_a_positive_volume():
    # a profile across the axis, revolved by the kernel directly: a "manifold" body of volume 0
    curves = Rectangle(10, 10).on(Plane.front).faces()[0].outer_wire()._copy_curves()
    inside_out = Part._wrap(k.rotational_sweep(curves, (0, 0, 0), (0, 0, 1), 360.0, cap_ends=True))
    assert inside_out._brep.is_manifold_solid() and inside_out.volume <= 1e-6
    assert not inside_out.is_valid()
    assert Box(1, 2, 3).is_valid() and (Box(10, 10, 10) - Sphere(3)).is_valid()


def test_scale_by_zero_is_refused_and_a_flat_body_is_not_valid():
    for factor in (0, (1, 0, 1), float("nan")):
        with pytest.raises(ValueError, match="not zero"):
            Box(10, 10, 10).scale(factor)
    flat = Box(10, 10, 10)._transformed(np.diag([0.0, 0.0, 0.0, 1.0]))  # what scale(0) returned
    assert not flat.is_valid()  # its bounding box is NaN; it reported valid
    assert Box(10, 10, 10).scale(-1).is_valid() and Box(10, 10, 10).scale((2, 1, 1)).is_valid()


@pytest.mark.parametrize("feature", [
    lambda p: p.fillet(p.edges().circles(), 0.5),
    lambda p: p.chamfer(p.edges().circles(), 0.5),
    lambda p: p.shell(1),
    lambda p: p.offset(1),
])
def test_features_refuse_an_invalid_part(feature):
    tangent = _raw_union(Cylinder(5, 20), Cylinder(5, 20).translate(10, 0, 0))  # crashed the fillet
    assert not tangent.is_valid()
    with pytest.raises(ModelingError, match="not a valid solid"):
        feature(tangent)


# -- shell --------------------------------------------------------------------------------
def test_shell_walls_that_do_not_fit_are_refused():
    box = Box(40, 30, 10)
    with pytest.raises(ModelingError, match="does not fit"):
        box.shell(10, box.faces().top())  # crashed the process now and then
    for t in (5, 6, 10):  # 6 returned a "valid" body of volume 10992
        with pytest.raises(ModelingError, match="do not fit"):
            box.shell(t)
    assert box.shell(6, box.faces().top()).volume == approx(40 * 30 * 10 - 28 * 18 * 4)
    assert box.shell(4).volume == approx(40 * 30 * 10 - 32 * 22 * 2)
    assert box.shell(10, box.faces().top() + box.faces().bottom()).volume == approx(40 * 30 * 10 - 20 * 10 * 10)


# -- fillet and chamfer -------------------------------------------------------------------
def _rounded_cube(s, r):
    a = s - 2 * r
    return a ** 3 + 6 * a * a * r + 3 * math.pi * a * r * r + 4 / 3 * math.pi * r ** 3


def test_fillet_close_to_the_limit_is_refused():
    cube = Box(10, 10, 10)
    with pytest.raises(ModelingError, match="too close to the largest"):
        cube.fillet(cube.edges(), 4.99)  # returned volume 11.19 instead of 525.17
    for r in (4, 4.97):
        p = cube.fillet(cube.edges(), r)
        assert p.is_valid() and p.volume == approx(_rounded_cube(10, r), rel=1e-6)
    with pytest.raises(ModelingError):
        Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 9.98)


def test_round_sizes_must_be_positive():
    cube = Box(10, 10, 10)
    with pytest.raises(ValueError, match="positive"):
        cube.fillet(cube.edges(), 0)
    with pytest.raises(ValueError, match="positive"):
        cube.chamfer(cube.edges(), -1)


def test_rounds_on_circular_edges_pass_the_volume_check():
    plate = Box(60, 40, 10) - Cylinder(5, 20)
    assert plate.fillet(plate.edges().circles(), 4.9).is_valid()
    boss = Box(40, 40, 10) + Cylinder(5, 20).translate(0, 0, 10)
    assert boss.fillet(boss.edges().circles().sort_by(Z)[0:1], 3).volume > boss.volume


def test_rounds_that_run_on_past_their_edge_pass_the_volume_check():
    # The kernel extends a round past an end where the edge runs on into one that is not
    # rounded (tangentially, or at a kink); these were refused as "wrong bodies".
    p = Box(80, 50, 10) + Box(10, 50, 60).translate(-35, 0, 35)
    p = p - Cylinder(6, 100).rotate(Y, 90).translate(0, 0, 45)
    p = p.fillet(p.edges().filter_by(Y), 2)
    bracket = p.chamfer(p.edges().group_by(Z)[-1], 1)  # into the arcs of the rounds below
    assert bracket.is_valid() and bracket.volume == approx(68689.3316, rel=1e-6)
    b = Box(40, 20, 10)
    b = b.fillet(b.edges().filter_by(Z), 4)
    block = b.fillet(b.edges().group_by(Z)[-1].lines().sort_by(X)[-1], 1)  # into the corner arcs
    assert block.is_valid() and block.volume == approx(7859.5722, rel=1e-6)
    prism = RegularPolygon(20, 24).extrude(10)
    kinked = prism.fillet(prism.edges().group_by(Z)[-1].sort_by(X)[-1], 1)  # 15 degree kinks
    assert kinked.is_valid() and kinked.volume == approx(12421.835947, rel=1e-6)


# -- revolve ------------------------------------------------------------------------------
@pytest.mark.parametrize("make", [
    lambda: Rectangle(10, 20).on(Plane.front).revolve(Z),
    lambda: Rectangle(10, 20).on(Plane.front).revolve(Z, 90),
    lambda: Rectangle(10, 20).revolve(),
    lambda: make_face(Polyline((10, 0), (20, 0), (20, 20), (10, 20), close=True)).revolve(),
])
def test_revolve_refuses_an_axis_through_the_region(make):
    with pytest.raises(ModelingError, match="axis crosses the region"):
        make()


def test_revolve_default_axis_error_names_the_axis():
    with pytest.raises(ModelingError, match=r"plane origin \(15, 10, 0\)"):
        make_face(Polyline((10, 0), (20, 0), (20, 20), (10, 20), close=True)).revolve()


def test_revolve_angles_and_axes():
    ring = Rectangle(10, 10).translate(15, 0).on(Plane.front)
    quarter = math.pi * (20 ** 2 - 10 ** 2) * 10 / 4
    plus, minus = ring.revolve(Z, 90), ring.revolve(Z, -90)
    assert plus.volume == approx(quarter) and minus.volume == approx(quarter)
    assert plus.bbox().min.y == approx(0, abs=1e-9) and minus.bbox().max.y == approx(0, abs=1e-9)
    with pytest.raises(ValueError, match="zero"):
        ring.revolve(Z, 0)
    with pytest.raises(ValueError, match="in the sketch plane"):
        Circle(3).translate(10, 0).revolve(Z)  # axis along the sketch normal
    touching = Rectangle(10, 20, align=(Align.MIN, Align.CENTER)).on(Plane.front).revolve(Z)
    assert touching.volume == approx(math.pi * 100 * 20)


# -- sweep, loft, extrude, thicken ---------------------------------------------------------
def test_sweep_along_a_closed_single_edge_path():
    torus = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))  # was inside out, volume -1579
    assert torus.is_valid() and len(torus.solids()) == 1
    assert torus.volume == approx(2 * math.pi * 20 * math.pi * 4, rel=1e-4)
    ring = sweep(Circle(2), Spline((20, 0), (0, 20), (-20, 0), (0, -20), closed=True))  # was volume 0
    assert ring.is_valid() and ring.volume > 1000


def test_tapered_extrusion_keeps_its_holes():
    ring = (Circle(10) - Circle(5)).extrude(10, taper=5)
    t = math.tan(math.radians(5)) * 10
    frustum = lambda r0, r1: math.pi * 10 / 3 * (r0 * r0 + r0 * r1 + r1 * r1)
    assert ring.volume == approx(frustum(10, 10 - t) - frustum(5, 5 + t), rel=1e-4)
    with pytest.raises(ModelingError, match="closes the profile"):
        Rectangle(20, 20).extrude(10, taper=56)
    with pytest.raises(ValueError):
        Rectangle(20, 20).extrude(10, taper=90)


def test_loft_sections_with_holes():
    tube = loft([Circle(10) - Circle(5), (Circle(8) - Circle(3)).translate(0, 0, 20)])
    frustum = lambda r0, r1: math.pi * 20 / 3 * (r0 * r0 + r0 * r1 + r1 * r1)
    assert tube.is_valid() and tube.volume == approx(frustum(10, 8) - frustum(5, 3), rel=1e-4)
    with pytest.raises(ValueError, match="same number of holes"):
        loft([Circle(10) - Circle(5), Circle(10).translate(0, 0, 20)])


def test_thicken_refuses_broken_results():
    ring = lambda z: [(10 * math.cos(a), 10 * math.sin(a), z) for a in np.linspace(0, 2 * math.pi, 25)]
    with pytest.raises(ModelingError, match="thicken"):
        surface([ring(z) for z in (0, 10, 20, 30)]).thicken(-1)  # was volume 0, "valid"
    with pytest.raises(ModelingError, match="thicken"):
        extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12)


def test_thicken_both_sides():
    slab = Rectangle(20, 10).thicken(2, both=True)
    assert slab.volume == approx(400)
    assert (slab.bbox().min.z, slab.bbox().max.z) == approx((-1, 1))
    wall = extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(2, both=True)
    assert wall.volume == approx(math.pi * (11 ** 2 - 9 ** 2) / 2 * 20, rel=1e-6)


# -- Booleans -----------------------------------------------------------------------------
def test_overlapping_parallel_holes_in_one_cut():
    part = Box(60, 40, 10)
    holes = (Locations((0, 0), (5, 0)) * Hole(4, 12)).on(part.faces().top())  # was an empty part
    lens = 2 * 16 * math.acos(5 / 8) - 2.5 * math.sqrt(64 - 25)
    result = part - holes
    assert result.is_valid() and result.volume == approx(24000 - 10 * (32 * math.pi - lens), rel=1e-6)
    plate = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]
    assert plate.is_valid()


def test_boolean_errors_say_what_to_do():
    with pytest.raises(KernelError, match="combine the tools first"):
        Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)
    with pytest.raises(ModelingError, match="touch only along an edge"):
        Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)  # returned an invalid part
    with pytest.raises(ModelingError, match="a tool is not a valid solid"):
        Box(10, 10, 10) + _raw_union(Cylinder(5, 20), Cylinder(5, 20).translate(10, 0, 0))


def test_boolean_operand_types():
    plate = Box(60, 40, 10)
    with pytest.raises(TypeError, match="extrude it first"):
        plate - Circle(3).on(plate.faces().top())
    for bad in ("x", 5, plate.edges()[0], plate.vertices()[0]):
        with pytest.raises(TypeError):
            plate - bad


def test_empty_boolean_results_where_they_are_right():
    assert len((Box(10, 10, 10) - Box(20, 20, 20)).faces()) == 0
    assert len((Box(10, 10, 10) - Box(10, 10, 10)).faces()) == 0
    assert len((Box(10, 10, 10) & Box(10, 10, 10).translate(30, 0, 0)).faces()) == 0


# -- distance -----------------------------------------------------------------------------
@pytest.mark.parametrize("a,b,expected", [
    (Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0), 12.0),  # was 10.33
    (Cylinder(5, 20), Box(10, 10, 30).translate(20, 0, 0), 10.0),  # was 7.22
    (Cylinder(5, 20).translate(1e5, 0, 0), Cylinder(3, 20).translate(1e5 + 20, 0, 0), 12.0),
    (Sphere(7).translate(1e5, 0, 0), Sphere(2).translate(1e5 + 10, 20, -5), math.sqrt(525) - 9),  # was 15.56
    (Sphere(7), Sphere(2).translate(10, 20, -5), math.sqrt(525) - 9),
    (Cylinder(2, 40), Cylinder(3, 40).rotate(X, 90).translate(15, 0, 0), 10.0),
    (Box(10, 10, 10), Box(10, 10, 10).translate(15, 12, 0), math.hypot(5, 2)),
    (Box(40, 40, 10) - Cylinder(6, 20), Cylinder(5, 30), 1.0),
    (Cylinder(10, 20) - Cylinder(8, 30), Cylinder(3, 18).translate(2, 0, 0), 3.0),
    (Box(10, 10, 10), Box(2, 2, 2), 4.0),
    (Box(10, 10, 10), Box(10, 10, 10).translate(5, 0, 0), 0.0),
    (Box(10, 10, 10), Box(10, 10, 10).translate(10, 0, 0), 0.0),
    (Sphere(10), Sphere(10).translate(15, 3, 0), 0.0),
])
def test_distance_between_bodies(a, b, expected):
    assert a.distance_to(b) == approx(expected, rel=1e-9, abs=1e-9)
    assert b.distance_to(a) == approx(expected, rel=1e-9, abs=1e-9)


def test_distance_to_takes_points_and_bodies():
    with pytest.raises(TypeError, match="point or a body"):
        Box(1, 1, 1).distance_to(Box(1, 1, 1).edges()[0])
    assert Box(2, 2, 2).distance_to((5, 0, 0)) == approx(4)


# -- mesh Booleans ------------------------------------------------------------------------
def test_wrong_mesh_booleans_raise():
    box, sphere = Box(20, 20, 20).mesh(), Sphere(12).mesh()
    with pytest.raises(ModelingError, match="exact parts"):
        box - sphere  # was an open mesh of volume 4377 (exact 1616)
    with pytest.raises(ModelingError, match="exact parts"):
        box + Cylinder(3, 60).rotate(X, 30).rotate(Z, 20).mesh()
    shifted = box - Box(20, 20, 20).translate(10, 10, 10).mesh()  # no face gets a hole: right
    assert shifted.is_closed() and shifted.volume == approx(7000)
