# twist a range: a baluster, square bar twisted in the middle only
bar = Box(16, 16, 200)
b = bar.twist(360, start=-50, end=50)
print("[02] valid", b.is_valid(), "faces", len(bar.faces()), "->", len(b.faces()))
print("[02] volume", round(b.mass_properties(accuracy=1e-10).volume, 6), "expect", 16 * 16 * 200)
low = [f for f in b.faces() if f.center().z < -51]
high = [f for f in b.faces() if f.center().z > 51]
print("[02] below range", len(low), sorted(f.geom_type for f in low))
print("[02] above range", len(high), sorted(f.geom_type for f in high))
top = sorted(tuple(round(c, 6) for c in v.point) for v in b.vertices() if v.z > 99)
print("[02] top corners (360 turn: unchanged)", top)
q = Box(16, 16, 200).twist(90, start=0)  # only the upper half
print("[02] upper half: faces", len(q.faces()), "top corners", sorted(tuple(round(c, 6) for c in v.point) for v in q.vertices() if v.z > 99))
s = Box(16, 16, 200).twist(45, start=-100, end=300)  # range beyond the part: it turns 45 * 200 / 400
e = [e for e in s.edges() if e.center().z > 99][0]
d = e.end - e.start
print("[02] range beyond: top edge turned by", round(math.degrees(math.atan2(d.y, d.x)) % 90, 6), "degrees")
snapshot("baluster", b, view="front")
