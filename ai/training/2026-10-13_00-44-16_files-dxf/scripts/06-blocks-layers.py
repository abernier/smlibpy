# blocks (INSERT, nested, mirrored, arrays) and layers
import sys, os, math; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import dxf, lw, circle
blocks = ("0\nBLOCK\n8\n0\n2\nSQ\n70\n0\n10\n5\n20\n5\n30\n0\n" + lw([(0, 0), (10, 0), (10, 10), (0, 10)]) + "0\nENDBLK\n"
          "0\nBLOCK\n8\n0\n2\nHOLE\n70\n0\n10\n0\n20\n0\n30\n0\n" + circle((0, 0), 1) + "0\nENDBLK\n"
          "0\nBLOCK\n8\n0\n2\nNEST\n70\n0\n10\n0\n20\n0\n30\n0\n0\nINSERT\n8\n0\n2\nHOLE\n10\n0\n20\n0\n30\n0\n41\n2\n42\n2\n0\nENDBLK\n")
ents = ("0\nINSERT\n8\nPARTS\n2\nSQ\n10\n100\n20\n0\n30\n0\n41\n2\n42\n2\n50\n45\n"
        "0\nINSERT\n8\nPARTS\n2\nNEST\n10\n100\n20\n0\n30\n0\n"
        "0\nINSERT\n8\nPARTS\n2\nSQ\n10\n0\n20\n0\n30\n0\n41\n-1\n42\n1\n"
        "0\nINSERT\n8\nGRID\n2\nHOLE\n10\n200\n20\n0\n30\n0\n70\n2\n71\n2\n44\n10\n45\n20\n")
path = dxf("blocks.dxf", ents, blocks=blocks)
s = import_dxf(path)
print("[06] all: faces", len(s.faces()), "holes", sorted(len(f.inner_wires()) for f in s.faces()), "area", round(s.area, 4))
turned = [f for f in s.faces() if f.inner_wires()][0]
print("[06] SQ scaled 2, turned 45 at (100, 0) with NEST's hole: bbox", turned.bbox())
mirrored = [f for f in s.faces() if abs(f.center().x) < 20][0]
print("[06] SQ mirrored at the origin:", mirrored.bbox())
grid = import_dxf(path, layers=["grid"])
print("[06] layer GRID (block on layer 0 takes the insert's layer):", sorted((round(e.arc_center.x, 6), round(e.arc_center.y, 6)) for e in grid.edges()))
print("[06] layer PARTS:", round(import_dxf(path, layers="PARTS").area, 4))
try:
    import_dxf(path, layers=["CUT"])
except ValueError as e:
    print("[06]", e)
