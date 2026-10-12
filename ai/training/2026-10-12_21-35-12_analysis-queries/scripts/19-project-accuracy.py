# Shape accuracy of projected curves; oblique projection; the face each piece lies on.
box = Box(20, 20, 20)
cs = box.project(CenterArc((0, 0, 30), 5, 0, 360), (0, 0, -1))
for c in cs:
    pts = [c.point_at(i/400) for i in range(401)]
    dr = max(abs(math.hypot(p.x, p.y) - 5) for p in pts)
    print(f"[19] projected circle on z={c.point_at(0.5).z:.3f}: length={c.length:.9g} (exp {2*math.pi*5:.9g}) max radius error={dr:.1e} closed={c.is_closed}")
cs = Sphere(10).project(CenterArc((0, 0, 30), 5, 0, 360), (0, 0, -1))
for c in cs:
    pts = [c.point_at(i/400) for i in range(401)]
    dr = max(abs(math.hypot(p.x, p.y) - 5) for p in pts)
    ds = max(abs(p.length - 10) for p in pts)
    print(f"[19] projected circle on sphere z={c.point_at(0.5).z:.4f}: max radius error={dr:.1e} max off sphere={ds:.1e}")
cs = box.project(CenterArc((-20, 0, 30), 5, 0, 360), (1, 0, -1))
for c in cs:
    print(f"[19] oblique (1,0,-1): {c.geom_type} start={c.start} mid={c.point_at(0.5)} length={c.length:.6g}")
cs = box.project(Line((-30, 0, 30), (30, 0, 30)), (0, 0, -1))
for c in cs:
    print(f"[19] line longer than the box: start={c.start} end={c.end} length={c.length:.6g}")
