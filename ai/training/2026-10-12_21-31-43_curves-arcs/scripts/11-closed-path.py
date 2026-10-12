# Sweep along a closed path: full circle vs two half circles vs revolve
exp = math.pi * 4 * 2 * math.pi * 20
full = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))
print("[11] full circle path: valid", full.is_valid(), "volume", round(full.volume, 4), "faces", len(full.faces()), "bbox", full.bbox().min, full.bbox().max)
halves = Wire([CenterArc((0, 0), 20, 0, 180), CenterArc((0, 0), 20, 180, 180)])
try:
    h = sweep(Circle(2), halves)
    print("[11] two halves: valid", h.is_valid(), "volume", round(h.volume, 4), "expected", round(exp, 4))
except Exception as ex:
    print("[11] two halves ->", type(ex).__name__, ex)
rv = Circle(2).translate(20, 0).on(Plane.XZ)
print("[11] profile for revolve bbox", rv.bbox().min, rv.bbox().max)
ring = revolve(Pos(20, 0) * Circle(2) if False else Circle(2).translate(20, 0).on(Plane.XZ), Z)
print("[11] revolve: valid", ring.is_valid(), "volume", round(ring.volume, 4), "expected", round(exp, 4))
spl = sweep(Circle(2), Spline((20, 0), (0, 20), (-20, 0), (0, -20), closed=True))
print("[11] closed spline path: valid", spl.is_valid(), "volume", round(spl.volume, 4))
for tag, path in [("full ellipse", EllipticalArc((0, 0), 30, 20)), ("ellipse arc 0..90", EllipticalArc((0, 0), 30, 20, 0, 90))]:
    try:
        ell = sweep(Circle(2), path)
        print(f"[11] {tag} path: valid", ell.is_valid(), "volume", round(ell.volume, 4))
    except Exception as ex:
        print(f"[11] {tag} path ->", type(ex).__name__, str(ex).splitlines()[0])
# open ellipse arc as an extrude / revolve profile, and in a loft
try:
    sh = extrude(EllipticalArc((0, 0), 30, 20, 0, 90), 5)
    print("[11] open ellipse extrude:", type(sh).__name__, round(sh.area, 4))
except Exception as ex:
    print("[11] open ellipse extrude ->", type(ex).__name__, str(ex).splitlines()[0])
try:
    lf = loft([make_face(EllipticalArc((0, 0), 30, 20)), Circle(10).on(Plane.XY.offset(20))])
    print("[11] loft ellipse->circle: valid", lf.is_valid(), "volume", round(lf.volume, 3))
except Exception as ex:
    print("[11] loft ellipse ->", type(ex).__name__, str(ex).splitlines()[0])
snapshot("closed", full, ring.translate(60, 0, 0), view="iso")
