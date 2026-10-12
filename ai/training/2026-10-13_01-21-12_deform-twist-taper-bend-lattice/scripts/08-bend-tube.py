# bent tubes: an elbow with straight legs, hollow
tube = Cylinder(6, 150).rotate(Y, 90)
elbow = tube.bend(90, radius=30)
print("[08] elbow: valid", elbow.is_valid(), "faces", len(elbow.faces()), "bbox", elbow.bbox(),
      "volume", round(elbow.mass_properties(accuracy=1e-10).volume, 4), "expect", round(math.pi * 36 * 150, 4))
pipe = elbow.shell(1, elbow.faces().planar())
print("[08] pipe: valid", pipe.is_valid(), "faces", len(pipe.faces()), "volume", round(pipe.mass_properties(accuracy=1e-10).volume, 4),
      "expect", round(math.pi * (36 - 25) * 150, 4))
hollow = (Cylinder(6, 150) - Cylinder(5, 160)).rotate(Y, 90).bend(90, radius=30)
print("[08] hollow first, then bent: valid", hollow.is_valid(), "volume", round(hollow.mass_properties(accuracy=1e-10).volume, 4))
handle = (Cylinder(5, 200).rotate(Y, 90)).bend(180, radius=30)
print("[08] handle: bbox", handle.bbox())
ends = [f for f in handle.faces() if f.geom_type == "plane"]
print("[08] handle ends at", sorted((round(f.center().x, 6), round(f.center().z, 6)) for f in ends))
snapshot("tubes", pipe, handle.translate(0, 0, 80), view="front")
