def rep(tag, fn):
    try:
        p = fn()
        b = p.bbox()
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} z={b.min.z:.2f}..{b.max.z:.2f} faces={len(p.faces())}")
        return p
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

a = rep("rect(4)->hex(6)", lambda: loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True))
b = rep("tri(3)->circle(1)", lambda: loft([RegularPolygon(10, 3), Circle(8).translate(0, 0, 20)]))
c = rep("rect->rot45 rect (twist)", lambda: loft([Rectangle(20, 20), Rectangle(20, 20).rotate(Z, 45).translate(0, 0, 20)]))
d = rep("rect->rect rot90", lambda: loft([Rectangle(20, 10), Rectangle(20, 10).rotate(Z, 90).translate(0, 0, 20)]))
e = rep("slot->circle", lambda: loft([Slot(30, 10), Circle(6).translate(0, 0, 20)]))
f = rep("rrect->circle", lambda: loft([RoundedRectangle(30, 20, 4), Circle(8).translate(0, 0, 20)]))
g = rep("pentagon->square, 3 sections", lambda: loft([RegularPolygon(10, 5), Rectangle(14, 14).translate(0, 0, 15), Circle(6).translate(0, 0, 30)]))
h = rep("star polygon -> circle", lambda: loft([Polygon(*[(10*math.cos(math.radians(36*i))*(1 if i%2==0 else 0.5), 10*math.sin(math.radians(36*i))*(1 if i%2==0 else 0.5)) for i in range(10)]), Circle(5).translate(0, 0, 20)]))
snapshot("counts", *(p.translate(40*i, 0, 0) for i, p in enumerate([a, b, c, d, e, f, g, h]) if p is not None), view="iso")
