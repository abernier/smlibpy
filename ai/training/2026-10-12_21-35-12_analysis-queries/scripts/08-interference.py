# Interference: what does a & b give for disjoint, touching, overlapping and nested bodies?
a = Box(10, 10, 10)
for name, b in (("disjoint", Box(4, 4, 4).translate(20, 0, 0)), ("touching face", Box(10, 10, 10).translate(10, 0, 0)),
                ("overlapping", Box(10, 10, 10).translate(5, 0, 0)), ("nested", Sphere(2))):
    try:
        r = a & b
        v = r.volume if len(r.faces()) else 0.0
        print(f"[08] {name}: distance={a.distance_to(b):.6g} (a & b) faces={len(r.faces())} volume={v:.6g}")
    except Exception as e:
        print(f"[08] {name}: distance={a.distance_to(b):.6g} (a & b) {type(e).__name__}: {e}")
