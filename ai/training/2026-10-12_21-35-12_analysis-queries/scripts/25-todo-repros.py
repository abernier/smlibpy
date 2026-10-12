# The minimal reproductions of ai/todo/analysis.md, run once more.
print("[25] #1", Cylinder(5, 20).distance_to(Cylinder(3, 20).translate(20, 0, 0)), Cylinder(5, 20).distance_to(Box(10, 10, 30).translate(20, 0, 0)))
a = Sphere(7).translate(1e5, 0, 0); b = Sphere(2).translate(1e5 + 10, 20, -5)
print("[25] #2", a.distance_to(b), math.sqrt(525) - 9)
bad = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))
spring = sweep(Circle(4), Helix(5, 20, 10))
print("[25] #3", bad.is_valid(), bad.volume, spring.is_valid(), spring.volume)
mp = Box(10, 10, 10).mass_properties(density=0.0)
print("[25] #4", mp.mass, mp.density)
sp = Spline((0, 0), (10, 5), (20, -3), (30, 8), (35, 0))
print("[25] #8", sp.bbox().min.y, min(sp.point_at(i / 20000).y for i in range(20001)))
for f in (lambda: Box(20, 20, 20).intersection_curves(Box(5, 5, 5).translate(50, 0, 0)),
          lambda: Sphere(10).project(CenterArc((0, 0, 30), 15, 0, 360), (0, 0, -1)),
          lambda: Sphere(10).mass_properties(accuracy=1e-12)):
    try:
        f(); print("[25] no error")
    except Exception as e:
        print("[25]", type(e).__name__, e)
