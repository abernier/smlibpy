# A row of identical points (a pole): dome from rings shrinking to one point.
import math
R = 10
def ring(r, z, n=13):
    return [(r * math.cos(2 * math.pi * k / (n - 1)), r * math.sin(2 * math.pi * k / (n - 1)), z) for k in range(n)]
rows = []
for a in np.linspace(0, 90, 7):
    r = R * math.cos(math.radians(a)); z = R * math.sin(math.radians(a))
    rows.append(ring(r, z))
try:
    dome = surface(rows)
    print(f"[05] dome: {dome} area {dome.area:.3f} exact {2*math.pi*R*R:.3f}")
    print(f"[05]   edges {len(dome.edges())} verts {len(dome.vertices())} bbox {dome.bbox().min} {dome.bbox().max}")
    print(f"[05]   normal at top {dome.faces()[0].normal_at((0,0,10))} at side {dome.faces()[0].normal_at((-10,0,0))}")
    snapshot("dome", dome)
    solid = dome.thicken(1)
    print(f"[05] dome.thicken(1): vol {solid.volume:.3f} valid {solid.is_valid()} bbox {solid.bbox().min} {solid.bbox().max}")
except Exception as e:
    print(f"[05] dome: {type(e).__name__}: {e}")
# a triangle-like patch: one boundary row collapsed to a point
tri = [[(x * (1 - j / 3), 10 * j, 0.5 * x * j) for x in (0, 10, 20, 30)] for j in range(4)]
try:
    t = surface(tri)
    print(f"[05] collapsed edge patch: {t} edges {len(t.edges())} verts {len(t.vertices())}")
except Exception as e:
    print(f"[05] collapsed edge patch: {type(e).__name__}: {e}")
