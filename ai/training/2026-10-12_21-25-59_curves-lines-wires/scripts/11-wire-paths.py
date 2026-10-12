# Wires as sweep paths and open-curve extrusions
path = Polyline((0, 0, 0), (0, 0, 30), (30, 0, 30))
pipe = sweep(Circle(3), path)
print("[11] polyline path: valid", pipe.is_valid(), "volume", round(pipe.volume, 3), "bbox", pipe.bbox().min, pipe.bbox().max)
rounded = FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8)
pipe2 = sweep(Circle(3), rounded)
L = rounded.length
print("[11] fillet path: valid", pipe2.is_valid(), "volume", round(pipe2.volume, 3), "expected pi*9*L", round(math.pi * 9 * L, 3))
# a mixed path built with Wire([...]) from edges given out of order
mixed = Wire([Line((20, 0, 30), (40, 0, 30)), Line((0, 0, 0), (0, 0, 10)), CenterArc((10, 0), 10, 180, -90, plane=Plane.XZ).translate(0, 0, 0)])
print("[11] arc on XZ:", mixed.edges()[1] if len(mixed.edges()) > 1 else None)
print("[11] mixed:", mixed, mixed.start, mixed.end)
# open wire extrudes to a Shell
wall = extrude(Polyline((0, 0), (20, 0), (20, 10)), 5)
print("[11] open wire extrude:", type(wall).__name__, "area", round(wall.area, 4) if hasattr(wall, "area") else None, "bbox", wall.bbox().min, wall.bbox().max)
# closed wire extrudes to a Part
blk = extrude(Polyline((0, 0), (20, 0), (20, 10), close=True), 5)
print("[11] closed wire extrude:", type(blk).__name__, round(blk.volume, 4))
# a path with a gap
gap_path = Wire([Line((0, 0, 0), (0, 0, 10)), Line((0, 0, 20), (0, 0, 30))])
try:
    g = sweep(Circle(1), gap_path)
    print("[11] gap path: valid", g.is_valid(), "volume", round(g.volume, 3), "solids", len(g.solids()))
except Exception as ex:
    print("[11] gap path ->", type(ex).__name__, ex)
snapshot("pipes", pipe, pipe2.translate(50, 0, 0), view="front")
