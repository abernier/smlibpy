import time
def rep(tag, fn, expected=None):
    print("start", tag, flush=True)
    t0 = time.time()
    try:
        p = fn()
        b = p.bbox()
        e = f" expected={expected:.4f}" if expected is not None else ""
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f}{e} size={tuple(round(v,3) for v in b.size.to_tuple())} faces={len(p.faces())} solids={len(p.solids())} t={time.time()-t0:.2f}s", flush=True)
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex} t={time.time()-t0:.2f}s", flush=True)

box = Box(20, 20, 20)
d = 2
grow = rep("box +2", lambda: box.offset(2), 8000 + 2*d*(3*400) + math.pi*d*d*60 + 4/3*math.pi*d**3)
print("sharp-corner alternative", 24**3)
rep("box -2", lambda: box.offset(-2), 16**3)
rep("function form", lambda: offset(box, 2))
rep("box 0", lambda: box.offset(0))
for dd in (-5, -9, -9.9, -10, -11):
    rep(f"box {dd}", lambda: box.offset(dd), max(0, 20 + 2*dd)**3)
rep("cylinder +1", lambda: Cylinder(5, 10).offset(1), math.pi*36*12 - (math.pi*36*12 - (math.pi*25*12 + 2*math.pi*5*1*... if False else 0)) if False else None)
cyl = Cylinder(5, 10)
r, h, t = 5, 10, 1
rep("cylinder +1 (exact rounded)", lambda: cyl.offset(1), math.pi*r*r*h + 2*math.pi*r*h*t + 2*math.pi*r*r*t + math.pi*math.pi*r*t*t + 4/3*math.pi*t**3 * 0 + (math.pi*t*t)*(2*math.pi*r)/2 * 0)
rep("cylinder -1", lambda: cyl.offset(-1), math.pi*16*8)
rep("sphere +3", lambda: Sphere(10).offset(3), 4/3*math.pi*13**3)
rep("sphere -3", lambda: Sphere(10).offset(-3), 4/3*math.pi*7**3)
# concave part: L shape and a plate with a hole
L = Polygon((0, 0), (40, 0), (40, 10), (10, 10), (10, 30), (0, 30)).extrude(10)
rep("L +2", lambda: L.offset(2))
rep("L -2", lambda: L.offset(-2))
ph = Box(40, 40, 10) - Cylinder(5, 20)
rep("plate with hole +2 (hole shrinks)", lambda: ph.offset(2))
rep("plate with hole -2 (hole grows)", lambda: ph.offset(-2))
rep("plate with hole +5 (hole closes)", lambda: ph.offset(5))
fb = Box(30, 30, 10).fillet(Box(30, 30, 10).edges().parallel_to(Z), 3)
rep("filleted r3, -4 (shrink beyond the radius)", lambda: fb.offset(-4))
snapshot("offsets", box.offset(2), L.offset(2).translate(40, 0, 0), view="iso")
