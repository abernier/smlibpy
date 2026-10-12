# How close is the Helix (a B-spline) to the true helix?
for pitch, height, r in [(5, 20, 10), (1, 10, 3), (2, 100, 20), (20, 20, 5)]:
    h = Helix(pitch, height, r)
    n = 4000
    dr = dz = 0.0
    for i in range(n + 1):
        p = h.point_at(i / n)
        ang = math.atan2(p.y, p.x)
        dr = max(dr, abs(math.hypot(p.x, p.y) - r))
        # z should be pitch * turns; unwrap with the expected turns
        t_est = p.z / pitch
        ang_exp = 2 * math.pi * t_est
        d = (ang - ang_exp + math.pi) % (2 * math.pi) - math.pi
        dz = max(dz, abs(d) * r)
    L = height / pitch * math.hypot(2 * math.pi * r, pitch)
    print(f"[09] pitch {pitch} height {height} r {r}: max radial dev {dr:.2e} max along-circle dev {dz:.2e} length {h.length:.6f} exact {L:.6f}")
