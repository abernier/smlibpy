# what selection finds on a non-uniformly scaled cylinder
o = Cylinder(5, 10).scale((2, 1, 1))
print("[22] cylinders():", len(o.faces().cylinders()), "circles():", len(o.edges().circles()), "planar faces:", len(o.faces().planar()))
try:
    print("[22] radius:", o.faces().sort_by("area")[-1].radius)
except Exception as e:
    print("[22] radius ->", type(e).__name__, e)
u = Cylinder(5, 10).scale(2)
print("[22] uniform: cylinders", len(u.faces().cylinders()), "radius", u.faces().cylinders()[0].radius, "circles", len(u.edges().circles()))
top = o.faces().top()
print("[22] scaled cyl top face:", top, "is_planar", top[0].is_planar)
try:
    print("[22] on(top of scaled cyl):", Circle(1).on(top).center())
except Exception as e:
    print("[22] on(top of scaled cyl) ->", type(e).__name__, e)
bx = Box(10, 10, 10).scale((2, 1, 1))
print("[22] scaled box face types:", sorted({f.geom_type for f in bx.faces()}), "planar", len(bx.faces().planar()))
