# After a chamfer, are straight edges still "line"? Selection consequences
box = Box(20, 20, 10)
c1 = box.chamfer(box.edges().parallel_to(Z), 2)
print("[08] chamfer vertical: edge types", sorted({e.geom_type for e in c1.edges()}), "count", len(c1.edges()))
print("[08]   parallel_to(Z):", len(c1.edges().parallel_to(Z)), " lines:", len(c1.edges().lines()))
straight = c1.edges().filter(lambda e: e.start.distance_to(e.end) > 0 and abs(e.length - e.start.distance_to(e.end)) < 1e-6)
print("[08]   straight by length test:", len(straight))
for e in c1.edges()[:4]:
    print("[08]   ", e, "len", round(e.length, 4), "chord", round(e.start.distance_to(e.end), 4))
c2 = box.chamfer(box.edges().top(), 1)
print("[08] chamfer top: edge types", sorted({e.geom_type for e in c2.edges()}), "parZ", len(c2.edges().parallel_to(Z)), "of", len(c2.edges()))
print("[08]   face types", sorted({f.geom_type for f in c2.faces()}), "planar", len(c2.faces().planar()), "of", len(c2.faces()))
f1 = box.fillet(box.edges().parallel_to(Z), 2)
print("[08] fillet vertical: edge types", sorted({e.geom_type for e in f1.edges()}), "parZ", len(f1.edges().parallel_to(Z)))
# Can a chamfered part be filleted on its now-bspline edges selected by geometry?
sel = c2.edges().filter(lambda e: abs(e.center().z + 5) < 1e-6)
print("[08] bottom edges of chamfered box (by z):", len(sel), " via bottom():", len(c2.edges().bottom()))
snapshot("chamfer", c1, view="iso")
