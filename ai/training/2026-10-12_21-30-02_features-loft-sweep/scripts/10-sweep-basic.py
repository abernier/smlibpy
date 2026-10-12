def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids())}")

# straight path: exact cylinder
st = sweep(Circle(3), Line((0, 0, 0), (0, 0, 40)))
rep("straight Z", st); print("expected", math.pi*9*40)
sx = sweep(Circle(3), Line((0, 0, 0), (40, 0, 0)))
rep("straight X", sx)
# path not starting at origin: profile drawn at origin
far = sweep(Circle(3), Line((50, 20, 10), (50, 20, 50)))
rep("path starts at (50,20,10)", far)
# profile drawn elsewhere (not at origin)
off = sweep(Circle(3).translate(30, 30), Line((0, 0, 0), (0, 0, 40)))
rep("profile at (30,30), path at origin", off)
# spline tube
path = Spline((0, 0, 0), (0, 20, 30), (40, 20, 50))
tube = sweep(Circle(3) - Circle(2), path)
rep("spline tube", tube); print("expected area*len", math.pi*(9-4)*path.length, "len", round(path.length, 3))
solid = sweep(Circle(3), path)
rep("spline rod", solid); print("expected", math.pi*9*path.length)
# arc path: exact torus section
arc = CenterArc((0, 0), 20, 0, 90)
ta = sweep(Circle(3), arc)
rep("quarter arc", ta); print("expected", math.pi*9*2*math.pi*20/4)
# Sketch.sweep method
m = Circle(3).sweep(arc)
rep("Sketch.sweep", m)
snapshot("basic", tube, ta, far, view="iso")
