import time
def rep(tag, fn, expected=None):
    t0 = time.time()
    try:
        p = fn()
        b = p.bbox()
        e = f" expected={expected:.4f}" if expected is not None else ""
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f}{e} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids())} t={time.time()-t0:.2f}s")
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex} t={time.time()-t0:.2f}s")

box = Box(80, 50, 30)
closed = rep("closed 2.5", lambda: box.shell(2.5), 80*50*30 - 75*45*25)
openb = rep("open top 2.5", lambda: box.shell(2.5, box.faces().top()), 80*50*30 - 75*45*27.5)
outw = rep("outward closed 2.5", lambda: box.shell(2.5, outward=True), 85*55*35 - 80*50*30)
outo = rep("outward open top 2.5", lambda: box.shell(2.5, box.faces().top(), outward=True), 85*55*32.5 - 80*50*30)
rep("negative thickness -2.5 open top", lambda: box.shell(-2.5, box.faces().top()), 80*50*30 - 75*45*27.5)
rep("function form", lambda: shell(box, 2.5, box.faces().top()), 80*50*30 - 75*45*27.5)
rep("single Face", lambda: box.shell(2.5, box.faces().top()[0]), 80*50*30 - 75*45*27.5)
rep("two openings top+bottom", lambda: box.shell(2.5, box.faces().top() + box.faces().bottom()), 80*50*30 - 75*45*30)
rep("two openings top+front", lambda: box.shell(2.5, box.faces().top() + box.faces().front()), 80*50*30 - 75*47.5*27.5)
rep("all six faces", lambda: box.shell(2.5, box.faces()), None)
rep("thickness 0", lambda: box.shell(0, box.faces().top()), None)
cup = rep("cylinder cup", lambda: Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top()), math.pi*400*30 - math.pi*18*18*28)
snapshot("sheet", openb, view="sheet")
snapshot("outward", outo, view="front")
