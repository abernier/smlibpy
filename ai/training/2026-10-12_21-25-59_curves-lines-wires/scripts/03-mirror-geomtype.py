# Do mirror / scale keep lines and arcs as lines and arcs?
l = Line((0, 0), (10, 5))
arc = CenterArc((0, 0), 5, 0, 90)
for name, e in [("line", l), ("arc", arc)]:
    m = e.mirror(Plane.XZ)
    s = e.scale(2)
    print(f"[03] {name}: mirror -> {m.geom_type}, scale -> {s.geom_type}, rotate -> {e.rotate(Z, 30).geom_type}")
m = arc.mirror(Plane.XZ)
try:
    print("[03] mirrored arc radius:", m.radius)
except Exception as ex:
    print("[03] mirrored arc radius ->", type(ex).__name__, ex)
try:
    print("[03] mirrored line direction:", l.mirror(Plane.XZ).direction)
except Exception as ex:
    print("[03] mirrored line direction ->", type(ex).__name__, ex)
# wire fillet after mirror
half = Polyline((-20, 0), (-20, 10), (20, 10), (20, 0))
full = half + half.mirror(Plane.XZ)
print("[03] full:", full, [e.geom_type for e in full.edges()])
f = full.fillet(2)
print("[03] filleted edges:", len(f.edges()), [e.geom_type for e in f.edges()])
sk = make_face(full)
print("[03] face area:", sk.area, "edges:", [e.geom_type for e in sk.edges()])
skf = sk.fillet(2)
print("[03] sketch.fillet area:", round(skf.area, 4), "expected", round(40 * 20 - 4 * (4 - math.pi) * 1, 4))
