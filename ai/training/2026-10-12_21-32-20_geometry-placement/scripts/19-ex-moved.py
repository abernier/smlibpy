arm = Box(4, 2, 2).translate(10, 0, 0)
place = Pos(0, 0, 5) * Rot(z=90)
print(arm.moved(place).center(), (place * arm).center())   # same: Vector(0, 10, 5)
print(arm.moved(Pos(1, 0, 0)).moved(Pos(1, 0, 0)).center())   # relative: Vector(12, 0, 0)

c = arm.center()
at_target = arm.moved(Pos(-c)).moved(Pos(0, 50, 0))   # "absolute": center to (0, 50, 0)
print(at_target.center())

A, B = Pos(10, 0, 0), Rot(z=90)
print(arm.moved(A).moved(B).center(), arm.moved(B * A).center())   # equal
