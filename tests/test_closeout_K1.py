"""Closeout of the kernel plan's Booleans, cells and topology area (K1): the defects the 0.5.0 notes
left open there. Reference volumes are OpenCASCADE's (BRepAlgoAPI, volume properties to 1e-10)
where it agrees with the invariants (|U| + |I| = |A| + |B|, |A - B| = |A| - |I|), else integrals of
the shapes as noted."""

from __future__ import annotations

import math
import random
import subprocess
import sys
import textwrap

import pytest
from pytest import approx

from smlibpy import Y, Box, Circle, Cylinder, KernelError, ModelingError, Plane, Rectangle, Sphere, Torus, X
from smlibpy._kernel import ext, k


def _run(code: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-c", textwrap.dedent(code)], capture_output=True, text=True, timeout=300)


# -- the process killed by a torus touching a plate (kernel patch: SmTopologyIntersector::DeleteFaces)


def test_a_torus_touching_a_plate_at_a_point_no_longer_kills_the_process():
    # Two Vertices of the deleted faces shared one vertex Shell, which DeleteVertex deleted with the
    # first: the second's Vertexuse named the freed Shell (AddressSanitizer). The operations run in a
    # process of their own, so that a regression fails this test rather than the test run.
    code = """
    import smlibpy.defeature, warnings
    warnings.simplefilter("ignore")
    smlibpy.defeature.GUARD_SECONDS = 0
    from smlibpy import *
    plate = Box(20, 16, 4) - Sphere(6).rotate(X, 90).translate(1.4007, 0, -1.5863)
    ring = Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)
    for r in (plate & ring, ring & plate, plate + ring, plate - ring, ring - plate):
        print(len(r.faces()), repr(r.volume))
    """
    run = _run(code)
    assert run.returncode == 0, run.stderr[-2000:]
    out = [line.split() for line in run.stdout.split("\n") if line]
    plate = 1280 - math.pi * (36 * 4 - (3.5863 ** 3 + 0.4137 ** 3) / 3)  # the box less the sphere's slab
    ring = 2 * math.pi ** 2 * 6 * 2.5 ** 2
    assert [int(n) for n, _ in out[:2]] == [0, 0]  # they touch at a point: nothing in common
    assert float(out[2][1]) == approx(plate + ring, rel=1e-7)
    assert float(out[3][1]) == approx(plate, rel=1e-7) and float(out[4][1]) == approx(ring, rel=1e-9)


# -- unions and cuts that left an operand out


def test_a_union_that_gives_back_one_operand_is_caught_and_done_again():
    # fuzz csg-11-132: the kernel returned the first operand with two vertices imprinted (1358.54)
    a = Cylinder(5, 5) + Box(20, 4, 16).rotate(X, 90).translate(0, -3, -0.5)
    b = Cylinder(2, 12).translate(2, -2.3693, 3.5)
    u = a + b
    assert u.volume == approx(1446.612107, rel=1e-7) and u.is_valid()  # OpenCASCADE 1446.612107
    assert u.bbox().max.z == approx(9.5)


def test_a_cut_that_reaches_out_of_the_part_raises():
    # fuzz csg-8-110 D: a body of no volume reaching to x = 16, out of the part (x <= 2), returned
    a = Cylinder(2, 12)
    b = Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)
    with pytest.raises(ModelingError, match="partly outside the part"):
        a - b


def test_an_intersection_the_other_way_round():
    # The hole's seam touches the ring and the ring's the part: the kernel's intersection of the
    # moved bodies gave a closed body of two faces and no volume, passed over now, and the operands
    # the other way round give it (OpenCASCADE 213.187445). It raised before.
    part = Box(30, 30, 30) - Cylinder(2.278, 60).translate(0.968, 1.638, 0)
    ring = Torus(3.566, 1.783).rotate(Y, 90).translate(3.246, 6.987, 7.278)
    common = part & ring
    assert common.volume == approx(213.187445, rel=1e-6) and common.is_valid()


# -- seams of bodies that are no bodies of revolution, and seams of B-spline faces (B6)

_HOLES = [
    # (box, hole radius, hole x, y, tool, OpenCASCADE: union, intersection, difference)
    (20, 3.174, -2.051, -2.981, lambda: Sphere(3.159).translate(1.123, 0.178, 2.221), 7387.872204, 111.192087,
     7255.822483),
    (30, 3.598, -1.684, 2.985, lambda: Sphere(1.273).translate(1.914, 4.258, 0.143), 25782.865515, 5.681248,
     25774.224319),
    (30, 3.194, 0.834, 0.654, lambda: Cylinder(3.288, 60).rotate(Y, 90).translate(0, 3.942, -5.207), 27134.631179,
     941.702215, 25096.816244),
    (20, 3.187, 2.812, 0.475, lambda: Sphere(3.244).translate(5.999, 3.719, 0.422), 7383.815903, 121.001303,
     7240.817513),
]


@pytest.mark.parametrize("case", range(len(_HOLES)))
def test_a_tool_tangent_to_the_seam_of_an_earlier_hole(case):
    # The hole's seam touches the tool where their faces cross; the part is no body of revolution, so
    # no turn of it moves the seam: the hole's wall is filled and cut again turned. Before: the union
    # of the first case 7492.16, the intersection 6.90, all valid.
    size, r, x, y, tool, union, common, rest = _HOLES[case]
    part = Box(size, size, size) - Cylinder(r, 2 * size).translate(x, y, 0)
    t = tool()
    assert k.ext.seam_contacts(part._brep, t._brep)  # (the hole's seam touches the tool)
    assert (part + t).volume == approx(union, rel=1e-7)
    assert (part & t).volume == approx(common, rel=1e-6)
    assert (part - t).volume == approx(rest, rel=1e-7)
    assert (part - t).is_valid()


def test_seams_on_b_spline_faces_and_tangent_to_b_spline_faces():
    # The groove pin of B6 with B-spline faces: the bore's faces were not looked at (24656.15), the
    # pin's own seam on a B-spline face was not turned (24461.48). Exact 24299.258668; NURBS copies
    # of cylinders hold their radius to about 1e-8.
    pin = Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
    part = Box(30, 30, 30) - Cylinder(5, 60)
    assert (part.to_nurbs() - pin).volume == approx(24299.258668, rel=1e-7)
    assert (part - pin.to_nurbs()).volume == approx(24299.258668, rel=1e-7)
    assert (part.to_nurbs() - pin.to_nurbs()).volume == approx(24299.258668, rel=1e-7)


def test_a_nurbs_part_with_a_hole_tangent_to_a_sphere():
    part = (Box(20, 20, 20) - Cylinder(3.174, 40).translate(-2.051, -2.981, 0)).to_nurbs()
    ball = Sphere(3.159).translate(1.123, 0.178, 2.221)
    assert (part & ball).volume == approx(111.192087, rel=1e-6)


def test_merging_into_a_merged_part_turns_the_new_parts_seam():
    part = Box(30, 30, 30) - Cylinder(5, 60)
    pin = Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
    other = Box(4, 4, 4).translate(0, 0, 40)
    cells = part.merge(other).merge(pin).cells()
    assert sum(c.volume for c in cells) == approx((part + pin).volume + 64, rel=1e-9)
    assert max(c.volume for c in cells) == approx(24299.258668, rel=1e-9)


# -- the raw kernel call that handed out freed edges


def test_boolean_with_curves_hands_out_the_edges_where_the_bodies_meet():
    # SmApiBooleanWithCurves handed out edges its post-processing had deleted, and pybind11 read them:
    # the process died. smlibpy._core.boolean_with_curves is smlibpy's Boolean and the edges on both
    # surfaces now, as ShapeList.joining finds them.
    code = """
    from smlibpy import *
    from smlibpy import _core
    from smlibpy._kernel import k
    for a, b in [(Box(10, 10, 10), Box(10, 10, 5).translate(5, 0, -2.5)), (Box(10, 10, 10), Box(10, 10, 10).translate(10, 0, 0)),
                 (Box(40, 40, 10), Cylinder(5, 20).translate(0, 0, 10)), (Box(20, 20, 20), Cylinder(3, 40).rotate(Y, 30))]:
        for op in (k.BooleanOp.UNION, k.BooleanOp.DIFFERENCE):
            r, edges = _core.boolean_with_curves(a._copy_brep(), b._copy_brep(), operation=op)
            p = Part._wrap(r)
            print(len(edges), len(p.edges().joining(a, b)), round(p.volume, 6))
    """
    run = _run(code)
    assert run.returncode == 0, run.stderr[-2000:]
    rows = [line.split() for line in run.stdout.split("\n") if line]
    assert [r[0] for r in rows] == [r[1] for r in rows]  # the same edges as joining
    assert [int(r[0]) for r in rows] == [1, 6, 0, 4, 1, 1, 2, 2]
    assert float(rows[4][2]) == approx(16000 + math.pi * 25 * 15, rel=1e-9)
    assert k.ext.nogil_mismatches() == []


# -- 2D Booleans of faces far apart (C1)


def test_a_lattice_of_unit_squares_beside_a_far_square():
    # A unit square fused to its neighbour at a corner, with a square 1000 away, became a sliver of
    # 0.2778 without an error (9 of 60 random lattices; 46 more raised): the kernel's planar Boolean
    # takes its tolerances from the extent of its operands. Faces apart from the other operand's are
    # set aside now, and the groups near each other go into the kernel one by one.
    for seed in range(12):
        rng = random.Random(seed)
        squares = Rectangle(1, 1).translate(1000.5, 0.5)
        for i, j in rng.sample([(i, j) for i in range(5) for j in range(5)], 6):
            squares = squares + Rectangle(1, 1).translate(i + 0.5, j + 0.5)
        assert squares.area == approx(7), seed
        assert all(f.area > 1 - 1e-9 for f in squares.faces()), seed


def test_far_pieces_on_both_sides():
    a = Rectangle(1, 1).translate(1000.5, 0.5) + Rectangle(2, 2).translate(1, 1) + Circle(1).translate(-500, 0)
    b = Rectangle(2, 2).translate(2, 2) + Rectangle(1, 1).translate(1000.5, 1.0) + Circle(0.5).translate(300, 300)
    area_a, area_b, common = 5 + math.pi, 5 + math.pi / 4, 1.5
    assert (a + b).area == approx(area_a + area_b - common)  # before: 9.419 in smlibwasm
    assert (a - b).area == approx(area_a - common)
    assert (a & b).area == approx(common)
    assert (a ^ b).area == approx(area_a + area_b - 2 * common)
    assert (a + b).extrude(1).volume == approx(area_a + area_b - common)


# -- split along a sheet of one analytic face that ends inside the part (B12)


def test_split_along_a_cylindrical_face_that_ends_inside_the_part():
    # A face of a cylinder of radius 30 about (0, -25), 8 high, in a box of 20: it raised "the surface
    # does not cut through the part"; the face goes on as its cylinder now (Face.extend).
    box = Box(20, 20, 20)
    face = (Cylinder(30, 8).translate(0, -25, 0)).faces().cylinders()[0]
    outside, inside = box.split(face.to_shell(), "both")
    # inside the cylinder: 20 * the integral of (sqrt(900 - x^2) - 15) over -10..10
    area = 2 * (5 * math.sqrt(800) + 450 * math.asin(1 / 3)) - 300
    assert inside.volume == approx(20 * area, rel=1e-6)
    assert outside.volume + inside.volume == approx(8000, rel=1e-7)
    assert inside.faces().cylinders()


def test_split_along_a_plane_face_that_ends_inside_the_part():
    box = Box(20, 20, 20)
    face = Box(8, 8, 1).rotate(X, 20).faces().sort_by(Y)[-1]  # the side at y = 4, turned by 20 degrees
    above, below = box.split(face.to_shell(), "both")
    assert above.volume == approx(4000 - 4 * 20 * 20 / math.cos(math.radians(20)), rel=1e-9)
    assert above.volume + below.volume == approx(8000, rel=1e-9)


# -- circular rims after a scale along the axis (T6)


def test_rims_of_parts_scaled_along_their_axis_are_circles(tmp_path):
    # The kernel's recognition after the transform gave back the cylinder, but its rims stayed
    # B-spline edges: .circles() found none and STEP files got B-spline curves.
    from smlibpy import Cone, export_step, import_step

    tall = Cylinder(5, 10).scale((1, 1, 2))
    assert sorted(e.geom_type for e in tall.edges()) == ["circle", "circle"]
    assert [e.radius for e in tall.edges().circles()] == [approx(5, abs=1e-12)] * 2
    assert tall.volume == approx(math.pi * 25 * 20, rel=1e-13) and tall.check() == []
    cone = Cone(5, 2, 10).scale((1, 1, 3))
    assert sorted(e.radius for e in cone.edges().circles()) == [approx(2, abs=1e-12), approx(5, abs=1e-12)]
    holed = (Box(20, 20, 10) - Cylinder(3, 20)).scale((1, 1, 1.5))
    assert len(holed.edges().circles()) == 2 and holed.check() == []
    assert holed.volume == approx(1.5 * (4000 - math.pi * 90), rel=1e-13)
    assert holed.fillet(holed.edges().circles(), 1).is_valid()
    cut = (Box(20, 20, 20) - Sphere(5).translate(0, 0, 10)).scale((1, 1, 2))
    assert [e.radius for e in cut.edges().circles()] == [approx(5, abs=1e-12)]
    # elliptic rims (a scale across the axis) stay B-splines
    assert {e.geom_type for e in Cylinder(5, 10).scale((2, 1, 1)).edges()} == {"bspline"}
    export_step(tall, tmp_path / "tall.step")
    text = (tmp_path / "tall.step").read_text()
    assert "CIRCLE(" in text and "B_SPLINE_CURVE" not in text
    assert import_step(tmp_path / "tall.step").volume == approx(math.pi * 500, rel=1e-13)


# -- a fillet the kernel fails inside names what it could not build (B19 with F8)


def test_a_fillet_that_fails_inside_the_kernel_names_the_round_it_could_not_build():
    # fuzz case fillet-7-161: SM_ERR_NULL_POINTER, with the fillet executive's record of the round
    part = Torus(8, 1.5) - Sphere(2.5).translate(7, 7, -2.8573)
    with pytest.raises(KernelError) as e:
        part.fillet(part.edges(), 0.495553)
    message = str(e.value)
    assert e.value.status == "SM_ERR_NULL_POINTER" and "may be too large" not in message
    assert "the kernel failed inside the fillet" in message and "which says nothing about the radius" in message
    assert "it could not build the round of the closed edge through (6.18121, 5.0668, -1.49998)" in message


# -- seams that no turn moves: a torus' outer equator (B6)


def test_a_torus_whose_outer_equator_touches_an_earlier_hole():
    # The torus' outer equator touches the hole's wall at a point: the union and the intersection gave
    # 23610.47 and 220.03 (the torus inside the hole taken for inside the part); the check of the
    # result's faces refuses them, and the part as a NURBS copy, whose hole's seam ext.boolean moves,
    # gives them right (point classification of the operands: 23635.96 and 194.55). The cut raises.
    part = Box(30, 30, 30) - Cylinder(5.997, 60).translate(2.016, 2.814, 0)
    ring = Torus(3.546, 1.773).rotate(Y, 90).translate(8.013, 8.133, 6.396)
    assert ext.seam_touches(part._brep, ring._brep)  # (the hole's seam touches the torus)
    union, common = part + ring, part & ring
    assert union.volume == approx(23635.9574, abs=1e-3) and common.volume == approx(194.5466, abs=1e-3)
    assert union.volume + common.volume == approx(part.volume + ring.volume, rel=1e-8)
    assert (ring - part).volume == approx(ring.volume - common.volume, rel=1e-5)
    with pytest.raises(ModelingError, match="seam"):
        part - ring


@pytest.mark.parametrize("R, r, at, above", [(6, 4, 10.0, 5.80689), (10, 3, 13.0, 3.27792)])
def test_a_split_whose_plane_touches_a_torus_outer_equator(R, r, at, above):
    # slice-7-390 of the fuzz run: the sides did not add up (5.8069 + 1842.7020 for 1894.9640). The
    # half-space boxes of four sizes, and the kernel's slice, are tried until both sides hold the
    # torus' volume. (The cap of R 6, r 4 integrated on a grid: 5.80697.)
    torus = Torus(R, r).rotate(Y, 90)
    plane = Plane((0, 0, at), z_dir=(math.tan(math.radians(30)), 0, 1))
    up, down = torus.split(plane, "both")
    assert up.volume == approx(above, abs=1e-4)
    assert up.volume + down.volume == approx(torus.volume, rel=1e-8)
    assert up.is_valid() and down.is_valid()
