# Text

Lettering as a `Sketch` with the exact outlines of a font: for labels, serial numbers and logos
that are engraved into a part or stand out of it.

## Signature
`Text(text, size, *, font=None, align=Align.CENTER, spacing=0.0, line_spacing=1.6, kerning=True, path=None)`

- `text`: a string; `"\n"` starts a new line.
- `size`: the height of the capital letters in mm (the nominal height of technical lettering):
  `Text("H", 10)` is exactly 10 tall. Not the font's em size (13.96 mm at size 10 for the
  default font).
- `font`: path of a `.ttf`, `.otf`, `.ttc` (its first font), `.woff` or `.woff2` file, or a
  `Font` from `load_font(path)` (read once). Default: Lato Regular, bundled (263 characters:
  Latin-1, Polish, `€ ± ° µ Ø ≤ ≥ ≈ ≠ ∞ Ω π`). No other package is needed: WOFF2 web fonts,
  CFF accents built with seac, and variable CFF2 fonts (their default instance) are read too.
- `align`: where the *layout box* sits: from the start to the end of the longest line (advance
  widths, not ink) and from the baseline of the last line to the cap height of the first.
  One `Align` (or string) for x and y, or one per axis.
- `spacing`: extra mm between neighbouring letters (negative: closer).
- `line_spacing`: distance between baselines as a multiple of `size`.
- `kerning`: the font's kerning pairs (`AV`, `To`, ...).
- `path`: an `Edge` or `Wire` in the XY plane to set one line of text along.

## Returns
A `Sketch` on `Plane.XY`, one face per separate piece of a letter, counters as holes: `o` is 1
face with 1 hole, `B` and `8` have 2 holes, `i` is 2 faces, `%` is 3 faces, `®` is 2 faces
with a hole each. Straight segments are `line` edges; every smooth curved run is one exact
`bspline` edge through the font's points, so `O` has 2 edges and extrudes to 4 faces.
`Text("SMLIB 42", 8)`: 7 faces, 78 edges, area 118.7013, bbox x -23.52..23.29, y -4.09..4.09.

## Size and alignment
| `align` | `Text("Hg", 10)` bbox |
|---|---|
| `CENTER` (default) | x -7.63..8.62, y -7.55..5.00: the caps span -5..5, `g` hangs below |
| `MIN` | x 1.21..17.46, y -2.55..10.00: the text starts at x = 0, baseline on y = 0 |
| `MAX` | x -16.47..-0.22, y -12.55..0.00: ends at x = 0, cap height on y = 0 |
| `(Align.MIN, Align.CENTER)` | x from 1.21, y -7.55..5.00 |
| `None` | like `MIN` for one line; several lines: the first baseline on y = 0 |

- Letters do not fill their box: the ink starts after the left side bearing (x 1.21 above),
  round letters overshoot the cap height (`O` at size 10: y -0.10..10.11), descenders go below
  the baseline (`g`: -2.55), accents above (`Ä`: 12.41).
- Two labels with `align=Align.MIN` share a baseline whatever their letters; centering on the
  bbox would not.
- Lines: `Text("H\nH", 10, line_spacing=1.6, align=Align.MIN)` spans y 0..26 (baselines 16
  apart). Each line is aligned left, centered or right by the x part of `align`.

## Spacing and kerning
- `kerning=False` puts `AV` 0.949 wider at size 10 (136 font units × 10 / 1433).
- `spacing=s` moves each next letter by `s`: `ABC` ends at 27.516, 28.516 with 0.5, 31.516 with 2.
- Letters that overlap (`spacing=-6`) are united into one face.

## Along a path
Each letter is placed upright on the path at the arc length of the middle of its advance and
turned with the tangent; letters are not bent, so the area stays that of the straight text.
The text reads in the direction of the path and stands on its **left** side:
- over the top of a circle: a clockwise arc, `CenterArc((0, 0), 30, 170, -160)`;
- along the bottom, readable from below: a counterclockwise arc `CenterArc((0, 0), 30, 200, 140)`
  with `align=(Align.CENTER, Align.MAX)` (cap height on the arc, letters outside the circle).

`align` along the path: `MIN` at its start, `CENTER` in the middle, `MAX` at its end; across it:
`MIN` baseline on the path, `CENTER` the middle of the capitals (an `H` of size 4 on the top of
a circle of radius 30: y 28..32), `MAX` the cap height.

## On parts
`Text(...).on(face)` puts the text on a planar face (its center, its frame);
`.extrude(+h)` added embosses, `.extrude(-d)` subtracted engraves. The volume changes by
`area × h` exactly. On a vertical face the letters stand upright (local Y is world Z).

Curved faces have no plane (`ValueError: a cylinder face has no plane`). For a uniform depth on a
cylinder, cut the text prism together with a skin of the wall:
`can - (Text(...).on(tangent_plane).extrude(-r) & (can - Cylinder(r - depth, h + 2)))`. A plain
`extrude(-depth)` from a tangent plane only reaches the wall near the line where they touch.

## Gotchas
- `size` is the cap height, not the em size and not the height of the bbox.
- Characters the font lacks raise; there is no fallback font. No shaping: no ligatures, no
  right-to-left scripts, no combining accents (use the precomposed `é`).
- Tabs and other control characters raise; only `"\n"` (and `"\r\n"`) is understood.
- A space-only text has nothing to draw and raises.
- Text with hundreds of letters is fast (224 characters: 0.09 s), but every letter adds faces
  to a part: keep embossing to the text you need.
- `area` is the area of the exact outlines (to rounding, 1e-15): the integration is exact for
  the polynomial curves of a font. `text.extrude(1).volume` is the same number.

## Errors
- `ValueError: Text: the font Lato Regular has no glyph for 'ж' (U+0436); pass font= with a font that has it`.
- `ValueError: Text: size must be a positive number (the height of capital letters in mm), got 0`.
- `ValueError: Text: nothing to draw: the text is empty or only spaces`.
- `ValueError: Text: control characters cannot be drawn: U+0009`.
- `ValueError: Text: .../README.md: not a TrueType or OpenType font`; `FileNotFoundError: no font file '...'`.
- `ValueError: Text: .../font.woff2: a damaged WOFF2 file (the compressed data runs past the end of the file)` (a cut-off download).
- `ValueError: Text: the text is 98.7969 mm long but the path only 7.85398 mm; use a smaller size or a longer path`.
- `ValueError: Text: the path must lie in the XY plane; draw it there and place the text with .on()`.
- `ValueError: Text: a text along a path has one line; leave out the line breaks`.

## Example
```python
plate = Box(70, 24, 5)
label = Text("SMLIB 42", 8)
embossed = plate + label.on(plate.faces().top()).extrude(0.8)   # raised 0.8
engraved = plate - label.on(plate.faces().top()).extrude(-0.5)  # cut 0.5 deep
print(round(embossed.volume - plate.volume, 4), round(plate.volume - engraved.volume, 4))  # 94.9612 59.3506

two_lines = Text("SMLIB\nNURBS", 5, align=Align.MIN)            # last baseline on y = 0
ring = Text("TEXT ON AN ARC", 4, path=CenterArc((0, 0), 30, 170, -160))
print(len(ring.faces()), round(ring.area, 2))                   # 11 51.57
```

## Related
`Sketch.extrude`, `on` (geometry), `Plane`, `CenterArc`, `Spline` (paths), `export_dxf`
(files), `generic` (this folder), `recipes/modeling` (engraving and embossing).
