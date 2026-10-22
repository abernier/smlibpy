"""Lane FO of the kernel plan: tangent chains in fillets and chamfers (F6), and the extended offset
mode's remaining crash on filleted boxes (O1, issue #2)."""

import math
import re
import subprocess
import sys

import pytest
from pytest import approx

from smlibpy import Box, Line, Rectangle, Slot, Z, chamfer, fillet
from smlibpy._kernel import KernelError


def _plate():
    """A 40 x 30 x 10 plate with corners rounded by 5: its top outline is one tangent run."""
    return Rectangle(40, 30, fillet=5).extrude(10)


def _at(p, z):
    return p.edges().filter(lambda e: abs(e.center().z - z) < 1e-6)


def _corner_box():
    """A box with one vertical edge (at x = 20, y = 15) rounded by 5, and the top line of 35 that
    runs into the round's arc."""
    b = Box(40, 30, 10)
    b = b.fillet(b.edges().parallel_to(Z).filter(lambda e: e.center().x > 0 and e.center().y > 0), 5)
    line = _at(b, 5).filter(lambda e: e.geom_type == "line" and abs(e.length - 35) < 1e-9).one()
    return b, line


def test_tangent_chain_selects_the_run_of_an_edge():
    p = _plate()
    top = _at(p, 10)
    long = max(top, key=lambda e: e.length)
    chain = long.tangent_chain()
    assert len(chain) == 8 and chain[0] == long
    assert {e._identity() for e in chain} == {e._identity() for e in top}
    assert len(top.filter(lambda e: e.geom_type == "line").tangent_chain()) == 8
    assert len(Box(10, 10, 10).edges().parallel_to(Z).tangent_chain()) == 4  # edges that meet at corners: no run
    assert len(p.edges().group_by(Z)[0].tangent_chain()) == 8  # the bottom outline
    assert len(p.faces().top().edges().tangent_chain()) == 8
    b, line = _corner_box()
    assert [e.geom_type for e in line.tangent_chain()] == ["line", "circle", "line"]
    assert len(Box(10, 10, 10).edges()[0].tangent_chain()) == 1
    assert len(Line((0, 0, 0), (1, 0, 0)).tangent_chain()) == 1  # an edge of no part


def test_fillet_rounds_the_tangent_run_of_a_selected_edge():
    # One top edge of a plate with rounded corners failed at any radius ("the radius may be too
    # large"); the round now follows the outline. OpenCASCADE (which always propagates):
    # 11757.497249759455 for r 1 and 11674.999251067233 for r 2.
    p = _plate()
    long = max(_at(p, 10), key=lambda e: e.length)
    one = p.fillet(long, 1)
    assert one.is_valid() and one.volume == approx(11757.497249759455, rel=1e-9) and len(one.faces()) == 18
    two = p.fillet(long, 2)
    assert two.volume == approx(11674.999251067233, rel=1e-9)
    assert two.volume == approx(p.fillet(_at(p, 10), 2).volume, rel=1e-12)
    arc = _at(p, 10).filter(lambda e: e.geom_type == "circle")[0]
    assert fillet(arc, 1).volume == approx(one.volume, rel=1e-12)
    # A run that ends at sharp corners: the line, the arc and the next line (OpenCASCADE: 14.4862927).
    b, line = _corner_box()
    assert b.volume - b.fillet(line, 1).volume == approx(14.486292690588016, rel=1e-9)


def test_fillet_without_propagate_rounds_the_selected_edges_only():
    p = _plate()
    # (the long top edge at y = 15: the two are equally long, and the kernel's order of edges can change)
    long = _at(p, 10).filter(lambda e: abs(e.length - 30) < 1e-9 and e.center().y > 0).one()
    with pytest.raises(KernelError, match=r"runs on tangentially into an edge that is not selected at "
                                          r"\(15, 15, 10\) and \(-15, 15, 10\).*propagate=True"):
        p.fillet(long, 1, propagate=False)
    with pytest.raises(KernelError, match="runs on tangentially"):
        fillet(long, 1, propagate=False)
    # Tangential at one end the kernel rounds the edge alone and runs the round on past its end.
    b, line = _corner_box()
    alone = b.fillet(line, 1, propagate=False)
    assert alone.is_valid() and (1 - math.pi / 4) * 35 < b.volume - alone.volume < 14.4862


def test_added_edges_take_the_radius_of_the_selected_edge_they_continue():
    b, line = _corner_box()
    bottom = _at(b, -5).filter(lambda e: e.geom_type == "line" and abs(e.length - 35) < 1e-9).one()
    grown = b.fillet([line, bottom], [1, 0.5])
    explicit = b.fillet(list(line.tangent_chain()) + list(bottom.tangent_chain()), [1, 1, 1, 0.5, 0.5, 0.5],
                        propagate=False)
    assert grown.is_valid() and grown.volume == approx(explicit.volume, rel=1e-12)
    with pytest.raises(ValueError, match="2 radii for 3 edges"):
        b.fillet([line, bottom, b.edges().parallel_to(Z)[0]], [1, 0.5])


def test_a_radius_law_does_not_run_along_a_tangent_run():
    p = _plate()
    long = max(_at(p, 10), key=lambda e: e.length)
    with pytest.raises(ValueError, match=r"runs on tangentially into another edge at .*propagate=False"):
        p.fillet(long, (1, 2))
    b, line = _corner_box()
    assert b.fillet(line, (0.5, 1), propagate=False).is_valid()
    assert b.fillet(line, (1, 1)).volume == approx(b.fillet(line, 1).volume, rel=1e-12)


def test_chamfer_bevels_the_tangent_run_of_a_selected_edge():
    s = Slot(40, 10).extrude(5)
    line = _at(s, 5).filter(lambda e: e.geom_type == "line")[0]
    assert len(line.tangent_chain()) == 4
    run = s.chamfer(line.tangent_chain(), 1, propagate=False)
    assert s.chamfer(line, 1).volume == approx(run.volume, rel=1e-12)
    assert chamfer(line, 1).volume == approx(run.volume, rel=1e-12) and run.is_valid()
    alone = chamfer(line, 1, propagate=False)  # the kernel bevels this one alone, and runs it on
    assert alone.is_valid() and s.volume - alone.volume < s.volume - run.volume


def test_extended_shells_of_filleted_boxes_keep_their_curves():
    # The kernel's extended offset mode (shell from its second attempt, every offset) killed the
    # process now and then on filleted boxes (issue #2: 27 of 300 runs of 8 calls for the 20 mm
    # cube, 8 and 7 of 300 for the 40 x 30 x 10 boxes): when SmBrep::MakeEdgeInFace failed after
    # it had given an intersection curve to a new Edge, SmEdgeDefinition::Imprint deleted the
    # curve, and the next Boolean of PiecewiseMerge read it. The kernel steps themselves, in
    # processes of their own (six, as about one in eight crashed before).
    code = """
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
from smlibpy._kernel import k, ext
steps = []
for size, r, t in (((20, 20, 20), 2, 1), ((40, 30, 10), 1, 0.5), ((40, 30, 10), 2, 1)):
    b = Box(*size)
    b = b.fillet(b.edges(), r)
    steps.append((b, [f._f for f in b.faces().top()], t))
for b, top, t in steps * 8:
    try:
        ext.delete_brep(k.shell_brep(b._brep, -t, extended_offset=True, faces_to_shell=top))
        print("ok", flush=True)
    except RuntimeError:
        print("failed", flush=True)
"""
    runs = [subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for _ in range(6)]
    for run in runs:
        out, _ = run.communicate(timeout=300)
        assert run.returncode == 0, f"exit {run.returncode} after {len(out.split())} steps"
        assert len(out.split()) == 24


@pytest.mark.parametrize("key", ["selection/tangent_chain", "features/fillet", "features/chamfer"])
def test_tangent_chain_guides_run_and_are_found(key, capsys):
    import re

    from smlibpy.mcp import discovery

    guide = discovery.guide(key)
    assert guide is not None
    ns: dict = {}
    exec("from smlibpy import *\nimport math\nimport numpy as np", ns)
    for i, code in enumerate(re.findall(r"```python\n(.*?)```", guide.text, re.S)):
        exec(compile(code, f"{key}[{i + 1}]", "exec"), ns)
    if key == "selection/tangent_chain":
        assert capsys.readouterr().out.split("\n")[:3] == ["8 ['line', 'circle', 'circle']", "4", "11757.4972"]
        for name in ("Edge.tangent_chain", "ShapeList.tangent_chain"):
            assert discovery.guide_for(discovery.find_method(name)).key == "selection/tangent_chain"


# -- batch 2: shell openings with tangent rims (O3), sheet offsets (O7), the fillet executive's
# record of a failure (F8), unequal chamfers (F9), SM_API's global merge (F7) ------------------


def _rounded_box(size=(60, 40, 20), r=5):
    from smlibpy import Box

    b = Box(*size)
    return b.fillet(b.edges(), r)


def test_shell_cuts_openings_whose_rim_is_tangent_out_of_the_closed_shell():
    # The kernel left the rim of such an opening open (inner rounds up to the outer edge, edges 2 mm
    # off their faces: gaps 0.27), which 0.5.0 refused; the shell guide's own example.
    from smlibpy import Cylinder, Y

    b = _rounded_box()
    closed = b.shell(2)
    tray = b.shell(2, b.faces().planar().top())
    assert tray.is_valid() and tray._props(1e-6)["gaps"] < 1e-9
    assert tray.volume == approx(11134.3949, abs=1e-3)
    assert tray.volume == approx(closed.volume - 50 * 30 * 2, rel=1e-8)
    side = b.shell(2, b.faces().planar().filter(lambda f: f.normal_at().x > 0.99))
    assert side.volume == approx(closed.volume - 30 * 10 * 2, rel=1e-8)  # (the kernel's own: 14134.39)
    both = b.shell(2, b.faces().planar().top() + b.faces().planar().bottom())
    assert both.volume == approx(closed.volume - 2 * 50 * 30 * 2, rel=1e-8)
    outward = b.shell(2, b.faces().planar().top(), outward=True)
    assert outward.volume == approx(b.shell(2, outward=True).volume - 50 * 30 * 2, rel=1e-8)
    # the lid over the opening is gone; the outer rounds end tangentially above the rim (z 12)
    assert outward.classify((0, 0, 11))[0] == "outside" and outward.bbox().max.z == approx(12.0, abs=1e-6)
    # the walls end tangentially at the rim: a point just inside the rim, below it, is in the cavity
    assert tray.classify((24.9, 0, 9.9))[0] == "outside" and tray.classify((25.4, 0, 9.0))[0] == "inside"
    cup = Cylinder(20, 30)
    cup = cup.fillet(cup.edges(), 3)
    assert cup.shell(1, cup.faces().planar().top()).volume == approx(4766.9544, abs=1e-3)  # the kernel raised
    for r, t, expected in ((1, 0.5, 1238.0236), (2, 0.5, 1233.2227), (3, 1, 2333.4807)):  # issue #2's boxes
        box = _rounded_box((40, 30, 10), r)
        assert box.shell(t, box.faces().planar().top()).volume == approx(expected, abs=1e-3)
    # a rim tangent on two sides and meeting straight walls on the others: the cavity's face under the
    # opening ends at the inner walls (34 x 28)
    m = Box(40, 30, 10)
    m = m.fillet(m.edges().top().parallel_to(Y), 3)
    assert m.shell(1, m.faces().planar().top()).volume == approx(m.shell(1).volume - 34 * 28 * 1, rel=1e-8)


def test_shell_leaves_other_openings_to_the_kernel():
    from smlibpy import Box, Z

    b = _rounded_box()
    top = b.faces().planar().top()
    assert b._openings_to_cut([f._f for f in top], 2.0, False) == [top[0]._f]
    # an opening next to another one, a curved opening, and none with a tangent rim: the kernel's
    rim = [g for e in top.one().edges() for g in e.faces() if g != top.one()]
    assert len(rim) == 4 and b._openings_to_cut([f._f for f in top + rim[:1]], 2.0, False) == []
    assert b._openings_to_cut([rim[0]._f], 2.0, False) == []
    v = Box(40, 30, 10)
    v = v.fillet(v.edges().parallel_to(Z), 4)
    assert v._openings_to_cut([f._f for f in v.faces().top()], 1.0, False) == []
    assert v.shell(1, v.faces().top()).volume == approx(2356.1858, abs=1e-3)  # the kernel's, as before
    # outward walls: only where the whole rim is tangent (a straight wall would keep a lip)
    from smlibpy import Y

    m = Box(40, 30, 10)
    m = m.fillet(m.edges().top().parallel_to(Y), 3)
    assert m._openings_to_cut([f._f for f in m.faces().planar().top()], 1.0, True) == []


def test_sheets_and_faces_offset_along_their_normals():
    from smlibpy import CenterArc, Cylinder, Shell, extrude, offset, stitch, thicken
    from smlibpy._kernel import ModelingError

    half = extrude(CenterArc((0, 0), 10, 0, 180), 20)  # normals away from the axis
    out, inner = half.offset(2), half.offset(-2)
    assert isinstance(out, Shell) and len(out.faces()) == 1
    assert out.area == approx(math.pi * 12 * 20, rel=1e-9) and inner.area == approx(math.pi * 8 * 20, rel=1e-9)
    from smlibpy.shapes import _face_samples

    for q in _face_samples(out.faces()[0]):
        assert half.distance_to(q) == approx(2.0, abs=1e-9)
    assert half.offset(0).area == approx(half.area, rel=1e-12)
    cup = stitch([f for f in Box(20, 20, 20).faces() if f.normal_at().z < 0.5])  # an open box
    assert cup.offset(-1).area == approx(18 * 18 + 4 * 18 * 19, rel=1e-9)
    grown = offset(cup, 1)
    assert grown.area == approx(22 * 22 + 4 * 22 * 21, rel=1e-9)
    assert sum(1 for e in grown.edges() if len(e.faces()) == 1) == 4  # sewn: only the rim is free
    lid = Box(20, 20, 20).faces().top().one().offset(5)
    assert lid.area == approx(400.0) and lid.bbox().min.z == approx(15.0) and lid.bbox().max.z == approx(15.0)
    side = Cylinder(5, 10).faces().filter(lambda f: f.geom_type == "cylinder").one()
    assert side.offset(-1).area == approx(2 * math.pi * 4 * 10, rel=1e-9)
    with pytest.raises(ModelingError, match="no faces"):
        half.offset(-12)  # beyond the radius: nothing left
    with pytest.raises(ModelingError, match="lies nowhere at 50"):
        from smlibpy import surface

        surface([[(x, y, 3 * math.sin(x / 10)) for x in (0, 10, 20, 30)] for y in (0, 10, 20, 30)]).offset(50)
    with pytest.raises(KernelError, match="cannot offset this sheet"):
        side.offset(-6)
    with pytest.raises(TypeError, match="offset takes a part, a sketch, a sheet"):
        offset(Line((0, 0, 0), (1, 0, 0)), 1)
    # thicken(..., both=True), the function too
    assert thicken(half, 2, both=True).volume == approx(math.pi * (11 ** 2 - 9 ** 2) / 2 * 20, rel=1e-6)


def test_round_edges_drives_the_executive_as_sm_api_does():
    # ext.round_edges replaces k.fillet_edges, fillet_edges_per_edge and variable_radius_fillet in
    # fillet() and chamfer(): the same results, bit for bit.
    from smlibpy import Cylinder
    from smlibpy._kernel import ext, k
    from smlibpy.shapes import _take

    p = Box(40, 30, 20) - Cylinder(5, 40)
    sel = p._sharp_edges(p.edges(), "x")
    cases = [
        (lambda b, e: k.fillet_edges(b, e, radius=2.0), lambda b, e: ext.round_edges(b, e, [2.0], [1])),
        (lambda b, e: k.fillet_edges(b, e, radius=1.0, xsect_type=0), lambda b, e: ext.round_edges(b, e, [1.0], [0])),
        (lambda b, e: k.fillet_edges(b, e, radius=1.0, xsect_type=2, continuity=2, thumbweight=1.2),
         lambda b, e: ext.round_edges(b, e, [1.0], [2], continuity=2, thumbweight=1.2)),
        (lambda b, e: k.fillet_edges_per_edge(b, e, [1 + 0.1 * (i % 3) for i in range(len(e))],
                                              [k.FilletXSect.CIRCULAR] * len(e)),
         lambda b, e: ext.round_edges(b, e, [1 + 0.1 * (i % 3) for i in range(len(e))], [1] * len(e))),
        (lambda b, e: k.variable_radius_fillet(b, e[:1], start_radius=1.0, end_radius=2.0),
         lambda b, e: ext.round_edges(b, e[:1], [1.0], [1], law=[1.0, 2.0])),
    ]
    for old, new in cases:
        results = []
        for fn in (old, new):
            h, kedges = p._with_edges(sel)
            out = fn(h.brep, kedges)
            assert not isinstance(out, dict) or out["status"] is None
            q = p._like(_take(h))
            results.append((len(q.faces()), q._props(1e-9)["volume"]))
        assert results[0] == results[1]


def test_fillet_errors_name_the_corner_the_kernel_could_not_build():
    from smlibpy import Cone, Cylinder, Polygon, Plane, X
    from smlibpy._kernel import ext

    # SM_API kept the executive's record to itself; every failure said "the radius may be too large"
    boss = Box(30, 30, 10) + Cylinder(5, 20).translate(10, 10, 0)  # the boss touches the side x = 15
    with pytest.raises(KernelError, match=r"cannot round the selection as given, at any size: it could not build "
                                          r"the corner at \(15, 10, 5\) \(it has no corner for the way the rounded "
                                          r"edges meet there\); select fewer edges there") as e:
        boss.fillet(boss.edges(), 2)
    assert e.value.status == "SM_ERR_INVALID_INPUT"
    cut = Box(10, 5, 20) - Cone(4, 5, 20)
    halves = cut.edges().filter(lambda e: abs(e.center().x - 5) < 1e-6 and abs(e.center().z - 10) < 1e-6)
    with pytest.raises(KernelError, match=r"the corner at \(5, 0, 10\)"):
        cut.fillet(halves, 0.1)
    pipe = Box(30, 20, 15) + Cylinder(3.97, 20).rotate(X, 90).translate(0.36, 5.82, 7.05)
    with pytest.raises(KernelError, match=r"\(SM_ERR\): the kernel could not build the corner at \((.*)\) \(.*\); the "
                                          r"radius may be too large for the selected edges") as e:
        pipe.fillet(pipe.edges(), 0.5)
    at = [float(c) for c in re.search(r"corner at \(([^)]*)\)", str(e.value)).group(1).split(",")]
    assert min(v.point.distance_to(at) for v in pipe.vertices()) < 1e-4  # a vertex of the part
    # the record itself: the corner of a stepped block where a 1.5 round does not fit
    blk = Polygon((0, 0), (40, 0), (40, 10), (30, 10), (30, 11), (0, 11)).on(Plane.front).extrude(20)
    edge = blk.edges().filter(lambda e: abs(e.center().x - 30) < 1e-6 and abs(e.center().z - 11) < 1e-6)
    h, kedges = blk._with_edges(edge)
    record = ext.round_edges(h.brep, kedges, [1.5], [1])
    assert record["status"] == "SM_ERR" and record["error"] == "corner" and record["corner"] == "Nx1"
    assert record["vertex"] == approx((30.0, 0.0, 11.0)) and record["edge"] == -1
    assert "Corner Edge Computation Failure" in record["comment"]


def test_chamfers_with_two_lengths_or_an_angle():
    from smlibpy import Cylinder, Polygon
    from smlibpy._kernel import ModelingError

    box = Box(40, 30, 20)
    top = box.faces().top()
    # OpenCASCADE's BRepFilletAPI_MakeChamfer.Add(2, 1, edge, top) on the four edges: 23865.333333333332
    lead = box.chamfer(top.edges(), 2, length2=1, reference=top)
    assert lead.is_valid() and lead.volume == approx(23865.333333333332, rel=1e-12)
    # the prismatoid it leaves: 2 in on the top, 1 down the sides
    w, d, a, h = 40, 30, 2, 1
    prismatoid = h / 6 * (w * d + (w - 2 * a) * (d - 2 * a) + 4 * (w - a) * (d - a))
    assert box.volume - lead.volume == approx(w * d * h - prismatoid)
    assert lead.bbox().max.z == approx(10.0) and lead.faces().top().one().area == approx(36 * 26)
    swapped = box.chamfer(top.edges(), 1, length2=2, reference=box.faces().filter(lambda f: abs(f.normal_at().z) < 0.5))
    assert swapped.volume == approx(lead.volume, rel=1e-12)
    # an angle to the reference face (OpenCASCADE with 2 and 2 tan 30: 23844.500327498256)
    assert box.chamfer(top.edges(), 2, angle=30, reference=top).volume == approx(23844.500327498256, rel=1e-12)
    one = box.edges().top()[0]
    steep = box.chamfer(one, 2, angle=60, reference=top)
    assert box.volume - steep.volume == approx(0.5 * 2 * 2 * math.sqrt(3) * one.length)
    assert box.chamfer(one, 2, length2=2, reference=top).volume == box.chamfer(one, 2).volume  # equal lengths
    # a round edge: a cylinder's rim (OpenCASCADE 6224.542244312576 and 6222.447849210183); the
    # bevel is a fitted B-spline, as equal ones are
    c = Cylinder(10, 20)
    for a, b, occ in ((2, 1, 6224.542244312576), (1, 2, 6222.447849210183)):
        assert c.chamfer(c.edges().top(), a, length2=b, reference=c.faces().top()).volume == approx(occ, rel=2e-6)
    # a 60-degree edge of a triangular prism: the triangle 3 x 1 at 60 degrees comes off
    tri = Polygon((0, 0), (20, 0), (10, 10 * math.sqrt(3))).extrude(10)
    corner = tri.edges().filter(lambda e: e.center().x < 1e-6 and e.center().y < 1e-6 and abs(e.center().z - 5) < 1e-6)
    base = tri.faces().filter(lambda f: abs(f.center().y) < 1e-6)
    for s1 in (1.5, 3):  # (3: setbacks less alike than cos 60, the kernel offsets the base backwards)
        assert tri.volume - tri.chamfer(corner, s1, length2=1, reference=base).volume == approx(
            0.5 * s1 * 1 * math.sin(math.pi / 3) * 10)
    with pytest.raises(ModelingError, match=r"meet at 60 degrees, and the kernel could not bevel them with setbacks "
                                             r"this different \(4 and 1\); bring them closer \(each at least 0.5 times "
                                             r"the other always works\)"):
        tri.chamfer(corner, 4, length2=1, reference=base)
    with pytest.raises(ValueError, match="length2 and angle need reference="):
        box.chamfer(one, 2, length2=1)
    with pytest.raises(ValueError, match="does not lie on a reference face"):
        box.chamfer(one, 2, length2=1, reference=box.faces().bottom())
    with pytest.raises(ValueError, match="give length2 or angle, not both"):
        box.chamfer(one, 2, length2=1, angle=30, reference=top)
    with pytest.raises(ValueError, match="use an angle below 90"):
        box.chamfer(one, 2, angle=130, reference=top)
    with pytest.raises(ValueError, match="length2 must be positive"):
        box.chamfer(one, 2, length2=0, reference=top)
    assert chamfer(one, 2, length2=1, reference=top).volume == approx(box.volume - 0.5 * 2 * 1 * one.length)


def test_sm_api_global_merge_stays_off():
    # F7: SM_API asks for the executive's global merge before SetFilletParameters, which turns it off.
    # Moving the request after it (measured as a kernel patch) changed no near-limit cube and made these
    # chamfers and G2 rounds of a box with a hole open bodies, so neither SM_API nor round_edges asks for it.
    from smlibpy import Cylinder

    p = Box(40, 30, 20) - Cylinder(5, 40)
    # (the kernel bevels the box's edges; the hole's rims are exact cones since F12: 22221.0369 before)
    assert p.chamfer(p.edges(), 1).volume == approx(22221.026685, abs=1e-5)
    assert p.fillet(p.edges(), 1, continuity="G2").volume == approx(22372.0102, abs=1e-3)


def test_fillets_that_crashed_the_kernel_raise():
    # Two null reads in the kernel's fillet code killed the process (also before 0.5.0): a boundary
    # curve that SmFilletGeom::MakeFaceBrep asked whether it was degenerate, and the side face of a
    # cliff rollover that SmFilletSolver::ProcessRollOver had not found. Both now fail the round, and
    # the error names the edge. In a process of their own, so that a crash fails only this test.
    code = """
from smlibpy import *
from smlibpy._kernel import KernelError
pipe = Box(30, 20, 15) + Cylinder(5.023133573190586, 20).rotate(X, 90).translate(
    8.998079542446177, 6.843028407324283, 3.2764943433527796)
cone = Box(30, 20, 15) + Cone(3.779342744550086, 0.8306021355423117, 12).translate(
    9.446745793730727, -7.9149898040942706, 6.188749624221394)
for make in (lambda: pipe.chamfer(pipe.edges(), 0.25), lambda: cone.fillet(cone.edges(), 0.5)):
    try:
        make()
        print("built")
    except KernelError as e:
        print(e.status, str(e))
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr[-2000:]
    lines = run.stdout.splitlines()
    assert lines[0].startswith("SM_ERR chamfer failed (SM_ERR): the kernel could not build the round of the edge from "
                               "(11.7172, -3.15697, 7.5) to (6.27891, -3.15697, 7.5)")
    assert lines[1].startswith("SM_ERR fillet failed (SM_ERR): the kernel could not build the round of the edge from "
                               "(-15, -10, 7.5) to (15, -10, 7.5)")


def test_rounds_close_to_the_limit_are_tried_with_a_finer_tolerance():
    # F7: SM_API builds the rounds' edges within 4 times the edge tolerance; close to the largest radius
    # that fits they came out open. fillet() and chamfer() try again within 1 times it, as the kernel's
    # own all-edge fillet does (and SM_API's global merge, which the plan suspected, made no difference).
    from smlibpy._kernel import ext
    from smlibpy.shapes import _take

    def rounded_cube(s, r):
        a = s - 2 * r
        return a ** 3 + 6 * a * a * r + 3 * math.pi * a * r * r + 4 / 3 * math.pi * r ** 3

    for s, r in ((10, 4.98), (20, 9.97), (40, 19.96)):
        b = Box(s, s, s)
        records = []
        for factor in (4.0, 1.0):
            h, kedges = b._with_edges(b.edges())
            records.append((ext.round_edges(h.brep, kedges, [r], [1], tolerance_factor=factor)["status"],
                            b._like(_take(h))))
        assert not records[0][1].is_valid()  # SM_API's: an open body
        assert records[1][0] is None and records[1][1].is_valid()
        assert records[1][1].volume == approx(rounded_cube(s, r), rel=1e-9)
        assert b.fillet(b.edges(), r).volume == approx(rounded_cube(s, r), rel=1e-9)
    from smlibpy._kernel import ModelingError

    # still refused (the first attempt's error; how depends on the build: a wrong body, or one the
    # volume check refuses)
    with pytest.raises(ModelingError, match="too close to the largest|too large"):
        Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 4.99)
    with pytest.raises(ValueError, match="tolerance factor must be positive"):
        b = Box(10, 10, 10)
        h, kedges = b._with_edges(b.edges())
        ext.round_edges(h.brep, kedges, [1.0], [1], tolerance_factor=0)


# -- batch 3: offsets of acute parts (O8) and rounded offsets (O9), mitred corners (F10), exact conical
# chamfers (F12) ---------------------------------------------------------------------------------------
def test_sharp_offsets_of_acute_edges_are_kept(monkeypatch):
    # O8: an edge whose faces meet at an angle a moves out by d / sin(a / 2) > d, which offset refused as
    # reaching out of the part's box grown by d. The bound is now the first-order reach of the part's
    # edges and corners (only asked for where a result reaches beyond d).
    from smlibpy import Cone, Cylinder, ModelingError, Polygon, offset
    import smlibpy.defeature
    import smlibpy.shapes

    cone = Cone(5, 2, 10).offset(1)  # (0.5.0: ModelingError)
    a = 3.5 + math.sqrt(1.09)  # the offset side runs at radius a - 0.3 z, from z = -6 to 6
    assert cone.is_valid() and cone.volume == approx(math.pi * (12 * a * a + 144 * 0.09), rel=1e-6)
    assert cone.bbox().max.x == approx(5.3 + math.sqrt(1.09), rel=1e-9)  # 6.344, beyond 5 + 1
    taper = Rectangle(20, 20).extrude(10, taper=10).offset(1)
    t, w = math.tan(math.radians(10)), 10 + 1 / math.cos(math.radians(10))
    assert taper.volume == approx(4 / (3 * t) * ((w + t) ** 3 - (w - 11 * t) ** 3), rel=1e-9)
    assert taper.bbox().max.x == approx(w + t, rel=1e-9)
    assert Box(10, 10, 10)._sharp_offset_reach() == approx(math.sqrt(3), rel=1e-12)
    # the kernel's sharp mode fails on an acute wedge: the error points to the rounded mode
    wedge = Polygon((0, 0), (20, 0), (0, 8)).extrude(5)
    with pytest.raises(KernelError, match='corners="round"'):
        wedge.offset(1)
    # a result that reaches farther than the part's edges and corners can move is still refused
    real = smlibpy.shapes.k.offset_brep
    monkeypatch.setattr(smlibpy.defeature, "GUARD_SECONDS", 0)  # (in this process)
    monkeypatch.setattr(smlibpy.shapes.k, "offset_brep", lambda brep, d, **kw: real(brep, 3 * d, **kw))
    with pytest.raises(ModelingError, match="reaches out of the box it must fit in"):
        Box(10, 10, 10).offset(1)
    monkeypatch.undo()
    with pytest.raises(ValueError, match='corners must be "sharp" or "round"'):
        offset(Cylinder(5, 10), 1, corners="chamfer")


def test_rounded_offsets_roll_a_ball_along_the_part():
    # O9: corners="round" (the kernel's offset without its extended mode): cylinders and spheres where
    # faces grow apart; every point at the distance from the part (Steiner's formula for convex parts).
    from smlibpy import Cylinder, Polygon, offset

    cube = Box(10, 10, 10)
    grown = cube.offset(2, corners="round")
    assert grown.volume == approx(1000 + 600 * 2 + 30 * math.pi * 4 + 4 / 3 * math.pi * 8, rel=1e-9)
    assert {f.geom_type for f in grown.faces()} == {"plane", "cylinder", "sphere"} and len(grown.faces()) == 26
    assert cube.offset(2).volume == approx(14 ** 3)  # (the default stays sharp)
    assert cube.offset(-2, corners="round").volume == approx(6 ** 3)  # convex edges stay sharp inward
    # a wedge (the sharp mode fails): 400 + area 407.7033 + edges 93.5264 + ball 4.1888
    wedge = Polygon((0, 0), (20, 0), (0, 8)).extrude(5)
    hyp = math.hypot(20, 8)
    steiner = 400 + (160 + 5 * (28 + hyp)) + (5 * math.pi + (28 + hyp) * math.pi / 2) + 4 / 3 * math.pi
    assert offset(wedge, 1, corners="round").volume == approx(steiner, rel=1e-6)
    # a hole that closes (the sharp mode fails): the rounded box less a dimple over each end of the hole
    holed = (Box(20, 20, 10) - Cylinder(3, 20)).offset(4, corners="round")
    assert holed.is_valid() and holed.volume == approx(13170.0401, rel=1e-8)
    # shrinking rounds the concave edges (OpenCASCADE's arc join: 2097.197642; sharp: 2092)
    notched = Box(20, 20, 10) - Box(10, 10, 10).translate(5, 5, 5)
    assert notched.offset(-1, corners="round").volume == approx(2097.197642, rel=1e-8)
    assert notched.offset(-1).volume == approx(2092)


def test_mitred_corners():
    # F10: corners="mitre" runs the rounds of three convex edges on until they meet (no corner patch)
    from smlibpy import RegularPolygon
    from smlibpy._kernel import ext
    from smlibpy.shapes import _take

    cube = Box(20, 20, 20)
    patched, mitred = cube.fillet(cube.edges(), 2), cube.fillet(cube.edges(), 2, corners="mitre")
    assert patched.volume == approx(7804.6961, rel=1e-8) and len(patched.faces()) == 26
    # the cube less the union of its edges' round prisms (integrated: 7808.676122)
    assert mitred.is_valid() and mitred.volume == approx(7808.676122, rel=1e-8) and len(mitred.faces()) == 18
    assert cube.fillet(cube.edges(), 2, continuity="G2", corners="mitre").is_valid()
    # chamfers too: the three bevel planes meet in a point (8000 less 8 x 54 at the corners, 12 x 40 along)
    assert cube.chamfer(cube.edges(), 2, corners="mitre").volume == approx(7568.0, rel=1e-12)
    assert chamfer(cube.edges(), 2).volume == approx(7562.666667, rel=1e-9)
    h, kedges = cube._with_edges(cube.edges())
    assert ext.round_edges(h.brep, kedges, [2.0], [1], mitre=True)["mitred"] == 8
    _take(h)
    notched = Box(20, 20, 10) - Box(10, 10, 10).translate(5, 5, 5)
    h, kedges = notched._with_edges(notched.edges())
    assert ext.round_edges(h.brep, kedges, [1.0], [1], mitre=True)["mitred"] == 11  # (not the 3 with a concave edge)
    assert notched._like(_take(h)).is_valid()
    hexagon = RegularPolygon(10, 6).extrude(5)
    assert len(hexagon.fillet(hexagon.edges(), 1, corners="mitre").faces()) == 26
    # where no corner takes a mitre, and for other styles
    with pytest.raises(ValueError, match="the selection has none"):
        cube.fillet(cube.edges().filter(lambda e: e.center().z > 9), 2, corners="mitre")
    with pytest.raises(ValueError, match='corners must be "patch" or "mitre"'):
        cube.fillet(cube.edges(), 2, corners="round")


def test_chamfers_of_circular_edges_are_exact_cones():
    # F12: the kernel fitted the bevel of a circular edge with a B-spline (volumes off by up to 1.2e-5);
    # between faces coaxial with the edge, smlibpy cuts it with a solid of revolution: exact.
    from smlibpy import Cone, Cylinder, PolarLocations, Polygon, Plane

    def bevelled(r, h, s):
        return math.pi * r * r * h - 2 * 2 * math.pi * (r - s / 3) * s * s / 2

    for r, h, s in ((2, 5, 1.94), (2, 5, 1.0), (10, 20, 1), (10, 20, 5), (1, 2, 0.3)):
        pin = Cylinder(r, h)
        result = pin.chamfer(pin.edges().filter(lambda e: e.is_closed), s)
        assert result.volume == approx(bevelled(r, h, s), rel=1e-12)  # (0.5.0: 1.1e-5 off at r 2)
        assert "bspline" not in {f.geom_type for f in result.faces()} and result.is_valid()
    holed = Box(20, 20, 10) - Cylinder(3, 20)
    rim = holed.edges().filter(lambda e: e.is_closed and e.center().z > 4)
    assert holed.chamfer(rim, 1).volume == approx(holed.volume - 2 * math.pi * (3 + 1 / 3) * 0.5, rel=1e-12)
    # a concave rim (a boss on a plate): the bevel fills in
    boss = Box(30, 30, 5) + Cylinder(5, 10).translate(0, 0, 7.5)
    base = boss.edges().filter(lambda e: e.is_closed and abs(e.center().z - 2.5) < 1e-6)
    assert boss.chamfer(base, 1).volume == approx(boss.volume + 2 * math.pi * (5 + 1 / 3) * 0.5, rel=1e-12)
    # unequal setbacks: 2 on the top face, 1 down the side (OpenCASCADE: 6224.542)
    pin = Cylinder(10, 20)
    top = pin.edges().filter(lambda e: e.is_closed and e.center().z > 0)
    unequal = pin.chamfer(top, 2, length2=1, reference=pin.faces().top())
    assert unequal.volume == approx(math.pi * 100 * 20 - 2 * math.pi * 28 / 3 * 1, rel=1e-12)
    # faces of a revolve (surfaces of revolution with straight meridians): the flange example's neck
    section = Polygon((25, 0), (60, 0), (60, 12), (35, 12), (35, 40), (25, 40))
    neck = section.on(Plane.front).revolve(Z)
    neck -= PolarLocations(47.5, 8) * Cylinder(5, 30)
    ends = neck.faces().top().edges().circles()
    assert neck.chamfer(ends, 1).volume == approx(neck.volume - math.pi * 60, rel=1e-12)
    # a cone's rims, and a selection with other edges (the kernel bevels those)
    frustum = Cone(5, 2, 10)
    assert frustum.chamfer(frustum.edges(), 0.5).is_valid()
    both = holed.chamfer(holed.edges(), 0.5)
    rings = 2 * 2 * math.pi * (3 + 1 / 6) * 0.125
    assert both.volume == approx(holed.chamfer(holed.edges().lines(), 0.5).volume - rings, rel=1e-12)
    # where the bevel's tool would take other material (a disc just below the rim), the kernel bevels
    # the edge as before
    disc = Cylinder(10, 10) + Cylinder(12, 0.5).translate(0, 0, 4.05)
    edge = disc.edges().filter(lambda e: e.is_closed and e.center().z > 4.9)
    kernel = disc.chamfer(edge, 0.6)
    assert "bspline" in {f.geom_type for f in kernel.faces()}
    assert kernel.volume == approx(disc.volume - 2 * math.pi * (10 - 0.2) * 0.18, rel=1e-6)
