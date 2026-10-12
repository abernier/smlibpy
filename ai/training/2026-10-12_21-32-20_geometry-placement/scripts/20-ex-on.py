block = Box(40, 30, 20)
top = block.faces().top()
pocket = Rectangle(10, 6).on(top).extrude(-4)              # into the part
side_hole = Hole(3, 8).on(block.faces().front())           # Hole points along -normal: inward
boss = Cylinder(4, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).on(block.faces().right())
part = block - pocket - side_hole + boss
print(part.is_valid(), part.bbox().max.x)                  # True 26.0

off = (Pos(12, 8) * Circle(2)).on(top)                     # 12 along the face x, 8 along its y
print(off.center())                                        # about Vector(12, 8, 10)
studs = (GridLocations(20, 10, 2, 2) * Circle(1)).on(top)  # a pattern on a face
print(len(studs), studs.bbox().size)
lid = Plane.XY.offset(block.bbox().max.z)                  # a fixed plane survives later edits
print(Circle(2).on(lid).center().z)
