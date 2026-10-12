def bb(p):
    b = p.bbox()
    return tuple(round(v, 6) for v in b.min.to_tuple()), tuple(round(v, 6) for v in b.max.to_tuple())

c = Cylinder(5, 20)
print("[06] repr:", c, "bbox:", bb(c))
print("[06] volume:", round(c.volume, 6), "pi r2 h:", round(math.pi * 25 * 20, 6))
print("[06] area:", round(c.area, 6), "formula:", round(2 * math.pi * 5 * 20 + 2 * math.pi * 25, 6))
print("[06] info:", c.info())
print("[06] edges:", len(c.edges()), "with seams:", len(c.edges(seams=True)))
print("[06] faces:", [(f.geom_type, tuple(round(v, 3) for v in f.center().to_tuple())) for f in c.faces()])
cf = c.faces().cylinders().one()
print("[06] cyl face radius:", cf.radius, "axis:", cf.axis)
print("[06] circles:", [(round(e.radius, 3), e.arc_center) for e in c.edges().circles()])
for a in [Align.MIN, Align.MAX, (Align.CENTER, Align.CENTER, Align.MIN)]:
    print("[06] align", a, bb(Cylinder(5, 20, align=a)))
for args in [(0, 10), (5, 0), (-1, 10)]:
    try:
        Cylinder(*args)
    except Exception as e:
        print("[06]", args, type(e).__name__, e)
try:
    Cylinder(5, 10, angle=180)
except Exception as e:
    print("[06] angle kw:", type(e).__name__, e)
flat = Cylinder(50, 0.5)
print("[06] flat disk valid:", flat.is_valid(), round(flat.volume, 4))
needle = Cylinder(0.01, 100)
print("[06] needle valid:", needle.is_valid(), round(needle.volume, 6))
# lying cylinder along X
lying = Cylinder(5, 20).rotate(Y, 90)
print("[06] rotated about Y:", bb(lying))
snapshot("cyl", c, view="sheet")
