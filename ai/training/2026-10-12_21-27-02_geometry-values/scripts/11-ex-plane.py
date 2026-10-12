lid = Plane.XY.offset(30)                     # parallel to XY, 30 above
tilted = Plane.XY.rotated(x=30)               # normal (0, -0.5, 0.866)
side = Plane(origin=(10, 0, 5), z_dir=(1, 0, 0))   # x_dir picked: local Y is world +Z
print(lid.origin, tilted.z_dir, side.x_dir, side.y_dir)

rib = Rectangle(10, 20, align=(Align.CENTER, Align.MIN)).on(Plane.front)
print(rib.bbox())                             # x -5..5, z 0..20: stands up

block = Box(30, 20, 10)
top = block.faces().top()[0].plane            # origin (0, 0, 5), normal +Z
print(top.origin, top.x_dir, top.z_dir)
print(top.to_local((5, 3, 5)), top.from_local((5, 3, 0)))
boss = Circle(4).on(top).extrude(6)
print((block + boss).bbox().max.z)            # 11.0
