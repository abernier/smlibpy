diff --git a/src/smlibpy/skill/references/files/import_dxf.md b/src/smlibpy/skill/references/files/import_dxf.md
new file mode 100644
index 0000000..38a6413
--- /dev/null
+++ b/src/smlibpy/skill/references/files/import_dxf.md
@@ -0,0 +1,77 @@
+# import_dxf
+
+Reads the outlines of a DXF drawing as a `Sketch` with exact curves, ready to extrude or
+revolve. `load("x.dxf")` does the same.
+
+## Signature
+`import_dxf(path, *, layers=None, unit=None, tolerance=None)`
+
+- `path`: an ASCII DXF file (R12 to current versions). Binary DXF raises.
+- `layers`: a layer name or a list of them, in any letter case; only their curves are read.
+- `unit`: the drawing's unit (`"mm"`, `"cm"`, `"m"`, `"um"`, `"inch"`, `"in"`, `"ft"`), used
+  instead of the file's `$INSUNITS`. Without it, `$INSUNITS` decides; a file without a unit
+  (no header, or 0) is read as mm.
+- `tolerance`: curve ends closer than this (mm) are joined. Default: 1e-7 of the drawing's size.
+
+## Returns
+A `Sketch` on `Plane.XY` with the drawing's coordinates in mm (not centered). Faces have their
+holes; separate outlines are separate faces.
+
+| Entity | Becomes |
+|---|---|
+| LINE | `line` edge |
+| CIRCLE, ARC | `circle` edge with the exact radius (in its object coordinates; mirrored arcs with extrusion (0, 0, -1) come out right) |
+| ELLIPSE | `ellipse` edge (full or an arc) |
+| LWPOLYLINE, POLYLINE (2D) | lines, and exact arcs where a vertex has a bulge (any angle, also above 180°) |
+| SPLINE | the NURBS of its control points, knots and weights; periodic ones are clamped exactly; one with fit points only is interpolated through them |
+| INSERT | the block's curves, moved, scaled (also unevenly), mirrored, rotated; nested blocks; arrays (MINSERT) |
+
+Everything else (TEXT, MTEXT, HATCH, DIMENSION, POINT, meshes) is left out with one warning:
+`UserWarning: import_dxf: left out what is not a curve: 1 POINT, 1 TEXT`. Paper space is ignored.
+
+## Loops and holes
+- The curves are joined end to end into loops; line and spline ends are moved onto the exact
+  ends of the arcs they meet, so arcs keep their radius.
+- Loops nest by the even-odd rule: a loop inside a loop is a hole, a loop inside a hole an
+  island. Square 40 / circle r 15 / square 10 inside each other: 2 faces (the frame with a hole,
+  the island), area 993.1417 = 1600 - π·225 + 100.
+- Loops that cross follow the same rule: two circles of radius 10, 10 apart, give the two
+  crescents (2 faces, area 382.6446); their overlap is empty.
+- A curve drawn twice is read once.
+
+## Gotchas
+- **Text inside an outline becomes holes.** A tag drawn as an outline (layer `cut`) with
+  lettering (layer `engrave`) read together gives the outline with letter-shaped holes and the
+  counters of the letters as islands (4 faces for `PART 7`). Read the layers one at a time:
+  `outline = import_dxf(p, layers=["cut"])`, `letters = import_dxf(p, layers=["engrave"])`.
+- Construction lines, center lines and dimensions of a drawing are curves too and make the
+  import fail (open or branching). Pick the layers of the outline.
+- A gap larger than the tolerance is an open chain. `tolerance=` closes it by moving both ends
+  halfway: a square with a 0.02 gap read with `tolerance=0.05` has area 99.95, not 100.
+- `$INSUNITS` 21 (US survey feet) is 304.8006096 mm, not 304.8.
+- Splines given only by fit points are interpolated by smlibpy; the drawing program's own curve
+  through those points may differ slightly.
+
+## Errors
+- `ModelingError: import_dxf: 1 chain of curves does not close: 4 curves from (0.02, 10) to (0, 10) on layer 'CUT' (the nearest other loose end is 0.02 mm away). Pick the layers of the outline with layers=[...], join small gaps with tolerance=..., or read every curve with import_dxf_wires()`.
+- `ModelingError: import_dxf: the outline branches (3 curve ends at (10, 10)); a loop needs exactly two curve ends at each corner. ...`.
+- `ValueError: import_dxf: the drawing has no layer 'CUT'; its layers are GRID, PARTS`.
+- `ModelingError: import_dxf: the drawing has no curves (lines, arcs, circles, ellipses, polylines, splines or blocks of them)`.
+- `ValueError: unknown unit 'MM'; use mm, cm, m, um, inch or ft`.
+- `ModelingError: import_dxf: the outlines are not in one plane parallel to XY ...`: a 3D drawing.
+- `FileNotFoundError` for a missing file; `ValueError: ...: a binary DXF; save the drawing as ASCII DXF`.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(8, 30) - Cylinder(3, 30).translate(14, 8, 0)
+export_dxf(part.section(Plane.XY), "section.dxf")      # a drawing to read back
+outline = import_dxf("section.dxf")
+print(outline, [len(f.inner_wires()) for f in outline.faces()])   # Sketch(1 faces, area=970.664) [2]
+print(sorted(round(e.radius, 9) for e in outline.edges() if e.geom_type == "circle"))   # [3.0, 8.0]
+plate = outline.extrude(6)                             # z 0..6
+print(round(plate.volume, 3))                          # 5823.982
+```
+
+## Related
+`import_dxf_wires` (every chain, open ones too), `export_dxf`, `load`, `make_face`,
+`Sketch.extrude` (features), `generic.md`.
diff --git a/src/smlibpy/skill/references/files/import_dxf_wires.md b/src/smlibpy/skill/references/files/import_dxf_wires.md
new file mode 100644
index 0000000..1743970
--- /dev/null
+++ b/src/smlibpy/skill/references/files/import_dxf_wires.md
@@ -0,0 +1,42 @@
+# import_dxf_wires
+
+Reads every chain of curves of a DXF drawing as a `Wire`, open or closed: sweep paths,
+construction lines, outlines that do not close, or the pieces of a drawing that branches.
+
+## Signature
+`import_dxf_wires(path, *, layers=None, unit=None, tolerance=None)`
+
+The parameters are those of `import_dxf`: the same entities are read, the same units and the
+same tolerance join the ends.
+
+## Returns
+A `ShapeList` of `Wire`s: the closed chains first, then the open ones, each in drawing order.
+A chain stops where it ends, and where three or more curve ends meet:
+- a square with one line leaving a corner: `[Wire(4 edges, closed, length=40), Wire(1 edges, open, length=14.1421)]`;
+- a square with a 0.02 gap: `[Wire(4 edges, open, length=39.98)]`.
+
+The edges keep their exact types (`line`, `circle`, `ellipse`, `bspline`) and are turned so that
+each wire runs head to tail.
+
+## Uses
+- Paths: `sweep(Circle(2), import_dxf_wires("path.dxf")[0])`.
+- Finding out why `import_dxf` refuses a drawing: the open wires show where the gaps are
+  (`w.start`, `w.end`).
+- Outlines you want to fix or combine yourself: `make_face(w.close())`.
+
+## Gotchas
+- Wires carry no layer; read one layer at a time with `layers=` when it matters.
+- A full circle, ellipse or closed spline is a closed wire of one edge.
+
+## Example
+```python
+path = Polyline((0, 0), (40, 0), (40, 30))
+export_dxf(path, "path.dxf")
+[w] = import_dxf_wires("path.dxf")
+print(w, w.is_closed)                  # Wire(2 edges, open, length=70) False
+tube = sweep(Circle(2).on(Plane.YZ), w)
+print(tube.is_valid())                 # True
+```
+
+## Related
+`import_dxf`, `export_dxf`, `Wire`, `make_face`, `sweep` (features).
diff --git a/src/smlibpy/skill/references/files/export_dxf.md b/src/smlibpy/skill/references/files/export_dxf.md
new file mode 100644
index 0000000..cb401a9
--- /dev/null
+++ b/src/smlibpy/skill/references/files/export_dxf.md
@@ -0,0 +1,73 @@
+# export_dxf
+
+Writes 2D shapes to a DXF drawing with exact curves: sketches, sections of parts, text, wires
+and edges, for laser cutting, CNC, 2D CAD and drawings. `export(shapes, "x.dxf")` and
+`shape.export("x.dxf")` do the same.
+
+## Signature
+`export_dxf(shapes, path, *, unit="mm", plane=None)`
+
+- `shapes`: a `Sketch`, a planar `Face` or sheet, a `Wire`, an `Edge`, or a list of them.
+- `unit`: `"mm"` (default), `"cm"`, `"m"`, `"um"`, `"inch"` (or `"in"`), `"ft"`. The model (mm) is
+  converted and `$INSUNITS` declared: a 50.8 mm rectangle is 2 wide in an inch file and reads
+  back as 50.8 mm.
+- `plane`: the drawing plane; the shapes are written in its coordinates (x along `x_dir`, y
+  along `y_dir`) and must lie in planes parallel to it.
+
+## Returns
+`None`. An AutoCAD 2000 (AC1015) file with one entity per curve:
+
+| Curve | Entity |
+|---|---|
+| line, straight B-spline | LINE |
+| circular arc, full circle | ARC, CIRCLE (exact center and radius) |
+| ellipse or elliptical arc | ELLIPSE |
+| any other B-spline | SPLINE (control points, knots, weights when rational) |
+
+Sections of parts come from the kernel as rational B-splines; the writer recognizes the
+circular ones (each span of a degree-2 rational spline is a conic, and seven points of a span
+on one circle prove it is that circle), joins the arcs of one circle, and writes ARC and
+CIRCLE: the section of a filleted block with two holes is 4 LINE, 4 ARC, 2 CIRCLE.
+
+A shape's `name` is its layer (`Text(...).named("engrave")` goes to layer `engrave`); unnamed
+shapes go to layer `0`.
+
+## The drawing plane
+| Shapes | Written in |
+|---|---|
+| in the XY plane, or in planes parallel to it | world X and Y (a sketch at z = 7 keeps its x and y) |
+| a sketch in another plane, `plane` not given | that sketch's plane: origin and axes of `sketch.plane` |
+| `plane=` given | that plane's coordinates |
+
+`part.section(Plane.XZ)` is written with x = world X and y = world Z. A sketch moved within
+`Plane.XZ` has its plane origin moved with it: pass `plane=Plane.XZ` to keep world coordinates
+(a 10 × 4 rectangle at x 0..10 is written at 0..10, without `plane` at -5..5).
+
+## Gotchas
+- A `Part` cannot be written: write `part.section(plane)` (a cross-section) or the edges of
+  `part.outline(plane)` (a 2D view; a holed box gives 4 LINE + 1 CIRCLE).
+- Text is written as its outlines (LINE and degree-2 or degree-3 SPLINE), not as DXF text.
+- Shapes in different, non-parallel planes need `plane=` (and then raise, as they are not parallel).
+- Every number is written with full precision: the round trip of a sketch gives the same
+  radii (5.0, 6.0), the same B-spline control points and knots, and the same area.
+
+## Errors
+- `TypeError: export_dxf writes 2D shapes, not a Part; write part.section(plane) for a cross-section or the edges of part.outline(plane) for a view`.
+- `TypeError: export_dxf writes planar faces; this face is curved`; `TypeError: export_dxf cannot write a Mesh`; `TypeError: export_dxf writes curves; a Vertex has none`.
+- `ValueError: export_dxf: the shapes are not parallel to the drawing plane; pass the plane they lie in`.
+- `ValueError: export_dxf: the shapes are neither in planes parallel to XY nor in one sketch's plane; pass plane=...`.
+- `ValueError: unknown unit 'MM'; use mm, cm, m, um, inch or ft`.
+
+## Example
+```python
+part = Box(40, 30, 20) - Cylinder(8, 30)
+export_dxf(part.section(Plane.XY), "section.dxf")                 # 4 LINE, 1 CIRCLE
+export_dxf(part.section(Plane.XZ), "side.dxf")                    # x = X, y = Z
+tag = [RoundedRectangle(40, 12, 2).named("cut"), Text("PART 7", 5).named("engrave")]
+export_dxf(tag, "tag.dxf", unit="inch")                           # two layers, inches
+print(import_dxf("tag.dxf", layers=["cut"]).bbox().size)          # Vector(40, 12, 0)
+```
+
+## Related
+`import_dxf`, `import_dxf_wires`, `Part.section`, `Part.outline`, `Text` (sketches), `export`,
+`generic.md`.
diff --git a/src/smlibpy/skill/references/files/generic.md b/src/smlibpy/skill/references/files/generic.md
index 3b39d6d..728b9a4 100644
--- a/src/smlibpy/skill/references/files/generic.md
+++ b/src/smlibpy/skill/references/files/generic.md
@@ -1,12 +1,13 @@
 # Files: formats and what they keep
 
-smlibpy writes six formats and reads three. Only STEP and `.smb` keep the exact geometry.
-Everything else is a triangle mesh.
+STEP and `.smb` keep the exact 3D geometry, DXF the exact 2D curves of sketches, sections and
+text. The other formats are triangle meshes or pictures.
 
 | Format | Write | Read | Geometry | Bodies | Names | Colors | Units in file |
 |---|---|---|---|---|---|---|---|
 | STEP `.step` `.stp` | `export_step` | `import_step` | exact (analytic + B-spline) | many | yes (solid label) | yes | mm or `unit=` (converted on export), converted to mm on import |
 | SMLib `.smb` | `save` | `load` | exact, binary bit-identical | **one** | no | no | none (mm) |
+| DXF `.dxf` | `export_dxf` | `import_dxf` → `Sketch`, `import_dxf_wires` → `Wire`s | exact 2D curves: LINE, ARC, CIRCLE, ELLIPSE, SPLINE | 2D only, no `Part` | names become layers | no | mm or `unit=` (converted on export), `$INSUNITS` converted to mm on import |
 | STL `.stl` | `export_stl` | `import_stl` → `Mesh` | triangles, float32 | merged into one mesh | no | no | none |
 | glTF `.glb` `.gltf` | `export_glb`, `export_gltf` | no | triangles + edge lines | one node per shape | yes | yes | meters (a root node scales the mm by 0.001) |
 | OBJ `.obj` | `export_obj` | no | triangles, no normals | one object per shape | yes | no | none |
@@ -14,7 +15,7 @@ Everything else is a triangle mesh.
 | HTML | `show` | | an interactive viewer | | | yes | |
 
 `export(shapes, path)` and `shape.export(path)` choose the writer by extension. `load(path)`
-chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`; any other extension raises
+chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`, `.dxf`; any other extension raises
 `ValueError: unknown file type ...`).
 
 ## Which format
@@ -26,6 +27,10 @@ chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`; any other extension r
 - **Show it to people: `.glb`** (colors, names, edges), or `show(..., path=..., open_browser=False)`
   for a page to open.
 - **Check it yourself: `render(..., view="sheet")`**, then read the PNG.
+- **Laser cutting, CNC, 2D CAD, drawings: DXF** with `export_dxf` (a sketch, `part.section(plane)`,
+  text). A part is not 2D: write a section of it.
+- **A 2D outline from someone else: DXF** with `import_dxf`, then `extrude` or `revolve`. Pick the
+  outline's layers with `layers=`.
 
 ## Units
 - All modeling is in mm.
@@ -35,6 +40,8 @@ chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`; any other extension r
 - glTF is defined in meters: `export_glb`/`export_gltf` write the mm positions under a root node
   that scales them by 0.001, so Blender and AR viewers show a 60 mm part as 0.06 m.
 - STL and OBJ have no units; they hold the mm values.
+- DXF: `export_dxf(unit="inch")` converts and declares `$INSUNITS`; `import_dxf` converts the
+  declared unit to mm, reads a file without a unit as mm, and takes `unit=` to override it.
 
 ## Assemblies
 - `export_step([a, b, c], path)` writes one product with several named solids, not an
@@ -44,14 +51,15 @@ chooses the reader (`.step`/`.stp`/`.p21`, `.stl`, `.smb`; any other extension r
   still check foreign assemblies with a picture.
 
 ## Shape kinds
-| Shape | STEP | `.smb` | STL / OBJ / glTF | render, show |
-|---|---|---|---|---|
-| `Part` | solid (a two-solid part becomes two solids) | yes | yes | yes |
-| `Shell`, `Sketch`, `Face` | surface, comes back as `Shell` | comes back as `Shell` | open mesh | yes |
-| `Mesh` | `TypeError` | `AttributeError` | yes | yes |
-| `Edge`, `Wire` | `TypeError: 'Edge' object is not iterable` | same | glTF only (lines) | yes (lines) |
-| `Vertex` | `TypeError: 'float' object is not iterable` | same | glTF only (a point) | render skips it, show draws it |
+| Shape | STEP | `.smb` | STL / OBJ / glTF | DXF | render, show |
+|---|---|---|---|---|---|
+| `Part` | solid (a two-solid part becomes two solids) | yes | yes | `TypeError`: write `part.section(plane)` | yes |
+| `Shell`, `Sketch`, `Face` | surface, comes back as `Shell` | comes back as `Shell` | open mesh | planar ones; comes back as `Sketch` | yes |
+| `Mesh` | `TypeError` | `AttributeError` | yes | `TypeError` | yes |
+| `Edge`, `Wire` | `TypeError: 'Edge' object is not iterable` | same | glTF only (lines) | yes (`import_dxf_wires` reads them back) | yes (lines) |
+| `Vertex` | `TypeError: 'float' object is not iterable` | same | glTF only (a point) | `TypeError` | render skips it, show draws it |
 
 ## Related
 `export.md`, `export_step.md`, `import_step.md`, `save_load.md`, `export_stl.md`,
-`import_stl.md`, `export_glb.md`, `export_obj.md`, `render.md`, `show.md`, `Mesh.md`.
+`import_stl.md`, `export_glb.md`, `export_obj.md`, `export_dxf.md`, `import_dxf.md`,
+`import_dxf_wires.md`, `render.md`, `show.md`, `Mesh.md`.
diff --git a/src/smlibpy/skill/references/files/export.md b/src/smlibpy/skill/references/files/export.md
index 1470fcb..3afdfc5 100644
--- a/src/smlibpy/skill/references/files/export.md
+++ b/src/smlibpy/skill/references/files/export.md
@@ -15,6 +15,7 @@ the format functions.
 | `.gltf` | `export_gltf` | `tolerance`, `angle`, `edges`, `edge_color` |
 | `.obj` | `export_obj` | `tolerance`, `angle` |
 | `.smb` | `save` | `ascii` |
+| `.dxf` | `export_dxf` | `unit`, `plane` |
 
 - `shapes`: one shape or a list (nested lists are flattened). `path`: `str` or `pathlib.Path`.
 - `kwargs` go to the format function unchanged. A keyword argument that the format does not
@@ -25,7 +26,8 @@ the format functions.
 
 ## Gotchas
 - STEP and `.smb` are exact. STL, glTF and OBJ are triangle meshes. Deliver STEP for CAD, and a
-  mesh format for printing or viewing.
+  mesh format for printing or viewing. DXF is exact and 2D: sketches, sections, text, wires and
+  edges; a `Part` raises `TypeError` (write `part.section(plane)`).
 - `.stp` with `unit="inch"` writes the coordinates in inches (converted from mm, see
   `export_step`).
 - `.smb` holds one body. `export([a, b], "x.smb")` raises.
@@ -33,11 +35,11 @@ the format functions.
   for `.smb` it raises `AttributeError`.
 - No extension, or `.iges`, `.3mf` and other formats, raise `ValueError` before anything is
   written.
-- `load` is the reverse for `.step`/`.stp`, `.stl` and `.smb` only. glTF and OBJ cannot be read
-  back.
+- `load` is the reverse for `.step`/`.stp`, `.stl`, `.smb` and `.dxf` (a `Sketch`). glTF and OBJ
+  cannot be read back.
 
 ## Errors
-- `ValueError: unknown file type '.iges'; use .step, .stl, .glb, .gltf, .obj or .smb`.
+- `ValueError: unknown file type '.iges'; use .step, .stl, .glb, .gltf, .obj, .smb or .dxf`.
 - `TypeError: export_step() got an unexpected keyword argument 'tolerance'`: a mesh keyword
   argument used on an exact format, or the other way round.
 
@@ -50,4 +52,4 @@ print(type(load("bracket.step")).__name__, type(load("bracket.stl")).__name__)
 ```
 
 ## Related
-`export_step`, `export_stl`, `export_glb`, `export_obj`, `save_load.md`, `generic.md`.
+`export_step`, `export_stl`, `export_glb`, `export_obj`, `export_dxf`, `save_load.md`, `generic.md`.
diff --git a/src/smlibpy/skill/references/files/save_load.md b/src/smlibpy/skill/references/files/save_load.md
index bd884df..db5636c 100644
--- a/src/smlibpy/skill/references/files/save_load.md
+++ b/src/smlibpy/skill/references/files/save_load.md
@@ -1,6 +1,6 @@
 # save / load
 
-`save` writes one body to SMLib's native `.smb` format. `load` reads `.smb`, STEP and STL,
+`save` writes one body to SMLib's native `.smb` format. `load` reads `.smb`, STEP, STL and DXF,
 and picks the format from the extension.
 
 ## Signatures
@@ -14,7 +14,8 @@ and picks the format from the extension.
 - `load` decides by the extension, in any letter case:
   - `.step`, `.stp`, `.p21`: same as `import_step`.
   - `.stl`: same as `import_stl`, gives a `Mesh`.
-  - anything else: read as `.smb`.
+  - `.dxf`: same as `import_dxf`, gives a `Sketch`.
+  - `.smb`: the native format; any other extension raises `ValueError`.
 
 ## Returns
 `load` of an `.smb` gives a `Part`. A body that does not enclose a volume (a sketch, face or
@@ -35,14 +36,14 @@ Use `.smb` to cache an intermediate result between scripts. Use STEP to deliver
   again with `.named()` and `.colored()`.
 - A list of two parts raises. Fuse them, or save each to its own file.
 - smlibpy cannot read glTF or OBJ: `load("x.glb")` raises `ValueError: unknown file type
-  '.glb'; load reads .step, .stp, .stl and .smb`.
+  '.glb'; load reads .step, .stp, .stl, .smb and .dxf`.
 - A `Sketch` comes back as a `Shell`: its plane is lost.
 
 ## Errors
 - `ValueError: an .smb file holds one body; fuse the parts or save them separately`.
 - `AttributeError: 'Mesh' object has no attribute '_brep'`: you passed a mesh to `save`.
 - `FileNotFoundError` for a missing file.
-- `ValueError: unknown file type '.glb'; load reads .step, .stp, .stl and .smb`.
+- `ValueError: unknown file type '.glb'; load reads .step, .stp, .stl, .smb and .dxf`.
 - `KernelError: load failed`: an `.smb` file the native reader cannot read.
 
 ## Example
diff --git a/plugins/smlibpy/skills/smlibpy/SKILL.md b/plugins/smlibpy/skills/smlibpy/SKILL.md
index 129bf7c..b31bc94 100644
--- a/plugins/smlibpy/skills/smlibpy/SKILL.md
+++ b/plugins/smlibpy/skills/smlibpy/SKILL.md
@@ -1,6 +1,6 @@
 ---
 name: smlibpy
-description: Build, check and export exact 3D CAD parts (mechanical parts, brackets, enclosures, flanges, gears, bottles, springs, freeform shells) by writing Python with smlibpy through the smlibpy MCP tools. Also for reading STEP files and measuring parts. Use when the user wants a 3D model made, measured or exported as a file. For models that must stay editable and regenerate (constrained sketches, feature history, expressions, assemblies, apps built on buerli or Buerligons), use the ClassCAD MCP instead.
+description: Build, check and export exact 3D CAD parts (mechanical parts, brackets, enclosures, flanges, gears, bottles, springs, freeform shells) by writing Python with smlibpy through the smlibpy MCP tools. Also for reading STEP files, lettering (engraved or embossed text), DXF drawings in and out, and measuring parts. Use when the user wants a 3D model made, measured or exported as a file. For models that must stay editable and regenerate (constrained sketches, feature history, expressions, assemblies, apps built on buerli or Buerligons), use the ClassCAD MCP instead.
 ---
 
 # smlibpy CAD
@@ -14,8 +14,8 @@ shows them in a live 3D viewer.
    variables stay between calls.
 3. After every step check the numbers the script prints (volume, bbox, `is_valid()`) and look
    with `snapshot(view="sheet")`. Fix before going on. `checkpoint()` before risky steps.
-4. Deliver with `save(format="step", path=...)` (or stl, glb) and tell the user where the file
-   is. Send them a snapshot when a picture helps.
+4. Deliver with `save(format="step", path=...)` (or stl, glb; dxf for 2D outlines and sections)
+   and tell the user where the file is. Send them a snapshot when a picture helps.
 
 The first script that makes a model returns a viewer link; open it once as the server's
 instructions say. Units are millimeters, Z is up.
