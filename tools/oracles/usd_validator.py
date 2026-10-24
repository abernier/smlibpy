"""NVIDIA's BrepArray validator (usd-brep's tools/brep_validator: 191 rules, BA.000 to BA.9xx) on
``.usda`` files, without OpenUSD: upstream's rule checker runs on a shim of the few ``pxr`` calls it
makes (tools/oracles/usd_shim: a reader of single ``.usda`` layers, the omniSolid schema's attributes,
and stand-ins for ``omni.capabilities`` and ``usd_validation_nvidia``, which only report).

It checks the BrepArray prims (the schema rules); the asset validator's general USD rules, which
``brep_validator.validate_file`` adds with OpenUSD, are not run. Calibrated on upstream's own files
(tests/test_lane_WN.py): each ``Test_BA_xxx`` file is flagged with its rule, the good ones pass.

``--nvidia`` runs NVIDIA's validator itself instead: ``brep_validator.validate_file`` with OpenUSD and
the asset validator (``usd_validation_nvidia``), once with the BrepArray rules only and once with the
general USD rules too. Where it comes from (``nvidia_validator()``): ``pip install
"usd-brep[validation]"`` (usd-brep's wheels: Python 3.12 on Linux and Windows) brings all of it; with
only ``pip install "usd-validation-nvidia[usd]"`` (OpenUSD and the asset validator, any platform)
the BrepArray rules and the omniSolid schema are the submodule's (third_party/usd-brep, its
tools/brep_validator and source/schema/omniSolid/resources).

usage: python tools/oracles/usd_validator.py [--json] [--nvidia] FILE.usda ...
Prints each file's BrepArray count and the rules it fails (``FAIL {'BA.365': 2}``), or PASS; exits
with 1 when a file fails. ``--json``: {file: {"breps": n, "issues": [[code, message], ...]}}.
With ``--nvidia``: the validator's verdict (``passed``, the general rules included), the codes and
messages of the BrepArray rules and the general rules' messages (``asset``); ``--json``: {file:
{"validator": "usd-brep" or "submodule", "breps": n, "passed": bool, "codes": {code: count},
"messages": [...], "asset": [...]}}. Exits with 2 where NVIDIA's validator is not installed."""

from __future__ import annotations

import collections
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHIM = Path(__file__).resolve().parent / "usd_shim"
VALIDATOR = ROOT / "third_party" / "usd-brep" / "tools" / "brep_validator" / "brep_validator.py"
SCHEMA = ROOT / "third_party" / "usd-brep" / "source" / "schema" / "omniSolid" / "resources"


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


def nvidia_validator() -> str | None:
    """Where NVIDIA's validator itself comes from in this Python, or None: ``"usd-brep"`` (the
    ``brep_validator`` and omniSolid schema of usd-brep's wheel, ``pip install "usd-brep[validation]"``)
    or ``"submodule"`` (OpenUSD and ``usd_validation_nvidia`` installed, ``pip install
    "usd-validation-nvidia[usd]"``; the BrepArray rules and the schema of third_party/usd-brep).
    Imports nothing."""
    find = importlib.util.find_spec
    if find("pxr") is None or find("usd_validation_nvidia") is None:
        return None
    if find("brep_validator") is not None:
        return "usd-brep"
    if (VALIDATOR.parent / "__init__.py").is_file() and (SCHEMA / "plugInfo.json").is_file():
        return "submodule"
    return None


def check_nvidia(paths: list[str | Path]) -> dict[str, dict]:
    """NVIDIA's ``validate_file`` on each file (in a process without the shim: this one imports
    OpenUSD's ``pxr``): see ``--nvidia`` above."""
    which = nvidia_validator()
    if which is None:
        raise RuntimeError('NVIDIA\'s validator is not installed: pip install "usd-validation-nvidia[usd]" '
                           '(or "usd-brep[validation]" on Linux and Windows with Python 3.12)')
    schema = None
    if which == "submodule":
        sys.dont_write_bytecode = True  # (no __pycache__ in the submodule, here and in its worker processes)
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        sys.path.insert(0, str(VALIDATOR.parent.parent))
        schema = str(SCHEMA)
        os.environ["OMNISOLID_PLUGIN_PATH"] = schema  # (for the rule checkers, which register it themselves)
    from brep_validator import validate_file

    out = {}
    for path in paths:
        brep = validate_file(str(path), omnisolid_plugin_path=schema, workers=1, brep_only=True)
        full = validate_file(str(path), omnisolid_plugin_path=schema, workers=1)
        asset = list(full.messages)
        for message in brep.messages:  # (the general rules' messages: the full run's but the BrepArray rules')
            if message in asset:
                asset.remove(message)
        out[str(path)] = {"validator": which, "breps": brep.brep_array_count, "passed": full.passed,
                          "codes": dict(brep.issue_summary), "messages": list(brep.messages), "asset": asset}
    return out


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    nvidia = "--nvidia" in argv
    files = [a for a in argv if a not in ("--json", "--nvidia")]
    if nvidia:
        if nvidia_validator() is None:
            print('NVIDIA\'s validator is not installed: pip install "usd-validation-nvidia[usd]"', file=sys.stderr)
            return 2
        results = check_nvidia(files)
        if as_json:
            print(json.dumps(results))
        else:
            for name, r in results.items():
                print(Path(name).name, r["breps"], f"FAIL {r['codes']}" if r["codes"] else "PASS")
                for message in r["asset"]:  # (the general rules')
                    print("  " + message)
        return 0 if all(r["passed"] for r in results.values()) else 1
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
