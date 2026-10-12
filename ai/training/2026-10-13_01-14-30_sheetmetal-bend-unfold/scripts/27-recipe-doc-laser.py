t, r = 1.5, 1.5
part = Box(120, 50, t, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10)
top_edges = part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6)
part = part.flange(top_edges.last, 25, radius=r)                       # up at +X
top_edges = part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6)
part = part.flange(top_edges.first, 25, radius=r, angle=-90)          # down at -X
pattern = flat_pattern(part)
print(pattern)                                                  # FlatPattern(170.786 x 50, ..., 2 bends, ...)
for b in pattern.bends:
    print(b.direction, round(b.line.start.x, 4), round(b.allowance, 4))    # down 23.6965 3.3929, up 147.0894 3.3929
print([e.geom_type for e in pattern.outline.edges()])          # ['line', 'line', 'line', 'line', 'circle']
export_step(pattern.part, "blank.step")
