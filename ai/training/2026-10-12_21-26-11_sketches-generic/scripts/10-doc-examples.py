# The examples of generic.md, unchanged
outline = RoundedRectangle(80, 50, 8)
holes = GridLocations(64, 34, 2, 2) * Circle(3)
plate_sketch = outline - holes - Slot(30, 10) - Circle(6).translate(0, 15)
plate = plate_sketch.extrude(6)            # volume == plate_sketch.area * 6

pins = (Locations((-25, 0), (25, 0)) * Circle(2)).on(plate.faces().top())
pinned = plate + [p.extrude(4) for p in pins]
print("[10] plate:", round(plate.volume, 3), round(plate_sketch.area * 6, 3), "pinned valid:", pinned.is_valid(), len(pinned.solids()))

box = Box(60, 40, 20)
pocket = Rectangle(30, 20).on(box.faces().top()).extrude(-4)
cut = box - pocket                          # 45600 = 48000 - 30*20*4
grown = box + box.faces().facing(X).one().to_sketch().extrude(5)   # bbox x up to 35
print("[10] cut:", round(cut.volume, 6), "grown max x:", grown.bbox().max.x, grown.is_valid())

m = Rectangle(20, 10).mirror(Plane.XZ).extrude(5)
print("[10] mirror extrude z:", m.bbox().min.z, m.bbox().max.z)
s = make_face(Polyline((10, 0), (20, 0), (20, 20), (10, 20), close=True))
print("[10] revolve default:", round(s.revolve().volume, 6), "explicit:", round(s.revolve(Axis((0, 0, 0), (0, 1, 0))).volume, 3))
