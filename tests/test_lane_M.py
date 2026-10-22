"""Meshes, drawings and rays (kernel plan, lane M): normals at the apex of a cone, colors and
positions in glTF, mesh points in double precision, drawing views with hidden lines, contours,
and many rays at once."""

import json
import math
import struct

import numpy as np
import pytest

from smlibpy import (Axis, Box, Cone, Cylinder, DrawingView, Edge, GridLocations, Plane, Polygon, ShapeList, Sphere,
                     Torus, X, Y, Z, drawing_views, export, export_dxf, export_glb, export_obj, export_svg,
                     import_dxf_wires, surface)
from smlibpy._kernel import ext
from smlibpy.drawing import to_svg
from smlibpy.exporters import gltf_document
from smlibpy.mesh import Mesh


def total(edges) -> float:
    return sum(e.length for e in edges)


# =============================================================================
# Normals at the apex of a cone
# =============================================================================
def apex_errors(part, apex) -> list[float]:
    """For each triangle corner of the part's mesh at `apex`: the angle (degrees) between its
    normal and the exact normal of the part a little inside the triangle (oriented outward)."""
    mesh = part.mesh()
    v = mesh.vertices[mesh.triangles]
    out = []
    faces = list(part.faces())
    for t in range(len(mesh.triangles)):
        for c in range(3):
            if np.linalg.norm(v[t, c] - apex) > 1e-6:
                continue
            q = v[t, c] + 1e-4 * (v[t].mean(axis=0) - v[t, c])
            face = min(faces, key=lambda f: f.distance_to(q))
            exact = np.array(face.normal_at(q).to_tuple())
            facet = np.cross(v[t, 1] - v[t, 0], v[t, 2] - v[t, 0])
            if exact @ facet < 0:
                exact = -exact
            n = mesh.normals[t, c] / np.linalg.norm(mesh.normals[t, c])
            out.append(math.degrees(math.acos(min(1.0, float(n @ exact)))))
    return out


@pytest.mark.parametrize("part, apex", [
    (Cone(10, 0, 20), (0, 0, 10)),  # the tessellator gave every corner the normal of one line: 127 degrees off
    (Cone(0, 10, 20), (0, 0, -10)),
    (Cone(30, 0, 5), (0, 0, 2.5)),  # flat: 19 degrees off
    (Polygon((0, 0), (10, 0), (0, 15)).on(Plane.XZ).revolve(Axis((0, 0, 0), (0, 0, 1))), (0, 0, 15)),
])
def test_corners_at_the_apex_of_a_cone_get_the_normal_of_the_surface_beside_them(part, apex):
    errors = apex_errors(part, np.array(apex, dtype=float))
    assert len(errors) >= 32
    assert max(errors) < 2.0


def test_the_apex_of_a_moved_cone_and_of_one_fused_to_a_box():
    tilted = Cone(8, 0, 12).rotate(X, 37).translate(5, 5, 5)  # 113 degrees off before
    errors = []
    for v in tilted.vertices():  # (the apex, and the corners on the rim)
        errors += apex_errors(tilted, np.array(v.point.to_tuple()))
    assert max(errors) < 2.0 and len(errors) > 32
    fused = Cone(10, 0, 20).translate(0, 0, 10) + Box(30, 30, 4)
    assert max(apex_errors(fused, np.array([0.0, 0.0, 20.0]))) < 2.0


def test_the_poles_of_a_sphere_keep_their_normals():
    mesh = Sphere(10).mesh()
    v = mesh.vertices[mesh.triangles]
    poles = np.abs(np.abs(v[..., 2]) - 10) < 1e-9
    assert poles.any()
    n = mesh.normals[poles]
    radial = v[poles] / 10
    assert np.allclose(n, radial, atol=1e-6)


def test_poly_arrays_are_the_kernels_mesh_in_double_precision():
    part = Cone(10, 0, 20) + Box(30, 30, 4)
    poly = ext.tessellate(part._brep, chord_height_tolerance=0.05, curve_angle_tolerance_deg=15,
                          surface_angle_tolerance_deg=15)
    try:
        ours = ext.poly_arrays(poly, True, part._brep)
        kernel = poly.to_numpy_arrays(face_varying_normals=True)
        assert ours["points"].dtype == np.float64 and kernel["points"].dtype == np.float32
        assert ours["points"].shape == kernel["points"].shape
        assert np.abs(ours["points"] - kernel["points"]).max() < 1e-5
        assert np.array_equal(ours["faces"], kernel["faces"])
        assert np.allclose(ours["face_normals"], kernel["face_normals"])
        # without the body (or per point) the normals are the kernel's
        assert np.allclose(ext.poly_arrays(poly, True)["normals"], kernel["normals"])
        assert np.allclose(ext.poly_arrays(poly)["normals"], poly.to_numpy_arrays()["normals"])
    finally:
        ext.delete_polybrep(poly)


# =============================================================================
# Mesh points in double precision (M3)
# =============================================================================
def test_mesh_points_keep_their_precision_far_from_the_origin():
    box = Box(10.3, 10.7, 10.1).translate(1e6, 0, 0)
    mesh = box.mesh(0.001)
    assert mesh.vertices.dtype == np.float64
    assert mesh.volume == pytest.approx(box.volume, rel=1e-9)  # 1107.72 for 1113.12 through float32
    assert mesh.bbox().min.x == pytest.approx(1e6 - 5.15, abs=1e-9)
    ball = Sphere(5).translate(1e5, 0, 0)
    m = ball.mesh(0.001)
    radius = np.linalg.norm(m.vertices - (1e5, 0, 0), axis=1)
    assert np.abs(radius - 5).max() < 1e-6  # 3.8e-3 through float32


def glb_doc(path):
    data = path.read_bytes()
    n = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + n])
    m = struct.unpack("<I", data[20 + n:24 + n])[0]
    return doc, data[28 + n:28 + n + m]


def test_gltf_positions_are_relative_to_their_node(tmp_path):
    box = Box(10.3, 10.7, 10.1).translate(1e6, 2e5, -3e5)
    mesh = box.mesh()
    path = tmp_path / "far.glb"
    export_glb(box, path, edges=True)
    doc, buf = glb_doc(path)
    root = doc["nodes"][doc["scenes"][0]["nodes"][0]]
    node = doc["nodes"][root["children"][0]]
    assert node["translation"] == pytest.approx([1e6, 2e5, -3e5])
    prim = doc["meshes"][node["mesh"]]["primitives"][0]
    acc = doc["accessors"][prim["attributes"]["POSITION"]]
    view = doc["bufferViews"][acc["bufferView"]]
    pos = np.frombuffer(buf, np.float32, acc["count"] * 3, view["byteOffset"]).reshape(-1, 3)
    assert np.abs(pos).max() < 6  # (around the middle of the box)
    world = pos.astype(float) + node["translation"]
    assert np.abs(world - mesh.vertices[mesh.triangles].reshape(-1, 3)).max() < 1e-5
    assert acc["max"] == pytest.approx([5.15, 5.35, 5.05], abs=1e-5)
    lines = doc["meshes"][node["mesh"]]["primitives"][1]
    lacc = doc["accessors"][lines["attributes"]["POSITION"]]
    assert lacc["max"] == pytest.approx([5.15, 5.35, 5.05], abs=1e-5)  # (the edges move with it)
    # a shape at the origin needs no translation
    doc, _ = gltf_document(Box(2, 2, 2), edges=False)
    assert "translation" not in doc["nodes"][0]


def test_obj_writes_twelve_digits(tmp_path):
    box = Box(10.3, 10.7, 10.1).translate(1e6, 0, 0)
    path = tmp_path / "far.obj"
    export_obj(box, path)
    v = np.array([[float(x) for x in line.split()[1:]] for line in path.read_text().splitlines()
                  if line.startswith("v ")])
    assert np.abs(v - box.mesh().vertices).max() < 1e-5


# =============================================================================
# glTF colors (sRGB to linear)
# =============================================================================
def linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def test_gltf_base_colors_are_linear():
    doc, _ = gltf_document([Box(1, 1, 1), Box(1, 1, 1).translate(3, 0, 0).colored((255, 0, 0)),
                            Box(1, 1, 1).translate(6, 0, 0).colored("#808080")], edge_color="#1f2328")
    colors = [m["pbrMetallicRoughness"]["baseColorFactor"] for m in doc["materials"]]
    first = colors[0]
    assert first[:3] == pytest.approx([0.2016, 0.2918, 0.4621], abs=5e-4)  # the default #7c93b5
    assert first[0] == pytest.approx(linear(0x7c / 255))
    assert [1.0, 0.0, 0.0, 1.0] in colors  # (pure colors stay)
    gray = linear(0x80 / 255)
    assert [gray, gray, gray, 1.0] in [pytest.approx(c) for c in colors]
    edge = linear(0x1f / 255)
    assert any(c[0] == pytest.approx(edge) for c in colors)
    assert gray == pytest.approx(0.2158605, abs=1e-6)


# =============================================================================
# Drawing views with hidden lines (M4)
# =============================================================================
def lengths(edges) -> list[float]:
    return sorted(round(e.length, 6) for e in edges)


def test_outline_with_hidden_lines():
    part = Box(40, 30, 20) - Cylinder(6, 40)
    visible, hidden = part.outline(Plane.XZ, hidden=True)
    assert lengths(visible) == [20, 20, 40, 40]
    assert lengths(hidden) == [20, 20]  # the bore's contour lines; its circles lie under the box's edges
    assert sorted(round(e.center().x, 6) for e in hidden) == [-6, 6]
    assert all(abs(p.y) < 1e-9 for e in visible + hidden for p in (e.start, e.end))  # in the plane
    # the visible lines are those of outline() without hidden lines
    assert lengths(part.outline(Plane.XZ)) == lengths(visible)
    tube = Cylinder(10, 20) - Cylinder(5, 30)
    visible, hidden = tube.outline(Plane.YZ, hidden=True)
    assert total(visible) == pytest.approx(80) and total(hidden) == pytest.approx(40)
    # the bottom square lies under the top square
    visible, hidden = Box(20, 20, 20).outline(Plane.XY, hidden=True)
    assert total(visible) == pytest.approx(80) and not hidden
    visible, hidden = Box(20, 20, 20).outline(Plane(origin=(0, 0, 0), z_dir=(1, 1, 1)), hidden=True)
    assert len(visible) == 9 and len(hidden) == 3
    assert total(hidden) == pytest.approx(3 * 20 * math.sqrt(2 / 3))
    visible, hidden = Torus(20, 5).outline(Plane.YZ, hidden=True)
    assert total(visible) == pytest.approx(80 + 10 * math.pi, rel=1e-6)
    assert total(hidden) == pytest.approx(10 * math.pi, rel=1e-6)  # the inner halves of the tube's circles


def test_outline_tangent_edges():
    box = Box(40, 30, 10)
    box = box.fillet(box.edges().group_by(Z)[-1], 3)
    plain = box.outline(Plane.XY)
    tangent = box.outline(Plane.XY, tangent_edges=True)
    assert total(tangent) - total(plain) == pytest.approx(2 * 34 + 2 * 24, rel=1e-6)  # the inner tangent rectangle
    visible, hidden = box.outline(Plane.XY, hidden=True)
    assert total(visible) == pytest.approx(total(plain), rel=1e-6) and not hidden  # (no tangent lines, not even hidden)


def test_drawing_views_first_and_third_angle():
    part = Box(40, 30, 20) - Cylinder(6, 40)
    views = drawing_views(part)
    assert [v.name for v in views] == ["front", "top", "left"]
    front, top, left = views
    assert isinstance(front, DrawingView) and front.direction.to_tuple() == (0, -1, 0)
    assert lengths(front.hidden) == [20, 20] and not top.hidden and lengths(left.hidden) == [20, 20]
    gap = 0.2 * 40
    fb, tb, lb = front.bbox(), top.bbox(), left.bbox()
    assert (fb.min.x, fb.min.y, fb.max.x, fb.max.y) == pytest.approx((-20, -10, 20, 10))
    assert tb.max.y == pytest.approx(fb.min.y - gap) and tb.min.x == pytest.approx(-20)  # below, first-angle
    assert lb.min.x == pytest.approx(fb.max.x + gap) and lb.min.y == pytest.approx(-10)  # to the right
    assert all(abs(p.z) < 1e-9 for v in views for e in v.visible + v.hidden for p in (e.start, e.end))
    third = {v.name: v.bbox() for v in drawing_views(part, ("front", "top", "left", "right", "bottom", "back"),
                                                       projection="third-angle", gap=5)}
    assert third["top"].min.y == pytest.approx(15) and third["bottom"].max.y == pytest.approx(-15)
    assert third["left"].max.x == pytest.approx(-25) and third["right"].min.x == pytest.approx(25)
    assert third["back"].min.x == pytest.approx(third["right"].max.x + 5)
    first = {v.name: v.bbox() for v in drawing_views(part, ("front", "right", "back"), gap=5)}
    assert first["right"].max.x == pytest.approx(-25) and first["back"].min.x == pytest.approx(25)
    assert not drawing_views(part, ("front",), hidden=False)[0].hidden
    with pytest.raises(ValueError, match="unknown view 'side'"):
        drawing_views(part, ("front", "side"))
    with pytest.raises(ValueError, match="first-angle"):
        drawing_views(part, projection="second-angle")


def test_drawing_views_as_dxf_and_svg(tmp_path):
    part = Box(40, 30, 20) - Cylinder(6, 40)
    views = drawing_views(part)
    dxf = tmp_path / "views.dxf"
    export_dxf(views, dxf)
    text = dxf.read_text()
    assert "\nDASHED\n" in text
    assert total(import_dxf_wires(dxf, layers="HIDDEN")) == pytest.approx(80)
    assert total(import_dxf_wires(dxf, layers="VISIBLE")) == pytest.approx(sum(total(v.visible) for v in views))
    svg = to_svg(views)
    assert svg.startswith("<?xml") and 'class="hidden"' in svg and "stroke-dasharray" in svg
    assert " A6 6 0 1 0 " in svg  # the bore in the top view: a circle, exactly
    path = tmp_path / "views.svg"
    export_svg(views, path)
    assert path.read_text() == svg
    export(views, tmp_path / "again.svg")
    assert (tmp_path / "again.svg").read_text() == svg
    with pytest.raises(ValueError, match="nothing to draw"):
        to_svg([])
    with pytest.raises(TypeError, match="not a Part"):
        to_svg(part)


def test_svg_arcs_turn_the_right_way():
    from smlibpy import CenterArc

    arc = CenterArc((0, 0), 5, 0, 90)  # counterclockwise from +X to +Y
    svg = to_svg(arc, margin=0)
    assert "M5 0 A5 5 0 0 0 0 -5" in svg  # (the SVG's y runs down)


# =============================================================================
# Contours (silhouette) and parting lines
# =============================================================================
def test_silhouette_is_the_contour():
    box = Box(20, 20, 20)
    contour = box.silhouette((1, 1, 1))
    assert len(contour) == 6 and total(contour) == pytest.approx(120)  # 9 visible edges, 180, before
    assert total(contour) == pytest.approx(total(box.parting_line((1, 1, 1))))
    assert sorted(round(e.center().z, 9) for e in box.silhouette(Z)) == [10] * 4  # the near edges
    assert sorted(round(e.center().z, 9) for e in box.silhouette(-Z)) == [-10] * 4
    torus = Torus(20, 5)
    # two circles of radius 20 and two of radius 5: 314.16 (the visible 157.08 before)
    assert total(torus.silhouette(X)) == pytest.approx(2 * math.pi * 50, rel=1e-6)
    assert total(torus.silhouette(-X)) == pytest.approx(2 * math.pi * 50, rel=1e-6)
    rim = Sphere(10).silhouette(Z)
    assert len(rim) == 1 and rim[0].geom_type == "circle" and rim[0].length == pytest.approx(20 * math.pi)
    sides = Cylinder(5, 20).silhouette(X)
    assert lengths(sides) == pytest.approx([5 * math.pi, 5 * math.pi, 20, 20])
    assert all(e.point_at(0.5).x > 4.99 for e in sides if e.geom_type == "circle")  # the near rims


def test_silhouette_of_a_sheet():
    pts = [[(x, y, 3 * math.sin(x / 5) * math.cos(y / 7)) for x in range(0, 31, 3)] for y in range(0, 31, 3)]
    sheet = surface(pts)
    contour = sheet.silhouette(X)
    assert len(contour) > 0
    face = sheet.faces()[0]
    for e in contour:
        for t in (0.25, 0.5, 0.75):
            p = e.point_at(t)
            assert abs(face.normal_at(p).x) < 1e-4  # where the sheet turns away


def test_parting_line_of_a_torus_along_minus_x():
    assert total(Torus(20, 5).parting_line((-1, 0, 0))) == pytest.approx(2 * math.pi * 50, rel=1e-6)


# =============================================================================
# Many rays at once (M5)
# =============================================================================
def same_hit(a, b, tol=1e-7) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a.distance - b.distance) <= tol and (a.point - b.point).length <= tol


def random_rays(box, n, seed):
    rng = np.random.default_rng(seed)
    d = rng.normal(size=(n, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    o = box.center.to_tuple() - d * box.diagonal + rng.uniform(-0.3, 0.3, (n, 3)) * box.diagonal
    return o, d


def test_mesh_raycast_many_finds_the_first_hits_of_raycast():
    for mesh in (Sphere(10).mesh(0.01), (Box(40, 30, 20) - Cylinder(5, 30)).mesh()):
        o, d = random_rays(mesh.bbox(), 300, 1)
        many = mesh.raycast_many(o, d)
        assert len(many) == 300 and sum(h is not None for h in many) > 100
        for i in range(300):
            first = mesh.raycast(o[i], d[i])
            h = many[i]
            assert same_hit(first[0] if first else None, h, 1e-9)
            if h is not None:
                assert h.triangle == first[0].triangle and h.face is None
                assert (h.normal - first[0].normal).length < 1e-12
    # one direction for all, a ray from a face, a miss, none
    mesh = Box(10, 10, 10).mesh()
    hits = mesh.raycast_many([(0, 0, 20), (0, 0, 5), (50, 0, 20)], (0, 0, -1))
    assert hits[0].distance == pytest.approx(15) and hits[1].distance == pytest.approx(0) and hits[2] is None
    assert mesh.raycast_many(np.zeros((0, 3)), Z) == []
    with pytest.raises(ValueError, match="the direction must not be zero"):
        mesh.raycast_many([(0, 0, 0)], (0, 0, 0))
    with pytest.raises(ValueError, match="one for each"):
        mesh.raycast_many([(0, 0, 0)] * 3, [(0, 0, 1), (0, 1, 0)])


@pytest.mark.parametrize("make", [
    lambda: Box(40, 30, 20) - Cylinder(5, 30),
    lambda: Sphere(10),
    lambda: Torus(20, 5),
    lambda: Box(30, 20, 10).fillet(Box(30, 20, 10).edges(), 2),
])
def test_part_raycast_many_finds_the_first_hits_of_raycast(make):
    part = make()
    o, d = random_rays(part.bbox(), 250, 2)
    many = part.raycast_many(o, d)
    for i in range(len(o)):
        first = part.raycast(o[i], d[i])
        exact = first[0] if first else None
        assert same_hit(exact, many[i])
        if exact is not None:
            assert many[i].face == exact.face and (many[i].normal - exact.normal).length < 1e-7
    grid = [(x, y) for x in np.linspace(-12.3, 11.7, 7) for y in np.linspace(-9.1, 8.9, 5)]  # (none grazes)
    down = part.raycast_many([(x, y, 50) for x, y in grid], -Z)
    for (x, y), h in zip(grid, down):
        exact = part.raycast((x, y, 50), -Z)
        assert same_hit(exact[0] if exact else None, h)


def test_part_raycast_many_near_the_rims_of_holes_and_from_inside():
    plate = Box(200, 200, 5) - GridLocations(14, 14, 12, 12) * Cylinder(3, 10)
    rng = np.random.default_rng(4)
    o = np.column_stack([rng.uniform(-100, 100, (400, 2)), np.full(400, 20.0)])
    many = plate.raycast_many(o, (0, 0, -1))
    for i in range(400):
        exact = plate.raycast(o[i], (0, 0, -1))
        assert same_hit(exact[0] if exact else None, many[i])
    # through a hole 0.01 inside its wall: the mesh's chords cover it, the hole does not
    near_wall = [(7 + 2.99 * math.cos(a), 7 + 2.99 * math.sin(a), 20) for a in np.linspace(0, 2 * math.pi, 40)]
    for p, h in zip(near_wall, plate.raycast_many(near_wall, -Z)):
        exact = plate.raycast(p, -Z)
        assert same_hit(exact[0] if exact else None, h)
    part = Box(40, 30, 20) - Cylinder(5, 30)
    inside = part.raycast_many([(10, 8, 0)] * 4, [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 1)])
    for h, d in zip(inside, [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 1)]):
        assert same_hit(part.raycast((10, 8, 0), d)[0], h)
    on = part.raycast_many([(10, 8, 10), (10, 8, 10)], [(0, 0, -1), (0, 0, 1)])
    assert on[0].distance == pytest.approx(0, abs=1e-9) and on[1].distance == pytest.approx(0, abs=1e-9)


def test_rays_along_a_cylinder_mesh_its_faces_once():
    cylinder = Cylinder(10, 20)
    assert "faces" not in cylinder._h.meshes
    first = cylinder.raycast((0, 0, 50), (0, 0, -1))  # along the axis: the kernel's intersection fails
    assert first and "faces" in cylinder._h.meshes
    meshes = cylinder._h.meshes["faces"]
    cylinder.raycast((0, 0, 50), (0, 0, -1))
    assert cylinder._h.meshes["faces"] is meshes  # made once per body
    hits = cylinder.raycast_many([(3, 0, 50), (0, 0, 50)], -Z)
    assert [h.distance for h in hits] == pytest.approx([40, 40])
    assert "rays" in cylinder._h.meshes
