# The open cover (skin + 4 walls): are its normals consistent after stitch? thicken both ways.
import math
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
walls = [ruled(e, Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))) for e in top.edges()]
cover = stitch(top, walls)
c = Vector(30, 20, 5)
for f in cover.faces():
    p = f.interior_point()
    print(f"[07] face at {tuple(round(v, 1) for v in p)} normal·outward {f.normal_at(p).dot((p - c).normalized()):+.2f}")
for t in (1.5, -1.5, 0.5, -0.5):
    try:
        r = cover.thicken(t)
        print(f"[07] thicken({t}): valid {r.is_valid()} vol {r.volume:.2f} bbox {r.bbox().min} {r.bbox().max}")
    except Exception as e:
        print(f"[07] thicken({t}): {type(e).__name__}: {e}")
# the input normals before stitching
print("[07] top normal", top.faces()[0].normal_at((30, 20, 10)))
for w in walls:
    p = w.faces()[0].interior_point()
    print(f"[07] wall at {tuple(round(v, 1) for v in p)} input normal·outward {w.faces()[0].normal_at(p).dot((p - c).normalized()):+.2f}")
