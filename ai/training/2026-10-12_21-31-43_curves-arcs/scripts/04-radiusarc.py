# RadiusArc: which of the arcs (sign of radius), minimum radius, plane, exactness of the end point
def info(tag, e, a, b):
    print(f"[04] {tag}: mid {e.point_at(0.5)} c {e.arc_center} r {e.radius:.6f} len {e.length:.6f} "
          f"start err {(e.start - Vector(a)).length:.2e} end err {(e.end - Vector(b)).length:.2e}")
a, b = (0, 0), (10, 0)
info("r=+10", RadiusArc(a, b, 10), a, b)
info("r=-10", RadiusArc(a, b, -10), a, b)
info("r=+5 (half circle)", RadiusArc(a, b, 5), a, b)
info("r=-5 (half circle)", RadiusArc(a, b, -5), a, b)
info("r=+100", RadiusArc(a, b, 100), a, b)
a2, b2 = (10, 0), (0, 0)
info("reversed points r=+10", RadiusArc(a2, b2, 10), a2, b2)
# a vertical chord: left of start->end
info("up chord r=+10", RadiusArc((0, 0), (0, 10), 10), (0, 0), (0, 10))
for r in (4.999, 4.9999999999999, -4.999):
    try:
        e = RadiusArc(a, b, r)
        print("[04] r", r, "->", e)
    except Exception as ex:
        print("[04] r", r, "->", type(ex).__name__, ex)
try:
    RadiusArc(a, b, 0)
except Exception as ex:
    print("[04] r 0 ->", type(ex).__name__, ex)
try:
    RadiusArc(a, a, 5)
except Exception as ex:
    print("[04] equal points ->", type(ex).__name__, ex)
# planes: points are world points; the plane decides "left"
for name in ("XY", "XZ", "front", "back", "YZ"):
    pl = getattr(Plane, name)
    try:
        e = RadiusArc((0, 0, 0), (10, 0, 0), 10, plane=pl)
        print(f"[04] plane {name}: mid {e.point_at(0.5)} normal {e.normal}")
    except Exception as ex:
        print(f"[04] plane {name} ->", type(ex).__name__, ex)
e = RadiusArc((0, 0), (10, 0), 10, plane=Plane.XY.offset(5))
print("[04] plane XY.offset(5): start", e.start, "mid", e.point_at(0.5))
# points not in the plane: chord along the plane normal
try:
    e = RadiusArc((0, 0, 0), (0, 0, 10), 10)
    print("[04] chord along Z with plane XY:", e)
except Exception as ex:
    print("[04] chord along Z with plane XY ->", type(ex).__name__, ex)
snapshot("radiusarcs", RadiusArc(a, b, 10), RadiusArc(a, b, -10), RadiusArc(a, b, 5), Line(a, b), view="top")
