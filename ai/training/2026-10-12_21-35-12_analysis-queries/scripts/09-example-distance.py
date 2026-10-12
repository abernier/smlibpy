a = Box(10, 10, 10)
b = Sphere(3).translate(20, 0, 0)
print(a.distance_to(b))                  # 12.0, gap between the surfaces
print(a.distance_to((0, 0, 30)))         # 25.0
print(a.closest_point((0, 0, 30)))       # Vector(0, 0, 5)
print(a.distance_to((1, 2, 3)))          # 2.0: inside the box, distance to its surface

# overlap check: distance_to cannot tell nested from apart, an intersection can
inner = Sphere(2)
print(a.distance_to(inner))              # 3.0 although the sphere is inside
overlap = a & inner
print(len(overlap.faces()) > 0, round(overlap.volume, 4))   # True 33.5103

# cross-check for parallel cylinders and flat faces (distance_to is wrong there)
def gap(p, q, steps=50):
    x = q.center()
    for _ in range(steps):
        y = p.closest_point(x)
        x = q.closest_point(y)
    return (y - x).length
c1, c2 = Cylinder(5, 20), Cylinder(3, 20).translate(20, 0, 0)
print(round(c1.distance_to(c2), 4), round(gap(c1, c2), 4))   # 10.3331 12.0 (true: 12)
