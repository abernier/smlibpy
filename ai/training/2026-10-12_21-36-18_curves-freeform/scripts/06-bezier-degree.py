# Highest degree a Bezier accepts
for n in range(14, 24):
    try:
        e = Bezier(*[(i, (-1) ** i * 5) for i in range(n)])
        print(f"[06] {n} control points (degree {n - 1}): ok, len {e.length:.4f}")
    except Exception as ex:
        print(f"[06] {n} control points (degree {n - 1}) ->", type(ex).__name__, str(ex).splitlines()[0])
