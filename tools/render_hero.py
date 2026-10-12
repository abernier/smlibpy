"""Render all example models side by side for the README (docs/images/hero.png)."""

import importlib.util
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from smlibpy import ShapeList  # noqa: E402
from smlibpy.viewer import html_page  # noqa: E402

ORDER = ["gear", "bracket", "flange", "bottle", "spring", "enclosure", "pipe"]


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "examples", f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    m = mod.model()
    return list(m) if isinstance(m, list) else [m]


def main(width: int = 1600, height: int = 430) -> None:
    placed = []
    x = 0.0
    for name in ORDER:
        shapes = load(name)
        if name == "enclosure":  # show the lid next to the box, not floating above it
            box, lid = shapes
            lid = lid.translate(0, 0, -lid.bbox().min.z + box.bbox().max.z + 6)
            shapes = [box, lid]
        group = ShapeList(shapes)
        bb = group.bbox()
        dx = x - bb.min.x
        dy = -(bb.min.y + bb.max.y) / 2
        dz = -bb.min.z
        placed += [s.translate(dx, dy, dz) for s in shapes]
        x += bb.size.x + 25
    page = html_page(*placed, title="smlibpy", angle=8.0, view=(0.18, -1.0, 0.36), margin=0.98)
    out = os.path.join(ROOT, "docs", "images", "hero.png")
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as fh:
        fh.write(page)
    try:
        subprocess.run(["node", os.path.join(ROOT, "tools", "snapshot.mjs"), fh.name + "#clean", out, str(width),
                        str(height)], check=True, timeout=180)
    finally:
        os.unlink(fh.name)
    print(out)


if __name__ == "__main__":
    main()
