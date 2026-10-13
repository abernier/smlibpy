"""Meshes of faces that are straight in one direction and twisted along it.

The kernel cuts a face into a grid whose lines it places by the curves along the face's
borders, so such a face got one facet across it. A body with such a face is now divided by
halving its faces until they are flat within the tolerance (smlibpy.mesh.tessellate, through
_core.ext.tessellate); other bodies keep the kernel's facets.
"""

import math

import numpy as np
import pytest

from smlibpy import (Axis, Box, Circle, Cylinder, Helix, Line, Rectangle, Sphere, export_stl, import_stl, loft,
                     ruled, surface, sweep)
from smlibpy._kernel import ext, k
from smlibpy.exporters import gltf_document
from smlibpy.mesh import Mesh


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
