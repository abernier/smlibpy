# CenterArc: start angle, arc size, direction, full circle
def info(tag, e):
    print(f"[01] {tag}: type {e.geom_type} start {e.start} end {e.end} mid {e.point_at(0.5)} "
          f"len {e.length:.6f} r {e.radius:.6f} c {e.arc_center} n {e.normal} t0 {e.tangent_at(0)}")
info("0..90", CenterArc((0, 0), 10, 0, 90))
info("45..+90", CenterArc((0, 0), 10, 45, 90))
info("0..-90 (cw)", CenterArc((0, 0), 10, 0, -90))
info("90..-180", CenterArc((0, 0), 10, 90, -180))
info("full 360", CenterArc((0, 0), 10, 0, 360))
info("full -360", CenterArc((0, 0), 10, 0, -360))
info("full start 90", CenterArc((0, 0), 10, 90, 360))
info("over 360 (450)", CenterArc((0, 0), 10, 0, 450))
info("center (5,5)", CenterArc((5, 5), 10, 0, 90))
info("center 3D (0,0,7)", CenterArc((0, 0, 7), 10, 0, 90))
info("start -30", CenterArc((0, 0), 10, -30, 60))
info("start 720", CenterArc((0, 0), 10, 720, 90))
info("tiny 0.001 deg", CenterArc((0, 0), 10, 0, 0.001))
info("359.999", CenterArc((0, 0), 10, 0, 359.999))
print("[01] is_closed full:", CenterArc((0, 0), 10, 0, 360).is_closed)
for args in [((0, 0), 0, 0, 90), ((0, 0), -5, 0, 90), ((0, 0), 10, 0, 0)]:
    try:
        e = CenterArc(*args)
        print("[01]", args, "->", e, e.length)
    except Exception as ex:
        print("[01]", args, "->", type(ex).__name__, ex)
snapshot("arcs", CenterArc((0, 0), 10, 0, 90), CenterArc((0, 0), 8, 0, -90), CenterArc((0, 0), 5, 90, 360), view="top")
