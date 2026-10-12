t = CounterSinkHole(2, 4, 10)
print("[08] tool:", t, "bbox:", t.bbox(), "valid:", t.is_valid())
cone = t.faces().filter_by(lambda f: f.geom_type == "cone").one()
print("[08] cone face z:", round(cone.bbox().min.z, 4), "..", round(cone.bbox().max.z, 4))
h = (4 - 2) / math.tan(math.radians(41))
print("[08] expected sink depth (4-2)/tan(41):", round(h, 4))
# measure the included angle from the cone face normal
pt = cone.center()
n = cone.normal_at(pt)
print("[08] cone normal at center:", n, "-> half angle from axis:", round(90 - math.degrees(math.acos(abs(n.z))), 4))
part = Box(60, 40, 10)
p = part - CounterSinkHole(2, 4, 10).on(part.faces().top())
print("[08] cut: valid", p.is_valid(), "faces", len(part.faces()), "->", len(p.faces()), "removed", round(part.volume - p.volume, 4))
circ = sorted((round(e.radius, 4), round(e.arc_center.z, 4)) for e in p.edges().circles())
print("[08] circles (r, z):", circ)
expected = math.pi * 4 * 10 + math.pi * h * (4 + 8 + 16) / 3 - math.pi * 4 * h
print("[08] expected removed:", round(expected, 4))
for ang in [60, 90, 100, 120, 179, 180, 0, -82]:
    try:
        tt = CounterSinkHole(2, 4, 10, angle=ang)
        c = [f for f in tt.faces() if f.geom_type == "cone"]
        print("[08] angle", ang, "-> sink z", round(tt.bbox().max.z - min(f.bbox().min.z for f in c), 4) if c else None,
              "bbox z", round(tt.bbox().min.z, 4), "valid", tt.is_valid())
    except Exception as e:
        print("[08] angle", ang, "->", type(e).__name__, e)
snapshot("cs", p & Box(60, 20, 10, align=(Align.CENTER, Align.MIN, Align.CENTER)), view="front")
