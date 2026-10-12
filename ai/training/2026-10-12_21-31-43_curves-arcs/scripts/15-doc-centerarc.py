# Doc examples, copied verbatim from the docs listed below

# ---- CenterArc.md block 1
print('==== CenterArc.md block 1')
quarter = CenterArc((0, 0), 10, 0, 90)                  # (10, 0) -> (0, 10), ccw
cw = CenterArc((0, 0), 10, 0, -90)                      # (10, 0) -> (0, -10), cw
bend = CenterArc((0, 0), 20, 0, 90, plane=Plane.XZ)     # (20, 0, 0) -> (0, 0, 20)
tube = sweep(Circle(2), bend)                           # volume pi * 4 * 10 * pi
outline = Polyline((0, 0), (40, 0), (40, 30), (0, 30), close=True)
plate = make_face(outline, CenterArc((20, 15), 6, 0, 360)).extrude(5)
print("[15] plate", plate.is_valid(), round(plate.volume, 4), round((1200 - 36 * math.pi) * 5, 4))
