"""Lane U of the kernel plan (phase 1): blends between sheet edges (U2), trimming sheets with
curves on them and imprinting curves on parts (U3); fills and curve networks (U4), stitch with its
tolerance, report and normals (U5), extending and untrimming faces (U6); pushing a face at a point
(U7), warping and flattening a region of a face (U8)."""

import math

import numpy as np
import pytest

from smlibpy import (Axis, Box, Circle, CenterArc, Cylinder, Line, ModelingError, Part, Plane, Rectangle, Shell, Sketch,
                     Sphere, Spline, ThreePointArc, Vector, Z, blend, extrude, fill, network, ruled, stitch, surface,
                     surface_fillet)
from smlibpy._kernel import ext, k


def _free(body):
    return [e for e in body.edges() if len(e.faces()) == 1]


def _angle_along(bl, sheet, edge, n=7):
    """The largest angle (degrees) between the blend's and the sheet's normals along an edge."""
    worst = 0.0
    for i in range(n):
        p = edge.point_at((i + 0.5) / n)
        a, b = bl.faces()[0].normal_at(p), sheet.faces()[0].normal_at(p)
        worst = max(worst, math.degrees(math.acos(min(1.0, abs(a.dot(b))))))
    return worst


def _gap_along(bl, edge, n=9):
    return max(bl.distance_to(edge.point_at(i / (n - 1))) for i in range(n))


def _curvatures(face, p):
    _, uvs, _ = k.surface_closest_point(face._f.surface(), p.to_tuple())
    c = ext.face_curvatures(face._f, [[uvs[0].x, uvs[0].y]])
    return float(c["k1"][0]), float(c["k2"][0])


def _steps():
    """Two flat sheets 10 apart in height whose facing edges run opposite ways."""
    a = Rectangle(20, 20).translate(-20, 0).faces()[0].to_shell()
    b = Rectangle(20, 20).on(Plane.XY.offset(10)).translate(20, 0, 0).faces()[0].to_shell()
    ea = a.edges().filter(lambda e: abs(e.center().x + 10) < 1e-9).one()
    eb = b.edges().filter(lambda e: abs(e.center().x - 10) < 1e-9).one()
    return a, b, ea, eb


# ------------------------------------------------------------------------------------- U2: blend
def test_blend_joins_the_nearest_ends_of_edges_that_run_opposite_ways():
    a, b, ea, eb = _steps()
    assert (ea.end - ea.start).dot(eb.end - eb.start) < 0  # the edges run opposite ways
    s = blend(ea, eb)
    assert isinstance(s, Shell) and len(s.faces()) == 1
    # the side edges join (-10, -10, 0) to (10, -10, 10) and (-10, 10, 0) to (10, 10, 10): not crossed
    sides = [e for e in s.edges() if abs(e.start.z - e.end.z) > 5]
    assert len(sides) == 2
    for e in sides:
        assert abs(e.start.y - e.end.y) < 1e-6
    # an untwisted S-bridge 20 wide spans at least 20 x 22.4 (the kernel's twisted ones: 216, 234)
    assert s.area == pytest.approx(466.054, abs=1e-3)
    for sheet, edge in ((a, ea), (b, eb)):
        assert _gap_along(s, edge) < 1e-9
        assert _angle_along(s, sheet, edge) < 1e-6
    # the blend's normal follows edge_a's sheet: sewn, the sheet thickens
    assert s.faces()[0].normal_at((-10, 0, 0)).z == pytest.approx(1.0)
    joined = blend(ea, eb, join=True)
    assert isinstance(joined, Shell) and len(joined.faces()) == 3 and len(_free(joined)) == 8
    assert joined.thicken(1).volume == pytest.approx(joined.area, rel=1e-6)


def test_blend_continuity_and_tension():
    a, b, ea, eb = _steps()
    areas = {c: blend(ea, eb, continuity=c).area for c in ("G1", "G2", "G3")}
    assert areas["G1"] == pytest.approx(456.253, abs=1e-3)
    assert areas["G1"] < areas["G2"] < areas["G3"]
    assert blend(ea, eb, continuity=2).area == pytest.approx(areas["G2"])
    # tension: one number for both edges, or one per edge
    assert blend(ea, eb, tension=1).area == pytest.approx(areas["G2"])
    tight, loose = blend(ea, eb, tension=0.5).area, blend(ea, eb, tension=(0.5, 2)).area
    assert tight == pytest.approx(453.474, abs=1e-3) and loose == pytest.approx(482.976, abs=1e-3)
    # flat sheets: G2 and G3 leave them with no curvature across the edges, G1 does not
    for c, flat in (("G1", False), ("G2", True), ("G3", True)):
        f = blend(ea, eb, continuity=c).faces()[0]
        k1, k2 = _curvatures(f, ea.point_at(0.5))
        assert (max(abs(k1), abs(k2)) < 1e-9) == flat


def test_blend_g2_takes_the_curvature_of_a_curved_sheet():
    # a quarter cylinder r 20 whose straight edge at (20, 0) runs along Z, and a flat sheet
    cyl = extrude(CenterArc((0, 0), 20, 0, 90), 30)
    flat = extrude(Line((30, -20), (50, -20)), 30)
    ea = cyl.edges().filter(lambda e: abs(e.center().x - 20) < 1e-6 and abs(e.center().y) < 1e-6).one()
    eb = flat.edges().filter(lambda e: abs(e.start.x - 30) < 1e-6 and abs(e.end.x - 30) < 1e-6).one()
    assert max(_curvatures(cyl.faces()[0], ea.point_at(0.5))) == pytest.approx(0.05)
    for c in ("G2", "G3"):
        for tension in (1, (0.5, 1.5)):
            f = blend(ea, eb, continuity=c, tension=tension).faces()[0]
            # (the kernel's own G2 blend has 1.28 there: it rescales only the first derivative)
            assert max(_curvatures(f, ea.point_at(0.5))) == pytest.approx(0.05, abs=1e-6)
            assert max(abs(x) for x in _curvatures(f, eb.point_at(0.5))) < 1e-9
            assert _angle_along(blend(ea, eb, continuity=c), cyl, ea) < 1e-6
    g1 = blend(ea, eb, continuity="G1").faces()[0]
    assert max(abs(x) for x in _curvatures(g1, ea.point_at(0.5))) == pytest.approx(0.0306, abs=1e-3)


def test_blend_of_arcs_and_curved_sheets():
    # half cylinders: arc edges (conics) with parameter ranges that do not start at 0
    small = Cylinder(10, 20).split(Plane.XZ).faces().filter(lambda f: f.geom_type == "cylinder").one().to_shell()
    big = (Cylinder(20, 20).split(Plane.XZ).translate(0, 0, 40)
           .faces().filter(lambda f: f.geom_type == "cylinder").one().to_shell())
    ea = small.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 5).one()
    eb = big.edges().filter(lambda e: e.geom_type == "circle" and e.center().z < 40).one()
    assert ea._range()[0] > 0 and eb._range()[0] > 0
    for c in ("G1", "G2"):
        s = blend(ea, eb, continuity=c)
        assert _gap_along(s, ea) < 1e-9 and _gap_along(s, eb) < 1e-9
        assert _angle_along(s, small, ea) < 1e-4 and _angle_along(s, big, eb) < 1e-4
        joined = blend(ea, eb, continuity=c, join=True)
        assert len(joined.faces()) == 3 and len(_free(joined)) == 8
    # freeform sheets (the review's probe): tangent along both edges
    a = surface([[(x, y, 0.05 * x * x + 0.02 * y * y) for y in np.linspace(0, 10, 5)] for x in np.linspace(0, 10, 5)])
    b = surface([[(x, y, 8 + 0.3 * (x - 20) - 0.03 * (x - 20) ** 2 + 0.01 * y * y) for y in np.linspace(0, 10, 5)]
                 for x in np.linspace(20, 30, 5)])
    ea = a.edges().filter(lambda e: abs(e.center().x - 10) < 1e-6).one()
    eb = b.edges().filter(lambda e: abs(e.center().x - 20) < 1e-6).one()
    s = blend(ea, eb)
    assert s.area == pytest.approx(106.35, abs=1e-2)
    assert _angle_along(s, a, ea) < 1e-3 and _angle_along(s, b, eb) < 1e-3


def test_blend_errors():
    a, b, ea, eb = _steps()
    with pytest.raises(ValueError, match="the same edge"):
        blend(ea, ea)
    with pytest.raises(ValueError, match="lies between two faces"):
        blend(Box(10, 10, 10).edges()[0], eb)
    with pytest.raises(TypeError, match="is a curve, not an edge of a sheet"):
        blend(Line((0, 0), (1, 0)), eb)
    with pytest.raises(TypeError, match="takes edges of sheets"):
        blend(a, eb)
    with pytest.raises(ValueError, match="continuity must be G1, G2 or G3"):
        blend(ea, eb, continuity="G4")
    with pytest.raises(ValueError, match="tension must be positive"):
        blend(ea, eb, tension=0)
    with pytest.raises(ValueError, match="one number or a pair"):
        blend(ea, eb, tension=(1, 1, 1))
    tube = Cylinder(10, 20).faces().cylinders()[0].to_shell()
    with pytest.raises(ValueError, match="^blend: closed edges"):
        blend(tube.edges().filter(lambda e: e.center().z > 5).one(), eb)


# -------------------------------------------------------------------------- U3: trim and imprint
def test_trim_a_sheet_with_curves_on_it():
    sheet = Rectangle(40, 40).faces()[0].to_shell()
    disk = sheet.trim(Circle(5).edges(), (0, 0, 0))
    assert isinstance(disk, Shell) and len(disk.faces()) == 1
    assert disk.area == pytest.approx(math.pi * 25)
    holed = sheet.trim(Circle(5).edges(), (15, 15, 0))
    assert holed.area == pytest.approx(1600 - math.pi * 25) and len(holed.faces()[0].wires()) == 2
    both = sheet.trim(Circle(5).edges(), "split")
    assert sorted(round(f.area, 4) for f in both.faces()) == [78.5398, 1521.4602]
    assert sheet.area == pytest.approx(1600) and len(sheet.faces()) == 1  # unchanged
    # a sketch stays a sketch
    from smlibpy import Sketch
    assert isinstance(Rectangle(40, 40).trim(Line((-20, -20), (20, 20)), (10, -10, 0)), Sketch)
    # curves that cross each other (and run past the sheet): each side is bounded by all of them
    cross = [Line((-30, 0), (30, 0)), Line((0, -30), (0, 30))]
    for p in ((5, 5, 0), (-5, 5, 0), (5, -5, 0), (-5, -5, 0)):
        quarter = sheet.trim(cross, p)
        assert len(quarter.faces()) == 1 and quarter.area == pytest.approx(400)
        assert quarter.center().x * p[0] > 0 and quarter.center().y * p[1] > 0
    assert len(sheet.trim(cross, "split").faces()) == 4
    grid = [Line((-30, -10), (30, -10)), Line((-30, 10), (30, 10)), Line((-10, -30), (-10, 30)), Line((10, -30), (10, 30))]
    assert sheet.trim(grid, (0, 0, 0)).area == pytest.approx(400)
    assert sheet.trim(grid, (15, 15, 0)).area == pytest.approx(100)
    assert len(sheet.trim(grid, "split").faces()) == 9


def test_trim_a_freeform_sheet_with_a_projected_outline():
    f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2  # noqa: E731
    sheet = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
    on = sheet.project(CenterArc((20, 15, 50), 5, 0, 360), (0, 0, -1))
    kept = sheet.trim(on, (20, 15, 0))
    holed = sheet.trim(on, (2, 2, 0))
    # (the kernel's projection and trim, trim_project_parallel: 78.7358 and 1169.8713)
    assert kept.area == pytest.approx(78.736, abs=1e-2)
    assert kept.area + holed.area == pytest.approx(sheet.area, rel=1e-6)
    assert len(holed.faces()[0].wires()) == 2
    plate = holed.thicken(1)
    assert plate.is_valid() and plate.volume == pytest.approx(holed.area, rel=2e-3)
    assert len(sheet.trim(on, "split").faces()) == 2


def test_surface_fillet_trim_sews_one_sheet():
    floor = Rectangle(40, 40).faces()[0]
    wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]
    one = surface_fillet(floor, wall, 5, trim=True)
    assert isinstance(one, Shell) and len(one.faces()) == 3 and len(_free(one)) == 8
    assert one.area == pytest.approx(600 + 600 + 5 * math.pi / 2 * 40)  # 1514.1593
    assert one.thicken(1).is_valid()
    # a curve across all three faces: trim the sewn sheet in half
    cs = one.intersection_curves(Rectangle(200, 200).on(Plane.YZ).faces()[0].to_shell())
    assert len(cs) == 3
    half = one.trim(cs, (10, -15, 0))
    assert half.area == pytest.approx(one.area / 2, rel=1e-6) and len(half.faces()) == 3
    assert len(one.trim(cs, "split").faces()) == 6
    # one curve that runs across the three faces is cut where it passes from face to face
    chain = sorted(cs, key=lambda c: c.center().z)
    oriented = [chain[0] if (chain[0].end - chain[1].start).length < 1e-6 or (chain[0].end - chain[1].end).length < 1e-6
                else chain[0].reversed()]
    for c in chain[1:]:
        oriented.append(c if (c.start - oriented[-1].end).length < 1e-6 else c.reversed())
    curves = [c._copy_curve() for c in oriented]
    try:
        from smlibpy.shapes import Edge
        joined = Edge._from_curve(ext.join_curves(curves))
    finally:
        for c in curves:
            ext.delete_curve(c)
    assert one.trim(joined, (10, -15, 0)).area == pytest.approx(half.area, rel=1e-6)


def test_face_split():
    floor = Rectangle(40, 40).faces()[0]
    pieces = floor.split(Line((-20, -20), (20, 20)))
    assert [round(f.area, 6) for f in pieces] == [800.0, 800.0]
    assert pieces[0].owner is pieces[1].owner and floor.area == pytest.approx(1600)


def test_imprint_projects_curves_onto_the_faces_seen_or_crossed():
    box = Box(20, 20, 10)
    ring = Circle(4).edges().translate(0, 0, 50)
    top = box.imprint(ring, (0, 0, -1))
    assert isinstance(top, Part) and len(top.faces()) == 7 and top.is_valid()
    assert top.volume == pytest.approx(4000)
    disk, rest = sorted(f.area for f in top.faces().filter(lambda f: f.center().z > 4.9))
    assert disk == pytest.approx(16 * math.pi, abs=1e-4) and disk + rest == pytest.approx(400)
    with pytest.raises(ModelingError, match="miss the part"):  # only ahead of the curves
        box.imprint(ring, (0, 0, 1))
    through = box.imprint(ring, -Z, nearest=False)
    assert len(through.faces()) == 8 and through.volume == pytest.approx(4000)
    # curves already on the faces
    assert len(box.imprint(box.project(ring[0], (0, 0, -1))).faces()) == 8
    # a filleted box keeps its shape
    rounded = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3)
    r = rounded.imprint(ring, (0, 0, -1))
    assert len(r.faces()) == len(rounded.faces()) + 1 and r.volume == pytest.approx(rounded.volume)


def test_imprint_across_the_seam_of_a_cylinder():
    cyl = Cylinder(10, 40)
    ring = CenterArc((50, 0, 0), 4, 0, 360).rotate(Axis_y(50), 90)
    r = cyl.imprint(ring, (-1, 0, 0))
    patch = r.faces().filter(lambda f: f.geom_type == "cylinder" and f.area < 100)
    # (trim_project_parallel imprinted one of the two halves only)
    assert len(patch) == 2 and sum(f.area for f in patch) == pytest.approx(51.3366, abs=1e-4)
    assert sum(f.area for f in r.faces()) == pytest.approx(sum(f.area for f in cyl.faces()), rel=1e-7)
    assert r.volume == pytest.approx(cyl.volume) and r.is_valid()
    assert len(cyl.imprint(ring, (-1, 0, 0), nearest=False).faces()) == 6


def Axis_y(x):
    from smlibpy import Axis
    return Axis((x, 0, 0), (0, 1, 0))


def test_trim_and_imprint_errors():
    sheet = Rectangle(40, 40).faces()[0].to_shell()
    with pytest.raises(ValueError, match='or "split"'):
        sheet.trim(Circle(5).edges(), "both")
    with pytest.raises(ValueError, match="must lie on the faces"):
        sheet.trim(Circle(5).edges().translate(0, 0, 3), "split")
    with pytest.raises(ModelingError, match="do not split the sheet"):
        sheet.trim(Line((-5, 0), (5, 0)), "split")  # a slit that ends inside the face
    with pytest.raises(ModelingError, match="do not cut the sheet in two"):
        sheet.trim(Line((-5, 0), (5, 0)), (0, 10, 0))
    with pytest.raises(TypeError, match="takes curves"):
        sheet.trim(Box(1, 1, 1), "split")
    with pytest.raises(ValueError, match="no curves"):
        sheet.trim([], "split")
    box = Box(20, 20, 10)
    with pytest.raises(ValueError, match="must lie on the faces"):
        box.imprint(Circle(4).edges().translate(0, 0, 50))
    with pytest.raises(ModelingError, match="miss the part"):
        box.imprint(Circle(4).edges().translate(100, 0, 50), (0, 0, -1))
    with pytest.raises(ValueError, match="direction must not be zero"):
        box.imprint(Circle(4).edges(), (0, 0, 0))


def test_guides_of_the_new_calls():
    from smlibpy.mcp import discovery

    for method, guide in (("blend", "surfaces/blend"), ("Shell.trim", "surfaces/trim"), ("Part.imprint", "features/imprint"),
                          ("Face.split", "selection/Face")):
        assert discovery.guide_for(discovery.find_method(method)).key == guide


# ---------------------------------------------------------------------------------------------- U5


def _moved_faces(box, amount):
    """The faces of a box, each moved by a fixed small offset (gaps of about `amount`)."""
    shifts = [(1, -1, 0.5), (-0.5, 1, 1), (1, 0.5, -1), (-1, -1, 0.5), (0.5, 1, -1), (-1, 0.5, 1)]
    return [f.to_shell().translate(*(amount * c for c in d)) for f, d in zip(box.faces(), shifts)]


def test_stitch_honours_the_tolerance_and_reports_the_gaps():
    # gaps of up to about 0.07 in a 200 mm box: stitch_into_solid closed them with tolerance=1e-4
    pieces = _moved_faces(Box(200, 100, 100), 0.03)
    open_, report = stitch(pieces, tolerance=1e-4, report=True)
    assert type(open_) is Shell
    assert report.sewn_edges == 0 and report.open_edges >= 24 and report.max_gap == 0.0
    closed, report = stitch(pieces, tolerance=0.2, report=True)
    assert isinstance(closed, Part) and closed.is_valid()
    assert report.sewn_edges == 12 and report.open_edges == 0
    assert 0.03 < report.max_gap <= 0.2 and report.tolerance <= 0.2
    # the default is 1e-4 of the size: a box built from its own faces closes exactly
    exact, report = stitch([f.to_shell() for f in Box(10, 10, 10).faces()], report=True)
    assert isinstance(exact, Part) and exact.volume == pytest.approx(1000, abs=1e-9)
    assert report.max_gap == 0.0 and report.open_edges == 0
    with pytest.raises(ValueError, match="positive distance"):
        stitch(pieces, tolerance=0)


def test_stitch_returns_a_part_when_sewn_shut():
    # todo surfaces #9: five faces and the top raised by 0.1, sewn with tolerance 0.2
    box = Box(10, 10, 10)
    top = box.faces().filter(lambda f: f.normal_at().z > 0.5)[0]
    pieces = [f.to_shell() for f in box.faces() if f != top] + [top.to_shell().translate(0, 0, 0.1)]
    body, report = stitch(pieces, tolerance=0.2, report=True)
    assert isinstance(body, Part) and body.is_valid()
    assert report.max_gap == pytest.approx(0.1, abs=1e-9)
    # without a tolerance the gap stays open: four free edges around the top, four below it
    body, report = stitch(pieces, report=True)
    assert type(body) is Shell and report.open_edges == 8
    # a T-junction: one long edge against two short ones
    long = Box(20, 10, 10).translate(10, 5, 5)
    sides = [f.to_shell() for f in long.faces() if not f.normal_at().z > 0.5]
    tops = [Box(10, 10, 10).translate(5 + 10 * i, 5, 5).faces().filter(lambda f: f.normal_at().z > 0.5)[0].to_shell()
            for i in range(2)]
    tee = stitch(sides + tops, tolerance=1e-3)
    assert isinstance(tee, Part) and tee.volume == pytest.approx(2000, abs=1e-6)


def test_stitch_turns_open_sheets_to_agree():
    # todo surfaces #12: a floor (normal +Z) and a wall (normal +Y, away from the floor)
    floor = ruled(Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 0), (10, 10, 0)))
    wall = ruled(Line((0, 10, 10), (10, 10, 10)), Line((0, 10, 0), (10, 10, 0)))
    sheet, report = stitch(floor, wall, report=True)
    assert report.turned_faces == 1 and report.sewn_edges == 1
    normals = sorted(tuple(round(c, 9) + 0.0 for c in f.normal_at()) for f in sheet.faces())
    assert normals == [(0.0, -1.0, 0.0), (0.0, 0.0, 1.0)]  # the floor's normal kept, the wall turned
    plate = sheet.thicken(1)
    assert plate.is_valid() and plate.volume == pytest.approx(190.0, abs=1e-6)
    # the first piece decides
    plate = stitch(wall, floor).thicken(1)
    assert plate.volume == pytest.approx(210.0, abs=1e-6)


def test_flipped():
    sheet = Rectangle(10, 20).faces()[0].to_shell()
    turned = sheet.flipped()
    assert type(turned) is Shell and turned.area == pytest.approx(200)
    assert tuple(turned.faces()[0].normal_at()) == pytest.approx((0, 0, -1))
    assert tuple(turned.flipped().faces()[0].normal_at()) == pytest.approx((0, 0, 1))
    assert turned.thicken(2).bbox().min.z == pytest.approx(-2)
    face = Box(10, 10, 10).faces().filter(lambda f: f.normal_at().x > 0.5)[0]
    assert tuple(face.flipped().faces()[0].normal_at()) == pytest.approx((-1, 0, 0))
    # an open curved sheet turns; a whole sphere encloses a volume and cannot
    hemi = (Sphere(5) & Box(20, 20, 20).translate(0, 0, 10)).faces().filter(lambda f: f.geom_type == "sphere")[0]
    assert tuple(hemi.flipped().faces()[0].normal_at((0, 0, 5))) == pytest.approx((0, 0, -1))
    with pytest.raises(ValueError, match="encloses a volume"):
        Sphere(5).faces()[0].to_shell().flipped()
    sk = Rectangle(10, 10).flipped()
    assert isinstance(sk, Sketch) and tuple(sk.plane.z_dir) == pytest.approx((0, 0, -1))
    assert sk.extrude(3).bbox().min.z == pytest.approx(-3)


# ---------------------------------------------------------------------------------------------- U6


def test_extended_planes_stay_planes():
    top = Box(10, 10, 10).faces().filter(lambda f: f.normal_at().z > 0.5)[0]
    grown = top.extended(3)
    assert grown.faces()[0].geom_type == "plane" and grown.area == pytest.approx(256)
    assert tuple(grown.faces()[0].normal_at()) == pytest.approx((0, 0, 1))
    side = max(top.edges(), key=lambda e: e.center().x)
    one = top.extended(3, sides=side)
    assert one.area == pytest.approx(130) and one.bbox().max.x == pytest.approx(8)
    bottom = Box(10, 10, 10).faces().filter(lambda f: f.normal_at().z < -0.5)[0]
    assert tuple(bottom.extended(1).faces()[0].normal_at()) == pytest.approx((0, 0, -1))
    # a disk: the smallest square around it, grown
    assert Circle(5).faces()[0].extended(1).area == pytest.approx(144)
    assert Circle(5).faces()[0].untrimmed().area == pytest.approx(100)


def test_extended_cylinders_and_spheres_continue_as_themselves():
    cyl = Cylinder(5, 10).faces().filter(lambda f: f.geom_type == "cylinder")[0]
    grown = cyl.extended(2)  # around it the cylinder closes: only along its axis
    assert grown.faces()[0].geom_type == "cylinder"
    assert grown.area == pytest.approx(2 * math.pi * 5 * 14, rel=1e-9)
    assert grown.bbox().min.z == pytest.approx(-7) and grown.bbox().max.z == pytest.approx(7)
    seam = [e for e in cyl.edges(seams=True) if e.geom_type == "line"]
    with pytest.raises(ValueError, match="closes around"):
        cyl.extended(2, sides=seam)
    cap = (Sphere(5) & Box(4, 4, 4).translate(0, 0, 4)).faces().filter(lambda f: f.geom_type == "sphere")[0]
    grown = cap.extended(1)
    assert grown.faces()[0].geom_type == "sphere" and grown.area > cap.area
    f = grown.faces()[0]
    (u0, v0), (u1, v1) = f._f.uv_domain()
    radii = [np.linalg.norm(f._f.point_at_uv(u0 + (u1 - u0) * i / 6, v0 + (v1 - v0) * j / 6)) for i in range(7) for j in range(7)]
    assert max(abs(r - 5) for r in radii) < 1e-9
    # straight on along the tangents (G1): a quarter round r 2 grown by 1 reaches the tangent lines
    box = Box(10, 10, 10)
    quarter = box.fillet(box.edges().parallel_to(Z), 2).faces().filter(lambda f: f.geom_type == "cylinder")[0]
    lo = quarter.bbox().min
    straight = quarter.extended(1, continuity="G1").bbox().min
    assert min(straight.x, straight.y) == pytest.approx(min(lo.x, lo.y) - 1, abs=1e-6)


def test_extended_bspline_sheets_by_the_distance():
    sheet = surface([[(x, y, 0.05 * (x - 10) ** 2) for y in range(0, 21, 5)] for x in range(0, 21, 5)])
    for continuity in ("natural", "G1", "G2"):
        grown = sheet.extend(3, continuity=continuity)
        b = grown.bbox()
        assert b.min.y == pytest.approx(-3, abs=1e-6) and b.max.y == pytest.approx(23, abs=1e-6)
        # the original sheet is part of the grown one
        assert max(grown.distance_to((x, y, 0.05 * (x - 10) ** 2)) for x in (0, 10, 20) for y in (0, 10, 20)) < 1e-6
    # G1 runs on straight along the tangent: 3 along it from the corner of the parabola
    g1 = sheet.extend(3, continuity="G1")
    assert g1.bbox().min.x < sheet.bbox().min.x - 2


def test_untrimmed():
    cut = Box(20, 20, 20) - Cylinder(4, 40)
    hole = cut.faces().filter(lambda f: f.geom_type == "cylinder")[0]
    whole = hole.untrimmed()
    assert whole.area == pytest.approx(2 * math.pi * 4 * 40, rel=1e-9)
    assert whole.bbox().min.z == pytest.approx(-20) and whole.bbox().max.z == pytest.approx(20)
    assert tuple(whole.faces()[0].normal_at((4, 0, 0))) == pytest.approx(tuple(hole.normal_at((4, 0, 0))))
    top = cut.faces().filter(lambda f: f.normal_at().z > 0.5)[0]
    assert top.untrimmed().area == pytest.approx(400)


def test_extend_errors():
    sheet = surface([[(x, y, 0.0) for y in range(0, 21, 5)] for x in range(0, 21, 5)])
    two = stitch(sheet, sheet.translate(20, 0, 0))
    with pytest.raises(ValueError, match="2 faces"):
        two.extend(1)
    with pytest.raises(ValueError, match="positive"):
        sheet.extend(0)
    with pytest.raises(ValueError, match="continuity"):
        sheet.extend(1, continuity="G3")
    with pytest.raises(ValueError, match="does not bound"):
        sheet.extend(1, sides=Box(1, 1, 1).edges()[0])
    with pytest.raises(TypeError, match="edges"):
        sheet.extend(1, sides=[sheet.faces()[0]])


# ---------------------------------------------------------------------------------------------- U4


def _bulged_square():
    return [Spline((0, 0, 0), (5, 0, 2), (10, 0, 0)), Spline((10, 0, 0), (10, 5, 1), (10, 10, 0)),
            Spline((10, 10, 0), (5, 10, 2), (0, 10, 0)), Spline((0, 10, 0), (0, 5, 1), (0, 0, 0))]


def test_fill_four_curves_coons():
    a, b, c, d = _bulged_square()
    patch = fill([a, b, c, d])
    assert len(patch.faces()) == 1 and patch.area == pytest.approx(112.2176, abs=1e-4)
    for curve in (a, b, c, d):
        assert max(patch.distance_to(curve.point_at(i / 8)) for i in range(9)) < 1e-6
    assert patch.bbox().max.z == pytest.approx(3.0, abs=1e-6)  # bilinear: the two bulges add up
    assert tuple(patch.faces()[0].normal_at()) == pytest.approx((0, 0, 1), abs=0.05)
    # any order and direction
    shuffled = fill([c, a.reversed(), d, b])
    assert shuffled.area == pytest.approx(patch.area, abs=1e-6)


def test_fill_three_and_five_curves():
    r = 10.0
    s = r / math.sqrt(2)
    arcs = [ThreePointArc((r, 0, 0), (s, s, 0), (0, r, 0)), ThreePointArc((0, r, 0), (0, s, s), (0, 0, r)),
            ThreePointArc((0, 0, r), (s, 0, s), (r, 0, 0))]
    patch = fill(arcs)
    assert type(patch) is Shell and len(patch.faces()) == 3 and len(_free(patch)) == 6
    for arc in arcs:
        assert max(patch.distance_to(arc.point_at(i / 8)) for i in range(9)) < 1e-6
    pts = [(10 * math.cos(2 * math.pi * i / 5), 10 * math.sin(2 * math.pi * i / 5), 0) for i in range(5)]
    sides = [Spline(pts[i], tuple((np.array(pts[i]) + np.array(pts[(i + 1) % 5])) / 2 + [0, 0, 2]), pts[(i + 1) % 5])
             for i in range(5)]
    patch = fill(sides)
    assert len(patch.faces()) == 5 and len(_free(patch)) == 10
    assert patch.area == pytest.approx(264.2841, abs=1e-3)


def test_fill_a_hole_tangent_to_the_sheet():
    cut = Sphere(10) - Box(30, 30, 30).translate(0, 0, 8 + 15)
    sheet = stitch([f for f in cut.faces() if f.geom_type == "sphere"])
    rim = _free(sheet)
    cap = fill(rim)
    assert len(cap.faces()) == 1
    worst = 0.0
    for e in rim:
        for t in (0.1, 0.3, 0.5, 0.7, 0.9):
            p = e.point_at(t)
            a, b = sheet.faces()[0].normal_at(p), cap.faces()[0].normal_at(p)
            assert a.dot(b) > 0  # the cap faces out with the sphere
            worst = max(worst, math.degrees(math.acos(min(1.0, a.dot(b)))))
    assert worst < 0.1
    ball = stitch(sheet, cap)
    assert isinstance(ball, Part) and ball.is_valid()
    assert 4141 < ball.volume < 4188.8  # above a flat lid (4071.5), below the whole sphere


def test_fill_an_n_sided_hole_tangent():
    g = surface([[(x, y, 0.02 * (x * x + y * y)) for y in range(-20, 21, 5)] for x in range(-20, 21, 5)])
    from smlibpy import RegularPolygon

    hole = stitch((Box(100, 100, 100) - RegularPolygon(5, 5).extrude(100, both=True)) & g)
    rim = [e for e in _free(hole) if e.center().x ** 2 + e.center().y ** 2 < 100]
    patch = fill(rim)
    assert len(patch.faces()) == 5
    worst = 0.0
    for e in rim:
        for t in (0.25, 0.5, 0.75):
            p = e.point_at(t)
            fs = min(hole.faces(), key=lambda f: f.distance_to(p))
            fp = min(patch.faces(), key=lambda f: f.distance_to(p))
            worst = max(worst, math.degrees(math.acos(min(1.0, abs(fs.normal_at(p).dot(fp.normal_at(p)))))))
    assert worst < 2.0  # the kernel's N-sided fill is tangent only approximately (about 1.4 degrees)
    closed = stitch(hole, patch)
    assert len(_free(closed)) == len(_free(hole)) - len(rim)


def test_fill_errors():
    a, b, c, d = _bulged_square()
    with pytest.raises(ValueError, match="do not close"):
        fill([a, b, c])
    sheet = Rectangle(10, 10).faces()[0].to_shell()
    with pytest.raises(ValueError, match="mixed"):
        fill(list(_free(sheet))[:3] + [Line((-5, 5, 0), (-5, -5, 0))])
    with pytest.raises(ValueError, match="between two faces"):
        fill(Box(10, 10, 10).faces()[0].edges())
    wall = Cylinder(5, 20).faces().filter(lambda f: f.geom_type == "cylinder")[0].to_shell()
    top = [e for e in _free(wall) if e.center().z > 0]
    with pytest.raises(ModelingError, match="folds back|not tangentially"):
        fill(top)  # a wall standing up from the loop
    assert fill(top, tangent=False).area == pytest.approx(math.pi * 25, rel=1e-6)


def _network():
    def h(x, y):
        return math.sin(math.pi * x / 10) * (1 + 0.3 * y / 10) + 0.5 * math.sin(math.pi * y / 10)

    us = [Spline(*[(x, y, h(x, y)) for x in (0, 2, 5, 7.5, 10)]) for y in (0, 5, 10)]
    vs = [Spline(*[(x, y, h(x, y)) for y in (0, 3, 5, 8, 10)]) for x in (0, 5, 10)]
    return us, vs, h


def test_network_runs_through_its_curves():
    us, vs, _ = _network()
    sheet = network(us, vs)
    assert len(sheet.faces()) == 1
    deviation = max(sheet.distance_to(c.point_at(i / 32)) for c in us + vs for i in range(33))
    assert deviation < 1e-6  # the kernel's own Gordon surface missed such a network by 4e-2
    assert sheet.faces()[0].normal_at().z > 0.99  # +X (u) crossed with +Y (v)
    again = network([us[2], us[0].reversed(), us[1]], [vs[1], vs[0], vs[2].reversed()])
    assert again.area == pytest.approx(sheet.area, abs=1e-6)
    assert network([us[0], us[2]], [vs[0], vs[2]]).area == pytest.approx(103.8279, abs=1e-4)


def test_network_errors():
    us, vs, h = _network()
    with pytest.raises(ValueError, match="at least two"):
        network(us, [vs[0]])
    with pytest.raises(ValueError, match="do not cross"):
        network(us, [vs[0], vs[1], vs[2].translate(0, 0, 1)])
    with pytest.raises(ValueError, match="past the outer"):
        network(us, [vs[0], Spline(*[(5, y, h(5, y)) for y in (-3, 0, 5, 10)]), vs[2]])
    with pytest.raises(TypeError, match="list of curves"):
        network(us[0], vs)
    c = us[0]._copy_curve()
    try:
        with pytest.raises(ValueError, match="640"):
            ext.network_surface([c] * 641, [c, c], 1e-3)
    finally:
        ext.delete_curve(c)


def test_guides_of_u4_u5_u6():
    from smlibpy.mcp import discovery

    for method, guide in (("fill", "surfaces/fill"), ("network", "surfaces/network"), ("Shell.extend", "surfaces/extend"),
                          ("stitch", "surfaces/stitch"), ("Shell.flipped", "surfaces/Shell"),
                          ("Face.extended", "selection/Face"), ("Face.untrimmed", "selection/Face")):
        assert discovery.guide_for(discovery.find_method(method)).key == guide


# ---------------------------------------------------------------------- U7: push


def _top(part):
    return part.faces().sort_by(Axis.Z)[-1]


def _z_at(face, x, y):
    """The height of a face over (x, y), along a vertical ray from below."""
    hits = face.raycast((x, y, -100), (0, 0, 1))
    assert hits, (x, y)
    return hits[-1].point.z


def test_push_moves_the_point_exactly_and_nothing_else():
    box = Box(60, 40, 20)
    top = _top(box)
    p = box.push(top, (0, 0, 10), by=5, radius=15)
    f = _top(p)
    assert p.is_valid() and len(p.faces()) == 6
    assert f.geom_type == "bspline"
    assert f.distance_to((0, 0, 15)) < 1e-9
    assert p.bbox().max.z == pytest.approx(15, abs=1e-9)
    # a cubic bump of radius 15: 500 more (5 times 10 by 10)
    assert p.volume == pytest.approx(48500, abs=1e-6)
    # unchanged beyond the radius, and the edges stay
    assert _z_at(f, 20, 0) == pytest.approx(10, abs=1e-12)
    assert _z_at(f, 0, 16) == pytest.approx(10, abs=1e-12)
    for e in f.edges():
        assert all(abs(e.point_at(t).z - 10) < 1e-12 for t in (0, 0.3, 0.5, 0.8))
        assert max(f.distance_to(e.point_at(t)) for t in (0.1, 0.5, 0.9)) < 1e-9
    # the other faces stay planes; the box does not change
    assert sum(g.geom_type == "plane" for g in p.faces()) == 5
    assert box.volume == pytest.approx(48000)


def test_push_to_a_point_with_a_normal():
    box = Box(60, 40, 20)
    p = box.push(_top(box), (5, 3, 10), to=(5, 3, 13), normal=(0.2, 0, 1), radius=10)
    f = _top(p)
    assert f.distance_to((5, 3, 13)) < 1e-9
    n = f.normal_at((5, 3, 13))
    assert n.dot(Vector(0.2, 0, 1).normalized()) == pytest.approx(1, abs=1e-9)
    # every face of the box, its surface's normal along the outward one or against it
    for f in box.faces():
        n = f.normal_at()
        tilted = (n + Vector(0.1, 0.1, 0.1)).normalized()
        p = box.push(f, f.center(), by=3, radius=6, normal=tilted)
        g = p.faces().filter(lambda h: h.geom_type == "bspline")[0]
        assert p.volume > box.volume + 40 and p.is_valid()
        assert g.normal_at(f.center() + n * 3).dot(tilted) == pytest.approx(1, abs=1e-9)
    # by a vector, and pulling in (a dent)
    q = box.push(_top(box), (0, 0, 10), by=(0, 0, -4), radius=12)
    assert q.bbox().max.z == pytest.approx(10) and _top(q).distance_to((0, 0, 6)) < 1e-9
    assert q.volume < 48000


def test_push_continuity_at_the_edges_it_reaches():
    box = Box(60, 40, 20)
    g1 = box.push(_top(box), (0, 0, 10), by=5, radius=30)
    g2 = box.push(_top(box), (0, 0, 10), by=5, radius=30, continuity="G2")
    g0 = box.push(_top(box), (0, 0, 10), by=5, radius=30, continuity="G0")
    assert g1.volume == pytest.approx(49833.333333, abs=1e-4)
    assert g2.volume == pytest.approx(49500, abs=1e-4)
    assert g0.is_valid() and g1.is_valid() and g2.is_valid()
    # G1 and G2 keep the top's tangent plane along its edges: level there
    for p in (g1, g2):
        f = _top(p)
        for y in (-19.999, 19.999):
            assert f.normal_at((0, y, 10)).z > 0.9999


def test_push_refuses_to_move_a_hole_and_shrinks_by_default():
    part = Box(60, 40, 20) - Cylinder(4, 40).translate(10, 0, 0)
    top = part.faces().filter(lambda f: f.geom_type == "plane").sort_by(Axis.Z)[-1]
    with pytest.raises(ValueError, match="reaches an edge of the face"):
        part.push(top, (0, 0, 10), by=3, radius=8)
    ok = part.push(top, (0, 0, 10), by=3, radius=5)
    auto = part.push(top, (0, 0, 10), by=3)
    for p in (ok, auto):
        assert p.is_valid()
        hole = p.faces().filter(lambda f: f.geom_type == "cylinder")[0]
        f = p.faces().filter(lambda f: f.geom_type == "bspline")[0]
        assert f.distance_to((0, 0, 13)) < 1e-9
        rim = [e for e in hole.edges() if e.center().z > 0]
        assert rim and max(f.distance_to(e.point_at(t)) for e in rim for t in (0, 0.25, 0.5, 0.75)) < 1e-9


def test_push_a_cylinder_across_its_quarter_turn_stays_smooth():
    c = Cylinder(10, 40)
    side = c.faces().filter(lambda f: f.geom_type == "cylinder")[0]
    p = c.push(side, (0, 10, 5), by=2, radius=6)
    f = p.faces().filter(lambda f: f.geom_type == "bspline")[0]
    assert p.is_valid()
    assert f.distance_to((0, 12, 5)) < 1e-9 and p.bbox().max.y == pytest.approx(12, abs=1e-9)
    assert p.volume == pytest.approx(12599.44, abs=0.01)
    # the cylinder's B-spline is only C0 in its control points at the quarter turn (y axis): the
    # normals turn smoothly across it (no crease)
    steps = []
    prev = None
    for i in range(-40, 41):
        a = math.radians(90 + i * 0.05)
        q = Vector(*f._f.closest_point((14 * math.cos(a), 14 * math.sin(a), 6))[0])
        n = f.normal_at(q)
        if prev is not None:
            steps.append(math.degrees(math.acos(min(1.0, n.dot(prev)))))
        prev = n
    assert max(steps) < 3 * sorted(steps)[len(steps) // 2] + 1e-6
    # away from the change it is still the cylinder
    assert f.distance_to((10, 0, -15)) < 1e-9 and f.distance_to((0, -10, 15)) < 1e-9


def test_push_a_sphere_and_a_sheet():
    s = Sphere(10)
    f0 = s.faces()[0]
    at = Vector(f0._f.closest_point((7.0710678, 7.0710678, 0))[0])
    p = s.push(f0, at, by=-1.5, radius=4)
    assert p.is_valid() and p.faces()[0].distance_to(at * (8.5 / 10)) < 1e-9
    assert p.volume == pytest.approx(4178.0, abs=0.01)
    sheet = surface([[(x, y, 2 * math.sin(x / 10) * math.cos(y / 15)) for y in range(0, 61, 10)] for x in range(0, 61, 10)])
    f = sheet.faces()[0]
    at = Vector(f._f.closest_point((30, 30, 0))[0])
    out = sheet.push(f, at, by=(0, 0, 5), radius=12, normal=(1, 0, 1))
    assert isinstance(out, Shell) and not isinstance(out, Part)
    g = out.faces()[0]
    assert g.distance_to(at + Vector(0, 0, 5)) < 1e-9
    assert g.normal_at(at + Vector(0, 0, 5)).dot(Vector(1, 0, 1).normalized()) == pytest.approx(1, abs=1e-9)
    # a sheet's edges stay
    for e in f.edges():
        assert max(g.distance_to(e.point_at(t)) for t in (0.2, 0.5, 0.8)) < 1e-9


def test_push_survives_a_copy_and_the_native_format(tmp_path):
    from smlibpy import load, save

    p = Box(60, 40, 20).push(_top(Box(60, 40, 20)), (0, 0, 10), by=5, radius=15)
    path = tmp_path / "pushed.smb"
    save(p, path)
    back = load(path)
    back = back[0] if isinstance(back, list) else back
    assert back.bbox().max.z == pytest.approx(15, abs=1e-9)
    assert back.volume == pytest.approx(48500, abs=1e-6)
    # a copy of the face keeps its bump too (not taken for a plane: K7)
    assert _top(back).to_shell().bbox().max.z == pytest.approx(15, abs=1e-9)


def test_push_errors():
    box = Box(60, 40, 20)
    top = _top(box)
    with pytest.raises(ValueError, match="not both"):
        box.push(top, (0, 0, 10), by=1, to=(0, 0, 12))
    with pytest.raises(ValueError, match="give the move"):
        box.push(top, (0, 0, 10))
    with pytest.raises(ValueError, match="continuity"):
        box.push(top, (0, 0, 10), by=1, continuity="G3")
    with pytest.raises(ValueError, match="radius"):
        box.push(top, (0, 0, 10), by=1, radius=0)
    with pytest.raises(ValueError, match="not a face of this part"):
        box.push(_top(Box(5, 5, 5).translate(100, 0, 0)), (100, 0, 2.5), by=1)
    with pytest.raises(TypeError, match="must be a Face"):
        box.push(box.edges()[0], (0, 0, 10), by=1)
    with pytest.raises(ValueError, match="on an edge of the face"):
        box.push(top, (30, 0, 10), by=1)
    with pytest.raises(ValueError, match="same side|tilts"):
        box.push(top, (0, 0, 10), by=1, normal=(0, 0, -1))
    # a face of an earlier version of the part is found by its place
    moved = box.push(top, (0, 0, 10), by=1, radius=5)
    assert moved.push(top.owner.faces().sort_by(Axis.X)[0], (-30, 0, 0), by=1, radius=5).is_valid()


# -------------------------------------------------------------- U8: warp and flatten


def test_warp_raises_a_region_by_the_height():
    box = Box(60, 40, 20)
    top = _top(box)
    vols = {}
    for cont in ("G2", "G1", "crease"):
        w = box.warp(top, Rectangle(20, 16).on(top), 4, continuity=cont)
        assert w.is_valid()
        assert w.bbox().max.z == pytest.approx(14, abs=1e-9)
        f = _top(w)
        # the change stays inside the region (a rectangle here)
        assert _z_at(f, 25, 15) == pytest.approx(10, abs=1e-12)
        assert _z_at(f, 10.5, 0) == pytest.approx(10, abs=1e-12)
        assert _z_at(f, 0, 0) > 13.8
        vols[cont] = w.volume
        if cont == "G2":
            assert _z_at(f, 0, 0) == pytest.approx(14, abs=1e-9)
    assert vols["G2"] == pytest.approx(48148.027, abs=1e-3)
    assert vols["G2"] < vols["G1"] < vols["crease"]
    # sinking a round region (a polygon of the circle's points), and by a vector
    w = box.warp(top, Circle(8).on(top), -3)
    assert w.bbox().min.z == pytest.approx(-10) and _top(w).distance_to((0, 0, 7)) < 1e-9
    pts = [(-10, -8, 10), (10, -8, 10), (10, 8, 10), (-10, 8, 10)]
    assert box.warp(top, pts, (0, 0, 4)).volume == pytest.approx(vols["G2"], abs=1e-6)


def test_warp_a_cylinder_and_a_sheet():
    c = Cylinder(10, 40)
    side = c.faces().filter(lambda f: f.geom_type == "cylinder")[0]
    outline = c.project(Rectangle(10, 12).on(Plane.XZ.offset(-30)).faces()[0].outer_wire(), (0, 1, 0))
    assert len(outline) > 0
    near = [(10 * math.cos(math.radians(a)), 10 * math.sin(math.radians(a)), z) for a, z in ((60, -6), (120, -6), (120, 6), (60, 6))]
    w = c.warp(side, near, 3)
    assert w.is_valid() and w.bbox().max.y == pytest.approx(13, abs=1e-9)
    f = w.faces().filter(lambda f: f.geom_type == "bspline")[0]
    assert f.distance_to((10, 0, -15)) < 1e-9
    sheet = surface([[(x, y, 0.02 * (x - 20) ** 2) for y in range(0, 41, 10)] for x in range(0, 41, 10)])
    g = sheet.faces()[0]
    region = [Vector(*g._f.closest_point((x, y, 0))[0]) for x, y in ((12, 12), (28, 12), (28, 28), (12, 28))]
    out = sheet.warp(g, region, (0, 0, 2))
    assert isinstance(out, Shell)
    lift = max(out.faces()[0].raycast((x, y, 50), (0, 0, -1))[0].point.z - 0.02 * (x - 20) ** 2
               for x in range(14, 27) for y in range(14, 27))
    assert lift == pytest.approx(2, abs=1e-3)


def test_flatten_presses_a_region_onto_a_plane():
    box = Box(60, 40, 20)
    top = _top(box)
    fl = box.flatten(top, Rectangle(20, 16).on(top), Plane.XY.offset(8))
    f = _top(fl)
    assert fl.is_valid()
    assert fl.volume == pytest.approx(47577.5, abs=1e-6)
    for x, y in ((0, 0), (-6, 0), (6, 4), (0, -4)):
        assert _z_at(f, x, y) == pytest.approx(8, abs=1e-12)
    assert _z_at(f, 25, 15) == pytest.approx(10, abs=1e-12)
    # a bumpy sheet flat over the region
    sheet = surface([[(x, y, 3 * math.sin(x / 9) * math.cos(y / 11)) for y in range(0, 61, 5)] for x in range(0, 61, 5)])
    g = sheet.faces()[0]
    region = [Vector(*g._f.closest_point((x, y, 0))[0]) for x, y in ((20, 20), (40, 20), (40, 40), (20, 40))]
    out = sheet.flatten(g, region, Plane.XY)
    h = out.faces()[0]
    for x, y in ((30, 30), (25, 25), (34, 33)):
        hits = h.raycast((x, y, 50), (0, 0, -1))
        assert hits[0].point.z == pytest.approx(0, abs=1e-9)
    assert max(h.distance_to(e.point_at(t)) for e in g.edges() for t in (0.1, 0.5, 0.9)) < 1e-9


def test_warp_and_flatten_errors():
    box = Box(60, 40, 20)
    top = _top(box)
    holed = Box(60, 40, 20) - Cylinder(4, 40).translate(10, 0, 0)
    holed_top = holed.faces().filter(lambda f: f.geom_type == "plane").sort_by(Axis.Z)[-1]
    with pytest.raises(ValueError, match="reaches an edge of the face"):
        holed.warp(holed_top, Rectangle(30, 16).translate(5, 0).on(holed_top), 3)
    with pytest.raises(ValueError, match="reaches an edge of the face"):
        holed.flatten(holed_top, Rectangle(30, 16).translate(5, 0).on(holed_top), Plane.XY.offset(8))
    assert holed.warp(holed_top, Rectangle(14, 12).translate(-5, 0).on(holed_top), 3).is_valid()
    with pytest.raises(ValueError, match="does not lie on the face"):
        box.warp(top, Rectangle(10, 10).on(Plane.XY.offset(15)), 4)
    with pytest.raises(ValueError, match="not closed"):
        box.warp(top, Line((0, 0, 10), (5, 0, 10)), 4)
    with pytest.raises(ValueError, match="continuity"):
        box.warp(top, Rectangle(10, 10).on(top), 4, continuity="G3")
    with pytest.raises(ValueError, match="nothing to flatten"):
        box.flatten(top, Rectangle(10, 10).on(top), Plane.XY.offset(10))
    with pytest.raises(TypeError, match="region"):
        box.warp(top, 5, 4)


def test_guides_of_u7_u8():
    from smlibpy.mcp import discovery

    for method, guide in (("Part.push", "surfaces/push"), ("Shell.push", "surfaces/push"), ("Part.warp", "surfaces/warp"),
                          ("Shell.warp", "surfaces/warp"), ("Part.flatten", "surfaces/flatten"),
                          ("Shell.flatten", "surfaces/flatten")):
        assert discovery.guide_for(discovery.find_method(method)).key == guide
    for query, key in (("dent in the lid", "push"), ("a bump on a face", "push"), ("raise a region of a face", "warp"),
                       ("flatten a region onto a plane", "flatten")):
        assert key in [e.key.split("/")[-1].split(".")[-1] for _, e in discovery.search(query, 6)], query
