# Booleans between a Part and a Shell: what comes out?
f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
s = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
b = Box(10, 10, 30).translate(20, 15, 0)
for op in ("&", "-", "+"):
    r = eval(f"b {op} s")
    print(f"[06] Part {op} Shell: faces {len(r.faces())} vol {r.volume:.3f} valid {r.is_valid()} solids {len(r.solids())} bbox z {r.bbox().min.z:.2f}..{r.bbox().max.z:.2f}")
    print(f"[06]   face types/areas {[(fc.geom_type, round(fc.area, 1)) for fc in r.faces()]}")
