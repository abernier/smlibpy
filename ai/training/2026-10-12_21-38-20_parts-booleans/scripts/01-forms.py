a = Box(20, 20, 20)
t1 = Cylinder(3, 30).translate(-5, 0, 0)
t2 = Cylinder(3, 30).translate(5, 0, 0)
ref = round((a - t1 - t2).volume, 4)
print("[01] chained a - t1 - t2:", ref)
print("[01] a - [t1, t2]:", round((a - [t1, t2]).volume, 4))
print("[01] a.cut(t1, t2):", round(a.cut(t1, t2).volume, 4))
print("[01] a.cut([t1, t2]):", round(a.cut([t1, t2]).volume, 4))
print("[01] a.cut([[t1], (t2,)]):", round(a.cut([[t1], (t2,)]).volume, 4))
print("[01] a - (t for t in ...):", round((a - (t for t in [t1, t2])).volume, 4))
print("[01] a - ShapeList:", round((a - ShapeList([t1, t2])).volume, 4))
print("[01] a - []:", round((a - []).volume, 4), "same object?", (a - []) is a)
print("[01] a.fuse():", round(a.fuse().volume, 4))
b = a
b -= t1
print("[01] -= leaves a unchanged:", round(a.volume, 4), round(b.volume, 4))
print("[01] a + [t1, t2]:", round((a + [t1, t2]).volume, 4))
print("[01] a & [t1, t2]:", round((a & [t1, t2]).volume, 4), "(sequential: a & t1 & t2)")
try:
    r = [t1, t2] + a
    print("[01] list + part:", type(r))
except Exception as e:
    print("[01] list + part:", type(e).__name__, e)
try:
    r = [t1, t2] - a
except Exception as e:
    print("[01] list - part:", type(e).__name__, e)
for bad in [5, "x", Circle(3), Rectangle(4, 4).extrude(1).faces().top().one()]:
    try:
        r = a - bad
        print("[01] a -", type(bad).__name__, "-> accepted:", r, "valid", r.is_valid())
    except Exception as e:
        print("[01] a -", type(bad).__name__, "->", type(e).__name__, e)
