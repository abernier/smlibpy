plate = Box(80, 60, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
top = plate.faces().top()
front = plate.faces().front()
plate -= (GridLocations(60, 40, 2, 2) * CounterBoreHole(3.3, 5.5, 3.5, 10)).on(top)   # M6 socket head, through
plate -= (GridLocations(30, 1, 2, 1) * CounterSinkHole(1.6, 3.2, 8)).on(front)        # M3 flat head, 8 deep
plate -= Hole(10, 4).on(top)                                                          # blind pocket, 4 deep
print("[10] plate:", plate, "valid:", plate.is_valid(), "solids:", len(plate.solids()))
print("[10] bbox:", plate.bbox())
axes = sorted((round(f.axis.origin.x, 4), round(f.axis.origin.y, 4), round(f.radius, 2), tuple(round(c, 3) for c in f.axis.direction.to_tuple()))
              for f in plate.faces().cylinders())
for a in axes:
    print("[10] cyl axis (x, y, r, dir):", a)
centers = sorted((round(f.center().x, 4), round(f.center().y, 4)) for f in plate.faces().cylinders() if abs(f.radius - 3.3) < 1e-6)
print("[10] M6 hole face centers:", centers)
snapshot("plate", plate, view="sheet")
