def rep(tag, fn):
    try:
        s = fn()
        b = s.bbox()
        print(f"[{tag}] {type(s).__name__} area={s.area:.4f} faces={len(s.faces())} plane origin={tuple(round(v,3) for v in s.plane.origin.to_tuple())} z={tuple(round(v,3) for v in s.plane.z_dir.to_tuple())} x={tuple(round(v,3) for v in s.plane.x_dir.to_tuple())} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())}")
        return s
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex}")

part = Box(40, 30, 20) - Cylinder(8, 30)
c = rep("XY", lambda: part.section(Plane.XY))
print("expected", 40*30 - math.pi*64, "inner wires", len(c.faces()[0].inner_wires()))
rep("default plane", lambda: part.section())
rep("function", lambda: section(part, Plane.XY))
rep("XY.offset(5)", lambda: part.section(Plane.XY.offset(5)))
rep("XZ", lambda: part.section(Plane.XZ))
print("expected XZ", 40*20 - 16*20)
rep("tilted", lambda: part.section(Plane(origin=(0, 0, 0), z_dir=(0, 1, 1))))
rep("top face (on the boundary)", lambda: part.section(part.faces().top()))
rep("XY.offset(9.999)", lambda: part.section(Plane.XY.offset(9.999)))
rep("misses", lambda: part.section(Plane.XY.offset(50)))
rep("sphere", lambda: Sphere(10).section(Plane.XY.offset(6)))
print("expected circle r8", math.pi*64)
two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
rep("two solids", lambda: two.section(Plane.XY))
# use: extrude a section back
s = part.section(Plane.XY.offset(5))
e = s.extrude(3)
print("[extrude section] vol", round(e.volume, 4), "z", e.bbox().min.z, e.bbox().max.z)
# section of a rounded part: curve types
r = Box(30, 30, 10).fillet(Box(30, 30, 10).edges().parallel_to(Z), 5)
rs = rep("rounded box", lambda: r.section(Plane.XY))
print("edge types", sorted(set(x.geom_type for x in rs.edges())))
snapshot("section", e, view="top")
