block = Box(40, 30, 20)
drilled = block - Cylinder(5, 40) - Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(12, 0, 0)
plain = drilled.remove_faces(drilled.faces().cylinders())   # the floor of the blind hole goes with its wall
print(len(plain.faces()), round(plain.volume, 6))            # 6 24000.0

bossed = block + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 10)
print(round(bossed.remove_faces(bossed.faces().cylinders()).volume, 6))   # 24000.0: the top went with the side

pocket = block - Box(10, 8, 6, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
walls = pocket.faces().within(BoundBox((-5.1, -4.1, 3.9), (5.1, 4.1, 10.1)))   # the 4 walls and the floor
print(len(walls), round(pocket.remove_faces(walls).volume, 6))           # 5 24000.0

try:
    drilled.remove_faces(drilled.faces())
except ModelingError as e:
    print(e)   # remove_faces: that is every face of the part; nothing would be left
