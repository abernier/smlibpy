# What a Shell has and lacks; which operations return one.
import math
s = surface([[(x, y, 0.02 * x * y) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
print("[01] repr:", s)
print("[01] area:", round(s.area, 4), "center:", s.center(), "bbox:", s.bbox().min, s.bbox().max)
print("[01] info:", s.info())
for attr in ("volume", "is_valid", "solids", "fillet", "shell", "mass_properties"):
    print(f"[01] has {attr}:", hasattr(s, attr))
for op in ("-", "&"):
    try:
        r = eval(f"s {op} s.translate(5, 0, 0)")
        print(f"[01] shell {op} shell:", r)
    except Exception as e:
        print(f"[01] shell {op} shell:", type(e).__name__, e)
print("[01] isinstance(Rectangle(1,1), Shell):", isinstance(Rectangle(1, 1), Shell))
arc = ThreePointArc((0, 0, 0), (10, 5, 0), (20, 0, 0))
cases = {
    "extrude(open arc)": lambda: extrude(arc, 10),
    "revolve(open spline)": lambda: revolve(Spline((5, 0, 0), (8, 0, 10), (4, 0, 20)), Z),
    "loft(open curves)": lambda: loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 0, 10), (10, 3, 10))]),
    "sweep(open line, path)": lambda: sweep(Line((-2, 0, 0), (2, 0, 0)), Helix(pitch=20, height=40, radius=10)),
    "Face.to_shell()": lambda: Box(5, 5, 5).faces()[0].to_shell(),
    "stitch(open)": lambda: stitch(Box(5, 5, 5).faces()[:3]),
    "extrude(closed wire)": lambda: extrude(Polyline((0, 0, 0), (5, 0, 0), (5, 5, 0), close=True), 3),
    "Part.section": lambda: Box(5, 5, 5).section(),
    "Part.split": lambda: Box(5, 5, 5).split(Plane.XY),
}
for k, fn in cases.items():
    try:
        r = fn()
        print(f"[01] {k}: {type(r).__name__}")
    except Exception as e:
        print(f"[01] {k}: {type(e).__name__}: {e}")
