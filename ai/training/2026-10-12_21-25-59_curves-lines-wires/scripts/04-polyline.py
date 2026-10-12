# Polyline: open, close=True, closed by repeating the first point, duplicates, list input
p = Polyline((0, 0), (20, 0), (20, 10), (0, 10))
print("[04] open:", p, "start", p.start, "end", p.end, "closed", p.is_closed)
print("[04] edges:", [(e.start.to_tuple(), e.end.to_tuple()) for e in p.edges()])
c = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True)
print("[04] close=True:", c, "n edges", len(c.edges()), "last edge", c.edges()[-1])
r = Polyline((0, 0), (20, 0), (20, 10), (0, 10), (0, 0))
print("[04] repeated first point:", r, len(r.edges()))
r2 = Polyline((0, 0), (20, 0), (20, 10), (0, 10), (0, 0), close=True)
print("[04] repeated + close:", r2, len(r2.edges()))
d = Polyline((0, 0), (10, 0), (10, 0), (10, 5))
print("[04] duplicate point dropped:", d, len(d.edges()))
lst = Polyline([(0, 0), (10, 0), (10, 5), (0, 5)])
print("[04] one list of 4 points:", lst)
try:
    lst3 = Polyline([(0, 0), (10, 0), (10, 5)])
    print("[04] one list of 3 points:", lst3)
except Exception as ex:
    print("[04] one list of 3 points ->", type(ex).__name__, ex)
print("[04] unpacked list of 3:", Polyline(*[(0, 0), (10, 0), (10, 5)]))
try:
    lst2 = Polyline([(0, 0), (10, 0)])
    print("[04] one list of 2 points:", lst2)
except Exception as ex:
    print("[04] one list of 2 points ->", type(ex).__name__, ex)
z3 = Polyline((0, 0, 0), (10, 0, 0), (10, 0, 10), (10, 10, 10))
print("[04] 3D:", z3, z3.length)
col = Polyline((0, 0), (5, 0), (10, 0), (10, 5), close=True)
print("[04] collinear points:", col, len(col.edges()))
s = make_face(col)
print("[04] collinear face area:", s.area, "edges", len(s.edges()))
for args in [((0, 0),), ((0, 0), (0, 0))]:
    try:
        print("[04]", args, "->", Polyline(*args))
    except Exception as ex:
        print("[04]", args, "->", type(ex).__name__, ex)
try:
    x = Polyline((0, 0), (0, 0), close=True)
    print("[04] two equal points close ->", x)
except Exception as ex:
    print("[04] two equal points close ->", type(ex).__name__, ex)
two = Polyline((0, 0), (10, 0), close=True)
print("[04] two points close=True:", two, len(two.edges()))
try:
    make_face(two)
except Exception as ex:
    print("[04] make_face of 2-point closed ->", type(ex).__name__, ex)
try:
    make_face(p)
except Exception as ex:
    print("[04] make_face of open polyline ->", type(ex).__name__, ex)
print("[04] face of closed:", make_face(c).area, c.to_sketch().area)
snapshot("polyline", c, z3, view="iso")
