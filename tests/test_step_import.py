import math
import re

import pytest

from smlibpy import *
from smlibpy.colors import to_hex


@pytest.fixture
def plate():
    p = Box(80, 60, 10)
    p = p.fillet(p.edges().parallel_to(Z), 8)
    p = p - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)
    return p.named("plate").colored("steelblue")


@pytest.mark.parametrize("name,shape", [
    ("plate", None),
    ("sphere", Sphere(10)),
    ("torus", Torus(20, 5)),
    ("cone", Cone(10, 0, 15)),
    ("hollow", Box(20, 20, 20) - Sphere(5)),
    ("g2", Box(30, 20, 10).fillet(Box(30, 20, 10).edges(), 2, continuity="G2")),
    ("loft", loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)])),
    ("revolved", revolve(Rectangle(4, 10).translate(12, 0), Axis.Y, 270)),
])
def test_step_roundtrip(tmp_path, plate, name, shape):
    shape = plate if shape is None else shape
    path = tmp_path / f"{name}.step"
    export_step(shape, path)
    back = import_step(path)
    assert isinstance(back, Part) and back.is_valid()
    assert back.volume == pytest.approx(shape.volume, rel=1e-6)
    assert len(back.faces()) == len(shape.faces())


def test_step_keeps_names_colors_and_parts(tmp_path, plate):
    cover = Box(80, 60, 2).translate(0, 0, 12).named("cover").colored("#d9925a")
    path = tmp_path / "assembly.step"
    export_step([plate, cover], path)
    back = load(path)
    assert [p.name for p in back] == ["plate", "cover"]
    assert to_hex(back[0].color) == to_hex(plate.color)
    assert back[1].bbox().min.z == pytest.approx(11)  # boxes are centered


@pytest.mark.parametrize("unit,mm", [("inch", 25.4), ("cm", 10.0), ("m", 1000.0), ("um", 0.001)])
def test_step_writes_coordinates_in_the_declared_unit(tmp_path, unit, mm):
    path = tmp_path / f"{unit}.step"
    export_step(Box(1, 2, 3).translate(25.4, 0, 0), path, unit=unit)
    xs = [float(m) for m in re.findall(r"CARTESIAN_POINT\('',\(([^,]+),", path.read_text())]
    assert max(xs) == pytest.approx(25.9 / mm, rel=1e-12)  # the corner at x = 25.9 mm
    back = import_step(path)  # converted back to mm
    assert back.volume == pytest.approx(6, rel=1e-9)
    assert back.bbox().max.x == pytest.approx(25.9, rel=1e-12)


def _step(entities: list[str]) -> str:
    """A minimal AP214 file in millimeters around the numbered entities."""
    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"
            "FILE_NAME('test','2026-01-01T00:00:00',(''),(''),'','','');\n"
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n")
    units = [
        "#900=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));",
        "#901=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));",
        "#902=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());",
        "#903=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#900,#901,#902))"
        "REPRESENTATION_CONTEXT('',''));",
        "#904=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#99),#903);",
    ]
    return head + "\n".join(entities + units) + "\nENDSEC;\nEND-ISO-10303-21;\n"


def _cylinder(seam_at: float | None) -> str:
    """Radius 10, height 20. ``seam_at`` None: the side face is bounded by its two circles
    only (as NX writes it), otherwise by a seam line at that angle."""
    return _step(_cylinder_entities(seam_at))


def _cylinder_entities(seam_at: float | None) -> list[str]:
    e = [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,1.));", "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);", "#5=CARTESIAN_POINT('',(0.,0.,20.));",
        "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);", "#7=CYLINDRICAL_SURFACE('',#4,10.);",
        "#8=PLANE('',#4);", "#9=PLANE('',#6);",
    ]
    a = math.radians(seam_at or 0.0)
    x, y = 10 * math.cos(a), 10 * math.sin(a)
    # circles start at their vertex: give them a reference direction pointing there
    e += [f"#10=DIRECTION('',({math.cos(a)},{math.sin(a)},0.));", "#11=AXIS2_PLACEMENT_3D('',#1,#2,#10);",
          "#12=AXIS2_PLACEMENT_3D('',#5,#2,#10);", "#13=CIRCLE('',#11,10.);", "#14=CIRCLE('',#12,10.);",
          f"#15=CARTESIAN_POINT('',({x},{y},0.));", f"#16=CARTESIAN_POINT('',({x},{y},20.));",
          "#17=VERTEX_POINT('',#15);", "#18=VERTEX_POINT('',#16);",
          "#19=EDGE_CURVE('',#17,#17,#13,.T.);", "#20=EDGE_CURVE('',#18,#18,#14,.T.);",
          # bottom (normal -z): the circle backwards; top (normal +z): forwards
          "#21=ORIENTED_EDGE('',*,*,#19,.F.);", "#22=EDGE_LOOP('',(#21));", "#23=FACE_OUTER_BOUND('',#22,.T.);",
          "#24=ADVANCED_FACE('',(#23),#8,.F.);",
          "#25=ORIENTED_EDGE('',*,*,#20,.T.);", "#26=EDGE_LOOP('',(#25));", "#27=FACE_OUTER_BOUND('',#26,.T.);",
          "#28=ADVANCED_FACE('',(#27),#9,.T.);",
          "#29=ORIENTED_EDGE('',*,*,#19,.T.);", "#30=ORIENTED_EDGE('',*,*,#20,.F.);"]
    if seam_at is None:
        e += ["#31=EDGE_LOOP('',(#29));", "#32=EDGE_LOOP('',(#30));", "#33=FACE_BOUND('',#31,.T.);",
              "#34=FACE_BOUND('',#32,.T.);", "#35=ADVANCED_FACE('',(#33,#34),#7,.T.);"]
    else:
        e += [f"#40=DIRECTION('',(0.,0.,1.));", "#41=VECTOR('',#40,1.);", "#42=LINE('',#15,#41);",
              "#43=EDGE_CURVE('',#17,#18,#42,.T.);", "#44=ORIENTED_EDGE('',*,*,#43,.T.);",
              "#45=ORIENTED_EDGE('',*,*,#43,.F.);", "#31=EDGE_LOOP('',(#29,#44,#30,#45));",
              "#33=FACE_OUTER_BOUND('',#31,.T.);", "#35=ADVANCED_FACE('',(#33),#7,.T.);"]
    e += ["#98=CLOSED_SHELL('',(#24,#28,#35));", "#99=MANIFOLD_SOLID_BREP('cylinder',#98);"]
    return e


@pytest.mark.parametrize("seam_at", [None, 0.0, 180.0, 117.0])
def test_step_periodic_faces_with_and_without_seam(tmp_path, seam_at):
    path = tmp_path / "cylinder.step"
    path.write_text(_cylinder(seam_at))
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(math.pi * 100 * 20, rel=1e-6)
    side = part.faces().cylinders()[0]
    assert side.area == pytest.approx(2 * math.pi * 10 * 20, rel=1e-6)


def test_step_cone_tip_given_by_a_vertex(tmp_path):
    """A cone face bounded by its base circle and the apex as a vertex loop (NX)."""
    e = [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,-1.));", "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);", f"#5=CONICAL_SURFACE('',#4,10.,{math.atan(0.5)});",
        "#6=PLANE('',#4);", "#7=CIRCLE('',#4,10.);", "#8=CARTESIAN_POINT('',(10.,0.,0.));",
        "#9=VERTEX_POINT('',#8);", "#10=EDGE_CURVE('',#9,#9,#7,.T.);",
        "#11=CARTESIAN_POINT('',(0.,0.,20.));", "#12=VERTEX_POINT('',#11);",
        # base plane: its normal is -z already, the circle runs counterclockwise about it
        "#13=ORIENTED_EDGE('',*,*,#10,.T.);", "#14=EDGE_LOOP('',(#13));", "#15=FACE_OUTER_BOUND('',#14,.T.);",
        "#16=ADVANCED_FACE('',(#15),#6,.T.);",
        "#17=ORIENTED_EDGE('',*,*,#10,.F.);", "#18=EDGE_LOOP('',(#17));", "#19=FACE_OUTER_BOUND('',#18,.T.);",
        "#20=VERTEX_LOOP('',#12);", "#21=FACE_BOUND('',#20,.T.);", "#22=ADVANCED_FACE('',(#19,#21),#5,.T.);",
        "#98=CLOSED_SHELL('',(#16,#22));", "#99=MANIFOLD_SOLID_BREP('cone',#98);",
    ]
    path = tmp_path / "cone.step"
    path.write_text(_step(e))
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(math.pi * 100 * 20 / 3, rel=1e-6)


def test_step_reports_files_without_bodies(tmp_path):
    path = tmp_path / "empty.step"
    path.write_text(_step(["#99=CARTESIAN_POINT('',(0.,0.,0.));"]))
    with pytest.raises(ModelingError, match="no B-rep"):
        import_step(path)


@pytest.mark.parametrize("name", ["box_with_hole", "sphere", "torus", "cone", "bspline"])
def test_step_from_opencascade(tmp_path, name):
    """Files written by another kernel: OpenCASCADE puts seams and orientations its own way."""
    pytest.importorskip("OCP.STEPControl")
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepGProp import BRepGProp
    from OCP.BRepPrimAPI import (BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder,
                                 BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeTorus)
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
    from OCP.GProp import GProp_GProps
    from OCP.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt
    from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer

    if name == "box_with_hole":
        shape = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(40.0, 30.0, 10.0).Shape(),
                                BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, -1), gp_Dir(0, 0, 1)), 6.0, 12.0).Shape()).Shape()
    elif name == "sphere":
        shape = BRepPrimAPI_MakeSphere(12.0).Shape()
    elif name == "torus":
        shape = BRepPrimAPI_MakeTorus(20.0, 6.0).Shape()
    elif name == "cone":
        shape = BRepPrimAPI_MakeCone(10.0, 4.0, 15.0).Shape()
    else:
        loft = BRepOffsetAPI_ThruSections(True, False)
        for z, r in ((0, 10.0), (12, 6.0), (25, 9.0)):
            circ = gp_Circ(gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), r)
            loft.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circ).Edge()).Wire())
        shape = loft.Shape()
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props, 1e-9, False, False)
    writer = STEPControl_Writer()
    writer.Transfer(shape, STEPControl_AsIs)
    path = tmp_path / f"{name}.step"
    writer.Write(str(path))
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(props.Mass(), rel=1e-6)


def _assembly_like_autocad(tmp_path) -> str:
    """Two instances of one part in an assembly built the way AutoCAD writes it: the
    identity placement is listed in the root's representation and in the part's, and
    every ITEM_DEFINED_TRANSFORMATION names it first (CAx-IF: item 1 in the child)."""
    part = tmp_path / "part.step"
    export_step(Box(20, 10, 4).named("plate"), part)
    lines = part.read_text().split("DATA;\n")[1].split("ENDSEC;")[0].splitlines()
    drop = ("APPLICATION_", "PRODUCT", "SHAPE_DEFINITION_REPRESENTATION")
    geometry = [ln for ln in lines if not any(d in ln.split("=", 1)[1][:40] for d in drop)]
    absr = next(ln.split("=")[0] for ln in lines if "ADVANCED_BREP_SHAPE_REPRESENTATION" in ln)
    ctx = next(ln.split("=")[0] for ln in lines if "GEOMETRIC_REPRESENTATION_CONTEXT" in ln)

    def placement(n: int, origin: str, x_dir: str) -> list[str]:
        return [f"#{n}=CARTESIAN_POINT('',({origin}));", f"#{n + 1}=DIRECTION('',(0.,0.,1.));",
                f"#{n + 2}=DIRECTION('',({x_dir}));", f"#{n + 3}=AXIS2_PLACEMENT_3D('',#{n},#{n + 1},#{n + 2});"]

    def product(n: int, name: str, rep_items: str) -> list[str]:
        return [f"#{n}=PRODUCT('{name}','{name}','',(#1001));", f"#{n + 1}=PRODUCT_DEFINITION_FORMATION('','',#{n});",
                f"#{n + 2}=PRODUCT_DEFINITION('','',#{n + 1},#1002);",
                f"#{n + 3}=SHAPE_REPRESENTATION('',({rep_items}),{ctx});",
                f"#{n + 4}=PRODUCT_DEFINITION_SHAPE('','',#{n + 2});",
                f"#{n + 5}=SHAPE_DEFINITION_REPRESENTATION(#{n + 4},#{n + 3});"]

    def instance(n: int, at: int) -> list[str]:
        return [f"#{n}=ITEM_DEFINED_TRANSFORMATION('','',#1006,#{at});",
                f"#{n + 1}=(REPRESENTATION_RELATIONSHIP(' ',$,#1023,#1013)"
                f"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#{n})SHAPE_REPRESENTATION_RELATIONSHIP());",
                f"#{n + 2}=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#1012,#1022,$);",
                f"#{n + 3}=PRODUCT_DEFINITION_SHAPE('','',#{n + 2});",
                f"#{n + 4}=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#{n + 1},#{n + 3});"]

    e = geometry + [
        "#1000=APPLICATION_CONTEXT('automotive design');", "#1001=PRODUCT_CONTEXT('',#1000,'mechanical');",
        "#1002=PRODUCT_DEFINITION_CONTEXT('part definition',#1000,'design');",
        *placement(1003, "0.,0.,0.", "1.,0.,0."),                                   # #1006: identity
        *product(1010, "ASM", "#1006,#1033,#1043"), *product(1020, "PLATE", "#1006"),
        f"#1026=SHAPE_REPRESENTATION_RELATIONSHIP('','',{absr},#1023);",
        *placement(1030, "90.,75.,10.", "1.,0.,0."), *placement(1040, "-50.,20.,0.", "0.,1.,0."),
        *instance(1050, 1033), *instance(1060, 1043),
    ]
    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"
            "FILE_NAME('asm','2026-01-01T00:00:00',(''),(''),'','','');\n"
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n")
    return head + "\n".join(e) + "\nENDSEC;\nEND-ISO-10303-21;\n"


def test_step_assembly_placement_listed_in_both_representations(tmp_path):
    path = tmp_path / "asm.step"
    path.write_text(_assembly_like_autocad(tmp_path))
    parts = sorted(import_step(path), key=lambda p: p.bbox().min.x)
    assert len(parts) == 2
    a, b = parts[0].bbox(), parts[1].bbox()
    # the second instance is turned 90 degrees about Z and sits at (-50, 20, 0)
    assert a.min.to_tuple() == pytest.approx((-55, 10, -2), abs=1e-6)
    assert a.max.to_tuple() == pytest.approx((-45, 30, 2), abs=1e-6)
    assert b.min.to_tuple() == pytest.approx((80, 70, 8), abs=1e-6)
    assert b.max.to_tuple() == pytest.approx((100, 80, 12), abs=1e-6)


def test_step_unnamed_solid_takes_the_product_name(tmp_path):
    path = tmp_path / "widget.step"
    export_step(Box(5, 5, 5), path)
    text = path.read_text()
    assert "MANIFOLD_SOLID_BREP('widget'" in text and "PRODUCT('widget','widget'" in text
    path.write_text(text.replace("MANIFOLD_SOLID_BREP('widget'", "MANIFOLD_SOLID_BREP(''")
                    .replace("PRODUCT('widget','widget'", "PRODUCT('W-1','Widget'"))
    assert import_step(path).name == "Widget"


# -- faces NX writes: extruded ellipses, periodic faces without seams --------------------------
def _elliptic_cylinder() -> str:
    """Semi-axes 6 and 3, height 10: the side face is a SURFACE_OF_LINEAR_EXTRUSION of an
    ELLIPSE, bounded by its two ellipses only (as NX writes small roundings)."""
    e = [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,1.));", "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);", "#5=CARTESIAN_POINT('',(0.,0.,10.));",
        "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);", "#7=ELLIPSE('',#4,6.,3.);", "#8=ELLIPSE('',#6,6.,3.);",
        "#9=VECTOR('',#2,10.);", "#10=SURFACE_OF_LINEAR_EXTRUSION('',#7,#9);",
        "#11=PLANE('',#4);", "#12=PLANE('',#6);",
        "#13=CARTESIAN_POINT('',(6.,0.,0.));", "#14=CARTESIAN_POINT('',(6.,0.,10.));",
        "#15=VERTEX_POINT('',#13);", "#16=VERTEX_POINT('',#14);",
        "#17=EDGE_CURVE('',#15,#15,#7,.T.);", "#18=EDGE_CURVE('',#16,#16,#8,.T.);",
        "#21=ORIENTED_EDGE('',*,*,#17,.F.);", "#22=EDGE_LOOP('',(#21));", "#23=FACE_OUTER_BOUND('',#22,.T.);",
        "#24=ADVANCED_FACE('',(#23),#11,.F.);",
        "#25=ORIENTED_EDGE('',*,*,#18,.T.);", "#26=EDGE_LOOP('',(#25));", "#27=FACE_OUTER_BOUND('',#26,.T.);",
        "#28=ADVANCED_FACE('',(#27),#12,.T.);",
        "#29=ORIENTED_EDGE('',*,*,#17,.T.);", "#30=ORIENTED_EDGE('',*,*,#18,.F.);",
        "#31=EDGE_LOOP('',(#29));", "#32=EDGE_LOOP('',(#30));", "#33=FACE_BOUND('',#31,.T.);",
        "#34=FACE_BOUND('',#32,.T.);", "#35=ADVANCED_FACE('',(#33,#34),#10,.T.);",
        "#98=CLOSED_SHELL('',(#24,#28,#35));", "#99=MANIFOLD_SOLID_BREP('ellipse',#98);",
    ]
    return _step(e)


def test_step_extruded_ellipse(tmp_path):
    path = tmp_path / "ellipse.step"
    path.write_text(_elliptic_cylinder())
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(math.pi * 6 * 3 * 10, rel=1e-6)
    [side] = [f for f in part.faces() if f.geom_type == "extrusion"]
    perimeter = EllipticalArc((0, 0), 6, 3).length
    assert side.area == pytest.approx(perimeter * 10, rel=1e-6)
    assert part.mesh().volume == pytest.approx(part.volume, rel=2e-2)


def test_step_cylinder_band_ending_in_an_open_loop(tmp_path):
    """A cylinder face bounded by a circle at one end and two arcs at the other, without a
    seam edge (NX writes a shank with a flat so): the kernel needs the seam added."""
    e = [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,1.));", "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);", "#5=CARTESIAN_POINT('',(0.,0.,20.));",
        "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);", "#7=CYLINDRICAL_SURFACE('',#4,10.);",
        "#8=PLANE('',#4);", "#9=PLANE('',#6);", "#10=CIRCLE('',#4,10.);", "#11=CIRCLE('',#6,10.);",
        "#12=CARTESIAN_POINT('',(10.,0.,0.));", "#13=VERTEX_POINT('',#12);",
        "#14=CARTESIAN_POINT('',(10.,0.,20.));", "#15=VERTEX_POINT('',#14);",
        "#16=CARTESIAN_POINT('',(-10.,0.,20.));", "#17=VERTEX_POINT('',#16);",
        "#18=EDGE_CURVE('',#13,#13,#10,.T.);",
        "#19=EDGE_CURVE('',#15,#17,#11,.T.);", "#20=EDGE_CURVE('',#17,#15,#11,.T.);",
        "#21=ORIENTED_EDGE('',*,*,#18,.F.);", "#22=EDGE_LOOP('',(#21));", "#23=FACE_OUTER_BOUND('',#22,.T.);",
        "#24=ADVANCED_FACE('',(#23),#8,.F.);",
        "#25=ORIENTED_EDGE('',*,*,#19,.T.);", "#26=ORIENTED_EDGE('',*,*,#20,.T.);",
        "#27=EDGE_LOOP('',(#25,#26));", "#28=FACE_OUTER_BOUND('',#27,.T.);", "#29=ADVANCED_FACE('',(#28),#9,.T.);",
        "#30=ORIENTED_EDGE('',*,*,#18,.T.);", "#31=EDGE_LOOP('',(#30));", "#32=FACE_BOUND('',#31,.T.);",
        "#33=ORIENTED_EDGE('',*,*,#20,.F.);", "#34=ORIENTED_EDGE('',*,*,#19,.F.);",
        "#35=EDGE_LOOP('',(#33,#34));", "#36=FACE_BOUND('',#35,.T.);", "#37=ADVANCED_FACE('',(#32,#36),#7,.T.);",
        "#98=CLOSED_SHELL('',(#24,#29,#37));", "#99=MANIFOLD_SOLID_BREP('band',#98);",
    ]
    path = tmp_path / "band.step"
    path.write_text(_step(e))
    part = import_step(path)
    assert part.is_valid()
    props = part._props()
    assert props["field_volumes"] == pytest.approx([math.pi * 100 * 20] * 3, rel=1e-6)
    assert part.faces().cylinders()[0].area == pytest.approx(2 * math.pi * 10 * 20, rel=1e-6)
    assert part.mesh().volume == pytest.approx(part.volume, rel=2e-2)


def _torus_entities(R: float, r: float) -> list[str]:
    return ["#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,1.));", "#3=DIRECTION('',(1.,0.,0.));",
            "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);", f"#5=TOROIDAL_SURFACE('',#4,{R},{r});"]


def test_step_torus_patch_across_the_outer_equator(tmp_path):
    """A torus face over u in [0, 90] and v in [-45, 45] degrees: it crosses v = 0, where the
    kernel's torus has its seam around the tube."""
    R, r, v = 20.0, 5.0, math.pi / 4
    s, c = math.sin(v), math.cos(v)
    e = _torus_entities(R, r) + [
        f"#10=CARTESIAN_POINT('',({R + r * c},0.,{-r * s}));", f"#11=CARTESIAN_POINT('',(0.,{R + r * c},{-r * s}));",
        f"#12=CARTESIAN_POINT('',(0.,{R + r * c},{r * s}));", f"#13=CARTESIAN_POINT('',({R + r * c},0.,{r * s}));",
        "#14=VERTEX_POINT('',#10);", "#15=VERTEX_POINT('',#11);", "#16=VERTEX_POINT('',#12);", "#17=VERTEX_POINT('',#13);",
        # the parallels v = -45 and v = 45
        f"#20=CARTESIAN_POINT('',(0.,0.,{-r * s}));", "#21=AXIS2_PLACEMENT_3D('',#20,#2,#3);", f"#22=CIRCLE('',#21,{R + r * c});",
        f"#23=CARTESIAN_POINT('',(0.,0.,{r * s}));", "#24=AXIS2_PLACEMENT_3D('',#23,#2,#3);", f"#25=CIRCLE('',#24,{R + r * c});",
        # the meridians u = 0 and u = 90 (tube circles; their angle runs against v)
        f"#30=CARTESIAN_POINT('',({R},0.,0.));", "#31=DIRECTION('',(0.,1.,0.));", "#32=AXIS2_PLACEMENT_3D('',#30,#31,#3);",
        f"#33=CIRCLE('',#32,{r});", f"#34=CARTESIAN_POINT('',(0.,{R},0.));", "#35=DIRECTION('',(-1.,0.,0.));",
        "#36=DIRECTION('',(0.,1.,0.));", "#37=AXIS2_PLACEMENT_3D('',#34,#35,#36);", f"#38=CIRCLE('',#37,{r});",
        "#40=EDGE_CURVE('',#14,#15,#22,.T.);", "#41=EDGE_CURVE('',#15,#16,#38,.F.);",
        "#42=EDGE_CURVE('',#16,#17,#25,.F.);", "#43=EDGE_CURVE('',#17,#14,#33,.T.);",
        "#44=ORIENTED_EDGE('',*,*,#40,.T.);", "#45=ORIENTED_EDGE('',*,*,#41,.T.);",
        "#46=ORIENTED_EDGE('',*,*,#42,.T.);", "#47=ORIENTED_EDGE('',*,*,#43,.T.);",
        "#48=EDGE_LOOP('',(#44,#45,#46,#47));", "#49=FACE_OUTER_BOUND('',#48,.T.);",
        "#50=ADVANCED_FACE('',(#49),#5,.T.);", "#97=OPEN_SHELL('',(#50));",
        "#99=SHELL_BASED_SURFACE_MODEL('patch',(#97));",
    ]
    path = tmp_path / "patch.step"
    path.write_text(_step(e))
    sheet = import_step(path)
    area = r * (R * 2 * v + r * 2 * s) * math.pi / 2
    assert sheet.area == pytest.approx(area, rel=1e-6)
    assert sheet.mesh().area == pytest.approx(area, rel=1e-2)


def test_step_half_torus_bounded_by_its_tube_circles(tmp_path):
    """A torus face bounded by two tube circles only: it runs all the way around the tube
    and needs a seam edge along it."""
    R, r = 20.0, 5.0
    e = _torus_entities(R, r) + [
        "#6=DIRECTION('',(0.,1.,0.));", "#7=DIRECTION('',(0.,-1.,0.));",
        f"#10=CARTESIAN_POINT('',({R},0.,0.));", "#11=AXIS2_PLACEMENT_3D('',#10,#6,#3);", f"#12=CIRCLE('',#11,{r});",
        f"#13=CARTESIAN_POINT('',({R + r},0.,0.));", "#14=VERTEX_POINT('',#13);", "#15=EDGE_CURVE('',#14,#14,#12,.T.);",
        f"#20=CARTESIAN_POINT('',({-R},0.,0.));", "#21=DIRECTION('',(-1.,0.,0.));",
        "#22=AXIS2_PLACEMENT_3D('',#20,#6,#21);", f"#23=CIRCLE('',#22,{r});",
        f"#24=CARTESIAN_POINT('',({-R - r},0.,0.));", "#25=VERTEX_POINT('',#24);", "#26=EDGE_CURVE('',#25,#25,#23,.T.);",
        "#30=AXIS2_PLACEMENT_3D('',#10,#7,#3);", "#31=PLANE('',#30);",
        "#32=ORIENTED_EDGE('',*,*,#15,.T.);", "#33=EDGE_LOOP('',(#32));", "#34=FACE_OUTER_BOUND('',#33,.T.);",
        "#35=ADVANCED_FACE('',(#34),#31,.T.);",
        "#40=AXIS2_PLACEMENT_3D('',#20,#7,#21);", "#41=PLANE('',#40);",
        "#42=ORIENTED_EDGE('',*,*,#26,.T.);", "#43=EDGE_LOOP('',(#42));", "#44=FACE_OUTER_BOUND('',#43,.T.);",
        "#45=ADVANCED_FACE('',(#44),#41,.T.);",
        "#50=ORIENTED_EDGE('',*,*,#15,.F.);", "#51=EDGE_LOOP('',(#50));", "#52=FACE_BOUND('',#51,.T.);",
        "#53=ORIENTED_EDGE('',*,*,#26,.F.);", "#54=EDGE_LOOP('',(#53));", "#55=FACE_BOUND('',#54,.T.);",
        "#56=ADVANCED_FACE('',(#52,#55),#5,.T.);",
        "#98=CLOSED_SHELL('',(#35,#45,#56));", "#99=MANIFOLD_SOLID_BREP('half torus',#98);",
    ]
    path = tmp_path / "half_torus.step"
    path.write_text(_step(e))
    part = import_step(path)
    assert part.is_valid()
    assert part._props()["field_volumes"] == pytest.approx([math.pi * r * r * math.pi * R] * 3, rel=1e-6)


def test_step_extrusion_whose_generator_rises_along_it(tmp_path):
    """An extrusion along z of a B-spline that itself climbs 10 in z: the face's height
    above the generator is not its height above the generator's first pole."""
    e = [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,1.));", "#3=DIRECTION('',(1.,0.,0.));",
        "#5=CARTESIAN_POINT('',(10.,0.,10.));",
        "#6=B_SPLINE_CURVE_WITH_KNOTS('',1,(#1,#5),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,1.),.UNSPECIFIED.);",
        "#7=VECTOR('',#2,1.);", "#8=SURFACE_OF_LINEAR_EXTRUSION('',#6,#7);",
        "#10=CARTESIAN_POINT('',(2.,0.,20.));", "#11=CARTESIAN_POINT('',(2.,0.,26.));",
        "#12=CARTESIAN_POINT('',(8.,0.,26.));", "#13=CARTESIAN_POINT('',(8.,0.,20.));",
        "#14=VERTEX_POINT('',#10);", "#15=VERTEX_POINT('',#11);", "#16=VERTEX_POINT('',#12);", "#17=VERTEX_POINT('',#13);",
        "#20=LINE('',#10,#7);", "#21=LINE('',#11,#23);", "#22=LINE('',#12,#24);", "#23=VECTOR('',#3,1.);",
        "#24=VECTOR('',#25,1.);", "#25=DIRECTION('',(0.,0.,-1.));", "#26=LINE('',#13,#27);",
        "#27=VECTOR('',#28,1.);", "#28=DIRECTION('',(-1.,0.,0.));",
        "#30=EDGE_CURVE('',#14,#15,#20,.T.);", "#31=EDGE_CURVE('',#15,#16,#21,.T.);",
        "#32=EDGE_CURVE('',#16,#17,#22,.T.);", "#33=EDGE_CURVE('',#17,#14,#26,.T.);",
        "#34=ORIENTED_EDGE('',*,*,#30,.T.);", "#35=ORIENTED_EDGE('',*,*,#31,.T.);",
        "#36=ORIENTED_EDGE('',*,*,#32,.T.);", "#37=ORIENTED_EDGE('',*,*,#33,.T.);",
        "#38=EDGE_LOOP('',(#34,#35,#36,#37));", "#39=FACE_OUTER_BOUND('',#38,.T.);",
        "#40=ADVANCED_FACE('',(#39),#8,.T.);", "#97=OPEN_SHELL('',(#40));",
        "#99=SHELL_BASED_SURFACE_MODEL('sheet',(#97));",
    ]
    path = tmp_path / "rising.step"
    path.write_text(_step(e))
    assert import_step(path).area == pytest.approx(36.0, rel=1e-9)


# -- read_step: coordinate systems, curves and points ---------------------------------------
def _tool_with_supplemental_geometry() -> str:
    """An assembly ASM holding the product TOOL 100 up: TOOL has the cylinder as its body,
    the coordinate system MCS (and a hidden one), and a curve set with a red B-spline, an
    arc, a composite path and the point CRP (NX and tool catalogs write tools so)."""
    e = _cylinder_entities(0.0) + [
        "#100=APPLICATION_CONTEXT('automotive design');", "#101=PRODUCT_CONTEXT('',#100,'mechanical');",
        "#102=PRODUCT_DEFINITION_CONTEXT('part definition',#100,'design');",
        "#110=PRODUCT('ASM','ASM','',(#101));", "#111=PRODUCT_DEFINITION_FORMATION('','',#110);",
        "#112=PRODUCT_DEFINITION('design','',#111,#102);", "#113=PRODUCT_DEFINITION_SHAPE('','',#112);",
        "#114=SHAPE_REPRESENTATION('ASM',(#4,#130),#903);", "#115=SHAPE_DEFINITION_REPRESENTATION(#113,#114);",
        "#120=PRODUCT('TOOL','TOOL','',(#101));", "#121=PRODUCT_DEFINITION_FORMATION('','',#120);",
        "#122=PRODUCT_DEFINITION('design','',#121,#102);", "#123=PRODUCT_DEFINITION_SHAPE('','',#122);",
        "#124=SHAPE_REPRESENTATION('TOOL',(#4),#903);", "#125=SHAPE_DEFINITION_REPRESENTATION(#123,#124);",
        "#126=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#112,#122,$);", "#127=PRODUCT_DEFINITION_SHAPE('','',#126);",
        "#128=(REPRESENTATION_RELATIONSHIP('','',#124,#114)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#129)"
        "SHAPE_REPRESENTATION_RELATIONSHIP());",
        "#129=ITEM_DEFINED_TRANSFORMATION('','',#4,#130);", "#131=CARTESIAN_POINT('',(0.,0.,100.));",
        "#130=AXIS2_PLACEMENT_3D('',#131,#2,#3);", "#132=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#128,#127);",
        "#133=SHAPE_REPRESENTATION_RELATIONSHIP('','',#124,#904);",
        # supplemental geometry: MCS at the top of the cylinder, a hidden helper at z = 5
        "#140=CONSTRUCTIVE_GEOMETRY_REPRESENTATION('supplemental geometry',(#141,#144),#903);",
        "#142=CARTESIAN_POINT('',(0.,0.,20.));", "#143=DIRECTION('',(0.,1.,0.));",
        "#141=AXIS2_PLACEMENT_3D('MCS',#142,#2,#143);", "#145=CARTESIAN_POINT('',(0.,0.,5.));",
        "#144=AXIS2_PLACEMENT_3D('',#145,#2,#3);",
        "#146=CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP('supplemental geometry','',#124,#140);",
        "#147=PRESENTATION_LAYER_ASSIGNMENT('180','',(#144));", "#148=INVISIBILITY((#147));",
        # wireframe: a curve set
        "#150=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('TOOL',(#151),#903);",
        "#151=GEOMETRIC_CURVE_SET('',(#152,#160,#170,#155));",
        "#153=CARTESIAN_POINT('',(0.,0.,0.));", "#154=CARTESIAN_POINT('',(3.,4.,0.));",
        "#152=B_SPLINE_CURVE_WITH_KNOTS('CUTTING EDGE LINE',1,(#153,#154),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,1.),"
        ".UNSPECIFIED.);",
        "#155=CARTESIAN_POINT('CRP',(1.,2.,3.));",
        "#161=CIRCLE('',#4,10.);",
        f"#160=TRIMMED_CURVE('ARC',#161,(PARAMETER_VALUE(0.)),(PARAMETER_VALUE({math.pi / 2})),.T.,.PARAMETER.);",
        "#175=VECTOR('',#3,1.);", "#176=LINE('',#1,#175);", "#177=CARTESIAN_POINT('',(10.,0.,0.));",
        "#173=TRIMMED_CURVE('',#176,(#1),(#177),.T.,.CARTESIAN.);",
        "#178=VECTOR('',#143,1.);", "#179=LINE('',#177,#178);",
        "#174=TRIMMED_CURVE('',#179,(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(10.)),.T.,.PARAMETER.);",
        "#171=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#173);", "#172=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#174);",
        "#170=COMPOSITE_CURVE('PATH',(#171,#172),.F.);",
        "#156=SHAPE_REPRESENTATION_RELATIONSHIP('','',#124,#150);",
        "#190=STYLED_ITEM('',(#191),#152);", "#191=PRESENTATION_STYLE_ASSIGNMENT((#192));",
        "#192=CURVE_STYLE('',#193,POSITIVE_LENGTH_MEASURE(1.),#194);",
        "#193=DRAUGHTING_PRE_DEFINED_CURVE_FONT('continuous');", "#194=COLOUR_RGB('',1.,0.,0.);",
    ]
    return _step(e)


def test_read_step_reads_coordinate_systems_curves_and_points(tmp_path):
    path = tmp_path / "tool.step"
    path.write_text(_tool_with_supplemental_geometry())
    model = read_step(path)
    assert repr(model) == "StepModel(1 bodies, 1 frames, 3 curves, 1 points)"
    [body] = model.bodies
    assert body.volume == pytest.approx(math.pi * 100 * 20, rel=1e-6)
    assert body.bbox().min.z == pytest.approx(100, abs=1e-9)  # placed by the assembly
    # the coordinate system, at its place in the assembly; the hidden one is left out
    [mcs] = model.frames
    assert (mcs.name, mcs.product) == ("MCS", "TOOL")
    assert mcs.plane.origin.to_tuple() == pytest.approx((0, 0, 120))
    assert mcs.plane.x_dir.to_tuple() == pytest.approx((0, 1, 0))
    assert model.frame("MCS") == mcs.plane and model.frame("MCS", product="TO") == mcs.plane
    with pytest.raises(KeyError, match="no coordinate system 'PCS'.*'MCS'"):
        model.frame("PCS")
    # the curves: a red B-spline, a quarter circle, and a path of two lines as a wire
    line, arc, path_ = model.curves
    assert (line.name, line.product, line.color) == ("CUTTING EDGE LINE", "TOOL", (1.0, 0.0, 0.0))
    assert line.shape.length == pytest.approx(5)
    assert line.shape.start.to_tuple() == pytest.approx((0, 0, 100))
    assert arc.shape.length == pytest.approx(5 * math.pi)
    assert arc.shape.end.to_tuple() == pytest.approx((0, 10, 100), abs=1e-9)
    assert isinstance(path_.shape, Wire) and path_.shape.length == pytest.approx(20)
    assert path_.shape.end.to_tuple() == pytest.approx((10, 10, 100), abs=1e-9)
    [crp] = model.points
    assert (crp.name, crp.point.to_tuple()) == ("CRP", pytest.approx((1, 2, 103)))
    # import_step reads the same file for its body alone
    assert import_step(path).volume == pytest.approx(body.volume)
