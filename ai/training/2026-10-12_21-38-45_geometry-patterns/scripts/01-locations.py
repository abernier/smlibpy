# Locations: inputs, multiplication, iteration
L = Locations((0, 0), (10, 5), (20, 0, 3))
print("[01] repr:", L, "len", len(L), "points:", L.points)
print("[01] items:", list(L))
print("[01] is list:", isinstance(L, list), "L[1]:", L[1])
b = Box(30, 20, 10)
L2 = Locations(Pos(1, 2, 3), Plane.XZ, b.faces().top()[0], b.vertices()[0], Vector(5, 5, 5), [7, 8, 9])
for l in L2:
    print("[01] L2 item:", l)
L3 = Locations(b.faces().filter_by(lambda f: abs(f.center().z) < 1e-9))
print("[01] from ShapeList of 4 side faces:", len(L3), [l.position for l in L3])
print("[01] nested Locations:", len(Locations(L, L)))
# Locations * shape
parts = L * Sphere(1)
print("[01] L*Sphere:", type(parts).__name__, len(parts), [p.center() for p in parts])
print("[01] L*Sketch:", type(L * Circle(1)).__name__)
print("[01] L*[a,b]:", len(L * [Box(1, 1, 1), Sphere(1)]))
print("[01] L*Location:", type(L * Rot(z=45)).__name__, (L * Rot(z=45))[1])
print("[01] Location*L:", type(Pos(0, 0, 10) * L).__name__)
print("[01] Plane*L:", type(Plane.XY.offset(10) * L).__name__)
print("[01] L*L:", len(Locations((0, 0), (100, 0)) * Locations((0, 0), (0, 5), (0, 10))))
try:
    r = (Pos(0, 0, 10) * L) * Box(1, 1, 1)
    print("[01] (Pos*L)*Box:", type(r).__name__, len(r))
except Exception as e:
    print("[01] (Pos*L)*Box ->", type(e).__name__, e)
try:
    r = Pos(0, 0, 10) * L * Box(1, 1, 1)
    print("[01] Pos*L*Box:", type(r).__name__)
except Exception as e:
    print("[01] Pos*L*Box ->", type(e).__name__, e)
try:
    r = Pos(0, 0, 10) * (L * Box(1, 1, 1))
    print("[01] Pos*(L*Box):", type(r).__name__, [x.center() for x in r])
except Exception as e:
    print("[01] Pos*(L*Box) ->", type(e).__name__, e)
try:
    r = Plane.XY.offset(10) * L * Circle(1)
    print("[01] Plane*L*Circle:", type(r).__name__)
except Exception as e:
    print("[01] Plane*L*Circle ->", type(e).__name__, e)
# Locations.on
lo = L.on(b.faces().top())
print("[01] L.on(top):", type(lo).__name__, [l.position for l in lo])
try:
    print("[01] L.on(top)*Circle:", [c.center() for c in L.on(b.faces().top()) * Circle(1)])
except Exception as e:
    print("[01] L.on(top)*Circle ->", type(e).__name__, e)
print("[01] (L*Circle).on(top):", [c.center() for c in (L * Circle(1)).on(b.faces().top())])
print("[01] type Pos*ShapeList:", type(Pos(0, 0, 1) * (L * Circle(1))).__name__)
# cut a list
plate = Box(60, 40, 5)
plate2 = plate - Locations((-20, 0), (0, 0), (20, 0)) * Cylinder(2, 10)
print("[01] plate - 3 holes: faces", len(plate2.faces()), "vol diff", round(plate.volume - plate2.volume, 4), "expected", round(3 * math.pi * 4 * 5, 4))
# iteration
for i, loc in enumerate(Locations((0, 0), (5, 0))):
    print("[01] iter", i, loc.position)
# empty
print("[01] Locations():", Locations(), "* Box:", Locations() * Box(1, 1, 1))
try:
    print("[01] plate - empty list:", (plate - (Locations() * Box(1, 1, 1))).volume)
except Exception as e:
    print("[01] plate - [] ->", type(e).__name__, e)
