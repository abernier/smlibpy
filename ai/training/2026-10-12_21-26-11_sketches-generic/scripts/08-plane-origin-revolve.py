# Where is plane.origin for each way of making a sketch, and what does revolve() do by default?
cases = {
    "Rectangle(10,20)": Rectangle(10, 20),
    "Polygon x 10..20": Polygon((10, 0), (20, 0), (20, 20), (10, 20)),
    "make_face x 10..20": make_face(Polyline((10, 0), (20, 0), (20, 20), (10, 20), close=True)),
    "Wire.to_sketch x 10..20": Polyline((10, 0), (20, 0), (20, 20), (10, 20), close=True).to_sketch(),
    "Pos(15,10)*Rectangle(10,20)": Pos(15, 10) * Rectangle(10, 20),
}
for name, s in cases.items():
    print(f"[08] {name}: plane origin={s.plane.origin} bbox={s.bbox().min}..{s.bbox().max}")
    try:
        p = s.revolve()
        print(f"[08]   revolve(): {p!r} valid={p.is_valid()}")
    except Exception as e:
        print(f"[08]   revolve(): {type(e).__name__}: {e}")
    p2 = s.revolve(Axis((0, 0, 0), (0, 1, 0)))
    print(f"[08]   revolve(world Y): volume={p2.volume:.3f}")
