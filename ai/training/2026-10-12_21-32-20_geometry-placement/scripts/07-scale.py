# scale: uniform, center, per-axis, volume, analytic surfaces
b = Box(10, 10, 10, align=Align.MIN)   # 0..10
s2 = b.scale(2)
print("[07] scale(2) bbox:", s2.bbox(), "vol", round(s2.volume, 6), "ratio", round(s2.volume / b.volume, 6))
s2c = b.scale(2, center=(5, 5, 5))
print("[07] scale(2, center=(5,5,5)) bbox:", s2c.bbox())
s2cc = b.scale(2, center=b.center())
print("[07] scale(2, center=b.center()) bbox:", s2cc.bbox())
sh = b.scale(0.5)
print("[07] scale(0.5) bbox:", sh.bbox(), "vol", round(sh.volume, 6))
sx = b.scale((2, 1, 1))
print("[07] scale((2,1,1)) bbox:", sx.bbox(), "vol", round(sx.volume, 6), "valid", sx.is_valid())
c = Cylinder(5, 10)
cx = c.scale((2, 1, 1))
print("[07] cylinder scale((2,1,1)): bbox", cx.bbox(), "vol", round(cx.volume, 4), "expected", round(2 * math.pi * 25 * 10, 4), "valid", cx.is_valid())
print("[07]   face types:", sorted({f.geom_type for f in cx.faces()}))
sp = Sphere(5).scale((1, 1, 0.5))
print("[07] sphere scale((1,1,0.5)): bbox", sp.bbox(), "vol", round(sp.volume, 4), "expected", round(4 / 3 * math.pi * 125 * 0.5, 4), "valid", sp.is_valid())
cu = Cylinder(5, 10).scale(3)
print("[07] cylinder scale(3): vol", round(cu.volume, 4), "expected", round(math.pi * 225 * 30, 4), "faces", sorted({f.geom_type for f in cu.faces()}), "radius", cu.faces().cylinders()[0].radius if cu.faces().cylinders() else None)
t = Torus(10, 2).scale(2)
print("[07] torus scale(2): vol", round(t.volume, 4), "expected", round(2 * math.pi**2 * 20 * 16, 4), "valid", t.is_valid())
# negative and zero factors
try:
    n = b.scale(-1)
    print("[07] scale(-1): bbox", n.bbox(), "vol", n.volume, "valid", n.is_valid())
except Exception as e:
    print("[07] scale(-1) ->", type(e).__name__, e)
try:
    z = b.scale(0)
    print("[07] scale(0): bbox", z.bbox(), "vol", z.volume, "valid", z.is_valid())
except Exception as e:
    print("[07] scale(0) ->", type(e).__name__, e)
try:
    z = b.scale((1, 1, 0))
    print("[07] scale((1,1,0)): bbox", z.bbox(), "valid", z.is_valid())
except Exception as e:
    print("[07] scale((1,1,0)) ->", type(e).__name__, e)
# sketch scaling
r = Rectangle(10, 4).scale(2)
print("[07] sketch scale(2): area", r.area, "plane", r.plane, "bbox", r.bbox())
ci = Circle(5).scale((2, 1, 1))
print("[07] circle scale((2,1,1)): area", round(ci.area, 4), "expected", round(math.pi * 50, 4), "edge types", [e.geom_type for e in ci.edges()])
# sketch on a plane scaled
rp = Rectangle(10, 4).on(Plane.XY.offset(10)).scale(2)
print("[07] sketch on offset plane scaled: bbox", rp.bbox(), "plane", rp.plane)
# edges / wires
e = CenterArc((0, 0), 5, 0, 90).scale(2)
print("[07] arc scale(2):", e, "type", e.geom_type, "length", round(e.length, 6), "expected", round(math.pi * 10 / 2, 6))
# booleans after a scale
cut = cx - Box(4, 4, 40)
print("[07] boolean after nonuniform scale: valid", cut.is_valid(), "vol", round(cut.volume, 3))
# ShapeList has scale?
print("[07] ShapeList.scale exists:", hasattr(ShapeList, "scale"))
snapshot("scale", cx, sp.translate(30, 0, 0), view="iso")
