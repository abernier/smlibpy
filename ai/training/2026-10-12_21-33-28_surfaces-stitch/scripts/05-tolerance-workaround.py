# Large gap: stitch with tolerance, then stitch again (or heal). Volume and validity.
def free_edges(r):
    return sum(1 for e in r.edges() if len(e.faces()) == 1)
box = Box(10, 10, 10)
for g in (0.1, 0.5, 1.0):
    ps = [f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, g)]
    first = stitch(ps, tolerance=2 * g)
    second = stitch(first)
    healed = stitch(first.heal())
    for label, r in (("stitch twice", second), ("heal+stitch", healed)):
        if isinstance(r, Part):
            print(f"[05] gap {g} {label}: Part vol {r.volume:.3f} (top face at {5 + g}: {1000 + 100 * g:.1f}) valid {r.is_valid()} bbox z {r.bbox().max.z:.4f}")
        else:
            print(f"[05] gap {g} {label}: Shell free {free_edges(r)}")
    # tolerance smaller than the gap
    r = stitch(ps, tolerance=g / 2)
    print(f"[05] gap {g} tol {g/2}: {type(r).__name__} free {free_edges(r)}")
p = stitch(stitch([f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, 0.5)], tolerance=1))
snapshot("gap05", p, view="front")
