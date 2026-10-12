ball = Sphere(10)
rim = ball.silhouette((0, 0, 1))                  # seen from above (camera at +Z)
print(len(rim), rim[0].geom_type, round(rim[0].length, 5))   # 1 bspline 62.83184 (2*pi*10)

ring = Torus(20, 5)
side = ring.silhouette((1, 0, 0))                 # camera at +X: only the visible contour
side = [e for e in side if e.length > 1e-3]       # drop slivers
print(len(side), round(sum(e.length for e in side), 3))      # 8 157.078 (half of the full set)

cyl = Cylinder(5, 20)
cs = cyl.silhouette((1, 0, 0))
lines = [e for e in cs if e.geom_type != "circle"]           # the two contour lines at y = +-5
print([(round(e.point_at(0.5).y, 6), round(e.length, 6)) for e in lines])   # [(-5.0, 20.0), (5.0, 20.0)]
