# Realistic: a plate sketch with holes and a slot, extruded; a pattern placed on a face
outline = RoundedRectangle(80, 50, 8)
holes = GridLocations(64, 34, 2, 2) * Circle(3)
plate_sketch = outline - holes - Slot(30, 10) - Circle(6).translate(0, 15)
print("[09] sketch:", repr(plate_sketch), "faces:", len(plate_sketch.faces()), "holes:", len(plate_sketch.faces()[0].inner_wires()))
plate = plate_sketch.extrude(6)
print("[09] plate:", repr(plate), "valid:", plate.is_valid(), "bbox:", plate.bbox().min, plate.bbox().max)
print("[09] volume check:", round(plate.volume, 3), round(plate_sketch.area * 6, 3))
# a pattern of sketches placed on the top face is a ShapeList: extrude each one
pins = (Locations((-25, 0), (25, 0)) * Circle(2)).on(plate.faces().top())
print("[09] pins type:", type(pins).__name__, len(pins), [p.center() for p in pins])
pinned = plate + [p.extrude(4) for p in pins]
print("[09] pinned:", repr(pinned), "valid:", pinned.is_valid(), "solids:", len(pinned.solids()), "bbox z:", round(pinned.bbox().max.z, 6))
# or make one sketch of several pieces and extrude it once
dots = sum(Locations((-25, 0), (25, 0)) * Circle(2))
print("[09] dots:", repr(dots), "extrude:", repr(dots.extrude(4)), "solids:", len(dots.extrude(4).solids()))
snapshot("plate", pinned, view="iso")
