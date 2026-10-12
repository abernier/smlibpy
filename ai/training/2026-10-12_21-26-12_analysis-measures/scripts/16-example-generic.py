plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallel_to(Z), 8)
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)

# after every step: valid, one solid, volume against a formula, outer size
expected = 80 * 60 * 10 - 4 * (8 * 8 - math.pi * 8 * 8 / 4) * 10 - 4 * math.pi * 4 * 4 * 10
print(plate.is_valid(), len(plate.solids()))           # True 1
print(abs(plate.volume - expected) / expected < 1e-6)  # True
print(plate.bbox().size)                               # Vector(80, 60, 10)
print(plate.info()["faces"])                           # 14
