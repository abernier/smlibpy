# loops in loops: holes and islands (even-odd)
import sys, os, math; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import dxf, lw, circle
nested = lw([(-20, -20), (20, -20), (20, 20), (-20, 20)]) + circle((0, 0), 15) + lw([(-5, -5), (5, -5), (5, 5), (-5, 5)])
s = import_dxf(dxf("nested.dxf", nested))
print("[08] square, circle, square: faces", len(s.faces()), "holes", sorted(len(f.inner_wires()) for f in s.faces()),
      "area", round(s.area, 4), "=", round(1600 - math.pi * 225 + 100, 4))
lens = import_dxf(dxf("lens.dxf", circle((-5, 0), 10) + circle((5, 0), 10)))
print("[08] two crossing circles: faces", len(lens.faces()), "area", round(lens.area, 4))
snapshot("nesting", s, lens.translate(50, 0, 0), view="top", size=(800, 400))
