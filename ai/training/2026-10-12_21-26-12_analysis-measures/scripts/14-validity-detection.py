# Can volume signs or Booleans reveal bodies that is_valid() accepts? Mirrored and scaled bodies.
pi = math.pi
b = Box(10, 20, 30, align=Align.MIN)
for name, p in (("mirror XZ", b.mirror(Plane.XZ)), ("mirror YZ", b.mirror(Plane.YZ)),
                ("scale -1", b.scale(-1)), ("scale (1,1,-1)", b.scale((1, 1, -1))), ("scale 2", b.scale(2))):
    try:
        print(f"[14] {name}: volume={p.volume:.6g} area={p.area:.6g} center={p.center()} valid={p.is_valid()} normal of top={p.faces().top().one().normal_at()}")
    except Exception as e:
        print(f"[14] {name}: {type(e).__name__}: {e}")
crossing = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))
print(f"[14] crossing revolve: volume={crossing.volume} area={crossing.area:.6g} valid={crossing.is_valid()} mesh volume={crossing.mesh().volume:.6g}")
for f in crossing.faces():
    print(f"[14]    face {f.geom_type} area={f.area:.6g} normal_at={f.normal_at()} center={f.center()}")
snapshot("crossing", crossing, view="sheet")
bad = sweep(Circle(4), Helix(5, 20, 10))
print(f"[14] self-intersecting spring: volume={bad.volume:.6g} pi*16*L={pi*16*Helix(5, 20, 10).length:.6g} mesh={bad.mesh(tolerance=0.01).volume:.6g}")
for name, f in (("fuse with a box far away", lambda p: p + Box(1, 1, 1).translate(100, 0, 0)),
                ("intersect with its bbox box", lambda p: p & Box(40, 40, 40, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, -5)),
                ("cut a small box", lambda p: p - Box(1, 1, 1).translate(100, 0, 0))):
    try:
        r = f(bad)
        print(f"[14] spring {name}: volume={r.volume:.6g} valid={r.is_valid()} faces={len(r.faces())}")
    except Exception as e:
        print(f"[14] spring {name}: {type(e).__name__}: {e}")
