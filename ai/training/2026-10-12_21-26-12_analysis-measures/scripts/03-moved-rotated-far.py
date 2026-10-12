# Same bodies moved, rotated and far from the origin: volume, area, center error.
pi = math.pi
bodies = {
    "box": (Box(40, 30, 20), 24000.0),
    "cylinder": (Cylinder(6, 20), pi*36*20),
    "sphere": (Sphere(10), 4/3*pi*1000),
    "torus": (Torus(20, 5), 2*pi**2*20*25),
    "cone": (Cone(10, 0, 30), pi*100*30/3),
}
placements = {
    "rot x30": lambda p: p.rotate(X, 30),
    "rot axis(1,2,3) 37": lambda p: p.rotate(Axis((0, 0, 0), (1, 2, 3)), 37),
    "at 1000,2000,3000": lambda p: p.translate(1000, 2000, 3000),
    "rot+far 1e4": lambda p: p.rotate(Axis((0, 0, 0), (1, 2, 3)), 37).translate(1e4, -2e4, 3e4),
    "far 1e6": lambda p: p.translate(1e6, 0, 0),
}
for bn, (b, v) in bodies.items():
    c0 = b.center()
    for pn, f in placements.items():
        q = f(b)
        # expected center: transform c0 the same way
        ce = f(Box(1, 1, 1).translate(c0)).center()
        c = q.center()
        print(f"[03] {bn} {pn}: relV={(q.volume-v)/v:+.2e} relA={(q.area-b.area)/b.area:+.2e} dC={(c-ce).length:.2e} valid={q.is_valid()}")
