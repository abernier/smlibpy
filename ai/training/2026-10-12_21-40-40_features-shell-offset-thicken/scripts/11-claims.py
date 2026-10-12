box = Box(80, 50, 30)
skin = box.offset(2.5) - box
print("[offset - part] valid", skin.is_valid(), "vol", round(skin.volume, 2), "expected", 85*55*35 - 80*50*30, "faces", len(skin.faces()))
# concave rounds limit growing
L = Polygon((0, 0), (40, 0), (40, 10), (10, 10), (10, 30), (0, 30)).extrude(10)
Lf = L.fillet(L.edges().concave(), 2)
for d in (1, 2, 3):
    try:
        g = Lf.offset(d)
        print(f"[L concave r2 offset +{d}] valid={g.is_valid()} vol={g.volume:.3f}")
    except Exception as e:
        print(f"[L concave r2 offset +{d}] {type(e).__name__}: {e}")
# symmetric thicken via moved copy
sk = Rectangle(20, 10)
sym = sk.translate(0, 0, -1).thicken(2)
b = sym.bbox()
print("[symmetric] z", b.min.z, b.max.z, "vol", sym.volume)
