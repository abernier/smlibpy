# triangle counts and real chord error vs tolerance and angle
cyl = Cylinder(10, 20)
sph = Sphere(10)
def seg(m):
    side = np.abs(np.hypot(m.vertices[:, 0], m.vertices[:, 1]) - 10) < 1e-6
    return len(np.unique(np.round(np.arctan2(m.vertices[side, 1], m.vertices[side, 0]), 6)))
def sphere_err(m):
    tri = m.vertices[m.triangles]
    c = tri.mean(axis=1)
    return float(10 - np.linalg.norm(c, axis=1).min())   # deepest triangle centroid (upper bound-ish)
rows = []
for tol in [None, 1.0, 0.1, 0.03, 0.01, 0.001]:
    for ang in [45, 15, 5]:
        mc = tessellate(cyl, tol, ang)
        n = seg(mc)
        chord = 10 * (1 - math.cos(math.pi / n))
        ms = tessellate(sph, tol, ang)
        rows.append(dict(tol=tol, angle=ang, cyl_tris=len(mc), cyl_segments=n, cyl_chord=round(chord, 5),
                         sph_tris=len(ms), sph_err=round(sphere_err(ms), 5), sph_vol_err=round((ms.volume - sph.volume) / sph.volume, 6)))
        print("[02]", rows[-1])
filewrite(rows, "table")
# box: planar faces ignore tolerance?
for tol in [None, 0.001]:
    print("[02] box tris tol", tol, len(tessellate(Box(10, 20, 30), tol)))
