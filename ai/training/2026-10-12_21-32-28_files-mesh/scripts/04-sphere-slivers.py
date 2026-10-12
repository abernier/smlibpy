sph = Sphere(10)
bary = np.array([[a, b, 1 - a - b] for a in np.linspace(0, 1, 7) for b in np.linspace(0, 1, 7) if a + b <= 1 + 1e-9])
def closed(mesh):
    _, inv = np.unique(np.round(mesh.vertices, 7), axis=0, return_inverse=True)
    t = inv.reshape(-1)[mesh.triangles]
    e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return int((c == 1).sum()), int((c > 2).sum())
for tol, ang in [(None, 15), (0.01, 15), (0.01, 5)]:
    m = tessellate(sph, tol, ang)
    tri = m.vertices[m.triangles]
    depth = (10 - np.linalg.norm(np.einsum("kj,tjd->tkd", bary, tri), axis=2)).max(axis=1)
    bad = np.argsort(depth)[-4:]
    print(f"[04] tol={tol} angle={ang}: open edges, edges used >2 times: {closed(m)}  volume err {(m.volume - sph.volume) / sph.volume:.2e}")
    for t in bad:
        c = tri[t].mean(axis=0)
        print(f"[04]    dev {depth[t]:.3f} centroid ({c[0]:.2f}, {c[1]:.2f}, {c[2]:.2f}) azimuth {math.degrees(math.atan2(c[1], c[0])):.1f}")
# a filleted box: same check against the true surface is hard, check the kernel's face count and closedness
fb = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)
m = tessellate(fb, 0.01)
print("[04] filleted box open/over-used edges:", closed(m), "vol err", (m.volume - fb.volume) / fb.volume)
