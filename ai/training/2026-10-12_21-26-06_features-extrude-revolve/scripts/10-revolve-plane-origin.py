def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,4) for v in b.min.to_tuple())} max={tuple(round(v,4) for v in b.max.to_tuple())} faces={len(p.faces())}")

for tag, s in [
    ("Rectangle centered", Rectangle(10, 20)),
    ("Rectangle align MIN", Rectangle(10, 20, align=(Align.MIN, Align.MIN))),
    ("Rectangle translate(15,0)", Rectangle(10, 20).translate(15, 0)),
    ("Pos(15,0)*Rectangle", Pos(15, 0) * Rectangle(10, 20)),
    ("Polygon", Polygon((10, 0), (30, 0), (30, 5), (10, 5))),
    ("Circle-Circle translated", (Circle(5) - Circle(2)).translate(20, 0)),
    ("translated on front", Rectangle(10, 20).translate(15, 0).on(Plane.front)),
]:
    print(f"[{tag}] plane origin {s.plane.origin.to_tuple()} y_dir {s.plane.y_dir.to_tuple()}")

# explicit axis fixes all of them
rep("translated rect, axis Z", Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve(Z))
print("expected", math.pi*(20**2-10**2)*20)
rep("align MIN, axis Z", Rectangle(10, 20, align=(Align.MIN, Align.MIN)).on(Plane.front).revolve(Z))
print("expected", math.pi*100*20)
rep("ring, axis Z", (Circle(5) - Circle(2)).translate(20, 0).on(Plane.front).revolve(Z))
print("expected", math.pi*(25-4)*2*math.pi*20)
rep("two regions, axis Z", (Rectangle(4, 4).translate(10, 0) + Rectangle(4, 4).translate(20, 0)).on(Plane.front).revolve(Z))
print("expected", 16*2*math.pi*(10+20))
# XY sketch about Y
rep("XY translated, axis Y", Rectangle(10, 20).translate(15, 0).revolve(Y))
# negative angle: which way and how much
prof = Rectangle(10, 10).translate(15, 0).on(Plane.front)
for a in (90, -90, 270, -270, 360, -360, 0):
    try:
        p = prof.revolve(Z, a)
        rep(f"angle {a}", p)
    except Exception as e:
        print(f"[angle {a}] {type(e).__name__}: {e}")
print("full ring", math.pi*(400-100)*10)
