# Realistic outlines with arcs: a D-shaped plate, a lens, a keyhole
# D: flat bottom, a half circle on top drawn with RadiusArc (radius = half the chord)
d = Wire([Line((-20, 0), (20, 0)), RadiusArc((20, 0), (-20, 0), 20)])
print("[09] D wire:", d, "mid of arc", d.edges()[1].point_at(0.5))
dp = make_face(d).extrude(5)
print("[09] D plate volume", round(dp.volume, 4), "expected", round(math.pi * 400 / 2 * 5, 4), "valid", dp.is_valid())
# lens: two sagitta arcs over the same chord
lens = Wire([SagittaArc((-10, 0), (10, 0), -3), SagittaArc((10, 0), (-10, 0), -3)])
ls = make_face(lens)
r = (9 + 100) / 6
seg = r * r * math.acos((r - 3) / r) - (r - 3) * math.sqrt(2 * r * 3 - 9)
print("[09] lens area", round(ls.area, 5), "expected", round(2 * seg, 5), "bbox", ls.bbox().min, ls.bbox().max)
# keyhole: circle of r 6 around the origin, slot 4 wide going down to y=-20
ang = math.degrees(math.asin(2 / 6))
top = CenterArc((0, 0), 6, -90 + ang, 360 - 2 * ang)
key = Wire([top, Line(top.end, (-2, -20)), Line((-2, -20), (2, -20)), Line((2, -20), top.start)])
print("[09] keyhole closed", key.is_closed, "top start", top.start, "end", top.end)
kp = (Rectangle(40, 50).extrude(4) - make_face(key).extrude(4))
print("[09] keyhole plate valid", kp.is_valid(), "volume", round(kp.volume, 4))
snapshot("outlines", dp, kp.translate(50, 0, 0), view="top")
