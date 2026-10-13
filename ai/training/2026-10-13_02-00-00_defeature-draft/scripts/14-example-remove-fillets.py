box = Box(40, 30, 20)
rounded = box.fillet(box.edges(), 3)
sharp = rounded.remove_fillets()                  # every fillet, corner patches included
print(len(sharp.faces()), round(sharp.volume, 6)) # 6 24000.0

v4 = box.fillet(box.edges().parallel_to(Z), 3)
one = v4.remove_fillets(v4.faces().fillets().sort_by("x")[0])   # just one of them
print(len(one.faces()))                           # 9

plate = Box(60, 40, 5, align=(Align.CENTER, Align.CENTER, Align.MAX))
part = plate + Cylinder(6, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = part.fillet(part.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 9), 2)        # round top, convex
part = part.fillet(part.edges().filter(lambda e: e.geom_type == "circle" and abs(e.center().z) < 1e-6), 1.5)  # base fillet, concave
print(round(part.remove_fillets().volume, 3), round(12000 + math.pi * 36 * 10, 3))   # 13130.973 13130.973
print(len(part.remove_fillets(max_radius=1.5).faces()))   # 9: only the base fillet went

try:
    v4.remove_fillets(v4.faces().top())
except ModelingError as e:
    print(e)   # remove_fillets: 1 of the faces are no fillets (plane); ...
