# Trapezoid: base width, height, side angles inside the base corners
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 4) for v in b.min)}..{tuple(round(v, 4) for v in b.max)}"
def attempt(label, fn):
    try:
        s = fn()
        vs = sorted((tuple(round(c, 4) for c in v)[:2] for v in s.vertices()), key=lambda p: (p[1], p[0]))
        print(f"[09] {label}: {s!r} bbox={bb(s)} corners={vs}")
        return s
    except Exception as e:
        print(f"[09] {label}: {type(e).__name__}: {e}")
t = attempt("Trapezoid(40, 15, 60)", lambda: Trapezoid(40, 15, 60))
print("[09] top width:", round(40 - 2 * 15 / math.tan(math.radians(60)), 4), "area formula:", round((40 + 40 - 2 * 15 / math.tan(math.radians(60))) / 2 * 15, 4))
attempt("left 60 right 90", lambda: Trapezoid(40, 15, 60, 90))
attempt("left 45 right 75", lambda: Trapezoid(40, 15, 45, 75))
attempt("90 (rectangle)", lambda: Trapezoid(40, 15, 90))
attempt("120 (top wider, dovetail)", lambda: Trapezoid(40, 15, 120))
attempt("left 120 right 60 (parallelogram)", lambda: Trapezoid(40, 15, 120, 60))
attempt("sides meet exactly (triangle)", lambda: Trapezoid(40, 20, 45))
attempt("sides cross", lambda: Trapezoid(40, 30, 45))
attempt("angle 0", lambda: Trapezoid(40, 15, 0))
attempt("angle 180", lambda: Trapezoid(40, 15, 180))
attempt("angle -60", lambda: Trapezoid(40, 15, -60))
attempt("height 0", lambda: Trapezoid(40, 0, 60))
attempt("height negative", lambda: Trapezoid(40, -15, 60))
attempt("align MIN", lambda: Trapezoid(40, 15, 60, align=Align.MIN))
attempt("align (CENTER, MIN)", lambda: Trapezoid(40, 15, 60, align=(Align.CENTER, Align.MIN)))
snapshot("traps", Trapezoid(40, 15, 60).extrude(1), Trapezoid(40, 15, 120).translate(0, -25).extrude(1), Trapezoid(40, 15, 60, 90).translate(50, 0).extrude(1), Trapezoid(40, 15, 120, 60).translate(50, -25).extrude(1), view="top")
