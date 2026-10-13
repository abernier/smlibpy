box = Box(40, 30, 20)
rounded = box.fillet(box.edges(), 3)              # 12 rounds, 8 corner spheres
found = rounded.faces().fillets()
print(len(found), len(found.cylinders()))         # 20 12
print(len(rounded.faces().fillets(max_radius=2))) # 0: all are r 3

disc = Cylinder(10, 8)
disc = disc.fillet(disc.edges(), 2)
print([f.geom_type for f in disc.faces().fillets()])   # ['revolution', 'revolution']: the side is a wall

slot = Slot(40, 12).extrude(5)                    # round ends look like r 6 fillets
print(len(slot.faces().fillets()), len(slot.faces().fillets(max_radius=5)))  # 2 0
