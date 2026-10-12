# What is inside a "valid" Part stitched over a 0.5 mm gap?
import tempfile, os
box = Box(10, 10, 10)
ps = [f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, 0.5)]
p = stitch(stitch(ps, tolerance=1))
top = p.faces().sort_by(Z)[-1]
print("[06] top face center z", round(top.center().z, 4), "vertex z", sorted({round(v.z, 4) for v in p.vertices()}))
print("[06] volume", round(p.volume, 3), "valid", p.is_valid(), "bbox z", round(p.bbox().max.z, 4))
d = tempfile.mkdtemp()
path = os.path.join(d, "gap.step")
export_step(p, path)
q = import_step(path)
print("[06] STEP round trip:", type(q).__name__, round(q.volume, 3) if isinstance(q, Part) else q)
f = p.fillet(p.edges().top() if hasattr(p.edges(), 'top') else p.edges(), 1) if False else None
try:
    c = p - Cylinder(2, 30)
    print("[06] boolean cut: vol", round(c.volume, 3), "valid", c.is_valid())
except Exception as e:
    print("[06] boolean cut:", type(e).__name__, e)
