# Close-out of lane S (sweeps, lofts, primitives and curves) of the kernel plan's phase 1: what the
# 0.5.0 release notes listed as not done and the close-out finished.
import math
import warnings

import numpy as np
import pytest

from smlibpy import *


def _quiet(fn):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        return fn()


def _turn(a, b):
    """The smallest rotation (a matrix) that turns direction a into b."""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(np.dot(a, b))
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def _signed(a, b, axis):
    """The angle (degrees) from line a to line b about axis, from -90 to 90."""
    a, b = a - np.dot(a, axis) * axis, b - np.dot(b, axis) * axis
    ang = math.degrees(math.atan2(float(np.dot(np.cross(a, b), axis)), float(np.dot(a, b))))
    return (ang + 90) % 180 - 90


def _long_axis(body, origin, normal):
    """The direction of the long side of a rectangle's section through the body near origin."""
    s = body.section(Plane(tuple(origin), z_dir=tuple(normal)))
    pts = np.array([v.point.to_tuple() for v in s.vertices() if (v.point - Vector(*origin)).length < 4])
    _, _, vt = np.linalg.svd(pts - pts.mean(axis=0))
    return vt[0]


def _off(face, edge, n=40):
    return max(face.distance_to(edge.point_at(i / n)) for i in range(n + 1))


# -- S2: where the profile sits ----------------------------------------------------------------------
def test_sweep_anchor_puts_the_named_point_on_the_path():
    tri = Polygon((0, 0), (4, 0), (0, 2))
    up = Line((0, 0, 0), (0, 0, 30))
    assert sweep(tri, up, anchor="origin").bbox().min.to_tuple() == pytest.approx((0, 0, 0), abs=1e-9)
    assert sweep(tri, up, anchor=(4, 0)).bbox().min.to_tuple() == pytest.approx((-4, 0, 0), abs=1e-9)
    assert sweep(tri, up, anchor=Vertex(0, 2, 0)).bbox().max.to_tuple() == pytest.approx((4, 0, 30), abs=1e-9)
    # the default, the center of the box, as before
    assert sweep(tri, up).bbox().center.to_tuple()[:2] == pytest.approx((0, 0), abs=1e-9)
    # along an oblique 3D path the named corner is the path's start
    body = sweep(tri, Line((0, 0, 0), (10, 10, 10)), anchor="origin")
    assert body.is_valid() and min((v.point - Vector(0, 0, 0)).length for v in body.vertices()) < 1e-9
    # a face takes (0, 0, 0); an open profile (a surface) too
    assert sweep(tri.faces()[0], up, anchor="origin").bbox().min.to_tuple() == pytest.approx((0, 0, 0), abs=1e-9)
    sheet = sweep(Line((0, 0), (5, 0)), up, anchor=(5, 0))
    assert isinstance(sheet, Shell) and sheet.bbox().min.to_tuple() == pytest.approx((-5, 0, 0), abs=1e-9)
    assert tri.sweep(up, anchor="origin").bbox().min.to_tuple() == pytest.approx((0, 0, 0), abs=1e-9)
    with pytest.raises(ValueError, match="off the profile's plane"):
        sweep(tri, up, anchor=(0, 0, 1))
    with pytest.raises(ValueError, match="'center', 'origin' or a point"):
        sweep(tri, up, anchor="corner")


def test_arcs_that_do_not_span_whole_quadrants_sit_by_their_own_box():
    # The kernel put the middle of the box of the profile curves' control points on the path, a little
    # beside the profile's own where an arc does not span whole quadrants (0.0211 here, 0.075 along the
    # 3D polyline); the kernel is given the anchor now.
    a = math.radians(40)
    p1, p2 = (10 * math.cos(a), -10 * math.sin(a), 0), (10 * math.cos(a), 10 * math.sin(a), 0)
    sector = make_face(Wire([Line((0, 0, 0), p1), ThreePointArc(p1, (10, 0, 0), p2), Line(p2, (0, 0, 0))]))
    side = math.hypot(10 * math.cos(a) - 5, 10 * math.sin(a))
    for path in (Polyline((0, 0, 0), (40, 0, 0), (40, 40, 0)), Spline((0, 0, 0), (20, 5, 8), (40, 0, 20)),
                 Polyline((0, 0, 0), (40, 0, 0), (40, 40, 30))):
        body = _quiet(lambda: sweep(sector, path))
        st = path.point_at(0)
        cap = [f for f in body.faces() if f.geom_type == "plane" and f.distance_to(st) < 1e-6
               and abs(abs(f.normal_at().dot(path.tangent_at(0))) - 1) < 1e-6][0]
        assert sorted((v.point - st).length for v in cap.vertices()) == pytest.approx([5.0, side, side], abs=1e-6)


# -- S3, S7: the profile's attitude and size along the path -------------------------------------------
def test_the_profile_meets_itself_where_a_loop_with_corners_closes():
    # Carried round a 3D loop by the smallest turns, the profile comes back turned (by -gain); that turn
    # is spread along the length: between the middles of the first and the last edge it turns by its
    # share, and at the closing corner only by the rest (before, all of it there: 8.5 degrees).
    vs = [(0, 0, 0), (40, 0, 0), (40, 30, 25), (10, 40, -10)]
    v = [np.array(p, float) for p in vs]
    n = len(v)
    ts = [(v[(i + 1) % n] - v[i]) / np.linalg.norm(v[(i + 1) % n] - v[i]) for i in range(n)]
    lens = [float(np.linalg.norm(v[(i + 1) % n] - v[i])) for i in range(n)]
    x0 = np.cross(ts[0], (0, 0, 1))
    x = x0.copy()
    for i in range(n):
        x = _turn(ts[i], ts[(i + 1) % n]) @ x
    gain = _signed(x0, x, ts[0])
    assert gain == pytest.approx(-8.5064, abs=1e-3)
    body = sweep(Rectangle(4, 1), Polyline(*vs, close=True))
    assert body.is_valid()
    first = _long_axis(body, v[0] + 0.5 * lens[0] * ts[0], ts[0])
    last = _long_axis(body, v[-1] + 0.5 * lens[-1] * ts[-1], ts[-1])
    carried = first.copy()
    for i in range(n - 1):
        carried = _turn(ts[i], ts[i + 1]) @ carried
    along = _signed(carried, last, ts[-1])
    closing = _signed(_turn(ts[-1], ts[0]) @ last, first, ts[0])
    share = (sum(lens) - 0.5 * lens[0] - 0.5 * lens[-1]) / sum(lens)
    assert along + closing == pytest.approx(-gain, abs=1e-3)
    assert along == pytest.approx(-gain * share, abs=1e-3)


def test_frenet_raises_where_the_profile_would_spin():
    # A helical arc that turns the other way: the curvature passes near 0 (7e-5) and the principal
    # normal swings round within 0.004 of the path. It was a confusing error from the oriented sweep.
    pts = ([(10 * math.cos(t), 10 * math.sin(t), 3 * t) for t in np.linspace(0, math.pi, 5)]
           + [(-10 - 10 * (1 - math.cos(t)), -10 * math.sin(t) * 0.999 + 0.001 * t, 3 * math.pi + 3 * t)
              for t in np.linspace(0, math.pi, 5)[1:]])
    path = Spline(*pts)
    with pytest.raises(ValueError, match="would spin about the path.*nearly straightens.*pick up= a direction"):
        sweep(Rectangle(4, 1), path, up="frenet")
    assert sweep(Rectangle(4, 1), path, up=Z).volume == pytest.approx(4 * path.length, rel=1e-5)


def test_scale_laws_hold_along_paths_not_parameterized_by_length():
    # The kernel reads the scale curve at the path's parameters, which run unevenly along this spline;
    # read at 65 points the radius was 1.2e-3 off (the volume 5.6e-6), now within 2e-6.
    path = Spline((0, 0, 0), (1, 0, 0.5), (2, 0, 3), (10, 0, 20), (11, 3, 40), (30, 10, 41), (60, 0, 42))
    body = sweep(Circle(1), path, scale=(1, 3))
    assert body.volume == pytest.approx(math.pi * path.length * 13 / 3, rel=1e-7)  # (the integral of pi r^2)
    worst = 0.0
    for i in range(1, 20):
        f = i / 20
        p, t = path.point_at(f), path.tangent_at(f)
        s = body.section(Plane(p, z_dir=t))
        r = max((q - p).length for e in s.edges() for q in (e.point_at(j / 16) for j in range(17))
                if (q - p).length < 6)
        worst = max(worst, abs(r / (1 + 2 * f) - 1))
    assert worst < 1e-5


# -- S8, S14: extrusions ------------------------------------------------------------------------------
def test_taper_takes_a_direction_only_along_the_normal():
    with pytest.raises(ValueError, match="taper drafts the walls about the sketch normal"):
        Rectangle(10, 10).extrude(10, taper=5, direction=(1, 0, 1))  # (it was ignored)
    down = Rectangle(10, 10).extrude(10, taper=5, direction=(0, 0, -1))
    assert down.bbox().min.z == pytest.approx(-10) and down.bbox().max.z == pytest.approx(0, abs=1e-9)
    assert down.volume == pytest.approx(Rectangle(10, 10).extrude(10, taper=5).volume, rel=1e-9)
    with pytest.raises(ValueError, match="open curve extrudes into a surface without a taper"):
        extrude(Line((0, 0), (10, 0)), 5, taper=3)


def test_oblique_extrusions_have_plane_walls():
    box = Rectangle(6, 4).extrude(5, direction=(1, 0, 1))
    assert sorted(f.geom_type for f in box.faces()) == ["plane"] * 6  # (two walls were B-splines)
    assert box.volume == pytest.approx(24 * 5 / math.sqrt(2), rel=1e-9)
    rod = Circle(3).extrude(5, direction=(1, 0, 1))
    assert rod.is_valid() and rod.volume == pytest.approx(math.pi * 9 * 5 / math.sqrt(2), rel=1e-9)


@pytest.mark.parametrize("nz, ox, kind", [
    ((-0.4092125194607695, 0.5336648914993783, 0.7400992484103236), -45.580993887045665, 3),
    ((0.6566440081552222, -0.43021580526965747, -0.6194618692462229), 0.5332129978121927, 0),
    ((0.08448912113948805, 0.5837642235746501, 0.8075152752012575), 33.769686371829195, 0),
    ((-0.46283758231099925, 0.5261490826361928, 0.7134062764243119), -38.026947581629074, 0),
])
def test_extrusions_close_to_tilted_planes(nz, ox, kind):
    # The four planes of the verifier's 1200 random extrusions where every angle failed (16 extrusions
    # each); they are swept along a line now where the turned extrusions fail.
    sk = [Circle(3), Rectangle(6, 4), RegularPolygon(5, 6), Ellipse(4, 2), Slot(10, 3)][kind].on(
        Plane(origin=(ox, 0, 0), z_dir=nz))
    n = sk.plane.z_dir
    t = n.cross(Vector(0.3, 0.5, 0.7)).normalized()
    for s in (1e-3, 0.01):
        for both in (False, True):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")  # (the thin-body warning below a sine of 1e-3)
                p = sk.extrude(5, direction=t * math.sqrt(1 - s * s) + n * s, both=both)
            assert p.is_valid() and p.volume == pytest.approx(sk.area * 5 * s * (2 if both else 1), rel=1e-6)


# -- S10: rails and tangency to faces ----------------------------------------------------------------
def test_lofts_along_rails_pass_through_them():
    r1 = Spline((0, 0, 0), (-2, 10, 1), (0, 20, 0))
    r2 = Spline((20, 0, 0), (24, 10, 2), (20, 20, 0))
    secs = [ThreePointArc(r1.point_at(t), (r1.point_at(t) + r2.point_at(t)) * 0.5 + Vector(0, 0, 3 + 2 * t),
                          r2.point_at(t)) for t in (0, 0.3, 0.7, 1)]
    sheet = loft(secs, rails=[r1, r2])
    assert isinstance(sheet, Shell) and len(sheet.faces()) == 1
    f = sheet.faces()[0]
    assert all(_off(f, e) < 1e-6 for e in [r1, r2] + secs)
    # a rail in the middle: the borders run smoothly through the sections' ends
    mid = Spline(*(s.point_at(0.5) for s in secs))
    f = loft(secs, rails=mid).faces()[0]
    assert _off(f, mid) < 1e-6 and all(_off(f, s) < 1e-6 for s in secs)
    # a rail may run on past the first and last section, and the other way
    f = loft(secs, rails=[r1.extend(5, end="both").reversed(), r2]).faces()[0]
    assert _off(f, r1) < 1e-6 and f.area == pytest.approx(sheet.area, rel=1e-6)
    with pytest.raises(ValueError, match="open sections"):
        loft([Circle(10), Circle(6).moved(Location((0, 0, 20)))], rails=Spline((10, 0, 0), (7, 0, 10), (6, 0, 20)))
    with pytest.raises(ValueError, match="takes no ruled"):
        loft(secs, rails=[r1, r2], ruled=True)
    with pytest.raises(ValueError, match="do not cross"):
        loft(secs, rails=[r1.translate(0, 0, 5), r2])
    kinked = [Line((0, 0, 0), (10, 0, 0)), Line((-2, 0, 10), (10, 0, 10)), Line((0, 0, 20), (10, 0, 20))]
    with pytest.raises(ModelingError, match="must be smooth curves"):
        loft(kinked, rails=[Polyline((0, 0, 0), (-2, 0, 10), (0, 0, 20)), Line((10, 0, 0), (10, 0, 20))])


def test_lofts_along_rails_that_spread_the_sections_unevenly():
    # The second rail rises over a hump near its start: along its length it spreads the sections
    # unevenly where the straight first one spreads them evenly. Every curve is smooth, yet the
    # curves fitted to cross at common parameters ran along the rails ahead of and behind their
    # points there (the straight rail by 0.003, all of it a slide along the line), which was taken
    # for "a corner".
    z = lambda x: 300 * math.exp(-((x - 200) / 80) ** 2)  # noqa: E731
    secs = [Spline((x, 0, 0), (x, 100, z(x) / 2 + 30), (x, 200, z(x))) for x in np.linspace(0, 1000, 27)]
    r1, r2 = Spline(*(s.start for s in secs)), Spline(*(s.end for s in secs))
    f = loft(secs, rails=[r1, r2]).faces()[0]
    assert all(_off(f, e) < 1e-5 for e in [r1, r2] + secs[::5])


def test_sweeps_along_two_rails_keep_the_profile_on_both():
    left = Spline((0, 0, 0), (2, 15, 1), (0, 30, 0))
    right = Spline((20, 0, 0), (26, 15, 3), (22, 30, 0))
    arc = ThreePointArc((0, 0, 0), (10, 0, 4), (20, 0, 0))
    hood = sweep(arc, left, rails=right)
    assert isinstance(hood, Shell) and len(hood.faces()) == 1
    f = hood.faces()[0]
    assert _off(f, left) < 1e-6 and _off(f, right) < 1e-6 and _off(f, arc) < 1e-6
    assert sweep(arc.reversed(), left, rails=right).area == pytest.approx(hood.area, rel=1e-9)
    # parallel straight rails: the profile moved along them
    straight = sweep(arc, Line((0, 0, 0), (0, 30, 0)), rails=Line((20, 0, 0), (20, 30, 0)))
    assert straight.area == pytest.approx(arc.length * 30, rel=1e-7)
    # rails that part: the profile scaled the same way in every direction (twice as long at the end)
    wide = sweep(arc, Line((0, 0, 0), (0, 30, 0)), rails=Line((20, 0, 0), (40, 30, 0)))
    end = max(wide.edges(), key=lambda e: e.center().y)
    assert end.length == pytest.approx(2 * arc.length, rel=1e-6)
    with pytest.raises(ValueError, match="takes no orient"):
        sweep(arc, left, rails=right, twist=10)
    with pytest.raises(ValueError, match="open profile"):
        sweep(Circle(3), left, rails=right)
    with pytest.raises(ValueError, match="from the path to the rail"):
        sweep(Line((0, 0, 5), (20, 0, 5)), left, rails=right)
    with pytest.raises(ValueError, match="one curve"):
        sweep(arc, left, rails=[right, right])


def test_lofts_continue_a_face_they_start_or_end_on():
    can = Cylinder(10, 20)
    rim = max((e for e in can.edges() if e.geom_type == "circle"), key=lambda e: e.center().z)
    wall = can.faces().cylinders()
    neck = loft([rim, Circle(4).moved(Location((0, 0, 30)))], start_tangent=wall)
    assert neck.is_valid() and neck.volume == pytest.approx(4264.351743, rel=1e-6)
    # tangent to the wall along the rim: the faces' normals agree there
    side = max(neck.faces(), key=lambda f: f.area)
    for i in range(8):
        a = 2 * math.pi * i / 8
        p = Vector(10 * math.cos(a), 10 * math.sin(a), 10)
        assert side.normal_at(side.closest_point(p)).angle_to(Vector(math.cos(a), math.sin(a), 0)) < 1e-4
    # and into a face at the end: a funnel into a plate's hole, as along the hole's axis (the side of
    # the face was taken wrongly at its seam, and the loft ran 180 degrees off there)
    plate = Box(40, 40, 2).translate(0, 0, 31) - Cylinder(4, 2).translate(0, 0, 31)
    bore = plate.faces().cylinders()[0]
    lip = min((e for e in bore.edges() if e.geom_type == "circle"), key=lambda e: e.center().z)
    funnel = loft([Circle(10), lip], end_tangent=bore)
    assert funnel.is_valid() and funnel.volume == pytest.approx(loft([Circle(10), lip], end_tangent=Z).volume, rel=1e-9)
    # a freeform face (a surface of revolution of a spline): tangent within 1e-3 radians
    vase = revolve(Spline((10, 0, 0), (14, 0, 8), (9, 0, 16), (11, 0, 24)), Axis.Z, 360).faces()[0]
    top = max((e for e in vase.edges() if e.is_closed), key=lambda e: e.bbox().center.z)
    spout = loft([top, Circle(5).moved(Location((0, 0, 40)))], start_tangent=vase)
    side = max(spout.faces(), key=lambda f: f.area)
    for i in range(8):
        p = top.point_at((i + 0.37) / 8)
        assert side.normal_at(side.closest_point(p)).angle_to(vase.normal_at(vase.closest_point(p))) < 0.06
    with pytest.raises(ValueError, match="must lie on it"):
        loft([Circle(9), Circle(4).moved(Location((0, 0, 30)))], start_tangent=wall)


# -- S13: primitives ----------------------------------------------------------------------------------
def test_torus_keeps_part_of_its_tube():
    half = Torus(20, 5, minor_start_angle=0, minor_end_angle=180)
    assert half.is_valid() and half.volume == pytest.approx(2 * math.pi * 20 * math.pi * 25 / 2, rel=1e-9)
    assert sorted(f.geom_type for f in half.faces()) == ["plane", "torus"]
    bead = Torus(20, 5, minor_start_angle=-90, minor_end_angle=90)  # the outer half
    assert bead.volume == pytest.approx(2 * math.pi * (20 + 20 / (3 * math.pi)) * math.pi * 25 / 2, rel=1e-9)
    assert sorted(f.geom_type for f in bead.faces()) == ["cylinder", "torus"]
    wedge = Torus(20, 5, minor_start_angle=30, minor_end_angle=120, major_angle=90)
    assert wedge.is_valid() and "cone" in [f.geom_type for f in wedge.faces()]
    assert Torus(20, 5, minor_start_angle=10, minor_end_angle=370).volume == pytest.approx(Torus(20, 5).volume,
                                                                                            rel=1e-9)
    with pytest.raises(ValueError, match="minor_end_angle"):
        Torus(20, 5, minor_start_angle=90, minor_end_angle=90)


def test_pyramid():
    p = Pyramid(10, 6, 8)
    assert p.is_valid() and p.volume == pytest.approx(10 * 6 * 8 / 3, rel=1e-9)
    assert sorted(f.geom_type for f in p.faces()) == ["plane"] * 5
    assert p.bbox().min.to_tuple() == pytest.approx((-5, -3, -4)) and p.bbox().max.to_tuple() == pytest.approx((5, 3, 4))
    assert Pyramid(10, 6, 8, align=(Align.CENTER, Align.CENTER, Align.MIN)).bbox().min.z == pytest.approx(0, abs=1e-9)
    with pytest.raises(ValueError, match="positive"):
        Pyramid(10, 0, 8)


# -- C4, C7, C8, C12: curves --------------------------------------------------------------------------
def test_long_helix_sweeps_with_the_kernels_frame():
    # NLib places at most about 1000 sections along a path: with the kernel's frame (orient=False) the
    # sweep failed beyond some 60 turns (80 here); it goes in pieces now.
    h = Helix(3, 240, 20)
    body = sweep(Circle(1.2).on(Plane(h.point_at(0), z_dir=h.tangent_at(0))), h, orient=False)
    # (the kernel's frame sweep approximates the surface: 8.6e-5 of the volume here)
    assert body.is_valid() and body.volume == pytest.approx(math.pi * 1.44 * h.length, rel=2e-4)


def test_closed_edges_with_a_corner_offset_into_one_closed_edge():
    pts = [(0, 0), (20, 0), (25, 15), (5, 20)]
    e = Spline(*pts, pts[0])
    out = e.offset(1)  # (it was the rounding arc alone)
    inn = e.offset(-1)  # (it raised)
    for o, length in ((out, 88.155147), (inn, 75.427285)):
        assert o.is_closed and o.length == pytest.approx(length, abs=1e-5)
        assert min(o.distance_to(e.point_at(i / 50)) for i in range(51)) == pytest.approx(1, abs=1e-4)


def test_fit_curve_takes_a_direction_at_every_point():
    ts = [4 * math.pi * i / 399 for i in range(400)]
    pts = [(t * 5, 10 * math.sin(t), 0) for t in ts]
    dirs = [(5, 10 * math.cos(t), 0) for t in ts]
    coarse = fit_curve(pts, tolerance=0.05, tangents=dirs)
    fine = fit_curve(pts, tolerance=0.005, tangents=dirs)
    assert max(coarse.distance_to(p) for p in pts) <= 0.05 and max(fine.distance_to(p) for p in pts) <= 0.005
    assert len(coarse.nurbs().points) < len(fine.nurbs().points) < 100  # (Spline: 400 and more)

    def dev(c):
        return max(c.tangent_at(c.param_at_point(p)).angle_to(Vector(*d)) for p, d in zip(pts[::10], dirs[::10]))

    assert dev(fine) < 0.1 < dev(coarse)
    with pytest.raises(ValueError, match="tangent 2 is None"):
        fit_curve(pts[:4], tangents=[(1, 0), None, (1, 0), (1, 0)])
    with pytest.raises(ValueError, match="closed curve takes no end tangents"):
        fit_curve(pts[:-1], closed=True, tangents=dirs[:-1])


def test_curves_across_a_closed_faces_seam_come_back_whole():
    cyl = Cylinder(10, 40)
    wall = cyl.faces().cylinders()[0]
    for at in ((10, 0, 0), (0, -10, 0)):  # (on the seam, and beside it)
        line = wall.wrap(Line((-20, 0), (20, 0)), at)
        ring = wall.wrap(Circle(5), at)
        assert len(line) == 1 and line[0].length == pytest.approx(40, abs=1e-5)
        assert len(ring) == 1 and ring[0].is_closed and ring[0].length == pytest.approx(10 * math.pi, rel=1e-6)
    across = Spline((12, -5, 10), (12, 0, 12), (12, 5, 14))
    assert [round(e.length, 5) for e in wall.project(across)] == [8.85288]  # (nothing before)
    assert [round(e.length, 5) for e in cyl.project(across, (-1, 0, 0), nearest=True)] == [11.21102]  # (two halves)


def test_nearest_projections_find_obstacles_between_their_samples():
    # A bridge 1 wide over a plate 100 long: 17 samples of the line missed it, and the plate's piece
    # under it came back whole.
    part = Box(100, 20, 2) + Box(1, 1, 8).translate(3, 9.5, 5) + Box(1, 20, 1).translate(3, 0, 8.5)
    got = part.project(Line((-50, 0, 20), (50, 0, 20)), (0, 0, -1), nearest=True)
    spans = sorted((round(min(e.start.x, e.end.x), 6), round(max(e.start.x, e.end.x), 6), round(e.start.z, 6))
                   for e in got)
    assert [v for span in spans for v in span] == pytest.approx([-50, 2.5, 1, 2.5, 3.5, 9, 3.5, 50, 1], abs=1e-4)
