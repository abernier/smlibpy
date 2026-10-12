# RoundedRectangle: radius limits, edges, area, align
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 6) for v in b.min)}..{tuple(round(v, 6) for v in b.max)}"
def attempt(label, fn):
    try:
        s = fn()
        print(f"[02] {label}: {s!r} bbox={bb(s)} edges={[e.geom_type for e in s.edges()]}")
        return s
    except Exception as e:
        print(f"[02] {label}: {type(e).__name__}: {e}")
w, h = 40, 20
for r in [4, 0, -2, 9.999, 10, 10.0000001, 10.001, 12]:
    s = attempt(f"radius {r}", lambda: RoundedRectangle(w, h, r))
    if s is not None and r > 0:
        print(f"[02]   area {s.area:.6f} formula {w*h - (4 - math.pi) * r * r:.6f}")
attempt("square, r = half", lambda: RoundedRectangle(20, 20, 10))
attempt("align MIN", lambda: RoundedRectangle(40, 20, 4, align=Align.MIN))
attempt("zero width", lambda: RoundedRectangle(0, 20, 4))
attempt("negative width, r 0", lambda: RoundedRectangle(-10, 20, 0))
attempt("negative width, r 2", lambda: RoundedRectangle(-10, 20, 2))
s = RoundedRectangle(40, 20, 4)
print("[02] arc radii:", [round(e.radius, 6) for e in s.edges() if e.geom_type == "circle"])
print("[02] extrude faces:", len(s.extrude(5).faces()), "valid:", s.extrude(5).is_valid())
stad = RoundedRectangle(40, 20, 10)
print("[02] stadium vs Slot(40,20) area:", round(stad.area, 6), round(Slot(40, 20).area, 6))
snapshot("rr", RoundedRectangle(40, 20, 4), RoundedRectangle(40, 20, 10).translate(0, -25), view="top")
