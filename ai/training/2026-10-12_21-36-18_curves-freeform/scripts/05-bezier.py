# Bezier: control points (not interpolated), degree, weights (rational), errors
b = Bezier((0, 0), (10, 20), (20, 0))
print("[05] quadratic:", b, b.geom_type, "mid", b.point_at(0.5), "dist to ctrl pt", round(b.distance_to((10, 20)), 6))
print("[05] t0", b.tangent_at(0), "t1", b.tangent_at(1), "expected dir to (10,20)", Vector(10, 20, 0).normalized())
# point at parameter 0.5 of the Bezier is (10, 10); point_at uses arc length
print("[05] point_at(0.5) by arc length:", b.point_at(0.5))
cub = Bezier((0, 0), (0, 10), (20, 10), (20, 0))
print("[05] cubic: max y", max(cub.point_at(i / 200).y for i in range(201)), "expected 7.5")
lin = Bezier((0, 0), (10, 0))
print("[05] two points:", lin, lin.geom_type)
# rational quadratic with w = cos(45 deg) is an exact quarter circle
w = math.sqrt(2) / 2
q = Bezier((10, 0), (10, 10), (0, 10), weights=[1, w, 1])
dev = max(abs(q.point_at(i / 50).length - 10) for i in range(51))
print("[05] rational quarter circle:", q.geom_type, "max radius deviation", dev, "len", q.length, "expected", 5 * math.pi)
for ww in ([1, 5, 1], [1, 0.2, 1]):
    e = Bezier((10, 0), (10, 10), (0, 10), weights=ww)
    print(f"[05] weights {ww}: mid {e.point_at(0.5)}")
for args, kw in [(((0, 0), (10, 10), (20, 0)), {"weights": [1, 1]}), (((0, 0), (10, 10), (20, 0)), {"weights": [1, 0, 1]}),
                 (((0, 0), (10, 10), (20, 0)), {"weights": [1, -1, 1]}), (((0, 0),), {}), (((0, 0), (0, 0)), {}),
                 (((0, 0), (5, 5), (0, 0)), {})]:
    try:
        e = Bezier(*args, **kw)
        print("[05]", args, kw, "->", e, "len", round(e.length, 6))
    except Exception as ex:
        print("[05]", args, kw, "->", type(ex).__name__, str(ex).splitlines()[0])
high = Bezier(*[(i, (-1) ** i * 5) for i in range(12)])
print("[05] degree 11:", high.geom_type, round(high.length, 4))
try:
    h2 = Bezier(*[(i, (-1) ** i * 5) for i in range(30)])
    print("[05] degree 29:", h2.geom_type, round(h2.length, 4))
except Exception as ex:
    print("[05] degree 29 ->", type(ex).__name__, str(ex).splitlines()[0])
b3 = Bezier((0, 0, 0), (0, 0, 10), (10, 0, 10), (10, 10, 20))
print("[05] 3D:", b3)
snapshot("bezier", b, Polyline((0, 0), (10, 20), (20, 0)), cub.translate(30, 0), Polyline((0, 0), (0, 10), (20, 10), (20, 0)).translate(30, 0), view="top")
