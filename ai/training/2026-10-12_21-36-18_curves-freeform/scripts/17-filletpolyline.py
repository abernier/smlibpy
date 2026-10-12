# FilletPolyline: open and closed, radius limits, 3D, tangency
o = FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)
print("[17] open:", o, [e.geom_type for e in o.edges()], "start", o.start, "end", o.end)
arcs = [e for e in o.edges() if e.geom_type == "circle"]
print("[17] arcs:", [(round(a.radius, 6), a.arc_center.to_tuple()) for a in arcs])
for i, (e1, e2) in enumerate(zip(o.edges(), o.edges()[1:])):
    print(f"[17]   joint {i}: {e1.tangent_at(1).angle_to(e2.tangent_at(0)):.2e} deg, gap {(e1.end - e2.start).length:.1e}")
c = FilletPolyline((0, 0), (20, 0), (20, 10), (0, 10), radius=2, close=True)
print("[17] closed:", c, "area", round(make_face(c).area, 6), "expected", round(200 - 4 * (4 - math.pi), 6))
# radius limits on a 10 long middle segment with two 90 deg corners: r <= 5
for r in (4.99, 5.0, 5.01):
    try:
        x = FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=r)
        print(f"[17] r={r}: {x} {[e.geom_type for e in x.edges()]}")
    except Exception as ex:
        print(f"[17] r={r} ->", type(ex).__name__, ex)
# end segments carry one setback only: first segment 20 long, corner 90 deg: r up to 20
for r in (19, 21):
    try:
        x = FilletPolyline((0, 0), (20, 0), (20, 50), radius=r)
        print(f"[17] one corner r={r}: {x}")
    except Exception as ex:
        print(f"[17] one corner r={r} ->", type(ex).__name__, ex)
# acute corner: setback = r * tan(angle/2) is long
x = FilletPolyline((0, 0), (20, 0), (0, 5), radius=1)
print("[17] acute corner (14 deg):", x, [round(e.length, 4) for e in x.edges()])
# 3D polyline
p3 = FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), (30, 30, 30), radius=5)
print("[17] 3D:", p3, [e.geom_type for e in p3.edges()], "arc normals", [e.normal.to_tuple() for e in p3.edges() if e.geom_type == "circle"])
# collinear points: no arc
cl = FilletPolyline((0, 0), (10, 0), (20, 0), (20, 10), radius=2)
print("[17] collinear point:", [e.geom_type for e in cl.edges()])
# two points: nothing to round
print("[17] two points:", FilletPolyline((0, 0), (10, 0), radius=2))
try:
    FilletPolyline((0, 0), (10, 0), (10, 10))
except Exception as ex:
    print("[17] missing radius ->", type(ex).__name__, ex)
# 180 degree turn back
try:
    x = FilletPolyline((0, 0), (10, 0), (0, 0.0), radius=1)
    print("[17] reversal:", x)
except Exception as ex:
    print("[17] reversal ->", type(ex).__name__, ex)
snapshot("fp", o, c.translate(0, 20), x.translate(50, 0), view="top")
