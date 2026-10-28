"""Sheet metal: exact bends with radius and K-factor, flanges, unfolding and flat patterns."""

import math

import pytest

from smlibpy import *
from smlibpy import sheetmetal

T, R, K = 2.0, 2.0, 0.44
ALONG_Y = (0, 1, 0)


def plate(length=100.0, width=40.0, t=T):
    """A sheet on XY, from z = 0 to t."""
    return Box(length, width, t, align=(Align.CENTER, Align.CENTER, Align.MIN))


def allowance(angle, r=R, t=T, k=K):
    return math.radians(angle) * (r + k * t)


def bent_volume(flat_volume, strip_area, r=R, t=T, k=K):
    """A bend stretches the material outside the neutral fiber: the strip of area A (in the flat)
    gains A * t^2 * (0.5 - k) / (r + k * t)."""
    return flat_volume + strip_area * t * t * (0.5 - k) / (r + k * t)


def volume(part):
    """Volume integrated finely enough to compare with the formulas (the default accuracy, 1e-7,
    gives about 1e-9 relative error on the bend cylinders)."""
    return part.mass_properties(accuracy=1e-10).volume


def area(face):
    from smlibpy._kernel import ext

    return ext.face_properties(face._f, 1e-10)["area"]


def cylinders(part, radius):
    return [f for f in part.faces() if f.geom_type == "cylinder" and abs(f.radius - radius) < 1e-9]


# -- formulas ---------------------------------------------------------------------
def test_bend_allowance_deduction_and_developed_length():
    assert bend_allowance(90, radius=R, thickness=T) == pytest.approx(math.pi / 2 * (2 + 0.44 * 2), rel=1e-15)
    assert bend_allowance(90, radius=R, thickness=T, k_factor=0.5) == pytest.approx(math.pi / 2 * 3, rel=1e-15)
    bd = bend_deduction(90, radius=R, thickness=T)
    assert bd == pytest.approx(2 * (R + T) - allowance(90), rel=1e-15)
    assert bend_deduction(60, radius=R, thickness=T) == pytest.approx(
        2 * (R + T) * math.tan(math.radians(30)) - allowance(60), rel=1e-15)
    assert developed_length(30, 25, radius=R, thickness=T) == pytest.approx(55 - bd, rel=1e-15)
    u = developed_length(20, 50, 20, angle=[90, 90], radius=R, thickness=T)
    assert u == pytest.approx(90 - 2 * bd, rel=1e-15)
    with pytest.raises(ValueError, match="angle"):
        bend_allowance(0, radius=R, thickness=T)
    with pytest.raises(ValueError, match="below 180"):
        bend_deduction(180, radius=R, thickness=T)
    with pytest.raises(ValueError, match="K-factor"):
        bend_allowance(90, radius=R, thickness=T, k_factor=1.5)
    with pytest.raises(ValueError, match="angles"):
        developed_length(20, 50, 20, angle=[90], radius=R, thickness=T)


# -- bending ----------------------------------------------------------------------
@pytest.mark.parametrize("angle", [30, 45, 90, 120, 180])
def test_bend_is_exact(angle):
    """The bend zone becomes cylinders of R and R + t on the bend axis; the volume grows by the
    stretched material only; unfolding gives the blank back."""
    blank = plate()
    part = fold(blank, Axis((20, 0, T), ALONG_Y), angle, radius=R)
    assert part.is_valid()
    ba = allowance(angle)
    assert volume(part) == pytest.approx(bent_volume(8000, ba * 40), rel=1e-10)
    inner, outer = cylinders(part, R), cylinders(part, R + T)
    assert len(inner) == 1 and len(outer) == 1
    # the -X side (it reaches farther) stays: the axis is over the end of the bend zone, at z = t + R
    axis = inner[0].axis
    assert axis.direction.is_parallel((0, 1, 0), 1e-12)
    assert axis.distance_to((20 - ba / 2, 0, T + R)) == pytest.approx(0, abs=1e-9)
    assert outer[0].axis.distance_to((20 - ba / 2, 0, T + R)) == pytest.approx(0, abs=1e-9)
    assert area(inner[0]) == pytest.approx(math.radians(angle) * R * 40, rel=1e-10)
    assert area(outer[0]) == pytest.approx(math.radians(angle) * (R + T) * 40, rel=1e-10)
    flat = unfold(part)
    assert flat.volume == pytest.approx(8000, rel=1e-12)
    bb = flat.bbox()
    assert bb.min.to_tuple() == pytest.approx((-50, -20, 0), abs=1e-9)
    assert bb.max.to_tuple() == pytest.approx((50, 20, T), abs=1e-9)
    assert all(f.geom_type == "plane" for f in flat.faces())


def test_bend_position_and_developed_length():
    part = fold(plate(), Axis((20, 0, T), ALONG_Y), 90, radius=R)
    ba = allowance(90)
    bb = part.bbox()
    # the flange stands on the outer face of the bend: its outside at 20 - BA/2 + R + t
    assert bb.max.x == pytest.approx(20 - ba / 2 + R + T, abs=1e-9)
    # its top: axis height t + R plus the flat rest of the moving side, 30 - BA/2
    assert bb.max.z == pytest.approx(T + R + 30 - ba / 2, abs=1e-9)
    # outside lengths of the two legs give back the blank length
    legs = (bb.max.x - bb.min.x, bb.max.z - bb.min.z)
    assert developed_length(*legs, radius=R, thickness=T) == pytest.approx(100, abs=1e-9)


def test_bend_directions_and_fixed_side():
    blank = plate()
    up = fold(blank, Axis((20, 0, T), ALONG_Y), 90, radius=R)
    down = fold(blank, Axis((20, 0, T), ALONG_Y), -90, radius=R)
    assert up.bbox().min.z == pytest.approx(0, abs=1e-9) and up.bbox().max.z > 30
    assert down.bbox().max.z == pytest.approx(T, abs=1e-9) and down.bbox().min.z < -27
    # a line on the bottom face folds the other way for the same angle
    under = fold(blank, Axis((20, 0, 0), ALONG_Y), 90, radius=R)
    assert under.bbox().min.z < -27
    # the side with the point stays
    other = fold(blank, Axis((20, 0, T), ALONG_Y), 90, radius=R, fixed=(40, 0, 0))
    assert other.bbox().max.x == pytest.approx(50, abs=1e-9) and other.bbox().min.x > 15
    assert volume(other) == pytest.approx(volume(up), rel=1e-10)


@pytest.mark.parametrize("k_bend, k_unfold", [(0.3, 0.3), (0.5, 0.5), (0.0, 0.0), (1.0, 1.0), (0.3, 0.5)])
def test_k_factor(k_bend, k_unfold):
    part = fold(plate(), Axis((0, 0, T), ALONG_Y), 90, radius=R, k_factor=k_bend)
    assert volume(part) == pytest.approx(bent_volume(8000, allowance(90, k=k_bend) * 40, k=k_bend), rel=1e-10)
    pattern = flat_pattern(part, k_factor=k_unfold)
    # the strip the bend took grows or shrinks with the K-factor it is unfolded with
    assert pattern.size.x == pytest.approx(100 + (k_unfold - k_bend) * T * math.pi / 2, abs=1e-9)
    assert pattern.size.y == pytest.approx(40, abs=1e-9)


def test_radius_range():
    blank = plate()
    big = fold(blank, Axis((0, 0, T), ALONG_Y), 90, radius=20)
    assert len(cylinders(big, 20)) == 1 and len(cylinders(big, 22)) == 1
    assert unfold(big).volume == pytest.approx(8000, rel=1e-12)
    for r in (0.3, 0.11):  # far below the thickness
        tight = fold(blank, Axis((0, 0, T), ALONG_Y), 90, radius=r)
        assert len(cylinders(tight, r)) == 1
        # The side faces of the unfolded bend zone are trimmed by curves that miss their straight
        # edges (0.5 % of the face at r = 0.3), so the faces do not close up and the volume says so.
        with pytest.warns(RuntimeWarning, match="do not meet exactly"):
            assert unfold(tight).volume == pytest.approx(8000, rel=1e-12)
    with pytest.raises(ModelingError, match="too small"):
        fold(blank, Axis((0, 0, T), ALONG_Y), 90, radius=0.1)


def test_oblique_bend_line_is_exact():
    """A bend line at 45 degrees: the bend faces are still exact cylinders (only the side faces
    cut obliquely through the bend zone become NURBS)."""
    blank = plate()
    part = fold(blank, Axis((0, 0, T), (1, 1, 0)), 90, radius=R)
    assert len(cylinders(part, R)) == 1 and len(cylinders(part, R + T)) == 1
    strip = allowance(90) * 40 * math.sqrt(2)
    assert part.volume == pytest.approx(bent_volume(8000, strip), rel=1e-6)
    assert unfold(part).volume == pytest.approx(8000, rel=1e-6)


def test_partial_bend_needs_relief_cuts():
    blank = plate()
    with pytest.raises(ModelingError, match="not cut free"):
        fold(blank, Line((25, -10, T), (25, 10, T)), 90, radius=R, partial=True)
    slotted = blank - Box(31, 1, 10).translate(35, 10.5, 0) - Box(31, 1, 10).translate(35, -10.5, 0)
    tab = fold(slotted, Line((25, -10, T), (25, 10, T)), 90, radius=R, partial=True)
    assert volume(tab) == pytest.approx(bent_volume(volume(slotted), allowance(90) * 20), rel=1e-10)
    (only,) = tab.bends()
    assert only.length == pytest.approx(20, abs=1e-9) and only.angle == pytest.approx(90, abs=1e-9)
    assert tab.bbox().max.z == pytest.approx(T + R + 25 - allowance(90) / 2, abs=1e-9)
    assert unfold(tab).volume == pytest.approx(slotted.volume, rel=1e-9)


def test_bending_a_flange_again():
    part = fold(plate(), Axis((20, 0, T), ALONG_Y), 90, radius=R)
    # the inside face of the flange is at x = 20 - BA/2 + R; bend it 15 above the plate
    x = 20 - allowance(90) / 2 + R
    hook = fold(part, Axis((x, 0, 15), ALONG_Y), 90, radius=R, fixed=(0, 0, 0))
    assert [b.radius for b in hook.bends()] == pytest.approx([R, R], abs=1e-9)
    pattern = flat_pattern(hook)
    assert pattern.part.volume == pytest.approx(8000, rel=1e-12)
    xs = sorted(b.line.start.x for b in pattern.bends)
    # in the flat: the first bend line at 70; the second is where the line was drawn, 15 - (t + R)
    # above the end of the first bend zone (the flange's inside face starts at height t + R)
    assert xs == pytest.approx([70, 70 + allowance(90) / 2 + 15 - (T + R)], abs=1e-9)


def test_hole_in_a_flange_and_across_a_bend():
    holed = plate() - Cylinder(5, 10).translate(35, 0, 0)
    part = fold(holed, Axis((20, 0, T), ALONG_Y), 90, radius=R)
    flat = unfold(part)
    assert flat.bbox().max.to_tuple() == pytest.approx((50, 20, T), abs=1e-9)
    assert len([f for f in flat.faces() if f.geom_type == "cylinder"]) == 1
    assert flat.volume == pytest.approx(holed.volume, rel=1e-7)
    contour = flat_pattern(part).outline        # exact lines and the circle, collinear pieces joined
    assert sorted(e.geom_type for e in contour.edges()) == ["circle", "line", "line", "line", "line"]
    (hole,) = contour.edges().circles()
    assert hole.radius == pytest.approx(5, abs=1e-9) and hole.arc_center.to_tuple() == pytest.approx((85, 20, 0))
    # a hole across the bend zone: its walls in the zone become NURBS (within 1e-4)
    across = plate() - Cylinder(5, 10).translate(20, 0, 0)
    part = fold(across, Axis((20, 0, T), ALONG_Y), 90, radius=R)
    assert part.is_valid() and any(f.geom_type == "bspline" for f in part.faces())
    flat = unfold(part)
    assert flat.mesh(0.001).volume == pytest.approx(8000 - math.pi * 25 * T, rel=1e-5)


def test_bend_errors():
    blank = plate()
    with pytest.raises(ModelingError, match="does not lie on a face"):
        fold(blank, Axis((20, 0, 5), ALONG_Y), 90, radius=R)
    with pytest.raises(ModelingError, match="does not cross the sheet"):
        fold(blank, Axis((60, 0, T), ALONG_Y), 90, radius=R)
    with pytest.raises(ModelingError, match="does not cut the sheet in two"):
        fold(blank, Axis((49, 0, T), ALONG_Y), 90, radius=R)
    with pytest.raises(ValueError, match="angle"):
        fold(blank, Axis((20, 0, T), ALONG_Y), 0, radius=R)
    with pytest.raises(ValueError, match="angle"):
        fold(blank, Axis((20, 0, T), ALONG_Y), 200, radius=R)
    with pytest.raises(ValueError, match="K-factor"):
        fold(blank, Axis((20, 0, T), ALONG_Y), 90, radius=R, k_factor=-0.1)
    with pytest.raises(ValueError, match="straight"):
        fold(blank, CenterArc((0, 0, T), 10, 0, 90), 90, radius=R)
    with pytest.raises(ValueError, match="partial"):
        fold(blank, Axis((20, 0, T), ALONG_Y), 90, radius=R, partial=True)
    with pytest.raises(TypeError, match="Part"):
        fold(Rectangle(10, 10), Axis((0, 0, 0), ALONG_Y), 90, radius=R)


# -- flanges ----------------------------------------------------------------------
def top_edge(part, x=None, y=None):
    """The edge of the base plate's top face (z = t) at x (along Y) or at y (along X)."""
    edges = part.edges().filter(lambda e: abs(e.start.z - T) < 1e-9 and abs(e.end.z - T) < 1e-9)
    if x is not None:
        return edges.filter_by(Y).filter(lambda e: abs(e.start.x - x) < 1e-9)
    return edges.filter_by(X).filter(lambda e: abs(e.start.y - y) < 1e-9)


def test_flange_dimensions():
    base = plate(100, 60)
    part = flange(base, top_edge(base, x=50), 20, radius=R)
    bb = part.bbox()
    # the bend starts at the edge: the outside of the flange is R + t beyond it, its top 20 high
    assert bb.max.x == pytest.approx(50 + R + T, abs=1e-9) and bb.max.z == pytest.approx(20, abs=1e-9)
    leg = 20 - (R + T)
    assert volume(part) == pytest.approx(bent_volume(12000 + (allowance(90) + leg) * 60 * T, allowance(90) * 60),
                                         rel=1e-10)
    (b,) = part.bends()
    assert b.angle == pytest.approx(90, abs=1e-9) and b.radius == pytest.approx(R, abs=1e-12)
    # 45 degrees: the length runs from the virtual sharp on the outer face along the flange
    tilted = flange(base, top_edge(base, x=50), 20, angle=45, radius=R)
    sharp = 50 + (R + T) * math.tan(math.radians(22.5))
    assert tilted.bbox().max.x == pytest.approx(sharp + 20 * math.cos(math.radians(45)), abs=1e-9)
    down = flange(base, top_edge(base, x=50), 20, angle=-90, radius=R)
    assert down.bbox().min.z == pytest.approx(T - 20, abs=1e-9)


def test_box_from_four_flanges():
    base = plate(100, 60)
    box = flange(base, top_edge(base, x=50), 20, radius=R)
    box = flange(box, top_edge(box, x=-50), 20, radius=R)
    box = flange(box, top_edge(box, y=30), 20, radius=R)
    box = flange(box, top_edge(box, y=-30), 20, radius=R)
    assert box.is_valid() and len(box.bends()) == 4
    bb = box.bbox()
    assert bb.size.to_tuple() == pytest.approx((100 + 2 * (R + T), 60 + 2 * (R + T), 20), abs=1e-9)
    pattern = flat_pattern(box)
    reach = allowance(90) + 20 - (R + T)
    assert (pattern.size.x, pattern.size.y) == pytest.approx((100 + 2 * reach, 60 + 2 * reach), abs=1e-9)
    assert [b.direction for b in pattern.bends] == ["up"] * 4
    assert pattern.part.volume == pytest.approx(T * (100 * 60 + 2 * reach * (100 + 60)), rel=1e-9)


def test_flange_errors():
    base = plate(100, 60)
    with pytest.raises(ModelingError, match="setback"):
        flange(base, top_edge(base, x=50), 3, radius=R)
    with pytest.raises(ValueError, match="one edge"):
        flange(base, base.edges().filter_by(Y), 20, radius=R)
    with pytest.raises(ValueError, match="angle"):
        flange(base, top_edge(base, x=50), 20, angle=180, radius=R)
    round_plate = Cylinder(30, T, align=(Align.CENTER, Align.CENTER, Align.MIN))
    with pytest.raises(ValueError, match="straight"):
        flange(round_plate, round_plate.edges().top(), 20, radius=R)


# -- unfolding and flat patterns -------------------------------------------------------
def test_u_and_z_channels_unfold():
    blank = plate()
    u = fold(fold(blank, Axis((-30, 0, T), ALONG_Y), 90, radius=R), Axis((30, 0, T), ALONG_Y), 90, radius=R)
    z = fold(fold(blank, Axis((-30, 0, T), ALONG_Y), 90, radius=R), Axis((30, 0, T), ALONG_Y), -90, radius=R)
    for part, directions in ((u, ["up", "up"]), (z, ["down", "up"])):
        pattern = flat_pattern(part)
        assert pattern.part.volume == pytest.approx(8000, rel=1e-12)
        assert pattern.size.to_tuple() == pytest.approx((100, 40, T), abs=1e-9)
        assert sorted(b.direction for b in pattern.bends) == sorted(directions)
        assert sorted(b.line.start.x for b in pattern.bends) == pytest.approx([20, 80], abs=1e-9)
        assert all(b.line.length == pytest.approx(40, abs=1e-9) for b in pattern.bends)
        assert pattern.outline.area == pytest.approx(4000, rel=1e-12)


def test_box_from_a_relieved_cross_blank():
    relief = 3
    cross = Rectangle(100, 80)
    for sx in (1, -1):
        for sy in (1, -1):
            cross -= Rectangle(20 + relief, 20 + relief).translate(sx * (50 - (20 + relief) / 2),
                                                                     sy * (40 - (20 + relief) / 2))
    blank = cross.extrude(T)
    box = blank
    for line in (Line((-27, 20, T), (27, 20, T)), Line((-27, -20, T), (27, -20, T)),
                 Line((30, -17, T), (30, 17, T)), Line((-30, -17, T), (-30, 17, T))):
        box = fold(box, line, 90, radius=R, fixed=(0, 0, 0), partial=True)
    assert box.is_valid() and len(box.bends()) == 4
    pattern = flat_pattern(box)
    assert pattern.part.volume == pytest.approx(blank.volume, rel=1e-12)
    assert pattern.size.to_tuple() == pytest.approx((100, 80, T), abs=1e-9)
    assert pattern.outline.area == pytest.approx(blank.volume / T, rel=1e-9)
    assert [e.geom_type for e in pattern.outline.edges()] == ["line"] * 12   # the cross with notched corners
    lines = sorted((round(b.line.center().x, 9), round(b.line.center().y, 9)) for b in pattern.bends)
    # (point by point: pytest 9.2 refuses approx of a list of tuples)
    assert lines == [pytest.approx(p, abs=1e-9) for p in [(20, 40), (50, 20), (50, 60), (80, 40)]]


def test_unfold_an_extruded_l_profile():
    """A sheet metal part that was not made by fold(): an L profile with an inside radius."""
    t, r = T, R
    profile = make_face([Line((0, r + t), (0, 25)), Line((0, 25), (t, 25)), Line((t, 25), (t, r + t)),
                         CenterArc((r + t, r + t), r, 180, 90), Line((r + t, t), (30, t)), Line((30, t), (30, 0)),
                         Line((30, 0), (r + t, 0)), CenterArc((r + t, r + t), r + t, 270, -90)])
    part = (Plane.XZ * profile).extrude(40)
    (b,) = part.bends()
    assert (b.angle, b.radius, b.thickness, b.length) == pytest.approx((90, r, t, 40), abs=1e-9)
    for k in (0.3, 0.44, 0.5):
        pattern = flat_pattern(part, k_factor=k)
        assert pattern.size.x == pytest.approx(developed_length(30, 25, radius=r, thickness=t, k_factor=k), abs=1e-9)
        assert pattern.size.y == pytest.approx(40, abs=1e-9)


def test_flat_pattern_of_a_flat_part_and_not_sheet_metal():
    pattern = flat_pattern(Box(10, 20, 2))
    assert pattern.size.to_tuple() == pytest.approx((20, 10, 2), abs=1e-12) and pattern.bends == []
    sharp_l = plate() + Box(T, 40, 30, align=(Align.MAX, Align.CENTER, Align.MIN)).translate(50, 0, 0)
    with pytest.raises(ModelingError, match="deep across the fixed face"):
        unfold(sharp_l)  # a corner without a bend radius does not unfold


def test_unfold_keeps_the_fixed_face():
    part = fold(plate(), Axis((20, 0, T), ALONG_Y), 90, radius=R)
    flange_face = part.faces().filter(lambda f: f.geom_type == "plane" and f.normal_at().x > 0.99).largest()
    flat = unfold(part, fixed=flange_face)
    # the flange stays standing: the flat now lies in its plane
    assert flat.bbox().size.x == pytest.approx(T, abs=1e-9)
    assert flat.bbox().size.z == pytest.approx(100, abs=1e-9)
    with pytest.raises(ValueError, match="planar face"):
        unfold(part, fixed=cylinders(part, R)[0])


def test_part_methods():
    blank = plate()
    part = blank.fold(Axis((20, 0, T), ALONG_Y), 90, radius=R)
    assert part.bends()[0].allowance == pytest.approx(allowance(90), rel=1e-15)
    assert part.unfold().volume == pytest.approx(8000, rel=1e-12)
    assert part.flat_pattern().size.to_tuple() == pytest.approx((100, 40, T), abs=1e-9)
    base = plate(100, 60)
    assert base.flange(top_edge(base, x=50), 20, radius=R).bbox().max.z == pytest.approx(20, abs=1e-9)
    assert sheetmetal.K_FACTOR == K


# -- MCP --------------------------------------------------------------------------
def test_bend_and_unfold_through_the_mcp_session():
    from smlibpy.mcp import discovery
    from smlibpy.mcp.session import Session

    s = Session()
    try:
        ok = s.run("blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))\n"
                   "bracket = fold(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)\n"
                   "pattern = flat_pattern(bracket)\n"
                   "print(len(bracket.bends()), round(pattern.part.volume, 9), [b.direction for b in pattern.bends])")
        assert ok["ok"], ok
        assert ok["output"].strip() == "1 8000.0 ['up']"
        flat = s.run("unfold(bracket).bbox().size.x")
        assert flat["ok"] and float(flat["value"]) == pytest.approx(100, abs=1e-9)
        bad = s.run("fold(blank, Axis((49, 0, 2), (0, 1, 0)), 90, radius=2)")
        assert not bad["ok"] and "ModelingError" in bad["error"]
    finally:
        s.close()
    def names(query, n):  # API names and guide names (sheetmetal/flange -> flange)
        return [e.key.split("/")[-1] for _, e in discovery.search(query, n)]

    assert "flat_pattern" in names("sheet metal flat pattern for the laser", 5)
    assert "generic" in names("sheet metal", 6)
    assert "bend_allowance" in names("k-factor bend allowance", 3)
    assert "flange" in names("fold up an edge", 5)
    assert discovery.guide("sheetmetal/generic") is not None and discovery.guide("recipes/sheet-metal") is not None



# -- review of 0.5.0: mirrored parts and fold records of tools ----------------------------------------
def _two_folds():
    blank = Box(200, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    part = fold(blank, Axis((-60, 0, 2), (0, 1, 0)), 90, radius=1, k_factor=0.33)
    return fold(part, Axis((60, 0, 2), (0, 1, 0)), 90, radius=6, k_factor=0.45)


@pytest.mark.parametrize("plane", [Plane.YZ, Plane.XY, Plane.XZ], ids=["YZ", "XY", "XZ"])
def test_mirrored_sheet_metal_unfolds(plane):
    # The bend ends (the flats beside a bend) were taken from edges whose geom_type is "line"; a
    # mirror gave every edge a B-spline (so do STEP files), the bends had no flat on either side, and
    # flat_pattern raised "unrolling a bend failed (... volume 1560.92 ...)" (0.4 unfolded them).
    part = _two_folds().mirror(plane)
    assert part.edges().lines()  # (lines again after a mirror)
    assert [b.k_factor for b in sheetmetal.bends(part)] == [0.33, 0.45]
    assert part.flat_pattern().size.x == pytest.approx(200, abs=1e-6)
    assert part.flat_pattern(k_factor=0.44).size.x == pytest.approx(200.314159, abs=1e-6)


def test_mirrored_flanges_and_their_step_files_unfold(tmp_path):
    plate = Box(100, 60, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    edge = plate.edges().filter_by(Y).top().sort_by(X)[-1]
    part = flange(plate, edge, 20, radius=2, k_factor=0.3)
    mirrored = part.mirror(Plane.YZ)
    assert mirrored.flat_pattern().size == pytest.approx(part.flat_pattern().size, abs=1e-6)
    export_step(mirrored, tmp_path / "flange.step")
    back = import_step(tmp_path / "flange.step")  # (B-spline edges as the file has them; no K records)
    assert back.flat_pattern().size.x == pytest.approx(120.524, abs=1e-3)
    other = plate.mirror(Plane.YZ)
    side = other.edges().filter_by(Y).top().sort_by(X)[-1]
    assert flange(other, side, 20, radius=2, k_factor=0.3).volume == pytest.approx(part.volume, rel=1e-9)


def test_unions_take_the_fold_records_of_every_operand():
    # The K-factor records went with the first operand only: tab + part unfolded at 0.44.
    part = _two_folds()
    tab = Box(10, 10, 2).translate(0, 0, 1)
    for joined in (part + tab, tab + part, tab.fuse(part), Box(300, 100, 100) & (part + tab)):
        assert joined.flat_pattern().size.x == pytest.approx(200, abs=1e-6)
