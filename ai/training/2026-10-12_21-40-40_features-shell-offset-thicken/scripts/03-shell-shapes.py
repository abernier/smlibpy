import time
def rep(tag, fn, expected=None):
    t0 = time.time()
    try:
        p = fn()
        e = f" expected={expected:.4f}" if expected is not None else ""
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f}{e} faces={len(p.faces())} solids={len(p.solids())} t={time.time()-t0:.2f}s")
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex} t={time.time()-t0:.2f}s")

sp = Sphere(20)
rep("sphere closed t2", lambda: sp.shell(2), 4/3*math.pi*(20**3 - 18**3))
half = Sphere(20).split(Plane.XY)
rep("half sphere open flat t2", lambda: half.shell(2, half.faces().planar()), 2/3*math.pi*(20**3 - 18**3))
to = Torus(20, 5)
rep("torus closed t1", lambda: to.shell(1), 2*math.pi**2*20*(25 - 16))
cone = Cone(20, 5, 30)
rep("cone open top t2", lambda: cone.shell(2, cone.faces().top()))
rep("cone open bottom t2", lambda: cone.shell(2, cone.faces().bottom()))
base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
rep("plate+boss open bottom t2", lambda: base.shell(2, base.faces().bottom()))
plate_holes = Box(60, 40, 10) - GridLocations(40, 20, 2, 2) * Cylinder(4, 20)
rep("plate with holes open top t2", lambda: plate_holes.shell(2, plate_holes.faces().top()))
lb = Polygon((0, 0), (40, 0), (40, 10), (10, 10), (10, 30), (0, 30)).extrude(20)
rep("L-profile open top t2", lambda: lb.shell(2, lb.faces().top()))
# revolved profile shell
prof = Polygon((0, 0), (20, 0), (20, 5), (12, 5), (12, 30), (0, 30))
rv = prof.on(Plane.front).revolve(Z)
rep("revolved open top t1.5", lambda: rv.shell(1.5, rv.faces().top()))
# extruded spline profile
blob = make_face(Wire([Spline((0, 0, 0), (20, 10, 0), (40, 0, 0)), Line((40, 0, 0), (40, -10, 0)), Line((40, -10, 0), (0, -10, 0)), Line((0, -10, 0), (0, 0, 0))])).extrude(15) if 'make_face' in globals() else None
if blob is not None:
    rep("spline-sided prism open top t1.5", lambda: blob.shell(1.5, blob.faces().top()))
