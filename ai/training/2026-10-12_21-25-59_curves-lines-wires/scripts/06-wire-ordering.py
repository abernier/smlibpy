# Wire([...]): ordering and flipping of edges, edges that do not chain
a = Line((0, 0), (10, 0))
b = Line((10, 0), (10, 10))
c = Line((10, 10), (0, 10))
d = Line((0, 10), (0, 0))
def show(tag, w):
    print(f"[06] {tag}: {w} start {w.start.to_tuple()} end {w.end.to_tuple()}")
    print("      ", [(tuple(round(v, 3) for v in e.start.to_tuple()[:2]), tuple(round(v, 3) for v in e.end.to_tuple()[:2])) for e in w.edges()])
show("in order", Wire([a, b, c, d]))
show("shuffled", Wire([c, a, d, b]))
show("flipped b,d", Wire([a, b.reversed(), c, d.reversed()]))
show("open shuffled", Wire([c, a, b]))
show("open first edge reversed", Wire([a.reversed(), b, c]))
show("sort=False", Wire([c, a, d, b], sort=False))
# edges that do not chain: a gap
e = Line((20, 0), (30, 0))
g = Wire([a, e])
show("gap", g)
print("[06] gap is_closed:", g.is_closed, "length", g.length)
# branching (T shape)
t = Wire([Line((0, 0), (10, 0)), Line((10, 0), (20, 0)), Line((10, 0), (10, 10))])
show("T branch", t)
# single edge, wire of wires, nested lists, ShapeList
show("single edge", Wire(a))
show("wire of wires", Wire([Wire([a, b]), Wire([c, d])]))
show("nested", Wire([[a, b], (c, d)]))
show("plus", a + b + c + d)
try:
    Wire([])
except Exception as ex:
    print("[06] empty ->", type(ex).__name__, ex)
try:
    Wire([a, (0, 0)])
except Exception as ex:
    print("[06] point inside ->", type(ex).__name__, ex)
# tolerance of chaining
near = Wire([Line((0, 0), (10, 0)), Line((10, 1e-7), (10, 10))])
show("gap 1e-7", near)
near2 = Wire([Line((0, 0), (10, 0)), Line((10, 1e-5), (10, 10))])
show("gap 1e-5", near2)
