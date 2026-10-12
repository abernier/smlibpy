import inspect
print("thicken", inspect.signature(thicken), "Shell.thicken", inspect.signature(Shell.thicken))
def rep(tag, fn, expected=None):
    print("start", tag, flush=True)
    try:
        p = fn()
        b = p.bbox()
        e = f" expected={expected:.4f}" if expected is not None else ""
        print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f}{e} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())}", flush=True)
        return p
    except Exception as ex:
        print(f"[{tag}] {type(ex).__name__}: {ex}", flush=True)

# planar sheet from a sketch (Sketch is a Shell)
sk = Rectangle(20, 10)
rep("Rectangle.thicken(2)", lambda: sk.thicken(2), 400)
rep("Rectangle.thicken(-2)", lambda: sk.thicken(-2), 400)
rep("thicken(Rectangle, 2)", lambda: thicken(sk, 2), 400)
rep("both=True (2)", lambda: sk.thicken(2, both=True), 800)
rep("on front plane", lambda: Rectangle(20, 10).on(Plane.front).thicken(2), 400)
# open-curve extrusion: a half-cylinder surface (arc in XY, extruded along Z)
arc_sheet = extrude(CenterArc((0, 0), 10, 0, 180), 20)
print("arc sheet normal at (0,10,10):", arc_sheet.faces()[0].normal_at((0, 10, 10)).to_tuple())
rep("half-cylinder sheet +2", lambda: arc_sheet.thicken(2), math.pi*(144 - 100)/2*20)
rep("half-cylinder sheet -2", lambda: arc_sheet.thicken(-2), math.pi*(100 - 64)/2*20)
# face of a part
box = Box(40, 30, 20)
top = box.faces().top()[0]
print("top face normal", top.normal_at().to_tuple())
rep("thicken(box top face, 3)", lambda: thicken(top, 3), 3600)
rep("thicken(box top face, -3)", lambda: thicken(top, -3), 3600)
# curved face of a part
cf = Cylinder(10, 20).faces().cylinders()[0]
print("cyl face normal", cf.normal_at((10, 0, 0)).to_tuple())
rep("thicken(cylinder face, 2)", lambda: thicken(cf, 2), math.pi*(144 - 100)*20)
rep("thicken(cylinder face, -2)", lambda: thicken(cf, -2), math.pi*(100 - 64)*20)
# a freeform surface
try:
    s = surface([[(0, 0, 0), (10, 0, 2), (20, 0, 0)], [(0, 10, 2), (10, 10, 5), (20, 10, 2)], [(0, 20, 0), (10, 20, 2), (20, 20, 0)]])
    print("surface", type(s).__name__, round(s.area, 3))
    rep("surface.thicken(1)", lambda: s.thicken(1), s.area)
except Exception as ex:
    print(f"[surface] {type(ex).__name__}: {ex}")
# multi-face sheet: open polyline extrusion (L-shaped sheet)
lsheet = extrude(Polyline((0, 0), (20, 0), (20, 10)), 10)
print("L sheet faces", len(lsheet.faces()), "area", lsheet.area)
rep("L sheet thicken 1", lambda: lsheet.thicken(1))
rep("L sheet thicken -1", lambda: lsheet.thicken(-1))
# too thick on a curved sheet (concave side larger than radius)
rep("half-cylinder sheet -12 (beyond the radius)", lambda: arc_sheet.thicken(-12))
rep("thicken 0", lambda: sk.thicken(0))
rep("thicken a Part", lambda: thicken(box, 1))
snapshot("thick", arc_sheet.thicken(2), lsheet.thicken(1).translate(30, 0, 0))
