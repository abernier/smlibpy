# Edge and wire length and center against formulas.
pi = math.pi
def ellipse_perimeter(a, b):
    f = lambda t: math.hypot(a*math.sin(t), b*math.cos(t))
    n = 200000
    return sum(f((i+0.5)*2*pi/n) for i in range(n)) * 2*pi/n
cases = [
    ("line", Line((0, 0, 0), (3, 4, 12)), 13.0),
    ("circle r7", CenterArc((0, 0, 0), 7, 0, 360), 2*pi*7),
    ("arc r7 90deg", CenterArc((0, 0, 0), 7, 0, 90), pi*7/2),
    ("arc r7 90deg far+tilted", CenterArc((1e4, 2e4, 3e4), 7, 10, 90, Plane((0, 0, 0), z_dir=(1, 1, 1))), pi*7/2),
    ("ellipse 10x4", EllipticalArc((0, 0), 10, 4), ellipse_perimeter(10, 4)),
    ("helix p5 h50 r10", Helix(5, 50, 10), 10*math.hypot(2*pi*10, 5)),
]
for name, e, L in cases:
    print(f"[11] {name}: geom={e.geom_type} length={e.length:.12g} exp={L:.12g} rel={(e.length-L)/L:+.2e}")
# spline length against a dense polyline
sp = Spline((0, 0), (10, 5), (20, -3), (30, 8))
pts = [sp.point_at(i/20000) for i in range(20001)]
Lp = sum((pts[i+1]-pts[i]).length for i in range(20000))
print(f"[11] spline: length={sp.length:.12g} polyline(20000)={Lp:.12g} rel={(sp.length-Lp)/Lp:+.2e}")
# centers: edge center is the midpoint along the edge, not the centroid
arc = CenterArc((0, 0, 0), 10, 0, 180)
print(f"[11] semicircle r10: center()={arc.center()} arc_center={arc.arc_center} radius={arc.radius} (centroid of the arc would be (0, {20/pi:.6f}, 0))")
circ = CenterArc((5, 5, 0), 10, 0, 360)
print(f"[11] full circle at (5,5): center()={circ.center()} arc_center={circ.arc_center} is_closed={circ.is_closed}")
w = Polyline((0, 0), (10, 0), (10, 10))
print(f"[11] L polyline: length={w.length} center()={w.center()} (length-weighted edge midpoints)")
sq = Polyline((0, 0), (10, 0), (10, 10), (0, 10), close=True)
print(f"[11] closed square wire: length={sq.length} center()={sq.center()} is_closed={sq.is_closed}")
semi = Wire([CenterArc((0, 0, 0), 10, 0, 180), Line((-10, 0), (10, 0))])
print(f"[11] semicircle+diameter wire: length={semi.length:.10g} exp={10*pi+20:.10g} center()={semi.center()}")
# edges of a part
cyl = Cylinder(6, 20)
for e in cyl.edges():
    print(f"[11] cylinder edge {e.geom_type}: length={e.length:.12g} center()={e.center()} arc_center={e.arc_center} radius={e.radius}")
print(f"[11] cylinder edges with seams: {len(cyl.edges(seams=True))} without: {len(cyl.edges())}")
print(f"[11] ShapeList center of the two circles: {cyl.edges().center()}")
print(f"[11] sum of box edge lengths: {sum(e.length for e in Box(40, 30, 20).edges())} exp {4*(40+30+20)}")
