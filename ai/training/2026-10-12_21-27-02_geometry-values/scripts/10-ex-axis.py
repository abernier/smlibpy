pin = Box(2, 2, 2).translate(10, 0, 0)
hinge = Axis((5, 0, 0), (0, 0, 1))          # vertical axis through (5, 0, 0)
print(pin.rotate(hinge, 90).center())       # Vector(5, 5, 0)
print(pin.rotate(Z, 90).center())           # about the world Z axis: Vector(0, 10, 0)

ring = Rectangle(4, 10).translate(12, 0).revolve(Y)   # revolve about the world Y axis
print(round(ring.volume, 2))                          # 3015.93 = 2*pi*12*40

shifted = Pos(0, 0, 5) * Z        # an axis moved by a location
print(shifted, -Z, Z.at((3, 4, 0)))
