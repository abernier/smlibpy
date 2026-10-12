# recipe: the flat pattern for a laser cutter
t, r = 1.5, 1.5
part = Box(120, 50, t, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10)
part = part.flange(part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6).last, 25, radius=r)
part = part.flange(part.edges().filter_by(Y).filter(lambda e: abs(e.center().z - t) < 1e-6).first, 25, radius=r,
                   angle=-90)
pattern = flat_pattern(part)
print("[14]", pattern)
print("[14] contour:", [(len(w.edges()), sorted({e.geom_type for e in w.edges()})) for w in pattern.outline.faces()[0].wires()])
for b in pattern.bends:
    print(f"[14] bend {b.direction} {b.angle:g} deg R{b.radius:g} at x = {b.line.start.x:.4f}, BA {b.allowance:.4f}")
export_step(pattern.part, "flat.step")
print("[14] flat.step written; outline z:", pattern.outline.bbox().min.z, pattern.outline.bbox().max.z)
snapshot("part", part, view="iso")
snapshot("pattern", pattern.part, view="top")
