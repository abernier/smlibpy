# outline: visible side, hidden lines, accuracy of projected circles, plane orientation.
part = Box(30, 30, 10) - Cylinder(5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, -5)  # blind hole from below
print("[22] Plane.XY normal", Plane.XY.z_dir, " Plane.bottom normal", Plane.bottom.z_dir, " Plane.XZ normal", Plane.XZ.z_dir)
for name, pl in (("XY (from +Z)", Plane.XY), ("bottom (from -Z)", Plane.bottom)):
    cs = part.outline(pl)
    print(f"[22] blind hole from below, outline on {name}: n={len(cs)} lengths={sorted(round(c.length, 4) for c in cs)}")
cs = Cylinder(5, 20).outline(Plane.XY)
c = cs[0]
pts = [c.point_at(i/400) for i in range(401)]
print(f"[22] projected circle: length={c.length:.10g} exp={2*math.pi*5:.10g} max radius error={max(abs(math.hypot(p.x, p.y)-5) for p in pts):.1e} closed={c.is_closed}")
# a box behind another: is the hidden one removed?
pair = Box(10, 10, 10) + Box(4, 4, 4).translate(0, 0, -10)
cs = pair.outline(Plane.XY)
print(f"[22] small box under a big box, from +Z: n={len(cs)} lengths={sorted(round(c.length, 4) for c in cs)}")
cs = pair.outline(Plane.bottom)
print(f"[22] same from -Z: n={len(cs)} lengths={sorted(round(c.length, 4) for c in cs)}")
# the 2D coordinates: are results in world coordinates on the plane? XZ origin moved
cs = Box(20, 10, 5).translate(100, 0, 0).outline(Plane.XZ.offset(7))
print(f"[22] box at x=100 on XZ.offset(7): y of pieces={sorted(set(round(c.point_at(0.5).y, 6) for c in cs))} x range={min(c.bbox().min.x for c in cs):.3f}..{max(c.bbox().max.x for c in cs):.3f}")
snapshot("blind", part, view="bottom")
