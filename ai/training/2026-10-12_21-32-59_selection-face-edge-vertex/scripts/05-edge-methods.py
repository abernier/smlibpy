# point_at range, reversed, intersections, is_seam, equality
def r3(v): return tuple(round(c, 4) for c in v)
arc = CenterArc((0, 0, 0), 10, 0, 180)
print("[05] arc point_at 0/0.25/0.5/1:", [r3(arc.point_at(t)) for t in (0, 0.25, 0.5, 1)])
print("[05] arc point_at -0.5 / 1.5:", r3(arc.point_at(-0.5)), r3(arc.point_at(1.5)))
sp = Spline((0, 0, 0), (2, 8, 0), (10, 0, 0))
pts = [sp.point_at(i / 4) for i in range(5)]
print("[05] spline quarter chord lengths:", [round(pts[i].distance_to(pts[i + 1]), 3) for i in range(4)], " total", round(sp.length, 3))
print("[05] spline point_at(0.5) vs half length check:", r3(sp.point_at(0.5)))
rv = arc.reversed()
print("[05] reversed start/end:", r3(rv.start), r3(rv.end), " tan0", r3(rv.tangent_at(0)), " point_at(0.25)", r3(rv.point_at(0.25)))
print("[05] reversed == original:", rv == arc, " normal of reversed:", r3(rv.normal), " original:", r3(arc.normal))
print("[05] reversed geom/length:", rv.geom_type, round(rv.length, 4))
box = Box(10, 10, 10)
e = box.edges().first
print("[05] part edge reversed == edge:", e.reversed() == e, " in edges():", e.reversed() in box.edges(), " faces:", len(e.reversed().faces()))
r = box.fillet(e.reversed(), 1)
print("[05] fillet reversed part edge:", round(r.volume, 3))
# intersections
a = Line((0, 0, 0), (10, 10, 0)); b = Line((0, 10, 0), (10, 0, 0))
print("[05] line x line:", [r3(p) for p in a.intersections(b)])
c = Circle(5).edges().one()
print("[05] circle x line through center:", [r3(p) for p in c.intersections(Line((-10, 0, 0), (10, 0, 0)))])
def inter(label, x, y):
    try:
        print(f"[05] {label}:", [r3(p) for p in x.intersections(y)])
    except Exception as ex:
        print(f"[05] {label}:", type(ex).__name__, ex)
inter("lines whose extensions cross at (15,15)", a, Line((20, 0, 0), (30, -10, 0)))
inter("parallel lines", a, Line((1, 0, 0), (11, 10, 0)))
inter("skew lines", a, Line((0, 10, 1), (10, 0, 1)))
inter("circle and far line", c, Line((20, 0, 0), (30, 0, 0)))
inter("circle and line ending inside", c, Line((0, 0, 0), (10, 0, 0)))
inter("part edges at a corner", box.edges()[0], box.edges()[1])
inter("collinear overlap", a, Line((5, 5, 0), (20, 20, 0)))
inter("arc x arc", CenterArc((0, 0, 0), 5, 0, 180), CenterArc((5, 0, 0), 5, 0, 180))
inter("spline x line", sp, Line((0, 3, 0), (10, 3, 0)))
# arc-length parameter check
n = 400
samp = [sp.point_at(i / n) for i in range(n + 1)]
seg = [samp[i].distance_to(samp[i + 1]) for i in range(n)]
print("[05] spline segment lengths min/max (should be equal):", round(min(seg), 5), round(max(seg), 5), " sum", round(sum(seg), 4))
# is_seam
cyl = Cylinder(5, 10)
print("[05] is_seam:", [(x.geom_type, x.is_seam) for x in cyl.edges(seams=True)], " free edge:", a.is_seam)
print("[05] sphere seams:", [(x.geom_type, x.is_seam, round(x.length, 3)) for x in Sphere(5).edges(seams=True)])
print("[05] torus seams:", [(x.geom_type, x.is_seam, round(x.length, 3)) for x in Torus(10, 2).edges(seams=True)])
# equality of free edges
l1 = Line((0, 0, 0), (1, 0, 0)); l2 = Line((0, 0, 0), (1, 0, 0))
print("[05] two equal free lines ==:", l1 == l2, " l1 == l1:", l1 == l1)
# edges of a wire carry the loop direction
top = (Box(10, 10, 10)).faces().top().one()
ow = top.outer_wire().edges()
print("[05] outer wire edges in edges():", [x in top.edges() for x in ow], " directions:", [r3(x.tangent_at(0.5)) for x in ow])
print("[05] distance_to:", round(a.distance_to((0, 10, 0)), 4), round(c.distance_to((0, 0, 0)), 4))
print("[05] Edge() direct:", end=" ")
try:
    Edge()
except Exception as ex:
    print(type(ex).__name__, ex)
