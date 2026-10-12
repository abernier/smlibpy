def bb(p):
    b = p.bbox()
    return tuple(round(v, 6) for v in b.min.to_tuple()), tuple(round(v, 6) for v in b.max.to_tuple())

def frustum(r1, r2, h):
    return math.pi * h * (r1 * r1 + r1 * r2 + r2 * r2) / 3

c = Cone(10, 4, 15)
print("[08] frustum:", c, "bbox:", bb(c), "valid:", c.is_valid())
print("[08] volume:", round(c.volume, 4), "formula:", round(frustum(10, 4, 15), 4))
print("[08] info:", c.info())
print("[08] faces:", [(f.geom_type, tuple(round(v, 3) for v in f.center().to_tuple())) for f in c.faces()])
print("[08] circles z,r:", sorted((round(e.arc_center.z, 3), round(e.radius, 3)) for e in c.edges().circles()))
print("[08] center of mass z:", round(c.center().z, 4))
p = Cone(10, 0, 15)
print("[08] point cone:", p, "bbox:", bb(p), "valid:", p.is_valid(), "info:", p.info())
print("[08] point cone volume:", round(p.volume, 4), "formula:", round(frustum(10, 0, 15), 4))
print("[08] point cone vertices:", [v.point for v in p.vertices()])
inv = Cone(0, 10, 15)
print("[08] inverted point cone:", inv, "bbox:", bb(inv), "valid:", inv.is_valid())
print("[08] inverted vertices:", [v.point for v in inv.vertices()])
same = Cone(5, 5, 10)
print("[08] equal radii:", same, "faces:", [f.geom_type for f in same.faces()], "vol:", round(same.volume, 4))
for a in [Align.MIN, (Align.CENTER, Align.CENTER, Align.MIN), (Align.CENTER, Align.CENTER, Align.MAX)]:
    print("[08] align", a, bb(Cone(10, 4, 15, align=a)))
for args in [(0, 0, 10), (10, 4, 0), (-1, 4, 10), (10, -4, 10)]:
    try:
        Cone(*args)
    except Exception as e:
        print("[08]", args, type(e).__name__, e)
# apex tip near-zero top radius
tiny = Cone(10, 1e-6, 15)
print("[08] top radius 1e-6:", tiny, "valid:", tiny.is_valid())
snapshot("cones", c, p.translate(25, 0, 0), inv.translate(50, 0, 0), view="front")
