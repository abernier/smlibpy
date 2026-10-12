# a tray: four flanges on a plate; outside = plate + 2 * (radius + t)
t, r = 2, 2
tray = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))
def base_edge(part, axis, side):
    """The top edge of the base plate on one side (side: "min" or "max" along the other axis)."""
    edges = part.edges().filter_by(axis).filter(lambda e: abs(e.center().z - t) < 1e-6)
    return edges.sort_by(Y if axis is X else X)[0 if side == "min" else -1]
for axis, side in ((Y, "max"), (Y, "min"), (X, "max"), (X, "min")):
    tray = tray.flange(base_edge(tray, axis, side), 20, radius=r)
print("[06] tray valid:", tray.is_valid(), "size:", tray.bbox().size, "bends:", len(tray.bends()))
pattern = flat_pattern(tray)
print("[06] pattern:", pattern, "volume:", round(pattern.part.volume, 6))
print("[06] directions:", [b.direction for b in pattern.bends])
print("[06] lines:", [(round(b.line.start.x, 4), round(b.line.start.y, 4), round(b.line.end.x, 4), round(b.line.end.y, 4)) for b in pattern.bends])
snapshot("tray", tray, view="iso")
snapshot("pattern", pattern.part, view="top")
