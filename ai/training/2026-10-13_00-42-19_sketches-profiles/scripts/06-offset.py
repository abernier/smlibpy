# Sketch.offset: corner styles, holes, merging, splitting, collapse, exact edges, speed.
import math, time
def show(label, s):
    b = s.bbox()
    print(f"[06] {label}: area {s.area:.4f} faces {len(s.faces())} holes {sum(len(f.inner_wires()) for f in s.faces())} "
          f"edges {len(s.edges())} {sorted(set(e.geom_type for e in s.edges()))} bbox ({b.min.x:.4g}, {b.min.y:.4g})..({b.max.x:.4g}, {b.max.y:.4g})")
r = Rectangle(40, 20)
show("grow 2 round", r.offset(2))
print("[06]   closed form", round(800 + 120 * 2 + 4 * math.pi, 4))
show("grow 2 sharp", r.offset(2, corners="sharp"))
show("grow 2 chamfer", r.offset(2, corners="chamfer"))
print("[06]   closed form chamfer", 44 * 24 - 4 * 2)
show("shrink 2 (any style)", r.offset(-2))
show("old spelling round=False", r.offset(2, round=False))
angle = Polygon((0, 0), (30, 0), (30, 8), (8, 8), (8, 25), (0, 25))
for c in ("round", "sharp", "chamfer"):
    show(f"L shrink 2 {c}", angle.offset(-2, corners=c))
show("L shrink 4.5 (only the corner survives)", angle.offset(-4.5))
show("ring grow 1", (Circle(10) - Circle(5)).offset(1))
print("[06]   closed form", round(math.pi * (121 - 16), 4))
show("ring grow 6 (hole closes)", (Circle(10) - Circle(5)).offset(6))
show("square hole grow 6 (hole closes)", (Rectangle(40, 40) - Rectangle(10, 10)).offset(6))
show("square hole grow 4 chamfer", (Rectangle(40, 40) - Rectangle(10, 10)).offset(4, corners="chamfer"))
two = Circle(5) + Pos(12, 0) * Circle(5)
show("two circles 2 apart, grow 0.5", two.offset(0.5))
show("two circles 2 apart, grow 2 (merge)", two.offset(2))
dumbbell = Circle(8) + Pos(30, 0) * Circle(8) + Pos(15, 0) * Rectangle(20, 2)
show("dumbbell shrink 1.5 (splits)", dumbbell.offset(-1.5))
show("slot shrink 4", Slot(40, 10).offset(-4))
show("rect shrink 9.9 (sliver)", r.offset(-9.9))
outline = Rectangle(80, 50, fillet=6)
gasket = outline.offset(3) - outline
show("gasket 3 wide outside", gasket)
print("[06]   closed form", round((outline.area + outline.perimeter * 3 + 9 * math.pi) - outline.area, 4))
frame = outline - outline.offset(-4)
show("frame 4 wide inside", frame)
show("ellipse grow 2 (kernel, B-spline)", Ellipse(15, 8).offset(2))
show("placed sketch", Rectangle(20, 10).on(Plane.XZ.offset(5)).offset(2))
print("[06] placed sketch plane", Rectangle(20, 10).on(Plane.XZ.offset(5)).offset(2).plane)
# Steiner check: convex shapes, round grow: A + P d + pi d^2
for label, s in (("pentagon", RegularPolygon(10, 5)), ("rounded rect", Rectangle(30, 10, fillet=3)), ("slot", Slot(30, 8))):
    o = s.offset(2.5)
    print(f"[06] Steiner {label}: {o.area:.6f} vs {s.area + s.perimeter * 2.5 + math.pi * 6.25:.6f}")
gear = Circle(20) + PolarLocations(20, 12) * Rectangle(6, 4)
t0 = time.perf_counter(); g = gear.offset(1); t1 = time.perf_counter()
show("gear-like outline grow 1", g)
print(f"[06] gear-like offset took {(t1 - t0) * 1000:.0f} ms")
def err(label, f):
    try:
        f(); print(f"[06] {label}: no error")
    except Exception as e:
        print(f"[06] {label}: {type(e).__name__}: {e}")
err("shrink 10 (vanishes)", lambda: r.offset(-10))
err("ring shrink 2.5 (wall vanishes)", lambda: (Circle(10) - Circle(5)).offset(-2.5))
err("slot shrink 6", lambda: Slot(40, 10).offset(-6))
err("bad corners", lambda: r.offset(2, corners="miter"))
err("ellipse chamfer", lambda: Ellipse(15, 8).offset(2, corners="chamfer"))
