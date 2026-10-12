tangent = Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)
print("[10] tangent fuse valid:", tangent.is_valid(), "circles:", len(tangent.edges().circles()), flush=True)
r = tangent.fillet(tangent.edges().circles(), 0.5)
print("[10] fillet ->", r, flush=True)
