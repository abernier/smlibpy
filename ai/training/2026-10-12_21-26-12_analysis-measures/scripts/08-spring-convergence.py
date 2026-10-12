# Convergence of volume with accuracy on a 20-turn spring and a thread-like triangle sweep.
import time
pi = math.pi
h = Helix(5.0, 100.0, 10.0)
spring = sweep(Circle(1), h)
tri = sweep(Polygon((-1, 0), (1, 0), (0, 1.5)), h)
for name, p in (("spring 20 turns", spring), ("triangle sweep 20 turns", tri)):
    for acc in (1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10, 1e-11):
        t = time.perf_counter()
        try:
            mp = p.mass_properties(accuracy=acc)
            print(f"[08] {name} acc={acc:.0e}: V={mp.volume:.12g} A={mp.area:.12g} {1000*(time.perf_counter()-t):.0f} ms")
        except Exception as e:
            print(f"[08] {name} acc={acc:.0e}: {type(e).__name__}: {e}")
print(f"[08] tri profile area 1.5, helix length {h.length:.12g}, A*L={1.5*h.length:.12g}; circle pi*L={pi*h.length:.12g} 2*pi*L={2*pi*h.length:.12g}")
