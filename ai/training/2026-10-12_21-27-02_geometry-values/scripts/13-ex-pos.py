peg = Cylinder(3, 10)
a = Pos(10, 0, 5) * peg                  # same as peg.translate(10, 0, 5)
b = Pos((10, 0, 5)) * peg                # tuple or Vector
c = Pos(z=5) * peg                       # keywords
print(a.center(), b.center(), c.center())

dots = Pos(15, 0) * Circle(2)            # sketches too (z = 0)
arm = Pos(20, 0, 0) * Rot(z=30) * Box(10, 2, 2)   # rotated in place, then moved
print(dots.center(), arm.center())
print([p.center() for p in Pos(0, 0, 10) * [peg, Box(2, 2, 2)]])
