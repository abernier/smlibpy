"""Close-out K2 of the kernel plan's phase 1 (ai/plan/kernel-deep-dive.md, "Not done"): memory
errors and leaks of the kernel's offset, fillet, sweep and fill code (third_party/patches/README.md
says what each patch changes; tools/sanitize/run.py checks them under AddressSanitizer)."""

from __future__ import annotations

import ctypes
import gc
import math
import subprocess
import sys
import textwrap
from pathlib import Path

import numpy as np
import pytest

from smlibpy import (
    Axis,
    Box,
    Circle,
    Cone,
    Cylinder,
    KernelError,
    Plane,
    Polyline,
    Rectangle,
    Spline,
    ThreePointArc,
    Vector,
    export_step,
    fill,
    sweep,
)

HERE = Path(__file__).resolve().parent


def _heap() -> int | None:
    """Bytes the C allocator holds (None where this platform has no statistics)."""
    if sys.platform == "darwin":
        class Stats(ctypes.Structure):
            _fields_ = [("blocks_in_use", ctypes.c_uint), ("size_in_use", ctypes.c_size_t),
                        ("max_size_in_use", ctypes.c_size_t), ("size_allocated", ctypes.c_size_t)]

        stats = Stats()
        libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        libc.malloc_zone_statistics(None, ctypes.byref(stats))
        return int(stats.size_in_use)
    if sys.platform.startswith("linux"):
        class Info(ctypes.Structure):
            _fields_ = [(name, ctypes.c_size_t) for name in
                        ("arena", "ordblks", "smblks", "hblks", "hblkhd", "usmblks", "fsmblks", "uordblks", "fordblks",
                         "keepcost")]

        libc = ctypes.CDLL(None)
        if not hasattr(libc, "mallinfo2"):
            return None
        libc.mallinfo2.restype = Info
        info = libc.mallinfo2()
        return int(info.uordblks + info.hblkhd)
    return None


def _per_call(make, calls: int = 20) -> float:
    """Bytes the C allocator keeps per call of ``make``: the least of three runs of ``calls`` calls,
    after three calls to warm up. A leak keeps as much in each run; what fills once and then stays
    (numpy's cache of small buffers, the allocator's own pools) keeps it in one run only. CI's macOS
    kept about 100 kB in some runs whatever their length (9882 bytes a fill over 10 fills, in both
    of two runs; 993 bytes a taper over 100), so each test's limit allows 100 kB over its calls and
    still lies well under the leak it guards against."""
    if _heap() is None:
        pytest.skip("no allocator statistics here")
    for _ in range(3):
        make()
    gc.collect()
    kept = []
    for _ in range(3):
        before = _heap()
        for _ in range(calls):
            make()
        gc.collect()
        kept.append((_heap() - before) / calls)
    return min(kept)


def _three_arcs():
    r = 10.0
    s = r / math.sqrt(2)
    return [ThreePointArc((r, 0, 0), (s, s, 0), (0, r, 0)), ThreePointArc((0, r, 0), (0, s, s), (0, 0, r)),
            ThreePointArc((0, 0, r), (s, 0, s), (r, 0, 0))]


def _five_splines():
    pts = [(10 * math.cos(2 * math.pi * i / 5), 10 * math.sin(2 * math.pi * i / 5), 0) for i in range(5)]
    return [Spline(pts[i], tuple((np.array(pts[i]) + np.array(pts[(i + 1) % 5])) / 2 + [0, 0, 2]), pts[(i + 1) % 5])
            for i in range(5)]


@pytest.mark.parametrize("sides", [3, 5])
def test_n_sided_fills_free_their_work_arrays(sides):
    # The kernel's N-sided fill (N_FillNSidedHole, behind fill() of three or five and more sides)
    # never freed the stack it did its work on: 92 kB a fill of these three arcs (an octant of a
    # sphere), 23 kB of the five splines, 1 MB for others (macOS, the WebAssembly build alike;
    # 0.4 too).
    curves = _three_arcs() if sides == 3 else _five_splines()
    patch = fill(curves)
    assert len(patch.faces()) == sides
    for c in curves:
        assert max(patch.distance_to(c.point_at(i / 8)) for i in range(9)) < 1e-6
    per_call = _per_call(lambda: fill(curves), calls=30)
    assert per_call < 8192, f"{per_call:.0f} bytes a fill"


def test_fillets_along_tangent_edges_free_their_curves():
    # The fillet executive joins the curves of tangent edges into one and gives each edge a copy;
    # no edge owned them, and they were lost with the caches the corners built on them: 189 kB a
    # fillet of a rounded plate's top run, the selection propagate=True makes from one edge.
    plate = Rectangle(40, 30, fillet=5).extrude(10)
    edge = plate.edges().filter_by(lambda e: e.center().z > 9.9 and e.geom_type == "line").sort_by(lambda e: -e.length)[0]
    rounded = plate.fillet(edge, 1)
    assert rounded.is_valid() and rounded.volume < plate.volume
    per_call = _per_call(lambda: plate.fillet(edge, 1))
    assert per_call < 16384, f"{per_call:.0f} bytes a fillet"


def test_refused_fillets_free_their_intersections_and_surfaces():
    # A fillet the executive refuses at a corner (here: one edge of a run of tangent edges with
    # propagate=False) lost the intersection curves sm_SrfSrfIntersection collected and the fillet
    # surfaces of its solvers, with their caches: 24.5 kB a refused fillet (also in 0.4).
    plate = Rectangle(40, 30, fillet=5).extrude(10)
    edge = plate.edges().filter_by(lambda e: e.center().z > 9.9 and e.geom_type == "line").sort_by(lambda e: -e.length)[0]
    with pytest.raises(KernelError):
        plate.fillet(edge, 1, propagate=False)

    def refused():
        try:
            plate.fillet(edge, 1, propagate=False)
        except KernelError:
            return
        raise AssertionError("the fillet was not refused")

    per_call = _per_call(refused, calls=40)
    assert per_call < 8192, f"{per_call:.0f} bytes a refused fillet"


def test_mitered_sweeps_free_their_curves():
    # The kernel's sweep along a mitered planar path lost the copies of the profile and of the path
    # for each segment, the extended segments, its cutting lines and the ProtoVertices it took out
    # of the Boolean of the segments: 12.7 kB a sweep.
    def make():
        return sweep(Circle(1).on(Plane.YZ), Polyline((0, 0, 0), (20, 0, 0), (20, 20, 0)))

    assert make().is_valid()
    per_call = _per_call(make, calls=40)
    assert per_call < 4096, f"{per_call:.0f} bytes a sweep"


def test_failed_extended_shells_free_the_offset_body():
    # A shell whose last Boolean fails keeps both operands; the offset body was the kernel's own and
    # was lost with the caches built on it (1.9 MB for these three calls, two of which fail), and
    # so were the trim curves of a failed extension and a line copied by the merge. In a process of
    # its own: the kernel's extended offset, called here without smlibpy's guard, still crashes now
    # and then in the Linux builds (tests/test_lane_FO.py), and a crash would end the whole run.
    if _heap() is None:
        pytest.skip("no allocator statistics here")
    code = f"""
import sys
sys.path.insert(0, {str(Path(__file__).parent)!r})
from test_closeout_K2 import _per_call
from smlibpy import Box
from smlibpy._kernel import ext, k
steps = []
for size, r, t in (((20, 20, 20), 2, 1), ((40, 30, 10), 1, 0.5), ((40, 30, 10), 2, 1)):
    b = Box(*size)
    b = b.fillet(b.edges(), r)
    steps.append((b, [f._f for f in b.faces().top()], t))
failed = 0
def shells():
    global failed
    for b, top, t in steps:
        try:
            ext.delete_brep(k.shell_brep(b._brep, -t, extended_offset=True, faces_to_shell=top))
        except RuntimeError:
            failed += 1
print(_per_call(shells, calls=10), failed)
"""
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=600)
    assert run.returncode == 0, f"exit {run.returncode}: {run.stderr[-2000:]}"
    per_call, failed = (float(x) for x in run.stdout.split()[-2:])
    assert failed > 0  # (else the test measures no failure)
    assert per_call < 64 * 1024, f"{per_call:.0f} bytes for three shells"


def test_face_copies_the_kernel_cannot_build_are_freed(tmp_path):
    # A face of an imported body whose faces share no edges and whose vertices lie 1e-3 apart cannot
    # be copied: CopyFaces fails, then RemoveFaces on a copy of the whole body. RemoveFaces left a
    # Face without Faceuses in that copy, which ~SmBrep read through, so smlibpy kept both copies
    # for the life of the process (118 kB a failed copy). They are deleted now. In a process of its
    # own, as a crash there would end it.
    sys.path.insert(0, str(HERE))
    from test_lane_IX import _per_face

    export_step((Box(20, 10, 10) - Cylinder(3, 20)).named("block"), tmp_path / "block.step")
    (tmp_path / "broken.step").write_text(_per_face((tmp_path / "block.step").read_text(), 1e-3))
    code = textwrap.dedent(f"""
        import gc, sys, warnings
        warnings.simplefilter("ignore")
        sys.path.insert(0, {str(HERE)!r})
        from test_closeout_K2 import _heap
        from smlibpy import KernelError, import_step
        r = import_step({str(tmp_path / "broken.step")!r}, heal=False)
        bad = []
        for i, f in enumerate(r.faces()):
            try:
                f.to_shell()
            except KernelError:
                bad.append(i)
        assert bad, "no face failed to copy"
        face = r.faces()[bad[0]]
        def copy():
            try:
                face.to_shell()
            except KernelError:
                return
            raise AssertionError("the copy did not fail")
        for _ in range(3):
            copy()
        gc.collect()
        before = _heap()
        for _ in range(20):
            copy()
        gc.collect()
        print(len(bad), (_heap() - before) / 20 if before is not None else 0.0)
    """)
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr[-2000:]
    bad, per_call = run.stdout.split()
    assert int(bad) >= 1
    assert float(per_call) < 2048, f"{per_call} bytes a failed copy"


def test_all_edge_fillet_of_two_cones_fails_cleanly():
    # The kernel's Boolean inside the fillet took out an Edge between the two sides of one Face as
    # if it joined two Faces and wrote into the Edgeuses it had just freed (AddressSanitizer; the
    # normal build then raised SM_ERR_NULL_POINTER; fuzz case fillet-7-185). The Edge is refused
    # now, before anything changes: the fillet fails with SM_ERR, and smaller radii round as before.
    part = Cone(3, 0, 10).rotate(Axis.Y, 90) - Cone(1.5, 0, 8).rotate(Axis.X, 90).translate(0, 1, 0)
    keys = [(-5.0, 0.0, 3.0), (-0.89404, 1.76821, 0.0), (-0.26627, -1.57988, 0.0)]  # (the fuzz case's order)
    edges = [min(part.edges(), key=lambda e: (e.center() - Vector(*p)).length) for p in keys]
    with pytest.raises(KernelError) as err:
        part.fillet(edges, 0.721755)
    assert err.value.status == "SM_ERR"
    rounded = part.fillet(edges, 0.3)
    assert rounded.is_valid() and rounded.volume == pytest.approx(90.0851, abs=1e-3)


def test_extended_offsets_that_read_a_squeezed_edge_do_not_crash():
    # The extended offset mode read an Edge that FixGaps had squeezed away (the relations kept its
    # mate when only one Brep lost an Edge): AddressSanitizer, 5 of 48 runs of these steps with the
    # heap laid out at random, in SmTopology::Mark from ManifoldBoolean. In processes of their own,
    # each with another layout. The read of a ProtoEdge that SplitIntersectingProtoEdges deleted
    # (ResolveOverlappingProtoEdges, about 1 to 3 runs in 100) is the patch of close-out K1, so a
    # process that crashes gets one more run, as in tests/test_guards.py.
    code = textwrap.dedent("""
        import random, sys, warnings
        warnings.simplefilter("ignore")
        from smlibpy import *
        from smlibpy._kernel import k, ext
        random.seed(int(sys.argv[1]))
        junk = [bytearray(random.randint(16, 4096)) for _ in range(random.randint(0, 200))]
        lbox = Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)
        foot = [f._f for f in lbox.faces() if abs(f.center().z + 9) < 1e-6]
        cone = Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)
        cones = Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16).translate(-2, 2.5147, -4)
        end = [min(cones.faces(), key=lambda f: abs(f.center().x - 3))._f]
        steps = [lambda: k.shell_brep(lbox._brep, -2.94, extended_offset=True, faces_to_shell=foot),
                 lambda: k.offset_brep(cone._brep, 6),
                 lambda: k.shell_brep(cones._brep, -2.4, extended_offset=True, faces_to_shell=end)]
        for step in steps * 3:
            junk.append(bytearray(random.randint(16, 4096)))
            try:
                ext.delete_brep(step())
                print("ok", flush=True)
            except RuntimeError:
                print("failed", flush=True)
    """)
    def start(seed):
        return subprocess.Popen([sys.executable, "-c", code, str(seed)], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)

    runs = [(seed, start(seed)) for seed in range(6)]
    for seed, run in runs:
        out, err = run.communicate(timeout=300)
        if run.returncode < 0:  # (one more run, with another layout: a crash in both is not that one)
            run = start(seed + 100)
            out, err = run.communicate(timeout=300)
        assert run.returncode == 0, f"exit {run.returncode} after {len(out.split())} steps: {err[-500:]}"
        assert len(out.split()) == 9
