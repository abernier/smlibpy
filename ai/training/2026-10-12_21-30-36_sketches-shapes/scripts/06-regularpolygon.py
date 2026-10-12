# RegularPolygon: circumscribed vs inscribed, sides, rotation, align, first corner
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 4) for v in b.min)}..{tuple(round(v, 4) for v in b.max)}"
def attempt(label, fn):
    try:
        s = fn()
        vs = sorted((tuple(round(c, 4) for c in v) for v in s.vertices()), key=lambda p: math.atan2(p[1], p[0]))
        print(f"[06] {label}: {s!r} bbox={bb(s)} n={len(s.edges())} corners={vs}")
        return s
    except Exception as e:
        print(f"[06] {label}: {type(e).__name__}: {e}")
h = attempt("hex r10", lambda: RegularPolygon(10, 6))
print("[06] hex corner distances:", sorted({round(v.point.length, 6) for v in h.vertices()}))
hi = attempt("hex r10 inscribed", lambda: RegularPolygon(10, 6, inscribed=True))
print("[06] hex inscribed across flats (y extent):", round(hi.bbox().size.y, 6), "corner dist:", sorted({round(v.point.length, 6) for v in hi.vertices()}))
attempt("hex rotation 30", lambda: RegularPolygon(10, 6, rotation=30))
attempt("hex inscribed rotation 30", lambda: RegularPolygon(10, 6, inscribed=True, rotation=30))
t = attempt("triangle", lambda: RegularPolygon(10, 3))
print("[06] triangle center:", t.center(), "plane origin:", t.plane.origin)
attempt("triangle align CENTER (scalar)", lambda: RegularPolygon(10, 3, align=Align.CENTER))
attempt("triangle align (CENTER, CENTER)", lambda: RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER)))
attempt("triangle align 'center'", lambda: RegularPolygon(10, 3, align="center"))
attempt("triangle align MIN", lambda: RegularPolygon(10, 3, align=Align.MIN))
attempt("square", lambda: RegularPolygon(10, 4))
attempt("square rotation 45", lambda: RegularPolygon(10, 4, rotation=45))
attempt("square inscribed rot 45 = 20x20", lambda: RegularPolygon(10, 4, inscribed=True, rotation=45))
p100 = attempt("100 sides", lambda: RegularPolygon(10, 100))
attempt("2 sides", lambda: RegularPolygon(10, 2))
attempt("radius 0", lambda: RegularPolygon(0, 6))
attempt("radius -10", lambda: RegularPolygon(-10, 6))
attempt("sides 6.0", lambda: RegularPolygon(10, 6.0))
attempt("sides 5.5", lambda: RegularPolygon(10, 5.5))
nut = RegularPolygon(6.5, 6, inscribed=True) - Circle(3.4)
print("[06] nut sketch:", repr(nut), "across flats:", round(nut.bbox().size.y, 6))
snapshot("polys", RegularPolygon(10, 6), RegularPolygon(10, 6, inscribed=True).translate(25, 0), RegularPolygon(10, 3).translate(50, 0), RegularPolygon(10, 6, rotation=30).translate(0, -25), view="top")
