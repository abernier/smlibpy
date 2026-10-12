part = Box(60, 40, 10)
p = part - CounterSinkHole(2, 4, 10).on(part.faces().top())
for e in p.edges():
    if abs(e.center().x) < 5 and abs(e.center().y) < 5 or e.geom_type != "line":
        print("[09] edge", e.geom_type, "z", round(e.bbox().min.z, 4), "..", round(e.bbox().max.z, 4), "len", round(e.length, 4))
t = CounterSinkHole(2, 4, 10)
print("[09] tool edges:", [(e.geom_type, round(e.center().z, 4)) for e in t.edges()])
print("[09] tool faces:", [(f.geom_type, round(f.bbox().min.z, 3), round(f.bbox().max.z, 3)) for f in t.faces()])
