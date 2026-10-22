"""Curves (kernel plan, lane C): the crash of 2D unions of touching xor sketches (C1), trimming,
splitting and locating points on edges (C2), ellipse curves in the bindings (C3), helices of any
number of turns (C4), curve intersections with a tolerance (C5), extended and joined edges (C6),
offsets of edges and wires and strokes along splines (C7), curves fitted to points (C8),
curvature, inflections and exact boxes of curves (C9), curves as lines and arcs (C10)."""

import math
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest
from pytest import approx

from smlibpy import *
from smlibpy._kernel import k


# -- C1: 2D unions of exclusive-or sketches whose faces touch at points ---------------------------
_C1_UNION = """
from smlibpy import *
def xor3(a, b, c):
    return Circle(5).translate(*a) ^ Circle(5).translate(*b) ^ Circle(5).translate(*c)
A = xor3((-2.182942041700211, -0.021197750386068748), (6.022573704823237, 2.0923218298214277),
         (3.2673065691056404, 6.700000911073089))
B = xor3((-1.339224018669533, -1.9852265367137176), (3.703896707505808, -1.34902306233055),
         (0.2844822629196706, 3.4839088044709605)).translate(1.5088026988484238, -0.07349559615725632)
u = A + B
c = u.center()
print(f"{u.area:.9f} {c.x:.6f} {c.y:.6f}")
"""


def test_union_of_touching_xor_sketches_does_not_crash():
    # The kernel's planar Boolean (SmPrimitiveCreation::Boolean2D) met an edge that the intersection
    # had left as a wire edge, read the mark of its missing face through a null pointer and killed the
    # process, depending on memory layout (7 of 13 runs before the patch). Now it fails with
    # SM_ERR_BAD_INTERSECTIONS and the checked route of C1 takes its next way. Fresh processes, as the
    # layout differs from one to the next; OpenCASCADE: area 219.190363897, center (2.171761, 1.680177).
    def run(_: int) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, "-c", _C1_UNION], capture_output=True, text=True, timeout=120)

    with ThreadPoolExecutor(4) as pool:
        runs = list(pool.map(run, range(8)))
    for r in runs:
        assert r.returncode == 0, f"exit {r.returncode}: {r.stderr[-300:]}"
        area, x, y = (float(v) for v in r.stdout.split())
        assert area == approx(219.190363897, rel=1e-7)
        assert (x, y) == approx((2.171761, 1.680177), abs=1e-5)


# -- C2: trim, split, param_at, closest_point ------------------------------------------------------
def test_split_a_spline_where_it_crosses_a_line():
    s = Spline((0, 0), (10, 10), (20, 0))
    x = s.intersections(Line((0, 4), (20, 4)))
    assert len(x) == 2 and x[0].to_tuple() == approx((10 - math.sqrt(60), 4, 0), abs=1e-9)
    a, b = s.split(x[0])
    assert a.length + b.length == approx(s.length, abs=1e-12)
    assert a.end.distance_to(x[0]) < 1e-9 and b.start.distance_to(x[0]) < 1e-9
    assert a.start.distance_to(s.start) < 1e-12 and b.end.distance_to(s.end) < 1e-12
    middle = s.trim(x[0], x[1])
    assert middle.start.distance_to(x[0]) < 1e-9 and middle.end.distance_to(x[1]) < 1e-9
    assert middle.length == approx(s.length - 2 * a.length, abs=1e-9)  # (the arch is symmetric)
    # the fraction of a point, and back
    t = s.param_at(x[0])
    assert s.point_at(t).distance_to(x[0]) < 1e-9
    assert t == approx(a.length / s.length, abs=1e-12)
    assert s.closest_point((10, 20)).to_tuple() == approx((10, 10, 0), abs=1e-9)
    assert s.param_at((10, 20)) == approx(0.5, abs=1e-12)


def test_trimmed_arcs_stay_arcs():
    arc = CenterArc((0, 0), 10, 0, 180).trim(0.25, 0.75)
    assert arc.geom_type == "circle" and arc.radius == approx(10) and arc.arc_center.length < 1e-12
    assert arc.length == approx(5 * math.pi, abs=1e-12)
    assert arc.start.to_tuple() == approx((50**0.5, 50**0.5, 0)) and arc.end.to_tuple() == approx((-(50**0.5), 50**0.5, 0))
    # an edge of a body: the rim of a cylinder
    rim = next(e for e in Cylinder(10, 20).edges() if e.geom_type == "circle")
    q = rim.trim(0.25, 0.5)
    assert q.geom_type == "circle" and q.length == approx(5 * math.pi, abs=1e-12)
    assert q.start.distance_to(rim.point_at(0.25)) < 1e-9 and q.end.distance_to(rim.point_at(0.5)) < 1e-9


def test_reversed_edges_split_and_trim_along_their_direction():
    r = Line((0, 0), (10, 0)).reversed()
    a, b = r.split(0.3)
    assert a.start.to_tuple() == approx((10, 0, 0)) and a.end.to_tuple() == approx((7, 0, 0))
    assert b.start.to_tuple() == approx((7, 0, 0)) and b.end.to_tuple() == approx((0, 0, 0))
    t = r.trim(0.2, 0.5)
    assert (t.start.x, t.end.x) == approx((8, 5))
    assert r.param_at((7, 0)) == approx(0.3)


def test_split_and_trim_refuse_what_is_not_on_the_edge():
    e = Line((0, 0), (10, 0))
    with pytest.raises(ValueError, match="end of the edge"):
        e.split(0.0)
    with pytest.raises(ValueError, match="end of the edge"):
        e.split((10, 0))
    with pytest.raises(ValueError, match="lies 1 off the edge"):
        e.split((5, 1))
    with pytest.raises(ValueError, match="start must come before the end"):
        e.trim(0.6, 0.2)
    with pytest.raises(ValueError, match="runs from 0 to 1"):
        e.split(1.5)


def test_wires_split_and_trim():
    w = Polyline((0, 0), (10, 0), (10, 10))
    a, b = w.split(0.25)
    assert (a.length, b.length) == approx((5, 15)) and len(a.edges()) == 1 and len(b.edges()) == 2
    a, b = w.split((10, 0))  # at the corner: the edges stay whole
    assert (len(a.edges()), len(b.edges())) == (1, 1) and a.end.to_tuple() == approx((10, 0, 0))
    m = w.trim((5, 0), (10, 5))
    assert m.length == approx(10) and m.start.to_tuple() == approx((5, 0, 0)) and m.end.to_tuple() == approx((10, 5, 0))
    assert w.trim(0.0, 0.5).length == approx(10)
    with pytest.raises(ValueError, match="end of the wire"):
        w.split(0.0)


# -- C3: ellipses -------------------------------------------------------------------------------
def test_ellipse_curves_reach_python_as_b_splines():
    c = k.create_ellipse((0, 0, 0), 30, 20)
    assert type(c).__name__ == "Ellipse" and isinstance(c, k.BSplineCurve)
    ea = EllipticalArc((0, 0), 30, 20, 0, 90)
    # a sweep along it (TypeError before)
    tube = sweep(Circle(2), ea)
    assert tube.is_valid() and tube.volume == approx(4 * math.pi * ea.length, rel=1e-5)
    # projected onto a box: two pieces, each as long as the arc (its plan view)
    up = EllipticalArc((0, 0, 20), 30, 20, 0, 90)
    pieces = Box(100, 100, 10).project(up, (0, 0, -1))
    assert len(pieces) == 2 and all(p.length == approx(ea.length, rel=1e-4) for p in pieces)
    # a ruled sheet between two ellipse arcs
    assert ruled(up, up.translate(0, 0, 10)).area == approx(10 * ea.length, rel=1e-6)


def test_ellipse_edges_of_bodies_sweep():
    # the edge of an oblique cut through a cylinder is an ellipse
    half = Cylinder(10, 40).split(Plane((0, 0, 0), z_dir=(0, 1, 1)))
    rim = next(e for e in half.edges() if e.geom_type == "ellipse")
    assert sweep(Circle(1), rim).is_valid()


# -- C4: helices ----------------------------------------------------------------------------------
@pytest.mark.parametrize("turns, radius", [(80, 20), (124, 50), (200, 20), (350.5, 5)])
def test_helices_of_many_turns(turns, radius):
    pitch = 2.0
    h = Helix(pitch, pitch * turns, radius)
    assert h.geom_type == "bspline"
    assert h.start.to_tuple() == approx((radius, 0, 0), abs=1e-9)
    end = 2 * math.pi * turns
    assert h.end.to_tuple() == approx((radius * math.cos(end), radius * math.sin(end), pitch * turns), abs=1e-6)
    assert h.length == approx(turns * math.hypot(2 * math.pi * radius, pitch), rel=5e-6)
    # every point within the fit tolerance (1e-4) of the radius, and the height linear in the angle
    c = h._curve()
    t0, t1 = h._range()
    for i in range(2001):
        x, y, _ = c.evaluate(t0 + (t1 - t0) * i / 2000)
        assert abs(math.hypot(x, y) - radius) < 1.2e-4


def test_long_conical_and_left_handed_helices():
    h = Helix(2, 2 * 150.5, 5, end_radius=15, left_handed=True)
    assert h.end.to_tuple() == approx((-15, 0, 301), abs=1e-4)  # half a turn at the end, radius 15
    mid = h.point_at(0.5)
    assert math.hypot(mid.x, mid.y) == approx(5 + 10 * mid.z / 301, abs=1e-4)  # the radius grows with the height
    lh = Helix(2, 2 * 150.5, 5, left_handed=True)
    assert lh.point_at(1 / (4 * 150.5)).to_tuple() == approx((0, -5, 0.5), abs=1e-4)  # a quarter turn: -y


# -- C5: intersections ------------------------------------------------------------------------------
def test_intersections_have_a_size_relative_tolerance():
    a = Line((0, 0, 0), (10, 0, 0))
    assert a.intersections(Line((5, -5, 0.0005), (5, 5, 0.0005))) == []  # skew: crossed before
    assert a.intersections(Line((5, -5, 0.0005), (5, 5, 0.0005)), tolerance=1e-3)[0].to_tuple() == approx((5, 0, 0))
    assert Line((0, 0), (0.01, 0)).intersections(Line((0, 0.0005), (0.01, 0.0005))) == []  # crossed at the origin before
    assert a.intersections(Line((0, 5), (10, 5))) == []  # KernelError before
    assert [p.x for p in a.intersections(Line((5, -5, 0), (5, 5, 0)))] == approx([5])
    assert a.intersection_params(Line((5, -5, 0), (5, 5, 0))) == approx([0.5])


def test_overlaps_give_both_ends_and_seams_count_once():
    assert [p.x for p in Line((0, 0), (10, 0)).intersections(Line((5, 0), (15, 0)))] == approx([5, 10])
    pts = EllipticalArc((0, 0), 20, 10).intersections(Line((-30, 0), (30, 0)))
    assert sorted(p.x for p in pts) == approx([-20, 20])
    pts = CenterArc((0, 0), 5, 0, 360).intersections(Line((-30, 0), (30, 0)))
    assert sorted(p.x for p in pts) == approx([-5, 5])
    e = Line((0, 0), (1, 1))
    with pytest.raises(ValueError, match="self_intersections"):
        e.intersections(e)


def test_intersections_with_wires_faces_and_bodies():
    z = Line((0, 0, -20), (0, 0, 20))
    box = Box(10, 10, 10)
    assert [p.z for p in z.intersections(box)] == approx([-5, 5])
    assert z.intersection_params(box) == approx([0.375, 0.625])
    assert [p.z for p in z.intersections(box.faces().sort_by(Axis.Z)[-1])] == approx([5])
    # a line on the top of a plate with a hole: the sides and the rim
    plate = Box(20, 20, 2) - Cylinder(4, 4)
    assert [p.x for p in Line((-20, 0, 1), (20, 0, 1)).intersections(plate)] == approx([-10, -4, 4, 10])
    # a line along a face of the box: where it starts and stops lying on it
    assert [p.x for p in Line((-20, 5, 0), (20, 5, 0)).intersections(box)] == approx([-5, 5])
    w = Polyline((0, -5), (10, 5), (20, -5))
    assert [p.x for p in Line((-5, 0), (25, 0)).intersections(w)] == approx([5, 15])
    assert [p.x for p in w.intersections(Line((-5, 0), (25, 0)))] == approx([5, 15])
    assert len(Line((10, -5), (10, 10)).intersections(w)) == 1  # the shared vertex, once
    assert Line((0, 0, 20), (10, 0, 20)).intersections(box) == []


def test_self_intersections():
    loop = Spline((0, 0), (10, 10), (10, 0), (0, 10))
    (p,) = loop.self_intersections()
    assert p.y == approx(5, abs=1e-9)
    assert CenterArc((0, 0), 5, 0, 360).self_intersections() == []


# -- C6: extend, to_edge -----------------------------------------------------------------------------
def test_extend_lines_and_arcs_as_themselves():
    e = Line((0, 0), (10, 0)).extend(2, end="both")
    assert e.geom_type == "line" and e.start.to_tuple() == approx((-2, 0, 0)) and e.end.to_tuple() == approx((12, 0, 0))
    arc = CenterArc((0, 0), 10, 0, 90).extend(math.pi * 10 / 4)
    assert arc.geom_type == "circle" and arc.radius == approx(10) and arc.length == approx(7.5 * math.pi)
    assert arc.end.to_tuple() == approx((-(50**0.5), 50**0.5, 0))
    back = CenterArc((0, 0), 10, 0, 90).reversed().extend(math.pi * 10 / 4)  # clockwise, past (10, 0)
    assert back.end.to_tuple() == approx((50**0.5, -(50**0.5), 0))
    el = EllipticalArc((0, 0), 20, 10, 0, 90)
    for end in ("start", "end", "both"):
        x = el.extend(5, end=end)
        assert x.geom_type == "ellipse" and x.length == approx(el.length + (10 if end == "both" else 5), abs=1e-8)
    assert CenterArc((0, 0), 10, 0, 300).extend(10).length == approx(10 * math.radians(300) + 10)
    with pytest.raises(ValueError, match="whole circle"):
        CenterArc((0, 0), 10, 0, 300).extend(11)
    with pytest.raises(ValueError, match="closed edge"):
        CenterArc((0, 0), 10, 0, 360).extend(1)


def test_extend_splines_by_the_distance():
    s = Spline((0, 0), (10, 10), (20, 0))
    for continuity in ("G1", "G2", "natural"):
        x = s.extend(5, continuity=continuity)
        assert x.length == approx(s.length + 5, abs=1e-8)
        assert x.start.distance_to(s.start) < 1e-9
        assert x.point_at(s.length / x.length).distance_to(s.end) < 1e-6  # the curve itself up to its end
    g1 = s.extend(5, end="both")
    t = s.tangent_at(1.0)
    assert g1.end.distance_to(s.end + t * 5) < 1e-9  # straight on along the tangent
    assert g1.start.distance_to(s.start - s.tangent_at(0.0) * 5) < 1e-9
    with pytest.raises(ValueError, match="continuity"):
        s.extend(1, continuity="C2")
    with pytest.raises(ValueError, match="positive"):
        s.extend(0)


def test_wires_join_into_one_edge():
    fp = FilletPolyline((0, 0), (30, 0), (30, 20), radius=5)
    e = fp.to_edge()
    assert e.geom_type == "bspline" and e.length == approx(fp.length, abs=1e-9)
    assert e.start.to_tuple() == approx((0, 0, 0)) and e.end.to_tuple() == approx((30, 20, 0))
    assert e.point_at(0.5).distance_to(fp.point_at(0.5)) < 1e-6
    path = FilletPolyline((0, 0, 0), (30, 0, 0), (30, 20, 10), radius=5)
    pipe = sweep(Circle(1), path.to_edge())
    assert pipe.is_valid() and pipe.volume == approx(math.pi * path.length, rel=1e-4)
    one = Line((0, 0), (1, 0))
    assert Wire([one]).to_edge() is one
    with pytest.raises(ValueError, match="a gap of 0.1"):
        Wire([Line((0, 0), (1, 0)), Line((1, 0.1), (2, 0))], sort=False).to_edge()


# -- C7: offsets of edges and wires, strokes along splines -------------------------------------------
def _arc_like_path(fitted: bool) -> Wire:
    """A line, a quarter circle and a line with corners; the arc exact or a cubic B-spline fitted to
    it within 1e-6 (an edge that is offset by the kernel, not as an arc)."""
    arc = CenterArc((10, 10), 10, -90, 90)
    if fitted:
        arc = fit_curve([arc.point_at(i / 200) for i in range(201)], tolerance=1e-6)
        assert arc.geom_type == "bspline"
    return Wire([Line((0, -5), (10, 0)), arc, Line((20, 10), (30, 10))])


def test_offsets_of_lines_and_arcs_stay_exact():
    w = Polyline((0, 0), (40, 0), (40, 30))
    inner = w.offset(2)  # to the left: the inside of the left turn, cut where the sides cross
    assert [e.geom_type for e in inner.edges()] == ["line", "line"] and inner.length == approx(66, abs=1e-12)
    outer = w.offset(-2)  # to the right: the corner opens, rounded with radius 2
    assert [e.geom_type for e in outer.edges()] == ["line", "circle", "line"]
    assert outer.length == approx(70 + math.pi, abs=1e-12) and outer.edges()[1].radius == approx(2)
    sharp = w.offset(-2, corners="sharp")
    assert sharp.length == approx(74, abs=1e-12) and sharp.end.to_tuple() == approx((42, 30, 0))
    assert w.offset(-2, corners="chamfer").length == approx(70 + 2 * math.sqrt(2), abs=1e-12)
    rect = Rectangle(20, 10).wires()[0]  # closed: positive moves outward, whichever way it runs
    assert rect.offset(2).length == approx(60 + 4 * math.pi, abs=1e-12)
    assert rect.reversed().offset(2).length == approx(60 + 4 * math.pi, abs=1e-12)
    assert rect.offset(-2).length == approx(44, abs=1e-12)
    circle = CenterArc((0, 0), 5, 0, 360)
    assert circle.offset(1).radius == approx(6) and circle.offset(-1).radius == approx(4)
    assert offset(Line((0, 0), (10, 0)), 2).start.to_tuple() == approx((0, 2, 0))  # (the operation too)


def test_spline_offsets_are_parallel_within_their_size():
    s = Spline((0, 0), (10, 5), (20, -3), (30, 4))
    for d in (2.0, -2.0):
        o = s.offset(d)
        dists = [s.distance_to(o.point_at(i / 200)) for i in range(201)]
        assert max(abs(x - abs(d)) for x in dists) <= 1e-6 * s.bbox().diagonal  # (the kernel's own call: 7e-4)
        normal = Vector(-s.tangent_at(0).y, s.tangent_at(0).x, 0)  # left of the direction
        assert o.start.distance_to(s.start + normal * d) < 1e-9
    assert s.offset(2).point_at(0.5).y > s.point_at(0.5).y  # positive: to the left (+Y here)
    with pytest.raises(ModelingError, match="bends more tightly than the distance 5.*radius of curvature is 3.9975"):
        s.offset(5)
    ring = Spline((0, 0), (10, 5), (20, 0), (10, -5), closed=True)
    assert ring.offset(1).length == approx(ring.length + 2 * math.pi, rel=1e-6)  # closed: outward
    assert ring.offset(-1).length == approx(ring.length - 2 * math.pi, rel=1e-6)
    # a curve in a vertical plane is seen from +Y; plane= says otherwise; a straight one needs it
    v = Spline((0, 0, 0), (10, 0, 5), (20, 0, 0))
    assert v.offset(1).start.to_tuple() == approx((math.sqrt(0.5), 0, -math.sqrt(0.5)))
    assert v.offset(1, plane=Plane.XZ).start.to_tuple() == approx((-math.sqrt(0.5), 0, math.sqrt(0.5)))
    with pytest.raises(ValueError, match="pass plane="):
        Line((0, 0, 0), (10, 0, 10)).offset(1)


def test_offsets_of_paths_with_curves_match_the_exact_path():
    exact, fitted = _arc_like_path(False), _arc_like_path(True)
    for d in (1.5, -1.5):
        for corners in ("round", "sharp", "chamfer"):
            a, b = exact.offset(d, corners=corners), fitted.offset(d, corners=corners)
            assert b.length == approx(a.length, abs=1e-5), (d, corners)
            assert b.start.distance_to(a.start) < 1e-9 and b.end.distance_to(a.end) < 1e-9
            assert all(x.end.distance_to(y.start) < 1e-9 for x, y in zip(b.edges(), b.edges()[1:]))


def test_closed_wires_with_splines_offset_like_their_region():
    lens = Wire([Spline((0, 0), (10, 6), (20, 0)), Spline((20, 0), (10, -6), (0, 0))])
    region = lens.to_sketch()
    for d in (1.0, -1.0, 2.0):
        for corners in ("round", "sharp"):
            assert lens.offset(d, corners=corners).to_sketch().area == approx(region.offset(d, corners=corners).area,
                                                                              rel=1e-5)
    # a U whose sides would run into each other
    u = Wire([Line((0, 0), (0, 20)), Line((0, 20), (8, 20)), Line((8, 20), (8, 0))])
    assert u.offset(-3).length == approx(36)
    with pytest.raises(ModelingError, match="moved by 5"):
        u.offset(-5)


def test_strokes_follow_splines():
    s = Spline((0, 0), (10, 5), (20, 0))
    band = 2 * s.length * 1e-6 * s.bbox().diagonal  # (the offsets are within 1e-6 of the size)
    assert Stroke(s, 2).area == approx(2 * s.length + math.pi, abs=band)  # (ModelingError before)
    assert Stroke(s, 2, ends="flat").area == approx(2 * s.length, abs=band)
    ring = Spline((0, 0), (10, 5), (20, 0), (10, -5), closed=True)
    assert Stroke(ring, 1).area == approx(ring.length, abs=2 * ring.length * 1e-6 * ring.bbox().diagonal)
    exact, fitted = _arc_like_path(False), _arc_like_path(True)
    for corners in ("round", "sharp", "chamfer"):
        for ends in ("round", "flat"):
            assert Stroke(fitted, 3, ends=ends, corners=corners).area == approx(
                Stroke(exact, 3, ends=ends, corners=corners).area, rel=1e-6), (corners, ends)
    # a spline that crosses itself: the band overlaps itself there and keeps the hole it encloses
    loop = Spline((0, 0), (20, 0), (20, 10), (10, 10), (10, -10))
    band = Stroke(loop, 1)
    assert len(band.faces()) == 1 and len(band.faces()[0].wires()) == 2
    assert band.area < loop.length + math.pi / 4  # (less than the band would cover without the overlap)


# -- C8: curves fitted to points -------------------------------------------------------------------
def test_fit_curve_keeps_within_the_tolerance_with_few_control_points():
    xs = [20 * i / 199 for i in range(200)]
    pts = [(x, 5 * math.sin(x / 3) + 0.003 * math.sin(7 * x)) for x in xs]
    e = fit_curve(pts, tolerance=0.01)
    assert max(e.distance_to(p) for p in pts) <= 0.01
    assert len(e.nurbs().points) < 40  # (Spline: 202)
    assert e.start.to_tuple() == approx((0, 0, 0), abs=1e-12) and e.end.distance_to(pts[-1]) < 1e-9
    import numpy as np

    a = fit_curve(np.array(pts), tangents=((1, 0), (0, 1)), tolerance=0.05)
    assert a.tangent_at(0).to_tuple() == approx((1, 0, 0)) and a.tangent_at(1).to_tuple() == approx((0, 1, 0))
    assert max(a.distance_to(p) for p in pts) <= 0.05
    ring = [(10 * math.cos(t), 6 * math.sin(t)) for t in (2 * math.pi * i / 60 for i in range(60))]
    c = fit_curve(ring, tolerance=0.01, closed=True)
    assert c.is_closed and c.tangent_at(0).angle_to(c.tangent_at(1)) < 1e-6
    assert max(c.distance_to(p) for p in ring) <= 0.01
    few = fit_curve([(0, 0), (1, 1), (2, 0)])  # through the points
    assert all(few.distance_to(p) < 1e-9 for p in [(0, 0), (1, 1), (2, 0)])
    with pytest.raises(ValueError, match="degree"):
        fit_curve(pts, degree=1)
    with pytest.raises(ValueError, match="closed curve takes no end tangents"):
        fit_curve(ring, closed=True, tangents=((1, 0), None))


def test_splines_take_a_tangent_at_every_point():
    pts = [(0, 0), (10, 0), (20, 10), (20, 20)]
    dirs = [(1, 0), (1, 1), (0, 1), (-1, 1)]
    s = Spline(*pts, tangents=dirs)
    for p, d in zip(pts, dirs):
        t = s.param_at(p)
        assert s.point_at(t).distance_to(p) < 1e-9
        assert s.tangent_at(t).angle_to(Vector(d)) < 1e-6  # (degrees)
    with pytest.raises(ValueError, match="one per point"):
        Spline(*pts, tangents=dirs[:3])


# -- C9: curvature, inflections, exact boxes -------------------------------------------------------
def test_curvature_minimum_radius_and_inflections():
    s = Spline((0, 0), (10, 5), (20, -3), (30, 4))
    r, t = s.min_radius()
    assert r == approx(3.997484385833472, rel=1e-9)  # OpenCASCADE (GeomLProp, refined)
    assert s.point_at(t).to_tuple() == approx((20.778561798465574, -3.1697513165695037, 0), abs=1e-6)
    assert s.radius_at(t) == approx(r, rel=1e-9) and s.curvature_at(t) == approx(1 / r, rel=1e-9)
    (f,) = s.inflections()
    assert s.point_at(f).to_tuple() == approx((14.951181948137158, 0.9954275141867979, 0), abs=1e-6)  # OpenCASCADE
    assert s.curvature_at(f) < 1e-9
    rr, tr = s.reversed().min_radius()
    assert rr == approx(r) and tr == approx(1 - t) and s.reversed().inflections() == [approx(1 - f)]
    e = EllipticalArc((0, 0), 20, 10, 0, 180)
    assert e.min_radius()[0] == approx(10 ** 2 / 20)  # b^2/a at the ends of the major axis
    assert e.curvature_at(0.5) == approx(10 / 20 ** 2) and e.inflections() == []
    assert Line((0, 0), (5, 5)).min_radius() == (math.inf, 0.0) and Line((0, 0), (5, 5)).radius_at() == math.inf
    assert CenterArc((0, 0), 7, 0, 90).min_radius() == (approx(7), 0.0)
    w = Wire([Line((0, 0), (10, 0)), Spline((10, 0), (20, 5), (30, 0))])
    rw, tw = w.min_radius()
    assert rw == approx(w.edges()[1].min_radius()[0]) and 10 / w.length < tw < 1


def test_free_curves_have_exact_boxes():
    b = Spline((0, 0), (1, 1), (2, 0), (30, 0)).bbox()
    assert b.max.y == approx(1.0069069109354301, abs=1e-12)  # OpenCASCADE (sampled before: 0.7998)
    assert b.min.y == approx(-1.1436479595277323, abs=1e-12)
    assert b.min.x == approx(0, abs=1e-12) and b.max.x == approx(30, abs=1e-12)


def test_sweep_errors_name_the_tightest_bend():
    path = Spline((0, 0, 0), (10, 0, 5), (10, 10, 10), (0, 10, 15))
    with pytest.raises(ModelingError, match=r"bends with a radius of 4\.556 .*reaches 5\.59 from the path"):
        sweep(Rectangle(10, 5), path)


# -- C10: lines and arcs ---------------------------------------------------------------------------
def test_to_arcs_keeps_within_the_tolerance():
    s = Spline((0, 0), (10, 5), (20, -3), (30, 4))
    for tol in (0.01, 0.001):
        w = s.to_arcs(tol)
        assert {e.geom_type for e in w.edges()} <= {"line", "circle"}
        assert max(s.distance_to(e.point_at(i / 8)) for e in w.edges() for i in range(9)) <= tol
        assert max(w.distance_to(s.point_at(i / 400)) for i in range(401)) <= tol
        assert w.start.distance_to(s.start) < 1e-9 and w.end.distance_to(s.end) < 1e-9
        assert all(a.tangent_at(1).angle_to(b.tangent_at(0)) < 1e-4 for a, b in zip(w.edges(), w.edges()[1:]))
    assert len(s.to_arcs(0.01).edges()) == 26  # (the kernel's own call: one curve, 0.0037 off for 0.001)
    e = EllipticalArc((0, 0), 20, 10, 0, 300)
    w = e.to_arcs(0.01)
    assert max(w.distance_to(e.point_at(i / 400)) for i in range(401)) <= 0.01
    line = Line((0, 0), (1, 1))
    assert line.to_arcs().edges()[0] is line
    assert Wire([line, Line((1, 1), (2, 0))]).to_arcs().length == approx(2 * math.sqrt(2))


def test_dxf_with_lines_and_arcs_only(tmp_path):
    s = Spline((0, 0), (10, 5), (20, -3), (30, 4))
    region = Ellipse(20, 10) - Circle(3)
    path = tmp_path / "arcs.dxf"
    export_dxf([s, region], path, curves="arcs", tolerance=0.01)
    text = path.read_text()
    kinds = {text.splitlines()[i + 1] for i, line in enumerate(text.splitlines()) if line.strip() == "0"}
    assert "SPLINE" not in kinds and "ELLIPSE" not in kinds and "ARC" in kinds and "CIRCLE" in kinds
    back = import_dxf_wires(path)
    assert sum(w.length for w in back) == approx(s.length + region.edges()[0].length + 6 * math.pi, rel=1e-4)
    with pytest.raises(ValueError, match="curves is 'exact' or 'arcs'"):
        export_dxf(s, path, curves="lines")
