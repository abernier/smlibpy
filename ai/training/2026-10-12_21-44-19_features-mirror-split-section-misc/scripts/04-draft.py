import inspect
print("Part.draft", inspect.signature(Part.draft))
box = Box(40, 30, 20)
try:
    box.draft(box.faces().facing(X), 5, Plane.XY)
except Exception as e:
    print(f"[draft] {type(e).__name__}: {e}")
# The alternatives: tapered extrusion (all side walls), loft between two outlines, or a cut by a tilted box
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
b = core.bbox()
top = core.section(Plane.XY.offset(19.999)).bbox()
print("[taper 3] bottom", b.size.to_tuple(), "top section size", tuple(round(v, 3) for v in top.size.to_tuple()), "expected top", 60 - 2*20*math.tan(math.radians(3)))
# draft one wall only: cut the box with a tilted half-space (split by a tilted plane through the bottom edge)
wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
ang = 5
pl = Plane(origin=(20, 0, 0), z_dir=(-math.cos(math.radians(ang)), 0, -math.sin(math.radians(ang))))
one = wall.split(pl, keep="above")   # the plane normal points into the part
ob = one.bbox()
print("[one wall drafted by split] valid", one.is_valid(), "vol", round(one.volume, 3), "expected", 40*30*20 - 0.5*20*20*math.tan(math.radians(ang))*30, "x max", round(ob.max.x, 3))
# draft of a pocket wall: taper the cutting tool (negative amount from the face, positive taper narrows downward)
blk = Box(60, 40, 20)
pocket = Rectangle(30, 20).on(blk.faces().top()).extrude(-10, taper=5)
cut = blk - pocket
pb = pocket.bbox()
print("[tapered pocket tool] z", round(pb.min.z, 3), round(pb.max.z, 3), "size at bottom", tuple(round(v, 3) for v in pocket.section(Plane.XY.offset(0.001)).bbox().size.to_tuple()), "top", tuple(round(v, 3) for v in pocket.section(Plane.XY.offset(9.999)).bbox().size.to_tuple()))
print("[pocket] valid", cut.is_valid(), "vol", round(cut.volume, 3))
snapshot("draft", core, one.translate(80, 0, 0), cut.translate(0, 70, 0), view="iso")
