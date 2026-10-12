# Is the gap that closes by default absolute or relative to the model size?
def free_edges(r):
    return sum(1 for e in r.edges() if len(e.faces()) == 1)
for size in (1, 10, 100, 1000):
    box = Box(size, size, size)
    for g in (0.005, 0.01, 0.02, 0.05):
        pieces = [f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, g)]
        r = stitch(pieces)
        desc = f"Part vol err {r.volume - size**3 - size**2 * g:+.2e}" if isinstance(r, Part) else f"Shell free {free_edges(r)}"
        print(f"[03] box {size} gap {g}: {desc}")
