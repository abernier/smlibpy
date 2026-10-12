# the drawing plane of export_dxf
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import TMP, count
part = Box(40, 30, 20) - Cylinder(8, 30)
side = part.section(Plane.XZ)
p = os.path.join(TMP, "side.dxf")
export_dxf(side, p)
print("[04] XZ section in its own plane:", import_dxf(p).bbox(), count(p))
lifted = Plane.XY.offset(7) * Circle(3).translate(10, 0)
export_dxf(lifted, os.path.join(TMP, "lifted.dxf"))
print("[04] parallel to XY at z 7:", import_dxf(os.path.join(TMP, "lifted.dxf")).bbox())
standing = Rectangle(10, 4).on(Plane.XZ).translate(5, 0, 0)
export_dxf(standing, os.path.join(TMP, "front.dxf"), plane=Plane.XZ)
print("[04] plane=Plane.XZ:", import_dxf(os.path.join(TMP, "front.dxf")).bbox())
export_dxf(standing, os.path.join(TMP, "front-own.dxf"))
print("[04] default for a sketch in XZ (its own plane, origin at its center):", import_dxf(os.path.join(TMP, "front-own.dxf")).bbox())
for bad in (dict(plane=Plane.XY), dict()):
    try:
        export_dxf([standing, Circle(2)], os.path.join(TMP, "bad.dxf"), **bad)
    except ValueError as e:
        print("[04]", bad, "->", e)
view = part.outline(Plane.XY)
export_dxf(view, os.path.join(TMP, "view.dxf"))
print("[04] outline view:", count(os.path.join(TMP, "view.dxf")))
