"""Meshes, drawings and rays (kernel plan, lane M): normals at the apex of a cone, colors and
positions in glTF, mesh points in double precision, drawing views with hidden lines, contours,
and many rays at once; mass properties, sections, decimation, repair and faceted parts of meshes,
a longest edge for tessellation, normals in OBJ files, indexed glTF and normals of mesh
Booleans."""

import json
import math
import struct

import numpy as np
import pytest

import warnings

from smlibpy import (Axis, Box, Cone, Cylinder, DrawingView, Edge, GridLocations, ModelingError, Part, Plane, Polygon,
                     ShapeList, Sphere, Torus, X, Y, Z, drawing_views, export, export_dxf, export_glb, export_obj,
                     export_stl, export_svg, import_dxf_wires, import_stl, make_face, surface, tessellate)
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
    iacc = doc["accessors"][prim["indices"]]
    index = np.frombuffer(buf, np.uint16, iacc["count"], doc["bufferViews"][iacc["bufferView"]]["byteOffset"])
    world = pos[index].astype(float) + node["translation"]
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


# =============================================================================
# Mass properties of meshes (M11)
# =============================================================================
def test_mesh_mass_properties_of_a_box_are_exact():
    m = Box(10, 20, 30).translate(5, 6, 7).mesh()
    mp = m.mass_properties(2.0)
    assert mp.volume == pytest.approx(6000, rel=1e-12) and mp.mass == pytest.approx(12000, rel=1e-12)
    assert mp.center.to_tuple() == pytest.approx((5, 6, 7), abs=1e-12)
    assert m.centroid.to_tuple() == pytest.approx((5, 6, 7), abs=1e-12)
    expected = np.diag([12000 / 12 * (20**2 + 30**2), 12000 / 12 * (10**2 + 30**2), 12000 / 12 * (10**2 + 20**2)])
    assert np.abs(mp.inertia - expected).max() < 1e-7 * expected.max()
    assert mp.area == pytest.approx(2 * (200 + 300 + 600))
    # far from the origin the numbers keep their digits
    far = Box(10, 20, 30).translate(1e6, -2e5, 3e5).mesh().mass_properties(2.0)
    assert far.center.to_tuple() == pytest.approx((1e6, -2e5, 3e5), abs=1e-6)
    assert np.abs(far.inertia - expected).max() < 1e-6 * expected.max()


def test_mesh_mass_properties_match_the_kernel_and_the_part():
    part = Box(40, 30, 20) - Cylinder(6, 40)
    m = part.mesh(0.01)
    mp = m.mass_properties()
    poly = m._kernel_mesh()
    try:
        kp = poly.mass_properties(1.0)  # (SmApiPolyBrepComputeMassProperties)
    finally:
        ext.delete_polybrep(poly)
    assert mp.volume == pytest.approx(kp["volume"], rel=1e-12)
    assert np.diag(mp.inertia) == pytest.approx(kp["moments_of_inertia"], rel=1e-9)
    assert mp.center.to_tuple() == pytest.approx(kp["centroid"], abs=1e-9)
    exact = part.mass_properties()
    assert mp.volume == pytest.approx(exact.volume, rel=2e-4)
    assert np.abs(mp.inertia - exact.inertia).max() < 1e-4 * np.abs(exact.inertia).max()


def test_empty_open_and_inward_meshes_say_why():
    empty = Box(5, 5, 5).mesh() - Box(10, 10, 10).mesh()
    assert len(empty) == 0
    with pytest.raises(ValueError, match="an empty mesh has no bounding box"):
        empty.bbox()
    with pytest.raises(ValueError, match="an empty mesh has no bounding box"):
        empty.center()
    with pytest.raises(ValueError, match="no mass properties"):
        empty.mass_properties()
    box = Box(10, 10, 10).mesh()
    with pytest.raises(ModelingError, match=r"open \(3 open edges\).*fill_holes"):
        Mesh(box.vertices, box.triangles[1:]).mass_properties()
    with pytest.raises(ModelingError, match="face inward"):
        Mesh(box.vertices, box.triangles[:, ::-1]).centroid
    with pytest.raises(ValueError, match="density"):
        box.mass_properties(0)


# =============================================================================
# Sections of meshes (M7)
# =============================================================================
def loop_area(wire: Edge, plane: Plane) -> float:
    """Signed area of a closed polyline seen from the plane's normal."""
    p = np.array([e.start.to_tuple() for e in wire.edges()])
    x, y = p @ np.array(plane.x_dir.to_tuple()), p @ np.array(plane.y_dir.to_tuple())
    return 0.5 * float((x * np.roll(y, -1) - np.roll(x, -1) * y).sum())


def test_mesh_section_chains_closed_loops_outer_counterclockwise():
    part = Box(40, 30, 20) - Cylinder(6, 40)
    m = part.mesh(0.01)
    loops = m.section(Plane.XY)
    assert isinstance(loops, ShapeList) and len(loops) == 2 and all(w.is_closed for w in loops)
    outer, hole = loops
    assert len(outer.edges()) == 4 and outer.length == pytest.approx(140, abs=1e-9)  # (straight runs joined)
    assert hole.length == pytest.approx(2 * math.pi * 6, rel=1e-3)  # (a polygon within 0.01 of the circle)
    assert loop_area(outer, Plane.XY) == pytest.approx(1200, rel=1e-12) and loop_area(hole, Plane.XY) < 0
    region = make_face(outer) - make_face(hole)
    assert region.area == pytest.approx(part.section(Plane.XY).area, rel=1e-3)
    # a plane on the top or bottom face of the mesh cuts it just inside
    for z in (10, -10):
        on = m.section(Plane.XY.offset(z))
        assert [round(w.length, 6) for w in on] == [round(w.length, 6) for w in loops]
        assert all(abs(e.start.z - z) < 1e-12 for w in on for e in w.edges())
    assert len(m.section(Plane.XY.offset(30))) == 0
    # a slanted plane through a far mesh, and a mesh whose triangles each have their own corners
    soup = Mesh(m.vertices[m.triangles].reshape(-1, 3), np.arange(3 * len(m)).reshape(-1, 3))
    assert sum(w.length for w in soup.section(Plane.XZ)) == pytest.approx(sum(w.length for w in m.section(Plane.XZ)))
    near = sum(w.length for w in m.section(Plane((0, 0, 0), z_dir=(0, 1, 1))))
    far = sum(w.length for w in m.translate(1e5, 0, 0).section(Plane((1e5, 0, 0), z_dir=(0, 1, 1))))
    assert far == pytest.approx(near, rel=1e-9)


def test_mesh_section_of_an_open_mesh_gives_open_polylines():
    side = Cylinder(5, 10).faces().filter_by(lambda f: f.geom_type == "cylinder")[0]
    m = tessellate(side, 0.01)
    assert not m.is_closed()
    lines = m.section(Plane.XZ)
    assert len(lines) == 2 and not any(w.is_closed for w in lines)
    assert all(w.length == pytest.approx(10, abs=1e-9) and len(w.edges()) == 1 for w in lines)


def test_slices_of_meshes_and_parts():
    part = Box(40, 30, 20) - Cylinder(6, 40)
    m = part.mesh(0.01)
    layers = m.slices(5)
    assert len(layers) == 4 and all(len(layer) == 2 for layer in layers)
    assert [layer[0].edges()[0].start.z for layer in layers] == pytest.approx([-7.5, -2.5, 2.5, 7.5])
    sketches = part.slices(5)
    assert [s.plane.origin.z for s in sketches] == pytest.approx([-7.5, -2.5, 2.5, 7.5])
    assert all(s.area == pytest.approx(1200 - math.pi * 36, rel=1e-9) for s in sketches)
    across = part.slices(7, X)  # x from -20 to 20: middles of 7-wide layers
    assert [s.plane.origin.x for s in across] == pytest.approx([-16.5, -9.5, -2.5, 4.5, 11.5, 18.5])
    assert [round(s.area, 3) for s in across] == [round(part.section(s.plane).area, 3) for s in across]
    assert across[0].area == pytest.approx(600) and across[2].area < 600
    # two parts with a gap: the layer in the gap is left out
    pair = Box(10, 10, 10) + Box(10, 10, 10).translate(0, 0, 20)
    assert len(pair.slices(10)) == 2 and len(pair.mesh().slices(10)) == 2
    with pytest.raises(ValueError, match="step"):
        m.slices(0)


# =============================================================================
# Decimation (M6)
# =============================================================================
@pytest.fixture(scope="module")
def fine_sphere():
    return Sphere(10).mesh(0.001)  # 136 872 triangles, within 0.001 of the sphere


def off_sphere(m: Mesh, radius: float = 10.0) -> float:
    """How far a mesh's points and the middles of its triangles are off a sphere at the origin."""
    p = np.vstack([m.vertices, m.vertices[m.triangles].mean(axis=1)])
    return float(np.abs(np.linalg.norm(p, axis=1) - radius).max())


def test_decimate_by_fraction_and_count_keeps_the_sphere_closed(fine_sphere):
    tenth = fine_sphere.decimate(0.9)
    assert len(tenth) == pytest.approx(len(fine_sphere) / 10, rel=0.02)
    assert tenth.is_closed() and tenth.volume == pytest.approx(fine_sphere.volume, rel=1e-3)
    assert off_sphere(tenth) < 0.02
    assert tenth.normals.shape == (len(tenth), 3, 3)
    assert np.abs(np.linalg.norm(tenth.normals, axis=2) - 1).max() < 1e-5
    # smooth normals on the sphere (no crease): near the radial direction at the corners (the
    # kernel's folded slivers are turned back, tilted ones take the normals around them)
    radial = tenth.vertices[tenth.triangles] / np.linalg.norm(tenth.vertices[tenth.triangles], axis=2, keepdims=True)
    along = np.einsum("ijk,ijk->ij", tenth.normals, radial)
    assert (along > 0.99).mean() > 0.99
    middles = tenth.vertices[tenth.triangles].mean(axis=1)
    assert (np.einsum("ij,ij->i", tenth.triangle_normals, middles) < 0).sum() <= 10  # (few folds, if any)
    few = fine_sphere.decimate(triangles=2000)
    assert few.is_closed() and len(few) == pytest.approx(2000, rel=0.02)
    same = fine_sphere.decimate(triangles=10**6)
    assert len(same) == len(fine_sphere) and same is not fine_sphere


def test_decimate_to_a_tolerance_measures_the_distance(fine_sphere):
    from smlibpy.mesh import _deviation

    m = fine_sphere.decimate(tolerance=0.01)
    assert m.is_closed() and len(m) < len(fine_sphere) / 5
    assert _deviation(fine_sphere, m) <= 0.01
    assert off_sphere(m) <= 0.01 + 0.001  # (the fine mesh is within 0.001 of the sphere itself)
    coarse = fine_sphere.decimate(tolerance=0.05)
    assert len(coarse) < len(m)


def test_decimate_keeps_the_border_of_an_open_mesh_and_checks_its_input():
    dome = Sphere(10).split(Plane.XY).faces().filter_by(lambda f: f.geom_type == "sphere")[0]
    m = tessellate(dome, 0.01)
    rim = m.vertices[m.triangles][np.abs(m.vertices[m.triangles][..., 2]).max(axis=1) < 1e-9]
    half = m.decimate(0.5)
    assert len(half) < 0.6 * len(m) and half._open_edge_count() == m._open_edge_count() == 128
    assert np.abs(half.vertices[:, 2]).min() < 1e-12  # (the rim's points stay where they were)
    # a tube of long triangles has all its points on its rims: the kernel collapses it to 2
    side = Cylinder(5, 10).faces().filter_by(lambda f: f.geom_type == "cylinder")[0]
    with pytest.raises(ModelingError, match="collapsed the mesh to 2 triangles"):
        tessellate(side, 0.001).decimate(0.5)
    box = (Box(40, 30, 20) - Cylinder(6, 40)).mesh(0.01)
    assert box.decimate(0.5).is_closed() and box.decimate(0.5).volume == pytest.approx(box.volume, rel=1e-3)
    with pytest.raises(TypeError, match="one of fraction, triangles or tolerance"):
        box.decimate()
    with pytest.raises(TypeError, match="one of"):
        box.decimate(0.5, triangles=10)
    with pytest.raises(ValueError, match="between 0 and 1"):
        box.decimate(1.5)
    with pytest.raises(ValueError, match="4 triangles"):
        box.decimate(triangles=2)


# =============================================================================
# Holes and repair (M9)
# =============================================================================
def test_fill_holes_closes_holes_that_touch_and_keeps_the_triangles(fine_sphere):
    s = Sphere(10).mesh(0.01)
    drop = [0, 70, 140, 210, 280]  # (three of them meet at a pole)
    holed = Mesh(s.vertices, np.delete(s.triangles, drop, axis=0), np.delete(s.normals, drop, axis=0))
    assert holed._open_edge_count() == 15
    filled = holed.fill_holes()
    assert filled.is_closed() and len(filled) == len(s)
    assert filled.volume == pytest.approx(s.volume, rel=1e-12)  # (each hole was one triangle)
    assert np.array_equal(filled.triangles[:len(holed)], holed.triangles)
    assert np.array_equal(filled.normals[:len(holed)], holed.normals)
    # a large hole that is not flat: the cap above z = 9.5 and a slanted cut
    middles = fine_sphere.vertices[fine_sphere.triangles].mean(axis=1)
    keep = middles[:, 2] + 0.3 * middles[:, 0] < 9.0
    capless = Mesh(fine_sphere.vertices, fine_sphere.triangles[keep])
    closed = capless.fill_holes()
    h = 10 - 9 / math.hypot(1, 0.3)  # the cap cut off by the plane z + 0.3 x = 9
    cap = math.pi * h * h * (30 - h) / 3
    assert closed.is_closed() and fine_sphere.volume - closed.volume == pytest.approx(cap, rel=0.1)


def test_repaired_merges_turns_and_reports():
    m = (Box(40, 30, 20) - Cylinder(6, 40)).mesh(0.01)
    tri = m.triangles.copy()
    tri[::5] = tri[::5, ::-1]  # every fifth triangle turned
    soup_triangles = np.arange(3 * len(tri)).reshape(-1, 3)
    soup = Mesh(m.vertices[tri].reshape(-1, 3), np.vstack([soup_triangles, soup_triangles[:1], [[0, 0, 1]]]))
    fixed, report = soup.repaired()
    assert report == {"merged_vertices": 3 * len(tri) - len(m.vertices), "removed_triangles": 2,
                      "flipped_triangles": len(tri[::5]), "filled_holes": 0, "open_holes": 0, "open_edges": 0}
    assert fixed.is_closed() and len(fixed.vertices) == len(m.vertices)
    assert fixed.volume == pytest.approx(m.volume, rel=1e-12)
    # a mesh that faces inward all over turns outward; normals turn with their triangles
    inward = Mesh(m.vertices, m.triangles[:, ::-1], -m.normals[:, ::-1])
    out, report = inward.repaired()
    assert report["flipped_triangles"] == len(m) and out.volume == pytest.approx(m.volume, rel=1e-12)
    # (each corner's normal is the one of its point in the mesh: triangles may start at another corner)
    expected = {(tuple(sorted(t)), v): n for t, n in zip(m.triangles.tolist(), m.normals) for v, n in zip(t, n)}
    assert all(np.allclose(n, expected[(tuple(sorted(t)), v)]) for t, ns in zip(out.triangles.tolist(), out.normals)
               for v, n in zip(t, ns))
    # a soup with normals: each corner keeps its normal, turned with its triangle
    soup_n = m.normals.copy()
    soup_n[::5] = -soup_n[::5, ::-1]  # (the turned triangles' normals face with them: inward)
    turned = Mesh(m.vertices[tri].reshape(-1, 3), soup_triangles, soup_n)
    out, report = turned.repaired()
    assert report["merged_vertices"] > 0 and report["flipped_triangles"] == len(tri[::5])
    corner = {}
    for v, n in zip(out.vertices[out.triangles].reshape(-1, 3), out.normals.reshape(-1, 3)):
        corner.setdefault(tuple(np.round(v, 9)), []).append(n)
    for v, n in zip(m.vertices[m.triangles].reshape(-1, 3), m.normals.reshape(-1, 3)):
        assert min(np.linalg.norm(x - n) for x in corner[tuple(np.round(v, 9))]) < 1e-6
    assert (np.einsum("ijk,ik->ij", out.normals, out.triangle_normals) > 0).all()
    # a hole and a border that does not close
    holed, report = Mesh(m.vertices, m.triangles[1:]).repaired()
    assert holed.is_closed() and report["filled_holes"] == 1 and report["open_edges"] == 0


# =============================================================================
# Faceted parts of meshes (M8)
# =============================================================================
def test_to_part_merges_flat_triangles_and_keeps_the_volume(tmp_path):
    part = Box(40, 30, 20) - Cylinder(6, 40)
    m = part.mesh(0.01)
    faceted = m.to_part()
    assert isinstance(faceted, Part) and faceted.is_valid()
    assert faceted.volume == pytest.approx(m.volume, rel=1e-9)
    assert len(faceted.faces()) == 6 + len(m.section(Plane.XY)[1].edges())  # (6, and a face per facet of the bore)
    assert len(faceted.faces().filter_by(Z)) == 2  # top and bottom: one face each, with the hole
    cut = faceted - Box(10, 10, 40).translate(20, 15, 0)
    assert cut.is_valid() and cut.volume == pytest.approx(faceted.volume - 25 * 20, rel=1e-9)
    # from an STL file, and as Part.from_mesh
    export_stl(part, tmp_path / "p.stl", tolerance=0.01)
    stl = import_stl(tmp_path / "p.stl")
    again = Part.from_mesh(stl)
    assert again.is_valid() and again.volume == pytest.approx(stl.volume, rel=1e-9)
    ball = Part.from_mesh(Sphere(10).mesh(0.3))
    assert ball.is_valid() and (ball - Box(5, 5, 40)).is_valid()


def test_to_part_refuses_open_and_large_meshes():
    box = Box(10, 10, 10).mesh()
    with pytest.raises(ModelingError, match=r"open \(3 open edges\).*fill_holes"):
        Mesh(box.vertices, box.triangles[1:]).to_part()
    ball = Sphere(10).mesh(0.3)
    with pytest.raises(ModelingError, match=r"faces, more than max_faces=100.*decimate"):
        ball.to_part(max_faces=100)
    assert ball.to_part(max_faces=0).is_valid()
    with pytest.raises(TypeError, match="takes a Mesh"):
        Part.from_mesh(Box(1, 1, 1))


# =============================================================================
# A longest edge for tessellation (M10)
# =============================================================================
def longest_edge(m: Mesh) -> float:
    p = m.vertices[m.triangles]
    return float(np.linalg.norm(p - np.roll(p, 1, axis=1), axis=2).max())


def test_max_edge_bounds_the_triangles(tmp_path):
    plate = Box(100, 100, 2) - Cylinder(5, 10)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        plain, fine = plate.mesh(0.1), plate.mesh(0.1, max_edge=10)
    assert longest_edge(plain) > 100 and longest_edge(fine) < 13 and len(fine) > 4 * len(plain)
    assert fine.is_closed() and fine.volume == pytest.approx(plain.volume, rel=1e-9)
    assert longest_edge(tessellate(plate, 0.1, max_edge=5)) < 7
    export_stl(plate, tmp_path / "fine.stl", tolerance=0.1, max_edge=10)
    assert len(import_stl(tmp_path / "fine.stl")) == len(fine)
    doc, _ = gltf_document(plate, tolerance=0.1, max_edge=10, edges=False)
    assert doc["accessors"][doc["meshes"][0]["primitives"][0]["indices"]]["count"] == 3 * len(fine)
    with pytest.raises(ValueError, match="max_edge"):
        plate.mesh(max_edge=0)


def test_max_edge_on_a_twisted_part_warns_where_the_grid_is_off():
    bar = Box(10, 10, 40).twist(90)
    with pytest.warns(RuntimeWarning, match=r"twisted face.*0\.13\d* off it, for a tolerance of 0\.01"):
        coarse = bar.mesh(0.01, max_edge=5)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        fine = bar.mesh(0.01, max_edge=1)  # (fine enough: no warning)
        bar.mesh(0.01)
    assert len(fine) > len(coarse) and longest_edge(fine) < 1.5


# =============================================================================
# Normals in OBJ files, indexed glTF, normals of mesh Booleans (M12)
# =============================================================================
def test_obj_names_the_normal_of_each_corner(tmp_path):
    part = Box(40, 30, 20) - Cylinder(6, 40)
    m = part.mesh()
    export_obj(part, tmp_path / "p.obj")
    lines = (tmp_path / "p.obj").read_text().splitlines()
    vn = np.array([[float(x) for x in l.split()[1:]] for l in lines if l.startswith("vn ")])
    faces = [l.split()[1:] for l in lines if l.startswith("f ")]
    assert len(faces) == len(m) and all(len(c.split("/")) == 3 for f in faces for c in f)
    corner = np.array([[int(c.split("//")[1]) - 1 for c in f] for f in faces])
    assert np.abs(vn[corner] - m.normals).max() < 1e-6
    assert len(vn) == len(np.unique(np.round(m.normals.reshape(-1, 3), 5), axis=0))  # each normal once
    assert {tuple(n) for n in vn} >= {(0.0, 0.0, 1.0), (0.0, 0.0, -1.0), (1.0, 0.0, 0.0)}
    # a mesh without normals: each triangle's own
    plain = Mesh(m.vertices, m.triangles)
    export_obj(plain, tmp_path / "q.obj")
    assert sum(l.startswith("vn ") for l in (tmp_path / "q.obj").read_text().splitlines()) < len(plain)


def test_gltf_is_indexed_with_one_entry_per_corner_and_normal(fine_sphere):
    part = Box(40, 30, 20) - Cylinder(6, 40)
    m = part.mesh()
    doc, buf = gltf_document(part, edges=False)
    prim = doc["meshes"][0]["primitives"][0]
    pos_acc, nrm_acc, idx_acc = (doc["accessors"][prim["attributes"]["POSITION"]],
                                 doc["accessors"][prim["attributes"]["NORMAL"]], doc["accessors"][prim["indices"]])
    assert idx_acc["componentType"] == 5123 and idx_acc["type"] == "SCALAR" and idx_acc["count"] == 3 * len(m)
    assert doc["bufferViews"][idx_acc["bufferView"]]["target"] == 34963
    pairs = {(int(v), *np.round(n, 6)) for v, n in zip(m.triangles.ravel(), m.normals.reshape(-1, 3))}
    assert pos_acc["count"] == nrm_acc["count"] == len(pairs) < 3 * len(m)  # (each corner and normal once)

    def read(acc, dtype, width):
        view = doc["bufferViews"][acc["bufferView"]]
        return np.frombuffer(buf, dtype, acc["count"] * width, view["byteOffset"]).reshape(-1, width) if width > 1 \
            else np.frombuffer(buf, dtype, acc["count"], view["byteOffset"])

    pos, nrm, idx = read(pos_acc, np.float32, 3), read(nrm_acc, np.float32, 3), read(idx_acc, np.uint16, 1)
    assert np.abs(pos[idx].reshape(-1, 3, 3) - m.vertices[m.triangles]).max() < 1e-5
    assert np.abs(nrm[idx].reshape(-1, 3, 3) - m.normals).max() < 1e-6
    # more than 65 535 corners: 32-bit indices
    doc, _ = gltf_document(fine_sphere, edges=False)
    big = doc["accessors"][doc["meshes"][0]["primitives"][0]["indices"]]
    assert big["componentType"] == 5125 and big["count"] == 3 * len(fine_sphere)


def test_mesh_boolean_results_take_the_normals_of_their_operands():
    union = Box(16, 16, 16).mesh() + Sphere(10).mesh()
    p = union.vertices[union.triangles]
    on_sphere = (np.abs(np.linalg.norm(p, axis=2) - 10) < 1e-9).all(axis=1)
    radial = p[on_sphere] / 10
    assert on_sphere.sum() > 1000
    assert np.abs(np.einsum("ijk,ijk->ij", union.normals[on_sphere], radial) - 1).max() < 1e-6
    flat = np.abs(np.abs(union.triangle_normals).max(axis=1) - 1) < 1e-12  # on the box's faces
    assert np.allclose(union.normals[flat], union.triangle_normals[flat][:, None, :], atol=1e-6)
    # meshes without normals give a result without
    a, b = Box(16, 16, 16).mesh(), Sphere(10).mesh()
    assert (Mesh(a.vertices, a.triangles) + b).normals is not None  # (one operand has them)
    assert (Mesh(a.vertices, a.triangles) + Mesh(b.vertices, b.triangles)).normals is None


# =============================================================================
# SmPyLib's PolyBrep.ray_intersection (M13)
# =============================================================================
def test_poly_ray_intersection_returns_its_hits():
    m = Box(20, 20, 20).mesh()
    poly = m._kernel_mesh()
    try:
        hits = poly.ray_intersection((0.0, 0.0, -50.0), (0.0, 0.0, 1.0), 1e-9, 1e-9)
        assert len(hits) >= 1 and hits[0]["point"] == pytest.approx((0, 0, -10), abs=1e-9)
        assert hits[0]["t"] == pytest.approx(40, abs=1e-6) and hits[0]["normal"] == pytest.approx((0, 0, -1))
        assert type(hits[0]["face"]).__name__ == "PolyFace"
        assert poly.ray_intersection((50.0, 0.0, 0.0), (0.0, 0.0, 1.0), 1e-9, 1e-9) == []
    finally:
        ext.delete_polybrep(poly)


def test_decimate_refuses_what_the_kernel_collapses():
    cone = Cone(10, 0, 20).mesh()  # (long thin triangles on the base)
    with pytest.raises(ModelingError, match=r"collapsed the mesh to \d+ triangles, where about 63 were asked"):
        cone.decimate(0.5)
    assert len(cone.decimate(tolerance=0.5)) <= len(cone)  # (steps the kernel collapses are not taken)
