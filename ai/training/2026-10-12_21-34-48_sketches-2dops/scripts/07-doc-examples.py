# Realistic use and the examples of make_face.md, offset.md, fillet.md, unchanged
# --- make_face
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bracket = make_face(outline, CenterArc((12, 12), 4, 0, 360))      # area 1200 - 16 pi
plate = bracket.extrude(5)

half = Wire([
    Line((-25, 0), (-25, -7.5)),
    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
    Line((25, -7.5), (25, 0)),
])
body = make_face(half + half.mirror(Plane.XZ))

profile = make_face(Polyline((5, 0, 0), (20, 0, 0), (20, 0, 3), (15, 0, 6), (15, 0, 10), (5, 0, 10), close=True))
pulley = profile.revolve(Axis((0, 0, 0), (0, 0, 1)))                # turn about Z
print("[07] bracket:", round(bracket.area, 4), round(1200 - 16 * math.pi, 4), plate.is_valid())
print("[07] body:", round(body.area, 4), body.bbox().min, body.bbox().max)
# Pappus: V = 2 pi * x_centroid * area
c = profile.center()
print("[07] pulley:", round(pulley.volume, 3), "pappus:", round(2 * math.pi * c.x * profile.area, 3), "valid:", pulley.is_valid(), "plane z:", profile.plane.z_dir, "bbox:", pulley.bbox().min, pulley.bbox().max)
# --- offset
outline = RoundedRectangle(60, 40, 6)
gasket = outline - outline.offset(-4)                # a 4 wide frame, inner corners radius 2
clearance = outline.offset(0.5)                      # 0.5 larger all round
square = Rectangle(40, 20).offset(2, round=False)    # 44 x 24, sharp corners
inner = gasket.faces()[0].inner_wires()[0]
print("[07] gasket:", repr(gasket), "holes:", len(gasket.faces()[0].inner_wires()), "inner bbox:", inner.bbox().min, inner.bbox().max)
print("[07] gasket area:", round(gasket.area, 4), "formula:", round((2400 - (4 - math.pi) * 36) - (52 * 32 - (4 - math.pi) * 4), 4))
print("[07] clearance bbox:", clearance.bbox().min, clearance.bbox().max, "square:", square.bbox().size, round(square.area, 4))
# --- fillet
bracket = Polygon((0, 0), (40, 0), (40, 6), (6, 6), (6, 30), (0, 30))
rounded = bracket.fillet(2)                                   # every corner
inside = bracket.fillet(4, [(6, 6)])                          # only the inner corner
tab = Rectangle(30, 10).fillet(5, Rectangle(30, 10).vertices().filter(lambda v: v.x > 0))   # round right end
print("[07] rounded:", round(rounded.area, 4), "formula:", round(384 - 5 * (4 - math.pi) + (4 - math.pi), 4))
print("[07] inside:", round(inside.area, 4), "formula:", round(384 + (4 - math.pi) * 4, 4))
print("[07] tab:", round(tab.area, 4), "edges:", [e.geom_type for e in tab.edges()], "bbox:", tab.bbox().min, tab.bbox().max)
part = inside.extrude(20)
print("[07] fillet extrude valid:", part.is_valid(), "faces:", len(part.faces()))
snapshot("examples", pulley, gasket.extrude(2).translate(60, 0, 0), part.translate(0, 40, 0), view="iso")
