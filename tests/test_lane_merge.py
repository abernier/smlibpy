"""Where the lanes of the kernel review meet (the merge of BT, FO, S, C, U, DA, IX, M and WN into
fix/kernel-review): a fillet of a part read from a file runs in another process (WN's
``_guard.isolated``, FO's fillet executive) and still brings back the colors and names of its faces
and where they came from (BT's T3 and T5, carried by the guard's sidecar of the result); the file
functions know every format the lanes added (.brep, .smp, .svg).
"""

import pytest
from pytest import approx

from smlibpy import *
from smlibpy import _guard


def _painted(part):
    return part.colored("gold", faces=part.faces().top()).named("seal", faces=part.faces().bottom())


def _own(part):
    return sorted(((f.geom_type, f.color, f.name) for f in part.faces() if f.color or f.name), key=repr)


def test_fillets_of_imported_parts_keep_colors_names_and_history(monkeypatch):
    made = _painted(Box(60, 40, 8) - Cylinder(5, 20))
    read = _painted(from_smb(to_smb(made)))
    assert read._h.imported and not made._h.imported
    steps = []
    isolated = _guard.isolated

    def spy(what, fn, *args, **kwargs):
        steps.append(what)
        return isolated(what, fn, *args, **kwargs)

    monkeypatch.setattr(_guard, "isolated", spy)
    here = made.fillet(made.edges().top(), 1)
    assert steps == []
    there = read.fillet(read.edges().top(), 1)
    assert steps == ["fillet"]
    assert _own(there) == _own(read) == _own(here)
    assert there.volume == approx(here.volume, rel=1e-9) and there.is_valid()
    assert len(there.faces().new(since=read)) == len(here.faces().new(since=made)) == 5
    assert len(there.faces().derived_from(read.faces().top())) == 1


def test_every_file_type_of_the_lanes(tmp_path):
    part = Box(20, 10, 5) - Cylinder(2, 10)
    for suffix in ("brep", "smp"):
        export(part, tmp_path / f"part.{suffix}")
        back = load(tmp_path / f"part.{suffix}")
        assert isinstance(back, Part) and back._h.imported
        assert back.volume == approx(part.volume, rel=1e-12)
    export(drawing_views(part), tmp_path / "views.svg")
    assert (tmp_path / "views.svg").read_text().startswith("<?xml")
    with pytest.raises(TypeError, match="draws 2D shapes, not a Part"):
        export(part, tmp_path / "part.svg")
    with pytest.raises(ValueError, match=r"use \.step, \.stl, \.glb, \.gltf, \.obj, \.smb, \.smp, \.dxf, \.svg, \.usda or \.brep"):
        export(part, tmp_path / "part.xyz")
    with pytest.raises(ValueError, match=r"load reads \.step, \.stp, \.igs, \.iges, \.stl, \.smb, \.smp, \.dxf, \.usda and \.brep"):
        load(tmp_path / "views.svg")
