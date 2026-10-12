# Which points are joined: same parameter or same arc-length fraction?
# Line vs an unevenly parameterized spline: test whether the straight segment between the
# arc-length midpoints lies on the surface.
a = Line((0, 0, 0), (20, 0, 0))
b = Spline((0, 10, 0), (2, 10, 3), (4, 10, 0), (20, 10, 0))   # wiggle at the start, long flat end
s = ruled(a, b)
for t in (0.25, 0.5, 0.75):
    pa, pb = a.point_at(t), b.point_at(t)
    mid = (pa + pb) * 0.5
    print(f"[02] t={t}: arc-length segment midpoint {mid} distance to surface {s.distance_to(mid):.4f}")
# Line vs a line of different length: same fraction?
c = Line((0, 10, 0), (40, 10, 0))
s2 = ruled(a, c)
print("[02] lines 20 vs 40: area", round(s2.area, 3), "trapezoid", (20 + 40) / 2 * 10)
for t in (0.25, 0.5):
    mid = (a.point_at(t) + c.point_at(t)) * 0.5
    print(f"[02]   t={t}: midpoint {mid} distance {s2.distance_to(mid):.4f}")
# Line vs a circular arc: half circle above a diameter line
arc = CenterArc((10, 0, 0), 10, 180, -180)  # from (0,0) over the top to (20,0)
print("[02] arc start/end", arc.start, arc.end)
line = Line((0, 0, 10), (20, 0, 10))
s3 = ruled(arc, line)
for t in (0.25, 0.5):
    mid = (arc.point_at(t) + line.point_at(t)) * 0.5
    print(f"[02]   arc t={t}: arc-len midpoint dist {s3.distance_to(mid):.4f}")
snapshot("matching", s, s3.translate(0, 30, 0))
