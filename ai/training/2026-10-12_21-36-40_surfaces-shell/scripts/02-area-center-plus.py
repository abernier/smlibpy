# area and center against a numerical integral; Shell + Shell; transforms keep the type.
f = lambda x, y: 0.02 * x * y
s = surface([[(x, y, f(x, y)) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
xs, ys = np.linspace(0, 40, 801), np.linspace(0, 30, 601)
X, Y = np.meshgrid(xs, ys)
dA = np.sqrt(1 + (0.02 * Y) ** 2 + (0.02 * X) ** 2)
A = np.trapezoid(np.trapezoid(dA, xs, axis=1), ys)
cx = np.trapezoid(np.trapezoid(dA * X, xs, axis=1), ys) / A
cz = np.trapezoid(np.trapezoid(dA * f(X, Y), xs, axis=1), ys) / A
print(f"[02] area {s.area:.4f} integral {A:.4f}; center x {s.center().x:.4f} vs {cx:.4f}, z {s.center().z:.4f} vs {cz:.4f}")
a = surface([[(x, y, 0) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
b = a.translate(20, 0, 0)
for label, fn in [("overlapping coplanar a + b", lambda: a + b), ("disjoint a + far", lambda: a + a.translate(100, 0, 0)),
                  ("crossing a + vertical", lambda: a + ruled(Line((20, -5, -5), (20, 35, -5)), Line((20, -5, 5), (20, 35, 5))))]:
    try:
        r = fn()
        print(f"[02] {label}: {type(r).__name__} faces {len(r.faces())} area {r.area:.2f}")
    except Exception as e:
        print(f"[02] {label}: {type(e).__name__}: {e}")
for label, r in [("translate", s.translate(1, 2, 3)), ("rotate", s.rotate(Z, 30)), ("mirror", s.mirror(Plane.YZ)),
                 ("scale 2", s.scale(2)), ("named", s.named("lid")), ("colored", s.colored("red")), ("Pos*", Pos(1, 0, 0) * s),
                 ("to_nurbs", s.to_nurbs()), ("heal", s.heal())]:
    print(f"[02] {label}: {type(r).__name__} area {r.area:.3f} name {r.name} color {r.color}")
m = s.mirror(Plane.YZ)
print("[02] normal before/after mirror:", s.faces()[0].normal_at((20, 15, 6)), m.faces()[0].normal_at((-20, 15, 6)))
