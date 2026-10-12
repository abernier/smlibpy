a = Box(20, 20, 20)
t1 = Cylinder(3, 30).translate(-5, 0, 0)
t2 = Cylinder(3, 30).translate(5, 0, 0)
r1 = a & [t1, t2]
print("[15] a & [t1, t2]:", r1, "faces", len(r1.faces()))
r2 = a & (t1 + t2)
print("[15] a & (t1 + t2):", r2, "solids", len(r2.solids()), "vol", round(r2.volume, 4), "expected", round(2 * math.pi * 9 * 20, 4))
lens = Sphere(10) & Sphere(10).translate(12, 0, 0) & Box(30, 30, 4).translate(6, 0, 0)
print("[15] chained &:", lens, "valid", lens.is_valid(), "bbox", lens.bbox())
