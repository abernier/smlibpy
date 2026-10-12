# Helix as a sweep path: spring, rectangular coil, cone spring, chained helices; turn limit at other sizes
import time
for p, t, r in [(2, 46, 20), (2, 47, 20), (0.5, 46, 2)]:
    try:
        Helix(p, p * t, r)
        print(f"[12] pitch {p} turns {t} r {r}: ok")
    except Exception as ex:
        print(f"[12] pitch {p} turns {t} r {r} ->", str(ex).splitlines()[0])
path = Helix(pitch=6, height=48, radius=10)
t = time.time()
spring = sweep(Circle(1.2), path)
print(f"[12] spring: valid {spring.is_valid()} volume {spring.volume:.4f} expected pi*1.44*L {math.pi * 1.44 * path.length:.4f} ({time.time() - t:.1f}s)")
print("[12] spring bbox", spring.bbox().min, spring.bbox().max)
coil = sweep(Rectangle(2, 1), Helix(pitch=4, height=12, radius=8))
print("[12] rect coil: valid", coil.is_valid(), "volume", round(coil.volume, 4), "expected", round(2 * Helix(4, 12, 8).length, 4))
cone = sweep(Circle(0.8), Helix(5, 20, 10, end_radius=4))
print("[12] cone spring: valid", cone.is_valid(), "volume", round(cone.volume, 4), "expected ~", round(math.pi * 0.64 * Helix(5, 20, 10, end_radius=4).length, 4))
two = Wire([Helix(4, 12, 8), Helix(4, 12, 8, center=(0, 0, 12))])
t = time.time()
try:
    s2 = sweep(Circle(1), two)
    print(f"[12] two helices: valid {s2.is_valid()} volume {s2.volume:.4f} expected {math.pi * two.length:.4f} solids {len(s2.solids())} ({time.time() - t:.1f}s)")
except Exception as ex:
    print("[12] two helices ->", type(ex).__name__, str(ex).splitlines()[0])
snapshot("springs", spring, coil.translate(30, 0, 0), cone.translate(60, 0, 0), view="iso")
