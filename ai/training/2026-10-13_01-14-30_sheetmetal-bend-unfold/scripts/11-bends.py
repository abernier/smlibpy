# Part.bends(): what a bent part reports
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
z = bend(blank, Axis((-30, 0, 2), (0, 1, 0)), 90, radius=2)
z = bend(z, Axis((30, 0, 2), (0, 1, 0)), -45, radius=3)
for b in z.bends():
    print("[11]", b, "axis", b.axis, "line", b.line, "direction", b.direction)
print("[11] k 0.5:", [round(b.allowance, 6) for b in z.bends(k_factor=0.5)])
print("[11] plain box:", Box(10, 10, 10).bends(), "cylinder:", Cylinder(5, 10).bends())
