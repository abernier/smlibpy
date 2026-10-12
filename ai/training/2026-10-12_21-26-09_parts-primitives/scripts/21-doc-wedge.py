# A ramp 20 long (X), 10 wide (Y), 8 high (Z): pass HALF the width
ramp = Wedge(20, 5, 8)
print(ramp.bbox(), round(ramp.volume, 3))           # x -10..10, y -5..5, z -4..4, volume 800
print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp.vertices()}))  # top edge at x = -10

# Flat top 5 long, standing on XY
step = Wedge(20, 5, 8, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
print(step.bbox(), round(step.volume, 3))           # (20 + 5) / 2 * 8 * 10 = 1000

# Top edge at +X instead: mirror it
ramp_right = Wedge(20, 5, 8).mirror(Plane.YZ)
print(sorted({(round(v.x, 3), round(v.z, 3)) for v in ramp_right.vertices()}))
# Rising towards +Y (the back): turn it about Z
ramp_back = Wedge(20, 5, 8).rotate(Z, -90)
print(ramp_back.bbox(), sorted({(round(v.y, 3), round(v.z, 3)) for v in ramp_back.vertices()}))
