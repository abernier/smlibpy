# recipe: an L bracket 60 x 40 outside, 30 wide, 2 thick, R 2, two holes in each leg
t, r = 2, 2
length = developed_length(60, 40, radius=r, thickness=t)      # outside legs -> blank length
blank = Box(length, 30, t, align=Align.MIN)
blank -= [Cylinder(3, 10).translate(x, 15, 0) for x in (15, 45)]           # holes in the 60 leg
blank -= [Cylinder(3, 10).translate(length - x, 15, 0) for x in (12, 28)]  # holes in the 40 leg
bend_x = 60 - (r + t) + bend_allowance(90, radius=r, thickness=t) / 2      # middle of the bend zone
bracket = bend(blank, Axis((bend_x, 0, t), (0, 1, 0)), 90, radius=r, fixed=(0, 0, 0))
bb = bracket.bbox()
print("[12] blank length:", round(length, 6), "bend line at x =", round(bend_x, 6))
print("[12] outside:", round(bb.size.x, 6), "x", round(bb.size.z, 6), "valid:", bracket.is_valid())
holes = sorted({(round(e.arc_center.x, 4), round(e.arc_center.z, 4)) for e in bracket.edges().circles()
                if abs(e.radius - 3) < 1e-9})
print("[12] hole centers (x, z) on both faces:", holes)
pattern = flat_pattern(bracket)
print("[12] pattern:", pattern, "volume", round(pattern.part.volume, 6), "blank", round(blank.volume, 6))
snapshot("bracket", bracket, view="iso")
