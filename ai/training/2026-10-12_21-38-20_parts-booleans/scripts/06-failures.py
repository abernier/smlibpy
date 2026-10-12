def rep(name, f):
    try:
        p = f()
        print(f"[06] {name}: faces {len(p.faces())}, vol {round(p.volume, 4)}, valid {p.is_valid()}")
    except Exception as e:
        print(f"[06] {name}: {type(e).__name__}: {e} | ModelingError? {isinstance(e, ModelingError)} status={getattr(e, 'status', None)} detail={getattr(e, 'detail', None)!r}")

a = Box(10, 10, 10)
empty = a - Box(20, 20, 20)
rep("empty part repr", lambda: (print('[06] repr:', repr(empty)), empty)[1])
rep("a + empty", lambda: a + empty)
rep("a - empty", lambda: a - empty)
rep("empty + a", lambda: empty + a)
rep("a & empty", lambda: a & empty)
bad = Rectangle(10, 10).on(Plane.front).revolve()
rep("a + self-intersecting revolve", lambda: a + bad)
tangent = Cylinder(5, 20) + Cylinder(5, 20).translate(10, 0, 0)
rep("invalid (tangent) part - hole", lambda: tangent - Cylinder(1, 30))
rep("invalid part fillet", lambda: tangent.fillet(tangent.edges().circles(), 0.5))
rep("export empty to STEP", lambda: (export_step(empty, "/tmp/_never.step"), a)[1])
