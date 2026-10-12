# PolarLocations: radius, count, start angle, arc vs full, rotate
def ang(p): return round(math.degrees(math.atan2(p.y, p.x)), 4)
P = PolarLocations(30, 6)
print("[03] 6 on r30 angles:", [ang(p) for p in P.points], "radii", {round(p.length, 9) for p in P.points})
print("[03] rotations:", [round(l.rotation.z, 4) for l in P])
print("[03] start_angle=15:", [ang(p) for p in PolarLocations(30, 4, start_angle=15).points])
print("[03] arc 0..90, count 4:", [ang(p) for p in PolarLocations(30, 4, angular_range=90).points])
print("[03] arc 180 count 3:", [ang(p) for p in PolarLocations(30, 3, angular_range=180).points])
print("[03] range -360 count 4:", [ang(p) for p in PolarLocations(30, 4, angular_range=-360).points])
print("[03] range -90 count 3:", [ang(p) for p in PolarLocations(30, 3, angular_range=-90).points])
print("[03] range 720 count 4:", [ang(p) for p in PolarLocations(30, 4, angular_range=720).points])
print("[03] range 359.9999 count 4:", [ang(p) for p in PolarLocations(30, 4, angular_range=359.9999).points])
print("[03] count 1:", PolarLocations(30, 1).points, "count 1 arc 90:", PolarLocations(30, 1, angular_range=90).points)
try:
    PolarLocations(30, 0)
except Exception as e:
    print("[03] count 0 ->", type(e).__name__, e)
print("[03] radius 0:", [round(l.rotation.z, 3) for l in PolarLocations(0, 4)], PolarLocations(0, 4).points[1])
print("[03] negative radius:", [tuple(round(c, 3) for c in p)[:2] for p in PolarLocations(-10, 4).points])
# rotate True vs False on a bar
bar = Box(10, 2, 2)
on = PolarLocations(30, 4) * bar
off = PolarLocations(30, 4, rotate=False) * bar
print("[03] rotate=True sizes:", [tuple(round(v, 3) for v in p.bbox().size) for p in on])
print("[03] rotate=False sizes:", [tuple(round(v, 3) for v in p.bbox().size) for p in off])
# copies turn about their own origin: shape offset from origin
tooth = Box(4, 2, 2).translate(3, 0, 0)    # local x 1..5 (radially outward when rotate)
t = PolarLocations(20, 4) * tooth
print("[03] offset tooth centers:", [tuple(round(c, 3) for c in p.center()) for p in t])
# bolt circle flange
flange = Cylinder(60, 10) - Cylinder(20, 12) - PolarLocations(45, 8) * Cylinder(5, 12)
print("[03] flange: valid", flange.is_valid(), "faces", len(flange.faces()), "holes", len(flange.faces().cylinders()) - 2)
hc = sorted(ang(f.axis.origin) for f in flange.faces().cylinders() if abs(f.radius - 5) < 1e-6)
print("[03] hole angles:", hc)
# gear-like: radius 0 with rotation
gear = Circle(20) + PolarLocations(0, 12) * Rectangle(6, 4).translate(21, 0)
print("[03] gear sketch faces", len(gear.faces()), "area", round(gear.area, 3))
# ShapeList on face
plate = Box(100, 100, 10)
bolt = (PolarLocations(30, 6, start_angle=30) * Hole(3, 10)).on(plate.faces().top())
p2 = plate - bolt
print("[03] polar holes on top face: vol diff", round(plate.volume - p2.volume, 3), "expected", round(6 * math.pi * 9 * 10, 3))
snapshot("flange", flange, view="top")
snapshot("bars", *on, *[b.translate(0, 0, 10) for b in off], view="top")
snapshot("gear", gear, view="top")
