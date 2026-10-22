"""Run the Python code blocks of README.md and docs/*.md.

The blocks of one file run in order in one namespace (so later blocks can use earlier
results), inside a temporary directory, with ``show`` replaced by a no-op. A block whose
first line is ``# not run`` is skipped.
"""

import os
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "README.md", *sorted((ROOT / "docs").glob("*.md"))]
BLOCK = re.compile(r"```python\n(.*?)```", re.S)


@pytest.mark.parametrize("path", FILES, ids=[p.name for p in FILES])
def test_code_blocks_run(path, tmp_path, monkeypatch):
    import smlibpy

    blocks = [b for b in BLOCK.findall(path.read_text()) if not b.startswith("# not run")]
    if not blocks:
        pytest.skip("no code")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(smlibpy, "show", lambda *a, **k: None)
    ns: dict = {}
    exec("from smlibpy import *", ns)
    ns["show"] = lambda *a, **k: None
    for i, code in enumerate(blocks):
        try:
            exec(compile(code, f"{path.name}[block {i + 1}]", "exec"), ns)
        except Exception as e:  # pragma: no cover - reported by pytest
            raise AssertionError(f"{path.name}, block {i + 1} failed:\n{code}") from e


# The skill's references (src/smlibpy/skill/references), which describe_method and the MCP's docs tool
# hand to an agent: their examples must run as written (the thread of curves/Helix.md raised for a
# release). One file's blocks run in order in one namespace, as above. files/ is left out: its
# examples read and write files that are not here (STEP and IGES files of a user, a drill tool).
REFERENCES = ROOT / "src" / "smlibpy" / "skill" / "references"
REFERENCE_FILES = sorted(p for p in REFERENCES.glob("*/*.md") if p.parent.name != "files")


@pytest.mark.parametrize("path", REFERENCE_FILES, ids=[f"{p.parent.name}/{p.name}" for p in REFERENCE_FILES])
def test_skill_reference_examples_run(path, tmp_path, monkeypatch):
    import warnings

    import smlibpy

    blocks = [b for b in BLOCK.findall(path.read_text()) if not b.startswith("# not run")]
    if not blocks:
        pytest.skip("no code")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(smlibpy, "show", lambda *a, **k: None)
    import smlibpy.defeature

    for setting in ("GUARD_SECONDS", "GUARD_PROCESS", "GUARD_BOOLEANS"):  # (parts/guards sets them)
        monkeypatch.setattr(smlibpy.defeature, setting, getattr(smlibpy.defeature, setting))
    ns: dict = {}
    exec("from smlibpy import *\nimport math\nimport numpy as np", ns)
    ns["show"] = lambda *a, **k: None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # (examples that show a warning)
        for i, code in enumerate(blocks):
            try:
                exec(compile(code, f"{path.parent.name}/{path.name}[block {i + 1}]", "exec"), ns)
            except Exception as e:  # pragma: no cover - reported by pytest
                raise AssertionError(f"{path.parent.name}/{path.name}, block {i + 1} failed:\n{code}") from e
