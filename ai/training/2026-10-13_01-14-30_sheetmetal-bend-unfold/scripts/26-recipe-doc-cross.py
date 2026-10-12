t, r, relief = 2, 2, 3                       # corner reliefs above half the allowance (2.26)
cross = Rectangle(100, 80)
for sx in (1, -1):
    for sy in (1, -1):
        cross -= Rectangle(20 + relief, 20 + relief).translate(sx * (50 - (20 + relief) / 2),
                                                               sy * (40 - (20 + relief) / 2))
box = cross.extrude(t)
for line in (Line((-27, 20, t), (27, 20, t)), Line((-27, -20, t), (27, -20, t)),
             Line((30, -17, t), (30, 17, t)), Line((-30, -17, t), (-30, 17, t))):
    box = bend(box, line, 90, radius=r, fixed=(0, 0, 0), partial=True)
print(box.is_valid(), box.bbox().size)                         # True Vector(63.4761, 43.4761, 21.7381)
