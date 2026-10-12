# 2D Booleans: + - & ^, lists, several pieces, touching, disjoint
a = Rectangle(40, 20)
b = Circle(12).translate(20, 0)
u = a + b; d = a - b; i = a & b; x = a ^ b
A, B = 800, math.pi * 144
print("[02] union:", repr(u), "faces:", len(u.faces()))
print("[02] diff:", repr(d), "faces:", len(d.faces()))
print("[02] inter:", repr(i), "faces:", len(i.faces()))
print("[02] xor:", repr(x), "faces:", len(x.faces()), "check u-i:", round(u.area - i.area, 4))
print("[02] check u = A + B - i:", round(A + B - i.area, 4), round(u.area, 4))
# list on the right
plate = RoundedRectangle(60, 40, 6) - GridLocations(44, 24, 2, 2) * Circle(2.5)
print("[02] list cut:", repr(plate), "inner wires:", len(plate.faces()[0].inner_wires()))
# sum() of sketches
s = sum(PolarLocations(20, 6) * Circle(4))
print("[02] sum of 6 disjoint circles:", repr(s), "faces:", len(s.faces()))
# disjoint union / difference / intersection
far = Circle(5).translate(100, 0)
du = a + far
print("[02] disjoint union faces:", len(du.faces()), "area:", round(du.area, 4))
dd = a - far
print("[02] disjoint diff area:", round(dd.area, 4))
try:
    di = a & far
    print("[02] disjoint inter:", repr(di))
except Exception as e:
    print("[02] disjoint inter raises:", type(e).__name__, e)
# cut into two pieces
two = Rectangle(40, 10) - Rectangle(4, 20)
print("[02] cut in two:", repr(two), "faces:", len(two.faces()), [f.center() for f in two.faces()])
# touching along an edge
t = Rectangle(10, 10) + Rectangle(10, 10).translate(10, 0)
print("[02] touching union:", repr(t), "faces:", len(t.faces()), "edges:", len(t.edges()), "bbox:", t.bbox().min, t.bbox().max)
# touching at a corner
tc = Rectangle(10, 10) + Rectangle(10, 10).translate(10, 10)
print("[02] corner-touch union:", repr(tc), "faces:", len(tc.faces()))
# overlapping circles (docs said 2D booleans reject some)
oc = Circle(10).translate(-5, 0) + Circle(10).translate(5, 0)
print("[02] two circles union:", repr(oc), "faces:", len(oc.faces()), "edges:", len(oc.edges()))
lens = Circle(10).translate(-5, 0) & Circle(10).translate(5, 0)
# lens area: 2 r^2 acos(d/2r) - d/2 sqrt(4r^2-d^2), d=10, r=10
r, dd_ = 10, 10
la = 2 * r * r * math.acos(dd_ / (2 * r)) - dd_ / 2 * math.sqrt(4 * r * r - dd_ * dd_)
print("[02] lens:", repr(lens), "expected:", round(la, 6))
# subtract everything
try:
    e = Rectangle(10, 10) - Rectangle(20, 20)
    print("[02] subtract all:", repr(e), "faces:", len(e.faces()))
except Exception as ex:
    print("[02] subtract all raises:", type(ex).__name__, ex)
# identical
try:
    same = Rectangle(10, 10) - Rectangle(10, 10)
    print("[02] subtract identical:", repr(same))
except Exception as ex:
    print("[02] subtract identical raises:", type(ex).__name__, ex)
snapshot("ops", u, d.translate(0, -40), i.translate(60, 0), x.translate(60, -40), two.translate(0, -80), oc.translate(60, -80), view="top")
