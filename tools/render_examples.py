"""Render the example models to PNG images for the documentation.

usage: python tools/render_examples.py [name ...]   (needs node and a Chromium browser)
"""

import importlib.util
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from smlibpy.viewer import html_page  # noqa: E402

EXAMPLES = ["bracket", "flange", "enclosure", "pipe", "spring", "bottle", "gear", "compass_armchair"]


def render(name: str, width: int = 900, height: int = 600) -> str:
    path = os.path.join(ROOT, "examples", f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    shapes = mod.model()
    shapes = list(shapes) if isinstance(shapes, list) else [shapes]
    page = html_page(*shapes, title=name, angle=8.0)
    out = os.path.join(ROOT, "docs", "images", f"{name}.png")
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as fh:
        fh.write(page)
        html = fh.name
    try:
        subprocess.run(["node", os.path.join(ROOT, "tools", "snapshot.mjs"), html + "#clean", out, str(width), str(height)],
                       check=True, timeout=120)
    finally:
        os.unlink(html)
    return out


if __name__ == "__main__":
    for n in sys.argv[1:] or EXAMPLES:
        print(render(n))
