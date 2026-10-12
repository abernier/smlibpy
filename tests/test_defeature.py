"""Fillet and face removal: faces().fillets(), Part.remove_fillets, Part.remove_faces."""

import math

import pytest

from smlibpy import Align, Box, Cylinder, ModelingError, Part, Slot, Z, export_step, import_step


def exact_volume(part: Part) -> float:
    return part.mass_properties(accuracy=1e-10).volume


def same(a: float, b: float, rel: float = 1e-9) -> bool:
    return abs(a - b) <= rel * max(abs(a), abs(b), 1.0)


@pytest.fixture(scope="module")
def box():
    return Box(40, 30, 20)


@pytest.fixture(scope="module")
def plate():
    return Box(60, 40, 5, align=(Align.CENTER, Align.CENTER, Align.MAX))


# -- finding fillets -------------------------------------------------------------------------
def test_fillets_found_by_geometry(box):
    rounded = box.fillet(box.edges(), 3)  # 12 edge rounds and 8 corner spheres
    found = rounded.faces().fillets()
    assert len(found) == 20
    assert sorted({f.geom_type for f in found}) == ["cylinder", "sphere"]
    assert len(rounded.faces().fillets(max_radius=3)) == 20
    assert len(rounded.faces().fillets(max_radius=2.9)) == 0
    assert len(box.faces().fillets()) == 0


def test_fillets_skip_walls_and_holes(box):
    holed = box - Cylinder(5, 40)
    assert len(holed.faces().fillets()) == 0
    # the side of a disc rounded at both ends meets two fillets tangentially but is no fillet
    disc = Cylinder(10, 8)
    disc = disc.fillet(disc.edges(), 2)
    found = disc.faces().fillets()
    assert len(found) == 2 and {f.geom_type for f in found} == {"revolution"}
    # the round ends of a slot look like fillets; max_radius keeps them out
    slot = Slot(40, 12).extrude(5)
    assert len(slot.faces().fillets()) == 2
    assert len(slot.faces().fillets(max_radius=5)) == 0


def test_fillets_rejects_bad_radius(box):
    with pytest.raises(ValueError):
        box.faces().fillets(max_radius=0)


# -- removing fillets ------------------------------------------------------------------------
def test_remove_vertical_fillets_gives_the_box_back(box):
    rounded = box.fillet(box.edges().parallel_to(Z), 3)
    sharp = rounded.remove_fillets()
    assert sharp.is_valid() and len(sharp.faces()) == 6
    assert all(f.geom_type == "plane" for f in sharp.faces())
    assert same(exact_volume(sharp), 24000.0, 1e-12)
    b = sharp.bbox()
    assert b.min.to_tuple() == pytest.approx((-20, -15, -10), abs=1e-9)
    assert b.max.to_tuple() == pytest.approx((20, 15, 10), abs=1e-9)
    assert len(rounded.faces()) == 10  # the input is unchanged


def test_remove_all_rounds_of_a_box(box):
    rounded = box.fillet(box.edges(), 3)
    sharp = rounded.remove_fillets()
    assert sharp.is_valid() and len(sharp.faces()) == 6
    assert same(exact_volume(sharp), 24000.0, 1e-12)


def test_remove_mitred_and_blend_fillets(box):
    top = box.fillet(box.edges().filter(lambda e: e.center().z > 9), 3)
    variable = box.fillet(box.edges().parallel_to(Z), (2, 4))
    g2 = box.fillet(box.edges().parallel_to(Z), 3, continuity="G2")
    for rounded in (top, variable, g2):
        sharp = rounded.remove_fillets()
        assert len(sharp.faces()) == 6 and same(exact_volume(sharp), 24000.0, 1e-12)


def test_remove_fillets_between_boss_and_plate(plate):
    sharp = plate + Box(20, 16, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
    rounded = sharp.fillet(sharp.edges().filter(lambda e: abs(e.center().z) < 1e-6 and e.convexity == "concave"), 2)
    assert len(rounded.faces().fillets()) == 8  # 4 fillets, 4 corner patches
    back = rounded.remove_fillets()
    assert back.is_valid() and len(back.faces()) == len(sharp.faces()) == 11
    assert same(exact_volume(back), 15200.0, 1e-12)
    assert exact_volume(back) < exact_volume(rounded)  # concave fillets held material


def test_remove_ring_fillet_around_a_boss(plate):
    sharp = plate + Cylinder(6, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
    ring = sharp.edges().filter(lambda e: abs(e.center().z) < 1e-6 and e.geom_type == "circle")
    rounded = sharp.fillet(ring, 2)
    back = rounded.remove_fillets()
    assert back.is_valid() and len(back.faces()) == len(sharp.faces())
    assert same(exact_volume(back), 12000 + math.pi * 36 * 10, 1e-11)


def test_remove_convex_and_concave_fillets_together(plate):
    sharp = plate + Cylinder(6, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
    rounded = sharp.fillet(sharp.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 9), 2)
    rounded = rounded.fillet(rounded.edges().filter(lambda e: e.geom_type == "circle" and abs(e.center().z) < 1e-6), 1.5)
    back = rounded.remove_fillets()
    assert same(exact_volume(back), exact_volume(sharp), 1e-11)
    # only the small concave one
    some = rounded.remove_fillets(max_radius=1.5)
    assert len(some.faces()) == len(rounded.faces()) - 1
    assert exact_volume(some) < exact_volume(rounded)


def test_remove_selected_fillets_only(box):
    rounded = box.fillet(box.edges().parallel_to(Z), 3)
    one = rounded.faces().fillets().sort_by("x")[0]
    back = rounded.remove_fillets(one)
    assert len(back.faces()) == 9
    gained = exact_volume(back) - exact_volume(rounded)  # one round: (r^2 - pi r^2 / 4) * 20
    assert abs(gained - 20 * (9 - 9 * math.pi / 4)) <= 1e-9 * 24000


def test_remove_fillets_after_a_step_round_trip(box, tmp_path):
    rounded = box.fillet(box.edges(), 3)
    export_step(rounded, str(tmp_path / "rounded.step"))
    imported = import_step(str(tmp_path / "rounded.step"))
    sharp = imported.remove_fillets()
    assert sharp.is_valid() and len(sharp.faces()) == 6
    assert same(exact_volume(sharp), 24000.0, 1e-12)


def test_remove_fillets_refuses_other_faces(box):
    rounded = box.fillet(box.edges().parallel_to(Z), 3)
    with pytest.raises(ModelingError, match="no fillets"):
        rounded.remove_fillets(rounded.faces().top())
    with pytest.raises(ValueError):
        rounded.remove_fillets([])


def test_remove_fillets_without_fillets_returns_the_part(box):
    assert box.remove_fillets() is box


# -- removing other faces --------------------------------------------------------------------
@pytest.mark.parametrize("name", ["through hole", "blind hole", "boss", "pocket", "counterbore", "two holes"])
def test_remove_faces_closes_holes_and_drops_bosses(box, name):
    if name == "through hole":
        part = box - Cylinder(5, 40)
        faces = part.faces().cylinders()
    elif name == "blind hole":
        part = box - Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
        faces = part.faces().cylinders()  # the floor goes with the wall
    elif name == "boss":
        part = box + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 10)
        faces = part.faces().cylinders()  # the top goes with the side
    elif name == "pocket":
        part = box - Box(10, 8, 6, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
        faces = part.faces().filter(lambda f: f.bbox().max.z < 10 + 1e-6 and f.bbox().min.z > 3.9)
    elif name == "counterbore":
        part = box - Cylinder(3, 40) - Cylinder(6, 4, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
        faces = part.faces().filter(lambda f: f.geom_type == "cylinder" or (f.is_planar and abs(f.center().z - 6) < 1e-9))
    else:
        part = box - Cylinder(3, 40).translate(-10, 0, 0) - Cylinder(3, 40).translate(10, 0, 0)
        faces = part.faces().cylinders()
    back = part.remove_faces(faces)
    assert back.is_valid() and len(back.faces()) == 6
    assert same(exact_volume(back), 24000.0, 1e-12)


def test_remove_faces_errors(box):
    holed = box - Cylinder(5, 40)
    with pytest.raises(ValueError):
        holed.remove_faces([])
    with pytest.raises(ModelingError, match="every face"):
        holed.remove_faces(holed.faces())
    with pytest.raises(ValueError):
        holed.remove_faces(Box(1, 1, 1).translate(100, 0, 0).faces().top())
