flange = Cylinder(60, 10) - Cylinder(20, 12) - PolarLocations(45, 8) * Cylinder(5, 12)
print(flange.is_valid(), len(flange.faces().cylinders()))   # 10: outer, bore, 8 holes

def angle(p):
    return round(math.degrees(math.atan2(p.y, p.x)), 3)

print([angle(p) for p in PolarLocations(30, 4).points])                       # 0, 90, 180, -90
print([angle(p) for p in PolarLocations(30, 4, start_angle=45).points])       # 45, 135, -135, -45
print([angle(p) for p in PolarLocations(30, 4, angular_range=90).points])     # 0, 30, 60, 90: ends included

spokes = PolarLocations(20, 3) * Box(10, 2, 2)                  # rotate=True: bars point outward
level = PolarLocations(20, 3, rotate=False) * Box(10, 2, 2)     # all stay parallel to X
print([tuple(round(v, 2) for v in s.bbox().size) for s in spokes])
print([tuple(round(v, 2) for v in s.bbox().size) for s in level])

gear = Circle(20) + PolarLocations(0, 12) * Rectangle(6, 4).translate(21, 0)   # radius 0: only turns
print(len(gear.faces()), round(gear.area, 3))
