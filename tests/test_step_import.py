import math

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


def test_step_converts_units(tmp_path):
    path = tmp_path / "inch.step"
    export_step(Box(1, 2, 3), path, unit="inch")
    assert import_step(path).volume == pytest.approx(6 * 25.4**3, rel=1e-9)


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
    return _step(e)


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
