"""Exploded views: assembly axes found where parts touch, and the picture that draws them."""

import math

import numpy as np
import pytest

from smlibpy import AssemblyAxis, Box, Cylinder, Pos, Sphere, Vector, assembly_axes, render_exploded


def _box_on_box():
    # a 40 x 30 x 10 box standing on a 100 x 60 x 20 one: the contact is the small box's bottom,
    # 1200 mm^2 centered at (10, 5, 10)
    base = Box(100, 60, 20).named("base")
    top = Pos(10, 5, 15) * Box(40, 30, 10).named("top")
    return base, top


def _peg_in_hole():
    # a peg of radius 5 in a blind hole 15 deep: the contact is the bore (150 pi mm^2, its centroid
    # at z = 12.5) and the bottom (25 pi mm^2 at z = 5): 175 pi in all, at z = (150 * 12.5 + 25 * 5) / 175
    block = Box(60, 60, 40).cut(Pos(0, 0, 12.5) * Cylinder(5, 15)).named("block")
    peg = Pos(0, 0, 20) * Cylinder(5, 30).named("peg")
    return block, peg


def test_box_on_box_axis_from_the_centroid_of_the_contact():
    base, top = _box_on_box()
    axes = assembly_axes([base, top], [(0, 0, 0), (0, 0, 50)])
    assert len(axes) == 1 and isinstance(axes[0], AssemblyAxis)
    a = axes[0]
    assert (a.first, a.second) == (0, 1)
    assert a.contact.to_tuple() == pytest.approx((10, 5, 10), abs=1e-6)
    assert a.area == pytest.approx(1200, rel=1e-6)
    assert a.start.to_tuple() == pytest.approx((10, 5, 10), abs=1e-6)
    assert a.end.to_tuple() == pytest.approx((10, 5, 60), abs=1e-6)


def test_peg_in_hole_axis_on_the_bore_axis():
    block, peg = _peg_in_hole()
    (a,) = assembly_axes([block, peg], {"peg": (0, 0, 60)})
    assert a.contact.x == pytest.approx(0, abs=1e-3) and a.contact.y == pytest.approx(0, abs=1e-3)
    assert a.contact.z == pytest.approx(2000 / 175, rel=1e-3)  # 11.428571
    assert a.area == pytest.approx(175 * math.pi, rel=1e-3)  # 549.78; the tessellation gives 549.70
    assert a.end.z - a.start.z == pytest.approx(60)


def test_offsets_by_part_and_parts_that_move_together():
    base, top = _box_on_box()
    lid = Pos(10, 5, 22.5) * Box(40, 30, 5).named("lid")  # on the top box
    # base and top move together: no axis between them; lid moves alone: an axis to the top box
    axes = assembly_axes([base, top, lid], {lid: (0, 0, 30)})
    assert [(a.first, a.second) for a in axes] == [(1, 2)]
    assert axes[0].contact.to_tuple() == pytest.approx((10, 5, 20), abs=1e-6)
    assert axes[0].area == pytest.approx(1200, rel=1e-6)


def test_assembly_axes_refuse():
    base, top = _box_on_box()
    far = Pos(500, 0, 0) * Sphere(5).named("ball")
    with pytest.raises(ValueError, match=r"part 2 \('ball'\) touches no other part within 0.01 mm"):
        assembly_axes([base, top, far], [(0, 0, 0)] * 3)
    with pytest.raises(ValueError, match="no part is named 'lid'; the names are 'base', 'top'"):
        assembly_axes([base, top], {"lid": (0, 0, 1)})
    with pytest.raises(ValueError, match="1 offsets for 2 parts"):
        assembly_axes([base, top], [(0, 0, 1)])
    with pytest.raises(ValueError, match="needs two parts or more"):
        assembly_axes([base], [(0, 0, 1)])
    with pytest.raises(TypeError, match="assembly_axes takes parts, not a Vector"):
        assembly_axes([base, Vector(0, 0, 0)], [(0, 0, 0)] * 2)
    with pytest.raises(ValueError, match="the tolerance must be positive"):
        assembly_axes([base, top], [(0, 0, 0)] * 2, tolerance=0)


def test_render_exploded_draws_the_axis_where_the_view_puts_it():
    # The front view looks along +Y: screen x is world x, screen up is world z. The moved parts span
    # x -50..50 and z -10..70, so without balloons the scale is min(800 * 0.88 / 100, 600 * 0.88 / 80)
    # = 6.6 px/mm and the middle (0, 30). The axis from (10, 5, 10) to (10, 5, 60) is the column
    # x = 400 + 10 * 6.6 = 466, from y = 300 + 20 * 6.6 = 432 up to 300 - 30 * 6.6 = 102.
    base, top = _box_on_box()
    pic = render_exploded([base, top], {"top": (0, 0, 50)}, view="front", size=(800, 600), balloons=False)
    assert pic.frame == pytest.approx({"scale": 6.6, "mid_x": 0.0, "mid_y": 30.0})
    band = pic.pixels[110:425].astype(int)  # between the two boxes: the background and the axis
    drawn = (np.abs(band - 255).sum(axis=2) > 30).any(axis=0)
    assert np.flatnonzero(drawn).tolist() == [465, 466]
    plain = render_exploded([base, top], {"top": (0, 0, 50)}, view="front", size=(800, 600), balloons=False,
                            axes=False)
    assert not (np.abs(plain.pixels[110:425].astype(int) - 255).sum(axis=2) > 30).any()


def test_render_exploded_balloons_and_parts_list(tmp_path):
    base, top = _box_on_box()
    path = tmp_path / "exploded.png"
    pic = render_exploded([base, top], {"top": (0, 0, 50)}, order=["top", "base"], size=(900, 600), path=path)
    assert path.read_bytes() == bytes(pic)
    assert (pic.width, pic.height) == (900, 600)
    ink = np.abs(pic.pixels.astype(int) - (31, 78, 121)).sum(axis=2) < 30
    # the parts list stands right of the parts: two rows of a balloon, a name and a count
    assert ink[:, 780:].any()
    # without balloons nothing is drawn in the balloons' color
    plain = render_exploded([base, top], {"top": (0, 0, 50)}, size=(900, 600), balloons=False)
    assert not (np.abs(plain.pixels.astype(int) - (31, 78, 121)).sum(axis=2) < 30).any()


def test_render_exploded_refuses():
    base, top = _box_on_box()
    offsets = {"top": (0, 0, 50)}
    with pytest.raises(ValueError, match="order names 'lid', which no part has"):
        render_exploded([base, top], offsets, order=["base", "top", "lid"])
    with pytest.raises(ValueError, match="order leaves out 'top'"):
        render_exploded([base, top], offsets, order=["base"])
    with pytest.raises(ValueError, match="order names 'base' more than once"):
        render_exploded([base, top], offsets, order=["base", "top", "base"])
    with pytest.raises(ValueError, match="supersample must be 1 to 4"):
        render_exploded([base, top], offsets, supersample=5)
    with pytest.raises(ValueError, match="balloons do not fit"):
        boxes = [Pos(10 * i, 0, 0) * Box(10, 10, 10).named(f"b{i}") for i in range(12)]
        render_exploded(boxes, [(0, 0, 5 * i) for i in range(12)], size=(400, 120))
