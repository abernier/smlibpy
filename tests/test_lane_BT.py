"""Booleans along seams and beside earlier holes (kernel plan B6, B4 and B10).

Exact volumes come from integrating the overlaps of the operands (the cross sections of two
cylinders, a sphere and a cylinder), not from the kernel; OpenCASCADE's volume is given where it
differs from that by more than 1e-6.
"""

import math
import subprocess
import sys

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
