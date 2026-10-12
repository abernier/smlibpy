peg = Cylinder(3, 10)
a = peg.translate(10, 0, 5)
b = peg.translate((10, 0, 5))         # tuple, list, numpy array or Vector
c = peg.translate(z=5)                # keywords; missing ones are 0
print(a.center(), c.center())

slot = Rectangle(20, 6).translate(0, 12)          # sketches keep their plane, moved
print(slot.plane.origin)
lid = Rectangle(30, 20).translate(0, 0, 40).extrude(3)   # sketch lifted to z = 40, then extruded
print(lid.bbox().min.z, lid.bbox().max.z)         # 40.0 43.0

row = (GridLocations(10, 10, 3, 1) * Box(4, 4, 4)).translate(0, 0, 20)   # a ShapeList
print([s.center().z for s in row])
