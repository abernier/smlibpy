"""Make a failing fuzz case smaller: drop the edges a fillet or chamfer rounds, or the openings of
a shell, one at a time, as long as the operation still fails the same way (a crash, a hang, a
trap or a broken invariant). Each try runs in a forked copy (run_py.run_one).

usage: python tools/fuzz/minimise.py CASES.json RESULTS.jsonl CASE_ID [OP]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check  # noqa: E402
import run_py  # noqa: E402


def fails(case: dict, resolved: dict, op: str, how: str, timeout: float) -> bool:
    r = run_py.run_one(case, timeout, resolved)
    cls, _ = check.classify(case, r, resolved)
    return cls.get(op) == how


def minimise(case: dict, resolved: dict, op: str, how: str, timeout: float = 60.0) -> dict:
    """The smallest selection (``edges`` or ``faces`` of ``resolved``) that still fails."""
    field = "edges" if case["kind"] in ("fillet", "chamfer") else "faces" if case["kind"] == "shell" else None
    if field is None or not resolved.get(field):
        return resolved
    items = list(resolved[field])
    changed = True
    while changed and len(items) > 1:
        changed = False
        for i in range(len(items)):
            trial = {**resolved, field: items[:i] + items[i + 1:]}
            if fails(case, trial, op, how, timeout):
                items = trial[field]
                changed = True
                break
    return {**resolved, field: items}


if __name__ == "__main__":
    cases = {c["id"]: c for c in json.load(open(sys.argv[1]))}
    results = {r["id"]: r for r in check.load(sys.argv[2])}
    cid = sys.argv[3]
    case, r = cases[cid], results[cid]
    resolved = check.resolve_of(r)
    cls, viol = check.classify(case, r)
    op = sys.argv[4] if len(sys.argv) > 4 else next(o for o, c in cls.items() if c not in ("ok", "error"))
    smaller = minimise(case, {k: v for k, v in resolved.items() if k != "op"}, op, cls[op])
    print(json.dumps(smaller))
