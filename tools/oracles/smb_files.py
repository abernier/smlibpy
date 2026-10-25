"""Load upstream's .smb test files (usd-brep TestFiles, 188 files) with smlibpy and compare what
they hold with tools/oracles/smb_files.json: the kind of body, its face count, volume, validity
and whether it meshes, or the error it raises. A change there is a change of the kernel's reader,
of its checks or of a patch; ``--update`` writes the file anew after one that is right.

Each file is read in another process (smlibpy._guard.isolated), so a file that crashes the kernel
is reported as such.

usage: python tools/oracles/smb_files.py [--update]
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "third_party" / "usd-brep" / "TestFiles"
EXPECTED = Path(__file__).with_name("smb_files.json")


def measure(path: str) -> dict:
    """What one file holds (runs in another process)."""
    import warnings

    from smlibpy import Part, load
    from smlibpy._kernel import ModelingError

    warnings.simplefilter("ignore")
    try:
        body = load(path)
    except (ModelingError, ValueError, OSError) as e:
        return {"error": type(e).__name__}
    out: dict = {"type": type(body).__name__, "faces": len(body.faces())}
    if isinstance(body, Part):
        out["valid"] = bool(body.is_valid())
        try:
            out["volume"] = round(float(body.volume), 6)
        except ModelingError as e:
            out["volume"] = type(e).__name__
        try:
            body.mesh()
            out["mesh"] = True
        except ModelingError:
            out["mesh"] = False
    return out


def main() -> int:
    from smlibpy import defeature
    from smlibpy._guard import _KernelFault, isolated

    defeature.GUARD_SECONDS = 120.0
    found = {}
    for path in sorted(FILES.rglob("*.smb")):
        key = path.relative_to(FILES).as_posix()
        try:
            found[key] = isolated("load", measure, str(path))
        except _KernelFault as e:
            found[key] = {"error": f"crash: {e.reason}"}
    if "--update" in sys.argv:
        EXPECTED.write_text(json.dumps(found, indent=1, sort_keys=True) + "\n")
        print(f"wrote {EXPECTED} ({len(found)} files)")
        return 0
    expected = json.loads(EXPECTED.read_text())
    changed = []
    for key in sorted(set(found) | set(expected)):
        a, b = expected.get(key), found.get(key)
        same = a is not None and b is not None and a.keys() == b.keys() and all(
            math.isclose(a[k], b[k], rel_tol=1e-6, abs_tol=1e-9) if isinstance(a[k], float) and isinstance(b[k], float)
            else a[k] == b[k] for k in a)
        if not same:
            changed.append(f"{key}: {a} -> {b}")
    loaded = sum(1 for v in found.values() if "error" not in v)
    print(f"{len(found)} files, {loaded} load; {len(changed)} changed")
    for line in changed:
        print("  " + line)
    return 1 if changed else 0


if __name__ == "__main__":
    sys.exit(main())
