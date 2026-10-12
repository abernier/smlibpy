# Geometric queries on a Shell: distance, closest point, intersection curves, projection; Part & Shell?
f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
s = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
print("[05] distance_to (20,15,20):", round(s.distance_to((20, 15, 20)), 4), "expected", 15)
print("[05] closest_point:", s.closest_point((20, 15, 20)))
cyl = Cylinder(5, 40).translate(20, 15, 0)
print("[05] distance shell<->part:", round(s.distance_to(Box(2, 2, 2).translate(20, 15, -10)), 4))
cs = s.intersection_curves(cyl)
print("[05] intersection curves with cylinder:", len(cs), [round(c.length, 3) for c in cs])
pr = s.project(Circle(5).edges()[0].translate(20, 15, 50), (0, 0, -1)) if False else s.project(CenterArc((20, 15, 50), 5, 0, 360), (0, 0, -1))
print("[05] projected circle:", len(pr), [round(e.length, 3) for e in pr], "z at x=25:", round(pr[0].point_at(0).z, 4) if pr else None)
for op in ("&", "-", "+"):
    try:
        r = eval(f"Box(10, 10, 30).translate(20, 15, 0) {op} s")
        print(f"[05] Part {op} Shell:", type(r).__name__, r)
    except Exception as e:
        print(f"[05] Part {op} Shell:", type(e).__name__, e)
