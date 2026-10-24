"""Booleans along seams and beside earlier holes (kernel plan B6, B4 and B10); empty Boolean results
checked without the kernel's brep_relationship (B13); parts split along sheets and sheets trimmed by
parts (B12); imprints (B14); where faces and edges came from (T3); the kernel's validity checks (T4);
the cells of a merged part named after their parts (B15); solids() separating a body in a cavity
(B16); the edges where two bodies meet (B17); sections by planes that only touch (B18); error hints
from what the operands show (B19); colors and names of single faces (T5); analytic faces after scales
that differ between the axes (T6); shells, cavities and the cells a face bounds (T7); named() and
colored() sharing the Brep (T8).

Exact volumes come from integrating the overlaps of the operands (the cross sections of two
cylinders, a sphere and a cylinder), not from the kernel; OpenCASCADE's volume is given where it
differs from that by more than 1e-6.
"""

import math
import re
import subprocess
import sys

import numpy as np
import pytest
from pytest import approx

from smlibpy import *
from smlibpy import shapes
from smlibpy._kernel import ext, k
from smlibpy.colors import to_rgb

PIN = 24299.258668  # (Box(30, 30, 30) - Cylinder(5, 60)) less a pin of radius 2 tangent to the bore
CROSS = 6931.747603  # Box(20, 20, 20) less two holes of radius 3 whose axes are 3 apart
HOLES = 62.720958  # the common volume of those two holes (OpenCASCADE: 62.7209)


def _pin(y=5.0, turn=0.0):
    return Cylinder(2, 60).rotate(Z, turn).rotate(Y, 90).translate(0, y, 0)


# -- B6: seams tangent to the other operand -------------------------------------------------
@pytest.mark.parametrize("make, exact", [
    (lambda: (Box(30, 30, 30) - Cylinder(5, 60)) - _pin(5), PIN),  # was 24331.7029, valid
    (lambda: (Box(30, 30, 30) - Cylinder(5, 60)) - _pin(-5), PIN),  # was 24461.4800
    (lambda: (Box(30, 30, 30) - Cylinder(5, 60)) - _pin(5, 45), PIN),  # turned by hand: as it was
    (lambda: Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 90).translate(0, 3, 0)
     - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3), CROSS),  # was 7057.1895
    (lambda: _pin(5) & Cylinder(5, 60), 32.444276),  # was 194.6656
    (lambda: _pin(5) - Cylinder(5, 60), 721.537961),  # was 559.3166
    (lambda: Cylinder(5, 60) - _pin(5), 4679.944704),  # was 4647.5004
    # a sphere whose seam lies in the plane tangent to the cylinder's top line: was 81.7551, more
    # than the sphere (33.51)
    (lambda: Cylinder(2.5, 30).rotate(Y, 90) & Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5), 13.625852),
    # a sphere's seam tangent to a cylinder through its centre: was 245.4102 (OpenCASCADE: 462.4602)
    (lambda: Cylinder(2.5, 20).rotate(Y, 90) + Sphere(3).translate(0, 2.5, 0), 462.398702),
], ids=["groove pin", "groove pin below", "pin turned by hand", "cross holes", "pin and bore", "pin less bore",
        "bore less pin", "sphere seam", "sphere seam fused"])
def test_seams_tangent_to_the_other_operand(make, exact):
    part = make()
    assert part.is_valid()
    assert part.volume == approx(exact, rel=1e-6)


def test_crossing_holes_compute_natively():
    # B4: natively the kernel's Boolean of these raises SM_ERR_BAD_INTERSECTIONS where its seams lie
    # tangent to the other hole (the wasm found the intersection); with the second hole turned about
    # its axis both builds get all of them.
    h1 = Cylinder(3, 40).translate(0, 3, 0)
    for z in (3, 3.1):
        h2 = Cylinder(3, 40).rotate(Y, 90).translate(0, 0, z)
        assert (h1 & h2).volume == approx(HOLES, rel=1e-6)
        assert (h1 + h2).volume == approx(2 * math.pi * 9 * 40 - HOLES, rel=1e-7)
        assert (h1 - h2).volume == approx(math.pi * 9 * 40 - HOLES, rel=1e-7)
        assert (Box(20, 20, 20) - h1 - h2).volume == approx(CROSS, rel=1e-8)
        assert (Box(20, 20, 20) - [h1, h2]).volume == approx(CROSS, rel=1e-8)
        cells = h1.merge(h2).cells()
        assert sorted(c.volume for c in cells) == approx([HOLES, 1068.252397, 1068.252397], rel=1e-6)
        with pytest.raises(RuntimeError, match="SM_ERR"):  # the kernel's own Boolean, seams as they are
            k.boolean(h1._copy_brep(), h2._copy_brep(), operation=k.BooleanOp.INTERSECTION)


def test_seam_contacts():
    bored = Box(30, 30, 30) - Cylinder(5, 60)
    pin = _pin(5)
    contacts = ext.seam_contacts(pin._brep, bored._brep)
    assert len(contacts) == 1
    edge, face, point = contacts[0]
    assert edge in ext.seam_edges(pin._brep)
    assert Face(bored, bored._brep.faces()[face]).radius == approx(5)  # the bore
    assert Vector(point).distance_to((0, 5, -2)) < 1e-6  # the pin's seam (t, 5, -2) touches the bore
    turned = _pin(5, 45)  # (held by a name: a temporary's Brep is freed before the call)
    assert ext.seam_contacts(turned._brep, bored._brep) == []
    assert ext.seam_contacts(bored._brep, pin._brep) == []  # the bore's seam lies away from the pin
    # Where the faces touch (the seam is the line along which they touch) it is no contact: a cylinder
    # tangent to a flat face along its seam, a cylinder touching a hole at a point of its seam.
    rod, box = Cylinder(3, 40).translate(7, 0, 0), Box(20, 20, 20)
    assert ext.seam_contacts(rod._brep, box._brep) == []
    holed = Box(20, 20, 20) - Cylinder(3, 40)
    inside = Cylinder(2, 40).rotate(X, 90).translate(1, 0, 0)  # its seam (3, t, 0) touches the hole at (3, 0, 0)
    assert ext.seam_contacts(inside._brep, holed._brep) == []


def test_seams_are_turned_only_where_they_touch():
    # A tool whose seam touches nothing keeps it where it is: (r, 0, z) before it is placed.
    plain = Box(30, 30, 30) - _pin(5)
    seams = [Edge._of(plain, plain._brep.edges()[i], True) for i in ext.seam_edges(plain._brep)]
    assert any(abs(e.center().y - 5) < 1e-9 and abs(e.center().z + 2) < 1e-9 for e in seams)
    # Beside the bore, where that seam would touch it, the pin went in turned about its axis: its
    # seam lies off the plane y = 5 that touches the bore.
    grooved = (Box(30, 30, 30) - Cylinder(5, 60)) - _pin(5)
    pin_seams = [i for i in ext.seam_edges(grooved._brep)
                 if Face(grooved, grooved._brep.edges()[i].faces()[0]).radius == approx(2)]
    assert pin_seams
    for i in pin_seams:
        c = Edge._of(grooved, grooved._brep.edges()[i], True).center()
        assert abs(c.y - 5) > 0.1


def test_a_turn_whose_result_cannot_be_right_is_passed_over():
    # A cylinder whose axis touches another one's surface: turned by 45 degrees the kernel's union
    # is the first cylinder alone (113.0973, valid), less than the second; the volume check passes it
    # over, and the next angle that clears the seam gives the union. Before, the union was an invalid
    # 256.4697.
    a = Cylinder(1.5, 16)
    b = Cylinder(3, 6).rotate(Y, 90).translate(0, -1.5, 1.1887)
    union = a + b
    assert union.is_valid()
    assert union.volume == approx(248.435398, rel=1e-6)
    assert (a - b).volume == approx(78.789394, rel=1e-6)


# -- B10: a tool beside an earlier parallel hole --------------------------------------------
def _lens(r1, r2, d):
    """The area two circles of radii r1 and r2, d apart, have in common."""
    a = r1 * r1 * math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
    b = r2 * r2 * math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
    return a + b - 0.5 * math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))


KEY = math.pi * 9 - _lens(6, 3, 8)  # the part of a hole of radius 3 at 8 outside one of radius 6


@pytest.mark.parametrize("make, exact", [
    (lambda: (Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0, 0), 16000 - 360 * math.pi - 10 * KEY),
    (lambda: (Cylinder(20, 40) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0),
     40 * (400 * math.pi - 36 * math.pi - KEY)),
    (lambda: (Box(60, 60, 20) - Cylinder(10, 40)) - Cylinder(4, 40).translate(12, 0, 0),
     72000 - 2000 * math.pi - 20 * (16 * math.pi - _lens(10, 4, 12))),
    (lambda: (Box(40, 40, 10) + Cylinder(6, 20).translate(0, 0, 10)) + Cylinder(3, 20).translate(8, 0, 10),
     16000 + 36 * math.pi * 15 + 15 * KEY),
    (lambda: (Box(40, 40, 10) - Cylinder(6, 30)) & Cylinder(3, 30).translate(8, 0, 0), 10 * KEY),
    (lambda: (Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0), 28160.608174),
    (lambda: (Sphere(20) - Cylinder(6, 60)) & Cylinder(3, 60).translate(8, 0, 0), 929.188),
], ids=["box", "cylinder", "large box", "boss", "intersection", "sphere", "sphere intersection"])
def test_a_tool_beside_an_earlier_parallel_hole(make, exact):
    # These raised KernelError (the box, the cylinder, the boss, the intersection) or ModelingError
    # (the sphere: the kernel's cut was empty, its intersection the whole part); a NURBS copy of the
    # tool gets them right.
    part = make()
    assert part.is_valid()
    assert part.volume == approx(exact, rel=1e-5)


def test_the_nurbs_retry_keeps_the_faces_analytic():
    part = (Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0, 0)
    rounds = sorted((f.geom_type, round(f.radius, 9)) for f in part.faces() if f.geom_type != "plane")
    assert rounds == [("cylinder", 3.0), ("cylinder", 3.0), ("cylinder", 6.0)]
    # Several tools at once are combined first, as before (exact: the tools stay analytic).
    both = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]
    assert both.volume == approx(16000 - 360 * math.pi - 10 * KEY, rel=1e-10)


def test_the_nurbs_retry_only_for_parallel_rounds(monkeypatch):
    tried = []
    retry = Part._nurbs_retry
    monkeypatch.setattr(Part, "_nurbs_retry", lambda self, *a: tried.append(1) or retry(self, *a))
    assert shapes._parallel_rounds(Box(40, 40, 10) - Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0))
    assert not shapes._parallel_rounds(Box(40, 40, 10) - Cylinder(6, 30), Cylinder(3, 30))  # on its axis
    assert not shapes._parallel_rounds(Box(40, 40, 10) - Cylinder(6, 30), Cylinder(3, 60).rotate(X, 90))
    assert not shapes._parallel_rounds(Box(40, 40, 10) - Cylinder(6, 30), Cylinder(3, 30).translate(30, 0, 0))
    with pytest.raises(KernelError):  # the hint's case for a failure the retry does not address
        Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 45) - Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)
    assert tried == [1]


@pytest.mark.skipif(sys.platform == "win32", reason="reads the process's memory with ps")
def test_booleans_that_turn_a_seam_free_their_copies():
    # A turned Boolean runs on copies of the operands and deletes the operands it was given; 100
    # groove pins grow the process by as little as 100 cuts that turn nothing. In a process of its own.
    code = """
import gc, os
from smlibpy import *
def rss():
    return int(os.popen(f"ps -o rss= -p {os.getpid()}").read()) / 1024
bored = Box(30, 30, 30) - Cylinder(5, 60)
pin = Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
for _ in range(10):
    (bored - pin).volume
gc.collect()
before = rss()
for _ in range(100):
    (bored - pin).volume
gc.collect()
print(rss() - before)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr
    grown = float(run.stdout.strip())
    assert grown < 10, f"100 turned cuts took {grown:.1f} MB"  # 0.6 MB each if the operands stayed



# -- B13: empty results are checked without brep_relationship ------------------------------
def _no_relationship(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("brep_relationship was asked")

    monkeypatch.setattr(k, "brep_relationship", refuse)


def test_an_empty_intersection_of_touching_boxes_is_right_wherever_they_are(monkeypatch):
    # brep_relationship called these "touching" at the origin and "interpenetrating" moved, so the
    # same right empty intersection raised there
    _no_relationship(monkeypatch)
    a, b = Box(10, 12, 12), Box(4, 20, 12).rotate(X, 90).translate(7, 0, 4)
    for move in ((0, 0, 0), (101.3, -57.9, 33.1)):
        r = a.translate(*move) & b.translate(*move)
        assert len(r.faces()) == 0


def test_empty_intersections_and_cuts_that_are_right(monkeypatch):
    _no_relationship(monkeypatch)
    cases = [
        lambda: Sphere(5) & Sphere(5).translate(10.5, 0, 0),  # apart
        lambda: Sphere(5) & Sphere(5).translate(10, 0, 0),  # touching at a point
        lambda: Box(20, 20, 10) & Cylinder(3, 20).rotate(X, 90).translate(0, 0, 8),  # along a line
        lambda: (Box(30, 30, 30) - Sphere(8)) & Sphere(8),  # a ball in its cavity (the mesh Booleans fail)
        lambda: Box(10, 10, 10) - Box(10, 10, 10),
        lambda: Box(10, 10, 10) - Sphere(9),  # the corners at 8.66 inside the sphere
        lambda: Cylinder(5, 10) - Cylinder(5, 10),
        lambda: Box(10, 10, 10) - [Box(6, 12, 12).translate(-2.5, 0, 0), Box(6, 12, 12).translate(2.5, 0, 0)],
    ]
    for make in cases:
        assert len(make().faces()) == 0


def test_an_empty_intersection_of_plates_apart_is_quick(monkeypatch):
    # brep_relationship took 10 s for these two plates of 168 faces, 3 apart (the Boolean 0.13 s)
    import time

    plate = Box(400, 200, 10) - [Cylinder(2, 20).translate(x, y, 0) for x in range(-180, 181, 20)
                                 for y in range(-80, 81, 20)]
    other = plate.translate(0, 0, 13)
    t = time.perf_counter()
    assert len((plate & other).faces()) == 0
    assert time.perf_counter() - t < 3


def test_a_wrong_empty_result_is_refused(monkeypatch):
    # The kernel returning nothing for bodies that overlap: brep_relationship calls the spheres
    # "touching" (18.6 in common), which accepted the empty intersection
    a, b = Sphere(7), Sphere(2).translate(6, 3, 0)
    assert k.brep_relationship(a._brep, b._brep)["relationship"] == "touching"
    assert (a & b).volume == approx(18.6016, rel=1e-4)
    monkeypatch.setattr(Part, "_run_boolean", lambda self, tools, op, name: ext.combine([]))
    with pytest.raises(ModelingError, match="empty"):
        a & b
    with pytest.raises(ModelingError, match="empty"):
        Box(10, 10, 10) - Sphere(8.6)  # the tool covers the box's box and volume, not its corners


def test_the_empty_checks_fall_back_to_classifying_points(monkeypatch):
    a, b = Sphere(7), Sphere(2).translate(6, 3, 0)
    monkeypatch.setattr(shapes, "_mesh_overlap", lambda *args, **kwargs: None)
    assert not shapes._empty_is_right(a, [b], k.BooleanOp.INTERSECTION)
    assert shapes._empty_is_right(a, [Sphere(2).translate(9.5, 0, 0)], k.BooleanOp.INTERSECTION)
    assert not shapes._empty_is_right(Box(10, 10, 10), [Sphere(8.6)], k.BooleanOp.DIFFERENCE)
    assert shapes._empty_is_right(Box(10, 10, 10), [Sphere(9)], k.BooleanOp.DIFFERENCE)


# -- B12: parts split along sheets, sheets trimmed by parts --------------------------------
def _wave(span=15.0, width=15.0):
    # z = 2 + 3 sin(x / 6), odd about x = 0 apart from its mean: a box of 20 splits 3200 / 4800
    return surface([[(x, y, 2 + 3 * math.sin(x / 6)) for y in np.linspace(-width, width, 7)]
                    for x in np.linspace(-span, span, 13)])


def test_split_along_a_sheet():
    box, s = Box(20, 20, 20), _wave()
    assert s.faces()[0].normal_at().z > 0  # "above" is the side the normals point to
    above, below = box.split(s, "both")
    assert above.volume == approx(3200, rel=1e-6) and below.volume == approx(4800, rel=1e-6)
    assert above.is_valid() and below.is_valid() and len(above.faces()) == 6
    assert box.split(s).volume == approx(3200, rel=1e-6)
    assert box.split(s, "below").volume == approx(4800, rel=1e-6)
    assert box.split(s.faces()[0], "below").volume == approx(4800, rel=1e-6)  # a face of it
    assert split(box, s).volume == approx(3200, rel=1e-6)
    with pytest.raises(ValueError, match="keep"):
        box.split(s, "middle")


def test_split_extends_a_free_form_sheet_that_ends_inside():
    narrow = _wave(width=5)  # 10 wide in y, in a box 20 wide: extended tangentially
    above, below = Box(20, 20, 20).split(narrow, "both")
    assert above.volume == approx(3200, rel=1e-6) and below.volume == approx(4800, rel=1e-6)


def test_split_along_a_curved_face_of_a_part():
    wall = Cylinder(5, 40).faces().filter_by(lambda f: f.geom_type == "cylinder").one()
    outside, inside = Box(20, 20, 20).split(wall, "both")  # its normals point out of the cylinder
    assert inside.volume == approx(500 * math.pi, rel=1e-6)
    assert outside.volume == approx(8000 - 500 * math.pi, rel=1e-6)


def test_split_by_a_sheet_that_does_not_cut_through():
    s = _wave()
    with pytest.raises(ModelingError, match="does not cut through"):
        Box(20, 20, 20).split(s.translate(0, 0, 50))  # misses the part
    # a plane sheet within the part is extended as its plane (closeout K1); one of two faces is not
    small = Box(4, 4, 4)
    above, below = Box(20, 20, 20).split(small.faces().top().one().to_shell(), "both")
    assert (above.volume, below.volume) == (approx(3200), approx(4800))
    two = stitch(small.faces().top().one(), small.faces().sort_by(X)[-1])
    with pytest.raises(ModelingError, match="does not cut through"):
        Box(20, 20, 20).split(two)


def test_sheets_trimmed_by_parts():
    s, cyl = _wave(), Cylinder(5, 30)
    outside, inside = s - cyl, s & cyl
    assert type(outside) is Shell and type(inside) is Shell
    assert outside.area + inside.area == approx(s.area, rel=1e-6)
    assert inside.area == approx(86.43, rel=1e-3)
    assert (cyl & s).area == approx(inside.area, rel=1e-9)  # also part & sheet
    assert stitch(cyl & s).area == approx(inside.area, rel=1e-9)  # the old workaround still works
    assert len((s & cyl.translate(100, 0, 0)).faces()) == 0
    assert (s - cyl.translate(100, 0, 0)).area == approx(s.area, rel=1e-9)
    assert len((s - Box(100, 100, 100)).faces()) == 0
    with pytest.raises(TypeError, match="trimmed by parts"):
        s - Rectangle(4, 4)


def test_a_part_and_a_sheet_do_not_fuse_or_cut():
    # they returned invalid "Parts" (the sheet imprinted, 11 faces, volume 8000)
    box, s = Box(20, 20, 20), _wave()
    for op in (lambda: box + s, lambda: box - s, lambda: box.fuse(s.faces()[0]), lambda: box - [Box(1, 1, 1), s]):
        with pytest.raises(TypeError, match="split"):
            op()


# -- B14: imprints -----------------------------------------------------------------------
def test_imprint_a_sketch_on_a_face():
    box = Box(20, 20, 10)
    for sketch, patch in ((Rectangle(8, 6), 48.0), (Circle(4), 16 * math.pi)):
        sk = sketch.on(Plane.XY.offset(5))
        r = box.imprint(sk)
        assert r.is_valid() and r.volume == approx(4000, rel=1e-9) and len(r.faces()) == 7
        assert sorted(f.area for f in r.faces().top()) == approx(sorted([patch, 400 - patch]), rel=1e-6)
        assert [f.area for f in r.faces().derived_from(sk)] == approx([patch], rel=1e-6)
    square = box.faces().top().one().to_sketch().scale(0.5, (0, 0, 5))  # a sketch from a face, 10 x 10
    assert sorted(f.area for f in box.imprint(square).faces().top()) == approx([100, 300])


def test_imprint_a_part_and_a_sheet():
    box = Box(20, 20, 10)
    pin = Cylinder(3, 30).rotate(Y, 90)
    r = box.imprint(pin)
    assert r.volume == approx(4000, rel=1e-9) and len(r.faces()) == 8
    assert [f.area for f in r.faces().derived_from(pin)] == approx([9 * math.pi] * 2, rel=1e-6)
    sheet = surface([[(x, y, 1 + 0.02 * x * x) for y in np.linspace(-15, 15, 5)] for x in np.linspace(-15, 15, 7)])
    r = box.imprint(sheet)
    assert r.volume == approx(4000, rel=1e-9) and len(r.faces()) > 6 and r.is_valid()
    later = box.imprint(Rectangle(8, 6).on(Plane.XY.offset(5))) - Cylinder(2, 30).translate(7, 7, 0)
    assert len(later.faces()) == 8  # the split line stays through a later cut


def test_imprint_refuses_a_tool_that_crosses_nothing():
    box = Box(20, 20, 10)
    for tool in (Cylinder(3, 30).translate(100, 0, 0), Box(2, 2, 2)):
        with pytest.raises(ModelingError, match="crosses no face"):
            box.imprint(tool)
    with pytest.raises(TypeError):
        box.imprint(Vector(1, 2, 3))


# -- T3: where faces and edges came from ---------------------------------------------------
def test_new_edges_and_faces_of_a_boolean():
    plate, boss = Box(30, 20, 5), Cylinder(4, 10).translate(0, 0, 5)
    r = plate + boss
    new = r.edges().new(since=[plate, boss])
    assert len(new) == 1 and new[0].geom_type == "circle" and new[0].radius == approx(4)
    assert new[0].center().z == approx(2.5)
    assert len(r.faces().new(since=[plate, boss])) == 0
    assert len(r.edges().new(since=plate)) == 2  # and the boss's top circle (its seam is no edge here)


def test_faces_derived_from_tools_and_split_faces():
    plate = Box(30, 20, 5)
    holes = [Cylinder(2, 10).translate(x, 0, 0) for x in (-10, 10)]
    r = plate - holes
    walls = r.faces().derived_from(holes)
    assert len(walls) == 2 and all(f.geom_type == "cylinder" for f in walls)
    assert [f.center().x for f in r.faces().derived_from(holes[0])] == approx([-10])
    pattern = GridLocations(10, 10, 2, 1) * Cylinder(2, 10)  # moved copies have marks of their own
    cut = Box(30, 30, 5) - pattern
    assert [len(cut.faces().derived_from(c)) for c in pattern] == [1, 1]
    box = Box(40, 30, 10)
    slotted = box - Box(5, 40, 4).translate(0, 0, 4)
    top = slotted.edges().derived_from(box.edges().top())
    assert len(top) == 6 and sum(e.length for e in top) == approx(2 * 30 + 4 * 17.5)
    left, right = Box(30, 20, 5), Box(30, 20, 5).translate(30, 0, 0)
    merged = left + right
    for half in (left, right):  # top, bottom, front and back merged, and an end
        assert len(merged.faces().derived_from(half)) == 5


def test_a_selection_from_before_an_edit():
    # "Edge(line, (-20, 15, 10) -> (20, 15, 10)) is not an edge of this part" before
    box = Box(40, 30, 10)
    top = box.edges().top()
    cut = box - Box(5, 40, 4).translate(0, 0, 4)
    rounded = cut.fillet(top, 1)
    assert rounded.is_valid() and rounded.volume < cut.volume
    rounds = rounded.faces().new(since=cut)
    assert len(rounds) == 6 and all(f.geom_type == "cylinder" and f.radius == approx(1) for f in rounds)
    shelled = cut.shell(-2, box.faces().top())  # both halves of the top face open
    assert shelled.is_valid() and shelled.volume == approx(cut.shell(-2, cut.faces().top()).volume, rel=1e-9)


def test_old_selections_are_measured_as_the_edges_they_stand_for():
    # the fillet's checks measure the pieces and merged edges, not the edges as selected (a merged
    # edge of 80 checked as the 40 selected was "a wrong body", at most 18.885 for 34.336)
    box = Box(40, 30, 10)
    joined = box + Box(40, 30, 10).translate(40, 0, 0)
    long = joined.fillet(box.edges().top().parallel_to(X), 1)
    assert long.is_valid() and long.volume == approx(24000 - 160 * (1 - math.pi / 4), rel=1e-6)
    top = box.edges().top()
    cut = box - Box(5, 40, 4).translate(0, 0, 4)
    per_edge = cut.fillet(top, [1, 1.5, 1, 1.5])  # each piece takes its edge's radius
    assert per_edge.is_valid() and len(per_edge.faces().new(since=cut)) == 6
    assert cut.chamfer(top, 1).is_valid()
    sheet = Box(40, 30, 2)
    edge = sheet.edges().top().max_by(Y)
    with pytest.raises(ValueError, match="got 2"):
        (sheet - Box(4, 4, 4).translate(5, 15, 0)).flange(edge, 10, radius=2)


def test_history_comes_back_from_the_forked_kernel_steps(monkeypatch):
    from smlibpy import defeature

    box = Box(40, 30, 10)
    cut = box - Box(5, 40, 4).translate(0, 0, 4)
    forked = cut.shell(-2, cut.faces().top())
    monkeypatch.setattr(defeature, "GUARD_SECONDS", 0)
    here = cut.shell(-2, cut.faces().top())
    assert len(forked.faces().new(since=cut)) == len(here.faces().new(since=cut)) < len(here.faces())
    floors = forked.faces().derived_from(cut.faces().bottom())  # the bottom, and the floor inside offset from it
    assert sorted(f.center().z for f in floors) == approx([-5, -3])


def test_history_takes_faces_and_edges():
    box = Box(10, 10, 10)
    with pytest.raises(TypeError, match="faces and edges"):
        box.vertices().new(since=box)
    with pytest.raises(TypeError, match="bodies, faces and edges"):
        box.faces().derived_from(Vector(1, 2, 3))
    assert box.faces().derived_from(box.faces().top()) == box.faces().top()
    assert len(box.edges().new(since=box)) == 0 and len(Line((0, 0, 0), (1, 0, 0)).edges().new(since=box)) == 1


def test_tags_reach_no_file(tmp_path):
    part = Box(10, 10, 10) - Cylinder(2, 20)
    copy = part._brep.copy()
    ext.untag_topology(copy)
    part._brep.write_to_file(str(tmp_path / "a.smb"), True)
    copy.write_to_file(str(tmp_path / "b.smb"), True)
    ext.delete_brep(copy)
    assert (tmp_path / "a.smb").read_bytes() == (tmp_path / "b.smb").read_bytes()
    assert part.check() == []  # (the tags' attributes in the kernel's own context)


# -- T4: the kernel's validity checks ------------------------------------------------------
def _lifted():
    # a box whose top face lies 0.002 above its walls, stitched within 0.01: valid for is_valid()
    faces = Box(20, 20, 20).faces()
    return stitch([f.to_shell().translate(0, 0, 0.002 if f.normal_at().z > 0.5 else 0) for f in faces], tolerance=0.01)


def test_check_names_the_problem():
    part = _lifted()
    assert isinstance(part, Part) and part.is_valid()
    problems = part.check()
    assert len(problems) == 4 and all(isinstance(p, Problem) for p in problems)
    p = problems[0]
    assert p.test == "Bad Vertex Gap" and p.category == "geometric"
    assert isinstance(p.shape, Vertex) and p.shape.z == approx(10, abs=1e-9)
    assert p.value == approx(0.002, rel=1e-6) and p.tolerance == approx(2e-5)
    assert "0.002" in p.message
    assert not part.is_valid(strict=True)
    assert max(e.tolerance for e in part.edges()) == approx(0.004)
    with pytest.raises(ValueError, match="level"):
        part.check(3)


def test_check_finds_nothing_on_generated_parts():
    part = (Box(30, 20, 10) - Cylinder(4, 20)).fillet((Box(30, 20, 10) - Cylinder(4, 20)).edges().top(), 1)
    for x in (part, part.shell(-1, part.faces().bottom()), Box(10, 10, 10).scale((1, 2, 3)), Torus(10, 3)):
        assert x.check() == [] and x.check(0) == [] and x.is_valid(strict=True)
    assert Box(10, 10, 10).edges()[0].tolerance == approx(1e-5)
    assert Box(10, 10, 10).vertices()[0].tolerance == approx(1e-5)
    with pytest.raises(ValueError, match="no body"):
        Line((0, 0, 0), (1, 0, 0)).tolerance
    with pytest.raises(ValueError, match="no body"):
        Vertex(1, 2, 3).tolerance


# the faces of a box moved apart by up to 0.1
SHIFTS = [(-0.0524, 0.0088, -0.026), (0.0208, 0.0251, -0.0869), (-0.0974, 0.0675, -0.0481),
          (-0.0531, 0.0991, -0.0059), (0.0673, -0.0047, 0.0278), (-0.0699, 0.027, 0.0736)]


def test_a_healed_closed_sheet_is_a_part():
    faces = Box(20, 20, 20).faces()
    sewn = stitch([f.to_shell().translate(*d) for f, d in zip(faces, SHIFTS)], tolerance=0.5)
    assert type(sewn) is Part  # (stitch gives the solid it sews shut, lane U: U5)
    sheet = Shell._wrap(sewn._copy_brep())  # the same faces as a sheet
    healed = sheet.heal()
    assert type(healed) is Part and healed.is_valid()
    with pytest.warns(RuntimeWarning, match="do not meet exactly"):
        assert healed.volume == approx(8000, rel=2e-2)
    assert healed.check()  # its edges are far from tight
    assert type(_wave().heal()) is Shell


# -- B15: the cells of a merged part know the parts they lie in --------------------------------
def _steel_and_brass():
    return Box(40, 40, 20).named("steel").colored("gray"), Cylinder(6, 30).named("brass").colored("gold")


def test_cells_are_named_after_the_parts_they_lie_in():
    # Every cell was named and colored as the first part: 4 cells, all "steel", "gray".
    steel, brass = _steel_and_brass()
    m = merge(steel, brass)
    cells = sorted(m.cells(), key=lambda c: (-c.volume, c.center().z))
    insert = math.pi * 36 * 20
    assert [c.volume for c in cells] == [approx(32000 - insert), approx(insert), approx(insert / 4), approx(insert / 4)]
    assert [(c.name, c.color) for c in cells] == [("steel", "gray"), ("steel&brass", "gold"), ("brass", "gold"),
                                                  ("brass", "gold")]
    assert [tuple(s.name for s in c.sources) for c in cells] == [("steel",), ("steel", "brass"), ("brass",), ("brass",)]
    assert cells[1].sources[0] is steel and cells[1].sources[1] is brass
    assert m.cell_at((0, 0, 12)).name == "brass" and m.cell_at((10, 10, 0)).name == "steel"
    assert Box(1, 1, 1).sources == () and m.sources == ()


def test_cells_of_moved_renamed_and_chained_merges():
    steel, brass = _steel_and_brass()
    m = merge(steel, brass)
    moved = m.translate(100, 0, 0).rotate(Z, 30).scale(2).named("assembly")
    names = sorted((c.name, round(c.volume, 1)) for c in moved.cells())
    assert names == sorted((c.name, round(8 * c.volume, 1)) for c in m.cells())
    pin = Cylinder(2, 50).rotate(X, 90).named("pin").colored("red")
    chained = m.merge(pin)
    found = {c.name for c in chained.cells()}
    assert found == {"steel", "brass", "pin", "steel&brass", "steel&pin", "steel&brass&pin"}
    assert all(c.color == "red" for c in chained.cells() if "pin" in c.name)
    # parts without names: the merged part's name and color, as before
    plain = Box(10, 10, 10).merge(Box(10, 10, 10).translate(5, 0, 0)).named("x").colored("blue")
    assert {(c.name, c.color) for c in plain.cells()} == {("x", "blue")}
    assert sorted(len(c.sources) for c in plain.cells()) == [1, 1, 2]


def test_step_writes_the_cells_with_their_names_and_colors(tmp_path):
    steel, brass = _steel_and_brass()
    path = tmp_path / "cells.step"
    export_step(merge(steel, brass), path)
    text = path.read_text()
    assert sorted(re.findall(r"MANIFOLD_SOLID_BREP\('([^']*)'", text)) == ["brass", "brass", "steel", "steel&brass"]
    back = import_step(path)
    assert sorted((b.name, b.color, round(b.volume, 1)) for b in back) == sorted(
        (c.name, to_rgb(c.color), round(c.volume, 1)) for c in merge(steel, brass).cells())
    # in another unit, the scaled copy keeps them
    export_step(merge(steel, brass), tmp_path / "cm.step", unit="cm")
    assert "steel&brass" in (tmp_path / "cm.step").read_text()


# -- B16: solids() separates a body inside a cavity ----------------------------------------------
def test_solids_separates_a_body_in_a_cavity():
    caged = (Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)  # was one solid of 7064
    solids = caged.solids()
    assert [s.volume for s in solids] == [approx(7000), approx(64)] and all(s.is_valid() for s in solids)
    nested = ((Sphere(20) - Sphere(15)) + (Sphere(10) - Sphere(6))) + Sphere(3)
    assert sorted(s.volume for s in nested.solids()) == approx(sorted(c.volume for c in nested.cells()))
    assert len(nested.solids()) == 3
    # touching cells of a merged part stay one solid; cells that touch inside a cage stay together
    assert [s.volume for s in Box(10, 10, 10).merge(Box(10, 10, 10).translate(10, 0, 0)).solids()] == [approx(2000)]
    cage = Box(30, 30, 30) - Box(20, 20, 20)
    inside = merge(cage, Box(6, 6, 6), Box(6, 6, 6).translate(6, 0, 0)).solids()
    assert sorted(s.volume for s in inside) == [approx(432), approx(19000)]
    assert [s.volume for s in (Box(10, 10, 10) + Box(10, 10, 10).translate(20, 0, 0)).solids()] == [approx(1000)] * 2


# -- B17: the edges where two bodies meet ---------------------------------------------------------
def test_edges_joining_two_bodies():
    plate = Box(40, 40, 10)
    standing = Cylinder(5, 10).translate(0, 0, 10)  # its bottom face on the plate's top
    joined = plate + standing
    assert len(joined.edges().new(since=[plate, standing])) == 0  # the circle is the boss's own edge
    rim = joined.edges().joining(plate, standing)
    assert len(rim) == 1 and rim[0].geom_type == "circle" and rim[0].length == approx(10 * math.pi)
    rounded = joined.fillet(rim, 2)
    assert rounded.is_valid() and rounded.volume > joined.volume
    through = Cylinder(5, 20).translate(0, 0, 10)
    assert len((plate + through).edges().joining(plate, through)) == 1
    hole = Cylinder(5, 40).rotate(X, 30)
    rims = (plate - hole).edges().joining(plate, hole)
    assert sorted(round(e.length, 4) for e in rims) == [8.4724, 8.4724, 25.4172, 25.4172]
    assert all(e.geom_type == "ellipse" for e in rims)
    a, b = Box(10, 10, 10), Box(10, 10, 10).translate(10, 0, 0)
    assert len((a + b).edges().joining(a, b)) == 0
    step = Box(10, 10, 5).translate(5, 0, -2.5)
    corner = (a + step).edges().joining(a, step)
    assert len(corner) == 1 and corner[0].length == approx(10)
    holes = [Cylinder(2, 20).translate(x, 0, 0) for x in (-10, 0, 10)]
    assert len((plate - holes).edges().joining(plate, holes)) == 6
    with pytest.raises(TypeError, match="selects edges"):
        joined.faces().joining(plate, standing)
    with pytest.raises(TypeError, match="takes bodies"):
        joined.edges().joining(plate, (1, 2, 3))


# -- B18: sections by planes that only touch ------------------------------------------------------
@pytest.mark.parametrize("part, plane", [
    (lambda: Cylinder(5, 20), Plane.XZ.offset(5)),  # was KernelError: section failed (SM_ERR)
    (lambda: Cylinder(5, 20), Plane.XZ.offset(-5)),
    (lambda: Box(10, 10, 10).rotate(Z, 45), Plane.YZ.offset(50 ** 0.5)),  # through an edge
    (lambda: Torus(10, 2), Plane.XY.offset(2)),  # was a disc of 314.159 that is not in the torus
    (lambda: Cylinder(5, 20).merge(Cylinder(5, 20).translate(20, 0, 0)), Plane.XZ.offset(5)),
], ids=["cylinder", "cylinder below", "box edge", "torus top", "two cylinders"])
def test_a_plane_that_only_touches_has_no_section(part, plane):
    with pytest.raises(ValueError, match="only touches the part"):
        part().section(plane)


def test_sections_by_planes_on_faces_and_inside():
    assert Box(10, 10, 10).section(Plane.XY.offset(5)).area == approx(100)  # a plane on a face: that face
    assert Cylinder(5, 20).section(Plane.XZ).area == approx(200)
    with pytest.raises(ValueError, match="does not cut"):
        Cylinder(5, 20).section(Plane.XZ.offset(6))
    # tangent to the wall of a hole inside the part: the kernel fails; the hint says to move the plane
    with pytest.raises(KernelError, match="move the plane a little"):
        (Box(20, 20, 10) - Cylinder(3, 20)).section(Plane.XZ.offset(3))


# -- B19: error hints from what the operands show --------------------------------------------------
def test_boolean_hints_say_what_the_operands_show(monkeypatch):
    # In 830 fuzz cases every Boolean error advised combining tools, though each had one tool.
    with pytest.raises(ModelingError, match="touch only along an edge") as e:
        Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)
    assert "combine" not in str(e.value)
    # a cylinder flush with a side face and with the top: both found, nothing about combining
    with pytest.raises(ModelingError) as e:
        Box(6, 16, 4) - Cylinder(1.5, 30).translate(-1.5, 0, -13)
    msg = str(e.value)
    assert "touches a face of the part tangentially (near (-3," in msg and "(at z = 2)" in msg
    assert "combine" not in msg and "touch only" not in msg
    # beside an earlier parallel hole, where the NURBS retry does not help either
    monkeypatch.setattr(Part, "_nurbs_retry", lambda self, *a: None)
    with pytest.raises(KernelError, match="combine the tools first") as e:
        Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)
    assert "tangentially" not in str(e.value)


def test_crashes_and_null_pointers_are_not_blamed_on_sizes():
    e = KernelError("cut", "SmApiBoolean failed: SM_ERR_NULL_POINTER", "SM_ERR_NULL_POINTER", "x")
    assert shapes._crash_note(e, "cut") == "the kernel failed inside the cut (it met a null pointer of its own)"
    e = KernelError("fillet", "the kernel crashed (table index is out of bounds)", None, "x")
    assert shapes._crash_note(e, "fillet") == "the kernel crashed in the fillet (table index is out of bounds)"
    assert shapes._crash_note(KernelError("cut", "SM_ERR", "SM_ERR"), "cut") is None
    # fuzz case fillet-7-161: a radius of 0.4956 that fits, and "the radius may be too large"
    part = Torus(8, 1.5) - Sphere(2.5).translate(7, 7, -2.8573)
    with pytest.raises(KernelError) as err:
        part.fillet(part.edges(), 0.495553)
    if err.value.status == "SM_ERR_NULL_POINTER":
        assert "says nothing about the radius" in str(err.value) and "too large" not in str(err.value)


def test_shell_and_cells_hints_name_the_place():
    holed = Box(30, 30, 10) - Cylinder(1, 20)
    with pytest.raises(KernelError, match=r"the hole or inside round at \(.*\) has a radius of 1, less than the wall of 2"):
        holed.shell(2, outward=True)
    slab = Box(40, 40, 5)
    hint = slab._shell_hint([], 2.0, slab._inward_rays([]), False)
    assert hint.startswith("the part is 5 thick across the face at (") and "two walls of 2" in hint
    assert Box(40, 40, 40)._shell_hint([], 2.0, Box(40, 40, 40)._inward_rays([]), False) == \
        "the wall may be thicker than the part allows"
    with pytest.raises(ModelingError, match=r"the insert at \(6, .*\) touches the part around it") as e:
        Box(20, 20, 20).merge(Cylinder(4, 10).translate(6, 0, 0)).cells()
    assert "combine" not in str(e.value) and "tool" not in str(e.value)


def test_hints_and_empty_checks_avoid_the_crashing_mesh_boolean():
    # The kernel's Boolean of the meshes of these cylinders, tangent inside each other, kills the
    # process at a tenth of tessellate's tolerance (also on origin/next); the hint and the check of
    # empty results asked it. In a process of its own.
    code = """
from smlibpy import *
from smlibpy import shapes
from smlibpy._kernel import k
a = Cylinder(4, 8).rotate(X, 90); b = Cylinder(1.5, 4).rotate(X, 90).translate(-2.5, 2.0, 0.0)
try:
    a - b
except ModelingError as e:
    print("tangentially" in str(e))
print(shapes._empty_is_right(a, [b], k.BooleanOp.INTERSECTION))
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr
    assert run.stdout.split() == ["True", "False"]


def test_classified_empty_sees_long_triangles():
    # The side of the cylinder is a few triangles from end to end, whose corners and middles all lie
    # outside the box: the overlap was missed, and the cut above was said to only touch.
    box, pin = Box(6, 16, 4), Cylinder(1.5, 30).translate(-1.5, 0, -13)
    assert not shapes._classified_empty(box, [pin], k.BooleanOp.INTERSECTION)


# -- T5: colors and names of single faces --------------------------------------------------
RED, GOLD = to_rgb("red"), to_rgb("gold")


def _painted():
    tool = Cylinder(5, 20)
    tool = tool.colored("red", faces=tool.faces().cylinders())     # the hole walls it will cut
    plate = (Box(60, 40, 8) - tool).colored("steelblue")
    plate = plate.colored("gold", faces=plate.faces().top()).named("seal", faces=plate.faces().bottom())
    return plate


def _own(part):
    return sorted(((f.geom_type, f.color, f.name) for f in part.faces() if f.color or f.name), key=repr)


def test_faces_keep_their_colors_and_names_through_operations():
    plate = _painted()
    assert plate.color == "steelblue" and plate.name is None              # the body's own stay
    assert _own(plate) == sorted([("cylinder", RED, None), ("plane", None, "seal"), ("plane", GOLD, None)], key=repr)
    assert plate.faces().top()[0].color == GOLD and plate.faces().bottom()[0].name == "seal"
    assert plate.check() == [] and plate.is_valid()
    assert plate.volume == approx(60 * 40 * 8 - math.pi * 25 * 8, rel=1e-12)
    # a fillet keeps the faces' (its rounds have none), so do moves, mirrors and other scales
    rounded = plate.fillet(plate.edges().top(), 1)
    assert _own(rounded) == _own(plate)
    for moved in (plate.translate(10, 0, 0).rotate(Z, 30), plate.mirror(Plane.YZ), plate.scale(2), plate.scale((1, 2, 1))):
        assert [(c, n) for _, c, n in _own(moved)] == [(c, n) for _, c, n in _own(plate)]
    # a Boolean splits the top: both pieces keep the color
    split = plate - Box(10, 50, 20)
    assert [f.color for f in split.faces().top()] == [GOLD, GOLD]
    # a shell (a step in a forked copy of the process) carries them back; the offsets of colored
    # faces descend from them and keep theirs
    shelled = plate.shell(-1, plate.faces().bottom())
    assert sum(1 for f in shelled.faces() if f.color == GOLD) == 2 and sum(1 for f in shelled.faces() if f.color == RED) == 2
    assert shelled.volume == approx(plate.volume - (58 * 38 * 7 - math.pi * 36 * 7), rel=1e-6)
    # None takes them off; faces of an earlier version stand for their pieces (T3)
    plain = split.colored(None, faces=plate.faces().top())
    assert [f.color for f in plain.faces().top()] == [None, None]
    assert plain.named(None, faces=plain.faces().bottom()).faces().bottom()[0].name is None
    with pytest.raises(ValueError, match="no faces selected"):
        plate.colored("red", faces=[])
    with pytest.raises(ValueError, match="is not a face of this part"):
        plate.colored("red", faces=Box(5, 5, 5).translate(100, 0, 0).faces())
    with pytest.raises(TypeError, match="a name is a string"):
        plate.named(3, faces=plate.faces().top())


def test_face_colors_and_names_in_files(tmp_path):
    hollow = Box(40, 30, 10) - Box(10, 10, 4)
    wall = hollow.faces().derived_from(hollow.shells()[1])
    part = _painted()
    export_step(part, tmp_path / "plate.step")
    text = (tmp_path / "plate.step").read_text()
    assert text.count("STYLED_ITEM(") == 3 and "ADVANCED_FACE('seal'," in text      # the body, the top, the hole
    back = import_step(tmp_path / "plate.step")
    assert _own(back) == _own(part) and back.color == approx(to_rgb("steelblue"))
    # the faces of a cavity (a BREP_WITH_VOIDS) too
    hollow = hollow.colored("lime", faces=wall)
    export_step(hollow, tmp_path / "hollow.step")
    back = import_step(tmp_path / "hollow.step")
    assert sorted(round(f.area, 6) for f in back.faces() if f.color == to_rgb("lime")) == [40, 40, 40, 40, 100, 100]
    # glTF: a primitive per color (the body's, red, gold) and the edges
    from smlibpy.exporters import _linear_rgb, gltf_document

    doc, _ = gltf_document(part)
    colors = [m["pbrMetallicRoughness"]["baseColorFactor"][:3] for m in doc["materials"]]
    # (glTF holds linear values, lane M: GLTF-COLOR)
    assert colors[:3] == [approx(list(_linear_rgb(c))) for c in ("steelblue", RED, GOLD)]
    assert [p["mode"] for p in doc["meshes"][0]["primitives"]] == [4, 4, 4, 1]
    # USD: a color per triangle of the mesh
    export_usd(part, tmp_path / "plate.usda")
    usd = (tmp_path / "plate.usda").read_text()
    mesh = usd[usd.index('def Mesh "body_mesh"'):]
    assert 'interpolation = "uniform"' in mesh and "(1, 0, 0)" in mesh
    triangles = mesh[mesh.index("faceVertexCounts = ["):].split("]")[0].count("3")
    colors = mesh[mesh.index("displayColor = ["):].split("] (")[0].count("(")
    assert colors == triangles
    # pictures: the top red, the sides blue, also cut open by a section
    slab = Box(20, 20, 4).colored("blue")
    slab = slab.colored("red", faces=slab.faces().top())
    r, g, b = (int(x) for x in render(slab, view="top", size=(160, 120), edges=False).pixels[60, 80])
    assert r > 120 and g < 60 and b < 60, (r, g, b)
    px = render(slab, size=(160, 120), edges=False, section=Plane.XZ).pixels.astype(int)
    red = (px[..., 0] > 150) & (px[..., 1] < 60) & (px[..., 2] < 60)
    blue = (px[..., 2] > 100) & (px[..., 0] < 100)
    assert red.sum() > 800 and blue.sum() > 300            # the top, and the sides and the cut
    r, g, b = (int(x) for x in render(Box(20, 20, 4).colored("blue"), view="top", size=(160, 120), edges=False).pixels[60, 80])
    assert b > 120 and r < 60


def test_face_colors_of_other_writers(tmp_path):
    # A STYLED_ITEM on one ADVANCED_FACE of a file (as SolidWorks, NX and OpenCASCADE write them)
    export_step(Box(10, 10, 10), tmp_path / "box.step")
    text = (tmp_path / "box.step").read_text()
    face = int(re.search(r"#(\d+)=ADVANCED_FACE\(", text).group(1))
    ctx = int(re.search(r"#(\d+)=\(GEOMETRIC_REPRESENTATION_CONTEXT", text).group(1))
    styled = (f"#9001=COLOUR_RGB('',0.,0.,1.);\n#9002=FILL_AREA_STYLE_COLOUR('',#9001);\n#9003=FILL_AREA_STYLE('',(#9002));\n"
              f"#9004=SURFACE_STYLE_FILL_AREA(#9003);\n#9005=SURFACE_SIDE_STYLE('',(#9004));\n"
              f"#9006=SURFACE_STYLE_USAGE(.BOTH.,#9005);\n#9007=PRESENTATION_STYLE_ASSIGNMENT((#9006));\n"
              f"#9008=OVER_RIDING_STYLED_ITEM('color',(#9007),#{face},#{face});\n"
              f"#9009=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#9008),#{ctx});\n")
    (tmp_path / "blue.step").write_text(text.replace("ENDSEC;\nEND-ISO", styled + "ENDSEC;\nEND-ISO", 1))
    back = import_step(tmp_path / "blue.step")
    assert [f.color for f in back.faces() if f.color] == [(0.0, 0.0, 1.0)] and back.color is None


def test_face_colors_read_by_opencascade(tmp_path):
    STEPCAFControl = pytest.importorskip("OCP.STEPCAFControl")
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.Quantity import Quantity_Color
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDocStd import TDocStd_Document
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool

    def static(cls, name):  # (OCP names static methods with _s, older builds without)
        return getattr(cls, name + "_s", None) or getattr(cls, name)

    export_step(_painted(), tmp_path / "plate.step")
    doc = TDocStd_Document(TCollection_ExtendedString("doc"))
    reader = STEPCAFControl.STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.ReadFile(str(tmp_path / "plate.step"))
    reader.Transfer(doc)
    colors = static(XCAFDoc_DocumentTool, "ColorTool")(doc.Main())
    areas: dict = {}
    ex = TopExp_Explorer(reader.Reader().OneShape(), TopAbs_FACE)
    while ex.More():
        face, c = static(TopoDS, "Face")(ex.Current()), Quantity_Color()
        props = GProp_GProps()
        static(BRepGProp, "SurfaceProperties")(face, props)
        key = (round(c.Red(), 3), round(c.Green(), 3), round(c.Blue(), 3)) \
            if colors.GetColor(face, XCAFDoc_ColorType.XCAFDoc_ColorSurf, c) else None
        areas[key] = areas.get(key, 0.0) + props.Mass()
        ex.Next()
    # (OpenCASCADE gives linear RGB: the gold of the top, (1, 0.843, 0) in sRGB, reads (1, 0.68, 0))
    assert areas.pop((1.0, 0.0, 0.0)) == approx(2 * math.pi * 5 * 8, rel=1e-6)
    gold = [area for key, area in areas.items() if key is not None]
    assert gold == [approx(60 * 40 - math.pi * 25, rel=1e-6)]


# -- T6: analytic faces after a scale that differs between the axes -----------------------
def test_scales_along_the_axes_keep_planes_and_cylinders(tmp_path):
    box = Box(10, 10, 10).scale((2, 1, 1))
    assert [f.geom_type for f in box.faces()] == ["plane"] * 6 and {e.geom_type for e in box.edges()} == {"line"}
    assert box.volume == approx(2000, rel=1e-14) and box.check() == []
    tall = Cylinder(5, 10).scale((1, 1, 2))           # was 3 B-spline faces, volume 1570.795256 (-6.8e-7)
    assert [f.geom_type for f in tall.faces()] == ["cylinder", "plane", "plane"]
    assert tall.faces().cylinders()[0].radius == approx(5, abs=1e-12)
    assert tall.volume == approx(math.pi * 25 * 20, rel=1e-13) and tall.check() == []
    flat = Cylinder(5, 10).scale((2, 1, 1))           # an elliptic cylinder: a surface of extrusion
    assert [f.geom_type for f in flat.faces()] == ["extrusion", "plane", "plane"]
    assert flat.volume == approx(math.pi * 10 * 5 * 10, rel=1e-13)
    egg = Sphere(5).scale((1, 1, 2))
    assert [f.geom_type for f in egg.faces()] == ["revolution"] and egg.volume == approx(4 / 3 * math.pi * 250, rel=1e-13)
    holed = (Box(20, 20, 10) - Cylinder(3, 20)).scale((1.5, 1, 1))
    assert sorted(f.geom_type for f in holed.faces()) == ["extrusion"] + ["plane"] * 6
    assert holed.volume == approx(1.5 * (4000 - math.pi * 90), rel=1e-13)
    # STEP files get the analytic surfaces
    export_step(tall, tmp_path / "tall.step")
    text = (tmp_path / "tall.step").read_text()
    assert "CYLINDRICAL_SURFACE" in text and "B_SPLINE_SURFACE" not in text
    assert import_step(tmp_path / "tall.step").volume == approx(math.pi * 500, rel=1e-13)
    # a body with nothing to recognize is left as it is
    plain = Box(1, 1, 1)
    assert ext.recognize_analytics(plain._brep, 1e-9) is None
    ellipsoid = Sphere(5).scale((2, 1, 1))            # no analytic surface: a B-spline, as before
    assert [f.geom_type for f in ellipsoid.faces()] == ["bspline"]
    assert ellipsoid.volume == approx(4 / 3 * math.pi * 250, rel=1e-12)


# -- T7: shells, cavities and the cells a face bounds ---------------------------------------
def test_shells_voids_and_the_cells_of_faces():
    hollow = Box(20, 20, 20) - Box(6, 6, 6)
    assert hollow.info()["solids"] == 1 and hollow.info()["voids"] == 1
    outside, wall = hollow.shells()
    assert isinstance(wall, Shell) and len(outside.faces()) == 6 and wall.area == approx(216)
    assert len(wall.edges()) == 12 and len(outside.edges()) == 12          # joined: closed sheets
    assert [v.volume for v in hollow.voids()] == [approx(216)]
    assert hollow.volume + sum(v.volume for v in hollow.voids()) == approx(8000)
    walls = hollow.faces().derived_from(wall)              # the cavity's faces of the part itself
    assert len(walls) == 6 and all(f.owner is hollow for f in walls)
    assert {f.cells for f in hollow.faces()} == {(0,)}
    # a body floating in the cavity: two solids, the cavity less the body
    caged = (Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)
    assert caged.info()["solids"] == 2 == len(caged.solids()) and caged.info()["voids"] == 1
    assert [v.volume for v in caged.voids()] == [approx(936)] and len(caged.shells()) == 3
    nested = Sphere(10) - Sphere(8) + Sphere(5) - Sphere(3)
    assert sorted(round(v.volume, 6) for v in nested.voids()) == [approx(4 / 3 * math.pi * 27), approx(4 / 3 * math.pi * (512 - 125))]
    assert nested.info()["solids"] == 2
    # the faces between two cells of a merged part
    m = merge(Box(40, 40, 20), Cylinder(6, 30))
    shared = m.faces().shared()
    assert sorted(f.geom_type for f in shared) == ["cylinder", "plane", "plane"]
    assert sorted(f.cells for f in shared) == [(0, 1), (1, 2), (1, 3)] and len(m.cells()) == 4
    assert m.info()["solids"] == 1 and m.info()["voids"] == 0 and len(m.shells()) == 1
    assert (Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)).info()["solids"] == 2
    assert Box(10, 10, 10).voids() == [] and Box(10, 10, 10).faces()[0].to_shell().faces()[0].cells == ()
    with pytest.raises(TypeError, match="shared selects faces"):
        m.edges().shared()
    assert "solids" not in Rectangle(4, 4).info()


# -- T8: named() and colored() share the Brep ---------------------------------------------
def test_named_and_colored_share_the_brep_not_the_identity():
    part = Box(40, 30, 20) - Cylinder(5, 50)
    volume = part.volume
    named = part.named("block").colored("red")
    assert named._h is part._h and named._h.props is part._h.props       # no copy, measures kept
    assert named.volume == volume and named.name == "block" and part.name is None and part.color is None
    assert named != part and len({named, part}) == 2 and named not in ShapeList([part])
    assert len(ShapeList([part, named]) - [part]) == 1
    assert named.faces()[0] == part.faces()[0]                          # the same kernel faces
    assert named.fillet(part.edges().top(), 1).is_valid()
    # a sketch keeps its plane
    s = Rectangle(10, 4).on(Plane.XZ).named("r")
    assert s.plane.z_dir == Plane.XZ.z_dir and s._h is not None
