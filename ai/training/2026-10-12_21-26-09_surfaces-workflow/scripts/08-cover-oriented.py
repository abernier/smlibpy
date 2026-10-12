# Orient the walls before stitching (normal pointing away from the middle), then thicken the open cover.
import math
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
mid = Vector(30, 20, 5)
walls = []
for e in top.edges():
    floor = Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))
    w = ruled(e, floor)
    p = w.faces()[0].interior_point()
    if w.faces()[0].normal_at(p).dot(p - mid) < 0:     # points inward: swap the curves
        w = ruled(floor, e)
    walls.append(w)
cover = stitch(top, walls)                              # open at the bottom: a Shell
for f in cover.faces():
    p = f.interior_point()
    print(f"[08] normal·outward {f.normal_at(p).dot((p - mid).normalized()):+.2f}")
for t in (-1.5, 1.5):
    try:
        r = cover.thicken(t)
        print(f"[08] thicken({t}): valid {r.is_valid()} vol {r.volume:.2f} bbox {r.bbox().min} {r.bbox().max}")
    except Exception as e:
        print(f"[08] thicken({t}): {type(e).__name__}: {e}")
hollow = cover.thicken(-1.5)
block = stitch(top, walls, make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True)))
ref = block.shell(-1.5, openings=block.faces().bottom())
print("[08] Part.shell reference vol", round(ref.volume, 2), "difference", round(hollow.volume - ref.volume, 3))
snapshot("cover", hollow, view="bottom")
