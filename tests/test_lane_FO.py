"""Lane FO of the kernel plan: tangent chains in fillets and chamfers (F6), and the extended offset
mode's remaining crash on filleted boxes (O1, issue #2)."""

import math
import subprocess
import sys

import pytest
from pytest import approx

from smlibpy import Box, Line, Rectangle, Slot, Z, chamfer, fillet
from smlibpy._kernel import KernelError


def _plate():
    """A 40 x 30 x 10 plate with corners rounded by 5: its top outline is one tangent run."""
    return Rectangle(40, 30, fillet=5).extrude(10)


def _at(p, z):
    return p.edges().filter(lambda e: abs(e.center().z - z) < 1e-6)


def _corner_box():
    """A box with one vertical edge (at x = 20, y = 15) rounded by 5, and the top line of 35 that
    runs into the round's arc."""
    b = Box(40, 30, 10)
    b = b.fillet(b.edges().parallel_to(Z).filter(lambda e: e.center().x > 0 and e.center().y > 0), 5)
    line = _at(b, 5).filter(lambda e: e.geom_type == "line" and abs(e.length - 35) < 1e-9).one()
    return b, line


def test_tangent_chain_selects_the_run_of_an_edge():
    p = _plate()
    top = _at(p, 10)
    long = max(top, key=lambda e: e.length)
    chain = long.tangent_chain()
    assert len(chain) == 8 and chain[0] == long
    assert {e._identity() for e in chain} == {e._identity() for e in top}
    assert len(top.filter(lambda e: e.geom_type == "line").tangent_chain()) == 8
    assert len(Box(10, 10, 10).edges().parallel_to(Z).tangent_chain()) == 4  # edges that meet at corners: no run
    assert len(p.edges().group_by(Z)[0].tangent_chain()) == 8  # the bottom outline
    assert len(p.faces().top().edges().tangent_chain()) == 8
    b, line = _corner_box()
    assert [e.geom_type for e in line.tangent_chain()] == ["line", "circle", "line"]
    assert len(Box(10, 10, 10).edges()[0].tangent_chain()) == 1
    assert len(Line((0, 0, 0), (1, 0, 0)).tangent_chain()) == 1  # an edge of no part


def test_fillet_rounds_the_tangent_run_of_a_selected_edge():
    # One top edge of a plate with rounded corners failed at any radius ("the radius may be too
    # large"); the round now follows the outline. OpenCASCADE (which always propagates):
    # 11757.497249759455 for r 1 and 11674.999251067233 for r 2.
    p = _plate()
    long = max(_at(p, 10), key=lambda e: e.length)
    one = p.fillet(long, 1)
    assert one.is_valid() and one.volume == approx(11757.497249759455, rel=1e-9) and len(one.faces()) == 18
    two = p.fillet(long, 2)
    assert two.volume == approx(11674.999251067233, rel=1e-9)
    assert two.volume == approx(p.fillet(_at(p, 10), 2).volume, rel=1e-12)
    arc = _at(p, 10).filter(lambda e: e.geom_type == "circle")[0]
    assert fillet(arc, 1).volume == approx(one.volume, rel=1e-12)
    # A run that ends at sharp corners: the line, the arc and the next line (OpenCASCADE: 14.4862927).
    b, line = _corner_box()
    assert b.volume - b.fillet(line, 1).volume == approx(14.486292690588016, rel=1e-9)


def test_fillet_without_propagate_rounds_the_selected_edges_only():
    p = _plate()
    long = max(_at(p, 10), key=lambda e: e.length)
    with pytest.raises(KernelError, match=r"runs on tangentially into an edge that is not selected at "
                                          r"\(15, 15, 10\) and \(-15, 15, 10\).*propagate=True"):
        p.fillet(long, 1, propagate=False)
    with pytest.raises(KernelError, match="runs on tangentially"):
        fillet(long, 1, propagate=False)
    # Tangential at one end the kernel rounds the edge alone and runs the round on past its end.
    b, line = _corner_box()
    alone = b.fillet(line, 1, propagate=False)
    assert alone.is_valid() and (1 - math.pi / 4) * 35 < b.volume - alone.volume < 14.4862


def test_added_edges_take_the_radius_of_the_selected_edge_they_continue():
    b, line = _corner_box()
    bottom = _at(b, -5).filter(lambda e: e.geom_type == "line" and abs(e.length - 35) < 1e-9).one()
    grown = b.fillet([line, bottom], [1, 0.5])
    explicit = b.fillet(list(line.tangent_chain()) + list(bottom.tangent_chain()), [1, 1, 1, 0.5, 0.5, 0.5],
                        propagate=False)
    assert grown.is_valid() and grown.volume == approx(explicit.volume, rel=1e-12)
    with pytest.raises(ValueError, match="2 radii for 3 edges"):
        b.fillet([line, bottom, b.edges().parallel_to(Z)[0]], [1, 0.5])


def test_a_radius_law_does_not_run_along_a_tangent_run():
    p = _plate()
    long = max(_at(p, 10), key=lambda e: e.length)
    with pytest.raises(ValueError, match=r"runs on tangentially into another edge at .*propagate=False"):
        p.fillet(long, (1, 2))
    b, line = _corner_box()
    assert b.fillet(line, (0.5, 1), propagate=False).is_valid()
    assert b.fillet(line, (1, 1)).volume == approx(b.fillet(line, 1).volume, rel=1e-12)


def test_chamfer_bevels_the_tangent_run_of_a_selected_edge():
    s = Slot(40, 10).extrude(5)
    line = _at(s, 5).filter(lambda e: e.geom_type == "line")[0]
    assert len(line.tangent_chain()) == 4
    run = s.chamfer(line.tangent_chain(), 1, propagate=False)
    assert s.chamfer(line, 1).volume == approx(run.volume, rel=1e-12)
    assert chamfer(line, 1).volume == approx(run.volume, rel=1e-12) and run.is_valid()
    alone = chamfer(line, 1, propagate=False)  # the kernel bevels this one alone, and runs it on
    assert alone.is_valid() and s.volume - alone.volume < s.volume - run.volume


def test_extended_shells_of_filleted_boxes_keep_their_curves():
    # The kernel's extended offset mode (shell from its second attempt, every offset) killed the
    # process now and then on filleted boxes (issue #2: 27 of 300 runs of 8 calls for the 20 mm
    # cube, 8 and 7 of 300 for the 40 x 30 x 10 boxes): when SmBrep::MakeEdgeInFace failed after
    # it had given an intersection curve to a new Edge, SmEdgeDefinition::Imprint deleted the
    # curve, and the next Boolean of PiecewiseMerge read it. The kernel steps themselves, in
    # processes of their own (six, as about one in eight crashed before).
    code = """
import warnings
warnings.simplefilter("ignore")
from smlibpy import *
from smlibpy._kernel import k, ext
steps = []
for size, r, t in (((20, 20, 20), 2, 1), ((40, 30, 10), 1, 0.5), ((40, 30, 10), 2, 1)):
    b = Box(*size)
    b = b.fillet(b.edges(), r)
    steps.append((b, [f._f for f in b.faces().top()], t))
for b, top, t in steps * 8:
    try:
        ext.delete_brep(k.shell_brep(b._brep, -t, extended_offset=True, faces_to_shell=top))
        print("ok", flush=True)
    except RuntimeError:
        print("failed", flush=True)
"""
    runs = [subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for _ in range(6)]
    for run in runs:
        out, _ = run.communicate(timeout=300)
        assert run.returncode == 0, f"exit {run.returncode} after {len(out.split())} steps"
        assert len(out.split()) == 24


@pytest.mark.parametrize("key", ["selection/tangent_chain", "features/fillet", "features/chamfer"])
def test_tangent_chain_guides_run_and_are_found(key, capsys):
    import re

    from smlibpy.mcp import discovery

    guide = discovery.guide(key)
    assert guide is not None
    ns: dict = {}
    exec("from smlibpy import *\nimport math\nimport numpy as np", ns)
    for i, code in enumerate(re.findall(r"```python\n(.*?)```", guide.text, re.S)):
        exec(compile(code, f"{key}[{i + 1}]", "exec"), ns)
    if key == "selection/tangent_chain":
        assert capsys.readouterr().out.split("\n")[:3] == ["8 ['line', 'circle', 'circle']", "4", "11757.4972"]
        for name in ("Edge.tangent_chain", "ShapeList.tangent_chain"):
            assert discovery.guide_for(discovery.find_method(name)).key == "selection/tangent_chain"
