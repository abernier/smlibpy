# A thread: triangle pointing radially out (sketch +X), base on the rod surface
tooth = Polygon((0, -0.8), (0, 0.8), (1.2, 0))
print("[16] tooth bbox center", tooth.bbox().center, "centroid", tooth.center())
h = Helix(pitch=2, height=16, radius=5.6, center=(0, 0, 2))
thread = sweep(tooth, h)
caps = [f for f in thread.faces() if f.is_planar]
start = min(caps, key=lambda f: f.center().z)
print("[16] start cap corners", sorted({tuple(round(c, 3) for c in v.point.to_tuple()) for v in start.vertices()}))
rod = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
screw = rod + thread
print("[16] thread valid", thread.is_valid(), "volume", round(thread.volume, 4), "screw valid", screw.is_valid(), "solids", len(screw.solids()))
snapshot("screw", screw, view="front")
