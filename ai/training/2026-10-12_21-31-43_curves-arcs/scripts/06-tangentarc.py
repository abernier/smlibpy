# TangentArc: does it leave start along the tangent? major arcs, straight case, magnitude, 3D
def info(tag, e, t):
    t = Vector(t).normalized()
    print(f"[06] {tag}: type {e.geom_type} end {e.end} t0 {e.tangent_at(0)} angle(t0,t) {e.tangent_at(0).angle_to(t):.2e} "
          f"len {e.length:.6f}" + (f" r {e.radius:.6f} c {e.arc_center}" if e.geom_type == "circle" else ""))
a, b = (0, 0), (10, 0)
info("t=(0,1)", TangentArc(a, b, (0, 1)), (0, 1))
info("t=(0,-1)", TangentArc(a, b, (0, -1)), (0, -1))
info("t=(1,1)", TangentArc(a, b, (1, 1)), (1, 1))
info("t=(1,-1)", TangentArc(a, b, (1, -1)), (1, -1))
info("t=(-1,1) backwards -> major arc", TangentArc(a, b, (-1, 1)), (-1, 1))
info("t=(-1,0.01)", TangentArc(a, b, (-1, 0.01)), (-1, 0.01))
info("t=(1,0) straight", TangentArc(a, b, (1, 0)), (1, 0))
info("t=(5,5) magnitude", TangentArc(a, b, (5, 5)), (5, 5))
try:
    e = TangentArc(a, b, (-1, 0))
    info("t=(-1,0) backwards straight", e, (-1, 0))
except Exception as ex:
    print("[06] t=(-1,0) ->", type(ex).__name__, ex)
try:
    TangentArc(a, b, (0, 0))
except Exception as ex:
    print("[06] t=(0,0) ->", type(ex).__name__, ex)
try:
    TangentArc(a, a, (1, 0))
except Exception as ex:
    print("[06] equal points ->", type(ex).__name__, ex)
info("3D", TangentArc((0, 0, 0), (10, 0, 10), (0, 0, 1)), (0, 0, 1))
info("3D tangent out of plane", TangentArc((0, 0, 0), (10, 0, 0), (0, 1, 1)), (0, 1, 1))
# chaining: a slot-like outline, each arc continues the previous edge
l1 = Line((0, 0), (20, 0))
a1 = TangentArc(l1.end, (20, 10), l1.tangent_at(1))
l2 = Line(a1.end, (0, 10))
a2 = TangentArc(l2.end, (0, 0), l2.tangent_at(1))
w = Wire([l1, a1, l2, a2])
print("[06] chained:", w, "closed", w.is_closed)
for i, (e1, e2) in enumerate(zip(w.edges(), list(w.edges()[1:]) + [w.edges()[0]])):
    print(f"[06]   joint {i}: angle {e1.tangent_at(1).angle_to(e2.tangent_at(0)):.2e} deg")
sk = make_face(w)
print("[06] slot area:", round(sk.area, 6), "expected", round(200 + math.pi * 25, 6))
snapshot("tangent", TangentArc(a, b, (0, 1)), TangentArc(a, b, (1, 1)), TangentArc(a, b, (-1, 1)),
         TangentArc(a, b, (1, -1)), view="top")
snapshot("slot", w, view="top")
