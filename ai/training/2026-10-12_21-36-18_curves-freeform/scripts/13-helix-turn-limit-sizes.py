# Largest whole number of turns per (pitch, radius)
for p, r in [(1, 5), (2, 20), (0.5, 2), (5, 50), (1, 50), (10, 5), (0.2, 0.5)]:
    ok = 0
    for t in range(1, 80):
        try:
            Helix(p, p * t, r)
            ok = t
        except Exception:
            break
    print(f"[13] pitch {p} radius {r}: max turns {ok}")
