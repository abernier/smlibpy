# Input forms and open vs closed results.
box = Box(10, 10, 10)
fs = box.faces()
def show(label, r):
    kind = type(r).__name__
    extra = f"vol {r.volume:.4f} valid {r.is_valid()}" if isinstance(r, Part) else f"area {r.area:.3f}"
    free = [e for e in r.edges() if len(e.faces()) == 1]
    print(f"[01] {label}: {kind} faces {len(r.faces())} edges {len(r.edges())} free edges {len(free)} {extra}")
    return r
show("list of shells", stitch([f.to_shell() for f in fs]))
show("faces directly (ShapeList)", stitch(fs))
show("*args faces", stitch(*fs))
show("nested lists", stitch([fs[:3], [fs[3], fs[4]], fs[5]]))
show("5 faces (open box)", stitch(fs[:5] if True else None))
open5 = stitch([f for f in fs if f.normal_at().z < 0.5])
show("open top (no top face)", open5)
show("2 adjacent faces", stitch(fs.top(), fs.front()))
show("2 disjoint faces", stitch(fs.top(), fs.bottom()))
show("a Part alone", stitch(box))
try:
    stitch([])
except Exception as e:
    print("[01] empty:", type(e).__name__, e)
