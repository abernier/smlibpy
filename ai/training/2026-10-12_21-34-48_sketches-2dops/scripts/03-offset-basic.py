# Sketch.offset: grow and shrink, round and sharp corners, areas against formulas
def info(label, s):
    b = s.bbox()
    print(f"[03] {label}: {s!r} faces={len(s.faces())} holes={[len(f.inner_wires()) for f in s.faces()]} "
          f"edges={sorted(set(e.geom_type for e in s.edges()))}/{len(s.edges())} bbox={tuple(round(v, 5) for v in b.min)}..{tuple(round(v, 5) for v in b.max)}")
r = Rectangle(40, 20)
g = r.offset(2); info("rect +2 round", g)
print("[03]   area", round(g.area, 5), "formula A + P d + pi d^2:", round(800 + 120 * 2 + math.pi * 4, 5))
print("[03]   arc radii:", sorted({round(e.radius, 6) for e in g.edges() if e.geom_type == 'circle'}))
gs = r.offset(2, round=False); info("rect +2 sharp", gs)
print("[03]   area", round(gs.area, 5), "formula:", 44 * 24)
s = r.offset(-2); info("rect -2 (round=True)", s)
print("[03]   area", round(s.area, 5), "formula:", 36 * 16)
info("rect -2 sharp", r.offset(-2, round=False))
info("rect 0", r.offset(0))
c = Circle(10).offset(3); info("circle +3", c)
print("[03]   radius:", [round(e.radius, 6) for e in c.edges() if e.geom_type == "circle"], "area", round(c.area, 4), round(math.pi * 169, 4))
info("circle -3", Circle(10).offset(-3))
# concave corner: L shape
L = Polygon((0, 0), (30, 0), (30, 10), (10, 10), (10, 30), (0, 30))
info("L +2 round", L.offset(2))
info("L +2 sharp", L.offset(2, round=False))
info("L -2 round", L.offset(-2))
info("L -2 sharp", L.offset(-2, round=False))
print("[03] L areas: +2r", round(L.offset(2).area, 4), "+2s", round(L.offset(2, round=False).area, 4), "-2r", round(L.offset(-2).area, 4), "-2s", round(L.offset(-2, round=False).area, 4))
# L outward sharp exact: polygon (-2,-2),(32,-2),(32,12),(12,12),(12,32),(-2,32): area
Ls = Polygon((-2, -2), (32, -2), (32, 12), (12, 12), (12, 32), (-2, 32)).area
print("[03] L +2 sharp exact:", round(Ls, 4))
print("[03] L -2 sharp exact:", round(Polygon((2, 2), (28, 2), (28, 8), (8, 8), (8, 28), (2, 28)).area, 4))
snapshot("offsets", L.offset(2), L.translate(0, 0, 0.01), L.offset(-2).translate(0, 0, 0.02), view="top")
