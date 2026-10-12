# Gaps: move the top face of a 10 mm box up by g; which g closes, with and without tolerance?
box = Box(10, 10, 10)
def free_edges(r):
    return sum(1 for e in r.edges() if len(e.faces()) == 1)
for g in (1e-6, 1e-5, 1e-4, 5e-4, 1e-3, 1e-2, 0.1, 0.5):
    pieces = [f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, g)]
    for tol in (None, 2 * g, 10 * g):
        try:
            r = stitch(pieces, tolerance=tol)
            if isinstance(r, Part):
                desc = f"Part vol {r.volume:.4f} valid {r.is_valid()} bbox z {r.bbox().max.z:.6f}"
            else:
                desc = f"Shell free edges {free_edges(r)} faces {len(r.faces())}"
            print(f"[02] gap {g:g} tol {tol}: {desc}")
        except Exception as e:
            print(f"[02] gap {g:g} tol {tol}: {type(e).__name__}: {e}")
