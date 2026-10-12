# Doc example: an open box sheet thickened outward, and a sheet trimmed by a solid.
box = Box(20, 20, 20)
cup = stitch([f for f in box.faces() if f.normal_at().z < 0.5])   # 5 faces: an open box
print(type(cup).__name__, len(cup.faces()), cup.area)              # Shell 5 2000.0
print(cup.faces().bottom()[0].normal_at())                        # (0, 0, -1): outward
wall = cup.thicken(-1)                                            # inward: outer size stays 20
print(wall.is_valid(), round(wall.volume, 3), wall.bbox().size)   # True 1844.0 (20, 20, 20)

f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
saddle = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
disc = stitch(Cylinder(8, 30).translate(20, 15, 0) & saddle)     # trim the sheet with a solid
print(type(disc).__name__, round(disc.area, 3))                  # Shell 202.344
