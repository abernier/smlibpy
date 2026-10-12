# Slots (straight, between centers, along arcs), Stroke along paths, Hull of shapes and points.
import math
def show(label, s):
    b = s.bbox()
    print(f"[04] {label}: area {s.area:.4f} faces {len(s.faces())} holes {sum(len(f.inner_wires()) for f in s.faces())} "
          f"edges {len(s.edges())} {sorted(set(e.geom_type for e in s.edges()))} "
          f"bbox ({b.min.x:.4g}, {b.min.y:.4g})..({b.max.x:.4g}, {b.max.y:.4g})")
# --- slots ---
show("Slot(30, 8)", Slot(30, 8))
between = Stroke(Line((10, 5), (40, 20)), 6)
show("Stroke(Line((10, 5), (40, 20)), 6)", between)
print("[04]   closed form", round(math.hypot(30, 15) * 6 + 9 * math.pi, 4))
arc_slot = ArcSlot(30, 6, 90)
show("ArcSlot(30, 6, 90)", arc_slot)
print("[04]   closed form", round(30 * math.pi / 2 * 6 + 9 * math.pi, 4))
show("ArcSlot(40, 6, 60, rotation=15)", ArcSlot(40, 6, 60, rotation=15))
flange = Circle(50) - Circle(20) - PolarLocations(0, 3) * ArcSlot(35, 6, 60, rotation=-30)
show("flange with 3 arc slots", flange)
print("[04]   closed form", round(math.pi * (2500 - 400) - 3 * (35 * math.pi / 3 * 6 + 9 * math.pi), 4))
show("ArcSlot(30, 6, 90, align=Align.CENTER)", ArcSlot(30, 6, 90, align=Align.CENTER))
# --- stroke ---
path = Profile((0, 0)).line_to(20, 0).arc(10, 90).line_to(y=25).wire()
show("Stroke(path, 4)", Stroke(path, 4))
print("[04]   closed form", round(path.length * 4 + 4 * math.pi, 4), "path length", round(path.length, 4))
show("Stroke(path, 4, ends='flat')", Stroke(path, 4, ends="flat"))
print("[04]   closed form", round(path.length * 4, 4))
corner = Polyline((0, 0), (20, 0), (20, 20))
for c in ("round", "sharp", "chamfer"):
    show(f"Stroke(corner, 4, ends='flat', corners='{c}')", Stroke(corner, 4, ends="flat", corners=c))
print("[04]   closed forms: round", round(156 + math.pi, 4), "sharp", 160, "chamfer", 158)
show("Stroke closed path (ring)", Stroke(CenterArc((0, 0), 10, 0, 360), 2))
print("[04]   closed form", round(math.pi * (121 - 81), 4))
show("Stroke crossing path", Stroke(Polyline((0, 0), (20, 20), (20, 0), (0, 20)), 2))
show("Stroke tight arc (r < width/2)", Stroke(CenterArc((0, 0), 2, 0, 90), 6))
rib = Stroke(Polyline((0, 0), (30, 0), (30, 20)), 3, ends="flat", corners="sharp").extrude(10)
print("[04] rib volume", round(rib.volume, 4), "expected", round((90 + 60 - 2.25 + 2.25) * 10, 4))
# --- hull ---
lever = Hull(Circle(10), Pos(60, 0) * Circle(6))
show("Hull(Circle(10), Pos(60, 0) * Circle(6))", lever)
r1, r2, d = 10, 6, 60
beta = math.asin((r1 - r2) / d)
print("[04]   closed form", round(math.sqrt(d * d - (r1 - r2) ** 2) * (r1 + r2) + r1 * r1 * (math.pi / 2 + beta) + r2 * r2 * (math.pi / 2 - beta), 4))
show("Hull of points", Hull((0, 0), (10, 0), (5, 8), (5, 2)))
show("Hull(Rectangle(20, 10), Pos(20, 0) * Circle(5))", Hull(Rectangle(20, 10), Pos(20, 0) * Circle(5)))
print("[04]   closed form", round(300 + 12.5 * math.pi, 4))
show("Hull of a slot and a circle", Hull(Slot(30, 10), Pos(0, 20) * Circle(3)))
show("Hull of arc edge and point", Hull(CenterArc((0, 0), 10, 0, 180), (0, -5)))
print("[04]   closed form", round(50 * math.pi + 50, 4))
show("Hull of an L sketch", Hull(Polygon((0, 0), (40, 0), (40, 8), (8, 8), (8, 30), (0, 30))))
link = Hull(Circle(8), Pos(40, 0) * Circle(8), Pos(20, 30) * Circle(5))
show("three-hole link", link - [Circle(4), Pos(40, 0) * Circle(4), Pos(20, 30) * Circle(2.5)])
def err(label, f):
    try:
        f(); print(f"[04] {label}: no error")
    except Exception as e:
        print(f"[04] {label}: {type(e).__name__}: {e}")
err("ArcSlot too wide", lambda: ArcSlot(3, 8, 90))
err("ArcSlot ends meet", lambda: ArcSlot(20, 6, 350))
err("ArcSlot angle 0", lambda: ArcSlot(20, 6, 0))
err("Stroke gap", lambda: Stroke(Wire([Line((0, 0), (10, 0)), Line((11, 0), (20, 0))]), 2))
err("Stroke spline", lambda: Stroke(Spline((0, 0), (10, 5), (20, 0)), 2))
err("Stroke Profile", lambda: Stroke(Profile().line_to(10, 0), 2))
err("Stroke width", lambda: Stroke(Line((0, 0), (10, 0)), 0))
err("Hull collinear", lambda: Hull((0, 0), (5, 0), (10, 0)))
err("Hull spline", lambda: Hull(Spline((0, 0), (10, 5), (20, 0)), (0, 10)))
err("Hull of a Part", lambda: Hull(Box(1, 1, 1)))
err("Hull point off plane", lambda: Hull((0, 0, 0), (10, 0, 5), (0, 10, 0)))
