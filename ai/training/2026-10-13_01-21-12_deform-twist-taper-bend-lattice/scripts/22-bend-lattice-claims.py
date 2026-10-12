# claims for bend.md and Lattice.md
from smlibpy._kernel import ext
hook = Box(160, 10, 6).bend(180, radius=25)
print("[22] U face types", sorted(f.geom_type for f in hook.faces()))
for counts in (3, 4):
    sph = Sphere(10)
    L = Lattice(sph, counts)
    L.move((1, 1, counts - 1), (0, 0, 4))           # one point of the top layer
    q = L.apply(sph)
    d = ext.surface_data(q.faces()[0]._f.surface(), True)
    print(f"[22] sphere, one point of a {counts}^3 lattice moved: degrees ({d['u_degree']}, {d['v_degree']}) poles {len(d['poles'])} valid {q.is_valid()}")
corner = Lattice(Box(10, 10, 10), 3)
corner.move((2, 2, 2), (3, 0, 0))
print("[22] corner point moved 3: corner goes to", corner.map((5, 5, 5)))
