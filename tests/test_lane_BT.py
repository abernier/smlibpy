"""Booleans along seams and beside earlier holes (kernel plan B6, B4 and B10); empty Boolean results
checked without the kernel's brep_relationship (B13); parts split along sheets and sheets trimmed by
parts (B12); imprints (B14); where faces and edges came from (T3); the kernel's validity checks (T4).

Exact volumes come from integrating the overlaps of the operands (the cross sections of two
cylinders, a sphere and a cylinder), not from the kernel; OpenCASCADE's volume is given where it
differs from that by more than 1e-6.
"""

import math
import subprocess
import sys

import numpy as np
import pytest
from pytest import approx

from smlibpy import *
from smlibpy import shapes
from smlibpy._kernel import ext, k

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
    assert ext.seam_contacts(_pin(5, 45)._brep, bored._brep) == []
    assert ext.seam_contacts(bored._brep, pin._brep) == []  # the bore's seam lies away from the pin
    # Where the faces touch (the seam is the line along which they touch) it is no contact: a cylinder
    # tangent to a flat face along its seam, a cylinder touching a hole at a point of its seam.
    assert ext.seam_contacts(Cylinder(3, 40).translate(7, 0, 0)._brep, Box(20, 20, 20)._brep) == []
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
    inside = Box(4, 4, 4).faces().top().one().to_shell()  # a plane sheet within the part: not extended
    with pytest.raises(ModelingError, match="does not cut through"):
        Box(20, 20, 20).split(inside)


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
    sheet = stitch([f.to_shell().translate(*d) for f, d in zip(faces, SHIFTS)], tolerance=0.5)
    assert type(sheet) is Shell
    healed = sheet.heal()
    assert type(healed) is Part and healed.is_valid()
    with pytest.warns(RuntimeWarning, match="do not meet exactly"):
        assert healed.volume == approx(8000, rel=2e-2)
    assert healed.check()  # its edges are far from tight
    assert type(_wave().heal()) is Shell
