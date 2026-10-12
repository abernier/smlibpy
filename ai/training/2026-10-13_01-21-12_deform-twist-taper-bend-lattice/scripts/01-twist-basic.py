# twist: default axis Z, the part's extent, volume, ends, faces
bar = Box(20, 10, 100)
t = bar.twist(90)
print("[01] valid", t.is_valid(), "faces", len(t.faces()), "edges", len(t.edges()))
print("[01] volume default", round(t.volume, 6), "precise", round(t.mass_properties(accuracy=1e-10).volume, 6))
top = sorted(tuple(round(c, 6) for c in v.point) for v in t.vertices() if v.z > 49)
print("[01] top corners", top)
print("[01] bbox", t.bbox())
print("[01] face kinds", sorted(f.geom_type for f in t.faces()))
from smlibpy._kernel import ext
print("[01] degrees", sorted((d["u_degree"], d["v_degree"], len(d["poles"])) for d in
                             (ext.surface_data(f._f.surface(), True) for f in t.faces())))
neg = bar.twist(-90)
print("[01] -90 top corners", sorted(tuple(round(c, 6) for c in v.point) for v in neg.vertices() if v.z > 49))
p = t.faces().sort_by(Z)[-1]
print("[01] top face normal", p.normal_at(), "center", p.center())
snapshot("twist", t, Box(20, 10, 100).translate(40, 0, 0), view="iso")
