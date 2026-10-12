part = Box(40, 30, 20) - Cylinder(6, 30)
print(len(part.faces().parallel_to(Z)))        # 2: top and bottom (normal along Z)
print(len(part.faces().perpendicular_to(Z)))   # 4: the planar side walls
print(len(part.edges().parallel_to(Z)))        # 4: the vertical edges
print(len(part.edges().perpendicular_to(Z)))   # 8: horizontal lines (circles excluded)
print(len(part.faces().parallel_to((0, 0, -1))))   # 2: the sense does not matter
