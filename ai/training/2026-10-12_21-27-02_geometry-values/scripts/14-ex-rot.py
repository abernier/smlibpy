bar = Box(10, 2, 2)
print((Rot(z=90) * bar).bbox().size)          # Vector(2, 10, 2)
print(Rot(10, 20, 30) == Rot(z=30) * Rot(y=20) * Rot(x=10))   # True: X, then Y, then Z
print(Rot(z=90) * Vector(1, 0, 0))            # Vector(0, 1, 0): counterclockwise seen from +Z

off = Box(2, 2, 2).translate(10, 0, 0)
print((Rot(z=90) * off).center())             # about the origin: Vector(0, 10, 0)
p = Vector(10, 0, 0)
print((Pos(p) * Rot(z=90) * Pos(-p) * off).center())   # about its own center: Vector(10, 0, 0)

lying = Rot(y=90) * Cylinder(3, 20)           # axis along X now
print(lying.bbox().size)                      # Vector(20, 6, 6)
