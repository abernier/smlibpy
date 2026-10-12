# bend: whole part, radius (centered), start, negative angle, neutral layer and volume
bar = Box(100, 10, 10)
b = bar.bend(90)
r = 100 / (math.pi / 2)
print("[07] whole: valid", b.is_valid(), "faces", len(b.faces()), "bbox", b.bbox())
print("[07] whole: volume default", round(b.volume, 4), "precise", round(b.mass_properties(accuracy=1e-10).volume, 6), "radius", round(r, 6))
print("[07] face areas", sorted(round(f.area, 4) for f in b.faces()))
u = Box(160, 10, 6).bend(180, radius=25)
print("[07] U radius 25: faces", len(u.faces()), "bbox", u.bbox(), "volume", round(u.mass_properties(accuracy=1e-10).volume, 4))
s = Box(100, 10, 10).bend(-90, radius=20, start=10)
print("[07] down from x=10: bbox", s.bbox())
e = Box(100, 10, 10).bend(90, radius=20, end=0)
print("[07] ending at x=0: bbox", e.bbox())
n = bar.bend(90, plane=Plane((0, 0, -5), (1, 0, 0), (0, -1, 0)))  # neutral layer at the bottom
print("[07] neutral at the bottom: volume", round(n.mass_properties(accuracy=1e-10).volume, 4),
      "Pappus", round(10000 * (1 - 5 / r), 4))
side = bar.bend(90, plane=Plane.XY)
print("[07] Plane.XY (toward +Y): bbox", side.bbox())
snapshot("bend", b, u.translate(0, 40, 0), s.translate(0, 80, 0), view="front")
