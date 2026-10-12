# Failing pairs: shaft off-center in a hole, parallel cylinders, far spheres. Alternating
# closest_point as a cross-check.
def alternating(a, b, steps=50):
    q = b.center()
    for _ in range(steps):
        p = a.closest_point(q)
        q = b.closest_point(p)
    return (p - q).length
cases = [
    ("parallel cylinders", Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0), 12.0),
    ("parallel cylinders oblique", Cylinder(5, 20), Cylinder(3, 20).translate(20, 10, 0), math.hypot(20, 10) - 8),
    ("shaft r4 off-center by 3 in hole r10", Box(30, 30, 10) - Cylinder(10, 20), Cylinder(4, 30).translate(3, 0, 0), 3.0),
    ("shaft r4 coaxial in hole r10", Box(30, 30, 10) - Cylinder(10, 20), Cylinder(4, 30), 6.0),
    ("far spheres", Sphere(7).translate(1e4, -2e4, 3e4), Sphere(2).translate(1e4 + 10, -2e4 + 20, 3e4 - 5), math.sqrt(525) - 9),
    ("cylinder and box face-parallel", Cylinder(5, 20), Box(10, 10, 30).translate(20, 0, 0), 10.0),
]
for name, a, b, exp in cases:
    d = a.distance_to(b)
    alt = alternating(a, b)
    print(f"[07] {name}: distance_to={d:.10g} alternating={alt:.10g} exp={exp:.10g}")
