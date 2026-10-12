import inspect
print("mirror", inspect.signature(mirror), "Shape.mirror", inspect.signature(Shape.mirror))
def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={getattr(p, 'is_valid', lambda: None)()} vol={getattr(p, 'volume', float('nan')):.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids()) if isinstance(p, Part) else '-'}")

half = Box(20, 10, 10).translate(10, 0, 0)
half = half.fillet(half.edges().right(), 2)
rep("half", half)
m = half.mirror(Plane.YZ)
rep("half.mirror(YZ)", m)
whole = half + half.mirror(Plane.YZ)
rep("fused", whole)
rep("mirror() default plane", half.mirror())
rep("mirror(half) function default", mirror(half))
rep("mirror XY", half.mirror(Plane.XY))
rep("offset plane YZ.offset(30)", half.mirror(Plane.YZ.offset(30)))
rep("tilted plane", half.mirror(Plane(origin=(0, 0, 0), z_dir=(1, 1, 0))))
# face's plane
p2 = Box(20, 10, 10)
rf = p2.faces().right()[0]
rep("mirror about the part's right face plane", p2.mirror(rf.plane))
try:
    p2.mirror(rf)
except Exception as e:
    print(f"[mirror(face)] {type(e).__name__}: {e}")
# fused with gap / overlap
gap = Box(10, 10, 10).translate(10, 0, 0)
rep("gap: fused with mirror (separate)", gap + gap.mirror(Plane.YZ))
ov = Box(30, 10, 10).translate(10, 0, 0)
rep("overlap: fused with mirror", ov + ov.mirror(Plane.YZ))
print("overlap expected", 50*10*10)
# mirror of a sketch: normal?
sk = Rectangle(10, 6).translate(10, 0)
ms = sk.mirror(Plane.YZ)
print("sketch normal", sk.plane.z_dir.to_tuple(), "mirrored sketch normal", ms.plane.z_dir.to_tuple(), "x_dir", ms.plane.x_dir.to_tuple())
e = ms.extrude(5)
rep("mirrored sketch extrude(5)", e)
# mirror of edges / wires
w = Polyline((0, 0, 0), (10, 0, 0), (10, 10, 0))
mw = w.mirror(Plane.YZ)
print("wire start/end", mw.start.to_tuple(), mw.end.to_tuple())
snapshot("mirror", whole, view="top")
