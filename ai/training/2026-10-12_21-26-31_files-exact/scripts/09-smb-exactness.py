import os
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"
lf = loft([Circle(10), Rectangle(15, 15).translate(0, 0, 20)])
for asc in (True, False):
    q = os.path.join(OUT, f"09-loft-{asc}.smb")
    save(lf, q, ascii=asc)
    lb = load(q)
    a = np.array([f.center().to_tuple() for f in lf.faces()])
    b = np.array([f.center().to_tuple() for f in lb.faces()])
    va = np.array([v.point.to_tuple() if hasattr(v, "point") else v.to_tuple() for v in lf.vertices()])
    vb = np.array([v.point.to_tuple() if hasattr(v, "point") else v.to_tuple() for v in lb.vertices()])
    print(f"[09] ascii={asc} face center max diff {np.abs(a - b).max():.2e} vertex max diff {np.abs(va - vb).max():.2e} area diff {lf.area - lb.area:.2e}")
s = os.path.join(OUT, "09-loft.step"); export_step(lf, s); ls = import_step(s)
vs = np.array([v.point.to_tuple() if hasattr(v, "point") else v.to_tuple() for v in ls.vertices()])
print(f"[09] step vertex count {len(vs)} vs {len(va)}")
# twice through the same face, center differs?
print("[09] same body twice:", np.abs(np.array(lf.faces()[0].center().to_tuple()) - np.array(lf.faces()[0].center().to_tuple())).max())
