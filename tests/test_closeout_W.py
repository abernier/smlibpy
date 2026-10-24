"""Close-out of area W of the kernel plan (phase 1): what the review of 0.5.0 left open in the runtime and the
infrastructure. Three things held on macOS only (N2; CI's Linux jobs check them): rounds close to the largest
radius that came back open (F7 on Linux x86_64), the parity check's files written from bodies the platform made
(N5) and the oracle of SmPyLib's tests; N5 covers the capabilities of phase 1;
N4 runs NVIDIA's own validator (usd-brep[validation]) where it is installed; W2's deadline inside the kernel
holds a step that no other process runs to GUARD_SECONDS."""

import importlib.util
import json
import math
import subprocess
import sys
import textwrap
import time
import warnings
from pathlib import Path

import pytest
from pytest import approx

from smlibpy import Box, Cylinder, Part, Sphere, export_usd
from smlibpy._kernel import KernelError, ext, k
from smlibpy.shapes import _NEAR_LIMIT

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"


def _tool(name: str):
    path = TOOLS / name
    spec = importlib.util.spec_from_file_location(path.stem + "_closeout_w", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _rounded_cube(s, r):
    a = s - 2 * r
    return a ** 3 + 6 * a * a * r + 3 * math.pi * a * r * r + 4 / 3 * math.pi * r ** 3


# == F7 on Linux x86_64 (found by N2) ===========================================================================
def test_rounds_that_fill_the_room_between_edges_measure_their_gaps(monkeypatch):
    # A 20 mm cube rounded by 9.97 at all edges came back from fillet() with gaps between its faces on
    # Linux x86_64 (2132.03 for 4207.63, a warning about its volume): SM_API's coarser tolerance left the
    # rounds open, and the check of the result measured no gaps, which only the slower measure sees. Rounds
    # whose setbacks fill more than _NEAR_LIMIT of the room between two edges now measure them, so the round
    # is made again within the finer tolerance there.
    b = Box(20, 20, 20)
    edges = b.edges()
    fill = b._check_round_sizes(edges, [b._setback(e, 9.97) for e in edges], "fillet", "radius")
    assert fill == approx(19.94 / 20) and fill > _NEAR_LIMIT
    assert b._check_round_sizes(edges, [b._setback(e, 5) for e in edges], "fillet", "radius") == approx(0.5)
    assert b._check_round_sizes(b.edges().filter(lambda e: e.center().z > 9), [1.0] * 4, "fillet", "radius") == approx(0.1)
    # the checks of the results measure the gaps where the rounds fill the room (SM_API's own round of the
    # cube, the tolerance factor 4, is refused on any platform: inside out on macOS arm64, open on Linux x86_64)
    asked = []
    solid_problem = Part._solid_problem

    def spy(self, volume=None, gaps=False):
        asked.append(gaps)
        return solid_problem(self, volume, gaps)

    monkeypatch.setattr(Part, "_solid_problem", spy)
    Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 5)
    assert True not in asked  # (the input's check, and the result's without the gaps)
    asked.clear()
    Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 9.97)
    assert True in asked
    monkeypatch.undo()
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # (no warning about an uncertain volume)
        for s, r in ((10, 4.98), (20, 9.97), (40, 19.96)):
            cube = Box(s, s, s)
            rounded = cube.fillet(cube.edges(), r)
            assert rounded.is_valid() and rounded.volume == approx(_rounded_cube(s, r), rel=1e-9)


# == N5: parity on any platform, and the capabilities of phase 1 =============================================
def test_the_parity_files_come_from_the_golden_bodies_on_other_platforms(tmp_path):
    # tools/parity.py wrote the files of the writers from bodies it made itself: on Linux x86_64 the plate
    # comes out a little different (no contraction of a * b + c), and so did parts.step and parts.usda, which
    # failed test_the_parity_golden_files_are_current there. Elsewhere than on the golden files' platform
    # the writers get the golden .smb bodies, as smlibwasm's test gives them.
    parity = _tool("parity.py")
    parity.write_files(tmp_path, parity.GOLDEN)
    for name, kind in parity.FILES.items():
        mine, theirs = (tmp_path / name).read_text(), (parity.GOLDEN / name).read_text()
        if kind == "json":
            assert parity.same_value(json.loads(parity.normalized(mine)), json.loads(parity.normalized(theirs)), 1e-9) is None
        else:
            assert parity.same_text(mine, theirs) is None, name
    assert not (tmp_path / "plate.smb").exists()  # (read from the golden folder, not written again)


def test_the_parity_golden_files_hold_the_capabilities_of_phase_1():
    # The parity of lane WN covered 18 modelling steps; these are one or more steps of each capability
    # phase 1 added, which js/test/closeout_W.test.ts makes with smlibwasm.
    parity = _tool("parity.py")
    golden = json.loads((parity.GOLDEN / "golden.json").read_text())
    names = set(parity.capabilities())
    assert set(golden["capabilities"]) == names and len(names) >= 50
    assert not [n for n, r in golden["capabilities"].items() if isinstance(r, dict) and "error" in r]
    js = ROOT / "js" / "test" / "closeout_W.test.ts"
    if js.is_file():  # (smlibwasm's side: the same names)
        assert all(f"'{n}'" in js.read_text() or f"  {n}: " in js.read_text() for n in names)


# == N2: upstream's tests of SmPyLib, and what smlibpy does differently =========================================
def test_the_helix_cap_smlibpy_lifts_gives_a_curve_within_the_tolerance():
    # tools/oracles/smpylib_tests.py leaves upstream's test_create_helix_tolerance_is_enforced out: it expects
    # 120 turns at 1e-6 to fail at the fitter's control-point cap, which smlibpy lifts (kernel plan C4). The
    # curve is within the tolerance, by the upstream test's own measure (4.8e-7).
    tests = ROOT / "third_party" / "usd-brep" / "source" / "SmPyLib" / "tests"
    if not (tests / "test_omni_solid.py").is_file():
        pytest.skip("usd-brep's SmPyLib tests are not checked out")
    code = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(tests)!r})
        import test_omni_solid as T, _omni_solid as sm
        h = sm.create_helix((0, 0, 0), 10.0, 2.0, 2.0, 120.0, tolerance=1e-6)
        t = T.TestCurves("test_create_helix_tolerance_is_enforced")
        print(t._max_helix_3d_dev(h, (0, 0, 0), 10.0, 2.0, 2.0, 120.0, True))
    """)
    # The shim first, then the smlibpy this process imported (the checkout's src/ in place, site-packages for an
    # installed wheel: the checkout's src/ has no _core there), then whatever PYTHONPATH held.
    import os
    import smlibpy
    paths = [str(TOOLS / "oracles" / "shim"), str(Path(smlibpy.__file__).resolve().parent.parent)]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(paths + [p for p in [os.environ.get("PYTHONPATH")] if p])}
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300, env=env)
    assert run.returncode == 0, run.stderr
    assert float(run.stdout.split()[-1]) < 1e-6


def test_the_oracle_lists_why_it_leaves_upstreams_tests_out():
    oracle = _tool("oracles/smpylib_tests.py")
    assert "TestCurves::test_create_helix_tolerance_is_enforced" in oracle.KNOWN
    assert sum(name.startswith("TestTransforms::") for name in oracle.KNOWN) == 4


# == N3: the fuzz baseline of Linux x86_64 ======================================================================
def test_the_fuzz_baseline_has_linux_x86_64():
    # The baseline was darwin-arm64 only, so the fuzz job on ubuntu-latest compared nothing but crashes and
    # rates. Its entry was made in a linux/amd64 container (three runs of seeds 7 and 8, with smlibwasm).
    base = json.loads((TOOLS / "fuzz" / "baseline.json").read_text())
    assert {"darwin-arm64", "linux-x86_64"} <= set(base)
    linux = base["linux-x86_64"]
    assert set(linux["seeds"]) == {"7", "8"} and all(s["cases"] == 410 for s in linux["seeds"].values())
    assert set(linux["rates"]) == {"python", "wasm"}


# == N4: NVIDIA's validator itself ==============================================================================
_REAL = importlib.util.find_spec("brep_validator") is not None and importlib.util.find_spec("usd_validation_nvidia") is not None


@pytest.mark.skipif(not _REAL, reason="usd-brep[validation] is not installed (CI's Linux job installs it)")
def test_usd_files_smlibpy_writes_pass_nvidias_own_validator(tmp_path):
    # tools/oracles/usd_validator.py runs the validator's rules on a shim of OpenUSD; with usd-brep[validation]
    # installed this runs validate_file itself: the BrepArray rules pass for every file, and of the asset
    # validator's general rules only UsdAsciiPerformanceChecker complains (large arrays in a text file).
    from smlibpy import Cone, Cylinder, Text, Torus, extrude

    rounded = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)
    bodies = {"box": Box(10, 20, 30), "ball": Sphere(5), "ring": Torus(10, 3), "cone": Cone(5, 2, 10), "rounded": rounded,
              "void": Box(10, 10, 10) - Sphere(2), "cells": Box(10, 10, 10).merge(Sphere(4).translate((0, 0, 5))),
              "text": extrude(Text("Ab", 10), 2), "sectors": Cylinder(5, 10, arc_size=90), "names": Box(5, 5, 5)}
    for name, body in bodies.items():
        export_usd(body.named("Grüße 1/2" if name == "names" else name), tmp_path / f"{name}.usda", mesh=False)
    script = textwrap.dedent(f"""
        import glob, json, os
        from brep_validator import validate_file
        def main():
            out = {{}}
            for f in sorted(glob.glob({str(tmp_path)!r} + '/*.usda')):
                brep = validate_file(f, brep_only=True, workers=1)
                full = validate_file(f, workers=1)
                out[os.path.basename(f)] = [brep.passed, brep.brep_array_count, full.passed,
                                            [m for m in full.messages if 'UsdAsciiPerformanceChecker' not in m]]
            print(json.dumps(out))
        if __name__ == '__main__':
            main()
    """)
    run = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=1200)
    assert run.returncode == 0, run.stderr
    found = json.loads(run.stdout.strip().splitlines()[-1])
    assert set(found) == {f"{n}.usda" for n in bodies}
    for name, (brep, count, _, others) in found.items():
        assert brep and count == 1 and others == [], (name, others)


# == W2: the kernel's deadline, for the steps no other process runs ============================================
def _cut():
    return (Box(10, 10, 10) - Cylinder(3, 20)).volume


def test_the_kernels_deadline_stops_its_intersections_and_is_cleared():
    # Past the deadline, the loops of the kernel's surface and topology intersections give up
    # (SM_ERR_METHOD_FAILURE_QUITING, through the error paths they have), and so does every later test of it
    # until the deadline is set again; cleared, the kernel works as before.
    good = _cut()
    ext.set_deadline(1e-9)
    try:
        time.sleep(1e-3)
        with pytest.raises(KernelError) as e:
            _cut()
        assert e.value.status == "SM_ERR_METHOD_FAILURE_QUITING"
        assert any("SmTopologyIntersector.cpp" in t for t in e.value.trace), e.value.trace
        assert ext.deadline_passed()
    finally:
        ext.set_deadline(0)
    assert not ext.deadline_passed()
    assert _cut() == good


def test_a_step_run_in_this_process_is_held_to_guard_seconds(monkeypatch):
    # smlibpy._guard.here: where no other process runs a step (no fork, no helper process), the kernel's
    # deadline holds it to GUARD_SECONDS; a step whose intersections gave up is a _KernelFault, as one that did
    # not finish in another process.
    import smlibpy.defeature as d
    from smlibpy._guard import _KernelFault, here

    def late(work):
        def step():
            time.sleep(0.1)  # (past the deadline)
            return work()
        return step

    good = _cut()
    monkeypatch.setattr(d, "GUARD_SECONDS", 0.05)
    with pytest.raises(_KernelFault, match=r"test step: the kernel did not finish within 0\.05 s"):
        here("test step", late(_cut))
    assert not ext.deadline_passed()
    assert here("test step", _cut) == good  # (in time)
    assert here("test step", late(lambda: Box(1, 2, 3).volume)) == approx(6.0)  # (late, but in no such loop)
    monkeypatch.setattr(d, "GUARD_SECONDS", 0)
    assert here("test step", late(_cut)) == good  # (no limit)


def test_the_enclosure_round_that_loops_returns_at_the_deadline_without_another_process():
    # The kernel's patching of the enclosure example's outer bottom round ran for good (it spends its time in a
    # surface intersection of the feature executive's Booleans). Where no other process can run the step (a
    # frozen application, a helper that does not start), the deadline stops it now. In a process of its own,
    # so that a hang fails the test instead of stopping the suite.
    code = textwrap.dedent(f"""
        import importlib.util, time
        import smlibpy._guard as g, smlibpy.defeature as d
        from smlibpy import ModelingError
        spec = importlib.util.spec_from_file_location("enclosure", {str(ROOT / "examples" / "enclosure.py")!r})
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        g._why_not = "no helper process (test)"  # (as in a frozen application: the steps run here)
        d.GUARD_PROCESS = "helper"
        d.GUARD_SECONDS = 2.0
        box = m.model()[0]
        rounds = [f for f in box.faces().fillets() if f.center().z < 2 and f.geom_type == "cylinder"][:1]
        t = time.monotonic()
        try:
            box.remove_fillets(rounds)
            print("removed")
        except ModelingError as e:
            print("could not take out 1 of the 1" in str(e), time.monotonic() - t)
        print(box.remove_fillets(rounds, partial=True).volume == box.volume)
    """)
    run = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stderr
    refused, seconds, kept = run.stdout.split()
    assert refused == "True" and kept == "True"
    assert 2.0 <= float(seconds) < 60.0
