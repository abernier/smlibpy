base = Box(80, 50, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
bosses = PolarLocations(15, 3) * Cylinder(6, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = base + [b.translate(0, 0, 10) for b in bosses]       # standing on the top face (z = 10)
part -= GridLocations(60, 30, 2, 2) * Cylinder(3, 30)        # four through holes in one call
print(part.is_valid(), len(part.solids()), round(part.volume, 2), part.bbox())

# Overlapping parallel through cuts: fuse the tools first, then cut once
keyhole = Cylinder(6, 30) + Cylinder(3, 30).translate(8, 0, 0)
plate = Box(40, 40, 10) - keyhole
print(plate.is_valid(), len(plate.faces()))
try:
    Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # one after the other
except KernelError as e:
    print(e)

# & with a list intersects with ALL of them; fuse first to keep each overlap
a = Box(20, 20, 20)
t1, t2 = Cylinder(3, 30).translate(-5, 0, 0), Cylinder(3, 30).translate(5, 0, 0)
print(round((a & [t1, t2]).volume, 3), round((a & (t1 + t2)).volume, 3))   # 0.0 1130.973

# results to check: empty, several bodies
print((a - Box(30, 30, 30)).volume, len((Box(40, 10, 10) - Box(4, 20, 20)).solids()))   # 0.0 2
snapshot("bracket", part, view="sheet")
