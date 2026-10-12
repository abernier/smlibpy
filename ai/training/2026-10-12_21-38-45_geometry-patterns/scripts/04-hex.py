# HexLocations: spacing, counts, layout, centering
H = HexLocations(10, 3, 2)
pts = [tuple(round(c, 4) for c in p)[:2] for p in H.points]
print("[04] 3x2 points:", pts)
Hu = HexLocations(10, 3, 2, centered=False)
print("[04] centered=False:", [tuple(round(c, 4) for c in p)[:2] for p in Hu.points])
# nearest-neighbour distances
P = HexLocations(6, 5, 4).points
d = sorted({round(P[i].distance_to(P[j]), 4) for i in range(len(P)) for j in range(i + 1, len(P))})[:3]
print("[04] 5x4 count", len(P), "smallest distances:", d)
b = BoundBox.of_points(P)
print("[04] 5x4 bbox of points:", b, "centroid of points:", sum(P, Vector()) / len(P))
print("[04] row spacing dy:", round(6 * math.sqrt(3) / 2, 4))
print("[04] rotations:", {tuple(l.rotation) for l in HexLocations(6, 5, 4)})
print("[04] 0 counts:", len(HexLocations(6, 0, 4)), len(HexLocations(6, 3, 0)), "negative:", len(HexLocations(6, -1, 2)))
print("[04] 1x1:", HexLocations(6, 1, 1).points)
# honeycomb: hex cells of across-flats f with wall w -> spacing f + w, RegularPolygon radius = f/2 inscribed, rotated 30 so flats face the neighbours
f, w = 8, 1.5
cells = HexLocations(f + w, 6, 5) * RegularPolygon(f / 2, 6, inscribed=True, rotation=30)
plate = Box(70, 50, 4) - [c.extrude(10).translate(0, 0, -5) for c in cells]
print("[04] honeycomb plate: valid", plate.is_valid(), "solids", len(plate.solids()), "faces", len(plate.faces()))
# wall thickness between two neighbours along x
c0, c1 = cells[0], cells[1]
gap = c1.bbox().min.x - c0.bbox().max.x
print("[04] wall along x between cells 0 and 1:", round(gap, 4), "cell bbox", c0.bbox().size)
snapshot("honeycomb", plate, view="top")
# the concepts.md example
hc = HexLocations(6, 5, 4) * RegularPolygon(3, 6)
print("[04] concepts example: count", len(hc), "overlap?", any(hc[i].bbox().max.x > hc[i + 1].bbox().min.x + 1e-9 for i in range(4)))
snapshot("concepts", Rectangle(1, 1).translate(100, 0), view="top") if False else None
