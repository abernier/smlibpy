"""Close-out of area W of the kernel plan (phase 1): what the review of 0.5.0 left open in the runtime and the
infrastructure. Three things held on macOS only (N2; CI's Linux jobs check them): rounds close to the largest
radius that came back open (F7 on Linux x86_64), the parity check's files written from bodies the platform made
(N5) and the oracle of SmPyLib's tests; N5 covers the capabilities of phase 1;
N4 runs NVIDIA's own validator where it is installed (usd-brep[validation], or on any platform
usd-validation-nvidia[usd] with the submodule's rules; CI's jobs that install it fail rather than skip without
it); W2's deadline inside the kernel holds a step that no other process runs to GUARD_SECONDS."""

import importlib.util
import json
import math
import os
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
            # (within 1e-6: the rounds are exact within the kernel's tolerance, and builds differ by 1e-7)
            assert rounded.is_valid() and rounded.volume == approx(_rounded_cube(s, r), rel=1e-6)


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
USD_VALIDATOR = TOOLS / "oracles" / "usd_validator.py"
USD_SAMPLES = ROOT / "third_party" / "usd-brep" / "TestFiles" / "brep_validator"


def _nvidia_validator() -> str:
    """Where NVIDIA's validator comes from in this Python (tools/oracles/usd_validator.py's
    nvidia_validator), or a skip; a failure where SMLIBPY_REQUIRE_USD_VALIDATOR is set (CI's jobs that
    install it), so that a validator that did not install does not pass as a skipped test."""
    which = _tool("oracles/usd_validator.py").nvidia_validator()
    if which is None:
        why = "NVIDIA's validator is not installed (pip install \"usd-validation-nvidia[usd]\" or \"usd-brep[validation]\")"
        if os.environ.get("SMLIBPY_REQUIRE_USD_VALIDATOR"):
            pytest.fail(f"{why}, and SMLIBPY_REQUIRE_USD_VALIDATOR asks for it")
        pytest.skip(why)
    return which


def _nvidia(*paths) -> dict:
    """{file name: NVIDIA's verdict} (tools/oracles/usd_validator.py --nvidia, in a process of its own)."""
    run = subprocess.run([sys.executable, str(USD_VALIDATOR), "--nvidia", "--json", *map(str, paths)],
                         capture_output=True, text=True, timeout=1800)
    assert run.returncode in (0, 1) and run.stdout.strip(), run.stderr
    return {Path(f).name: r for f, r in json.loads(run.stdout.strip().splitlines()[-1]).items()}


def _general(result: dict) -> list:
    """The asset validator's messages but UsdAsciiPerformanceChecker's (large arrays in a text file)."""
    return [m for m in result["asset"] if "UsdAsciiPerformanceChecker" not in m]


def test_usd_files_smlibpy_writes_pass_nvidias_own_validator(tmp_path):
    # tools/oracles/usd_validator.py runs the validator's rules on a shim of OpenUSD everywhere; this runs
    # NVIDIA's validate_file itself, with OpenUSD and the asset validator: from usd-brep's wheel (pip install
    # "usd-brep[validation]": Python 3.12 on Linux and Windows) or, on any platform, from pip install
    # "usd-validation-nvidia[usd]" with the submodule's BrepArray rules and omniSolid schema. Every file
    # passes the BrepArray rules, and of the general rules only UsdAsciiPerformanceChecker complains (large
    # arrays in a text file). Bodies read from other software and written again keep what their files break
    # of BA.465 (control points in the body's box: upstream's own files fail it), which the plan exempts.
    which = _nvidia_validator()
    from smlibpy import Cone, Text, Torus, extrude, import_usd

    rounded = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)
    bodies = {"box": Box(10, 20, 30), "ball": Sphere(5), "ring": Torus(10, 3), "cone": Cone(5, 2, 10), "rounded": rounded,
              "void": Box(10, 10, 10) - Sphere(2), "cells": Box(10, 10, 10).merge(Sphere(4).translate((0, 0, 5))),
              "text": extrude(Text("Ab", 10), 2), "sectors": Cylinder(5, 10, arc_size=90), "names": Box(5, 5, 5),
              "nurbs": rounded.to_nurbs()}
    for name, body in bodies.items():
        export_usd(body.named("Grüße 1/2" if name == "names" else name), tmp_path / f"{name}.usda", mesh=False)
    export_usd([Box(10, 10, 10).named("a"), Sphere(3).translate((20, 0, 0)).named("b")], tmp_path / "two.usda")  # (meshes)
    export_usd(Box(10, 10, 10), tmp_path / "lines.usda", mesh=False)  # (the schema's line edges, read and written again)
    export_usd(import_usd(tmp_path / "lines.usda"), tmp_path / "lines_again.usda", mesh=False)
    foreign = ("Cube", "cubeWithVoid", "nonManifoldCubes", "Cone_SmConnect_Brep", "mouse") if USD_SAMPLES.is_dir() else ()
    for name in foreign:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # (mouse.usda: gaps of 2e-3)
            export_usd(import_usd(USD_SAMPLES / f"{name}.usda"), tmp_path / f"re_{name}.usda", mesh=False)
    found = _nvidia(*sorted(tmp_path.glob("*.usda")))
    assert set(found) == {f"{n}.usda" for n in [*bodies, "two", "lines", "lines_again", *(f"re_{n}" for n in foreign)]}
    for name, r in found.items():
        assert r["validator"] == which and r["breps"] == (2 if name == "two.usda" else 1), (name, r)
        codes = {c: n for c, n in r["codes"].items() if not (name.startswith("re_") and c == "BA.465")}
        assert codes == {} and _general(r) == [], (name, r["messages"], _general(r))
    if foreign:
        assert found["re_Cone_SmConnect_Brep.usda"]["codes"] == {"BA.465": 1} and found["re_mouse.usda"]["codes"] == {"BA.465": 1}


def test_nvidias_own_validator_finds_what_a_broken_file_breaks(tmp_path):
    # So that files that all pass mean something: the box as export_usd writes it passes, the box with its
    # first vertex moved out of the body's box fails the vertex containment rule (BA.310), and upstream's
    # file for BA.000 fails that rule.
    import re

    _nvidia_validator()
    export_usd(Box(10, 20, 30), tmp_path / "box.usda", mesh=False)
    text = (tmp_path / "box.usda").read_text()
    moved, n = re.subn(r"(brep:vertexPoint:point:position = \[\()[^,]+", r"\g<1>50", text, count=1)
    assert n == 1
    (tmp_path / "moved.usda").write_text(moved)
    upstream = sorted(USD_SAMPLES.glob("Test_BA_000_*.usda"))
    found = _nvidia(tmp_path / "box.usda", tmp_path / "moved.usda", *upstream)
    assert found["box.usda"]["passed"] and found["box.usda"]["codes"] == {} and found["box.usda"]["asset"] == []
    assert "BA.310" in found["moved.usda"]["codes"] and not found["moved.usda"]["passed"]
    for f in upstream:
        assert "BA.000" in found[f.name]["codes"], found[f.name]["codes"]


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
