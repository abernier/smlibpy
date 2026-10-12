def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,4) for v in b.min.to_tuple())} max={tuple(round(v,4) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids())}")

section = Polygon((10, 0), (30, 0), (30, 5), (15, 5), (15, 20), (10, 20))
placed = section.on(Plane.front)
print("front plane x,y,z:", Plane.front.x_dir.to_tuple(), Plane.front.y_dir.to_tuple(), Plane.front.z_dir.to_tuple())
pb = placed.bbox(); print("placed profile bbox", pb.min.to_tuple(), pb.max.to_tuple())
spool = placed.revolve()
rep("spool default axis", spool)
# Pappus: area * 2*pi*xc
area = section.area
xc = section.center().x
print("pappus", area * 2 * math.pi * xc, "area", area, "xc", xc)
q = placed.revolve(Z, 90)
rep("quarter Z 90", q)
qn = placed.revolve(Z, -90)
rep("quarter Z -90", qn)
half = placed.revolve(Z, 180)
rep("half", half)
over = None
try:
    over = placed.revolve(Z, 400)
    rep("400", over)
except Exception as e:
    print(f"[400] {type(e).__name__}: {e}")
# function form
f = revolve(placed, Z, 360)
rep("func", f)
# XY sketch, default axis = sketch Y = world Y
r = Rectangle(10, 20).translate(15, 0).revolve()
rep("XY default (about Y)", r)
print("expected tube about Y", math.pi*(20**2-10**2)*20)
snapshot("sheet", spool, q, view="sheet")
