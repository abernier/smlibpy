# flat_pattern(): the blank on XY, outline sketch and bend lines
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(4, 10).translate(-30, 0, 0)
part = bend(blank, Axis((-15, 0, 2), (0, 1, 0)), 90, radius=2)
part = bend(part, Axis((30, 0, 2), (0, 1, 0)), -90, radius=2)
pattern = flat_pattern(part)
print("[07]", pattern)
print("[07] part bbox:", pattern.part.bbox(), "volume:", round(pattern.part.volume, 6), "blank:", round(blank.volume, 6))
print("[07] outline:", pattern.outline, "plane z:", pattern.outline.plane.origin.z,
      "loops:", [len(w.edges()) for f in pattern.outline.faces() for w in f.wires()])
for b in pattern.bends:
    print(f"[07] bend {b.direction}: angle {b.angle:g} radius {b.radius:g} allowance {b.allowance:.6f} line {b.line.start} -> {b.line.end}")
print("[07] bend_lines:", pattern.bend_lines)
print("[07] size:", pattern.size)
inplace = unfold(part)
print("[07] unfold in place bbox:", inplace.bbox())
snapshot("pattern", pattern.part, view="top")
snapshot("part", part, view="iso")
