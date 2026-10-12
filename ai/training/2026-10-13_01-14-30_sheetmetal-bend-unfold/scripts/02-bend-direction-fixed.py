# angle sign, line on the bottom face, fixed side
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
line_top = Axis((20, 0, 2), (0, 1, 0))
up = bend(blank, line_top, 90, radius=2)
down = bend(blank, line_top, -90, radius=2)
under = bend(blank, Axis((20, 0, 0), (0, 1, 0)), 90, radius=2)
left = bend(blank, line_top, 90, radius=2, fixed=(40, 0, 0))
for name, p in (("up", up), ("down", down), ("under", under), ("fixed +X", left)):
    bb = p.bbox()
    print(f"[02] {name}: min {bb.min} max {bb.max}")
snapshot("four", up, down.translate(0, 60, 0), under.translate(0, 120, 0), left.translate(0, 180, 0), view="front")
