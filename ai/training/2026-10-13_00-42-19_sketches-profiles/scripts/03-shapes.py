# Shapes with the shared options: fillet=, chamfer=, rotation=, align=.
import math
def show(label, s):
    b = s.bbox()
    print(f"[03] {label}: area {s.area:.4f} edges {len(s.edges())} {sorted(set(e.geom_type for e in s.edges()))} "
          f"bbox ({b.min.x:.4g}, {b.min.y:.4g})..({b.max.x:.4g}, {b.max.y:.4g})")

# --- Rectangle ---
plate = Rectangle(80, 50, fillet=6)
show("Rectangle(80, 50, fillet=6)", plate)
print("[03]   closed form", round(4000 - (4 - math.pi) * 36, 4))
show("Rectangle(40, 20, chamfer=3)", Rectangle(40, 20, chamfer=3))
show("Rectangle(40, 20, rotation=30)", Rectangle(40, 20, rotation=30))
show("Rectangle(40, 20, fillet=10)", Rectangle(40, 20, fillet=10))
show("Rectangle(40, 20, fillet=4, align=Align.MIN)", Rectangle(40, 20, fillet=4, align=Align.MIN))
show("RoundedRectangle(80, 50, 6)", RoundedRectangle(80, 50, 6))
# --- Triangle ---
show("Triangle(40, 20)", Triangle(40, 20))
show("Triangle(30, 40, apex=0)", Triangle(30, 40, apex=0))
show("Triangle(30, 40, apex=30)", Triangle(30, 40, apex=30))
show("Triangle(30, 20, apex=-10)", Triangle(30, 20, apex=-10))
gusset = Triangle(30, 30, apex=0, fillet=2)
show("Triangle(30, 30, apex=0, fillet=2)", gusset)
print("[03]   right angle at", [v.point for v in Triangle(30, 40, apex=0).vertices()])
show("Triangle(20, 20 * math.sqrt(3) / 2)", Triangle(20, 20 * math.sqrt(3) / 2))
# --- Polygon / RegularPolygon / Trapezoid / Ellipse ---
show("Polygon L fillet=2", Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30), fillet=2))
show("Polygon L chamfer=1", Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30), chamfer=1))
show("RegularPolygon(10, 6, fillet=1)", RegularPolygon(10, 6, fillet=1))
show("RegularPolygon(6.5, 6, inscribed=True, chamfer=0.5)", RegularPolygon(6.5, 6, inscribed=True, chamfer=0.5))
show("Trapezoid(40, 15, 60, fillet=2)", Trapezoid(40, 15, 60, fillet=2))
show("Trapezoid(40, 15, 60, rotation=90)", Trapezoid(40, 15, 60, rotation=90))
show("Ellipse(15, 8, rotation=30)", Ellipse(15, 8, rotation=30))
print("[03]   ellipse closed form", round(math.pi * 120, 4))
# --- errors ---
def err(label, f):
    try:
        f(); print(f"[03] {label}: no error")
    except Exception as e:
        print(f"[03] {label}: {type(e).__name__}: {e}")
err("fillet and chamfer", lambda: Rectangle(40, 20, fillet=2, chamfer=1))
err("fillet too large", lambda: Rectangle(40, 20, fillet=11))
err("polygon fillet too large", lambda: Polygon((0, 0), (50, 0), (0, 5), fillet=3))
err("triangle zero height", lambda: Triangle(10, 0))
err("trapezoid angle 0", lambda: Trapezoid(40, 15, 0))
err("trapezoid angle 180", lambda: Trapezoid(40, 15, 180))
err("ellipse radius 0", lambda: Ellipse(0, 5))
err("negative fillet", lambda: Rectangle(40, 20, fillet=-1))
err("polygon 3D points with fillet", lambda: Polygon((0, 0, 1), (10, 0, 1), (0, 10, 1), fillet=1))
err("RoundedRectangle too large", lambda: RoundedRectangle(40, 20, 10.0001))
