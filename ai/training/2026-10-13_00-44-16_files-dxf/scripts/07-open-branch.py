# curves that do not close, and outlines that branch
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import dxf, lw, line
gap = line((0, 0), (10, 0), "CUT") + line((10, 0), (10, 10), "CUT") + line((10, 10), (0.02, 10), "CUT") + line((0, 10), (0, 0), "CUT")
path = dxf("gap.dxf", gap)
try:
    import_dxf(path)
except ModelingError as e:
    print("[07]", type(e).__name__ + ":", e)
s = import_dxf(path, tolerance=0.05)
print("[07] tolerance=0.05: area", round(s.area, 6), "(the ends meet halfway)")
w = import_dxf_wires(path)
print("[07] import_dxf_wires:", list(w))
branch = lw([(0, 0), (10, 0), (10, 10), (0, 10)]) + line((10, 10), (20, 20))
try:
    import_dxf(dxf("branch.dxf", branch))
except ModelingError as e:
    print("[07]", type(e).__name__ + ":", e)
print("[07] wires of the branching drawing:", list(import_dxf_wires(dxf("branch.dxf", branch))))
twice = line((0, 0), (10, 0)) + line((0, 0), (10, 0)) + line((10, 0), (5, 8)) + line((5, 8), (0, 0))
print("[07] a line drawn twice is read once: area", round(import_dxf(dxf("twice.dxf", twice)).area, 6))
