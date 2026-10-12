# Edge properties on line, circle, arc, ellipse, bspline; part edges and free edges
def r3(v): return tuple(round(c, 4) for c in v)
def show(label, e):
    row = [e.geom_type, "len", round(e.length, 4), "start", r3(e.start), "end", r3(e.end), "closed", e.is_closed,
           "mid", r3(e.point_at(0.5)), "center", r3(e.center()), "tan0", r3(e.tangent_at(0))]
    for attr in ("direction", "radius", "arc_center", "normal"):
        try:
            v = getattr(e, attr)
            row += [attr, round(v, 4) if isinstance(v, float) else r3(v)]
        except Exception as ex:
            row += [attr, f"{type(ex).__name__}: {ex}"]
    print(f"[04] {label}:", *row)
show("Line", Line((0, 0, 0), (10, 0, 0)))
show("CenterArc", CenterArc((0, 0, 0), 5, 0, 90))
show("Circle edge", Circle(5).edges().one())
show("EllipticalArc", EllipticalArc((0, 0, 0), 6, 3, 0, 180))
show("Spline", Spline((0, 0, 0), (5, 5, 0), (10, 0, 0)))
cyl = Cylinder(5, 10)
for e in cyl.edges():
    show("cyl rim", e)
show("cyl rim tan(0) x normal", cyl.edges().top().one())
t = cyl.edges().top().one()
print("[04] top rim: tangent_at(0) x normal:", r3(t.tangent_at(0).cross(t.normal)), " start", r3(t.start))
hole = Box(20, 20, 10) - Cylinder(3, 20)
for e in hole.edges().circles():
    print("[04] hole rim z", round(e.center().z, 3), "normal", r3(e.normal), "tan0", r3(e.tangent_at(0)), "start", r3(e.start))
# part edge directions: lines of a box
for e in Box(2, 2, 2).edges().parallel_to(Z):
    print("[04] box vertical edge:", r3(e.start), "->", r3(e.end), "direction", r3(e.direction))
# ellipse edge on a part
el = Cylinder(5, 20) - Rot(x=30) * Box(30, 30, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))
for e in el.edges().of_type("ellipse"):
    show("ellipse on part", e)
