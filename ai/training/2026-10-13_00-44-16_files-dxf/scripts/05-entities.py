# every entity the reader knows, hand-written
import sys, os, math; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import dxf, lw, line, circle
slot = import_dxf(dxf("slot.dxf", lw([(-15, -5), (15, -5, 1), (15, 5), (-15, 5, 1)])))
print("[05] LWPOLYLINE with bulges 1:", [e.geom_type for e in slot.edges()], "area", round(slot.area, 6), "exact", round(300 + math.pi * 25, 6))
big = import_dxf(dxf("big.dxf", lw([(0, 0, math.tan(math.radians(270) / 4)), (10, 0)])))
print("[05] bulge for 270 degrees:", big.bbox())
ents = "0\nPOLYLINE\n8\n0\n66\n1\n70\n1\n10\n0\n20\n0\n30\n0\n"
for x, y, b in [(0, 0, 0), (2, 0, 0), (2, 1, 1), (0, 1, 0)]:
    ents += f"0\nVERTEX\n8\n0\n10\n{x}\n20\n{y}\n30\n0\n42\n{b}\n"
ents += "0\nSEQEND\n"
old = import_dxf(dxf("old.dxf", ents, header="9\n$INSUNITS\n70\n1\n"))
print("[05] POLYLINE + VERTEX in inches:", old.bbox(), round(old.area, 4), "=", round((2 + math.pi / 2) * 25.4 ** 2, 4))
arc = import_dxf(dxf("ocs.dxf", line((-10, 0), (0, 0)) + "0\nARC\n8\n0\n10\n5\n20\n0\n30\n0\n40\n5\n50\n0\n51\n180\n210\n0\n220\n0\n230\n-1\n"))
print("[05] ARC with extrusion (0,0,-1):", arc.bbox())
ell = import_dxf(dxf("ell.dxf", "0\nELLIPSE\n8\n0\n10\n0\n20\n0\n30\n0\n11\n10\n21\n0\n31\n0\n40\n0.5\n41\n0\n42\n3.141592653589793\n" + line((-10, 0), (10, 0))))
print("[05] ELLIPSE arc + LINE:", sorted({e.geom_type for e in ell.edges()}), round(ell.area, 6), "=", round(math.pi * 25, 6))
w = math.sqrt(0.5)
poles = [(10, 0), (10, 10), (0, 10), (-10, 10), (-10, 0), (-10, -10), (0, -10), (10, -10), (10, 0)]
knots = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]
sp = (f"0\nSPLINE\n8\n0\n70\n13\n71\n2\n72\n{len(knots)}\n73\n{len(poles)}\n74\n0\n" + "".join(f"40\n{k}\n" for k in knots)
      + "".join(f"41\n{x}\n" for x in [1, w, 1, w, 1, w, 1, w, 1]) + "".join(f"10\n{a}\n20\n{b}\n30\n0\n" for a, b in poles))
c = import_dxf(dxf("nurbs.dxf", sp))
print("[05] rational SPLINE circle:", round(c.area, 6), "=", round(math.pi * 100, 6), c.edges()[0].geom_type)
fit = "0\nSPLINE\n8\n0\n70\n8\n71\n3\n72\n0\n73\n0\n74\n4\n" + "".join(f"11\n{x}\n21\n{y}\n31\n0\n" for x, y in [(0, 0), (10, 5), (20, 0), (30, 5)])
wires = import_dxf_wires(dxf("fit.dxf", fit))
print("[05] SPLINE with fit points only:", wires[0], "passes (10, 5):", round(wires[0].distance_to((10, 5)), 12))
mixed = import_dxf(dxf("mixed.dxf", "0\nTEXT\n8\n0\n10\n0\n20\n0\n30\n0\n40\n2\n1\nNOTE\n0\nPOINT\n8\n0\n10\n1\n20\n1\n30\n0\n" + circle((0, 0), 4)))
print("[05] TEXT and POINT left out with a warning; area", round(mixed.area, 4))
