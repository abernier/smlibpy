# Workaround for flat bspline faces without .plane
nb = Box(10, 10, 10).to_nurbs()
face = nb.faces().facing(Z).one()
pl = Plane(face.center(), z_dir=face.normal_at())
print("[08] plane:", pl.origin, pl.z_dir)
cut = nb - Circle(2).on(pl).extrude(-3)
print("[08] cut volume:", round(cut.volume, 3), " expected", round(1000 - math.pi * 4 * 3, 3))
