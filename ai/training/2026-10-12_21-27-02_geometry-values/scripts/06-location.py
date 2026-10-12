# Location, Pos, Rot: construction, order, inverse, application
print("[06] Location():", Location())
print("[06] Location((1,2,3)):", Location((1, 2, 3)))
print("[06] Location((1,2,3),(0,0,90)):", Location((1, 2, 3), (0, 0, 90)))
print("[06] Location(Plane.XZ):", Location(Plane.XZ))
print("[06] Location(4x4):", Location(np.eye(4)))
L = Location((1, 2, 3), (10, 20, 30))
print("[06] position:", L.position, "rotation:", L.rotation)
print("[06] x/y/z_dir:", L.x_dir, L.y_dir, L.z_dir)
print("[06] plane:", L.plane)
print("[06] matrix:\n", np.round(L.matrix, 4))
# Pos variants
print("[06] Pos(10):", Pos(10), "Pos(10,5):", Pos(10, 5), "Pos((1,2,3)):", Pos((1, 2, 3)), "Pos(Vector):", Pos(Vector(4, 5, 6)), "Pos(z=5):", Pos(z=5), "Pos((1,2)):", Pos((1, 2)))
# Rot variants
print("[06] Rot(z=90):", Rot(z=90), "Rot(90):", Rot(90), "Rot((10,20,30)):", Rot((10, 20, 30)))
# Rot order: Rot(x=90, z=90) applied to X axis point
p = Vector(1, 0, 0)
print("[06] Rot(x=90,z=90)*(1,0,0):", Rot(x=90, z=90) * p, " Rot(z=90)*Rot(x=90)*p:", Rot(z=90) * (Rot(x=90) * p), " Rot(x=90)*Rot(z=90)*p:", Rot(x=90) * (Rot(z=90) * p))
q = Vector(0, 1, 0)
print("[06] Rot(x=90,z=90)*(0,1,0):", Rot(x=90, z=90) * q, " Rz*Rx:", Rot(z=90) * Rot(x=90) * q, " Rx*Rz:", Rot(x=90) * Rot(z=90) * q)
print("[06] Rot(x=90,z=90) == Rot(z=90)*Rot(x=90):", Rot(x=90, z=90) == Rot(z=90) * Rot(x=90))
print("[06] Rot(x,y,z) == Rz*Ry*Rx:", Rot(10, 20, 30) == Rot(z=30) * Rot(y=20) * Rot(x=10))
# positive direction: right hand
print("[06] Rot(z=90)*(1,0,0):", Rot(z=90) * Vector(1, 0, 0), "Rot(x=90)*(0,1,0):", Rot(x=90) * Vector(0, 1, 0), "Rot(y=90)*(0,0,1):", Rot(y=90) * Vector(0, 0, 1))
# multiplication order Pos*Rot vs Rot*Pos
b = Box(4, 2, 2)
a1 = Pos(10, 0, 0) * Rot(z=90) * b
a2 = Rot(z=90) * Pos(10, 0, 0) * b
print("[06] Pos*Rot*box center:", a1.center(), "size", a1.bbox().size)
print("[06] Rot*Pos*box center:", a2.center(), "size", a2.bbox().size)
# Rot rotates about the world origin, not the shape center
c = Box(2, 2, 2).translate(10, 0, 0)
print("[06] Rot(z=90)*box@(10,0,0) center:", (Rot(z=90) * c).center())
# about a point: Location.about
print("[06] Location.about(Axis((10,0,0),Z dir), 90)*box@10:", (Location.about(Axis((10, 0, 0), (0, 0, 1)), 90) * c).center())
print("[06] Pos(p)*Rot*Pos(-p):", (Pos(10, 0, 0) * Rot(z=90) * Pos(-10, 0, 0) * c).center())
# inverse
I = L.inverse()
print("[06] L*L.inverse()==Location():", L * I == Location(), " I*L:", I * L == Location())
print("[06] inverse undoes move:", (I * (L * c)).center())
# Location * Vector applies translation; rotate_vector does not
print("[06] Pos(5,0,0)*Vector(1,0,0):", Pos(5, 0, 0) * Vector(1, 0, 0), "rotate_vector:", Pos(5, 0, 0).rotate_vector((1, 0, 0)))
print("[06] Location * tuple:", Pos(5, 0, 0) * (1, 2), Pos(5, 0, 0) * (1, 2, 3))
# location equality, hash
print("[06] eq:", Pos(1, 0, 0) == Location((1, 0, 0)), "hash eq:", hash(Pos(1, 0, 0)) == hash(Location((1, 0, 0))))
# rotation property round trip, gimbal case
for r in [(10, 20, 30), (0, 90, 0), (90, 90, 0), (0, 0, 200)]:
    print("[06] Rot", r, "-> rotation", Rot(*r).rotation, "roundtrip ok:", Rot(*r) == Rot(*Rot(*r).rotation))
# location applied to Plane and Axis
print("[06] Pos(0,0,5)*Plane.XY:", Pos(0, 0, 5) * Plane.XY)
# moved vs *
print("[06] moved == *:", (b.moved(L)).center(), (L * b).center())
# non-numbers
try:
    Pos("a")
except Exception as e:
    print("[06] Pos('a') ->", type(e).__name__, e)
try:
    Rot(x=90) * "abc"
except Exception as e:
    print("[06] Rot*str ->", type(e).__name__, e)
# chaining with sketches
s = Pos(10, 0) * Rot(z=45) * Rectangle(4, 2)
print("[06] sketch Pos*Rot center", s.center(), "plane", s.plane)
