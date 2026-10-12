# Part + Sketch is accepted silently: what is the result?
p = Box(5, 5, 5) + Rectangle(10, 10)
print("[04] repr:", repr(p), "valid:", p.is_valid(), "solids:", len(p.solids()))
print("[04] bbox:", p.bbox().min, p.bbox().max)
print("[04] face types:", sorted(round(f.area, 3) for f in p.faces()))
p2 = Box(5, 5, 5) - Rectangle(10, 10)
print("[04] part - sketch:", repr(p2), "valid:", p2.is_valid())
p3 = Box(20, 20, 5) - Circle(3)
print("[04] part - circle:", repr(p3), "valid:", p3.is_valid())
