# SagittaArc: sign of the sagitta, size, large sagitta (> half chord), zero, planes
a, b = (0, 0), (10, 0)
for s in (2, -2, 5, -5, 8, 0.001):
    e = SagittaArc(a, b, s)
    print(f"[05] s={s}: mid {e.point_at(0.5)} r {e.radius:.6f} c {e.arc_center} len {e.length:.6f} "
          f"expected r {(s * s + 25) / (2 * abs(s)):.6f}")
for s in (0, 1e-12):
    try:
        print(f"[05] s={s} ->", SagittaArc(a, b, s))
    except Exception as ex:
        print(f"[05] s={s} ->", type(ex).__name__, ex)
e = SagittaArc((0, 0), (0, 10), 2)
print("[05] up chord s=2: mid", e.point_at(0.5))
for name in ("XZ", "back"):
    e = SagittaArc((0, 0, 0), (10, 0, 0), 2, plane=getattr(Plane, name))
    print(f"[05] plane {name}: mid {e.point_at(0.5)}")
try:
    SagittaArc(a, a, 2)
except Exception as ex:
    print("[05] equal points ->", type(ex).__name__, ex)
snapshot("sagitta", SagittaArc(a, b, 2), SagittaArc(a, b, -2), SagittaArc(a, b, 8), Line(a, b), view="top")
