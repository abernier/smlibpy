# Closed grids: each row is a closed ring (first point == last point) -> a tube?
import math
R, H = 10, 30
def ring(z, n=13, r=R):
    return [(r * math.cos(2 * math.pi * k / (n - 1)), r * math.sin(2 * math.pi * k / (n - 1)), z) for k in range(n)]
grid = [ring(z) for z in np.linspace(0, H, 5)]
for interp in (True, False):
    try:
        t = surface(grid, interpolate=interp)
        print(f"[03] tube interpolate={interp}: {t} edges {len(t.edges())} edges+seams {len(t.edges(seams=True))} verts {len(t.vertices())}")
        print(f"[03]   area {t.area:.3f} exact {2*math.pi*R*H:.3f}  bbox {t.bbox().min} {t.bbox().max}")
        mid = [t.distance_to((R * math.cos(a), R * math.sin(a), 15)) for a in np.linspace(0, 2 * math.pi, 37)]
        print(f"[03]   max dist to true cylinder at z=15: {max(mid):.4f}")
        # tangent continuity across the seam: normals just either side of the seam point
        n1 = t.faces()[0].normal_at((R, -0.01, 15)); n2 = t.faces()[0].normal_at((R, 0.01, 15))
        print(f"[03]   normals beside the seam: {n1} {n2} angle {math.degrees(n1.angle_to(n2)) if hasattr(n1,'angle_to') else 'n/a'}")
        print(f"[03]   normal at (10,0,15)->{t.faces()[0].normal_at((R,0,15))} at (-10,0,15)->{t.faces()[0].normal_at((-R,0,15))}")
    except Exception as e:
        print(f"[03] tube interpolate={interp}: {type(e).__name__}: {e}")
tube = surface(grid)
snapshot("tube", tube)
# closed in both directions? torus grid
def tor(u, v, R=20, r=5):
    return ((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v))
tg = [[tor(2 * math.pi * i / 12, 2 * math.pi * j / 8) for j in range(9)] for i in range(13)]
try:
    torus = surface(tg)
    print(f"[03] torus grid: {torus} edges {len(torus.edges())} seams {len(torus.edges(seams=True))} area {torus.area:.2f} exact {4*math.pi**2*20*5:.2f}")
    snapshot("torus", torus)
except Exception as e:
    print(f"[03] torus grid: {type(e).__name__}: {e}")
