t, r = 2, 2                                                     # sheet thickness, inside bend radius
plate = Box(100, 60, t, align=(Align.CENTER, Align.CENTER, Align.MIN))   # base flange: a plate on XY
part = plate.flange(plate.edges().filter_by(Y).filter(lambda e: e.center().z > t / 2).last, 25, radius=r)
part = part.bend(Axis((-20, 0, t), (0, 1, 0)), 90, radius=r)          # fold the -X end up as well
print(part.is_valid(), part.bbox().size, len(part.bends()))
ba = bend_allowance(90, radius=r, thickness=t)                     # 4.5239 with the default K 0.44
pattern = part.flat_pattern()
print(pattern.size, [b.direction for b in pattern.bends], round(ba, 4))
