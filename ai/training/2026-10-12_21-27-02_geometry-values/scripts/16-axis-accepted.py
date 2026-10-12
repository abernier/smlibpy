# where Axis and tuples are accepted
p = Box(10, 20, 30)
print("[16] facing(Z):", len(p.faces().facing(Z)), "facing((0,0,1)):", len(p.faces().facing((0, 0, 1))), "facing(-Z):", len(p.faces().facing(-Z)))
print("[16] group_by(Z):", [len(g) for g in p.edges().group_by(Z)])
try:
    print("[16] group_by((0,0,1)):", [len(g) for g in p.edges().group_by((0, 0, 1))])
except Exception as e:
    print("[16] group_by tuple ->", type(e).__name__, e)
try:
    print("[16] sort_by((0,0,1)):", p.faces().sort_by((0, 0, 1))[-1].center())
except Exception as e:
    print("[16] sort_by tuple ->", type(e).__name__, e)
s = Rectangle(4, 10).translate(12, 0)
try:
    print("[16] revolve((0,1,0)):", round(s.revolve((0, 1, 0)).volume, 2))
except Exception as e:
    print("[16] revolve tuple ->", type(e).__name__, e)
try:
    print("[16] revolve(Axis offset):", round(s.revolve(Axis((10, 0, 0), (0, 1, 0))).volume, 2), "expected", round(2 * math.pi * 2 * 40, 2))
except Exception as e:
    print("[16] revolve offset ->", type(e).__name__, e)
try:
    print("[16] Location.about tuple:", Location.about((0, 0, 1), 90))
except Exception as e:
    print("[16] Location.about tuple ->", type(e).__name__, e)
