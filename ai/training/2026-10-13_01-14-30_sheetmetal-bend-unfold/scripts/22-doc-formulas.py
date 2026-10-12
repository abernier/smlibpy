t, r = 2, 2
print(round(bend_allowance(90, radius=r, thickness=t), 6))               # pi/2 * (2 + 0.44 * 2)
print(round(bend_deduction(90, radius=r, thickness=t), 6))               # 2 * (r + t) - BA
blank_length = developed_length(60, 40, radius=r, thickness=t)           # outside legs 60 and 40
print(round(blank_length, 6))
u_length = developed_length(20, 50, 20, angle=[90, 90], radius=r, thickness=t)
print(round(u_length, 6))
blank = Box(blank_length, 30, t, align=Align.MIN)
line_x = 60 - (r + t) + bend_allowance(90, radius=r, thickness=t) / 2     # middle of the bend zone
bracket = bend(blank, Axis((line_x, 0, t), (0, 1, 0)), 90, radius=r, fixed=(0, 0, 0))
print(round(bracket.bbox().size.x, 6), round(bracket.bbox().size.z, 6))  # 60 x 40 outside
