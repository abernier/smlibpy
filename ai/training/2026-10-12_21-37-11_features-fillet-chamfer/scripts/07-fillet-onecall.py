blk = Box(30, 30, 30)
vert = blk.edges().parallel_to(Z)
topE = blk.faces().top().edges()
try:
    p = blk.fillet(list(vert) + list(topE), [8]*4 + [3]*4)
    print("[one call r8+r3] valid", p.is_valid(), "vol", round(p.volume, 4), "faces", len(p.faces()))
    snapshot("onecall", p)
except Exception as e:
    print(f"[one call r8+r3] {type(e).__name__}: {e}")
# repeat the r4.99 cube to confirm it is deterministic
cube = Box(10, 10, 10)
for i in range(3):
    q = cube.fillet(cube.edges(), 4.99)
    print(f"[repeat {i}] r4.99 vol={q.volume:.4f} faces={len(q.faces())} valid={q.is_valid()}")
q = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 9.98)
print("[20 cube r9.98] vol", round(q.volume, 4), "faces", len(q.faces()))
