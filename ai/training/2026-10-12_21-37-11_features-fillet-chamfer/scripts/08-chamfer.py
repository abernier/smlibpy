import inspect
print("signature", inspect.signature(Part.chamfer), inspect.signature(chamfer))
def rep(tag, fn, base):
    try:
        p = fn()
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} dV={p.volume - base.volume:.4f} faces={len(p.faces())}")
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex}")

box = Box(40, 30, 20)
c = rep("4 vertical L2", lambda: box.chamfer(box.edges().parallel_to(Z), 2), box)
print("expected dV", -4*2*2/2*20)
c1 = rep("top face edges L2", lambda: box.chamfer(box.faces().top().edges(), 2), box)
c2 = rep("top face (Face list) L2", lambda: box.chamfer(box.faces().top(), 2), box)
ca = rep("all edges L2", lambda: box.chamfer(box.edges(), 2), box)
a, b, h, L = 40, 30, 20, 2
print("expected all-edge chamfer", a*b*h - 2*(a-2*L+b-2*L+h-2*L)*2*L*L - 8*L**3*(1/2 - 1/6) if False else "see journal")
rep("function form", lambda: chamfer(box.edges().parallel_to(Z), 2), box)
# measure the setback on a perpendicular edge
e = box.edges().parallel_to(Z).nearest((20, 15, 0))
p = box.chamfer(e, 3)
ff = [f for f in p.faces() if f.is_planar and abs(f.normal_at().z) < 1e-9 and abs(abs(f.normal_at().x) - abs(f.normal_at().y)) < 1e-6]
b = ff[0].bbox()
print("[perpendicular L3] chamfer face x", round(b.min.x, 4), "..", round(b.max.x, 4), "y", round(b.min.y, 4), "..", round(b.max.y, 4))
# non-perpendicular faces: a wedge, the sloped edge
w = Wedge(20, 10, 8)
print("wedge bbox", w.bbox().min.to_tuple(), w.bbox().max.to_tuple(), "faces", len(w.faces()))
for x in w.edges():
    fs = x.faces()
    if len(fs) == 2:
        ang = fs[0].normal_at(x.center()).angle_to(fs[1].normal_at(x.center()))
        print("  edge", tuple(round(v, 2) for v in x.center().to_tuple()), "angle between normals", round(ang, 2), x.convexity)
# a 30-degree-ish edge: profile triangle extruded
tri = Polygon((0, 0), (40, 0), (0, 20)).extrude(10)
acute = tri.edges().parallel_to(Z).nearest((40, 0, 0))
fs = acute.faces()
print("acute edge normals angle", round(fs[0].normal_at(acute.center()).angle_to(fs[1].normal_at(acute.center())), 3))
pc = tri.chamfer(acute, 2)
print("[acute L2] valid", pc.is_valid(), "dV", round(pc.volume - tri.volume, 4))
new = [f for f in pc.faces() if f.is_planar and abs(f.normal_at().z) < 1e-9 and f.area < 30]
for f in new:
    vs = [v for v in f.vertices() if abs(v.z) < 1e-9]
    print("   chamfer face bottom vertices", [tuple(round(c, 4) for c in v.point.to_tuple()) for v in vs],
          "distances from corner (40,0):", [round(math.hypot(v.x - 40, v.y), 4) for v in vs])
# limits
for L in (4.9, 5, 5.1, 10, 15, 16):
    rep(f"cube10 all edges L{L}", lambda: Box(10, 10, 10).chamfer(Box(10, 10, 10).edges(), L), Box(10, 10, 10))
for L in (9, 10, 11):
    rep(f"cube10 one edge L{L}", lambda: Box(10, 10, 10).chamfer(Box(10, 10, 10).edges().first, L), Box(10, 10, 10))
rep("L0", lambda: box.chamfer(box.edges().first, 0), box)
rep("L-1", lambda: box.chamfer(box.edges().first, -1), box)
rep("two distances (tuple)", lambda: box.chamfer(box.edges().first, (2, 3)), box)
# circular edge
cyl = Cylinder(10, 20)
top = cyl.edges().circles().sort_by(Z)[-1]
cc = rep("cylinder top edge L2", lambda: cyl.chamfer(top, 2), cyl)
print("expected dV", -(2*2/2)*2*math.pi*(10 - 2/3))
# hole edge (convex rim)
plate = Box(40, 40, 10) - Cylinder(5, 20)
rim = plate.edges().circles().filter(lambda x: x.center().z > 0)
cs = rep("hole rim countersink L1.5", lambda: plate.chamfer(rim, 1.5), plate)
print("expected dV", -(1.5*1.5/2)*2*math.pi*(5 + 0.5))
# concave edge chamfer
base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
rep("concave edge L2 (adds)", lambda: base.chamfer(base.edges().concave(), 2), base)
print("expected dV", (2*2/2)*2*math.pi*(10 + 2/3))
snapshot("chamfers", c1, cs.translate(50, 0, 0), pc.translate(0, 40, 0), view="iso")
