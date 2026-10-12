plate = Box(60, 40, 5)
spots = Locations((-20, 0), (0, 0), (20, 0))          # points, Vectors, Pos, planes, faces, vertices
plate -= spots * Cylinder(2, 10)                      # a ShapeList, cut all at once
print(len(spots), spots.points, len(plate.faces()))

corners = Box(60, 40, 5).vertices().top()           # vertices -> positions
pegs = Locations(*corners) * Sphere(1)               # one copy per top corner
print(len(pegs))                                     # 4 (plate.vertices() would add hole seams)

block = Box(30, 20, 10)
sides = Locations(block.faces().filter_by(lambda f: abs(f.normal_at().z) < 1e-9))
studs = sides * Cylinder(2, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
print([tuple(round(c) for c in s.center()) for s in studs])   # one stud standing out of each side

for loc in GridLocations(10, 10, 2, 1):               # iterate: each item is a Location
    print(loc.position)
marks = (spots * Circle(1)).on(block.faces().top())   # pattern first, then onto the face
print([m.center().z for m in marks])
