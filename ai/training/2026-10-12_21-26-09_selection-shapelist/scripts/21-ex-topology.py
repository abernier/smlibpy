part = Box(40, 30, 20) - Cylinder(6, 30)
print(len(part.faces()), len(part.edges()), len(part.vertices()))   # 7 14 10

top = part.faces().top().one()
print(top.outer_wire())                  # Wire(4 edges, closed, length=140)
print(top.inner_wires())                 # [Wire(1 edges, closed, length=37.6991)]
print(len(top.edges()), len(top.neighbors()))   # 5 5

e = part.edges().parallel_to(Z).first
print(len(e.faces()), e.vertices())      # 2 [Vertex(20, 15, -10), Vertex(20, 15, 10)]

two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
print(len(two.solids()))                 # 2
