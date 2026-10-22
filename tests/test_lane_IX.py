"""Lane IX of the kernel plan (ai/plan/kernel-deep-dive.md): STEP import and export, USD names.

I3 O-rings, I4 cavities within the gaps of their faces, I5 stitching faces that do not share
their edges, I6 one unreadable body, I7 assembly instances built once, I8 one integration per
shell, I9 faces' parameter domains, I10 assemblies in export_step, X3 non-ASCII names in USD,
I11 offset surfaces in export_step, I12 curves, points and coordinate systems in export_step,
I13 the STEP uncertainty in any unit, X5 analytic edges in USD, X7 USD bodies that cannot be read,
I14 IGES import.
"""

import math
import re
import warnings
from pathlib import Path

import pytest

from smlibpy import *
from smlibpy import step_import as si
from smlibpy._kernel import KernelError
from smlibpy.step import _s
from smlibpy.step_reader import _decode_string
from test_step_import import _assembly_like_autocad, _step, _tool_with_supplemental_geometry, _unshared


def _per_face(text: str, gap: float) -> str:
    """A STEP text in which no two faces share an edge or a vertex: each face gets EDGE_CURVEs and
    VERTEX_POINTs of its own (a seam stays one edge its face uses twice), the points of each copy
    moved by up to ``gap``."""
    head, data = text.split("DATA;\n", 1)
    data, tail = data.split("ENDSEC;", 1)
    ents = dict(re.findall(r"#(\d+)=(.*?);\n", data, re.S))
    order = list(ents)
    new: list[tuple[int, str]] = []
    nxt = max(int(i) for i in order) + 1
    count = 0

    def add(s: str) -> int:
        nonlocal nxt
        new.append((nxt, s))
        nxt += 1
        return nxt - 1

    for f in order:
        if not ents[f].startswith("ADVANCED_FACE"):
            continue
        vcopy: dict[str, int] = {}
        ecopy: dict[str, int] = {}

        def vertex(v: str) -> int:
            nonlocal count
            if v not in vcopy:
                p = re.match(r"VERTEX_POINT\('',#(\d+)\)", ents[v]).group(1)
                xyz = [float(c) for c in re.match(r"CARTESIAN_POINT\('.*?',\((.*)\)\)", ents[p]).group(1).split(",")]
                xyz = [c + gap * ((count * 7 + j * 3) % 5 - 2) / 2 for j, c in enumerate(xyz)]
                count += 1
                point = add("CARTESIAN_POINT('',(%s))" % ",".join(f"{c:.12E}" for c in xyz))
                vcopy[v] = add(f"VERTEX_POINT('',#{point})")
            return vcopy[v]

        bounds = re.match(r"ADVANCED_FACE\('[^']*',\(([^)]*)\)", ents[f]).group(1).replace("#", "").split(",")
        for b in bounds:
            loop = re.match(r"FACE(?:_OUTER)?_BOUND\('[^']*',#(\d+)", ents[b]).group(1)
            uses = []
            for oe in re.match(r"EDGE_LOOP\('[^']*',\(([^)]*)\)", ents[loop]).group(1).replace("#", "").split(","):
                m = re.match(r"ORIENTED_EDGE\('',\*,\*,#(\d+),(\.[TF]\.)\)", ents[oe])
                e = m.group(1)
                if e not in ecopy:
                    v1, v2, c, sense = re.match(r"EDGE_CURVE\('',#(\d+),#(\d+),#(\d+),(\.[TF]\.)\)", ents[e]).groups()
                    ecopy[e] = add(f"EDGE_CURVE('',#{vertex(v1)},#{vertex(v2)},#{c},{sense})")
                uses.append("#%d" % add(f"ORIENTED_EDGE('',*,*,#{ecopy[e]},{m.group(2)})"))
            ents[loop] = "EDGE_LOOP('',(" + ",".join(uses) + "))"
    body = "".join(f"#{i}={ents[i]};\n" for i in order) + "".join(f"#{i}={s};\n" for i, s in new)
    return head + "DATA;\n" + body + "ENDSEC;" + tail


def _messages(caught: list[warnings.WarningMessage]) -> list[str]:
    return [str(w.message) for w in caught if "mass properties" not in str(w.message)]


# -- I3: O-rings ---------------------------------------------------------------------------------
def _oring() -> str:
    """An O-ring as OpenCASCADE writes it (R 4.5, r 0.5): one torus face, its seams on the tube
    circle and on the outer equator, the frame a rounding error off the axes. The angle of its
    seam around the tube comes out of atan2 as +6e-15, and the window the importer made of it,
    -359.99999999999994 to 0, the kernel refused."""
    return _step([
        "#1=CARTESIAN_POINT('',(6.232587878746,-35.03807040626,6.235798942157));", "#2=VERTEX_POINT('',#1);",
        "#3=CARTESIAN_POINT('',(5.732587878746,-35.03807040626,6.235798942157));",
        "#4=DIRECTION('',(-2.775472858268E-17,-1.348103941297E-33,-1.));",
        "#5=DIRECTION('',(1.,5.551115123126E-17,-2.775472858268E-17));",
        "#6=AXIS2_PLACEMENT_3D('',#3,#4,#5);", "#7=CIRCLE('',#6,0.5);", "#8=SEAM_CURVE('',#7,(),.PCURVE_S1.);",
        "#9=EDGE_CURVE('',#2,#2,#8,.T.);",
        "#10=CARTESIAN_POINT('',(1.232587878746,-35.03807040626,6.235798942157));",
        "#11=DIRECTION('',(5.551115123126E-17,-1.,-1.925929944387E-34));",
        "#12=AXIS2_PLACEMENT_3D('',#10,#11,#5);", "#13=CIRCLE('',#12,5.);", "#14=SEAM_CURVE('',#13,(),.PCURVE_S1.);",
        "#15=EDGE_CURVE('',#2,#2,#14,.T.);", "#16=TOROIDAL_SURFACE('',#12,4.5,0.5);",
        "#17=ORIENTED_EDGE('',*,*,#9,.F.);", "#18=ORIENTED_EDGE('',*,*,#15,.T.);",
        "#19=ORIENTED_EDGE('',*,*,#9,.T.);", "#20=ORIENTED_EDGE('',*,*,#15,.F.);",
        "#21=EDGE_LOOP('',(#17,#18,#19,#20));", "#22=FACE_BOUND('',#21,.T.);",
        "#23=ADVANCED_FACE('',(#22),#16,.T.);", "#98=CLOSED_SHELL('',(#23));",
        "#99=MANIFOLD_SOLID_BREP('o-ring',#98);",
    ])


def test_oring_whose_seam_runs_along_the_outer_equator(tmp_path):
    path = tmp_path / "oring.step"
    path.write_text(_oring())
    ring = import_step(path)
    assert ring.name == "o-ring"
    assert len(ring.faces()) == 1
    assert ring.is_valid()
    assert ring.volume == pytest.approx(2 * math.pi ** 2 * 4.5 * 0.5 ** 2, rel=1e-9)  # 22.2066


def test_tube_window_starts_at_the_seam():
    assert si._tube_window_start(6e-15) == 0.0
    assert si._tube_window_start(-6e-15) == pytest.approx(0.0, abs=1e-12)
    assert si._tube_window_start(90.0) == -270.0
    assert si._tube_window_start(-45.0) == -45.0


def test_oring_from_opencascade(tmp_path):
    pytest.importorskip("OCP.STEPControl")
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeTorus
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer

    axis = gp_Ax2(gp_Pnt(1.232587878746, -35.03807040626, 6.235798942157), gp_Dir(5.551115123126e-17, -1, 0),
                  gp_Dir(1, 5.551115123126e-17, -2.775472858268e-17))
    writer = STEPControl_Writer()
    writer.Transfer(BRepPrimAPI_MakeTorus(axis, 4.5, 0.5).Shape(), STEPControl_AsIs)
    writer.Write(str(tmp_path / "oring.step"))
    ring = import_step(tmp_path / "oring.step")
    assert ring.is_valid()
    assert ring.volume == pytest.approx(2 * math.pi ** 2 * 4.5 * 0.25, rel=1e-9)


# -- I4: cavities whose faces leave gaps ------------------------------------------------------------
def _block_with_cavity(tmp_path):
    path = tmp_path / "cavity.step"
    export_step((Box(40, 30, 20) - Box(20, 10, 10)).named("block"), path)
    assert "BREP_WITH_VOIDS" in path.read_text()
    return path


def _cavity_measured(monkeypatch, off: float, gaps: float) -> None:
    """The cavity (the 20 x 10 x 10 box, built as a solid of its own) measures ``off`` more than it
    integrates to inside the solid, its faces with ``gaps``: as the cavities of the Kraken X60
    motor, whose void region came out 2.7 mm3 off of 195,950 with gaps of up to 1e-2."""
    props = Part._props

    def measured(self, accuracy=None):
        p = props(self, accuracy)
        if abs(p["volume"] - 2000) < 1e-6:
            p = dict(p, volume=p["volume"] + off, gaps=gaps)
        return p

    monkeypatch.setattr(Part, "_props", measured)


def test_cavity_within_the_gaps_of_its_faces_is_a_void_region(tmp_path, monkeypatch):
    # 0.5 mm3 off: beyond the 1e-6 of the solid's volume the import asked (0.024), so both void
    # builds were refused and the cavities were subtracted (which failed on the motor after 18 s
    # with "the operands may touch"); within 2 x the gaps (4.0) it is the void region.
    path = _block_with_cavity(tmp_path)
    _cavity_measured(monkeypatch, 0.5, 1e-3)

    def no_boolean(self, other):
        raise AssertionError("the cavity was subtracted")

    monkeypatch.setattr(Part, "__sub__", no_boolean)
    part = import_step(path)
    assert len(part.faces()) == 12
    assert part.volume == pytest.approx(24000 - 2000, rel=1e-9)


def test_cavity_turned_the_wrong_way_is_not_taken(tmp_path, monkeypatch):
    # gaps so large that both orientations lie within the tolerance (2 x 0.6 x 2000 = 2400): the
    # one turned the wrong way adds the cavity, 4000 off, which is further from the right volume
    # than from the wrong one, and is refused; the right one (0 off) is taken.
    path = _block_with_cavity(tmp_path)
    _cavity_measured(monkeypatch, 0.0, 0.6)
    part = import_step(path)
    assert part.volume == pytest.approx(22000, rel=1e-9)
    assert part.is_valid()


def test_cavity_that_cannot_be_built_names_the_body(tmp_path, monkeypatch):
    path = _block_with_cavity(tmp_path)
    _cavity_measured(monkeypatch, 500.0, 0.0)  # no void build is close enough: the Boolean decides

    def failing(self, other):
        raise KernelError("cut", "SM_ERR", "SM_ERR", "the operands may touch")

    monkeypatch.setattr(Part, "__sub__", failing)
    with pytest.raises(ModelingError, match=r"body 'block' \(#\d+, product 'cavity'\): its cavities could not be "
                                            r"built, neither as void regions nor by subtracting them \(cut failed"):
        import_step(path, strict=True)


# -- I5: faces that do not share their edges --------------------------------------------------------
def test_faces_that_share_no_edges_are_stitched(tmp_path):
    reference = Box(20, 10, 10) - Cylinder(3, 20)
    export_step(reference.named("block"), tmp_path / "block.step")
    (tmp_path / "apart.step").write_text(_per_face((tmp_path / "block.step").read_text(), 0.0))
    raw = import_step(tmp_path / "apart.step", heal=False)
    assert not raw.is_valid() and len(raw.edges()) == 28  # each face with its own edges, as in the file
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        part = import_step(tmp_path / "apart.step")
    assert part.is_valid()
    assert (len(part.faces()), len(part.edges())) == (7, 14)
    assert part.volume == pytest.approx(reference.volume, rel=1e-9)
    assert any(re.search(r"faces of body 'block' \(#\d+\) did not share their edges; stitched them", m)
               for m in _messages(caught))


@pytest.mark.parametrize("gap", [1e-4, 1e-3])
def test_faces_with_gaps_between_them_are_stitched(tmp_path, gap):
    # every oriented edge with edges and vertices of its own, the vertices up to `gap` off (the
    # kernel's stitch joins them; the healer then gives the hole's face the seam it lacks)
    export_step((Box(20, 10, 10) - Cylinder(3, 20)).named("block"), tmp_path / "block.step")
    (tmp_path / "gaps.step").write_text(_unshared((tmp_path / "block.step").read_text(), gap))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        part = import_step(tmp_path / "gaps.step")
    assert part.is_valid()
    assert part.volume == pytest.approx(2000 - math.pi * 90, rel=20 * gap)
    [message] = _messages(caught)
    assert "stitched them, closing gaps of up to" in message


def test_planar_faces_with_gaps_are_stitched(tmp_path):
    export_step((Box(20, 10, 10) - Box(5, 5, 20)).named("pocket"), tmp_path / "pocket.step")
    (tmp_path / "gaps.step").write_text(_per_face((tmp_path / "pocket.step").read_text(), 1e-3))
    with warnings.catch_warnings(record=True):
        warnings.simplefilter("always")
        part = import_step(tmp_path / "gaps.step")
    assert part.is_valid()
    assert (len(part.faces()), len(part.edges())) == (10, 24)
    assert part.volume == pytest.approx(1750, rel=1e-3)


def test_body_that_cannot_be_repaired_says_so(tmp_path):
    # the hole's face with its vertices 1e-3 off its seam: stitched, it still covers nothing
    export_step((Box(20, 10, 10) - Cylinder(3, 20)).named("block"), tmp_path / "block.step")
    (tmp_path / "broken.step").write_text(_per_face((tmp_path / "block.step").read_text(), 1e-3))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        part = import_step(tmp_path / "broken.step")
    assert not part.is_valid()
    assert any(re.search(r"body 'block' \(#\d+\) is not a valid solid \(.*\); heal and stitching could not repair it",
                         m) for m in _messages(caught))


def test_sheet_whose_faces_share_no_edges_is_sewn(tmp_path):
    box = Box(10, 10, 10)
    sheet = stitch(box.faces().top()[0], box.faces().sort_by(Axis.X)[-1])
    assert (len(sheet.faces()), len(sheet.edges())) == (2, 7)
    export_step(sheet.named("sheet"), tmp_path / "sheet.step")
    (tmp_path / "apart.step").write_text(_per_face((tmp_path / "sheet.step").read_text(), 1e-4))
    assert len(import_step(tmp_path / "apart.step", heal=False).edges()) == 8
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        back = import_step(tmp_path / "apart.step")
    assert isinstance(back, Shell)
    assert (len(back.faces()), len(back.edges())) == (2, 7)
    assert any("stitched 1 edges" in m for m in _messages(caught))


def test_file_uncertainty_is_read(tmp_path):
    # (where stitching starts: the uncertainty the file declares, in its unit)
    from smlibpy.step_reader import interpret, parse

    export_step(Box(1, 1, 1).named("b"), tmp_path / "b.step", unit="m")
    [(body, _)] = interpret(parse((tmp_path / "b.step").read_text()))
    assert body.uncertainty == pytest.approx(1e-7)  # 1e-10 m in mm (I13: 1e-7 mm in any unit)
    assert body.name == "b" and body.entity > 0


# -- I6: one body that cannot be read --------------------------------------------------------------
def _two_bodies(tmp_path, broken: bool = True):
    path = tmp_path / "two.step"
    export_step([Box(10, 10, 10).named("a"), (Box(5, 5, 5) - Cylinder(1, 10)).translate(20, 0, 0).named("b")], path)
    text = path.read_text()
    if broken:
        # body b's last circle becomes a curve the reader does not know
        last = re.findall(r"#(\d+)=CIRCLE\(", text)[-1]
        text = text.replace(f"#{last}=CIRCLE(", f"#{last}=OFFSET_CURVE_3D(")
        path.write_text(text)
    return path, last if broken else None


def test_body_that_cannot_be_read_is_left_out(tmp_path):
    path, entity = _two_bodies(tmp_path)
    with pytest.warns(RuntimeWarning, match=rf"left out body 'b' \(#\d+, product 'two'\): curve type OFFSET_CURVE_3D \(#{entity}\), "
                                            "which is not supported"):
        part = import_step(path)
    assert isinstance(part, Part) and part.name == "a"
    assert part.volume == pytest.approx(1000, rel=1e-9)


def test_strict_import_raises_for_a_body_that_cannot_be_read(tmp_path):
    path, entity = _two_bodies(tmp_path)
    with pytest.raises(ModelingError, match=rf"body 'b' \(#\d+, product 'two'\): curve type OFFSET_CURVE_3D \(#{entity}\)"):
        import_step(path, strict=True)
    with pytest.raises(ModelingError, match="OFFSET_CURVE_3D"):
        read_step(path, strict=True)


def test_read_step_lists_the_bodies_left_out(tmp_path):
    path, entity = _two_bodies(tmp_path)
    with pytest.warns(RuntimeWarning, match="left out"):
        model = read_step(path)
    assert [b.name for b in model.bodies] == ["a"]
    [skipped] = model.skipped
    assert re.fullmatch(rf"body 'b' \(#\d+, product 'two'\): curve type OFFSET_CURVE_3D \(#{entity}\), which is not supported", skipped)
    assert repr(model) == "StepModel(1 bodies, 0 frames, 0 curves, 0 points, 1 skipped)"


def test_body_the_kernel_cannot_build_is_left_out(tmp_path, monkeypatch):
    path, _ = _two_bodies(tmp_path, broken=False)
    build = si._build_body

    def failing(body, m, heal):
        if body.name == "b":
            raise KernelError("import STEP", "SM_ERR", "SM_ERR", "the file may hold faces the kernel cannot rebuild")
        return build(body, m, heal)

    monkeypatch.setattr(si, "_build_body", failing)
    with pytest.warns(RuntimeWarning, match=r"left out body 'b' \(#\d+, product 'two'\): import STEP failed \(SM_ERR\)"):
        assert import_step(path).name == "a"


def test_file_none_of_whose_bodies_can_be_read_raises(tmp_path):
    path = tmp_path / "one.step"
    export_step(Cylinder(2, 5).named("c"), path)
    text = path.read_text().replace("CIRCLE(", "OFFSET_CURVE_3D(")
    path.write_text(text)
    with pytest.warns(RuntimeWarning), pytest.raises(ModelingError, match="no body of the file could be read: body 'c'"):
        import_step(path)


# -- I7: instances of a product ------------------------------------------------------------------
def test_instances_of_a_product_are_built_once(tmp_path, monkeypatch):
    path = tmp_path / "asm.step"
    path.write_text(_assembly_like_autocad(tmp_path))
    calls = []
    build = si._build_body
    monkeypatch.setattr(si, "_build_body", lambda body, m, heal: calls.append(body.name) or build(body, m, heal))
    parts = sorted(import_step(path), key=lambda p: p.bbox().min.x)
    assert calls == ["plate"]  # (two instances)
    a, b = parts[0].bbox(), parts[1].bbox()
    assert a.min.to_tuple() == pytest.approx((-55, 10, -2), abs=1e-6)
    assert a.max.to_tuple() == pytest.approx((-45, 30, 2), abs=1e-6)
    assert b.min.to_tuple() == pytest.approx((80, 70, 8), abs=1e-6)
    assert b.max.to_tuple() == pytest.approx((100, 80, 12), abs=1e-6)
    assert [p.name for p in parts] == ["plate", "plate"]
    assert all(p.is_valid() and p.volume == pytest.approx(800, rel=1e-9) for p in parts)


# -- I8: the checks of a shell ----------------------------------------------------------------------
def test_import_integrates_each_shell_once(tmp_path, monkeypatch):
    # _positive and _sound each asked the kernel for the volume, and is_valid() once more: on a part
    # of 2079 faces 1.9 of 8.2 s. Now once per built shell.
    path = tmp_path / "plate.step"
    plate = Box(80, 60, 10).fillet(Box(80, 60, 10).edges().parallel_to(Z), 8) - Cylinder(4, 20)
    export_step(plate, path)
    calls = []
    props = Part._kernel_props
    monkeypatch.setattr(Part, "_kernel_props", lambda self, accuracy: calls.append(accuracy) or props(self, accuracy))
    part = import_step(path)
    assert calls == [1e-4]
    assert part.volume == pytest.approx(plate.volume, rel=1e-9)


# -- I9: the parameter domains of imported faces -----------------------------------------------------
def test_imported_faces_have_a_point_inside(tmp_path):
    # small patches of a torus: in the torus' whole parameter domain the kernel's search for a point
    # inside them found none, and Face.interior_point() and export_step raised a raw RuntimeError
    patch = Torus(10, 3) & Box(1, 1, 1).translate(12.8, 0.3, 0)
    export_step(patch, tmp_path / "patch.step")
    back = import_step(tmp_path / "patch.step")
    tori = [f for f in back.faces() if f.geom_type == "torus"]
    assert len(tori) == 4
    for f in tori:
        assert back.distance_to(f.interior_point()) < 1e-6  # on the part's boundary
        (u0, v0), (u1, v1) = f._f.uv_domain()
        assert v1 - v0 < 180  # the face's own domain, not the torus' 360 degrees
    export_step(back, tmp_path / "again.step")
    assert import_step(tmp_path / "again.step").volume == pytest.approx(patch.volume, rel=1e-7)


def test_fillet_size_check_does_not_leak_kernel_errors():
    # The size check measures how far points of a rounded edge are from the other edges of its faces.
    # On this body the kernel finds no closest point on one of them, and the check raised a raw
    # RuntimeError (SmApiEdgeClosestPoint failed) instead of leaving that pair out.
    import pathlib

    path = pathlib.Path(__file__).parents[1] / "third_party/usd-brep/TestFiles/pt_TestFiles/Fillet/fillet1019.smb"
    if not path.exists():
        pytest.skip("usd-brep test files not checked out")
    part = load(path)

    def between(a, b):  # (the edges by their ends)
        return min(part.edges(), key=lambda e: e.start.distance_to(Vector(a)) + e.end.distance_to(Vector(b)))

    edge = between((-24.917, 24.917, 5.523), (-19.856, 25.4, 0))
    other = between((-24.917, -19.856, 5.523), (-20.337, -25.398, 0.023))
    with pytest.raises(KernelError, match="distance failed"):
        other.distance_to(Vector(-22.81907097071722, 25.316566421632405, 0.9536501645481591))
    try:
        part.fillet(ShapeList([edge]), 0.2)
    except ModelingError:
        pass  # (the kernel cannot round it: a KernelError says so)


# -- I10: assemblies --------------------------------------------------------------------------------
def _parts():
    bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
    cover = Box(60, 40, 2).translate(0, 0, 10).named("Größe").colored("#d9925a")
    bolt = Cylinder(2, 10).translate(20, 10, 0).named("bolt")
    return bracket, cover, bolt


def test_export_step_writes_an_assembly_of_named_products(tmp_path):
    bracket, cover, bolt = _parts()
    path = tmp_path / "asm.step"
    export_step([bracket, cover, bolt, bolt], path, assembly=True, name="fixture")
    text = path.read_text()
    products = re.findall(r"=PRODUCT\('([^']*)'", text)
    assert products == ["fixture", "bracket", "Gr\\X2\\00F600DF\\X0\\e", "bolt"]
    assert text.count("NEXT_ASSEMBLY_USAGE_OCCURRENCE(") == 4
    assert text.count("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(") == 4
    assert text.count("MANIFOLD_SOLID_BREP(") == 3  # the bolt once, placed twice
    back = import_step(path)
    assert [p.name for p in back] == ["bracket", "Größe", "bolt", "bolt"]
    for p, q in zip(back, [bracket, cover, bolt, bolt]):
        assert p.volume == pytest.approx(q.volume, rel=1e-9)
        assert p.bbox().min.to_tuple() == pytest.approx(q.bbox().min.to_tuple(), abs=1e-9)
    assert back[0].color == pytest.approx((70 / 255, 130 / 255, 180 / 255))
    assert back[3].color is None


def test_assembly_in_inches_and_with_sheets(tmp_path):
    bracket, _, _ = _parts()
    skin = Box(20, 20, 1).faces().top()[0].to_shell().translate(0, 0, 30).named("skin")
    path = tmp_path / "asm.step"
    export_step([bracket, skin], path, assembly=True, unit="inch")
    assert "MANIFOLD_SURFACE_SHAPE_REPRESENTATION('skin'" in path.read_text()
    back = import_step(path)
    assert [type(b).__name__ for b in back] == ["Part", "Shell"]
    assert back[0].volume == pytest.approx(bracket.volume, rel=1e-9)
    assert back[1].bbox().min.z == pytest.approx(30.5, abs=1e-9)


def test_one_product_stays_the_default(tmp_path):
    bracket, cover, _ = _parts()
    path = tmp_path / "one.step"
    export_step([bracket, cover], path)
    text = path.read_text()
    assert text.count("=PRODUCT(") == 1 and "NEXT_ASSEMBLY_USAGE_OCCURRENCE" not in text


def test_assembly_read_by_opencascade(tmp_path):
    pytest.importorskip("OCP.STEPControl")
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer

    bracket, cover, bolt = _parts()
    path = tmp_path / "asm.step"
    export_step([bracket, cover, bolt, bolt], path, assembly=True)
    reader = STEPControl_Reader()
    reader.ReadFile(str(path))
    model = reader.WS().Model()
    names = [model.Value(i).Name().ToCString() for i in range(1, model.NbEntities() + 1)
             if model.Value(i).DynamicType().Name() == "StepBasic_Product"]
    assert names == ["asm", "bracket", "Größe", "bolt"]
    reader.TransferRoots()
    solids = []
    explorer = TopExp_Explorer(reader.OneShape(), TopAbs_SOLID)
    while explorer.More():
        solids.append(explorer.Current())
        explorer.Next()
    assert len(solids) == 4
    assert solids[2].IsPartner(solids[3]) and not solids[0].IsPartner(solids[2])  # one bolt, placed twice


def test_step_names_keep_their_characters(tmp_path):
    for name in ["Bügel", "部品 #1", "a'b\\c", "x\U0001F600y", "plain"]:
        assert _decode_string(_s(name)) == name
        assert all(32 <= ord(c) < 127 for c in _s(name))
    path = tmp_path / "names.step"
    export_step([Box(1, 1, 1).named("Bügel"), Box(1, 1, 1).translate(3, 0, 0).named("部品")], path)
    assert [p.name for p in import_step(path)] == ["Bügel", "部品"]


# -- X3: names in USD --------------------------------------------------------------------------------
def test_usd_names_of_any_characters_round_trip(tmp_path):
    names = ["Größe", "café", "部品", "Bracket #1 (left)", 'quote " back \\ slash', "plain_name", "1st"]
    parts = [Box(1, 1, 1).translate(3 * i, 0, 0).named(n) for i, n in enumerate(names)]
    path = tmp_path / "names.usda"
    export_usd(parts, path)
    text = path.read_text(encoding="utf-8")
    prims = re.findall(r'def BrepArray "([^"]*)"', text)
    assert prims == ["Gr__e", "caf_", "__", "Bracket__1__left_", "quote___back___slash", "plain_name", "_1st"]
    assert all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", p) for p in prims)
    assert 'displayName = "Größe"' in text and 'displayName = "quote \\" back \\\\ slash"' in text
    assert 'displayName = "plain_name"' not in text  # (a name that is a prim name needs none)
    assert [b.name for b in import_usd(path)] == names


def test_usd_names_that_map_to_one_prim_name_stay_apart(tmp_path):
    path = tmp_path / "twins.usda"
    export_usd([Box(1, 1, 1).named("部品"), Box(1, 1, 1).translate(3, 0, 0).named("名前")], path, mesh=False)
    assert re.findall(r'def BrepArray "([^"]*)"', path.read_text(encoding="utf-8")) == ["__", "___1"]
    assert [b.name for b in import_usd(path)] == ["部品", "名前"]


# -- I11: offset surfaces ------------------------------------------------------------------------------
_PT = __import__("pathlib").Path(__file__).parents[1] / "third_party/usd-brep/TestFiles/pt_TestFiles"


def _kinds(body) -> dict[str, int]:
    from collections import Counter

    from smlibpy._kernel import ext

    return dict(Counter(f["kind"] for f in ext.brep_dump(body._brep, False)["faces"]))


def _offset_of(text: str, pattern: str, make) -> str:
    """A STEP text with the first surface that matches ``pattern`` replaced by an OFFSET_SURFACE of
    the basis ``make(match)`` gives as ``(entity, distance)``, written as other CAD systems write them."""
    head, data = text.split("DATA;\n", 1)
    data, tail = data.split("ENDSEC;", 1)
    n = max(int(i) for i in re.findall(r"^#(\d+)=", data, re.M))
    m = re.search(r"^#(\d+)=" + pattern + ";$", data, re.M)
    basis, distance = make(m)
    data = data.replace(m.group(0), f"#{m.group(1)}=OFFSET_SURFACE('',#{n + 1},{distance!r},.F.);")
    return head + "DATA;\n" + data + f"#{n + 1}={basis};\n" + "ENDSEC;" + tail


def _cylinder_offset(r0: float, d: float):
    return lambda m: (f"CYLINDRICAL_SURFACE('',#{m.group(2)},{r0!r})", d)


_CYL = r"CYLINDRICAL_SURFACE\('',#(\d+),([-\d.E]+)\)"
_OFFSETS = {
    # a cylinder of radius 10 as an offset of radius 8 out (+2) and of 12 in (-2), the hole of a
    # block (its face points to the axis) as one of radius 3 and 5, a torus' tube, a cone, a sphere
    "cylinder out": (lambda: Cylinder(10, 20), _CYL, _cylinder_offset(8.0, 2.0)),
    "cylinder in": (lambda: Cylinder(10, 20), _CYL, _cylinder_offset(12.0, -2.0)),
    "hole out": (lambda: Box(20, 20, 10) - Cylinder(4, 10), _CYL, _cylinder_offset(3.0, 1.0)),
    "hole in": (lambda: Box(20, 20, 10) - Cylinder(4, 10), _CYL, _cylinder_offset(5.0, -1.0)),
    "torus": (lambda: Torus(20, 5), r"TOROIDAL_SURFACE\('',#(\d+),([-\d.E]+),([-\d.E]+)\)",
              lambda m: (f"TOROIDAL_SURFACE('',#{m.group(2)},{m.group(3)},6.)", -1.0)),
    "cone": (lambda: Cone(10, 5, 20), r"CONICAL_SURFACE\('',#(\d+),([-\d.E]+),([-\d.E]+)\)",
             lambda m: (f"CONICAL_SURFACE('',#{m.group(2)},{float(m.group(3)) - 1 / math.cos(float(m.group(4)))!r},"
                        f"{m.group(4)})", 1.0)),
    "sphere patch": (lambda: Sphere(12) & Box(10, 10, 10, align=Align.MIN),
                     r"SPHERICAL_SURFACE\('',#(\d+),([-\d.E]+)\)",
                     lambda m: (f"SPHERICAL_SURFACE('',#{m.group(2)},10.)", 2.0)),
}


@pytest.mark.parametrize("case", list(_OFFSETS))
def test_offset_surfaces_are_written_as_offset_surfaces(tmp_path, case):
    # An offset surface went to NURBS with its whole body (to_nurbs fits offsets loosely). It is
    # written as OFFSET_SURFACE of its basis now, the distance turned where STEP's normal of the
    # basis runs against the kernel's (the hole, the torus' inner side).
    make, pattern, basis = _OFFSETS[case]
    plain = make()
    export_step(plain, tmp_path / "plain.step")
    (tmp_path / "offset.step").write_text(_offset_of((tmp_path / "plain.step").read_text(), pattern, basis))
    part = import_step(tmp_path / "offset.step")
    assert part.is_valid() and _kinds(part)["offset"] == 1
    assert part.volume == pytest.approx(plain.volume, rel=1e-7)
    export_step(part, tmp_path / "again.step")
    text = (tmp_path / "again.step").read_text()
    assert text.count("OFFSET_SURFACE(") == 1 and "B_SPLINE_SURFACE" not in text  # (the basis analytic)
    back = import_step(tmp_path / "again.step")
    assert back.is_valid() and _kinds(back) == _kinds(part)
    assert back.volume == pytest.approx(part.volume, rel=1e-9)
    assert back.area == pytest.approx(part.area, rel=1e-9)


def test_offset_planes_are_written_as_offset_surfaces(tmp_path):
    # every face of a block as an offset of a parallel plane, some outward, some inward
    export_step(Box(20, 10, 6), tmp_path / "plain.step")
    text = (tmp_path / "plain.step").read_text()
    def coords(ref: str, kind: str) -> list[float]:
        return [float(x) for x in re.search(rf"^#{ref}={kind}\('',\(([^)]*)\)\);$", text, re.M).group(1).split(",")]

    for i, m in enumerate(re.finditer(r"^#(\d+)=PLANE\('',#(\d+)\);$", text, re.M)):
        ax = re.search(rf"^#{m.group(2)}=AXIS2_PLACEMENT_3D\('',#(\d+),#(\d+),#(\d+)\);$", text, re.M)
        p, z = coords(ax.group(1), "CARTESIAN_POINT"), coords(ax.group(2), "DIRECTION")
        d = 1.5 if i % 2 else -2.5
        q = ",".join(repr(p[k] - d * z[k]) for k in range(3))
        n = 10000 + 3 * i
        text = text.replace(m.group(0), f"#{m.group(1)}=OFFSET_SURFACE('',#{n + 2},{d!r},.F.);\n"
                            f"#{n}=CARTESIAN_POINT('',({q}));\n#{n + 1}=AXIS2_PLACEMENT_3D('',#{n},#{ax.group(2)},"
                            f"#{ax.group(3)});\n#{n + 2}=PLANE('',#{n + 1});")
    (tmp_path / "offset.step").write_text(text)
    part = import_step(tmp_path / "offset.step")
    assert part.is_valid() and _kinds(part) == {"offset": 6} and part.volume == pytest.approx(1200, rel=1e-12)
    export_step(part, tmp_path / "again.step")
    assert (tmp_path / "again.step").read_text().count("OFFSET_SURFACE(") == 6
    back = import_step(tmp_path / "again.step")
    assert back.is_valid() and _kinds(back) == {"offset": 6} and back.volume == pytest.approx(1200, rel=1e-12)


@pytest.mark.parametrize("unit", ["mm", "inch"])
def test_offset_fillets_of_smb_files_round_trip(tmp_path, unit):
    # vase.smb: four fillets on offset surfaces. The whole body went to NURBS: the volume changed by
    # 7.7e-3 and the planes came back as B-splines (11 B-spline faces), without a warning. Now the
    # faces keep their types, and the volume changes by what re-trimming the fillets costs (as for
    # fillet bodies without offsets).
    path = _PT / "Fillet/vase.smb"
    if not path.exists():
        pytest.skip("usd-brep test files not checked out")
    vase = load(path)
    assert _kinds(vase) == {"bspline": 4, "plane": 3, "offset": 4}
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)  # (no conversion, no warning)
        export_step(vase, tmp_path / "vase.step", unit=unit)
    assert (tmp_path / "vase.step").read_text().count("OFFSET_SURFACE(") == 4
    back = import_step(tmp_path / "vase.step")
    assert back.is_valid() and _kinds(back) == _kinds(vase)
    assert back.volume == pytest.approx(vase.volume, rel=1e-6)  # (0.4: 7.7e-3)


def test_bodies_step_cannot_hold_exactly_are_converted_with_a_warning(tmp_path, monkeypatch):
    # A face STEP cannot hold as the kernel has it (here: an offset whose basis the dump does not
    # give) sends the body to NURBS, now with a warning. (The converted body was also dropped while
    # it was written: the writer read a freed Brep.)
    import smlibpy.step as step
    from smlibpy._kernel import ext

    dump = ext.brep_dump

    def no_basis(brep, geometry):
        d = dump(brep, geometry)
        for f in d["faces"]:
            if geometry and f["surface"]["kind"] == "offset":
                del f["surface"]["basis"]
        return d

    monkeypatch.setattr(step.ext, "brep_dump", no_basis)
    path = _PT / "Fillet/vase2.smb"
    if not path.exists():
        pytest.skip("usd-brep test files not checked out")
    vase = load(path).named("vase")
    with pytest.warns(RuntimeWarning, match=r"export STEP: 'vase' has 4 faces on an offset of a surface of kind "
                                            r"'unknown', which STEP cannot hold .* written converted to NURBS"):
        export_step(vase, tmp_path / "vase.step")
    monkeypatch.undo()
    assert "OFFSET_SURFACE" not in (tmp_path / "vase.step").read_text()
    back = import_step(tmp_path / "vase.step")
    assert back.is_valid() and "offset" not in _kinds(back)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # (the approximated faces leave gaps: mass properties say so)
        assert back.volume == pytest.approx(vase.volume, rel=1e-2)


def _opencascade(path):
    """The shape OpenCASCADE reads from a STEP file, its volume and its curve length."""
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.STEPControl import STEPControl_Reader

    reader = STEPControl_Reader()
    reader.ReadFile(str(path))
    reader.TransferRoots()
    shape = reader.OneShape()
    volume, length = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, volume)
    BRepGProp.LinearProperties_s(shape, length)
    return shape, volume.Mass(), length.Mass()


@pytest.mark.parametrize("case", ["cylinder out", "hole in", "torus", "cone"])
def test_offset_surfaces_read_by_opencascade(tmp_path, case):
    pytest.importorskip("OCP.STEPControl")
    make, pattern, basis = _OFFSETS[case]
    plain = make()
    export_step(plain, tmp_path / "plain.step")
    (tmp_path / "offset.step").write_text(_offset_of((tmp_path / "plain.step").read_text(), pattern, basis))
    export_step(import_step(tmp_path / "offset.step"), tmp_path / "again.step")
    _, volume, _ = _opencascade(tmp_path / "again.step")
    assert volume == pytest.approx(plain.volume, rel=1e-6)


def test_imported_cylinders_are_written_as_cylinders(tmp_path):
    # The importer builds STEP cylinders as the kernel's cylinders, which the writer wrote as rational
    # B-splines (SMLib's own cylinders are cones of angle 0): a read and written file lost them.
    export_step(Box(20, 20, 10) - Cylinder(4, 10), tmp_path / "a.step")
    part = import_step(tmp_path / "a.step")
    assert _kinds(part) == {"plane": 6, "cylinder": 1}
    export_step(part, tmp_path / "b.step")
    text = (tmp_path / "b.step").read_text()
    assert text.count("CYLINDRICAL_SURFACE(") == 1 and "B_SPLINE_SURFACE" not in text
    back = import_step(tmp_path / "b.step")
    assert _kinds(back) == {"plane": 6, "cylinder": 1}
    assert back.volume == pytest.approx(20 * 20 * 10 - math.pi * 16 * 10, rel=1e-9)
    assert back.faces().cylinders()[0].radius == pytest.approx(4)


# -- I12: curves, points and coordinate systems -------------------------------------------------------
def _wireframe_items():
    spline = Spline([(0, 0, 0), (5, 5, 2), (10, 0, 4), (15, 3, 0)])
    wire = Wire([Line((0, 0, 0), (10, 0, 0)), Line((10, 0, 0), (10, 10, 0)), CenterArc((5, 10), 5, 0, 180)])
    box = Box(10, 10, 10).named("box").colored("red")
    return [box, StepCurve("cut", spline, color=(1.0, 0.0, 0.0)), Line((0, 0, 0), (10, 0, 0)),
            CenterArc((0, 0), 5, 30, 120).reversed(), EllipticalArc((0, 0), 6, 3, 10, 200), wire,
            box.edges().sort_by(Axis.Z)[0], CenterArc((0, 0), 4, 90, 360),
            StepPoint("P1", Vector(1, 2, 3), color=(0.0, 1.0, 0.0)), Vertex(4, 5, 6), Vector(7, 8, 9),
            StepFrame("MCS", Plane((1, 2, 3), x_dir=(0, 1, 0), z_dir=(1, 0, 0))), Plane.XZ]


@pytest.mark.parametrize("unit", ["mm", "inch"])
def test_export_step_writes_curves_points_and_frames(tmp_path, unit):
    # export_step(Line(...)) raised "TypeError: 'Edge' object is not iterable"; read_step reads curves,
    # points and coordinate systems, but nothing wrote them.
    items = _wireframe_items()
    path = tmp_path / "wire.step"
    export_step(items, path, unit=unit)
    text = path.read_text()
    assert "GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION" in text and "GEOMETRIC_CURVE_SET" in text
    assert "CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP('supplemental geometry'" in text
    model = read_step(path)
    assert repr(model) == "StepModel(1 bodies, 2 frames, 7 curves, 3 points)"
    assert model.bodies[0].volume == pytest.approx(1000) and model.bodies[0].name == "box"
    curves = model.curves
    assert [c.name for c in curves] == ["cut", "", "", "", "", "", ""]
    assert {c.product for c in curves} == {"wire"}
    assert curves[0].color == (1.0, 0.0, 0.0) and curves[1].color is None
    originals = [x if not isinstance(x, StepCurve) else x.shape for x in items[1:8]]
    for c, e in zip(curves, originals):
        assert type(c.shape) is type(e)
        assert c.shape.length == pytest.approx(e.length, rel=1e-9)
        assert c.shape.start.distance_to(e.start) < 1e-9 and c.shape.end.distance_to(e.end) < 1e-9
        assert c.shape.point_at(0.3).distance_to(e.point_at(0.3)) < 1e-7
    assert curves[4].shape.edges()[0].geom_type == "line" and curves[3].shape.geom_type == "ellipse"
    assert curves[6].shape.is_closed and curves[6].shape.radius == pytest.approx(4)
    p1, p2, p3 = model.points
    assert (p1.name, p1.point, p1.color) == ("P1", Vector(1, 2, 3), (0.0, 1.0, 0.0))
    assert (p2.name, p3.name) == ("", "") and p2.point == Vector(4, 5, 6) and p3.point == Vector(7, 8, 9)
    mcs, xz = model.frames
    assert mcs.name == "MCS" and model.frame("MCS") == Plane((1, 2, 3), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
    assert xz.name == "" and xz.plane == Plane.XZ


def test_wireframe_read_by_opencascade(tmp_path):
    pytest.importorskip("OCP.STEPControl")
    items = _wireframe_items()
    export_step(items, tmp_path / "wire.step", unit="inch")
    _, volume, length = _opencascade(tmp_path / "wire.step")
    assert volume == pytest.approx(1000, rel=1e-9)
    curves = sum(x.length for x in items[1:8] if not isinstance(x, StepCurve)) + items[1].shape.length
    assert length == pytest.approx(2 * 120 + curves, rel=1e-6)  # (OpenCASCADE counts each box edge twice)


def test_export_step_writes_a_step_model_back(tmp_path):
    # A read_step -> export_step round trip lost everything that is not a body.
    (tmp_path / "tool.step").write_text(_tool_with_supplemental_geometry())
    tool = read_step(tmp_path / "tool.step")
    for assembly in (False, True):
        path = tmp_path / f"again_{assembly}.step"
        export_step(tool, path, name="KIT", assembly=assembly)
        again = read_step(path)
        assert repr(again) == repr(tool)
        assert again.bodies[0].volume == pytest.approx(tool.bodies[0].volume, rel=1e-9)
        assert again.bodies[0].bbox().min.z == pytest.approx(100)
        assert [(c.name, c.color) for c in again.curves] == [(c.name, c.color) for c in tool.curves]
        for a, b in zip(again.curves, tool.curves):
            assert type(a.shape) is type(b.shape) and a.shape.length == pytest.approx(b.shape.length)
            assert a.shape.end.distance_to(b.shape.end) < 1e-9
        assert again.frame("MCS") == tool.frame("MCS") and again.frames[0].product == "KIT"
        assert (again.points[0].name, again.points[0].point) == ("CRP", tool.points[0].point)


def test_export_step_writes_wireframe_alone(tmp_path):
    export_step([StepCurve("path", Line((0, 0, 0), (0, 0, 10))), Plane.XY.offset(5)], tmp_path / "w.step")
    model = read_step(tmp_path / "w.step")
    assert repr(model) == "StepModel(0 bodies, 1 frames, 1 curves, 0 points)"
    assert model.curves[0].shape.length == pytest.approx(10) and model.frames[0].plane.origin == Vector(0, 0, 5)
    export_step(StepFrame("CSW", Plane.YZ), tmp_path / "f.step")  # (a frame alone: a shape without items)
    assert read_step(tmp_path / "f.step").frame("CSW") == Plane.YZ
    with pytest.raises(ValueError, match="nothing to write"):
        export_step([], tmp_path / "none.step")


def test_export_step_assembly_puts_wireframe_with_its_body(tmp_path):
    bracket = Box(60, 40, 8).named("bracket")
    cover = Box(60, 40, 2).translate(0, 0, 10).named("cover")
    mcs = StepFrame("MCS", Plane((0, 0, 4)), product="bracket")
    edge = StepCurve("rim", Line((0, 0, 12), (60, 0, 12)), product="cover")
    loose = StepPoint("ref", Vector(1, 1, 1))
    export_step([bracket, cover, mcs, edge, loose], tmp_path / "asm.step", assembly=True, name="kit")
    model = read_step(tmp_path / "asm.step")
    assert [b.name for b in model.bodies] == ["bracket", "cover"]
    assert (model.frames[0].product, model.curves[0].product, model.points[0].product) == ("bracket", "cover", "kit")
    assert model.frame("MCS", product="bracket").origin == Vector(0, 0, 4)


def test_export_step_still_refuses_what_it_cannot_write(tmp_path):
    with pytest.raises(TypeError, match="cannot write a Mesh to STEP"):
        export_step(tessellate(Box(1, 1, 1)), tmp_path / "m.step")
    with pytest.raises(TypeError, match="cannot write a Location to STEP"):
        export_step(Location((1, 2, 3)), tmp_path / "l.step")


# -- I13: the uncertainty -------------------------------------------------------------------------------
@pytest.mark.parametrize("unit, per_mm", [("mm", 1.0), ("cm", 0.1), ("m", 0.001), ("um", 1000.0), ("inch", 1 / 25.4)])
def test_step_uncertainty_is_the_same_length_in_any_unit(tmp_path, unit, per_mm):
    # 1e-7 was written in the file's unit: 1e-4 mm in a file in meters, 2.5e-6 mm in inches.
    from smlibpy.step_reader import interpret, parse

    path = tmp_path / "u.step"
    export_step(Box(1, 1, 1), path, unit=unit)
    text = path.read_text()
    value = float(re.search(r"UNCERTAINTY_MEASURE_WITH_UNIT\(LENGTH_MEASURE\(([^)]*)\)", text).group(1))
    assert value == pytest.approx(1e-7 * per_mm, rel=1e-14)
    [(body, _)] = interpret(parse(text))
    assert body.uncertainty == pytest.approx(1e-7, rel=1e-12)  # (mm, as the reader converts it)


# -- X5: analytic edges in USD --------------------------------------------------------------------------
DATA = Path(__file__).resolve().parent / "data"
USD_FILES = Path(__file__).resolve().parent.parent / "third_party" / "usd-brep" / "TestFiles"


def _edge_kinds(body) -> dict[str, int]:
    out: dict[str, int] = {}
    for e in body.edges():
        out[e.geom_type] = out.get(e.geom_type, 0) + 1
    return out


@pytest.mark.parametrize("name, make", [
    ("drilled", lambda: Box(20, 20, 10) - Cylinder(4, 20)),
    ("rounded", lambda: Box(20, 20, 10).fillet(Box(20, 20, 10).edges(), 2)),
    ("slanted", lambda: Cylinder(5, 30) - Box(40, 40, 40).rotate(Y, 30).translate((0, 0, 25))),  # (ellipses)
    ("chamfered", lambda: Box(20, 20, 10).chamfer(Box(20, 20, 10).edges().parallel_to(Z), 2)),  # (straight B-splines)
])
def test_usd_round_trip_keeps_line_circle_and_ellipse_edges(tmp_path, name, make):
    # Every edge was written as a B-spline: circles() came back empty, Edge.radius raised and STEP
    # wrote B-splines. Lines, circles and ellipses are written as the schema's analytic curves.
    part = make()
    export_usd(part.named(name), tmp_path / "p.usda", mesh=False)
    back = import_usd(tmp_path / "p.usda")
    assert _edge_kinds(back) == _edge_kinds(part)
    assert back.volume == pytest.approx(part.volume, rel=1e-12) and back.is_valid()
    assert back.bbox().max == Vector(*part.bbox().max)
    assert sorted(e.radius for e in back.edges().circles()) == pytest.approx(sorted(e.radius for e in part.edges().circles()))
    text = (tmp_path / "p.usda").read_text()
    for kind, api in (("line", "Line"), ("circle", "Circle"), ("ellipse", "Ellipse")):
        if kind in _edge_kinds(part):
            assert f"BrepCurve3d{api}API:edge3d{api}" in text
    export_step(back, tmp_path / "back.step")
    export_step(part, tmp_path / "part.step")
    step, before = (tmp_path / "back.step").read_text(), (tmp_path / "part.step").read_text()
    for entity in ("LINE(", "CIRCLE(", "ELLIPSE("):
        assert step.count(entity) == before.count(entity), entity


def test_usd_edges_of_curved_b_spline_faces_stay_b_splines(tmp_path):
    # (a circle on a face the file has as a B-spline surface: its UV curve follows the B-spline's
    # parameters, which the schema's circle does not keep)
    part = Polygon([(0, 0), (10, 0), (10, 5), (5, 12), (0, 12)]).revolve(axis=Y)
    export_usd(part, tmp_path / "r.usda", mesh=False)
    back = import_usd(tmp_path / "r.usda")
    assert back.volume == pytest.approx(part.volume, rel=1e-12) and back.is_valid()
    assert {f.geom_type for f in back.faces()} == {"plane", "bspline"}
    assert _edge_kinds(back) == {"bspline": 3}


def test_usd_reads_lines_and_circles_of_b_spline_edges():
    # usd-brep and Omniverse write every edge as a B-spline: those that are lines, or circles on faces of
    # analytic surfaces, come back as lines and circles (smlibpy 0.4 wrote this block so, its lines
    # B-splines 2.5 km long)
    back = import_usd(DATA / "usd_bspline_edges.usda")
    assert _edge_kinds(back) == {"line": 12, "circle": 2}
    assert [e.radius for e in back.edges().circles()] == pytest.approx([4, 4])
    assert back.volume == pytest.approx(20 * 20 * 10 - math.pi * 16 * 10, rel=1e-12) and back.is_valid()
    assert back.bbox().max == Vector(10, 10, 5)


@pytest.mark.skipif(not USD_FILES.is_dir(), reason="usd-brep's test files are not checked out")
def test_usd_brep_files_get_their_lines_back():
    files = USD_FILES
    cube = import_usd(files / "brep_validator" / "Cube.usda")
    assert _edge_kinds(cube) == {"line": 12} and cube.is_valid()
    # (OpenCASCADE's cylinder of B-spline faces: its circles stay B-splines, its volume pi * 9 * 10)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # (the kernel's check finds problems with its edgeuses)
        cylinder = import_usd(files / "usd_TestFiles" / "test_wireEdgeTopology_absent.usda", units="mm")
    assert _edge_kinds(cylinder) == {"line": 2, "bspline": 4}
    assert cylinder.volume == pytest.approx(math.pi * 90, rel=1e-6) and cylinder.is_valid()


# -- X7: USD bodies that cannot be read -----------------------------------------------------------------
def _three_bodies(tmp_path) -> Path:
    # a box, a cylinder whose face range turns 60 radians (the kernel cannot build it) and a sphere of
    # radius 0 (malformed), in a file another tool wrote (checked)
    path = tmp_path / "three.usda"
    export_usd([Box(2, 3, 4).named("a"), Cylinder(4, 10).translate((10, 0, 0)).named("c"),
                Sphere(3).translate((20, 0, 0)).named("s")], path, mesh=False)
    text = path.read_text().replace('string source = "smlibpy"', 'string source = "x"')
    text = text.replace("face:range = [(0, 0), (6.283185307179586, 10), ", "face:range = [(0, 0), (60, 10), ", 1)
    text = re.sub(r"(uniform double\[\] brep:surface:sphere:radius = \[)[^\]]+(\])", r"\g<1>0\2", text, count=1)
    path.write_text(text)
    return path


def test_usd_body_the_kernel_cannot_build_is_named_in_the_message(tmp_path):
    # str(KernelError) was "import_usd failed (SM_ERR_INVALID_INPUT)", the body only in .detail
    with pytest.raises(KernelError) as caught:
        import_usd(_three_bodies(tmp_path))
    message = str(caught.value)
    assert 'body 0 of the BrepArray "/World/c" could not be built' in message and "partial=True" in message
    assert message.count("SM_ERR_INVALID_INPUT") == 1 and caught.value.status == "SM_ERR_INVALID_INPUT"


def test_usd_partial_import_leaves_out_what_cannot_be_read(tmp_path):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        back = import_usd(_three_bodies(tmp_path), partial=True)
    assert isinstance(back, Part) and back.name == "a" and back.volume == pytest.approx(24)
    assert _messages(caught) == [
        'import_usd: body 0 of the BrepArray "/World/c" could not be built (SM_ERR_INVALID_INPUT); it is left out',
        'import_usd: body 0 of the BrepArray "/World/s" is malformed: face 0: the sphere\'s radius is 0, not '
        "positive (BA.481); it is left out"]


@pytest.mark.skipif(not USD_FILES.is_dir(), reason="usd-brep's test files are not checked out")
def test_usd_partial_import_takes_the_bodies_of_one_prim_apart(tmp_path):
    # usd-brep's own case: one BrepArray of several bodies, one of them broken (here the first face of
    # the second of its two cubes gets a weight of 0, BA.440)
    text = (USD_FILES / "brep_validator" / "CubeBrepArray.usda").read_text()
    weights = re.search(r"(brep:surface:nurb:weights = \[)([^\]]*)\]", text)
    values = weights.group(2).split(", ")
    values[len(values) // 2] = "0"
    path = tmp_path / "packed.usda"
    path.write_text(text[:weights.start(2)] + ", ".join(values) + text[weights.end(2):])
    with pytest.raises(ValueError, match="body 1, face 0: its NURBS surface has a weight of 0"):
        import_usd(path)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        back = import_usd(path, partial=True)
    assert isinstance(back, Part) and back.name == "brepArray" and back.is_valid()
    assert back.volume == pytest.approx(import_usd(USD_FILES / "brep_validator" / "CubeBrepArray.usda")[0].volume)
    assert [m for m in _messages(caught) if "left out" in m] == [
        'import_usd: body 1 of the BrepArray "/World/brepArray" is malformed: face 0: its NURBS surface has a weight '
        "of 0, not positive (BA.440); it is left out"]  # (and the reference to a file of materials it lacks)


def test_usd_partial_import_of_nothing_readable_raises(tmp_path):
    path = tmp_path / "bad.usda"
    export_usd(Sphere(3).named("s"), path, mesh=False)
    text = re.sub(r"(uniform double\[\] brep:surface:sphere:radius = \[)[^\]]+(\])", r"\g<1>0\2", path.read_text())
    path.write_text(text)
    with pytest.raises(ValueError, match="no body of the file can be read: body 0 of the BrepArray \"/World/s\" is malformed"):
        import_usd(path, partial=True)


# -- I14: IGES import -------------------------------------------------------------------------------------
# The files in tests/data/iges were written by OpenCASCADE 8.0 (IGESControl_Writer) from smlibpy parts:
# block_brep.igs as a solid B-rep (186), the others as trimmed surfaces (144), the way most CAD
# systems write IGES; block_faces_inch.igs in inches.
IGES = DATA / "iges"
DEP = "00010000"  # (the status of an entity that is part of another)


def _iges(entities: list[dict], unit: int = 2, resolution: float = 1e-7) -> str:
    """An IGES file of entities {"type", "params", "form", "transform", "color", "status", "label"};
    ("@", i) in params, transform or color points at entity i (a color: its definition)."""
    def value(v):
        if isinstance(v, tuple):
            return str(2 * v[1] + 1)
        if isinstance(v, str):
            return f"{len(v)}H{v}"
        return repr(v) if isinstance(v, float) else str(v)

    def lines(text: str, letter: str, width: int = 72) -> list[str]:
        return [text[i:i + width].ljust(width) + letter for i in range(0, max(len(text), 1), width)]

    g = ",".join(["1H,", "1H;", "4Htest", "8Htest.igs", "4Htest", "4Htest", "32", "38", "6", "308", "15", "4Htest", "1.",
                  str(unit), "2HMM" if unit == 2 else "4HINCH", "1", "0.01", "15H20260101.000000", repr(resolution),
                  "100.", "4Htest", "4Htest", "11", "0", "15H20260101.000000"]) + ";"
    D, P = [], []
    for i, e in enumerate(entities):
        text = ",".join([str(e["type"])] + [value(v) for v in e["params"]]) + ";"
        chunks = [text[k:k + 64] for k in range(0, len(text), 64)]
        start = len(P) + 1
        P += [c.ljust(64) + " " + str(2 * i + 1).rjust(7) + "P" for c in chunks]
        col = e.get("color", 0)
        col = "-" + value(col) if isinstance(col, tuple) else str(col)
        tr = value(e["transform"]) if "transform" in e else "0"
        D.append("".join(str(x).rjust(8) for x in (e["type"], start, 0, 0, 0, 0, tr, 0)) + e.get("status", "00000000").rjust(8) + "D")
        D.append("".join(str(x).rjust(8) for x in (e["type"], 0, col, len(chunks), e.get("form", 0), "", "")) +
                 e.get("label", "").rjust(8) + "0".rjust(8) + "D")
    sections = [lines("smlibpy test", "S"), lines(g, "G"), D, P]
    numbered = [line + str(k + 1).rjust(7) for sec in sections for k, line in enumerate(sec)]
    counts = "S{:7d}G{:7d}D{:7d}P{:7d}".format(*(len(sec) for sec in sections))
    return "\n".join(numbered + [counts.ljust(72) + "T" + "1".rjust(7)]) + "\n"


def _line(a, b) -> dict:
    return {"type": 110, "params": [float(x) for x in (*a, *b)], "status": DEP}


def _bounded_plane(curves: list[dict], **extra) -> list[dict]:
    """A bounded plane (108) z = 0 whose boundary is a composite (102) of the curves."""
    return [{"type": 108, "form": 1, "params": [0., 0., 1., 0., ("@", 1), 0., 0., 0., 0.], **extra},
            {"type": 102, "params": [len(curves)] + [("@", 2 + i) for i in range(len(curves))], "status": DEP}] + curves


def _read_iges(tmp_path, entities, **kw):
    path = tmp_path / "t.igs"
    path.write_text(_iges(entities, **kw))
    return import_iges(path)


def test_iges_solid_brep_object(tmp_path):
    # a manifold solid B-rep object (186): its faces share their edges as the file has them
    part = import_iges(IGES / "block_brep.igs")
    assert isinstance(part, Part) and part.is_valid()
    assert part.volume == pytest.approx(4000 - math.pi * 16 * 10, rel=1e-12)
    assert sorted(f.geom_type for f in part.faces()) == ["cylinder"] + ["plane"] * 6
    assert sorted(e.geom_type for e in part.edges()) == ["circle"] * 2 + ["line"] * 12
    assert load(IGES / "block_brep.igs").volume == pytest.approx(part.volume)


@pytest.mark.parametrize("name, volume, faces", [
    ("block_faces_inch.igs", 4000 - math.pi * 16 * 10, 7),  # (mirrored surfaces of revolution, inches)
    ("torus_faces.igs", 2 * math.pi ** 2 * 10 * 4, 1),  # (its seams: two closed curves, each used twice)
    ("vase_faces.igs", 934.8130160051498, 3),  # (a B-spline revolved; OpenCASCADE's volume)
])
def test_iges_trimmed_surfaces_are_stitched_into_solids(name, volume, faces):
    part = import_iges(IGES / name)
    assert isinstance(part, Part) and part.is_valid() and len(part.faces()) == faces
    assert part.volume == pytest.approx(volume, rel=1e-8)  # (the inch file has 10 digits)


def test_iges_block_faces_keep_their_surfaces_and_edges():
    part = import_iges(IGES / "block_faces_inch.igs")
    assert sorted(f.geom_type for f in part.faces()) == ["cylinder"] + ["plane"] * 6
    assert sorted(e.geom_type for e in part.edges()) == ["circle"] * 2 + ["line"] * 12
    assert part.bbox().max.to_tuple() == pytest.approx((10, 10, 5), abs=1e-6)


def test_iges_curves_of_every_kind_bound_faces(tmp_path):
    # a parabola (104 form 3) y = x^2 / 4 closed by a line: area 8/3
    par = {"type": 104, "form": 3, "params": [0.25, 0., 0., 0., -1., 0., 0., -2., 1., 2., 1.], "status": DEP}
    assert _read_iges(tmp_path, _bounded_plane([par, _line((2, 1, 0), (-2, 1, 0))])).area == pytest.approx(8 / 3)
    # half an ellipse (104 form 1) turned by 30 degrees, from its equation: area 4 pi
    c, s = math.cos(math.radians(30)), math.sin(math.radians(30))
    A, B, C = c * c / 16 + s * s / 4, 2 * c * s / 16 - 2 * s * c / 4, s * s / 16 + c * c / 4
    ell = {"type": 104, "form": 1, "params": [A, B, C, 0., 0., -1., 0., 4 * c, 4 * s, -4 * c, -4 * s], "status": DEP}
    assert _read_iges(tmp_path, _bounded_plane([ell, _line((-4 * c, -4 * s, 0), (4 * c, 4 * s, 0))])).area == \
        pytest.approx(4 * math.pi, rel=1e-6)
    # a hyperbola (104 form 2) x^2 - y^2 = 1 cut by x = cosh 1: area sinh 1 cosh 1 - 1
    ch, sh = math.cosh(1), math.sinh(1)
    hyp = {"type": 104, "form": 2, "params": [1., 0., -1., 0., 0., -1., 0., ch, -sh, ch, sh], "status": DEP}
    assert _read_iges(tmp_path, _bounded_plane([hyp, _line((ch, sh, 0), (ch, -sh, 0))])).area == pytest.approx(sh * ch - 1)
    # a linear path (106 form 12): a triangle of area 9
    tri = {"type": 106, "form": 12, "params": [2, 4, 0., 0., 0., 6., 0., 0., 0., 3., 0., 0., 0., 0.], "status": DEP}
    assert _read_iges(tmp_path, _bounded_plane([tri])).area == pytest.approx(9)
    # a parametric spline (112) y = 4x - x^2 over [0, 4]: area 32/3
    spl = {"type": 112, "params": [3, 1, 2, 1, 0., 4., 0., 1., 0., 0., 0., 4., -1., 0., 0., 0., 0., 0.] + [0.] * 12,
           "status": DEP}
    assert _read_iges(tmp_path, _bounded_plane([spl, _line((4, 0, 0), (0, 0, 0))])).area == pytest.approx(32 / 3)


def _square(z: float = 0.0, w: float = 10.0, h: float = 5.0, clockwise: bool = False) -> list[dict]:
    pts = [(0, 0, z), (w, 0, z), (w, h, z), (0, h, z)]
    if clockwise:
        pts = pts[::-1]
    return [_line(pts[i], pts[(i + 1) % 4]) for i in range(4)]


def test_iges_surfaces_of_every_kind(tmp_path):
    # an untrimmed B-spline surface (128) on its own, and as a trimmed surface of all of itself
    bilinear = {"type": 128, "params": [1, 1, 1, 1, 0, 0, 1, 0, 0, 0., 0., 1., 1., 0., 0., 1., 1., 1., 1., 1., 1.,
                                        0., 0., 0., 10., 0., 0., 0., 20., 0., 10., 20., 0., 0., 1., 0., 1.]}
    assert _read_iges(tmp_path, [bilinear]).area == pytest.approx(200)
    assert _read_iges(tmp_path, [{"type": 144, "params": [("@", 1), 0, 0, 0]}, dict(bilinear, status=DEP)]).area == \
        pytest.approx(200)
    # a parametric spline surface (114): one bicubic patch, the plane x = 10 s, y = 20 t
    coef = [0.] * 48
    coef[1], coef[16 + 4] = 10.0, 20.0
    sheet = _read_iges(tmp_path, [{"type": 114, "params": [3, 1, 1, 1, 0., 1., 0., 1.] + coef + [0.] * 144}])
    assert sheet.area == pytest.approx(200)
    # a bounded surface (143) with a boundary (141) one of whose curves runs the other way (sense 2)
    sq = [(0, 0, 0), (10, 0, 0), (10, 5, 0), (0, 5, 0)]
    bounded = [{"type": 143, "params": [0, ("@", 1), 1, ("@", 2)]},
               {"type": 108, "params": [0., 0., 1., 0., 0, 0., 0., 0., 0.], "status": DEP},
               {"type": 141, "params": [0, 0, ("@", 1), 4, ("@", 3), 1, 0, ("@", 4), 2, 0, ("@", 5), 1, 0, ("@", 6), 1, 0],
                "status": DEP},
               _line(sq[0], sq[1]), _line(sq[2], sq[1]), _line(sq[2], sq[3]), _line(sq[3], sq[0])]
    assert _read_iges(tmp_path, bounded).area == pytest.approx(50)


@pytest.mark.parametrize("backwards", [1, 0])
def test_iges_ruled_surface(tmp_path, backwards):
    # a ruled surface (118) between a line and a straight B-spline of degree 2 (the strip from y = 0,
    # z = 0 to y = 5, z = 3: 10 x 5.83), trimmed by its four sides; the second curve given the other
    # way round with the flag that says so (or the same way without it): read without the flag, the
    # strip would be twisted
    a, b = (10.0, 5.0, 3.0), (0.0, 5.0, 3.0)
    if not backwards:
        a, b = b, a
    spline = {"type": 126, "params": [2, 2, 1, 0, 1, 0, 0., 0., 0., 1., 1., 1., 1., 1., 1.,
                                      *a, *((x + y) / 2 for x, y in zip(a, b)), *b, 0., 1., 0., 0., 0.], "status": DEP}
    corners = [(0, 0, 0), (10, 0, 0), (10, 5, 3), (0, 5, 3)]
    ents = [{"type": 144, "params": [("@", 1), 1, 0, ("@", 4)]},
            {"type": 118, "form": 1, "params": [("@", 2), ("@", 3), backwards, 0], "status": DEP},
            _line((0, 0, 0), (10, 0, 0)), spline,
            {"type": 142, "params": [0, ("@", 1), 0, ("@", 5), 2], "status": DEP},
            {"type": 102, "params": [4, ("@", 6), ("@", 7), ("@", 8), ("@", 9)], "status": DEP}] + \
        [_line(corners[i], corners[(i + 1) % 4]) for i in range(4)]
    sheet = _read_iges(tmp_path, ents)
    assert sheet.area == pytest.approx(10 * math.sqrt(34), rel=1e-9)
    assert [f.geom_type for f in sheet.faces()] in (["plane"], ["bspline"])


def test_iges_boundaries_of_either_orientation(tmp_path):
    # IGES does not hold writers to an orientation of a boundary: a hole whose loop runs the way the
    # outer loop does is still a hole, and an outer loop that runs clockwise still bounds the face
    def holed(outer: list[dict]) -> list[dict]:
        return [{"type": 144, "params": [("@", 1), 1, 1, ("@", 2), ("@", 8)]},
                {"type": 108, "params": [0., 0., 1., 0., 0, 0., 0., 0., 0.], "status": DEP},
                {"type": 142, "params": [0, ("@", 1), 0, ("@", 3), 2], "status": DEP},
                {"type": 102, "params": [4, ("@", 4), ("@", 5), ("@", 6), ("@", 7)], "status": DEP}] + outer + \
               [{"type": 142, "params": [0, ("@", 1), 0, ("@", 9), 2], "status": DEP},
                {"type": 100, "params": [0., 5., 2.5, 6., 2.5, 6., 2.5], "status": DEP}]  # (counterclockwise)
    for outer in (_square(), _square(clockwise=True)):
        assert _read_iges(tmp_path, holed(outer)).area == pytest.approx(50 - math.pi)


def test_iges_names_colors_transforms_and_subfigures(tmp_path):
    # a name property (406 form 15), a color definition (314) and a transformation in a
    # transformation (124: turned by 90 degrees about z and moved by 100 in x, then moved by 7 in z)
    plate = _bounded_plane(_square(), color=("@", 7), transform=("@", 8))
    plate[0]["params"] += [0, 1, ("@", 6)]
    plate += [{"type": 406, "form": 15, "params": [1, "Deckel"], "status": DEP},
              {"type": 314, "params": [100., 50., 0., "ORANGE"], "status": DEP},
              {"type": 124, "params": [0., -1., 0., 100., 1., 0., 0., 0., 0., 0., 1., 0.], "transform": ("@", 9),
               "status": DEP},
              {"type": 124, "params": [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 7.], "status": DEP}]
    sheet = _read_iges(tmp_path, plate)
    assert sheet.name == "Deckel" and sheet.color == pytest.approx((1.0, 0.5, 0.0))
    box = sheet.bbox()
    assert box.min.to_tuple() == pytest.approx((95, 0, 7)) and box.max.to_tuple() == pytest.approx((100, 10, 7))
    # a subfigure (308) placed twice (408): moved, and moved and scaled by 2
    sub = [{"type": 408, "params": [("@", 2), 100., 0., 0., 1.]},
           {"type": 408, "params": [("@", 2), 0., 100., 0., 2.]},
           {"type": 308, "params": [0, "PLATE", 1, ("@", 3)], "status": "00020200"}] + \
        [dict(e, params=[("@", v[1] + 3) if isinstance(v, tuple) else v for v in e["params"]])
         for e in _bounded_plane(_square())]
    sub[3]["status"] = DEP
    a, b = _read_iges(tmp_path, sub)
    assert (a.area, b.area) == pytest.approx((50, 200))
    assert a.bbox().min.to_tuple() == pytest.approx((100, 0, 0)) and b.bbox().max.to_tuple() == pytest.approx((20, 110, 0))


def test_iges_parameter_space_boundary_on_a_b_spline_surface(tmp_path):
    # a bilinear patch over [0, 10] x [0, 20] trimmed by a triangle given in its parameters only
    # (its corners (0, 0), (1, 0), (0, 1): half the patch)
    patch = {"type": 128, "params": [1, 1, 1, 1, 0, 0, 1, 0, 0, 0., 0., 1., 1., 0., 0., 1., 1., 1., 1., 1., 1.,
                                     0., 0., 0., 10., 0., 0., 0., 20., 0., 10., 20., 0., 0., 1., 0., 1.], "status": DEP}
    uv = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    ents = [{"type": 144, "params": [("@", 1), 1, 0, ("@", 2)]}, patch,
            {"type": 142, "params": [1, ("@", 1), ("@", 3), 0, 1], "status": DEP},
            {"type": 102, "params": [3, ("@", 4), ("@", 5), ("@", 6)], "status": DEP}] + \
           [dict(_line(uv[i], uv[(i + 1) % 3]), status="00010500") for i in range(3)]
    sheet = _read_iges(tmp_path, ents)
    assert sheet.area == pytest.approx(100, rel=1e-6)
    assert sheet.bbox().max.to_tuple() == pytest.approx((10, 20, 0), abs=1e-6)


def test_iges_what_cannot_be_read_is_left_out(tmp_path):
    # a trimmed surface whose surface is no surface (a point, 116), and a good one
    bad = [{"type": 144, "params": [("@", 1), 1, 0, ("@", 2)], "label": "ODD"},
           {"type": 116, "params": [0., 0., 0.], "status": DEP},
           {"type": 142, "params": [0, ("@", 1), 0, ("@", 3), 2], "status": DEP}]
    good = [dict(e, params=[("@", v[1] + 3) if isinstance(v, tuple) else v for v in e["params"]])
            for e in _bounded_plane(_square())]
    path = tmp_path / "t.igs"
    path.write_text(_iges(bad + good))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        sheet = import_iges(path)
    assert sheet.area == pytest.approx(50)
    assert _messages(caught) == ["import IGES: left out trimmed surface 'ODD' (DE 1): surface entity 116 (DE 3), which "
                                 "is not supported"]
    with pytest.raises(ModelingError, match=r"import IGES: trimmed surface 'ODD' \(DE 1\): surface entity 116"):
        import_iges(path, strict=True)
    path.write_text(_iges(bad))
    with pytest.raises(ModelingError, match="nothing in the file could be read: trimmed surface 'ODD'"):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            import_iges(path)


def test_iges_files_it_does_not_read(tmp_path):
    (tmp_path / "a.igs").write_text("not iges at all\n")
    with pytest.raises(ValueError, match="not an IGES file"):
        import_iges(tmp_path / "a.igs")
    text = (IGES / "torus_faces.igs").read_text()
    (tmp_path / "b.igs").write_text(text.replace("S0000001", "B0000001", 1))
    with pytest.raises(ValueError, match="binary or compressed IGES"):
        import_iges(tmp_path / "b.igs")
    with pytest.raises(ModelingError, match="holds no solids or surfaces"):
        _read_iges(tmp_path, [_line((0, 0, 0), (1, 0, 0)) | {"status": "00000000"}])
    with pytest.raises(ValueError, match="load reads .step, .stp, .igs, .iges"):
        load(tmp_path / "c.xyz")
