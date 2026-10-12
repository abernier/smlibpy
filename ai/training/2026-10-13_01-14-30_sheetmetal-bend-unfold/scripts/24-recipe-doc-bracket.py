t, r = 2, 2                                                    # 2 mm sheet, inside radius 2
length = developed_length(60, 40, radius=r, thickness=t)       # outside legs 60 and 40 -> 96.5239
blank = Box(length, 30, t, align=Align.MIN)                    # x = 0..length, z = 0..t
blank -= [Cylinder(3, 10).translate(x, 15, 0) for x in (15, 45)]             # holes in the 60 leg
blank -= [Cylinder(3, 10).translate(length - x, 15, 0) for x in (12, 28)]    # holes in the 40 leg
line_x = 60 - (r + t) + bend_allowance(90, radius=r, thickness=t) / 2        # middle of the bend zone
bracket = bend(blank, Axis((line_x, 0, t), (0, 1, 0)), 90, radius=r, fixed=(0, 0, 0))
print(bracket.is_valid(), round(bracket.bbox().size.x, 6), round(bracket.bbox().size.z, 6))   # True 60.0 40.0
