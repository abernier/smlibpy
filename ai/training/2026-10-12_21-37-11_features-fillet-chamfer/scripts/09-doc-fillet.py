box = Box(40, 30, 20)
rounded = box.fillet(box.edges().parallel_to(Z), 5)     # 4 vertical edges
print(round(box.volume - rounded.volume, 4))            # 429.2037 = 4 * (25 - 25*pi/4) * 20

lid = box.fillet(box.faces().top(), 3)                  # a face: its edges
ramp = box.fillet(box.edges().parallel_to(Z).first, (2, 8))  # radius 2 at the edge start, 8 at its end
stepped = box.fillet(box.edges().parallel_to(Z), [2, 4, 6, 8])  # one radius per edge, in selection order
soft = box.fillet(box.edges().parallel_to(Z), 5, continuity="G2")  # curvature-continuous, same setback 5

# different radii that meet at corners: one call with a list, or the larger radius first
blk = Box(30, 30, 30)
edges = list(blk.edges().parallel_to(Z)) + list(blk.faces().top().edges())
both = blk.fillet(edges, [8] * 4 + [3] * 4)
print(both.is_valid(), round(both.volume, 3))           # True 25154.747

# concave edges add material
part = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
part += Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
part = part.fillet(part.edges().concave(), 2)           # root of the boss

# rounding a hole's rim: select the circle by radius and height
plate = Box(60, 40, 8) - Cylinder(5, 20)
rim = plate.edges().circles().filter(lambda e: abs(e.radius - 5) < 1e-6 and e.center().z > 0)
plate = plate.fillet(rim, 1)

cube = Box(10, 10, 10)
try:
    cube.fillet(cube.edges(), 6)
except ModelingError as e:
    print(e)   # fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)
print(round(part.volume, 3), plate.is_valid())
