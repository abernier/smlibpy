def cyls(p):
    return sorted(tuple(round(c, 3) for c in f.center().to_tuple()) for f in p.faces().cylinders())

part = Box(60, 40, 10)
part -= (Pos(20, 0) * Hole(5, 10)).on(part.faces().top())
top = part.faces().top().one()
print("[04] after one hole, top face center:", top.center(), "plane origin:", top.plane.origin)
p2 = part - (Pos(-20, 0) * Hole(2, 10)).on(part.faces().top())
print("[04] second hole meant at x=-20, holes at:", cyls(p2))
# robust: place on a fixed plane instead of the face
p3 = part - (Pos(-20, 0) * Hole(2, 10)).on(Plane.XY.offset(5))
print("[04] on Plane.XY.offset(5):", cyls(p3))
# or: one pattern for all holes at once on the original top face
blank = Box(60, 40, 10)
p4 = blank - (Locations((20, 0), (-20, 0)) * Hole(2, 10)).on(blank.faces().top())
print("[04] Locations on the fresh top:", cyls(p4))
# a pocket shifts the centroid too
pk = Box(60, 40, 10)
pk -= Box(20, 40, 4, align=(Align.MIN, Align.CENTER, Align.MAX)).translate(10, 0, 5)
print("[04] after a pocket, top faces:", [(tuple(round(c, 3) for c in f.center().to_tuple())) for f in pk.faces().top()])
try:
    pk - Hole(2, 10).on(pk.faces().facing(Z))
except Exception as e:
    print("[04] on() with 2 faces:", type(e).__name__, e)
