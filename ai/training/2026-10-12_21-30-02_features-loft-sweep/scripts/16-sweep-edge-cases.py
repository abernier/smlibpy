def rep(tag, fn):
    try:
        p = fn()
        b = p.bbox()
        extra = f"valid={p.is_valid()} vol={p.volume:.4f} solids={len(p.solids())}" if isinstance(p, Part) else f"area={p.area:.4f}"
        print(f"[{tag}] {type(p).__name__} {extra} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())}")
        return p
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

# profile radius vs path radius
for r in (5, 9, 10, 12):
    rep(f"circle r{r} on arc R10", lambda: sweep(Circle(r), CenterArc((0, 0), 10, 0, 90)))
# closed circular path variants
rep("full circle path", lambda: sweep(Circle(2), CenterArc((0, 0), 20, 0, 360)))
rep("two half arcs path", lambda: sweep(Circle(2), Wire([CenterArc((0, 0), 20, 0, 180), CenterArc((0, 0), 20, 180, 180)])))
rep("revolve instead", lambda: Circle(2).translate(20, 0).on(Plane.front).revolve(Z))
print("expected ring", math.pi*4*2*math.pi*20)
# profile with a hole along a polyline (mitered)
rep("tube mitered", lambda: sweep(Circle(3) - Circle(2), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40))))
print("expected", math.pi*5*80)
# open profile -> surface
rep("open arc profile on line", lambda: sweep(CenterArc((0, 0), 5, 0, 180), Line((0, 0, 0), (0, 0, 30))))
print("expected area", math.pi*5*30)
rep("open profile on polyline", lambda: sweep(Line((0, 0, 0), (5, 0, 0)), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40))))
# path as a ShapeList of edges
box = Box(20, 20, 20)
rep("path = top face edges (closed square)", lambda: sweep(Circle(1), box.faces().top()[0].outer_wire()))
# bad inputs
rep("path is a Part", lambda: sweep(Circle(1), box))
rep("profile is a Part", lambda: sweep(box, Line((0, 0, 0), (0, 0, 10))))
rep("disconnected wire", lambda: sweep(Circle(1), Wire([Line((0, 0, 0), (0, 0, 10)), Line((5, 0, 20), (5, 0, 30))])))
# profile far from path start: moved?
rep("profile far away", lambda: sweep(Circle(2).translate(100, 100), Spline((0, 0, 0), (10, 10, 20), (0, 20, 40))))
