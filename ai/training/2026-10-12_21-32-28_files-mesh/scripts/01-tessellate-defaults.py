# Mesh fields and the default tolerance, measured as the real chord error on a cylinder
cyl = Cylinder(10, 20)
m = tessellate(cyl)
print("[01] repr:", m, "len:", len(m))
print("[01] vertices", m.vertices.shape, m.vertices.dtype, "triangles", m.triangles.shape, m.triangles.dtype,
      "normals", None if m.normals is None else m.normals.shape)
print("[01] bbox diag:", round(cyl.bbox().diagonal, 4), "default tol = 0.1 %:", round(cyl.bbox().diagonal * 1e-3, 5))
r = np.hypot(m.vertices[:, 0], m.vertices[:, 1])
side = np.abs(r - 10) < 1e-6
print("[01] side vertices on radius:", side.sum(), "of", len(r))
# chord error: distance from radius at the midpoints of side triangle edges
tri = m.vertices[m.triangles]
mids = (tri + np.roll(tri, -1, axis=1)) / 2
rm = np.hypot(mids[..., 0], mids[..., 1])
onside = np.all(np.abs(np.hypot(tri[..., 0], tri[..., 1]) - 10) < 1e-6, axis=1)
err = 10 - rm[onside].min()
print("[01] max chord error on the side:", round(err, 5))
print("[01] segments around:", len(np.unique(np.round(np.arctan2(m.vertices[side, 1], m.vertices[side, 0]), 6))))
print("[01] area mesh/exact:", round(m.area, 4), round(cyl.area, 4), "volume mesh/exact:", round(m.volume, 4), round(cyl.volume, 4))
print("[01] Shape.mesh same:", len(cyl.mesh()) == len(m))
# shared vertices? count unique positions vs vertices
u = np.unique(np.round(m.vertices, 9), axis=0)
print("[01] unique positions:", len(u), "vertices:", len(m.vertices))
# closed? every undirected edge used by exactly two triangles (by position)
def closed(mesh):
    key = np.round(mesh.vertices, 9)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    t = inv.reshape(-1)[mesh.triangles] if inv.ndim == 1 else inv[mesh.triangles]
    e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return bool(np.all(c == 2)), int((c != 2).sum())
print("[01] closed by position:", closed(m))
# orientation: outward normals? signed volume positive
print("[01] signed volume > 0:", m.volume > 0)
print("[01] normals unit:", np.allclose(np.linalg.norm(m.normals, axis=2), 1, atol=1e-5))
print("[01] center:", m.center(), "bbox:", m.bbox())
