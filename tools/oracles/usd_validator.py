"""NVIDIA's BrepArray validator (usd-brep's tools/brep_validator: 191 rules, BA.000 to BA.9xx) on
``.usda`` files, without OpenUSD: upstream's rule checker runs on a shim of the few ``pxr`` calls it
makes (tools/oracles/usd_shim: a reader of single ``.usda`` layers, the omniSolid schema's attributes,
and stand-ins for ``omni.capabilities`` and ``usd_validation_nvidia``, which only report).

It checks the BrepArray prims (the schema rules); the asset validator's general USD rules, which
``brep_validator.validate_file`` adds with OpenUSD, are not run. Calibrated on upstream's own files
(tests/test_lane_WN.py): each ``Test_BA_xxx`` file is flagged with its rule, the good ones pass.

usage: python tools/oracles/usd_validator.py [--json] FILE.usda ...
Prints each file's BrepArray count and the rules it fails (``FAIL {'BA.365': 2}``), or PASS; exits
with 1 when a file fails. ``--json``: {file: {"breps": n, "issues": [[code, message], ...]}}.
"""

from __future__ import annotations

import collections
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHIM = Path(__file__).resolve().parent / "usd_shim"
VALIDATOR = ROOT / "third_party" / "usd-brep" / "tools" / "brep_validator" / "brep_validator.py"


def _validator():
    """Upstream's brep_validator module, on the shim (in a process of its own: the shim's ``pxr``
    stands in for OpenUSD's)."""
    if str(SHIM) not in sys.path:
        sys.path.insert(0, str(SHIM))
    import pxr

    if Path(pxr.__file__).resolve().parent != SHIM / "pxr":
        raise RuntimeError(f"OpenUSD's pxr is loaded in this process ({pxr.__file__}); run the validator in a process of its own")
    spec = importlib.util.spec_from_file_location("brep_validator_rules", VALIDATOR)
    module = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True  # (no __pycache__ in the submodule)
    spec.loader.exec_module(module)
    module._omnisolid_registered = True  # (the schema is the shim's: nothing to register)
    return module


def check(paths: list[str | Path]) -> dict[str, dict]:
    """Per file: its BrepArray prims (``breps``) and the issues the rules find (``[code, message]``)."""
    rules = _validator()
    from pxr import Usd  # (the shim's)

    out = {}
    for path in paths:
        stage = Usd.Stage.Open(path)
        breps, issues = 0, []
        for prim in stage.Traverse():
            if prim.GetTypeName() != "BrepArray":
                continue
            breps += 1
            checker = rules.BrepValidator(verbose=False)
            checker.CheckPrim(prim)
            issues += [[getattr(i.requirement, "code", "?"), str(i.message)] for i in checker.GetIssues()]
        out[str(path)] = {"breps": breps, "issues": issues}
    return out


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    files = [a for a in argv if a != "--json"]
    results = check(files)
    if as_json:
        print(json.dumps(results))
    else:
        for name, r in results.items():
            codes = dict(collections.Counter(code for code, _ in r["issues"]))
            print(Path(name).name, r["breps"], f"FAIL {codes}" if codes else "PASS")
    return 1 if any(r["issues"] for r in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
