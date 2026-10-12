box = Box(40, 30, 20)
e = box.edges().parallel_to(Z).nearest((20, 15, 0))
for c, fu in ((None, 1.0), ("G1", 1.0), ("G2", 1.0), ("G3", 1.0), ("G2", 0.5), ("G2", 1.2)):
    p = box.fillet(e, 5, continuity=c, fullness=fu)
    ff = [f for f in p.faces() if not f.is_planar]
    b = ff[0].bbox()
    print(f"[{c} fullness {fu}] blend face x {b.min.x:.4f}..{b.max.x:.4f} y {b.min.y:.4f}..{b.max.y:.4f} -> setback x {20 - b.min.x:.4f} y {15 - b.min.y:.4f}; corner gap {math.hypot(20 - p.closest_point((40, 30, 0)).x, 15 - p.closest_point((40, 30, 0)).y):.4f}")
