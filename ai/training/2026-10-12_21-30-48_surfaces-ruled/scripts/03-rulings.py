# Evaluate the ruled surface directly: where does the ruling from a's point at fraction t land on b?
# (uses the kernel surface of the face for evidence only)
def rulings(s, n=5):
    srf = s.faces()[0]._f.surface()
    (u0, v0), (u1, v1) = srf.uv_domain()
    out = []
    for i in range(n):
        u = u0 + (u1 - u0) * i / (n - 1)
        p0 = Vector(*srf.evaluate(u, v0)); p1 = Vector(*srf.evaluate(u, v1))
        out.append((p0, p1))
    return srf.uv_domain(), out
a = Line((0, 0, 0), (20, 0, 0))
b = Spline((0, 10, 0), (2, 10, 3), (4, 10, 0), (20, 10, 0))
dom, rs = rulings(ruled(a, b))
print("[03] uv domain", dom)
for p0, p1 in rs:
    print(f"[03] line->spline ruling {p0} -> {p1}")
arc = CenterArc((10, 0, 0), 10, 180, -180)
line = Line((0, 0, 10), (20, 0, 10))
dom, rs = rulings(ruled(arc, line))
for p0, p1 in rs:
    print(f"[03] arc->line ruling {p0} -> {p1}")
