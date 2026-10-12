# Spline: through points, default end tangents, 2 points, 3D, list input
pts = [(0, 0), (10, 5), (20, -5), (30, 0)]
s = Spline(*pts)
print("[01]", s, "type", s.geom_type, "len", round(s.length, 6))
print("[01] distance to each point:", [round(s.distance_to(p), 12) for p in pts])
print("[01] t0", s.tangent_at(0), "t1", s.tangent_at(1))
print("[01] point_at(0.5)", s.point_at(0.5))
s2 = Spline((0, 0), (10, 0))
print("[01] two points ->", s2, s2.geom_type)
s3 = Spline((0, 0), (10, 10), (20, 0))
print("[01] three points t0", s3.tangent_at(0), "t1", s3.tangent_at(1), "max y", round(s3.bbox().max.y, 6))
s4 = Spline((0, 0, 0), (10, 0, 10), (20, 10, 20))
print("[01] 3D:", s4, [round(s4.distance_to(p), 12) for p in [(0, 0, 0), (10, 0, 10), (20, 10, 20)]])
s5 = Spline([(0, 0), (10, 5), (20, -5), (30, 0)])
print("[01] one list of 4:", s5)
for args in [[(0, 0), (10, 5), (20, 0)]]:
    try:
        print("[01] one list of 3:", Spline(args))
    except Exception as ex:
        print("[01] one list of 3 ->", type(ex).__name__, ex)
for args in [((0, 0),), ((0, 0), (0, 0)), ((0, 0), (10, 0), (10, 0), (20, 5))]:
    try:
        print("[01]", args, "->", Spline(*args))
    except Exception as ex:
        print("[01]", args, "->", type(ex).__name__, ex)
# uneven spacing: overshoot?
u = Spline((0, 0), (1, 1), (2, 0), (30, 0))
print("[01] uneven spacing bbox", u.bbox().min, u.bbox().max)
data = [s.point_at(i / 50).to_tuple() for i in range(51)]
filewrite(data, "samples")
snapshot("spline", s, u.translate(0, 20), Polyline(*pts), view="top")
