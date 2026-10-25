"""The fuzz run: seeded random models through smlibpy (and smlibwasm), checked against invariants
and against a baseline (tools/fuzz/baseline.json).

For each seed: generate the cases (gen.py), run them in smlibpy, each in a forked copy of the
process (run_py.py), then, with ``--wasm``, the same cases with the same parameters in smlibwasm
(run_wasm.py), and check every operation (check.py). The run fails on

- a crash of the kernel whose signature (the kernel functions at the top of the crash's stack,
  where gdb or lldb can tell; else the operation) the baseline does not know, and any hang;
- for a seed the baseline has (7 and 8, the regression corpus): an operation that breaks an
  invariant, crashes, hangs or traps where the baseline's run of that seed did not, or a
  smlibpy/smlibwasm divergence (class, or volume beyond 1e-6) it did not have, other than one
  between a right result and the way the baseline knows the case to fail (csg-8-98 E is silent on
  one side or both, depending on memory layout);
- a silent rate (the share of results that break an invariant, over all operations of a side)
  more than 0.3 points above the baseline's.

New failures are made smaller (minimise.py) and written as pytest stubs (``repro/`` in the output
directory). ``--update-baseline`` writes the baseline of this machine's platform from the run;
with ``--repeat N`` from N runs, whose failures it unites (a few Booleans and offsets of seed 8
come out differently from run to run, depending on where the kernel's objects lie in memory), and
with ``--unite`` it adds them to the platform's baseline rather than replacing it. A new failure
counts only if the case fails the same way when run twice more, each time in a fresh process.

usage: python tools/fuzz/fuzz.py [--seed N ...] [--cases N] [--wasm] [--budget SECONDS]
       [--out DIR] [--update-baseline [--repeat N] [--unite]]
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check  # noqa: E402
import gen  # noqa: E402
import minimise  # noqa: E402
import repro  # noqa: E402
import run_py  # noqa: E402
import run_wasm  # noqa: E402

BASELINE = HERE / "baseline.json"
#: Crashes of the kernel that are known and not fixed, by the function at the top of their stack:
#: a null polar box in the stitcher's ray (``cells()`` of some merges, the offset of an imported
#: part; B5 of the kernel plan) and a freed edge as the extended offset mode's merge starts (issue
#: #2's filleted boxes; O1). smlibpy runs both steps in another process.
KNOWN_CRASHES = ("SmBezierAux2d::BuildPolarBox", "SmEdge::CalculateBoundingBox")
#: How far a silent rate may rise above the baseline's, in points.
SLACK = 0.3


def platform_key() -> str:
    return f"{sys.platform}-{platform.machine().lower()}"


def signature(case: dict, resolved: dict, op: str) -> str:
    """The kernel functions at the top of a crash's stack (gdb on Linux, lldb on macOS), or the
    operation where no debugger can tell."""
    import tempfile

    debugger = shutil.which("gdb") if sys.platform.startswith("linux") else shutil.which("lldb")
    fallback = f"{case['kind']}/{op}"
    if debugger is None:
        return fallback
    with tempfile.TemporaryDirectory() as folder:
        script = Path(folder) / "case.py"
        (Path(folder) / "case.json").write_text(json.dumps({"case": case, "resolved": resolved}))
        script.write_text(f"""import json, sys
sys.path.insert(0, {str(HERE)!r})
import run_py, smlibpy.defeature
smlibpy.defeature.GUARD_SECONDS = 0
data = json.load(open({str(Path(folder) / "case.json")!r}))
run_py.run_case(data["case"], lambda r: None, data["resolved"])
""")
        if "gdb" in Path(debugger).name:
            cmd = [debugger, "-batch", "-ex", "run", "-ex", "bt 30", "--args", sys.executable, str(script)]
        else:
            # (in batch mode lldb runs the -k commands once the process crashed)
            cmd = [debugger, "--batch", "-o", "run", "-k", "bt 30", "-k", "process kill", "--", sys.executable, str(script)]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL).stdout
        except (subprocess.TimeoutExpired, OSError):
            return fallback
    names: list[str] = []
    for line in out.splitlines():
        if "frame #" not in line and not line.lstrip().startswith("#"):
            continue
        for word in line.replace("`", " ").split():
            name = word.split("(")[0]
            if name.startswith(("Sm", "smlibpy::", "sm_")) and name not in names:
                names.append(name)
                break
        if len(names) == 4:
            break
    return " < ".join(names) if names else fallback


def run_seed(seed: int, n: int, wasm: bool, deadline: float | None, out: Path) -> dict:
    """Runs one seed; its results and their analysis."""
    cases = gen.gen(seed, gen.counts(n))
    cases_path = out / f"cases-{seed}.json"
    cases_path.write_text(json.dumps(cases))
    py_path = out / f"python-{seed}.jsonl"
    start = time.monotonic()
    ran = run_py.drive(cases, str(py_path), 60.0, deadline)
    cases = cases[:ran]
    cases_path.write_text(json.dumps(cases))
    by_id = {c["id"]: c for c in cases}
    py = check.load(str(py_path))
    resolved = run_py.resolved_of(str(py_path))
    result = {"seed": seed, "cases": ran, "python_seconds": round(time.monotonic() - start, 1),
              "python": check.summary(by_id, py)}
    if wasm:
        start = time.monotonic()
        wa_path = out / f"wasm-{seed}.jsonl"
        run_wasm.drive(str(cases_path), str(py_path), str(wa_path), 60.0)
        wa = check.load(str(wa_path))
        result["wasm_seconds"] = round(time.monotonic() - start, 1)
        result["wasm"] = check.summary(by_id, wa, resolved)
        result["divergence"] = check.divergence(by_id, py, wa, resolved)
    result["_cases"], result["_resolved"] = by_id, resolved
    result["_paths"] = {"python": py_path}
    return result


#: A case run in a fresh interpreter (its argv: the case, the resolved parameters, this folder).
_ONE = ("import json, sys; sys.path.insert(0, sys.argv[3]); import run_py; "
        "print(json.dumps(run_py.run_one(json.loads(sys.argv[1]), 60.0, json.loads(sys.argv[2]))))")


def _again(result: dict, cid: str, side: str) -> dict:
    """A case run again (to tell a regression from a result that changes from run to run). In a
    fresh process: a few Booleans depend on where the kernel's objects lie in memory, which differs
    from one process to the next but not in the forks of one."""
    case, resolved = result["_cases"][cid], result["_resolved"].get(cid, {})
    if side == "python":
        run = subprocess.run([sys.executable, "-c", _ONE, json.dumps(case), json.dumps(resolved), str(HERE)],
                             capture_output=True, text=True, timeout=180, check=True)
        return json.loads(run.stdout.strip().splitlines()[-1])
    import tempfile

    with tempfile.TemporaryDirectory() as folder:
        cases_path, py_path, out = (str(Path(folder) / n) for n in ("cases.json", "py.jsonl", "wasm.jsonl"))
        Path(cases_path).write_text(json.dumps([case]))
        Path(py_path).write_text(json.dumps({"id": cid, "recs": [{"op": "resolve", **resolved}]}) + "\n")
        run_wasm.drive(cases_path, py_path, out, 60.0)
        return check.load(out)[0]


def _steady(result: dict, cid: str, op: str, side: str, how: str, runs: int = 2) -> bool:
    """Whether operation ``op`` of a case fails as ``how`` again in ``runs`` more runs."""
    for _ in range(runs):
        cls, _ = check.classify(result["_cases"][cid], _again(result, cid, side), result["_resolved"].get(cid))
        if cls.get(op) != how:
            return False
    return True


def _volumes_steady(result: dict, cid: str, op: str, runs: int = 2) -> bool:
    """Whether smlibpy gives operation ``op`` of a case the same volume in ``runs`` more runs."""
    first = None
    for _ in range(runs + 1):
        v = check.ops_of(_again(result, cid, "python")).get(op, {}).get("v")
        if first is None:
            first = v
        elif v is None or first is None or abs(v - first) > 1e-9 * max(1.0, abs(first)):
            return False
    return True


def judge(result: dict, base: dict | None, rates_base: dict[str, float]) -> list[str]:
    """What fails the run, for one seed's result. A new failure of a seed the baseline has counts
    only if the case fails the same way in two more runs (a few Booleans come out differently from
    run to run: those are printed as unsteady)."""
    problems = []
    known_seed = (base or {}).get("seeds", {}).get(str(result["seed"]))
    if known_seed is not None and known_seed.get("cases") != result["cases"]:
        known_seed = None  # (other cases than the baseline's run of this seed: rates only)
    known_sigs = [*KNOWN_CRASHES, *(base or {}).get("crash_signatures", [])]
    crashed_known = set()  # smlibpy crashes of known signatures (smlibwasm traps there too)
    for side in ("python", "wasm"):
        if side not in result:
            continue
        s = result[side]
        for key, how in s["bad"].items():
            cid, op = key.split(" ")
            if how == "hang":
                problems.append(f"{side} {key}: hang")
            elif how in ("crash", "trap"):
                sig = signature(result["_cases"][cid], result["_resolved"].get(cid, {}), op) if side == "python" else how
                result.setdefault("signatures", {})[key] = sig
                if known_seed is not None and key in known_seed.get(f"{side}_bad", {}):
                    continue
                if any(sig.startswith(k) for k in known_sigs):
                    crashed_known.add(key)
                    continue
                if side == "wasm" and key in crashed_known:
                    continue
                problems.append(f"{side} {key}: {how} ({sig})")
            elif known_seed is not None and key not in known_seed.get(f"{side}_bad", {}):
                if _steady(result, cid, op, side, how):
                    problems.append(f"{side} {key}: {how} (new)")
                else:
                    print(f"  unsteady: {side} {key}: {how} in this run only")
        rate = overall(s["counts"])
        ref = rates_base.get(side)
        if ref is not None and rate > ref + SLACK:
            problems.append(f"{side}: silent rate {rate:.2f}% > baseline {ref:.2f}% + {SLACK}")
    if known_seed is not None and "divergence" in result:
        for key, how in result["divergence"].items():
            if key in known_seed.get("divergence", {}):
                continue
            known_bad = {known_seed.get(f"{side}_bad", {}).get(key) for side in ("python", "wasm")} - {None}
            if how.startswith("class ") and set(how[len("class "):].split("/")) <= known_bad | {"ok"}:
                # (a case the baseline knows to fail, right on one side in this run only)
                print(f"  unsteady: divergence {key}: {how} (the baseline knows it {'/'.join(sorted(known_bad))})")
                continue
            cid, op = key.split(" ")
            if how.startswith("volume") and not _volumes_steady(result, cid, op):
                print(f"  unsteady: divergence {key}: {how} (smlibpy's volume changes from run to run)")
            elif how.startswith("class") and not _steady(result, cid, op, "python",
                                                         check.classify(result["_cases"][cid], next(
                                                             r for r in check.load(str(result["_paths"]["python"]))
                                                             if r["id"] == cid), result["_resolved"].get(cid))[0].get(op)):
                print(f"  unsteady: divergence {key}: {how}")
            else:
                problems.append(f"divergence {key}: {how} (new)")
    return problems


def overall(counts: dict[str, dict]) -> float:
    """The silent rate over all main operations, in percent."""
    n = sum(c.get("n", 0) for c in counts.values())
    return 100.0 * sum(c.get("silent", 0) for c in counts.values()) / n if n else 0.0


def write_repros(result: dict, problems: list[str], out: Path) -> None:
    """A minimised pytest stub per new failure of smlibpy."""
    folder = out / "repro"
    for p in problems:
        side, key = p.split(" ", 1)
        if side != "python" or " " not in key:
            continue
        cid, rest = key.split(" ", 1)
        op = rest.split(":")[0]
        if cid not in result["_cases"]:
            continue
        case, how = result["_cases"][cid], result["python"]["bad"].get(f"{cid} {op}")
        resolved = result["_resolved"].get(cid, {})
        if how in ("crash", "hang", "silent"):
            resolved = minimise.minimise(case, resolved, op, how)
        folder.mkdir(exist_ok=True)
        (folder / f"test_fuzz_{cid.replace('-', '_')}_{op}.py").write_text(repro.stub(case, resolved, op, p))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, action="append", help="a seed (default: 7 and 8); 0: today's date")
    ap.add_argument("--cases", type=int, default=410, help="cases per seed (in the proportions of gen.MIX)")
    ap.add_argument("--wasm", action="store_true", help="also run smlibwasm (needs node and js/wasm)")
    ap.add_argument("--budget", type=float, default=None, help="seconds for the smlibpy runs of all seeds")
    ap.add_argument("--out", default="fuzz-out")
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--repeat", type=int, default=1, help="with --update-baseline: runs to unite")
    ap.add_argument("--unite", action="store_true",
                    help="with --update-baseline: add to this platform's baseline instead of replacing it")
    a = ap.parse_args()
    seeds = [int(datetime.date.today().strftime("%Y%m%d")) if s == 0 else s for s in (a.seed or [7, 8])]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    allbase = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
    key = platform_key()
    base = allbase.get(key)
    # (the rates of another platform where this one has none: crashes and rates still count)
    ref = base or next(iter(allbase.values()), None)
    rates_base = (ref or {}).get("rates", {})
    deadline = time.monotonic() + a.budget if a.budget else None
    results, problems = [], []
    for seed in seeds * (a.repeat if a.update_baseline else 1):
        r = run_seed(seed, a.cases, a.wasm, deadline, out)
        results.append(r)
        found = judge(r, base, rates_base)
        problems += found
        if found and not a.update_baseline:
            write_repros(r, found, out)
        print(f"seed {seed}: {r['cases']} cases, smlibpy {r['python_seconds']} s"
              + (f", smlibwasm {r['wasm_seconds']} s, {len(r['divergence'])} divergences" if a.wasm else ""))
        for side in ("python", "wasm"):
            if side in r:
                rt = check.rates(r[side]["counts"])
                print(f"  {side:6s} silent % {overall(r[side]['counts']):.2f} (" + ", ".join(f"{k} {v:.2f}" for k, v in rt.items())
                      + f"); bad ops: {len(r[side]['bad'])}")
    summary = [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    if a.update_baseline:
        seen = {s.split(" < ")[0] for r in results for s in r.get("signatures", {}).values() if s not in ("trap",)}
        entry: dict = {"seeds": {}, "rates": {},
                       "crash_signatures": sorted((seen | set((base or {}).get("crash_signatures", []))) - set(KNOWN_CRASHES))}
        if a.unite and base:  # (the baseline's failures and rates, to add this run's to)
            entry["seeds"] = json.loads(json.dumps(base.get("seeds", {})))
            entry["rates"] = dict(base.get("rates", {}))
        for r in results:  # (the failures of every run of a seed, united)
            known = entry["seeds"].setdefault(str(r["seed"]), {"cases": r["cases"], "python_bad": {}, "wasm_bad": {},
                                                               "divergence": {}})
            known["python_bad"].update(r["python"]["bad"])
            known["wasm_bad"].update(r.get("wasm", {}).get("bad", {}))
            known["divergence"].update(r.get("divergence", {}))
        for side in ("python", "wasm"):  # (the highest of the runs)
            seen = [overall(r[side]["counts"]) for r in results if side in r]
            if seen:
                entry["rates"][side] = round(max(seen + [entry["rates"].get(side, 0.0)]), 3)
        allbase[key] = entry
        BASELINE.write_text(json.dumps(allbase, indent=1, sort_keys=True) + "\n")
        print(f"wrote the baseline of {key} to {BASELINE}")
        return 0
    if base is None:
        print(f"no baseline for {key}: only crashes, hangs and silent rates (against {next(iter(allbase), 'none')}) count")
    for p in problems:
        print("FAIL", p)
    return 1 if problems else 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONHASHSEED", "0")
    sys.exit(main())
