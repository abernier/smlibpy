"""Run the public calls that crashed the kernel, again and again, each run in a fresh process
with the guard off (``smlibpy.defeature.GUARD_SECONDS = 0``: a crash ends the process) and with
address-space layout randomization as the system has it. These crashes depended on memory layout
(the offset code's use of freed memory, ai/plan/kernel-deep-dive.md O1 and O4): AddressSanitizer
and runs without randomization missed them, and one run says little.

A case marked ``known`` crashes now and then still (its site is not located); its rate is printed
and does not fail the run. Any crash of another case fails it.

usage: python tools/oracles/crash_loops.py [--runs N] [--case NAME ...]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PRELUDE = """
import warnings
warnings.simplefilter("ignore")
import smlibpy.defeature
smlibpy.defeature.GUARD_SECONDS = 0  # (in this process: a crash ends it)
from smlibpy import *
from smlibpy._kernel import k
def attempt(make):
    try:
        make()
    except RuntimeError:  # (a kernel error, ModelingError, KernelError: no crash)
        pass
"""

#: name -> (code, known). Each case's code runs its calls a few times in one process.
CASES = {
    # O1: the extended offset mode glued a Vertex it had deleted (GlueCoincidentBrepVertices);
    # after K2 it still crashed in 1 of 30 runs (third_party/patches/README.md)
    "L-shaped box, extended shell": ("""
lbox = Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)
foot = [f._f for f in lbox.faces() if abs(f.center().z + 9) < 1e-6]
for _ in range(8):
    attempt(lambda: k.shell_brep(lbox._brep, -2.94, extended_offset=True, faces_to_shell=foot))
""", True),
    # O1: a fused cone offset by 6 (every run before the patch)
    "fused cone, offset": ("""
cone = Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)
for _ in range(3):
    attempt(lambda: cone.offset(6))
""", False),
    # O1: two fused cones shelled at the end face (DoExtendedOffset handed out a freed surface)
    "two cones, shell": ("""
cones = Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16).translate(-2, 2.5147, -4)
end = min(cones.faces(), key=lambda f: abs(f.center().x - 3))
for _ in range(3):
    attempt(lambda: cones.shell(2.4, end))
""", False),
    # O4: the extended shell of a rotated box (BooleanPostProcess read a deleted Vertex, about one
    # call in a hundred)
    "rotated box, extended shell": ("""
box = Box(40, 30, 10).rotate(X, 45)
opening = box.faces().sort_by(Axis((0, 0, 0), (0, -1, 1)))[-1]
for _ in range(30):
    attempt(lambda: k.shell_brep(box._brep, -10, extended_offset=True, faces_to_shell=[opening._f]))
""", False),
    # issue #2: shells of filleted, fused boxes; still crash now and then in
    # SmEdge::CalculateBoundingBox (third_party/patches/README.md), contained by the guard
    "issue #2, filleted box shell": ("""
for s in (0.1, 1.0, 100.0):
    b = Box(40 * s, 30 * s, 20 * s) - Cylinder(5 * s, 40 * s).translate((8 * s, 0, 0))
    u = b.fillet(b.edges(), 1.5 * s) + Sphere(8 * s).translate((-10 * s, 0, 10 * s))
    attempt(lambda: u.shell(1.2 * s, u.faces().bottom()))
""", True),
}


def run(code: str) -> int:
    env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(ROOT / "src"), os.environ.get("PYTHONPATH", "")]))
    try:
        return subprocess.run([sys.executable, "-c", PRELUDE + code], env=env, capture_output=True,
                              timeout=600).returncode
    except subprocess.TimeoutExpired:
        return -999


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--runs", type=int, default=10, help="fresh processes per case")
    ap.add_argument("--case", action="append", help="a case to run (default: every case)")
    ap.add_argument("--jobs", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    a = ap.parse_args()
    names = a.case or list(CASES)
    bad = []
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        for name in names:
            code, known = CASES[name]
            codes = list(pool.map(run, [code] * a.runs))
            crashed = [c for c in codes if c < 0]  # (a signal; -999: did not finish)
            broken = [c for c in codes if c > 0]  # (a Python error: the case itself is wrong)
            note = "known, not failing" if known and crashed else ""
            state = "FAIL" if broken or (crashed and not known) else ("KNOWN" if crashed else "ok  ")
            print(f"{state} {name:30s} {len(crashed)} of {a.runs} runs crashed {sorted(set(crashed)) or ''}"
                  f"{f' ({len(broken)} ended with an error)' if broken else ''} {note}", flush=True)
            if state == "FAIL":
                bad.append(name)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
