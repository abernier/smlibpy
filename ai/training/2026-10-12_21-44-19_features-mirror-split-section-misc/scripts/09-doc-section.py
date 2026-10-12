part = Box(40, 30, 20) - Cylinder(8, 30)
cut = part.section(Plane.XY)                            # a Sketch on Plane.XY
print(round(cut.area, 3))                               # 998.938 = 40*30 - pi*8^2
side = part.section(Plane.XZ)                           # two pieces left and right of the hole
print(len(side.faces()), round(side.area, 1))           # 2 480.0
slab = part.section(Plane.XY.offset(5)).extrude(3)      # sections are sketches: z 5..8
print(slab.bbox().min.z, slab.bbox().max.z)
try:
    part.section(Plane.XY.offset(50))
except ValueError as e:
    print(e)                                            # the plane does not cut the part
