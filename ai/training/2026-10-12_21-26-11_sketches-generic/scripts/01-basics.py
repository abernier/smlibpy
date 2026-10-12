# What is a Sketch: type, repr, plane, area, bbox, center, topology
r = Rectangle(40, 20)
print("[01] type:", type(r).__name__, isinstance(r, Shell), repr(r))
print("[01] plane origin/x/z:", r.plane.origin, r.plane.x_dir, r.plane.z_dir)
print("[01] area:", r.area, "bbox:", r.bbox().min, r.bbox().max)
print("[01] center:", r.center())
print("[01] faces/edges/vertices/wires:", len(r.faces()), len(r.edges()), len(r.vertices()), len(r.wires()))
f = r.faces()[0]
print("[01] face normal:", f.normal_at(), "face.plane z:", f.plane.z_dir, "x:", f.plane.x_dir)
print("[01] info:", r.info())
c = Circle(10)
print("[01] circle area:", c.area, "pi r^2:", math.pi * 100, "diff:", c.area - math.pi * 100)
print("[01] circle edges:", len(c.edges()), [e.geom_type for e in c.edges()], "vertices:", len(c.vertices()))
ring = Circle(10) - Circle(6)
print("[01] ring:", repr(ring), "faces:", len(ring.faces()), "inner wires:", len(ring.faces()[0].inner_wires()),
      "area expected:", math.pi * (100 - 36))
ex = r.extrude(5)
print("[01] extrude bbox:", ex.bbox().min, ex.bbox().max)
snapshot("rect-ring", r, ring.translate(40, 0), view="top")
