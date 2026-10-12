part = Box(60, 40, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Cylinder(8, 25)
bb = part.bbox()
print(bb.min, bb.max)                 # Vector(-30, -20, -12.5) Vector(30, 20, 12.5)
print(bb.size, bb.center, round(bb.diagonal, 3))
lo, hi = bb                           # unpacks into min and max
print(bb.contains((0, 0, 12)), bb.contains((31, 0, 0)))

holes = PolarLocations(20, 6) * Cylinder(2, 5)
print(holes.bbox().size)              # bbox of a ShapeList: union of the members
print(part.faces().top()[0].bbox())   # faces and edges have one too
height = part.bbox().size.z           # 25.0: the cylinder reaches below the plate
