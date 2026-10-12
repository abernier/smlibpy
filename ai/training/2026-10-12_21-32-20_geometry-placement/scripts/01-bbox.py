# BoundBox: members, bbox of each shape type, tightness
b = Box(30, 20, 10).bbox()
print("[01] min/max:", b.min, b.max, "size:", b.size, "center:", b.center, "diagonal:", b.diagonal)
print("[01] iter:", list(b), "unpack:", *b)
print("[01] contains:", b.contains((15, 10, 5)), b.contains((15.1, 0, 0)), b.contains((15 + 5e-7, 0, 0)))
print("[01] union:", b.union(BoundBox((100, 0, 0), (101, 1, 1))))
print("[01] of_points:", BoundBox.of_points([(0, 0, 0), (1, 5, -2), (3, 1)]))
print("[01] BoundBox((0,0,0),(1,1,1)):", BoundBox((0, 0, 0), (1, 1, 1)))
# attributes mutable?
try:
    b.min = Vector(1, 1, 1)
    print("[01] bbox.min assignable:", b.min)
except Exception as e:
    print("[01] bbox.min assign ->", type(e).__name__, e)
# bbox of each type
p = Cylinder(5, 10)
print("[01] Cylinder bbox:", p.bbox())
print("[01] Sphere bbox:", Sphere(5).bbox())
print("[01] Torus bbox:", Torus(10, 2).bbox())
rp = Cylinder(5, 10).rotate(Axis((0, 0, 0), (1, 1, 0)), 37)
print("[01] rotated cylinder bbox:", rp.bbox())
s45 = Sphere(5).rotate(X, 45)
print("[01] rotated sphere bbox:", s45.bbox())
print("[01] Sketch Circle bbox:", Circle(5).bbox(), "Circle on XZ:", Circle(5).on(Plane.XZ).bbox())
f = p.faces().cylinders()[0]
print("[01] cyl face bbox:", f.bbox())
e = p.edges().circles()[0]
print("[01] body circle edge bbox:", e.bbox())
arc = CenterArc((0, 0), 10, 10, 90)  # 10..100 deg, passes the +Y extreme at 90
print("[01] standalone CenterArc 10..100 bbox:", arc.bbox(), "true max y = 10")
arc2 = CenterArc((0, 0), 10, 0, 360)
print("[01] standalone full circle bbox:", arc2.bbox())
arc3 = CenterArc((0, 0), 10, 5, 170)
print("[01] standalone CenterArc 5..175 bbox max y:", arc3.bbox().max.y, "true 10")
sp = Spline((0, 0), (10, 10), (20, -10), (30, 0))
bb = sp.bbox()
pts = [sp.point_at(i / 2000) for i in range(2001)]
print("[01] standalone spline bbox:", bb, "dense max y:", max(q.y for q in pts), "min y:", min(q.y for q in pts))
w = Polyline((0, 0), (10, 0), (10, 5))
print("[01] wire bbox:", w.bbox())
print("[01] vertex bbox:", Vertex(1, 2, 3).bbox())
sl = ShapeList([Box(1, 1, 1), Box(1, 1, 1).translate(10, 0, 0)])
print("[01] ShapeList bbox:", sl.bbox())
print("[01] list of parts (GridLocations) bbox:", (GridLocations(10, 10, 2, 2) * Box(1, 1, 1)).bbox())
try:
    ShapeList().bbox()
except Exception as e:
    print("[01] empty ShapeList bbox ->", type(e).__name__, e)
try:
    [Box(1, 1, 1)].bbox()
except Exception as e:
    print("[01] python list bbox ->", type(e).__name__, e)
# sketch extrude edge (spline) on a body: tight?
sk = make_face(Polyline((0, 0), (30, 0)) + Spline((30, 0), (20, 15), (0, 0)))
print("[01] spline-sketch bbox:", sk.bbox())
