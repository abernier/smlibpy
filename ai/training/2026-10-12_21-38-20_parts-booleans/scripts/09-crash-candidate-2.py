a = Box(10, 10, 10)
print("[09] start: (Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)) - Cylinder(1, 30)", flush=True)
r = (Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)) - Cylinder(1, 30)
print("[09] ->", r, flush=True)
if r is not None:
    print("[09] valid", r.is_valid(), "vol", r.volume, flush=True)
