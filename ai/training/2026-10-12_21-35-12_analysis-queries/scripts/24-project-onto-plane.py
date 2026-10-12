floor = Rectangle(100, 100)                 # a sketch larger than the curve stands in for Plane.XY
coil = Helix(5, 20, 10)                     # 4 turns, z = 0..20
flat = floor.project(coil, (0, 0, -1))
print(len(flat), round(sum(e.length for e in flat), 4))   # 1 251.3194 (4 circles: 251.3274)
print(max(abs(e.point_at(t).z) for e in flat for t in (0, 0.5, 1)) < 1e-9)   # True: in the plane
