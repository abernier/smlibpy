"""Lane U of the kernel plan (phase 1): blends between sheet edges (U2), trimming sheets with
curves on them and imprinting curves on parts (U3)."""

import math

import numpy as np
import pytest

from smlibpy import (Box, Circle, CenterArc, Cylinder, Line, ModelingError, Part, Plane, Rectangle, Shell, Z, blend,
                     extrude, stitch, surface, surface_fillet)
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
