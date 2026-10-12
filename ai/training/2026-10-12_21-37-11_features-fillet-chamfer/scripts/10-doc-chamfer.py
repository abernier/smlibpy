box = Box(40, 30, 20)
bevel = box.chamfer(box.edges().parallel_to(Z), 2)      # 2 along both faces
print(round(box.volume - bevel.volume, 3))              # 160.0 = 4 * 2*2/2 * 20

top = box.chamfer(box.faces().top(), 2)                 # all edges of the top face
also = chamfer(box.faces().top().edges(), 2)            # function form: finds the part

plate = Box(40, 40, 10) - Cylinder(5, 20)
rim = plate.edges().circles().filter(lambda e: e.center().z > 0)
plate = plate.chamfer(rim, 1.5)                         # countersink-like bevel on the hole
print(plate.is_valid(), round(plate.volume, 3))         # True 15175.73

tri = Polygon((0, 0), (40, 0), (0, 20)).extrude(10)
sharp = tri.edges().parallel_to(Z).nearest((40, 0, 0))  # acute 26.6-degree edge
tip = tri.chamfer(sharp, 2)                             # still 2 along each face
