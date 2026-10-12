# Which geom_type names occur, and which bodies produce them
def types(label, b):
    ft = sorted({f.geom_type for f in b.faces()})
    et = sorted({e.geom_type for e in b.edges()})
    print(f"[07] {label}: faces {ft} edges {et}")
    return b
types("Cone", Cone(5, 2, 10))
types("Sphere", Sphere(5))
types("Torus", Torus(10, 2))
types("Box.fillet", Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 2))
types("Box.chamfer", Box(10, 10, 10).chamfer(Box(10, 10, 10).edges(), 1))
# inclined cut through a cylinder -> ellipse edge
el = Cylinder(5, 20) - Rot(x=30) * Box(30, 30, 30, align=(Align.CENTER, Align.CENTER, Align.MIN))
types("cyl inclined cut", el)
types("Ellipse extrude", Ellipse(6, 3).extrude(5))
# spline profile extruded -> extrusion?
prof = make_face(Polyline((0, 0), (10, 0), (10, 5)) + Spline((10, 5), (5, 8), (0, 5)) + Line((0, 5), (0, 0)))
types("spline extrude", prof.extrude(5))
# revolved spline profile -> revolution?
rp = make_face(Polyline((0, 0), (5, 0)) + Spline((5, 0), (7, 5), (4, 10)) + Polyline((4, 10), (0, 10), (0, 0)))
types("spline revolve", rp.on(Plane.XZ).revolve(Z) if True else None)
# loft
types("loft", loft([Rectangle(10, 10), Circle(4).on(Plane.XY.offset(10))]))
# offset of a filleted box
try:
    types("offset fillet box", offset(Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 2), 1))
except Exception as ex:
    print("[07] offset:", type(ex).__name__, ex)
try:
    types("offset spline extrude", offset(prof.extrude(5), 1))
except Exception as ex:
    print("[07] offset2:", type(ex).__name__, ex)
types("surface", surface([[(x, y, math.sin(x / 5) + math.cos(y / 5)) for x in (0, 4, 8, 12)] for y in (0, 4, 8, 12)]))
types("to_nurbs Box-hole", (Box(20, 20, 10) - Cylinder(3, 20)).to_nurbs())
types("Helix sweep", Circle(0.5).sweep(Helix(5, 10, 3)) if hasattr(Sketch, "sweep") else None)
# of_type with several names, unknown names
p = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallel_to(Z), 3) - Cylinder(3, 20)
print("[07] of_type('plane','cylinder'):", len(p.faces().of_type("plane", "cylinder")), "of", len(p.faces()))
print("[07] of_type('Cylinder'):", len(p.faces().of_type("Cylinder")))
print("[07] of_type('cylindrical'):", len(p.faces().of_type("cylindrical")), " of_type('arc'):", len(p.edges().of_type("arc")))
print("[07] planar/cylinders/lines/circles:", len(p.faces().planar()), len(p.faces().cylinders()), len(p.edges().lines()), len(p.edges().circles()))
print("[07] lines() on faces:", len(p.faces().lines()), " planar() on edges:", len(p.edges().planar()))
print("[07] fillet faces radius:", sorted({round(f.radius, 3) for f in p.faces().cylinders()}))
print("[07] arcs vs full circles:", [(round(e.radius, 2), round(e.length, 3), e.is_closed) for e in p.edges().circles().top()])
print("[07] smooth on faces:", len(p.faces().smooth()))
