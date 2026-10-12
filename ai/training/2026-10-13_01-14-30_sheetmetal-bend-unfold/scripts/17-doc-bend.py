blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))   # z = 0..2
bracket = bend(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2)        # line on the top face at x = 20
ba = bend_allowance(90, radius=2, thickness=2)
bb = bracket.bbox()
print(round(bb.max.x, 4), round(bb.max.z, 4))            # 20 - BA/2 + R + t, t + R + (30 - BA/2)
print(sorted(round(f.radius, 6) for f in bracket.faces() if f.geom_type == "cylinder"))   # exact R and R + t
down = bend(blank, Axis((20, 0, 2), (0, 1, 0)), -90, radius=2)          # negative: folds away from the face
print(round(down.bbox().min.z, 4))
