# Equal vertices with different hashes
box = Box(10, 10, 10)
corner = box.vertices().top().right().back().one()
free = Vertex(5, 5, 5)
print("[07] corner == free:", corner == free, " hash equal:", hash(corner) == hash(free), " set size:", len({corner, free}))
print("[07] ShapeList | dedupe:", len(ShapeList([corner]) | ShapeList([free])))
print("[07] _unique via vertices():", len(ShapeList([corner, free]).vertices()))
print("[07] tolerance of equality:", free == Vertex(5, 5, 5 + 5e-7), free == Vertex(5, 5, 5 + 2e-6))
