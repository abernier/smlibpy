def rep(tag, fn):
    try:
        p = fn()
        b = p.bbox()
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids())}")
        return p
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

# mitered frame corner
frame = rep("polyline mitered", lambda: sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40))))
print("expected mitered", 24*80)
pieces = rep("polyline sharp_corners=False", lambda: sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)), sharp_corners=False))
c3 = rep("circle mitered", lambda: sweep(Circle(3), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40))))
print("expected", math.pi*9*80)
# U shape
u = rep("U polyline", lambda: sweep(Circle(3), Polyline((0, 0, 0), (0, 0, 40), (30, 0, 40), (30, 0, 0))))
print("expected", math.pi*9*110)
# 3D (non-planar) polyline
nonp = rep("3D polyline", lambda: sweep(Circle(3), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40), (40, 40, 40))))
print("expected straight sum", math.pi*9*120)
rep("3D polyline sharp_corners=True", lambda: sweep(Circle(3), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40), (40, 40, 40)), sharp_corners=True))
# tangent wire: line + arc (elbow)
elbow = rep("elbow line+arc", lambda: sweep(Circle(4), Wire([Line((0, 0, 0), (0, 0, 20)), CenterArc((15, 20), 15, 180, -90, plane=Plane.front)])))
print("expected", math.pi*16*(20 + 2*math.pi*15/4))
# FilletPolyline path
fp = rep("FilletPolyline", lambda: sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), radius=8)))
L = 32 + 32 + 2*math.pi*8/4
print("expected", math.pi*9*L)
# closed path: a square loop
loop = rep("closed square path", lambda: sweep(Circle(2), Polyline((0, 0, 0), (40, 0, 0), (40, 40, 0), (0, 40, 0), close=True)))
ring = rep("closed circle path", lambda: sweep(Circle(2), CenterArc((0, 0), 20, 0, 360)))
print("expected ring", math.pi*4*2*math.pi*20)
# Sketch.sweep with polyline
rep("Sketch.sweep polyline", lambda: Rectangle(6, 4).sweep(Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40))))
snapshot("multi", frame, pieces.translate(60, 0, 0), elbow.translate(120, 0, 0), fp.translate(180, 0, 0), view="front")
snapshot("nonplanar", nonp)
