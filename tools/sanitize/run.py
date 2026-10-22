"""Run tests against a build of smlibpy's kernel module with AddressSanitizer, and LeakSanitizer
where the compiler's runtime has it (Linux; macOS with LLVM's clang, not Apple's).

Build the module first, in a directory of its own:

    cmake -S . -B build-asan -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DSKBUILD=ON \\
      -DCMAKE_CXX_FLAGS="-fsanitize=address -fsanitize-recover=address -fno-omit-frame-pointer"
    cmake --build build-asan

(``-DSKBUILD=ON`` keeps its ``_core`` in the build directory; ``-fsanitize-recover=address`` lets a
test go on after a report, so that one run finds every error.) This script puts that module next
to a copy of ``src/smlibpy``, runs pytest on the given tests with the sanitizer's runtime preloaded
(``LD_PRELOAD``, ``DYLD_INSERT_LIBRARIES`` on macOS) and every kernel step in the test process
(``GUARD_SECONDS = 0``, tools/sanitize/guard_off.py), and reads the sanitizer's reports: any
memory error fails the run unless tools/sanitize/known.txt names it, and so does any leak whose
allocation went through the kernel or smlibpy's C++, unless tools/sanitize/leaks.txt names it.
Leaks of Python itself, and the one-time allocations of the module's import (pybind11's type
registrations), are not counted. On macOS, Apple's clang has no leak checker: build with LLVM's
(``-DCMAKE_CXX_COMPILER=$(brew --prefix llvm)/bin/clang++``), or pass ``--no-leaks``.

With ``--fuzz`` it runs the fuzz run (tools/fuzz/fuzz.py, its options after ``--``) instead of
the tests: its cases run in forked copies, which end without a leak check, so only memory errors
count, and the fuzz run's own verdict.

usage: python tools/sanitize/run.py [--build build-asan] [--no-leaks] [tests ...] [-- pytest options]
       python tools/sanitize/run.py [--build build-asan] --fuzz [-- fuzz options]
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DEFAULT_TESTS = ["tests/test_defeature.py", "tests/test_guards.py", "tests/test_draft.py", "tests/test_io.py"]

#: A frame in the kernel or in smlibpy's own C++: a leak allocated through one is the kernel's.
OURS = re.compile(r"usd-brep/source/|third_party/patches/|/src/cpp/|smlibpy::|\bin Sm[A-Z]\w*::|\bin smos_|_core\.cpython")
#: The module's import: pybind11 registers its types once per process (not a leak to count).
IMPORT = re.compile(r"PyInit__core|pybind11_init__core")


def runtime(cxx: str) -> tuple[str, str]:
    """The environment variable that preloads the sanitizer's runtime, and its file."""
    if sys.platform == "darwin":
        name, var = "libclang_rt.asan_osx_dynamic.dylib", "DYLD_INSERT_LIBRARIES"
    elif "clang" in Path(cxx).name:
        name, var = "libclang_rt.asan-x86_64.so", "LD_PRELOAD"
    else:
        name, var = "libasan.so", "LD_PRELOAD"
    path = subprocess.run([cxx, f"-print-file-name={name}"], capture_output=True, text=True).stdout.strip()
    if not path or not Path(path).exists():
        raise SystemExit(f"{cxx} has no {name}")
    return var, path


def compiler(build: Path) -> str:
    cache = (build / "CMakeCache.txt").read_text()
    m = re.search(r"^CMAKE_CXX_COMPILER:\w+=(.*)$", cache, re.M)
    return m.group(1) if m else "c++"


def _listed(path: Path) -> list[str]:
    """The entries of a list file: its lines that are not empty or comments."""
    return [line.strip() for line in path.read_text().splitlines() if line.strip() and not line.startswith("#")]


def reports(text: str) -> list[str]:
    """The memory error reports of a sanitizer log (each up to the next one or the leak check)."""
    starts = [m.start() for m in re.finditer(r"^=+\d+=+ERROR: AddressSanitizer", text, re.M)]
    out = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        leak = text.find("ERROR: LeakSanitizer", start, end)
        out.append(text[start:leak if leak >= 0 else end])
    return out


def leaks(text: str, known: list[str]) -> list[str]:
    """The leak reports of a LeakSanitizer log that count (see the module's notes)."""
    out = []
    for block in re.split(r"\n(?=(?:Direct|Indirect) leak of )", text):
        if not re.match(r"(Direct|Indirect) leak of ", block):
            continue
        block = block.split("\n\n")[0]
        if not OURS.search(block) or IMPORT.search(block):
            continue
        if any(k in block for k in known):
            continue
        out.append(block)
    return out


def main() -> int:
    argv = sys.argv[1:]
    extra = []
    if "--" in argv:
        i = argv.index("--")
        argv, extra = argv[:i], argv[i + 1:]
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--build", default=str(ROOT / "build-asan"))
    ap.add_argument("--no-leaks", action="store_true", help="AddressSanitizer only")
    ap.add_argument("--fuzz", action="store_true", help="the fuzz run instead of the tests")
    ap.add_argument("tests", nargs="*", default=DEFAULT_TESTS)
    a = ap.parse_args(argv)
    build = Path(a.build).resolve()
    modules = sorted(build.glob("_core*.so")) + sorted(build.glob("_core*.pyd"))
    if not modules:
        raise SystemExit(f"no _core module in {build}: build it with -DSKBUILD=ON (see this script's notes)")
    var, lib = runtime(compiler(build))
    work = Path(tempfile.mkdtemp(prefix="smlibpy-asan-"))
    try:
        package = work / "src" / "smlibpy"
        shutil.copytree(ROOT / "src" / "smlibpy", package, ignore=shutil.ignore_patterns("_core*.so", "_core*.pyd", "__pycache__"))
        shutil.copy2(modules[0], package / modules[0].name)
        logs = work / "logs"
        logs.mkdir()
        options = {
            "detect_leaks": "0" if a.no_leaks else "1",
            # (a report ends the process, but not with an error of its own: the processes the tests
            # start would fail their tests with it, and the logs decide here)
            "exitcode": "0",
            "abort_on_error": "0",
            "halt_on_error": "0",  # (with -fsanitize-recover=address: go on after a report)
            "handle_segv": "0",  # (the tests crash forked copies on purpose: a plain signal, no report)
            "strip_env": "0",  # (keeps the runtime in the processes the tests start)
            "detect_container_overflow": "0",  # (Python's and the kernel's containers are not all instrumented)
            "log_path": str(logs / "asan"),
        }
        env = dict(os.environ)
        env[var] = lib
        env["ASAN_OPTIONS"] = ":".join(f"{k}={v}" for k, v in options.items())
        env["LSAN_OPTIONS"] = "print_suppressions=0:max_leaks=200"
        env["PYTHONPATH"] = os.pathsep.join([str(work / "src"), str(HERE), str(ROOT / "tests")])
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        # (Python's objects in malloc's heap, where LeakSanitizer sees what they point to: with its own
        # allocator, every kernel object a living Python object holds at exit would count as leaked)
        env["PYTHONMALLOC"] = "malloc"
        tests = [str((ROOT / t).resolve()) for t in a.tests]
        # (the Python binary itself: on macOS a wrapper such as /usr/bin/env would drop the DYLD_
        # variables; a virtual environment's link to it keeps them)
        python = sys.executable
        cmd = [python, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "guard_off", "--rootdir", str(ROOT),
               *tests, *extra]
        if a.fuzz:
            cmd = [python, str(ROOT / "tools" / "fuzz" / "fuzz.py"), *extra]
        print("running", " ".join(cmd), flush=True)
        code = subprocess.call(cmd, env=env, cwd=ROOT)
        known = _listed(HERE / "leaks.txt")
        known_errors = _listed(HERE / "known.txt")
        errors, tolerated, counted = [], [], []
        for log in sorted(logs.iterdir()):
            text = log.read_text(errors="replace")
            for report in reports(text):
                (tolerated if any(k in report for k in known_errors) else errors).append(report)
            counted += leaks(text, known)
        for e in errors:
            print(e[:8000], end="\n\n")
        for block in counted:
            print(block, end="\n\n")
        for e in tolerated:
            print("known:", e.splitlines()[0], "|", next((l.strip() for l in e.splitlines() if " in Sm" in l), ""))
        print(f"pytest exit {code}; {len(errors)} AddressSanitizer reports ({len(tolerated)} known); {len(counted)} "
              f"leaks of the kernel or smlibpy's C++ ({len(list(logs.iterdir()))} logs)")
        # (with halt_on_error=0 a test can fail after a known report; such a run is decided by the
        # reports alone)
        return 1 if errors or counted or (code != 0 and not tolerated) else 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
