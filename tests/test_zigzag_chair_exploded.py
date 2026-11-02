"""The zigzag chair's exploded views: the assembly axes `assembly_axes` finds with the views' offsets are the chair's
joints, each counted. The pictures themselves are not tested here (`test_exploded` covers `render_exploded`).
"""

import importlib.util
from pathlib import Path

import pytest

from smlibpy import *

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "zigzag_chair_exploded.py"


@pytest.fixture(scope="module")
def module():
    spec = importlib.util.spec_from_file_location("zigzag_chair_exploded", EXAMPLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_exploded_views_axes_are_the_chairs_joints(module):
    # render_exploded finds the axes where the parts touch: with the chair's offsets they are its joints, each once.
    # The dovetail's contacts (six tails, their pins and the back's end grain) make one contact, so one axis.
    parts = module.model()
    axes = assembly_axes(parts, [module.exploded_offset(p) for p in parts])
    joints = {}
    for a in axes:
        pair = tuple(sorted((parts[a.first].name, parts[a.second].name)))
        joints[pair] = joints.get(pair, 0) + 1
    assert joints == {
        ("back", "seat"): 1,  # the dovetails
        ("seat", "slant"): 1,  # the top mitre
        ("base", "slant"): 1,  # the bottom mitre
        ("seat", "seat cleat"): 1,
        ("seat cleat", "slant"): 1,  # the seat's cleat, glued to the seat, the slant's rear face onto it
        ("base", "foot cleat"): 1,
        ("foot cleat", "slant"): 1,  # the base's cleat, glued to the base, the slant's front face onto it
    }
    assert len(axes) == 7
