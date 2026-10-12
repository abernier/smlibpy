# claims in the pattern docs
P = PolarLocations(20, 4) * Pos(5, 0, 0)
print("[09] Polar*Pos(5): type", type(P).__name__, [tuple(round(c, 3) for c in l.position) for l in P])
G = GridLocations(10, 10, 2, 1) * Pos(0, 0, 10) * Box(1, 1, 1)
print("[09] Grid*Pos(0,0,10)*Box:", type(G).__name__, [x.center() for x in G])
f = 8; w = 1.5
c0 = (HexLocations(f + w, 2, 1) * RegularPolygon(f / 2, 6, inscribed=True))
gap0 = c0[1].bbox().min.x - c0[0].bbox().max.x
print("[09] hex without rotation=30: x gap", round(gap0, 4), "vertex at +x:", round(c0[0].bbox().max.x - c0[0].center().x, 4))
c1 = HexLocations(f + w, 2, 2) * RegularPolygon(f / 2, 6, inscribed=True, rotation=30)
# diagonal neighbour wall: distance between cells 0 and 2 (row 2)
d = c1[0].extrude(1).distance_to(c1[2].extrude(1))
print("[09] hex rotation=30 diagonal wall:", round(d, 4))
d0 = c0[0].extrude(1).distance_to(c0[1].extrude(1))
print("[09] hex rotation=0 x-neighbour wall:", round(d0, 4))
