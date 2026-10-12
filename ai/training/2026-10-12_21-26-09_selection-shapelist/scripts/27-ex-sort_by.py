part = Box(40, 30, 20) - Cylinder(6, 30) - Cylinder(2, 30).translate(14, 0, 0)
faces = part.faces()
print([round(f.area, 1) for f in faces.sort_by("area")][-2:])   # [1074.3, 1074.3]
print(round(faces.sort_by(Z, reverse=True).first.center().z, 3))  # 10.0
groups = part.edges().group_by(Z)
print([(round(g[0].center().z, 3), len(g)) for g in groups])    # [(-10.0, 6), (0.0, 4), (10.0, 6)]
radii = part.edges().circles().group_by("radius")
print([(round(g[0].radius, 1), len(g)) for g in radii])         # [(2.0, 2), (6.0, 2)]
corner = part.vertices().sort_by_distance((20, 15, 10)).first
print(corner)                                                   # Vertex(20, 15, 10)
