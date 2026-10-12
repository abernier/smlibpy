blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
z = bend(blank, Axis((-30, 0, 2), (0, 1, 0)), 90, radius=2)
z = bend(z, Axis((30, 0, 2), (0, 1, 0)), -45, radius=3)
for b in z.bends():
    print(b, b.axis)
print([round(b.allowance, 4) for b in z.bends(k_factor=0.5)])
print(Box(10, 10, 10).fillet(Box(10, 10, 10).edges().parallel_to(Z), 2).bends())   # rounds are no bends
