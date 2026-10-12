# A base plate standing on XY with a boss, a gusset made from a Wedge, and a cone tip
base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
boss = Cylinder(10, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
tip = Cone(10, 4, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 28)
# Wedge: high side at -X, and the width comes out doubled (pass half the width).
# Mirror it so the high side is at +X, and let it reach 1 mm into the boss (x = -9):
# a face that only touches the cylinder makes an invalid fuse.
rib = Wedge(16, 2, 14, align=(Align.MIN, Align.CENTER, Align.MIN)).mirror(Plane.YZ).translate(-9, 0, 8)
part = base + boss + tip + rib
print("[17] part:", part, "valid:", part.is_valid(), "solids:", len(part.solids()))
print("[17] bbox:", part.bbox())
print("[17] rib bbox:", rib.bbox())
print("[17] rib top vertices:", [v.point for v in rib.vertices() if abs(v.z - 22) < 1e-6])
snapshot("block", part, view="sheet")
