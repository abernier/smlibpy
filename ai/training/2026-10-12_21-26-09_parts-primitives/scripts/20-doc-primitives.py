# Box
block = Box(40, 30, 10)                                                  # x -20..20, y -15..15, z -5..5
plate = Box(80, 60, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))    # z 0..6, stands on XY
corner = Box(10, 10, 10, align=Align.MIN)                                # 0..10 on every axis
print(block.bbox(), plate.bbox(), corner.bbox())

# Cylinder
pin = Cylinder(5, 20)                                                    # axis = Z, z -10..10
post = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))    # axis stays on Z, z 0..20
rod = Cylinder(3, 50).rotate(Y, 90)                                      # along X, x -25..25
half = Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))  # y >= 0
print(pin.bbox(), post.bbox(), rod.bbox(), half.bbox(), round(half.volume, 2))

# Cone
frustum = Cone(10, 4, 15)                                                # r 10 at z -7.5, r 4 at z 7.5
tip = Cone(10, 0, 15, align=(Align.CENTER, Align.CENTER, Align.MIN))     # apex at (0, 0, 15)
apex_down = Cone(10, 0, 15).rotate(X, 180)                               # apex at (0, 0, -7.5)
print(frustum.bbox(), [v.point for v in tip.vertices()], [v.point for v in apex_down.vertices()])

# Sphere
ball = Sphere(8)                                                         # -8..8
dome = Sphere(8) & Box(16, 16, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))  # z 0..8
print(ball.bbox(), dome.bbox(), round(dome.volume, 2))

# Torus
ring = Torus(20, 4)                                                      # x, y -24..24, z -4..4
standing = Torus(20, 4).rotate(X, 90)                                    # in the XZ plane
print(ring.bbox(), standing.bbox(), round(ring.volume, 3))
