"""Regression tests: features refuse broken input and do not return broken bodies."""

import math
import subprocess
import sys
from pathlib import Path

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


def test_shell_walls_are_measured_across_the_part():
    # The check measured the walls along the world axes only: the plate turned by 10 or 45 degrees
    # got two 6 mm walls in its 10 mm (valid, 10992.0), and 10 mm walls gave the plate back (10 faces).
    # A closed shell is checked on its result: where the walls meet, there is no cavity.
    for angle in (10, 45):
        plate = Box(40, 30, 10).rotate(X, angle)
        for t in (6, 10):
            with pytest.raises(ModelingError, match="do not fit|it built a body with a cavity where its walls meet"):
                plate.shell(t)
        assert plate.shell(4.9).volume == approx(40 * 30 * 10 - 30.2 * 20.2 * 0.2)
    plate = Box(40, 30, 10).rotate(X, 45)
    with pytest.raises(ModelingError, match="a wall of 10 does not fit into the part, which is 10 deep from the face"):
        plate.shell(10, plate.faces().sort_by(Axis((0, 0, 0), (0, -1, 1)))[-1])
    # an L-shaped body whose leg is thinner than two walls (the kernel crashed in 1 run of 4)
    body = Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)
    with pytest.raises(ModelingError, match="two walls of 2.94 do not fit into the part, which is 4 thick across"):
        body.shell(2.94, body.faces().filter(lambda f: abs(f.center().z + 9) < 1e-6))
    # a plate with a hole: shell(4) gave the plate back (3717.2567, 7 faces, valid)
    holed = Box(20, 20, 10) - Cylinder(3, 20)
    with pytest.raises(ModelingError, match="shell: the kernel could not build a valid result"):
        holed.shell(4)
    assert holed.shell(3).volume == approx(3385.646, rel=1e-6)


def test_shell_and_offset_results_are_checked(monkeypatch):
    import smlibpy.shapes

    box = Box(40, 30, 20)
    shell_brep = k.shell_brep
    # the kernel giving the part back unchanged (it did, for walls that left no cavity)
    monkeypatch.setattr(smlibpy.shapes.k, "shell_brep", lambda brep, d, **kw: brep.copy())
    with pytest.raises(ModelingError, match=r"it built a body whose volume did not go down"):
        box.shell(2, box.faces().top())
    # ... or with a corner cut off: less volume, but no cavity
    notch = Box(2, 2, 2).translate(19, 14, 9)
    monkeypatch.setattr(smlibpy.shapes.k, "shell_brep",
                        lambda brep, d, **kw: (Part._wrap(brep.copy()) - notch)._copy_brep())
    with pytest.raises(ModelingError, match=r"it built a body without its cavity: \(.*\), which no wall reaches"):
        box.shell(2, box.faces().top())
    # ... or walls of another thickness, closed: not the part less its offset
    monkeypatch.setattr(smlibpy.shapes.k, "shell_brep", lambda brep, d, **kw: shell_brep(brep, d / 2, **kw))
    with pytest.raises(ModelingError, match="of volume 4848, where the part less its offset by -2 has 9024"):
        box.shell(2)
    monkeypatch.undo()
    # faces that do not meet: refused from 1e-3 of the volume (is_valid() from 1e-2)
    result = Box(40, 30, 19)
    result._props(1e-4)["gaps"] = 2e-3
    assert smlibpy.shapes._offset_problem(result, box.bbox(), 1e-6, 24000.0, True).startswith(
        "a body whose faces do not meet, so that its volume is uncertain by 2.0e-03")
    # offset(0) is an equal copy, without the kernel
    monkeypatch.setattr(smlibpy.shapes.k, "offset_brep", None)
    copy = box.offset(0)
    assert copy.volume == approx(24000) and copy._brep is not box._brep


def test_shell_and_offset_do_not_repeat_what_fails(monkeypatch):
    # Shell tried the kernel eight times (twice in its plain mode, six times in its extended mode)
    # and offset eight times; over 420 runs on imported parts no repeat helped, and a failure cost
    # up to 115 s. Now: the plain mode once, the extended mode once, and once more only after a
    # result that was refused; offset once, and once more after a refused result.
    import smlibpy.defeature
    import smlibpy.shapes

    monkeypatch.setattr(smlibpy.defeature, "GUARD_SECONDS", 0)  # (counted in this process)
    calls = []

    def failing(brep, d, extended_offset=True, **kw):
        calls.append(extended_offset)
        raise RuntimeError("SmApiShellBrepFull failed: SM_ERR (1001)")

    def unchanged(brep, d, extended_offset=True, **kw):
        calls.append(extended_offset)
        return brep.copy()

    box = Box(40, 30, 20)
    for kernel, expect in ((failing, [False, True]), (unchanged, [False, True, True])):
        calls.clear()
        monkeypatch.setattr(smlibpy.shapes.k, "shell_brep", kernel)
        with pytest.raises(ModelingError):
            box.shell(2, box.faces().top())
        assert calls == expect
    for kernel, expect in ((failing, [True]), (unchanged, [True, True])):
        calls.clear()
        monkeypatch.setattr(smlibpy.shapes.k, "offset_brep", kernel)
        with pytest.raises(ModelingError):
            box.offset(1)
        assert calls == expect


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


def test_rounds_that_crashed_the_kernel_raise():
    # In a process of its own, so that a crash fails the test rather than the run.
    # A chamfer of edges at different angles (a hexagonal prism: 90 and 120 degrees) bevelled one
    # edge per kernel call, with edges taken before the first call replaced it: exit 139.
    # The two halves of a box edge that a cone touches tangentially: the kernel has no corner for
    # where they meet, went on, and called corner methods on what it held in the corner's place
    # (exit 139 at any radius). The same for all edges of upstream's revolution_mold.smb.
    mold = Path(__file__).resolve().parent.parent / "third_party/usd-brep/TestFiles/pt_TestFiles/Solids/revolution_mold.smb"
    code = f"""
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
p = RegularPolygon(10, 6).extrude(10)
print(len(p.chamfer(p.edges(), 1).faces()), flush=True)
p = Box(10, 5, 20) - Cone(4, 5, 20)
halves = p.edges().filter(lambda e: abs(e.center().x - 5) < 1e-6 and abs(e.center().z - 10) < 1e-6)
mold = load({str(mold)!r})
for make in (lambda: p.fillet(halves, 0.1), lambda: p.fillet(halves, 0.02), lambda: mold.fillet(mold.edges(), 0.2)):
    try:
        make()
        print("ok", flush=True)
    except KernelError as e:
        print(e.status, flush=True)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, f"exit {run.returncode} after {run.stdout.split()}"
    assert run.stdout.split() == ["38"] + ["SM_ERR_INVALID_INPUT"] * 3
    p = RegularPolygon(10, 6).extrude(10)
    hexagon = p.chamfer(p.edges(), 1)
    assert hexagon.is_valid() and hexagon.volume == approx(2516.827500047, rel=1e-9)  # OpenCASCADE
    # the setbacks: 1 along both faces, 0.5 and 0.7071 from the old edges at 120 and 90 degrees
    assert sorted({round(hexagon.distance_to(e.center()), 9) for e in p.edges()}) == [0.5, 0.707106781]
    p = Box(10, 5, 20) - Cone(4, 5, 20)
    halves = p.edges().filter(lambda e: abs(e.center().x - 5) < 1e-6 and abs(e.center().z - 10) < 1e-6)
    with pytest.raises(KernelError, match="cannot round the selection as given, at any size"):
        p.fillet(halves, 0.1)


def test_a_variable_radius_runs_along_each_edge_on_its_own():
    box = Box(40, 30, 20)
    edge = box.edges().parallel_to(Z)[0]
    assert box.volume - box.fillet(edge, (2, 6)).volume == approx(74.399926, rel=1e-6)
    for continuity in ("G1", "G2", "G3"):  # gave the ruled chamfer (173.3333 removed), not a blend
        with pytest.raises(ValueError, match="circular rounds only"):
            box.fillet(edge, (2, 6), continuity=continuity)
    # A closed edge: the radius rose to 2.9 and fell back to 1 at the seam.
    cylinder = Cylinder(10, 20)
    rim = cylinder.edges().circles().sort_by(Z)[-1]
    with pytest.raises(ValueError, match="closed edge"):
        cylinder.fillet(rim, (1, 3))
    assert cylinder.fillet(rim, (2, 2)).volume == approx(cylinder.fillet(rim, 2).volume, rel=1e-9)
    # Edges that run into each other tangentially: the kernel gave the rounds one radius where they
    # meet, so (1, 3) ran 2.46 -> 1.04 along one edge and 1.65 -> 1.99 -> 1.07 along the arcs.
    plate = Box(40, 30, 10)
    plate = plate.fillet(plate.edges().parallel_to(Z).filter(lambda e: e.center().x > 0), 5)
    chain = plate.edges().filter(lambda e: e.center().z > 4.9 and e.center().x > -19.9)
    with pytest.raises(ValueError, match=r"run into each other tangentially at \(15, 15, 5\)"):
        plate.fillet(chain, (1, 3))
    assert plate.fillet(chain, 2).is_valid()


def test_a_chamfer_needs_one_angle_along_its_edge():
    # A cylinder tilted by 30 degrees on a plate: the faces meet at 60 to 120 degrees along the
    # ellipse, and the bevel of length 1 reached 1 to 3 into the plate.
    plate = Box(60, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MAX))
    above = Box(60, 60, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))
    tilted = plate + (Cylinder(5, 60).rotate(Y, 30) & above)
    foot = tilted.edges().filter(lambda e: abs(e.center().z) < 1e-6 and e.geom_type == "ellipse")
    with pytest.raises(ModelingError, match="60 to 120 degrees apart.*reach 1 to 3 from the edge instead of 1"):
        tilted.chamfer(foot, 1)
    upright = plate + (Cylinder(5, 60) & above)
    ring = upright.edges().filter(lambda e: abs(e.center().z) < 1e-6 and e.geom_type == "circle")
    bevel = upright.chamfer(ring, 1)  # a concave ring: adds the triangle 1 x 1 / 2 around radius 5 1/3
    assert bevel.is_valid() and bevel.volume - upright.volume == approx(math.pi * 2 * (5 + 1 / 3) * 0.5, rel=1e-3)


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


def test_offsets_that_read_freed_kernel_memory_fail():
    # The kernel's offset code read memory it had freed, and the process died now and then (an
    # L-shaped body in 1 run of 4, a fused cone offset by 6 and a shell of two cones in every run):
    # GlueCoincidentBrepVertices glued a Vertex it had deleted, a ProtoEdge it deleted stayed in
    # the lists of other ProtoFaces, and an extended surface was handed out after it was deleted.
    # The kernel steps themselves, in their extended mode, in a process of their own.
    code = """
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
from smlibpy._kernel import k
lbox = Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)
foot = [f._f for f in lbox.faces() if abs(f.center().z + 9) < 1e-6]
cone = Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)
cones = Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16).translate(-2, 2.5147, -4)
end = [min(cones.faces(), key=lambda f: abs(f.center().x - 3))._f]
steps = [lambda: k.shell_brep(lbox._brep, -2.94, extended_offset=True, faces_to_shell=foot),
         lambda: k.offset_brep(cone._brep, 6),
         lambda: k.shell_brep(cones._brep, -2.4, extended_offset=True, faces_to_shell=end)]
for step in steps * 8:
    try:
        step()
        print("ok", flush=True)
    except RuntimeError:
        print("failed", flush=True)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, f"exit {run.returncode} after {len(run.stdout.split())} steps"
    assert len(run.stdout.split()) == 24


def test_shell_offset_and_thicken_run_the_kernel_in_a_copy_of_the_process(monkeypatch):
    # They ran the kernel's offset code in this process, where its crashes killed it: now in a forked
    # copy, whose body comes back as an exact (.smb) copy. A crash there costs only the copy.
    import os
    import signal
    import time

    import smlibpy.defeature
    import smlibpy.shapes

    if not hasattr(os, "fork"):
        pytest.skip("no fork: the kernel runs in this process")
    box = Box(20, 20, 20)
    shelled = box.shell(2, box.faces().top())
    assert shelled.volume == approx(8000 - 16 * 16 * 18) and shelled.is_valid()
    assert box.offset(2).volume == approx(24 ** 3) and Rectangle(10, 10).thicken(1).volume == approx(100)
    with pytest.raises(KernelError, match=r"offset failed \(SM_ERR"):
        (Box(40, 40, 10) - Cylinder(5, 20)).offset(5)  # an error there is raised here

    def crash(*args, **kwargs):
        import faulthandler

        faulthandler.disable()  # (no report of the copy's crash)
        os.kill(os.getpid(), signal.SIGSEGV)

    monkeypatch.setattr(smlibpy.shapes.k, "offset_brep", crash)
    monkeypatch.setattr(smlibpy.shapes.k, "shell_brep", crash)
    for call, name in ((lambda: box.offset(1), "offset"), (lambda: box.shell(1, box.faces().top()), "shell"),
                       (lambda: Rectangle(10, 10).thicken(1), "thicken")):
        crashed = fr"{name}: the kernel crashed \(signal \d+, in a copy of this process\)"  # (6 under ASan)
        with pytest.raises(ModelingError, match=crashed):
            call()
    monkeypatch.setattr(smlibpy.shapes.k, "offset_brep", lambda *a, **kw: time.sleep(10))
    monkeypatch.setattr(smlibpy.defeature, "GUARD_SECONDS", 0.5)
    start = time.monotonic()
    with pytest.raises(ModelingError, match="offset: the kernel did not finish within 0.5 s"):
        box.offset(1)
    assert time.monotonic() - start < 5


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
    # nearly parallel faces: closest points in turn settled slowly and stopped too far apart
    (Cylinder(5, 200), Cylinder(5, 200).rotate(X, 1).translate(12, 0, 0), 2.0),  # was 2.1197
    (Cylinder(5, 200), Cylinder(5, 200).rotate(X, 5).translate(12, 0, 0), 2.0),  # was 2.4853
    (Cylinder(5, 200), Cylinder(5, 200).rotate(X, 10).translate(12, 0, 0), 2.0),  # was 2.0162
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
