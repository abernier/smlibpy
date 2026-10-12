# EllipticalArc across 0 degrees: which ranges fail, and workarounds
for a0, a1 in [(270, 360), (300, 359), (350, 10), (-10, 10), (0, 360), (180, 360), (180, 0), (90, 360), (1, 0), (359, 1)]:
    try:
        e = EllipticalArc((0, 0), 20, 10, a0, a1)
        print(f"[08] {a0}..{a1}: start {e.start} end {e.end} len {e.length:.6f}")
    except Exception as ex:
        print(f"[08] {a0}..{a1} ->", type(ex).__name__, ex)
# workaround 1: two pieces in one wire
right = Wire([EllipticalArc((0, 0), 20, 10, 270, 360), EllipticalArc((0, 0), 20, 10, 0, 90)])
print("[08] two pieces:", right, right.start, right.end)
# workaround 2: draw it rotated by 180 degrees and turn it back
r2 = EllipticalArc((0, 0), 20, 10, 90, 270).rotate(Z, 180)
print("[08] rotated:", r2.geom_type, r2.start, r2.end, r2.point_at(0.5), r2.length)
