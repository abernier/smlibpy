"""Curves (kernel plan, lane C): the crash of 2D unions of touching xor sketches (C1), trimming,
splitting and locating points on edges (C2), ellipse curves in the bindings (C3), helices of any
number of turns (C4), curve intersections with a tolerance (C5), extended and joined edges (C6)."""

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
