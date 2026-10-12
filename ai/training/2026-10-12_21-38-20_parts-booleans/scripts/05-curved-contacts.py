import time
def rep(name, f):
    t = time.time()
    try:
        p = f()
        print(f"[05] {name}: faces {len(p.faces())}, vol {round(p.volume, 4)}, valid {p.is_valid()}, solids {len(p.solids()) if len(p.faces()) else 0}, {time.time()-t:.2f}s")
    except Exception as e:
        print(f"[05] {name}: {type(e).__name__}: {e} | status={getattr(e, 'status', None)}")

c = Cylinder(5, 20)
rep("coaxial same radius, overlapping (fuse)", lambda: c + Cylinder(5, 20).translate(0, 0, 10))
rep("coaxial same radius, overlapping (cut)", lambda: c - Cylinder(5, 20).translate(0, 0, 10))
rep("coaxial same radius, overlapping (intersect)", lambda: c & Cylinder(5, 20).translate(0, 0, 10))
rep("parallel cylinders externally tangent (fuse)", lambda: c + Cylinder(5, 20).translate(10, 0, 0))
rep("parallel cylinders internally tangent (cut)", lambda: Cylinder(10, 20) - Cylinder(5, 30).translate(5, 0, 0))
rep("cross cylinders same radius (fuse, T joint)", lambda: c + Cylinder(5, 30).rotate(Y, 90))
rep("cross cylinders same radius (cut)", lambda: c - Cylinder(5, 30).rotate(Y, 90))
rep("sphere tangent to box top (fuse)", lambda: Box(20, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)) + Sphere(5).translate(0, 0, 5))
rep("sphere tangent to box top (cut)", lambda: Box(20, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)) - Sphere(5).translate(0, 0, -5 + 10))
rep("sphere center on box face (cut)", lambda: Box(20, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)) - Sphere(5))
rep("cylinder tangent to box side (cut)", lambda: Box(20, 20, 10) - Cylinder(5, 20).translate(15, 0, 0))
rep("cylinder axis on box edge (cut)", lambda: Box(20, 20, 10) - Cylinder(5, 20).translate(10, 10, 0))
rep("torus through box (cut)", lambda: Box(50, 50, 4) - Torus(20, 4))
rep("cone apex on face (fuse)", lambda: Box(20, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)) + Cone(5, 0, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)))
