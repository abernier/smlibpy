# Survey of body-body distance against formulas for many pairs of primitives.
pi = math.pi
cases = []
def add(name, a, b, exp):
    cases.append((name, a, b, exp))
add("box-box diagonal", Box(10, 10, 10), Box(10, 10, 10).translate(20, 20, 20), math.sqrt(3*100))
add("sphere-sphere", Sphere(5), Sphere(3).translate(20, 0, 0), 12)
add("sphere-sphere oblique", Sphere(5), Sphere(3).translate(10, 20, -5), math.sqrt(525) - 8)
add("cyl-sphere side", Cylinder(5, 20), Sphere(3).translate(20, 0, 0), 12)
add("cyl-sphere above", Cylinder(5, 20), Sphere(3).translate(0, 0, 20), 7)
add("cyl-box side", Cylinder(5, 20), Box(10, 10, 10).translate(20, 0, 0), 10)
add("cyl-cyl stacked coaxial", Cylinder(5, 20), Cylinder(3, 20).translate(0, 0, 30), 10)
add("cyl-cyl parallel", Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0), 12)
add("cyl-cyl parallel, shifted half up", Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 10), 12)
add("cyl-cyl perpendicular", Cylinder(5, 20), Cylinder(3, 40).rotate(X, 90).translate(20, 0, 0), 12)
add("cyl-cyl skew", Cylinder(5, 100).rotate(Y, 90), Cylinder(4, 100).rotate(X, 90).translate(0, 0, 30), 21)
add("cyl rotated 90 - cyl", Cylinder(5, 20).rotate(X, 90), Cylinder(3, 20).rotate(X, 90).translate(20, 0, 0), 12)
add("cone-sphere", Cone(10, 0, 30), Sphere(2).translate(0, 0, 25), 8)
add("torus-sphere center", Torus(20, 5), Sphere(3), 12)
add("torus-box", Torus(20, 5), Box(10, 10, 10).translate(40, 0, 0), 10)
add("torus-torus", Torus(20, 5), Torus(20, 5).translate(0, 0, 20), 10)
add("box-cylinder hole inside clearance", Box(30, 30, 10) - Cylinder(10, 20), Cylinder(4, 30), 6)
for name, a, b, exp in cases:
    d = a.distance_to(b)
    flag = "" if abs(d - exp) < 1e-6 else "   <-- WRONG"
    print(f"[06] {name}: d={d:.10g} exp={exp:.10g} err={d-exp:+.2e}{flag}")
