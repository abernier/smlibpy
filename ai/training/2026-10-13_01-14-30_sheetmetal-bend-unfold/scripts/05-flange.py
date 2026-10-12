# flange(): extend an outer edge and bend it there
plate = Box(100, 60, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
edge = plate.edges().filter_by(Y).filter(lambda e: e.center().z > 1).sort_by(X).last
print("[05] edge:", edge)
for angle in (90, 45, 120, -90):
    p = flange(plate, edge, 20, angle=angle, radius=2)
    print(f"[05] angle {angle}: valid {p.is_valid()} bbox {p.bbox()} bends {p.bends()}")
p = plate.flange(edge, 20, radius=2)
print("[05] method:", p.bbox().max)
for bad in (dict(length=3), dict(length=20, angle=180)):
    try:
        flange(plate, edge, bad.pop("length"), radius=2, **bad)
    except (ModelingError, ValueError) as e:
        print("[05]", type(e).__name__, e)
try:
    flange(plate, plate.edges().filter_by(Y), 20, radius=2)
except ValueError as e:
    print("[05]", e)
snapshot("flanges", flange(plate, edge, 20, radius=2), view="iso")
