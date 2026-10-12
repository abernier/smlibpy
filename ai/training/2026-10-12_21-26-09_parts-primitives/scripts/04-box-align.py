def bb(p):
    b = p.bbox()
    return tuple(round(v, 6) for v in b.min.to_tuple()), tuple(round(v, 6) for v in b.max.to_tuple())

print("[04] default:", bb(Box(40, 30, 10)))
for a in [Align.MIN, Align.CENTER, Align.MAX, "min", "MAX", None]:
    print("[04] align", a, bb(Box(40, 30, 10, align=a)))
print("[04] (C,C,MIN):", bb(Box(40, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))))
print("[04] (MIN,MAX,CENTER):", bb(Box(40, 30, 10, align=(Align.MIN, Align.MAX, Align.CENTER))))
print("[04] (None,None,MIN):", bb(Box(40, 30, 10, align=(None, None, Align.MIN))))
print("[04] two values (MIN,MIN):", bb(Box(40, 30, 10, align=(Align.MIN, Align.MIN))))
print("[04] strings tuple:", bb(Box(40, 30, 10, align=("min", "center", "max"))))
try:
    Box(40, 30, 10, align="bottom")
except Exception as e:
    print("[04] bad string:", type(e).__name__, e)
try:
    Box(40, 30, 10, align=(Align.MIN,) * 4)
    print("[04] 4 values accepted", bb(Box(40, 30, 10, align=(Align.MIN,) * 4)))
except Exception as e:
    print("[04] 4 values:", type(e).__name__, e)
b = Box(40, 30, 10)
print("[04] faces:", len(b.faces()), "top center:", b.faces().top().one().center(), "top normal:", b.faces().top().one().normal_at())
print("[04] front face (min Y) center:", b.faces().front().one().center())
for f in b.faces():
    print("[04] face", f.center(), f.normal_at(), round(f.area, 3))
