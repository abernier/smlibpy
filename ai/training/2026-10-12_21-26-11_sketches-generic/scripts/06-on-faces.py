# Sketches on faces of a part; Face.to_sketch; Wire.to_sketch
box = Box(60, 40, 20)
marker = Rectangle(10, 4, align=Align.MIN)   # local +X along 10, +Y along 4
for sel in ["top", "bottom", "front", "back", "left", "right"]:
    face = getattr(box.faces(), sel)()
    s = marker.on(face)
    p = s.plane
    print(f"[06] on {sel}: face center={face.one().center()} x={p.x_dir} y={p.y_dir} z={p.z_dir} bbox={s.bbox().min}..{s.bbox().max}")
# extrude negative from top cuts into the part
top = box.faces().top()
pocket = Rectangle(30, 20).on(top).extrude(-4)
print("[06] pocket bbox:", pocket.bbox().min, pocket.bbox().max)
cut = box - pocket
print("[06] cut volume:", round(cut.volume, 3), "expected:", 60 * 40 * 20 - 30 * 20 * 4, "valid:", cut.is_valid())
# off-center on a face: Pos before on
oc = (Pos(10, 5) * Circle(3)).on(top)
print("[06] off-center center:", oc.center())
# several faces -> error
try:
    Circle(3).on(box.faces().parallel_to(Z) if False else box.faces().facing(Z) + box.faces().facing(-Z))
except Exception as e:
    print("[06] on two faces:", type(e).__name__, e)
# cylinder face -> error
cyl = Cylinder(10, 20)
try:
    Circle(3).on(cyl.faces().filter_by("cylinder") if hasattr(cyl.faces(), "filter_by") else cyl.faces()[0])
except Exception as e:
    print("[06] on curved face:", type(e).__name__, e)
# Face.to_sketch
f = box.faces().facing(X).one()
fs = f.to_sketch()
print("[06] to_sketch:", repr(fs), "plane z:", fs.plane.z_dir, "x:", fs.plane.x_dir, "origin:", fs.plane.origin)
grown = box + fs.extrude(5)
print("[06] to_sketch extrude(5) bbox:", grown.bbox().min, grown.bbox().max, "valid:", grown.is_valid(), "solids:", len(grown.solids()))
# face with hole
holed = Box(30, 30, 10) - Cylinder(5, 20)
hs = holed.faces().top().one().to_sketch()
print("[06] holed top to_sketch:", repr(hs), "inner wires:", len(hs.faces()[0].inner_wires()), "expected area:", round(900 - math.pi * 25, 4))
# Wire.to_sketch
w = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True)
ws = w.to_sketch()
print("[06] wire to_sketch:", repr(ws), "plane z:", ws.plane.z_dir, "origin:", ws.plane.origin)
w_cw = Polyline((0, 0), (0, 10), (20, 10), (20, 0), close=True)
print("[06] clockwise wire to_sketch plane z:", w_cw.to_sketch().plane.z_dir)
try:
    Polyline((0, 0), (20, 0), (20, 10)).to_sketch()
except Exception as e:
    print("[06] open wire to_sketch:", type(e).__name__, e)
part = box + Slot(30, 8).on(box.faces().front()).extrude(3)
snapshot("on-faces", box + marker.on(box.faces().top()).extrude(1) + marker.on(box.faces().front()).extrude(1) + marker.on(box.faces().right()).extrude(1), view="iso")
