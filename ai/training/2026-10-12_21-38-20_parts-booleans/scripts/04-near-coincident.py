import time
def rep(name, f):
    t = time.time()
    try:
        p = f()
        print(f"[04] {name}: faces {len(p.faces())}, vol {round(p.volume, 6)}, valid {p.is_valid()}, {time.time()-t:.2f}s")
    except Exception as e:
        print(f"[04] {name}: {type(e).__name__}: {e} | status={getattr(e, 'status', None)} detail={getattr(e, 'detail', None)!r}")

a = Box(10, 10, 10)
for eps in [1e-3, 1e-5, 1e-6, 1e-7, 1e-9]:
    rep(f"fuse gap {eps}", lambda: a + Box(10, 10, 10).translate(10 + eps, 0, 0))
    rep(f"fuse overlap {eps}", lambda: a + Box(10, 10, 10).translate(10 - eps, 0, 0))
    rep(f"cut top almost flush {eps}", lambda: a - Box(4, 4, 5, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 5 + eps))
    rep(f"cut top almost flush below {eps}", lambda: a - Box(4, 4, 5, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 5 - eps))
