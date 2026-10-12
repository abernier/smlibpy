# the code of recipes/modeling.md (text and DXF sections), unchanged, in a temp folder
import os, tempfile
os.chdir(tempfile.mkdtemp(prefix="recipes-"))
plate = Box(80, 30, 6)
plate = plate.fillet(plate.edges().parallel_to(Z), 4)
top = plate.faces().top()
engraved = plate - Text("SN 0042", 8).on(top).extrude(-0.6)       # 8 mm capitals, 0.6 deep
base = Box(40, 16, 3)
badge = base + Text("OK", 10).on(base.faces().top()).extrude(1)    # raised 1 mm
print("[13] engraved valid", engraved.is_valid(), "removed", round(plate.volume - engraved.volume, 4),
      "= 0.6 * area", round(0.6 * Text("SN 0042", 8).area, 4))
print("[13] badge valid", badge.is_valid(), "top", badge.bbox().max.z)

export_dxf(Slot(40, 12) - Circle(3), "outline.dxf")    # stands for a drawing from elsewhere
outline = import_dxf("outline.dxf")                     # closed loops, holes nested, in mm
link = outline.extrude(5)
print("[13] link valid", link.is_valid(), "volume", round(link.volume, 4), "faces", len(link.faces()))
snapshot("recipes", engraved, badge.translate(0, 30, 0), link.translate(0, -30, 0), view="iso")
