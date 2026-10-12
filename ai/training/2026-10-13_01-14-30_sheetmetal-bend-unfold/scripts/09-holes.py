# holes: in a flange they stay exact; across the bend zone they become NURBS
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
holed = blank - Cylinder(5, 10).translate(35, 0, 0)
part = bend(holed, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)
print("[09] hole in flange:", sorted({f.geom_type for f in part.faces()}), "volume", round(part.volume, 6))
flat = flat_pattern(part)
print("[09] flat:", flat.size, "outline edges:", [e.geom_type for f in flat.outline.faces() for e in f.edges()])
across = blank - Cylinder(5, 10).translate(20, 0, 0)
part2 = bend(across, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)
print("[09] hole across the bend:", sorted({f.geom_type for f in part2.faces()}), "valid", part2.is_valid())
flat2 = unfold(part2)
print("[09] unfolded: volume (kernel)", round(flat2.volume, 6), "mesh", round(flat2.mesh(0.001).volume, 4),
      "exact", round(8000 - math.pi * 25 * 2, 4))
snapshot("hole", part, part2.translate(0, 60, 0), view="iso")
