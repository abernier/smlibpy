def rep(tag, fn):
    try:
        p = fn()
        b = p.bbox()
        print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={getattr(p, 'volume', float('nan')):.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())}")
        return p
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

rep("with hole (ring)", lambda: loft([Circle(10) - Circle(5), Circle(10).translate(0, 0, 20)]))
print("full cylinder", math.pi*100*20)
rep("two regions", lambda: loft([Rectangle(5, 5).translate(-10, 0) + Rectangle(5, 5).translate(10, 0), Circle(5).translate(0, 0, 20)]))
rep("descending z", lambda: loft([Circle(10).translate(0, 0, 20), Circle(5)]))
rep("same plane", lambda: loft([Circle(10), Circle(5)]))
rep("crossing order z 0,20,10", lambda: loft([Circle(10), Circle(8).translate(0, 0, 20), Circle(6).translate(0, 0, 10)]))
rep("one section", lambda: loft([Circle(10)]))
rep("mixed open/closed", lambda: loft([Circle(10), Line((0, 0, 10), (5, 0, 10))]))
# tilted sections
rep("bent 90 (XY -> side plane)", lambda: loft([Rectangle(10, 10), Rectangle(10, 10).on(Plane(origin=(30, 0, 30), z_dir=(1, 0, 0)))]))
rep("tilted top", lambda: loft([Circle(10), Circle(10).on(Plane(origin=(0, 0, 20), z_dir=(0, 0.5, 1)))]))
# a face and a wire as sections
box = Box(20, 20, 10)
rep("face -> wire", lambda: loft([box.faces().top()[0], Polyline((-5, -5, 30), (5, -5, 30), (5, 5, 30), (-5, 5, 30), close=True)]))
# point-like end: tiny circle
rep("to small circle", lambda: loft([Circle(10), Circle(0.01).translate(0, 0, 20)]))
# open curves -> Shell
rep("open curves", lambda: loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5))]))
rep("open curves 3 arcs", lambda: loft([CenterArc((0, 0), 10, 0, 180), CenterArc((0, 0), 12, 0, 180).translate(0, 0, 10), CenterArc((0, 0), 9, 0, 180).translate(0, 0, 20)]))
rep("open curves reversed", lambda: loft([Line((0, 0, 0), (10, 0, 0)), Line((10, 10, 5), (0, 10, 5))]))
rep("open polylines", lambda: loft([Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0)), Polyline((0, 0, 10), (8, 0, 10), (8, 8, 10))]))
