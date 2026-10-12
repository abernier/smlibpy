# rotate: axis, angle, point, direction, errors
bar = Box(10, 2, 2, align=(Align.MIN, Align.CENTER, Align.CENTER))   # x 0..10
r = bar.rotate(Z, 90)
print("[06] rotate(Z,90) bbox:", r.bbox())
print("[06] rotate(Z,-90) bbox:", bar.rotate(Z, -90).bbox())
print("[06] rotate(-Z,90) bbox:", bar.rotate(-Z, 90).bbox())
print("[06] rotate(X,90) of upright bar:", Box(2, 2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).rotate(X, 90).bbox())
print("[06] rotate(Y,90) of upright bar:", Box(2, 2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).rotate(Y, 90).bbox())
# axis through a point
a = Axis((10, 0, 0), (0, 0, 1))
print("[06] about axis at x=10:", bar.rotate(a, 90).bbox())
# default args
print("[06] rotate() no args:", bar.rotate().bbox())
try:
    print("[06] rotate(45):", bar.rotate(45).bbox())
except Exception as e:
    print("[06] rotate(45) ->", type(e).__name__, e)
print("[06] rotate(angle=45) with default axis Z:", bar.rotate(angle=45).bbox())
try:
    print("[06] rotate(90, Z):", bar.rotate(90, Z).bbox())
except Exception as e:
    print("[06] rotate(90, Z) ->", type(e).__name__, e)
# vs Rot
print("[06] Rot(z=90)*bar == rotate(Z,90):", (Rot(z=90) * bar).bbox().min == r.bbox().min, (Rot(z=90) * bar).bbox().max == r.bbox().max)
# on sketches: stays a sketch; plane turns
s = Rectangle(10, 2, align=(Align.MIN, Align.CENTER)).rotate(Z, 90)
print("[06] sketch rotate:", type(s).__name__, s.bbox(), s.plane)
s2 = Rectangle(10, 2).rotate(X, 90)
print("[06] sketch rotate X 90: plane z", s2.plane.z_dir, "extrude bbox", s2.extrude(3).bbox())
# ShapeList.rotate
sl = (GridLocations(10, 1, 2, 1) * Box(1, 1, 1)).rotate(Z, 90)
print("[06] ShapeList rotate:", [x.center() for x in sl])
# angle > 360, fractional
print("[06] rotate 450 == 90:", bar.rotate(Z, 450).bbox().max == r.bbox().max)
# edge, vertex, face rotate
print("[06] vertex rotate:", Vertex(10, 0, 0).rotate(Z, 90))
print("[06] Line rotate:", Line((0, 0), (10, 0)).rotate(Z, 30))
# rotate many times: drift?
x = bar
for i in range(36):
    x = x.rotate(Z, 10)
print("[06] 36x10 deg bbox:", x.bbox(), "valid", x.is_valid(), "vol", x.volume)
c = Cylinder(5, 10).translate(20, 0, 0)
for i in range(36):
    c = c.rotate(Z, 10)
print("[06] cylinder 36x10 center:", c.center(), "valid", c.is_valid())
snapshot("rotate", bar, r, bar.rotate(a, 90), view="top")
