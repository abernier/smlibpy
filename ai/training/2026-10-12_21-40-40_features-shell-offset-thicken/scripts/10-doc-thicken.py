panel = Rectangle(20, 10).thicken(2)                    # along the sketch normal: z 0..2
under = Rectangle(20, 10).thicken(-2)                   # z -2..0
box = Box(40, 30, 20)
skin = thicken(box.faces().top()[0], 3)                 # face normal points out: z 10..13

arc_sheet = extrude(CenterArc((0, 0), 10, 0, 180), 20)  # a half-cylinder surface (Shell)
print(arc_sheet.faces()[0].normal_at((0, 10, 10)).to_tuple())   # (0, 1, 0): points away from the axis
wall = arc_sheet.thicken(2)                             # outside: radii 10..12
print(round(wall.volume, 2))                            # 1382.3 = pi*(12^2 - 10^2)/2 * 20
