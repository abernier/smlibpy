"""Regression tests: selections, patterns and argument checks."""

import math

import pytest
from pytest import approx

from smlibpy import *


def test_straight_bspline_edges_count_as_lines():
    box = Box(20, 20, 10)
    c = box.chamfer(box.edges().parallel_to(Z), 2)
    assert len(c.edges().parallel_to(Z)) == 8  # the chamfer's edges are straight B-splines
    assert len(c.edges().lines()) == 24
    half = Polyline((-20, 0), (-20, 10), (20, 10), (20, 0))
    full = half + half.mirror(Plane.XZ)  # mirrored lines become B-splines
    assert len(full.fillet(2).edges()) == 10
    assert Rectangle(40, 20).offset(-2).fillet(3).area == approx(Rectangle(36, 16).fillet(3).area)
    assert len(Cylinder(5, 10).edges().lines()) == 0


def test_flat_bspline_faces_are_planar():
    nurbs = Box(10, 10, 10).to_nurbs()
    top = nurbs.faces().top().one()
    assert top.geom_type == "bspline" and top.is_planar
    assert top.plane.z_dir.to_tuple() == approx((0, 0, 1))
    assert len(nurbs.faces().planar()) == 6
    assert not Sphere(5).faces()[0].is_planar


def test_location_times_pattern_keeps_the_pattern():
    r = Pos(0, 0, 10) * GridLocations(10, 10, 2, 2) * Box(1, 1, 1)
    assert isinstance(r, ShapeList) and len(r) == 4 and r.bbox().min.z == approx(9.5)
    top = Box(30, 20, 10).faces().top()
    assert len(GridLocations(10, 10, 2, 2).on(top) * Circle(1)) == 4
    assert isinstance(Plane.XY.offset(5) * GridLocations(10, 10, 2, 2), Locations)
    assert isinstance(Pos(1, 0, 0) * (GridLocations(10, 10, 2, 2) * Box(1, 1, 1)), ShapeList)


def test_mass_properties_checks_density_and_accuracy():
    with pytest.raises(ValueError, match="density"):
        Box(10, 10, 10).mass_properties(density=0)
    with pytest.raises(ValueError, match="accuracy"):
        Sphere(10).mass_properties(accuracy=1e-12)
    assert Box(10, 10, 10).mass_properties(density=2).mass == approx(2000)


def test_wedge_size_and_checks():
    w = Wedge(20, 10, 8)
    assert w.volume == approx(800) and w.bbox().size.to_tuple() == approx((20, 10, 8))
    assert Wedge(20, 10, 8, 5).volume == approx(1000)
    for args in ((-20, 10, 8), (20, 10, -8), (0, 10, 8), (20, 0, 8), (20, 10, 8, 20)):
        with pytest.raises(ValueError):
            Wedge(*args)


def test_split_with_nothing_on_the_kept_side():
    part = Box(20, 20, 20)
    with pytest.raises(ModelingError, match="nothing of the part"):
        part.split(Plane.XY.offset(50))
    assert part.split(Plane.XY).volume == approx(4000)


def test_mirror_in_a_face():
    part = Box(10, 10, 10)
    m = part.mirror(part.faces().right())
    assert m.bbox().min.x == approx(5) and m.bbox().max.x == approx(15)


def test_feature_argument_checks():
    with pytest.raises(TypeError, match="face or a sheet"):
        thicken(Box(1, 1, 1), 1)
    with pytest.raises(ValueError, match="not connected"):
        sweep(Circle(1), Wire([Line((0, 0, 0), (0, 0, 10)), Line((5, 0, 20), (5, 0, 30))]))
    with pytest.raises(ValueError, match="positive"):
        Rectangle(40, 20).fillet(-2)
    with pytest.raises(ValueError, match="4 x 4"):
        surface([[(x, y, 0) for x in (0, 1, 2)] for y in (0, 1, 2)])


def test_file_argument_checks(tmp_path):
    with pytest.raises(ValueError, match="unknown file type"):
        load(tmp_path / "x.glb")
    with pytest.raises(FileNotFoundError):
        load(tmp_path / "missing.smb")
    with pytest.raises(ValueError, match="positive"):
        Box(1, 1, 1).mesh(tolerance=0)
    bad = tmp_path / "bad.stl"
    bad.write_text("hello world")
    with pytest.raises(ValueError, match="not an STL file"):
        import_stl(bad)


def test_surface_rejects_nan():
    with pytest.raises(ValueError, match="finite"):
        surface([[(x, y, math.nan if (x, y) == (1, 1) else 0) for x in range(4)] for y in range(4)])
