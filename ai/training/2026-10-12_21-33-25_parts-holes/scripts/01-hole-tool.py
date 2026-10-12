h = Hole(3, 10)
print("[01] tool:", h, "bbox:", h.bbox(), "valid:", h.is_valid())
print("[01] faces:", [(f.geom_type, tuple(round(c, 3) for c in f.center().to_tuple())) for f in h.faces()])
try:
    Hole(3)
except Exception as e:
    print("[01] Hole(3):", type(e).__name__, e)
for args in [(0, 10), (3, 0), (-3, 10), (3, -10)]:
    try:
        Hole(*args)
        print("[01]", args, "accepted")
    except Exception as e:
        print("[01]", args, type(e).__name__, e)
try:
    Hole(3, 10, align=Align.MIN)
except Exception as e:
    print("[01] align kw:", type(e).__name__, e)
# placed on a plate top face
part = Box(60, 40, 10)
top = part.faces().top()
print("[01] top plane:", top.one().plane)
drilled = part - Hole(3, 6).on(top)
print("[01] blind hole: vol removed:", round(part.volume - drilled.volume, 4), "expected:", round(math.pi * 9 * 6, 4))
cyl = drilled.faces().cylinders().one()
print("[01] hole face: radius", cyl.radius, "bbox z:", cyl.bbox().min.z, cyl.bbox().max.z, "center:", cyl.center())
bottom = [f for f in drilled.faces().planar() if abs(f.area - math.pi * 9) < 1e-3]
print("[01] hole bottom face z:", [round(f.center().z, 4) for f in bottom], "normal:", [f.normal_at() for f in bottom])
print("[01] faces:", len(part.faces()), "->", len(drilled.faces()), "valid:", drilled.is_valid())
snapshot("blind", drilled, view="sheet")
