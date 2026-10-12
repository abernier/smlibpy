# taper: cylinder to cone, box to frustum, exactness, ranges, scale > 1, other axes
from smlibpy._kernel import ext
cone = Cylinder(10, 50).taper(0.5)
print("[05] cone: valid", cone.is_valid(), "faces", len(cone.faces()), "volume", round(cone.mass_properties(accuracy=1e-10).volume, 6),
      "frustum", round(math.pi * 50 / 3 * (100 + 50 + 25), 6))
print("[05] cone degrees", sorted((d["u_degree"], d["v_degree"], d["weights"] is not None) for d in
                                 (ext.surface_data(f._f.surface(), True) for f in cone.faces())))
top = cone.edges().sort_by(Z)[-1]
print("[05] top edge radius", round(math.hypot(top.point_at(0.3).x, top.point_at(0.3).y), 12), "z", round(top.point_at(0.3).z, 12))
f = Box(20, 20, 50).taper(2.0)
print("[05] frustum 2x: volume", round(f.mass_properties(accuracy=1e-10).volume, 6), "expect", round(50 / 3 * (400 + 1600 + 800), 6), "bbox", f.bbox())
h = Box(20, 20, 50).taper(0.5, start=0)
print("[05] upper half: faces", len(h.faces()), "volume", round(h.mass_properties(accuracy=1e-10).volume, 6),
      "expect", round(20 * 20 * 25 + 25 / 3 * (400 + 100 + 200), 6))
x = Box(100, 20, 20).taper(0.25, axis=X)
print("[05] along X: bbox", x.bbox())
c = Box(20, 20, 50).taper(0.5, end=0)
print("[05] end=0: bbox", c.bbox(), "volume", round(c.mass_properties(accuracy=1e-10).volume, 6))
off = Box(20, 20, 50, align=(Align.MIN, Align.MIN, Align.MIN)).taper(0.5)
print("[05] box not on the axis: bbox", off.bbox())
snapshot("taper", cone, f.translate(40, 0, 0), x.translate(0, 60, 0), view="iso")
