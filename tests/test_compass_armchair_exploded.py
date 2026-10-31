"""The compass armchair's exploded views: the assembly axes `assembly_axes` finds with the views' offsets are the
chair's joints, each counted. The pictures themselves are not tested here (`test_exploded` covers `render_exploded`).
"""

import importlib.util
from pathlib import Path

import pytest

from smlibpy import *

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "compass_armchair_exploded.py"


@pytest.fixture(scope="module")
def module():
    spec = importlib.util.spec_from_file_location("compass_armchair_exploded", EXAMPLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_exploded_views_axes_are_the_chairs_joints(module):
    # render_exploded finds the axes where the parts touch: with the chair's offsets they are its joints, each side's
    # once (two back rails, so two to each post), and no two parts that move together get one
    parts = module.model()
    axes = assembly_axes(parts, [module.exploded_offset(p) for p in parts])
    joints = {}
    for a in axes:
        pair = tuple(sorted((parts[a.first].name, parts[a.second].name)))
        joints[pair] = joints.get(pair, 0) + 1
    assert joints == {
        ("front leg", "side rail"): 2,
        ("rear leg", "side rail"): 2,  # the side rails' faces on the boards
        ("rail tenon", "side rail"): 4,
        ("front leg", "rail tenon"): 2,
        ("rail tenon", "rear leg"): 2,  # the side rails' loose tenons, into the rail and into the board
        ("front leg", "spline"): 2,
        ("rear leg", "spline"): 2,
        ("armrest", "spline"): 2,  # the splines in the seam
        ("armrest", "front leg"): 2,
        ("armrest", "rear leg"): 2,  # the legs' tops under the arms
        ("front rail", "side rail"): 2,
        ("rear rail", "side rail"): 2,  # the cross rails' dovetails
        ("armrest", "back post"): 2,  # the post's outer face on the armrest's inner face
        ("arm tenon", "armrest"): 2,
        ("arm tenon", "back post"): 2,  # the loose tenon, half in each
        ("back post", "back rail"): 4,  # two back rails' dovetails, both ends
        ("back cane", "back post"): 2,
        ("back cane", "back rail"): 2,
        ("seat cane", "side rail"): 2,
        ("front rail", "seat cane"): 1,
        ("rear rail", "seat cane"): 1,
    }
    assert len(axes) == 44
