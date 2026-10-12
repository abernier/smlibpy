# real deviation of sphere meshes: sample each triangle, find the deepest point and where it is
sph = Sphere(10)
bary = np.array([[a, b, 1 - a - b] for a in np.linspace(0, 1, 7) for b in np.linspace(0, 1, 7) if a + b <= 1 + 1e-9])
for tol, ang in [(None, 15), (0.1, 15), (0.01, 45), (0.01, 15), (0.01, 5), (0.001, 15)]:
    m = tessellate(sph, tol, ang)
    tri = m.vertices[m.triangles]
    pts = np.einsum("kj,tjd->tkd", bary, tri)
    depth = 10 - np.linalg.norm(pts, axis=2)
    t = int(depth.max(axis=1).argmax())
    worst = tri[t]
    edge_len = max(np.linalg.norm(worst[i] - worst[(i + 1) % 3]) for i in range(3))
    over = int((depth.max(axis=1) > (tol or 0.0346) * 1.01).sum())
    print(f"[03] tol={tol} angle={ang}: tris={len(m)} max dev={depth.max():.4f} at z={worst[:, 2].mean():.2f} longest edge={edge_len:.2f} tris over tol={over} vertex radius err={np.abs(np.linalg.norm(m.vertices, axis=1) - 10).max():.1e}")
m = tessellate(sph, 0.01, 45)
snapshot("sphere-001-45", m, view="top")
