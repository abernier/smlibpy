# recipe: a tray 108 x 68 x 20 outside from a 100 x 60 base with four flanges, then its blank
t, r = 2, 2
tray = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
def base_top_edge(part, axis, last):
    """Top edge of the base plate along `axis`, on the far (last=True) or near side."""
    edges = part.edges().filter_by(axis).filter(lambda e: abs(e.center().z - t) < 1e-6)
    ordered = edges.sort_by(Y if axis is X else X)
    return ordered.last if last else ordered.first
for axis, last in ((Y, True), (Y, False), (X, True), (X, False)):
    tray = tray.flange(base_top_edge(tray, axis, last), 20, radius=r)
print("[13] tray:", tray.bbox().size, "valid:", tray.is_valid(), "bends:", len(tray.bends()))
blank = flat_pattern(tray)
print("[13] blank:", blank.size, "bend lines:", len(blank.bend_lines), [b.direction for b in blank.bends])
# the same box from a cross-shaped blank: corner reliefs larger than half the bend allowance
relief = 3
cross = Rectangle(100, 80)
for sx in (1, -1):
    for sy in (1, -1):
        cross -= Rectangle(20 + relief, 20 + relief).translate(sx * (50 - (20 + relief) / 2), sy * (40 - (20 + relief) / 2))
box = cross.extrude(t)
for line in (Line((-27, 20, t), (27, 20, t)), Line((-27, -20, t), (27, -20, t)),
             Line((30, -17, t), (30, 17, t)), Line((-30, -17, t), (-30, 17, t))):
    box = bend(box, line, 90, radius=r, fixed=(0, 0, 0), partial=True)
print("[13] cross box:", box.bbox().size, "valid:", box.is_valid(), "half BA:", round(bend_allowance(90, radius=r, thickness=t) / 2, 4))
snapshot("boxes", tray, box.translate(130, 0, 0), view="iso")
