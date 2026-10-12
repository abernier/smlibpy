dome = Sphere(10)
path = CenterArc((0, 0, 30), 5, 0, 360)               # a circle above the sphere
hits = dome.project(path, (0, 0, -1))
print(len(hits), [round(e.point_at(0.5).z, 4) for e in hits])   # 2 [8.6603, -8.6603]: both sides
top = max(hits, key=lambda e: e.center().z)           # keep the upper one
print(top.geom_type, top.is_closed, round(dome.distance_to(top.point_at(0.3)), 4))   # bspline True 0.0001: a fit, ~1e-4 off

box = Box(20, 20, 20)
pieces = box.project(Line((-30, 0, 30), (30, 0, 30)), (0, 0, -1))
print(len(pieces))                                    # 4: top, bottom and the two side faces
on_top = [e for e in pieces if abs(e.start.z - 10) < 1e-9 and abs(e.end.z - 10) < 1e-9]
print(len(on_top), on_top[0].length)                  # 1 20.0

try:
    dome.project(CenterArc((0, 0, 30), 15, 0, 360), (0, 0, -1))   # misses the sphere
except KernelError as e:
    print(e)                                          # project failed (SM_ERR)
