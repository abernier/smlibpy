"""The zigzag chair taken apart: two exploded views, parts in glue-up order, the assembly axes found by the library.

    python examples/zigzag_chair_exploded.py [output folder]   (default: zigzag_chair_exploded/)

Everything is read off `zigzag_chair.py`'s model and constants. Each part moves out of the chair along the way it
goes in at glue-up (`exploded_offset`, after the model's `assembly_order`); `render_exploded` draws the views,
numbering the parts in the order of `GLUE_UP` and finding the assembly axes where the parts touch.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

from smlibpy import *


def _chair():
    spec = importlib.util.spec_from_file_location("zigzag_chair", Path(__file__).with_name("zigzag_chair.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


chair = _chair()

# How far each part moves out of the chair, in mm, along the way it goes in at glue-up, and the glue-up order the
# balloons are numbered in. The assembly axes are not given: render_exploded finds them where the parts touch.
BACK_UP, CLEAT_OUT, SLANT_OUT, BASE_OUT = 220, 120, 340, 340
GLUE_UP = ["seat", "back", "seat cleat", "slant", "base", "foot cleat"]
EXPLODED_VIEWS = {"iso": {"azimuth": 35, "elevation": 22}, "iso_back": {"azimuth": 145, "elevation": 22}}


def model() -> list[Part]:
    """The chair these views take apart."""
    return chair.model()


def exploded_offset(part: Part) -> tuple[float, float, float]:
    """How far a part moves out of the chair in the exploded views, the way it goes in (`assembly_order` of the
    model): the back up off the seat's tails along its own faces, which lean 8 degrees; the seat's cleat down, square
    to the seat; the slant along the top mitre's normal, away from the seat; the base, with its cleat, along the
    bottom mitre's normal, away from the slant, and its cleat up off it, square to the base. The seat stays."""
    c, s = math.cos(math.radians(chair.SLANT / 2)), math.sin(math.radians(chair.SLANT / 2))
    mitre_out = (0.0, -s, -c)  # both mitres' normals, away from the seat and away from the slant
    slant = tuple(SLANT_OUT * m for m in mitre_out)
    base = tuple(a + BASE_OUT * m for a, m in zip(slant, mitre_out))
    return {
        "back": tuple(BACK_UP * u for u in chair.UP),
        "seat cleat": (0, 0, -CLEAT_OUT),
        "slant": slant,
        "base": base,
        "foot cleat": (base[0], base[1], base[2] + CLEAT_OUT),
    }.get(part.name, (0, 0, 0))


def exploded_views(out: str | Path, parts: list[Part] | None = None) -> list[Path]:
    """Write the chair taken apart into `out`, one PNG per view of EXPLODED_VIEWS (`exploded_iso.png`,
    `exploded_iso_back.png`): the parts moved by `exploded_offset`, the assembly axes, balloons numbered in the order
    of glue-up and the parts list. Returns the paths written."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    parts = model() if parts is None else parts
    offsets = [exploded_offset(p) for p in parts]
    paths = []
    for key, view in EXPLODED_VIEWS.items():
        paths.append(out / f"exploded_{key}.png")
        render_exploded(parts, offsets, path=paths[-1], view=view, order=GLUE_UP, size=(1800, 1200))
    return paths


if __name__ == "__main__":
    for path in exploded_views(sys.argv[1] if len(sys.argv) > 1 else "zigzag_chair_exploded"):
        print(path)
