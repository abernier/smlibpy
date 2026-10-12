# Remaining Edge claims
sp = Spline((0, 0, 0), (10, 0, 0), (5, 8, 0), closed=True)
print("[09] closed spline is_closed:", sp.is_closed, " vertices:", len(sp.vertices()))
box = Box(20, 20, 10)
c = box.chamfer(box.edges().parallel_to(Z), 2)
e = c.edges().of_type("bspline").filter(lambda e: abs(e.center().z) < 1e-6).first
print("[09] bspline straight edge:", e.geom_type, (e.end - e.start).normalized())
try:
    e.direction
except ValueError as ex:
    print("[09] direction:", ex)
