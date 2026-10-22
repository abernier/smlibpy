"""Run upstream's tests of its Python bindings (usd-brep source/SmPyLib/tests/test_omni_solid.py)
against smlibpy's kernel module ``smlibpy._core``, through a shim that lets them import it as
``_omni_solid`` (tools/oracles/shim).

smlibpy builds SmPyLib without ``SmPyUsd.cpp`` (it needs OpenUSD) and with its own module spine,
so upstream's tests of the ``usd`` submodule and of the module's docstring cannot pass; they are
listed in KNOWN with the reason and left out. Every other test must pass.

usage: python tools/oracles/smpylib_tests.py [pytest options]
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "third_party" / "usd-brep" / "source" / "SmPyLib" / "tests" / "test_omni_solid.py"

#: Tests that cannot pass against smlibpy's module, and why.
KNOWN = {
    "TestUsd": "the usd submodule (SmPyUsd.cpp needs OpenUSD; smlibpy has its own USD reader and writer)",
    "TestErrors::test_runtime_error_includes_c_entry_point": "calls sm.usd",
    "TestErrors::test_runtime_error_includes_symbolic_status_name": "calls sm.usd",
    "TestErrors::test_runtime_error_does_not_accumulate_between_calls": "calls sm.usd",
    "TestErrors::test_usd_import_nonexistent": "calls sm.usd",
    "TestErrors::test_usd_partial_import_nonexistent": "calls sm.usd",
    "TestDiscoverability::test_module_docstring_lists_categories": "smlibpy's module spine has its own docstring",
    "TestDiscoverability::test_submodules_exist": "lists the usd submodule",
}


def main() -> int:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join([str(ROOT / "tools" / "oracles" / "shim"), str(ROOT / "src"),
                                         env.get("PYTHONPATH", "")])
    deselect = []
    for test in KNOWN:
        deselect += ["--deselect", f"{TESTS.name}::{test}"]
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--rootdir", str(TESTS.parent), TESTS.name,
           *deselect, *sys.argv[1:]]
    return subprocess.call(cmd, env=env, cwd=TESTS.parent)


if __name__ == "__main__":
    sys.exit(main())
