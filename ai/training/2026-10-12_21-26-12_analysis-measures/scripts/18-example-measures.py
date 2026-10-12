part = Box(40, 30, 20) - Cylinder(6, 30)
print(round(part.volume, 4))                    # 21738.0534 = 24000 - pi*36*20

hole = part.faces().filter_by(lambda f: f.geom_type == "cylinder").one()
print(round(hole.area, 4), hole.radius)         # 753.9823 6.0

rim = part.edges().circles().sort_by(Z)[-1]     # top edge of the hole
print(rim.arc_center, rim.radius)               # Vector(0, 0, 10) 6.0
print(rim.center())                             # a point ON the circle, not its center
print(round(rim.length, 6))                     # 37.699112 = 2*pi*6

ring = Circle(10) - Circle(4)
print(round(ring.area, 5), ring.center())       # 263.89379 (about 0, 0, 0)
