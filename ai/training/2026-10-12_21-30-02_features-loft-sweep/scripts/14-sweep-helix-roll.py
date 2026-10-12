# Does the profile keep its orientation relative to the helix axis? Section each turn with the
# half plane x=0, y>0 (plane YZ) and measure the radial (y) and axial (z) extent of each piece.
h = Helix(pitch=5, height=30, radius=10)
rect = sweep(Rectangle(2, 1), h)     # 2 along sketch x, 1 along sketch y
sec = rect.section(Plane.YZ)
rows = []
for f in sec.faces():
    b = f.bbox()
    if b.min.y > 0:
        rows.append((round(b.center.z, 2), round(b.size.y, 3), round(b.size.z, 3)))
rows.sort()
print("[rect 2x1] (z, radial size, axial size) per turn at angle 90:")
for r in rows:
    print("   ", r)
# expected without roll: radial 2, axial ~1/cos(helix angle)
ang = math.atan(5 / (2*math.pi*10))
print("expected radial 2, axial", round(1/math.cos(ang), 3))
# same with translational=True
try:
    tr = sweep(Rectangle(2, 1), h, translational=True)
    print("[translational] valid", tr.is_valid(), "vol", round(tr.volume, 3))
except Exception as e:
    print(f"[translational] {type(e).__name__}: {e}")
# shorter helix (1 turn) to see the start
one = sweep(Rectangle(2, 1), Helix(pitch=5, height=5, radius=10))
s1 = one.section(Plane.YZ)
print("[1 turn] pieces", [(round(f.bbox().center.z, 2), round(f.bbox().size.y, 3), round(f.bbox().size.z, 3)) for f in s1.faces() if f.bbox().min.y > 0])
snapshot("roll", rect)
