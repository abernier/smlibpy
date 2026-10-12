# Can an elliptical arc be made sweepable by converting it to a B-spline?
e = EllipticalArc((0, 0), 30, 20, 0, 90)
b = e.mirror(Plane.XZ).mirror(Plane.XZ)
print("[13] converted:", b.geom_type, b.start, b.end, round(b.length, 6), "max dev", max(b.distance_to(e.point_at(i / 20)) for i in range(21)))
s = sweep(Circle(2), b)
print("[13] sweep valid", s.is_valid(), "volume", round(s.volume, 4), "expected ~", round(math.pi * 4 * e.length, 4))
