# Spline tangents=(start, end): directions, magnitude, None, 2-point spline with tangents
pts = [(0, 0), (10, 5), (20, -5), (30, 0)]
for tg in [((1, 0), (1, 0)), ((0, 1), (0, -1)), ((1, 0), None), (None, (0, 1)), ((10, 0), (10, 0)), ((-1, 0), (1, 0))]:
    s = Spline(*pts, tangents=tg)
    print(f"[03] tangents {tg}: t0 {s.tangent_at(0)} t1 {s.tangent_at(1)} len {s.length:.4f} through {max(s.distance_to(p) for p in pts):.1e}")
s = Spline((0, 0), (10, 0), tangents=((0, 1), (0, -1)))
print("[03] two points with tangents:", s.geom_type, "t0", s.tangent_at(0), "t1", s.tangent_at(1), "mid", s.point_at(0.5))
s = Spline((0, 0), (10, 0), tangents=((0, 1), None))
print("[03] two points, start tangent only:", s.geom_type, "t0", s.tangent_at(0), "t1", s.tangent_at(1))
try:
    Spline(*pts, tangents=((0, 0), (1, 0)))
except Exception as ex:
    print("[03] zero tangent ->", type(ex).__name__, ex)
try:
    Spline(*pts, tangents=((1, 0),))
except Exception as ex:
    print("[03] one tangent only ->", type(ex).__name__, ex)
try:
    s = Spline(*pts, tangents=(1, 0))
    print("[03] tangents=(1, 0) ->", s.tangent_at(0), s.tangent_at(1))
except Exception as ex:
    print("[03] tangents=(1, 0) ->", type(ex).__name__, ex)
# smooth join to a line: spline continuing a line
l = Line((-10, 0), (0, 0))
sp = Spline((0, 0), (10, 10), (20, 10), tangents=(l.tangent_at(1), (1, 0)))
print("[03] join angle line->spline:", l.tangent_at(1).angle_to(sp.tangent_at(0)))
snapshot("tangents", Spline(*pts), Spline(*pts, tangents=((0, 1), (0, -1))).translate(0, 20), Spline(*pts, tangents=((-1, 0), (1, 0))).translate(0, 40), view="top")
