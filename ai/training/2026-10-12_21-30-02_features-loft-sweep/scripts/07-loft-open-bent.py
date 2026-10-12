def rep(tag, fn):
    try:
        p = fn()
        b = p.bbox()
        extra = f"vol={p.volume:.3f} valid={p.is_valid()}" if isinstance(p, Part) else f"area={p.area:.3f}"
        print(f"[{tag}] {type(p).__name__} {extra} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())}")
        return p
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

s1 = rep("open lines", lambda: loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5))]))
print("expected area", 10*math.hypot(10, 5))
s2 = rep("open lines reversed", lambda: loft([Line((0, 0, 0), (10, 0, 0)), Line((10, 10, 5), (0, 10, 5))]))
s3 = rep("3 arcs", lambda: loft([CenterArc((0, 0), 10, 0, 180), CenterArc((0, 0), 12, 0, 180).translate(0, 0, 10), CenterArc((0, 0), 9, 0, 180).translate(0, 0, 20)]))
s4 = rep("open polylines", lambda: loft([Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0)), Polyline((0, 0, 10), (8, 0, 10), (8, 8, 10))]))
s5 = rep("open polylines ruled", lambda: loft([Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0)), Polyline((0, 0, 10), (8, 0, 10), (8, 8, 10))], ruled=True))
s6 = rep("open lines 3 ruled", lambda: loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5)), Line((0, 20, 0), (10, 20, 0))], ruled=True))
print("ruled 3 lines expected area", 2*10*math.hypot(10, 5))
bent = rep("bent 90", lambda: loft([Rectangle(10, 10), Rectangle(10, 10).on(Plane(origin=(30, 0, 30), z_dir=(1, 0, 0)))]))
bent3 = rep("bent 3 sections", lambda: loft([Rectangle(10, 10), Rectangle(10, 10).on(Plane(origin=(9, 0, 21), z_dir=(1, 0, 1))), Rectangle(10, 10).on(Plane(origin=(30, 0, 30), z_dir=(1, 0, 0)))]))
snapshot("bent", bent, bent3.translate(0, 30, 0), view="front")
snapshot("open", s2, s3.translate(30, 0, 0), s4.translate(60, 0, 0))
