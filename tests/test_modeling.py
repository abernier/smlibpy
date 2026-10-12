import math

import pytest

from smlibpy import *

REL = 1e-6


def approx(v, rel=REL):
    return pytest.approx(v, rel=rel)


# -- primitives -------------------------------------------------------------------
def test_primitives_are_exact():
    assert Box(10, 20, 30).volume == approx(6000)
    assert Cylinder(3, 10).volume == approx(math.pi * 9 * 10)
    assert Sphere(5).volume == approx(4 / 3 * math.pi * 125)
    assert Torus(10, 2).volume == approx(2 * math.pi ** 2 * 10 * 4)
    assert Cone(4, 2, 6).volume == approx(math.pi * 6 / 3 * (16 + 8 + 4))
    assert Box(10, 20, 30).area == approx(2 * (200 + 600 + 300))


def test_alignment():
    b = Box(10, 10, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
    assert b.bbox().min.z == pytest.approx(0)
    assert b.bbox().max.z == pytest.approx(4)
    c = Cylinder(2, 5, align=Align.MIN)
    assert c.bbox().min == Vector(0, 0, 0)


# -- booleans ---------------------------------------------------------------------
def test_booleans():
    a, b = Box(10, 10, 10), Box(10, 10, 10).translate(5, 0, 0)
    assert (a + b).volume == approx(1500)
    assert (a - b).volume == approx(500)
    assert (a & b).volume == approx(500)
    assert (a - [Cylinder(1, 20).translate(x, 0, 0) for x in (-2, 2)]).volume == approx(1000 - 2 * math.pi * 10)


def test_boolean_with_pattern():
    plate = Box(80, 60, 10) - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)
    assert plate.volume == approx(48000 - 4 * math.pi * 16 * 10)
    assert plate.is_valid()


def test_disjoint_union_has_two_solids():
    p = Box(1, 1, 1) + Box(1, 1, 1).translate(5, 0, 0)
    assert len(p.solids()) == 2


# -- features ---------------------------------------------------------------------
def test_fillet_and_chamfer():
    box = Box(30, 20, 10)
    f = box.fillet(box.edges().parallel_to(Z), 2)
    assert f.volume == approx(6000 - 4 * (4 - math.pi) * 10)
    c = box.chamfer(box.faces().top().edges(), 2)
    # four prisms along the top edges minus the overlapping corner pyramids
    assert c.volume == approx(6000 - 0.5 * 4 * (2 * 30 + 2 * 20) + 4 * 8 / 3)


def test_fillet_accepts_edges_of_an_equal_part():
    a, b = Box(10, 10, 10), Box(10, 10, 10)
    assert a.fillet(b.edges().parallel_to(Z), 1).volume == approx(1000 - 4 * (1 - math.pi / 4) * 10)


def test_fillet_function_finds_the_part():
    box = Box(10, 10, 10)
    assert fillet(box.edges().parallel_to(Z), 1).volume == approx(1000 - 4 * (1 - math.pi / 4) * 10)


def test_blend_and_variable_fillets():
    box = Box(30, 20, 10)
    g2 = box.fillet(box.edges().parallel_to(Z), 3, continuity="G2")
    assert g2.is_valid() and g2.volume < 6000
    var = box.fillet(box.edges().parallel_to(Z).first, (1, 4))
    assert var.is_valid() and var.volume < 6000


def test_shell():
    box = Box(30, 20, 10)
    assert box.shell(1, box.faces().top()).volume == approx(6000 - 28 * 18 * 9)


def test_split_and_section():
    box = Box(30, 20, 10)
    above, below = box.split(Plane.YZ.offset(5), keep="both")
    assert above.volume == approx(2000) and below.volume == approx(4000)
    assert above.is_valid() and below.is_valid()
    assert Cylinder(5, 20).section(Plane.XZ).area == approx(200)


def test_mirror_keeps_volume():
    w = Wedge(10, 10, 5)
    assert w.mirror(Plane.XZ).volume == approx(w.volume)


def test_mass_properties():
    mp = Box(10, 20, 30).translate(1, 2, 3).mass_properties(density=2)
    assert mp.mass == approx(12000)
    assert mp.center == Vector(1, 2, 3)
    assert mp.inertia[0, 0] == approx(12000 * (20 ** 2 + 30 ** 2) / 12)
    assert abs(mp.inertia[0, 1]) < 1e-6


# -- sketches ---------------------------------------------------------------------
def test_sketch_areas():
    assert (Rectangle(40, 20) - Circle(5)).area == approx(800 - math.pi * 25)
    assert RoundedRectangle(40, 20, 4).area == approx(800 - (4 - math.pi) * 16)
    assert Slot(30, 10).area == approx(200 + math.pi * 25)
    assert RegularPolygon(10, 6).area == approx(3 * math.sqrt(3) / 2 * 100)
    assert Rectangle(20, 10).fillet(2).area == approx(200 - (4 - math.pi) * 4)


def test_sketch_offset():
    assert Rectangle(20, 10).offset(1).area == approx(22 * 12 - (4 - math.pi))
    assert Rectangle(20, 10).offset(-1).area == approx(18 * 8)
    assert Rectangle(20, 10).offset(1, round=False).area == approx(22 * 12)


def test_extrude_variants():
    assert Circle(5).extrude(10, both=True).bbox().min.z == pytest.approx(-10)
    assert Rectangle(10, 10).extrude(-5).bbox().max.z == pytest.approx(0)
    assert Rectangle(10, 4).on(Plane.XZ).extrude(3).bbox().min.y == pytest.approx(-3)
    tapered = Rectangle(20, 20).extrude(10, taper=10)
    assert tapered.is_valid() and tapered.volume < 4000


def test_sketch_on_face_pocket():
    part = Box(50, 50, 20)
    part = part - Rectangle(30, 20).on(part.faces().top()).extrude(-5)
    assert part.volume == approx(50 * 50 * 20 - 30 * 20 * 5)


def test_revolve():
    profile = Polygon((10, 0), (30, 0), (30, 5), (15, 5), (15, 20), (10, 20)).on(Plane.XZ)
    full = math.pi * ((30 ** 2 - 10 ** 2) * 5 + (15 ** 2 - 10 ** 2) * 15)
    assert profile.revolve(Z).volume == approx(full)
    assert profile.revolve(Z, 90).volume == approx(full / 4)
    ring = (Rectangle(10, 10) - Circle(2)).translate(20, 0, 0).on(Plane.XZ)
    assert ring.revolve(Z).volume == approx(2 * math.pi * 20 * (100 - math.pi * 4))


def test_loft_and_sweep():
    assert loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)]).is_valid()
    path = Spline((0, 0, 0), (0, 10, 20), (30, 10, 40))
    # Pappus: a tube's volume is its cross-section times the path length
    assert sweep(Circle(2), path).volume == approx(math.pi * 4 * path.length, rel=1e-6)
    assert sweep(Circle(3) - Circle(1.5), path).volume == approx(math.pi * 6.75 * path.length, rel=1e-6)
    bent = sweep(Rectangle(4, 4), Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30)))
    assert bent.volume == approx(4 * 4 * 60)
    elbow = Wire([Line((0, 0, 0), (0, 0, 20)), CenterArc((10, 20), 10, 180, -90, plane=Plane.XZ)])
    assert sweep(Circle(2), elbow).volume == approx(math.pi * 4 * elbow.length, rel=1e-6)
    helix = Helix(pitch=10, height=40, radius=20)
    assert sweep(Rectangle(4, 2), helix).volume == approx(8 * helix.length, rel=1e-5)


def test_disjoint_sketch_union():
    two = Circle(1).translate(-3, 0, 0) + Circle(1).translate(3, 0, 0)
    assert two.area == approx(2 * math.pi)
    assert len(two.faces()) == 2


# -- curves -----------------------------------------------------------------------
def test_curves():
    assert Line((0, 0), (3, 4)).length == pytest.approx(5)
    arc = CenterArc((0, 0), 10, 0, 90)
    assert arc.length == pytest.approx(5 * math.pi)
    assert arc.radius == pytest.approx(10)
    t = ThreePointArc((0, 0), (1, 1), (2, 0))
    assert t.arc_center == Vector(1, 0, 0)
    s = Spline((0, 0), (10, 5), (20, 0), tangents=((1, 0), (1, 0)))
    assert s.start == Vector(0, 0, 0) and s.end == Vector(20, 0, 0)
    assert s.tangent_at(0) == Vector(1, 0, 0)
    h = Helix(pitch=5, height=20, radius=10)
    assert h.end == Vector(10, 0, 20)
    assert Polyline((0, 0), (10, 0), (10, 10), close=True).is_closed


# -- selectors --------------------------------------------------------------------
def test_selectors():
    part = Box(10, 10, 10) - Cylinder(2, 20)
    assert len(part.edges().parallel_to(Z).lines()) == 4
    assert len(part.faces().cylinders()) == 1
    assert part.faces().top().one().normal_at() == Vector(0, 0, 1)
    assert len(part.faces().facing(-Z)) == 1
    assert len(part.edges().circles()) == 2
    groups = part.edges().group_by(Z)
    assert len(groups) == 3
    assert part.faces().sort_by("area")[-1].area == pytest.approx(2 * math.pi * 2 * 10)
    assert part.faces().sort_by("area")[0].area == pytest.approx(100 - math.pi * 4)
    assert part.faces().top().one().plane.origin.z == pytest.approx(5)


def test_sketch_booleans_of_overlapping_circles():
    a, b = Circle(10).translate(-5, 0), Circle(10).translate(5, 0)
    lens = 2 * 100 * math.acos(0.5) - 5 * math.sqrt(300)
    assert (a & b).area == approx(lens)
    assert (a + b).area == approx(2 * math.pi * 100 - lens)
    assert (a - b).area == approx(math.pi * 100 - lens)
    assert (a ^ b).area == approx(2 * (math.pi * 100 - lens))


def test_oversized_rounds_are_rejected():
    cube = Box(10, 10, 10)
    with pytest.raises(ModelingError):
        cube.fillet(cube.edges(), 6)
    with pytest.raises(ModelingError):
        cube.chamfer(cube.edges(), 6)
    assert cube.fillet(cube.edges(), 4).is_valid()
