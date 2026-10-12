# load() and export() by extension; what cannot be written
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import TMP, count
s = (Rectangle(30, 20) - Circle(4)).named("cut")
p = os.path.join(TMP, "s.dxf")
s.export(p)
back = load(p)
print("[09] export/load:", type(back).__name__, round(back.area, 6), "layer in file:", "\ncut\n" in open(p).read())
export([Polyline((0, 0), (10, 0), (10, 5)), Line((0, 0), (0, 3)), CenterArc((0, 0), 5, 0, 90)], os.path.join(TMP, "curves.dxf"))
print("[09] wires and edges:", count(os.path.join(TMP, "curves.dxf")))
for bad in (Box(1, 1, 1), Box(1, 1, 1).mesh(), Vertex(0, 0, 0)):
    try:
        export_dxf(bad, os.path.join(TMP, "bad.dxf"))
    except TypeError as e:
        print("[09]", type(bad).__name__, "->", e)
try:
    export_dxf(Sphere(5).faces()[0], os.path.join(TMP, "bad.dxf"))
except TypeError as e:
    print("[09] curved face ->", e)
