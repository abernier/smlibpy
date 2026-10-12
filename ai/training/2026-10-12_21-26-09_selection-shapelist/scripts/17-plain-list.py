# Features with a plain list of edges; generator
box = Box(20, 20, 10)
print("[17] plain list:", round(box.fillet(list(box.edges().parallel_to(Z)), 2).volume, 3))
print("[17] tuple:", round(box.fillet(tuple(box.edges().parallel_to(Z)), 2).volume, 3))
print("[17] ShapeList:", round(box.fillet(box.edges().parallel_to(Z), 2).volume, 3))
print("[17] faces().top().edges() == edges().top():", set(box.faces().top().edges()) == set(box.edges().top()))
