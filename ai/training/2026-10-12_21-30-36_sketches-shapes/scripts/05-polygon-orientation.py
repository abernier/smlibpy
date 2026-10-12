# Polygon: does the winding or 3D points change extrude/Booleans?
ccw = Polygon((0, 0), (30, 0), (30, 10), (0, 10))
cw = Polygon((0, 0), (0, 10), (30, 10), (30, 0))
for name, s in [("ccw", ccw), ("cw", cw)]:
    p = s.extrude(5)
    print(f"[05] {name}: face normal {s.faces()[0].normal_at()} extrude bbox {p.bbox().min}..{p.bbox().max} vol {p.volume:.4f} valid {p.is_valid()}")
    print(f"[05] {name}: + Circle: {(s + Circle(3)).area:.4f}, - Circle: {(s - Circle(3)).area:.4f}, extrude(-5) z {s.extrude(-5).bbox().min.z}")
    print(f"[05] {name} on top of box: ", (Box(40, 40, 10) - s.on(Box(40,40,10).faces().top()).extrude(-2)).volume)
tilt = Polygon((0, 0, 0), (10, 0, 0), (10, 10, 10), (0, 10, 10))
pt = tilt.extrude(5)
print("[05] tilted polygon extrude bbox:", pt.bbox().min, pt.bbox().max, "vol:", round(pt.volume, 4), "valid:", pt.is_valid())
up = Polygon((0, 0, 5), (10, 0, 5), (10, 10, 5), (0, 10, 5))
print("[05] z=5 polygon plane origin:", up.plane.origin)
try:
    print("[05] z=5 polygon + XY rect:", repr(up + Rectangle(4, 4)))
except Exception as e:
    print("[05] z=5 polygon + XY rect:", type(e).__name__, e)
try:
    print("[05] z=5 polygon + rect at z=5:", repr(up + Rectangle(4, 4).translate(0, 0, 5)))
except Exception as e:
    print("[05] z=5 polygon + rect at z=5:", type(e).__name__, e)
