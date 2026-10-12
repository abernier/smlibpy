# CenterArc on planes: center in plane coordinates, angle reference, normal
for name in ("XY", "XZ", "YZ", "front", "right", "back", "bottom"):
    pl = getattr(Plane, name)
    e = CenterArc((0, 0), 10, 0, 90, plane=pl)
    print(f"[02] {name}: start {e.start} end {e.end} normal {e.normal}")
e = CenterArc((5, 2), 10, 0, 90, plane=Plane.XZ)
print("[02] center (5,2) on XZ -> world center", e.arc_center, "start", e.start)
off = Plane.XY.offset(5)
e = CenterArc((1, 2), 3, 0, 180, plane=off)
print("[02] center (1,2) on XY.offset(5) -> world center", e.arc_center, "start", e.start)
p = Plane(origin=(10, 0, 0), z_dir=(1, 0, 0))
print("[02] custom plane x_dir", p.x_dir, "y_dir", p.y_dir)
e = CenterArc((0, 0), 5, 0, 90, plane=p)
print("[02] custom plane: center", e.arc_center, "start", e.start, "end", e.end)
# .on() gives the same thing as plane=
a = CenterArc((5, 2), 10, 0, 90).on(Plane.XZ)
print("[02] .on(XZ) same:", a.start, a.end, a.arc_center)
