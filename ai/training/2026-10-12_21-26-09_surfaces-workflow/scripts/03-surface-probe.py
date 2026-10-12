# Which grids does surface() accept? Planar vs curved, sizes.
def tryit(label, grid, **kw):
    try:
        s = surface(grid, **kw)
        print(f"[03] {label}: ok {s}")
    except Exception as e:
        print(f"[03] {label}: {type(e).__name__}: {e}")

flat = lambda nx, ny: [[(10 * i, 10 * j, 0) for i in range(nx)] for j in range(ny)]
bump = lambda nx, ny: [[(10 * i, 10 * j, (i * j) % 3) for i in range(nx)] for j in range(ny)]
for nx, ny in [(2, 2), (3, 3), (4, 3), (4, 4), (5, 5), (7, 5)]:
    tryit(f"flat {nx}x{ny}", flat(nx, ny))
    tryit(f"flat {nx}x{ny} ctrl", flat(nx, ny), interpolate=False)
    tryit(f"bump {nx}x{ny}", bump(nx, ny))
