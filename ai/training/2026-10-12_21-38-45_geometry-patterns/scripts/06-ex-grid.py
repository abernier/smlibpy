plate = Box(80, 60, 10)
plate = plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 20)        # through holes, tool longer than 10
print(len(plate.faces().cylinders()), plate.is_valid())

g = GridLocations(20, 10, 3, 2)
print([tuple(p)[:2] for p in g.points])     # x first, then rows in +y; centered on the origin
print(GridLocations(20, 10, 3, 2, centered=False).points[-1])   # Vector(40, 10, 0)

top = plate.faces().top()
plate -= (GridLocations(30, 20, 2, 2) * Hole(2, 6)).on(top)       # blind holes from the top face
print(len(plate.faces().cylinders()), round(plate.volume, 3))

panel = Rectangle(60, 40) - GridLocations(44, 24, 2, 2) * Circle(2.5)   # works for sketches too
print(round(panel.area, 3))
