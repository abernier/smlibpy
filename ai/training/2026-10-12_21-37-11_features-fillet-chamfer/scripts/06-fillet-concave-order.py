def rep(tag, p, base=None):
    d = f" dV={p.volume - base.volume:.4f}" if base is not None else ""
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f}{d} faces={len(p.faces())}")

base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
boss = Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
part = base + boss
rep("base+boss", part)
conc = part.edges().concave()
print("concave edges", len(conc), [x.geom_type for x in conc])
f = part.fillet(conc, 2)
rep("concave fillet r2 (adds)", f, part)
r = 2; R = 10
A = r*r - math.pi*r*r/4
cent = r - (4*r)/(3*(4 - math.pi)) * 0  # placeholder
# centroid of the region between square corner and quarter circle, measured from the corner along one leg:
xc = (r**3/2 - (math.pi*r*r/4)*(r - 4*r/(3*math.pi))) / A
print("expected dV (Pappus)", A*2*math.pi*(R + (r - xc)) if False else A*2*math.pi*(R + xc))
# order: fillet then hole vs hole then fillet of the hole edge
plate = Box(60, 40, 8)
p1 = plate.fillet(plate.edges().parallel_to(Z), 6) - Cylinder(5, 20)
rep("fillet corners then hole", p1)
p2 = (plate - Cylinder(5, 20))
p2 = p2.fillet(p2.edges().parallel_to(Z), 6)
rep("hole then fillet parallel_to(Z) (picks seam?)", p2)
hole_top = p2.edges().circles().filter(lambda x: abs(x.radius - 5) < 1e-6 and x.center().z > 0)
p3 = p2.fillet(hole_top, 1)
rep("hole rim fillet r1 (concave? convex)", p3, p2)
print("hole rim convexity", [x.convexity for x in hole_top])
# fillet across a fused seam edge: box + box side by side flush (tangent faces merged?)
two = Box(20, 20, 10) + Box(20, 20, 10).translate(20, 0, 0)
rep("two boxes fused", two)
print("edges", len(two.edges()), "faces", len(two.faces()))
t = two.fillet(two.faces().top(), 2)
rep("fillet top of fused", t, two)
# fillet corners where radii differ: larger first vs smaller first
blk = Box(30, 30, 30)
a1 = blk.fillet(blk.edges().parallel_to(Z), 8)
try:
    a1 = a1.fillet(a1.faces().top().edges(), 3)
    rep("vertical r8 then top r3", a1, blk)
except Exception as e:
    print(f"[vertical r8 then top r3] {type(e).__name__}: {e}")
a2 = blk.fillet(blk.faces().top().edges(), 3)
try:
    a2 = a2.fillet(a2.edges().parallel_to(Z), 8)
    rep("top r3 then vertical r8", a2, blk)
except Exception as e:
    print(f"[top r3 then vertical r8] {type(e).__name__}: {e}")
a3 = blk.fillet(blk.faces().top().edges(), 8)
try:
    a3 = a3.fillet(a3.edges().parallel_to(Z), 3)
    rep("top r8 then vertical r3", a3, blk)
except Exception as e:
    print(f"[top r8 then vertical r3] {type(e).__name__}: {e}")
snapshot("order", a1, a2.translate(40, 0, 0), f.translate(0, 60, 0), p3.translate(80, 0, 0), view="iso")
