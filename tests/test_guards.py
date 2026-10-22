"""Regression tests: features refuse broken input and do not return broken bodies."""

import math
import subprocess
import sys

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
    with pytest.warns(RuntimeWarning, match="do not meet exactly"):  # its faces overlap: no volume to speak of
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
    # the kernel's result differs between builds: a valid-looking body with regions missing
    # (caught by the volume bound) or a broken one (caught by the validity check)
    with pytest.raises(ModelingError, match="too close to the largest|too large"):
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
    assert len((Sphere(5) - [Box(10, 10, 5).translate(0, 0, 2.5), Box(10, 10, 5).translate(0, 0, -2.5)]).faces()) == 0


def test_an_empty_cut_needs_tools_that_can_cover_the_part():
    # A tool beside an earlier hole in a sphere: the kernel's cut is empty, and its intersection of
    # the same pair, which confirmed the empty cut, is the whole part. Both were accepted.
    holed = Sphere(20) - Cylinder(6, 60)
    with pytest.raises(ModelingError, match="empty"):
        holed - Cylinder(3, 60).translate(8, 0, 0)  # was Part(0 faces), no error
    with pytest.raises(ModelingError, match="partly outside an operand"):
        holed & Cylinder(3, 60).translate(8, 0, 0)  # was the whole part, 29089.8 (right: 929.188)
    assert (Sphere(20) - [Cylinder(6, 60), Cylinder(3, 60).translate(8, 0, 0)]).volume == approx(28160.608174, rel=1e-8)


def test_an_intersection_may_give_an_operand_back_when_the_other_contains_it():
    box = Box(10, 10, 10)
    assert (box & Box(20, 20, 20)).volume == approx(1000)
    assert (box & Box(10, 10, 20)).volume == approx(1000)  # faces shared
    assert (Sphere(5) & Box(20, 20, 20)).volume == approx(4 / 3 * math.pi * 125)
    assert (Box(30, 30, 30) & Sphere(20)).volume == approx((Sphere(20) & Box(30, 30, 30)).volume)


def test_boolean_results_are_checked_when_asked():
    # Closed, manifold results of sound operands were marked valid unchecked. Two cylinders whose
    # lowest lines touch: the kernel's intersection leaves a face out (volume 250.206, more than its
    # operand's 150.796; its faces leave gaps of 0.25), and the difference has no volume.
    a = Cylinder(2, 12)
    b = Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)
    common = Part._wrap(k.boolean(a._copy_brep(), b._copy_brep(), operation=k.BooleanOp.INTERSECTION))
    assert not common.is_valid() and "open between its faces" in common._solid_problem()
    with pytest.raises(ModelingError, match="not a valid solid"):
        common.fillet(common.edges(), 0.1)
    rest = a - b
    assert not rest.is_valid() and rest._solid_problem() == "without volume"
    with pytest.raises(ModelingError, match="partly outside an operand"):
        a & b  # reaches out of the first cylinder
    assert (Box(20, 20, 20) - Cylinder(5, 30)).is_valid()


@pytest.mark.xfail(strict=True, reason="kernel plan B6: a primitive's seam line in a tangent plane of the other operand")
@pytest.mark.parametrize("cut, exact", [
    (lambda: (Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0), 24299.258668),
    (lambda: Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 90).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3),
     6931.747603),
], ids=["groove pin", "cross holes"])
def test_holes_tangent_to_a_seam(cut, exact):
    assert cut().volume == approx(exact, rel=1e-7)  # 24331.7029 and 7057.1895, both valid


def test_failed_booleans_free_their_operands():
    # The kernel keeps both operands when a Boolean fails; their copies were never freed: 0.6 MB
    # per failed cut. In a process of its own, so that what other tests left does not count.
    code = """
import gc, os
from smlibpy import *
def rss():
    return int(os.popen(f"ps -o rss= -p {os.getpid()}").read()) / 1024
def fail():
    try:
        Box(40, 30, 20) - Cylinder(3, 40).translate((-5, 0, 0)) - Cylinder(3, 40)
    except KernelError:
        pass
for _ in range(10):
    fail()
gc.collect()
before = rss()
for _ in range(100):
    fail()
gc.collect()
print(rss() - before)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr
    grown = float(run.stdout.strip())
    assert grown < 25, f"100 failed cuts took {grown:.1f} MB"  # was 53 MB


def test_booleans_that_read_freed_kernel_memory_raise():
    # Each of these read freed memory in the kernel and killed the process (exit 139); in a
    # process of their own, so that a crash fails the test rather than the run.
    # Crossing holes whose seams lie tangent to the other hole: SplitIntersectingProtoEdges split a
    # ProtoEdge it had just deleted (now: SM_ERR_BAD_INTERSECTIONS). A flat end cap tangent to a
    # sphere: the Boolean deleted a Shell that Faces still used (DeleteFaces), and BooleanPostProcess
    # read it. The shell of a rotated box: BooleanPostProcess read a deleted Vertex, in one call of
    # four or so (40 calls).
    code = """
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
h1 = Cylinder(3, 40).translate(0, 3, 0)
cases = []
for z in (3, 3.1):
    h2 = Cylinder(3, 40).rotate(Y, 90).translate(0, 0, z)
    cases += [lambda: Box(20, 20, 20) - h1 - h2, lambda: Box(20, 20, 20) - [h1, h2], lambda: h1 + h2,
              lambda: h1 & h2, lambda: h1.merge(h2)]
cases.append(lambda: Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504))
box = Box(40, 30, 10).rotate(X, 45)
opening = box.faces().sort_by(Axis((0, 0, 0), (0, -1, 1)))[-1]
cases += [lambda: box.shell(10, opening)] * 40
for case in cases:
    try:
        case()
        print("ok", flush=True)
    except KernelError:
        print("KernelError", flush=True)
    except ModelingError:
        print("ModelingError", flush=True)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, f"exit {run.returncode} after {len(run.stdout.split())} cases"
    out = run.stdout.split()
    assert out[:11] == ["KernelError"] * 11  # the crossing holes and the end cap
    assert len(out) == 51
    assert (Sphere(1.5).rotate(Y, 90) & Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)).volume == approx(
        14.137072, rel=1e-6)  # the same pair's intersection works


def test_a_merge_that_loses_volume_raises():
    # A sphere whose seam lies tangent to the cylinder: the kernel's merge came out smaller than the
    # cut cylinder (518.314 against 566.559; right: 586.443), and cells() of it crashed the process.
    pin = Cylinder(2.5, 30).rotate(Y, 90) - Cone(2.5, 6, 6).rotate(Y, 90).translate(15, 0.6687, -3.5)
    with pytest.raises(ModelingError, match="less than that of the largest part"):
        pin.merge(Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5))
    right = pin.merge(Sphere(2).translate(0, -0.5, 2.5))  # the sphere not turned
    assert right.volume == approx(586.443229, rel=1e-6)  # OpenCASCADE
    assert sum(c.volume for c in right.cells()) == approx(586.443229, rel=1e-6)


# -- moved bodies -------------------------------------------------------------------------
def test_moved_bodies_keep_their_tolerances():
    # Moving a body reset its tolerances from the box of its vertices: a torus (one vertex) got 0,
    # and the Booleans of the moved torus went wrong.
    groove = Cylinder(10, 40) - Torus(10, 1.5).translate(0, 0, 10)
    assert groove.volume == approx(12358.441682, rel=1e-8)  # was 12566.37: the groove was ignored
    corner = (Torus(8, 1.5) & Box(4, 4, 4).translate(8, 0, 0)).volume
    assert corner == approx(28.586308, rel=1e-6)
    moves = [lambda p: p.translate(0, 0, 5),  # was 355.31, the whole torus
             lambda p: p.rotate(Z, 30), lambda p: p.mirror(Plane.YZ), lambda p: p.scale(-1),
             lambda p: p.moved(Location((5, 6, 7), (10, 20, 30)))]
    for move in moves:
        assert (move(Torus(8, 1.5)) & move(Box(4, 4, 4).translate(8, 0, 0))).volume == approx(corner, rel=1e-6)
    assert (Torus(8, 1.5).scale(2) & Box(8, 8, 8).translate(16, 0, 0)).volume == approx(8 * corner, rel=1e-6)
    assert (Torus(8, 1.5).scale((1, 1, 2)) & Box(4, 4, 8).translate(8, 0, 0)).volume == approx(2 * corner, rel=1e-6)
    # a part over 500 across went from tolerance 1e-5 to 1e-4: a step of 5e-5 was absorbed
    step = Box(1000, 1000, 100).translate(1, 0, 0) + Box(10, 10, 100.00005).translate(1, 0, 2.5e-5)
    assert len(step.faces()) == 11  # was 6


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
    # (was an open mesh of volume 4377, exact 1616: the polygons with holes the kernel leaves were
    # read by their outer loops; now they are triangulated first)
    corners = box - sphere
    assert corners.is_closed() and corners.volume == approx(box.volume - (box & sphere).volume)
    with pytest.raises(ModelingError, match="exact parts"):
        box + Cylinder(3, 60).rotate(X, 30).rotate(Z, 20).mesh()
    shifted = box - Box(20, 20, 20).translate(10, 10, 10).mesh()  # no face gets a hole: right
    assert shifted.is_closed() and shifted.volume == approx(7000)
