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
            with warnings.catch_warnings():
                # (where the halves turned to meet where the loop closes do not fuse, the kernel's frame
                # sweeps them, with a warning: the ellipse along loop 18)
                warnings.simplefilter("error")
                warnings.filterwarnings("ignore", message=".*meet itself where the loop closes", category=RuntimeWarning)
                assert _sound(sweep(profile, Spline(*pts, pts[0])))


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
    # a spline among the edges, the profile turned off the axes: on its own box too (the kernel is given
    # the anchor; before, the path's spline could not be offset and the profile sat by its box along
    # the path's plane, with a warning)
    c, s = math.cos(math.radians(30)), math.sin(math.radians(30))
    wavy = Wire([Line((0, 0, 0), (20 * c, 20 * s, 0)),
                 Spline((20 * c, 20 * s, 0), (30, 25, 0), (50, 30, 0), tangents=((c, s, 0), (1, 0, 0)))])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        body = sweep(Polygon(*ODD), wavy)
    assert body.is_valid() and _box_center_off_path(body, wavy, ODD) < 1e-6


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


# -- batch 3: scale laws (S7), lines and arcs (S8), tapers (S9), loft ends (S10), curve copies (S11) ----
def _kinds(body):
    return sorted(f.geom_type for f in body.faces())


def _radius_at(part, z):
    return math.sqrt(part.section(Plane((0, 0, z))).area / math.pi)


def test_sweeps_scale_the_profile_along_the_path():
    cone = sweep(Circle(2), Line((0, 0, 0), (0, 0, 50)), scale=(1, 2))
    assert cone.is_valid()
    assert cone.volume == pytest.approx(math.pi * 50 * (4 + 8 + 16) / 3, rel=1e-7)
    assert _radius_at(cone, 25) == pytest.approx(3, rel=1e-4)
    assert _radius_at(cone, 49) == pytest.approx(3.96, rel=1e-4)
    # a function of the fraction of the length, about the profile's anchor
    bar = Rectangle(4, 2).sweep(Line((0, 0, 0), (0, 0, 30)), scale=lambda t: 1 + t)
    assert bar.volume == pytest.approx(8 * 30 * 7 / 3, rel=1e-9)
    assert bar.bbox().max.x == pytest.approx(4, rel=1e-6) and bar.bbox().min.x == pytest.approx(-4, rel=1e-6)
    # through points, without overshoot
    bulge = sweep(Circle(2), Line((0, 0, 0), (0, 0, 40)), scale=[(0, 1), (0.5, 1.6), (1, 1)])
    assert _radius_at(bulge, 20) == pytest.approx(3.2, rel=1e-4)
    # (a piecewise cubic: 1.45 at a quarter, its end slopes 2.4 as scipy's PCHIP takes them)
    assert _radius_at(bulge, 10) == pytest.approx(2 * 1.45, rel=1e-4)
    assert _radius_at(bulge, 1) == pytest.approx(_radius_at(bulge, 39), rel=1e-6)
    assert _radius_at(bulge, 1) == pytest.approx(2 * (0.99275 + 0.045125 * 0.5 * 2.4 + 0.00725 * 1.6), rel=1e-4)
    assert max(_radius_at(bulge, z) for z in range(1, 40)) <= 3.2 * (1 + 1e-4)
    # along a 3D spline (the kernel's frame) and a helix (the attitude kept): area x length, scaled
    path = Spline((0, 0, 0), (0, 10, 20), (30, 10, 40))
    horn = sweep(Circle(1), path, scale=(1, 3))
    assert horn.is_valid() and horn.volume == pytest.approx(math.pi * path.length * (1 + 3 + 9) / 3, rel=1e-7)
    h = Helix(pitch=10, height=40, radius=15)
    spring = sweep(Circle(2), h, scale=(1, 0.5))
    assert spring.volume == pytest.approx(math.pi * 4 * h.length * (1 + 0.5 + 0.25) / 3, rel=1e-6)
    twisted = sweep(Rectangle(4, 2), Line((0, 0, 0), (0, 0, 30)), twist=90, scale=(1, 2))
    assert twisted.volume == pytest.approx(8 * 30 * 7 / 3, rel=1e-5)
    # closed paths: the same scale at both ends
    ring = sweep(Circle(1), Circle(10).edges()[0], scale=lambda t: 1 + 0.5 * math.sin(math.pi * t) ** 2)
    assert ring.is_valid()
    assert ring.volume == pytest.approx(math.pi * 2 * math.pi * 10 * (1 + 0.5 + 0.25 * 3 / 8), rel=1e-5)
    # an open profile: a scaled surface
    sheet = sweep(Line((-1, 0, 0), (1, 0, 0)), Line((0, 0, 0), (0, 10, 10)), scale=(1, 2))
    assert sheet.area == pytest.approx(2 * math.sqrt(200) * 1.5, rel=1e-9)
    # planar paths of several edges go piece by piece
    corner = _quiet(lambda: sweep(Rectangle(2, 1), Polyline((0, 0, 0), (20, 0, 0), (20, 20, 0)), scale=(1, 2)))
    assert corner.is_valid() and 2 * 40 * 7 / 3 * 0.95 < corner.volume < 2 * 40 * 7 / 3


def test_scale_errors():
    line = Line((0, 0, 0), (0, 0, 10))
    with pytest.raises(ValueError, match="positive"):
        sweep(Circle(1), line, scale=(1, -1))
    with pytest.raises(ValueError, match="positive"):
        sweep(Circle(1), line, scale=lambda t: 1 - t)
    with pytest.raises(ValueError, match="t = 0 to t = 1"):
        sweep(Circle(1), line, scale=[(0, 1), (0.5, 2)])
    for bad in ("x", 3):
        with pytest.raises(TypeError, match="scale is"):
            sweep(Circle(1), line, scale=bad)
    with pytest.raises(ValueError, match="come round into itself"):
        sweep(Circle(1), Circle(10).edges()[0], scale=(1, 2))
    with pytest.raises(ValueError, match="sharp_corners=False"):
        sweep(Rectangle(2, 1), Polyline((0, 0, 0), (20, 0, 0), (20, 20, 0)), scale=(1, 2), sharp_corners=True)


def test_single_lines_and_arcs_sweep_into_planes_cylinders_and_tori():
    rod = sweep(Circle(2), Line((0, 0, 0), (0, 0, 50)))
    assert _kinds(rod) == ["cylinder", "plane", "plane"]  # (was a B-spline face)
    assert rod.faces().cylinders().first.radius == pytest.approx(2) and rod.volume == pytest.approx(math.pi * 4 * 50)
    beam = sweep(Rectangle(4, 3) - Circle(1), Line((1, 2, 3), (11, 22, 13)))
    assert _kinds(beam) == ["cylinder"] + ["plane"] * 6
    assert beam.volume == pytest.approx((12 - math.pi) * math.sqrt(600), rel=1e-12)
    bend = sweep(Rectangle(4, 2), CenterArc((0, 0), 10, 0, 90))
    assert _kinds(bend) == ["cylinder", "cylinder", "plane", "plane", "plane", "plane"]
    assert bend.volume == pytest.approx(8 * math.pi / 2 * 10, rel=1e-12)  # (Pappus)
    torus = sweep(Circle(2), Circle(10).edges()[0])
    assert _kinds(torus) == ["torus"] and torus.volume == pytest.approx(math.pi * 4 * 2 * math.pi * 10, rel=1e-12)
    # translational along an oblique line: the profile's plane kept
    prism = sweep(Rectangle(4, 2), Line((0, 0, 0), (10, 20, 10)), translational=True)
    assert prism.volume == pytest.approx(80, rel=1e-12) and prism.bbox().min.z == pytest.approx(0)
    # a profile that reaches across the arc's axis would sweep through itself (it was a "valid" body)
    with pytest.raises(ModelingError, match="across the axis of the arc"):
        sweep(Circle(12), CenterArc((0, 0), 10, 0, 90))


def test_tapered_extrusions_have_plane_walls():
    inward = Rectangle(30, 30).extrude(10, taper=8)
    assert _kinds(inward) == ["plane"] * 6 and inward.volume == pytest.approx(8183.09063, rel=1e-9)
    outward = Rectangle(30, 30).extrude(10, taper=-8)
    assert _kinds(outward) == ["plane"] * 6 and outward.volume == pytest.approx(9869.58064, rel=1e-9)  # (14 faces)
    holed = (Rectangle(30, 30) - Rectangle(10, 10)).extrude(10, taper=-5)
    assert _kinds(holed) == ["plane"] * 10 and holed.volume == pytest.approx(8699.9093, rel=1e-8)
    ell = Polygon((0, 0), (20, 0), (20, 8), (8, 8), (8, 20), (0, 20)).extrude(10, taper=-8, both=True)
    assert set(_kinds(ell)) == {"plane"} and ell.volume == pytest.approx(2 * 3148.498974, rel=1e-8)
    assert {f.geom_type for f in (Circle(8) - Circle(2)).extrude(10, taper=8).faces()} == {"cone", "plane"}
    # the walls can be drafted again: draft.md's promise (taper 3, then 2 more)
    walls = Rectangle(20, 20).extrude(10, taper=3).faces().filter(lambda f: abs(f.normal_at().z) < 0.5)
    again = walls[0]._owner.draft(walls, 2, Plane.XY)
    assert again.volume == pytest.approx(Rectangle(20, 20).extrude(10, taper=5).volume, rel=1e-9)
    # corners="round": the kernel's rounded corners; its flat B-spline walls draft too
    rounded = Rectangle(30, 30).extrude(10, taper=-8, corners="round")
    assert len(rounded.faces()) == 10 and rounded.volume == pytest.approx(9863.92897, rel=1e-8)
    soft = Rectangle(20, 20).extrude(10, taper=3, corners="round")
    assert _kinds(soft).count("bspline") == 4
    flat = soft.faces().filter(lambda f: f.geom_type == "bspline")
    five = Rectangle(20, 20).extrude(10, taper=5).volume
    assert soft.draft(flat, 2, Plane.XY).volume == pytest.approx(five, rel=1e-9)
    with pytest.raises(ValueError, match="corners is 'sharp' or 'round'"):
        Rectangle(30, 30).extrude(10, taper=5, corners="chamfer")
    # a hole that widens across the region before the end (it came out 5.67 high)
    with pytest.raises(ModelingError, match="closes the profile after 5.67128 of 10"):
        (Circle(10) - Circle(8)).extrude(10, taper=10)


def test_lofts_leave_and_reach_their_ends_along_tangents():
    a, b = Circle(10), Circle(4).moved(Location((0, 0, 30)))

    def radial_error(part):
        side = part.faces().filter(lambda f: f.geom_type == "bspline")[0]
        worst = 0.0
        for i in range(12):
            t = 2 * math.pi * i / 12
            for r, z in ((10, 0.0), (4, 30.0)):
                n = side.normal_at(Vector(r * math.cos(t), r * math.sin(t), z))
                worst = max(worst, n.angle_to((math.cos(t), math.sin(t), 0)))
        return worst

    neck = loft([a, b], start_tangent=Z, end_tangent=Z)
    assert neck.is_valid() and radial_error(neck) < 1e-6
    assert radial_error(loft([a, b])) > 1
    bottle = Circle(10).extrude(-20) + neck + Circle(4).moved(Location((0, 0, 30))).extrude(10)
    assert bottle.is_valid() and len(bottle.faces()) == 5  # (smooth: the joints are no edges of note)
    assert loft([a, b], start_tangent=Z).volume == pytest.approx(6361.8212, rel=1e-6)
    holed = loft([Rectangle(20, 20) - Circle(4), (Rectangle(10, 10) - Circle(2)).moved(Location((0, 0, 20)))],
                 start_tangent=Z, end_tangent=Z)
    assert holed.is_valid() and len(holed.faces()) == 7
    sheet = loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 5, 10), (10, 5, 10))], start_tangent=Z, end_tangent=Z)
    assert isinstance(sheet, Shell) and sheet.area > 10 * math.sqrt(125)
    # closed: through the first section again, smooth (16 circles about a circle: nearly a torus)
    rings = [Circle(2).moved(Plane((10 * math.cos(t), 10 * math.sin(t), 0), x_dir=(math.cos(t), math.sin(t), 0),
                                   z_dir=(-math.sin(t), math.cos(t), 0)).location)
             for t in (2 * math.pi * i / 16 for i in range(16))]
    torus = loft(rings, closed=True)
    assert torus.is_valid() and len(torus.faces()) == 1
    assert torus.volume == pytest.approx(2 * math.pi ** 2 * 10 * 4, rel=2e-4)
    with pytest.raises(ValueError, match="lies in the plane"):
        loft([a, b], start_tangent=X)
    with pytest.raises(ValueError, match="ruled=False"):
        loft([a, b], ruled=True, end_tangent=Z)
    with pytest.raises(ValueError, match="closed=False"):
        loft(rings, closed=True, start_tangent=Z)
    with pytest.raises(ValueError, match="three sections"):
        loft([a, b], closed=True)


def test_revolves_lofts_extrusions_and_tapers_free_their_curve_copies(monkeypatch):
    import smlibpy.shapes as shapes

    counts = {"copies": 0, "deletes": 0}
    copy, delete = shapes.Edge._copy_curve, ext.delete_curve

    def counted_copy(self):
        counts["copies"] += 1
        return copy(self)

    def counted_delete(c):
        counts["deletes"] += 1
        return delete(c)

    monkeypatch.setattr(shapes.Edge, "_copy_curve", counted_copy)
    monkeypatch.setattr(ext, "delete_curve", counted_delete)
    lathe = (Rectangle(10, 10, align=(Align.MIN, Align.MIN)).translate(5, 0) - Circle(2).translate(10, 5)).on(Plane.XZ)
    sections = [Rectangle(10, 10) - Circle(2), (Rectangle(8, 8) - Circle(1)).moved(Location((0, 0, 10)))]
    region = Rectangle(30, 30) - Circle(4)
    curve = Spline((0, 0, 0), (5, 3, 0), (10, 0, 0))
    for op in (lambda: lathe.revolve(Z, 90), lambda: revolve(Line((5, 0, 0), (5, 0, 20)), Z),
               lambda: extrude(curve, 5, both=True), lambda: loft(sections), lambda: region.extrude(10, taper=5),
               lambda: sweep(Rectangle(2, 1), Polyline((0, 0, 0), (20, 0, 0), (20, 20, 0)))):
        counts.update(copies=0, deletes=0)
        op()
        assert counts["copies"] > 0 and counts["deletes"] >= counts["copies"]  # (before: 0 deleted)


# S12: swing, a revolve about Z whose circle is an outline of any shape


def test_swing_carries_the_profile_around_the_outline():
    cup = Polygon((0, 0), (30, 0), (30, 40), (0, 40)).on(Plane.front)
    box = swing(cup, Ellipse(30, 20))
    assert box.is_valid() and math.isclose(box.volume, math.pi * 30 * 20 * 40, rel_tol=1e-9)
    assert cup.swing(Ellipse(30, 20)).volume == pytest.approx(box.volume, rel=1e-12)
    # sections scale with the profile's distance from the axis: a frustum's 1 + 1/2 + 1/4 over 3
    cone = swing(Polygon((0, 0), (30, 0), (15, 40), (0, 40)).on(Plane.front), Ellipse(30, 20))
    assert math.isclose(cone.volume, math.pi * 30 * 20 * 40 * 1.75 / 3, rel_tol=1e-9)
    # a circle about the origin is the revolve
    lathe = Polygon((0, 0), (30, 0), (15, 40), (0, 40)).on(Plane.front)
    assert math.isclose(swing(lathe, Circle(30)).volume, lathe.revolve(Z).volume, rel_tol=1e-9)
    # the cut by the XZ plane at +X is the profile, also for an outline crossing it off a vertex: a
    # rounded rectangle turned by 30 degrees (the kernel's own swung primitive raised SM_ERR for it), an
    # off-centre circle (crossing +X at 5 + sqrt(391))
    turned = RoundedRectangle(60, 40, 10).rotate(Z, 30)
    p = swing(cup, turned)
    for z in (5, 20, 35):
        assert p.distance_to((30, 0, z)) < 1e-9 and p.distance_to((30.01, 0, z)) > 0.005
    off = Circle(20).translate(5, 3)
    r0 = 5 + math.sqrt(391)
    assert math.isclose(swing(cup, off).volume, math.pi * 400 * (30 / r0) ** 2 * 40, rel_tol=1e-9)
    # beside the axis (a ring), with holes, an open curve (a surface)
    ring = swing(Polygon((20, 0), (30, 0), (30, 10), (20, 10)).on(Plane.front), Ellipse(30, 20))
    assert math.isclose(ring.volume, math.pi * 600 * 10 * (1 - (20 / 30) ** 2), rel_tol=1e-9)
    holed = (Rectangle(20, 30, align=(Align.MIN, Align.MIN)) - Circle(4).translate(12, 15)).on(Plane.front)
    assert math.isclose(swing(holed, Circle(20)).volume, holed.revolve(Z).volume, rel_tol=1e-9)
    sheet = swing(Spline((0, 0, 0), (25, 0, 10), (15, 0, 30), (20, 0, 45), (0, 0, 50)), Ellipse(30, 20))
    assert isinstance(sheet, Shell) and sheet.area > 0
    bottle = swing(Polygon((0, 0), (20, 0), (20, 50), (8, 60), (8, 70), (0, 70)).on(Plane.front),
                   RoundedRectangle(40, 30, 8))
    assert bottle.is_valid() and len(bottle.solids()) == 1
    assert bottle.bbox().min.to_tuple() == pytest.approx((-20, -15, 0)) and bottle.bbox().max.z == pytest.approx(70)


def test_swing_refuses_outlines_and_profiles_it_cannot_carry():
    cup = Polygon((0, 0), (30, 0), (30, 40), (0, 40)).on(Plane.front)
    with pytest.raises(ValueError, match="once around the Z axis"):
        swing(cup, Rectangle(10, 10).translate(30, 0))
    with pytest.raises(ValueError, match="every ray from the Z axis"):
        swing(cup, Polygon((10, 0), (0, 10), (-10, 0), (0, -10), (5, 0.5)))
    with pytest.raises(ValueError, match="XZ plane"):
        swing(Polygon((0, 0), (30, 0), (30, 40), (0, 40)), Ellipse(30, 20))
    with pytest.raises(ValueError, match="beside the Z axis"):
        swing(Rectangle(10, 10).on(Plane.front), Ellipse(30, 20))
    with pytest.raises(ValueError, match="parallel to XY"):
        swing(cup, Ellipse(30, 20).on(Plane.front))
    with pytest.raises(ValueError, match="holes"):
        swing(cup, Ellipse(30, 20) - Circle(5))
    with pytest.raises(ValueError, match="closed curve"):
        swing(cup, Line((0, 0), (1, 1)))


# S13: sectors of the primitives


def _face_kinds(p):
    out = {}
    for f in p.faces():
        out[f.geom_type] = out.get(f.geom_type, 0) + 1
    return out


def test_primitives_take_sectors():
    pi = math.pi
    q = Cylinder(10, 20, arc_size=90)
    assert q.is_valid() and math.isclose(q.volume, pi * 100 * 20 / 4, rel_tol=1e-9)
    assert _face_kinds(q) == {"plane": 4, "cylinder": 1}
    # centered by its box like every primitive; align=None keeps the axis on Z
    assert q.bbox().min.to_tuple() == pytest.approx((-5, -5, -10)) and q.bbox().max.to_tuple() == pytest.approx((5, 5, 10))
    on_z = Cylinder(10, 20, arc_size=90, align=None)
    assert on_z.bbox().min.to_tuple() == pytest.approx((0, 0, -10)) and on_z.bbox().max.to_tuple() == pytest.approx((10, 10, 10))
    standing = Cylinder(10, 20, arc_size=270, align=(Align.CENTER, Align.CENTER, Align.MIN))
    assert standing.bbox().min.z == pytest.approx(0) and math.isclose(standing.volume, pi * 100 * 20 * 0.75, rel_tol=1e-9)
    # within 0.01 degrees of 360 a whole one (the kernel's sectors there are not closed solids)
    assert _face_kinds(Cylinder(10, 20, arc_size=359.995)) == {"cylinder": 1, "plane": 2}
    cone = Cone(10, 5, 20, arc_size=90)
    assert math.isclose(cone.volume, pi * 20 / 3 * 175 / 4, rel_tol=1e-9) and _face_kinds(cone) == {"plane": 4, "cone": 1}
    assert math.isclose(Cone(10, 0, 20, arc_size=120).volume, pi * 20 / 3 * 100 / 3, rel_tol=1e-6)
    lune = Sphere(10, arc_size3=90, align=None)
    assert math.isclose(lune.volume, 4 / 3 * pi * 1000 / 4, rel_tol=1e-9) and _face_kinds(lune) == {"plane": 2, "sphere": 1}
    # latitudes: planes parallel to XY
    z1, z2 = -5.0, 10 * math.sin(math.radians(60))
    zone = pi * ((100 * z2 - z2 ** 3 / 3) - (100 * z1 - z1 ** 3 / 3))
    part = Sphere(10, arc_size1=-30, arc_size2=60, arc_size3=90, align=None)
    assert math.isclose(part.volume, zone / 4, rel_tol=1e-9) and _face_kinds(part) == {"plane": 4, "sphere": 1}
    assert part.bbox().min.z == pytest.approx(-5) and part.bbox().max.z == pytest.approx(z2)
    assert math.isclose(Sphere(10, arc_size1=0).volume, 2 / 3 * pi * 1000, rel_tol=1e-9)
    # a torus sector is a torus (the kernel's own is a surface of revolution)
    ring = Torus(20, 5, major_angle=90, align=None)
    assert math.isclose(ring.volume, 2 * pi ** 2 * 20 * 25 / 4, rel_tol=1e-9) and _face_kinds(ring) == {"plane": 2, "torus": 1}
    sector = AnnularSector(5, 10, 20, 120, align=None)
    assert math.isclose(sector.volume, pi * 75 * 20 / 3, rel_tol=1e-6) and _face_kinds(sector) == {"plane": 4, "cylinder": 2}
    assert sector.bbox().min.to_tuple() == pytest.approx((-5, 0, -10)) and sector.bbox().max.to_tuple() == pytest.approx((10, 10, 10))
    tube = AnnularSector(5, 10, 20, 360)
    assert math.isclose(tube.volume, pi * 75 * 20, rel_tol=1e-9) and _face_kinds(tube) == {"cylinder": 2, "plane": 2}
    assert math.isclose(AnnularSector(0, 10, 20, 90).volume, q.volume, rel_tol=1e-12)
    for bad in (lambda: Cylinder(10, 20, arc_size=0), lambda: Cone(5, 2, 3, arc_size=400),
                lambda: Sphere(10, arc_size1=30, arc_size2=30), lambda: Sphere(10, arc_size1=-100),
                lambda: Torus(20, 5, major_angle=-5), lambda: AnnularSector(10, 5, 20, 90),
                lambda: AnnularSector(5, 10, 20, 0)):
        with pytest.raises(ValueError):
            bad()


# S14: extrusion directions in or near the sketch plane


def test_extrude_direction_in_the_sketch_plane_raises_and_near_it_warns():
    with pytest.raises(ValueError, match="lies in the sketch plane"):  # (was a bare KernelError, SM_ERR)
        Rectangle(10, 10).extrude(5, direction=(1, 0, 0))
    with pytest.raises(ValueError, match="lies in the sketch plane"):
        Rectangle(10, 10).extrude(5, direction=(1, 0, 1e-6))
    with pytest.raises(ValueError, match="lies in the sketch plane"):
        Circle(3).on(Plane(origin=(1, 2, 3), z_dir=(1, 1, 1))).extrude(5, direction=(1, -1, 0), taper=5)
    with pytest.warns(RuntimeWarning, match="only 0.0005 thick"):
        thin = Rectangle(10, 10).extrude(5, direction=(1, 0, 1e-4))
    assert thin.is_valid() and math.isclose(thin.volume, 0.05, rel_tol=1e-6)
    slanted = _quiet(lambda: Rectangle(10, 10).extrude(5, direction=(1, 0, 1)))
    assert math.isclose(slanted.volume, 500 / math.sqrt(2), rel_tol=1e-9)


def test_extrusions_along_a_direction_are_valid_or_raise():
    # In tilted planes the kernel made some extrusions of curved profiles along a direction inside out
    # or open; they are made again turned about the normal, or raise.
    fixed = Circle(3).on(Plane(origin=(2.00729845925639, 0, 0),
                               z_dir=(0.9513514554730566, -0.29311120370412086, -0.09495383316337645)))
    d = (-0.18315301020251898, -0.7616861581242306, 0.6215216580101659)
    part = _quiet(lambda: fixed.extrude(5, direction=d))  # (was inside out: volume -1.41372)
    sine = abs(Vector(d).normalized().dot(fixed.plane.z_dir))
    assert part.is_valid() and math.isclose(part.volume, fixed.area * 5 * sine, rel_tol=1e-9)
    rng = np.random.default_rng(7)
    for i in range(24):
        n = rng.normal(size=3)
        sk = [Circle(3), Ellipse(4, 2), Slot(10, 3), Rectangle(6, 4)][i % 4].on(Plane(origin=(i, 0, 0), z_dir=tuple(n)))
        t = sk.plane.z_dir.cross(Vector(0.3, 0.5, 0.7)).normalized()
        for s in (0.01, 0.1):
            d = t * math.sqrt(1 - s * s) + sk.plane.z_dir * s
            try:
                p = sk.extrude(5, direction=d)
            except ModelingError:
                continue
            assert p.is_valid() and math.isclose(p.volume, sk.area * 5 * s, rel_tol=1e-6)
