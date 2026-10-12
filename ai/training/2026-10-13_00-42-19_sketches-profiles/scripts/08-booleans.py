# 2D Booleans: exactness, moved operands, many tools at once, empty results, errors; measures.
import math, random, time
from smlibpy._kernel import k
lens = 2 * 100 * math.acos(0.5) - 5 * math.sqrt(300)
a, b = Circle(10).translate(-5, 0), Circle(10).translate(5, 0)
print("[08] circles 10 apart: & ", round((a & b).area, 6), "+", round((a + b).area, 6), "-", round((a - b).area, 6),
      "^", round((a ^ b).area, 6), "| closed forms", round(lens, 6), round(200 * math.pi - lens, 6),
      round(100 * math.pi - lens, 6), round(2 * (100 * math.pi - lens), 6))
u = Circle(6).rotate(Z, 30).translate(-4, 2) + Slot(30, 8)
c, s = Circle(6).rotate(Z, 30).translate(-4, 2), Slot(30, 8)
print("[08] moved circle + slot:", round(u.area, 6), "expected", round(c.area + s.area - (c & s).area, 6),
      "edges", sorted({e.geom_type for e in u.edges()}))
# random identities through the public operators
random.seed(11)
def rand_shape():
    t = random.choice(["circle", "rect", "slot", "rrect", "poly", "ring"])
    if t == "circle": sh = Circle(random.uniform(2, 10))
    elif t == "rect": sh = Rectangle(random.uniform(3, 20), random.uniform(3, 20))
    elif t == "slot": sh = Slot(random.uniform(12, 30), random.uniform(3, 10))
    elif t == "rrect": sh = Rectangle(random.uniform(10, 20), random.uniform(10, 20), fillet=random.uniform(1, 4))
    elif t == "ring": sh = Circle(8) - Circle(random.uniform(2, 6))
    else:
        n = random.randint(3, 7)
        sh = Polygon(*[(random.uniform(5, 12) * math.cos(2 * math.pi * i / n), random.uniform(5, 12) * math.sin(2 * math.pi * i / n)) for i in range(n)])
    return sh.rotate(Z, random.uniform(0, 360)).translate(random.uniform(-8, 8), random.uniform(-8, 8))
bad, n, t_ops = 0, 60, 0.0
for i in range(n):
    x, y = rand_shape(), rand_shape()
    A, B = x.area, y.area
    t0 = time.perf_counter()
    I, U, D, X = (x & y).area, (x + y).area, (x - y).area, (x ^ y).area
    t_ops += time.perf_counter() - t0
    tol = 2e-6 * max(1, A, B)
    if abs(U - (A + B - I)) > tol or abs(D - (A - I)) > tol or abs(X - (A + B - 2 * I)) > tol:
        bad += 1
print(f"[08] {n} random moved pairs, 4 operations each: {bad} inconsistent, {t_ops / (4 * n) * 1000:.1f} ms per operation")
# many tools
plate = Rectangle(200, 120, fillet=10)
holes = GridLocations(10, 10, 18, 10) * Circle(3)
t0 = time.perf_counter(); r = plate - holes; t1 = time.perf_counter()
print(f"[08] plate - 180 holes in one call: {(t1 - t0) * 1000:.0f} ms, area {r.area:.4f}, closed form "
      f"{200 * 120 - (4 - math.pi) * 100 - 180 * 9 * math.pi:.4f}, holes {len(r.faces()[0].inner_wires())}")
t0 = time.perf_counter(); r2 = plate
for h in holes[:30]:
    r2 = r2 - h
t1 = time.perf_counter()
print(f"[08] the first 30 holes one by one: {(t1 - t0) * 1000:.0f} ms")
bosses = Rectangle(100, 60) + GridLocations(40, 40, 3, 2) * Circle(12)
print("[08] rectangle + 6 overlapping bosses: faces", len(bosses.faces()), "area", round(bosses.area, 4))
# touching, sharing edges, empty
print("[08] squares sharing an edge:", len((Rectangle(10, 10) + Pos(10, 0) * Rectangle(10, 10)).faces()), "face,",
      len((Rectangle(10, 10) + Pos(10, 0) * Rectangle(10, 10)).edges()), "edges")
print("[08] squares touching at a corner:", len((Rectangle(10, 10) + Pos(10, 10) * Rectangle(10, 10)).faces()), "faces")
e1 = Rectangle(10, 10) - Rectangle(20, 20)
e2 = Rectangle(10, 10) & Pos(30, 0) * Rectangle(10, 10)
L = Polygon((0, 0), (20, 0), (20, 5), (5, 5), (5, 20), (0, 20))
e3 = L & Pos(8, 8) * Rectangle(10, 10, align=Align.MIN)
print("[08] empty results:", e1, e2, e3)
print("[08] measures of RoundedRectangle - circle: area", round((Rectangle(40, 20, fillet=4) - Circle(5)).area, 6),
      "perimeter", round((Rectangle(40, 20, fillet=4) - Circle(5)).perimeter, 6),
      "closed form", round(2 * 32 + 2 * 12 + 2 * math.pi * 4 + 10 * math.pi, 6),
      "center", (Rectangle(40, 20) - Pos(10, 0) * Circle(5)).center())
def err(label, f):
    try:
        f(); print(f"[08] {label}: no error")
    except Exception as e:
        print(f"[08] {label}: {type(e).__name__}: {e}")
err("extrude an empty sketch", lambda: e1.extrude(5))
err("center of an empty sketch", lambda: e1.center())
err("sketch + edge", lambda: Rectangle(10, 10) + Line((0, 0), (20, 0)))
err("sketch + part", lambda: Rectangle(10, 10) + Box(1, 1, 1))
err("different planes", lambda: Rectangle(10, 10) + Rectangle(10, 10).translate(0, 0, 5))
