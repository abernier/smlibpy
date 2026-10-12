# make_face: from Wires, Edges, holes; plane and origin
def info(label, s):
    print(f"[01] {label}: {s!r} faces={len(s.faces())} holes={[len(f.inner_wires()) for f in s.faces()]} "
          f"edges={len(s.edges())} plane origin={s.plane.origin} z={s.plane.z_dir} bbox={s.bbox().min}..{s.bbox().max}")
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
bracket = make_face(outline, bolt_hole)
info("docs bracket", bracket)
print("[01] area:", round(bracket.area, 4), "expected:", round(50 * 10 + (50 + 20) / 2 * 20 - 0 + 0, 4), "- hole", round(math.pi * 16, 4))
info("hole as an Edge", make_face(outline, CenterArc((12, 12), 4, 0, 360)))
info("outer as a closed Edge (circle)", make_face(CenterArc((0, 0), 10, 0, 360)))
info("two holes", make_face(outline, CenterArc((10, 8), 3, 0, 360), CenterArc((35, 5), 3, 0, 360)))
info("clockwise outline", make_face(Polyline((0, 0), (0, 30), (20, 30), (50, 10), (50, 0), close=True)))
# Wire([...]) from unordered, mixed-direction edges
edges = [Line((20, 0), (20, 10)), Line((0, 0), (20, 0)), Line((0, 10), (0, 0)), Line((20, 10), (0, 10))]
info("Wire of unordered edges", make_face(Wire(edges)))
# wire made with +
half = Wire([
    Line((-25, 0), (-25, -7.5)),
    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
    Line((25, -7.5), (25, 0)),
])
body = make_face(half + half.mirror(Plane.XZ))
info("half + mirror (docs)", body)
# collinear segments merged?
info("collinear points", make_face(Polyline((0, 0), (10, 0), (20, 0), (20, 10), (0, 10), close=True)))
# spline outline
sp = Spline((0, 0), (20, 10), (0, 20), (-20, 10), closed=True)
info("closed spline", make_face(sp))
# FilletPolyline outline
fp = FilletPolyline((0, 0), (40, 0), (40, 20), (0, 20), radius=5, close=True)
info("FilletPolyline", make_face(fp))
print("[01] FilletPolyline area:", round(make_face(fp).area, 4), "expected:", round(800 - (4 - math.pi) * 25, 4))
snapshot("faces", bracket, body.translate(0, -40), make_face(sp).translate(80, 0), view="top")
