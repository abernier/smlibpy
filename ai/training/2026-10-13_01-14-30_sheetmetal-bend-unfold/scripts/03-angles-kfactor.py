# angles up to 180, K-factor, radius limits
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
for angle in (30, 90, 135, 180):
    p = bend(blank, Axis((20, 0, 2), (0, 1, 0)), angle, radius=2)
    fp = flat_pattern(p)
    print(f"[03] angle {angle}: volume {p.volume:.6f} bbox max {p.bbox().max} flat {fp.size}")
for k in (0.0, 0.3, 0.5, 1.0):
    p = bend(blank, Axis((0, 0, 2), (0, 1, 0)), 90, radius=2, k_factor=k)
    print(f"[03] k {k}: BA {bend_allowance(90, radius=2, thickness=2, k_factor=k):.6f} volume {p.volume:.6f} "
          f"flat with k {k}: {flat_pattern(p, k_factor=k).size.x:.6f}, with 0.44: {flat_pattern(p).size.x:.6f}")
for r in (20, 0.3, 0.11, 0.1):
    try:
        p = bend(blank, Axis((0, 0, 2), (0, 1, 0)), 90, radius=r)
        print(f"[03] radius {r}: ok, unfolded volume {unfold(p).volume:.6f}")
    except Exception as e:
        print(f"[03] radius {r}: {type(e).__name__}: {e}")
