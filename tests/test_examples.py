import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = sorted(p.stem for p in (ROOT / "examples").glob("*.py"))


@pytest.mark.parametrize("name", EXAMPLES)
def test_example_builds_valid_parts(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "examples" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    result = mod.model()
    parts = list(result) if isinstance(result, list) else [result]
    assert parts
    for p in parts:
        assert p.is_valid(), f"{name}: {p!r} is not a valid solid"
        assert p.volume > 0
