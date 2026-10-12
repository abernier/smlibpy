# text in DXF, layers from names
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import TMP, count
label = Text("PART 7", 5).named("engrave")
outline = RoundedRectangle(40, 12, 2).named("cut")
p = os.path.join(TMP, "tag.dxf")
export_dxf([outline, label], p)
print("[10] entities:", count(p))
text = open(p).read()
print("[10] layers:", [n for n in ("cut", "engrave") if f"\n{n}\n" in text])
both = import_dxf(p)
only = import_dxf(p, layers=["engrave"])
print("[10] read: all", len(both.faces()), "faces; engrave", len(only.faces()), "faces, area", round(only.area, 6), "=", round(label.area, 6))
