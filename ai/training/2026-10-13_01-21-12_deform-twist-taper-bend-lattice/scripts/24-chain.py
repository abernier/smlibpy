# chaining deformations
p = Box(20, 20, 100).taper(0.8).twist(45)
print("[24] taper then twist: valid", p.is_valid(), "faces", len(p.faces()), "volume", round(p.mass_properties(accuracy=1e-10).volume, 3))
q = Box(20, 20, 100).twist(45).taper(0.8)
print("[24] twist then taper: valid", q.is_valid(), "volume", round(q.mass_properties(accuracy=1e-10).volume, 3))
r = Cylinder(5, 120).rotate(Y, 90).twist(90, axis=X).bend(90, radius=30)
print("[24] twist about X then bend: valid", r.is_valid(), "volume", round(r.mass_properties(accuracy=1e-10).volume, 3), "expect", round(math.pi * 25 * 120, 3))
