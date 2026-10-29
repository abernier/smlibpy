"""The compass armchair taken apart: two exploded views, parts in glue-up order, the assembly axes found by the library.

    python examples/compass_armchair_exploded.py [output folder]   (default: compass_armchair_exploded/)

Everything is read off `compass_armchair.py`'s model and constants. Each part moves out of the chair along the way it
goes in at glue-up (`exploded_offset`); `render_exploded` draws the views, numbering the parts in the order of
`GLUE_UP` and finding the assembly axes where the parts touch.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

from smlibpy import *


def _chair():
    spec = importlib.util.spec_from_file_location("compass_armchair", Path(__file__).with_name("compass_armchair.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


chair = _chair()

# How far each part moves out of the chair, in mm, along the way it goes in at glue-up, and the glue-up order the
# balloons are numbered in. The assembly axes are not given: render_exploded finds them where the parts touch.
SEAT_UP, RAIL_OUT, LEG_OUT, SPLINE_UP, ARM_UP, POST_OUT, CANE_BACK = 110, 70, 170, 60, 170, 110, 110
GLUE_UP = [
    "front leg",
    "rear leg",
    "spline",
    "side rail",
    "front rail",
    "rear rail",
    "seat cane",
    "armrest",
    "back post",
    "back rail",
    "back cane",
]
EXPLODED_VIEWS = {"iso": {"azimuth": 35, "elevation": 22}, "iso_back": {"azimuth": 145, "elevation": 22}}


def model() -> list[Part]:
    """The chair these views take apart."""
    return chair.model()


def exploded_offset(part: Part) -> tuple[float, float, float]:
    """How far a part moves out of the chair in the exploded views: the sides outwards along x (+x for the right
    side), the seat cane up, the arms and the back up, the back cane up and back, square to the back."""
    s = 1 if part.center().x > 0 else -1
    back = (0.0, math.cos(math.radians(chair.BACK_TILT)), -math.sin(math.radians(chair.BACK_TILT)))
    return {
        "seat cane": (0, 0, SEAT_UP),
        "side rail": (s * RAIL_OUT, 0, 0),
        "front leg": (s * LEG_OUT, 0, 0),
        "rear leg": (s * LEG_OUT, 0, 0),
        "spline": (s * LEG_OUT, 0, SPLINE_UP),
        "armrest": (s * LEG_OUT, 0, ARM_UP),
        "back post": (s * POST_OUT, 0, ARM_UP),
        "back rail": (0, 0, ARM_UP),
        "back cane": (CANE_BACK * back[0], CANE_BACK * back[1], CANE_BACK * back[2] + ARM_UP),
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
    for path in exploded_views(sys.argv[1] if len(sys.argv) > 1 else "compass_armchair_exploded"):
        print(path)
