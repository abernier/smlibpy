# Angle between the normals on both sides of the seam of a closed grid, and a fix:
# overlap the ring (repeat points past the seam) does not close; check with more points.
import math
R = 10
def ring(z, n):
    return [(R * math.cos(2 * math.pi * k / (n - 1)), R * math.sin(2 * math.pi * k / (n - 1)), z) for k in range(n)]
for n in (9, 13, 25, 49):
    t = surface([ring(z, n) for z in np.linspace(0, 30, 5)])
    f = t.faces()[0]
    n1 = f.normal_at((R, -0.001, 15)); n2 = f.normal_at((R, 0.001, 15))
    ang = math.degrees(math.acos(max(-1, min(1, n1.dot(n2)))))
    print(f"[04] ring of {n-1} segments: seam kink {ang:.3f} deg, seams {len(t.edges(seams=True)) - len(t.edges())}")
