# How is a profile oriented at the start of a helix? Rectangle(2, 1): which side is radial?
h = Helix(pitch=4, height=12, radius=8)
coil = sweep(Rectangle(2, 1), h)
bb = coil.bbox()
print("[14] coil bbox", bb.min, bb.max, "(radial half-width = max.x - 8:", round(bb.max.x - 8, 4), ", axial: z", round(bb.min.z, 4), round(bb.max.z, 4), ")")
coil2 = sweep(Rectangle(1, 2), h)
bb2 = coil2.bbox()
print("[14] Rectangle(1, 2): bbox", bb2.min, bb2.max, "radial", round(bb2.max.x - 8, 4))
# a thread on a rod: triangular profile, drawn on XY, swept along a helix at the rod surface
rod = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
tooth = Polygon((-0.8, 0), (0.8, 0), (0, 1.2))
thread = sweep(tooth, Helix(pitch=2, height=16, radius=5, center=(0, 0, 2)))
print("[14] thread valid", thread.is_valid(), "volume", round(thread.volume, 4), "bbox", thread.bbox().min, thread.bbox().max)
screw = rod + thread
print("[14] screw valid", screw.is_valid(), "solids", len(screw.solids()), "volume", round(screw.volume, 3), "rod", round(rod.volume, 3))
snapshot("screw", screw, view="front")
snapshot("coils", coil, coil2.translate(25, 0, 0), view="front")
