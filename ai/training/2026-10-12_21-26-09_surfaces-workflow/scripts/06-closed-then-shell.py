# Route 2: close the freeform skin into a solid, then hollow it with Part.shell; compare with
# thickening an open stitched shell (skin + walls, no bottom).
import math
h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
walls = [ruled(e, Line((e.start.x, e.start.y, 0), (e.end.x, e.end.y, 0))) for e in top.edges()]
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))
block = stitch(top, walls, bottom)
print("[06] block:", type(block).__name__, round(block.volume, 2))
try:
    hollow = block.shell(-1.5, openings=block.faces().bottom())
    print("[06] block.shell(-1.5, bottom open): valid", hollow.is_valid(), "vol", round(hollow.volume, 2), "bbox", hollow.bbox().min, hollow.bbox().max)
except Exception as e:
    print("[06] block.shell:", type(e).__name__, e)
    hollow = None
try:
    hollow2 = block.shell(1.5, openings=block.faces().bottom())
    print("[06] block.shell(+1.5): valid", hollow2.is_valid(), "vol", round(hollow2.volume, 2), "bbox", hollow2.bbox().min, hollow2.bbox().max)
except Exception as e:
    print("[06] block.shell(+1.5):", type(e).__name__, e)
cover = stitch(top, walls)                      # open at the bottom
print("[06] cover:", type(cover).__name__, "free", sum(1 for e in cover.edges() if len(e.faces()) == 1),
      "top normal", cover.faces().sort_by(Z)[-1].normal_at((30, 20, 10)))
t = cover.thicken(-1.5)
print("[06] cover.thicken(-1.5): valid", t.is_valid(), "vol", round(t.volume, 2), "bbox", t.bbox().min, t.bbox().max)
if hollow is not None:
    print("[06] difference of the two hollow bodies:", round(abs(hollow.volume - t.volume), 3))
    snapshot("hollow", hollow, view="bottom")
