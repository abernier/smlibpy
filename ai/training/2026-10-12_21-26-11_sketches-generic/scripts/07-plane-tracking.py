# What is sketch.plane after align, Booleans, mirror, scale, section? Does it matter?
r = Rectangle(20, 10, align=Align.MIN)
print("[07] align MIN plane origin:", r.plane.origin)
u = Circle(3).translate(50, 0) + r
print("[07] (circle at 50) + rect plane origin:", u.plane.origin, "(left operand wins)")
# revolve default axis = plane origin + local Y: differs with align
rv = Rectangle(10, 20, align=Align.MIN).translate(10, 0).revolve()
print("[07] revolve default (rect x 10..20, plane origin x=", Rectangle(10, 20, align=Align.MIN).translate(10, 0).plane.origin.x, "):", repr(rv), "bbox:", rv.bbox().min, rv.bbox().max)
rv2 = Rectangle(10, 20, align=Align.MIN).translate(10, 0).revolve(Axis((0, 0, 0), (0, 1, 0)))
print("[07] revolve about world Y:", round(rv2.volume, 3), "expected:", round(math.pi * (400 - 100) * 20, 3))
# mirror flips the normal
m = Rectangle(20, 10, align=Align.MIN).mirror(Plane.XZ)
print("[07] mirror plane z:", m.plane.z_dir, "face normal:", m.faces()[0].normal_at())
me = m.extrude(5)
print("[07] mirrored extrude(5) bbox:", me.bbox().min, me.bbox().max, "valid:", me.is_valid(), "vol:", round(me.volume, 3))
both = Rectangle(20, 10, align=Align.MIN) + m
print("[07] r + mirror:", repr(both), "plane z:", both.plane.z_dir, "extrude bbox:", both.extrude(5).bbox().min, both.extrude(5).bbox().max)
both2 = m + Rectangle(20, 10, align=Align.MIN)
print("[07] mirror + r: plane z:", both2.plane.z_dir, "extrude bbox:", both2.extrude(5).bbox().min, both2.extrude(5).bbox().max)
# scale
sc = Rectangle(20, 10).scale(2)
print("[07] scale 2:", repr(sc), "bbox:", sc.bbox().min, sc.bbox().max, "plane:", sc.plane.x_dir, sc.plane.z_dir)
sc2 = Circle(10).scale((2, 1, 1))
print("[07] scale (2,1,1) circle:", repr(sc2), "expected ellipse area:", round(math.pi * 200, 3), "edges:", [e.geom_type for e in sc2.edges()])
# section is a sketch
sec = Cylinder(10, 20).section(Plane.XY.offset(3))
print("[07] section:", type(sec).__name__, repr(sec), "plane:", sec.plane.origin, sec.plane.z_dir)
# sketch face plane
print("[07] sketch face plane x/z:", r.faces()[0].plane.x_dir, r.faces()[0].plane.z_dir, "origin:", r.faces()[0].plane.origin)
snapshot("mirror", me, Rectangle(20, 10, align=Align.MIN).extrude(5), view="front")
