# Which helices fail with SM_ERR_NOT_WITHIN_TOLERANCE?
import time
for pitch, height, r in [(2, 20, 20), (2, 40, 20), (2, 60, 20), (2, 100, 20), (2, 100, 5), (1, 100, 5), (1, 200, 5),
                         (0.5, 100, 3), (1.5, 30, 6), (10, 1000, 20), (2, 100, 50), (5, 20, 200), (0.2, 2, 1)]:
    t = time.time()
    try:
        h = Helix(pitch, height, r)
        print(f"[10] pitch {pitch} height {height} r {r} turns {height / pitch:g}: ok ({time.time() - t:.2f}s)")
    except Exception as ex:
        print(f"[10] pitch {pitch} height {height} r {r} turns {height / pitch:g} ->", type(ex).__name__, str(ex).splitlines()[0])
