# Rectangle: sizes, align values, errors, rotation
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 6) for v in b.min)}..{tuple(round(v, 6) for v in b.max)}"
r = Rectangle(40, 20)
print("[01] default:", repr(r), bb(r), "edges:", len(r.edges()), [e.geom_type for e in r.edges()])
print("[01] vertices:", sorted(tuple(v) for v in r.vertices()))
for a in [Align.MIN, Align.MAX, Align.CENTER, (Align.MIN, Align.CENTER), (Align.CENTER, Align.MAX),
          (Align.MIN, None), "min", ("max", "min"), (Align.MIN, Align.MIN, Align.MAX)]:
    try:
        s = Rectangle(40, 20, align=a)
        print(f"[01] align={a}: {bb(s)} plane origin={s.plane.origin}")
    except Exception as e:
        print(f"[01] align={a}: {type(e).__name__}: {e}")
for args in [(0, 10), (-5, 10), (10, -1)]:
    try:
        Rectangle(*args)
    except Exception as e:
        print(f"[01] Rectangle{args}: {type(e).__name__}: {e}")
try:
    Rectangle(40, 20, rotation=30)
except Exception as e:
    print("[01] rotation kw:", type(e).__name__, e)
rot = Rectangle(40, 20).rotate(Z, 30)
print("[01] rotate(Z,30):", bb(rot), "area:", round(rot.area, 6))
rot2 = Rot(z=30) * Rectangle(40, 20)
print("[01] Rot(z=30)*:", bb(rot2))
tiny = Rectangle(1e-4, 1e-4)
print("[01] tiny:", repr(tiny))
big = Rectangle(1e5, 1)
print("[01] long:", repr(big))
snapshot("align", Rectangle(40, 20), Rectangle(40, 20, align=Align.MIN).translate(0, 0, 0), Circle(1), view="top")
