# Is the thickened volume the same from run to run? Print full precision, repeat in-process too.
import math
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
skin = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
mid = Vector(30, 20, 5)
walls = []
for e in skin.edges():
    floor = Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))
    w = ruled(e, floor)
    p = w.faces()[0].interior_point()
    if w.faces()[0].normal_at(p).dot(p - mid) < 0:
        w = ruled(floor, e)
    walls.append(w)
cover = stitch(skin, walls)
wall = cover.thicken(-1.5)
print("[12] same body, volume x3:", [repr(wall.volume) for _ in range(3)])
print("[12] accurate:", repr(wall.mass_properties(accuracy=1e-10).volume))
print("[12] new thicken x3:", [repr(cover.thicken(-1.5).volume) for _ in range(3)])
print("[12] skin.thicken x3:", [repr(skin.thicken(-1.5).volume) for _ in range(3)])
