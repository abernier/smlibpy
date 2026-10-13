# Part.parting_line
import time
def show_lines(name, part, d=Z):
    t = time.time()
    lines = part.parting_line(d)
    dt = time.time() - t
    print(f"[10] {name}: {len(lines)} lines [{dt:.3f} s]")
    for w in lines:
        b = w.bbox()
        print(f"[10]    {w}, edges {[e.geom_type for e in w.edges()]}, z {b.min.z:.9f}..{b.max.z:.9f}")
    return lines
w = show_lines("sphere", Sphere(10))[0]
print("[10]    radius", [round(e.radius, 12) for e in w.edges()], "length error %.1e" % (w.length - 20 * math.pi))
show_lines("cylinder along Z", Cylinder(5, 20))
lying = show_lines("cylinder along X", Cylinder(5, 20).rotate(Y, 90))[0]
print("[10]    straight:", [(round(e.center().y, 9), round(e.center().z, 9), round(e.length, 9)) for e in lying.edges() if e._is_straight()])
show_lines("torus", Torus(20, 5))
tt = Torus(20, 5).rotate(X, 30)
lines = show_lines("torus tilted 30 deg", tt)
f = tt.faces()[0]
print("[10]    torus tilted: bbox diagonal %.3f, fit tolerance %.1e" % (tt.bbox().diagonal, 1e-6 * tt.bbox().diagonal))
for w in lines:
    pts = [w.point_at(i / 400) for i in range(401)]
    print("[10]    off the surface %.1e, |n.z| %.1e" % (max(f.distance_to(p) for p in pts), max(abs(f.normal_at(p).z) for p in pts)))
show_lines("box", Box(40, 30, 20))
cup = Box(40, 30, 20) - Box(30, 20, 15, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
show_lines("open box (cup)", cup)
show_lines("cup upside down", cup.rotate(X, 180))
show_lines("tapered core", RoundedRectangle(60, 40, 5).extrude(20, taper=3))
show_lines("sphere along (1, 1, 1)", Sphere(10), (1, 1, 1))
show_lines("box along X", Box(40, 30, 20), X)
for call in ("Box(1, 1, 1).parting_line((0, 0, 0))",):
    try:
        eval(call)
    except Exception as e:
        print("[10]", call, "->", type(e).__name__ + ":", e)
