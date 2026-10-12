# ThreePointArc: passes through the middle point? which side? 3D, > 180 degrees, errors
def info(tag, e, through=None):
    d = e.distance_to(through) if through is not None else None
    print(f"[03] {tag}: start {e.start} end {e.end} r {e.radius:.6f} c {e.arc_center} n {e.normal} "
          f"len {e.length:.6f} dist(through) {d}")
info("upper half", ThreePointArc((-10, 0), (0, 10), (10, 0)), (0, 10))
info("lower half", ThreePointArc((-10, 0), (0, -10), (10, 0)), (0, -10))
info("off-centre through", ThreePointArc((-10, 0), (6, 8), (10, 0)), (6, 8))
info("major arc (> 180)", ThreePointArc((10, 0), (-10, 0), (0, -10)), (-10, 0))
info("3D tilted", ThreePointArc((0, 0, 0), (5, 5, 5), (10, 0, 10)), (5, 5, 5))
info("on XZ", ThreePointArc((0, 0, 0), (5, 0, 5), (10, 0, 0)), (5, 0, 5))
e = ThreePointArc((-10, 0), (0, 10), (10, 0))
print("[03] tangent at start:", e.tangent_at(0), "at end:", e.tangent_at(1))
for args in [((0, 0), (5, 0), (10, 0)), ((0, 0), (0, 0), (10, 0)), ((0, 0), (10, 0), (10, 0)), ((0, 0), (5, 5), (0, 0)), ((0, 0), (5, 1e-9), (10, 0))]:
    try:
        e = ThreePointArc(*args)
        print("[03]", args, "->", e, "r", e.radius, "len", e.length)
    except Exception as ex:
        print("[03]", args, "->", type(ex).__name__, ex)
snapshot("arcs", ThreePointArc((-10, 0), (0, 10), (10, 0)), ThreePointArc((-10, 0), (6, 8), (10, 0)),
         ThreePointArc((10, 0), (-10, 0), (0, -10)).translate(30, 0), view="top")
