# the example of references/sketches/Text.md, unchanged
plate = Box(70, 24, 5)
label = Text("SMLIB 42", 8)
embossed = plate + label.on(plate.faces().top()).extrude(0.8)   # raised 0.8
engraved = plate - label.on(plate.faces().top()).extrude(-0.5)  # cut 0.5 deep
print(round(embossed.volume - plate.volume, 4), round(plate.volume - engraved.volume, 4))

two_lines = Text("SMLIB\nNURBS", 5, align=Align.MIN)            # last baseline on y = 0
ring = Text("TEXT ON AN ARC", 4, path=CenterArc((0, 0), 30, 170, -160))
print(len(ring.faces()), round(ring.area, 2))
print("[12] two_lines bbox", two_lines.bbox())
