# Lengths of intersection curves against numerical integration of the exact curves.
pi = math.pi
def num_len(f, n=200000):
    pts = [f(2*pi*i/n) for i in range(n+1)]
    return sum(math.dist(pts[i], pts[i+1]) for i in range(n))
# r3 cylinder along Y crossing r5 cylinder along Z: two closed curves y = +-sqrt(25 - 9 cos^2 t)
L1 = num_len(lambda t: (3*math.cos(t), math.sqrt(25 - 9*math.cos(t)**2), 3*math.sin(t)))
cs = Cylinder(5, 30).intersection_curves(Cylinder(3, 30).rotate(X, 90))
print(f"[11] r5/r3 crossing: total={sum(c.length for c in cs):.10g} exp={2*L1:.10g} rel={(sum(c.length for c in cs)-2*L1)/(2*L1):+.1e}")
# Steinmetz: two ellipses with semi-axes 5*sqrt2 and 5
Le = num_len(lambda t: (5*math.sqrt(2)*math.cos(t), 5*math.sin(t), 0))
cs = Cylinder(5, 30).intersection_curves(Cylinder(5, 30).rotate(X, 90))
print(f"[11] Steinmetz: total={sum(c.length for c in cs):.10g} exp={2*Le:.10g} rel={(sum(c.length for c in cs)-2*Le)/(2*Le):+.1e}")
for c in cs:
    print(f"[11]    piece {c.geom_type} start={c.start} end={c.end} length={c.length:.8g}")
# doc example pieces
box = Box(20, 20, 20)
pipe = Cylinder(4, 40).rotate(X, 30)
cs = box.intersection_curves(pipe)
for c in cs:
    print(f"[11] doc example piece {c.geom_type}: start={c.start} end={c.end} length={c.length:.6g}")
