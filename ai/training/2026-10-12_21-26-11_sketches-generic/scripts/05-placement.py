# Placing sketches: on(plane), Plane * sketch, Pos * sketch, on(face); plane after placement; extrude direction
def show(label, s):
    p = s.plane
    bb = s.bbox()
    ex = s.extrude(3).bbox()
    print(f"[05] {label}: origin={p.origin} x={p.x_dir} y={p.y_dir} z={p.z_dir} bbox={bb.min}..{bb.max} extrude(3) bbox={ex.min}..{ex.max}")

r = Rectangle(20, 10, align=Align.MIN)   # lower-left corner at origin: shows where local x/y go
for name in ["XY", "XZ", "YZ", "top", "bottom", "front", "back", "left", "right"]:
    show("on " + name, r.on(getattr(Plane, name)))
show("Plane.XY.offset(15) * r", Plane.XY.offset(15) * r)
show("on XY.offset(15)", r.on(Plane.XY.offset(15)))
show("Pos(0,0,15) * r", Pos(0, 0, 15) * r)
show("translate z", r.translate(0, 0, 15))
show("Rot(x=90) * r", Rot(x=90) * r)
show("rotate about Z 30", r.rotate(Z, 30))
show("on Location", r.on(Pos(5, 5, 5) * Rot(y=90)))
show("on rotated plane", r.on(Plane.XY.rotated(x=30)))
show("mirror XZ", r.mirror(Plane.XZ))
show("mirror YZ", r.mirror(Plane.YZ))
