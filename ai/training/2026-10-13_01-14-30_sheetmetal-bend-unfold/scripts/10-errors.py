# what goes wrong and what it says
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
cases = {
    "line above the plate": lambda: bend(blank, Axis((20, 0, 5), (0, 1, 0)), 90, radius=2),
    "line outside the plate": lambda: bend(blank, Axis((60, 0, 2), (0, 1, 0)), 90, radius=2),
    "line 1 from the edge": lambda: bend(blank, Axis((49, 0, 2), (0, 1, 0)), 90, radius=2),
    "radius too small": lambda: bend(blank, Axis((0, 0, 2), (0, 1, 0)), 90, radius=0.1),
    "angle 200": lambda: bend(blank, Axis((0, 0, 2), (0, 1, 0)), 200, radius=2),
    "arc as line": lambda: bend(blank, CenterArc((0, 0, 2), 10, 0, 90), 90, radius=2),
    "sketch": lambda: bend(Rectangle(10, 10), Axis((0, 0, 0), (0, 1, 0)), 90, radius=2),
    "sharp corner": lambda: unfold(blank + Box(2, 40, 30, align=(Align.MAX, Align.CENTER, Align.MIN)).translate(50, 0, 0)),
    "two bends too close": lambda: bend(bend(blank, Axis((0, 0, 2), (0, 1, 0)), 90, radius=2),
                                        Axis((-3, 0, 2), (0, 1, 0)), 90, radius=2),
}
for name, fn in cases.items():
    try:
        fn()
        print(f"[10] {name}: no error")
    except Exception as e:
        print(f"[10] {name}: {type(e).__name__}: {e}")
