# Realistic: freeform top + ruled side walls down to z=0 + flat bottom -> closed solid.
import math
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
walls = []
for e in top.edges():
    a, b = e.start, e.end
    floor = Line((a.x, a.y, 0), (b.x, b.y, 0))       # same direction as the top edge
    walls.append(ruled(e, floor))
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
block = stitch(top, walls, bottom)
print(type(block).__name__, block.is_valid(), round(block.volume, 2), len(block.faces()))
# reference: volume = integral of h over the rectangle
xs, ys = np.linspace(0, 60, 601), np.linspace(0, 40, 401)
ref = np.trapezoid([[h(x, y) for x in xs] for y in ys], xs, axis=1)
ref = np.trapezoid(ref, ys)
print("[09] reference volume (numerical integral of h):", round(float(ref), 2))
print("[09] bbox", block.bbox().min, block.bbox().max)
snapshot("block", block, view="sheet")
