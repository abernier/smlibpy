plate = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
plate -= GridLocations(40, 20, 2, 2) * Cylinder(3, 20)
plate = plate.named("plate").colored("steelblue")
print(plate)                      # Part('plate', 10 faces, volume=18295.2)
print(plate.is_valid(), round(plate.volume, 3), len(plate.solids()))
print(plate.info())

pair = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
print(len(pair.solids()), [round(s.volume, 3) for s in pair.solids()])   # 2 [1000.0, 1000.0]
pins = sum(Cylinder(2, 10).translate(i * 10, 0, 0) for i in range(4))    # one Part, 4 bodies
print(len(pins.solids()))
