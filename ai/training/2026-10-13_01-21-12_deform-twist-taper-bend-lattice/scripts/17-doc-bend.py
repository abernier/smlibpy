bar = Box(100, 10, 10).bend(90)                      # the whole bar: a quarter circle, radius 100 / (pi/2)
print(bar.bbox(), round(bar.mass_properties(accuracy=1e-10).volume, 3))   # volume kept: 10000.0

hook = Box(160, 10, 6).bend(180, radius=25)          # U shape: the bend is centered on x = 0
print(hook.bbox())

elbow = Cylinder(6, 150).rotate(Y, 90).bend(90, radius=30)   # pipe elbow with straight legs
pipe = elbow.shell(1, elbow.faces().planar())               # hollow, open ends
print(pipe.is_valid(), round(pipe.mass_properties(accuracy=1e-10).volume, 3))

down = Box(100, 10, 10).bend(-90, radius=20, start=10)     # down from x = 10
print(down.bbox())

side = Box(100, 10, 10).bend(90, plane=Plane.XY)           # toward +Y instead of +Z
print(side.bbox())
