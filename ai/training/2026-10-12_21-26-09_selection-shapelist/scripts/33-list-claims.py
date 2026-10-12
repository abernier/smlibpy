# Remaining list_transforms claims
pins = ShapeList([Cylinder(3, 20), Cylinder(3, 20).translate(20, 0, 0)])
print("[33] Rot * sl:", type(Rot(z=90) * pins).__name__, " Plane * sl:", type(Plane.XZ * pins).__name__)
m = ShapeList(s.mirror() for s in pins)
print("[33] mirror via generator:", type(m).__name__, len(m))
r = pins.rotate(Axis((10, 0, 0), (0, 0, 1)), 180)
print("[33] rotate about axis through (10,0,0):", [round(p.center().x, 3) for p in r])
print("[33] PolarLocations * part:", type(PolarLocations(30, 6) * Cylinder(3, 20)).__name__)
sl = ShapeList(pins); sl.insert(0, Box(1, 1, 1)); sl.pop(); print("[33] insert/pop:", type(sl).__name__, len(sl))
