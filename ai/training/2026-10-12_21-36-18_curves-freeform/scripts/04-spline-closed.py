# Spline closed=True: smooth at the join? first point repeated? make_face, extrude
pts = [(20, 0), (0, 20), (-20, 0), (0, -20)]
c = Spline(*pts, closed=True)
print("[04] closed:", c, "is_closed", c.is_closed, "len", round(c.length, 6), "circle would be", round(2 * math.pi * 20, 6))
print("[04] join angle t1 vs t0:", c.tangent_at(1).angle_to(c.tangent_at(0)), "t0", c.tangent_at(0))
print("[04] through:", [round(c.distance_to(p), 12) for p in pts])
# curvature continuity at the join: compare second differences near the ends
eps = 1e-4
a0 = (c.point_at(eps) - c.point_at(0)) - (c.point_at(0) - c.point_at(1 - eps))
print("[04] second difference at join (should be ~ same as elsewhere):", a0.length, "elsewhere", ((c.point_at(0.3 + eps) - c.point_at(0.3)) - (c.point_at(0.3) - c.point_at(0.3 - eps))).length)
f = make_face(c)
print("[04] face area", round(f.area, 4), "circle", round(math.pi * 400, 4))
c2 = Spline(*pts, (20, 0), closed=True)
print("[04] first point repeated + closed:", c2.is_closed, round(c2.length, 6))
c3 = Spline(*pts, (20, 0))
print("[04] first point repeated, closed=False:", c3.is_closed, "join angle", round(c3.tangent_at(1).angle_to(c3.tangent_at(0)), 4))
ct = Spline(*pts, closed=True, tangents=((0, 1), (0, 1)))
print("[04] closed with tangents:", ct.tangent_at(0), ct.tangent_at(1))
ct2 = Spline(*pts, closed=True, tangents=((1, 0), (0, 1)))
print("[04] closed with different tangents: t0", ct2.tangent_at(0), "t1", ct2.tangent_at(1), "is_closed", ct2.is_closed)
try:
    c4 = Spline((0, 0), (10, 0), closed=True)
    print("[04] two points closed:", c4, c4.is_closed, c4.length)
except Exception as ex:
    print("[04] two points closed ->", type(ex).__name__, ex)
try:
    c5 = Spline((0, 0), (10, 0), (5, 8), closed=True)
    print("[04] three points closed:", c5.is_closed, round(make_face(c5).area, 4))
except Exception as ex:
    print("[04] three points closed ->", type(ex).__name__, ex)
blob = make_face(Spline((0, 0), (20, -5), (35, 5), (25, 20), (5, 15), closed=True)).extrude(4)
print("[04] blob valid", blob.is_valid(), "volume", round(blob.volume, 3))
snapshot("closed", c, c3.translate(50, 0), view="top")
snapshot("blob", blob, view="iso")
