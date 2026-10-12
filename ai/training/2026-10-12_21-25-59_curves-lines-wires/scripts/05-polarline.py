# PolarLine: angle reference, negative angle/length, plane, start in which coordinates?
for ang in (0, 30, 90, 180, -45, 400):
    e = PolarLine((0, 0), 10, ang)
    print(f"[05] angle {ang}: end {e.end}, direction {e.direction}")
e = PolarLine((5, 5), -10, 0)
print("[05] negative length:", e, e.length)
for name in ("XY", "XZ", "YZ", "front", "right", "back"):
    pl = getattr(Plane, name)
    e = PolarLine((0, 0), 10, 90, plane=pl)
    e0 = PolarLine((0, 0), 10, 0, plane=pl)
    print(f"[05] {name}: angle 0 -> {e0.end}, angle 90 -> {e.end}")
# start: world or plane coordinates?
e = PolarLine((1, 2, 3), 10, 0, plane=Plane.XZ)
print("[05] start (1,2,3) on XZ:", e)
e = PolarLine((1, 2), 10, 0, plane=Plane.XY.offset(5))
print("[05] start (1,2) on XY.offset(5):", e)
try:
    PolarLine((0, 0), 0, 30)
except Exception as ex:
    print("[05] zero length ->", type(ex).__name__, ex)
