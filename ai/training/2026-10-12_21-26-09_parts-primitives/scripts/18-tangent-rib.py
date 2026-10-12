base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
boss = Cylinder(10, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
w = Wedge(16, 2, 14, align=(Align.MIN, Align.CENTER, Align.MIN))
m = w.mirror(Plane.YZ)
print("[18] wedge vol/valid:", round(w.volume, 3), w.is_valid(), "| mirrored:", round(m.volume, 3), m.is_valid())
for dx in [-10, -9.5, -9]:
    rib = m.translate(dx, 0, 8)
    p = base + boss + rib
    print("[18] rib at", dx, "-> valid:", p.is_valid(), "vol:", round(p.volume, 3), "faces:", len(p.faces()))
# simpler tangency: box face touching a cylinder along a line
t = Cylinder(10, 20) + Box(10, 4, 20, align=(Align.MAX, Align.CENTER, Align.CENTER)).translate(-10, 0, 0)
print("[18] box tangent to cylinder:", t, "valid:", t.is_valid(), "solids:", len(t.solids()))
t2 = Cylinder(10, 20) + Box(10, 4, 20, align=(Align.MAX, Align.CENTER, Align.CENTER)).translate(-9, 0, 0)
print("[18] box overlapping cylinder by 1:", t2, "valid:", t2.is_valid(), "solids:", len(t2.solids()))
