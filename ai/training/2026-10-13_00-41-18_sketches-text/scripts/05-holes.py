# pieces and holes of letters; the fill rule of fonts
for ch in "oB8i%®Ä@&ÆgQ":
    t = Text(ch, 10)
    print(f"[05] {ch!r}: faces {len(t.faces())}, holes {sorted(len(f.inner_wires()) for f in t.faces())}, edges {len(t.edges())}")
quad = "tests/data/test-quadratic.ttf"  # run from the repository root
for ch, what in (("X", "two rectangles overlapping by 200"), ("N", "a rectangle inside a rectangle, same turning sense"),
                 ("R", "outline, hole, island"), ("P", "composite placed by point matching, sharing an edge")):
    t = Text(ch, 700, font=quad, align=None)
    print(f"[05] test font {ch} ({what}): faces {len(t.faces())}, holes {sorted(len(f.inner_wires()) for f in t.faces())}, area {t.area:.1f}")
