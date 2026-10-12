"""Deformations: twist, taper, bend and lattices (smlibpy.deform)."""

import math

import numpy as np
import pytest

from smlibpy import (Axis, Box, Cylinder, Lattice, ModelingError, Part, Plane, Rectangle, Shell, Sphere, X, Y, Z,
                     bend, export_step, import_step, taper, twist)
from smlibpy import deform as D
from smlibpy._kernel import ext, k


def volume(p: Part) -> float:
    # the kernel's default accuracy is not enough for bent B-spline bodies (see the deform guide)
    return p.mass_properties(accuracy=1e-10).volume


def surfaces(p) -> list[dict]:
    return [ext.surface_data(f._f.surface(), True) for f in p.faces()]


def face_points(face, n: int = 4) -> list:
    """Points of a face (a UV grid, those inside the trims)."""
    (u0, v0), (u1, v1) = face._f.uv_domain()
    out = []
    for a in range(n):
        for b in range(n):
            u, v = u0 + (a + 0.5) / n * (u1 - u0), v0 + (b + 0.5) / n * (v1 - v0)
            if face._f.classify_uv(u, v) != "outside":
                out.append(face._f.point_at_uv(u, v))
    return out


def deviation(plan: "D._Plan", result) -> float:
    """Largest distance between the result and the exact map of the plan's shape, at the same parameters."""
    spec = dict(plan.spec, max_degree=D.MAX_DEGREE)
    d = k.deform.deviation(plan.shape._brep, result._brep, spec, 9)
    return max(d.values())


# -- twist ---------------------------------------------------------------------
def test_twist_keeps_volume_and_topology():
    box = Box(20, 10, 100)
    bar = box.twist(90)
    assert bar.is_valid() and len(bar.faces()) == 6 and len(bar.edges()) == 12
    assert volume(bar) == pytest.approx(20000, rel=1e-8)
    # the top is turned by exactly 90 degrees about Z: 20 x 10 becomes 10 x 20
    top = sorted(tuple(round(c, 9) for c in v.point) for v in bar.vertices() if v.z > 49)
    assert top == [(-5.0, -10.0, 50.0), (-5.0, 10.0, 50.0), (5.0, -10.0, 50.0), (5.0, 10.0, 50.0)]
    bottom = sorted(tuple(round(c, 9) for c in v.point) for v in bar.vertices() if v.z < -49)
    assert bottom == [(-10.0, -5.0, -50.0), (-10.0, 5.0, -50.0), (10.0, -5.0, -50.0), (10.0, 5.0, -50.0)]


def test_twist_is_exact_where_it_can_be_and_within_tolerance_elsewhere():
    box = Box(20, 20, 100)
    plan = D._plan_twist(box, 90.0, Z, None, None, 1e-6)
    bar = box.twist(90)
    assert deviation(plan, bar) < 1e-6
    data = surfaces(bar)
    assert all(d["kind"] == "bspline" for d in data)
    degrees = sorted((d["u_degree"], d["v_degree"]) for d in data)
    # top and bottom only turn: still planes of degree 1; the sides keep their straight rulings
    assert degrees.count((1, 1)) == 2
    assert all(1 in dd for dd in degrees)


def test_twist_range_turns_the_rest_rigidly():
    box = Box(20, 10, 100)
    bar = box.twist(90, start=-20, end=20)
    assert bar.is_valid() and len(bar.faces()) == 14  # the side faces are split at the range ends
    assert volume(bar) == pytest.approx(20000, rel=1e-8)
    top = sorted(tuple(round(c, 9) for c in v.point) for v in bar.vertices() if v.z > 49)
    assert top == [(-5.0, -10.0, 50.0), (-5.0, 10.0, 50.0), (5.0, -10.0, 50.0), (5.0, 10.0, 50.0)]
    # below the range nothing moved; above it the faces are planes again, only turned
    low = [f for f in bar.faces() if f.center().z < -21]
    assert len(low) == 5 and all(f.geom_type == "plane" for f in low)
    high = [f for f in bar.faces() if f.center().z > 21]
    assert len(high) == 5 and all(f.geom_type == "plane" for f in high)
    plan = D._plan_twist(box, 90.0, Z, -20, 20, 1e-6)
    assert deviation(plan, bar) < 1e-6


def test_twist_round_trip():
    part = Box(30, 20, 60) - Cylinder(4, 80)
    back = part.twist(120).twist(-120)
    assert back.is_valid() and len(back.faces()) == len(part.faces())
    assert volume(back) == pytest.approx(volume(part), rel=1e-7)
    for v in back.vertices():
        assert part.distance_to(v.point) < 1e-6
    for f in back.faces():
        assert max(part.distance_to(p) for p in face_points(f)) < 2e-6


def test_twist_about_another_axis_and_with_holes():
    plate = Box(80, 60, 10) - Cylinder(5, 20)
    t = plate.twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))
    assert t.is_valid()
    assert volume(t) == pytest.approx(80 * 60 * 10 - math.pi * 25 * 10, rel=1e-7)


# -- taper ---------------------------------------------------------------------
def test_taper_turns_a_cylinder_into_an_exact_cone():
    cyl = Cylinder(10, 50)
    cone = cyl.taper(0.5)
    assert cone.is_valid() and len(cone.faces()) == 3
    assert volume(cone) == pytest.approx(math.pi * 50 / 3 * (100 + 50 + 25), rel=1e-9)
    plan = D._plan_taper(cyl, 0.5, Z, None, None, 1e-6)
    assert deviation(plan, cone) < 1e-9  # exact
    side = [d for d in surfaces(cone) if d["weights"] is not None]
    assert [(d["u_degree"], d["v_degree"]) for d in side] == [(2, 1)]
    # the top circle has half the radius
    top = cone.edges().sort_by(Z)[-1]
    for t in (0.0, 0.3, 0.7):
        p = top.point_at(t)
        assert math.hypot(p.x, p.y) == pytest.approx(5, abs=1e-9) and p.z == pytest.approx(25, abs=1e-9)


def test_taper_box_is_a_frustum_and_ranges_work():
    f = Box(20, 20, 50).taper(2.0)
    assert volume(f) == pytest.approx(50 / 3 * (400 + 1600 + 800), rel=1e-12)
    half = Box(20, 20, 50).taper(0.5, start=0)
    assert half.is_valid() and len(half.faces()) == 10
    assert volume(half) == pytest.approx(20 * 20 * 25 + 25 / 3 * (400 + 100 + 200), rel=1e-12)


# -- bend ----------------------------------------------------------------------
def test_bend_keeps_the_volume_of_a_bar_bent_about_its_middle_layer():
    bar = Box(100, 10, 10)
    b = bar.bend(90)
    assert b.is_valid() and len(b.faces()) == 6
    assert volume(b) == pytest.approx(10000, rel=1e-6)
    r = 100 / (math.pi / 2)
    faces = sorted(round(f.area, 6) for f in b.faces())
    assert faces == pytest.approx(sorted([100, 100, 1000, 1000, (r - 5) * math.pi / 2 * 10, (r + 5) * math.pi / 2 * 10]),
                                  rel=1e-7)
    plan = D._plan_bend(bar, 90.0, None, Plane.XZ, None, None, 1e-6)
    assert deviation(plan, b) < 1e-6


def test_bend_changes_the_volume_by_pappus_rule():
    # neutral layer at the bottom of the bar: every layer above it gets shorter by (r - y) / r
    bar = Box(100, 10, 10)
    b = bar.bend(90, plane=Plane((0, 0, -5), (1, 0, 0), (0, -1, 0)))
    r = 100 / (math.pi / 2)
    assert volume(b) == pytest.approx(10000 * (1 - 5 / r), rel=1e-6)


def test_bend_with_radius_makes_straight_legs():
    u = Box(160, 10, 6).bend(180, radius=25)
    assert u.is_valid() and len(u.faces()) == 14
    assert volume(u) == pytest.approx(160 * 10 * 6, rel=1e-6)
    bb = u.bbox()
    # the left leg stays, the right one comes back above it, 2 * 25 higher
    assert bb.min.x == pytest.approx(-80) and bb.max.z == pytest.approx(53)
    legs = sorted((f for f in u.faces() if f.geom_type == "plane" and abs(f.normal_at().z) > 0.999),
                  key=lambda f: f.center().z)
    assert [round(f.center().z, 9) for f in legs] == [-3, 3, 47, 53]


def test_bend_downward_from_a_start():
    b = Box(100, 10, 10).bend(-90, radius=20, start=10)
    bb = b.bbox()
    assert bb.max.x == pytest.approx(35) and bb.min.z == pytest.approx(-20 - (50 - 10 - 10 * math.pi))
    assert volume(b) == pytest.approx(10000, rel=1e-6)


def test_bend_refuses_what_cannot_work():
    with pytest.raises(ModelingError, match="larger radius"):
        Box(100, 10, 10).bend(90, radius=4)
    with pytest.raises(ValueError, match="less than 360"):
        Box(100, 10, 10).bend(360)
    with pytest.raises(ValueError, match="only two of radius"):
        Box(100, 10, 10).bend(90, radius=10, start=0, end=5)
    with pytest.raises(ModelingError, match="does not reach"):
        Box(100, 10, 10).bend(90, radius=10, start=60)


# -- lattice -------------------------------------------------------------------
def test_unchanged_lattice_changes_nothing():
    part = Box(30, 20, 10) - Cylinder(3, 20)
    lat = Lattice(part, 3)
    same = lat.apply(part)
    assert volume(same) == pytest.approx(volume(part), rel=1e-10)
    for v in same.vertices():
        assert part.distance_to(v.point) < 1e-9


def test_lattice_result_is_exact():
    block = Box(60, 40, 20)
    lat = Lattice(block, 3)
    lat.move((1, 1, -1), (0, 0, 8))
    plan = lat._plan(block, 1e-6)
    pillow = lat.apply(block)
    assert pillow.is_valid() and len(pillow.faces()) == 6
    assert deviation(plan, pillow) < 1e-9
    assert all((d["u_degree"], d["v_degree"]) in ((1, 1), (1, 2), (2, 1), (2, 2)) for d in surfaces(pillow))
    # the Bernstein weight of the middle point at the middle of the top is 1/2 * 1/2
    top = pillow.faces().sort_by(Z)[-1]
    assert top.distance_to((0, 0, 10 + 8 * 0.25)) < 1e-9
    assert lat.map((0, 0, 10)) == pytest.approx((0, 0, 12))


def test_lattice_on_curved_parts_is_exact_up_to_max_degree():
    cyl = Cylinder(15, 20)
    lat = Lattice(cyl, 3)
    lat.scale(lat.layer(Z, -1), 1.5)
    out = lat.apply(cyl)
    assert out.is_valid()
    assert deviation(lat._plan(cyl, 1e-6), out) < 1e-9
    sph = Sphere(10)
    lat4 = Lattice(sph, 4)
    lat4.move((1, 1, 3), (0, 0, 6))
    blob = lat4.apply(sph)  # a sphere in a 4 x 4 x 4 lattice needs degree 18: within the tolerance
    assert blob.is_valid() and deviation(lat4._plan(sph, 1e-6), blob) < 1e-6


def test_lattice_editing_helpers():
    lat = Lattice(Box(10, 10, 10), (2, 3, 4))
    assert lat.points.shape == (2, 3, 4, 3) and lat.counts == (2, 3, 4)
    lat.move(lat.layer(Z, -1), (0, 0, 2))
    assert np.allclose(lat.offsets[:, :, -1], (0, 0, 2)) and np.allclose(lat.offsets[:, :, :-1], 0)
    lat.reset().scale(lat.layer(Z, 0), 2.0)
    assert lat.points[:, :, 0, 0].min() == pytest.approx(-10)
    lat.reset().rotate(lat.layer(Z, -1), Z, 90)
    assert lat.points[1, 0, -1] == pytest.approx((5, 5, 5))  # (5, -5) turned by 90 degrees
    with pytest.raises(IndexError):
        lat.move((1, 1), (0, 0, 1))
    with pytest.raises(ValueError):
        Lattice(Box(10, 10, 10), 1)


def test_lattice_refuses_folding():
    lat = Lattice(Box(10, 10, 10), 3)
    lat.move((2, 1, 1), (-30, 0, 0))
    with pytest.raises(ModelingError, match="folds"):
        lat.apply(Box(10, 10, 10))


# -- shells, kernel composition, downstream ---------------------------------------
def test_sketches_and_shells_deform_to_shells():
    s = twist(Rectangle(100, 20), 90, axis=X)
    assert isinstance(s, Shell) and s.area > 2000
    b = bend(Rectangle(100, 20), 90)
    assert isinstance(b, Shell) and b.area == pytest.approx(2000, rel=1e-7)


def test_kernel_composition_agrees():
    """The kernel's own (procedural) composition of the twist and our NURBS are the same body."""
    box = Box(20, 20, 100)
    plan = D._plan_twist(box, 90.0, Z, None, None, 1e-6)
    exact = Part._wrap(k.deform.composite_brep(box._brep, plan.spec))
    assert ext.surface_data(exact.faces()[0]._f.surface(), False)["class"] == "SmSrfInVolume"
    assert exact.volume == pytest.approx(40000, rel=1e-9)
    bar = box.twist(90)
    for f in exact.faces():
        assert max(bar.distance_to(p) for p in face_points(f)) < 1e-6


def test_deformed_parts_work_downstream(tmp_path):
    bar = Box(20, 20, 100).twist(90)
    holed = bar - Cylinder(4, 40).rotate(X, 90)
    assert holed.is_valid() and volume(holed) < volume(bar)
    rounded = bar.fillet(bar.faces().sort_by(Z)[-1].edges(), 2)
    assert rounded.is_valid()
    export_step(bar, tmp_path / "bar.step")
    back = import_step(tmp_path / "bar.step")
    assert volume(back) == pytest.approx(40000, rel=1e-7)


def test_errors():
    with pytest.raises(ValueError, match="angle is 0"):
        Box(1, 1, 1).twist(0)
    with pytest.raises(ModelingError, match="does not reach"):
        Box(10, 10, 10).twist(90, start=20, end=30)
    with pytest.raises(ValueError, match="positive"):
        Box(10, 10, 10).taper(0)
    with pytest.raises(ValueError, match="tolerance"):
        Box(10, 10, 10).twist(90, tolerance=0)
    with pytest.raises(TypeError):
        twist(Z, 90)


# -- MCP ---------------------------------------------------------------------------
def test_mcp_session_deforms_and_finds_the_guides():
    from smlibpy.mcp import discovery
    from smlibpy.mcp.session import Session

    s = Session()
    try:
        r = s.run("bar = Box(20, 20, 100).twist(90)\nprint(round(bar.mass_properties(accuracy=1e-10).volume, 3))")
        assert r["ok"] and r["output"].strip() == "40000.0"
        r = s.run("lat = Lattice(bar, 3)\nlat.move((1, 1, -1), (0, 0, 5))\npillow = lat.apply(bar)\npillow.is_valid()")
        assert r["ok"] and r["value"] == "True"
        bad = s.run("bar.bend(90, radius=1)")
        assert not bad["ok"] and "ModelingError" in bad["error"] and "larger radius" in bad["error"]
        assert {item["name"] for item in s.run("1")["scene"]} >= {"bar", "pillow"}
    finally:
        s.close()
    for query, key in [("twist a bar", "twist"), ("bend a tube into a U", "bend"), ("taper the grip", "taper"),
                       ("free-form deformation with a cage", "Lattice"), ("warp the part", "Lattice"),
                       ("morph a shape", "Lattice")]:
        assert key in [e.key.split("/")[-1].split(".")[-1] for _, e in discovery.search(query, 6)], query
    assert discovery.guide("deform/generic") is not None and discovery.guide("recipes/deform") is not None
    assert discovery.guide_for(discovery.find_method("Part.twist")).key == "deform/twist"
