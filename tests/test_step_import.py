import math
import re
import subprocess
import sys

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



def test_step_cylinder_band_sheet_gets_its_seam(tmp_path):
    """The band above as a sheet (a surface model of the cylinder face alone): it gets the
    seam as well, without the checks a solid has to pass."""
    e = [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));", "#2=DIRECTION('',(0.,0.,1.));", "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);", "#5=CARTESIAN_POINT('',(0.,0.,20.));",
        "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);", "#7=CYLINDRICAL_SURFACE('',#4,10.);",
        "#10=CIRCLE('',#4,10.);", "#11=CIRCLE('',#6,10.);",
        "#12=CARTESIAN_POINT('',(10.,0.,0.));", "#13=VERTEX_POINT('',#12);",
        "#14=CARTESIAN_POINT('',(10.,0.,20.));", "#15=VERTEX_POINT('',#14);",
        "#16=CARTESIAN_POINT('',(-10.,0.,20.));", "#17=VERTEX_POINT('',#16);",
        "#18=EDGE_CURVE('',#13,#13,#10,.T.);",
        "#19=EDGE_CURVE('',#15,#17,#11,.T.);", "#20=EDGE_CURVE('',#17,#15,#11,.T.);",
        "#30=ORIENTED_EDGE('',*,*,#18,.T.);", "#31=EDGE_LOOP('',(#30));", "#32=FACE_BOUND('',#31,.T.);",
        "#33=ORIENTED_EDGE('',*,*,#20,.F.);", "#34=ORIENTED_EDGE('',*,*,#19,.F.);",
        "#35=EDGE_LOOP('',(#33,#34));", "#36=FACE_BOUND('',#35,.T.);", "#37=ADVANCED_FACE('',(#32,#36),#7,.T.);",
        "#97=OPEN_SHELL('',(#37));", "#99=SHELL_BASED_SURFACE_MODEL('band',(#97));",
    ]
    path = tmp_path / "band_sheet.step"
    path.write_text(_step(e))
    sheet = import_step(path)
    assert not isinstance(sheet, Part)
    area = 2 * math.pi * 10 * 20
    assert sheet.area == pytest.approx(area, rel=1e-6)
    assert sheet.mesh().area == pytest.approx(area, rel=1e-2)

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


# -- closed B-spline surfaces, flipped faces and cavities (files from tool catalogs) ---------
class _Entities:
    """STEP entities numbered from #100 as they are added (the body is #99, see _step)."""

    def __init__(self):
        self.lines: list[str] = []

    def add(self, text: str) -> str:
        ref = f"#{100 + len(self.lines)}"
        self.lines.append(f"{ref}={text};")
        return ref

    def point(self, x: float, y: float, z: float) -> str:
        return self.add(f"CARTESIAN_POINT('',({float(x)!r},{float(y)!r},{float(z)!r}))")

    def vertex(self, x: float, y: float, z: float) -> str:
        return self.add(f"VERTEX_POINT('',{self.point(x, y, z)})")

    def axis(self, origin: tuple[float, float, float], z: tuple[float, float, float] = (0.0, 0.0, 1.0),
             x: tuple[float, float, float] | None = None) -> str:
        zd = self.add(f"DIRECTION('',({float(z[0])!r},{float(z[1])!r},{float(z[2])!r}))")
        if x is None:
            return self.add(f"AXIS2_PLACEMENT_3D('',{self.point(*origin)},{zd},$)")
        xd = self.add(f"DIRECTION('',({float(x[0])!r},{float(x[1])!r},{float(x[2])!r}))")
        return self.add(f"AXIS2_PLACEMENT_3D('',{self.point(*origin)},{zd},{xd})")

    def line(self, a: str, b: str, pa: tuple[float, float, float], pb: tuple[float, float, float]) -> str:
        d = [q - p for p, q in zip(pa, pb)]
        n = math.sqrt(sum(c * c for c in d))
        direction = self.add(f"DIRECTION('',({d[0] / n!r},{d[1] / n!r},{d[2] / n!r}))")
        line = self.add(f"LINE('',{self.point(*pa)},{self.add(f'VECTOR($,{direction},{n!r})')})")
        return self.add(f"EDGE_CURVE('',{a},{b},{line},.T.)")

    def arc(self, a: str, b: str, z: float, r: float) -> str:
        """Counterclockwise about +z around the z axis, at height z."""
        circle = self.add(f"CIRCLE('',{self.axis((0, 0, z), x=(1, 0, 0))},{r!r})")
        return self.add(f"EDGE_CURVE('',{a},{b},{circle},.T.)")

    def plane(self, origin: tuple[float, float, float], normal: tuple[float, float, float] = (0.0, 0.0, 1.0)) -> str:
        return self.add(f"PLANE('',{self.axis(origin, normal)})")

    def solid(self, name: str, faces: list[str]) -> str:
        shell = self.add(f"CLOSED_SHELL('',({','.join(faces)}))")
        return self.step(f"MANIFOLD_SOLID_BREP('{name}',{shell})")

    def face(self, surface: str, same_sense: bool, *loops: list[tuple[str, bool]]) -> str:
        bounds = []
        for i, loop in enumerate(loops):
            uses = ",".join(self.add(f"ORIENTED_EDGE('',*,*,{e},{'.T.' if fwd else '.F.'})") for e, fwd in loop)
            kind = "FACE_OUTER_BOUND" if i == 0 else "FACE_BOUND"
            loop_ref = self.add(f"EDGE_LOOP('',({uses}))")
            bounds.append(self.add(f"{kind}('',{loop_ref},.T.)"))
        return self.add(f"ADVANCED_FACE('',({','.join(bounds)}),{surface},{'.T.' if same_sense else '.F.'})")

    def bspline_cylinder(self, r: float, h: float, seam: float) -> str:
        """A cylinder about z as a closed rational B-spline surface (u around, v up), its seam
        at the angle ``seam`` in degrees."""
        rows, weights = [], []
        for k in range(9):
            a = math.radians(seam + 45 * k)
            f = 1.0 if k % 2 == 0 else math.sqrt(2)
            x, y = r * f * math.cos(a), r * f * math.sin(a)
            rows.append(f"({self.point(x, y, 0)},{self.point(x, y, h)})")
            w = 1.0 if k % 2 == 0 else math.sqrt(0.5)
            weights.append(f"({w!r},{w!r})")
        return self.add(f"(BOUNDED_SURFACE()B_SPLINE_SURFACE(2,1,({','.join(rows)}),.UNSPECIFIED.,.T.,.F.,.F.)"
                        "B_SPLINE_SURFACE_WITH_KNOTS((3,2,2,2,3),(2,2),(0.,0.25,0.5,0.75,1.),(0.,1.),.UNSPECIFIED.)"
                        f"GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE(({','.join(weights)}))"
                        "REPRESENTATION_ITEM('')SURFACE())")

    def step(self, body: str) -> str:
        return _step(self.lines + [f"#99={body};"])


def _segment_on_bspline(a0: float, a1: float, seam: float, slit_at: float | None = None) -> str:
    """The solid between the arc from a0 to a1 degrees (radius 10, height 10) and its chord,
    the curved face on a closed B-spline cylinder with its seam at ``seam``. ``slit_at``: the
    curved face's loop also runs up a cut half way at that angle and back down."""
    r, h, s = 10.0, 10.0, _Entities()
    p = {n: (r * math.cos(math.radians(a)), r * math.sin(math.radians(a))) for n, a in (("0", a0), ("1", a1))}
    v0b, v1b = s.vertex(*p["0"], 0), s.vertex(*p["1"], 0)
    v0t, v1t = s.vertex(*p["0"], h), s.vertex(*p["1"], h)
    top, chord_t, chord_b = s.arc(v0t, v1t, h, r), s.line(v1t, v0t, (*p["1"], h), (*p["0"], h)), \
        s.line(v1b, v0b, (*p["1"], 0), (*p["0"], 0))
    up0, up1 = s.line(v0b, v0t, (*p["0"], 0), (*p["0"], h)), s.line(v1b, v1t, (*p["1"], 0), (*p["1"], h))
    if slit_at is None:
        bottom = [(s.arc(v0b, v1b, 0, r), True)]
        cut = []
    else:
        q = (r * math.cos(math.radians(slit_at)), r * math.sin(math.radians(slit_at)))
        vs, vc = s.vertex(*q, 0), s.vertex(*q, h / 2)
        bottom = [(s.arc(v0b, vs, 0, r), True), (s.arc(vs, v1b, 0, r), True)]
        slit = s.line(vs, vc, (*q, 0), (*q, h / 2))
        cut = [(slit, True), (slit, False)]
    m = math.radians((a0 + a1) / 2)
    return s.solid("segment", [
        s.face(s.bspline_cylinder(r, h, seam), True, bottom[:1] + cut + bottom[1:] + [(up1, True), (top, False), (up0, False)]),
        s.face(s.plane((0, 0, 0)), False, [(e, False) for e, _ in reversed(bottom)] + [(chord_b, False)]),
        s.face(s.plane((0, 0, h)), True, [(top, True), (chord_t, True)]),
        s.face(s.plane((*p["0"], 0), (-math.cos(m), -math.sin(m), 0)), True,
               [(chord_b, True), (up0, True), (chord_t, False), (up1, False)]),
    ])


def _segment_volume(a0: float, a1: float) -> float:
    t = math.radians(a1 - a0)
    return 10.0 * 100 / 2 * (t - math.sin(t))


@pytest.mark.parametrize("a0,a1,seam", [(-90, 90, 0), (-60, 150, 30), (0, 180, 0), (10, 170, 0), (200, 350, 300)])
def test_step_face_across_the_seam_of_a_closed_bspline(tmp_path, a0, a1, seam):
    """A face on a closed B-spline surface that lies across the surface's seam, without an edge
    there: the kernel trims it the wrong way round unless the seam is moved off it."""
    path = tmp_path / "segment.step"
    path.write_text(_segment_on_bspline(a0, a1, seam))
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(_segment_volume(a0, a1), rel=1e-6)
    curved = part.faces().sort_by(lambda f: -f.area)[0]
    assert curved.area == pytest.approx(10 * math.radians(a1 - a0) * 10, rel=1e-6)
    assert part.mesh().volume == pytest.approx(part.volume, rel=1e-2)


def test_step_slit_into_a_face_on_a_closed_bspline(tmp_path):
    """A loop that runs up a cut into the face and back (a broken file): on a closed surface it
    looks like a seam, but the rest of the loop does not go around the surface."""
    path = tmp_path / "slit.step"
    path.write_text(_segment_on_bspline(-90, 90, 0, slit_at=0))
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(_segment_volume(-90, 90), rel=1e-6)
    assert part.area == pytest.approx(10 * math.pi * 10 + 2 * 50 * math.pi + 200, rel=1e-6)


def test_step_bspline_tube_bounded_by_two_circles(tmp_path):
    """A closed B-spline face bounded by a circle at each end and no seam edge (the hub of an
    impeller): it needs the seam the kernel adds."""
    r, h, s = 10.0, 10.0, _Entities()
    vb, vt = s.vertex(r, 0, 0), s.vertex(r, 0, h)
    bottom, top = s.arc(vb, vb, 0, r), s.arc(vt, vt, h, r)
    path = tmp_path / "tube.step"
    path.write_text(s.solid("tube", [
        s.face(s.bspline_cylinder(r, h, 0), True, [(bottom, True)], [(top, False)]),
        s.face(s.plane((0, 0, 0)), False, [(bottom, False)]),
        s.face(s.plane((0, 0, h)), True, [(top, True)]),
    ]))
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(math.pi * r * r * h, rel=1e-6)
    assert part.mesh().volume == pytest.approx(part.volume, rel=1e-2)


def test_step_face_flagged_against_its_loops(tmp_path):
    """A face whose same_sense flag disagrees with its loops (and so with its neighbours): the
    loops decide, as they do in the other readers."""
    path = tmp_path / "box.step"
    export_step(Box(10, 20, 30), path)
    text = path.read_text()
    faces = re.findall(r"(#\d+)=ADVANCED_FACE\('[^']*',\([^)]*\),#\d+,\.(T|F)\.\)", text)
    ref, flag = faces[0]
    flipped = {"T": "F", "F": "T"}[flag]
    text = re.sub(rf"({ref}=ADVANCED_FACE\('[^']*',\([^)]*\),#\d+,)\.{flag}\.\)", rf"\1.{flipped}.)", text)
    path.write_text(text)
    part = import_step(path)
    assert part.is_valid()
    assert part.volume == pytest.approx(6000, rel=1e-9)
    assert part.area == pytest.approx(2 * (200 + 300 + 600), rel=1e-9)


def _box(s: _Entities, lo: tuple[float, float, float], hi: tuple[float, float, float]) -> str:
    """The closed shell of an axis-aligned box, faces pointing out of it."""
    c = [(x, y, z) for z in (lo[2], hi[2]) for y in (lo[1], hi[1]) for x in (lo[0], hi[0])]
    v = [s.vertex(*p) for p in c]
    edges: dict[tuple[int, int], str] = {}

    def edge(i: int, j: int) -> tuple[str, bool]:
        if (j, i) in edges:
            return edges[(j, i)], False
        edges[(i, j)] = edges.get((i, j)) or s.line(v[i], v[j], c[i], c[j])
        return edges[(i, j)], True

    # each face's corners counterclockwise seen from outside, and its outward normal
    quads = [((0, 2, 3, 1), (0, 0, -1)), ((4, 5, 7, 6), (0, 0, 1)), ((0, 1, 5, 4), (0, -1, 0)),
             ((2, 6, 7, 3), (0, 1, 0)), ((0, 4, 6, 2), (-1, 0, 0)), ((1, 3, 7, 5), (1, 0, 0))]
    faces = []
    for q, n in quads:
        faces.append(s.face(s.plane(c[q[0]], n), True, [edge(q[k], q[(k + 1) % 4]) for k in range(4)]))
    return s.add(f"CLOSED_SHELL('',({','.join(faces)}))")


def test_step_solid_with_a_cavity(tmp_path):
    """BREP_WITH_VOIDS: the cavity is a void region inside the solid, as the file has it (the
    Boolean difference fails where a cavity comes close to the outside)."""
    s = _Entities()
    outer = _box(s, (0, 0, 0), (40, 30, 20))
    cavity = s.add(f"ORIENTED_CLOSED_SHELL('',*,{_box(s, (10, 10, 5), (30, 20, 15))},.F.)")
    path = tmp_path / "cavity.step"
    path.write_text(s.step(f"BREP_WITH_VOIDS('block',{outer},({cavity}))"))
    part = import_step(path)
    assert part.is_valid()
    assert len(part.faces()) == 12
    assert part.volume == pytest.approx(40 * 30 * 20 - 20 * 10 * 10, rel=1e-9)
    assert part.area == pytest.approx(2 * (1200 + 800 + 600) + 2 * (200 + 200 + 100), rel=1e-9)


def _puck(flagged: str, axis_down: bool) -> str:
    """A puck of radius 10 and height 10 whose bottom edge is rounded with radius 2 by a torus
    face, with the bound of one face (``flagged``) marked reversed against the loop it holds."""
    s = _Entities()
    R, h, f = 10.0, 10.0, 2.0
    v_top, v_mid, v_bot = s.vertex(R, 0, h), s.vertex(R, 0, f), s.vertex(R - f, 0, 0)
    c_top, c_mid, c_bot = s.arc(v_top, v_top, h, R), s.arc(v_mid, v_mid, f, R), s.arc(v_bot, v_bot, 0, R - f)
    seam = s.line(v_mid, v_top, (R, 0, f), (R, 0, h))
    tube = s.add(f"CIRCLE('',{s.axis((R - f, 0, f), (0, 1, 0), (1, 0, 0))},{f!r})")
    tube_seam = s.add(f"EDGE_CURVE('',{v_mid},{v_bot},{tube},.T.)")  # down from the side to the bottom
    torus = s.add(f"TOROIDAL_SURFACE('',{s.axis((0, 0, f), (0, 0, -1 if axis_down else 1), (1, 0, 0))},{R - f!r},{f!r})")
    faces = {
        "top": s.face(s.plane((0, 0, h)), True, [(c_top, True)]),
        "side": s.face(s.add(f"CYLINDRICAL_SURFACE('',{s.axis((0, 0, 0), x=(1, 0, 0))},{R!r})"), True,
                       [(c_mid, True), (seam, True), (c_top, False), (seam, False)]),
        "bottom": s.face(s.plane((0, 0, 0), (0, 0, -1)), True, [(c_bot, False)]),
        "fillet": s.face(torus, True, [(c_mid, False), (tube_seam, True), (c_bot, True), (tube_seam, False)]),
    }
    face = next(line for line in s.lines if line.startswith(faces[flagged] + "="))
    bound = re.search(r"ADVANCED_FACE\('',\((#\d+)", face).group(1)
    i = next(i for i, line in enumerate(s.lines) if line.startswith(bound + "="))
    s.lines[i] = s.lines[i].replace(",.T.);", ",.F.);")
    return s.solid("puck", list(faces.values()))


@pytest.mark.parametrize("flagged, axis_down", [("fillet", True), ("fillet", False), ("bottom", True)])
def test_step_face_bound_flagged_against_its_neighbours(tmp_path, flagged, axis_down):
    """A face whose bound is flagged reversed, so that its loop uses the edges it shares the
    same way round as its neighbours do (issue #3: the fillets of a hole in a file from another
    kernel). The neighbours decide: on the torus the loop would bound the rest of the tube."""
    path = tmp_path / "puck.step"
    path.write_text(_puck(flagged, axis_down))
    part = import_step(path)
    R, h, f = 10.0, 10.0, 2.0
    corner = f * f * (1 - math.pi / 4)  # the cross-section the rounding takes away, and its centroid
    centroid = R - f * (10 - 3 * math.pi) / (3 * (4 - math.pi))
    faces = len(part.faces())  # (a number: a failed assert would print the faces, and a broken one hangs)
    assert part.is_valid()
    assert faces == 4
    assert part.volume == pytest.approx(math.pi * R * R * h - corner * 2 * math.pi * centroid, rel=1e-9)
    fillet = 2 * math.pi * f * ((R - f) * math.pi / 2 + f)  # a quarter of the tube, the outer one
    assert part.area == pytest.approx(math.pi * (R * R + 2 * R * (h - f) + (R - f) ** 2) + fillet, rel=1e-9)


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


# -- edges off their faces, faces that share nothing, shared vertices, seam checks -------------------
def _planes_moved(text: str, shift: float) -> str:
    """A STEP text with the origin of every PLANE moved by `shift` along x, y and z, its edges and
    vertices left where they are: edges that lie off their faces, as low-precision writers leave them."""
    axes = set(re.findall(r"=PLANE\('',#(\d+)\)", text))
    origins = {m.group(2) for m in re.finditer(r"#(\d+)=AXIS2_PLACEMENT_3D\('',#(\d+),", text) if m.group(1) in axes}

    def move(m):
        if m.group(1) not in origins:
            return m.group(0)
        return f"#{m.group(1)}=CARTESIAN_POINT('',({','.join(repr(float(x) + shift) for x in m.group(2).split(','))}));"

    return re.sub(r"#(\d+)=CARTESIAN_POINT\('',\(([^)]*)\)\);", move, text)


def test_step_edges_off_their_faces_keep_their_convexity(tmp_path):
    # The edges of an L-shaped block whose planes lie 6e-4 off its edges (the valve body's edges lie
    # 6.6e-4 off theirs): the convexity was read from two steps of 1e-4 x the length into a face,
    # which the gap swamped, and 9 of its 21 edges came out the wrong way. The kernel's outer angle
    # (SmEdge::CalcOuterAngle) does not look at the faces' distances.
    block = Box(20, 20, 20) - Box(20, 20, 20).translate(10, 10, 10)
    export_step(block, tmp_path / "block.step")
    (tmp_path / "moved.step").write_text(_planes_moved((tmp_path / "block.step").read_text(), 6e-4))
    moved = import_step(tmp_path / "moved.step")
    assert moved.is_valid()
    want = {tuple(round(c, 2) for c in e.center()): e.convexity for e in block.edges()}
    got = {tuple(round(c, 2) for c in e.center()): e.convexity for e in moved.edges()}
    assert sorted(got.values()) == sorted(want.values())
    assert len(moved.edges().concave()) == 3 and len(moved.edges().convex()) == 18
    assert sorted(round(e.dihedral_angle, 6) for e in moved.edges().concave()) == [270.0] * 3
    # a box: 90 degrees through the material; a rounded edge's borders meet tangentially
    box = Box(10, 10, 10)
    assert {round(e.dihedral_angle, 9) for e in box.edges()} == {90.0}
    rounded = box.fillet(box.edges().parallel_to(Z), 2)
    assert len(rounded.edges().smooth()) == 8
    assert all(abs(e.dihedral_angle - 180) < 1e-6 for e in rounded.edges().smooth())
    # where the kernel cannot tell (both sides of the edge the same kind of region): as before
    merged = Box(10, 10, 10).merge(Box(10, 10, 10).translate(10, 0, 0))
    assert len(merged.edges().convex()) == len(merged.edges())
    sheet = box.faces().top()[0].to_shell()
    assert [e.convexity for e in sheet.edges()] == ["convex"] * 4
    with pytest.raises(ValueError, match="does not lie between two faces"):
        sheet.edges()[0].dihedral_angle


def _unshared(text: str, gap: float) -> str:
    """A STEP text in which no two faces share an edge or a vertex: each ORIENTED_EDGE gets an
    EDGE_CURVE and VERTEX_POINTs of its own, the points moved by up to `gap`."""
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

    def copied(v: str) -> int:
        nonlocal count
        p = re.match(r"VERTEX_POINT\('',#(\d+)\)", ents[v]).group(1)
        xyz = [float(c) for c in re.match(r"CARTESIAN_POINT\('.*?',\((.*)\)\)", ents[p]).group(1).split(",")]
        xyz = [c + gap * ((count * 7 + j * 3) % 5 - 2) / 2 for j, c in enumerate(xyz)]
        count += 1
        return add("VERTEX_POINT('',#%d)" % add("CARTESIAN_POINT('',(%s))" % ",".join(f"{c:.12E}" for c in xyz)))

    for i in order:
        m = re.match(r"ORIENTED_EDGE\('',\*,\*,#(\d+),(\.[TF]\.)\)", ents[i])
        if not m:
            continue
        v1, v2, c, sense = re.match(r"EDGE_CURVE\('',#(\d+),#(\d+),#(\d+),(\.[TF]\.)\)", ents[m.group(1)]).groups()
        a = copied(v1)
        b = a if v1 == v2 else copied(v2)
        ents[i] = "ORIENTED_EDGE('',*,*,#%d,%s)" % (add(f"EDGE_CURVE('',#{a},#{b},#{c},{sense})"), m.group(2))
    body = "".join(f"#{i}={ents[i]};\n" for i in order) + "".join(f"#{i}={s};\n" for i, s in new)
    return head + "DATA;\n" + body + "ENDSEC;" + tail


def test_faces_of_an_import_whose_faces_share_nothing_raise(tmp_path):
    # Faces that share no edges, with vertex points up to 1e-3 off (low-precision writers): copying
    # one out of the body (to_shell, moving a face, to_sketch, extrude) fell back to copying the
    # body and removing the other faces, the removal failed, and deleting the copy then crashed the
    # process (SmBrep::~SmBrep, a null pointer). Now such a copy is kept, never freed, and the call
    # raises KernelError. In a process of its own, so that a crash fails the test, not the run.
    export_step(Box(20, 10, 10) - Cylinder(3, 20), tmp_path / "block.step")
    (tmp_path / "unshared.step").write_text(_unshared((tmp_path / "block.step").read_text(), 1e-3))
    code = f"""
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
part = import_step({str(tmp_path / "unshared.step")!r})
print(type(part).__name__, part.is_valid(), flush=True)
for f in part.faces():
    try:
        f.to_shell()
        print("copied", flush=True)
    except KernelError as e:
        print("KernelError", e, flush=True)
print(round((Box(10, 10, 10) - Cylinder(2, 20)).volume, 3), flush=True)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stdout + run.stderr
    lines = run.stdout.split("\n")
    assert lines[0] == "Part False"
    assert all(line.startswith("KernelError copy face failed") for line in lines[1:8])
    assert lines[8] == f"{1000 - math.pi * 4 * 10:.3f}"  # the kernel still works


def test_step_import_makes_one_vertex_per_file_vertex(tmp_path):
    # The builder started each new edge without the file's vertices, and the kernel made a vertex
    # for every vertexuse a loop had not linked yet: a rounded box came back with 48 vertices for
    # the file's 24, its corners each twice, and 48 links in its loops between edges that end and
    # start at different vertices (7 of 9 imported parts whose all-edge fillets crashed had such).
    box = Box(40, 30, 20)
    rounded = box.fillet(box.edges(), 3)
    export_step(rounded, tmp_path / "rounded.step")
    assert (tmp_path / "rounded.step").read_text().count("VERTEX_POINT(") == 24
    back = import_step(tmp_path / "rounded.step")
    assert len(back.vertices()) == 24 and back.is_valid()
    assert back.volume == pytest.approx(rounded.volume, rel=1e-12)
    broken = 0
    for f in back.faces():
        for loop in f._f.boundary_loops():
            for (e, fwd), (e2, fwd2) in zip(loop, loop[1:] + loop[:1]):
                broken += (e.end_vertex() if fwd else e.start_vertex()) is not (e2.start_vertex() if fwd2 else e2.end_vertex())
    assert broken == 0


@pytest.mark.skipif(sys.platform == "win32", reason="reads the process's memory with ps")
def test_seam_checks_on_import_free_their_curves(tmp_path):
    # The kernel's seam check (SmFace::HasSeamProblem), which every STEP import runs on every body,
    # copied the seam curve it made and lost the original: 3.4 KB per cylinder, 12.7 KB per torus,
    # each call (also in the healer). In a process of its own, so that what other tests left does
    # not count.
    export_step(Box(20, 10, 10) - Cylinder(3, 20), tmp_path / "hole.step")
    code = f"""
import gc, os
from smlibpy import *
from smlibpy._kernel import ext
def rss():
    return int(os.popen(f"ps -o rss= -p {{os.getpid()}}").read()) / 1024
ring = Torus(10, 2) + Cylinder(3, 30)
for _ in range(50):
    ext.seam_problems(ring._brep)
gc.collect()
before = rss()
for _ in range(1000):
    ext.seam_problems(ring._brep)
for _ in range(100):
    import_step({str(tmp_path / "hole.step")!r})
gc.collect()
print(rss() - before)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr
    grown = float(run.stdout.strip())
    assert grown < 5, f"1000 seam checks and 100 imports took {grown:.1f} MB"  # was 16 MB
