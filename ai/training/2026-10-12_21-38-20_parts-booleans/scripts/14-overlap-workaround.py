def rep(name, f):
    try:
        p = f()
        print(f"[14] {name}: faces {len(p.faces())}, vol {round(p.volume, 4)}, valid {p.is_valid()}", flush=True)
        return p
    except Exception as e:
        print(f"[14] {name}: {type(e).__name__}: {e}", flush=True)

b = Box(40, 40, 20)
c5, c3 = Cylinder(5, 30), Cylinder(3, 30).translate(6, 0, 0)
rep("b - c5 - c3 (fails)", lambda: b - c5 - c3)
rep("b - (c5 + c3)", lambda: b - (c5 + c3))
rep("b + (c5 + c3)", lambda: b + (c5 + c3))
rep("b - c3 - c5 (other order)", lambda: b - c3 - c5)
rep("b - c5 - c3 with c3 1 mm longer on top only", lambda: b - c5 - Cylinder(3, 31).translate(6, 0, 0.5))
rep("b - c5 - c3 ending inside (c3 z -15..9)", lambda: b - c5 - Cylinder(3, 24).translate(6, 0, -3))
expected = 40 * 40 * 20 - (b & (c5 + c3)).volume
print("[14] expected volume:", round(expected, 4))
