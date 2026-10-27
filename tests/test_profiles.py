"""2D modeling: the Profile pen, the shapes and their corner options, Hull and Stroke, and the
exact 2D operations (Booleans, offset, fillet and chamfer of corners, mirror)."""

import math
import random
import re
import time
from pathlib import Path

import pytest
from pytest import approx

from smlibpy import *
from smlibpy.mcp import discovery

PI = math.pi


def types(s):
    return sorted({e.geom_type for e in s.edges()})


def holes(s):
    return sum(len(f.inner_wires()) for f in s.faces())


def assert_tangent_joints(s, radius):
    """Every arc of ``radius`` meets its neighbours tangentially."""
    for f in s.faces():
        for w in f.wires():
            edges = list(w.edges())
            for a, b in zip(edges, edges[1:] + edges[:1]):
                if any(e.geom_type == "circle" and abs(e.radius - radius) < 1e-9 for e in (a, b)):
                    assert a.tangent_at(1).angle_to(b.tangent_at(0)) < 1e-6


# -- Profile ----------------------------------------------------------------------------------
def test_profile_revolve_section_is_exact():
    section = (Profile((0, 0)).line_to(12, 0).line_to(y=4).fillet(1.5)
               .line_to(x=6).line_to(y=20).chamfer(1).line_to(x=0).close())
    assert section.area == approx(12 * 4 + 6 * 16 - (4 - PI) * 1.5 ** 2 / 4 - 0.5, rel=1e-6)
    assert types(section) == ["circle", "line"]
    assert_tangent_joints(section, 1.5)
    bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
    assert bushing.is_valid()
    assert bushing.volume == approx(2 * PI * section.center().x * section.area, rel=1e-6)


def test_profile_half_and_mirror_make_a_symmetric_outline():
    bracket = (Profile((0, 0)).line_to(30, 0).line_to(y=6).line_to(x=10).fillet(4)
               .line_to(y=30).arc(10, 90).mirror(Y).close())
    b = bracket.bbox()
    assert (b.min.x, b.max.x, b.min.y, b.max.y) == approx((-30, 30, 0, 40))
    assert bracket.area == approx(60 * 6 + 20 * 24 + 50 * PI + 2 * (4 - PI) * 4, rel=1e-6)
    assert len(bracket.edges()) == 10  # the bottom and the top arc each join across the axis
    assert bracket.center().x == approx(0, abs=1e-6)
    assert (bracket - bracket.mirror(Y)).area == approx(0, abs=1e-6)
    assert_tangent_joints(bracket, 4)
    assert_tangent_joints(bracket, 10)
    # ends off the axis are joined straight across it
    m = Profile((5, 0)).line_to(20, 0).line_to(20, 10).line_to(5, 10).mirror(Y).close()
    assert m.area == approx(400) and len(m.edges()) == 4


def test_profile_moves_and_where_the_pen_is():
    p = Profile((0, 0)).line_to(20, 0).arc(10, 90)
    assert p.point == Vector(30, 10, 0) and p.heading == approx(90) and len(p) == 2
    assert Profile((0, 0), heading=30).forward(y=5).point == Vector(5 / math.tan(math.radians(30)), 5, 0)
    assert Profile((3, 4)).line_to(x=10).point == Vector(10, 4, 0)
    assert Profile((3, 4)).line_by(1, -1).point == Vector(4, 3, 0)
    assert Profile().turn(270).heading == approx(-90)
    assert Profile().arc(5, -90).heading == approx(-90)
    assert Profile().turn(45).line_to(10, 0).heading == approx(0)  # line_to sets its own direction
    t = Profile((0, 0)).line_to(10, 0).arc_to(20, 10)
    assert t.point == Vector(20, 10, 0) and t.heading == approx(90)
    slot = Profile((0, -3)).forward(20).arc(3, 180).forward(20).arc(3, 180).close()
    assert slot.area == approx(20 * 6 + 9 * PI, rel=1e-6)
    base = Profile((-25, 0)).line_to(-25, -7.5).arc_to(25, -7.5, through=(0, -15)).line_to(25, 0)
    assert base.mirror(X).close().area == approx(1258.8876, rel=1e-6)


def test_profile_is_immutable_and_branches():
    base = Profile((0, 0)).line_to(20, 0).line_to(20, 10)
    square = base.line_to(0, 10).close()
    round_top = base.arc_to(0, 10).close()
    assert square.area == approx(200)
    assert round_top.area == approx(357.0796, rel=1e-6)
    assert len(base) == 2 and base.point == Vector(20, 10, 0)


def test_profile_corners_at_the_start_and_end():
    r = Profile((0, 0)).fillet(2).line_to(20, 0).line_to(20, 10).line_to(0, 10).close()
    assert r.area == approx(200 - (4 - PI), rel=1e-6)
    closed = Profile((0, 0)).fillet(2).line_to(20, 0).line_to(20, 10).line_to(0, 10).line_to(0, 0).close()
    assert closed.area == approx(r.area, rel=1e-9)
    end = Profile((0, 0)).line_to(20, 0).line_to(20, 10).line_to(0, 10).fillet(3).close()
    assert end.area == approx(200 - (4 - PI) * 9 / 4, rel=1e-6)
    cw = Profile((0, 0)).line_to(0, 10).line_to(20, 10).line_to(20, 0).close()
    assert cw.area == approx(200) and cw.plane.z_dir == Vector(0, 0, 1)


def test_profile_wire_is_an_exact_sweep_path():
    path = Profile((0, 0)).line_to(20, 0).fillet(5).line_to(20, 20).wire()
    assert [e.geom_type for e in path.edges()] == ["line", "circle", "line"]
    assert path.length == approx(15 + 15 + 2.5 * PI)
    assert sweep(Circle(1), path).volume == approx(PI * path.length, rel=1e-6)


def test_profile_close_align():
    s = Profile((10, 10)).line_to(30, 10).line_to(30, 20).close(align=Align.CENTER)
    b = s.bbox()
    assert (b.min.x, b.max.x, b.min.y, b.max.y) == approx((-10, 10, -5, 5))


@pytest.mark.parametrize("make,error,message", [
    (lambda: Profile().line_to(10, 0).line_to(10, 10).line_to(0, -5).line_to(5, 5).close(), ModelingError,
     r"crosses or touches itself at \(3.3333, 0\): segment 1, line_to\(10, 0\) meets segment 3, line_to\(0, -5\)"),
    (lambda: Profile().line_to(10, 0).fillet(20).line_to(10, 10).line_to(0, 10).close(), ModelingError,
     r"fillet\(20\) at \(10, 0\) does not fit: it needs 20 along segment 1, line_to\(10, 0\), which is 10 long"),
    (lambda: Profile().forward(10).fillet(2).arc(5, 90).close(), ModelingError, "no corner; leave the fillet out"),
    (lambda: Profile().line_to(10, 0).forward(x=-5), ModelingError, "lies behind the pen"),
    (lambda: Profile().forward(y=5), ModelingError, "runs parallel to the X axis"),
    (lambda: Profile().line_to(10, 0).arc_to(20, 0), ModelingError, "straight ahead"),
    (lambda: Profile().line_to(10, 0).arc_to(0, 0), ModelingError, "straight behind"),
    (lambda: Profile().arc_to(10, 0, through=(5, 0)), ModelingError, "lie on one line"),
    (lambda: Profile().line_to(10, 0).line_to(10, 0), ValueError, "has no length"),
    (lambda: Profile().line_to(30), TypeError, r"line_to\(x=...\)"),
    (lambda: Profile().arc(-5, 90), ValueError, "radius must be positive"),
    (lambda: Profile().line_to(10, 0).fillet(2).wire(), ModelingError, "end of an open path is not a corner"),
    (lambda: Profile().line_to(10, 0).line_to(10, 10).line_to(0, 10).line_to(0, 5).mirror(Y), ModelingError,
     "runs along the mirror axis"),
    (lambda: Profile().line_to(10, 0).line_to(0, 10).line_to(0, 0).mirror(Y), ModelingError, "already closed"),
    (lambda: Profile().line_to(10, 0).close(), ModelingError, "encloses no area"),
    (lambda: Profile((0, 0, 5)), ValueError, "z = 0"),
    (lambda: Profile().fillet(2).line_to(20, 0).line_to(0, 10).line_to(0, 0).fillet(1).close(), ValueError,
     "both at the start corner"),
])
def test_profile_errors_name_the_segment_and_the_numbers(make, error, message):
    with pytest.raises(error, match=message):
        make()


def test_a_profile_is_not_a_shape():
    with pytest.raises(AttributeError, match=r"Call .close\(\) for the region"):
        Profile().line_to(10, 0).line_to(0, 10).extrude(5)


# -- shapes --------------------------------------------------------------------------------------
def test_shapes_corner_options_and_rotation():
    assert Rectangle(80, 50, fillet=6).area == approx(4000 - (4 - PI) * 36, rel=1e-6)
    assert types(Rectangle(80, 50, fillet=6)) == ["circle", "line"]
    assert Rectangle(40, 20, chamfer=3).area == approx(782)
    assert Rectangle(40, 20, fillet=10).area == approx(Slot(40, 20).area, rel=1e-6)
    assert len(Rectangle(40, 20, fillet=10).edges()) == 4
    t = Rectangle(40, 20, rotation=30).bbox()
    assert t.max.x == approx(20 * math.cos(math.radians(30)) + 10 * math.sin(math.radians(30)))
    b = Rectangle(40, 20, fillet=4, align=Align.MIN).bbox()
    assert (b.min.x, b.min.y, b.max.x, b.max.y) == approx((0, 0, 40, 20))
    assert Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30), fillet=2).area == approx(496 - 5 * (4 - PI) + (4 - PI), rel=1e-6)
    assert len(RegularPolygon(10, 6, fillet=1).edges()) == 12
    assert Ellipse(15, 8, rotation=30).area == approx(PI * 120, rel=1e-6)
    assert Trapezoid(40, 15, 60, rotation=90).bbox().size.y == approx(40)


def test_old_names_keep_working():
    assert RoundedRectangle(80, 50, 6).area == approx(Rectangle(80, 50, fillet=6).area, rel=1e-12)
    assert RoundedRectangle(40, 20, 0).area == approx(800)
    with pytest.raises(ValueError, match="corner radius is larger than half the shorter side"):
        RoundedRectangle(40, 20, 10.0001)
    assert Rectangle(40, 20).offset(2, corners="sharp").area == approx(44 * 24)
    assert FilletPolyline((0, 0), (20, 0), (20, 10), (0, 10), radius=2, close=True).length > 0
    assert make_face(Polyline((0, 0), (10, 0), (0, 10), close=True)).area == approx(50)
    assert Slot(30, 8).area == approx(22 * 8 + 16 * PI, rel=1e-6)


def test_triangle():
    assert Triangle(40, 20).area == approx(400)
    corners = sorted((round(v.x, 9), round(v.y, 9)) for v in Triangle(30, 40, apex=0).vertices())
    assert corners == [(-15, -20), (-15, 20), (15, -20)]
    assert Triangle(30, 20, apex=-10).bbox().size.x == approx(40)
    assert Triangle(20, 20 * math.sqrt(3) / 2).area == approx(math.sqrt(3) / 4 * 400)
    g = Triangle(30, 30, apex=0, fillet=2)
    assert len(g.edges()) == 6 and types(g) == ["circle", "line"]


@pytest.mark.parametrize("make,message", [
    (lambda: Rectangle(40, 20, fillet=2, chamfer=1), "not both"),
    (lambda: Rectangle(40, 20, fillet=11), r"fillet=11 is more than half the shorter side \(10\)"),
    (lambda: Polygon((0, 0), (50, 0), (0, 5), fillet=3), r"does not fit: it needs 60.1496 along the line \(0, 0\) -> \(50, 0\)"),
    (lambda: Triangle(10, 0), "must be positive"),
    (lambda: Trapezoid(40, 15, 180), "between 0 and 180"),
    (lambda: Ellipse(0, 5), "radii must be positive"),
    (lambda: ArcSlot(3, 8, 90), "needs a centerline radius above 4"),
    (lambda: ArcSlot(20, 6, 350), "the round ends meet for angles above 342.7461"),
])
def test_shape_errors(make, message):
    with pytest.raises(ValueError, match=message):
        make()


# -- slots, strokes, hulls -------------------------------------------------------------------
def test_slots_and_strokes():
    assert ArcSlot(30, 6, 90).area == approx(30 * PI / 2 * 6 + 9 * PI, rel=1e-6)
    assert types(ArcSlot(30, 6, 90)) == ["circle"]
    between = Stroke(Line((10, 5), (40, 20)), 6)
    assert between.area == approx(math.hypot(30, 15) * 6 + 9 * PI, rel=1e-6)
    path = Profile((0, 0)).line_to(20, 0).arc(10, 90).line_to(y=25).wire()
    assert Stroke(path, 4).area == approx(path.length * 4 + 4 * PI, rel=1e-6)
    assert Stroke(path, 4, ends="flat").area == approx(path.length * 4, rel=1e-6)
    corner = Polyline((0, 0), (20, 0), (20, 20))
    assert Stroke(corner, 4, ends="flat").area == approx(156 + PI, rel=1e-6)
    assert Stroke(corner, 4, ends="flat", corners="sharp").area == approx(160)
    assert Stroke(corner, 4, ends="flat", corners="chamfer").area == approx(158)
    ring = Stroke(CenterArc((0, 0), 10, 0, 360), 2)
    assert ring.area == approx(PI * 40, rel=1e-6) and holes(ring) == 1
    crossing = Stroke(Polyline((0, 0), (20, 20), (20, 0), (0, 20)), 2)
    assert len(crossing.faces()) == 1 and holes(crossing) == 1
    with pytest.raises(ModelingError, match="gap of 1 between edge 1 and edge 2"):
        Stroke(Wire([Line((0, 0), (10, 0)), Line((11, 0), (20, 0))]), 2)
    with pytest.raises(TypeError, match=r"call .wire\(\) on a Profile"):
        Stroke(Profile().line_to(10, 0), 2)


def test_hull_is_exact():
    r1, r2, d = 10, 6, 60
    beta = math.asin((r1 - r2) / d)
    lever = Hull(Circle(10), Pos(60, 0) * Circle(6))
    assert lever.area == approx(math.sqrt(d * d - (r1 - r2) ** 2) * (r1 + r2) + r1 * r1 * (PI / 2 + beta)
                                + r2 * r2 * (PI / 2 - beta), rel=1e-6)
    assert types(lever) == ["circle", "line"] and len(lever.edges()) == 4
    assert Hull(Rectangle(20, 10), Pos(20, 0) * Circle(5)).area == approx(300 + 12.5 * PI, rel=1e-6)
    assert Hull((0, 0), (10, 0), (5, 8), (5, 2)).area == approx(40)
    assert Hull(CenterArc((0, 0), 10, 0, 180), (0, -5)).area == approx(50 * PI + 50, rel=1e-6)
    random.seed(3)
    for _ in range(10):
        disks = [Pos(random.uniform(-20, 20), random.uniform(-20, 20)) * Circle(random.uniform(1, 6))
                 for _ in range(random.randint(1, 4))]
        h = Hull(*disks)
        assert all((s - h).area < 1e-6 for s in disks)
        assert not h.vertices().concave()
    with pytest.raises(ModelingError, match="all the points lie on one line"):
        Hull((0, 0), (5, 0), (10, 0))
    with pytest.raises(ModelingError, match="neither a line nor a circular arc"):
        Hull(Spline((0, 0), (10, 5), (20, 0)), (0, 10))


# -- Booleans --------------------------------------------------------------------------------------
def test_union_with_a_moved_circle_on_the_left_is_right():
    # The kernel's planar Boolean returned 200.48 here (a wrong union, no error).
    c, s = Circle(6).rotate(Z, 30).translate(-4, 2), Slot(30, 8)
    assert (c + s).area == approx(c.area + s.area - (c & s).area, rel=1e-6)
    a, b = Circle(10).translate(-5, 0), Circle(10).translate(5, 0)
    lens = 2 * 100 * math.acos(0.5) - 5 * math.sqrt(300)
    assert (a ^ b).area == approx(2 * (100 * PI - lens), rel=1e-6)


def test_booleans_of_moved_shapes_are_consistent():
    random.seed(11)

    def shape():
        kind = random.choice(["circle", "rect", "slot", "ring"])
        s = {"circle": lambda: Circle(random.uniform(2, 10)),
             "rect": lambda: Rectangle(random.uniform(3, 20), random.uniform(3, 20), fillet=1),
             "slot": lambda: Slot(random.uniform(12, 30), random.uniform(3, 10)),
             "ring": lambda: Circle(8) - Circle(random.uniform(2, 6))}[kind]()
        return s.rotate(Z, random.uniform(0, 360)).translate(random.uniform(-8, 8), random.uniform(-8, 8))

    for _ in range(12):
        x, y = shape(), shape()
        a, b, i = x.area, y.area, (x & y).area
        tol = 2e-6 * max(1, a, b)
        assert abs((x + y).area - (a + b - i)) < tol
        assert abs((x - y).area - (a - i)) < tol
        assert abs((x ^ y).area - (a + b - 2 * i)) < tol


def test_many_tools_in_one_boolean():
    plate = Rectangle(200, 120, fillet=10)
    t0 = time.perf_counter()
    r = plate - GridLocations(10, 10, 18, 10) * Circle(3)
    assert time.perf_counter() - t0 < 5  # 0.4 s here; 6.6 s before tools were combined
    assert holes(r) == 180
    assert r.area == approx(200 * 120 - (4 - PI) * 100 - 180 * 9 * PI, rel=1e-6)


def test_booleans_of_faces_that_touch_at_a_point():
    # The faces of an exclusive or of circles touch each other at points. There the kernel's planar
    # Boolean misclassified whole faces without an error, in either operand: abc & t was 86.6355 and
    # abc - t 23.9044 (wasm 54.9061 and 55.6337), abc ^ t 702.18 (wasm 67.09). The values below
    # are OpenCASCADE's.
    abc = Circle(5) ^ Circle(5).translate(4, 0) ^ Circle(5).translate(2, 4)
    t = Polygon((-20, -20), (20, -20), (0, 20))
    a = 110.5398163
    assert abc.area == approx(a)
    for r in (abc & t, t & abc):
        assert len(r.faces()) == 4 and r.area == approx(a)
        assert (r.center() - Vector(2, 1.5261489, 0)).length < 1e-6
    assert not (abc - t).faces()
    for r in (t - abc, abc ^ t, t ^ abc):
        assert r.area == approx(800 - a)
        assert (r.center() - Vector(-0.3206561, -7.9802049, 0)).length < 1e-6
    assert (abc + t).area == approx(800) and len((abc + t).faces()) == 1
    # The result is built as the kernel builds such regions: its faces share their vertices.
    assert (abc & t).extrude(5).volume == approx(5 * a)

    # two such sketches; OpenCASCADE: & 35.067874, - 103.018076, + 213.322849, ^ 178.254975
    def xor3(*centers):
        c = [Circle(5).translate(x, y) for x, y in centers]
        return c[0] ^ c[1] ^ c[2]

    p = xor3((-0.285723, 0.358634), (6.545264, -0.2061), (2.047048, 4.524309))
    q = xor3((-1.892038, 0.071452), (4.779296, 1.757861), (-0.435259, 2.820408)).translate(-4.911954, 3.715734)
    i = (p & q).area
    assert i == approx(35.067874, abs=1e-5)
    assert (p - q).area == approx(p.area - i) and (q - p).area == approx(q.area - i)
    assert (p + q).area == approx(p.area + q.area - i)
    assert (p ^ q).area == approx(p.area + q.area - 2 * i)
    assert (p ^ q).area == approx(178.254975, abs=1e-5)


def test_touching_faces_far_from_the_rest_are_checked_to_their_own_size():
    # Unit squares that touch at corners, and one 1000 away: the check of the face-by-face route took
    # its tolerance from the loose box of the faces' planes (an area of 4.8), and passed a union
    # whose square had become a sliver of 0.2778 by the far one (4.2778 for 5). A face that could
    # not be measured escaped as a bare RuntimeError.
    squares = Rectangle(1, 1).translate(1000.5, 0.5)
    for i, j in [(0, 0), (0, 3), (1, 0), (1, 1), (4, 1)]:
        squares = squares + Rectangle(1, 1).translate(i + 0.5, j + 0.5)
    assert squares.area == approx(6)
    # Faces apart from the other operand's go around the kernel (closeout K1): the squares that touch
    # at corners, which raised, and the far one keep their area.
    squares = Rectangle(1, 1).translate(1000.5, 0.5)
    for i, j in [(0, 2), (3, 2), (3, 3), (4, 1), (4, 3)]:
        squares = squares + Rectangle(1, 1).translate(i + 0.5, j + 0.5)
    assert squares.area == approx(6) and sorted(round(f.area, 9) for f in squares.faces())[0] == approx(1)


def test_empty_results_and_operand_errors():
    empty = Rectangle(10, 10) - Rectangle(20, 20)
    assert len(empty.faces()) == 0
    assert len((Rectangle(10, 10) & Pos(30, 0) * Rectangle(10, 10)).faces()) == 0
    with pytest.raises(ModelingError, match="the sketch is empty"):
        empty.extrude(5)
    with pytest.raises(ValueError, match="the sketch is empty"):
        empty.center()
    with pytest.raises(TypeError, match=r"make_face\(...\) or Profile\(...\).close\(\)"):
        Rectangle(10, 10) + Line((0, 0), (20, 0))


# -- offset --------------------------------------------------------------------------------------
def test_offset_corner_styles_are_exact():
    r = Rectangle(40, 20)
    grown = r.offset(2)
    assert grown.area == approx(800 + 120 * 2 + 4 * PI, rel=1e-6) and types(grown) == ["circle", "line"]
    assert r.offset(2, corners="sharp").area == approx(44 * 24) and len(r.offset(2, corners="sharp").edges()) == 4
    assert r.offset(2, corners="chamfer").area == approx(44 * 24 - 8)
    assert r.offset(-2).area == approx(36 * 16)
    angle = Polygon((0, 0), (30, 0), (30, 8), (8, 8), (8, 25), (0, 25))
    assert angle.offset(-2, corners="sharp").area == approx(172)
    assert angle.offset(-2, corners="chamfer").area == approx(174)
    assert angle.offset(-2).area == approx(172 + (4 - PI), rel=1e-6)
    for s in (RegularPolygon(10, 5), Rectangle(30, 10, fillet=3), Slot(30, 8)):  # Steiner's formula
        assert s.offset(2.5).area == approx(s.area + s.perimeter * 2.5 + PI * 6.25, rel=1e-6)


def test_offset_changes_topology_where_it_must():
    ring = Circle(10) - Circle(5)
    assert ring.offset(1).area == approx(PI * (121 - 16), rel=1e-6) and holes(ring.offset(1)) == 1
    assert holes(ring.offset(6)) == 0
    two = Circle(5) + Pos(12, 0) * Circle(5)
    assert len(two.offset(0.5).faces()) == 2 and len(two.offset(2).faces()) == 1
    dumbbell = Circle(8) + Pos(30, 0) * Circle(8) + Pos(15, 0) * Rectangle(20, 2)
    assert len(dumbbell.offset(-1.5).faces()) == 2
    assert holes((Rectangle(40, 40) - Rectangle(10, 10)).offset(6)) == 0
    outline = Rectangle(80, 50, fillet=6)
    gasket = outline.offset(3) - outline
    assert gasket.area == approx(outline.perimeter * 3 + 9 * PI, rel=1e-6) and holes(gasket) == 1
    for shrink in (lambda: Rectangle(40, 20).offset(-10), lambda: ring.offset(-2.5), lambda: Slot(40, 10).offset(-6)):
        with pytest.raises(ModelingError, match="removes the whole region"):
            shrink()
    with pytest.raises(ValueError, match="corners is 'round', 'sharp' or 'chamfer'"):
        Rectangle(10, 10).offset(1, corners="miter")
    assert types(Ellipse(15, 8).offset(2)) == ["bspline"]  # splines and ellipses: the kernel's offset


# -- corners --------------------------------------------------------------------------------------
def test_corners_selected_by_geometry():
    angle = Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))
    assert len(angle.vertices().convex()) == 5 and len(angle.vertices().concave()) == 1
    inner = angle.fillet(4, angle.vertices().concave())
    assert inner.area == approx(496 + (4 - PI) * 4, rel=1e-6)
    assert len(inner.vertices().smooth()) == 2
    outer = inner.chamfer(1, inner.vertices().convex())
    assert outer.area == approx(496 + (4 - PI) * 4 - 2.5, rel=1e-6)
    plate = Rectangle(60, 40) - Rectangle(20, 10)
    assert len(plate.vertices().concave()) == 4  # the corners of the hole
    assert fillet(plate.vertices().concave(), 2).area == approx(2200 + (4 - PI) * 4, rel=1e-6)
    assert chamfer(plate.vertices().convex(), 1).area == approx(2200 - 2)
    rc = Rectangle(30, 20) + Pos(15, 0) * Circle(6)  # two corners between a line and an arc
    rounded = rc.fillet(2, rc.vertices().concave())
    assert rounded.area > rc.area
    assert_tangent_joints(rounded, 2)
    lens = (Circle(10) & Pos(10, 0) * Circle(10)).fillet(2)  # corners between two arcs
    assert types(lens) == ["circle"]
    assert_tangent_joints(lens, 2)
    placed = Rectangle(20, 10).on(Plane.XZ)
    assert placed.fillet(2, placed.vertices().top()).area == approx(200 - 2 * (4 - PI), rel=1e-6)


@pytest.mark.parametrize("make,error,message", [
    (lambda: (Rectangle(60, 40) - Rectangle(20, 10)).fillet(2, [(1, 2)]), ModelingError,
     r"\(1, 2\) is not a corner of the sketch; its corners are at"),
    (lambda: Rectangle(40, 20).fillet(10.5), ModelingError, r"they need 10.5 \+ 10.5 of its 20"),
    (lambda: Slot(30, 10).fillet(1), ModelingError, "no sharp corners"),
    (lambda: Slot(30, 10).fillet(1, [(10, 5)]), ModelingError, "is smooth"),
    (lambda: make_face(Spline((0, 0), (10, 5), (20, 0), tangents=((0, 1), (0, -1))) + Line((20, 0), (0, 0))).fillet(3),
     ModelingError, "no arc of radius 3 touches both segments"),  # (OpenCASCADE finds none either; 2.5 fits)
    (lambda: Rectangle(10, 10).fillet(0), ValueError, "must be positive"),
    (lambda: Rectangle(10, 10).fillet(1, Rectangle(10, 10).edges()), TypeError, "not as an Edge"),
    (lambda: Box(1, 1, 1).vertices()[0].convexity, ValueError, "corners of a sketch"),
])
def test_corner_errors(make, error, message):
    with pytest.raises(error, match=message):
        make()


# -- mirror ---------------------------------------------------------------------------------------
def test_mirror_keeps_lines_arcs_and_the_side():
    half = Polygon((0, 0), (20, 0), (20, 5), (5, 20), (0, 20))
    m = half.mirror(Y)
    assert m.plane.z_dir == Vector(0, 0, 1) and types(m) == ["line"]
    assert (half.extrude(5).mirror(Plane.YZ) - m.extrude(5)).volume == approx(0, abs=1e-6)
    lifted = half.translate(0, 0, 10)
    assert (lifted.extrude(5).mirror(Plane.XY) - lifted.mirror(Plane.XY).extrude(5)).volume == approx(0, abs=1e-6)
    assert (half + m).area == approx(575)
    ring = (Pos(10, 0) * (Circle(5) - Circle(2))).mirror(Y)
    assert types(ring) == ["circle"] and ring.center().x == approx(-10)
    assert [e.geom_type for e in (Line((0, 0), (10, 5)) + CenterArc((10, 0), 5, 90, -90)).mirror(Plane.YZ).edges()] == \
        ["line", "circle"]
    c = CenterArc((3, 4), 5, 0, 360).mirror(Plane.YZ)
    assert c.geom_type == "circle" and c.arc_center == Vector(-3, 4, 0)
    assert CenterArc((0, 0), 5, 0, 90).scale(2).radius == approx(10)
    outline = Polyline((-20, 0), (-20, 10), (20, 10), (20, 0))
    assert len((outline + outline.mirror(Plane.XZ)).fillet(2).edges()) == 10
    with pytest.raises(ValueError, match="the axis must lie in the sketch plane"):
        half.mirror(Axis((0, 0, 0), (0, 0, 1)))


# -- skill: search, guides, a session -----------------------------------------------------------
@pytest.mark.parametrize("query,expected", [
    ("tangent arc", "Profile.arc_to"),
    ("rounded corner", "sketches/fillet"),
    ("slot", "sketches/ArcSlot"),
    ("hull", "sketches/Hull"),
    ("offset outline", "sketches/offset"),
    ("symmetric profile", "Profile.mirror"),
    ("trace path width", "sketches/Stroke"),
    ("gasket", "sketches/offset"),
])
def test_search_finds_the_2d_tools(query, expected):
    assert expected in [e.key for _, e in discovery.search(query, 6)]


def test_describe_method_picks_the_guide_of_the_domain():
    assert discovery.guide_for(discovery.find_method("Sketch.fillet")).key == "sketches/fillet"
    assert discovery.guide_for(discovery.find_method("Profile.arc")).key == "sketches/Profile"
    assert discovery.guide_for(discovery.find_method("Part.fillet")).key == "features/fillet"


SKILL = Path(discovery.SKILL_DIR)
GUIDES = sorted((SKILL / "references" / "sketches").glob("*.md")) + [SKILL / "recipes" / "profiles.md"]


@pytest.mark.parametrize("path", GUIDES, ids=[p.stem for p in GUIDES])
def test_sketch_guides_run(path):
    ns: dict = {}
    exec("from smlibpy import *\nimport math", ns)
    for i, code in enumerate(re.findall(r"```python\n(.*?)```", path.read_text(), re.S)):
        exec(compile(code, f"{path.name}[{i + 1}]", "exec"), ns)


def test_profile_script_through_an_mcp_session():
    from smlibpy.mcp.session import Session

    session = Session()
    try:
        ok = session.run(
            "section = (Profile((0, 0)).line_to(12, 0).line_to(y=4).fillet(1.5)\n"
            "           .line_to(x=6).line_to(y=20).chamfer(1).line_to(x=0).close())\n"
            "bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))\n"
            "print(round(section.area, 4), bushing.is_valid())")
        assert ok["ok"], ok
        assert ok["output"].split() == ["143.0171", "True"]
        bad = session.run("p = Profile().line_to(10, 0).fillet(20).line_to(10, 10).line_to(0, 10).close()")
        assert not bad["ok"] and "does not fit" in bad["error"] and "line 1" in bad["error"]
        assert [item["name"] for item in session.run("bushing.volume")["scene"]] == ["section", "bushing"]
    finally:
        session.close()
