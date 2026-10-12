# Counterbore for an M6 socket head screw through a 10 mm plate
plate = Box(80, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
top = plate.faces().top()
plate -= (GridLocations(60, 40, 2, 2) * CounterBoreHole(3.3, 5.5, 6.5, 10)).on(top)
print(sorted({(round(f.radius, 2), round(f.bbox().min.z, 3), round(f.bbox().max.z, 3))
              for f in plate.faces().cylinders()}))      # [(3.3, 0.0, 3.5), (5.5, 3.5, 10.0)]
print(plate.is_valid(), round(80 * 60 * 10 - plate.volume, 3))   # 4 * pi * (3.3² * 3.5 + 5.5² * 6.5)

# Countersink for an M4 flat head (ISO 90 degrees), 8 deep in total
block = Box(40, 40, 20)
block -= CounterSinkHole(2.2, 4.5, 8, angle=90).on(block.faces().top())
cone = block.faces().filter_by(lambda f: f.geom_type == "cone").one()
print(round(cone.bbox().min.z, 3), round(cone.bbox().max.z, 3))   # 7.7 10.0: sink depth 4.5 - 2.2 = 2.3
print(sorted((round(e.radius, 3), round(e.center().z, 3)) for e in block.edges().circles()))
