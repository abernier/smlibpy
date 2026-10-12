# lattices on curved parts: exact up to MAX_DEGREE, approximated above it
import time
from smlibpy._kernel import ext
from smlibpy import deform as D
print("[11] MAX_DEGREE", D.MAX_DEGREE)
for name, part in [("cylinder", Cylinder(15, 20)), ("sphere", Sphere(10)), ("torus", Torus(20, 5))]:
    for counts in (2, 3, 4):
        L = Lattice(part, counts)
        L.scale(L.layer(Z, -1), 1.4)
        L.move(L.layer(X, 0), (-4, 0, 0))
        t0 = time.time(); q = L.apply(part); dt = time.time() - t0
        data = [ext.surface_data(f._f.surface(), True) for f in q.faces()]
        print(f"[11] {name} counts {counts}: valid {q.is_valid()} degrees {sorted((d['u_degree'], d['v_degree']) for d in data)} "
              f"poles {sum(len(d['poles']) for d in data)} {dt:.3f}s")
