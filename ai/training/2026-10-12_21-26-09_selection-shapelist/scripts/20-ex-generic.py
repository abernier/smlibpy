part = Box(40, 30, 20) - Cylinder(6, 30)

top = part.faces().top()                     # ShapeList with one face
rim = part.edges().circles().top()           # the hole's top rim
walls = part.edges().parallel_to(Z)          # the four vertical box edges
print(len(top), len(rim), len(walls))        # 1 1 4

part = part.fillet(walls, 3)                 # a ShapeList goes straight into a feature
hole = part.faces().cylinders().filter(lambda f: abs(f.radius - 6) < 1e-6).one()
print(round(hole.radius, 3), part.is_valid())   # 6.0 True

sel = part.edges().circles().top()
print(len(sel))                              # 5: the hole rim and 4 fillet arcs
assert len(sel.filter(lambda e: e.is_closed)) == 1
