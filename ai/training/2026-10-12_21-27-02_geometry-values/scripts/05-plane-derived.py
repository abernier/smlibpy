# Plane: derived planes, coordinates, face planes, placing
def sh(n, p):
    print(f"[05] {n:22s} o {p.origin} x {p.x_dir} y {p.y_dir} z {p.z_dir}")
sh("XY.offset(30)", Plane.XY.offset(30))
sh("XZ.offset(10)", Plane.XZ.offset(10))
sh("XY.shifted(5,0,2)", Plane.XY.shifted(5, 0, 2))
sh("XZ.shifted(5,7,0)", Plane.XZ.shifted(5, 7, 0))
sh("XY.flipped()", Plane.XY.flipped())
sh("XY.rotated(x=30)", Plane.XY.rotated(x=30))
sh("XY.rotated(y=30)", Plane.XY.rotated(y=30))
sh("XY.rotated(z=90)", Plane.XY.rotated(z=90))
sh("XY.rotated(x=90,z=90)", Plane.XY.rotated(x=90, z=90))
sh("XZ.rotated(x=30)", Plane.XZ.rotated(x=30))
sh("XY.offset(5).rotated(x=90)", Plane.XY.offset(5).rotated(x=90))
sh("XY.moved(Rot(x=90))", Plane.XY.moved(Rot(x=90)))
sh("Rot(x=90)*XY", Rot(x=90) * Plane.XY)
sh("XY.at((1,2,3))", Plane.XY.at((1, 2, 3)))
sh("Plane(Pos(1,2,3)*Rot(z=90))", Plane(Pos(1, 2, 3) * Rot(z=90)))
sh("Plane(Plane.XZ)", Plane(Plane.XZ))
p = Plane((10, 0, 0), (0, 1, 0), (1, 0, 0))
print("[05] to_local((10,3,4)):", p.to_local((10, 3, 4)), "from_local((3,4,0)):", p.from_local((3, 4, 0)), "from_local((3,4)):", p.from_local((3, 4)))
print("[05] contains:", p.contains((10, 99, -5)), p.contains((11, 0, 0)), "distance_to:", p.distance_to((13, 0, 0)), p.distance_to((7, 0, 0)))
print("[05] project:", p.project((15, 2, 3)))
print("[05] coplanar:", Plane.XY.is_coplanar(Plane.XY.flipped()), Plane.XY.is_coplanar(Plane.XY.offset(1)), Plane.XY.is_coplanar(Plane.XY.at((5, 5, 0))))
print("[05] eq: XY == XY.flipped():", Plane.XY == Plane.XY.flipped(), "XY==top:", Plane.XY == Plane.top)
loc = Plane.XZ.location
print("[05] XZ.location:", loc, "matrix x col", loc.x_dir, "z col", loc.z_dir)
# face planes of a box
b = Box(30, 20, 10)
for name in ["top", "bottom", "front", "back", "left", "right"]:
    f = getattr(b.faces(), name)()
    pl = f.one().plane
    print(f"[05] box face {name:6s} origin {pl.origin} x {pl.x_dir} y {pl.y_dir} z {pl.z_dir}")
# Plane(face), Plane(ShapeList)
f = b.faces().top()
print("[05] Plane(face):", Plane(f[0]))
try:
    print("[05] Plane(ShapeList):", Plane(f))
except Exception as e:
    print("[05] Plane(ShapeList) ->", type(e).__name__, e)
try:
    print(b.faces().filter_by(lambda q: q.geom_type == "plane")[0].plane)
    print(Cylinder(3, 10).faces().cylinders()[0].plane)
except Exception as e:
    print("[05] cylinder face plane ->", type(e).__name__, e)
# face on an L shape: centroid outside the face?
L = Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 20), (0, 20)).extrude(5)
lf = L.faces().top()[0]
print("[05] L top face plane origin:", lf.plane.origin, "interior point:", lf.interior_point())
# Plane * shape
s = Plane.XY.offset(30) * Circle(5)
print("[05] Plane*Circle:", type(s).__name__, s.bbox(), s.plane)
print("[05] Plane*Location:", Plane.XY.offset(30) * Pos(1, 0, 0))
print("[05] Plane*list:", Plane.XY.offset(30) * [Circle(1), Circle(2)])
print("[05] Plane*Vector:", Plane.XY.offset(30) * Vector(1, 2, 3))
# local vs world for a sketch drawn on a tilted plane
tilt = Plane.XY.rotated(x=30)
sk = (Pos(10, 0) * Circle(2)).on(tilt)
print("[05] Pos(10,0)*Circle on tilted: center", sk.center(), "local:", tilt.to_local(sk.center()))
sk2 = (Pos(0, 10) * Circle(2)).on(tilt)
print("[05] Pos(0,10)*Circle on tilted: center", sk2.center(), "local:", tilt.to_local(sk2.center()))
pr = sk2.extrude(5)
print("[05] extrude on tilted: center", pr.center(), "expected", tilt.from_local((0, 10, 2.5)))
