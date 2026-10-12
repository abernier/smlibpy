def rep(name, f):
    try:
        p = f()
        print(f"[12] {name}: faces {len(p.faces())}, vol {round(p.volume, 4)}, valid {p.is_valid()}", flush=True)
        return p
    except Exception as e:
        print(f"[12] {name}: {type(e).__name__}: {e}", flush=True)

b = Box(40, 40, 5)
c0, c4, c8 = Cylinder(5, 10), Cylinder(5, 10).translate(4, 0, 0), Cylinder(5, 10).translate(8, 0, 0)
s1 = rep("b - c0", lambda: b - c0)
s2 = rep("(b - c0) - c4", lambda: s1 - c4)
s3 = rep("((b - c0) - c4) - c8", lambda: s2 - c8)
rep("b - c4 - c8", lambda: b - c4 - c8)
rep("b - c0 - c8", lambda: b - c0 - c8)
tool = rep("c0 + c4 + c8", lambda: c0 + c4 + c8)
rep("b - (c0 + c4 + c8)", lambda: b - tool)
rep("b - [c0, c4, c8] with tool height 12", lambda: b - [Cylinder(5, 12), Cylinder(5, 12).translate(4, 0, 0), Cylinder(5, 12).translate(8, 0, 0)])
rep("b - c0 - c4 - c8 with c4 shifted 0.01 in y", lambda: b - c0 - c4.translate(0, 0.01, 0) - c8)
rep("b - c0 - c3 - c8 (other spacing)", lambda: b - c0 - Cylinder(5, 10).translate(3, 0, 0) - c8)
rep("b - c0 - c4 - c8 different heights (10, 11, 12)", lambda: b - Cylinder(5, 10) - Cylinder(5, 11).translate(4, 0, 0) - Cylinder(5, 12).translate(8, 0, 0))
