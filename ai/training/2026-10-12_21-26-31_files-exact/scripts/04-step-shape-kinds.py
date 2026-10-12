import os
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"

def rt(label, shape):
    p = os.path.join(OUT, f"04-{label}.step")
    try:
        export_step(shape, p)
    except Exception as e:
        print(f"[04] {label}: export {type(e).__name__}: {e}")
        return None
    txt = open(p).read()
    kinds = [k for k in ("MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "SHELL_BASED_SURFACE_MODEL", "B_SPLINE_SURFACE") if k in txt]
    try:
        back = import_step(p)
    except Exception as e:
        print(f"[04] {label}: import {type(e).__name__}: {e} entities={kinds}")
        return None
    desc = type(back).__name__
    if isinstance(back, ShapeList):
        desc += "[" + ",".join(type(s).__name__ for s in back) + "]"
    print(f"[04] {label}: back {desc} entities={kinds}")
    return back

sk = Rectangle(20, 10)
b = rt("sketch", sk)
print("[04]   sketch area", sk.area, "back area", round(b.area, 6), "bbox", b.bbox())
b = rt("face", Box(10, 10, 10).faces().top())
srf = surface([[(x * 10, y * 10, math.sin(x) + math.cos(y)) for x in range(4)] for y in range(4)])
b = rt("surface", srf)
print("[04]   surface area", round(srf.area, 6), "back area", round(b.area, 6))
b = rt("open-box", Box(20, 20, 20).faces()[:5])    # ShapeList of Faces: each face its own sheet?
hollow = Box(20, 20, 20).shell(2)                   # closed hollow: inner void
print("[04] hollow volume", round(hollow.volume, 4), "solids", len(hollow.solids()))
b = rt("hollow", hollow)
if b is not None:
    print("[04]   hollow back volume", round(b.volume, 4), "valid", b.is_valid(), "faces", len(b.faces()))
two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)  # one Part, two solids
print("[04] two-solid part solids:", len(two.solids()))
b = rt("two-solids", two)
if b is not None and isinstance(b, ShapeList):
    print("[04]   back:", [round(s.volume, 3) for s in b], [s.name for s in b])
rt("edge", Line((0, 0, 0), (10, 0, 0)))
rt("wire", Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0)))
rt("empty", [])
rt("mesh", Box(5, 5, 5).mesh())
rt("nested", [[Box(5, 5, 5)], [Sphere(2).translate(10, 0, 0), [Cylinder(1, 4).translate(20, 0, 0)]]])
rt("mixed", [Box(5, 5, 5), Rectangle(5, 5).translate(10, 0, 0)])
sp = Part.__new__  # noqa
spline_part = loft([Circle(10), Rectangle(15, 15).translate(0, 0, 20)])
b = rt("loft", spline_part)
print("[04]   loft volume", round(spline_part.volume, 4), "back", round(b.volume, 4), "faces", len(spline_part.faces()), len(b.faces()))
