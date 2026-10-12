# The free-edge report of the doc example when one wall is missing.
import math
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
walls = []
for e in top.edges():
    a, b = e.start, e.end
    walls.append(ruled(e, Line((a.x, a.y, 0), (b.x, b.y, 0))))
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
block = stitch(top, walls[1:], bottom)
free = [e for e in block.edges() if len(e.faces()) == 1]
print("[12]", type(block).__name__, len(free), [tuple(round(c, 2) for c in e.center()) for e in free])
