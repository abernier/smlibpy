# Bad and unusual inputs: ragged rows, 2D points, numpy, Vectors, NaN, duplicate rows, folded grid.
import math, time
def tryit(label, fn):
    try:
        r = fn()
        print(f"[09] {label}: ok {r}")
        return r
    except Exception as e:
        print(f"[09] {label}: {type(e).__name__}: {e}")
base = [[(10 * i, 10 * j, (i - 2) * (j - 2)) for i in range(5)] for j in range(5)]
tryit("ragged rows", lambda: surface([row[:4] if j == 2 else row for j, row in enumerate(base)]))
tryit("2D points", lambda: surface([[(10 * i, 10 * j) for i in range(5)] for j in range(5)]))
tryit("numpy array", lambda: surface(np.array(base, dtype=float)))
tryit("Vectors", lambda: surface([[Vector(*p) for p in row] for row in base]))
tryit("flat list", lambda: surface([p for row in base for p in row]))
nan = [list(r) for r in base]; nan[2][2] = (20, 20, float("nan"))
tryit("NaN point", lambda: surface(nan))
dup = [list(r) for r in base]; dup[2] = dup[1]
tryit("two equal rows", lambda: surface(dup))
dpt = [list(r) for r in base]; dpt[2][2] = dpt[2][1]
tryit("two equal points in a row", lambda: surface(dpt))
# folded: row 3 goes back behind row 2
fold = [list(r) for r in base]; fold[3] = [(x, 5, z) for (x, y, z) in fold[3]]
s = tryit("folded rows (y=0,10,20,5,40)", lambda: surface(fold))
uneven = [[(x, y, 0.01 * x * y) for x in (0, 1, 2, 30, 60)] for y in (0, 10, 20, 30, 40)]
s2 = tryit("very uneven spacing", lambda: surface(uneven))
if s2 is not None:
    print("[09]   uneven bbox", s2.bbox().min, s2.bbox().max, "max dev", max(s2.distance_to(p) for r in uneven for p in r))
t0 = time.time()
big = [[(i, j, math.sin(i / 7) * math.cos(j / 9)) for i in range(100)] for j in range(100)]
b = tryit("100x100", lambda: surface(big))
print(f"[09] 100x100 time {time.time() - t0:.2f}s")
t0 = time.time(); tryit("100x100 thicken", lambda: b.thicken(0.5).volume); print(f"[09] thicken time {time.time()-t0:.2f}s")
