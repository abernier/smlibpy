# silhouette on spheres, cylinders, tori, cones, boxes; direction sign; zero direction.
import time
pi = math.pi
def show(name, body, d, exp_len=None):
    t = time.perf_counter()
    try:
        cs = body.silhouette(d)
    except Exception as e:
        print(f"[14] {name} dir={d}: {type(e).__name__}: {e}")
        return None
    dt = 1000*(time.perf_counter()-t)
    L = sum(c.length for c in cs)
    dn = np.array(d, float); dn /= np.linalg.norm(dn) if np.linalg.norm(dn) else 1
    # silhouette condition: surface normal perpendicular to the view direction
    worst = 0.0
    for c in cs:
        for i in range(9):
            p = c.point_at(i/8)
            f = min(body.faces(), key=lambda f: f.distance_to(p))
            worst = max(worst, abs(np.dot(np.array(f.normal_at(p).to_tuple()), dn)))
    s = f"[14] {name} dir={d}: n={len(cs)} types={[c.geom_type for c in cs]} length={L:.9g}"
    if exp_len is not None and exp_len:
        s += f" exp={exp_len:.9g} rel={(L-exp_len)/exp_len:+.1e}"
    print(s + f" max|n.d|={worst:.1e} ({dt:.0f} ms)")
    return cs
show("sphere r10", Sphere(10), (0, 0, 1), 2*pi*10)
show("sphere r10", Sphere(10), (0, 0, -1), 2*pi*10)
cs = show("sphere r10", Sphere(10), (1, 1, 1), 2*pi*10)
show("sphere r10 at (100,50,20)", Sphere(10).translate(100, 50, 20), (1, 1, 1), 2*pi*10)
show("cylinder r5 h20", Cylinder(5, 20), (1, 0, 0), 2*20)
show("cylinder r5 h20", Cylinder(5, 20), (0, 0, 1), 0)
show("cylinder r5 h20", Cylinder(5, 20), (1, 0, 1), None)
show("torus 20/5", Torus(20, 5), (0, 0, 1), 2*pi*25 + 2*pi*15)
cs_t = show("torus 20/5", Torus(20, 5), (1, 0, 0))
show("cone r10 h30", Cone(10, 0, 30), (1, 0, 0), 2*math.hypot(10, 30))
show("box", Box(10, 10, 10), (0, 0, 1))
show("box with fillets", Box(20, 20, 20).fillet(Box(20, 20, 20).edges().parallel_to(Z), 5), (0, 0, 1))
show("box with fillets", Box(20, 20, 20).fillet(Box(20, 20, 20).edges().parallel_to(Z), 5), (1, 0, 0))
show("sphere", Sphere(10), (0, 0, 0))
show("sphere (default direction)", Sphere(10), None) if False else None
cs = Sphere(10).silhouette()
print(f"[14] default direction: n={len(cs)} length={sum(c.length for c in cs):.9g} z-range={[round(c.point_at(0.3).z, 9) for c in cs]}")
snapshot("torus_side", Torus(20, 5), view="front")
