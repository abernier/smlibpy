"""Close-out of lane U's "Not done" (kernel plan phase 1): surfaces, deformation, sheet metal and
measuring. Plane sections within a tolerance, the nearest point of a folded B-spline face, rays beside
a seam (the kernel's seam evaluation, third_party/patches SmEllipse.cpp); a hole wholly inside a bend
zone unfolded into a valid part (D5); K-factor records in .smp files (D1); blends between two closed
edges (U2); trimming with curves that run past a sheet's border or across a hole (U3); the knots a warp
or a flattening does not need removed (U8)."""

import math

import numpy as np
import pytest

from smlibpy import (Align, Axis, Box, Cone, Cylinder, Edge, Ellipse, Location, Plane, Rectangle, Shell, Sphere, Spline,
                     Torus, Vector, blend, flat_pattern, fold, from_smp, loft, surface, to_smp)
from smlibpy._kernel import ext, k

# ------------------------------------------------------------------------------------ measuring


def _bumpy_part():
    pts = [[(x, y, 3 * np.sin(x / 6.0) * np.cos(y / 5.0)) for x in np.linspace(0, 30, 7)] for y in np.linspace(0, 20, 5)]
    return surface(pts).thicken(4)


def test_section_of_bspline_faces_lies_on_them():
    # the kernel's plane section fitted each curve within a thousandth of its face's size: up to
    # 1.5e-2 off a part thickened from a B-spline sheet
    part = _bumpy_part()
    for z in (0.5, 1.0, 1.7):
        sk = part.section(Plane.XY.offset(z))
        assert sk.area > 100
        assert max(part.distance_to(e.point_at(i / 30)) for e in sk.edges() for i in range(31)) < 1e-5
    # the curves themselves, at the tolerance asked for
    for rel in (1e-6, 1e-8):
        tol = rel * part._extent()
        edges = [Edge._from_curve(c) for c in ext.plane_section(part._brep, [0, 0, 1.0], [0, 0, 1], tol)]
        assert edges
        assert max(part.distance_to(e.point_at(i / 20)) for e in edges for i in range(21)) < 50 * tol
    with pytest.raises(ValueError, match="positive"):
        ext.plane_section(part._brep, [0, 0, 1.0], [0, 0, 1], 0.0)


def _tube(degrees, n=1500, seed=1):
    rng = np.random.default_rng(seed)
    a = rng.uniform(-math.radians(degrees) / 2, math.radians(degrees) / 2, n)
    return np.c_[10 * np.sin(a), 10 * np.cos(a), rng.uniform(0, 40, n)]


def test_distance_to_finds_the_nearest_point_of_a_folded_face():
    # a sheet fitted around 288 degrees of a tube folds back towards points inside it: the kernel's
    # closest point stopped at a local minimum (5.83 where the nearest point is 5.71)
    pts = _tube(288)
    s = surface(pts)
    srf = s.faces()[0]._f.surface()
    (u0, v0), (u1, v1) = ext.surface_data(srf, False)["uv_domain"]
    dense = np.array([k.evaluate_surface_point(srf, float(u), float(v)) for u in np.linspace(u0, u1, 200)
                      for v in np.linspace(v0, v1, 200)])
    face = s.faces()[0]
    kernel_worse = 0
    for i in range(0, len(pts), 23):
        p = tuple(pts[i])
        brute = float(np.sqrt(((dense - pts[i]) ** 2).sum(1)).min())
        d = s.distance_to(p)
        assert brute - 0.2 < d <= brute + 1e-9  # (the grid's points lie up to about 0.1 apart)
        assert face.distance_to(p) == pytest.approx(d, abs=1e-9)
        q = s.closest_point(p)
        assert (q - p).length == pytest.approx(d, abs=1e-9)
        assert (face.closest_point(p) - q).length < 1e-6
        kernel_worse += float(k.brep_closest_point(s._brep, p)[1]) > brute + 1e-6
    assert kernel_worse > 0  # (the kernel's own still misses: the case is a real one)


def test_distance_to_analytic_and_trimmed_faces():
    box = Box(10, 10, 10)
    assert box.distance_to((20, 0, 0)) == pytest.approx(15)
    assert box.distance_to((0, 0, 0)) == pytest.approx(5)  # (inside: to the boundary, as before)
    holed = Box(20, 20, 4) - Cylinder(5, 10)
    top = holed.faces().sort_by(Axis.Z)[-1]
    assert top.distance_to((0, 0, 2)) == pytest.approx(5)  # over the hole: its rim
    assert top.closest_point((0, 0, 2)).z == pytest.approx(2)
    assert Sphere(10).distance_to((0, 0, 30)) == pytest.approx(20)
    assert Cylinder(10, 40).distance_to((30, 0, 0)) == pytest.approx(20)


def test_raycast_beside_a_seam():
    # a ray just beside a cylinder's seam missed the near side (also in 0.4.0)
    hits = Cylinder(10, 40).raycast((88.98, -1e-8, 4), (-1, 0, 0))
    assert [round(h.point.x, 6) for h in hits] == [10.0, -10.0]
    for name, body, n, z in (("cylinder", Cylinder(10, 40), 2, 1.0), ("cone", Cone(10, 4, 20), 2, 1.0),
                             ("sphere", Sphere(10), 2, 1.0), ("torus", Torus(20, 5), 4, 0.5)):
        for e in np.linspace(-12, -3, 19):
            for sign in (-1, 1):
                assert len(body.raycast((50, sign * 10 ** e, z), (-1, 0, 0))) == n, (name, sign * 10 ** e)


def test_seam_evaluation_is_not_snapped():
    # a cylinder's (cone's, sphere's, torus') parameters up to 1e-7 short of the end of its domain
    # evaluated to the seam itself: y = -2.4e-15 where it is -9.0e-8
    face = Cylinder(10, 40).faces().cylinders()[0]
    for back in (1e-7, 1e-8, 1e-9):
        p = face.position_at(1 - back, 0.5)
        # (the circle's NURBS runs at 2 sqrt(2) / pi of its mean speed at the end of a quarter)
        assert p.y == pytest.approx(-10 * 2 * math.pi * back * 2 * math.sqrt(2) / math.pi, rel=1e-3)
    sphere = Sphere(10).faces()[0]
    assert sphere.position_at(1 - 1e-8, 0.5).y < -1e-8


# ------------------------------------------------------------------------------------- D5, D1


def _plate(length, width, t):
    return Box(length, width, t, align=(Align.CENTER, Align.CENTER, Align.MIN))


def test_hole_inside_a_bend_unfolds_into_a_valid_part():
    # two holes of r 6 wholly inside an R20, 120 degree bend: the unfolded part was not is_valid()
    # ("open between its faces"): the kernel's fits of its hole walls overlapped themselves
    blank = _plate(200, 60, 3) - Cylinder(6, 10).translate(10, -15, 0) - Cylinder(6, 10).translate(25, 15, 0)
    part = fold(blank, Axis((20, 0, 3), (0, 1, 0)), 120, radius=20)
    assert part.is_valid()
    flat = part.unfold()
    assert flat.is_valid() and flat.check() == []
    assert flat.volume == pytest.approx(blank.volume, rel=1e-10)
    walls = [f for f in flat.faces() if f.geom_type != "plane"]
    assert len(walls) == 2
    for f in walls:
        assert f.area == pytest.approx(2 * math.pi * 6 * 3, rel=1e-9)
        c = (10, -15) if f.center().y < 0 else (25, 15)
        pts = [f.position_at(u, v) for u in np.linspace(0, 1, 25) for v in np.linspace(0, 1, 4)]
        assert max(abs(math.hypot(p.x - c[0], p.y - c[1]) - 6) for p in pts) < 1e-9
    fp = flat_pattern(part)
    assert tuple(fp.size) == pytest.approx((200, 60, 3), abs=1e-7)
    assert sorted(e.geom_type for e in fp.outline.edges()) == ["circle", "circle", "line", "line", "line", "line"]


def test_k_factors_are_kept_in_part_files():
    blank = Box(200, 40, 2, align=(Align.MIN, Align.CENTER, Align.MIN))
    a = fold(blank, Axis((60, 0, 2), (0, 1, 0)), 90, radius=1, k_factor=0.33)
    b = fold(a, Axis((140, 0, 2), (0, 1, 0)), 90, radius=6, k_factor=0.45)
    assert flat_pattern(b).size.x == pytest.approx(200, abs=1e-9)
    for ascii in (True, False):
        back = from_smp(to_smp(b, ascii=ascii))
        assert len(back._folds) == 2
        for (o1, d1, r1, k1), (o2, d2, r2, k2) in zip(back._folds, b._folds):
            assert o1 == pytest.approx(o2, abs=1e-12) and d1 == pytest.approx(d2, abs=1e-12)
            assert (r1, k1) == (r2, k2)
        assert flat_pattern(back).size.x == pytest.approx(200, abs=1e-9)  # (0.44 everywhere: 200.314)
        assert sorted(round(x.k_factor, 6) for x in back.bends()) == [0.33, 0.45]
    many = from_smp(to_smp([b, Box(5, 5, 5), Box(3, 3, 3).faces()[0]]))
    assert len(many) == 3 and len(many[0]._folds) == 2 and not many[1]._folds
    with pytest.raises(ValueError, match="8 numbers"):
        ext.part_bytes([(b._brep, None, None, None, -1, [1.0, 2.0, 3.0])], True)


# ------------------------------------------------------------------------------------- U2, U3


def _rim(sheet, above=None, below=None):
    return [e for e in sheet.edges() if len(e.faces()) == 1
            and (above is None or e.center().z > above) and (below is None or e.center().z < below)][0]


def _tubes():
    wide = Cylinder(10, 20).faces().cylinders()[0].to_shell()
    narrow = Cylinder(6, 20).translate(0, 0, 40).faces().cylinders()[0].to_shell()
    return wide, narrow, _rim(wide, above=5), _rim(narrow, below=35)


def _crease(sheet):
    """The largest angle (degrees) between the normals of faces across their shared edges."""
    worst = 0.0
    for e in sheet.edges():
        fs = e.faces()
        if len(fs) == 2:
            for i in range(1, 10):
                p = e.point_at(i / 10)
                worst = max(worst, math.degrees(math.acos(min(1.0, abs(fs[0].normal_at(p).dot(fs[1].normal_at(p)))))))
    return worst


def test_blend_of_two_closed_edges():
    wide, narrow, top, bottom = _tubes()
    b = blend(top, bottom)
    assert isinstance(b, Shell) and len(b.faces()) == 2 and b.check() == []
    free = sorted(e.length for e in b.edges() if len(e.faces()) == 1)
    assert free == pytest.approx([6 * math.pi, 6 * math.pi, 10 * math.pi, 10 * math.pi], abs=1e-6)
    assert b.area == pytest.approx(1033.6314, abs=1e-3)
    assert _crease(b) < 1e-4
    for e, sheet in ((top, wide), (bottom, narrow)):
        for i in range(12):
            p = e.point_at(i / 12)
            near = min(b.faces(), key=lambda f: f.distance_to(p))
            assert b.distance_to(p) < 1e-6
            assert math.degrees(math.acos(min(1.0, abs(sheet.faces()[0].normal_at(p).dot(near.normal_at(p)))))) < 1e-3
    # it thickens, alone and sewn to both tubes
    assert b.thicken(1).volume == pytest.approx(b.area, rel=0.1)
    assert b.thicken(-1).is_valid()
    joined = blend(top, bottom, join=True)
    assert len(joined.faces()) == 4 and len([e for e in joined.edges() if len(e.faces()) == 1]) == 2
    assert joined.thicken(1).is_valid() and joined.thicken(-1).is_valid()


def test_blend_of_closed_edges_running_opposite_ways_and_off_axis():
    _, _, top, _ = _tubes()
    turned = Cylinder(6, 20).rotate(Axis.X, 180).translate(3, 0, 40).faces().cylinders()[0].to_shell()
    b = blend(top, _rim(turned, below=35))
    assert b.check() == [] and _crease(b) < 1e-4 and b.area == pytest.approx(1040.18, abs=0.01)
    # to a lofted sheet's elliptic rim (a B-spline), at each continuity
    lo = loft([Ellipse(9, 5).moved(Location((2, 1, 30))), Ellipse(12, 7).moved(Location((2, 1, 50)))])
    sheet = lo.faces().filter(lambda f: f.geom_type == "bspline").one().to_shell()
    low = min((e for e in sheet.edges() if len(e.faces()) == 1), key=lambda e: e.center().z)
    for c in ("G1", "G2", "G3"):
        s = blend(top, low, continuity=c)
        assert s.check() == [] and _crease(s) < 1e-4
        assert s.thicken(0.5).is_valid()
    assert blend(top, low, join=True).thicken(0.5).is_valid()


def test_blend_of_a_closed_and_an_open_edge_is_refused():
    _, _, top, _ = _tubes()
    half = Cylinder(6, 20).split(Plane.XZ).translate(0, 0, 40).faces().filter(lambda f: f.geom_type == "cylinder").one()
    arc = [e for e in half.to_shell().edges() if e.geom_type == "circle" and e.center().z < 40][0]
    with pytest.raises(ValueError, match="one edge is closed"):
        blend(top, arc)


def test_trim_with_a_curve_past_a_bspline_sheets_border():
    # a curve that runs on past the border of a B-spline sheet (off its surface) raised
    a = Spline((0, 0, 0), (10, 0, 3), (20, 0, 0), (30, 0, 2))
    b = Spline((0, 20, 1), (10, 20, -2), (20, 20, 2), (30, 20, 0))
    sh = loft([a, b])
    f = sh.faces()[0]
    keep = f.position_at(0.25, 0.25)
    for which in ("u", "v"):
        across = f.iso(**{which: 0.5})[0]
        longer = across.extend(5, end="both")  # on past both borders, along the surface's extension
        ref = sh.trim(across, keep=keep)
        cut = sh.trim(longer, keep=keep)
        assert cut.area == pytest.approx(ref.area, rel=1e-9) and cut.check() == []
        pieces = sh.trim(longer, keep="split")
        assert len(pieces.faces()) == 2
        assert sum(x.area for x in pieces.faces()) == pytest.approx(sh.area, rel=1e-9)
    # a curve across a hole: cut where it leaves the faces and where it comes back
    plate = (Box(40, 20, 1) - Cylinder(4, 4)).faces().sort_by(Axis.Z)[-1].to_shell()
    line = Spline((-25, 0, 0.5), (0, 0, 0.5), (25, 0, 0.5))
    halves = plate.trim(line, keep="split")
    assert len(halves.faces()) == 2
    assert sum(x.area for x in halves.faces()) == pytest.approx(plate.area, rel=1e-9)


# ------------------------------------------------------------------------------------------- U8


def _poles(face):
    return len(ext.surface_data(face._f.surface(), True)["poles"])


def test_warp_and_flatten_drop_the_knots_they_do_not_need():
    # the change was added on knots of its own, so the face's B-spline grew; the plan's knot removal
    # within 1e-6 of the size (not NLib's 1 %) was not done
    box = Box(60, 40, 20)
    top = box.faces().sort_by(Axis.Z)[-1]
    flat = box.flatten(top, Rectangle(20, 16).on(top), Plane.XY.offset(8))
    f = flat.faces().sort_by(Axis.Z)[-1]
    assert _poles(f) == 21 * 21  # (39 x 39 before)
    assert flat.is_valid() and flat.volume == pytest.approx(47577.5, abs=1e-6)
    for x, y in ((0, 0), (-6, 0), (6, 4)):
        assert f.raycast((x, y, 50), (0, 0, -1))[0].point.z == pytest.approx(8, abs=1e-9)
    assert f.raycast((25, 15, 50), (0, 0, -1))[0].point.z == pytest.approx(10, abs=1e-12)
    for cont, n in (("G1", 22 * 22), ("crease", 23 * 23), ("G2", 21 * 21)):  # (23 x 23, 25 x 25, 21 x 21 before)
        w = box.warp(top, Rectangle(20, 16).on(top), 4, continuity=cont)
        g = w.faces().sort_by(Axis.Z)[-1]
        assert _poles(g) == n and w.is_valid()
        assert w.bbox().max.z == pytest.approx(14, abs=1e-6)
    # a bumpy sheet flattened keeps its edges where they are (a removal that moved one is not taken)
    sheet = surface([[(x, y, 3 * math.sin(x / 9) * math.cos(y / 11)) for y in range(0, 61, 5)] for x in range(0, 61, 5)])
    g = sheet.faces()[0]
    region = [Vector(*g._f.closest_point((x, y, 0))[0]) for x, y in ((20, 20), (40, 20), (40, 40), (20, 40))]
    h = sheet.flatten(g, region, Plane.XY).faces()[0]
    assert max(h.distance_to(e.point_at(t)) for e in g.edges() for t in (0.1, 0.5, 0.9)) < 1e-9
