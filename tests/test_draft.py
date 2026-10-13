"""Draft analysis, parting lines and face drafts: Part.draft_analysis, Part.parting_line,
Part.draft."""

import math

import pytest

from smlibpy import (Align, Box, Cylinder, ModelingError, Plane, RoundedRectangle, ShapeList, Sphere, Torus, Wire, X,
                     Y, Z, export_step, import_step)
from smlibpy.draft import ANGLE_TOLERANCE, DraftAnalysis


def test_box_faces_by_draft():
    box = Box(40, 30, 20)
    da = box.draft_analysis(Z)
    assert isinstance(da, DraftAnalysis) and len(da) == 6 and not da.ok
    assert len(da.positive) == 1 and da.positive.one().center().z == pytest.approx(10)
    assert len(da.undercut) == 1 and da.undercut.one().center().z == pytest.approx(-10)
    assert len(da.vertical) == 4 and len(da.insufficient) == 0
    assert da.angles(box.faces().top().one()) == (pytest.approx(90.0, abs=1e-12), pytest.approx(90.0, abs=1e-12))
    for f in da.vertical:
        lo, hi = da.angles(f)
        assert abs(lo) <= ANGLE_TOLERANCE and abs(hi) <= ANGLE_TOLERANCE
    # the groups are faces of the part, usable as selections
    assert isinstance(da.vertical, ShapeList) and all(f.owner is box for f in da.vertical)
    # a sideways pull
    side = box.draft_analysis(X)
    assert len(side.positive) == 1 and side.positive.one().center().x == pytest.approx(20)


def test_tapered_walls_have_exactly_their_draft():
    core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
    da = core.draft_analysis(Z, min_angle=1)
    walls = [fd for fd in da if fd.face.geom_type != "plane" or abs(fd.face.normal_at().z) < 0.5]
    assert len(walls) == 8
    for fd in walls:
        assert fd.min_angle == pytest.approx(3.0, abs=1e-9) and fd.max_angle == pytest.approx(3.0, abs=1e-9)
        assert fd.kind == "positive"
    strict = core.draft_analysis(Z, min_angle=5)
    assert len(strict.insufficient) == 8
    assert len(core.draft_analysis(-Z).undercut) == 9  # the walls and the top turn away from -Z


def test_curved_faces_report_their_range():
    sphere = Sphere(10)
    fd = sphere.draft_analysis(Z).faces[0]
    assert fd.kind == "undercut"
    assert fd.min_angle == pytest.approx(-90, abs=1e-6) and fd.max_angle == pytest.approx(90, abs=1e-6)
    cone_like = Cylinder(10, 20).draft_analysis(Y)
    side = [fd for fd in cone_like if fd.face.geom_type == "cylinder"][0]
    assert side.min_angle == pytest.approx(-90, abs=1e-6) and side.max_angle == pytest.approx(90, abs=1e-6)


def test_draft_analysis_errors():
    box = Box(10, 10, 10)
    with pytest.raises(ValueError):
        box.draft_analysis((0, 0, 0))
    with pytest.raises(ValueError):
        box.draft_analysis(Z, min_angle=90)
    with pytest.raises(ValueError):
        box.draft_analysis(Z, min_angle=-1)
    with pytest.raises(ValueError):
        box.draft_analysis(Z).angles(Box(1, 1, 1).faces()[0])


# -- parting lines ---------------------------------------------------------------------------
def points(wire: Wire, n: int = 64):
    return [wire.point_at(i / n) for i in range(n + 1)]


def test_parting_line_of_a_sphere_is_its_equator():
    lines = Sphere(10).parting_line(Z)
    assert len(lines) == 1
    w = lines[0]
    assert w.is_closed and w.length == pytest.approx(2 * math.pi * 10, rel=1e-9)
    assert all(e.geom_type == "circle" and e.radius == pytest.approx(10, abs=1e-12) for e in w.edges())
    assert all(abs(p.z) <= 1e-12 and abs(p.length - 10) <= 1e-12 for p in points(w))
    tilted = Sphere(10).parting_line((1, 1, 1))[0]
    n = (1 / math.sqrt(3),) * 3
    assert all(abs(p.x * n[0] + p.y * n[1] + p.z * n[2]) <= 1e-9 for p in points(tilted))


def test_parting_line_of_cylinders():
    upright = Cylinder(5, 20).parting_line(Z)
    assert len(upright) == 1  # walls without draft: the line runs along their far end
    w = upright[0]
    assert w.length == pytest.approx(2 * math.pi * 5, rel=1e-9) and w.bbox().max.z == pytest.approx(-10)
    assert w.edges().one().geom_type == "circle" and w.edges().one().radius == pytest.approx(5, abs=1e-12)
    lying = Cylinder(5, 20).rotate(Y, 90).parting_line(Z)[0]
    assert lying.is_closed and lying.length == pytest.approx(40 + 10 * math.pi, rel=1e-9)
    contour = [e for e in lying.edges() if e._is_straight()]
    assert len(contour) == 2
    assert sorted(round(e.center().y, 9) for e in contour) == [-5.0, 5.0]
    assert all(abs(e.center().z) <= 1e-9 and e.length == pytest.approx(20, rel=1e-9) for e in contour)


def test_parting_line_of_tori():
    upright = Torus(20, 5).parting_line(Z)
    circles = sorted((w.edges().one() for w in upright), key=lambda e: e.radius)
    assert [e.geom_type for e in circles] == ["circle", "circle"]
    assert [e.radius for e in circles] == [pytest.approx(15, abs=1e-12), pytest.approx(25, abs=1e-12)]
    assert all(abs(e.arc_center.z) <= 1e-12 for e in circles)
    tilted = Torus(20, 5).rotate(X, 30)
    line = tilted.parting_line(Z)  # traced: the outer and the inner contour
    # A traced line closes within the trace's fit tolerance (1e-6 of the part's size), which can
    # be more than Wire.is_closed allows (on Linux on ARM a gap of a few 1e-5 mm).
    trace_tol = 1e-6 * tilted.bbox().diagonal
    assert len(line) == 2 and all(w.start.distance_to(w.end) <= 10 * trace_tol for w in line)
    face = tilted.faces()[0]
    for w in line:
        for p in points(w, 200):
            assert face.distance_to(p) <= 1e-4 and abs(face.normal_at(p).z) <= 1e-4


def test_parting_line_of_an_open_box_and_a_drafted_core():
    cup = Box(40, 30, 20) - Box(30, 20, 15, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
    lines = cup.parting_line(Z)
    assert len(lines) == 1 and lines[0].length == pytest.approx(140) and lines[0].bbox().max.z == pytest.approx(-10)
    core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
    rim = core.parting_line(Z)
    assert len(rim) == 1 and rim[0].bbox().max.z == pytest.approx(0, abs=1e-9)
    assert rim[0].length == pytest.approx(2 * (50 + 30) + 2 * math.pi * 5, rel=1e-9)


def test_parting_line_errors():
    with pytest.raises(ValueError):
        Box(10, 10, 10).parting_line((0, 0, 0))


# -- through the MCP session -----------------------------------------------------------------
def test_session_draft_and_parting_line():
    from smlibpy.mcp.session import Session

    s = Session()
    try:
        ok = s.run("core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)\nda = core.draft_analysis(Z, min_angle=1)\n"
                   "print(len(da.positive), len(da.vertical), len(da.undercut))\n"
                   "print(round(Sphere(10).parting_line(Z)[0].length, 6))")
        assert ok["ok"] and ok["output"].split() == ["9", "0", "1", "62.831853"]
        bad = s.run("core.parting_line((0, 0, 0))")
        assert not bad["ok"] and "ValueError" in bad["error"]
    finally:
        s.close()


def test_search_finds_mold_checks():
    from smlibpy.mcp import discovery

    for query, wanted in (("draft angle", "Part.draft_analysis"), ("undercut", "Part.draft_analysis"),
                          ("mold", "Part.parting_line"), ("casting", "Part.draft_analysis"),
                          ("parting line", "Part.parting_line"), ("pull direction", "Part.draft_analysis")):
        keys = [e.key for _, e in discovery.search(query, 6)]
        assert wanted in keys, (query, keys)
    assert discovery.guide("recipes/mold-check") is not None
    assert discovery.guide_for(discovery.find_method("Part.parting_line")).key == "analysis/parting_line"


# -- face drafts -----------------------------------------------------------------------------
# Kernel results differ in the last bits between platforms (and runs): measures are compared
# with a relative tolerance, never exactly.
def walls(part):
    """The faces of a part that run along Z: walls, holes and the rounds between walls."""
    return part.faces().filter(lambda f: abs(f.normal_at(f.interior_point()).z) < 1e-9)


def prismatoid(h, bottom, middle, top):
    """Volume of a solid whose cross-section area is quadratic in the height."""
    return h / 6 * (bottom + 4 * middle + top)


def drafted_angles(part, direction=Z):
    """The (least, greatest) draft angle of every face that is neither a top nor a bottom."""
    return [(fd.min_angle, fd.max_angle) for fd in part.draft_analysis(direction) if abs(fd.min_angle) < 89]


def test_draft_box_walls_keep_the_top_and_grow_the_bottom():
    box = Box(40, 30, 20)
    t = math.tan(math.radians(3))
    for neutral in (Plane.XY.offset(10), box.faces().top()):  # a plane, or the top face (normal +Z)
        drafted = box.draft(walls(box), 3, neutral)
        assert drafted.is_valid() and len(drafted.faces()) == 6
        assert drafted.faces().top().one().area == pytest.approx(40 * 30, rel=1e-9)
        assert drafted.faces().bottom().one().area == pytest.approx((40 + 40 * t) * (30 + 40 * t), rel=1e-9)
        assert drafted.volume == pytest.approx(
            prismatoid(20, (40 + 40 * t) * (30 + 40 * t), (40 + 20 * t) * (30 + 20 * t), 40 * 30), rel=1e-7)
        bb = drafted.bbox()
        assert (bb.min.z, bb.max.z) == (pytest.approx(-10), pytest.approx(10))
        assert bb.max.x - bb.min.x == pytest.approx(40 + 40 * t, rel=1e-9)
        # every wall now has 3 degrees of draft for a mold that moves up
        angles = drafted_angles(drafted)
        assert len(angles) == 4 and all(lo == pytest.approx(3, abs=1e-6) and hi == pytest.approx(3, abs=1e-6)
                                        for lo, hi in angles)
    # The bottom keeps its size when it is the neutral plane, and the top shrinks.
    drafted = box.draft(walls(box), 3, Plane.XY.offset(-10))
    assert drafted.faces().bottom().one().area == pytest.approx(40 * 30, rel=1e-9)
    assert drafted.faces().top().one().area == pytest.approx((40 - 40 * t) * (30 - 40 * t), rel=1e-9)
    # A face as the neutral plane pulls along its outward normal: down for the bottom face.
    down = box.draft(walls(box), 3, box.faces().bottom())
    assert down.faces().top().one().area == pytest.approx((40 + 40 * t) * (30 + 40 * t), rel=1e-9)
    assert all(lo == pytest.approx(3, abs=1e-6) for lo, _ in drafted_angles(down, -Z))
    # The original part does not change.
    assert box.volume == pytest.approx(24000, rel=1e-12) and len(walls(box)) == 4


def test_draft_about_a_plane_through_the_walls():
    box = Box(40, 30, 20)
    t = math.tan(math.radians(3))
    drafted = box.draft(walls(box), 3, Plane.XY)  # the upper half narrows, the lower half widens
    assert drafted.faces().top().one().area == pytest.approx((40 - 20 * t) * (30 - 20 * t), rel=1e-9)
    assert drafted.faces().bottom().one().area == pytest.approx((40 + 20 * t) * (30 + 20 * t), rel=1e-9)
    assert drafted.volume == pytest.approx(24000 + 8000 * t * t / 3, rel=1e-7)
    # Against a tilted pull direction two of the walls have draft already: 3 degrees more.
    pull = (0, 0.2, 1)
    tilted = box.draft(walls(box), 3, Plane((0, 0, -10), z_dir=pull))
    assert tilted.is_valid() and len(tilted.faces()) == 6
    before = math.degrees(math.asin(0.2 / math.hypot(0.2, 1)))
    analysis = tilted.draft_analysis(pull)
    angles = sorted(analysis.angles(f) for f in tilted.faces() if abs(f.normal_at().z) < 0.5)
    expected = sorted([-before + 3, 3, 3, before + 3])
    assert [lo for lo, _ in angles] == pytest.approx(expected, abs=1e-6)
    assert [hi for _, hi in angles] == pytest.approx(expected, abs=1e-6)


def test_draft_opens_a_pocket():
    block = Box(60, 40, 20) - Box(30, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
    pocket = walls(block).filter(lambda f: abs(f.center().x) < 29 and abs(f.center().y) < 19)
    floor = block.faces().filter(lambda f: abs(f.normal_at().z) > 0.5 and abs(f.center().z) < 1e-9).one()
    assert len(pocket) == 4
    t = math.tan(math.radians(3))
    full = 60 * 40 * 20
    # The rim keeps its size and the pocket narrows towards its floor: it opens upwards.
    rim = block.draft(pocket, 3, block.faces().top())
    assert rim.faces().filter(lambda f: abs(f.normal_at().z) > 0.5 and abs(f.center().z) < 1e-9).one().area == pytest.approx(
        (30 - 20 * t) * (20 - 20 * t), rel=1e-9)
    assert rim.volume == pytest.approx(
        full - prismatoid(10, (30 - 20 * t) * (20 - 20 * t), (30 - 10 * t) * (20 - 10 * t), 600), rel=1e-7)
    # The floor keeps its size and the rim widens.
    opened = block.draft(pocket, 3, floor)
    assert opened.faces().top().one().area == pytest.approx(2400 - (30 + 20 * t) * (20 + 20 * t), rel=1e-9)
    assert opened.volume == pytest.approx(
        full - prismatoid(10, 600, (30 + 10 * t) * (20 + 10 * t), (30 + 20 * t) * (20 + 20 * t)), rel=1e-7)
    for part in (rim, opened):
        angles = drafted_angles(part)
        assert len(angles) == 8  # the outer walls stay at 0, the pocket walls get 3 degrees
        assert sorted(round(lo, 6) for lo, _ in angles) == [0.0] * 4 + [3.0] * 4


def test_draft_turns_cylinders_into_cones():
    shaft = Cylinder(10, 20)
    for angle in (5, -5):
        drafted = shaft.draft(walls(shaft), angle, Plane.XY.offset(-10))
        side = drafted.faces().filter(lambda f: f.geom_type == "cone").one()
        assert side.axis.direction.normalized().cross(Z.direction).length < 1e-12
        # a cone's draft about its axis is its half angle
        lo, hi = drafted.draft_analysis(Z).angles(side)
        assert lo == pytest.approx(angle, abs=1e-6) and hi == pytest.approx(angle, abs=1e-6)
        r = 10 - 20 * math.tan(math.radians(angle))
        top = drafted.edges().circles().filter(lambda e: e.arc_center.z > 9).one()
        assert top.radius == pytest.approx(r, rel=1e-9)  # the kernel's B-spline edges are circles again
        assert drafted.volume == pytest.approx(math.pi * 20 / 3 * (100 + 10 * r + r * r), rel=1e-6)
    # A hole widens towards the pull direction, which takes material away.
    holed = Box(40, 30, 20) - Cylinder(5, 40)
    hole = walls(holed).filter(lambda f: f.geom_type == "cylinder")
    opened = holed.draft(hole, 5, Plane.XY.offset(-10))
    r = 5 + 20 * math.tan(math.radians(5))
    assert len(opened.faces().filter(lambda f: f.geom_type == "cone")) == 1
    assert sorted(e.radius for e in opened.edges().circles()) == [pytest.approx(5, rel=1e-9), pytest.approx(r, rel=1e-9)]
    assert opened.volume == pytest.approx(24000 - math.pi * 20 / 3 * (25 + 5 * r + r * r), rel=1e-6)
    # A cylinder is drafted only about its own axis.
    lying = Cylinder(10, 20).rotate(X, 90)
    with pytest.raises(ModelingError, match="axis of the cylinder face.* 90 degrees off"):
        lying.draft(lying.faces().filter(lambda f: f.geom_type == "cylinder"), 3, Plane.XY)
    # A cone that would narrow to a point inside the face
    with pytest.raises(ModelingError, match="narrow to a point"):
        shaft.draft(walls(shaft), 30, Plane.XY.offset(-10))


def test_draft_needs_the_fillets_of_its_walls():
    box = Box(40, 30, 20)
    rounded = box.fillet(box.edges().parallel_to(Z), 5)
    with pytest.raises(ModelingError, match="cylinder face .* meets the drafted plane face .* tangentially.*add it"):
        rounded.draft(walls(rounded).planar(), 3, Plane.XY.offset(-10))
    drafted = rounded.draft(walls(rounded), 3, Plane.XY.offset(-10))
    assert sorted(f.geom_type for f in drafted.faces()) == ["cone"] * 4 + ["plane"] * 6
    t = math.tan(math.radians(3))
    # The cross-section at height h: the rounded rectangle moved in by d = h tan(3 degrees)

    def area(d):
        return (40 - 2 * d) * (30 - 2 * d) - (4 - math.pi) * (5 - d) ** 2

    assert drafted.volume == pytest.approx(prismatoid(20, area(0), area(10 * t), area(20 * t)), rel=1e-6)
    assert drafted.volume == pytest.approx(RoundedRectangle(40, 30, 5).extrude(20, taper=3).volume, rel=1e-6)
    # Rounds along the top cannot be drafted with the walls: draft first, round afterwards.
    rounded_top = box.fillet(box.edges().top(), 3)
    with pytest.raises(ModelingError, match="tangentially.*cannot be drafted about this plane"):
        rounded_top.draft(walls(rounded_top), 3, Plane.XY.offset(-10))
    rounded_after = box.draft(walls(box), 3, Plane.XY.offset(-10))
    assert rounded_after.fillet(rounded_after.edges().top(), 3).is_valid()


def test_draft_a_part_with_holes_and_rounds():
    box = Box(40, 30, 20)
    part = box.fillet(box.edges().parallel_to(Z), 5) - Cylinder(4, 40)
    drafted = part.draft(walls(part), 3, Plane.XY.offset(-10))
    t = math.tan(math.radians(3))

    def area(h):  # the outline moves in by h t, the hole widens by h t
        d = h * t
        return (40 - 2 * d) * (30 - 2 * d) - (4 - math.pi) * (5 - d) ** 2 - math.pi * (4 + d) ** 2

    assert drafted.is_valid() and len(drafted.faces()) == len(part.faces())
    assert drafted.volume == pytest.approx(prismatoid(20, area(0), area(10), area(20)), rel=1e-6)
    # A wall with a hole through it: the hole's cylinder is trimmed by the drafted wall.
    pierced = Box(40, 30, 20) - Cylinder(4, 60).rotate(Y, 90)
    tilted = pierced.draft(walls(pierced).planar(), 5, Plane.XY.offset(-10))
    assert tilted.is_valid() and len(tilted.faces()) == len(pierced.faces())


def test_draft_adds_to_the_draft_a_face_has():
    core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
    sides = core.faces().filter(lambda f: abs(f.normal_at(f.interior_point()).z) < 0.5)
    assert len(sides) == 8
    more = core.draft(sides, 2, Plane.XY)
    assert more.volume == pytest.approx(RoundedRectangle(60, 40, 5).extrude(20, taper=5).volume, rel=1e-6)
    assert all(lo == pytest.approx(5, abs=1e-6) for lo, _ in drafted_angles(more))
    straight = core.draft(sides, -3, Plane.XY)
    assert straight.volume == pytest.approx(RoundedRectangle(60, 40, 5).extrude(20).volume, rel=1e-6)
    assert sorted(f.geom_type for f in straight.faces()) == ["cylinder"] * 4 + ["plane"] * 6
    twice = Box(40, 30, 20).draft(walls(Box(40, 30, 20)), 3, Plane.XY.offset(-10))
    twice = twice.draft(twice.faces().filter(lambda f: abs(f.normal_at().z) < 0.5), 2, Plane.XY.offset(-10))
    once = Box(40, 30, 20).draft(walls(Box(40, 30, 20)), 5, Plane.XY.offset(-10))
    assert twice.volume == pytest.approx(once.volume, rel=1e-9)


def test_draft_after_a_step_round_trip(tmp_path):
    box = Box(40, 30, 20)
    part = box.fillet(box.edges().parallel_to(Z), 4) - Cylinder(5, 40)
    export_step(part, tmp_path / "part.step")
    imported = import_step(tmp_path / "part.step")
    here = part.draft(walls(part), 3, Plane.XY.offset(-10))
    there = imported.draft(walls(imported), 3, Plane.XY.offset(-10))
    assert there.is_valid() and there.volume == pytest.approx(here.volume, rel=1e-6)


def test_draft_errors():
    box = Box(40, 30, 20)
    sides = walls(box)
    for bad in (0, 90, -90, float("nan")):
        with pytest.raises(ValueError, match="draft: the angle"):
            box.draft(sides, bad, Plane.XY)
    for bad in ("3", True, None):
        with pytest.raises(TypeError, match="draft: the angle must be a number"):
            box.draft(sides, bad, Plane.XY)
    with pytest.raises(ValueError, match="no faces selected"):
        box.draft([], 3, Plane.XY)
    with pytest.raises(ValueError, match="not a face of this part"):
        box.draft(Box(1, 1, 1).faces()[0], 3, Plane.XY)
    with pytest.raises(ValueError, match="neutral plane must be a Plane or a planar face"):
        box.draft(sides, 3, Cylinder(3, 3).faces().filter(lambda f: f.geom_type == "cylinder").one())
    with pytest.raises(ModelingError, match="plane face at .* is parallel to the neutral plane"):
        box.draft(box.faces().top(), 3, Plane.XY)
    with pytest.raises(ModelingError, match="lies in the neutral plane"):
        box.draft(box.faces().bottom(), 3, Plane.XY.offset(-10))
    with pytest.raises(ModelingError, match="sphere face .* cannot be drafted"):
        Sphere(10).draft(Sphere(10).faces(), 3, Plane.XY)
    with pytest.raises(ModelingError, match="89.5 degrees of draft"):
        box.draft(sides, 89.5, Plane.XY.offset(-10))
    # At 40 degrees the walls 30 apart meet below the top: the top face would vanish. (How the
    # kernel fails there is up to it: an open body here.)
    with pytest.raises(ModelingError, match="^draft: .*angle"):
        box.draft(sides, 40, Plane.XY.offset(-10))


def test_draft_never_returns_a_broken_part(monkeypatch):
    import smlibpy.draft

    # Without the tangency check the kernel closes the part with faces that do not meet.
    box = Box(40, 30, 20)
    rounded = box.fillet(box.edges().parallel_to(Z), 5)
    monkeypatch.setattr(smlibpy.draft, "TANGENCY", 0.0)
    with pytest.raises(ModelingError, match="draft: "):
        rounded.draft(walls(rounded).planar(), 3, Plane.XY.offset(-10))
    monkeypatch.undo()
    # Next to a sphere the kernel can fail where the sphere's seam runs; turned about its axis
    # the same sphere gives the reference.
    reference = None
    for turn in (90, 0):
        dome = Box(40, 30, 20) & Sphere(40).rotate(Z, turn).translate(0, 0, -25)
        try:
            drafted = dome.draft(walls(dome).planar(), 3, Plane.XY.offset(-10))
        except ModelingError:
            continue  # with the seam at +X: the kernel's gaps were found
        assert drafted.is_valid()
        reference = reference or drafted.volume
        assert drafted.volume == pytest.approx(reference, rel=1e-6)


# -- through the MCP session -----------------------------------------------------------------
def test_session_drafts_faces():
    from smlibpy.mcp.session import Session

    s = Session()
    try:
        ok = s.run("box = Box(40, 30, 20)\nwalls = box.faces().filter(lambda f: abs(f.normal_at().z) < 0.5)\n"
                   "core = box.draft(walls, 3, box.faces().bottom().one().plane.flipped())\n"
                   "print(len(core.faces()), round(core.faces().top().one().area, 4))")
        assert ok["ok"], ok
        t = math.tan(math.radians(3))
        assert ok["output"].split() == ["6", f"{(40 - 40 * t) * (30 - 40 * t):.4f}"]
        bad = s.run("box.draft(box.faces().top(), 3, Plane.XY)")
        assert not bad["ok"] and "ModelingError" in bad["error"] and "parallel to the neutral plane" in bad["error"]
    finally:
        s.close()


def test_search_finds_the_face_draft():
    from smlibpy.mcp import discovery

    for query in ("add draft to the walls", "draft faces", "draft the side walls 2 degrees", "tilt faces",
                  "apply a draft angle"):
        keys = [e.key for _, e in discovery.search(query, 6)]
        assert keys[0] in ("Part.draft", "features/draft"), (query, keys)
        assert keys.index("Part.draft") < keys.index("Part.draft_analysis"), (query, keys)
    for query in ("taper the walls of a part", "neutral plane"):
        assert "Part.draft" in [e.key for _, e in discovery.search(query, 6)], query
    # the analysis is still what a question about the draft finds
    assert [e.key for _, e in discovery.search("draft analysis", 2)] == ["analysis/draft_analysis", "Part.draft_analysis"]
    assert discovery.guide_for(discovery.find_method("Part.draft")).key == "features/draft"
