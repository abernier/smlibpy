# Lane S of the kernel plan's phase 1: sweeps along closed 3D paths (S1 regressions), faces without
# area in fused sweeps, and planar paths with mitered corners (S2).
import itertools
import math
import subprocess
import sys
import warnings

import numpy as np
import pytest

from smlibpy import *
from smlibpy._kernel import ext


def _quiet(fn):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        return fn()


def _shells(part):
    return [len(r["shells"]) for r in ext.brep_dump(part._brep, False)["regions"] if not r["infinite"]]


def _sound(part):
    # one solid of one shell, no face without area
    size = part.bbox().diagonal
    return part.is_valid() and _shells(part) == [1] and all(f.area > 1e-9 * size ** 2 for f in part.faces())


# Loops closed with a kink, Spline(*pts, pts[0]), with circles of radius 1.5 (random loops of the
# review's verifier)
KINKED = {
    7: [(17.944, 2.054, -4.26), (11.378, 11.536, -3.851), (0.783, 14.81, -2.957), (-13.078, 10.26, 0.004),
        (-18.112, 0.403, 4.051), (-14.403, -8.994, 6.065), (1.942, -14.738, 2.183), (12.841, -10.458, -1.977)],
    18: [(18.449, 1.62, 4.647), (13.143, 9.57, 5.996), (1.728, 13.479, 4.695), (-13.279, 9.47, 0.061),
         (-18.58, 0.21, -4.092), (-13.895, -8.989, -5.991), (0.142, -13.538, -4.296), (12.938, -9.717, -0.204)],
    27: [(18.562, -0.491, -5.32), (11.818, 14.456, -6.492), (-1.047, 18.712, 3.067), (-12.406, 13.944, 10.092),
         (-18.568, 0.163, 5.617), (-14.198, -12.079, -1.929), (2.395, -18.585, -1.69), (12.304, -14.036, -0.57)],
    4: [(14.698, 0.379, -6.006), (11.217, 7.223, -5.207), (-1.646, 11.098, -2.206), (-11.42, 7.037, 1.914),
        (-14.701, -0.297, 6.12), (-10.685, -7.674, 7.267), (-1.834, -11.081, 3.648), (9.45, -8.558, -2.897)],
}


def test_circles_sweep_along_smoothly_closed_3d_fillet_polylines():
    # The halves of the edges joined into one curve: the kernel could not sweep a circle along most
    # of them (SM_ERR, 49 of 60 random loops that swept before). Swept in one go and closed where
    # the ends meet, as other profiles are.
    for pts, radius, r in [(((0, 0, 0), (30, 0, 0), (30, 30, 10), (0, 30, 0)), 6, 2),
                           (((24.226, 5.277, 4.539), (-3.137, 18.162, 4.837), (-17.105, -0.267, -4.161),
                             (6.641, -22.637, 3.545)), 4, 1.5),
                           (((23.518, 2.391, 4.238), (-5.46, 24.013, 0.691), (-24.229, -2.084, 6.298),
                             (1.397, -19.966, 6.382)), 4, 1.5)]:
        path = FilletPolyline(*pts, radius=radius, close=True)
        tube = _quiet(lambda: sweep(Circle(r), path))
        assert _sound(tube) and tube.volume == pytest.approx(math.pi * r * r * path.length, rel=1e-6)
    path = FilletPolyline((0, 0, 0), (30, 0, 0), (30, 30, 10), (0, 30, 0), radius=6, close=True)
    assert sweep(Circle(2), path).volume == pytest.approx(1410.9417, rel=1e-7)


def test_loops_closed_with_a_kink_sweep_as_before_where_carried_they_fail():
    # Carried along the halves, the fuse where the ends cross failed for these loops (KernelError),
    # which swept before: they go the way they went before then. Each comes out area x length less
    # the overlap of the ends at the kink, a few tenths of a percent.
    for i in (7, 18, 27):
        path = Spline(*KINKED[i], KINKED[i][0])
        tube = _quiet(lambda: sweep(Circle(1.5), path))
        full = math.pi * 1.5 ** 2 * path.length
        assert _sound(tube) and 0.995 * full < tube.volume < full


def test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel():
    # Fused, the halves of these loops crashed the process (SmMerge::ManifoldBoolean marked a Vertex
    # that CloseIntersectionLoop had deleted before it failed; AddressSanitizer: a read of freed
    # memory). They raise now. In a process of its own, so that a crash fails the test, not the run.
    code = """
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
import smlibpy.operations as op
loops = [[(18.547, 0.0, -0.158), (11.564, 23.04, 1.635), (-4.127, 28.73, -3.088), (-16.71, 12.786, 4.037),
          (-16.71, -12.786, -3.752), (-4.127, -28.73, 3.159), (11.564, -23.04, -1.832)],
         [(21.58, 0.0, -2.951), (15.26, 7.405, 0.925), (0.0, 10.473, 2.951), (-15.26, 7.405, -0.925),
          (-21.58, 0.0, -2.951), (-15.26, -7.405, 0.925), (0.0, -10.473, 2.951), (15.26, -7.405, -0.925)]]
for pts in loops:
    path = Spline(*pts, pts[0])
    for former in (False, True):
        try:
            if former:
                sk = op._as_sketch(Circle(2))
                body = op._former_sweep(sk, sk.bbox().center.to_tuple(), op._halves(path), True, False, "")
            else:
                body = sweep(Circle(2), path)
            print("valid" if body.is_valid() else "invalid", flush=True)
        except ModelingError:
            print("ModelingError", flush=True)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, f"exit {run.returncode} after {run.stdout.split()}"
    assert len(run.stdout.split()) == 4 and set(run.stdout.split()) <= {"valid", "ModelingError"}


def test_fused_sweeps_have_no_faces_without_area():
    # The fuse of the halves of a loop closed with a kink left faces of no area where the end caps
    # and both tubes meet at a point (25 of about 100 random loops before), some of them a shell of
    # their own inside the solid, which STEP writes as a void: OpenCASCADE read the plan's loop
    # inside out (-1707.27). They are taken out, or the sweep raises.
    path = Spline(*KINKED[4], KINKED[4][0])
    tube = _quiet(lambda: sweep(Circle(1.5), path))  # (2 such faces before)
    assert _sound(tube) and len(tube.faces()) == 4 and tube.volume == pytest.approx(611.1968, rel=1e-6)
    pts = [(20 * math.cos(a), 20 * math.sin(a), 6 * math.sin(2 * a)) for a in np.arange(8) * math.pi / 4]
    path = Spline(*pts, pts[0])
    try:
        ring = sweep(Circle(2), path)
    except ModelingError as err:
        assert "enclose no area" in str(err) or "fuse failed" in str(err)
    else:
        assert _sound(ring)
    for i, pts in KINKED.items():
        for profile in (Circle(1.5), Rectangle(3, 1.2), Ellipse(1.5, 1)):
            assert _sound(_quiet(lambda: sweep(profile, Spline(*pts, pts[0]))))


def _unit(v):
    return np.array(v, dtype=float) / np.linalg.norm(v)


def _planar_path(normal, turn):
    n = _unit(normal)
    u = _unit(np.cross(n, (1, 0, 0)) if abs(n[0]) < 0.9 else np.cross(n, (0, 1, 0)))
    a = math.radians(turn)
    u = math.cos(a) * u + math.sin(a) * np.cross(n, u)
    v = np.cross(n, u)
    p1 = 40 * u
    p2 = p1 + 30 * v
    return [(0, 0, 0), tuple(p1), tuple(p2), tuple(p2 - 25 * u + 10 * v)]


def _box_center_off_path(part, path, corners):
    # how far the center of the triangle's own box lies from the path, halfway along its first edge:
    # the section there is the triangle, matched to it by its sides
    e = path.edges()[0]
    t = _unit(e.tangent_at(0.5).to_tuple())
    at = np.array(e.point_at(0.5).to_tuple())
    cut = [np.array(tuple(v)) for v in part.section(Plane(tuple(at), z_dir=tuple(t))).vertices()]
    cut = [c for c in cut if np.linalg.norm(c - at) < 8]  # (not where the plane cuts other legs)
    assert len(cut) == 3
    p = np.array(corners, dtype=float)
    center = 0.5 * (p.min(axis=0) + p.max(axis=0))
    weights = np.linalg.solve(np.vstack([p.T, np.ones(3)]), [center[0], center[1], 1.0])
    for order in itertools.permutations(range(3)):
        q = np.array([cut[i] for i in order])
        if all(abs(np.linalg.norm(q[i] - q[j]) - np.linalg.norm(p[i] - p[j])) < 1e-6 for i, j in ((0, 1), (1, 2), (0, 2))):
            return float(np.linalg.norm(weights @ q - at))
    raise AssertionError("the section is not the triangle")


RIGHT = [(0, 0), (6, 0), (0, 3)]
ODD = [(0, 0), (6, 0), (1, 4)]


def test_planar_paths_with_mitered_corners_in_any_plane():
    # The kernel's planar-path sweep frames each edge with the world's Z axis: in a plane that is not
    # horizontal its frames did not meet at the corners, and it returned no closed solid (a path in
    # the YZ plane, a triangle on a path in the XZ plane that turns back, any oblique plane). The
    # path is swept in a frame of its own now.
    for normal in [(1, 0, 0), (0, 1, 0), (1, 1, 1), (1, 2, 0.3), (0.2, 0.1, 1)]:
        for turn in (0, 30):
            pts = _planar_path(normal, turn)
            for path in (Polyline(*pts), FilletPolyline(*pts, radius=5)):
                bar = _quiet(lambda: sweep(Rectangle(6, 2), path))
                assert bar.is_valid() and bar.volume == pytest.approx(12 * path.length, rel=1e-7)
                tri = _quiet(lambda: sweep(Polygon(*ODD), path))
                assert tri.is_valid() and _box_center_off_path(tri, path, ODD) < 1e-6
    frame = sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 40, 0), (0, 40, 40)))
    assert frame.is_valid() and frame.volume == pytest.approx(24 * 80)


def test_planar_paths_place_asymmetric_profiles_by_their_own_box():
    # The kernel moved the profile by the center of its box along the world axes: a triangle turned
    # off them (a path in the XY plane that does not start along X or Y) went beside the path, 0.25
    # for this one at 30 degrees. The path is moved by the difference now: its offset curve (lines
    # and arcs) and along its normal.
    for turn in (30, 45):
        a = math.radians(turn)
        u, v = np.array((math.cos(a), math.sin(a), 0.0)), np.array((-math.sin(a), math.cos(a), 0.0))
        pts = [(0, 0, 0), tuple(40 * u), tuple(40 * u + 30 * v), tuple(15 * u + 40 * v)]
        for path in (Polyline(*pts), FilletPolyline(*pts, radius=4), Polyline(*pts, close=True),
                     FilletPolyline(*pts, radius=4, close=True)):
            body = _quiet(lambda: sweep(Polygon(*ODD), path))
            assert body.is_valid() and _box_center_off_path(body, path, ODD) < 1e-6
    # paths that start along X, Y or Z: as before
    tri = Polygon(*RIGHT)
    body = sweep(tri, Polyline((0, 0, 0), (40, 0, 0), (40, 40, 0)))
    assert body.volume == pytest.approx(729.0)
    assert body.bbox().min.to_tuple() == pytest.approx((0, -1.5, -3), abs=1e-9)
    assert body.bbox().max.to_tuple() == pytest.approx((41.5, 40, 3), abs=1e-9)
    body = sweep(tri, Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)))
    assert body.volume == pytest.approx(738.0)
    assert body.bbox().max.to_tuple() == pytest.approx((40, 1.5, 43), abs=1e-9)
    # a spline among the edges, the profile turned off the axes: by its box along the path's plane
    c, s = math.cos(math.radians(30)), math.sin(math.radians(30))
    wavy = Wire([Line((0, 0, 0), (20 * c, 20 * s, 0)),
                 Spline((20 * c, 20 * s, 0), (30, 25, 0), (50, 30, 0), tangents=((c, s, 0), (1, 0, 0)))])
    with pytest.warns(RuntimeWarning, match="cannot be offset"):
        assert sweep(Polygon(*ODD), wavy).is_valid()


# -- batch 2: the profile's attitude along the path (S3), analytic revolves (S4), planar paths (S6) --

def _cap_long_side(part, point):
    # the direction of the longest edge of the planar face nearest to point (an end cap)
    cap = min((f for f in part.faces() if f.geom_type == "plane"), key=lambda f: f.center().distance_to(point))
    e = max(cap.edges(), key=lambda e: e.length)
    return np.array((e.end - e.start).to_tuple()) / e.length


def _angle_to(v, u, t):
    # the angle (degrees, modulo 180) from u to v about t
    a = math.degrees(math.atan2(np.dot(np.cross(u, v), t), np.dot(u, v)))
    return a % 180.0


def test_a_rectangle_keeps_its_attitude_along_a_helix():
    # ai/todo/features.md 10: the profile rolled about the path by some 30 degrees a turn
    helix = Helix(pitch=5, height=30, radius=10)
    rect = _quiet(lambda: sweep(Rectangle(2, 1), helix))
    assert rect.is_valid()
    assert rect.volume == pytest.approx(2 * helix.length, rel=1e-5)
    for plane in (Plane.YZ, Plane.XZ):
        sections = [f.bbox().size for f in rect.section(plane).faces()]
        whole = [s for s in sections if s.z > 0.75]  # (the ends of the helix cut half a band)
        assert len(whole) >= 6
        for s in whole:
            radial = s.y if plane is Plane.YZ else s.x
            assert radial == pytest.approx(2.0, abs=2e-3)  # was 1.34 to 2.23
            assert s.z == pytest.approx(1.0, abs=5e-3)  # the band cut at its slope: 1.0039 (was 1.25 to 2.22)


def test_the_default_along_a_conical_helix_and_a_chain_of_helices_is_their_axis():
    cone = Helix(5, 30, 10, end_radius=5)
    found = ext.helix_axis([cone._copy_curve()], 1e-5)
    assert found is not None and np.allclose(found[1], (0, 0, 1), atol=1e-7)
    tilted = Helix(5, 30, 10, end_radius=5, direction=(1, 2, 3), center=(4, 5, 6))
    axis = ext.helix_axis([tilted._copy_curve()], 1e-5)
    assert np.allclose(axis[1], np.array((1, 2, 3)) / math.sqrt(14), atol=1e-7)
    assert ext.helix_axis([Spline((0, 0, 0), (10, 5, 3), (20, -5, 7), (30, 0, 9))._copy_curve()], 1e-5) is None
    body = _quiet(lambda: sweep(Rectangle(2, 1), cone))
    assert body.volume == pytest.approx(2 * cone.length, rel=1e-5)
    # at the end (radius 5, the start along +x at radius 10) the long side still points at the axis,
    # as nearly as it can across the path, which runs inwards there (the kernel's frame: 61 degrees off)
    end = cone.point_at(1.0)
    side = _cap_long_side(body, end)
    radial = np.array((end.x, end.y, 0.0)) / math.hypot(end.x, end.y)
    assert abs(np.dot(side, radial)) > math.cos(math.radians(2))


def test_up_keeps_the_profiles_angle_to_a_direction():
    path = Spline((0, 0, 0), (10, 20, 10), (30, 10, 25), (40, 30, 30))
    body = _quiet(lambda: sweep(Rectangle(4, 2), path, up=Z))
    assert body.is_valid()
    assert body.volume == pytest.approx(8 * path.length, rel=1e-5)
    z = np.array((0.0, 0.0, 1.0))
    angles = []
    for t in (0.0, 1.0):
        tangent = np.array(path.tangent_at(t).to_tuple())
        up = z - np.dot(z, tangent) * tangent
        angles.append(_angle_to(_cap_long_side(body, path.point_at(t)), up / np.linalg.norm(up), tangent))
    assert abs(angles[1] - angles[0]) < 1e-3 or abs(abs(angles[1] - angles[0]) - 180) < 1e-3
    # the kernel's own frame (the default here) ends at another angle
    free = sweep(Rectangle(4, 2), path)
    tangent = np.array(path.tangent_at(1.0).to_tuple())
    up = z - np.dot(z, tangent) * tangent
    other = _angle_to(_cap_long_side(free, path.point_at(1.0)), up / np.linalg.norm(up), tangent)
    assert abs(other - angles[0]) > 1.0
    # an axis gives its direction; Sketch.sweep passes them on
    assert Rectangle(4, 2).sweep(path, up=Axis((5, 5, 5), (0, 0, 1))).volume == pytest.approx(body.volume, rel=1e-9)
    frenet = _quiet(lambda: sweep(Rectangle(4, 2), path, up="frenet"))
    assert frenet.is_valid() and frenet.volume == pytest.approx(8 * path.length, rel=1e-5)


def test_twist_turns_the_profile_along_the_path():
    line = Line((0, 0, 0), (0, 0, 100))
    bar = _quiet(lambda: sweep(Rectangle(10, 2), line, twist=180))
    assert bar.is_valid()
    assert bar.volume == pytest.approx(2000, rel=1e-6)  # (two sections, a ruled surface through the axis: 666.7)
    middle = bar.section(Plane.XY.offset(50)).bbox().size
    assert (middle.x, middle.y) == pytest.approx((2, 10), abs=1e-4)  # a quarter turn halfway
    top = bar.section(Plane.XY.offset(100 - 1e-6)).bbox().size
    assert (top.x, top.y) == pytest.approx((10, 2), abs=1e-4)
    # a law: twist(s) degrees at the fraction s of the length
    law = _quiet(lambda: sweep(Rectangle(10, 2), line, twist=lambda s: 90 * s * s))
    a = math.radians(22.5)
    middle = law.section(Plane.XY.offset(50)).bbox().size
    assert middle.x == pytest.approx(10 * math.cos(a) + 2 * math.sin(a), abs=1e-3)
    assert middle.y == pytest.approx(10 * math.sin(a) + 2 * math.cos(a), abs=1e-3)
    # a twisted ribbon: a helicoid, area L * integral of sqrt(1 + (k r)^2) over the width
    ribbon = sweep(Line((-5, 0, 0), (5, 0, 0)), line, twist=180)
    k_ = math.pi / 100
    strip = 2 * (2.5 * math.sqrt(1 + (5 * k_) ** 2) + math.asinh(5 * k_) / (2 * k_))
    assert ribbon.area == pytest.approx(100 * strip, rel=1e-5)  # (500: ruled through the axis)
    # along a fillet polyline (lines and arcs joined into one curve) and a helix
    fp = FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), (40, 40, 40), radius=8)
    assert _quiet(lambda: sweep(Rectangle(4, 2), fp, twist=90)).volume == pytest.approx(8 * fp.length, rel=1e-5)
    helix = Helix(5, 30, 10)
    assert _quiet(lambda: sweep(Rectangle(2, 1), helix, twist=360)).volume == pytest.approx(2 * helix.length, rel=1e-5)


def test_up_and_twist_errors():
    line = Line((0, 0, 0), (0, 0, 50))
    with pytest.raises(ValueError, match="runs along up="):
        sweep(Rectangle(4, 2), line, up=Z)
    with pytest.raises(ValueError, match="runs straight"):
        sweep(Rectangle(4, 2), line, up="frenet")
    with pytest.raises(ValueError, match="orient=True and translational=False"):
        sweep(Rectangle(4, 2), line, twist=10, translational=True)
    with pytest.raises(ValueError, match="'frenet'"):
        sweep(Rectangle(4, 2), line, up="binormal")
    with pytest.raises(TypeError):
        sweep(Rectangle(4, 2), line, twist="a lot")
    with pytest.raises(ValueError, match="sharp_corners=False"):
        sweep(Rectangle(4, 2), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)), twist=10, sharp_corners=True)
    loop = Spline((20, 0, 0), (0, 20, 6), (-20, 0, 0), (0, -20, -6), closed=True)
    with pytest.raises(ValueError, match="come round into itself"):
        sweep(Rectangle(4, 2), loop, twist=90)
    square = _quiet(lambda: sweep(Rectangle(3, 3), loop, twist=90))  # (a square comes round)
    assert square.is_valid() and square.volume == pytest.approx(9 * loop.length, rel=1e-5)


def test_a_chain_of_helices_with_even_turns_is_not_planar():
    # S6: Helix.md's long spring, two pieces of 30 (and of 16) turns each: points sampled along it lie
    # in a plane, so it went to the mitered sweep and raised
    from smlibpy.operations import _is_planar_path

    for turns in (30, 16):
        chain = Wire([Helix(1, turns, 5), Helix(1, turns, 5, center=(0, 0, turns))])
        assert not _is_planar_path(list(chain.edges()))
        spring = _quiet(lambda: sweep(Rectangle(0.6, 0.3), chain))
        assert spring.is_valid()
        assert spring.volume == pytest.approx(0.18 * chain.length, rel=1e-5)  # (60 turns: 336.96, 0.7 % short)
    assert _is_planar_path(list(Polyline((0, 0, 0), (10, 0, 5), (20, 3, 10)).edges()))


def test_planar_paths_whose_corners_cannot_be_mitered_go_piece_by_piece():
    kinked = Wire([ThreePointArc((0, 0, 0), (5, 5, 0), (10, 0, 0)), ThreePointArc((10, 0, 0), (14, 3, 0), (20, 2, 0))])
    with pytest.warns(RuntimeWarning, match="cannot be mitered"):
        body = sweep(Rectangle(2, 1), kinked)
    assert body.is_valid()
    assert body.volume == pytest.approx(sweep(Rectangle(2, 1), kinked, sharp_corners=False).volume, rel=1e-12)
    with pytest.raises(ModelingError):
        sweep(Rectangle(2, 1), kinked, sharp_corners=True)


def test_full_revolves_give_cylinders_cones_spheres_and_tori():
    tube = Polygon((5, 0), (10, 0), (10, 20), (5, 20)).on(Plane.XZ).revolve(Z)
    assert sorted(f.geom_type for f in tube.faces()) == ["cylinder", "cylinder", "plane", "plane"]
    assert sorted(f.radius for f in tube.faces().cylinders()) == pytest.approx([5, 10])
    assert tube.faces().cylinders().first.axis.direction.is_parallel((0, 0, 1))
    assert tube.volume == pytest.approx(math.pi * (100 - 25) * 20, rel=1e-12)
    outer = tube.faces().cylinders().sort_by(lambda f: f.radius)[-1]
    drafted = tube.draft(outer, 3, Plane.XY)
    assert drafted.is_valid() and drafted.volume < tube.volume
    lathe = (Rectangle(5, 20, align=(Align.MIN, Align.MIN)).translate(5, 0).fillet(1)).on(Plane.XZ)
    whole = lathe.revolve(Z)
    assert sorted(f.geom_type for f in whole.faces()) == ["cylinder"] * 2 + ["plane"] * 2 + ["torus"] * 4
    assert {round(f.radius, 9) for f in whole.faces() if f.geom_type == "torus"} == {1.0}
    assert whole.volume == pytest.approx(4 * lathe.revolve(Z, 90).volume, rel=1e-9)
    ball = (Circle(10) & Rectangle(10, 20, align=(Align.MIN, Align.CENTER))).on(Plane.XZ).revolve(Z)
    assert {f.geom_type for f in ball.faces()} == {"sphere"}
    assert ball.volume == pytest.approx(4 / 3 * math.pi * 1000, rel=1e-12)
    cone = Polygon((0, 0), (10, 0), (0, 20)).on(Plane.XZ).revolve(Z)
    assert sorted(f.geom_type for f in cone.faces()) == ["cone", "plane"]
    # part of a turn: arcs give tori (the kernel gives surfaces of revolution), also as holes
    ring = Circle(2).translate(10, 0).on(Plane.XZ).revolve(Z, 90)
    assert sorted(f.geom_type for f in ring.faces()) == ["plane", "plane", "torus"]
    holed = (Rectangle(10, 20, align=(Align.MIN, Align.MIN)) - Circle(1).translate(5, 10)).on(Plane.XZ).revolve(Z, 90)
    assert "revolution" not in {f.geom_type for f in holed.faces()}
    # a spline stays a surface of revolution, which has an axis now
    vase = revolve(Spline((5, 0, 0), (8, 0, 5), (6, 0, 10), (9, 0, 20)), Z)
    assert vase.faces().first.geom_type == "revolution" and vase.faces().first.axis.direction.is_parallel((0, 0, 1))
    sheet = revolve(Line((5, 0, 0), (5, 0, 20)), Z)
    assert [f.geom_type for f in sheet.faces()] == ["cylinder"]
    assert sheet.area == pytest.approx(2 * math.pi * 5 * 20, rel=1e-9)


def test_revolves_within_a_hundredth_of_a_degree_of_a_turn_are_whole(tmp_path):
    section = Polygon((5, 0), (10, 0), (10, 20), (5, 20)).on(Plane.XZ)
    for angle in (359.995, 359.999, 359.9999):  # (raised "not a closed, manifold solid")
        assert section.revolve(Z, angle).volume == pytest.approx(math.pi * 75 * 20, rel=1e-12)
    assert section.revolve(Z, 359.99).volume < math.pi * 75 * 20
    # STEP writes the cylinders as cylinders
    path = tmp_path / "tube.step"
    export_step(section.revolve(Z), path)
    text = path.read_text()
    assert text.count("CYLINDRICAL_SURFACE") == 2 and "B_SPLINE_SURFACE" not in text
    back = import_step(path)
    assert sorted(f.geom_type for f in back.faces()) == ["cylinder", "cylinder", "plane", "plane"]
