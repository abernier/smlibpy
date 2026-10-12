# How close is the interpolated surface to the true function between the grid points?
import math
f = lambda x, y: 8 * math.sin(x / 15) * math.cos(y / 15)
for n in (4, 6, 10, 20):
    xs = np.linspace(0, 60, n)
    ys = np.linspace(0, 40, n)
    grid = [[(x, y, f(x, y)) for x in xs] for y in ys]
    s = surface(grid)
    # sample at midpoints between grid points, measure distance to the true point
    test = [(x, y, f(x, y)) for x in np.linspace(1, 59, 25) for y in np.linspace(1, 39, 17)]
    dev = max(s.distance_to(p) for p in test)
    c = surface(grid, interpolate=False)
    devc = max(c.distance_to(p) for p in test)
    print(f"[02] {n}x{n}: interpolate max dev {dev:.4f}  control max dev {devc:.4f}")
