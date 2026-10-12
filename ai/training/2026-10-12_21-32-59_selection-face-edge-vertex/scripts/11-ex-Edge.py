arc = CenterArc((0, 0, 0), 10, 0, 180)
print(arc.geom_type, round(arc.length, 4))           # circle 31.4159
print(arc.start, arc.end)                            # Vector(10, 0, 0) Vector(-10, 0, 0)
print(arc.point_at(0.5), arc.center(), arc.arc_center)   # (0, 10, 0) (0, 10, 0) (0, 0, 0)
print(arc.radius, arc.normal)                        # 10.0 Vector(0, 0, 1)
print(arc.reversed().start, arc.reversed().tangent_at(0))   # (-10, 0, 0) (0, 1, 0)

a = Line((0, 0, 0), (10, 10, 0))
print(a.intersections(Line((0, 10, 0), (10, 0, 0))))   # [Vector(5, 5, 0)]
try:
    pts = a.intersections(Line((1, 0, 0), (11, 10, 0)))   # parallel: the kernel raises
except KernelError:
    pts = []
print(pts)                                            # []

cyl = Cylinder(5, 10)
print([e.is_seam for e in cyl.edges(seams=True)])    # [True, False, False]
