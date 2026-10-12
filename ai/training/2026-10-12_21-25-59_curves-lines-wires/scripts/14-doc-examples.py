# Doc examples, copied verbatim from the docs listed below

# ---- generic.md block 1
print('==== generic.md block 1')
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
bracket = make_face(outline, bolt_hole).extrude(5)    # volume 5748.67, z 0..5

# ---- generic.md block 2
print('==== generic.md block 2')
profile = make_face(Polyline((-10, -5), (10, -5), (10, 5), (-10, 5), close=True)).on(Plane.XZ)
wall = profile.extrude(5)    # y -5..0, like Rectangle(20, 10).on(Plane.XZ).extrude(5)

# ---- generic.md block 3
print('==== generic.md block 3')
path = FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8)
pipe = sweep(Circle(3), path)    # valid, volume = pi * 3**2 * path.length

# ---- Line.md block 1
print('==== Line.md block 1')
a = Line((0, 0), (30, 40))
b = Line((1, 2, 3), Vector(4, 6, 3))
print(a.length, a.direction, a.point_at(0.25))   # 50.0, (0.6, 0.8, 0), (7.5, 10, 0)
print(Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0))))   # [Vector(5, 5, 0)]

# ---- Polyline.md block 1
print('==== Polyline.md block 1')
outline = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True)
print(len(outline.edges()), outline.is_closed, make_face(outline).area)   # 4 True 200 (to 1e-12)
path = Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30))
pipe = sweep(Circle(3), path)                                              # mitered corner
pts = [(0, 0), (10, 0), (10, 5)]
step = Polyline(*pts)                                                      # unpack a list

# ---- PolarLine.md block 1
print('==== PolarLine.md block 1')
e = PolarLine((0, 0), 10, 30)                      # end (8.66025, 5, 0)
up = PolarLine((0, 0), 10, 90, plane=Plane.XZ)     # end (0, 0, 10)
print(e.end, up.end)

# ---- Wire.md block 1
print('==== Wire.md block 1')
a = Line((0, 0), (10, 0))
b = Line((10, 0), (10, 10))
c = Line((10, 10), (0, 10))
d = Line((0, 10), (0, 0))
sq = Wire([c, a, d, b])            # any order; starts at c.start = (10, 10)
print(sq.is_closed, sq.length)     # True 40.0

w = Wire([Line((0, 0), (10, 0)), CenterArc((10, 5), 5, -90, 180), Line((10, 10), (0, 10))])
print(w.point_at(0.5), w.tangent_at(0.5))   # (15, 5, 0), (0, 1, 0)
region = w.close().to_sketch()              # area 100 + 12.5 * pi

rounded = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(2)
corner = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).fillet(4, vertices=[(20, 0)])
# ---- checks of the claims in the comments above
print("[14] bracket volume", round(bracket.volume, 2), bracket.bbox().min.z, bracket.bbox().max.z)
print("[14] wall bbox", wall.bbox().min, wall.bbox().max, "profile z", profile.plane.z_dir)
print("[14] pipe valid", pipe.is_valid(), round(pipe.volume, 3), "vs", round(math.pi * 9 * path.length, 3))
print("[14] e/up", e.end, up.end)
print("[14] sq start", sq.start, "region area", round(region.area, 5), "expected", round(100 + 12.5 * math.pi, 5))
print("[14] rounded", rounded, "corner", corner, [x.geom_type for x in corner.edges()])
print("[14] step", step)
