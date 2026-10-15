import importlib.util
import math
import struct
import subprocess
import sys
from pathlib import Path

import pytest

from smlibpy import *
from smlibpy.exporters import export_glb, export_gltf, export_step, export_stl, import_stl, load, save


@pytest.fixture
def plate():
    p = Box(80, 60, 10)
    p = p.fillet(p.edges().parallel_to(Z), 8)
    p = p - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)
    return p.named("plate").colored("steelblue")


def test_native_roundtrip(tmp_path, plate):
    path = tmp_path / "plate.smb"
    save(plate, path)
    back = load(path)
    assert back.volume == pytest.approx(plate.volume, rel=1e-12)


def test_stl_roundtrip(tmp_path, plate):
    path = tmp_path / "plate.stl"
    export_stl(plate, path)
    mesh = import_stl(path)
    assert mesh.volume == pytest.approx(plate.volume, rel=1e-3)


def test_glb_header(tmp_path, plate):
    path = tmp_path / "plate.glb"
    export_glb(plate, path)
    data = path.read_bytes()
    magic, version, length = struct.unpack("<4sII", data[:12])
    assert magic == b"glTF" and version == 2 and length == len(data)


@pytest.mark.parametrize("fmt", ["glb", "gltf"])
def test_gltf_is_in_meters(tmp_path, fmt):
    import json

    path = tmp_path / f"box.{fmt}"
    (export_glb if fmt == "glb" else export_gltf)(Box(60, 40, 8), path, edge_color="red")
    if fmt == "glb":
        data = path.read_bytes()
        n = struct.unpack("<I", data[12:16])[0]
        doc = json.loads(data[20:20 + n])
    else:
        doc = json.loads(path.read_text())
    root = doc["nodes"][doc["scenes"][0]["nodes"][0]]
    assert root["scale"] == [0.001, 0.001, 0.001]
    mesh_node = doc["nodes"][root["children"][0]]
    pos = doc["accessors"][doc["meshes"][mesh_node["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
    assert pos["max"] == pytest.approx([30, 20, 4])  # millimeters below the root: 60 mm = 0.06 m


@pytest.mark.parametrize("cone", [Cone(0, 10, 15), Cone(0, 10, 15).translate(5, -3, 2), Cone(10, 0, 15)])
def test_step_cone_with_apex_keeps_its_volume(tmp_path, cone):
    path = tmp_path / "cone.step"
    export_step(cone, path)
    assert load(path).volume == pytest.approx(cone.volume, rel=1e-6)


def test_step_structure(tmp_path, plate):
    path = tmp_path / "plate.step"
    export_step(plate, path)
    text = path.read_text()
    assert text.startswith("ISO-10303-21;")
    assert "MANIFOLD_SOLID_BREP('plate'" in text
    assert text.count("CYLINDRICAL_SURFACE") == 8  # four holes, four rounded corners
    assert "COLOUR_RGB" in text


occ = pytest.importorskip  # alias for readability below


@pytest.mark.parametrize("name,shape", [
    ("plate", None),
    ("sphere", Sphere(10)),
    ("torus", Torus(20, 5)),
    ("cone", Cone(10, 0, 15)),
    ("hollow", Box(20, 20, 20) - Sphere(5)),
    ("g2", Box(30, 20, 10).fillet(Box(30, 20, 10).edges(), 2, continuity="G2")),
    ("loft", loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)])),
])
def test_step_reads_back_in_opencascade(tmp_path, plate, name, shape):
    """Optional cross-check with an independent kernel (needs OCP, e.g. cadquery-ocp-novtk)."""
    STEPControl = pytest.importorskip("OCP.STEPControl")
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    shape = plate if shape is None else shape
    path = tmp_path / f"{name}.step"
    export_step(shape, path)
    reader = STEPControl.STEPControl_Reader()
    reader.ReadFile(str(path))
    reader.TransferRoots()
    s = reader.OneShape()
    assert BRepCheck_Analyzer(s).IsValid()
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(s, props, 1e-9, False, False)
    assert props.Mass() == pytest.approx(shape.volume, rel=1e-6)


def test_render_png(tmp_path, plate):
    data = render(plate, path=tmp_path / "plate.png", size=(320, 240))
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", data[16:24]) == (320, 240)
    assert (tmp_path / "plate.png").read_bytes() == data
    sheet = render(plate, Spline((0, 0, 20), (30, 20, 30)), view="sheet", size=(400, 300))
    assert struct.unpack(">II", sheet[16:24]) == (400, 300)


# -- USD ---------------------------------------------------------------------------------------------
USD_SAMPLES = Path(__file__).resolve().parent.parent / "third_party" / "usd-brep" / "TestFiles"


@pytest.mark.parametrize("name, shape", [
    ("box", lambda: Box(10, 20, 30)),
    ("ball", lambda: Sphere(5)),
    ("ring", lambda: Torus(10, 3)),
    ("narrowing", lambda: Cone(5, 2, 10)),  # (a negative semi-angle in SMLib)
    ("rounded", lambda: Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)),  # (cylinders as cones of angle 0)
    ("countersunk", lambda: Box(30, 30, 10) - Cone(6, 3, 3).translate((0, 0, 3.5)) - Cylinder(3, 10)),
    ("cup", lambda: Box(30, 30, 30).shell(2, openings=Box(30, 30, 30).faces().top())),
])
def test_usd_roundtrip_is_exact(tmp_path, name, shape):
    part = shape()
    export_usd(part.named(name), tmp_path / "part.usda")
    back = import_usd(tmp_path / "part.usda")
    assert isinstance(back, Part) and back.name == name and back.is_valid()
    assert len(back.faces()) == len(part.faces())
    assert back.volume == pytest.approx(part.volume, rel=1e-12)
    assert [f.geom_type for f in back.faces()] == [f.geom_type for f in part.faces()]


def test_usd_names_colors_sheets_cells_and_meshes(tmp_path, plate):
    sheet = surface([[(x * 10, y * 10, 3 * ((x - 2) ** 2 - (y - 2) ** 2) / 4) for x in range(5)] for y in range(5)])
    cells = Box(10, 10, 10).merge(Sphere(4).translate((0, 0, 5)))
    export([plate, sheet.named("sheet"), cells.named("cells")], tmp_path / "all.usda")
    back = load(tmp_path / "all.usda")
    assert [b.name for b in back] == ["plate", "sheet", "cells"]
    assert back[0].color == pytest.approx((70 / 255, 130 / 255, 180 / 255))  # steelblue
    assert isinstance(back[1], Shell) and not isinstance(back[1], Part)
    assert back[1].area == pytest.approx(sheet.area, rel=1e-12)
    assert sorted(c.volume for c in back[2].cells()) == pytest.approx(sorted(c.volume for c in cells.cells()), rel=1e-9)
    text = (tmp_path / "all.usda").read_text()
    assert text.startswith("#usda 1.0") and 'upAxis = "Z"' in text and "metersPerUnit = 0.001" in text
    # each body with a mesh of it, which is what USD viewers draw
    assert text.count("def BrepArray") == 3 and text.count("def Mesh") == 3 and 'def Mesh "plate_mesh"' in text
    assert "normal3f[] normals" in text
    export_usd([plate, plate.mesh()], tmp_path / "exact.usda", mesh=False)
    text = (tmp_path / "exact.usda").read_text()
    assert text.count("def BrepArray") == 1 and text.count("def Mesh") == 1  # (the mesh given)
    assert load(tmp_path / "all.usda")[0].volume == pytest.approx(plate.volume, rel=1e-12)  # (meshes are not read)


def test_usd_rejects_what_it_cannot_read(tmp_path, plate):
    with pytest.raises(ValueError, match="usdcat"):
        export_usd(plate, tmp_path / "plate.usdc")
    with pytest.raises(ValueError, match="usdzip"):  # (usdcat writes no packages)
        export_usd(plate, tmp_path / "plate.usdz")
    (tmp_path / "binary.usdc").write_bytes(b"PXR-USDC" + bytes(100))
    with pytest.raises(ValueError, match="binary"):
        import_usd(tmp_path / "binary.usdc")
    (tmp_path / "none.usda").write_text('#usda 1.0\ndef Xform "World"\n{\n}\n')
    with pytest.raises(ValueError, match="no BrepArray"):
        import_usd(tmp_path / "none.usda")
    good = tmp_path / "good.usda"
    export_usd(plate, good)
    broken = good.read_text().replace("uniform uint[] faceuse:faceIndex = [", "uniform uint[] faceuse:faceIndex = [99, ")
    (tmp_path / "broken.usda").write_text(broken)
    with pytest.raises(ValueError, match="malformed"):
        import_usd(tmp_path / "broken.usda")


@pytest.mark.skipif(not USD_SAMPLES.is_dir(), reason="usd-brep's test files are not checked out")
def test_usd_reads_usd_brep_files():
    # their files of good bodies, and their validator's files of broken ones: each gives bodies or a
    # ValueError that names what is wrong, none crashes
    good = {"Cube.usda": 1, "CubeBrepArray.usda": 2, "sphere_nurbs.usda": 1, "cubeWithVoid.usda": 1, "mouse.usda": 1,
            "RevitWallHealerCrash.usda": 1, "Cone_SmConnect_Brep.usda": 1}
    seen = 0
    for path in sorted(USD_SAMPLES.rglob("*.usda")):
        text = path.read_text(errors="replace")
        if "def BrepArray" not in text or text.startswith("version https://git-lfs"):
            continue
        if path.name in good:
            bodies = import_usd(path)
            bodies = bodies if isinstance(bodies, ShapeList) else [bodies]
            assert len(bodies) == good[path.name] and all(b.is_valid() for b in bodies), path.name
            seen += 1
        else:
            try:
                import_usd(path)
            except ValueError:
                pass
    assert seen == len(good)


@pytest.mark.skipif(importlib.util.find_spec("pxr") is None, reason="OpenUSD (usd-core) is not installed")
def test_usd_opens_in_openusd(tmp_path, plate):
    from pxr import Usd, UsdGeom

    export_usd([plate, Sphere(5).named("ball")], tmp_path / "parts.usda")
    stage = Usd.Stage.Open(str(tmp_path / "parts.usda"))
    prims = {str(p.GetPath()): p.GetTypeName() for p in stage.Traverse()}
    assert prims == {"/World": "Xform", "/World/plate": "BrepArray", "/World/plate_mesh": "Mesh",
                     "/World/ball": "BrepArray", "/World/ball_mesh": "Mesh"}
    assert UsdGeom.GetStageUpAxis(stage) == "Z" and UsdGeom.GetStageMetersPerUnit(stage) == pytest.approx(0.001)
    brep = stage.GetPrimAtPath("/World/plate")
    spec = stage.GetRootLayer().GetPrimAtPath("/World/plate")
    assert "BrepSurfaceCylinderAPI" in spec.GetInfo("apiSchemas").prependedItems
    assert len(brep.GetAttribute("face:surfaceType").Get()) == len(plate.faces())
    mesh = UsdGeom.Mesh(stage.GetPrimAtPath("/World/plate_mesh"))
    assert len(mesh.GetFaceVertexCountsAttr().Get()) == len(plate.mesh().triangles)
    export_usd(plate, tmp_path / "exact.usda", mesh=False)
    exact = Usd.Stage.Open(str(tmp_path / "exact.usda"))
    prims = {str(p.GetPath()): p.GetTypeName() for p in exact.Traverse()}
    assert prims == {"/World": "Xform", "/World/plate": "BrepArray"}


@pytest.mark.skipif(importlib.util.find_spec("usd_brep") is None, reason="NVIDIA's usd-brep is not installed")
def test_usd_files_go_both_ways_with_usd_brep(tmp_path, plate):
    # usd-brep reads what smlibpy writes, smlibpy what usd-brep writes (in a process of its own:
    # the two packages each hold a copy of the kernel)
    export_usd(plate, tmp_path / "ours.usda")
    script = (
        "import sys, usd_brep\n"
        "(brep,) = usd_brep.usd.import_breps(sys.argv[1])\n"
        "print(brep.volume(1e-9), len(brep.faces()))\n"
        "box = usd_brep.primitives.create_box((0.0, 0.0, 0.0), 10.0, 20.0, 30.0)\n"
        "usd_brep.usd.export_brep(box, sys.argv[2])\n"
    )
    out = subprocess.run([sys.executable, "-c", script, str(tmp_path / "ours.usda"), str(tmp_path / "theirs.usda")],
                         capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr
    volume, faces = out.stdout.split()
    assert float(volume) == pytest.approx(plate.volume, rel=1e-6) and int(faces) == len(plate.faces())
    box = import_usd(tmp_path / "theirs.usda")
    assert box.is_valid() and box.volume == pytest.approx(6000, rel=1e-12)
