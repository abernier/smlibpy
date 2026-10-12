# Effect of mass_properties(accuracy=...) on error and time.
import time
pi = math.pi
cases = {
    "cylinder": (Cylinder(6, 20), pi*36*20, 2*pi*36 + 2*pi*6*20),
    "sphere": (Sphere(10), 4/3*pi*1000, 4*pi*100),
    "torus": (Torus(20, 5), 2*pi**2*20*25, 4*pi**2*20*5),
}
for name, (p, v, a) in cases.items():
    for acc in (1e-2, 1e-4, 1e-6, 1e-7, 1e-8, 1e-10, 1e-12, 1e-14):
        t = time.perf_counter()
        try:
            mp = p.mass_properties(accuracy=acc)
            dt = (time.perf_counter() - t) * 1000
            print(f"[02] {name} acc={acc:.0e}: relV={(mp.volume-v)/v:+.2e} relA={(mp.area-a)/a:+.2e} |c|={mp.center.length:.1e} {dt:.1f} ms")
        except Exception as e:
            print(f"[02] {name} acc={acc:.0e}: {type(e).__name__}: {e}")
for acc in (0, -1, 1, 0.5):
    try:
        mp = Sphere(10).mass_properties(accuracy=acc)
        print(f"[02] sphere acc={acc}: relV={(mp.volume-4/3*pi*1000)/(4/3*pi*1000):+.2e}")
    except Exception as e:
        print(f"[02] sphere acc={acc}: {type(e).__name__}: {e}")
