cone = Cylinder(10, 50).taper(0.5)                   # exact frustum of a cone
print(round(cone.mass_properties(accuracy=1e-10).volume, 3), round(math.pi * 50 / 3 * (100 + 50 + 25), 3))

grip = Cylinder(12, 90)
grip = grip.fillet(grip.edges(), 4).taper(0.75)      # the rounds taper with it
print(grip.is_valid(), len(grip.faces()))

post = Box(40, 40, 60).taper(1.4, start=10)          # flares from z = 10 up, 1.4 x at the top
print(post.bbox())

wedge = Box(100, 20, 20).taper(0.25, axis=X)         # along X: a quarter of the size at x = 50
print(round(wedge.mass_properties(accuracy=1e-10).volume, 3))
