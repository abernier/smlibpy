base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))     # z 0..8
post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
part = base + post
print(part.bbox())                    # z 0..28

corner = Box(10, 10, 10, align=Align.MIN)                  # x, y, z all 0..10
under = Box(10, 10, 10, align=(None, None, Align.MAX))     # centered in x, y; z -10..0
print(corner.bbox(), under.bbox())

tab = Rectangle(20, 6, align=(Align.CENTER, Align.MIN))    # sketches: x and y only
print(tab.bbox())                     # y 0..6
tri = RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER))   # bbox centered
print(tri.bbox())
