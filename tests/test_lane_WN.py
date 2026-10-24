"""Lane WN of the kernel plan: isolated kernel steps (N1), memory (N2), the fuzz harness (N3), the typings of
the free functions (W11), the API reference of the bodies (W12), fonts without fontTools: WOFF2 (Brotli), CFF2
and accents built with seac (W13); NVIDIA's validator on smlibpy's USD files (N4), the golden files of the parity
test of smlibwasm (N5, W16), the kernel's error trace (N6), the C library's random numbers (N7), threads: the
kernel lock and the GIL (N8), and what queries keep on a body (N9)."""

import _thread
import math
import os
import signal
import threading
import time
import warnings

import pytest
from pytest import approx

from smlibpy import *
from smlibpy import defeature, shapes
from smlibpy._guard import _KernelFault, isolated
from smlibpy._kernel import KernelError, ModelingError, ext, k

HAS_FORK = hasattr(os, "fork")
MODES = ["fork", "helper"] if HAS_FORK else ["helper"]
CALLS = {"n": 0}


@pytest.fixture(params=MODES)
def mode(request, monkeypatch):
    monkeypatch.setattr(defeature, "GUARD_PROCESS", request.param)
    monkeypatch.setattr(defeature, "GUARD_SECONDS", 20.0)  # (also where a run turns the guard off)
    return request.param


# -- steps the tests isolate (functions of a module: the helper process imports them) ----------
def _bodies(n):
    CALLS["n"] += 1
    a = Box(10, 20, 30)._copy_brep()
    b = (Box(10, 10, 10) - Cylinder(2, 20))._copy_brep()
    return {"one": a, "both": [a, b], "n": n, "pair": (n, "x"), "none": None}


def _face_areas(brep, faces, edges):
    return [f.area() for f in faces], [e.length() for e in edges], brep.face_count()


def _fail(kind):
    if kind == "kernel":
        raise KernelError("probe", "SM_ERR_INVALID_INPUT (probe)", "SM_ERR_INVALID_INPUT", "a hint")
    if kind == "value":
        raise ValueError("a value error")
    if kind == "modeling":
        raise ModelingError("a modeling error")
    if kind == "warn":
        warnings.warn("a warning from there", RuntimeWarning)
        return 7
    raise _Odd("something else")


class _Odd(Exception):
    pass


def _crash():
    import faulthandler

    faulthandler.disable()  # (no report of the crash)
    os.kill(os.getpid(), signal.SIGSEGV) if hasattr(signal, "SIGSEGV") and os.name != "nt" else os.abort()


def _sleep(seconds):
    time.sleep(seconds)
    return seconds


def _counted(fn):
    def wrapper(*args, **kwargs):
        CALLS["n"] += 1
        return fn(*args, **kwargs)

    return wrapper


# -- N1: isolated steps return their results ------------------------------------------------------
def test_isolated_steps_bring_bodies_and_data_back(mode):
    CALLS["n"] = 0
    out = isolated("probe", _bodies, 3)
    assert CALLS["n"] == 0  # this process never ran the step
    assert out["n"] == 3 and out["pair"] == (3, "x") and out["none"] is None
    one = shapes.Part._wrap(out["one"])
    assert one.volume == approx(6000.0) and one.is_valid()
    # a Brep returned twice comes back once (the same object both times)
    assert out["both"][0] is out["one"]
    cut = shapes.Part._wrap(out["both"][1])
    assert cut.volume == approx(1000 - math.pi * 4 * 10) and len(cut.faces()) == 7


def test_isolated_steps_take_bodies_faces_and_edges(mode):
    part = Box(10, 20, 30) - Cylinder(2, 40)
    faces = [part.faces().sort_by(Z)[-1]._f, part.faces().cylinders()[0]._f]
    edges = [e._e for e in part.edges().circles()]
    areas, lengths, count = isolated("probe", _face_areas, part._brep, faces, edges)
    assert count == len(part.faces())
    assert areas == approx([f.area() for f in faces]) and lengths == approx([e.length() for e in edges])


def test_isolated_steps_raise_their_errors_here(mode):
    with pytest.raises(KernelError) as e:
        isolated("probe", _fail, "kernel")
    assert (e.value.operation, e.value.status, e.value.hint) == ("probe", "SM_ERR_INVALID_INPUT", "a hint")
    with pytest.raises(ValueError, match="a value error"):
        isolated("probe", _fail, "value")
    with pytest.raises(ModelingError, match="a modeling error"):
        isolated("probe", _fail, "modeling")
    with pytest.raises(ModelingError, match="probe: _Odd in .*: something else"):
        isolated("probe", _fail, "other")
    with pytest.warns(RuntimeWarning, match="a warning from there"):
        assert isolated("probe", _fail, "warn") == 7


def test_a_crash_or_a_hang_costs_only_the_other_process(mode, monkeypatch):
    with pytest.raises(_KernelFault, match=r"probe: the kernel crashed \((signal|exit code) "):
        isolated("probe", _crash)
    assert isolated("probe", _sleep, 0) == 0  # (a new helper)
    monkeypatch.setattr(defeature, "GUARD_SECONDS", 0.5)
    start = time.monotonic()
    with pytest.raises(_KernelFault, match="probe: the kernel did not finish within 0.5 s"):
        isolated("probe", _sleep, 30)
    assert time.monotonic() - start < 5
    monkeypatch.setattr(defeature, "GUARD_SECONDS", 20.0)
    assert isolated("probe", _bodies, 1)["n"] == 1


def test_ctrl_c_stops_an_isolated_step(mode):
    # A kernel call in this process cannot be interrupted; one in the other process can: Ctrl-C
    # (KeyboardInterrupt in the main thread) ends the step, and the next one runs.
    timer = threading.Timer(0.5, _thread.interrupt_main)
    start = time.monotonic()
    timer.start()
    with pytest.raises(KeyboardInterrupt):
        isolated("probe", _sleep, 30)
    assert time.monotonic() - start < 5
    assert isolated("probe", _sleep, 0) == 0


def test_the_guard_settings_are_checked(monkeypatch):
    monkeypatch.setattr(defeature, "GUARD_PROCESS", "spawn")
    with pytest.raises(ValueError, match="GUARD_PROCESS must be 'auto', 'fork' or 'helper'"):
        Box(10, 10, 10).offset(1)
    monkeypatch.setattr(defeature, "GUARD_PROCESS", "auto")
    monkeypatch.setattr(defeature, "GUARD_SECONDS", 0)  # in this process
    CALLS["n"] = 0
    assert isolated("probe", _bodies, 2)["n"] == 2 and CALLS["n"] == 1


def test_defeaturing_runs_each_kernel_step_once(mode, monkeypatch):
    # The guard ran each step of remove_fillets in a copy first and then again here; now the copy's
    # result comes back and this process runs no step (the copy sees the counters, the helper not).
    calls = {"defeature": 0, "remove_fillet_faces": 0}
    for name in calls:
        real = getattr(defeature._D, name)

        def count(*args, _real=real, _name=name, **kwargs):
            calls[_name] += 1
            return _real(*args, **kwargs)

        monkeypatch.setattr(defeature._D, name, count)
    box = Box(20, 20, 20)
    rounded = box.fillet(box.edges().filter(lambda e: e.center().z > 9), 3)
    plain = defeature.remove_fillets(rounded, rounded.faces().fillets())
    assert plain.volume == approx(8000.0) and len(plain.faces()) == 6
    hole = Box(20, 20, 10) - Cylinder(3, 10)
    filled = defeature.remove_faces(hole, hole.faces().cylinders())
    assert filled.volume == approx(4000.0)
    assert calls == {"defeature": 0, "remove_fillet_faces": 0}
    with monkeypatch.context() as m:
        m.setattr(defeature, "GUARD_SECONDS", 0)
        defeature.remove_fillets(rounded, rounded.faces().fillets())
    assert sum(calls.values()) >= 1  # (here, without the guard)


def test_surface_fillet_runs_in_another_process(mode, monkeypatch):
    real = k.surface_surface_fillet
    monkeypatch.setattr(k, "surface_surface_fillet", _counted(real))
    CALLS["n"] = 0
    floor = Rectangle(40, 40).faces()[0]
    wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]
    blend = surface_fillet(floor, wall, 5, sides=(1, 1))
    assert blend.area == approx(math.pi / 2 * 5 * 40, rel=1e-6)
    assert CALLS["n"] == 0


def test_cells_run_the_stitcher_in_another_process(mode, monkeypatch):
    monkeypatch.setattr(shapes.ext, "region_shells", _counted(ext.region_shells))
    CALLS["n"] = 0
    merged = Box(10, 10, 10).merge(Box(10, 10, 10).translate(5, 0, 0))
    cells = merged.cells()
    assert sorted(round(c.volume, 6) for c in cells) == [500.0, 500.0, 500.0]
    assert CALLS["n"] == 0


def test_booleans_run_in_another_process_on_request(mode, monkeypatch):
    monkeypatch.setattr(shapes.ext, "boolean", _counted(ext.boolean))
    CALLS["n"] = 0
    a = Box(10, 10, 10) - Cylinder(2, 20)
    assert CALLS["n"] >= 1  # (off by default: here)
    monkeypatch.setattr(defeature, "GUARD_BOOLEANS", True)
    CALLS["n"] = 0
    b = Box(10, 10, 10) - Cylinder(2, 20)
    c = Box(10, 10, 10) + Sphere(3).translate(5, 5, 5)
    m = Box(10, 10, 10).merge(Box(4, 4, 4).translate(5, 5, 5))
    assert CALLS["n"] == 0
    assert b.volume == approx(a.volume) and b.is_valid()
    assert c.volume == approx(1000 + 7 / 8 * 4 / 3 * math.pi * 27, rel=1e-6)
    assert m.volume == approx(1000 + 4 * 4 * 4 - 2 * 2 * 2) and len(m.cells()) == 3
    with pytest.raises(KernelError, match="cut failed"):
        Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)


def test_fillets_of_parts_read_from_files_run_in_another_process(mode, monkeypatch, tmp_path):
    made = Box(20, 20, 20) - Cylinder(4, 30)
    assert not made._h.imported
    path = tmp_path / "part.smb"
    save(made, path, ascii=False)
    part = load(str(path))
    assert part._h.imported
    cut = part - Box(4, 4, 30).translate(10, 10, 0)
    moved = cut.translate(1, 2, 3)
    assert cut._h.imported and moved._h.imported  # (made from it)
    monkeypatch.setattr(ext, "round_edges", _counted(ext.round_edges))  # (the fillet executive, lane FO: F8)
    CALLS["n"] = 0
    rounded = moved.fillet(moved.edges().filter(lambda e: e.center().z > 11 and e.geom_type == "line"), 1)
    beveled = moved.chamfer(moved.edges().circles().filter(lambda e: e.center().z > 11), 0.5)
    assert CALLS["n"] == 0 and rounded.is_valid() and beveled.is_valid()
    assert rounded.volume < moved.volume and beveled.volume < moved.volume
    plain = made.fillet(made.edges().filter(lambda e: e.center().z > 9 and e.geom_type == "line"), 1)
    assert CALLS["n"] == 1  # (a part made here: in this process)
    here = made.translate(1, 2, 3).cut(Box(4, 4, 30).translate(11, 12, 3))
    with monkeypatch.context() as m:
        m.setattr(defeature, "GUARD_SECONDS", 0)
        same = here.fillet(here.edges().filter(lambda e: e.center().z > 11 and e.geom_type == "line"), 1)
    assert same.volume == approx(rounded.volume, rel=1e-9) and plain.is_valid()


# -- N2: memory --------------------------------------------------------------------------------
def _heap() -> int | None:
    """Bytes the C allocator has handed out and not got back (None where it cannot be read)."""
    import ctypes
    import sys

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


@pytest.mark.parametrize("name", ["revolve", "taper", "offset", "loft", "open extrude", "open revolve", "mitered sweep"])
def test_sweeps_free_the_curves_they_hand_the_kernel(name):
    # The kernel's sweeps, skins and offset profiles copy the curves they are given ("Pure" in
    # SmPyLib): the copies smlibpy made for them were never freed (a revolve of a rectangle left its
    # four lines, 600 bytes, each call). Found by the leak check (tools/sanitize/run.py).
    import gc

    if _heap() is None:
        pytest.skip("no allocator statistics here")
    from smlibpy import extrude, loft, revolve, sweep

    make = {
        "revolve": lambda: Rectangle(5, 5).translate(10, 0).revolve(Axis((0, 0, 0), (0, 1, 0))),
        "taper": lambda: Rectangle(10, 10).extrude(5, taper=5),
        "offset": lambda: Rectangle(10, 10).offset(1),
        "loft": lambda: loft([Rectangle(10, 10), Circle(4).moved(Location((0, 0, 10)))]),
        "open extrude": lambda: extrude(Line((0, 0, 0), (10, 0, 0)), 5),
        "open revolve": lambda: revolve(Line((5, 0, 0), (5, 0, 10))),
        "mitered sweep": lambda: sweep(Circle(1).on(Plane.YZ), Polyline((0, 0, 0), (20, 0, 0), (20, 20, 0))),
    }[name]
    for _ in range(5):
        make()
    gc.collect()
    before = _heap()
    for _ in range(100):
        make()
    gc.collect()
    per_call = (_heap() - before) / 100
    # (the kernel's own sweep along a mitered path keeps its copies of the profile and the path,
    # about 10 kB a call: tools/sanitize/leaks.txt)
    limit = 16000 if name == "mitered sweep" else 64
    assert per_call < limit, f"{name}: {per_call:.0f} bytes a call"


def _per_call(make, calls: int = 50) -> float:
    """Bytes the C allocator keeps per call of ``make`` (after five calls to warm up)."""
    import gc

    for _ in range(5):
        make()
    gc.collect()
    before = _heap()
    for _ in range(calls):
        make()
    gc.collect()
    return (_heap() - before) / calls


def test_failed_sliver_removals_free_their_copies():
    # ext.remove_slivers (the sweeps' clean-up of fused loops) kept every copy it failed on: 73 kB
    # each here, 262 kB per sweep along a kinked loop whose slivers could not be taken out. Only a
    # copy that SmBrep::RemoveFaces failed on half way must be kept (its destructor can crash).
    if _heap() is None:
        pytest.skip("no allocator statistics here")
    part = Box(10, 20, 30) - Cylinder(3, 40)
    wall = part.faces().filter_by(lambda f: f.geom_type == "cylinder")[0]

    def fail():
        with pytest.raises(RuntimeError, match="DoStitching"):  # (a hole the stitch cannot close)
            ext.remove_slivers(part._brep, [wall._f], 1e-3)

    assert _per_call(fail) < 2000


def test_failed_booleans_free_the_kernel_s_intersections():
    # A Boolean that fails while it intersects the operands (SmTopologyIntersector) kept its
    # ProtoTopologyManager with the intersection curves (kernel patch, SmTopologyIntersector.cpp):
    # about 450 kB per failed Boolean of the crossing holes, whose seams lie tangent to the other.
    if _heap() is None:
        pytest.skip("no allocator statistics here")
    from smlibpy._kernel import BrepHandle

    h1, h2 = Cylinder(3, 40).translate(0, 3, 0), Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)

    def fail():
        a, b = BrepHandle(h1._copy_brep()), BrepHandle(h2._copy_brep())  # (freed with the handles)
        with pytest.raises(RuntimeError, match="SM_ERR_BAD_INTERSECTIONS"):
            k.boolean(a.brep, b.brep, operation=k.BooleanOp.INTERSECTION)

    assert _per_call(fail, 20) < 5000


# -- N2, N3: the checks of the kernel (tools/sanitize, tools/oracles, tools/fuzz) ----------------
TOOLS = __import__("pathlib").Path(__file__).resolve().parent.parent / "tools"


def _tool(name: str):
    import importlib.util

    path = TOOLS / name
    spec = importlib.util.spec_from_file_location(path.stem + "_lane_wn", path)
    module = importlib.util.module_from_spec(spec)
    import sys as _sys

    _sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        _sys.path.remove(str(path.parent))
    return module


def test_fuzz_cases_are_the_same_for_a_seed_everywhere():
    gen = _tool("fuzz/gen.py")
    cases = gen.gen(7, gen.counts(410))
    assert len(cases) == 410 and [c["kind"] for c in cases[:1]] == ["csg"]
    assert sum(c["kind"] == "csg" for c in cases) == 160 and sum(c["kind"] == "slice" for c in cases) == 40
    # (the first case of seed 7, as the review's harness drew it)
    assert cases[0] == {"id": "csg-7-0", "kind": "csg", "A": ["box", 6, 16, 4],
                        "B": ["tr", ["cyl", 1.5, 30], -1.5, 0.0, -13.0], "tags": ["prim", "flushmin", "center", "flushmax"]}
    assert gen.gen(7, gen.counts(410)) == cases and gen.gen(8, gen.counts(410)) != cases


def test_fuzz_invariants_catch_wrong_results():
    check = _tool("fuzz/check.py")
    case = {"id": "csg-0-0", "kind": "csg", "A": ["box", 10, 10, 10], "B": ["box", 10, 10, 10]}

    def rec(op, v, **kw):
        return {"op": op, "ok": True, "v": v, "valid": True, "bb": [0, 0, 0, 10, 10, 10], **kw}

    right = {"id": "csg-0-0", "fate": "exit", "recs": [rec("A", 1000), rec("B", 1000), rec("U", 1000), rec("I", 1000),
                                                       rec("D", 0.0, empty=True), rec("E", 0.0, empty=True)]}
    cls, viol = check.classify(case, right)
    assert cls["U"] == "ok" and not viol
    wrong = {**right, "recs": [rec("A", 1000), rec("B", 1000), rec("U", 1500), rec("I", 1000)]}
    cls, viol = check.classify(case, wrong)
    assert cls["U"] == "silent" and "|U|+|I|=2500 != |A|+|B|=2000" in viol["U"]
    crashed = {"id": "csg-0-0", "fate": "crash", "in_op": "D", "recs": [rec("A", 1000), {"op": "D", "start": True}]}
    assert check.classify(case, crashed)[0]["D"] == "crash"
    # a box filleted along one edge has an exact volume
    fil = {"id": "fillet-0-1", "kind": "fillet", "base": ["box", 10, 10, 10]}
    r = {"id": "fillet-0-1", "fate": "exit", "recs": [
        rec("base", 1000, bb=[-5, -5, -5, 5, 5, 5]), {"op": "resolve", "edges": [[5, 5, 0]], "size": 2.0},
        rec("F", 1000 - (1 - math.pi / 4) * 4 * 10 + 1e-2, bb=[-5, -5, -5, 5, 5, 5])]}
    assert check.classify(fil, r)[0]["F"] == "silent"  # (1e-2 off: 1e-5 of the volume)
    # smlibpy and smlibwasm disagreeing
    one = {**right, "recs": [rec("A", 1000), rec("B", 1000), rec("U", 1000), rec("I", 1000)]}
    big = [0, 0, 0, 10, 10, 11]
    other = {**right, "recs": [rec("A", 1000), rec("B", 1000.1, bb=big), rec("U", 1000.1, bb=big), rec("I", 1000)]}
    assert check.divergence({"csg-0-0": case}, [one], [other], {}) == {"csg-0-0 B": "volume 1000/1000.1",
                                                                      "csg-0-0 U": "volume 1000/1000.1"}


@pytest.mark.skipif(not HAS_FORK, reason="the fuzz runner forks")
def test_fuzz_runner_and_repro_of_a_case(tmp_path):
    run_py, check, repro = _tool("fuzz/run_py.py"), _tool("fuzz/check.py"), _tool("fuzz/repro.py")
    case = {"id": "csg-0-1", "kind": "csg", "A": ["box", 20, 20, 20], "B": ["tr", ["cyl", 4, 30], 5, 0, 0]}
    r = run_py.run_one(case, 60.0)
    assert r["fate"] == "exit" and check.classify(case, r)[0] == {o: "ok" for o in ("A", "B", "U", "I", "D", "E", "M")}
    ops = check.ops_of(r)
    assert ops["D"]["v"] == approx(8000 - math.pi * 16 * 20, rel=1e-9) and ops["M"]["ncells"] == 4  # (the cylinder's two ends too)
    shell = {"id": "shell-0-2", "kind": "shell", "base": ["box", 10, 20, 30], "nopen": 1, "pick": 5, "frac": 0.2}
    r = run_py.run_one(shell, 60.0)
    resolved = check.resolve_of(r)
    assert r["fate"] == "exit" and resolved["t"] == 1.0 and len(resolved["faces"]) == 1
    assert check.classify(shell, r)[0]["S"] == "ok"
    # the pytest stub of a case runs it
    code = repro.stub(shell, resolved, "S", "a probe")
    ns: dict = {}
    exec(compile(code, "stub", "exec"), ns)
    ns["test_shell_0_2_S"]()
    exec(compile(repro.stub(case, {}, "D", "a probe"), "stub", "exec"), ns)
    ns["test_csg_0_1_D"]()


def test_sanitizer_reports_are_read_right():
    run = _tool("sanitize/run.py")
    log = """=================================================================
==1==ERROR: AddressSanitizer: heap-use-after-free on address 0x1 at pc 0x2
READ of size 8 at 0x1 thread T0
    #0 0x3 in SmEdge::GetBrep() SmEdge.cpp:10

=================================================================
==1==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 152 byte(s) in 1 object(s) allocated from:
    #0 0x4 in calloc
    #1 0x5 in SmLine::Copy(SmContext const&, SmCurve*&) const SmLine.cpp:500
    #2 0x6 in smlibpy::edge_curve(SmEdge const*) ext.cpp:926

Direct leak of 64 byte(s) in 1 object(s) allocated from:
    #0 0x7 in malloc
    #1 0x8 in PyUnicode_New

Direct leak of 32 byte(s) in 1 object(s) allocated from:
    #0 0x9 in operator new(unsigned long)
    #1 0xa in pybind11::detail::make_new_python_type
    #2 0xb in PyInit__core

Direct leak of 704 byte(s) in 2 object(s) allocated from:
    #0 0xc in calloc
    #1 0xd in SmCircle::Copy(SmContext const&, SmCurve*&) const SmCircle.cpp:158
    #2 0xe in PositionProfileCurves(...) SmPrimitiveCreation.cpp:5561
"""
    reports = run.reports(log)
    assert len(reports) == 1 and "heap-use-after-free" in reports[0] and "LeakSanitizer" not in reports[0]
    counted = run.leaks(log, ["PositionProfileCurves"])
    # the kernel's leak through smlibpy counts; Python's own, the import's and a known one do not
    assert len(counted) == 1 and "smlibpy::edge_curve" in counted[0]
    assert run._listed(TOOLS / "sanitize" / "known.txt") == ["sm_FixProblemsBySqueezing"]


def test_upstream_smb_files_hold_what_they_held():
    smb = _tool("oracles/smb_files.py")
    expected = __import__("json").loads((TOOLS / "oracles" / "smb_files.json").read_text())
    assert len(expected) == 200 and sum("error" in v for v in expected.values()) == 2
    folder = TOOLS.parent / "third_party" / "usd-brep" / "TestFiles"
    for name in ("pt_TestFiles/Solids/revolution_mold.smb", "pt_TestFiles/Platform.smb", "pt_TestFiles/Fillet/sphere_plane.smb"):
        if not (folder / name).exists():
            pytest.skip("usd-brep's test files are not checked out")
        got = smb.measure(str(folder / name))
        want = expected[name]
        assert got.keys() == want.keys() and all(
            got[k] == approx(want[k], rel=1e-6) if isinstance(want[k], float) else got[k] == want[k] for k in want), name


def test_cells_of_a_merge_that_crashed_the_stitcher_come_back(mode):
    # Found by the fuzz run (seed 20261022, case csg-153): the stitcher behind cells() read a null
    # polar box (SmBezierAux2d::BuildPolarBox, from SmBrep::FindInfiniteRegion's ray) on this merge
    # of a cone and a cylinder, and ended the process (exit 139); it runs in another process.
    # Part.merge turns the cylinder about its axis now (lane BT: B6, its seam ran along the cone): the
    # right merge (OpenCASCADE: 150.26185), whose cells come apart. The kernel's own merge crashed the
    # stitcher until the patched SmSurfaceCache.cpp (close-out K2) gave the polar box the surface of
    # its tree: its cells come back, and add up to that (wrong) merge.
    a, b = Cone(3, 0, 4).rotate(X, 90), Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3)
    assert a.merge(b).volume == approx(150.26185413540605, rel=1e-9)
    m = Part._wrap(k.non_manifold_boolean(a._copy_brep(), b._copy_brep(), operation=k.BooleanOp.MERGE))
    # (the kernel's wrong merge holds 149.19267 where the compiler fuses a * b + c, as on arm64, and
    # 145.98511 where it does not, as in the wasm and on x86_64 (W16): the cylinder's volume is
    # 113.0973, the right merge 150.26185)
    assert 113.0973 < m.volume < 150.7964
    cells = m.cells()
    assert len(cells) == 3 and all(c.is_valid() for c in cells)
    assert sum(c.volume for c in cells) == approx(m.volume, rel=1e-6)


def test_steps_stopped_after_the_time_limit_say_so(monkeypatch, tmp_path):
    # Fillets and chamfers of parts read from files run in another process (N1), stopped after
    # GUARD_SECONDS. They raised "KernelError: fillet failed: the radius may be too large for the
    # selected edges", the time limit only in .detail, and tried again with the finer tolerance.
    plate = Box(60, 60, 10) - [Cylinder(2, 20).translate(x, y, 0) for x in (-20, 0, 20) for y in (-20, 0, 20)]
    export_step(plate, tmp_path / "plate.step")
    part = import_step(tmp_path / "plate.step")
    monkeypatch.setattr(defeature, "GUARD_SECONDS", 0.01)
    started = time.perf_counter()
    with pytest.raises(_KernelFault, match=r"^fillet: the kernel did not finish within 0.01 s; smlibpy.defeature.GUARD"):
        part.fillet(part.edges().filter_by(lambda e: e.center().z > 4.9), 0.5)
    assert time.perf_counter() - started < 5


# ================================================================================ W11, W12
def test_free_functions_say_what_a_sketch_or_face_gives():
    """W11: what the TypeScript overloads say, Python's say too: a sketch or face gives a Part, a
    curve a Part or a Shell; vertices give a Sketch; split(..., "both") two Parts."""
    import typing

    from smlibpy import operations as ops

    returns = {f.__name__: [o.__annotations__["return"] for o in typing.get_overloads(f)]
               for f in (ops.extrude, ops.revolve, ops.loft, ops.sweep, ops.fillet, ops.chamfer, ops.offset, ops.split)}
    assert returns == {
        "extrude": ["Part", "Part | Shell"], "revolve": ["Part", "Part | Shell"], "loft": ["Part", "Part | Shell"],
        "sweep": ["Part", "Part | Shell"], "fillet": ["Sketch", "Part"], "chamfer": ["Sketch", "Part"],
        # (offset also moves sheets, faces (lane FO: O7), wires and edges (lane C: C7))
        "offset": ["Sketch", "Part", "Shell", "Wire", "Edge"], "split": ["tuple[Part, Part]", "Part"],
    }
    assert typing.get_overloads(ops.extrude)[0].__annotations__["profile"] == "Sketch | Face"
    # and so they behave
    assert isinstance(extrude(Rectangle(10, 5), 3), Part)
    assert isinstance(extrude(Line((0, 0), (10, 0)), 3), Shell)
    assert isinstance(sweep(Line((0, 0, 0), (0, 5, 0)), Line((0, 0, 0), (0, 0, 10))), Shell)
    assert isinstance(fillet(Rectangle(10, 5).vertices(), 1), Sketch)
    above, below = split(Box(10, 10, 10), Plane.XY, "both")
    assert above.volume == approx(500) and below.volume == approx(500)


def test_api_reference_shows_what_every_body_has():
    """W12: Part, Sketch and Shell in docs/api.md list every public member of the bodies' base class
    (_Body), which mkdocstrings leaves out of a class unless told."""
    import pathlib
    import re

    page = (pathlib.Path(__file__).parent.parent / "docs" / "api.md").read_text()
    public = sorted(name for name in vars(shapes._Body) if not name.startswith("_"))
    assert {"named", "colored", "raycast", "closest_point", "heal", "bbox"} <= set(public)
    for cls in ("Part", "Sketch", "Shell"):
        entry = re.search(rf"^::: smlibpy\.shapes\.{cls}\n    options:\n      inherited_members: \[([^\]]*)\]", page, re.M)
        assert entry, f"{cls} has no inherited_members in docs/api.md"
        assert sorted(entry.group(1).split(", ")) == public, cls


# ================================================================================ W13: fonts without fontTools
DATA = os.path.join(os.path.dirname(__file__), "data")


def _font(name):
    from smlibpy.font import Font

    return Font(os.path.join(DATA, name))


def test_brotli_decodes_the_reference_encoders_streams():
    import base64
    import hashlib
    import json

    from smlibpy import _brotli

    vectors = json.load(open(os.path.join(DATA, "brotli-vectors.json")))["vectors"]
    assert len(vectors) == 13
    for v in vectors:
        data = base64.b64decode(v["brotli"])
        if v.get("error"):
            with pytest.raises(_brotli.BrotliError):
                _brotli.decompress(data)
            continue
        out = _brotli.decompress(data)
        assert (len(out), hashlib.sha256(out).hexdigest()) == (v["length"], v["sha256"]), v["name"]
    # what the damaged ones say
    by_name = {v["name"]: base64.b64decode(v["brotli"]) for v in vectors}
    for name, message in (("cut short", "the data ends early"),
                          ("a window size that is reserved (large-window Brotli)", "an invalid window size"),
                          ("padding bits that are not zero", "padding bits that are not zero")):
        with pytest.raises(_brotli.BrotliError, match=message):
            _brotli.decompress(by_name[name])
    assert issubclass(_brotli.BrotliError, ValueError)


def test_brotli_damaged_streams_fail_as_brotli_errors():
    """Every bit of a stream flipped, and every length cut: data or a BrotliError, nothing else (the
    decoder agreed with node's on 3,000 such streams)."""
    import base64
    import json

    from smlibpy import _brotli

    vectors = json.load(open(os.path.join(DATA, "brotli-vectors.json")))["vectors"]
    data = base64.b64decode(next(v["brotli"] for v in vectors if v["name"].startswith("text: dictionary")))
    outcomes = {"data": 0, "error": 0}
    for i in range(len(data) * 8):
        damaged = bytearray(data)
        damaged[i // 8] ^= 1 << (i % 8)
        for d in (bytes(damaged), data[:i // 8]):
            try:
                _brotli.decompress(d)
                outcomes["data"] += 1
            except _brotli.BrotliError:
                outcomes["error"] += 1
    assert outcomes["error"] > 0 and sum(outcomes.values()) == 2 * len(data) * 8


def test_brotli_dictionary_is_rfc_7932s():
    import hashlib

    from smlibpy import _brotli

    words = _brotli._dictionary()
    assert len(words) == 122784 and _brotli._WORD_OFFSETS[25] == 122784
    assert hashlib.sha256(words).hexdigest() == "20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70"
    assert words[:20] == b"timedownlifeleftback"  # (the words of length 4 come first)
    # the transforms: an uppercased first letter with a suffix, a word without its first byte
    assert [_brotli._transform(b"time", i) for i in range(5)] == [b"time", b"time ", b" time ", b"ime", b"Time "]


def test_woff2_fonts_read_as_the_fonts_they_hold():
    """test-quadratic.woff2 has transformed glyf, loca and hmtx tables (and the overlap bitmap),
    test-quadratic-plain.woff2 none, test-cubic.woff2 is a CFF font: each reads as its TTF or OTF."""
    ttf, otf = _font("test-quadratic.ttf"), _font("test-cubic.otf")
    for name, ref in (("test-quadratic.woff2", ttf), ("test-quadratic-plain.woff2", ttf), ("test-cubic.woff2", otf)):
        f = _font(name)
        assert (f.name, f.units_per_em, f.num_glyphs, f.cap_height) == (ref.name, ref.units_per_em, ref.num_glyphs,
                                                                       ref.cap_height)
        assert f.characters() == ref.characters()
        for g in range(ref.num_glyphs):
            assert f.advance(g) == ref.advance(g)
            if name.startswith("test-quadratic") and g == ttf.glyph_index("P"):
                assert len(f.outline(g)) == len(ref.outline(g)) == 2  # (point matching: the same two Hs)
            assert f.outline(g) == ref.outline(g), (name, g)
        assert f.kerning_source == ref.kerning_source
    assert _font("test-quadratic.woff2").kerning(ttf.glyph_index("H"), ttf.glyph_index("O")).advance1 == -50
    # the reconstructed glyf table is found through the loca table the head table says
    woff2 = _font("test-quadratic.woff2")
    assert woff2._long_loca == (len(woff2._tables["loca"]) == 4 * (woff2.num_glyphs + 1))
    # and Text draws with it what it draws with the TTF
    woff2_text = Text("HOX", 10, font=os.path.join(DATA, "test-quadratic.woff2"))
    assert woff2_text.area == approx(Text("HOX", 10, font=os.path.join(DATA, "test-quadratic.ttf")).area, rel=1e-12)


def test_damaged_woff_and_woff2_files_are_font_errors(tmp_path):
    from smlibpy.font import Font, FontError

    data = open(os.path.join(DATA, "test-quadratic.woff2"), "rb").read()
    for n, damaged in enumerate((data[:200], data[:60] + bytes([data[60] ^ 0xFF]) + data[61:], data[:48])):
        p = tmp_path / f"bad{n}.woff2"
        p.write_bytes(damaged)
        with pytest.raises(FontError, match="a damaged WOFF2 file"):
            Font(str(p))
    # a WOFF table whose zlib data is damaged (it was zlib.error)
    woff = bytearray(open(os.path.join(DATA, "test-quadratic.woff"), "rb").read())
    n = int.from_bytes(woff[12:14], "big")
    for i in range(n):
        rec = 44 + 20 * i
        off, comp, orig = (int.from_bytes(woff[rec + k:rec + k + 4], "big") for k in (4, 8, 12))
        if comp < orig:
            woff[off + 2] ^= 0xFF  # (past the zlib header: the deflate data)
            break
    p = tmp_path / "bad.woff"
    p.write_bytes(bytes(woff))
    with pytest.raises(FontError, match="damaged WOFF table"):
        Font(str(p))


def test_seac_accents_are_their_base_and_accent_glyphs():
    """test-seac.otf: Agrave is endchar seac with a width (A, grave moved by (300, 750)), Atilde
    one without (A, tilde moved by (250, 760))."""
    f = _font("test-seac.otf")
    g = f.glyph_index
    a, grave, tilde = f.outline(g("A")), f.outline(g("`")), f.outline(g("~"))
    assert len(f.outline(g("À"))) == len(f.outline(g("Ã"))) == 2
    assert f.outline(g("À")) == a + [[tuple((x + 300, y + 750) for x, y in seg) for seg in c] for c in grave]
    assert f.outline(g("Ã")) == a + [[tuple((x + 250, y + 760) for x, y in seg) for seg in c] for c in tilde]
    t = Text("ÀÃ", 700, font=os.path.join(DATA, "test-seac.otf"), align=None)  # (one font unit is one mm)
    assert len(t.faces()) == 4
    assert t.area == approx(2 * 600 * 700 + 100 * 100 + 200 * 80, rel=1e-12)


def test_cff2_fonts_draw_their_default_instance():
    """test-variable.otf (CFF2: blends, two item variation data, vsindex) draws its 400 master,
    whose glyphs are test-cubic.otf's."""
    v, c = _font("test-variable.otf"), _font("test-cubic.otf")
    assert "CFF2" in v._tables and type(v._outlines).__name__ == "_CFF2Outlines"
    assert v._outlines.region_counts == [2, 1]
    for ch in "HOS":
        assert v.outline(v.glyph_index(ch)) == c.outline(c.glyph_index(ch)), ch
    assert v.advance(v.glyph_index("H")) == 700 and v.cap_height == 700
    assert Text("HOS", 700, font=os.path.join(DATA, "test-variable.otf"), align=None).area == approx(
        Text("HOS", 700, font=os.path.join(DATA, "test-cubic.otf"), align=None).area, rel=1e-12)


def test_fonts_read_without_fonttools():
    import subprocess
    import sys

    code = ("import sys; sys.modules['fontTools'] = None\n"  # (an import of fontTools fails)
            "from smlibpy.font import Font\n"
            "import os\n"
            "d = sys.argv[1]\n"
            "for n in ('test-quadratic.woff2', 'test-cubic.woff2', 'test-seac.otf', 'test-variable.otf'):\n"
            "    f = Font(os.path.join(d, n))\n"
            "    assert all(f.outline(g) is not None for g in range(f.num_glyphs))\n"
            "print('ok')\n")
    out = subprocess.run([sys.executable, "-c", code, DATA], capture_output=True, text=True,
                         env={**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)})
    assert out.stdout.strip() == "ok", out.stderr


def test_text_takes_a_font():
    from smlibpy.font import load_font

    f = load_font(os.path.join(DATA, "test-quadratic.woff2"))
    assert Text("H", 700, font=f, align=None).area == approx(600 * 700, rel=1e-12)
    with pytest.raises(ValueError, match="has no glyph for 'Z'"):
        Text("Z", 10, font=f)


def test_new_fonts_against_an_independent_reader():
    """The fonts of the new kinds against fontTools (where it is installed, with brotli for WOFF2):
    character map, advances and the exact area of every outline."""
    ttlib = pytest.importorskip("fontTools.ttLib")
    from fontTools.pens.areaPen import AreaPen

    from smlibpy.text import _segment_area

    names = ["test-seac.otf", "test-variable.otf"]
    try:
        import brotli  # noqa: F401

        names += ["test-quadratic.woff2", "test-quadratic-plain.woff2", "test-cubic.woff2"]
    except ImportError:
        pass
    for name in names:
        f = _font(name)
        tt = ttlib.TTFont(os.path.join(DATA, name))
        gs = tt.getGlyphSet()
        cmap = tt.getBestCmap()
        assert {c: f.glyph_index(chr(c)) for c in cmap} == {c: tt.getGlyphID(n) for c, n in cmap.items()}
        for gid, glyph in enumerate(tt.getGlyphOrder()):
            assert f.advance(gid) == tt["hmtx"][glyph][0]
            if glyph == "P":  # (point matching, which fontTools does not draw)
                continue
            pen = AreaPen(gs)
            gs[glyph].draw(pen)
            assert sum(_segment_area(s) for c in f.outline(gid) for s in c) == approx(pen.value, rel=1e-12, abs=1e-9)



# == N6: where the kernel gave up (KernelError.trace) ====================================================
_TRACE_ENTRY = __import__("re").compile(r"^SM_[A-Z_]+ at \w+\.cpp:\d+( \(.+\))?$")


def _crossing_holes():
    # (the kernel's own Boolean: smlibpy's turns the second cylinder about its axis and succeeds now,
    # lane BT: B4)
    a, b = Cylinder(3, 40).translate(0, 3, 0), Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)
    with shapes.kernel_call("fuse"):
        return k.boolean(a._copy_brep(), b._copy_brep(), operation=k.BooleanOp.UNION)


def _raw_fillet(brep=None):
    brep = brep or Box(10, 10, 10)._copy_brep()
    try:
        k.fillet_edges(brep, brep.edges(), radius=50.0)  # (a kernel function's own RuntimeError)
    finally:
        ext.delete_brep(brep)


def test_kernel_errors_say_where_the_kernel_gave_up():
    # Release builds compiled the kernel's error reports out (SER and friends only returned), so a
    # KernelError said "SM_ERR at <binding>" and no more. Kernel patch K11 (SmMessages.h) reports
    # each failure to the error callback; the trail keeps the last 48, the failing chain at its end.
    with pytest.raises(KernelError) as e:
        _crossing_holes()
    trace = e.value.trace
    assert isinstance(trace, tuple) and all(_TRACE_ENTRY.match(t) for t in trace), trace
    assert trace[-1].startswith("SM_ERR_BAD_INTERSECTIONS at SmApiBrep.cpp:") and trace[-1].endswith("(SmApiBoolean)")
    assert any(t.endswith("(IntersectTopology)") for t in trace)  # (where kernel patch K1 stops it)
    # the message and the detail are as they were (the trace is its own field)
    assert e.value.status == "SM_ERR_BAD_INTERSECTIONS" and e.value.detail.startswith("SmApiBoolean failed:")
    assert "Kernel trace" not in e.value.detail and "SmTopologyIntersector" not in str(e.value)
    # a selection the kernel cannot round: raised again with its hint, with the trace of the first
    # (the fillet executive itself, lane FO: F8; no SmApiFilletEdges around it)
    p = Box(10, 5, 20) - Cone(4, 5, 20)
    with pytest.raises(KernelError, match="cannot round the selection") as e:
        p.fillet(p.edges(), 0.5)
    assert [t.split(" at ")[0] for t in e.value.trace] == ["SM_ERR_INVALID_INPUT"]
    assert e.value.trace[0].endswith("(CreateFilletCorners)")
    # errors that did not come from a kernel function have none
    assert KernelError("probe", "detail").trace == ()
    with pytest.raises(ModelingError) as e:
        Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 6)  # (smlibpy's own check)
    assert getattr(e.value, "trace", ()) == ()


def test_the_kernel_trace_keeps_the_last_failures():
    ext.clear_kernel_trace()
    assert ext.kernel_trace() == ([], 0)
    (Box(40, 30, 20) - Cylinder(5, 40)).volume  # (no failure on the way)
    assert ext.kernel_trace() == ([], 0)
    with pytest.raises(RuntimeError, match="SmApiFilletEdges failed: SM_ERR"):
        _raw_fillet()
    entries, n = ext.kernel_trace()
    assert n == len(entries) == 4 and entries[-1].endswith("(SmApiFilletEdges)")
    chain = list(entries)
    breps = [Box(10, 10, 10)._copy_brep() for _ in range(19)]  # (smlibpy's calls clear the trace: kernel_call)
    ext.clear_kernel_trace()
    for brep in breps:
        with pytest.raises(RuntimeError):
            _raw_fillet(brep)
    entries, n = ext.kernel_trace()
    assert n == 76 and len(entries) == 48 and entries == (chain * 12)[-48:]  # (the first 28 dropped)
    ext.clear_kernel_trace()
    assert ext.kernel_trace() == ([], 0)


def test_the_kernel_trace_comes_back_from_another_process(mode):
    # A step in another process (smlibpy._guard): its KernelError, or the kernel function's own error
    # that kernel_call turns into one here, comes with the trace of the kernel there.
    with pytest.raises(KernelError) as e:
        isolated("probe", _crossing_holes)
    assert e.value.trace and e.value.trace[-1].endswith("(SmApiBoolean)")
    ext.clear_kernel_trace()
    with pytest.raises(KernelError) as e:
        with shapes.kernel_call("probe"):
            isolated("probe", _raw_fillet)
    assert len(e.value.trace) == 4 and e.value.trace[-1].endswith("(SmApiFilletEdges)")
    assert ext.kernel_trace() == ([], 0)  # (this process's kernel did not fail)


# == N7: the kernel leaves the C library's random numbers alone =============================================
@pytest.mark.skipif(os.name == "nt", reason="the C library of the Python process is not the kernel's on Windows")
def test_inner_shell_classification_leaves_rand_alone():
    # SmFace::GetPointsInFace and SmShell::IsInnerShellOf reseeded the process-wide rand() from the
    # clock (srand(time(NULL))), so the points their rays start from changed from second to second
    # and every other user of rand() was reseeded. Kernel patch K10: a generator of their own.
    import ctypes

    libc = ctypes.CDLL(None)
    libc.rand.restype = ctypes.c_int
    libc.srand(42)
    expected = [libc.rand() for _ in range(6)]
    libc.srand(42)
    first = [libc.rand() for _ in range(3)]
    void = Box(20, 20, 20) - Box(10, 10, 10)  # (a cavity: which shell is inside which)
    apart = (Box(5, 5, 5) + Box(5, 5, 5).translate((20, 0, 0))).solids()
    assert first + [libc.rand() for _ in range(3)] == expected
    assert void.volume == approx(7000) and len(void.solids()) == 1 and len(apart) == 2


# == N4: NVIDIA's BrepArray validator on what export_usd writes =============================================
USD_VALIDATOR = TOOLS / "oracles" / "usd_validator.py"
USD_SAMPLES = TOOLS.parent / "third_party" / "usd-brep" / "TestFiles"


def _validated(*paths) -> dict:
    """{file name: {code: count}} of NVIDIA's BrepArray rules (tools/oracles/usd_validator.py, in a
    process of its own: its pxr is a shim of OpenUSD's)."""
    import collections
    import json
    import subprocess
    import sys

    run = subprocess.run([sys.executable, "-I", str(USD_VALIDATOR), "--json", *map(str, paths)], capture_output=True,
                         text=True, timeout=600)
    assert run.returncode in (0, 1), run.stderr
    return {os.path.basename(f): dict(collections.Counter(c for c, _ in r["issues"])) for f, r in json.loads(run.stdout).items()}


@pytest.mark.skipif(not USD_SAMPLES.is_dir(), reason="usd-brep's test files are not checked out")
def test_the_usd_validator_finds_what_its_own_files_break():
    # Calibration of the shim: upstream's file for each rule fails that rule, its good files pass.
    files = sorted((USD_SAMPLES / "brep_validator").glob("Test_BA_*.usda"))
    found = _validated(*files, *(USD_SAMPLES / "brep_validator" / n for n in ("Cube.usda", "cubeWithVoid.usda",
                                                                               "nonManifoldCubes.usda", "CubeBrepArray.usda")))
    assert len(files) > 100
    for f in files:
        rule = "BA." + f.name.split("_")[2]
        assert rule in found[f.name], (f.name, found[f.name])
    assert [found[n] for n in ("Cube.usda", "cubeWithVoid.usda", "nonManifoldCubes.usda", "CubeBrepArray.usda")] == [{}] * 4


def test_usd_files_smlibpy_writes_pass_nvidias_validator(tmp_path):
    # docs/files.md said the test suite checked the files with NVIDIA's validator; nothing did. Its
    # rules on what export_usd writes: analytic and NURBS faces, cavities, cells, sheets, text, a part
    # far from the origin and a tiny one, several bodies with meshes.
    rounded = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)
    bodies = {
        "box": Box(10, 20, 30), "ball": Sphere(5), "ring": Torus(10, 3), "cone": Cone(5, 2, 10), "rounded": rounded,
        "countersunk": Box(30, 30, 10) - Cone(6, 3, 3).translate((0, 0, 3.5)) - Cylinder(3, 10),
        "cup": Box(30, 30, 30).shell(2, Box(30, 30, 30).faces().top()), "void": Box(10, 10, 10) - Sphere(2),
        "cells": Box(10, 10, 10).merge(Sphere(4).translate((0, 0, 5))), "slanted": Box(20, 20, 20) - Cylinder(3, 40).rotate(X, 30),
        "far": Box(10, 10, 10).translate((1e6, 0, 0)), "tiny": Box(0.01, 0.01, 0.01), "text": extrude(Text("Ab", 10), 2),
        "sheet": surface([[(x * 10, y * 10, 3 * ((x - 2) ** 2 - (y - 2) ** 2) / 4) for x in range(5)] for y in range(5)]),
        "loft": loft([Circle(5), Rectangle(6, 6).moved(Location((0, 0, 10)))]), "spring": sweep(Circle(0.5).moved(Location((5, 0, 0), (90, 0, 0))), Helix(5, 3, 12)),
        "nurbs_ball": Sphere(5).to_nurbs(), "nurbs_void": (Box(10, 10, 10) - Sphere(2)).to_nurbs(),
        "nurbs_rounded": rounded.to_nurbs(),
    }
    for name, body in bodies.items():
        export_usd(body.named(name), tmp_path / f"{name}.usda", mesh=False)
    export_usd([Box(10, 10, 10).named("a"), Sphere(3).translate((20, 0, 0)).named("b")], tmp_path / "two.usda")
    found = _validated(*sorted(tmp_path.glob("*.usda")))
    assert found == {f"{n}.usda": {} for n in [*bodies, "two"]}


@pytest.mark.skipif(not USD_SAMPLES.is_dir(), reason="usd-brep's test files are not checked out")
def test_usd_files_smlibpy_writes_again_pass_nvidias_validator(tmp_path):
    # Bodies read from other writers' files and written again, and a box read with analytic line edges:
    # the rules but BA.465 (control points in the body's box), which upstream's own files fail (rational
    # NURBS) and which the plan exempts for them. A body read and checked (SmBrep::AssertValid) carries
    # UV curves; the loop of a sphere's face up and down its seam does not close in them, which BA.763
    # wants: such loops are written without UV curves (read back the same).
    for name in ("Cube.usda", "cubeWithVoid.usda", "nonManifoldCubes.usda", "Cone_SmConnect_Brep.usda", "mouse.usda"):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # (mouse.usda: gaps of 2e-3)
            body = import_usd(USD_SAMPLES / "brep_validator" / name)
        export_usd(body, tmp_path / name, mesh=False)
        again = import_usd(tmp_path / name)
        assert again.volume == approx(body.volume, rel=1e-9) and len(again.faces()) == len(body.faces())
    # (export_usd writes a box's edges with the schema's line now, lane IX: X5)
    export_usd(Box(10, 10, 10), tmp_path / "lines.usda", mesh=False)
    assert "BrepCurve3dLineAPI:edge3dLine" in (tmp_path / "lines.usda").read_text()
    export_usd(import_usd(tmp_path / "lines.usda"), tmp_path / "Lines_again.usda", mesh=False)
    found = _validated(*(tmp_path / n for n in ("Cube.usda", "cubeWithVoid.usda", "nonManifoldCubes.usda",
                                               "Cone_SmConnect_Brep.usda", "mouse.usda", "Lines_again.usda")))
    assert {n: {c: k for c, k in codes.items() if c != "BA.465"} for n, codes in found.items()} == {n: {} for n in found}
    assert found["Cone_SmConnect_Brep.usda"] == {"BA.465": 1} and found["mouse.usda"] == {"BA.465": 1}


def test_usd_files_of_names_and_empty_parts_against_the_validator(tmp_path):
    # Names outside ASCII and empty parts (kernel plan X3 and X10, another lane's): what this branch
    # does is an xfail; once they are refused or written well, the file must pass.
    try:
        export_usd(Cylinder(4, 8).named("Größe 部品"), tmp_path / "name.usda", mesh=False)
    except UnicodeDecodeError:
        pytest.xfail("X3: a name outside ASCII breaks export_usd")
    assert _validated(tmp_path / "name.usda") == {"name.usda": {}}
    empty = Box(10, 10, 10) & Box(10, 10, 10).translate((30, 0, 0))
    with pytest.raises(ValueError, match="is empty"):  # (X10: refused, lane IX)
        export_usd(empty, tmp_path / "empty.usda", mesh=False)


# == N5, W16: the golden files of smlibwasm's parity test (tools/parity.py) =================================
def test_the_parity_golden_files_are_current():
    # js/test/lane_WN.test.ts compares smlibwasm's writers and results with these files: they must be
    # what smlibpy makes now (python tools/parity.py --update writes them).
    import subprocess
    import sys

    parity = _tool("parity.py")
    # (in a process of its own: its steps include fillets of imported parts and the cases of KNOWN)
    run = subprocess.run([sys.executable, str(TOOLS / "parity.py")], capture_output=True, text=True, timeout=600)
    assert run.returncode == 0, run.stdout + run.stderr
    golden = __import__("json").loads((parity.GOLDEN / "golden.json").read_text())
    assert set(golden["known"]) == set(parity.KNOWN) and golden["platform"] == "darwin-arm64"
    # W16: the vase fillets that the native arm64 build makes and smlibwasm cannot; also a part of the
    # fuzz run's divergences. Both come from the arm64 build's contraction of a * b + c.
    if parity.FMA and "vase1 fillet" in golden["cases"]:
        assert golden["cases"]["vase1 fillet"]["valid"] and golden["cases"]["vase1 fillet"]["faces"] == 51
    # (the fuzz run's cone and cylinder merge agrees now, at OpenCASCADE's 150.26185: lane BT, B6)
    assert all(parity.KNOWN[n]["fma"] for n in ("vase1 fillet", "vase3 fillet"))


def test_the_parity_comparison_tells_numbers_from_text():
    parity = _tool("parity.py")
    a = "FILE_NAME('a.step','2026-10-22T12:00:00',(''),(''),'smlibpy','x','');\n#3=POINT((1.0,2.000000000000001));"
    b = "FILE_NAME('','2026-10-22T12:00:09',(''),(''),'smlibwasm','x','');\n#3=POINT((1.0,1.9999999999999998));"
    assert parity.same_text(a, b) is None
    assert parity.same_text(a, b.replace("1.9999999999999998", "2.001")) == "number 2: 2.000000000000001 against 2.001"
    assert parity.same_text(a, b.replace("POINT", "PLANE")).startswith("text")
    assert parity.same_value({"v": 1.0, "n": 3}, {"v": 1.00000001, "n": 3}) is None
    assert parity.same_value({"v": 1.0, "n": 3}, {"v": 1.0, "n": 4}) == ".n: 3 against 4"
    assert parity.same_value({"error": "KernelError"}, {"volume": 3.0}).startswith(": keys")



# == fillets of parts read from files, with the guard off (found by AddressSanitizer in this batch) =========
def test_fillets_of_imported_parts_keep_their_body_with_the_guard_off(monkeypatch, tmp_path):
    # With GUARD_SECONDS = 0, or where no helper process starts, the step of a part read from a file
    # ran in this process and returned the copy that the step's handle still held: the handle freed
    # the result's body with itself (AddressSanitizer: reads of freed memory in brep_measure and
    # CalculateTightBoundingBox, from all-edge fillets of usd-brep's vase1.smb; a crash of the
    # process in a run of the whole suite).
    import gc

    monkeypatch.setattr(defeature, "GUARD_SECONDS", 0)
    save(Box(10, 10, 10), tmp_path / "box.smb")
    part = load(tmp_path / "box.smb")
    assert part._h.imported
    freed = []
    real = ext.delete_brep
    monkeypatch.setattr(ext, "delete_brep", lambda b: (freed.append(b), real(b))[1])
    rounded = part.fillet(part.edges(), 1)
    chamfered = part.chamfer(part.faces().top()[0].edges(), 1)
    gc.collect()
    assert not any(b is rounded._h.brep or b is chamfered._h.brep for b in freed)
    box = Box(10, 10, 10)
    assert rounded.volume == approx(box.fillet(box.edges(), 1).volume, rel=1e-9)
    assert chamfered.volume == approx(box.chamfer(box.faces().top()[0].edges(), 1).volume, rel=1e-9)
    assert rounded.is_valid() and chamfered.is_valid()


# ================================================================================ N8: threads
def _plate_and_tool():
    """A cut of about 0.3 s (macOS arm64) in one kernel call: a plate and a tool of 144 fused pins."""
    pins = list(GridLocations(12, 12, 12, 12) * Cylinder(4, 30))
    return Box(200, 200, 10), pins[0].fuse(*pins[1:])


def _one_cut(plate, tool, boolean=None):
    """The cut as one kernel call: smlibpy's ext.boolean, or SmPyLib's k.boolean bound again
    (src/cpp/nogil.cpp), which return a new body (the kernel deletes the operands' copies)."""
    a, b = plate._copy_brep(), tool._copy_brep()
    t = time.perf_counter()
    if boolean is None:
        r = ext.boolean(a, b, k.BooleanOp.DIFFERENCE)
    else:
        r = boolean(a, b, operation=k.BooleanOp.DIFFERENCE)
    dt = time.perf_counter() - t
    try:
        return r.face_count(), dt
    finally:
        ext.delete_brep(r)


def test_long_kernel_calls_let_other_threads_run():
    # No kernel call let the GIL go: a 0.29 s Boolean froze another Python thread for 0.293 s. Now
    # the long ones let it go while the kernel works.
    plate, tool = _plate_and_tool()
    ticks, stop = [], threading.Event()

    def ticker():
        while not stop.is_set():
            ticks.append(time.perf_counter())
            time.sleep(0.002)

    th = threading.Thread(target=ticker)
    th.start()
    try:
        time.sleep(0.02)
        calls = []
        for boolean in (None, k.boolean, k.booleans.boolean):  # (smlibpy's, SmPyLib's in both places)
            t0 = time.perf_counter()
            faces, dt = _one_cut(plate, tool, boolean)
            calls.append((t0, time.perf_counter(), faces, dt))
        rounded = Box(40, 40, 10).fillet(Box(40, 40, 10).edges(), 3)
        t0 = time.perf_counter()
        mesh = rounded.mesh(0.0005)  # (ext.tessellate, 0.3 s)
        t1 = time.perf_counter()
    finally:
        stop.set()
        th.join()
    assert len(mesh.triangles) > 50000
    for t0, t1, faces, dt in calls + [(t0, t1, 150, t1 - t0)]:
        during = [t for t in ticks if t0 <= t <= t1]
        gaps = [b - a for a, b in zip(during, during[1:])]
        assert faces == 150 and dt > 0.05
        assert len(during) > 20 and max(gaps) < dt / 3, (len(during), max(gaps, default=None), dt)


def test_every_entry_point_of_the_kernel_takes_its_lock():
    # (functions of the module and its submodules, methods and properties of its classes)
    import types

    from smlibpy import _core

    seen, found, unlocked = set(), [], []

    def check(name, fn):
        locked = ext.kernel_locked(fn)
        if locked is not None:
            found.append(name)
            if not locked:
                unlocked.append(name)

    def walk(owner, prefix):
        if id(owner) in seen:
            return
        seen.add(id(owner))
        for name, v in vars(owner).items():
            if isinstance(v, types.ModuleType):
                if v.__name__.startswith(_core.__name__ + "."):
                    walk(v, prefix + name + ".")
            elif isinstance(v, type):
                if v.__module__.startswith(_core.__name__):
                    walk(v, prefix + name + ".")
            elif isinstance(v, property):
                for part in (v.fget, v.fset, v.fdel):
                    check(prefix + name, part)
            elif isinstance(v, (staticmethod, classmethod)):
                check(prefix + name, v.__func__)
            else:
                check(prefix + name, v)

    walk(_core, "")
    assert len(found) > 600 and {"boolean", "fillets.fillet_edges", "Brep.face_count", "ext.delete_brep"} <= set(found)
    assert unlocked == ["ext.kernel_lock_waits", "ext.kernel_locked"]  # (these two only count)


def test_kernel_calls_of_other_threads_wait_for_a_long_one():
    # The kernel is not thread-safe: every entry point takes one lock, the cheap ones too (functions,
    # methods, properties, deletions), so they wait while another thread's long call runs.
    plate, tool = _plate_and_tool()
    box = Box(10, 20, 30)
    brep, face = box._brep, box.faces()[0]._f
    probes = {
        "function": lambda: k.create_box((0, 0, 0), 1, 2, 3),
        "method": lambda: brep.face_count(),
        "ext": lambda: ext.face_indices(brep, [face]),
        "deletion": lambda: ext.delete_brep(box._copy_brep()),
    }
    for name, probe in probes.items():
        inside, out = threading.Event(), {}

        def long_call():
            inside.set()
            out["cut"] = _one_cut(plate, tool)

        waits = ext.kernel_lock_waits()
        th = threading.Thread(target=long_call)
        th.start()
        inside.wait()
        time.sleep(0.05)  # (the cut takes 0.3 s)
        t = time.perf_counter()
        result = probe()
        waited = time.perf_counter() - t
        th.join()
        assert out["cut"][0] == 150
        assert ext.kernel_lock_waits() > waits and waited > 0.03, (name, waited)
        if name == "function":
            ext.delete_brep(result)
    assert brep.face_count() == 6  # (and nothing broke)


@pytest.mark.filterwarnings("ignore:This process .* is multi-threaded:DeprecationWarning")  # (shells fork)
def test_threads_that_model_at_once_get_what_one_thread_gets():
    def work(i):
        part = Box(20 + i, 30, 10) - Cylinder(4, 20).translate(i, 0, 0)
        part = part.fillet(part.edges().parallel_to(Z), 2)
        shell = part.shell(-1, part.faces().top())
        swept = sweep(Circle(2), Line((0, 0, 0), (0, 0, 20 + i)))
        lofted = loft([Rectangle(10, 10), Circle(4).translate(0, 0, 10 + i)])
        mesh = part.mesh(0.05)
        return (round(part.volume, 6), round(shell.volume, 6), round(swept.volume, 6), round(lofted.volume, 6),
                len(mesh.triangles), round(part.distance_to(Box(5, 5, 5).translate(0, 0, 40)), 9),
                tuple(round(v, 9) for v in part.bbox().max))

    alone = [work(i) for i in range(6)]
    shared = Box(30, 30, 30) - Sphere(12)
    reads, errors, results = [], [], [None] * 6

    def run(i):
        try:
            results[i] = work(i)
            for _ in range(5):
                reads.append((round(shared.volume, 6), len(shared.faces()), round(shared.distance_to((100, 0, 0)), 9)))
                for _ in range(20):  # (bodies made and freed: finalizers in every thread)
                    Box(1, 1, 1).translate(i, 0, 0)
        except BaseException as e:  # pragma: no cover - reported below
            errors.append(e)

    waits = ext.kernel_lock_waits()
    threads = [threading.Thread(target=run, args=(i,)) for i in range(6)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert not errors, errors
    assert results == alone
    assert len(set(reads)) == 1 and len(reads) == 30
    assert ext.kernel_lock_waits() > waits  # (they did meet)


@pytest.mark.skipif(not HAS_FORK, reason="no os.fork")
def test_a_fork_waits_for_another_threads_kernel_call():
    # A forked copy has only the forking thread. Without the at-fork hooks it could start with kernel
    # state another thread was changing, and with the kernel lock held by a thread it does not have.
    plate, tool = _plate_and_tool()
    inside, out = threading.Event(), {}

    def long_call():
        inside.set()
        out["cut"] = _one_cut(plate, tool)

    part = Box(10, 10, 10) - Cylinder(2, 20)
    expected = part.fillet(part.edges().parallel_to(Z), 1).volume
    th = threading.Thread(target=long_call)
    th.start()
    inside.wait()
    time.sleep(0.05)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)  # (forking a process with threads)
        pid = os.fork()
    if pid == 0:  # pragma: no cover - the copy
        code = 1
        try:
            again = Box(10, 10, 10) - Cylinder(2, 20)
            code = 0 if again.fillet(again.edges().parallel_to(Z), 1).volume == expected else 2
        finally:
            os._exit(code)
    deadline = time.monotonic() + 30
    while True:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        if time.monotonic() > deadline:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            pytest.fail("the forked copy waited for the kernel lock")
        time.sleep(0.01)
    th.join()
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
    assert out["cut"][0] == 150
    # the guard's copies too, while another thread works
    th = threading.Thread(target=long_call)
    th.start()
    inside.wait()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(defeature, "GUARD_PROCESS", "fork")
        mp.setattr(defeature, "GUARD_SECONDS", 30.0)
        assert isolated("probe", _bodies, 3)["n"] == 3
    th.join()


# The SmPyLib bindings bound again with the GIL let go (src/cpp/nogil.cpp), and a hash of the source
# each was copied from (from `m.def("name"` to its docstring, blanks collapsed). A change upstream
# fails here: copy it into nogil.cpp, then update the hash.
_NOGIL_SOURCES = {
    "boolean": "8791083e676041d1",  # SmPyBooleans.cpp
    "boolean_with_options": "73e44a942abac7ac",  # SmPyBooleans.cpp
    "boolean_2d": "0a680a7224916a78",  # SmPyBooleans.cpp
    "non_manifold_boolean": "a51d755a24de47ff",  # SmPyBooleans.cpp
    "chamfer_fillet": "1b8473e1f1c7c8ad",  # SmPyFillets.cpp
    "circular_fillet": "0a669893ba280c16",  # SmPyFillets.cpp
    "fillet_edges": "9b673965dd2673a5",  # SmPyFillets.cpp
    "variable_radius_fillet": "42dbef934ad66dc7",  # SmPyFillets.cpp
    "fillet_edges_per_edge": "028c218e8f4c3b04",  # SmPyFillets.cpp
    "surface_surface_fillet": "ae6e1eed1412838c",  # SmPyFillets.cpp
    "shell_brep": "1fdaeadf0297c877",  # SmPyOffset.cpp
    "offset_brep": "5f247058d152fe6b",  # SmPyOffset.cpp
    "linear_sweep": "5b1f1a0879976d12",  # SmPySweeps.cpp
    "rotational_sweep": "a96c5ff846349ccd",  # SmPySweeps.cpp
    "draft_sweep": "5e2179d06af84439",  # SmPySweeps.cpp
    "pipe_sweep": "6205b2e8591234bf",  # SmPySweeps.cpp
    "sweep_along_planar_path": "c439a85bc2db6863",  # SmPySweeps.cpp
    "create_skin_primitive": "20c107a99b146f89",  # SmPyPrimitives.cpp
    "heal_brep": "d2984c865745d825",  # SmPyHeal.cpp
    "stitch_into_solid": "d834737efb6927f0",  # SmPyStitching.cpp
    "stitch_into_shell": "f666b36103d7913a",  # SmPyStitching.cpp
    "poly_boolean": "609b971e489ae738",  # SmPyPolyOps.cpp
}


def test_smpylibs_long_calls_are_bound_again_as_they_were():
    import hashlib
    import pathlib
    import re

    assert ext.nogil_mismatches() == []  # (same signature and docstring as SmPyLib's, or kept as it was)
    assert sorted(ext.nogil_rebound()) == sorted(_NOGIL_SOURCES)
    for name in _NOGIL_SOURCES:  # (both places: k.<name> and k.<category>.<name>)
        assert any(getattr(sub, name, None) is not None and getattr(sub, name) is not getattr(k, name)
                   and getattr(sub, name).__doc__ == getattr(k, name).__doc__
                   for sub in vars(k).values() if isinstance(sub, type(k))), name
    src = pathlib.Path(__file__).resolve().parent.parent / "third_party" / "usd-brep" / "source" / "SmPyLib" / "src"
    if not src.is_dir():
        pytest.skip("no usd-brep checkout")
    texts = [p.read_text() for p in src.glob("SmPy*.cpp")]
    for name, digest in _NOGIL_SOURCES.items():
        (text,) = [t for t in texts if f'm.def("{name}"' in t]
        lines = []
        for line in text[text.index(f'm.def("{name}"'):].splitlines():
            if re.match(r'\s*"', line):
                break
            lines.append(line)
        assert hashlib.sha256(" ".join(" ".join(lines).split()).encode()).hexdigest()[:16] == digest, (
            f"SmPyLib changed {name}: copy it into src/cpp/nogil.cpp again")


def test_rebound_kernel_calls_work_and_fail_as_before():
    a, b = Box(10, 10, 10)._copy_brep(), Box(10, 10, 10).translate(5, 0, 0)._copy_brep()
    r = k.boolean(a, b, operation=k.BooleanOp.UNION)
    try:
        assert k.brep_volume(r) == approx(1500.0) if hasattr(k, "brep_volume") else r.face_count() == 6
    finally:
        ext.delete_brep(r)
    brep = Box(10, 10, 10)._copy_brep()
    try:
        assert k.fillets.fillet_edges(brep, brep.edges()[:1], radius=1.0) is not None and brep.face_count() == 7
        with pytest.raises(RuntimeError, match=r"SmApiFilletEdges failed: SM_ERR"):
            k.fillet_edges(brep, brep.edges(), radius=50.0)
    finally:
        ext.delete_brep(brep)
    with pytest.raises(KernelError) as e:  # (the error trace is still this thread's)
        _crossing_holes()
    assert e.value.trace[-1].endswith("(SmApiBoolean)")
    part = Box(20, 20, 20)
    assert part.shell(-2, part.faces().top()).volume == approx(8000 - 16 * 16 * 18)


# ================================================================================ N9: query caches
def test_compact_frees_what_queries_left_on_a_body():
    # The kernel keeps what a query computes on the body's curves and surfaces for the body's life:
    # on 300 copies of this part, bbox() added 41 KB to each one's 129 KB, mesh() 754 KB and
    # distance_to() 799 KB (heap, macOS arm64).
    part = Box(40, 30, 10) - Cylinder(5, 20)
    part = part.fillet(part.edges().parallel_to(Z), 2)
    target = Box(5, 5, 5).translate(0, 0, 100)
    ext.drop_caches(part._brep)  # (what the fillet left)
    assert ext.drop_caches(part._brep) == (0, 0.0)
    before = (part.bbox(), part.distance_to(target), len(part.mesh().triangles), part.volume)
    count, size = ext.drop_caches(part._brep)
    assert count >= 5 and size > 500_000, (count, size)
    assert ext.drop_caches(part._brep) == (0, 0.0)
    # compact() does that, and the body answers as before
    part.distance_to(target)
    assert part.compact() is None and ext.drop_caches(part._brep) == (0, 0.0)
    after = (part.bbox(), part.distance_to(target), len(part.mesh().triangles), part.volume)
    assert after[0].min == before[0].min and after[0].max == before[0].max and after[1:] == before[1:]
    assert ext.drop_caches(part._brep)[0] > 0  # (built again)
    # faces and edges of a compacted body, sketches and shells
    part.compact()
    assert sum(f.area for f in part.faces()) == approx(part.area, rel=1e-9) and part.is_valid()
    sketch = Rectangle(10, 5) - Circle(1)
    sheet = extrude(Line((0, 0), (10, 0)), 3)
    sketch.bbox(), sheet.mesh()
    sketch.compact(), sheet.compact()
    assert ext.drop_caches(sketch._brep) == (0, 0.0) and ext.drop_caches(sheet._brep) == (0, 0.0)
    assert sketch.area == approx(50 - math.pi) and sheet.area == approx(30)


def test_compact_gives_the_memory_back():
    # (the heap the C allocator counts; tools/sanitize/guard_off.py leaves this test out)
    import gc

    if _heap() is None:
        pytest.skip("no allocator statistics here")
    base = Box(40, 30, 10) - Cylinder(5, 20)
    base = base.fillet(base.edges().parallel_to(Z), 2)
    target = Box(5, 5, 5).translate(0, 0, 100)
    parts = [base.translate(i * 50, 0, 0) for i in range(50)]
    gc.collect()
    made = _heap()
    for p in parts:
        p.distance_to(target), p.mesh()
    gc.collect()
    queried = _heap()
    for p in parts:
        p.compact()
    gc.collect()
    compacted = _heap()
    per_part = (queried - made) / 50
    assert per_part > 500_000, per_part  # (about 1.2 MB each on macOS arm64)
    assert (compacted - made) / 50 < 0.02 * per_part, ((compacted - made) / 50, per_part)
