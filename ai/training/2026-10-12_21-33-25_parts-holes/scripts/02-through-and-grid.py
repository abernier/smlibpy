part = Box(60, 40, 10)
top = part.faces().top()
for d in [10, 10.0001, 12, 100]:
    p = part - Hole(3, d).on(top)
    print("[02] depth", d, "faces:", len(p.faces()), "valid:", p.is_valid(), "removed:", round(part.volume - p.volume, 4),
          "through-area expected:", round(math.pi * 9 * 10, 4))
grid = part - (GridLocations(40, 20, 2, 2) * Hole(2, 10)).on(top)
centers = sorted((round(f.center().x, 3), round(f.center().y, 3)) for f in grid.faces().cylinders())
print("[02] grid holes at:", centers, "faces:", len(grid.faces()), "valid:", grid.is_valid())
# non-square grid: is x along world X?
g2 = part - (GridLocations(40, 10, 3, 1) * Hole(2, 10)).on(top)
print("[02] 3x1 grid on top:", sorted((round(f.center().x, 3), round(f.center().y, 3)) for f in g2.faces().cylinders()))
# Pos offsets on the face
off = part - (Pos(20, 10) * Hole(2, 10)).on(top)
print("[02] Pos(20,10) on top:", [(round(f.center().x, 3), round(f.center().y, 3)) for f in off.faces().cylinders()])
# the same without .on(): Hole at the origin points down from z=0 (part center)
mid = part - Hole(2, 10)
print("[02] without on(): cyl z range:", [(round(f.bbox().min.z, 3), round(f.bbox().max.z, 3)) for f in mid.faces().cylinders()],
      "valid:", mid.is_valid(), "solids:", len(mid.solids()))
snapshot("grid", grid, view="top")
