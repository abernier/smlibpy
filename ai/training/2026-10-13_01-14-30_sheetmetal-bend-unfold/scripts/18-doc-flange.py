t, r = 2, 2
tray = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
for axis, last in ((Y, True), (Y, False), (X, True), (X, False)):
    top_edges = tray.edges().filter_by(axis).filter(lambda e: abs(e.center().z - t) < 1e-6)  # base plate's top edges
    ordered = top_edges.sort_by(Y if axis is X else X)
    tray = tray.flange(ordered.last if last else ordered.first, 20, radius=r)
print(tray.bbox().size, tray.is_valid())                 # 100 + 2 * (r + t) by 60 + 2 * (r + t) by 20
