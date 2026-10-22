"""Measuring and analysis, and per-bend K-factors (kernel plan items A2-A7, D1).

A2: the nearest points of two shapes (with their faces), distances to edges, wires and faces, and
closest points and parameters on faces, edges and wires. A3: curvature, smallest radius,
parameters, NURBS data and iso-parametric curves of faces; major radius and cone angle. A4: the
continuity of the faces at an edge and of the edges of a wire, G1/G2 selectors, convexity along the
whole edge. A5: section properties of sketches. A6: inertia about a point or an axis, radii of
gyration. A7: a face the integration cannot converge on raises instead of running for minutes.
D1: K-factors per bend: as folded, by rule, by table. D2: deformations keep analytic faces where
the exact image is a plane, cylinder or cone (a bent plate is sheet metal). D3: unroll, and
unfolding rolled parts, bends at a free end and bends over 180 degrees. D4: part.volume of
deformed parts.
"""

import math
import time

import numpy as np
import pytest
from pytest import approx

from smlibpy import *
from smlibpy._kernel import KernelError, ext
from smlibpy.sheetmetal import bends, din6935
from smlibpy.shapes import Part


# -- A6: inertia about a point or an axis --------------------------------------------------------
def test_inertia_about_a_corner_and_an_axis():
    a, b, c = 10.0, 20.0, 30.0
    mp = Box(a, b, c).mass_properties(density=2.0)
    m = 2.0 * a * b * c
    corner = (a / 2, b / 2, c / 2)
    i = mp.inertia_about(corner)
    assert i[0][0] == approx(m * (b * b + c * c) / 3, rel=1e-9)
    assert i[2][2] == approx(m * (a * a + b * b) / 3, rel=1e-9)
    assert i[0][1] == approx(-m * a * b / 4, rel=1e-9)  # the product of inertia, negated
    assert np.allclose(mp.inertia_about(mp.center), mp.inertia, rtol=0, atol=1e-6 * abs(mp.inertia).max())
    # an edge of the box as the axis: m (a^2 + b^2) / 3; any point of the axis gives the same
    assert mp.moment_about(Axis(corner, (0, 0, 1))) == approx(m * (a * a + b * b) / 3, rel=1e-9)
    assert mp.moment_about(Axis((a / 2, b / 2, -100), (0, 0, -1))) == approx(m * (a * a + b * b) / 3, rel=1e-9)
    assert mp.moment_about(Axis((0, 0, 0), (1, 1, 0))) == approx(
        (mp.inertia[0][0] + mp.inertia[1][1] + 2 * mp.inertia[0][1]) / 2, rel=1e-9)
    with pytest.raises(TypeError, match="Axis"):
        mp.moment_about((0, 0, 1))


def test_radii_of_gyration():
    mp = Cylinder(10, 100).mass_properties(density=7.85e-3)
    k = mp.radii_of_gyration
    assert k[0] == approx(10 / math.sqrt(2), rel=1e-9)  # about the axis: r / sqrt(2)
    assert k[1] == approx(math.sqrt((3 * 10**2 + 100**2) / 12), rel=1e-9)
    assert k == approx(tuple(math.sqrt(x / mp.mass) for x in mp.principal_moments), rel=1e-15)


# -- A5: section properties ----------------------------------------------------------------------
def test_section_properties_of_a_rectangle_and_a_plate_with_a_hole():
    sp = Rectangle(40, 20).section_properties()
    assert sp.area == approx(800, rel=1e-12)
    assert sp.ixx == approx(40 * 20**3 / 12, rel=1e-9)
    assert sp.iyy == approx(20 * 40**3 / 12, rel=1e-9)
    assert abs(sp.ixy) <= 1e-9 * sp.iyy
    assert sp.polar == approx(sp.ixx + sp.iyy)
    assert sp.section_moduli == approx((40 * 20**2 / 6, 20 * 40**2 / 6), rel=1e-9)
    assert sp.radii_of_gyration == approx((20 / math.sqrt(12), 40 / math.sqrt(12)), rel=1e-9)
    assert sp.principal_moments == approx((sp.ixx, sp.iyy), rel=1e-9)
    assert abs(sp.principal_axes[0].dot(X.direction)) == approx(1, abs=1e-9)
    # with a hole, on a plane of its own: the sketch plane's axes
    plane = Plane((5, 6, 7), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
    sp = (Rectangle(40, 20) - Circle(5)).on(plane).section_properties()
    assert sp.area == approx(800 - 25 * math.pi, rel=1e-10)
    assert sp.ixx == approx(40 * 20**3 / 12 - math.pi * 5**4 / 4, rel=1e-9)
    assert sp.iyy == approx(20 * 40**3 / 12 - math.pi * 5**4 / 4, rel=1e-9)
    assert (sp.centroid - Vector(5, 6, 7)).length <= 1e-9
    assert sp.plane.x_dir.is_close(Vector(0, 1, 0)) and sp.plane.z_dir.is_close(Vector(1, 0, 0))


def test_section_properties_of_an_angle():
    """An L of two legs 30 x 5 and 5 x 40 (the corner square counted once): the textbook sums."""
    sp = (Rectangle(30, 5, align=(Align.MIN, Align.MIN)) + Rectangle(5, 40, align=(Align.MIN, Align.MIN))).section_properties()
    parts = [(30 * 5, 15, 2.5, 30, 5), (5 * 35, 2.5, 22.5, 5, 35)]  # area, cx, cy, width, height
    area = sum(p[0] for p in parts)
    cx = sum(p[0] * p[1] for p in parts) / area
    cy = sum(p[0] * p[2] for p in parts) / area
    ixx = sum(w * h**3 / 12 + a * (y - cy) ** 2 for a, x, y, w, h in parts)
    iyy = sum(h * w**3 / 12 + a * (x - cx) ** 2 for a, x, y, w, h in parts)
    ixy = sum(a * (x - cx) * (y - cy) for a, x, y, w, h in parts)
    assert sp.area == approx(area, rel=1e-12)
    assert (sp.centroid - Vector(cx, cy, 0)).length <= 1e-9
    assert (sp.ixx, sp.iyy, sp.ixy) == approx((ixx, iyy, ixy), rel=1e-9)
    lo, hi = sp.principal_moments
    assert lo + hi == approx(ixx + iyy, rel=1e-12) and lo * hi == approx(ixx * iyy - ixy**2, rel=1e-9)
    u, v = sp.principal_axes
    t = np.array([[sp.ixx, -sp.ixy], [-sp.ixy, sp.iyy]])
    assert np.array([u.x, u.y]) @ t @ np.array([u.x, u.y]) == approx(lo, rel=1e-9)
    assert u.dot(v) == approx(0, abs=1e-12)
    # the farthest fibers: y from the centroid to 40, x to 30
    assert sp.section_moduli == approx((ixx / (40 - cy), iyy / (30 - cx)), rel=1e-9)
    with pytest.raises(ValueError, match="empty"):
        (Rectangle(10, 10) - Rectangle(20, 20)).section_properties()


# -- A2: closest points --------------------------------------------------------------------------
def test_closest_points_of_two_bodies_with_their_faces():
    a, b = Box(10, 10, 10), Sphere(3).translate(20, 0, 0)
    cp = a.closest_points(b)
    assert cp.distance == approx(12.0, abs=1e-12) == a.distance_to(b)
    assert (cp.point - Vector(5, 0, 0)).length <= 1e-9 and (cp.other_point - Vector(17, 0, 0)).length <= 1e-9
    assert cp.face.geom_type == "plane" and cp.face.normal_at().is_close(Vector(1, 0, 0))
    assert cp.other_face.geom_type == "sphere" and cp.other_face.owner is b
    back = b.closest_points(a)
    assert (back.point - cp.other_point).length <= 1e-9 and back.face.owner is b
    # nearly parallel cylinders (A1): the points lie on both surfaces, 2 apart
    c, d = Cylinder(5, 200), Cylinder(5, 200).rotate(X, 5).translate(12, 0, 0)
    cp = c.closest_points(d)
    assert cp.distance == approx(2.0, abs=1e-9)
    assert c.distance_to(cp.point) <= 1e-9 and d.distance_to(cp.other_point) <= 1e-9
    assert (cp.point - cp.other_point).length == approx(cp.distance, abs=1e-12)


def test_distances_to_edges_wires_and_faces():
    box = Box(10, 10, 10)
    line = Line((20, -50, 3), (20, 50, 3))
    cp = box.closest_points(line)
    assert cp.distance == approx(15.0, abs=1e-12) and cp.other_face is None
    assert cp.point.x == approx(5) and cp.other_point.x == approx(20) and cp.face.normal_at().is_close(Vector(1, 0, 0))
    assert box.distance_to(line) == line.distance_to(box) == approx(15.0)
    assert box.distance_to(Line((0, 0, -20), (0, 0, 20))) == 0.0  # through the box
    # a line beside a cylinder: the nearest point is inside the line, on the round face
    rod = Cylinder(5, 20)
    cp = rod.closest_points(Line((-50, 10, 5), (50, 10, 5)))
    assert cp.distance == approx(5.0, abs=1e-12) and cp.face.geom_type == "cylinder"
    assert (cp.point - Vector(0, 5, 5)).length <= 1e-9
    # a wire around a corner, and a helix around a ball
    w = Polyline((20, 0, 20), (20, 0, -20), (-20, 0, -20))
    assert box.distance_to(w) == approx(15.0) and w.distance_to(box) == approx(15.0)
    helix, ball5 = Helix(2, 30, 8).translate(0, 0, -15), Sphere(5)
    brute = min(ball5.distance_to(helix.point_at(i / 300)) for i in range(301))
    d = ball5.distance_to(helix)
    assert d == approx(3.0, abs=1e-5) and d <= brute + 1e-12  # (the helix is a fitted B-spline)
    # a face: the nearest point of a plate's top face lies on the rim of its hole
    top = (Box(40, 30, 20) - Cylinder(6, 30)).faces().top()[0]
    ball = Sphere(2).translate(0, 0, 30)
    cp = ball.closest_points(top)
    assert cp.distance == approx(math.hypot(6, 20) - 2, rel=1e-12) and cp.other_face is top
    assert top.distance_to(ball) == approx(cp.distance)
    assert math.hypot(cp.other_point.x, cp.other_point.y) == approx(6) and cp.other_point.z == approx(10)


def test_closest_points_and_parameters_on_faces_edges_and_wires():
    part = Box(40, 30, 20) - Cylinder(6, 30)
    bore = part.faces().cylinders()[0]
    assert (bore.closest_point((0, 0, 0)) - Vector(6, 0, 0)).length <= 1e-12
    top = part.faces().top()[0]
    assert (top.closest_point((0, 0, 20)) - Vector(6, 0, 10)).length <= 1e-12  # (the hole is not part of the face)
    for p in ((3, 4, 25), (-17, 9, 30), (100, -3, 0)):
        u, v = top.uv_at(p)
        assert 0 <= u <= 1 and 0 <= v <= 1
        assert (top.position_at(u, v) - top.closest_point(p)).length <= 1e-9
    u, v = bore.uv_at((0, 6, 3))
    assert (bore.position_at(u, v) - Vector(0, 6, 3)).length <= 1e-9
    circle = part.edges().circles()[0]
    assert (circle.closest_point((0, 0, 0)) - Vector(6, 0, circle.start.z)).length <= 1e-12
    for t in (0.0, 0.3, 0.77):
        assert circle.param_at_point(circle.point_at(t)) == approx(t, abs=1e-9)
    spline = Spline((0, 0, 0), (10, 5, 0), (20, 0, 0), (30, -5, 0))
    for t in (0.1, 0.5, 0.77):
        assert spline.param_at_point(spline.point_at(t) + Vector(0, 0, 1)) == approx(t, abs=1e-9)
        assert spline.reversed().param_at_point(spline.point_at(t)) == approx(1 - t, abs=1e-9)
    line = Line((0, 0, 0), (10, 0, 0))
    assert line.param_at_point((3, 5, 0)) == approx(0.3) and line.reversed().param_at_point((3, 5, 0)) == approx(0.7)
    assert line.param_at_point((-5, 1, 0)) == 0.0 and line.param_at_point((50, 1, 0)) == 1.0
    w = Wire([Line((0, 0, 0), (10, 0, 0)), Line((10, 0, 0), (10, 10, 0))])
    assert (w.closest_point((12, 5, 3)) - Vector(10, 5, 0)).length <= 1e-12


# -- A3: curvature and surface access ------------------------------------------------------------
def test_curvature_of_analytic_faces():
    ball = Sphere(10).faces()[0]
    for p in ((20, 0, 0), (0, 0, 20), (3, -4, 5)):  # also at a pole
        c = ball.curvature_at(p)
        assert c.k1 == approx(0.1, rel=1e-12) and c.k2 == approx(0.1, rel=1e-12)
        assert c.mean == approx(0.1) and c.gaussian == approx(0.01)
        assert c.normal.is_close(Vector(*p).normalized(), 1e-9)
        assert abs(c.dir1.dot(c.normal)) <= 1e-9 and abs(c.dir2.dot(c.normal)) <= 1e-9
    side = Cylinder(5, 20).faces().cylinders()[0]
    c = side.curvature_at((10, 0, 3))
    assert (c.k1, c.k2) == approx((0.2, 0.0), abs=1e-12)
    assert abs(c.dir1.dot(Z.direction)) <= 1e-12 and abs(c.dir2.dot(Z.direction)) == approx(1)  # around, along
    assert c.point.is_close(Vector(5, 0, 3)) and c.normal.is_close(Vector(1, 0, 0))
    bore = (Box(40, 30, 20) - Cylinder(6, 30)).faces().cylinders()[0].curvature_at()
    assert (bore.k1, bore.k2) == approx((0.0, -1 / 6), abs=1e-12)
    torus = Torus(20, 5).faces()[0]
    outer, inner = torus.curvature_at((30, 0, 0)), torus.curvature_at((0, 10, 0))
    assert (outer.k1, outer.k2) == approx((0.2, 1 / 25), rel=1e-12)
    assert (inner.k1, inner.k2) == approx((0.2, -1 / 15), rel=1e-12)
    assert torus.radius == 5 and torus.major_radius == 20
    cone = Cone(10, 4, 20).faces().filter_by(lambda f: f.geom_type == "cone")[0]
    assert cone.cone_angle == approx(math.degrees(math.atan(6 / 20)), rel=1e-12)
    with pytest.raises(ValueError, match="major radius"):
        side.major_radius
    with pytest.raises(ValueError, match="cone angle"):
        side.cone_angle


def test_min_radius():
    assert Box(1, 1, 1).faces()[0].min_radius() == math.inf
    assert Cylinder(5, 20).faces().cylinders()[0].min_radius() == 5
    assert Sphere(10).faces()[0].min_radius() == 10
    assert Torus(20, 5).faces()[0].min_radius() == approx(5, rel=1e-12)
    assert Torus(6, 5).faces()[0].min_radius() == approx(1, rel=1e-9)  # the inner equator: R - r
    cone = Cone(10, 4, 20).faces().filter_by(lambda f: f.geom_type == "cone")[0]
    assert cone.min_radius() == approx(4 / math.cos(math.atan(6 / 20)), rel=1e-9)
    # a free-form face: no sample of a fine net is sharper
    pts = [[(x, y, 3 * math.sin(x / 7) * math.cos(y / 9)) for y in np.linspace(0, 60, 12)] for x in np.linspace(0, 60, 12)]
    face = surface(pts).faces()[0]
    r = face.min_radius()
    sampled = min(1 / max(abs(c.k1), abs(c.k2)) for c in
                  (face.curvature_at(face.position_at(u, v)) for u in np.linspace(0, 1, 41) for v in np.linspace(0, 1, 41)))
    assert sampled * 0.95 <= r <= sampled * (1 + 1e-9)


def _nurbs_point(n, u, v):
    """A point of a NURBS surface (Cox-de Boor), to check the layout of Face.nurbs()."""
    def basis(knots, p, t):
        last = t >= knots[-1]
        b = [1.0 if (knots[i] <= t < knots[i + 1]) or (last and knots[i] < knots[i + 1] == knots[-1]) else 0.0
             for i in range(len(knots) - 1)]
        for d in range(1, p + 1):
            b = [((t - knots[i]) / (knots[i + d] - knots[i]) * b[i] if knots[i + d] > knots[i] else 0.0)
                 + ((knots[i + d + 1] - t) / (knots[i + d + 1] - knots[i + 1]) * b[i + 1]
                    if knots[i + d + 1] > knots[i + 1] else 0.0) for i in range(len(knots) - d - 1)]
        return b
    bu, bv = basis(n.knots[0], n.degrees[0], u), basis(n.knots[1], n.degrees[1], v)
    s, w = np.zeros(3), 0.0
    for i, a in enumerate(bu):
        for j, b in enumerate(bv):
            wt = 1.0 if n.weights is None else n.weights[i][j]
            s += a * b * wt * np.array(n.points[i][j].to_tuple())
            w += a * b * wt
    return Vector(*(s / w))


@pytest.mark.parametrize("make", [
    lambda: Box(10, 20, 30).faces()[2],
    lambda: Cylinder(5, 20).faces().cylinders()[0],
    lambda: Torus(20, 5).faces()[0],
    lambda: Cone(10, 4, 20).faces().filter_by(lambda f: f.geom_type == "cone")[0],
    lambda: Sphere(7).faces()[0],
], ids=["plane", "cylinder", "torus", "cone", "sphere"])
def test_nurbs_of_faces(make):
    face = make()
    n = face.nurbs()
    nu, nv = len(n.knots[0]) - n.degrees[0] - 1, len(n.knots[1]) - n.degrees[1] - 1
    assert len(n.points) == nu and all(len(row) == nv for row in n.points)
    (u0, v0), (u1, v1) = face._f.uv_domain()
    for a, b in ((0.3, 0.6), (0.5, 0.5), (0.9, 0.1)):
        u, v = u0 + (u1 - u0) * a, v0 + (v1 - v0) * b
        assert (_nurbs_point(n, u, v) - face.position_at(a, b)).length <= 1e-9


def test_isocurves():
    plate = (Box(40, 30, 5) - Cylinder(5, 10)).faces().top()[0]
    pieces = plate.isocurve(u=0.5)  # across the hole: two pieces, exactly to its rim
    ends = sorted(abs(round(c, 12)) for e in pieces for c in (e.start.x + e.start.y, e.end.x + e.end.y))
    assert len(pieces) == 2 and ends == [5, 5, 15, 15]
    assert all(e.geom_type == "line" for e in pieces) and sum(e.length for e in pieces) == approx(20, rel=1e-12)
    across = plate.isocurve(v=0.9)
    assert len(across) == 1 and across[0].length == approx(40 if plate.position_at(0, 0).x != plate.position_at(1, 0).x
                                                              else 30, rel=1e-12)
    assert len(plate.isocurve(u=0.0)) == 1  # along the boundary
    side = Cylinder(5, 20).faces().cylinders()[0]
    ring = side.isocurve(v=0.5)
    assert len(ring) == 1 and ring[0].geom_type == "circle" and ring[0].length == approx(10 * math.pi, rel=1e-12)
    assert side.isocurve(u=0.25)[0].length == approx(20, rel=1e-12)
    for bad in ({}, {"u": 0.5, "v": 0.5}):
        with pytest.raises(ValueError, match="one of u and v"):
            plate.isocurve(**bad)
    with pytest.raises(ValueError, match="from 0 to 1"):
        plate.isocurve(u=1.5)


def test_curvature_of_edges():
    assert CenterArc((0, 0, 0), 7, 0, 90).curvature_at(0.3) == approx(1 / 7, rel=1e-12)
    assert Line((0, 0, 0), (1, 2, 3)).curvature_at() == 0
    e = Ellipse(10, 4).edges()[0]  # at the end of the major axis: a / b^2
    assert max(e.curvature_at(t / 400) for t in range(401)) == approx(10 / 16, rel=1e-4)


# -- A4: continuity ------------------------------------------------------------------------------
def test_continuity_of_fillet_borders():
    box = Box(30, 30, 30)
    edge = box.edges().filter_by(Z).sort_by(X)[-1]
    round_, blend = box.fillet(edge, 5), box.fillet(edge, 5, continuity="G2")
    borders = round_.edges().g1()
    assert len(borders) == 2 and len(round_.edges().g2()) == 0
    for e in borders:
        c = e.continuity()
        assert c.level == "G1" and c.angle <= 1e-9 and c.curvature_jump == approx(0.2, rel=1e-9) and c.gap <= 1e-9
    assert len(blend.edges().g2()) == 2 and len(blend.edges().g1()) == 2
    for e in blend.edges().g2():
        assert e.continuity().curvature_jump <= 1e-6
    crease = box.edges()[0].continuity()
    assert crease.level == "G0" and crease.angle == approx(90)
    seam = Cylinder(5, 10).edges(seams=True).filter(lambda e: e.is_seam)[0].continuity()
    assert seam.level == "G2" and seam.angle <= 1e-9
    # other tolerances, by keyword
    assert borders[0].continuity(angle_tol=1e-12).level == "G1"
    assert borders[0].continuity(curvature_tol=10).level == "G2"
    with pytest.raises(ValueError, match="free curve"):
        Line((0, 0, 0), (1, 0, 0)).continuity()
    with pytest.raises(ValueError, match="between two faces"):
        Rectangle(10, 10).edges()[0].continuity()


def _twist(x, y):
    """A top that is flat for x <= 10 and beyond turns about the line y = 5: its slope across
    x = 10 runs from -0.25 through 0 (at y = 5) to +0.25."""
    return (y - 5) * 0.05 * (x - 10) if x > 10 else 0.0


def _crease_through_tangency(solid: bool):
    """Two faces along x = 10 whose angle runs from -14 through 0 (at y = 5) to +14 degrees: a sheet,
    or a solid closed by planar sides and bottom."""
    ys = np.linspace(0, 10, 5)
    flat = surface([[(x, y, 0.0) for y in ys] for x in np.linspace(0, 10, 5)])
    twisted = surface([[(x, y, _twist(x, y)) for y in ys] for x in np.linspace(10, 20, 5)])
    if not solid:
        return stitch(flat, twisted)
    sides = [Polyline((0, 0, -5), (20, 0, -5), (20, 0, _twist(20, 0)), (10, 0, 0), (0, 0, 0)),
             Polyline((0, 10, -5), (20, 10, -5), (20, 10, _twist(20, 10)), (10, 10, 0), (0, 10, 0)),
             Polyline((20, 0, -5), (20, 10, -5), (20, 10, _twist(20, 10)), (20, 0, _twist(20, 0))),
             Polyline((0, 0, -5), (0, 10, -5), (0, 10, 0), (0, 0, 0)),
             Polyline((0, 0, -5), (20, 0, -5), (20, 10, -5), (0, 10, -5))]
    return stitch(flat, twisted, *(w.close().to_sketch() for w in sides))


def test_convexity_looks_along_the_whole_edge():
    sheet = _crease_through_tangency(False)
    edge = [e for e in sheet.edges() if len(e.faces()) == 2][0]
    assert edge._probed_convexity(0.5, 1) == "smooth"  # what the middle alone said
    assert edge.convexity in ("convex", "concave")
    c = edge.continuity()
    # (the last of 16 points along the edge: y = 9.6875, a slope of 0.05 * 4.6875 across it)
    assert c.level == "G0" and c.angle == approx(math.degrees(math.atan(0.05 * 4.6875)), rel=1e-6)
    solid = _crease_through_tangency(True)
    assert isinstance(solid, Part) and solid.volume == approx(1000, rel=1e-9)
    inner = [e for e in solid.edges() if abs(e.center().x - 10) < 1e-6 and abs(e.center().z) < 1e-6][0]
    from smlibpy.shapes import _outer_angles
    assert _outer_angles([inner])[0] == approx(180)  # the kernel's angle at the middle: tangent
    assert inner.convexity in ("convex", "concave")  # was "smooth"
    assert inner not in solid.edges().smooth() and inner.continuity().level == "G0"


def test_continuity_of_wires():
    tangent = Wire([Line((0, 0, 0), (10, 0, 0)), CenterArc((10, 5, 0), 5, -90, 90)])
    c = tangent.continuity()
    assert c.level == "G1" and c.curvature_jump == approx(0.2, rel=1e-9) and c.point.is_close(Vector(10, 0, 0))
    corner = Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0)).continuity()
    assert corner.level == "G0" and corner.angle == approx(90)
    assert Wire(Circle(5).edges()).continuity().level == "G2"
    apart = Wire([Line((0, 0, 0), (1, 0, 0)), Line((1, 0.1, 0), (2, 0, 0))], sort=False).continuity()
    assert apart.level is None and apart.gap == approx(0.1)
    with pytest.raises(ValueError, match="no joints"):
        Wire(Line((0, 0, 0), (1, 0, 0))).continuity()


# -- A7: faces the integration cannot converge on ------------------------------------------------
def _crossed_oring(v_start):
    """A torus face built by hand with its window turned half round (v_start), so that the seam
    edge runs across the face: no public operation makes one (the kernel review found it by
    rebuilding an imported O-ring with another window)."""
    faces = [{"surface": {"kind": "torus", "origin": (0, 0, 0), "z": (0, -1, 0), "x": (1, 0, 0), "major": 4.5,
                          "minor": 0.5, "v_start": v_start}, "same_sense": True,
              "loops": [{"edges": [(0, False), (1, True), (0, True), (1, False)]}], "free_seam": False}]
    edges = {0: {"kind": "circle", "center": (4.5, 0, 0), "z": (0, 0, -1), "x": (1, 0, 0), "radius": 0.5,
                 "sweep": 360.0, "v0": 0, "v1": 0},
             1: {"kind": "circle", "center": (0, 0, 0), "z": (0, -1, 0), "x": (1, 0, 0), "radius": 5.0,
                 "sweep": 360.0, "v0": 0, "v1": 0}}
    return Part._wrap(ext.build_brep(faces, edges, True, False, False))


def test_a_face_across_its_seam_raises_instead_of_integrating_for_minutes():
    sound = _crossed_oring(0.0)
    assert sound.volume == approx(2 * math.pi**2 * 4.5 * 0.25, rel=1e-7)
    broken = _crossed_oring(-180.0)
    assert not broken.is_valid()
    t = time.perf_counter()
    with pytest.raises(KernelError, match="crosses the seam of its surface"):
        broken.volume  # ran for more than 4 minutes
    with pytest.raises(KernelError, match="crosses the seam"):
        broken.faces()[0].area
    assert time.perf_counter() - t < 30
    m = ext.brep_measure(broken._brep, 1e-8)
    assert m["exhausted"] == 0 and not m["converged"]
    assert ext.brep_measure(sound._brep, 1e-8)["exhausted"] == -1


# -- D1: K-factors per bend ----------------------------------------------------------------------
def _two_bends():
    blank = Box(200, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    part = fold(blank, Axis((-60, 0, 2), (0, 1, 0)), 90, radius=1, k_factor=0.33)
    return fold(part, Axis((60, 0, 2), (0, 1, 0)), 90, radius=6, k_factor=0.45)


def test_unfold_takes_each_bend_s_own_k_factor():
    part = _two_bends()
    assert [b.k_factor for b in bends(part)] == [0.33, 0.45]
    pattern = flat_pattern(part)  # was 200.314 (0.44 for both)
    assert pattern.size.x == approx(200, abs=1e-6) and pattern.k_factor is None
    assert [b.k_factor for b in pattern.bends] == [0.33, 0.45]
    assert unfold(part).bbox().size.x == approx(200, abs=1e-6)
    # the records move and survive with the part
    assert part.rotate(Z, 30).translate(5, 5, 5).flat_pattern().size.x == approx(200, abs=1e-6)
    assert (part - Cylinder(3, 10).translate(-90, 0, 1)).flat_pattern().size.x == approx(200, abs=1e-6)
    assert part.named("p").flat_pattern().size.x == approx(200, abs=1e-6)
    # an explicit K-factor wins, as before
    assert flat_pattern(part, k_factor=0.44).size.x == approx(200.314, abs=1e-3)
    assert flat_pattern(part, k_factor=0.44).k_factor == 0.44


def test_k_factor_rules():
    part = _two_bends()
    for rule in ({1: 0.33, 6: 0.45}, lambda r, t, a: 0.33 if r < 3 else 0.45, [(0.5, 0.33), (3, 0.45)]):
        assert flat_pattern(part, k_factor=rule).size.x == approx(200, abs=1e-6)
    # DIN 6935: k = 0.65 + 0.5 log10(r / t) (1 from r / t = 5), the neutral fiber at k t / 2
    assert din6935(1, 2) == approx((0.65 + 0.5 * math.log10(0.5)) / 2)
    assert din6935(20, 2) == 0.5
    din = flat_pattern(part, k_factor="din6935")
    assert [b.k_factor for b in din.bends] == approx([din6935(1, 2), din6935(6, 2)])
    expected = 200 + sum(math.pi / 2 * (b.k_factor - k) * 2 for b, k in zip(din.bends, (0.33, 0.45)))
    assert din.size.x == approx(expected, abs=1e-6)
    assert bends(part, k_factor=[(0, 0.3), (1, 0.4)])[0].k_factor == approx(0.35)  # r / t = 0.5: halfway
    with pytest.raises(ValueError, match="no entry for the inside radius 6"):
        flat_pattern(part, k_factor={1: 0.33})
    with pytest.raises(ValueError, match="din6935"):
        flat_pattern(part, k_factor="foo")
    with pytest.raises(ValueError, match="between 0 and 1"):
        flat_pattern(part, k_factor=lambda r, t, a: 2.0)
    with pytest.raises(TypeError, match="k_factor must be"):
        flat_pattern(part, k_factor=object())


def test_flanges_keep_their_k_factor():
    plate = Box(100, 60, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    edge = plate.edges().filter_by(Y).top().sort_by(X)[-1]
    part = flange(plate, edge, 20, radius=2, k_factor=0.3)
    assert part.bends()[0].k_factor == 0.3
    blank = part.flat_pattern().size.x
    assert part.flat_pattern(k_factor=0.44).size.x == approx(blank + math.pi / 2 * (0.44 - 0.3) * 2, abs=1e-6)
    plain = Part._wrap(part._copy_brep())  # a part without the record (imported, say): 0.44
    assert plain.bends()[0].k_factor == 0.44


# -- D2: analytic images of deformations --------------------------------------------------------
def _kinds(shapes) -> dict:
    out: dict = {}
    for s in shapes:
        out[s.geom_type] = out.get(s.geom_type, 0) + 1
    return out


def _deviation(plan, result) -> float:
    from smlibpy import deform as D
    from smlibpy._kernel import k

    return max(k.deform.deviation(plan.shape._brep, result._brep, dict(plan.spec, max_degree=D.MAX_DEGREE), 9).values())


def test_a_bent_plate_has_exact_cylinders_and_circles():
    from smlibpy import deform as D

    plate = Box(200, 40, 10)
    bent = plate.bend(90, radius=25)
    assert bent.is_valid()
    assert _kinds(bent.faces()) == {"plane": 12, "cylinder": 2}
    assert _kinds(bent.edges()) == {"line": 24, "circle": 4}
    cyl = bent.faces().cylinders()
    assert sorted(round(f.radius, 9) for f in cyl) == [20, 30]
    for f in cyl:  # about the bend axis: 25 above the plate's middle, at the bend's start
        assert f.axis.direction.is_parallel((0, 1, 0))
        assert Axis((-25 * math.pi / 4, 0, 25), (0, 1, 0)).distance_to(f.axis.origin) < 1e-9
    assert sorted(round(e.radius, 9) for e in bent.edges().circles()) == [20, 20, 30, 30]
    assert bent.volume == approx(80000, rel=1e-12)  # bent about its middle layer: the volume stays
    plan = D._plan_bend(plate, 90.0, 25, Plane.XZ, None, None, 1e-6)
    assert _deviation(plan, bent) < 1e-9


def test_a_bent_plate_is_sheet_metal():
    bent = Box(200, 40, 10).bend(90, radius=25)
    (b,) = bent.bends()
    assert (b.angle, b.radius, b.thickness, b.k_factor) == (90, 20, 10, 0.5)  # its neutral layer: the middle
    flat = bent.unfold()
    assert flat.bbox().size == approx(Vector(200, 40, 10), abs=1e-9)
    assert flat.volume == approx(80000, rel=1e-9)
    assert flat_pattern(bent).size.x == approx(200, abs=1e-9)
    # neutral layer at the bottom, the outside of the bend: K 1, inside radius 25 - 10
    low = Box(200, 40, 10).bend(90, radius=25, plane=Plane((0, 0, -5), (1, 0, 0), (0, -1, 0)))
    (b,) = low.bends()
    assert (b.radius, b.k_factor) == (approx(15), 1.0)
    assert low.unfold().bbox().size.x == approx(200, abs=1e-9)


def test_tapers_make_cones_planes_and_circles():
    cone = Cylinder(10, 50).taper(0.5)
    assert _kinds(cone.faces()) == {"cone": 1, "plane": 2}
    assert _kinds(cone.edges()) == {"circle": 2}
    assert sorted(round(e.radius, 9) for e in cone.edges()) == [5, 10]
    side = cone.faces().filter(lambda f: f.geom_type == "cone")[0]
    assert side.cone_angle == approx(math.degrees(math.atan(5 / 50)), abs=1e-9)
    assert side.axis.direction.is_parallel((0, 0, 1))
    assert cone.volume == approx(math.pi * 50 / 3 * (100 + 50 + 25), rel=1e-10)
    frustum = Box(20, 20, 50).taper(2.0)
    assert _kinds(frustum.faces()) == {"plane": 6} and _kinds(frustum.edges()) == {"line": 12}
    assert frustum.volume == approx(50 / 3 * (400 + 1600 + 800), rel=1e-12)
    # tapered below z = 0, scaled across the axis above it: a cone, then a cylinder of half the radius
    half = Cylinder(10, 50).taper(0.5, end=0)
    assert _kinds(half.faces()) == {"cone": 1, "cylinder": 1, "plane": 2}
    assert [round(f.radius, 9) for f in half.faces().cylinders()] == [5]


def test_twists_keep_turned_faces_and_unmoved_faces():
    bar = Box(20, 20, 100).twist(90)
    assert _kinds(bar.faces()) == {"plane": 2, "bspline": 4}
    rod = Cylinder(10, 100).twist(90)
    assert _kinds(rod.edges()) == {"circle": 2}  # the rims only turn
    block = Box(60, 40, 20)
    lat = Lattice(block, 3)
    lat.move((1, 1, -1), (0, 0, 8))  # the bottom and the sides do not move
    pillow = lat.apply(block)
    assert _kinds(pillow.faces()) == {"plane": 5, "bspline": 1}
    assert pillow.faces().sort_by(Z)[0].center().z == approx(-10, abs=1e-12)


def test_slanted_planes_bend_into_cones_and_holes_stay_fitted():
    b = Box(200, 40, 10)
    chamfered = b.chamfer(b.edges().filter_by(X).filter(lambda e: e.center().z > 0), 3)
    bent = chamfered.bend(90, radius=25)
    assert bent.is_valid()
    assert _kinds(bent.faces()) == {"plane": 16, "cylinder": 2, "cone": 2}
    for f in bent.faces().filter(lambda f: f.geom_type == "cone"):
        assert f.cone_angle == approx(45, abs=1e-9) and f.axis.direction.is_parallel((0, 1, 0))
    holed = (Box(200, 40, 10) - Cylinder(5, 20)).bend(90, radius=25)
    assert holed.is_valid()
    assert _kinds(holed.faces()) == {"plane": 12, "cylinder": 2, "bspline": 1}  # the hole's wall is fitted
    assert holed.volume == approx(80000 - 250 * math.pi, rel=1e-9)


def test_bent_parts_write_cylinders_to_step(tmp_path):
    for name, part in (("bent", Box(200, 40, 10).bend(90, radius=25)),
                       ("folded", fold(Box(200, 40, 10, align=(Align.MIN, Align.CENTER, Align.MIN)),
                                       Axis((100, 0, 10), (0, 1, 0)), 90, radius=20, k_factor=0.5))):
        path = tmp_path / f"{name}.step"
        export_step(part, path)
        text = path.read_text()
        assert text.count("CYLINDRICAL_SURFACE") == 2 and "B_SPLINE_SURFACE" not in text
        back = import_step(path)
        assert _kinds(back.faces()) == {"plane": 12, "cylinder": 2}
        assert back.volume == approx(80000, rel=1e-9)


def test_the_kernel_report_counts_analytic_faces_and_can_leave_them_out():
    from smlibpy import deform as D
    from smlibpy._kernel import k

    plan = D._plan_bend(Box(200, 40, 10), 90.0, 25, Plane.XZ, None, None, 1e-6)
    spec = dict(plan.spec, max_degree=D.MAX_DEGREE)
    brep, report = k.deform.deform_brep(plan.shape._brep, spec)
    assert (report["faces_analytic"], report["edges_analytic"], report["faces_approximated"]) == (4, 12, 0)
    brep, report = k.deform.deform_brep(plan.shape._brep, dict(spec, analytic=False))
    assert (report["faces_analytic"], report["faces_approximated"]) == (0, 4)
    assert _kinds(Part._wrap(brep).faces()) == {"plane": 10, "bspline": 4}


# -- D3: unroll, rolled sheet metal --------------------------------------------------------------
def test_unroll_lays_a_ring_segment_flat():
    ring = Cylinder(52, 40) - Cylinder(50, 50) - Box(60, 60, 50, align=(Align.MIN, Align.MIN, Align.CENTER))
    strip = unroll(ring, radius=51)
    assert strip.is_valid() and _kinds(strip.faces()) == {"plane": 6} and _kinds(strip.edges()) == {"line": 12}
    assert strip.volume == approx(ring.volume, rel=1e-12)  # unrolled at the middle of the thickness
    # every layer is as long as the neutral one: the inside and outside faces 51 * 3 pi / 2 by 40
    big = sorted(f.area for f in strip.faces())[-2:]
    assert big == [approx(51 * 3 * math.pi / 2 * 40, rel=1e-12)] * 2
    seg = (Cylinder(52, 40) - Cylinder(50, 50)) & Box(60, 60, 40, align=(Align.MIN, Align.MIN, Align.CENTER))
    flat = seg.unroll(radius=51, start=(1, 0, 0))  # the line along +X stays
    bb = flat.bbox()
    assert (bb.min.x, bb.max.x) == (approx(50), approx(52))
    assert (bb.min.y, bb.max.y) == (approx(0, abs=1e-9), approx(51 * math.pi / 2))
    outside = seg.unroll(radius=52, start=(1, 0, 0))  # the outside keeps its length, the rest shrinks
    assert outside.volume == approx(seg.volume * 52 / 51, rel=1e-9)


def test_unroll_inverts_bend():
    bar = Box(100, 10, 10)
    bent = bar.bend(90)
    center, direction, _, _ = bent._folds[0]
    straight = bent.unroll(radius=100 / (math.pi / 2), axis=Axis(center, direction))
    assert straight.is_valid() and _kinds(straight.faces()) == {"plane": 6}
    assert straight.volume == approx(10000, rel=1e-12)
    assert sorted(round(f.area, 6) for f in straight.faces()) == [100] * 2 + [1000] * 4


def test_unroll_refuses_what_it_cannot_lay_flat():
    tube = Cylinder(52, 40) - Cylinder(50, 50)
    with pytest.raises(ModelingError, match="all the way around"):
        tube.unroll(radius=51)
    with pytest.raises(ModelingError, match="reaches the axis"):
        Box(10, 10, 10).unroll(radius=5)
    seg = (Cylinder(52, 40) - Cylinder(50, 50)) & Box(60, 60, 40, align=(Align.MIN, Align.MIN, Align.CENTER))
    with pytest.raises(ModelingError, match="opposite start"):
        seg.unroll(radius=51, start=(-1, -1, 0))
    with pytest.raises(ValueError, match="positive"):
        seg.unroll(radius=0)
    with pytest.raises(ValueError, match="across the axis"):
        seg.unroll(radius=51, start=(0, 0, 1))
    slit = Cylinder(30, 50) - Cylinder(29, 60) - Box(4, 40, 60, align=(Align.CENTER, Align.MIN, Align.CENTER))
    assert slit.unroll(radius=30).bbox().size.x == approx(30 * (2 * math.pi - 2 * math.asin(2 / 30)), rel=1e-9)


def test_rolled_parts_unfold():
    seg = (Cylinder(52, 40) - Cylinder(50, 50)) & Box(200, 200, 40, align=(Align.MIN, Align.MIN, Align.CENTER))
    pattern = flat_pattern(seg)
    assert pattern.size == approx(Vector((50 + 0.44 * 2) * math.pi / 2, 40, 2), abs=1e-9)
    assert pattern.outline.area == approx(pattern.size.x * 40, rel=1e-12)
    assert seg.unfold(k_factor=0.5).volume == approx(seg.volume, rel=1e-12)
    ring = (Cylinder(52, 40) - Cylinder(50, 50)) - Box(200, 200, 40, align=(Align.MIN, Align.MIN, Align.CENTER))
    (b,) = ring.bends()
    assert b.angle == approx(270) and b.allowance == approx(3 * math.pi / 2 * 50.88)
    assert flat_pattern(ring).size.x == approx(3 * math.pi / 2 * 50.88, abs=1e-9)
    with pytest.raises(ValueError, match="rolled"):
        unfold(seg, fixed=seg.faces().planar()[0])


def test_a_bend_at_a_free_end_unfolds_with_its_flat_in_place():
    seg = (Cylinder(52, 40) - Cylinder(50, 50)) & Box(200, 200, 40, align=(Align.MIN, Align.MIN, Align.CENTER))
    j = seg + Box(30, 2, 40, align=(Align.MAX, Align.MIN, Align.CENTER)).translate(0, 50, 0)
    flat = j.unfold()
    bb = flat.bbox()
    assert (bb.min.x, bb.max.x) == (approx(-30), approx((50 + 0.44 * 2) * math.pi / 2))
    assert (bb.min.y, bb.max.y) == (approx(50), approx(52))  # the leg stayed where it was
    assert flat_pattern(j).size.x == approx(30 + (50 + 0.44 * 2) * math.pi / 2, abs=1e-9)


def _curl() -> Part:
    ring = (Cylinder(12, 40) - Cylinder(10, 50)).rotate(X, 90).translate(0, 0, 12)
    curl = ring - Box(20, 60, 20, align=(Align.MAX, Align.CENTER, Align.MAX)).translate(0, 0, 12)
    return Box(100, 40, 2, align=(Align.MAX, Align.CENTER, Align.MIN)) + curl  # 270 degrees at x = 0


def test_curls_and_bends_over_180_degrees_unfold():
    curled = _curl()
    (b,) = curled.bends()
    assert b.angle == approx(270)
    flat = curled.unfold()
    bb = flat.bbox()
    assert (bb.min.x, bb.max.x) == (approx(-100), approx(3 * math.pi / 2 * 10.88))
    assert (bb.min.z, bb.max.z) == (approx(0, abs=1e-9), approx(2))  # the plate stayed
    # with flat sheet beyond the bend too: it moves along
    omega = curled + Box(2, 40, 5, align=(Align.MIN, Align.CENTER, Align.MAX)).translate(-12, 0, 12)
    assert omega.unfold().bbox().size.x == approx(105 + 3 * math.pi / 2 * 10.88, abs=1e-9)
    assert omega.unfold(k_factor=0.5).bbox().size.x == approx(105 + 3 * math.pi / 2 * 11, abs=1e-9)
    assert omega.flat_pattern().outline.area == approx((105 + 3 * math.pi / 2 * 10.88) * 40, rel=1e-9)


def test_a_folded_part_with_a_curl_unfolds():
    curled = _curl()
    part = fold(curled, Axis((-50, 0, 2), (0, 1, 0)), 90, radius=2, k_factor=0.4)
    assert len(part.bends()) == 2
    flat = flat_pattern(part)
    assert flat.size.x == approx(100 + 3 * math.pi / 2 * 10.88, abs=1e-6)
    assert sorted(b.k_factor for b in flat.bends) == [0.4, 0.44]


def test_bend_allowance_takes_rolled_angles():
    assert bend_allowance(270, radius=50, thickness=2) == approx(3 * math.pi / 2 * 50.88)
    with pytest.raises(ValueError, match="below 360"):
        bend_allowance(360, radius=50, thickness=2)
    with pytest.raises(ValueError, match="between -180 and 180"):
        fold(Box(100, 40, 2), Axis((0, 0, 1), (0, 1, 0)), 200, radius=2)


# -- D4: volumes of deformed parts ---------------------------------------------------------------
def test_deformed_parts_measure_exactly():
    assert Box(100, 10, 10).bend(90).volume == approx(10000, rel=1e-12)
    assert round(Box(20, 20, 100).twist(90).volume, 3) == 40000.0
