# Line: placing and transforming; adding lines; tiny lines in a profile
a = Line((0, 0), (10, 0))
print("[02] on XZ:", a.on(Plane.XZ))
print("[02] on front:", a.on(Plane.front), "on right:", a.on(Plane.right))
print("[02] on XY.offset(5):", a.on(Plane.XY.offset(5)))
print("[02] translate:", a.translate(1, 2, 3))
print("[02] rotate Z 90:", a.rotate(Z, 90))
print("[02] mirror YZ:", a.mirror(Plane.YZ))
print("[02] Pos*Rot:", Pos(0, 0, 5) * Rot(z=90) * a)
print("[02] scale 2:", a.scale(2))
print("[02] equal to itself:", a == a, "copy equal:", a == Line((0, 0), (10, 0)))
w = Line((0, 0), (10, 0)) + Line((10, 0), (10, 5))
print("[02] edge+edge:", type(w).__name__, w, w.start, w.end)
# a tiny line in a closed outline
pts = [(0, 0), (10, 0), (10, 10), (0, 10)]
tiny = Wire([Line((0, 0), (10, 0)), Line((10, 0), (10, 10)), Line((10, 10), (0, 10)),
             Line((0, 10), (0, 1e-7)), Line((0, 1e-7), (0, 0))])
print("[02] tiny wire:", tiny, tiny.is_closed)
try:
    s = make_face(tiny)
    print("[02] tiny face area:", s.area, len(s.edges()))
except Exception as ex:
    print("[02] tiny face ->", type(ex).__name__, ex)
gap = Wire([Line((0, 0), (10, 0)), Line((10, 0), (10, 10)), Line((10, 10), (0, 10)), Line((0, 10), (0, 1e-5))])
print("[02] gap 1e-5 wire:", gap, gap.is_closed)
gap7 = Wire([Line((0, 0), (10, 0)), Line((10, 0), (10, 10)), Line((10, 10), (0, 10)), Line((0, 10), (0, 1e-7))])
print("[02] gap 1e-7 wire:", gap7, gap7.is_closed)
try:
    s = make_face(gap7)
    print("[02] gap7 face area:", s.area)
except Exception as ex:
    print("[02] gap7 face ->", type(ex).__name__, ex)
