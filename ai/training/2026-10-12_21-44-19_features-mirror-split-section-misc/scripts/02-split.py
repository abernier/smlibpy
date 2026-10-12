def rep(tag, fn):
    try:
        p = fn()
        if isinstance(p, tuple):
            for i, q in enumerate(p):
                b = q.bbox()
                print(f"[{tag}][{i}] valid={q.is_valid()} vol={q.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(q.faces())} solids={len(q.solids())}")
            return p
        b = p.bbox()
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids())}")
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex}")

part = Box(40, 30, 20) - Cylinder(8, 30)
print("part vol", round(part.volume, 4), "half", round(part.volume/2, 4))
up = rep("split XY default above", lambda: part.split(Plane.XY))
rep("split XY below", lambda: part.split(Plane.XY, keep="below"))
lr = rep("split YZ both", lambda: part.split(Plane.YZ, keep="both"))
rep("function split", lambda: split(part, Plane.XY))
rep("offset plane z=5 above", lambda: part.split(Plane.XY.offset(5)))
print("expected", (1200 - math.pi*64)*5)
rep("Plane.bottom (flipped) above", lambda: part.split(Plane.bottom))
print("Plane.bottom z_dir", Plane.bottom.z_dir.to_tuple(), "origin", Plane.bottom.origin.to_tuple())
rep("tilted plane", lambda: part.split(Plane(origin=(0, 0, 0), z_dir=(0, 1, 1))))
rep("by a face of the part (top face plane -> nothing above?)", lambda: part.split(part.faces().top()))
rep("by a face, below", lambda: part.split(part.faces().top(), keep="below"))
other = Box(100, 100, 100).translate(0, 0, 50 + 3)
rep("by a face of another body (its bottom at z=3)", lambda: part.split(other.faces().bottom()))
rep("plane above the part, keep above", lambda: part.split(Plane.XY.offset(50)))
rep("plane above the part, keep below", lambda: part.split(Plane.XY.offset(50), keep="below"))
rep("keep='left'", lambda: part.split(Plane.XY, keep="left"))
rep("curved face", lambda: part.split(part.faces().cylinders()))
# by another body: not supported -> use & and -
tool = Sphere(15)
rep("split(Sphere)", lambda: part.split(tool))
inside = part & tool
outside = part - tool
print("[& and -] vols", round(inside.volume, 3), round(outside.volume, 3), "sum", round(inside.volume + outside.volume, 3))
snapshot("split", lr[0].translate(5, 0, 0), lr[1].translate(-5, 0, 0), view="iso")
