t, r = 2, 2
tray = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
def base_edge(part, axis, last):
    """A top edge of the base plate (z = t) along axis, on the far (last) or near side."""
    edges = part.edges().filter_by(axis).filter(lambda e: abs(e.center().z - t) < 1e-6)
    ordered = edges.sort_by(Y if axis is X else X)
    return ordered.last if last else ordered.first
for axis, last in ((Y, True), (Y, False), (X, True), (X, False)):
    tray = tray.flange(base_edge(tray, axis, last), 20, radius=r)
print(tray.bbox().size, len(tray.bends()))                     # Vector(108, 68, 20) 4
