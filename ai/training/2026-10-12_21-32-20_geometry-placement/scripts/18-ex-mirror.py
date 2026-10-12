half = Box(20, 10, 10, align=Align.MIN)          # x 0..20
print(half.mirror(Plane.YZ).bbox())              # x -20..0
print(half.mirror().bbox())                      # default Plane.XZ: y -10..0
print(half.mirror(Plane.YZ.offset(30)).bbox())   # about x = 30: x 40..60

bracket = Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 12), (0, 12)).extrude(5)
tee = bracket + bracket.mirror(Plane.YZ)         # symmetric part from one half
print(tee.is_valid(), tee.volume, len(tee.solids()), tee.bbox().size)

right = half.faces().sort_by(X)[-1]
print(half.mirror(right.plane).bbox())           # about a face: pass face.plane, x 20..40
