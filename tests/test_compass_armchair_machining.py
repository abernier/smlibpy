"""The compass armchair's machining files, read back: every part's volume is its outline's prism less its pockets.

The files are made once (without the drawings, which `test_machining` covers) and read with `import_dxf`; the
volumes are the model's own. A pocket's depth is in its layer's name.
"""

import csv
import importlib.util
import math
from pathlib import Path

import pytest
from pytest import approx

from smlibpy import *

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "compass_armchair_machining.py"


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    spec = importlib.util.spec_from_file_location("compass_armchair_machining", EXAMPLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out = tmp_path_factory.mktemp("machining")
    return module, out, module.machining_files(out, pictures=False)


def layer_names(path: Path) -> set[str]:
    lines = path.read_text().splitlines()
    return {lines[i + 1].strip() for i in range(len(lines) - 1) if lines[i].strip() == "8"}


def pockets(path: Path) -> float:
    """The volume a setup's pockets take out: each layer's area times the depth its name gives."""
    names = [n for n in layer_names(path) if n.startswith("POCKET_D")]
    return sum(import_dxf(path, layers=[n]).area * float(n[len("POCKET_D") :].replace("_", ".")) for n in names)


def test_every_machined_part_is_in_the_cut_list_once(files):
    module, out, written = files
    machined = [p for p in module.model() if "cane" not in p.name]
    assert sum(r["qty"] for r in written["rows"]) == len(machined) == 16
    with (out / "cutlist.csv").open() as fh:
        rows = list(csv.DictReader(fh))
    assert sorted(r["part"] for r in rows) == sorted({p.name for p in machined})
    assert sorted(written["dxf"]) == sorted(p.name for p in (out / "dxf").glob("*.dxf"))
    assert written["flagged"] == []  # every feature is a pocket of some setup


def test_a_part_is_its_outline_less_its_pockets(files):
    module, out, written = files
    for row in written["rows"]:
        for rec in row["records"]:
            names = [f"{rec['key']}{suffix}.dxf" for suffix, *_ in rec["setups"]]
            faces = [n for n in names if "_edge" not in n]  # the main face and the other face, same thickness
            volume = import_dxf(out / "dxf" / names[0], layers=["OUTLINE"]).area * rec["main"].thickness
            volume -= sum(pockets(out / "dxf" / n) for n in faces)
            edge = [n for n in names if "_edge" in n]
            if rec["part"].name == "armrest":  # the spline's mortise, from the sloping underside: its depth is local
                (n,) = edge
                (pocket,) = [x for x in layer_names(out / "dxf" / n) if x.startswith("POCKET_D")]
                volume -= import_dxf(out / "dxf" / n, layers=[pocket]).area * module.chair.SPLINE_IN_ARM
            elif edge:  # the legs: half the spline's slot, through the board's sloping top end
                assert rec["part"].name in ("front leg", "rear leg")
                (n,) = edge
                depth = module.chair.SPLINE[1] / 2
                assert f"POCKET_D{depth:g}" in layer_names(out / "dxf" / n)
                continue
            assert volume == approx(rec["part"].volume, rel=1e-6), rec["key"]


def test_the_nests_hold_every_blank_once(files):
    module, out, written = files
    blanks = sum(r["qty"] * r["blank"][0] * r["blank"][1] for r in written["rows"])
    nested = sum(import_dxf(p, layers=["BLANK"]).area for p in (out / "nests").glob("*.dxf"))
    assert nested == approx(blanks, rel=1e-9)
    planks = sum(n for _, n, _, _ in written["nests"])
    plank_area = sum(import_dxf(p, layers=["PLANK"]).area for p in (out / "nests").glob("*.dxf"))
    assert plank_area == approx(planks * math.prod(module.PLANK))


def test_the_exploded_views_axes_are_the_chairs_joints(files):
    # render_exploded finds the axes where the parts touch: with the chair's offsets they are its joints, each side's
    # once (two back rails, so two to each post and to the cane), and no two parts that move together get one
    module = files[0]
    parts = module.model()
    axes = assembly_axes(parts, [module.exploded_offset(p) for p in parts])
    joints = {}
    for a in axes:
        pair = tuple(sorted((parts[a.first].name, parts[a.second].name)))
        joints[pair] = joints.get(pair, 0) + 1
    assert joints == {
        ("front leg", "side rail"): 2,
        ("rear leg", "side rail"): 2,  # the rails' stub tenons
        ("front leg", "spline"): 2,
        ("rear leg", "spline"): 2,
        ("armrest", "spline"): 2,  # the splines in the seam
        ("armrest", "front leg"): 2,
        ("armrest", "rear leg"): 2,  # the legs' tops under the arms
        ("front rail", "side rail"): 2,
        ("rear rail", "side rail"): 2,  # the cross rails' tenons
        ("armrest", "back post"): 2,  # the half lap
        ("back post", "back rail"): 4,  # two back rails, both ends
        ("back cane", "back post"): 2,
        ("back cane", "back rail"): 2,
        ("seat cane", "side rail"): 2,
        ("front rail", "seat cane"): 1,
        ("rear rail", "seat cane"): 1,
    }
