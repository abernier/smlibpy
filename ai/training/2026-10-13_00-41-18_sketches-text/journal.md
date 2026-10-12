# Training: sketches · Text

**Date:** 2026-10-13

## Goal

APIs: `Text` (new), with `Sketch.extrude`, `on`, Booleans.

Questions:
- What does `size` measure? Where does the text sit for each `align`?
- How do lines, `line_spacing`, `spacing` and `kerning` move letters?
- Do holes come out right (o, B, 8, ®, %), and the fill rule of fonts (overlaps, nested contours)?
- Which fonts can be read; what happens with a character a font lacks?
- Text along a path: which side, which direction, which alignment?
- Embossing and engraving on flat and curved faces.

## Log

### 01-basics.py
`Text("SMLIB 42", 8)`: a `Sketch` on Plane.XY (origin 0), 7 faces, holes [0,0,0,0,0,1,2], 78 edges
(lines and bsplines), area 118.7013, bbox ±23.5 x ±4.09. `O`: 2 closed bspline edges; extruded: 4 faces,
valid, volume 71.0624 = 2 × area. `H`: 12 line edges, height 10.0.
**📌 doc:** smooth runs are one bspline edge; straight parts are lines.

### 02-size.py
`H` is exactly `size` tall for 1, 2.5, 10, 100 (y ±size/2 when centered). With `align=MIN` at size 10:
`O` -0.1047..10.1117, `g` -2.5471..7.1877, `x` 0..7.0691, `Ä` 0..12.4075. The em size at size 10 is
13.9567 mm (2000 units, cap height 1433).
**📌 doc:** size = cap height; overshoot, descenders, accents.

### 03-align.py
`"Hg"` at 10: CENTER x -7.63..8.62 y -7.55..5; MIN x 1.21..17.46 y -2.55..10; MAX x -16.47..-0.22
y -12.55..0; None = MIN for one line; per-axis tuples and strings work. Two MIN labels share the baseline
(`Hg` bottom -2.55 because of the g, `HH` 0, both baselines at 0).
**📌 doc:** alignment table; the layout box is not the ink box.

### 04-lines-spacing.py
`line_spacing` 1.0 / 1.6 / 2.5 with `"H\nH"` at 10 and MIN: top at 20 / 26 / 35. Lines aligned by the
x alignment: the short line's H at x 5.269 (MIN), -0.007 (CENTER), -5.283 (MAX). Kerning `AV`: 0.949058
narrower = 136 units × 10/1433. `spacing` adds exactly s per gap (ABC: 26.5157, 27.5157, 28.5157, 31.5157
for -0.5, 0, 0.5, 2). `AA` with spacing -6: the letters overlap and become one face (area 53.53 < 2 × 29.47).
![block](files/04-lines-spacing-block.png)

### 05-holes.py
o 1 face 1 hole; B 2 holes; 8 2 holes; i 2 faces; % 3 faces (2 holes); ® 2 faces, a hole each; Ä 3 faces;
@, &, Æ, Q 1 hole; g 2 holes. Test font (nonzero rule): overlapping rectangles X → 1 face 420000; nested
same-sense N → no hole, 420000; R (outline, hole, island) → 2 faces 280000; P (point-matched composite
sharing an edge) → 1 face 840000.

### 06-fonts.py
Default `Lato-Regular.ttf` 96184 bytes; `font=` with the same path gives the same text. A CFF font
(`test-cubic.otf`), WOFF and TTC (first font) read. Lato covers 263 characters. Missing glyphs:
`ValueError: Text: the font Lato Regular has no glyph for 'ж' (U+0436); pass font= with a font that has
it` (several listed for 日本). Missing file: `FileNotFoundError: no font file '/no/such/font.ttf'`; a text
file: `ValueError: Text: .../README.md: not a TrueType or OpenType font`.

### 07-path.py
Over a clockwise arc the letters stand outside; along a counterclockwise bottom arc with
`align=(CENTER, MAX)` they hang outside and read from below. Area along the arc = straight area (51.57).
An H of size 4 centered on the top of a circle of radius 30: y 28..32; across MIN 30..34, MAX 26..30.
Along a 100 mm line: MIN starts at 0, CENTER around 50, MAX ends at 100. A spline path works (12 faces,
valid extrusion). Errors: too long (`the text is 98.7969 mm long but the path only 7.85398 mm`), not in XY,
two lines.
![arcs](files/07-path-arcs.png)

### 08-emboss-engrave.py
Plate 70×24×5 with `SMLIB 42` at 8: embossed 0.8 → volume 8494.9612 (plate + 0.8 × area), valid, top
at 3.3; engraved 0.5 → 8340.6494, valid. On the front face (facing -Y) the text stands upright (x
-6.6..6.9, z -1.53..1.53, y -12). `.on(cylinder face)`: `ValueError: a cylinder face has no plane; use
normal_at() or a planar face`. A plain cut of depth 1 from a tangent plane removes 13.44 instead of 32.56:
the wall curves away from the plane.
![parts](files/08-emboss-engrave-parts.png)

### 09-files-speed.py
224 characters at 3: 188 faces in 0.087 s (0.067 s again). STEP round trip: a `Shell` with the same area.
DXF: 6 SPLINE + 22 LINE for `A1`.

### 10-errors.py
size 0 / -2, empty, spaces only, tab, line_spacing 0 → `ValueError` with the messages in the guide;
`Text(42, 5)` and `path=Box(...)` → `TypeError`.

### 11-curved-face.py
Uniform depth on a cylinder: `can - (Text(...).on(tangent).extrude(-r) & (can - Cylinder(r - depth, h + 2)))`
is valid, removes 41.46, and the floors are 5 cylinder faces at radius 14.4. A plain cut of 0.6 removes
only 6.34.
![can](files/11-curved-face-can.png)
**📌 doc:** the pattern for curved faces.

### 12-doc-example.py
The guide's example, unchanged: `94.9612 59.3506`, `11 51.57`.

## Coverage
- [x] ran successfully; [x] every parameter (size, font, align, spacing, line_spacing, kerning, path)
- [x] defaults measured (CENTER, 1.6, kerning on, Lato)
- [x] edge cases and errors; [x] realistic use (emboss, engrave, flat and curved faces)
- [x] every spatial claim backed by numbers
