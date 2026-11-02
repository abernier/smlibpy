"""The zigzag chair's machining files, read back: every part lies inside its outline, the tails and the grip are the
model's, and what machining_setup leaves or refuses is what the README says.

The files are made once (without the drawings, which `test_machining` covers) and read with `import_dxf`; the
volumes and sizes are the model's own.
"""

import csv
import importlib.util
import math
from pathlib import Path

import pytest
from pytest import approx

from smlibpy import *

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "zigzag_chair_machining.py"


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    spec = importlib.util.spec_from_file_location("zigzag_chair_machining", EXAMPLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out = tmp_path_factory.mktemp("machining")
    return module, out, module.machining_files(out, pictures=False)


def test_every_part_is_in_the_cut_list_once(files):
    module, out, written = files
    parts = module.model()
    assert sum(r["qty"] for r in written["rows"]) == len(parts) == 6
    with (out / "cutlist.csv").open() as fh:
        rows = list(csv.DictReader(fh))
    assert sorted(r["part"] for r in rows) == sorted(p.name for p in parts)
    assert sorted(written["dxf"]) == sorted(p.name for p in (out / "dxf").glob("*.dxf"))
    # The four boards are wider than a plank: edge-glued panels of two boards each.
    boards = {r["part"]: r["boards"] for r in written["rows"]}
    assert boards == {"seat": 2, "back": 2, "slant": 2, "base": 2, "seat cleat": 1, "foot cleat": 1}


def test_what_machining_setup_leaves_and_refuses(files):
    module, _out, written = files
    # On its face, the seat with its tails is refused, either way up; its blank is laid instead.
    assert [(key, what.split(",")[0]) for key, what, _ in written["refused"]] == [
        ("seat", "main face"),
        ("seat", "the other face"),
    ]
    flagged = sorted((key, setup, why.split(" (")[0]) for key, setup, why, _, _ in written["flagged"])
    assert flagged == sorted(
        [
            ("seat", "`seat.dxf`", "not a prism along the tool"),  # the nose's mitre and the 8 degree rear end
            ("seat", "`seat_tails.dxf`", "not a prism along the tool"),  # the seat's faces, tilted
            ("back", "`back.dxf`", "not a prism along the tool"),  # the pins
            ("back", "(no DXF)", "not a prism along the tool"),  # on end: the pins' floors lean
            ("back", "(no DXF)", "enclosed"),
            ("back", "(no DXF)", "opens at the side"),  # the grip, from the back's end
            ("slant", "`slant.dxf`", "not a prism along the tool"),  # the two mitres
            ("base", "`base.dxf`", "not a prism along the tool"),  # the mitre and the planed sides
            ("seat_cleat", "`seat_cleat.dxf`", "not a prism along the tool"),  # the long face, and the ends
            ("foot_cleat", "`foot_cleat.dxf`", "not a prism along the tool"),
        ]
    )
    leans = {(key, setup): lean for key, setup, _, lean, _ in written["flagged"]}
    assert leans[("slant", "`slant.dxf`")] == f"{90 - module.MITRE_ANGLE:g}"  # 22.5 degrees to the board's face
    assert leans[("base", "`base.dxf`")] == f"{module.chair.BEVEL_ANGLE:.1f}, {90 - module.MITRE_ANGLE:g}"


def test_every_part_lies_inside_its_outline(files):
    """The router's through cut never takes from the finished part: the part is inside its outline's prism, and
    touches its walls (the outline is the part's widest extent)."""
    _module, out, written = files
    for r in written["records"]:
        main = r["main"]
        outline = import_dxf(out / "dxf" / f"{r['key']}.dxf", layers=["OUTLINE"])
        assert outline.area == approx(main.layer("OUTLINE").area, rel=1e-9)
        prism = outline.extrude(main.thickness)
        laid = main.part
        assert (laid & prism).volume == approx(laid.volume, rel=1e-6), r["key"]
        assert outline.bbox().size.x == approx(laid.bbox().size.x, rel=1e-9)
        assert outline.bbox().size.y == approx(laid.bbox().size.y, rel=1e-9)
    # The seat's main setup is its blank: the seat, and the back's sockets between its tails.
    seat = next(r for r in written["records"] if r["key"] == "seat")
    assert seat["laid"].volume > seat["part"].volume
    assert (seat["laid"] & seat["part"]).volume == approx(seat["part"].volume, rel=1e-6)


def test_the_tails_and_the_grip_are_the_models(files):
    module, out, _written = files
    chair = module.chair
    tails = import_dxf(out / "dxf" / "seat_tails.dxf", layers=["TAILS"])
    assert len(tails.faces()) == chair.TAILS
    assert tails.area == approx(chair.TAILS * (chair.TAIL_REAR + chair.TAIL_FRONT) / 2 * chair.T, rel=1e-6)
    depth = f"{chair.GRIP_DEEP:g}".replace(".", "_")
    grip = import_dxf(out / "dxf" / "back.dxf", layers=[f"POCKET_D{depth}"])
    slot = (chair.GRIP - chair.GRIP_HIGH) * chair.GRIP_HIGH + math.pi * (chair.GRIP_HIGH / 2) ** 2
    assert grip.area == approx(slot, rel=1e-6)


def test_the_base_is_cut_to_its_top_face(files):
    module, _out, written = files
    chair = module.chair
    base = next(r for r in written["rows"] if r["part"] == "base")
    assert base["width"] == approx(2 * chair.base_half(*chair.BASE_INNER), rel=1e-9)  # the slant's width there
    # Cut square to 330 at the foot and 300 at the front, it would fall short of the slant at the mitre's inner edge
    # by SQUARE_STEP a side, which planing the base cannot close.
    y, foot, front = chair.BASE_INNER[0], chair.FOOT[0], chair.BASE_FRONT
    square = chair.W_FOOT + (chair.W_BASE_FRONT - chair.W_FOOT) * (y - foot) / (front - foot)
    assert base["width"] / 2 - square / 2 == approx(chair.SQUARE_STEP, rel=1e-9)
    assert chair.SQUARE_STEP > 3


def test_the_nests_hold_every_board_once(files):
    module, out, written = files
    boards = sum(r["boards"] * r["blank"][0] * r["strip"] for r in written["rows"])
    nested = sum(import_dxf(p, layers=["BLANK"]).area for p in (out / "nests").glob("*.dxf"))
    assert nested == approx(boards, rel=1e-9)
    planks = sum(n for _, n, _, _ in written["nests"])
    plank_area = sum(import_dxf(p, layers=["PLANK"]).area for p in (out / "nests").glob("*.dxf"))
    assert plank_area == approx(planks * math.prod(module.PLANK))
