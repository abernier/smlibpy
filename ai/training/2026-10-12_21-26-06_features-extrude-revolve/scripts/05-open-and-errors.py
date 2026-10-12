sh = extrude(Line((0, 0, 0), (10, 0, 0)), 5)
b = sh.bbox()
print("[line] type", type(sh).__name__, "area", round(sh.area, 4), b.min.to_tuple(), b.max.to_tuple())
sh2 = extrude(Line((0, 0, 0), (10, 0, 0)), 5, direction=(0, 1, 0))
b = sh2.bbox()
print("[line dir y] area", round(sh2.area, 4), b.min.to_tuple(), b.max.to_tuple())
arc = CenterArc((0, 0), 10, 0, 180)
sh3 = extrude(arc, 5)
b = sh3.bbox()
print("[arc] area", round(sh3.area, 4), "expected", math.pi*10*5, b.min.to_tuple(), b.max.to_tuple())
sh4 = extrude(arc, 5, both=True)
b = sh4.bbox()
print("[arc both] area", round(sh4.area, 4), b.min.to_tuple(), b.max.to_tuple())
sh5 = extrude(Polyline((0,0),(10,0),(10,10)), -4)
b = sh5.bbox()
print("[polyline -4] area", round(sh5.area, 4), b.min.to_tuple(), b.max.to_tuple())
# closed wire -> solid
cw = extrude(Polyline((0,0),(10,0),(10,10), close=True), 4)
print("[closed wire] type", type(cw).__name__, round(cw.volume, 4))
# Circle edge (closed) -> ?
ce = extrude(CenterArc((0, 0), 5, 0, 360), 4)
print("[closed circle edge] type", type(ce).__name__, round(ce.volume, 4))
for tag, fn in [
    ("zero", lambda: Rectangle(10, 10).extrude(0)),
    ("Part", lambda: extrude(Box(1, 1, 1), 3)),
    ("3d open wire taper", lambda: extrude(Line((0,0,0),(1,0,0)), 3, taper=5)),
    ("self crossing", lambda: extrude(Polyline((0,0),(10,10),(10,0),(0,10), close=True), 3)),
]:
    try:
        r = fn()
        print(f"[{tag}] OK {type(r).__name__}", getattr(r, "volume", None) if isinstance(r, Part) else r)
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")
