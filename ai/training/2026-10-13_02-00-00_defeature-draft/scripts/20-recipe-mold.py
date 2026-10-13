cover = RoundedRectangle(80, 50, 6).extrude(25, taper=2)      # outside, 2 degrees
cover -= RoundedRectangle(74, 44, 3).extrude(23, taper=1.5)   # inside, open at the bottom, 1.5 degrees

lines = cover.parting_line(Z)
print(len(lines), round(lines[0].length, 3), lines[0].bbox().max.z)   # 1 249.699 0.0: the bottom rim

up = cover.draft_analysis(Z, min_angle=1)       # the half that moves up: outside and top
down = cover.draft_analysis(-Z, min_angle=1)    # the half that moves down: inside and rim
print(len(up.positive), len(down.positive))     # 9 10
need = [f for f in cover.faces() if f not in up.positive and f not in down.positive]
print(len(need))                                # 0: every face releases from one half

ribbed = cover + Box(2, 44, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 23)
up, down = ribbed.draft_analysis(Z), ribbed.draft_analysis(-Z)
need = [f for f in ribbed.faces() if f not in up.positive and f not in down.positive]
print(len(need), [round(up.angles(f)[0], 6) for f in need])   # 2 [0.0, 0.0]: the rib's sides need draft
