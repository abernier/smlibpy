"""Draft analysis and parting lines: Part.draft_analysis, Part.parting_line."""

import math

import pytest

from smlibpy import Align, Box, Cylinder, Plane, RoundedRectangle, ShapeList, Sphere, Torus, Wire, X, Y, Z
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
    assert len(line) == 2 and all(w.is_closed for w in line)
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
