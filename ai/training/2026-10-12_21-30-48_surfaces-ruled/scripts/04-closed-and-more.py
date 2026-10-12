# Closed curves (circles), helix + axis, polyline wires, degenerate inputs.
import math
def tryit(label, fn):
    try:
        r = fn()
        print(f"[04] {label}: ok {r}")
        return r
    except Exception as e:
        print(f"[04] {label}: {type(e).__name__}: {e}")
c1 = CenterArc((0, 0, 0), 10, 0, 360)
c2 = CenterArc((0, 0, 0), 5, 0, 360).translate(0, 0, 20)
cone = tryit("circle r10 -> circle r5 at z20", lambda: ruled(c1, c2))
if cone:
    L = math.hypot(5, 20)
    print(f"[04]   area {cone.area:.4f} exact frustum {math.pi * (10 + 5) * L:.4f} edges {len(cone.edges())} seams {len(cone.edges(seams=True))}")
    print(f"[04]   normal at (10,0,0) {cone.faces()[0].normal_at((10, 0, 0))} type {cone.faces()[0].geom_type}")
cyl = tryit("circle -> same circle moved up", lambda: ruled(c1, c1.translate(0, 0, 20)))
if cyl:
    print(f"[04]   area {cyl.area:.4f} exact {2 * math.pi * 10 * 20:.4f} normal at (10,0,10) {cyl.faces()[0].normal_at((10,0,10))}")
cylr = tryit("circle -> moved circle started at 90deg", lambda: ruled(c1, CenterArc((0, 0, 20), 10, 90, 360)))
if cylr:
    print(f"[04]   area {cylr.area:.4f} (twisted by 90 deg; untwisted {2 * math.pi * 10 * 20:.1f})")
cyl_rev = tryit("circle -> moved circle running clockwise", lambda: ruled(c1, CenterArc((0, 0, 20), 10, 0, -360)))
if cyl_rev:
    print(f"[04]   area {cyl_rev.area:.4f}")
# sketch circle edge
ce = Circle(10).edges()[0]
tryit("Circle(10).edges()[0] -> moved", lambda: ruled(ce, ce.translate(0, 0, 20)).area)
# helicoid: helix and its axis
h = Helix(pitch=10, height=20, radius=10)
ax = Line((0, 0, 0), (0, 0, 20))
hel = tryit("helix -> axis line", lambda: ruled(h, ax))
if hel:
    print(f"[04]   bbox {hel.bbox().min} {hel.bbox().max} area {hel.area:.3f}")
    snapshot("helicoid", hel)
# polyline wires
tryit("two-segment polyline", lambda: ruled(Polyline((0, 0, 0), (10, 0, 0), (20, 5, 0)), Line((0, 10, 5), (20, 10, 5))))
tryit("one-segment polyline", lambda: ruled(Polyline((0, 0, 0), (20, 0, 0)), Line((0, 10, 5), (20, 10, 5))).area)
tryit("Wire of one edge", lambda: ruled(Wire([Line((0, 0, 0), (20, 0, 0))]), Line((0, 10, 5), (20, 10, 5))).area)
# degenerate
tryit("identical curves", lambda: ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 0, 0), (20, 0, 0))).area)
tryit("zero-length line (a point)", lambda: ruled(Line((0, 0, 0), (20, 0, 0)), Line((10, 10, 5), (10, 10, 5))).area)
tryit("crossing lines", lambda: ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, -5, 0), (20, 5, 0))).area)
tryit("face edge of a part", lambda: ruled(Box(10, 10, 10).edges().top()[0], Line((-5, -5, 20), (5, -5, 20))).area)
tryit("a Face", lambda: ruled(Box(10, 10, 10).faces().top()[0], Line((-5, -5, 20), (5, -5, 20))))
tryit("a tuple of points", lambda: ruled(((0, 0, 0), (1, 0, 0)), Line((-5, -5, 20), (5, -5, 20))))
