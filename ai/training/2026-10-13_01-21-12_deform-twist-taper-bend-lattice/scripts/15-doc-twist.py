bar = Box(20, 10, 100).twist(90)                     # a quarter turn over the whole length
print(len(bar.faces()), round(bar.mass_properties(accuracy=1e-10).volume, 3))      # 6 20000.0
print(sorted((round(v.x, 6), round(v.y, 6)) for v in bar.vertices() if v.z > 49))  # top: 10 wide, 20 deep

baluster = Box(16, 16, 200).twist(360, start=-50, end=50)   # only z -50..50 turns
print(len(baluster.faces()))                         # 14: the sides are split at z -50 and 50

vase = RegularPolygon(30, 6).extrude(120).twist(60)
vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])  # hollow, open at the top
print(vase.is_valid(), round(vase.mass_properties(accuracy=1e-10).volume, 1))

plate = Box(80, 60, 10).twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))  # about Y
print(plate.is_valid(), round(plate.mass_properties(accuracy=1e-10).volume, 3))
