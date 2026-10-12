# a tapered grip: cylinder with rounded ends, tapered, then hollowed
grip = Cylinder(12, 90)
grip = grip.fillet(grip.edges(), 4)
g = grip.taper(0.75)
print("[06] grip: valid", g.is_valid(), "faces", len(grip.faces()), "->", len(g.faces()),
      "volume", round(grip.mass_properties(accuracy=1e-10).volume, 3), "->", round(g.mass_properties(accuracy=1e-10).volume, 3))
bore = Cylinder(4, 100)
hollow = g - bore
print("[06] bored: valid", hollow.is_valid(), "volume", round(hollow.mass_properties(accuracy=1e-10).volume, 3))
flare = Box(40, 40, 60).fillet(Box(40, 40, 60).edges().parallel_to(Z), 6).taper(1.4, start=10)
print("[06] flared post: valid", flare.is_valid(), "faces", len(flare.faces()), "bbox", flare.bbox())
snapshot("grip", hollow, flare.translate(60, 0, 0), view="iso")
