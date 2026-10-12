cube = Box(10, 10, 10, align=Align.MIN)          # 0..10
big = cube.scale(2)                              # about the origin: 0..20
mid = cube.scale(2, center=cube.center())        # about its center: -5..15
print(big.bbox(), mid.bbox(), big.volume / cube.volume)   # volume x8

oval = Cylinder(5, 10).scale((2, 1, 1))          # elliptic cylinder, 20 x 10 x 10
print(oval.bbox().size, round(oval.volume, 2), oval.is_valid())
print(sorted({f.geom_type for f in oval.faces()}))   # ['bspline']: no longer a cylinder

inch = 25.4
part_in_mm = Box(2, 1, 0.5).scale(inch)          # a model drawn in inches
print(part_in_mm.bbox().size)                    # Vector(50.8, 25.4, 12.7)
