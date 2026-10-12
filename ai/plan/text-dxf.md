# Design: text and DXF

Two ways to get exact 2D outlines into smlibpy and out of it: lettering from fonts, and DXF
drawings. Both produce a `Sketch`, so everything a sketch does (place with `.on()`, combine,
extrude, revolve) works on them unchanged.

## API

```python
Text(text, size, *, font=None, align=Align.CENTER, spacing=0.0, line_spacing=1.6,
     kerning=True, path=None) -> Sketch

import_dxf(path, *, layers=None, unit=None, tolerance=None) -> Sketch
import_dxf_wires(path, *, layers=None, unit=None, tolerance=None) -> ShapeList[Wire]
export_dxf(shapes, path, *, unit="mm", plane=None) -> None
```

`load("x.dxf")` calls `import_dxf`, `export(shapes, "x.dxf")` and `shape.export("x.dxf")` call
`export_dxf`. The MCP `save` tool takes `format="dxf"`.

## Text

### Size is the cap height

`size` is the height of the capital letters (H, E, T), the nominal height of technical
lettering. `Text("H", 10)` is exactly 10 mm tall, whatever the font. The em size would make the
same `size` give different letter heights in different fonts, and nobody can measure an em on a
part. Round letters overshoot the cap height by a few percent and descenders go below the
baseline, as in every font. The cap height comes from the font's `OS/2` table, or from the
height of its `H` when the table is too old to have it.

### Alignment by the lines, not by the ink

`align` takes the same `Align` values as every other constructor, per axis or for both, but it
aligns the *layout box* of the text: from the start to the end of the longest line (the advance
widths) and from the baseline of the last line to the cap height of the first. So:

- `Align.CENTER` (default): centered on the origin; one line has its baseline at `-size / 2`.
- `Align.MIN`: the text starts at x = 0 and the last line stands on y = 0.
- `Align.MAX`: the text ends at x = 0 and the cap height of the first line is at y = 0.

Aligning the ink instead would move a line up when it has no descender and left when it starts
with a round letter; two labels next to each other would not share a baseline. Lines of a block
are aligned with the same horizontal value (left, centered, right).

### Spacing

- `spacing` adds that many millimeters between neighbouring letters (negative brings them
  closer).
- `line_spacing` is the distance between baselines as a multiple of `size`. 1.6 suits the
  bundled font and the usual proportions of technical lettering.
- `kerning` applies the font's kerning pairs (`GPOS` pair adjustment when the font has it,
  otherwise the `kern` table, as text engines do).

### Exact outlines, few edges

TrueType outlines are quadratic Béziers and CFF outlines cubic ones; both are polynomial curves,
so the sketch can hold them exactly. smlibpy does not write one edge per Bézier segment: where
an outline runs on smoothly (the tangent continues across an on-curve point), consecutive
segments are joined into one B-spline. The knot spacing is chosen so that the B-spline passes
through every on-curve point of the font, which makes it the same curve, not an approximation:

- quadratic run `P0, Q1, P1, Q2, P2, ...` with on-curve points `Pi` between off-curve points
  `Qi` and `Qi+1`: degree-2 B-spline with control points `P0, Q1, Q2, ..., Pn` and knot spans
  `d` such that `Pi = (d(i+1) Qi + d(i) Qi+1) / (d(i) + d(i+1))`; the usual implied on-curve
  midpoints of TrueType give equal spans.
- cubic run: degree 3, double inner knots, the same relation for the two control points
  around each joint.

Edges break only at corners and at straight segments, which stay lines. An `O` is two closed
edges, so `Text("O", 10).extrude(1)` has 4 faces and engraving it cuts two smooth walls.

### Holes and fill rules

Font outlines are filled by the nonzero winding rule. For each glyph:

1. Contours that do not cross: build the nesting tree, give each region its winding number,
   keep a contour only where filled changes to empty or back. The kernel builds the faces with
   their holes from the kept contours (`create_planar_faces`). The counters of o, B, 8, the dot
   of i and the island in ® come out right; a contour nested in another one of the same turning
   sense (redundant under nonzero) is dropped instead of becoming a hole.
2. Contours that cross (overlapping components, common in fonts built from variable masters):
   each outer contour with the holes inside it is a region, and the glyph is their union (2D
   Booleans). That is the nonzero result as long as a hole does not cross its own outline.

Glyphs whose regions overlap each other (negative spacing, text on a tight curve) are united;
the others are only collected into one sketch.

### Fonts

- Bundled: Lato Regular 1.105 by Łukasz Dziedzic, SIL Open Font License 1.1, 96 KB, 263
  characters (Latin-1, Polish, €, ±, °, µ, Ø, ≤, ≥, ≈, ≠, ∞, Ω, π), a `kern` table and `GPOS`
  kerning, TrueType outlines. Shipped unmodified (the name Lato is reserved for the original) in
  `src/smlibpy/fonts/` with its license; the wheel picks it up with the package.
- `font=` takes the path of a TTF, OTF, TTC (first font) or WOFF file.
- The reader is our own, without dependencies: sfnt and WOFF containers, `cmap` (formats 0, 4,
  6, 12, 13), `head`, `hhea`, `hmtx`, `maxp`, `OS/2`, `loca`, `glyf` (simple and composite
  glyphs with all transform forms and point matching), `CFF ` (Type 2 charstrings with
  subroutines, flex, hint masks, CID-keyed fonts, `seac` accents), `kern` (format 0, Microsoft
  and Apple headers) and `GPOS` pair adjustment (formats 1 and 2, extension lookups).
- fontTools is used, when it is installed, only for what the reader does not do (WOFF2,
  variable CFF2 outlines).
- No shaping: one character is one glyph. No ligatures, right-to-left scripts or combining
  marks; a character the font lacks raises `ValueError` naming it.

### Text along a curve

`path=` (an edge or wire in the XY plane) puts one line of text on a curve: each glyph is
placed rigidly, upright on the curve at the arc length of the middle of its advance and turned
with the tangent. Glyphs are not bent, so they keep their exact outlines and areas. The text
reads in the direction of the path and stands on its left side; `align` places it along the
path (MIN at the start, CENTER in the middle, MAX at the end) and across it (MIN: baseline on
the curve, CENTER: middle of the cap height, MAX: cap height on the curve). Text longer than
the path raises `ValueError`.

### Examples

```python
label = Text("SMLIB 01", 6)                                    # 6 mm capitals, centered
plate = Box(60, 20, 4)
embossed = plate + label.on(plate.faces().top()).extrude(0.8)  # raised letters
engraved = plate - label.on(plate.faces().top()).extrude(-0.5) # cut into the top

two_lines = Text("SMLIB\nNURBS", 5, align=Align.MIN)           # last baseline on y = 0
wide = Text("A B C", 5, spacing=1.0)
own = Text("Hello", 5, font="/path/to/font.otf")
ring = Text("ABOVE THE CIRCLE", 4, path=CenterArc((0, 0), 30, 170, -160))
```

## DXF

### Reading

`import_dxf` reads the model space of an ASCII DXF (R12 to current versions):

| Entity | Becomes |
|---|---|
| LINE | line |
| ARC, CIRCLE | circular arc, circle (exact, in their object coordinate system) |
| LWPOLYLINE, POLYLINE (2D) | lines, and exact arcs where a vertex has a bulge |
| SPLINE | the NURBS of its control points, knots and weights (periodic ones clamped exactly); a spline with fit points only is interpolated |
| ELLIPSE | elliptical arc or ellipse |
| INSERT (and arrays of it) | the block's entities, moved, scaled, mirrored, rotated; nested blocks too |

Everything else (text, hatches, dimensions, points, meshes) is skipped with one warning that
counts what was left out. `$INSUNITS` sets the unit; inches, feet, meters and the others are
converted to millimeters, and a unitless file is read as millimeters. `unit=` overrides the file.

The curves are joined end to end into loops (ends within `tolerance` of each other, by default
1e-7 of the drawing size). Loops become regions by nesting with the even-odd rule: a loop in a
loop is a hole, a loop in a hole an island. Line and spline ends are moved onto the exact ends
of arcs where they meet, so the kernel sees closed loops without changing an arc.

Curves that do not close raise `ModelingError` with the open ends and their layers, and the
hint to pick the outline's layers (`layers=`), raise `tolerance` for small gaps, or use
`import_dxf_wires`. That function returns every chain as a `Wire`, open or closed, so a drawing
can also deliver sweep paths and construction lines.

### Writing

`export_dxf` writes an AutoCAD 2000 (AC1015) DXF, the oldest version with splines and ellipses
that every reader understands. Sketches (their outlines and holes), faces, wires and edges are
written with exact entities: LINE, ARC, CIRCLE, ELLIPSE and SPLINE (with weights when
rational). A section's edges are rational B-splines; the writer recognizes the circular ones
(a degree-2 span is a conic, so five points on a circle prove it is that circle), joins
consecutive arcs of one circle and writes ARC and CIRCLE, and straight B-splines as LINE.

The drawing plane: shapes lying in the world XY plane are written with their X and Y; a sketch
in another plane (a section in `Plane.XZ`) is written in its own plane's coordinates; `plane=`
chooses it explicitly. Shapes that are not parallel to the drawing plane raise `ValueError`.
`unit=` converts like in `export_step` and sets `$INSUNITS`. A shape's name becomes its layer.

### Examples

```python
outline = import_dxf("bracket.dxf")                  # a Sketch in mm
bracket = outline.extrude(6)
only_cut = import_dxf("panel.dxf", layers=["CUT"])
paths = import_dxf_wires("paths.dxf")                # every chain, open or closed

part = Box(40, 30, 20) - Cylinder(8, 30)
export_dxf(part.section(Plane.XY), "section.dxf")    # 4 LINE + 1 CIRCLE
export_dxf(part.section(Plane.XZ), "side.dxf")       # in the XZ plane's coordinates
export_dxf(Text("A1", 5).named("engrave"), "a1.dxf", unit="inch")
```

## Modules

- `smlibpy/font.py`: the font reader (no kernel calls).
- `smlibpy/text.py`: `Text`: layout, glyph outlines to exact curves.
- `smlibpy/regions.py`: closed loops to a sketch under a fill rule (shared by text and DXF).
- `smlibpy/dxf.py`: `import_dxf`, `import_dxf_wires`, `export_dxf`.
- `smlibpy/fonts/`: `Lato-Regular.ttf` and `OFL.txt`.

## Checks

- Glyph areas and counts of pieces and holes against the font's own outlines (exact areas
  from the Bézier segments; fontTools as an independent reader where it is installed).
- Advance widths and kerning against the `hmtx`, `kern` and `GPOS` values.
- Emboss and engrave: the volume changes by area × depth.
- DXF: hand-written files for every entity, units, bulges, OCS, blocks, nesting, open curves;
  round trips with exact radii and areas; ezdxf as an independent reader where installed.
- MCP: a text embossing script through `Session`; `save(format="dxf")`.
