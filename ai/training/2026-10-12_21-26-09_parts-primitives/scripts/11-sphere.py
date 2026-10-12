def bb(p):
    b = p.bbox()
    return tuple(round(v, 6) for v in b.min.to_tuple()), tuple(round(v, 6) for v in b.max.to_tuple())

s = Sphere(8)
print("[11] sphere:", s, "bbox:", bb(s), "valid:", s.is_valid())
print("[11] volume:", round(s.volume, 4), "formula:", round(4 / 3 * math.pi * 512, 4))
print("[11] area:", round(s.area, 4), "formula:", round(4 * math.pi * 64, 4))
print("[11] info:", s.info(), "edges:", len(s.edges()), "seams:", len(s.edges(seams=True)))
f = s.faces().one()
print("[11] face:", f.geom_type, "radius:", f.radius)
print("[11] vertices:", [v.point for v in s.vertices()])
for a in [Align.MIN, (Align.CENTER, Align.CENTER, Align.MIN), Align.MAX]:
    print("[11] align", a, bb(Sphere(8, align=a)))
for r in [0, -2]:
    try:
        Sphere(r)
    except Exception as e:
        print("[11] r=", r, type(e).__name__, e)
# partial spheres: no parameter; hemisphere via & with a box
hemi = Sphere(8) & Box(16, 16, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
print("[11] hemisphere:", hemi, "valid:", hemi.is_valid(), "bbox:", bb(hemi), "expected:", round(2 / 3 * math.pi * 512, 3))
dome = Box(30, 30, 5, align=(Align.CENTER, Align.CENTER, Align.MAX)) + hemi
print("[11] plate + dome:", dome, "solids:", len(dome.solids()), "valid:", dome.is_valid())
snapshot("sphere", s, hemi.translate(20, 0, 0), view="iso")
