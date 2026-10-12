# project: curves onto bodies along a direction. Which faces get hit, both sides, misses, wires.
import time
pi = math.pi
def show(name, body, curve, d=(0, 0, -1)):
    t = time.perf_counter()
    try:
        cs = body.project(curve, d)
    except Exception as e:
        print(f"[18] {name}: {type(e).__name__}: {e}")
        return None
    dt = 1000*(time.perf_counter()-t)
    off = max([body.distance_to(c.point_at(i/8)) for c in cs for i in range(9)] or [0])
    zs = sorted(set(round(c.point_at(0.5).z, 4) for c in cs))
    print(f"[18] {name}: n={len(cs)} types={[c.geom_type for c in cs]} length={sum(c.length for c in cs):.9g} mid z={zs} off={off:.1e} ({dt:.0f} ms)")
    return cs
box = Box(20, 20, 20)
circ = CenterArc((0, 0, 30), 5, 0, 360)
show("doc example: circle above box, down", box, circ)
show("same, direction up (curve above, pointing away)", box, circ, (0, 0, 1))
show("same, curve below the box, direction down", box, CenterArc((0, 0, -30), 5, 0, 360))
show("circle at z=0 inside the box", box, CenterArc((0, 0, 0), 5, 0, 360))
show("circle r5 above sphere r10", Sphere(10), circ)
show("circle r15 above sphere r10 (misses)", Sphere(10), CenterArc((0, 0, 30), 15, 0, 360))
show("circle crossing the sphere rim r12", Sphere(10), CenterArc((0, 0, 30), 12, 0, 360) if False else CenterArc((5, 0, 30), 8, 0, 360))
cs = show("horizontal line onto cylinder side along -X", Cylinder(10, 40), Line((30, -5, -10), (30, -5, 10)), (-1, 0, 0))
show("tilted line onto cylinder side along -X", Cylinder(10, 40), Line((30, -8, -10), (30, 8, 10)), (-1, 0, 0))
show("polyline square onto box top", box, Polyline((-5, -5, 30), (5, -5, 30), (5, 5, 30), (-5, 5, 30), close=True))
show("spline onto a filleted box", Box(40, 40, 10).fillet(Box(40, 40, 10).edges().parallel_to(Y), 5), Spline((-25, 0, 30), (0, 3, 30), (25, 0, 30)))
show("oblique direction (1,0,-1)", box, circ, (1, 0, -1))
show("zero direction", box, circ, (0, 0, 0))
try:
    print("[18] project a Sketch:", box.project(Circle(5).on(Plane.XY.offset(30))))
except Exception as e:
    print(f"[18] project a Sketch: {type(e).__name__}: {e}")
a = Sphere(10).silhouette((0, 0, 1))[0]
b = Sphere(10).translate(100, 50, 20).silhouette((0, 0, 1))[0]
print("[18] silhouette of a moved sphere moves along:", b.point_at(0.3) - a.point_at(0.3))
