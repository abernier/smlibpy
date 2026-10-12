# Happy path of every surface API: types, counts, area, bbox.
import math
grid = [[(x, y, 5 * math.sin(x / 12) * math.cos(y / 12)) for x in range(0, 61, 10)]
        for y in range(0, 41, 10)]
terrain = surface(grid)
print("[01] surface:", terrain, type(terrain).__name__)
print("[01] faces/edges/verts:", len(terrain.faces()), len(terrain.edges()), len(terrain.vertices()))
print("[01] bbox:", terrain.bbox().min, terrain.bbox().max)
print("[01] geom_type:", terrain.faces()[0].geom_type)
print("[01] info:", terrain.info())

twist = ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 20, 10), (20, 20, -10)))
print("[01] ruled:", twist, twist.bbox().min, twist.bbox().max)

box = Box(10, 10, 10)
sheets = [f.to_shell() for f in box.faces()]
print("[01] sheets:", [type(s).__name__ for s in sheets][:2], len(sheets))
solid = stitch(sheets)
print("[01] stitch:", type(solid).__name__, solid)
if isinstance(solid, Part):
    print("[01] volume, valid:", round(solid.volume, 6), solid.is_valid())

panel = terrain.thicken(2)
print("[01] thicken:", type(panel).__name__, round(panel.volume, 3), panel.is_valid())
print("[01] area*2:", round(terrain.area * 2, 3))
print("[01] panel bbox:", panel.bbox().min, panel.bbox().max)
snapshot("all", terrain, twist.translate(80, 0, 0), panel.translate(0, 60, 0))
