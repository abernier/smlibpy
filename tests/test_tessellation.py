"""Meshes of faces that are straight in one direction and twisted along it, and of single faces.

The kernel cuts a face into a grid whose lines it places by the curves along the face's
borders, so such a face got one facet across it. A body with such a face is now divided by
halving its faces until they are flat within the tolerance (smlibpy.mesh.tessellate, through
_core.ext.tessellate); other bodies keep the kernel's facets.

A single face is meshed as a copy in a sheet of its own, which faces where the face's surface
normal points; where that is into the face's part, the mesh is turned.
"""

import math

import numpy as np
import pytest

from smlibpy import (Axis, Box, Circle, Cylinder, Helix, Line, Plane, Rectangle, Sphere, Z, export_stl, import_stl,
                     loft, ruled, surface, sweep)
from smlibpy._kernel import ext, k
from smlibpy.exporters import gltf_document
from smlibpy.mesh import Mesh, tessellate


def default_tolerance(shape) -> float:
    return shape.bbox().diagonal * 1e-3  # what tessellate() and shape.mesh() take


def off_surface(shape, mesh: Mesh) -> float:
    """Largest distance of the triangle centroids and edge midpoints from the exact shape."""
    t = mesh.vertices[mesh.triangles]
    pts = np.concatenate([t.mean(axis=1), (t[:, 0] + t[:, 1]) / 2, (t[:, 1] + t[:, 2]) / 2, (t[:, 2] + t[:, 0]) / 2])
    return max(k.brep_closest_point(shape._brep, (float(p[0]), float(p[1]), float(p[2])))[1] for p in pts)


def kernel_grid(shape, tolerance: float, curve_angle: float = 15.0, surface_angle: float = 15.0) -> Mesh:
    """The kernel's own tessellation, which always cuts the faces into grids (smlibpy's before)."""
    return Mesh._from_poly(k.tessellate(shape._brep, chord_height_tolerance=tolerance,
                                        curve_angle_tolerance_deg=curve_angle, surface_angle_tolerance_deg=surface_angle))


def algorithm(shape, tolerance: float, angle: float = 15.0) -> str:
    return ext.tessellation_algorithm(shape._brep, chord_height_tolerance=tolerance, surface_angle_tolerance_deg=angle)


def check_twisted(shape, volume: float) -> Mesh:
    """The mesh of a twisted body is within the tolerance; the kernel's grid was not."""
    tol = default_tolerance(shape)
    assert algorithm(shape, tol) == "halving"
    mesh = shape.mesh()
    assert mesh.is_closed()
    assert off_surface(shape, mesh) <= tol
    # the facets enclose the volume up to the layer between them and the faces
    assert abs(mesh.volume - volume) <= shape.area * tol
    assert off_surface(shape, kernel_grid(shape, tol)) > 2 * tol  # the defect the test is about
    return mesh


def test_twisted_box():
    bar = Box(20, 20, 100).twist(90)
    mesh = check_twisted(bar, 40000)
    # one facet across each side was 1 mm off and enclosed 5 % too much
    grid = kernel_grid(bar, default_tolerance(bar))
    assert len(grid) == 68 and grid.volume > 42000
    assert abs(mesh.volume - 40000) < 100 and 1500 < len(mesh) < 3000


def test_twisted_sweep():
    band = sweep(Rectangle(8, 3), Line((0, 0, 0), (0, 0, 60))).twist(90)
    check_twisted(band, 8 * 3 * 60)  # a twist keeps the volume


def test_ruled_loft_between_a_square_and_a_circle():
    transition = loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)], ruled=True)
    check_twisted(transition, transition.mass_properties(accuracy=1e-9).volume)


def test_walls_of_a_thickened_free_form_sheet():
    grid = [[(x, y, 4 * math.sin(x / 15) * math.cos(y / 15)) for x in range(0, 60, 10)] for y in range(0, 50, 10)]
    panel = surface(grid).thicken(2)
    check_twisted(panel, panel.mass_properties(accuracy=1e-9).volume)


def test_edges_at_the_end_of_a_twist_are_divided_too():
    # The trim curves of a box lie 1e-14 outside the domains of their faces; unless they are
    # moved onto the border, the kernel leaves the straight edge at the untwisted end whole and
    # fans long triangles from its ends (2.9 times the tolerance off here).
    plate = Box(80, 60, 10).twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))
    check_twisted(plate, 48000)


def test_plain_parts_keep_their_facets():
    assert len(Box(20, 20, 20).mesh()) == 12
    assert len(Cylinder(10, 20).mesh()) == 252
    assert len(Sphere(10).mesh()) == 3584
    rounded = Box(40, 30, 20) - Cylinder(5, 30)
    rounded = rounded.fillet(rounded.edges().parallel_to((0, 0, 1)), 3)
    plain = [rounded, sweep(Circle(1), Helix(pitch=5, height=30, radius=10)),
             loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)]),
             Cylinder(10, 50).twist(90)]  # a cylinder twisted about its axis is the same cylinder
    for part in plain:
        tol = default_tolerance(part)
        assert algorithm(part, tol) == "grid"
        mesh, grid = part.mesh(), kernel_grid(part, tol)
        assert np.array_equal(mesh.vertices, grid.vertices) and np.array_equal(mesh.triangles, grid.triangles)


def test_surface_straight_both_ways_keeps_the_grid():
    # the kernel places the grid of such a surface by its diagonals, which bend with the twist
    saddle = ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 20, 10), (20, 20, -10)))
    tol = default_tolerance(saddle)
    assert algorithm(saddle, tol) == "grid"
    assert off_surface(saddle, saddle.mesh()) <= tol


def test_the_angle_tolerance_of_the_faces_decides():
    # Points on the edges (curve angle 1 degree) do not help where the two borders of a face are
    # divided differently (a side of the square against a quarter of the circle): the grid is
    # 7 times the tolerance off, so the faces' own angle tolerance (25 degrees) decides.
    transition = loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)], ruled=True)
    tol = default_tolerance(transition)
    assert off_surface(transition, kernel_grid(transition, tol, 1, 25)) > 5 * tol
    poly, report = ext.tessellate(transition._brep, chord_height_tolerance=tol, curve_angle_tolerance_deg=1,
                                  surface_angle_tolerance_deg=25, return_report=True)
    assert report["algorithm"] == "halving"
    assert off_surface(transition, Mesh._from_poly(poly)) <= tol
    # a fine angle tolerance for the faces divides them along, so the grid is good enough
    poly, report = ext.tessellate(transition._brep, chord_height_tolerance=tol, curve_angle_tolerance_deg=25,
                                  surface_angle_tolerance_deg=1, return_report=True)
    assert report["algorithm"] == "grid"
    assert off_surface(transition, Mesh._from_poly(poly)) <= 2 * tol


def test_exports_and_renderer_take_the_halved_mesh(tmp_path):
    from smlibpy.render import _Scene

    bar = Box(20, 20, 100).twist(90)
    mesh = bar.mesh()
    path = tmp_path / "bar.stl"
    export_stl(bar, path)
    assert import_stl(path).volume == pytest.approx(mesh.volume, rel=1e-6)
    doc, buf = gltf_document(bar, edges=False)
    acc = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    view = doc["bufferViews"][acc["bufferView"]]
    tris = np.frombuffer(buf, np.float32, acc["count"] * 3, view["byteOffset"]).reshape(-1, 3, 3).astype(float)
    assert len(tris) == len(mesh)
    assert np.einsum("ij,ij->i", tris[:, 0], np.cross(tris[:, 1], tris[:, 2])).sum() / 6 == pytest.approx(mesh.volume)
    assert _Scene([bar], None, "native").bodies[0].mesh.volume == pytest.approx(mesh.volume)


def test_tessellate_options():
    bar = Box(20, 20, 100).twist(90)
    tol = default_tolerance(bar)
    kw = dict(chord_height_tolerance=tol, curve_angle_tolerance_deg=15, surface_angle_tolerance_deg=15)
    grid = Mesh._from_poly(ext.tessellate(bar._brep, algorithm="grid", **kw))
    assert np.array_equal(grid.vertices, kernel_grid(bar, tol).vertices)
    poly, report = ext.tessellate(bar._brep, return_report=True, **kw)
    assert report["algorithm"] == "halving" and report["output_manifold"] and not report["failures"]
    ext.delete_polybrep(poly)
    # the kernel's halving divides the faces down to a thousandth with a max edge length or
    # aspect ratio, so they keep the grid
    for extra in (dict(max_edge_length=5.0), dict(max_aspect_ratio=4.0)):
        poly, report = ext.tessellate(bar._brep, return_report=True, **kw, **extra)
        assert report["algorithm"] == "grid"
        ext.delete_polybrep(poly)
        with pytest.raises(ValueError, match="no max_edge_length or max_aspect_ratio"):
            ext.tessellate(bar._brep, algorithm="halving", **kw, **extra)
    with pytest.raises(ValueError, match="algorithm must be"):
        ext.tessellate(bar._brep, algorithm="fine", **kw)
    # without a chord height a face is divided by its angles only, which do not show a twist
    assert ext.tessellation_algorithm(bar._brep, chord_height_tolerance=0) == "grid"
    side = max(bar.faces(), key=lambda f: f.area)
    assert ext.grid_deviation(side._f, chord_height_tolerance=tol, surface_angle_tolerance_deg=15) > 5 * tol
    assert ext.grid_deviation(Box(20, 20, 100).faces()[0]._f, chord_height_tolerance=tol) == 0


def normal_near(mesh: Mesh, point: np.ndarray) -> np.ndarray:
    """The mean corner normal of the triangle nearest to a point."""
    t = mesh.vertices[mesh.triangles]
    return mesh.normals[np.argmin(np.linalg.norm(t.mean(axis=1) - point, axis=1))].mean(axis=0)


@pytest.mark.parametrize("make, inward", [
    (lambda: loft([Rectangle(50, 50), Circle(13).on(Plane.XY.offset(54))]), ["bspline"] * 4 + ["plane"]),
    (lambda: (Rectangle(10, 10) - Circle(2)).translate(20, 0, 0).on(Plane.XZ).revolve(Z), ["torus"]),
    (lambda: Box(10, 20, 30), []),
], ids=["loft", "revolve", "box"])
def test_the_mesh_of_a_face_faces_out_of_its_part(make, inward):
    # inward: the faces whose surface normal points into the part (the sides and the bottom of
    # the loft, the wall of the hole running round the ring), whose meshes faced into the part
    part = make()
    found = []
    for face in part.faces():
        p = np.array(face.interior_point().to_tuple())
        outward = np.array(face.normal_at(p).to_tuple())
        mesh = tessellate(face)
        assert normal_near(mesh, p) @ outward > 0.9
        t = mesh.vertices[mesh.triangles]  # counterclockwise around the normals
        turn = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        assert (np.einsum("ij,ij->i", turn, mesh.normals.sum(axis=1)) > 0).all()
        if normal_near(face.to_shell().mesh(), p) @ outward < 0:  # the sheet faces like the surface
            found.append(face.geom_type)
    assert sorted(found) == inward  # the defect the test is about


def test_exports_take_the_turned_mesh_of_a_face(tmp_path):
    side = loft([Rectangle(50, 50), Circle(13).on(Plane.XY.offset(54))]).faces()[0]  # surface normal points in
    mesh = side.mesh()
    doc, buf = gltf_document(side, edges=False)
    acc = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    view = doc["bufferViews"][acc["bufferView"]]
    tris = np.frombuffer(buf, np.float32, acc["count"] * 3, view["byteOffset"]).reshape(-1, 3, 3).astype(float)
    assert np.allclose(tris, mesh.vertices[mesh.triangles], atol=1e-4)
    path = tmp_path / "side.stl"
    export_stl(side, path)
    assert np.allclose(import_stl(path).triangle_normals, mesh.triangle_normals, atol=1e-4)


def test_face_meshes_cut_one_tessellation_by_face():
    from smlibpy.mesh import face_meshes

    part = Box(20, 10, 5)
    part = part.fillet(part.edges().parallel_to(Z), 2) - Cylinder(2, 10)
    meshes = face_meshes(part, 0.005)
    assert len(meshes) == len(part.faces())
    for face, mesh in zip(part.faces(), meshes):
        assert mesh.area == pytest.approx(face.area, rel=1e-2)
    assert sum(len(m.triangles) for m in meshes) == len(tessellate(part, 0.005).triangles)


def test_a_mesh_is_its_arrays():
    """The kernel mesh of a tessellation goes once its arrays are copied out; mesh Booleans build
    one from the arrays, and what keeps the tessellation's own mesh frees it with dispose()."""
    from smlibpy.mesh import _tessellate

    ball = Sphere(20).mesh(0.01)
    assert ball._poly is None
    block = (Box(30, 30, 30).translate(20, 0, 0)).mesh()
    cut = ball - block
    assert cut.is_closed() and cut.volume < ball.volume
    assert (ball._poly, block._poly, cut._poly) == (None, None, None)
    kept = _tessellate(Box(10, 10, 10), None, 15.0, True)
    assert kept._poly is not None and kept._poly.poly is not None
    kept.dispose()
    assert kept._poly is None
    kept.dispose()  # (once is enough)
    assert (kept + Box(10, 10, 10).translate(5, 0, 0).mesh()).volume == pytest.approx(1500, rel=1e-9)


def test_mesh_booleans_on_any_mesh(tmp_path):
    a, b = Box(20, 20, 20), Cylinder(6, 40)
    for ma, mb in [(a.mesh(), b.mesh()), (Mesh(a.mesh().vertices, a.mesh().triangles), Mesh(b.mesh().vertices, b.mesh().triangles))]:
        both = (ma & mb).volume
        assert (ma & mb).is_closed() and both == pytest.approx(mb.volume / 2, rel=1e-9)
        assert (ma - mb).is_closed() and (ma - mb).volume == pytest.approx(ma.volume - both, rel=1e-9)
        assert (ma + mb).is_closed() and (ma + mb).volume == pytest.approx(ma.volume + mb.volume - both, rel=1e-9)
    a.export(tmp_path / "a.stl")
    b.export(tmp_path / "b.stl")
    sa, sb = import_stl(tmp_path / "a.stl"), import_stl(tmp_path / "b.stl")  # meshes of their own
    diff = sa - sb
    assert diff.is_closed() and diff.volume == pytest.approx(sa.volume - (sa & sb).volume, rel=1e-6)
    assert diff.volume == pytest.approx((a - b).volume, rel=1e-2)  # (the cylinder's facets cut its corners)
    # (the kernel gives the result no normals: they come from the triangles, not all (0, 0, 1))
    assert diff.normals is None and (a.mesh() - b.mesh()).normals is None
    tet = Mesh([(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)], [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)])
    assert (tet & tet).volume == pytest.approx(1 / 6)
    with pytest.raises(ValueError, match="triangles"):
        Mesh([(0, 0, 0)], []) + tet
