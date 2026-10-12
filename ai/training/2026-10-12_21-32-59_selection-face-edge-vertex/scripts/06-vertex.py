# Vertex: point, x/y/z, construction, equality, use in selections
v = Vertex(1, 2, 3)
print("[06] Vertex(1,2,3):", v, v.point, v.x, v.y, v.z, type(v.point).__name__)
print("[06] Vertex((1,2,3)):", Vertex((1, 2, 3)), " Vertex(Vector):", Vertex(Vector(1, 2, 3)), " Vertex():", Vertex())
print("[06] Vertex(1,2):", Vertex(1, 2))
try:
    print("[06] Vertex((1,2)):", Vertex((1, 2)))
except Exception as ex:
    print("[06] Vertex((1,2)):", type(ex).__name__, ex)
print("[06] unpack:", tuple(v), " center:", v.center(), " bbox:", v.bbox())
print("[06] == another Vertex(1,2,3):", v == Vertex(1, 2, 3), " near (1e-9):", v == Vertex(1, 2, 3 + 1e-9), " far 1e-3:", v == Vertex(1, 2, 3.001))
box = Box(10, 10, 10)
corner = box.vertices().top().right().back().one()
print("[06] part corner:", corner, " == Vertex(5,5,5):", corner == Vertex(5, 5, 5), " Vertex(5,5,5) == corner:", Vertex(5, 5, 5) == corner)
print("[06] Vertex in part.vertices():", Vertex(5, 5, 5) in box.vertices())
print("[06] corner edges/faces:", len(corner.edges()), len(corner.faces()))
print("[06] distance_to point:", corner.distance_to((0, 0, 0)), " to Part:", Vertex(20, 5, 5).distance_to(box))
print("[06] translate:", corner.translate(1, 0, 0), type(corner.translate(1, 0, 0)).__name__, " edges after move:", corner.translate(1, 0, 0).edges())
print("[06] vertices sorted by x then nearest:", box.vertices().nearest((100, 100, 100)))
print("[06] vertex coordinates of a part:", sorted({tuple(round(c, 3) for c in vv) for vv in box.vertices()}))
print("[06] hash set dedupe:", len({corner, box.vertices().top().right().back().one()}))
print("[06] vertex as point argument:", Line(corner, Vertex(0, 0, 0)).length if True else None)
try:
    print("[06] Pos * vertex:", Pos(1, 0, 0) * corner)
except Exception as ex:
    print("[06] Pos * vertex:", type(ex).__name__, ex)
# fillet a sketch at a selected vertex
sk = Rectangle(20, 10)
r = sk.fillet(2, sk.vertices().right())
print("[06] sketch fillet at right vertices:", round(r.area, 4), " (200 - 2*(4-pi) =", round(200 - 2 * (4 - math.pi), 4), ")")
print("[06] sphere vertices:", Sphere(5).vertices(), " cylinder vertices:", Cylinder(5, 10).vertices())
