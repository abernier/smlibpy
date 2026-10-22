import importlib.util
import math
import re
import struct
import subprocess
import sys
import warnings
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


def test_native_files_keep_merged_parts(tmp_path):
    # A merged part is no valid solid by design (Part.merge); load took that for a sheet and gave a
    # Shell without cells or volume. It decides by what the body encloses, as import_usd does.
    merged = Box(10, 10, 10).merge(Box(10, 10, 10).translate(10, 0, 0))
    save(merged, tmp_path / "merged.smb")
    back = load(tmp_path / "merged.smb")
    assert isinstance(back, Part) and len(back.cells()) == 2 and back.volume == pytest.approx(2000)
    save(Box(10, 10, 10).faces().top()[0].to_shell(), tmp_path / "sheet.smb")
    sheet = load(tmp_path / "sheet.smb")
    assert isinstance(sheet, Shell) and not isinstance(sheet, Part)


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
DATA = Path(__file__).resolve().parent / "data"


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
    # (the kernel makes the trim curves of the cone from its circle edges, written as circles: 3e-12)
    assert back.volume == pytest.approx(part.volume, rel=1e-11)
    assert [f.geom_type for f in back.faces()] == [f.geom_type for f in part.faces()]
    assert [e.geom_type for e in back.edges()] == [e.geom_type for e in part.edges()]


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
            "Cone_SmConnect_Brep.usda": 1}
    seen = 0
    for path in sorted(USD_SAMPLES.rglob("*.usda")):
        text = path.read_text(errors="replace")
        if "def BrepArray" not in text or text.startswith("version https://git-lfs"):
            continue
        if path.name in good:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                bodies = import_usd(path)
            bodies = bodies if isinstance(bodies, ShapeList) else [bodies]
            assert len(bodies) == good[path.name], path.name
            assert all(b.is_valid() for b in bodies), path.name
            # (the mouse's faces leave gaps of 2e-3: noted)
            assert any("gap of 0.00199" in str(w.message) for w in caught) == (path.name == "mouse.usda"), path.name
            seen += 1
        else:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")  # (bodies the kernel finds problems with)
                    import_usd(path)
            except ValueError:
                pass
    assert seen == len(good)
    # its wall whose faces leave gaps of 377 (the healer crashed on it) is refused, and read with
    # the check off
    revit = USD_SAMPLES / "usd_TestFiles" / "RevitWallHealerCrash.usda"
    with pytest.raises(ValueError, match="is broken: the kernel finds a gap of 377 .0.033 of its size"):
        import_usd(revit)
    assert not import_usd(revit, check=False).is_valid()


@pytest.mark.skipif(not USD_SAMPLES.is_dir(), reason="usd-brep's test files are not checked out")
def test_usd_refuses_the_validators_broken_bodies():
    # usd-brep's validator files whose bodies are geometrically broken imported as Parts that said
    # they were valid: a unit cube of volume 0.5 (a surface weight of 0), one whose box reached 100
    # away, one that did not mesh. The value rules and the kernel's check (SmBrep::AssertValid,
    # before anything measures the body) refuse them, naming the body, the entity and the rule.
    files = USD_SAMPLES / "brep_validator"
    refused = {
        "Test_BA_440_Non_positive_NURBS_surface_weights.usda": "body 0, face 0: its NURBS surface has a weight of 0, not positive .BA.440",
        "Test_BA_582_Orphan_edge_not_referenced_by_any_edgeuse.usda": "1 of the edges are used by no edgeuse .BA.582",
        "Test_BA_465_Surface_NURBS_control_point_containment.usda": "body 0 of the BrepArray \"/World/brepArray\" is broken: the kernel finds",
        "Test_BA_310_Vertex_position_containment.usda": "is broken: the kernel finds a gap of 171 .* at vertex 0",
        "Test_BA_365_Edge_NURBS_control_point_containment.usda": "is broken: the kernel finds an edge of length",
        "Test_BA_763_UV_trim_curves_do_not_close_loop.usda": "is broken: the kernel finds a gap of 0.1 ",
        "Test_BA_764_Zero_length_UV_trim_curve.usda": "is broken: the kernel finds a gap of 1 ",
        "empty.usda": "body 0 is empty",
        "Test_BA_155_Invalid_U_range_order.usda": "body 0, face 0: its range in u is empty or the wrong way round .BA.155",
        "Test_BA_235_Invalid_edge_range_order.usda": "body 0, edge 0: its range is the wrong way round .BA.235",
    }
    for name, message in refused.items():
        with pytest.raises(ValueError, match=message):
            import_usd(files / name)
    # bodies that are only types the validator dislikes read as they are
    assert [b.volume for b in import_usd(files / "Test_BA_076_Invalid_region_attribute_data_types.usda")] == \
        pytest.approx([1, 1])


def _mutated(text: str, attribute: str, value: str) -> str:
    """The text with the first value of an array attribute replaced."""
    m = re.search(r"(\] |\[\] )" + re.escape(attribute) + r" = \[", text)
    start = m.end()
    item = re.match(r"\([^)]*\)|[^,\]]+", text[start:])
    return text[:start] + value + text[start + item.end():]


def test_usd_values_the_conversion_cannot_take_raise(tmp_path):
    # One bad number of a BrepArray crashed usd-brep's conversion (a sphere whose refDirection is
    # its axis), crashed the meshing later (a weight of 0), hung the volume (a torus axis of length
    # 0) or gave a wrong body that said it was valid (a cylinder axis of 0, an edge weight of 0, a
    # control point that is not a number). Now each raises ValueError naming the body, the face or
    # edge and the validator's rule; a cone axis of length 2 is made unit (it gave 496.58). In a
    # process of its own, so that a crash or a hang fails the test rather than the run.
    exported = {}
    for name, shape in [("ball", Sphere(5)), ("ring", Torus(10, 2)), ("tube", Cylinder(5, 10)), ("cube", Box(10, 10, 10)),
                        ("cone", Cone(5, 2, 10)), ("loft", loft([Rectangle(20, 20), Circle(8).translate((0, 0, 20))]))]:
        export_usd(shape.named(name), tmp_path / f"{name}.usda", mesh=False)
        exported[name] = (tmp_path / f"{name}.usda").read_text()
    cases = [
        ("ball", "brep:surface:sphere:refDirection", "(0, 0, 1)", "face 0: the axis and the refDirection are parallel (BA.482-484)"),
        ("ball", "brep:surface:sphere:refDirection", "(0, 0, 0)", "face 0: the refDirection has no length"),
        ("loft", "brep:surface:nurb:weights", "0", "its NURBS surface has a weight of 0, not positive (BA.440)"),
        ("ring", "brep:surface:torus:axis", "(0, 0, 0)", "face 0: the axis has no length (BA.523-525)"),
        ("tube", "brep:surface:cylinder:axis", "(0, 0, 0)", "the axis has no length (BA.502-504)"),
        ("tube", "brep:surface:cylinder:radius", "0", "the cylinder's radius is 0, not positive (BA.501)"),
        ("loft", "brep:edge3dNurb:curve3d:nurb:weights", "0", "body 0, edge 0: its NURBS curve has a weight of 0, not positive (BA.350)"),
        ("loft", "brep:edge3dNurb:curve3d:nurb:controlVertices", "(nan, 0, 0)",
         "brep:edge3dNurb:curve3d:nurb:controlVertices[0] is not a finite number (BA.660)"),
        ("cube", "brep:edge3dLine:curve3d:line:direction", "(0, 0, 0)", "body 0, edge 0: the line's direction has no length (BA.541)"),
        ("cube", "brep:intersectTol3d", "0", "body 0: brep:intersectTol3d is 0, not positive (BA.010)"),
        ("cube", "edge:range", "inf", "edge:range[0] is not a finite number (BA.660)"),
    ]
    for i, (name, attribute, value, _) in enumerate(cases):
        (tmp_path / f"case{i}.usda").write_text(_mutated(exported[name], attribute, value))
    (tmp_path / "long.usda").write_text(_mutated(exported["cone"], "brep:surface:cone:axis", "(0, 0, -2)"))
    code = f"""
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
for i in range({len(cases)}):
    try:
        import_usd({str(tmp_path)!r} + f"/case{{i}}.usda").volume
        print("read", flush=True)
    except ValueError as e:
        print(e, flush=True)
cone = import_usd({str(tmp_path / "long.usda")!r})
print(cone.is_valid(), round(cone.volume, 3), flush=True)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, run.stdout + run.stderr
    lines = run.stdout.split("\n")
    for (name, _, _, message), line in zip(cases, lines):
        assert line.startswith("usd: the BrepArray \"/World/" + name + "\" is malformed: ") and message in line, line
    assert lines[len(cases)] == f"True {Cone(5, 2, 10).volume:.3f}"


def _placed(tmp_path, text: str, **options) -> tuple[float, ...]:
    (tmp_path / "placed.usda").write_text(text)
    box = import_usd(tmp_path / "placed.usda", **options).bbox()
    return tuple(round(c, 6) + 0.0 for c in (*box.min, *box.max))


def _ops(text: str, ops: str, order: str) -> str:
    """The text with xformOps on /World."""
    return text.replace('def Xform "World"\n{\n', 'def Xform "World"\n{\n' + ops + f"    uniform token[] xformOpOrder = [{order}]\n", 1)


def test_usd_bodies_are_placed_as_the_stage_has_them(tmp_path):
    # import_usd read the bodies' arrays alone: the transforms of their prims and of the prims above
    # them, the stage's metersPerUnit and upAxis were left out, so assemblies fell onto their origins
    # and sizes were off by 10 or 1000, without a word.
    export_usd(Box(10, 10, 10), tmp_path / "box.usda", mesh=False)
    text = (tmp_path / "box.usda").read_text()
    moved = _ops(text, "    double3 xformOp:translate = (100, 0, 0)\n", '"xformOp:translate"').replace(
        "metersPerUnit = 0.001", "metersPerUnit = 0.01")
    assert _placed(tmp_path, moved) == (950, -50, -50, 1050, 50, 50)  # was (-5, -5, -5, 5, 5, 5)
    assert _placed(tmp_path, moved, placement=False) == (-50, -50, -50, 50, 50, 50)
    assert _placed(tmp_path, moved, units="mm") == (95, -5, -5, 105, 5, 5)
    # the kinds of xformOps, applied the last first; a Y-up stage turned to Z up
    export_usd(Box(10, 20, 30, align=Align.MIN), tmp_path / "corner.usda", mesh=False)
    corner = (tmp_path / "corner.usda").read_text()
    assert _placed(tmp_path, corner.replace('upAxis = "Z"', 'upAxis = "Y"')) == (0, -30, 0, 10, 0, 20)
    cases = [
        ("    float xformOp:rotateX = 90\n", '"xformOp:rotateX"', (0, -30, 0, 10, 0, 20)),
        ("    float3 xformOp:rotateXYZ = (90, 0, 90)\n", '"xformOp:rotateXYZ"', (0, 0, 0, 30, 10, 20)),
        ("    float3 xformOp:rotateZYX = (90, 0, 90)\n", '"xformOp:rotateZYX"', (-20, -30, 0, 0, 0, 10)),
        ("    quatf xformOp:orient = (0.70710678, 0, 0, 0.70710678)\n", '"xformOp:orient"', (-20, 0, 0, 0, 10, 30)),
        ("    double3 xformOp:translate = (100, 0, 0)\n    float xformOp:rotateZ = 90\n",
         '"xformOp:translate", "xformOp:rotateZ"', (80, 0, 0, 100, 10, 30)),
        ("    float3 xformOp:scale = (2, 1, 3)\n", '"xformOp:scale"', (0, 0, 0, 20, 20, 90)),
        ("    matrix4d xformOp:transform = ( (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (5, 6, 7, 1) )\n",
         '"xformOp:transform"', (-15, 6, 7, 5, 16, 37)),
        ("    double3 xformOp:translate:pivot = (5, 0, 0)\n    float xformOp:rotateZ = 180\n",
         '"xformOp:translate:pivot", "xformOp:rotateZ", "!invert!xformOp:translate:pivot"', (0, -20, 0, 10, 0, 30)),
    ]
    for ops, order, box in cases:
        assert _placed(tmp_path, _ops(corner, ops, order)) == box, order
    # a transform under another; !resetXformStack! drops those above
    nested = corner.replace('    def BrepArray "body"', '    double3 xformOp:translate = (0, 0, 100)\n'
                            '    uniform token[] xformOpOrder = ["xformOp:translate"]\n    def BrepArray "body"')
    assert _placed(tmp_path, nested) == (0, 0, 100, 10, 20, 130)
    reset = nested.replace("    def BrepArray \"body\" (\n", "    def BrepArray \"body\" (\n", 1).replace(
        "        uniform token[] face:surfaceType", '        uniform token[] xformOpOrder = ["!resetXformStack!"]\n'
        "        uniform token[] face:surfaceType", 1)
    assert _placed(tmp_path, reset) == (0, 0, 0, 10, 20, 30)


def test_usd_stages_compose_references_and_layers(tmp_path):
    # References, payloads and subLayers were not read ("holds no BrepArray prims"), and abstract,
    # inactive and over-only prims came in as bodies.
    export_usd(Box(10, 10, 10), tmp_path / "box.usda", mesh=False)
    head = '#usda 1.0\n(\n    metersPerUnit = 0.001\n    upAxis = "Z"\n)\n'
    (tmp_path / "parts").mkdir()
    (tmp_path / "parts" / "box.usda").write_text((tmp_path / "box.usda").read_text())
    (tmp_path / "scene.usda").write_text(head + """def Xform "Scene"
{
    def Xform "A" (
        prepend references = @./parts/box.usda@</World>
    )
    {
        double3 xformOp:translate = (0, 50, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def Xform "B" (
        prepend payload = @parts/box.usda@
    )
    {
        double3 xformOp:translate = (0, -50, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def Xform "C" (
        active = false
        references = @./parts/box.usda@</World>
    )
    {
    }
    class Xform "D" (
        references = @./parts/box.usda@</World>
    )
    {
    }
    def Xform "E" (
        references = </Scene/A>
    )
    {
        double3 xformOp:translate = (0, 0, 50)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
over "Nothing"
{
    def BrepArray "body"
    {
    }
}
""")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        bodies = import_usd(tmp_path / "scene.usda")
    # (two prims named "body": named by their paths)
    assert [b.name for b in bodies] == ["/Scene/A/body", "/Scene/B/body", "/Scene/E/body"]
    assert [b.bbox().center.to_tuple() for b in bodies] == [(0, 50, 0), (0, -50, 0), (0, 0, 50)]
    # a stage of sublayers: the stronger one's opinion wins
    (tmp_path / "moved.usda").write_text(head + 'over "World"\n{\n    double3 xformOp:translate = (7, 0, 0)\n'
                                         '    uniform token[] xformOpOrder = ["xformOp:translate"]\n}\n')
    (tmp_path / "stack.usda").write_text('#usda 1.0\n(\n    subLayers = [\n        @./moved.usda@,\n        @./box.usda@\n    ]\n)\n')
    assert import_usd(tmp_path / "stack.usda").bbox().center.to_tuple() == (7, 0, 0)
    # what cannot be read is named: in a warning, or in the error when no bodies are left
    (tmp_path / "missing.usda").write_text(head + 'def Xform "S" (\n    references = @./gone.usda@</World>\n)\n{\n}\n')
    with pytest.raises(ValueError, match="no BrepArray prims .bodies.; the reference ./gone.usda was not read .there is no file"):
        import_usd(tmp_path / "missing.usda")
    (tmp_path / "half.usda").write_text((tmp_path / "scene.usda").read_text().replace("parts/box.usda@</World>\n    )\n    {\n        double3 xformOp:translate = (0, 50",
                                                                                      "gone.usda@</World>\n    )\n    {\n        double3 xformOp:translate = (0, 50"))
    with pytest.warns(RuntimeWarning, match="the reference ./gone.usda was not read"):
        assert import_usd(tmp_path / "half.usda").name == "body"  # (B's; A, and E through A, have none)
    (tmp_path / "loop.usda").write_text(head + 'def Xform "L" (\n    references = </L>\n)\n{\n}\n')
    with pytest.raises(ValueError, match="references go round in a circle"):
        import_usd(tmp_path / "loop.usda")


def test_usd_line_edges_are_written_as_long_as_the_edges(tmp_path):
    # SMLib's lines have an unbounded interval: they were written as B-splines 2.5 km long (control
    # points at 1234572; usd-brep's validator: BA.365), and reading that back gave a box (bbox)
    # reaching to 1234560: the kernel's tight box of an edge took in the knots past its end
    # (SmCurve::CalculateTightBoundingBox, patched). Lines are written as lines now (X5).
    export_usd(Box(10, 10, 10), tmp_path / "box.usda", mesh=False)
    text = (tmp_path / "box.usda").read_text()
    assert "BrepCurve3dLineAPI:edge3dLine" in text and "edge3dNurb" not in text
    box = import_usd(tmp_path / "box.usda")
    assert [e.geom_type for e in box.edges()] == ["line"] * 12 and box.volume == pytest.approx(1000)
    assert box.bbox().max.to_tuple() == pytest.approx((5, 5, 5))
    # such a file as smlibpy 0.4 wrote the lines of a body it had read: B-splines reaching 1234567
    # along their parameter both ways (smlibpy's own file: read as it is). The box of the body read
    # back is its own.
    (tmp_path / "old.usda").write_text(_long_lines((DATA / "usd_bspline_edges.usda").read_text().replace(
        'string source = "another tool"', 'string source = "smlibpy"')))
    back = import_usd(tmp_path / "old.usda")
    assert [e.geom_type for e in back.edges()].count("bspline") == 14
    assert back.bbox().max.to_tuple() == pytest.approx((10, 10, 5))  # was 1234560


def _long_lines(text: str) -> str:
    """The text with each two-point NURBS edge (a line) reaching 1234567 along its parameter both
    ways, its edge as it was."""
    def values(name: str) -> tuple[re.Match[str], str]:
        m = re.search(r"(edge3dNurb:curve3d:nurb:" + name + r" = \[)([^\]]*)\]", text)
        return m, m.group(2)

    counts = [int(x) for x in values("vertexCount")[1].split(", ")]
    orders = [int(x) for x in values("order")[1].split(", ")]
    knots = [float(x) for x in values("knots")[1].split(", ")]
    cvs = [tuple(float(c) for c in p.split(",")) for p in re.findall(r"\(([^)]*)\)", values("controlVertices")[1])]
    new_knots, new_cvs = [], []
    ki = ci = 0
    for n, o in zip(counts, orders):
        ks, pts = knots[ki:ki + n + o], cvs[ci:ci + n]
        if n == 2 and o == 2:
            (a, b), (t0, t1) = pts, (ks[1], ks[2])
            d = [(y - x) / (t1 - t0) for x, y in zip(a, b)]
            pts = [tuple(x + c * (t - t0) for x, c in zip(a, d)) for t in (-1234567.0, 1234567.0)]
            ks = [-1234567.0, -1234567.0, 1234567.0, 1234567.0]
        new_knots += ks
        new_cvs += pts
        ki, ci = ki + n + o, ci + n
    for name, joined in (("knots", ", ".join(repr(k) for k in new_knots)),
                         ("controlVertices", ", ".join("(%r, %r, %r)" % p for p in new_cvs))):
        m, _ = values(name)
        text = text[:m.start(2)] + joined + text[m.end(2):]
    return text


def test_usd_bodies_that_other_writers_left_gaps_in(tmp_path):
    # The kernel's check runs on bodies smlibpy did not write: a vertex moved off its edges by
    # more than 1e-3 of the body's size is refused, a smaller gap noted; check=False reads it.
    export_usd(Box(10, 10, 10), tmp_path / "box.usda", mesh=False)
    theirs = (tmp_path / "box.usda").read_text().replace('string source = "smlibpy"', 'string source = "theirs"')
    first = re.search(r"brep:vertexPoint:point:position = \[\(([^)]*)\)", theirs).group(1)
    x, y, z = (float(c) for c in first.split(","))
    for gap, refused in [(0.5, True), (0.004, False)]:
        (tmp_path / "gap.usda").write_text(_mutated(theirs, "brep:vertexPoint:point:position", f"({x}, {y}, {z + gap})"))
        if refused:
            with pytest.raises(ValueError, match=r"is broken: the kernel finds a gap of 0.5 \(0.0\d+ of its size\) at vertex 0"):
                import_usd(tmp_path / "gap.usda")
            assert import_usd(tmp_path / "gap.usda", check=False).volume == pytest.approx(1000)
        else:
            with pytest.warns(RuntimeWarning, match="the kernel finds a gap of 0.004 "):
                import_usd(tmp_path / "gap.usda")



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
