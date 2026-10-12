# claims in Pos.md
s = Box(2, 2, 2)
print("[18] Pos(0,0,10)*Rot(x=90):", (Pos(0, 0, 10) * Rot(x=90) * s).center(), "Rot(x=90)*Pos(0,0,10):", (Rot(x=90) * Pos(0, 0, 10) * s).center())
blk = Box(40, 30, 10)
for name in ["top", "front", "right"]:
    f = getattr(blk.faces(), name)()
    c = (Pos(10, 5) * Circle(3)).on(f)
    pl = f[0].plane
    print(f"[18] (Pos(10,5)*Circle).on({name}) center", c.center(), "expected", pl.from_local((10, 5)))
g = GridLocations(20, 10, 2, 1) * Pos(8) * Box(1, 1, 1)
print("[18] Grid*Pos(8)*Box centers:", [x.center() for x in g])
f = blk.faces().top()[0]
print("[18] Pos(normal*5):", Pos(f.normal_at() * 5))
for sh in [Vertex(1, 2, 3), Line((0, 0), (1, 0)), Polyline((0, 0), (1, 0), (1, 1)), blk.faces().top()[0]]:
    m = Pos(10, 0, 0) * sh
    print("[18] Pos*", type(sh).__name__, "->", type(m).__name__, m.center())
