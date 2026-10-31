"""machining_setup: a part laid on a 3-axis machine, its features sorted into DXF layers.

The numbers are worked out by hand: areas of rectangles and circles, volumes of boxes, and the
closed form of a band between two arcs.
"""

import math
import re

import pytest
from pytest import approx

from smlibpy import *

MIN = (Align.MIN, Align.MIN, Align.MIN)


def block() -> Part:
    """A 100 x 60 x 20 block with one feature of every kind."""
    b = Box(100, 60, 20, align=MIN)
    b -= Box(30, 20, 8, align=(Align.MIN, Align.MIN, Align.MAX)).translate(20, 20, 20)  # a pocket, 8 deep
    b -= Cylinder(5, 50).translate(80, 40, 0)  # a hole through
    b -= Box(20, 60, 5, align=(Align.MAX, Align.MIN, Align.MAX)).translate(100, 0, 20)  # a rabbet at the end, 5 deep
    b -= Box(10, 10, 5, align=MIN).translate(60, 10, 0)  # a pocket from below
    b -= Box(15, 8, 8, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(0, 30, 10)  # a mortise in the end
    return b - Box(10, 10, 10).translate(60, 45, 10)  # a void


def by_name(setup: MachiningSetup) -> dict[str, float]:
    return {s.name: s.area for s in setup.layers}


def test_the_layers_of_a_block_seen_from_above():
    setup = machining_setup(block(), label="A1")
    areas = by_name(setup)
    assert setup.thickness == approx(20)
    assert setup.plane == Plane.XY  # (the block as it stands: its long edge along x, the corner at the origin)
    assert [s.name for s in setup.layers] == ["OUTLINE", "THROUGH", "POCKET_D5", "POCKET_D8", "LABEL"]
    assert areas["OUTLINE"] == approx(6000)  # the footprint, holes filled
    assert areas["THROUGH"] == approx(math.pi * 25)
    assert areas["POCKET_D8"] == approx(30 * 20)
    assert areas["POCKET_D5"] == approx(20 * 60 - math.pi * 25 / 2)  # the rabbet, less the half of the hole in it
    pocket = setup.layer("POCKET_D8").bbox()
    assert (pocket.min.x, pocket.min.y, pocket.max.x, pocket.max.y) == approx((20, 20, 50, 40))
    label = setup.layer("LABEL")
    assert len(label.faces()) == 3 and 25 < label.center().x < 75 and 15 < label.center().y < 45  # A, 1 and the arrow
    left = sorted((why, len(faces)) for why, _, faces in setup.elsewhere)
    assert left == [("enclosed", 6), ("opens at the side", 5), ("opens below", 1)]  # a void; a mortise; a floor
    side = next((d, faces) for why, d, faces in setup.elsewhere if why == "opens at the side")
    assert side[0].to_tuple() == approx((-1, 0, 0))  # the mortise opens through the x = 0 end
    below = next(d for why, d, _ in setup.elsewhere if why == "opens below")
    assert below.to_tuple() == approx((0, 0, -1))
    for s in setup.layers:
        assert s.bbox().min.z == approx(0) and s.bbox().max.z == approx(0)  # all in the XY plane


def test_the_same_block_tilted_in_space_gives_the_same_drawing():
    loc = Pos(50, -20, 30) * Rot(x=30, y=-20, z=70)
    tilted = loc * block()
    top = tilted.faces().facing(loc.plane.z_dir).sort_by(lambda f: f.area)[-1]
    setup = machining_setup(tilted, top)
    areas = by_name(setup)
    assert setup.thickness == approx(20)
    assert (
        areas["OUTLINE"] == approx(6000)
        and areas["POCKET_D8"] == approx(600)
        and areas["THROUGH"] == approx(math.pi * 25)
    )
    assert setup.layer("OUTLINE").bbox().size.to_tuple() == approx((100, 60, 0))
    assert setup.plane.origin.to_tuple() == approx((50, -20, 30), abs=1e-6)  # the block's corner, where loc put it
    assert setup.plane.z_dir.to_tuple() == approx(loc.plane.z_dir.to_tuple())
    assert sorted(why for why, _, _ in setup.elsewhere) == ["enclosed", "opens at the side", "opens below"]


def test_the_other_face_and_an_edge_are_setups_of_their_own():
    b = block()
    below = machining_setup(b, (0, 0, -1))
    assert by_name(below)["POCKET_D5"] == approx(100)  # the pocket from below, 10 x 10
    assert sorted(why for why, _, _ in below.elsewhere) == [
        "enclosed",
        "opens at the side",
        "opens below",
        "opens below",
    ]
    end = machining_setup(b, (-1, 0, 0))  # the tool comes from the x = 0 end
    assert end.thickness == approx(100)
    assert by_name(end) == {"OUTLINE": approx(60 * 20), "POCKET_D15": approx(8 * 8)}
    mortise = end.layer("POCKET_D15").bbox()
    assert (mortise.min.x, mortise.min.y, mortise.max.x, mortise.max.y) == approx((26, 6, 34, 14))
    names = sorted(why for why, _, _ in end.elsewhere)
    # the hole's wall runs across the tool (a shaped rim); the rabbet is a pocket of the far end, the void a void
    assert names == ["enclosed", "not a prism along the tool", "opens at the side", "opens at the side", "opens below"]


def test_a_curved_rail_keeps_its_arcs_through_the_dxf():
    r, a = 1000.0, 200.0
    band = (Circle(r + 15) - Circle(r - 15)).translate(0, -r, 0)
    band &= Rectangle(2 * a, 3 * r, align=(Align.CENTER, Align.MIN)).translate(0, -r, 0)
    rail = band.extrude(35) - Box(10, 10, 8, align=(Align.MIN, Align.CENTER, Align.MAX)).translate(
        -a, band.bbox().min.y + 15, 35
    )
    setup = machining_setup(rail)

    def under(radius: float) -> float:  # the integral of sqrt(radius^2 - x^2) from -a to a
        return a * math.sqrt(radius**2 - a**2) + radius**2 * math.asin(a / radius)

    assert by_name(setup) == {"OUTLINE": approx(under(r + 15) - under(r - 15)), "POCKET_D8": approx(100)}
    assert setup.layer("OUTLINE").bbox().size.x == approx(2 * a)  # the chord along x
    assert setup.elsewhere == []


def test_the_dxf_of_a_setup_reads_back_layer_by_layer(tmp_path):
    setup = machining_setup(block(), label="A1")
    path = tmp_path / "block.dxf"
    export_dxf(setup.layers, path, curves="arcs")
    text = path.read_text()
    for name in ("OUTLINE", "THROUGH", "POCKET_D5", "POCKET_D8", "LABEL"):
        assert name in text
    assert import_dxf(path, layers=["OUTLINE"]).area == approx(6000)
    assert import_dxf(path, layers=["POCKET_D8"]).area == approx(600)
    assert import_dxf(path, layers=["THROUGH"]).area == approx(math.pi * 25, rel=1e-6)


def test_walls_that_do_not_run_along_the_tool_are_left_to_another_method():
    oblique = Box(100, 60, 20, align=MIN) - (Rot(y=20) * Box(10, 10, 30)).translate(50, 30, 15)
    setup = machining_setup(oblique)
    assert [s.name for s in setup.layers] == [
        "OUTLINE",
        "THROUGH",
    ]  # where the slanted hole shows through, seen along z
    assert {why for why, _, _ in setup.elsewhere} == {"not a prism along the tool"}
    cove = Box(100, 60, 20, align=MIN) - Cone(10, 0, 10).translate(50, 30, 20)
    setup = machining_setup(cove)
    assert [s.name for s in setup.layers] == ["OUTLINE"]
    assert [why for why, _, _ in setup.elsewhere] == ["not a prism along the tool"]


def test_x_dir_turns_the_drawing_and_the_pocket_names_their_depth():
    b = Box(100, 60, 20, align=MIN) - Box(10, 10, 7.5, align=(Align.MIN, Align.MIN, Align.MAX)).translate(10, 10, 20)
    turned = machining_setup(b, x_dir=(0, 1, 0))
    assert turned.layer("OUTLINE").bbox().size.to_tuple() == approx((60, 100, 0))
    assert [s.name for s in turned.layers] == ["OUTLINE", "POCKET_D7_5"]
    assert turned.layer("POCKET_D7_5").area == approx(100)
    assert turned.plane.x_dir.to_tuple() == approx((0, 1, 0))


def test_what_machining_setup_refuses():
    b = Box(100, 60, 20, align=MIN)
    with pytest.raises(TypeError, match="Part"):
        machining_setup(Rectangle(10, 10))
    with pytest.raises(ValueError, match="one solid"):
        machining_setup(b + b.translate(200, 0, 0))
    with pytest.raises(ValueError, match="planar"):
        machining_setup(Cylinder(10, 20), Cylinder(10, 20).faces().filter(lambda f: not f.is_planar).one())
    with pytest.raises(ValueError, match="x_dir"):
        machining_setup(b, x_dir=(0, 0, 1))
    with pytest.raises(ValueError, match="label_size"):
        machining_setup(b, label="A", label_size=0)


def test_a_shaped_edge_is_reported_apart_from_the_pockets():
    b = Box(100, 60, 20, align=MIN) - Box(30, 20, 8, align=(Align.MIN, Align.MIN, Align.MAX)).translate(20, 20, 20)
    top_front = b.edges().filter(
        lambda e: e.geom_type == "line" and abs(e.center().y) < 1e-9 and abs(e.center().z - 20) < 1e-9
    )
    b = chamfer(top_front, 5)
    setup = machining_setup(b)
    assert by_name(setup) == {"OUTLINE": approx(6000), "POCKET_D8": approx(600)}  # the pocket is still a pocket
    assert [(why, len(faces)) for why, _, faces in setup.elsewhere] == [
        ("not a prism along the tool", 1)
    ]  # the chamfer


def test_the_svg_of_a_curved_part_is_the_size_of_the_part():
    r, a = 1000.0, 200.0
    band = (Circle(r + 15) - Circle(r - 15)).translate(0, -r, 0)
    band &= Rectangle(2 * a, 3 * r, align=(Align.CENTER, Align.MIN)).translate(0, -r, 0)
    svg = to_svg(machining_setup(band.extrude(35)).layers)
    width = float(re.search(r'width="([\d.]+)mm"', svg).group(1))
    assert width == approx(2 * a * 1.1, rel=0.01)  # the chord with its 5 % margins, not the arcs' circle of 2000
