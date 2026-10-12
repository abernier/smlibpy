# Distance accuracy on curved geometry against formulas; faces, edges; far from the origin.
import time
pi = math.pi
def rel(a, b):
    return f"{a:.12g} exp {b:.12g} err {a-b:+.1e}"
# two skew cylinders: axes along X at z=0 and along Y at z=30 -> gap 30 - 5 - 4
c1 = Cylinder(5, 100).rotate(Y, 90)
c2 = Cylinder(4, 100).rotate(X, 90).translate(0, 0, 30)
print("[02] skew cylinders:", rel(c1.distance_to(c2), 21.0))
# sphere and torus: sphere at the torus center axis above, torus R20 r5, sphere r3 at (0,0,h)
t = Torus(20, 5)
s = Sphere(3).translate(0, 0, 15)
print("[02] torus-sphere:", rel(t.distance_to(s), math.hypot(20, 15) - 5 - 3))
# sphere to sphere tilted and far
off = np.array([1e4, -2e4, 3e4])
s1 = Sphere(7).translate(*off)
s2 = Sphere(2).translate(*(off + np.array([10, 20, -5])))
print("[02] far spheres:", rel(s1.distance_to(s2), math.sqrt(100+400+25) - 9))
# point to curved bodies
cyl = Cylinder(6, 20)
p = (10, 10, 3)
print("[02] cylinder to point:", rel(cyl.distance_to(p), math.hypot(10, 10) - 6), "closest", cyl.closest_point(p))
sph = Sphere(10)
print("[02] sphere to (3,4,12) outside:", rel(sph.distance_to((3, 4, 12)), 13 - 10), "closest", sph.closest_point((3, 4, 12)))
print("[02] sphere to center (ambiguous):", sph.distance_to((0, 0, 0)), sph.closest_point((0, 0, 0)))
# fillet: point near a rounded edge
b = Box(20, 20, 20)
fb = b.fillet(b.edges().parallel_to(Z), 5)
q = (20, 20, 0)   # beyond the rounded corner; fillet axis at (5,5)
print("[02] filleted box corner:", rel(fb.distance_to(q), math.hypot(15, 15) - 5))
# faces and edges
top = Box(10, 10, 10).faces().top().one()
print("[02] top face to (20,0,5):", rel(top.distance_to((20, 0, 5)), 15.0))
print("[02] cyl face to (0,0,0) (axis):", cyl.faces().filter_by(lambda f: f.geom_type == "cylinder").one().distance_to((0, 0, 0)))
e = CenterArc((0, 0, 0), 10, 0, 90)
print("[02] arc to (0,0,0):", e.distance_to((0, 0, 0)), " arc to (-10,0,0) (exp sqrt(200)):", rel(e.distance_to((-10, 0, 0)), math.sqrt(200)))
w = Polyline((0, 0), (10, 0), (10, 10))
print("[02] wire to (5,5,0):", w.distance_to((5, 5, 0)))
for label, f in (("edge to part", lambda: e.distance_to(Box(1, 1, 1))), ("face to part", lambda: top.distance_to(Box(1, 1, 1))),
                 ("edge closest_point", lambda: e.closest_point((0, 0, 0))), ("face closest_point", lambda: top.closest_point((0, 0, 0)))):
    try:
        print(f"[02] {label}: {f()}")
    except Exception as ex:
        print(f"[02] {label}: {type(ex).__name__}: {ex}")
