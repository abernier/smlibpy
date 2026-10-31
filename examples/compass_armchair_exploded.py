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
SEAT_UP, RAIL_OUT, LEG_OUT, SPLINE_UP, ARM_UP, TENON_OUT, BACK_RAIL_OUT, CANE_BACK = 110, 120, 170, 60, 170, 70, 90, 110
GLUE_UP = [
    "side rail",
    "front rail",
    "rear rail",
    "back post",
    "back cane",
    "back rail",
    "arm tenon",
    "front leg",
    "rear leg",
    "spline",
    "armrest",
    "seat cane",
]
EXPLODED_VIEWS = {"iso": {"azimuth": 35, "elevation": 22}, "iso_back": {"azimuth": 145, "elevation": 22}}


def model() -> list[Part]:
    """The chair these views take apart."""
    return chair.model()


def exploded_offset(part: Part) -> tuple[float, float, float]:
    """How far a part moves out of the chair in the exploded views, the way it goes in (`assembly_order` of the
    model): the front rail forwards and the rear rail backwards along y, out of the side rails' sockets; the back
    rails along the posts, the upper one up and the lower one down; the back cane back, square to the back; each
    side (legs, spline, armrest) outwards along x (+x for the right side), off the side rail's stub tenons and the
    loose tenon, its spline and armrest also up; the loose tenons part of the way; the seat cane up. The side rails
    stay; the back frame rises with the armrests, so that each armrest still meets its post along x."""
    s = 1 if part.center().x > 0 else -1
    lean = math.radians(chair.BACK_TILT)
    along = (0.0, math.sin(lean), math.cos(lean))  # along the posts, upward
    back = (0.0, math.cos(lean), -math.sin(lean))  # square to the back, backwards
    up = 1 if part.name == "back rail" and part.center().z > chair.SEAT_TOP + 200 else -1  # which back rail
    return {
        "front rail": (0, -RAIL_OUT, 0),
        "rear rail": (0, RAIL_OUT, 0),
        "back post": (0, 0, ARM_UP),
        "back rail": (0, up * BACK_RAIL_OUT * along[1], up * BACK_RAIL_OUT * along[2] + ARM_UP),
        "back cane": (0, CANE_BACK * back[1], CANE_BACK * back[2] + ARM_UP),
        "arm tenon": (s * TENON_OUT, 0, ARM_UP),
        "front leg": (s * LEG_OUT, 0, 0),
        "rear leg": (s * LEG_OUT, 0, 0),
        "spline": (s * LEG_OUT, 0, SPLINE_UP),
        "armrest": (s * LEG_OUT, 0, ARM_UP),
        "seat cane": (0, 0, SEAT_UP),
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
