# Open ellipse arc extruded into a surface: is the area right?
e = EllipticalArc((0, 0), 30, 20, 0, 90)
print("[12] arc length", round(e.length, 6), "start", e.start, "end", e.end)
sh = extrude(e, 5)
print("[12] shell area", round(sh.area, 6), "expected", round(5 * e.length, 6), "bbox", sh.bbox().min, sh.bbox().max)
for f in sh.faces():
    print("[12] face", f.geom_type, round(f.area, 6), [ (round(x.length, 4), x.geom_type) for x in f.edges()])
c = CenterArc((0, 0), 30, 0, 90)
shc = extrude(c, 5)
print("[12] circle arc shell area", round(shc.area, 6), "expected", round(5 * c.length, 6))
full = extrude(EllipticalArc((0, 0), 30, 20), 5)
print("[12] full ellipse extrude:", type(full).__name__, round(full.volume, 4), "expected", round(math.pi * 600 * 5, 4))
snapshot("shell", sh, view="iso")
