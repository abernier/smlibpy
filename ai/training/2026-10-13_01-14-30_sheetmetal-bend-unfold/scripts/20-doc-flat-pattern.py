part = Box(120, 50, 1.5, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10)
edges = part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - 1.5) < 1e-6)
part = part.flange(edges.last, 25, radius=1.5)
part = part.flange(part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - 1.5) < 1e-6).first, 25,
                   radius=1.5, angle=-90)
pattern = flat_pattern(part)
print(pattern)
print([(len(w.edges()), sorted({e.geom_type for e in w.edges()})) for w in pattern.outline.faces()[0].wires()])
for b in pattern.bends:
    print(b.direction, b.angle, b.radius, round(b.allowance, 4), b.line)
export_step(pattern.part, "flat.step")                    # the blank as a solid
