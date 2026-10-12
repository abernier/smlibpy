import math

# 1. Faces. The skin: rows along y stacked in x, so its normal points up (+Z).
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
skin = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
print(skin.faces()[0].normal_at((30, 20, 10)))                    # ~(0, 0, 1)

# Walls from the skin's own edges (so they meet exactly), turned to point outward.
mid = Vector(30, 20, 5)
walls = []
for e in skin.edges():
    floor = Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))
    w = ruled(e, floor)
    p = w.faces()[0].interior_point()
    if w.faces()[0].normal_at(p).dot(p - mid) < 0:
        w = ruled(floor, e)
    walls.append(w)

# 2a. Closed solid: add a bottom and stitch.
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
block = stitch(skin, walls, bottom)
assert isinstance(block, Part) and block.is_valid()
print(round(block.volume, 2))                                     # 23997.28

# 2b. Open cover: stitch without the bottom, check the free edges, thicken inward.
cover = stitch(skin, walls)
free = [e for e in cover.edges() if len(e.faces()) == 1]
print(type(cover).__name__, len(free))                            # Shell 4 (the bottom rim)
wall = cover.thicken(-1.5)
assert wall.is_valid() and wall.volume > 0
print(round(wall.volume, 1))                                      # 6134.8, same as block.shell(-1.5, ...)
