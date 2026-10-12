# Realistic: an angle bracket built with selections only
base = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
wall = Box(8, 40, 40, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(-30, 0, 0)
part = base + wall
print("[16] L:", len(part.faces()), "faces, concave:", len(part.edges().concave()))
# round the inside corner
part = part.fillet(part.edges().concave(), 6)
# round the four vertical outside corners of the base plate (right end)
corners = part.edges().parallel_to(Z).filter(lambda e: e.center().x > 25)
print("[16] base corner edges:", len(corners), [tuple(round(c, 1) for c in e.center()) for e in corners])
part = part.fillet(corners, 5)
# two holes in the top face of the base: the planar faces facing up, lowest one
top = part.faces().facing(Z).bottom().one()
print("[16] base top face center z:", round(top.center().z, 3), " area:", round(top.area, 2))
part -= [Pos(15, y, 0) * Cylinder(3, 30) for y in (-10, 10)]
# one hole through the wall, on its outer face
outer = part.faces().facing(-X).one()
print("[16] wall outer face center:", tuple(round(c, 3) for c in outer.center()))
part -= Circle(4).on(outer).extrude(-20)
# chamfer the hole rims on the top of the base plate
at8 = part.edges().circles().filter(lambda e: abs(e.center().z - 8) < 1e-6)
print("[16] circles at z=8:", len(at8), [(round(e.radius, 3), e.is_closed) for e in at8])
rims = at8.filter(lambda e: e.is_closed)
print("[16] hole rims:", len(rims), [tuple(round(c, 3) for c in e.arc_center) for e in rims])
part = part.chamfer(rims, 0.8)
print("[16] valid:", part.is_valid(), " volume:", round(part.volume, 3), " faces:", len(part.faces()))
print("[16] bbox:", part.bbox())
print("[16] holes (cylinder faces r=3):", len(part.faces().cylinders().filter(lambda f: abs(f.radius - 3) < 1e-9)),
      " r=4:", len(part.faces().cylinders().filter(lambda f: abs(f.radius - 4) < 1e-9)))
print("[16] wall hole axis:", part.faces().cylinders().filter(lambda f: abs(f.radius - 4) < 1e-9).one().axis)
snapshot("bracket", part, view="iso")
snapshot("sheet", part, view="sheet")
# stale selections: an edge split by a later cut no longer matches
blk = Box(20, 20, 10)
old_top_edges = blk.edges().top()
blk2 = blk - Box(4, 30, 4).translate(0, 0, 5)   # slot across the top, splits two top edges
try:
    blk2.fillet(old_top_edges, 1)
except Exception as ex:
    print("[16] stale edges:", type(ex).__name__, ex)
old_top = blk.faces().top()
try:
    blk2.shell(1, openings=old_top)
except Exception as ex:
    print("[16] stale face:", type(ex).__name__, ex)
blk3 = blk - Cylinder(2, 4).translate(0, 0, -5)  # change only the bottom
r = blk3.fillet(old_top_edges, 1)
print("[16] unchanged old edges on new part:", round(r.volume, 3), r.is_valid())
