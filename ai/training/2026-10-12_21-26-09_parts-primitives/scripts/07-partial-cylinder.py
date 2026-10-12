# Cylinder has no angle parameter; two ways to get a partial cylinder
half = Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))
print("[07] half via &:", half, "valid:", half.is_valid(), "bbox:", half.bbox())
print("[07] expected half volume:", round(math.pi * 100 * 20 / 2, 3))
sector = Rectangle(10, 20, align=(Align.MIN, Align.CENTER)).on(Plane.front).revolve(Z, 90)
print("[07] 90 deg sector via revolve:", sector, "valid:", sector.is_valid(), "bbox:", sector.bbox())
print("[07] expected quarter volume:", round(math.pi * 100 * 20 / 4, 3))
snapshot("partial", half, sector.translate(30, 0, 0), view="iso")
