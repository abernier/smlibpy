half = Box(20, 10, 10).translate(10, 0, 0)
half = half.fillet(half.edges().right(), 2)
whole = half + half.mirror(Plane.YZ)                    # mirror about x = 0, then fuse
print(len(whole.solids()), len(whole.faces()), round(whole.volume, 3))   # 1 14 3937.463

right = Box(20, 10, 10)
pair = right + right.mirror(right.faces().right()[0].plane)  # about the part's own face: x = 10
print(pair.bbox().size.to_tuple())                      # (40.0, 10.0, 10.0)

copy = mirror(half, Plane.YZ.offset(30))                # a copy about x = 30 (no fuse)

sk = Rectangle(10, 6).translate(10, 0).mirror(Plane.YZ)
print(sk.plane.z_dir.to_tuple())                        # (0, 0, -1): a mirrored sketch extrudes downwards
