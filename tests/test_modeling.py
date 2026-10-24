import math
import warnings

import numpy as np
import pytest

from smlibpy import *

REL = 1e-6


def approx(v, rel=REL):
    return pytest.approx(v, rel=rel)


# -- primitives -------------------------------------------------------------------
def test_primitives_are_exact():
    assert Box(10, 20, 30).volume == approx(6000)
    assert Cylinder(3, 10).volume == approx(math.pi * 9 * 10)
    assert Sphere(5).volume == approx(4 / 3 * math.pi * 125)
    assert Torus(10, 2).volume == approx(2 * math.pi ** 2 * 10 * 4)
    assert Cone(4, 2, 6).volume == approx(math.pi * 6 / 3 * (16 + 8 + 4))
    assert Box(10, 20, 30).area == approx(2 * (200 + 600 + 300))


def test_alignment():
    b = Box(10, 10, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
    assert b.bbox().min.z == pytest.approx(0)
    assert b.bbox().max.z == pytest.approx(4)
    c = Cylinder(2, 5, align=Align.MIN)
    assert c.bbox().min == Vector(0, 0, 0)


# -- booleans ---------------------------------------------------------------------
def test_booleans():
    a, b = Box(10, 10, 10), Box(10, 10, 10).translate(5, 0, 0)
    assert (a + b).volume == approx(1500)
    assert (a - b).volume == approx(500)
    assert (a & b).volume == approx(500)
    assert (a - [Cylinder(1, 20).translate(x, 0, 0) for x in (-2, 2)]).volume == approx(1000 - 2 * math.pi * 10)


def test_boolean_with_pattern():
    plate = Box(80, 60, 10) - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)
    assert plate.volume == approx(48000 - 4 * math.pi * 16 * 10)
    assert plate.is_valid()


def test_disjoint_union_has_two_solids():
    p = Box(1, 1, 1) + Box(1, 1, 1).translate(5, 0, 0)
    assert len(p.solids()) == 2


# -- features ---------------------------------------------------------------------
def test_fillet_and_chamfer():
    box = Box(30, 20, 10)
    f = box.fillet(box.edges().parallel_to(Z), 2)
    assert f.volume == approx(6000 - 4 * (4 - math.pi) * 10)
    c = box.chamfer(box.faces().top().edges(), 2)
    # four prisms along the top edges minus the overlapping corner pyramids
    assert c.volume == approx(6000 - 0.5 * 4 * (2 * 30 + 2 * 20) + 4 * 8 / 3)


def test_fillet_accepts_edges_of_an_equal_part():
    a, b = Box(10, 10, 10), Box(10, 10, 10)
    assert a.fillet(b.edges().parallel_to(Z), 1).volume == approx(1000 - 4 * (1 - math.pi / 4) * 10)


def test_fillet_function_finds_the_part():
    box = Box(10, 10, 10)
    assert fillet(box.edges().parallel_to(Z), 1).volume == approx(1000 - 4 * (1 - math.pi / 4) * 10)


def test_blend_and_variable_fillets():
    box = Box(30, 20, 10)
    g2 = box.fillet(box.edges().parallel_to(Z), 3, continuity="G2")
    assert g2.is_valid() and g2.volume < 6000
    var = box.fillet(box.edges().parallel_to(Z).first, (1, 4))
    assert var.is_valid() and var.volume < 6000


def test_shell():
    box = Box(30, 20, 10)
    assert box.shell(1, box.faces().top()).volume == approx(6000 - 28 * 18 * 9)


def test_split_and_section():
    box = Box(30, 20, 10)
    above, below = box.split(Plane.YZ.offset(5), keep="both")
    assert above.volume == approx(2000) and below.volume == approx(4000)
    assert above.is_valid() and below.is_valid()
    assert Cylinder(5, 20).section(Plane.XZ).area == approx(200)


def test_mirror_keeps_volume():
    w = Wedge(10, 10, 5)
    assert w.mirror(Plane.XZ).volume == approx(w.volume)


def test_mass_properties():
    mp = Box(10, 20, 30).translate(1, 2, 3).mass_properties(density=2)
    assert mp.mass == approx(12000)
    assert mp.center == Vector(1, 2, 3)
    assert mp.inertia[0, 0] == approx(12000 * (20 ** 2 + 30 ** 2) / 12)
    assert abs(mp.inertia[0, 1]) < 1e-6


# -- sketches ---------------------------------------------------------------------
def test_sketch_areas():
    assert (Rectangle(40, 20) - Circle(5)).area == approx(800 - math.pi * 25)
    assert RoundedRectangle(40, 20, 4).area == approx(800 - (4 - math.pi) * 16)
    assert Slot(30, 10).area == approx(200 + math.pi * 25)
    assert RegularPolygon(10, 6).area == approx(3 * math.sqrt(3) / 2 * 100)
    assert Rectangle(20, 10).fillet(2).area == approx(200 - (4 - math.pi) * 4)


def test_sketch_offset():
    assert Rectangle(20, 10).offset(1).area == approx(22 * 12 - (4 - math.pi))
    assert Rectangle(20, 10).offset(-1).area == approx(18 * 8)
    assert Rectangle(20, 10).offset(1, round=False).area == approx(22 * 12)


def test_extrude_variants():
    assert Circle(5).extrude(10, both=True).bbox().min.z == pytest.approx(-10)
    assert Rectangle(10, 10).extrude(-5).bbox().max.z == pytest.approx(0)
    assert Rectangle(10, 4).on(Plane.XZ).extrude(3).bbox().min.y == pytest.approx(-3)
    tapered = Rectangle(20, 20).extrude(10, taper=10)
    assert tapered.is_valid() and tapered.volume < 4000


def test_sketch_on_face_pocket():
    part = Box(50, 50, 20)
    part = part - Rectangle(30, 20).on(part.faces().top()).extrude(-5)
    assert part.volume == approx(50 * 50 * 20 - 30 * 20 * 5)


def test_revolve():
    profile = Polygon((10, 0), (30, 0), (30, 5), (15, 5), (15, 20), (10, 20)).on(Plane.XZ)
    full = math.pi * ((30 ** 2 - 10 ** 2) * 5 + (15 ** 2 - 10 ** 2) * 15)
    assert profile.revolve(Z).volume == approx(full)
    assert profile.revolve(Z, 90).volume == approx(full / 4)
    ring = (Rectangle(10, 10) - Circle(2)).translate(20, 0, 0).on(Plane.XZ)
    assert ring.revolve(Z).volume == approx(2 * math.pi * 20 * (100 - math.pi * 4))


def test_loft_and_sweep():
    assert loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)]).is_valid()
    path = Spline((0, 0, 0), (0, 10, 20), (30, 10, 40))
    # Pappus: a tube's volume is its cross-section times the path length
    assert sweep(Circle(2), path).volume == approx(math.pi * 4 * path.length, rel=1e-6)
    assert sweep(Circle(3) - Circle(1.5), path).volume == approx(math.pi * 6.75 * path.length, rel=1e-6)
    bent = sweep(Rectangle(4, 4), Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30)))
    assert bent.volume == approx(4 * 4 * 60)
    elbow = Wire([Line((0, 0, 0), (0, 0, 20)), CenterArc((10, 20), 10, 180, -90, plane=Plane.XZ)])
    assert sweep(Circle(2), elbow).volume == approx(math.pi * 4 * elbow.length, rel=1e-6)
    helix = Helix(pitch=10, height=40, radius=20)
    assert sweep(Rectangle(4, 2), helix).volume == approx(8 * helix.length, rel=1e-5)


def test_sweep_puts_the_center_of_the_profile_on_the_path():
    # The kernel anchored the profile by the box along the world axes of the profile already turned
    # to the path: a triangle along (1, 1, 1) started 1.6667 before the path (along (1, 2, 0.3):
    # 0.8025 off). The center of the triangle's own box is 2.357 from its centroid, in its plane.
    tri = Polygon((0, 0), (10, 0), (0, 10))
    for d in [(0, 0, 1), (1, 0, 0), (1, 1, 1), (1, 2, 0.3)]:
        d = np.array(d) / np.linalg.norm(d)
        part = sweep(tri, Line((0, 0, 0), tuple(10 * d)))
        assert part.is_valid() and part.volume == pytest.approx(500)
        caps = [f for f in part.faces() if f.geom_type == "plane" and abs(np.dot(f.normal_at().to_tuple(), d)) > 1 - 1e-9]
        start = min(caps, key=lambda f: abs(np.dot(f.center().to_tuple(), d)))
        c = np.array(start.center().to_tuple())
        assert np.dot(c, d) == pytest.approx(0, abs=1e-9) and np.linalg.norm(c) == pytest.approx(math.sqrt(50) / 3)


def test_sweep_carries_the_profile_along_a_3d_path():
    # Each piece of a 3D path was turned afresh from the sketch: the rectangle turned by 90 degrees
    # at the last joint of this path (its end 4 wide in x and 2 high), and a section through that
    # joint failed (SM_ERR). Tangent edges are swept in one go now.
    path = FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), (40, 40, 40), radius=8)
    bar = sweep(Rectangle(4, 2), path)
    assert bar.is_valid() and bar.volume == pytest.approx(8 * path.length, rel=1e-6)
    end = next(f for f in bar.faces() if f.geom_type == "plane" and f.normal_at().y > 1 - 1e-9 and f.center().y > 39)
    assert (end.bbox().max - end.bbox().min).to_tuple() == pytest.approx((2, 0, 4), abs=1e-6)
    cut = bar.section(Plane((40, 8, 40), z_dir=(0, 1, 0))).bbox()
    assert (cut.max - cut.min).to_tuple() == pytest.approx((2, 0, 4), abs=1e-6)
    # at a corner the profile turns by the smallest rotation from one leg to the next: the long
    # side ends along (-1 / sqrt(5), -0.4, 0.8), where it ended along X before
    legs = Polyline((0, 0, 0), (0, 0, 20), (20, 0, 20), (20, 20, 30))
    part = sweep(Rectangle(4, 1), legs)
    t = np.array((0, 2, 1)) / math.sqrt(5)
    end = next(f for f in part.faces() if f.geom_type == "plane" and abs(np.dot(f.normal_at().to_tuple(), t)) > 1 - 1e-9
               and f.center().distance_to((20, 20, 30)) < 1)
    side = max(end.edges(), key=lambda e: e.length)
    assert side.length == pytest.approx(4)
    assert abs(np.dot(_unit((side.end - side.start).to_tuple()), (-1 / math.sqrt(5), -0.4, 0.8))) == pytest.approx(1)
    # a closed path that is not planar: in one go, without a turn where the halves met
    loop = Spline(*[(20 * math.cos(a), 14 * math.sin(a), 6 * math.sin(2 * a) + 3 * math.cos(a))
                    for a in np.arange(8) * math.pi / 4], closed=True)
    ring = sweep(Rectangle(4, 1), loop)
    assert ring.is_valid() and len(ring.faces()) == 4 and ring.volume == pytest.approx(4 * loop.length, rel=1e-4)
    assert sweep(Circle(2), loop).volume == pytest.approx(4 * math.pi * loop.length, rel=1e-7)  # (in two halves, as before)
    # an open profile along a closed edge sweeps into a surface in one go (it was split into halves
    # and refused: "surface sweeps need a single-edge path")
    band = sweep(Line((0, 0, 0), (4, 0, 0)), Circle(20).edges()[0])
    assert isinstance(band, Shell) and band.area == pytest.approx(2 * math.pi * 20 * 4, rel=1e-6)


def test_sweep_along_kinked_closed_3d_paths():
    # Loops closed with a kink, Spline(*pts, pts[0]), through these symmetric points lie in a plane
    # at 0, 1/4, 1/2 and 3/4 of their length: taken for planar, their halves went to the
    # planar-path sweep, which gave no closed solid (ModelingError; valid before the profile was
    # carried along). Now they are swept as 3D paths, the profile carried along the halves: area x
    # length less the overlap of the ends where they cross at the kink (for the circle about
    # tan(kink) x 2 r^3 / 3, the first moment of its inner half). Since 0.5.0's close-out the
    # rectangle meets itself where the loop closes (turned there by the smallest rotation, the turn
    # it gained round the loop spread along it): it was 543.404104 and 477.647314.
    for ry, profile, volume in ((20, Rectangle(4, 1), 543.395580), (14, Circle(2), 1499.196379),
                                (14, Rectangle(4, 1), 477.122125)):
        pts = [(20 * math.cos(a), ry * math.sin(a), 6 * math.sin(2 * a)) for a in np.arange(8) * math.pi / 4]
        path = Spline(*pts, pts[0])
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            body = sweep(profile, path)
        assert body.is_valid() and body.volume == pytest.approx(volume, rel=1e-6)
        overlap = profile.area * path.length - body.volume
        kink = math.radians(path.tangent_at(0).angle_to(path.tangent_at(1)))
        if profile.edges()[0].geom_type == "circle":
            assert overlap == pytest.approx(math.tan(kink) * 2 * 2 ** 3 / 3, rel=0.03)
        else:
            assert 0 < overlap < math.tan(kink) * 1 * 4 ** 2 / 8  # at most with the long side in the bend


def test_sweep_edge_by_edge_where_the_joined_path_fails():
    # The edges of this 3D fillet polyline are joined into one curve and swept in one go; the kernel
    # cannot sweep a circle or an ellipse of this size along it (SM_ERR; the rectangle goes), which
    # raised (a valid body before the profile was carried along). The edges are swept on their own
    # then, each turned to its own start: a profile that is not round turns where they meet, and a
    # warning says so.
    path = FilletPolyline((0, 0, 0), (13.2, 22.83, -20.78), (38.33, 52.89, -20.73), (38.66, 70.52, -34.06), radius=5)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        tube = sweep(Circle(2), path)
    assert tube.is_valid() and tube.volume == pytest.approx(4 * math.pi * path.length, rel=1e-6)
    with pytest.warns(RuntimeWarning, match="could not be carried along the path"):
        oval = sweep(Ellipse(2, 1.5), path)
    assert oval.is_valid() and oval.volume == pytest.approx(3 * math.pi * path.length, rel=1e-6)


def _unit(v):
    return np.array(v) / np.linalg.norm(v)


def test_disjoint_sketch_union():
    two = Circle(1).translate(-3, 0, 0) + Circle(1).translate(3, 0, 0)
    assert two.area == approx(2 * math.pi)
    assert len(two.faces()) == 2


# -- curves -----------------------------------------------------------------------
def test_curves():
    assert Line((0, 0), (3, 4)).length == pytest.approx(5)
    arc = CenterArc((0, 0), 10, 0, 90)
    assert arc.length == pytest.approx(5 * math.pi)
    assert arc.radius == pytest.approx(10)
    t = ThreePointArc((0, 0), (1, 1), (2, 0))
    assert t.arc_center == Vector(1, 0, 0)
    s = Spline((0, 0), (10, 5), (20, 0), tangents=((1, 0), (1, 0)))
    assert s.start == Vector(0, 0, 0) and s.end == Vector(20, 0, 0)
    assert s.tangent_at(0) == Vector(1, 0, 0)
    h = Helix(pitch=5, height=20, radius=10)
    assert h.end == Vector(10, 0, 20)
    assert Polyline((0, 0), (10, 0), (10, 10), close=True).is_closed


@pytest.mark.parametrize("start, end", [(300, 60), (210, 390), (-90, 90), (45, 395)])
def test_elliptical_arc_across_angle_0(start, end):
    rx, ry, span = 27, 15, (end - start) % 360
    arc = EllipticalArc((0, 0), rx, ry, start, end)
    assert arc.geom_type == "ellipse"
    # the length against Gauss-Legendre integration of the ellipse's speed from start to end
    a0, a1 = math.radians(start), math.radians(start + span)
    x, w = np.polynomial.legendre.leggauss(64)
    t = a0 + (a1 - a0) * (x + 1) / 2
    assert arc.length == pytest.approx((a1 - a0) / 2 * np.dot(w, np.hypot(rx * np.sin(t), ry * np.cos(t))), rel=1e-10)
    assert arc.start.distance_to((rx * math.cos(a0), ry * math.sin(a0))) < 1e-9
    assert arc.end.distance_to((rx * math.cos(a1), ry * math.sin(a1))) < 1e-9
    # counterclockwise from start to end: the middle lies within the arc's angles, not on the rest of the ellipse
    mid = arc.point_at(0.5)
    assert 0 < (math.degrees(math.atan2(mid.y / ry, mid.x / rx)) - start) % 360 < span


# -- selectors --------------------------------------------------------------------
def test_selectors():
    part = Box(10, 10, 10) - Cylinder(2, 20)
    assert len(part.edges().parallel_to(Z).lines()) == 4
    assert len(part.faces().cylinders()) == 1
    assert part.faces().top().one().normal_at() == Vector(0, 0, 1)
    assert len(part.faces().facing(-Z)) == 1
    assert len(part.edges().circles()) == 2
    groups = part.edges().group_by(Z)
    assert len(groups) == 3
    assert part.faces().sort_by("area")[-1].area == pytest.approx(2 * math.pi * 2 * 10)
    assert part.faces().sort_by("area")[0].area == pytest.approx(100 - math.pi * 4)
    assert part.faces().top().one().plane.origin.z == pytest.approx(5)


def test_facing_takes_a_curved_face_only_when_all_its_normals_qualify():
    # The wall of a hole was judged at its centroid, which lies on the axis, where any normal
    # comes back: facing(-X) took both walls here. A full wall faces no direction.
    holed = Box(40, 30, 20) - Cylinder(5, 30) - Cylinder(3, 30).translate(12, 0, 0)
    for d in (X, -X, Y, -Y, Z, -Z):
        assert [f.geom_type for f in holed.faces().facing(d)] == ["plane"]
    boss = (Box(40, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MAX))
            + Cylinder(6, 15, align=(Align.CENTER, Align.CENTER, Align.MIN)))
    assert sorted(round(f.center().z, 6) for f in boss.faces().facing(Z)) == [0, 15]  # block and boss tops
    for d in (X, -X, Y, -Y):
        assert [f.geom_type for f in boss.faces().facing(d)] == ["plane"]
    # A fillet between the top and the +X side: its normals turn from Z to X, so it faces
    # (1, 0, 1) only with an angle that takes in both ends (45 degrees off).
    block = Box(40, 30, 20)
    rounded = block.fillet(block.edges().parallel_to(Y).top().right(), 5)
    assert [f.geom_type for f in rounded.faces().facing(X)] == ["plane"]
    assert [f.geom_type for f in rounded.faces().facing(Z)] == ["plane"]
    fillet = rounded.faces().cylinders()
    assert len(fillet) == 1
    assert not fillet.facing((1, 0, 1), max_angle=40)
    assert fillet.facing((1, 0, 1), max_angle=50) == fillet
    # a dome whose rim normal is acos(12 / 20) = 53.13 degrees off Z
    dome = Sphere(20) & Box(60, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 12)
    assert not dome.faces().facing(Z, max_angle=50).of_type("sphere")
    assert len(dome.faces().facing(Z, max_angle=56).of_type("sphere")) == 1


def test_sketch_booleans_of_overlapping_circles():
    a, b = Circle(10).translate(-5, 0), Circle(10).translate(5, 0)
    lens = 2 * 100 * math.acos(0.5) - 5 * math.sqrt(300)
    assert (a & b).area == approx(lens)
    assert (a + b).area == approx(2 * math.pi * 100 - lens)
    assert (a - b).area == approx(math.pi * 100 - lens)
    assert (a ^ b).area == approx(2 * (math.pi * 100 - lens))


def test_oversized_rounds_are_rejected():
    cube = Box(10, 10, 10)
    with pytest.raises(ModelingError):
        cube.fillet(cube.edges(), 6)
    with pytest.raises(ModelingError):
        cube.chamfer(cube.edges(), 6)
    assert cube.fillet(cube.edges(), 4).is_valid()


# -- cells -----------------------------------------------------------------------
def test_merge_makes_cells():
    a, b = Box(10, 10, 10), Box(10, 10, 10).translate((5, 0, 0))
    m = a.merge(b)
    assert m.volume == approx(1500)
    assert not m.is_valid()  # cells share faces: not a manifold solid
    assert sorted(c.volume for c in m.cells()) == [approx(500)] * 3
    assert all(c.is_valid() for c in m.cells())
    assert merge(a, b).volume == approx(1500)
    # touching parts share the face between them
    t = Box(10, 10, 10).merge(Box(10, 10, 10).translate((10, 0, 0)))
    assert len(t.faces()) == 11 and [c.volume for c in t.cells()] == [approx(1000)] * 2
    assert Box(1, 1, 1).cells()[0].volume == approx(1)


def test_cells_with_cavities():
    m = Box(10, 10, 10).merge(Box(2, 2, 2))
    outer, inner = m.cells()
    assert outer.volume == approx(992) and inner.volume == approx(8)
    assert len(outer.faces()) == 12  # the outer box and the cavity
    ball = Sphere(4).translate((0, 0, 5))
    cells = Box(10, 10, 10).merge(ball).cells()
    assert sorted(c.volume for c in cells) == pytest.approx(
        sorted([(Box(10, 10, 10) - ball).volume, (Box(10, 10, 10) & ball).volume, (ball - Box(10, 10, 10)).volume]),
        rel=1e-6)
    with pytest.raises(TypeError, match="parts"):
        Box(1, 1, 1).merge(Rectangle(1, 1))
    with pytest.raises(ValueError, match="two or more"):
        merge(Box(1, 1, 1))


def test_cells_of_inserts_that_touch_the_part_around_them():
    # An insert that touches the box's wall at a point joins its shell to the box's: the outer cell
    # kept the insert's volume (8000 + 268.083 in a box of 8000).
    box = Box(20, 20, 20)
    ball = Sphere(4)
    for where in [(6, 0, 0), (6, 6, 0)]:  # touching a face, and an edge
        cells = sorted(c.volume for c in box.merge(ball.translate(where)).cells())
        assert cells == [approx(ball.volume), approx(8000 - ball.volume)]
    two = box.merge(ball.translate(6, 0, 0), ball.translate(-6, 0, 0)).cells()
    assert sorted(c.volume for c in two) == [approx(ball.volume)] * 2 + [approx(8000 - 2 * ball.volume)]
    # Along a line the cavity cannot be cut out (the kernel's cut of a tangent cylinder fails): the
    # outer cell was 8502.655, more than the box.
    with pytest.raises(ModelingError, match="cells: the cells inside a cell could not be cut out"):
        box.merge(Cylinder(4, 10).translate(6, 0, 0)).cells()


def test_cells_must_fill_the_part(monkeypatch):
    # The cells add up to the merged part, or cells() raises: here region_shells leaves the cavity out.
    import smlibpy.defeature
    import smlibpy.shapes

    monkeypatch.setattr(smlibpy.defeature, "GUARD_SECONDS", 0)  # (in this process, which sees the call replaced)
    m = Box(10, 10, 10).merge(Box(2, 2, 2))
    shells = smlibpy.shapes.ext.region_shells
    monkeypatch.setattr(smlibpy.shapes.ext, "region_shells", lambda b: [s[:1] for s in shells(b)])
    with pytest.raises(ModelingError, match="cells: the cells add up to a volume of 1008, the part has 1000"):
        m.cells()


def test_cells_of_parts_whose_faces_meet_within_a_tolerance():
    # A pin with fitted rounds in a block: the faces leave gaps of about 2e-6 of the volume, so the
    # part and its cells integrate differently by about as much (456.57590 against 456.57678).
    # cells() raised that they did not add up, and section() and cell_at() with it. (The pin's
    # chamfers did this until 0.5.0; they are exact cones now.)
    pin = Cylinder(3, 10)
    m = Box(8, 8, 5).merge(pin.fillet(pin.edges(), 1, continuity="G2"))
    cells = m.cells()
    assert len(cells) == 4 and sum(c.volume for c in cells) == approx(456.57678, rel=1e-7)
    assert m.cell_at((0, 0, 0)).volume == approx(45 * math.pi)
    xy = m.section(Plane.XY)
    assert len(xy.faces()) == 2 and xy.area == approx(64)
    wide = Cylinder(10, 20)
    assert len(Box(30, 30, 10).merge(wide.fillet(wide.edges(), 3, continuity="G2")).cells()) == 4


def test_section_of_a_merged_part_has_every_cell():
    m = merge(Box(40, 40, 20), Cylinder(6, 30))
    xy = m.section(Plane.XY)  # was 1 face, 1486.903: the insert's disc was dropped
    assert sorted(f.area for f in xy.faces()) == [approx(36 * math.pi), approx(1600 - 36 * math.pi)]
    assert xy.plane == Plane.XY
    xz = m.section(Plane.XZ)  # was KernelError: section failed (SM_ERR)
    assert len(xz.faces()) == 5 and xz.area == approx(40 * 20 + 12 * 10)
    assert m.section(Plane.XY.offset(12)).area == approx(36 * math.pi)  # the pin end alone
    with pytest.raises(ValueError, match="does not cut"):
        m.section(Plane.XY.offset(40))
    # a plane through the face between two cells: that face once
    stack = merge(Box(40, 40, 20), Box(40, 40, 20).translate(0, 0, 20))
    assert [f.area for f in stack.section(Plane.XY.offset(10)).faces()] == [approx(1600)]
    with pytest.raises(ModelingError, match="split: the part is not a valid solid"):
        m.split(Plane.XZ)  # was KernelError: split failed
    # an insert that touches the part along a line has no cells (a wrong sketch of 370 for 400 before)
    touching = Box(20, 20, 20).merge(Cylinder(3, 10).rotate(X, 90).translate(7, 0, 0))
    with pytest.raises(ModelingError, match="^section: cells: "):
        touching.section(Plane.XY)



# -- review of 0.5.0: mirrors -----------------------------------------------------------------------
def _mirrored_normals_follow(body, plane) -> float:
    """The largest difference between the mirror of each face's normal and the normal of its image."""
    from smlibpy.shapes import _reflection

    m = _reflection(plane)
    mirrored = body.mirror(plane)
    worst = 0.0
    for f in body.faces():
        p = f.interior_point()
        image = Vector(*(m[:3, :3] @ np.array(p.to_tuple()) + m[:3, 3]))
        g = min(mirrored.faces(), key=lambda g: g.distance_to(image))
        want = Vector(*(m[:3, :3] @ np.array(f.normal_at(p).to_tuple())))
        worst = max(worst, (g.normal_at(image) - want).length)
    return worst


@pytest.mark.parametrize("plane", [Plane.YZ, Plane.XZ, Plane.XY], ids=["YZ", "XZ", "XY"])
def test_mirrored_bodies_keep_the_sides_of_their_faces(plane):
    # SmBrep::Mirror turned every surface over; the faces with both sides inside (cavity walls, faces
    # between cells) or outside (sheets) came out inside out for meshes, normal_at and convexity:
    # (Box(20) - Box(10)).mirror(Plane.YZ) meshed to 9000 for 7000 and its cavity edges read convex.
    cavity = Box(20, 20, 20) - Box(10, 10, 10)
    m = cavity.mirror(plane)
    assert m.volume == pytest.approx(7000) and m.mesh(0.01).volume == pytest.approx(7000)
    assert len(m.edges().concave()) == 12 and m.check() == [] and m.is_valid()
    ball = (Box(20, 20, 20) - Sphere(5)).mirror(plane)
    assert ball.mesh(0.01).volume == pytest.approx((Box(20, 20, 20) - Sphere(5)).mesh(0.01).volume, rel=1e-9)
    dome = Sphere(10) & Box(40, 40, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    sheet = stitch(dome.faces().filter_by(lambda f: f.geom_type == "sphere"))
    for body in (cavity, Box(20, 20, 20) - Sphere(5), merge(Box(20, 20, 20), Cylinder(4, 30)), sheet,
                 Rectangle(10, 10).translate(3, 0, 0)):
        assert _mirrored_normals_follow(body, plane) < 1e-9
    # mirror twice: the body again
    twice = cavity.mirror(plane).mirror(plane)
    assert twice.mesh(0.01).volume == pytest.approx(7000) and len(twice.edges().concave()) == 12


def test_mirrored_parts_shell_round_and_chamfer_as_the_part_does():
    # The offset code builds a cavity from the surfaces: a mirrored part shelled with its cavity
    # inside out (Box(60, 40, 20).mirror(Plane.YZ).shell(2) meshed to 80256 for 15744), and the
    # opening of a rounded box could not be cut (O3); mirrored circles were B-splines, so a chamfer of
    # a mirrored pin was the kernel's fitted bevel (30.8287005, 1.1e-5 off).
    box = Box(60, 40, 20)
    assert box.mirror(Plane.YZ).shell(2).mesh(0.01).volume == pytest.approx(15744)
    rounded = box.fillet(box.edges(), 5)
    m = rounded.mirror(Plane.YZ)
    assert m.shell(2, m.faces().top()).volume == pytest.approx(rounded.shell(2, rounded.faces().top()).volume, rel=1e-9)
    pin = Cylinder(2, 5).mirror(Plane.YZ)
    assert len(pin.edges().circles()) == 2
    assert pin.chamfer(pin.edges(), 1.94).volume == pytest.approx(Cylinder(2, 5).chamfer(Cylinder(2, 5).edges(), 1.94).volume,
                                                                  rel=1e-12)
    assert sorted(e.geom_type for e in Box(1, 2, 3).mirror(Plane.XZ).edges()) == ["line"] * 12


def _bumped_cylinder_sheet(bump: float):
    """A rational degree-(2, 1) cylinder sheet of radius 5 and height 10 whose control point in the
    middle of its first quarter is pushed out by ``bump`` (in its top and bottom row)."""
    w = math.sqrt(0.5)
    circle = [(5, 0), (5, 5), (0, 5), (-5, 5), (-5, 0), (-5, -5), (0, -5), (5, -5), (5, 0)]
    scale = 1 + bump / (5 * math.sqrt(2))
    rows = [[(x * scale, y * scale, z) if i == 1 else (x, y, z) for z in (0, 10)] for i, (x, y) in enumerate(circle)]
    weights = [[1 if i % 2 == 0 else w] * 2 for i in range(9)]
    return nurbs_surface(rows, knots=([0, 0, 0, .25, .25, .5, .5, .75, .75, 1, 1, 1], [0, 0, 1, 1]), degrees=(2, 1),
                         weights=weights)


def test_bumped_cylinder_sheets_stay_bumped(tmp_path):
    # The kernel's test for a cone or cylinder samples the sheet at fixed parameters only, and a bump
    # between them passed: scaling it (T6's recognition), saving it as .smb, to_shell() and every
    # copy that adds analytic surfaces turned it into the plain cylinder (area 314.16 for 316.27).
    sheet = _bumped_cylinder_sheet(0.5)
    area = sheet.area
    assert sheet.faces()[0].geom_type == "bspline" and area == pytest.approx(316.2716, rel=1e-5)
    stretched = sheet.scale((1, 1, 2))
    assert stretched.faces()[0].geom_type == "bspline" and stretched.area == pytest.approx(632.543, rel=1e-5)
    assert sheet.scale((1, 1, 1.0001)).faces()[0].geom_type == "bspline"
    save(sheet, tmp_path / "bump.smb")
    back = load(tmp_path / "bump.smb")
    assert back.faces()[0].geom_type == "bspline" and back.area == pytest.approx(area, rel=1e-9)
    assert sheet.faces()[0].to_shell().area == pytest.approx(area, rel=1e-9)
    # a sheet that is the cylinder is still recognized
    plain = _bumped_cylinder_sheet(0.0)
    assert plain.scale((1, 1, 2)).faces()[0].geom_type == "cylinder"
    assert plain.faces()[0].to_shell().faces()[0].geom_type == "cylinder"
