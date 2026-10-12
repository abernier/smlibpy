# how exact are centers and volumes of curved parts?
for r, h in [(3, 10), (30, 100), (300, 1000)]:
    c = Cylinder(r, h)
    print("[15] Cylinder", r, h, "center", c.center(), "== origin:", c.center() == (0, 0, 0), "vol rel err", (c.volume - math.pi * r * r * h) / (math.pi * r * r * h))
s = Sphere(50)
print("[15] Sphere center", s.center(), "vol rel err", (s.volume - 4 / 3 * math.pi * 50**3) / (4 / 3 * math.pi * 50**3))
print("[15] Box(1000,1000,1000) center:", Box(1000, 1000, 1000).center())
print("[15] bbox cylinder:", Cylinder(3, 10).bbox())
