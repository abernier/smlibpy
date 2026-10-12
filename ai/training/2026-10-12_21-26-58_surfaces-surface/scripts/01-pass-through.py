# Does surface() pass through its points? interpolate True vs False. Degree.
from smlibpy._kernel import ext
import math
grid = [[(x, y, 5 * math.sin(x / 12) * math.cos(y / 12)) for x in range(0, 61, 10)]
        for y in range(0, 41, 10)]
for interp in (True, False):
    s = surface(grid, interpolate=interp)
    d = ext.surface_data(s.faces()[0]._f.surface(), True)
    dev = [s.distance_to(p) for row in grid for p in row]
    corners = [s.distance_to(grid[i][j]) for i in (0, -1) for j in (0, -1)]
    edge_mid = s.distance_to(grid[0][3])
    print(f"[01] interpolate={interp}: degree {d['u_degree']}x{d['v_degree']} poles {len(d['poles'])}"
          f" max dev {max(dev):.2e} corners {max(corners):.2e} edge-mid {edge_mid:.3e} area {s.area:.3f}")
    print(f"[01]   bbox {s.bbox().min} {s.bbox().max}")
    print(f"[01]   vertices {[tuple(round(c, 6) for c in v) for v in s.vertices()]}")
