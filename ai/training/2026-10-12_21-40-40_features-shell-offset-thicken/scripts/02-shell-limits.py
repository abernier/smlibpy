import time
def rep(tag, fn, expected=None):
    print("start", tag, flush=True)
    t0 = time.time()
    try:
        p = fn()
        e = f" expected={expected:.4f}" if expected is not None else ""
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f}{e} faces={len(p.faces())} solids={len(p.solids())} t={time.time()-t0:.2f}s", flush=True)
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex} t={time.time()-t0:.2f}s", flush=True)

box = Box(40, 30, 10)
for t in (2, 4, 4.9, 4.99, 5, 6, 10):
    rep(f"box 40x30x10 closed t{t}", lambda: box.shell(t), 12000 - max(0, 40-2*t)*max(0, 30-2*t)*max(0, 10-2*t))
for t in (4.9, 5, 9, 9.9, 10, 11):
    rep(f"box open top t{t}", lambda: box.shell(t, box.faces().top()), 12000 - max(0, 40-2*t)*max(0, 30-2*t)*max(0, 10-t))
# filleted box: fillet radius vs wall
for r, t in ((5, 2), (2, 2), (1, 2), (3, 2.5)):
    fb = Box(60, 40, 20).fillet(Box(60, 40, 20).edges().parallel_to(Z), r)
    rep(f"vertical fillets r{r} then shell t{t} open top", lambda: fb.shell(t, fb.faces().top()))
fa = Box(60, 40, 20)
fa = fa.fillet(fa.edges(), 5)
rep("all edges r5 then shell t2 closed", lambda: fa.shell(2))
rep("all edges r5 then shell t2, open = largest planar top", lambda: fa.shell(2, fa.faces().planar().top()))
rep("all edges r5 then shell t6 (> r)", lambda: fa.shell(6, fa.faces().planar().top()))
# shell first, fillet after (outer edges)
s = Box(60, 40, 20).shell(2, Box(60, 40, 20).faces().top())
outer_vertical = s.edges().parallel_to(Z).filter(lambda e: abs(abs(e.center().x) - 30) < 1e-6 and abs(abs(e.center().y) - 20) < 1e-6)
print("outer vertical edges", len(outer_vertical))
rep("shell t2 then fillet outer vertical r5", lambda: s.fillet(outer_vertical, 5))
inner_vertical = s.edges().parallel_to(Z).filter(lambda e: abs(abs(e.center().x) - 28) < 1e-6)
rep("then inner vertical r3", lambda: s.fillet(outer_vertical, 5).fillet(inner_vertical, 3))
