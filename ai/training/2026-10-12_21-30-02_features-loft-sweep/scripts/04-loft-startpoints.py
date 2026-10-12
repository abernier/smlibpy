def info(tag, s):
    w = s.faces()[0].outer_wire()
    es = w.edges()
    print(f"[{tag}] start={tuple(round(v,3) for v in w.start.to_tuple())} edges={len(es)} first-edge-end={tuple(round(v,3) for v in es[0].end.to_tuple())} tangent0={tuple(round(v,3) for v in w.tangent_at(0).to_tuple())}")

for tag, s in [("Rectangle(20,20)", Rectangle(20, 20)), ("Rectangle(20,10)", Rectangle(20, 10)), ("Circle(10)", Circle(10)),
               ("RegularPolygon(10,6)", RegularPolygon(10, 6)), ("RegularPolygon(10,3)", RegularPolygon(10, 3)),
               ("Slot(30,10)", Slot(30, 10)), ("RoundedRectangle(30,20,4)", RoundedRectangle(30, 20, 4)),
               ("Polygon tri", Polygon((0, 0), (10, 0), (0, 10))), ("Ellipse(10,5)", Ellipse(10, 5)),
               ("Circle rotated 45", Circle(10).rotate(Z, 45)), ("Rectangle rot 90", Rectangle(20, 10).rotate(Z, 90))]:
    info(tag, s)

def frustum(a0, a1, h):
    return h/3*(a0+a1+math.sqrt(a0*a1))
# a hexagon whose corners line up with the square: is the twist from start points?
a = loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)
print("[rect->hex] vol", round(a.volume, 3), "area at z=10", round(a.section(Plane.XY.offset(10)).area, 3))
print("unwisted estimate (frustum of mean)", round(frustum(400, 259.81, 20), 1))
