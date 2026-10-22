"""Run the WebAssembly fuzz runner (run_wasm.ts) over every case, with the parameters a Python run
resolved, in node processes that start again after a trap, a hang or a crash.

usage: python tools/fuzz/run_wasm.py CASES.json PY_OUT.jsonl WASM_OUT.jsonl [--timeout S]
"""

from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from run_py import resolved_of  # noqa: E402


def drive(cases_path: str, py_out: str, out: str, timeout: float = 60.0, node: str = "node") -> None:
    cases = json.load(open(cases_path))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(resolved_of(py_out), f)
        resolved = f.name
    results: dict[str, dict] = {}
    i, n = 0, len(cases)
    try:
        while i < n:
            p = subprocess.Popen([node, str(HERE / "run_wasm.ts"), os.path.abspath(cases_path), resolved, str(i), str(n)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=HERE.parents[1])
            buf, cur, fate = b"", None, None
            deadline = time.monotonic() + max(timeout, 120.0)  # (the first case waits for the kernel to load)
            while True:
                left = deadline - time.monotonic()
                if left <= 0:
                    p.kill()
                    fate = "hang"
                    break
                ready, _, _ = select.select([p.stdout], [], [], min(left, 1.0))
                if not ready:
                    if p.poll() is not None:
                        buf += p.stdout.read()
                        break
                    continue
                chunk = os.read(p.stdout.fileno(), 65536)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    m = json.loads(line)
                    cid = m["id"]
                    if "case_start" in m:
                        cur = cid
                        results[cid] = {"id": cid, "recs": []}
                        deadline = time.monotonic() + timeout
                    elif "rec" in m:
                        results[cid]["recs"].append(m["rec"])
                    elif m.get("case_done"):
                        results[cid]["fate"] = "exit"
                        cur = None
                    elif m.get("trapped"):
                        results[cid]["fate"] = "trap"
            p.wait()
            err = p.stderr.read().decode(errors="replace")[-2000:]
            if cur is not None and results[cur].get("fate") is None:
                results[cur]["fate"] = fate or ("trap" if p.returncode == 7 else f"exit{p.returncode}")
                results[cur]["stderr"] = err[-500:]
            elif cur is None and p.returncode not in (0, None) and fate is None and not results:
                raise SystemExit(f"node ended with {p.returncode}: {err[-500:]}")
            done = [j for j, c in enumerate(cases) if results.get(c["id"], {}).get("fate")]
            i = (max(done) + 1) if done else i + 1
    finally:
        os.unlink(resolved)
    with open(out, "w") as fo:
        for c in cases:
            r = results.get(c["id"], {"id": c["id"], "recs": [], "fate": "missing"})
            r["kind"] = c["kind"]
            started = [x["op"] for x in r["recs"] if x.get("start")]
            finished = {x["op"] for x in r["recs"] if not x.get("start")}
            pending = [s for s in started if s not in finished]
            if pending:
                r["in_op"] = pending[-1]
            fo.write(json.dumps(r) + "\n")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cases")
    ap.add_argument("pyout")
    ap.add_argument("out")
    ap.add_argument("--timeout", type=float, default=60)
    a = ap.parse_args()
    drive(a.cases, a.pyout, a.out, a.timeout)
