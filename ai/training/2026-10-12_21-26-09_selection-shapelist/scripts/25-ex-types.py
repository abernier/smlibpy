p = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3) - Cylinder(3, 20)
print(len(p.faces().planar()), len(p.faces().cylinders()))   # 6 5: 4 fillets + the hole
print(len(p.faces().of_type("plane", "cylinder")))           # 11
print(len(p.edges().circles().top()))                        # 5: 4 fillet arcs + the hole rim
hole_rims = p.edges().circles().filter(lambda e: e.is_closed)
print(len(hole_rims))                                        # 2
print(p.edges().of_type("arc"))                              # ShapeList([]): unknown name, no error
