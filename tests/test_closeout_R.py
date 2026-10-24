"""Close-out of the 0.5.0 kernel plan, area R: regressions and documentation errors the verifiers
found, and D7.

- Drawing views of tori: ``outline`` rebuilt the kernel's projected pieces as lines and arcs and
  raised on the degenerate slivers the projection gives where an edge or seam is seen end-on
  (``Torus(20, 5).outline(Plane.YZ)``: "a line needs two distinct points"); measuring those
  slivers also took seconds each.
- D2: a twist maps a cylinder, cone, sphere or torus about its own axis onto itself; such faces
  stay what they were (they came out B-splines, their seam a helix).
- The error of ``Text`` for a font it cannot read is a ``FontError`` (a ``ValueError``), as the
  font reader's own, and ``FontError`` is in ``smlibpy`` (``from smlibpy import *``), as in
  smlibwasm's index.
- The documented ``KernelError.trace`` example still fails in the kernel (docs/kernel.md).
"""

import math
import time

import pytest
from pytest import approx

from smlibpy import *
from smlibpy._kernel import KernelError
from smlibpy.font import FontError


# -- outline: degenerate pieces of a projection ----------------------------------------------------
@pytest.mark.parametrize("torus, plane, edges, length", [
    ((20, 5), Plane.YZ, 8, 4 * 20 + 2 * math.pi * 5),     # 0.5.0: ValueError (a line needs two points)
    ((8, 2), Plane.XZ, 5, 4 * 8 + 2 * math.pi * 2),        # 0.5.0: ValueError
    ((12, 2), Plane.XZ, 5, 4 * 12 + 2 * math.pi * 2),      # 0.5.0: ValueError (collinear points)
    ((20, 5), Plane.XZ, 5, 4 * 20 + 2 * math.pi * 5),
    ((5, 4.5), Plane.YZ, 8, 4 * 5 + 2 * math.pi * 4.5),
])
def test_outline_of_tori_seen_from_the_side(torus, plane, edges, length):
    t0 = time.perf_counter()
    seen = Torus(*torus).outline(plane)
    assert time.perf_counter() - t0 < 10  # (the slivers took up to 27 s to measure)
    assert len(seen) == edges and sum(e.length for e in seen) == approx(length, rel=1e-6)
    tol = 1e-6 * Torus(*torus).bbox().diagonal
    assert all(e.bbox().diagonal > tol for e in seen)  # no specks left
    visible, hidden = Torus(*torus).outline(plane, hidden=True)
    assert visible and all(e.length > tol for e in visible + hidden)


def test_outline_survey_of_shapes_and_views():
    # (the verifiers' survey: 3 of 104 shape and view pairs failed, all side views of tori)
    planes = [Plane.XY, Plane.YZ, Plane.XZ, Plane((0, 0, 0), z_dir=(1, 1, 1)), Plane((0, 0, 0), z_dir=(0.3, -1, 0.2))]
    shapes = [Torus(R, r) for R, r in [(10, 3), (15, 4), (30, 5), (20, 8), (6, 1), (40, 3)]]
    shapes += [Torus(20, 5).rotate(X, 30), Cone(10, 5, 20), Cone(10, 0, 20), Sphere(7), Cylinder(5, 20).rotate(Y, 90),
               Torus(20, 5) - Box(50, 50, 20).translate(25, 0, 0), Sphere(10) - Cylinder(3, 30)]
    for s in shapes:
        tol = 1e-6 * s.bbox().diagonal
        for p in planes:
            seen = s.outline(p)
            assert seen and all(e.bbox().diagonal > tol for e in seen)
            visible, hidden = s.outline(p, hidden=True)
            assert visible


def test_outline_draws_each_line_once():
    # the projection gave a hole's rim seen edge-on as a second piece of the outline's line (and
    # smlibwasm did not): a ring from the front had 5 lines, 66 mm, over its 4 lines of 50 mm
    for part, plane, edges, length in [(Cylinder(10, 5) - Cylinder(8, 5), Plane.XZ, 4, 50.0),
                                       (Cylinder(10, 5) - Cylinder(8, 5), Plane.YZ, 6, 50.0),  # (split at y 0)
                                       (Cylinder(5, 20).rotate(Y, 90), Plane.XY, 4, 60.0)]:
        seen = part.outline(plane)
        assert len(seen) == edges and sum(e.length for e in seen) == approx(length)
        visible, _ = part.outline(plane, hidden=True)  # (its pieces leave gaps of a few 1e-4 natively)
        assert sum(e.length for e in visible) == approx(length, rel=1e-4)


def test_drawing_views_of_a_torus():
    views = drawing_views(Torus(20, 5))
    assert [v.name for v in views] == ["front", "top", "left"]
    assert all(v.visible for v in views)
    assert sum(e.length for e in views[2].visible) == approx(4 * 20 + 2 * math.pi * 5, rel=1e-6)


# -- D2: a twist about a body's own axis -----------------------------------------------------------
def _types(part):
    return sorted(f.geom_type for f in part.faces())


@pytest.mark.parametrize("make, types, volume", [
    (lambda: twist(Cylinder(5, 40), 90), ["cylinder", "plane", "plane"], math.pi * 25 * 40),
    (lambda: twist(Cylinder(5, 40), 720), ["cylinder", "plane", "plane"], math.pi * 25 * 40),
    (lambda: twist(Cone(10, 5, 20), -400), ["cone", "plane", "plane"], math.pi * 20 / 3 * (100 + 50 + 25)),
    (lambda: twist(Cone(10, 0, 20), 90), ["cone", "plane"], math.pi * 20 / 3 * 100),
    (lambda: twist(Sphere(7), 90), ["sphere"], 4 / 3 * math.pi * 343),
    (lambda: twist(Torus(20, 5), 90), ["torus"], 2 * math.pi ** 2 * 20 * 25),
    (lambda: twist(Torus(20, 5), 90, start=-2, end=2), ["torus"] * 5, 2 * math.pi ** 2 * 20 * 25),
    (lambda: twist(Cylinder(10, 40) - Cylinder(6, 40), 90), ["cylinder", "cylinder", "plane", "plane"],
     math.pi * 64 * 40),
    (lambda: twist(Cylinder(5, 40), 90, start=-10, end=10), ["cylinder"] * 3 + ["plane"] * 2, math.pi * 25 * 40),
    (lambda: twist(Cylinder(5, 40).rotate(Y, 90), 90, axis=Axis.X), ["cylinder", "plane", "plane"],
     math.pi * 25 * 40),
])
def test_a_twist_leaves_surfaces_of_revolution_about_its_axis(make, types, volume):
    # 0.5.0: every such face a B-spline (its seam a helix), the volume 1e-9 off
    part = make()
    assert part.is_valid() and part.check() == []
    assert _types(part) == types
    assert part.volume == approx(volume, rel=1e-10)


def test_a_twisted_cylinder_is_the_cylinder():
    c = twist(Cylinder(5, 40), 90)
    wall = c.faces().cylinders().one()
    assert wall.radius == approx(5) and wall.axis.direction.is_parallel(Z.direction)
    assert sorted(e.geom_type for e in c.edges()) == ["circle", "circle"]
    step = to_step(c)
    assert "CYLINDRICAL_SURFACE" in step and "B_SPLINE_SURFACE" not in step


def test_a_twisted_bar_keeps_its_bore():
    # the bore's circles stay where they are; the turned ends get their trim curves along them anew
    bar = Box(20, 20, 40) - Cylinder(4, 40)
    for kwargs in ({}, {"start": -5, "end": 5}):
        twisted = twist(bar, 90, **kwargs)
        assert twisted.is_valid() and twisted.check() == []
        bore = twisted.faces().cylinders()
        assert len(bore) == (1 if not kwargs else 3) and all(f.radius == approx(4) for f in bore)
        assert len(twisted.faces().filter_by(lambda f: f.geom_type == "bspline")) == 4  # the sides
        assert twisted.volume == approx(bar.volume, rel=1e-8)


def test_a_twisted_shaft_keeps_its_turned_faces():
    profile = Polygon((0, 0), (10, 0), (10, 20), (8, 22), (8, 30), (10, 32), (10, 60), (0, 60)).on(Plane.XZ)
    shaft = revolve(profile, Axis.Z)
    twisted = twist(shaft, 45)
    assert _types(twisted) == _types(shaft) == ["cone", "cone", "cylinder", "cylinder", "cylinder", "plane", "plane"]
    assert twisted.volume == approx(shaft.volume, rel=1e-12)
    rounded = Cylinder(5, 40).fillet(Cylinder(5, 40).edges(), 1)
    assert _types(twist(rounded, 90)) == _types(rounded)


def test_faces_the_twist_moves_are_fitted_as_before():
    # off the axis, about another axis, or a face with edges the twist moves: fitted, valid
    assert _types(twist(Cylinder(3, 40).translate(5, 0, 0), 90)) == ["bspline", "plane", "plane"]
    assert _types(twist(Torus(20, 5), 90, axis=Axis.X)) == ["bspline"]
    key = Cylinder(10, 60) - Box(4, 30, 4).translate(0, 10, 0)
    twisted = twist(key, 45)
    assert twisted.is_valid() and "cylinder" not in _types(twisted)
    assert twisted.volume == approx(key.volume, rel=1e-8)
    holed = Cylinder(10, 40) - Cylinder(2, 40).translate(5, 0, 0)
    twisted = twist(holed, 90)  # the outer wall stays, the hole off the axis is fitted
    assert _types(twisted) == ["bspline", "cylinder", "plane", "plane"] and twisted.is_valid()
    assert twisted.volume == approx(holed.volume, rel=1e-8)


def test_a_twisted_sheet_of_revolution():
    sheet = twist(Cylinder(5, 40).faces().cylinders()[0].to_shell(), 90)
    assert isinstance(sheet, Shell) and _types(sheet) == ["cylinder"]
    # a half: its straight free edges bound it and turn with the twist (into helices)
    half = (Cylinder(5, 40) & Box(10, 10, 40).translate(5, 0, 0)).faces().cylinders()[0].to_shell()
    twisted = twist(half, 90)
    top = sorted((round(v.x, 6), round(v.y, 6)) for v in twisted.vertices() if v.z > 0)
    assert top == [(-5, 0), (0, 5)]  # (the top turned by 90 degrees: (0, 5) and (5, 0) before)
    assert twisted.faces()[0].area == approx(half.faces()[0].area, rel=1e-9)


# -- fonts -------------------------------------------------------------------------------------------
def test_text_with_a_font_it_cannot_read_raises_a_font_error(tmp_path):
    bad = tmp_path / "bad.woff"
    bad.write_bytes(b"wOFF" + bytes(60))
    with pytest.raises(FontError, match=r"^Text: ") as e:  # (0.5.0: a ValueError, not a FontError)
        Text("A", 5, font=str(bad))
    assert isinstance(e.value, ValueError)


def test_font_error_is_in_smlibpy():
    import smlibpy
    import smlibpy.font

    assert "FontError" in smlibpy.__all__ and smlibpy.FontError is smlibpy.font.FontError
    assert "FontError" in smlibpy.font.__all__
    ns: dict = {}
    exec("from smlibpy import *", ns)
    try:
        exec("Text('A', 5, font=bytes(8))", ns)
    except ns["FontError"] as e:  # the release notes' `except FontError`
        assert str(e) == "Text: font data: not a font file"
    else:
        raise AssertionError("no FontError")


# -- docs/kernel.md: an example that still fails ---------------------------------------------------
def test_the_documented_kernel_trace_example_fails_in_the_kernel():
    with pytest.raises(KernelError) as e:
        Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 45) - Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)
    assert e.value.status == "SM_ERR"
    where = [t.rsplit(" ", 1)[-1] for t in e.value.trace[-3:]]
    assert where == ["(MakeFaceuse)", "(ManifoldBoolean)", "(SmApiBoolean)"]
