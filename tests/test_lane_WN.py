"""Lane WN of the kernel plan: isolated kernel steps (N1), memory (N2), the fuzz harness (N3)."""

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
    monkeypatch.setattr(k, "fillet_edges", _counted(k.fillet_edges))
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


def test_cells_that_crash_the_stitcher_raise(mode):
    # Found by the fuzz run (seed 20261022, case csg-153): the stitcher behind cells() reads a null
    # polar box (SmBezierAux2d::BuildPolarBox, from SmBrep::FindInfiniteRegion's ray) on this merge
    # of a cone and a cylinder, and ended the process (exit 139). It runs in another process now.
    m = Cone(3, 0, 4).rotate(X, 90).merge(Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3))
    assert m.volume == approx(149.1926689941786, rel=1e-9)
    with pytest.raises(KernelError, match="cells failed") as e:
        m.cells()
    assert "the kernel crashed" in e.value.detail
