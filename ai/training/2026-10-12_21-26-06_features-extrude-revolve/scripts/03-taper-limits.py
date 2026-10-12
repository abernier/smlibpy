for ang in (30, 45, 56, 60, 80, 89):
    try:
        p = Rectangle(20, 20).extrude(10, taper=ang)
        b = p.bbox()
        print(f"[taper {ang}] valid={p.is_valid()} vol={p.volume:.4f} top z={b.max.z:.3f} faces={len(p.faces())} size={b.size.to_tuple()}")
    except Exception as e:
        print(f"[taper {ang}] {type(e).__name__}: {e}")
print("closing angle for 20x20 h10:", math.degrees(math.atan(10/10)))
for ang in (90, 100, -60):
    try:
        p = Rectangle(20, 20).extrude(10, taper=ang)
        print(f"[taper {ang}] valid={p.is_valid()} vol={p.volume:.4f}")
    except Exception as e:
        print(f"[taper {ang}] {type(e).__name__}: {e}")
# hole closes first in negative taper
try:
    p = (Rectangle(40, 40) - Circle(3)).extrude(10, taper=-30)
    print("[hole closing] valid", p.is_valid(), p.volume)
except Exception as e:
    print(f"[hole closing] {type(e).__name__}: {e}")
