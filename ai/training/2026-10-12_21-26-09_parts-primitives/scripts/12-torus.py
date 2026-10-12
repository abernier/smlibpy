def bb(p):
    b = p.bbox()
    return tuple(round(v, 6) for v in b.min.to_tuple()), tuple(round(v, 6) for v in b.max.to_tuple())

t = Torus(20, 4)
print("[12] torus:", t, "bbox:", bb(t), "valid:", t.is_valid())
print("[12] volume:", round(t.volume, 4), "formula:", round(2 * math.pi**2 * 20 * 16, 4))
print("[12] area:", round(t.area, 4), "formula:", round(4 * math.pi**2 * 20 * 4, 4))
print("[12] info:", t.info(), "edges:", len(t.edges()), "seams:", len(t.edges(seams=True)))
f = t.faces().one()
print("[12] face:", f.geom_type)
try:
    print("[12] face radius:", f.radius, "axis:", f.axis)
except Exception as e:
    print("[12] face radius/axis:", type(e).__name__, e)
print("[12] center:", t.center())
for a in [Align.MIN, (Align.CENTER, Align.CENTER, Align.MIN)]:
    print("[12] align", a, bb(Torus(20, 4, align=a)))
for args in [(4, 4), (4, 6), (20, 0), (20, -1), (0, 0)]:
    try:
        Torus(*args)
        print("[12]", args, "accepted")
    except Exception as e:
        print("[12]", args, type(e).__name__, e)
# a ring sitting on a plate
ring = Torus(20, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))
standing = Torus(20, 4).rotate(X, 90)
print("[12] rotated about X:", bb(standing))
snapshot("torus", t, view="sheet")
