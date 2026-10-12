def closed(mesh):
    _, inv = np.unique(np.round(mesh.vertices, 7), axis=0, return_inverse=True)
    t = inv.reshape(-1)[mesh.triangles]
    e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return int((c == 1).sum()), int((c > 2).sum())
a = Box(20, 20, 20).mesh()
b = Sphere(12).mesh()
print("[06] a:", a, "closed", closed(a), "vol", round(a.volume, 2))
print("[06] b:", b, "closed", closed(b), "vol", round(b.volume, 2))
for op, r in [("-", a - b), ("+", a + b), ("&", a & b)]:
    n = r.normals
    zero = int((np.linalg.norm(n, axis=2) < 1e-6).sum()) if n is not None else None
    tn = r.triangle_normals
    # agreement of corner normals with geometric normals
    agree = np.einsum("td,td->t", n.mean(axis=1), tn) if n is not None else None
    deg = int((np.linalg.norm(np.cross(r.vertices[r.triangles][:, 1] - r.vertices[r.triangles][:, 0], r.vertices[r.triangles][:, 2] - r.vertices[r.triangles][:, 0]), axis=1) < 1e-12).sum())
    print(f"[06] {op}: {r} open/overused {closed(r)} zero corner normals {zero} corner·geom<0: {int((agree < 0).sum())} >0: {int((agree > 0).sum())} degenerate tris {deg} bbox {r.bbox()}")
    print(f"[06] {op}: vertex radius range {np.linalg.norm(r.vertices, axis=1).min():.3f}..{np.linalg.norm(r.vertices, axis=1).max():.3f}")
r = a - b
render(r, path="ai/training/2026-10-12_21-32-28_files-mesh/files/06-diff.png")
render(a, path="ai/training/2026-10-12_21-32-28_files-mesh/files/06-a.png")
# exact Boolean then mesh
e = (Box(20, 20, 20) - Sphere(12)).mesh()
print("[06] exact then mesh:", e, round(e.volume, 2), "closed", closed(e))
