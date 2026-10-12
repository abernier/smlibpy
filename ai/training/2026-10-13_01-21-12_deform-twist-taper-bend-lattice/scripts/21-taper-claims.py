# taper claims: off-axis parts move toward the axis, holes across the axis come out oval
off = Box(20, 20, 50, align=(Align.MIN, Align.MIN, Align.MIN)).taper(0.5)
top = off.faces().sort_by(Z)[-1]
print("[21] off-axis box: top face bbox", top.bbox())
holed = (Box(40, 40, 60) - Cylinder(5, 50).rotate(X, 90)).taper(0.5)
ring = [e for e in holed.edges() if e.bbox().size.x < 10 and e.bbox().min.y > 10]
bb = ring[0].bbox()
print("[21] hole edge on the +Y face after the taper: x size", round(bb.size.x, 4), "z size", round(bb.size.z, 4))
