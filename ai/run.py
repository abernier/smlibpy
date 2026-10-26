"""Training harness: run one script against smlibpy and keep the evidence.

    python ai/run.py <script.py> --outdir <session folder>

The script runs as plain Python with ``from smlibpy import *``, ``math`` and ``numpy as
np`` already imported, plus two helpers:

    snapshot(label, *shapes, view="iso", size=(900, 675))
        Renders the shapes (default: every Part and Shell variable of the script) to
        files/<script>-<label>.png; parts and shells also go to files/<script>-<label>.step.
        view: iso, front, back, left, right, top, bottom, sheet, or a direction (x, y, z).

    filewrite(data, label)
        Writes data to files/: dicts and lists as .json, strings as .txt, bytes as .bin.

Everything the script prints is also written to files/<script>.log. A script that raises
ends with the error and exit code 1.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


class _Tee(io.TextIOBase):
    def __init__(self, *streams: Any):
        self.streams = streams

    def write(self, s: str) -> int:
        for st in self.streams:
            st.write(s)
        return len(s)

    def flush(self) -> None:
        for st in self.streams:
            st.flush()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("script")
    ap.add_argument("--outdir", required=True, help="the session folder; evidence goes to <outdir>/files")
    args = ap.parse_args()

    script = Path(args.script).resolve()
    files = Path(args.outdir).resolve() / "files"
    files.mkdir(parents=True, exist_ok=True)
    stem = script.stem
    log = open(files / f"{stem}.log", "w", encoding="utf-8")
    out = _Tee(sys.__stdout__, log)

    import numpy as np

    import smlibpy
    from smlibpy import Part, Shell
    from smlibpy.pictures import render

    namespace: dict[str, Any] = {}

    def snapshot(label: str, *shapes: Any, view: Any = "iso", size: tuple[int, int] = (900, 675)) -> str:
        items = list(shapes) or [v for k, v in namespace.items()
                                 if not k.startswith("_") and isinstance(v, (Part, Shell))]
        if not items:
            print(f"[snapshot {label}] nothing to show")
            return ""
        png = files / f"{stem}-{label}.png"
        render(*items, path=png, view=view, size=size)
        bodies = [s for s in items if isinstance(s, (Part, Shell))]
        if bodies:
            smlibpy.export_step(bodies, files / f"{stem}-{label}.step")
        rel = os.path.relpath(png, Path(args.outdir).resolve())
        print(f"[snapshot {label}] {rel}")
        return rel

    def filewrite(data: Any, label: str) -> str:
        if isinstance(data, (bytes, bytearray)):
            path = files / f"{stem}-{label}.bin"
            path.write_bytes(bytes(data))
        elif isinstance(data, str):
            path = files / f"{stem}-{label}.txt"
            path.write_text(data, encoding="utf-8")
        else:
            path = files / f"{stem}-{label}.json"
            try:
                text = json.dumps(data, indent=2, default=_jsonable)
            except (TypeError, ValueError):
                text = repr(data)
            path.write_text(text, encoding="utf-8")
        rel = os.path.relpath(path, Path(args.outdir).resolve())
        print(f"[filewrite {label}] {rel} ({path.stat().st_size} bytes)")
        return rel

    namespace.update({k: getattr(smlibpy, k) for k in smlibpy.__all__})
    import math

    namespace.update(math=math, np=np, snapshot=snapshot, filewrite=filewrite, __name__="__main__")
    sys.stdout = out
    code = 0
    try:
        source = script.read_text(encoding="utf-8")
        exec(compile(source, str(script), "exec"), namespace)
    except SystemExit as e:
        code = int(e.code or 0)
    except BaseException as e:
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == str(script)]
        for f in frames:
            print(f"  line {f.lineno}: {(f.line or '').strip()}")
        print("".join(traceback.format_exception_only(type(e), e)).strip())
        code = 1
    finally:
        sys.stdout = sys.__stdout__
        log.close()
    return code


def _jsonable(o: Any) -> Any:
    if hasattr(o, "to_tuple"):
        return list(o.to_tuple())
    if hasattr(o, "tolist"):
        return o.tolist()
    return repr(o)


if __name__ == "__main__":
    raise SystemExit(main())
