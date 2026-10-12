# a part's cross-section to DXF: which entities, read back
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import TMP, count
part = Box(40, 30, 20) - Cylinder(8, 30) - Cylinder(3, 30).translate(14, 8, 0)
part = part.fillet(part.edges().parallel_to(Z).filter_by(lambda e: abs(e.center().x) > 19), 4)
cut = part.section(Plane.XY)
print("[01] section edges:", sorted({e.geom_type for e in cut.edges()}), len(cut.edges()))
path = os.path.join(TMP, "section.dxf")
export_dxf(cut, path)
print("[01] entities:", count(path), "| size", os.path.getsize(path), "bytes")
back = import_dxf(path)
print("[01] back:", back, "holes", [len(f.inner_wires()) for f in back.faces()],
      "kinds", sorted({e.geom_type for e in back.edges()}))
print("[01] radii:", sorted(round(e.radius, 12) for e in back.edges() if e.geom_type == "circle"))
print("[01] area", round(cut.area, 6), "->", round(back.area, 6))
text = open(path).read()
print("[01] header:", [l for l in text.splitlines()[:12]])
snapshot("section", back, view="top", size=(700, 500))
