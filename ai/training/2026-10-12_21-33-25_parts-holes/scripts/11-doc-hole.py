part = Box(60, 40, 10)
top = part.faces().top()                                    # select once, before cutting
part -= Hole(3, 6).on(top)                                  # blind, 6 deep, at the face center
part -= (GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top) # through (the box is 10 thick)
part -= (Pos(20, 0) * Hole(1.5, 4)).on(part.faces().front())  # into the front face
print(part.is_valid(), len(part.faces().cylinders()))       # True 6
for f in part.faces().cylinders():
    print(round(f.radius, 2), f.axis.origin, f.axis.direction)

# six bolt holes on a circle of radius 22
flange = Cylinder(30, 8)
bolts = flange - (PolarLocations(22, 6) * Hole(3, 8)).on(flange.faces().top())
print(sorted(round(math.hypot(f.axis.origin.x, f.axis.origin.y), 4) for f in bolts.faces().cylinders()))
