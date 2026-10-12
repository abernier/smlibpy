# all-edge round of a cube near the limit
def exact(a, r):
    return a**3 - (4 - math.pi)*r*r*3*(a - 2*r) - (8 - 4*math.pi/3)*r**3
cube = Box(10, 10, 10)
for r in (4.5, 4.8, 4.9, 4.95, 4.97, 4.99, 4.999):
    try:
        p = cube.fillet(cube.edges(), r)
        print(f"[r{r}] valid={p.is_valid()} vol={p.volume:.4f} exact={exact(10, r):.4f} faces={len(p.faces())} bbox={tuple(round(v, 3) for v in p.bbox().size.to_tuple())}")
    except Exception as e:
        print(f"[r{r}] {type(e).__name__}: {e}")
p = cube.fillet(cube.edges(), 4.99)
snapshot("r499", p)
