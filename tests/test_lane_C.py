"""Curves (kernel plan, lane C): the crash of 2D unions of touching xor sketches (C1), trimming,
splitting and locating points on edges (C2), ellipse curves in the bindings (C3), helices of any
number of turns (C4), curve intersections with a tolerance (C5), extended and joined edges (C6),
offsets of edges and wires and strokes along splines (C7), curves fitted to points (C8),
curvature, inflections and exact boxes of curves (C9), curves as lines and arcs (C10), edges from
NURBS data (C11), projections onto bodies and faces, iso curves and wrapping (C12), splines in
linear time and closed ones curvature continuous (C13), conic arcs and flat spirals (C14), wire
and sketch fillets at arcs, splines and ellipses (C15), edges bent through a point or to new ends
(C16)."""

import math
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from pytest import approx

from smlibpy import *
from smlibpy._kernel import k
from smlibpy._regions import seg_of_edge, wire_frame


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


# -- C2: trim, split, param_at_point, closest_point ---------------------------------------------------
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
    t = s.param_at_point(x[0])
    assert s.point_at(t).distance_to(x[0]) < 1e-9
    assert t == approx(a.length / s.length, abs=1e-12)
    assert s.closest_point((10, 20)).to_tuple() == approx((10, 10, 0), abs=1e-9)
    assert s.param_at_point((10, 20)) == approx(0.5, abs=1e-12)


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
    assert r.param_at_point((7, 0)) == approx(0.3)


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
    # (the kernel offsets the fitted curve within 1e-6 of the path's size, 4e-5 here: 1e-4 for the
    # length. Before 0.5.0's fit_curve, the fitted arc happened to pass seg_of_edge's test for a
    # circle and was offset as an exact arc, not by the kernel.)
    exact, fitted = _arc_like_path(False), _arc_like_path(True)
    assert seg_of_edge(fitted.edges()[1], wire_frame(fitted.edges(), None, "test")).__class__.__name__ == "Curve2"
    for d in (1.5, -1.5):
        for corners in ("round", "sharp", "chamfer"):
            a, b = exact.offset(d, corners=corners), fitted.offset(d, corners=corners)
            assert b.length == approx(a.length, abs=1e-4), (d, corners)
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
    band = 2 * fitted.length * 1e-6 * fitted.bbox().diagonal  # (the fitted arc's sides: the kernel's offsets)
    for corners in ("round", "sharp", "chamfer"):
        for ends in ("round", "flat"):
            assert Stroke(fitted, 3, ends=ends, corners=corners).area == approx(
                Stroke(exact, 3, ends=ends, corners=corners).area, abs=band), (corners, ends)
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


def test_fit_curve_smooths_noisy_points():
    # 80 points round a ring in space with noise (sigma 0.15, the worst 0.50 off): a least-squares
    # fit within 0.6 of every point with 15 control points, smooth all round. The kernel's
    # approximation (SmBSplineCurve::ApproximatePoints) needed 31 and followed the noise.
    import numpy as np

    t = np.linspace(0, 2 * np.pi, 80, endpoint=False)
    ring = np.column_stack([30 * np.cos(t), 18 * np.sin(t), 6 * np.sin(3 * t)])
    pts = ring + np.random.default_rng(3).normal(0, 0.15, ring.shape)
    c = fit_curve(pts, tolerance=0.6, closed=True)
    assert max(c.distance_to(tuple(p)) for p in pts) <= 0.6 and len(c.nurbs().points) <= 20
    assert c.is_closed and c.start.distance_to(tuple(pts[0])) <= 0.6  # (near the first point)
    assert c.tangent_at(0).angle_to(c.tangent_at(1)) < 1e-6
    # a fitted quarter circle (tight tolerance) leaves its ends along the circle
    arc = CenterArc((10, 10), 10, -90, 90)
    f = fit_curve([arc.point_at(i / 200) for i in range(201)], tolerance=1e-6)
    assert len(f.nurbs().points) < 30
    assert all(f.tangent_at(u).angle_to(arc.tangent_at(u)) < 1e-6 for u in (0, 1))


def test_splines_take_a_tangent_at_every_point():
    pts = [(0, 0), (10, 0), (20, 10), (20, 20)]
    dirs = [(1, 0), (1, 1), (0, 1), (-1, 1)]
    s = Spline(*pts, tangents=dirs)
    for p, d in zip(pts, dirs):
        t = s.param_at_point(p)
        assert s.point_at(t).distance_to(p) < 1e-9
        assert s.tangent_at(t).angle_to(Vector(d)) < 1e-6  # (degrees)
    with pytest.raises(ValueError, match="one per point"):
        Spline(*pts, tangents=dirs[:3])


# -- C9: curvature, inflections, exact boxes -------------------------------------------------------
def test_curvature_minimum_radius_and_inflections():
    s = Spline((0, 0), (10, 5), (20, -3), (30, 4))
    r, t = s.min_radius(), s.min_radius_at()
    assert r == approx(3.997484385833472, rel=1e-9)  # OpenCASCADE (GeomLProp, refined)
    assert s.point_at(t).to_tuple() == approx((20.778561798465574, -3.1697513165695037, 0), abs=1e-6)
    assert s.radius_at(t) == approx(r, rel=1e-9) and s.curvature_at(t) == approx(1 / r, rel=1e-9)
    (f,) = s.inflections()
    assert s.point_at(f).to_tuple() == approx((14.951181948137158, 0.9954275141867979, 0), abs=1e-6)  # OpenCASCADE
    assert s.curvature_at(f) < 1e-9
    rr, tr = s.reversed().min_radius(), s.reversed().min_radius_at()
    assert rr == approx(r) and tr == approx(1 - t) and s.reversed().inflections() == [approx(1 - f)]
    e = EllipticalArc((0, 0), 20, 10, 0, 180)
    assert e.min_radius() == approx(10 ** 2 / 20)  # b^2/a at the ends of the major axis
    assert e.curvature_at(0.5) == approx(10 / 20 ** 2) and e.inflections() == []
    assert (Line((0, 0), (5, 5)).min_radius(), Line((0, 0), (5, 5)).min_radius_at()) == (math.inf, 0.0) and Line((0, 0), (5, 5)).radius_at() == math.inf
    assert CenterArc((0, 0), 7, 0, 90).min_radius() == approx(7) and CenterArc((0, 0), 7, 0, 90).min_radius_at() == 0.0
    w = Wire([Line((0, 0), (10, 0)), Spline((10, 0), (20, 5), (30, 0))])
    rw, tw = w.min_radius(), w.min_radius_at()
    assert rw == approx(w.edges()[1].min_radius())
    # (one kind of answer on edges, wires and faces: they compare)
    assert min(x.min_radius() for x in [*w.edges(), *Cylinder(50, 20).faces()]) == approx(rw) and 10 / w.length < tw < 1


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


# -- C11: edges from NURBS data ---------------------------------------------------------------------
def test_from_nurbs_is_the_inverse_of_nurbs():
    for e in (CenterArc((0, 0), 10, 0, 90), Spline((0, 0), (10, 5), (20, 0), (30, 8)), Helix(5, 20, 10),
              Line((0, 0), (5, 5)), EllipticalArc((0, 0), 10, 5, 0, 120)):
        f = Edge.from_nurbs(e.nurbs())
        assert f.geom_type == "bspline"
        assert f.start.distance_to(e.start) < 1e-12 and f.end.distance_to(e.end) < 1e-12
        assert f.length == approx(e.length, rel=1e-12)
        assert max(f.point_at(i / 10).distance_to(e.point_at(i / 10)) for i in range(11)) < 1e-9
    # moving a control point keeps the ends of a clamped curve
    n = Spline((0, 0), (10, 5), (20, 0), (30, 8)).nurbs()
    points = list(n.points)
    points[2] = points[2] + Vector(0, 0, 1)
    moved = Edge.from_nurbs(n._replace(points=points))
    assert moved.start == Vector(0, 0, 0) and moved.end == Vector(30, 8, 0)
    assert moved.point_at(0.5).z > 0.3


def test_from_nurbs_of_many_spans_and_unclamped_knots():
    # a uniform cubic B-spline (unclamped knots) starts at (P0 + 4 P1 + P2) / 6
    pts = [(0, 0), (10, 10), (20, 0), (30, 10), (40, 0), (50, 10)]
    e = Edge.from_nurbs((3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pts, None))
    assert e.start.distance_to((10, 20 / 3, 0)) < 1e-12 and e.end.distance_to((40, 10 / 3, 0)) < 1e-12
    # rational: the quarter circle
    q = Edge.from_nurbs(Nurbs(2, [0, 0, 0, 1, 1, 1], [Vector(10, 0, 0), Vector(10, 10, 0), Vector(0, 10, 0)],
                              [1, math.sqrt(2) / 2, 1]))
    assert max(abs(q.point_at(i / 20).length - 10) for i in range(21)) < 1e-12


@pytest.mark.parametrize("data,message", [
    ((3, [0, 0, 0, 0, 1, 1, 1, 1], [(0, 0), (1, 1), (2, 0), (3, 1), (4, 0), (5, 1)], None), "take 10 knots"),
    ((3, [0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2], [(0, 0), (1, 1), (2, 0), (3, 1), (4, 0), (5, 1)], None), "got 11"),
    ((3, [0, 0, 0, 0, 2, 1, 3, 3, 3, 3], [(0, 0), (1, 1), (2, 0), (3, 1), (4, 0), (5, 1)], None), "must not decrease"),
    ((3, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2], [(0, 0), (1, 1), (2, 0), (3, 1), (4, 0), (5, 1)], None), None),
    ((2, [0, 0, 0, 1, 1, 1], [(0, 0), (1, 1), (2, 0)], [1, 0, 1]), "weights must be positive"),
    ((2, [0, 0, 0, 1, 1, 1], [(0, 0), (1, 1), (2, 0)], [1, 1]), "one weight per control point"),
    ((0, [0, 1], [(0, 0)], None), "degree is a whole number from 1 to 32"),
    ((3, [0] * 8, [(0, 0)] * 4, None), "is empty"),
    ((2, [0, 0, 0, 1, 1, 1, 2, 2, 2], [(0, 0), (1, 1), (2, 0), (3, 1), (4, 0), (5, 1)], None), "repeated 3 times"),
])
def test_from_nurbs_checks_its_data(data, message):
    if message is None:  # (knots beyond the range of the curve are fine: the curve ends at knots[-4])
        assert Edge.from_nurbs(data).end.distance_to((3, 1, 0)) < 1e-12
        return
    with pytest.raises(ValueError, match=message):
        Edge.from_nurbs(data)
    with pytest.raises(TypeError, match="takes a Nurbs or a tuple"):
        Edge.from_nurbs(5)


# -- C12: projections onto bodies and faces, iso curves, wrapping -----------------------------------
def _off_sphere(edges, r=10.0):
    return max(abs(e.point_at(i / 100).length - r) for e in edges for i in range(101))


def test_project_fits_within_the_size_and_keeps_the_near_side():
    dome = Sphere(10)
    circle = CenterArc((0, 0, 30), 5, 0, 360)
    both = dome.project(circle)
    assert sorted(round(e.center().z, 4) for e in both) == [-8.6603, 8.6603]
    assert _off_sphere(both) < 1e-7 * 50  # within 1e-7 of the size (the kernel's default fits were 9.4e-5 off)
    near = dome.project(circle, nearest=True)
    assert len(near) == 1 and near[0].center().z == approx(8.660254, abs=1e-6)
    # a box with a through hole: only the top, cut by the hole; the bottom and the walls are hidden
    plate = Box(40, 40, 10) - Cylinder(5, 20)
    line = Line((-30, 0, 8), (30, 0, 8))
    assert len(plate.project(line)) == 8
    seen = plate.project(line, nearest=True)
    assert sorted((round(e.start.x, 9), round(e.end.x, 9)) for e in seen) == [(-5, -20), (20, 5)]
    assert all(abs(e.start.z - 5) < 1e-9 and abs(e.end.z - 5) < 1e-9 for e in seen)
    # a step seen obliquely: the high step hides part of the low one
    step = (Box(40, 20, 10, align=(Align.MIN, Align.CENTER, Align.MIN))
            + Box(20, 20, 10, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(0, 0, 10))
    low = step.project(Line((0, 0, 40), (50, 0, 40)), (1, 0, -1), nearest=True)
    assert len(low) == 1
    assert low[0].start.distance_to((30, 0, 10)) < 1e-6 and low[0].end.distance_to((40, 0, 10)) < 1e-6
    # a curve that misses: no pieces (it raised KernelError SM_ERR)
    assert dome.project(CenterArc((0, 0, 30), 15, 0, 360)) == []


def test_face_project_is_the_normal_projection():
    side = Cylinder(10, 40).faces().cylinders()[0]
    a, b = Vector(-30, -15, 5), Vector(30, -15, -5)
    [e] = side.project(Line(a, b))
    # onto a cylinder along its normals: radially, at the height of the point
    assert e.start.distance_to((-30 / math.hypot(30, 15) * 10, -15 / math.hypot(30, 15) * 10, 5)) < 1e-6
    assert e.end.distance_to((30 / math.hypot(30, 15) * 10, -15 / math.hypot(30, 15) * 10, -5)) < 1e-6
    for i in range(21):
        q = e.point_at(i / 20)
        p = a + (b - a) * ((q.z - a.z) / (b.z - a.z))
        assert abs(math.hypot(q.x, q.y) - 10) < 1e-5
        assert abs(math.atan2(p.y, p.x) - math.atan2(q.y, q.x)) * 10 < 1e-5
    top = (Box(40, 40, 10) - Cylinder(5, 20)).faces().sort_by(Z)[-1]
    pieces = top.project(Line((-30, 0, 9), (30, 0, 9)))
    assert sorted((round(p.start.x, 6), round(p.end.x, 6)) for p in pieces) == [(-20, -5), (5, 20)]


def test_face_iso_curves():
    side = Cylinder(10, 40).faces().cylinders()[0]
    [ring] = side.iso(v=0.5)
    assert ring.length == approx(20 * math.pi, rel=1e-9) and ring.is_closed and abs(ring.start.z) < 1e-9
    [line] = side.iso(u=0.25)
    assert line.length == approx(40, rel=1e-12) and abs(math.hypot(line.start.x, line.start.y) - 10) < 1e-9
    top = (Box(40, 40, 10) - Cylinder(5, 20)).faces().sort_by(Z)[-1]
    assert len(top.iso(u=0.5)) == 2  # cut by the hole
    with pytest.raises(ValueError, match="give u or v"):
        side.iso()
    with pytest.raises(ValueError, match="from 0 to 1"):
        side.iso(v=1.5)


def test_wrap_keeps_lengths_around_a_cylinder():
    side = Cylinder(10, 40).faces().cylinders()[0]
    w = side.wrap(Line((-20, 0), (20, 0)), (0, -10, 0), direction=(1, 0, 0))
    assert sum(e.length for e in w) == approx(40, abs=1e-5)  # across the seam: two pieces
    ends = [e.start for e in w] + [e.end for e in w]
    for a in (-math.pi / 2 - 2.0, -math.pi / 2 + 2.0):  # 20 along the circle of radius 10 from (0, -10) is 2 rad
        assert min(p.distance_to((10 * math.cos(a), 10 * math.sin(a), 0)) for p in ends) < 1e-6
    # on the face within 1e-7 of its size (49)
    assert all(abs(math.hypot(e.point_at(i / 10).x, e.point_at(i / 10).y) - 10) < 5e-6 for e in w for i in range(11))
    rect = side.wrap(Rectangle(20, 10), (0, -10, 0), direction=(1, 0, 0))
    assert sorted(round(e.length, 5) for e in rect) == [10, 10, 20, 20]
    assert max(e.bbox().max.z for e in rect) == approx(5, abs=1e-6)
    # a plane keeps the drawing; what falls into a hole is cut off
    top = (Box(40, 40, 10) - Cylinder(5, 20)).faces().sort_by(Z)[-1]
    across = top.wrap(Line((-30, 0), (30, 0)))
    assert sorted((round(e.start.x, 6), round(e.end.x, 6)) for e in across) == [(-20, -5), (5, 20)]
    with pytest.raises(ValueError, match="point of the face's surface"):
        side.wrap(Line((0, 0), (1, 0)), (0, 0, 0))
    with pytest.raises(ValueError, match="normal to the face"):
        side.wrap(Line((0, 0), (1, 0)), (0, -10, 0), direction=(0, -1, 0))


# -- C13: splines in linear time, closed splines curvature continuous -------------------------------
def test_spline_of_many_points_is_fast_and_unchanged():
    pts = [(math.cos(t) * 50 + 3 * math.sin(7 * t), math.sin(t) * 30) for t in (6 * i / 1599 for i in range(1600))]
    t0 = time.perf_counter()
    e = Spline(*pts)
    assert time.perf_counter() - t0 < 0.5  # (4.2 s with the dense system)
    assert e.length == approx(253.31646562349, rel=1e-10)
    # the same curve as the dense solve gave (control points of 0.5.0's Spline)
    s = Spline((0, 0, 0), (10, 5, 3), (20, 0, -2), (30, 8, 1), (31, 9, 7))
    p = s.nurbs().points
    assert p[1].distance_to((3.37902164578829, 3.2869916728601445, 2.2916911737092867)) < 1e-12
    assert p[3].distance_to((19.56508200997608, -4.983886379703627, -4.4997555548312596)) < 1e-12


def test_closed_spline_is_curvature_continuous_at_the_seam():
    s = Spline((0, 0), (30, -5), (50, 10), (35, 30), (10, 25), (-8, 12), closed=True)
    assert s.is_closed and s.start == Vector(0, 0, 0)
    assert s.tangent_at(0).angle_to(s.tangent_at(1)) < 1e-6
    assert s.curvature_at(0) == approx(s.curvature_at(1), rel=1e-9)  # (it was 0.0135 against 0.0574)
    assert s.curvature_at(0) == approx(0.03247170528591742, rel=1e-9)
    with pytest.raises(ValueError, match="at least three points"):
        Spline((0, 0), (10, 0), closed=True)


# -- C14: conic arcs and flat spirals ----------------------------------------------------------------
def test_conic_arcs_are_exact():
    p = ParabolicArc((0, 0), 10, -20, 20)
    assert p.start == Vector(-20, 10, 0) and p.end == Vector(20, 10, 0)
    assert max(abs(q.y - q.x ** 2 / 40) for q in (p.point_at(i / 50) for i in range(51))) < 1e-12
    h = HyperbolicArc((0, 0), 10, 20, -30, 30)
    assert max(abs(q.x ** 2 / 100 - q.y ** 2 / 400 - 1) for q in (h.point_at(i / 50) for i in range(51))) < 1e-12
    assert h.point_at(0.5).distance_to((10, 0, 0)) < 1e-9
    c = ConicArc((10, 0), (10, 10), (0, 10), math.sqrt(2) - 1)
    assert max(abs(q.length - 10) for q in (c.point_at(i / 50) for i in range(51))) < 1e-12
    para = ConicArc((0, 0), (10, 0), (10, 10))  # rho 0.5: half way from the chord's middle to the apex
    assert para.distance_to((7.5, 2.5, 0)) < 1e-12
    placed = ParabolicArc((5, 5), -10, 0, 20, Plane.XZ)
    assert placed.start == Vector(5, 0, 5) and placed.end.distance_to((25, 0, -5)) < 1e-12
    for make, message in [(lambda: ConicArc((0, 0), (1, 0), (2, 0)), "on one line"),
                          (lambda: ConicArc((0, 0), (1, 1), (2, 0), 1), "between 0 and 1"),
                          (lambda: ParabolicArc((0, 0), 0, 1, 2), "must not be zero"),
                          (lambda: HyperbolicArc((0, 0), 1, 0, 1, 2), "must be positive")]:
        with pytest.raises(ValueError, match=message):
            make()


def test_spiral():
    s = Spiral(2, 20, 5)
    assert s.start == Vector(2, 0, 0) and s.end.distance_to((20, 0, 0)) < 1e-9
    assert all(abs(q.z) < 1e-15 for q in (s.point_at(i / 20) for i in range(21)))
    c, (t0, t1) = s._curve(), s._range()
    for i in range(401):  # the radius grows evenly with the angle: 18 / (10 pi) per radian
        q = c.evaluate(t0 + (t1 - t0) * i / 400)
        r = math.hypot(q[0], q[1])
        turned = (r - 2) / 18 * 10 * math.pi
        assert abs(((math.atan2(q[1], q[0]) - turned + math.pi) % (2 * math.pi)) - math.pi) * 18 / (10 * math.pi) < 2e-4
    assert Spiral(0, 20, 5).start == Vector(0, 0, 0)
    inward = Spiral(20, 0, 5, Plane.XZ, clockwise=True)
    assert inward.end == Vector(0, 0, 0) and abs(inward.point_at(0.3).y) < 1e-12
    assert Spiral(2, 20, 150).end.distance_to((20, 0, 0)) < 1e-6  # (longer than one kernel helix)
    groove = sweep(Rectangle(0.5, 1), s)
    assert groove.is_valid() and groove.volume == approx(0.5 * s.length, rel=1e-3)
    with pytest.raises(ValueError, match="must differ"):
        Spiral(5, 5, 3)
    with pytest.raises(KernelError, match="fit_curve through points of the spiral makes it"):
        Spiral(2, 20, 0.5)  # (less than a turn with a large change of radius)


def test_a_wire_rounds_one_corner_given_alone():
    w = Polyline((0, 0), (20, 0), (20, 20))
    one = w.fillet(2, (20, 0))
    assert len(one.edges()) == 3 and one.length == approx(36 + math.pi)
    assert w.fillet(2, w.vertices()[1]).length == approx(one.length) == approx(w.fillet(2, [(20, 0)]).length)


def test_a_wire_offset_that_collapses_says_so():
    # (the inside of a strip 2 wide, moved 2 inward: its short sides shrink to nothing)
    with pytest.raises(ModelingError, match="moved by 2, a side of it shrinks to nothing"):
        Polyline((0, 0), (40, 0), (40, 2), (0, 2), close=True).offset(-2)


# -- C15: fillets of wires and sketches at arcs, splines and ellipses --------------------------------
def test_wire_fillet_rounds_corners_with_arcs():
    w = Wire([Line((0, 0), (10, 0)), ThreePointArc((10, 0), (13, 5), (10, 10)), Line((10, 10), (0, 10))])
    f = w.fillet(2)
    assert [e.geom_type for e in f.edges()] == ["line", "circle", "circle", "circle", "line"]
    assert f.start == w.start and f.end == w.end
    es = f.edges()
    assert all(a.end.distance_to(b.start) < 1e-9 and a.tangent_at(1).angle_to(b.tangent_at(0)) < 1e-6
               for a, b in zip(es, es[1:]))
    closed = Wire([Line((0, 0), (10, 0)), ThreePointArc((10, 0), (13, 5), (10, 10)), Line((10, 10), (0, 10)),
                   Line((0, 10), (0, 0))])
    region = make_face(closed)
    assert make_face(closed.fillet(1)).area == approx(region.fillet(1, region.vertices()).area, rel=1e-12)
    assert len(w.fillet(2, [(10, 0)]).edges()) == 4


def test_wire_fillet_names_what_it_cannot_round():
    w = Wire([Line((0, 0), (10, 0)), ThreePointArc((10, 0), (13, 5), (10, 10)), Line((10, 10), (0, 10))])
    with pytest.raises(ModelingError, match=r"\(55, 55\) is not a corner of the wire; its corners are at \(10, 0\)"):
        w.fillet(2, [(55, 55)])
    with pytest.raises(ModelingError, match="is an end of the open wire"):
        w.fillet(2, [(0, 0)])
    with pytest.raises(ValueError, match="selection is empty"):
        w.fillet(2, [])
    smooth = Wire([Line((0, 0), (10, 0)), CenterArc((10, 5), 5, -90, 180)])
    with pytest.raises(ModelingError, match="is smooth"):
        smooth.fillet(1, [(10, 0)])
    assert len(smooth.fillet(1).edges()) == 2  # (nothing to round)
    helix_like = Wire([Line((0, 0, 0), (10, 0, 0)), Spline((10, 0, 0), (12, 5, 1), (10, 10, 6))])
    with pytest.raises(ModelingError, match="not planar"):
        helix_like.fillet(1)
    # polylines as before, also in 3D
    p = FilletPolyline((0, 0, 0), (30, 0, 0), (30, 20, 10), radius=5)
    assert [e.geom_type for e in p.edges()] == ["line", "circle", "line"]
    with pytest.raises(ValueError, match="overlap"):
        Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(5.001)


def test_fillets_at_spline_and_ellipse_corners():
    w = Wire([Line((0, 0), (10, 0)), Spline((10, 0), (14, 4), (12, 8), (10, 10)), Line((10, 10), (0, 10))])
    arcs = [e for e in w.fillet(2).edges() if e.geom_type == "circle"]
    assert [round(a.radius, 12) for a in arcs] == [2, 2]
    # OpenCASCADE (ChFi2d_FilletAPI): centers (9.507884445553, 2) and (9.316103414, 7.99999996)
    assert arcs[0].arc_center.distance_to((9.507884445553, 2, 0)) < 1e-9
    assert arcs[0].end.distance_to((10.45551014916122, 0.23874887484462426, 0)) < 1e-9
    assert arcs[1].arc_center.distance_to((9.316103414, 8, 0)) < 1e-7
    spline = w.edges()[1]
    for a in arcs:
        assert spline.distance_to(a.arc_center) == approx(2, abs=1e-9)
    region = make_face(w.close())
    rounded = region.fillet(2)  # every corner, the spline's too (this raised before)
    outline = rounded.faces()[0].outer_wire().edges()
    assert all(a.tangent_at(1).angle_to(b.tangent_at(0)) < 1e-6 for a, b in zip(outline, outline[1:] + outline[:1]))
    assert rounded.area == approx(124.12092870628695, rel=1e-9)
    assert region.chamfer(1.5).area == approx(122.3254869677154, rel=1e-9)
    ell = Wire([Line((-20, 0), (0, 0)), EllipticalArc((10, 0), 10, 5, 180, 300),
                Line(EllipticalArc((10, 0), 10, 5, 180, 300).end, (20, 10)), Line((20, 10), (-20, 10)),
                Line((-20, 10), (-20, 0))])
    r = make_face(ell).fillet(1)
    assert "ellipse" in [e.geom_type for e in r.edges()] and r.area == approx(448.215432183746, rel=1e-9)
    # where no arc of the radius touches both (OpenCASCADE finds none either; 2.5 fits)
    tight = Wire([Spline((0, 0), (10, 5), (20, 0), tangents=((0, 1), (0, -1))), Line((20, 0), (0, 0))])
    assert [e.arc_center for e in tight.fillet(2.5, [(20, 0)]).edges() if e.geom_type == "circle"][0].distance_to(
        (10, 2.5, 0)) < 1e-6
    with pytest.raises(ValueError, match="no arc of radius 3 touches both segments"):
        tight.fillet(3, [(20, 0)])


# -- C16: edges bent through a point, edges whose ends move ----------------------------------------
def test_through_moves_the_curve_onto_the_point_and_keeps_its_ends():
    s = Spline((0, 0, 0), (10, 8, 0), (25, 5, 0), (40, 12, 0), (52, 10, 0), (60, 0, 0))
    e = s.through((25, 8, 3))
    assert e.distance_to((25, 8, 3)) < 1e-12
    assert e.start == s.start and e.end == s.end
    assert e.tangent_at(0).angle_to(s.tangent_at(0)) < 1e-6 and e.tangent_at(1).angle_to(s.tangent_at(1)) < 1e-6
    t = s.through((25, 8, 3), tangent=(1, 0, 0))
    assert t.distance_to((25, 8, 3)) < 1e-12 and t.tangent_at(t.param_at_point((25, 8, 3))).angle_to((1, 0, 0)) < 1e-6
    at = s.through((30, 20, 0), at=0.5)
    assert at.distance_to((30, 20, 0)) < 1e-12
    # lines and arcs become cubic B-splines; arcs stay rational
    line = Line((0, 0), (10, 0)).through((5, 2))
    assert line.distance_to((5, 2, 0)) < 1e-12 and line.tangent_at(0) == Vector(1, 0, 0) and line.nurbs().degree == 3
    arc = CenterArc((0, 0), 10, 0, 90).through((8, 8))
    assert arc.distance_to((8, 8, 0)) < 1e-12 and arc.nurbs().weights is not None
    assert arc.tangent_at(0).angle_to((0, 1, 0)) < 1e-6
    with pytest.raises(ValueError, match="nearest to an end"):
        s.through((-5, 0, 0))
    with pytest.raises(ValueError, match="strictly between 0 and 1"):
        s.through((25, 8, 3), at=1)


def test_match_moves_the_ends_exactly():
    s = Spline((0, 0, 0), (10, 8, 0), (25, 5, 0), (40, 12, 0), (52, 10, 0), (60, 0, 0))
    m = s.match(end=(52, 10, 4), end_tangent=(0, 1, 0))
    assert m.end.distance_to((52, 10, 4)) < 1e-12 and m.tangent_at(1).angle_to((0, 1, 0)) < 1e-6
    assert m.start == s.start and m.tangent_at(0).angle_to(s.tangent_at(0)) < 1e-6
    other = Spline((52, 10, 4), (60, 20, 4), (70, 20, 0))
    joined = s.match(end=other.start, end_tangent=other.tangent_at(0))
    assert Wire([joined, other]).edges()[0].tangent_at(1).angle_to(other.tangent_at(0)) < 1e-6
    moved = Line((0, 0), (10, 0)).match(start=(0, 1), start_tangent=(1, 1))
    assert moved.start == Vector(0, 1, 0) and moved.end == Vector(10, 0, 0)
    assert moved.tangent_at(0).angle_to((1, 1, 0)) < 1e-6 and moved.tangent_at(1).angle_to((1, 0, 0)) < 1e-6
    with pytest.raises(ValueError, match="give start, end"):
        s.match()



def test_points_along_long_helices_take_time_in_proportion_to_their_turns():
    # A point along a helix of 1000 turns (joined from pieces of 100) took a second: the arc length
    # was walked span by span, and each span looked the knots of the whole curve up again.
    import time

    h = Helix(0.5, 500, 3)  # 1000 turns
    t = time.perf_counter()
    points = [h.point_at(i / 20) for i in range(21)]
    assert time.perf_counter() - t < 3  # (21 s before)
    assert points[10].z == pytest.approx(250, abs=1e-3) and math.hypot(points[10].x, points[10].y) == pytest.approx(3, abs=1e-3)
    assert h.length == pytest.approx(1000 * math.hypot(2 * math.pi * 3, 0.5), rel=1e-5)
