cases = [
    ("cbr == r", (2, 2, 3, 10)),
    ("cbr < r", (4, 2, 3, 10)),
    ("cbd == depth", (2, 4, 10, 10)),
    ("cbd > depth", (2, 4, 12, 10)),
    ("cbd 0", (2, 4, 0, 10)),
    ("r 0", (0, 4, 3, 10)),
    ("depth 0", (2, 4, 3, 0)),
    ("negative cbd", (2, 4, -3, 10)),
]
for name, args in cases:
    try:
        t = CounterBoreHole(*args)
        cyl = sorted((round(f.radius, 3), round(f.bbox().min.z, 3), round(f.bbox().max.z, 3)) for f in t.faces().cylinders())
        print("[07]", name, args, "-> accepted: bbox z", round(t.bbox().min.z, 3), "..", round(t.bbox().max.z, 3),
              "cyl faces", cyl, "valid", t.is_valid())
    except Exception as e:
        print("[07]", name, args, "->", type(e).__name__, e)
try:
    CounterBoreHole(2, 4, 3)
except Exception as e:
    print("[07] no depth:", type(e).__name__, e)
