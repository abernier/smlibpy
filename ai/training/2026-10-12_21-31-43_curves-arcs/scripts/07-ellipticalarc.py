# EllipticalArc: full ellipse, angles (parametric or polar?), direction, wrap, plane, errors
def info(tag, e):
    if callable(e):
        try:
            e = e()
        except Exception as ex:
            print(f"[07] {tag} ->", type(ex).__name__, ex)
            return
    print(f"[07] {tag}: type {e.geom_type} start {e.start} end {e.end} mid {e.point_at(0.5)} len {e.length:.6f} closed {e.is_closed} t0 {e.tangent_at(0)}")
info("full", lambda: EllipticalArc((0, 0), 20, 10))
info("0..90", lambda: EllipticalArc((0, 0), 20, 10, 0, 90))
info("0..45", lambda: EllipticalArc((0, 0), 20, 10, 0, 45))
print("[07]   polar 45 deg point would be", (20 * 10 / math.hypot(10, 20), 20 * 10 / math.hypot(10, 20)), "parametric", (20 * math.cos(math.pi / 4), 10 * math.sin(math.pi / 4)))
info("90..0 (end < start)", lambda: EllipticalArc((0, 0), 20, 10, 90, 0))
info("-90..90", lambda: EllipticalArc((0, 0), 20, 10, -90, 90))
info("270..450", lambda: EllipticalArc((0, 0), 20, 10, 270, 450))
info("30..30", lambda: EllipticalArc((0, 0), 20, 10, 30, 30))
info("0..360 start 90", lambda: EllipticalArc((0, 0), 20, 10, 90, 450))
info("center (5,5)", lambda: EllipticalArc((5, 5), 20, 10, 0, 90))
info("ry > rx", lambda: EllipticalArc((0, 0), 10, 20, 0, 90))
info("rx == ry", lambda: EllipticalArc((0, 0), 10, 10, 0, 90))
info("on XZ", lambda: EllipticalArc((0, 0), 20, 10, 0, 90, plane=Plane.XZ))
info("on XZ center (5,2)", lambda: EllipticalArc((5, 2), 20, 10, 0, 90, plane=Plane.XZ))
info("on XY.offset(5) center (1,2)", lambda: EllipticalArc((1, 2), 20, 10, 0, 90, plane=Plane.XY.offset(5)))
print("[07] full length expected (Ramanujan):", math.pi * (3 * 30 - math.sqrt((3 * 20 + 10) * (20 + 3 * 10))))
for args in [((0, 0), 0, 10), ((0, 0), -20, 10), ((0, 0), 20, -10)]:
    try:
        e = EllipticalArc(*args)
        info(f"{args}", e)
    except Exception as ex:
        print("[07]", args, "->", type(ex).__name__, ex)
s = make_face(EllipticalArc((0, 0), 20, 10))
print("[07] face of full ellipse area:", s.area, "expected", math.pi * 200)
half = Wire([EllipticalArc((0, 0), 20, 10, 0, 180), Line((-20, 0), (20, 0))])
print("[07] half ellipse wire closed", half.is_closed, "area", make_face(half).area, "expected", math.pi * 100)
snapshot("ell", EllipticalArc((0, 0), 20, 10), EllipticalArc((0, 0), 20, 10, 0, 45), Line((0, 0), (20, 20)), view="top")
