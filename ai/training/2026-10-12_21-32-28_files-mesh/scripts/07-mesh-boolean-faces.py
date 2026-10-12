a = Box(20, 20, 20).mesh()
b = Sphere(12).mesh()
for op, r in [("-", a - b), ("&", a & b), ("+", a + b)]:
    tri = r.vertices[r.triangles]
    on_top = np.all(np.abs(tri[:, :, 2] - 10) < 1e-6, axis=1)
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    sph = np.all(np.abs(np.linalg.norm(tri, axis=2) - 12) < 0.05, axis=1)
    tn = r.triangle_normals
    up = int((tn[on_top][:, 2] > 0).sum())
    radial_out = np.einsum("td,td->t", tn[sph], tri[sph].mean(axis=1))
    print(f"[07] {op}: top-face tris {on_top.sum()} area {area[on_top].sum():.2f} (normal +z: {up}); sphere tris {sph.sum()} area {area[sph].sum():.1f} outward {int((radial_out > 0).sum())} inward {int((radial_out < 0).sum())}")
    print(f"[07] {op}: total area {r.area:.1f}")
print("[07] exact: top face area of box-sphere", round(400 - math.pi * 44, 2), " sphere area inside box", round((Box(20, 20, 20) & Sphere(12)).area - 6 * math.pi * 44, 1))
