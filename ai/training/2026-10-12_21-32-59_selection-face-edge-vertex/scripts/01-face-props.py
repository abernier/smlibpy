# Face properties on all face types
def r3(v): return tuple(round(c, 4) for c in v)
bodies = {
    "box": Box(40, 30, 20) - Cylinder(6, 30),
    "cone": Cone(10, 5, 20),
    "sphere": Sphere(8),
    "torus": Torus(20, 4),
    "fillet": Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3),
}
for name, b in bodies.items():
    for f in b.faces():
        row = [f.geom_type, "area", round(f.area, 3), "center", r3(f.center()), "planar", f.is_planar]
        for attr in ("radius", "axis"):
            try:
                v = getattr(f, attr)
                row += [attr, round(v, 4) if isinstance(v, float) else v]
            except Exception as ex:
                row += [attr, f"{type(ex).__name__}: {ex}"]
        try:
            pl = f.plane
            row += ["plane", r3(pl.origin), "x", r3(pl.x_dir), "z", r3(pl.z_dir)]
        except Exception as ex:
            row += ["plane", f"{type(ex).__name__}: {ex}"]
        row += ["interior", r3(f.interior_point()), "normal", r3(f.normal_at())]
        print(f"[01] {name}:", *row)
