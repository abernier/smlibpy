part = Box(40, 30, 20) - Cylinder(6, 30)
print(part.faces().largest())                        # Face(plane, area=1086.9, ...) one face
print(len(part.faces().max_by("area")))              # 2: top and bottom tie
print(len(part.edges().min_by("length")))            # 4: the vertical edges (20)
print(part.vertices().at((20, 15, 10)))              # ShapeList([Vertex(20, 15, 10)])
print(len(part.edges().at((20, 15, 10))))            # 3
try:
    part.faces().parallel_to(Z).one()
except ValueError as e:
    print(e)   # expected exactly one shape, got 2 - narrow the selection or use [0]
