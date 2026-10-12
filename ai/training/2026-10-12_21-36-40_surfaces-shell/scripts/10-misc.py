# Shell(): constructor; silhouette, outline, moved, on.
try:
    Shell()
except Exception as e:
    print("[10] Shell():", type(e).__name__, e)
s = surface([[(x, y, 0.02 * x * y) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
for label, fn in [("silhouette", lambda: s.silhouette((1, 0, 0))), ("outline", lambda: s.outline()),
                  ("moved", lambda: s.moved(Pos(1, 0, 0))), ("on", lambda: s.on(Plane.XZ)),
                  ("wires", lambda: s.wires())]:
    try:
        r = fn()
        print(f"[10] {label}: {type(r).__name__} {len(r) if hasattr(r, '__len__') else ''} {r if not hasattr(r, '__len__') else ''}")
    except Exception as e:
        print(f"[10] {label}: {type(e).__name__}: {e}")
