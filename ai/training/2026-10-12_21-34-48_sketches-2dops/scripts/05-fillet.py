# Sketch.fillet: all corners, chosen vertices, radius limits, holes, concave corners, arcs
def info(label, s):
    b = s.bbox()
    print(f"[05] {label}: {s!r} faces={len(s.faces())} holes={[len(f.inner_wires()) for f in s.faces()]} "
          f"edges={[e.geom_type[0] for e in s.edges()]} bbox={tuple(round(v, 4) for v in b.min)}..{tuple(round(v, 4) for v in b.max)}")
def attempt(label, fn):
    try:
        s = fn(); info(label, s); return s
    except Exception as e:
        print(f"[05] {label}: {type(e).__name__}: {e}")
r = Rectangle(40, 20)
f = attempt("rect fillet 3", lambda: r.fillet(3))
print("[05]   area", round(f.area, 5), "formula", round(800 - (4 - math.pi) * 9, 5), "radii", sorted({round(e.radius, 6) for e in f.edges().circles()}))
one = attempt("one corner by tuple", lambda: r.fillet(5, [(20, 10)]))
attempt("one corner by 2D tuple w/o z", lambda: r.fillet(5, [(20, 10, 0)]))
attempt("two corners by Vertex selection (right)", lambda: r.fillet(5, r.vertices().filter(lambda v: v.x > 0)))
attempt("vertices sorted by x, last 2", lambda: r.fillet(5, r.vertices().sort_by(X)[-2:]))
attempt("a point that is no corner", lambda: r.fillet(5, [(0, 0)]))
attempt("empty list", lambda: r.fillet(5, []))
attempt("single tuple (not in a list)", lambda: r.fillet(5, (20, 10)))
attempt("radius = half short side (10)", lambda: r.fillet(10))
attempt("radius 10.0001", lambda: r.fillet(10.0001))
attempt("radius 15", lambda: r.fillet(15))
attempt("radius 15 on one corner", lambda: r.fillet(15, [(20, 10)]))
attempt("radius 0", lambda: r.fillet(0))
attempt("radius -2", lambda: r.fillet(-2))
# concave corners, holes
L = Polygon((0, 0), (30, 0), (30, 10), (10, 10), (10, 30), (0, 30))
lf = attempt("L fillet 3", lambda: L.fillet(3))
print("[05]   L area", round(lf.area, 5), "formula 500 - 5*(4-pi)*9/4 + (4-pi)*9/4:", round(500 - 5 * (4 - math.pi) * 9 / 4 + (4 - math.pi) * 9 / 4, 5))
attempt("L concave corner only", lambda: L.fillet(3, [(10, 10)]))
frame = Rectangle(40, 40) - Rectangle(20, 20)
ff = attempt("frame fillet 2 (holes too)", lambda: frame.fillet(2))
print("[05]   frame area", round(ff.area, 5), "formula", round(1600 - (4 - math.pi) * 4 - (400 - (4 - math.pi) * 4), 5))
attempt("frame outer corners only", lambda: frame.fillet(2, frame.faces()[0].outer_wire().vertices()))
# corners with arcs
attempt("slot fillet (arcs only)", lambda: Slot(30, 10).fillet(2))
attempt("rect + circle fillet", lambda: (Rectangle(40, 20) + Circle(8).translate(20, 0)).fillet(2))
attempt("circle fillet", lambda: Circle(5).fillet(1))
# acute angle
tri = Polygon((0, 0), (50, 0), (0, 5))
attempt("acute triangle fillet 1", lambda: tri.fillet(1))
attempt("acute triangle fillet 3", lambda: tri.fillet(3))
# several pieces, placed
two = Rectangle(10, 10).translate(-10, 0) + Rectangle(10, 10).translate(10, 0)
attempt("two pieces fillet 2", lambda: two.fillet(2))
xz = Rectangle(20, 10).on(Plane.XZ)
xf = attempt("on XZ fillet 2", lambda: xz.fillet(2))
print("[05]   XZ plane z:", xf.plane.z_dir, "extrude bbox:", xf.extrude(3).bbox().min, xf.extrude(3).bbox().max)
attempt("on XZ, corner by 3D point", lambda: xz.fillet(4, [(10, 0, 5)]))
attempt("on XZ, corner by local 2D point", lambda: xz.fillet(4, [(10, 5)]))
snapshot("fillets", r.fillet(5, [(20, 10)]), L.fillet(3).translate(30, -15), frame.fillet(2).translate(80, 0), view="top")
