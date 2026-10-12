diff --git a/src/smlibpy/skill/references/sketches/Text.md b/src/smlibpy/skill/references/sketches/Text.md
new file mode 100644
index 0000000..e7ce058
--- /dev/null
+++ b/src/smlibpy/skill/references/sketches/Text.md
@@ -0,0 +1,108 @@
+# Text
+
+Lettering as a `Sketch` with the exact outlines of a font: for labels, serial numbers and logos
+that are engraved into a part or stand out of it.
+
+## Signature
+`Text(text, size, *, font=None, align=Align.CENTER, spacing=0.0, line_spacing=1.6, kerning=True, path=None)`
+
+- `text`: a string; `"\n"` starts a new line.
+- `size`: the height of the capital letters in mm (the nominal height of technical lettering):
+  `Text("H", 10)` is exactly 10 tall. Not the font's em size (13.96 mm at size 10 for the
+  default font).
+- `font`: path of a `.ttf`, `.otf`, `.ttc` (its first font) or `.woff` file. Default: Lato
+  Regular, bundled (263 characters: Latin-1, Polish, `€ ± ° µ Ø ≤ ≥ ≈ ≠ ∞ Ω π`).
+- `align`: where the *layout box* sits: from the start to the end of the longest line (advance
+  widths, not ink) and from the baseline of the last line to the cap height of the first.
+  One `Align` (or string) for x and y, or one per axis.
+- `spacing`: extra mm between neighbouring letters (negative: closer).
+- `line_spacing`: distance between baselines as a multiple of `size`.
+- `kerning`: the font's kerning pairs (`AV`, `To`, ...).
+- `path`: an `Edge` or `Wire` in the XY plane to set one line of text along.
+
+## Returns
+A `Sketch` on `Plane.XY`, one face per separate piece of a letter, counters as holes: `o` is 1
+face with 1 hole, `B` and `8` have 2 holes, `i` is 2 faces, `%` is 3 faces, `®` is 2 faces
+with a hole each. Straight segments are `line` edges; every smooth curved run is one exact
+`bspline` edge through the font's points, so `O` has 2 edges and extrudes to 4 faces.
+`Text("SMLIB 42", 8)`: 7 faces, 78 edges, area 118.7013, bbox x -23.52..23.29, y -4.09..4.09.
+
+## Size and alignment
+| `align` | `Text("Hg", 10)` bbox |
+|---|---|
+| `CENTER` (default) | x -7.63..8.62, y -7.55..5.00: the caps span -5..5, `g` hangs below |
+| `MIN` | x 1.21..17.46, y -2.55..10.00: the text starts at x = 0, baseline on y = 0 |
+| `MAX` | x -16.47..-0.22, y -12.55..0.00: ends at x = 0, cap height on y = 0 |
+| `(Align.MIN, Align.CENTER)` | x from 1.21, y -7.55..5.00 |
+| `None` | like `MIN` for one line; several lines: the first baseline on y = 0 |
+
+- Letters do not fill their box: the ink starts after the left side bearing (x 1.21 above),
+  round letters overshoot the cap height (`O` at size 10: y -0.10..10.11), descenders go below
+  the baseline (`g`: -2.55), accents above (`Ä`: 12.41).
+- Two labels with `align=Align.MIN` share a baseline whatever their letters; centering on the
+  bbox would not.
+- Lines: `Text("H\nH", 10, line_spacing=1.6, align=Align.MIN)` spans y 0..26 (baselines 16
+  apart). Each line is aligned left, centered or right by the x part of `align`.
+
+## Spacing and kerning
+- `kerning=False` puts `AV` 0.949 wider at size 10 (136 font units × 10 / 1433).
+- `spacing=s` moves each next letter by `s`: `ABC` ends at 27.516, 28.516 with 0.5, 31.516 with 2.
+- Letters that overlap (`spacing=-6`) are united into one face.
+
+## Along a path
+Each letter is placed upright on the path at the arc length of the middle of its advance and
+turned with the tangent; letters are not bent, so the area stays that of the straight text.
+The text reads in the direction of the path and stands on its **left** side:
+- over the top of a circle: a clockwise arc, `CenterArc((0, 0), 30, 170, -160)`;
+- along the bottom, readable from below: a counterclockwise arc `CenterArc((0, 0), 30, 200, 140)`
+  with `align=(Align.CENTER, Align.MAX)` (cap height on the arc, letters outside the circle).
+
+`align` along the path: `MIN` at its start, `CENTER` in the middle, `MAX` at its end; across it:
+`MIN` baseline on the path, `CENTER` the middle of the capitals (an `H` of size 4 on the top of
+a circle of radius 30: y 28..32), `MAX` the cap height.
+
+## On parts
+`Text(...).on(face)` puts the text on a planar face (its center, its frame);
+`.extrude(+h)` added embosses, `.extrude(-d)` subtracted engraves. The volume changes by
+`area × h` exactly. On a vertical face the letters stand upright (local Y is world Z).
+
+Curved faces have no plane (`ValueError: a cylinder face has no plane`). For a uniform depth on a
+cylinder, cut the text prism together with a skin of the wall:
+`can - (Text(...).on(tangent_plane).extrude(-r) & (can - Cylinder(r - depth, h + 2)))`. A plain
+`extrude(-depth)` from a tangent plane only reaches the wall near the line where they touch.
+
+## Gotchas
+- `size` is the cap height, not the em size and not the height of the bbox.
+- Characters the font lacks raise; there is no fallback font. No shaping: no ligatures, no
+  right-to-left scripts, no combining accents (use the precomposed `é`).
+- Tabs and other control characters raise; only `"\n"` (and `"\r\n"`) is understood.
+- A space-only text has nothing to draw and raises.
+- Text with hundreds of letters is fast (224 characters: 0.09 s), but every letter adds faces
+  to a part: keep embossing to the text you need.
+
+## Errors
+- `ValueError: Text: the font Lato Regular has no glyph for 'ж' (U+0436); pass font= with a font that has it`.
+- `ValueError: Text: size must be a positive number (the height of capital letters in mm), got 0`.
+- `ValueError: Text: nothing to draw: the text is empty or only spaces`.
+- `ValueError: Text: control characters cannot be drawn: U+0009`.
+- `ValueError: Text: .../README.md: not a TrueType or OpenType font`; `FileNotFoundError: no font file '...'`.
+- `ValueError: Text: the text is 98.7969 mm long but the path only 7.85398 mm; use a smaller size or a longer path`.
+- `ValueError: Text: the path must lie in the XY plane; draw it there and place the text with .on()`.
+- `ValueError: Text: a text along a path has one line; leave out the line breaks`.
+
+## Example
+```python
+plate = Box(70, 24, 5)
+label = Text("SMLIB 42", 8)
+embossed = plate + label.on(plate.faces().top()).extrude(0.8)   # raised 0.8
+engraved = plate - label.on(plate.faces().top()).extrude(-0.5)  # cut 0.5 deep
+print(round(embossed.volume - plate.volume, 4), round(plate.volume - engraved.volume, 4))  # 94.9612 59.3506
+
+two_lines = Text("SMLIB\nNURBS", 5, align=Align.MIN)            # last baseline on y = 0
+ring = Text("TEXT ON AN ARC", 4, path=CenterArc((0, 0), 30, 170, -160))
+print(len(ring.faces()), round(ring.area, 2))                   # 11 51.57
+```
+
+## Related
+`Sketch.extrude`, `on` (geometry), `Plane`, `CenterArc`, `Spline` (paths), `export_dxf`
+(files), `generic` (this folder), `recipes/modeling` (engraving and embossing).
diff --git a/src/smlibpy/skill/references/sketches/generic.md b/src/smlibpy/skill/references/sketches/generic.md
index b2691a3..08e1d7a 100644
--- a/src/smlibpy/skill/references/sketches/generic.md
+++ b/src/smlibpy/skill/references/sketches/generic.md
@@ -10,6 +10,9 @@ It is the profile you extrude, revolve, sweep or loft. `Sketch` is a subclass of
 - From curves: `make_face(outer_wire, *hole_wires)`, `wire.to_sketch()`.
 - From a part: `face.to_sketch()` (copy of a planar face, holes kept, normal pointing out of the
   part), `part.section(plane)`.
+- Lettering: `Text("SMLIB 42", 8)`, the exact outlines of a font, `size` = cap height. See `Text`.
+- From a drawing: `import_dxf(path)` (files): the closed outlines of a DXF as a sketch in mm, at
+  the drawing's coordinates.
 
 ## Measuring
 
@@ -104,5 +107,6 @@ grown = box + box.faces().facing(X).one().to_sketch().extrude(5)   # bbox x up t
 
 ## Related
 
-`Rectangle`, `Circle`, `Polygon`, `make_face`, `offset`, `fillet` (this folder);
+`Rectangle`, `Circle`, `Polygon`, `make_face`, `offset`, `fillet`, `Text` (this folder); `import_dxf`,
+`export_dxf` (files);
 `Sketch.extrude`, `revolve`, `sweep`, `loft` (features); `Plane`, `Location`, patterns (geometry).
diff --git a/src/smlibpy/skill/recipes/modeling.md b/src/smlibpy/skill/recipes/modeling.md
index a9822a8..e514f1e 100644
--- a/src/smlibpy/skill/recipes/modeling.md
+++ b/src/smlibpy/skill/recipes/modeling.md
@@ -55,3 +55,41 @@ face along it. For springs and threads use `Helix` as the path.
 `GridLocations`, `PolarLocations` and `Locations` multiply with a shape to make copies:
 `PolarLocations(30, 6) * Cylinder(3, 20)` makes six cylinders on a circle of radius 30. Cut or
 fuse the resulting list.
+
+## Text: engraving and embossing
+
+`Text` is a sketch: place it on a face, extrude it, subtract (engrave) or add (emboss). Do it
+last, after fillets and shells: the letters add many faces.
+
+```python
+plate = Box(80, 30, 6)
+plate = plate.fillet(plate.edges().parallel_to(Z), 4)
+top = plate.faces().top()
+engraved = plate - Text("SN 0042", 8).on(top).extrude(-0.6)       # 8 mm capitals, 0.6 deep
+base = Box(40, 16, 3)
+badge = base + Text("OK", 10).on(base.faces().top()).extrude(1)    # raised 1 mm
+```
+
+- `size` is the height of the capitals; the volume changes by `text.area * depth` exactly.
+- `.on(face)` centers the text on the face's centroid, which holes move. To place it exactly,
+  use a plane: `Text(...).on(Plane.XY.offset(top_z))` with `Pos(x, y)` or `align=`.
+- On a vertical face the letters stand upright. A curved face has no plane: cut the text prism
+  together with a skin of the wall for an even depth,
+  `can - (Text(...).on(tangent_plane).extrude(-r) & (can - Cylinder(r - depth, h + 2)))`.
+- Around a round part, set the text along an arc: `Text(..., path=CenterArc(c, r, 170, -160))`
+  stands outside the arc (clockwise path: letters on its left side).
+
+## DXF outlines
+
+A profile drawn elsewhere comes in with `import_dxf` and becomes a part like any sketch:
+
+```python
+export_dxf(Slot(40, 12) - Circle(3), "outline.dxf")    # stands for a drawing from elsewhere
+outline = import_dxf("outline.dxf")                     # closed loops, holes nested, in mm
+link = outline.extrude(5)
+```
+
+- Drawings carry construction lines, center lines and text. Read only the outline's layers
+  (`layers=["CUT"]`), and lettering inside an outline separately, or it becomes holes.
+- The way out: `export_dxf(part.section(Plane.XY), "profile.dxf")` for laser cutting, with exact
+  LINE, ARC and CIRCLE entities.
diff --git a/src/smlibpy/skill/SKILL.md b/src/smlibpy/skill/SKILL.md
index 8919067..0743633 100644
--- a/src/smlibpy/skill/SKILL.md
+++ b/src/smlibpy/skill/SKILL.md
@@ -1,6 +1,6 @@
 ---
 name: smlibpy
-description: Model exact 3D CAD parts in Python with smlibpy, the Python library on SMLib (NVIDIA's open-source NURBS solid modeling kernel). Solids, sketches, holes, fillets (also G2), shells, lofts, sweeps, freeform surfaces, measurements, STEP/STL/glTF export and STEP import. Use when building, checking or exporting CAD geometry with smlibpy, directly or through the smlibpy MCP server (tools run_script, snapshot, docs).
+description: Model exact 3D CAD parts in Python with smlibpy, the Python library on SMLib (NVIDIA's open-source NURBS solid modeling kernel). Solids, sketches, text (engraved or embossed lettering), holes, fillets (also G2), shells, lofts, sweeps, freeform surfaces, measurements, STEP/STL/glTF export, STEP import, DXF drawings in and out. Use when building, checking or exporting CAD geometry with smlibpy, directly or through the smlibpy MCP server (tools run_script, snapshot, docs).
 license: MIT
 ---
 
@@ -27,7 +27,7 @@ export_step(plate, "plate.step")
 2. **Build in steps.** One feature or a few per script; in the MCP session variables persist.
 3. **Verify every step** with numbers and a picture: `volume`, `bbox()`, `is_valid()`, face
    counts; `snapshot(view="sheet")`. See `recipes/verification`.
-4. **Deliver** a STEP file (exact), STL or glTF (meshes), and say where it is.
+4. **Deliver** a STEP file (exact), STL or glTF (meshes), DXF for 2D outlines, and say where it is.
 
 ## Conventions
 
@@ -64,12 +64,12 @@ classcad.ch account). A part made here opens in ClassCAD as a solid through STEP
 | geometry | `geometry/*` | Vector, Axis, Plane, Location, Pos, Rot, BoundBox, Align, placement methods, patterns |
 | selection | `selection/*` | ShapeList and its selectors, topology (faces, edges, vertices), Face, Edge, Vertex |
 | parts | `parts/*` | Part, primitives (Box, Cylinder, Cone, Sphere, Torus, Wedge), holes, Booleans |
-| sketches | `sketches/*` | Sketch, 2D shapes (Rectangle, Circle, Polygon, Slot, ...), make_face, 2D offset and fillet |
+| sketches | `sketches/*` | Sketch, 2D shapes (Rectangle, Circle, Polygon, Slot, ...), Text, make_face, 2D offset and fillet |
 | curves | `curves/*` | Line, arcs, Spline, Bezier, Helix, Polyline, Wire |
 | features | `features/*` | extrude, revolve, loft, sweep, fillet, chamfer, shell, offset, mirror, split, section, thicken, draft, heal |
 | surfaces | `surfaces/*` | surface, ruled, stitch, Shell |
 | analysis | `analysis/*` | mass properties, measures, distances, intersections, silhouettes, projections, validity |
-| files | `files/*` | STEP in and out, STL, glTF, OBJ, the native format, render, show, meshes |
+| files | `files/*` | STEP in and out, DXF in and out, STL, glTF, OBJ, the native format, render, show, meshes |
 
 Each domain has a `generic.md` with the concepts; the other docs are named after the API
 (`features/fillet`, `parts/Box`, `selection/filter_by`).
