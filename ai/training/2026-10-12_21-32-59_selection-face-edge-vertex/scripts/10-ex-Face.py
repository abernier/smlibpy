part = Box(40, 30, 20) - Cylinder(6, 30)
top = part.faces().top().one()
print(top.geom_type, round(top.area, 1))         # plane 1086.9
print(top.normal_at(), top.plane.x_dir)          # Vector(0, 0, 1) Vector(1, 0, 0)
print(len(top.inner_wires()))                    # 1: the hole

hole = part.faces().cylinders().one()
print(hole.radius, hole.axis.direction)          # 6.0 Vector(0, 0, 1)
print(hole.normal_at((6, 0, 0)))                 # Vector(-1, 0, 0): out of the material, into the hole

boss = top.to_sketch().extrude(5)                # same as top.extrude(5): outward, z 10..15
print(round(boss.volume, 3), boss.bbox().min.z)  # 5434.513 10.0
print(round(part.volume, 3))                     # 21738.053
lost = Rectangle(10, 6).on(top).extrude(-4)      # placed at the centroid (0, 0, 10): inside the hole
print(round((part - lost).volume, 3))            # 21738.053: nothing removed
pocket = Rectangle(10, 6).translate(12, 0, 0).on(top).extrude(-4)   # move in face coordinates first
print(round((part - pocket).volume, 3))          # 21498.053: 10 * 6 * 4 removed
