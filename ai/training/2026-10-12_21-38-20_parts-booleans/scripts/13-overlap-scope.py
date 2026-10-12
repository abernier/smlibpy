def rep(name, f):
    try:
        p = f()
        print(f"[13] {name}: faces {len(p.faces())}, vol {round(p.volume, 4)}, valid {p.is_valid()}", flush=True)
        return p
    except Exception as e:
        print(f"[13] {name}: {type(e).__name__}: {e}", flush=True)

b = Box(40, 40, 20)
rep("cross drilled: vertical hole then horizontal hole through it", lambda: b - Cylinder(3, 30) - Cylinder(2, 50).rotate(Y, 90))
rep("parallel holes overlapping, different radii", lambda: b - Cylinder(5, 30) - Cylinder(3, 30).translate(6, 0, 0))
rep("parallel holes overlapping, blind second", lambda: b - Cylinder(5, 30) - Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(6, 0, 0))
rep("parallel holes overlapping, both blind", lambda: b - Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(6, 0, 0))
rep("parallel holes overlapping, rotated tools", lambda: b - Cylinder(5, 30).rotate(Z, 17) - Cylinder(3, 30).rotate(Z, 41).translate(6, 0, 0))
rep("cylinder boss fused onto cylinder boss (parallel, overlapping)", lambda: b + Cylinder(5, 30) + Cylinder(3, 30).translate(6, 0, 0))
rep("Cylinder minus parallel overlapping cylinder", lambda: Cylinder(10, 20) - Cylinder(5, 30).translate(10, 0, 0))
rep("hole then a box pocket overlapping it", lambda: b - Cylinder(5, 30) - Box(10, 10, 30).translate(8, 0, 0))
rep("slot from extruded Slot sketch (alternative)", lambda: b - Slot(20, 10).extrude(30, both=True))
