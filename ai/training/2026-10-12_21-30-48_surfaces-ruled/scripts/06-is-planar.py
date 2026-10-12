# Is a flat ruled / grid face reported as planar? Can it become a sketch?
r = ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 10, 0), (20, 10, 0)))
g = surface([[(x, y, 0) for y in range(4)] for x in range(4)])
for label, s in (("ruled", r), ("grid", g)):
    f = s.faces()[0]
    srf = f._f.surface()
    print(f"[06] {label}: is_planar {f.is_planar} kernel is_planar(1e-7) {srf.is_planar(1e-7)} is_planar(1e-3) {srf.is_planar(1e-3)}"
          f" planar() selector {len(s.faces().planar())}")
    try:
        sk = f.to_sketch()
        print(f"[06]   to_sketch ok area {sk.area}")
    except Exception as e:
        print(f"[06]   to_sketch: {type(e).__name__}: {e}")
