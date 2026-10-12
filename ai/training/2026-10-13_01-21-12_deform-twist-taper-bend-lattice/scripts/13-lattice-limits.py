# folding, flat parts, bad indices, helpers in place
lat = Lattice(Box(10, 10, 10), 3)
lat.move((2, 1, 1), (-30, 0, 0))
try:
    lat.apply(Box(10, 10, 10))
except ModelingError as e:
    print("[13] folding ->", e)
for label, make in [("counts 1", lambda: Lattice(Box(10, 10, 10), 1)),
                    ("flat sketch", lambda: Lattice(Rectangle(10, 10), 3)),
                    ("two indices", lambda: Lattice(Box(10, 10, 10)).move((1, 1), (0, 0, 1))),
                    ("layer out of range", lambda: Lattice(Box(10, 10, 10)).layer(Z, 3))]:
    try:
        print("[13]", label, "->", make())
    except Exception as e:
        print("[13]", label, "->", type(e).__name__ + ":", e)
flat = Lattice(Rectangle(10, 10), 3, margin=1)
print("[13] flat with margin:", flat.box)
a = Lattice(Box(10, 10, 10), 3)
b = a.copy().move(a.layer(Z, -1), (0, 0, 1))
print("[13] copy is independent:", float(abs(a.offsets).max()), float(abs(b.offsets).max()))
chained = Lattice(Box(10, 10, 10), 3).move(Lattice(Box(10, 10, 10), 3).layer(Z, -1), (0, 0, 2)).scale((1, 1, -1), 1.0)
print("[13] chained calls return the lattice:", type(chained).__name__)
