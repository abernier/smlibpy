# exact round trip of a sketch with arcs, an ellipse and a spline
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import TMP, count
from smlibpy._kernel import ext
spline_hole = make_face(Spline((-25, -10), (-15, -5), (-10, -15), closed=True))
plate = RoundedRectangle(60, 40, 5) - Circle(6) - Ellipse(8, 4).translate(18, 0) - spline_hole
path = os.path.join(TMP, "plate.dxf")
export_dxf(plate.named("plate"), path)
print("[02] entities:", count(path))
back = import_dxf(path)
print("[02] holes:", [len(f.inner_wires()) for f in back.faces()], "area", round(plate.area, 6), round(back.area, 6))
print("[02] radii:", sorted(e.radius for e in back.edges() if e.geom_type == "circle"))
a = [e for e in plate.edges() if e.geom_type == "bspline"][0]
b = [e for e in back.edges() if e.geom_type == "bspline"][0]
da, db = ext.curve_data(a._curve()), ext.curve_data(b._curve())
print("[02] spline poles equal:", da["poles"] == db["poles"], "knots equal:", list(da["knots"]) == list(db["knots"]))
el = [e for e in back.edges() if e.geom_type == "ellipse"][0]
print("[02] ellipse back:", ext.curve_data(el._curve(), False)["radius1"], ext.curve_data(el._curve(), False)["radius2"])
