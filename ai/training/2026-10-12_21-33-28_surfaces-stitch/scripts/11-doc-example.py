import math

h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
walls = []
for e in top.edges():                                  # the top's own boundary curves
    a, b = e.start, e.end
    walls.append(ruled(e, Line((a.x, a.y, 0), (b.x, b.y, 0))))   # same direction as e
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))

block = stitch(top, walls, bottom)
if not isinstance(block, Part):                        # a Shell: something did not close
    free = [e for e in block.edges() if len(e.faces()) == 1]
    raise ValueError(f"{len(free)} free edges, e.g. at {free[0].center()}")
print(block.is_valid(), round(block.volume, 2), len(block.faces()))   # True 23997.28 6
