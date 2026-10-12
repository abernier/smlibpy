plate = Box(80, 60, 10)                        # mm; centered on the origin
holed = plate - Cylinder(4, 20)                # plate is unchanged
print(plate)                                   # Part(6 faces, volume=48000)
print(holed.info())                            # counts and bbox in one dict
print(holed.is_valid(), round(holed.volume, 3), holed.bbox().size)

expected = 80 * 60 * 10 - math.pi * 4**2 * 10
assert math.isclose(holed.volume, expected, rel_tol=1e-6)
assert holed.bbox().size == (80, 60, 10)       # Vector == tuple, tolerance 1e-6
assert len(holed.faces()) == len(plate.faces()) + 1
