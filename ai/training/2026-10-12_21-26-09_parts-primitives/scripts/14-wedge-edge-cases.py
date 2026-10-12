def bb(p):
    b = p.bbox()
    return tuple(round(v, 6) for v in b.min.to_tuple()), tuple(round(v, 6) for v in b.max.to_tuple())

for args in [(0, 10, 8), (20, 0, 8), (20, 10, 0), (-20, 10, 8), (20, -10, 8), (20, 10, -8), (20, 10, 8, -5)]:
    try:
        w = Wedge(*args)
        print("[14]", args, "accepted: bbox", bb(w), "vol", round(w.volume, 3), "valid", w.is_valid())
    except Exception as e:
        print("[14]", args, type(e).__name__, "|", e)
for a in [Align.MIN, (Align.CENTER, Align.CENTER, Align.MIN), Align.MAX]:
    print("[14] align", a, bb(Wedge(20, 10, 8, align=a)))
# Workaround for the intended width: pass half the width
w = Wedge(20, 5, 8)
print("[14] Wedge(20, 5, 8) bbox:", bb(w), "vol:", round(w.volume, 3))
# Default centering: is the base centered in Z? bbox z -4..4 means height centered
