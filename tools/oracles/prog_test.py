"""Run upstream's kernel tests (usd-brep tests/prog_test) against smlibpy's kernel.

Build the program first: configure with ``-DSMLIBPY_PROG_TEST=ON`` (CMakeLists.txt), which makes
``prog_test_app`` in the build directory, compiled against the kernel with the patches of
third_party/patches. Each suite runs in a directory of its own laid out as the program expects
(``tests/prog_test`` with ``../../TestFiles`` beside it, a copy of usd-brep's TestFiles), several
at a time; a suite passes when the program exits with 0 (its report ends "PROG_TEST SUCCESS").

usage: python tools/oracles/prog_test.py [--app build/prog_test_app] [--suite NAME ...] [--jobs N]
       [--timeout S] [--keep DIR]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST_FILES = ROOT / "third_party" / "usd-brep" / "TestFiles"


def suites(app: Path) -> list[str]:
    """The suites the program runs by default (``--list-suites`` marks the others)."""
    out = subprocess.run([str(app), "--list-suites"], capture_output=True, text=True, timeout=60).stdout
    return [line.strip() for line in out.splitlines() if line.strip() and "(" not in line]


def run_suite(app: Path, suite: str, root: Path, timeout: float) -> tuple[str, bool, float, str]:
    """Runs one suite in ``root/<suite>``: (suite, passed, seconds, the end of its output)."""
    base = root / suite
    cwd = base / "tests" / "prog_test"
    cwd.mkdir(parents=True)
    shutil.copytree(TEST_FILES, base / "TestFiles")  # (a copy: some suites write next to their inputs)
    start = time.monotonic()
    try:
        p = subprocess.run([str(app), "--suite", suite], cwd=cwd, capture_output=True, text=True,
                           timeout=timeout, errors="replace")
        code, out = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        code, out = -1, f"timed out after {timeout:g} s\n{e.stdout or ''}"
    seconds = time.monotonic() - start
    reports = sorted((cwd / "OutputFiles").glob("*.txt")) if (cwd / "OutputFiles").exists() else []
    tail = "".join(r.read_text(errors="replace")[-2000:] for r in reports[:1]) or out[-2000:]
    return suite, code == 0, seconds, tail if code != 0 else ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--app", default=str(ROOT / "build" / "prog_test_app"))
    ap.add_argument("--suite", action="append", help="a suite to run (default: every suite)")
    ap.add_argument("--jobs", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    ap.add_argument("--timeout", type=float, default=900.0, help="seconds per suite")
    ap.add_argument("--keep", help="run in this directory and keep it (default: a temporary one)")
    a = ap.parse_args()
    app = Path(a.app).resolve()
    if not app.exists():
        print(f"{app} is missing: configure with -DSMLIBPY_PROG_TEST=ON and build", file=sys.stderr)
        return 2
    names = a.suite or suites(app) + ["stitch"]  # (stitch does not run by default; it is cheap)
    root = Path(a.keep) if a.keep else Path(tempfile.mkdtemp(prefix="prog_test-"))
    root.mkdir(parents=True, exist_ok=True)
    failed = []
    try:
        with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
            for suite, ok, seconds, tail in pool.map(lambda s: run_suite(app, s, root, a.timeout), names):
                print(f"{'ok  ' if ok else 'FAIL'} {suite:22s} {seconds:6.1f} s", flush=True)
                if not ok:
                    failed.append(suite)
                    print(tail, file=sys.stderr)
    finally:
        if not a.keep:
            shutil.rmtree(root, ignore_errors=True)
    print(f"{len(names) - len(failed)} of {len(names)} suites passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
