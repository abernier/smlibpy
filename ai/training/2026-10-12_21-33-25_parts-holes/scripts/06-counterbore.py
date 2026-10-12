t = CounterBoreHole(2, 4, 3, 10)
print("[06] tool:", t, "bbox:", t.bbox(), "valid:", t.is_valid(), "solids:", len(t.solids()))
print("[06] tool faces:", sorted((f.geom_type, round(f.radius, 3) if f.geom_type == "cylinder" else None,
                                  round(f.bbox().min.z, 3), round(f.bbox().max.z, 3)) for f in t.faces()))
print("[06] tool volume:", round(t.volume, 4), "expected:", round(math.pi * (16 * 3 + 4 * 7), 4))
part = Box(60, 40, 10)
top = part.faces().top()
p = part - CounterBoreHole(2, 4, 3, 10).on(top)
print("[06] cut: valid", p.is_valid(), "faces", len(part.faces()), "->", len(p.faces()), "removed", round(part.volume - p.volume, 4))
for f in p.faces().cylinders():
    print("[06]   cyl r", round(f.radius, 4), "z", round(f.bbox().min.z, 4), "..", round(f.bbox().max.z, 4))
shoulder = [f for f in p.faces().planar() if abs(f.center().z - 2) < 1e-6]
print("[06] shoulder face z=2:", len(shoulder), "area", [round(f.area, 4) for f in shoulder], "expected:", round(math.pi * (16 - 4), 4))
print("[06] param order check: CounterBoreHole(radius, counter_bore_radius, counter_bore_depth, depth)")
snapshot("cb", p, view="sheet")
# section view to see the profile
sec = p.section(Plane.XZ)
print("[06] section:", sec)
snapshot("cbsec", p & Box(60, 20, 10, align=(Align.CENTER, Align.MIN, Align.CENTER)), view="front")
