"""Close-out of the kernel plan's fillets, chamfers, shells and offsets (area F of 0.5.0's "Not done"):
radius laws along runs of edges, the fillet executive's failed step, unequal bevels of sharp wedges,
exact circles where conical bevels meet cylinders, the fillet preview, face edits and drafts of parts
with cavities, extended rounds that keep their cylinders and cones, sheets of separate faces offset as
one, and tangent-rim shell openings next to other openings (js/test/closeout_F.test.ts is its twin)."""

import math

import pytest
from pytest import approx

from smlibpy import Box, Cone, Cylinder, ModelingError, Plane, Polygon, Rectangle, Shell, X, Z
from smlibpy._kernel import KernelError, ext

K = math.sqrt(2) - 1  # a round of radius r on a right-angled edge lies r (sqrt 2 - 1) from the edge


def _radius(part, edge, t):
    """The radius of the round of a right-angled edge of the part before, at the edge's point t."""
    return part.distance_to(edge.point_at(t)) / K


def _corner_run():
    """A 40 x 30 x 10 box with its two +x vertical edges rounded by 5, and the first line of its top run
    (line, arc, line, arc, line: open at both ends, from x = -20)."""
    b = Box(40, 30, 10)
    b = b.fillet(b.edges().parallel_to(Z).filter(lambda e: e.center().x > 0), 5)
    top = b.edges().filter(lambda e: abs(e.center().z - 5) < 1e-6)
    first = top.filter(lambda e: e.geom_type == "line" and abs(e.center().y + 15) < 1e-6)[0]
    return b, first


# -- radius laws along runs of edges (F5, F8) --------------------------------------------------------
def test_a_start_end_radius_runs_along_the_whole_run():
    b, first = _corner_run()
    run = first.tangent_chain()
    assert [e.geom_type for e in run] == ["line", "circle", "line", "circle", "line"]
    r = b.fillet(first, (1, 3))  # (0.5.0: ValueError; propagate rounds the run)
    assert r.is_valid() and r.volume == approx(11795.876320590976, rel=1e-8)
    # linear in the length along the run: 1 at its start (x = -20), 3 at its end; the first line is 35 long
    total = sum(e.length for e in run)
    assert _radius(r, first, 0.02) == approx(1 + 2 * 0.02 * 35 / total, abs=0.03)
    assert _radius(r, first, 0.5) == approx(1 + 2 * 17.5 / total, abs=0.01)
    last = run[-1]  # (the line along y = 15, which ends the run at x = -20)
    assert _radius(r, last, 0.0 if last.start.x < last.end.x else 1.0) == approx(3.0, abs=0.06)
    # the same edges given one by one take the same law
    assert b.fillet(run, (1, 3)).volume == approx(r.volume, rel=1e-12)
    assert b.fillet(first, (2, 2)).volume == approx(b.fillet(first, 2).volume, rel=1e-12)


def test_a_radius_law_through_points_along_the_run():
    b, first = _corner_run()
    r = b.fillet(first, {0: 1, 0.5: 3, 1: 1})
    assert r.is_valid() and r.volume == approx(11791.895790098008, rel=1e-8)
    assert _radius(r, first, 0.02) == approx(1.0, abs=0.05)
    middle = first.tangent_chain()[2]  # the line between the two arcs: the middle of the run
    assert _radius(r, middle, 0.5) == approx(3.0, abs=0.15)
    # a missing end takes the radius nearest it: {0.5: 3, 1: 1} starts at 3
    assert _radius(b.fillet(first, {0.5: 3, 1: 1}), first, 0.02) == approx(3.0, abs=0.05)
    # around a single closed edge (a rim): flat where it is largest and smallest
    c = Cylinder(10, 20)
    rim = c.edges().top()[0]
    rounded = c.fillet(rim, {0: 1, 0.5: 3})  # (1 missing: around the rim, the radius at 0)
    assert rounded.is_valid() and rounded.volume == approx(6225.985184875267, rel=1e-8)
    radii = [_radius(rounded, rim, t) for t in (0.0, 0.25, 0.5, 0.75, 0.999)]
    assert radii == approx([1.0, 1.998, 3.0, 1.998, 1.0], abs=0.01)


def test_radius_laws_the_kernel_cannot_build_raise():
    c = Cylinder(10, 20)
    rim = c.edges().top()[0]
    with pytest.raises(ValueError, match=r"a \(start, end\) radius cannot run around a closed edge"):
        c.fillet(rim, (1, 3))
    with pytest.raises(ValueError, match=r"the radius at position 1 is the one at 0 .*\(1 and 2\)"):
        c.fillet(rim, {0: 1, 0.5: 3, 1: 2})
    plate = Rectangle(40, 30, fillet=5).extrude(10)
    line = plate.edges().filter(lambda e: abs(e.center().z - 10) < 1e-6 and e.geom_type == "line")[0]
    with pytest.raises(ValueError, match=r"cannot run around a closed run of edges"):
        plate.fillet(line, (1, 2))
    # (around a closed run of several edges the kernel built broken rounds: 19 faces, open)
    with pytest.raises(ValueError, match=r"varies around a closed run of 8 edges .* is not possible"):
        plate.fillet(line, {0: 1, 0.5: 2})
    assert plate.fillet(line, {0: 2, 1: 2}).volume == approx(plate.fillet(line, 2).volume, rel=1e-12)
    b, first = _corner_run()
    with pytest.raises(ValueError, match="continuity needs a constant radius"):
        b.fillet(first, {0: 1, 1: 3}, continuity="G2")
    with pytest.raises(ValueError, match=r"lies from 0 \(its start\) to 1 \(its end\), not 2"):
        b.fillet(first, {0: 1, 2: 3})
    with pytest.raises(ValueError, match="the radius must be positive"):
        b.fillet(first, {0: 1, 1: 0})
    with pytest.raises(TypeError, match="maps positions along the run"):
        b.fillet(first, {"start": 1})
    # an open and a closed run, with a missing end, which they take differently
    both = Box(40, 30, 10) - Cylinder(3, 20)
    rim = both.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 4)
    edge = both.edges().filter(lambda e: e.geom_type == "line" and abs(e.center().z - 5) < 1e-6)[0]
    with pytest.raises(ValueError, match="open and closed runs of edges"):
        both.fillet(rim + [edge], {0: 1, 0.5: 2})


def test_round_edges_spreads_a_law_over_a_chain():
    from smlibpy.shapes import _law_chains, _take

    b, first = _corner_run()
    run = list(first.tangent_chain())
    chains = _law_chains(run)
    assert chains == [[0, 1, 2, 3, 4]]  # (in the direction of the first edge: from x = -20)
    h, kedges = b._with_edges(run)
    record = ext.round_edges(h.brep, kedges, [1.0], [1], law=[1.0, 3.0], chains=chains)
    assert record["status"] is None
    assert b._like(_take(h)).volume == approx(11795.876320590976, rel=1e-8)
    h, kedges = b._with_edges(run)
    with pytest.raises(ValueError, match="each edge must lie in one chain"):
        ext.round_edges(h.brep, kedges, [1.0], [1], law=[1.0, 3.0], chains=[[0, 1]])
    with pytest.raises(ValueError, match="law_at .* and law_radii"):
        ext.round_edges(h.brep, kedges, [1.0], [1], chains=chains, law_at=[0.2, 1.0], law_radii=[1.0, 2.0])


# -- the step the fillet executive failed at (F8) -----------------------------------------------------
def test_fillet_errors_say_which_step_failed():
    p = Box(30, 20, 15) + Cylinder(5.558816439731906, 20).rotate(X, 90).translate(
        5.784497984417392, 4.295773171366248, 7.767713087022971)
    h, kedges = p._with_edges(p.edges())
    record = ext.round_edges(h.brep, kedges, [0.3], [1])
    assert record["status"] == "SM_ERR" and record["stage"] == "rail_edge" and record["error"] == "edge"
    with pytest.raises(KernelError, match=r"\(unable to process rollover: a side of the round does not reach the edge "
                                          r"it should end on\); the radius may be too large"):
        p.fillet(p.edges(), 0.3)
    b = Box(10, 10, 10)
    h, kedges = b._with_edges(b.edges())
    assert ext.round_edges(h.brep, kedges, [2.0], [1])["stage"] == ""


# -- unequal bevels on sharp wedges (F9) ---------------------------------------------------------------
def test_unequal_bevels_of_sharp_wedges_are_cut_as_prisms():
    tri = Polygon((0, 0), (20, 0), (10, 10 * math.sqrt(3))).extrude(10)
    corner = tri.edges().filter(lambda e: e.center().x < 1e-6 and e.center().y < 1e-6 and abs(e.center().z - 5) < 1e-6)
    base = tri.faces().filter(lambda f: abs(f.center().y) < 1e-6)
    for s1, s2 in ((4, 1), (6, 1), (1, 4), (8, 0.5)):  # (0.5.0: ModelingError, the kernel's solver)
        bevel = tri.chamfer(corner, s1, length2=s2, reference=base)
        assert bevel.is_valid() and len(bevel.faces()) == 6
        assert tri.volume - bevel.volume == approx(0.5 * s1 * s2 * math.sin(math.pi / 3) * 10, rel=1e-9)
    # a 30 degree wedge
    wedge = Polygon((0, 0), (20, 0), (20, 20 * math.tan(math.radians(30)))).extrude(10)
    edge = wedge.edges().filter(lambda e: e.center().x < 1e-6 and abs(e.center().z - 5) < 1e-6)
    bottom = wedge.faces().filter(lambda f: abs(f.center().y) < 1e-6)
    for s1, s2 in ((5, 1), (1, 5)):
        assert wedge.volume - wedge.chamfer(edge, s1, length2=s2, reference=bottom).volume == approx(
            0.5 * s1 * s2 * 0.5 * 10, rel=1e-9)
    # with another bevelled edge at its end the prism would leave the corner: still refused
    top = tri.edges().filter(lambda e: abs(e.center().z - 10) < 1e-6 and abs(e.center().y) < 1e-6)
    with pytest.raises(ModelingError, match="could not bevel them with setbacks this different"):
        tri.chamfer(corner + top, 4, length2=1, reference=base)


# -- exact circles where conical bevels meet cylinders (F12) -------------------------------------------
def test_conical_bevels_meet_cylinders_in_circles():
    pin = Cylinder(2, 5).chamfer(Cylinder(2, 5).edges(), 1)
    assert [e.geom_type for e in pin.edges()] == ["circle"] * 4  # (0.5.0: the edges on the wall were B-splines)
    walls = [e for e in pin.edges() if e.radius == approx(2.0)]
    assert len(walls) == 2 and all(e.length == approx(4 * math.pi, rel=1e-12) for e in walls)
    assert pin.volume == approx(math.pi * 4 * 5 - 2 * 2 * math.pi * (2 - 1 / 3) / 2, rel=1e-12)
    assert pin.faces().of_type("cone") and pin.is_valid()
    c = Cylinder(10, 20)
    lead = c.chamfer(c.edges().top(), 2, length2=1, reference=c.faces().top())
    assert all(e.geom_type == "circle" for e in lead.edges()) and lead.volume == approx(6224.542244312576, rel=1e-9)
    assert ext.exact_circles(Box(10, 10, 10)._brep) is None


# -- the fillet preview (F11) --------------------------------------------------------------------------
def test_fillet_preview_shows_the_rounds_without_rounding():
    b = Box(20, 20, 20)
    sheets = b.fillet_preview(b.edges().top(), 2)
    assert len(sheets) == 4 and all(isinstance(s, Shell) for s in sheets)
    assert [s.faces()[0].geom_type for s in sheets] == ["cylinder"] * 4
    assert all(s.faces()[0].radius == approx(2.0) for s in sheets)
    assert b.volume == approx(8000.0) and len(b.faces()) == 6
    plate = Rectangle(40, 30, fillet=5).extrude(10)
    line = plate.edges().filter(lambda e: abs(e.center().z - 10) < 1e-6 and e.geom_type == "line")[0]
    assert len(plate.fillet_preview(line, 2)) == 8  # the whole run (propagate)
    assert len(plate.fillet_preview(line, 2, propagate=False)) == 1
    with pytest.raises(ValueError, match="the radius must be positive"):
        b.fillet_preview(b.edges().top(), 0)


# -- face edits and drafts of parts with cavities (O10) ------------------------------------------------
def _hollow():
    return Box(40, 30, 20) - Box(10, 10, 10)


def _cavity_top(p):
    return p.faces().filter(lambda f: abs(f.center().z - 5) < 1e-6 and abs(f.center().x) < 1e-6)


def test_face_edits_of_a_part_with_a_cavity():
    p = _hollow()
    assert p.info()["voids"] == 1
    up = p.move_faces(p.faces().top(), (0, 0, 2))  # (0.5.0: ModelingError, the kernel drops cavities)
    assert up.volume == approx(40 * 30 * 22 - 1000, rel=1e-12) and up.info()["voids"] == 1
    assert p.offset_faces(p.faces().top(), 2).volume == approx(up.volume, rel=1e-12)
    # the cavity's own faces: its top moves into the cavity (out of the material) for a positive distance
    smaller = p.offset_faces(_cavity_top(p), 1)
    assert smaller.volume == approx(24000 - 10 * 10 * 9, rel=1e-12) and smaller.info()["voids"] == 1
    assert p.move_faces(_cavity_top(p), (0, 0, 3)).volume == approx(24000 - 1300, rel=1e-12)
    # both at once, and two cavities
    two = Box(40, 30, 20) - Box(6, 6, 6).translate(-10, 0, 0) - Box(6, 6, 6).translate(10, 0, 0)
    tops = two.faces().filter(lambda f: abs(f.center().z - 3) < 1e-6)
    assert len(tops) == 2
    assert two.offset_faces(tops + two.faces().top(), 1).volume == approx(40 * 30 * 21 - 2 * 6 * 6 * 5, rel=1e-12)
    with pytest.raises(ModelingError, match="the moved faces reach a cavity of the part"):
        p.move_faces(_cavity_top(p), (0, 0, 6))


def test_draft_of_a_part_with_a_cavity():
    p = _hollow()
    plain = Box(40, 30, 20)

    def outer(q):
        return q.faces().filter(lambda f: abs(f.normal_at().z) < 1e-6 and max(abs(f.center().x), abs(f.center().y)) > 6)

    # (0.5.0: "at this angle the drafted faces change which faces of the part meet")
    drafted = p.draft(outer(p), 3, Plane.XY)
    assert drafted.volume == approx(plain.draft(outer(plain), 3, Plane.XY).volume - 1000, rel=1e-12)
    assert drafted.info()["voids"] == 1
    inner = p.faces().filter(lambda f: abs(f.normal_at().z) < 1e-6 and max(abs(f.center().x), abs(f.center().y)) < 6)
    walls = p.draft(inner, 3, Plane.XY)
    cavity = Box(10, 10, 10)
    alone = cavity.draft(cavity.faces().filter(lambda f: abs(f.normal_at().z) < 1e-6), -3, Plane.XY)
    assert walls.volume == approx(24000 - alone.volume, rel=1e-12)
    analysis = walls.draft_analysis((0, 0, 1))
    assert len(analysis.positive) == 6 and len(analysis.vertical) == 4  # (the cavity's walls widen upwards)


# -- extended rounds keep their cylinders and cones (O10) ----------------------------------------------
def test_faces_extended_by_a_face_edit_keep_their_cylinders_and_cones():
    b = Box(40, 30, 10)
    b = b.fillet(b.edges().parallel_to(Z), 3)
    taller = b.offset_faces(b.faces().top(), 5)  # (0.5.0: four surfaces of extrusion)
    assert sorted(f.geom_type for f in taller.faces()) == ["cylinder"] * 4 + ["plane"] * 6
    assert [f.radius for f in taller.faces().cylinders()] == approx([3.0] * 4)
    assert taller.volume == approx(1.5 * b.volume, rel=1e-8) and taller.is_valid()
    lower = b.move_faces(b.faces().top(), (0, 0, -3))
    assert len(lower.faces().cylinders()) == 4 and lower.volume == approx(0.7 * b.volume, rel=1e-12)
    # a cone extended past its end (0.5.0: a B-spline within 1e-7)
    hole = Box(40, 30, 10) - Cone(6, 3, 10)
    deeper = hole.offset_faces(hole.faces().top(), 2)
    assert len(deeper.faces().of_type("cone")) == 1
    assert sorted(e.radius for e in deeper.edges().circles()) == approx([2.4, 6.0])
    assert deeper.volume == approx(40 * 30 * 12 - math.pi * 12 / 3 * (36 + 6 * 2.4 + 2.4 ** 2), rel=1e-12)


# -- sheets of separate faces offset as one (O7) -------------------------------------------------------
def test_a_sheet_of_separate_faces_is_offset_as_one():
    from smlibpy import stitch

    cup = [f for f in Box(20, 20, 20).faces() if f.normal_at().z < 0.5]  # an open box: 5 faces
    pieces = Shell._wrap(ext.combine([f.to_shell()._copy_brep() for f in cup]))
    assert len(pieces.faces()) == 5 and len(pieces.edges()) == 20  # (no edge shared)
    inner = pieces.offset(-1)  # (0.5.0: ModelingError, "it built no faces")
    assert len(inner.faces()) == 5 and inner.area == approx(1692.0, rel=1e-12)
    assert inner.area == approx(stitch(*[f.to_shell() for f in cup]).offset(-1).area, rel=1e-12)


# -- shell openings with a tangent rim next to another opening (O3) ------------------------------------
def test_a_tangent_rim_opening_next_to_another_opening():
    b = Box(60, 40, 20)
    b = b.fillet(b.edges().parallel_to(Z) + b.edges().filter(lambda e: abs(e.center().z + 10) < 1e-6), 5)
    top = b.faces().planar().top()
    side = b.faces().planar().filter(lambda f: f.normal_at().x > 0.99)
    open_top = b.shell(2, top)
    both = b.shell(2, top + side)  # (0.5.0: ModelingError, the kernel left the side's rim open)
    assert both.is_valid() and len(both.faces()) == 36
    # the side's wall goes: its cavity face, 30 x 15 (it reaches the open top), 2 thick
    assert both.volume == approx(open_top.volume - 30 * 15 * 2, rel=1e-9)
    assert both._props(1e-6)["gaps"] < 1e-9
