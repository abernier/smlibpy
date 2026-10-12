def cyls(p):
    return sorted(tuple(round(c, 3) for c in f.center().to_tuple()) for f in p.faces().cylinders() if f.radius < 5)

flange = Cylinder(30, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
top = flange.faces().top()
bolts = flange - (PolarLocations(22, 6) * Hole(3, 8)).on(top)
print("[05] polar holes:", len(bolts.faces().cylinders()) - 1, "valid:", bolts.is_valid())
print("[05] centers:", cyls(bolts))
print("[05] radii from axis:", sorted({round(math.hypot(c[0], c[1]), 4) for c in cyls(bolts)}))
# on a cylindrical face: no plane
try:
    flange - Hole(2, 5).on(flange.faces().cylinders())
except Exception as e:
    print("[05] on cylinder face:", type(e).__name__, e)
# on a tilted face: the chamfered block
blk = Box(40, 40, 20)
blk = blk.chamfer(blk.edges().top().filter_by(lambda e: e.center().x > 19), 10)
tilted = [f for f in blk.faces().planar() if abs(f.normal_at().x) > 0.1 and abs(f.normal_at().z) > 0.1]
print("[05] tilted faces:", len(tilted), "normal:", tilted[0].normal_at() if tilted else None)
if tilted:
    th = blk - Hole(2, 10).on(tilted[0])
    c = th.faces().cylinders().one()
    print("[05] hole on tilted face axis:", c.axis, "valid:", th.is_valid())
    snapshot("tilted", th, view="iso")
# a hole partly outside the part (on the edge)
edge = Box(60, 40, 10) - (Pos(30, 0) * Hole(3, 10)).on(Box(60, 40, 10).faces().top())
print("[05] hole on the edge: faces", len(edge.faces()), "valid:", edge.is_valid(), "removed:", round(24000 - edge.volume, 3), "half expected:", round(math.pi * 9 * 10 / 2, 3))
# a hole that misses the part
miss = Box(60, 40, 10) - (Pos(100, 0) * Hole(3, 10)).on(Box(60, 40, 10).faces().top())
print("[05] missing hole: volume", round(miss.volume, 3), "faces", len(miss.faces()))
