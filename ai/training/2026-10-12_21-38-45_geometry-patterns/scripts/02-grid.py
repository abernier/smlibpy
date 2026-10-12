# GridLocations: spacing, counts, centering, order, holes
g = GridLocations(20, 10, 3, 2)
print("[02] 3x2 points (order):", [tuple(p)[:2] for p in g.points])
gu = GridLocations(20, 10, 3, 2, centered=False)
print("[02] centered=False:", [tuple(p)[:2] for p in gu.points])
print("[02] 1x1:", GridLocations(20, 10, 1, 1).points)
print("[02] 4x1:", [p.x for p in GridLocations(5, 99, 4, 1).points])
print("[02] negative spacing:", [tuple(p)[:2] for p in GridLocations(-10, 10, 2, 2).points])
print("[02] zero spacing:", [tuple(p)[:2] for p in GridLocations(0, 0, 2, 2).points])
for bad in [(10, 10, 0, 2), (10, 10, 2, -1)]:
    try:
        GridLocations(*bad)
    except Exception as e:
        print("[02] GridLocations", bad, "->", type(e).__name__, e)
try:
    print("[02] float count:", len(GridLocations(10, 10, 2.5, 2)))
except Exception as e:
    print("[02] float count ->", type(e).__name__, e)
# rotations? all identity
print("[02] rotations:", {tuple(l.rotation) for l in g})
# holes in a plate: 4 corner holes
plate = Box(80, 60, 10)
plate2 = plate - GridLocations(60, 40, 2, 2) * Cylinder(4, 10)
print("[02] plate holes: faces", len(plate2.faces()), "vol diff", round(plate.volume - plate2.volume, 4), "expected", round(4 * math.pi * 16 * 10, 4))
hole_faces = plate2.faces().cylinders()
print("[02] hole centers:", sorted((round(f.axis.origin.x, 3), round(f.axis.origin.y, 3)) for f in hole_faces))
# exact-length tool: coplanar ends; is it clean?
print("[02] valid", plate2.is_valid(), "solids", len(plate2.solids()))
# holes on top face with Hole
top = plate.faces().top()
p3 = plate - (GridLocations(60, 40, 2, 2) * Hole(3, 6)).on(top)
print("[02] blind holes: vol diff", round(plate.volume - p3.volume, 4), "expected", round(4 * math.pi * 9 * 6, 4), "bbox", p3.bbox())
# on a side face: grid x,y follow face local axes
side = plate.faces().front()
p4 = plate - (GridLocations(40, 4, 3, 1) * Hole(1.5, 5)).on(side)
print("[02] side holes centers:", sorted((round(f.axis.origin.x, 2), round(f.axis.origin.y, 2), round(f.axis.origin.z, 2)) for f in p4.faces().cylinders()))
# combine with Pos offset per copy
p5 = GridLocations(30, 1, 2, 1) * Pos(0, 10) * Circle(2)
print("[02] Grid*Pos*Circle:", [c.center() for c in p5])
# sketch pattern subtraction
sk = Rectangle(60, 40) - GridLocations(44, 24, 2, 2) * Circle(2.5)
print("[02] sketch minus grid: area", round(sk.area, 4), "expected", round(2400 - 4 * math.pi * 6.25, 4), "faces", len(sk.faces()))
snapshot("plate", plate2, view="top")
snapshot("side", p4, view="front")
