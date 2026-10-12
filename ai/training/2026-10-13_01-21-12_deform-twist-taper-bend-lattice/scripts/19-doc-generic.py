def check(tag, part, expected=None):
    v = part.mass_properties(accuracy=1e-10).volume    # Part.volume can be 4e-4 off for bent parts
    ok = part.is_valid() and (expected is None or abs(v - expected) <= 1e-6 * expected)
    print(tag, ok, len(part.faces()), round(v, 3))
    return ok

check("twist", Box(20, 20, 100).twist(90), 40000)            # a twist keeps the volume
check("bend", Box(100, 10, 10).bend(90), 10000)              # neutral layer through the middle: kept
r = 100 / (math.pi / 2)
check("bend, neutral at the bottom", Box(100, 10, 10).bend(90, plane=Plane((0, 0, -5), (1, 0, 0), (0, -1, 0))),
      10000 * (1 - 5 / r))                                   # Pappus: layers above the neutral one shorten
check("taper", Cylinder(10, 50).taper(0.5), math.pi * 50 / 3 * (100 + 50 + 25))
lat = Lattice(Box(60, 40, 20), 3)
lat.move((1, 1, -1), (0, 0, 8))
check("lattice", lat.apply(Box(60, 40, 20)))
