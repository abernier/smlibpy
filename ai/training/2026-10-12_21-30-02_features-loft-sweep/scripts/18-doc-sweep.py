path = Spline((0, 0, 0), (0, 20, 30), (40, 20, 50))
tube = sweep(Circle(3) - Circle(2), path)               # profile drawn at the origin in XY
print(tube.is_valid(), round(tube.volume, 2), round(math.pi * 5 * path.length, 2))  # True 1314.96 1314.96

spring = sweep(Circle(1), Helix(pitch=5, height=30, radius=10))   # wire diameter 2 < pitch 5

frame = sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)))  # planar path: mitered corner
print(round(frame.volume, 1))                           # 1920.0

bent = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), radius=8))  # rounded corner

ring = sweep(Circle(2), Wire([CenterArc((0, 0), 20, 0, 180), CenterArc((0, 0), 20, 180, 180)]))
print(len(ring.solids()), round(ring.volume, 2))        # 1 1579.14 (a single 360-degree arc gives 2 solids and a negative volume)

# a square thread profile that does not roll: loft through placed copies (8 per turn)
h = Helix(pitch=5, height=10, radius=10)
n = 16
secs = []
for i in range(n + 1):
    p = h.point_at(i / n)
    radial = Vector(p.x, p.y, 0).normalized()
    secs.append(Rectangle(2, 1).on(Plane(origin=p, x_dir=radial, z_dir=h.tangent_at(i / n))))
thread = loft(secs)
print(thread.is_valid(), round(thread.volume, 2))       # True 252.12 = 2 * 1 * helix length
