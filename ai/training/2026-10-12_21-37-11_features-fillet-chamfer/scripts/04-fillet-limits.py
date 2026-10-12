def rep(tag, fn, base):
    try:
        p = fn()
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} dV={p.volume - base.volume:.4f} faces={len(p.faces())}")
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex}")

cube = Box(10, 10, 10)
for r in (4, 4.9, 4.99, 5, 5.01, 6):
    rep(f"cube all edges r{r}", lambda: cube.fillet(cube.edges(), r), cube)
for r in (4.9, 5, 6, 9.9, 10, 11):
    rep(f"cube one vertical edge r{r}", lambda: cube.fillet(cube.edges().parallel_to(Z).first, r), cube)
for r in (4.9, 5, 6):
    rep(f"cube two parallel edges of one face r{r}", lambda: cube.fillet(cube.faces().top().edges().parallel_to(X), r), cube)
plate = Box(40, 30, 4)
for r in (1.9, 2, 2.1, 3, 4, 5):
    rep(f"plate 4 thick, top edges r{r}", lambda: plate.fillet(plate.faces().top(), r), plate)
for r in (3.9, 4, 4.1, 6):
    rep(f"plate 4 thick, one top edge r{r}", lambda: plate.fillet(plate.faces().top().edges().first, r), plate)
# zero/negative radius
rep("r=0", lambda: cube.fillet(cube.edges().first, 0), cube)
rep("r=-1", lambda: cube.fillet(cube.edges().first, -1), cube)
# smooth/seam edges only
cyl = Cylinder(5, 10)
print("cyl edges", [(x.geom_type, x.is_seam) for x in cyl.edges(seams=True)] if True else "")
rep("cylinder all edges r1", lambda: cyl.fillet(cyl.edges(), 1), cyl)
rr = Rectangle(20, 20).fillet(4).extrude(10) if hasattr(Sketch, "fillet") else None
smooth = rr.edges().parallel_to(Z)
print("rounded block vertical edges", len(smooth), [x.geom_type for x in smooth])
rep("smooth edges only", lambda: rr.fillet(smooth.filter(lambda x: x.convexity == "smooth") if smooth.filter(lambda x: x.convexity == "smooth") else smooth, 1), rr)
rep("rounded block top face r2 (tangent chain)", lambda: rr.fillet(rr.faces().top(), 2), rr)
# edge not of this part
other = Box(5, 5, 5).translate(100, 0, 0)
rep("foreign edge", lambda: cube.fillet(other.edges().first, 1), cube)
rep("empty selection", lambda: cube.fillet(cube.edges().filter(lambda x: False), 1), cube)
rep("function form with foreign list", lambda: fillet([], 1), cube)
