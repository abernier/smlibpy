import math
import struct

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
