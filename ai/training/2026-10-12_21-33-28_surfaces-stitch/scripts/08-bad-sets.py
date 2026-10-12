# Duplicate faces, three faces on one edge, overlapping faces, ruled pieces of a polyline.
def free_edges(r):
    return sum(1 for e in r.edges() if len(e.faces()) == 1)
def report(label, fn):
    try:
        r = fn()
        if isinstance(r, Part):
            print(f"[08] {label}: Part faces {len(r.faces())} vol {r.volume:.3f} valid {r.is_valid()}")
        else:
            print(f"[08] {label}: Shell faces {len(r.faces())} free {free_edges(r)} area {r.area:.3f}")
        return r
    except Exception as e:
        print(f"[08] {label}: {type(e).__name__}: {e}")
box = Box(10, 10, 10)
fs = list(box.faces())
report("cube + duplicate top face", lambda: stitch(fs + [box.faces().top()[0]]))
fin = ruled(Line((-5, 0, 5), (5, 0, 5)), Line((-5, 0, 15), (5, 0, 15)))   # fin standing on the top face's mid line? no: on y=0 from z=5 up
fin_on_edge = ruled(Line((-5, -5, 5), (5, -5, 5)), Line((-5, -5, 15), (5, -5, 15)))  # shares the top front edge
report("cube + a fin on an edge (3 faces on one edge)", lambda: stitch(fs + [fin_on_edge]))
half = Box(10, 10, 10).faces().top()[0].to_shell().translate(3, 0, 0)
report("cube with the top face shifted 3 sideways", lambda: stitch(fs[:-1] + [half]) if False else stitch([f for f in fs if f.normal_at().z < 0.5] + [half]))
# polyline pieces, ruled per edge, stitched into one sheet
pl = Polyline((0, 0, 0), (10, 0, 0), (20, 5, 0), (30, 5, 0))
pieces = [ruled(e, e.translate(0, 0, 10)) for e in pl.edges()]
r = report("ruled per polyline edge, stitched", lambda: stitch(pieces))
if r is not None:
    print("[08]   edges", len(r.edges()), "faces", len(r.faces()))
    t = r.thicken(1)
    print(f"[08]   thicken(1): vol {t.volume:.3f} valid {t.is_valid()} expected ~{pl.length * 10:.1f}")
