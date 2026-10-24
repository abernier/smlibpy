"""Close-out of the 0.5.0 kernel plan, the verification of the merged close-out (V): what it found wrong.

- STEP's ``OFFSET_CURVE_3D`` offsets along its reference direction x the curve's tangent (ISO 10303-42,
  as OpenCASCADE reads it); the reader went the other way (IGES's offset curve, 130, goes along the
  tangent x the normal, and stays so).
- A profile swept round a loop closed with a kink: the fused halves pass the kernel's strict check (a
  vertex lay 1.1e-5 from its edge, whose tolerance was 5e-6), and their STEP and .brep files read into
  OpenCASCADE as valid solids (a loop that passes a vertex twice is written as the loops between, and the
  readers join such loops again, as the kernel has them; the .brep writer leaves out an edge that a loop
  runs along and straight back).
- The printed numbers of docs/kernel.md, the trim and the loft references.
- The helix test of SmPyLib's oracle runs against the smlibpy it imported (an installed wheel too).
"""

import ast
import math
import re
import warnings
from pathlib import Path

import pytest
from pytest import approx

from smlibpy import *
from smlibpy._kernel import KernelError
from smlibpy.step import _simple_loops
from smlibpy.step_import import _joined_loops

ROOT = Path(__file__).resolve().parent.parent


# -- STEP's OFFSET_CURVE_3D ------------------------------------------------------------------------------
def _with(text: str, lines: list[str]) -> str:
    return text.replace("ENDSEC;\nEND-ISO", "".join(f"{x}\n" for x in lines) + "ENDSEC;\nEND-ISO", 1)


def _offset_files() -> dict[str, str]:
    """Cylinder(5, 10) with its top circle or its seam given as an offset curve in the sense of ISO
    10303-42 (OpenCASCADE reads each as that cylinder, 785.398163, valid)."""
    text = to_step(Cylinder(5, 10))
    top, place = re.findall(r"#(\d+)=CIRCLE\('',#(\d+),5\.0\);", text)[-1]
    z = re.search(rf"#{place}=AXIS2_PLACEMENT_3D\('',#\d+,#(\d+),#\d+\);", text).group(1)
    seam, vector = re.search(r"#(\d+)=LINE\('',#\d+,#(\d+)\);", text).groups()
    n = max(int(x) for x in re.findall(r"#(\d+)=", text)) + 1
    circle = rf"#{top}=CIRCLE\('',(#\d+),5\.0\);"
    w = math.sqrt(0.5)
    corners = [(7, 0), (7, 7), (0, 7), (-7, 7), (-7, 0), (-7, -7), (0, -7), (7, -7), (7, 0)]
    poles = [f"#{n + i}=CARTESIAN_POINT('',({x}.,{y}.,5.));" for i, (x, y) in enumerate(corners)]
    refs = ",".join(f"#{n + i}" for i in range(9))
    spline = (f"#{n + 9}=(BOUNDED_CURVE() B_SPLINE_CURVE(2,({refs}),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS("
              f"(3,2,2,2,3),(0.,1.,2.,3.,4.),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() "
              f"RATIONAL_B_SPLINE_CURVE((1.,{w},1.,{w},1.,{w},1.,{w},1.)) REPRESENTATION_ITEM(''));")
    offset = "#{0}=OFFSET_CURVE_3D('',#{1},{2},.F.,#{3});"
    r7, r3 = rf"#{n}=CIRCLE('',\1,7.0);\n", rf"#{n}=CIRCLE('',\1,3.0);\n"
    line = rf"#{seam}=LINE\('',#\d+,#\d+\);"
    return {
        # the axis (+Z) x the tangent of a counterclockwise circle points into it: radius 7 - 2
        "circle r 7 by 2 about +Z": re.sub(circle, r7 + offset.format(top, n, "2.0", z), text),
        "circle r 3 by -2 about +Z": re.sub(circle, r3 + offset.format(top, n, "-2.0", z), text),
        "circle r 3 by 2 about -Z": _with(re.sub(circle, r3 + offset.format(top, n, "2.0", n + 1), text),
                                          [f"#{n + 1}=DIRECTION('',(0.,0.,-1.));"]),
        "B-spline circle r 7 by 2 about +Z": _with(re.sub(circle, offset.format(top, n + 9, "2.0", z), text),
                                                   poles + [spline]),
        # the seam (x = 5, up along +Z) as the line x = 3 moved by 2 along +Y x +Z = +X
        "line x = 3 by 2 about +Y": _with(re.sub(line, offset.format(seam, n + 2, "2.0", n + 1), text),
                                          [f"#{n}=CARTESIAN_POINT('',(3.,0.,-5.));",
                                           f"#{n + 1}=DIRECTION('',(0.,1.,0.));",
                                           f"#{n + 2}=LINE('',#{n},#{vector});"]),
    }


@pytest.mark.parametrize("name", list(_offset_files()))
def test_step_offset_curves_run_along_the_reference_direction_x_the_tangent(name):
    # The close-out read them along the tangent x the reference direction: the circle of radius 7 by 2 as
    # one of radius 9, an invalid body of 961.328 with a warning only about its mass properties
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        part = from_step(_offset_files()[name])
    assert part.is_valid() and part.volume == approx(math.pi * 25 * 10, rel=1e-8)
    box = part.bbox()
    assert (box.min.x, box.max.x, box.min.y, box.max.y) == approx((-5, 5, -5, 5), abs=1e-6)


def test_step_offset_curves_in_a_model():
    text = _offset_files()["circle r 7 by 2 about +Z"]
    assert from_step_model(text).bodies[0].volume == approx(math.pi * 250, rel=1e-9)


# -- sweeps round loops closed with a kink ----------------------------------------------------------------
def _loop(ry: float, wobble: float = 0.0) -> Spline:
    pts = [(20 * math.cos(a), ry * math.sin(a), 6 * math.sin(2 * a) + wobble * math.cos(a))
           for a in (i * 2 * math.pi / 8 for i in range(8))]
    return Spline(*pts, pts[0])


# two of 60 random kinked loops: 44, whose STEP and .brep files of a rectangle OpenCASCADE took for invalid
# (a face of 173.57 whose loop touches itself), and 59, whose .brep file of a circle it took for invalid (an
# edge its loop runs along and straight back)
_KINKED = [(20.824, 0.066, -5.489), (14.048, 8.859, 3.492), (2.005, 11.945, 4.512), (-14.058, 8.854, 2.83),
           (-20.592, 1.786, 4.928), (-16.204, -7.538, 5.641), (2.512, -11.913, -5.902), (16.712, -7.16, -10.939)]
_KINKED_59 = [(15.834, -1.146, -5.281), (11.903, 9.63, -0.405), (-1.951, 14.435, -0.369), (-12.418, 9.069, 0.423),
              (-15.811, 1.394, 4.12), (-11.684, -9.853, 6.922), (-1.214, -14.502, 1.021), (11.64, -9.896, -6.705)]


@pytest.mark.parametrize("ry, wobble, volume", [(14, 0, 477.122125), (20, 0, 543.395624), (14, 3, 479.357865)])
def test_a_rectangle_round_a_loop_closed_with_a_kink_passes_the_strict_check(ry, wobble, volume):
    # (14, 0): the fused halves had a vertex 1.1e-5 from the end of its edge, whose tolerance was 5e-6:
    # is_valid(strict=True) False, two problems in check(); the tolerances take the gaps in now
    body = sweep(Rectangle(4, 1), _loop(ry, wobble))
    assert body.volume == approx(volume, rel=1e-6)
    assert body.check() == [] and body.is_valid(strict=True)


def test_fused_sweeps_take_only_small_gaps_into_their_tolerances(monkeypatch):
    from smlibpy import operations

    body = Box(10, 10, 10)
    wide = {"violated": True, "edge_face": 0.0, "vertex_edge": 0.01, "vertex_face": 0.0}  # (1e-4 of 17.3: 1.7e-3)
    monkeypatch.setattr(operations.ext, "tolerance_gaps", lambda brep: wide)
    assert operations._tolerant(body) is body  # (a defect a tolerance should not hide)
    monkeypatch.setattr(operations.ext, "tolerance_gaps", lambda brep: dict(wide, violated=False))
    assert operations._tolerant(body) is body


def _step_loops(text: str) -> list[list[int]]:
    """The vertices each EDGE_LOOP of a STEP text starts its edges at."""
    ent = dict(re.findall(r"#(\d+)=([^;]*);", text.replace("\n", "")))
    out = []
    for body in ent.values():
        m = re.match(r"EDGE_LOOP\('[^']*',\(([^)]*)\)\)", body)
        if m:
            starts = []
            for ref in m.group(1).split(","):
                e, sense = re.match(r"ORIENTED_EDGE\('[^']*',\*,\*,#(\d+),\.(T|F)\.\)", ent[ref.strip()[1:]]).groups()
                v0, v1 = re.match(r"EDGE_CURVE\('[^']*',#(\d+),#(\d+),", ent[e]).groups()
                starts.append(int(v0 if sense == "T" else v1))
            out.append(starts)
    return out


def test_a_loop_that_passes_a_vertex_twice_is_written_as_the_loops_between(tmp_path):
    # Where the halves of the loop meet as the profile meets itself, a face's loop touches itself at a
    # vertex (a thin hole that reaches the face's border). OpenCASCADE walked that wire the wrong way there
    # and took the face for invalid (BRepCheck_NotClosed), in the STEP file and in the .brep file
    body = sweep(Rectangle(3, 1.2), Spline(*_KINKED, _KINKED[0]))
    assert body.volume == approx(412.245515, rel=1e-6) and body.is_valid(strict=True)
    text = to_step(body)
    loops = _step_loops(text)
    assert all(len(set(s)) == len(s) for s in loops)
    assert len(loops) > len(body.faces())  # (a face bounded by the loops between)
    again = from_step(text)
    assert again.volume == approx(body.volume, rel=1e-7) and len(again.faces()) == len(body.faces())
    # the reader joins them again: the kernel has no loops that share a vertex
    assert again.is_valid(strict=True)
    export_brep(body, tmp_path / "loop.brep")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        back = import_brep(tmp_path / "loop.brep")
    assert back.volume == approx(body.volume, rel=1e-6) and len(back.faces()) == len(body.faces())
    assert back.is_valid(strict=True)


def test_a_circle_round_a_kinked_loop_reads_back_from_brep(tmp_path):
    body = sweep(Circle(1.5), Spline(*_KINKED_59, _KINKED_59[0]))
    export_brep(body, tmp_path / "loop.brep")
    with warnings.catch_warnings():  # (the check of the body read finds a gap of 5.3e-5 between its faces: a warning)
        warnings.simplefilter("ignore", RuntimeWarning)
        back = import_brep(tmp_path / "loop.brep")
    assert back.is_valid() and back.volume == approx(body.volume, rel=1e-6) and len(back.faces()) == len(body.faces())


@pytest.mark.parametrize("profile, pts", [(Rectangle(3, 1.2), _KINKED), (Circle(1.5), _KINKED_59)])
def test_sweeps_round_kinked_loops_read_into_opencascade(tmp_path, profile, pts):
    STEPControl = pytest.importorskip("OCP.STEPControl")
    from OCP.BRep import BRep_Builder
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepGProp import BRepGProp
    from OCP.BRepTools import BRepTools
    from OCP.GProp import GProp_GProps
    from OCP.TopoDS import TopoDS_Shape

    body = sweep(profile, Spline(*pts, pts[0]))
    export_step(body, tmp_path / "loop.step")
    export_brep(body, tmp_path / "loop.brep")
    reader = STEPControl.STEPControl_Reader()
    reader.ReadFile(str(tmp_path / "loop.step"))
    reader.TransferRoots()
    shape = reader.OneShape()
    assert BRepCheck_Analyzer(shape).IsValid()
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props, 1e-9, False, False)
    assert props.Mass() == approx(body.volume, rel=1e-6)
    brep = TopoDS_Shape()
    BRepTools.Read_s(brep, str(tmp_path / "loop.brep"), BRep_Builder())
    assert BRepCheck_Analyzer(brep).IsValid()


_EDGES = [{"v0": a, "v1": b} for a, b in [(0, 1), (1, 2), (2, 0), (0, 3), (3, 4), (4, 0), (5, 5), (6, 7), (7, 5)]]


def test_simple_loops_split_a_loop_where_it_passes_a_vertex_again():
    # 0 -> 1 -> 2 -> 0 -> 3 -> 4 -> 0: two triangles at vertex 0
    pinched = [(0, True), (1, True), (2, True), (3, True), (4, True), (5, True)]
    assert _simple_loops(pinched, _EDGES) == [pinched[:3], pinched[3:]]
    for items in (pinched[2:] + pinched[:2], [(e, not f) for e, f in reversed(pinched)]):
        assert sorted(sorted(e for e, _ in s) for s in _simple_loops(items, _EDGES)) == [[0, 1, 2], [3, 4, 5]]
    # loops that pass no vertex twice, with a closed edge or with an edge used twice (a seam) stay
    assert _simple_loops(pinched[:3], _EDGES) == [pinched[:3]]
    assert _simple_loops(pinched + [(6, True)], _EDGES) == [pinched + [(6, True)]]
    seam = [(7, True), (0, True), (7, False), (1, True)]
    assert _simple_loops(seam, _EDGES) == [seam]


def test_joined_loops_join_two_loops_that_meet_at_one_vertex():
    outer = {"edges": [(1, True), (2, True), (0, True)], "outer": True}
    hole = {"edges": [(4, True), (5, True), (3, True)], "outer": False}
    other = {"edges": [(6, True)], "outer": False}
    joined = _joined_loops([outer, hole, other], _EDGES)
    assert len(joined) == 2 and joined[0]["outer"] and joined[1] is other
    items = joined[0]["edges"]
    assert sorted(items) == sorted(outer["edges"] + hole["edges"])
    starts = [_EDGES[e]["v0"] if f else _EDGES[e]["v1"] for e, f in items]
    ends = [_EDGES[e]["v1"] if f else _EDGES[e]["v0"] for e, f in items]
    assert ends == starts[1:] + starts[:1]  # (one chain, round)
    assert sorted(sorted(e for e, _ in s) for s in _simple_loops(items, _EDGES)) == [[0, 1, 2], [3, 4, 5]]
    loops = [outer, other]
    assert _joined_loops(loops, _EDGES) is loops  # (nothing to join)


# -- documented numbers ------------------------------------------------------------------------------------
def _comment(path: Path, code: str) -> str:
    """The comment after the first line of ``path`` that holds ``code``."""
    line = next(x for x in path.read_text().splitlines() if code in x)
    return line.split("#", 1)[1].strip()


def test_the_kernel_trace_example_prints_what_docs_kernel_md_says():
    said = ast.literal_eval(_comment(ROOT / "docs" / "kernel.md", "print(e.trace[-3:])"))
    with pytest.raises(KernelError) as e:
        Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 45) - Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)
    assert e.value.trace[-3:] == said  # (it said SmMerge.cpp:7146 and :4437; the kernel's patches moved them)


def test_the_loft_reference_prints_its_sections():
    said = _comment(ROOT / "src" / "smlibpy" / "skill" / "references" / "features" / "loft.md", "duct.section(")
    turned, unturned = (float(x) for x in re.findall(r"\d+\.\d", said))
    duct = loft([Rectangle(30, 30), Circle(12).rotate(Z, 45).translate(0, 0, 25)])
    plain = loft([Rectangle(30, 30), Circle(12).translate(0, 0, 25)])
    # (it said 660.2 and 565.9: the section is 660.69997, as a split face and a thin slab measure it)
    assert round(duct.section(Plane.XY.offset(12.5)).area, 1) == turned == 660.7
    assert round(plain.section(Plane.XY.offset(12.5)).area, 1) == unturned


def test_the_trim_reference_measures_what_it_prints():
    text = (ROOT / "src" / "smlibpy" / "skill" / "references" / "surfaces" / "trim.md").read_text()
    kept, holed, whole = (float(x) for x in re.search(r"kept ([\d.]+), the holed sheet ([\d.]+) \(they add\s+up to the "
                                                         r"sheet, ([\d.]+)\)", text).groups())
    f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2  # noqa: E731
    saddle = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
    outline = saddle.project(CenterArc((20, 15, 50), 5, 0, 360), (0, 0, -1))
    assert round(saddle.trim(outline, keep=(20, 15, 0)).area, 3) == kept
    assert round(saddle.trim(outline, keep=(2, 2, 0)).area, 3) == holed  # (it said 1169.877)
    assert round(saddle.area, 3) == whole == round(kept + holed, 3)
