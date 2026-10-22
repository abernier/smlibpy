# Defects and surprises: files

## HIGH

### 1. `import_step`: assembly parts placed at the inverse of their placement (AS1 from AutoCAD)
- **Fixed:** step_reader._item_transform takes the CAx-IF reading whenever both item lists allow it; AS1 from AutoCAD (and the AS1/DM1 files from OpenCASCADE) assemble right, the rest of the corpus is unchanged.
- **Session:** `2026-10-12_21-26-31_files-exact`, scripts `06-step-foreign-assembly.py`, `07-step-as1-placement-check.py`
- **What happens:** `import_step("../models/as1_ac_214.stp")` (the CAx-IF AS1 assembly written by
  AutoCAD 2000) returns all 18 parts, valid, with names and colors, but scattered: the bolts sit
  18 mm from their nuts, the rod 500 mm from the brackets. No error, no warning.
  `step_reader._item_transform` decides which item of an `ITEM_DEFINED_TRANSFORMATION` belongs to
  the parent with `if i1 in items[parent] or i2 in items[child]`. In this file the identity
  placement `#61` is listed in both representations (`SR1` root and `SR2` plate), so the test is
  true and the CAx-IF reading (item 1 in the child, item 2 in the parent) is swapped: every
  placement is inverted (plate at -90,-75,-10 instead of +90,75,10).
- **Expected:** the assembled AS1 (plate, two brackets, rod through them, bolts in nuts).
- **Reproduce:**
  ```python
  asm = import_step("/Users/dev/dev/awv/models/as1_ac_214.stp")
  bolts = [p for p in asm if p.name == "870"]; nuts = [p for p in asm if p.name == "79A"]
  print(min(bolts[0].distance_to(n) for n in nuts))   # 18.0, expected 0.0
  ```
  Script 07 monkeypatches `_item_transform` to prefer the CAx-IF reading when it is consistent
  (`i2 in items[parent] and i1 in items[child]`): all six bolts then touch a nut (distance 0.0),
  the rod touches both brackets, and the picture shows the assembled AS1
  (`files/07-step-as1-placement-check-patched.png`).
- **Workaround:** none in the API. Check foreign assemblies with a picture before using them.

### 2. `Mesh` Booleans (`+`, `-`, `&`): wrong, open results without error
- **Fixed:** mesh Booleans check the result (closed, volume the operation can give) and raise ModelingError pointing to the exact Boolean.
- **Session:** `2026-10-12_21-32-28_files-mesh`, scripts `05`, `06`, `07`, `08-mesh-boolean-cases.py`
- **What happens:** `Box(20,20,20).mesh() - Sphere(12).mesh()` has volume 4376.95 (exact
  Boolean then mesh: 1630.9; exact 1616.3), 336 open edges, and the box faces stay whole
  (2 triangles of 400 mm² each instead of 261.8 mm² with a hole). The union is +31 %. In 9 cases x
  3 operations, the results are right only where no face of the result gets a hole: box - box
  offset is exact, sphere - box is -0.5 %. Box - cylinder through: +2.6 %, 64 open edges. Off-diagonal
  cylinder: volume -749 (negative). Box - small box within one face triangle: volume 0 (exact 7968),
  and `&` gives 7947 (exact 32). The rendered picture of box - sphere is a plain box
  (`files/06-diff.png`).
- **Expected:** the mesh of the Boolean, or an error.
- **Reproduce:**
  ```python
  a, b = Box(20, 20, 20).mesh(), Sphere(12).mesh()
  print((a - b).volume, (Box(20, 20, 20) - Sphere(12)).volume)   # 4376.95 vs 1616.28
  ```
- **Workaround:** do the Boolean on the exact parts, then `mesh()`.

## MEDIUM

### 19. `import_dxf`: the kernel nests loops wrongly, and differently in the WebAssembly build
- **Found:** by the JavaScript port (2026-10-13), the one of 99 local DXF files whose import differs.
- **What happens:** `create_planar_faces` gets the same 10 B-spline loops (polygons equal to 1e-13) and nests
  them differently: native 3 faces (holes 0, 0, 7), area 56008.26; WebAssembly 2 faces (holes 0, 8), area
  55817.34. The even-odd answer from the polygons is 1 face with 9 holes, about 55732.3: both are wrong.
- **Reproduce:** `import_dxf("../classcad/data/Test/Input/BugReporting/CAD-3602/yon002k7.dxf")` (plan
  "faces", all 10 loops kept).
- **Expected:** the nesting smlibpy's plan already knows (see 18: a kernel entry point that takes the loops of
  a face would fix both).

### 20. DXF: fit-point tangents lost their y and z; a byte order mark was "not a DXF file"
- **Fixed:** `_spline_curve` reads codes 22/32 and 23/33 into the tangents of 12 and 13 (it looked for 2 and
  3), and the text is decoded as utf-8-sig (2026-10-13). Found by the JavaScript port.
- **What happens:** a fit-point SPLINE with a start tangent (1, 1) started along (1, 0); a vertical one (0, 1)
  failed with "cannot normalize a zero-length vector". A UTF-8 file with a BOM was rejected.
- **Tests:** `tests/test_text_dxf.py::test_fit_point_tangents_keep_all_their_coordinates`,
  `test_a_byte_order_mark_is_no_part_of_the_drawing`.

### 3. `tessellate`: tolerance not kept near the poles of a sphere
- **Fixed:** on spheres, tori, cones and cylinders, `tessellate` splits the edges whose middle is more than the
  tolerance off the face onto it (kernel plan M2, `split_far_edges` in `src/cpp/tessellate.cpp`):
  `tessellate(Sphere(10), 0.01)` is within 0.0096 (15004 triangles instead of 14080), 0.001 within 0.0010
  (was 0.0014), the default within 0.026 (was 0.103). Free-form faces whose surface the grid misses at a control
  point are halved (a raised point of an interpolated sheet came out flat) (2026-10-22).
- **Session:** `2026-10-12_21-32-28_files-mesh`, scripts `03-sphere-deviation.py`, `04-sphere-slivers.py`
- **What happens:** `tessellate(Sphere(10), 0.01, 15)` (also with angle 45) has a largest
  deviation of 0.678 mm, 68 times the tolerance. It comes from long sliver triangles (edges up to
  7.2 mm) along the seam (azimuth about -2 deg) near both poles (z = +-9). The mesh is closed. The
  default tolerance (0.035) gives 0.103. With `angle=5` the largest deviation is 0.006.
- **Expected:** deviation <= tolerance, as the docstring says ("Maximum distance between mesh and
  exact surface").
- **Reproduce:** sample the triangles of `tessellate(Sphere(10), 0.01)` and measure `10 - |p|`.
- **Workaround:** pass `angle=5` together with a small tolerance.

### 4. `export_step(unit=...)`: declares the unit but does not scale; the user doc example misleads
- **Fixed:** export_step converts the coordinates to the declared unit; the round trip gives the same size in mm.
- **Session:** `2026-10-12_21-26-31_files-exact`, script `02-step-unit.py`
- **What happens:** a 60 x 40 x 8 mm box written with `unit="inch"` reads back as 1524 x 1016 x
  203.2 mm (in smlibpy, and in any CAD system). `cm` gives 10x, `m` 1000x. `docs/files.md` shows
  `export_step(bracket, "bracket_inch.step", unit="inch")` on a model built in mm. That line
  writes a part 25.4 times too large.
- **Expected:** either scale the coordinates to the declared unit (most users mean "deliver in
  inches"), or change the docs example to `bracket.scale(1 / 25.4)`.
- **Workaround:** `export_step(part.scale(1 / 25.4), path, unit="inch")`, which reads back at 60 x 40 x 8.

### 5. glTF export writes millimeters; glTF defines meters
- **Fixed:** export_glb/export_gltf scale the root node by 0.001 (meters); the viewer page is unchanged.
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `11-gltf.py`
- **What happens:** the positions are the model's mm values (bracket -30..30), with no scale node.
  Viewers that respect glTF units (Blender, AR viewers) show a 60 m bracket.
- **Expected:** a 0.001 scale on the root node (or an option), or at least a note in the docstring.
- **Workaround:** `export_glb([s.scale(0.001) for s in shapes], path)`.

### 6. `import_step`: names come only from the solid label; product names are ignored
- **Fixed:** an unnamed solid takes the name of its product (also through plain representation relationships).
- **Session:** `2026-10-12_21-26-31_files-exact`, script `05-step-foreign-occt.py`
- **What happens:** all 13 OpenCASCADE files import with `name = None`. They name the
  `PRODUCT` ('COMPOUND') and leave `MANIFOLD_SOLID_BREP('')` empty. Many CAD systems name parts
  this way. `docs/files.md` says "Names and colors come along".
- **Expected:** fall back to the product name (or the assembly instance name) when the solid
  label is empty.

## LOW

### 7. `load`: unknown extensions and missing `.smb` files give `KernelError: load failed`
- **Fixed:** load raises ValueError for unknown extensions and FileNotFoundError for a missing .smb.
- **Session:** `2026-10-12_21-26-31_files-exact`, script `10-export-dispatch.py`
- **What happens:** `load("x.glb")`, `load("x.obj")`, and `load("missing.smb")` all raise
  `KernelError: load failed`. Every extension other than STEP and STL goes to the native reader.
- **Expected:** `ValueError: unknown file type '.glb'` (as `export` does), and `FileNotFoundError`
  for a missing file.

### 8. Unhelpful errors for shapes a format cannot hold
- **Session:** `files-exact` scripts `04`, `08`, `10`; `files-mesh` script `12`
- **What happens:** `save(mesh)` and `mesh.export("x.smb")` raise
  `AttributeError: 'Mesh' object has no attribute '_brep'`. `export_step(edge)`,
  `save(edge)`, `export_stl(edge)` and `export_obj([edge])` raise `TypeError: 'Edge' object is not
  iterable`. For a `Vertex` the message is `TypeError: 'float' object is not iterable`
  (`files-mesh` script `19-shape-kinds-matrix.py`). `export_stl([])` raises
  `ValueError: need at least one array to concatenate`, while `export_glb([])` and
  `export_obj([])` write empty files without an error.
- **Expected:** one clear message, for example "cannot write an Edge to STEP; make a face or
  part", "an .smb file holds a body, not a mesh", "nothing to write".

### 9. `colored()` accepts any value; the error comes at export time
- **Session:** `2026-10-12_21-26-31_files-exact`, script `03-step-names-colors.py`
- **What happens:** `Box(5,5,5).colored("notacolor")` works. `export_step` then raises
  `ValueError: unknown color 'notacolor'`.
- **Expected:** validate in `colored()`.

### 10. `export_stl` / `tessellate`: invalid tolerance and angle accepted silently
- **Fixed:** tessellate (and so export_stl, mesh) raises ValueError for tolerance or angle <= 0.
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `09-stl-export.py`
- **What happens:** `tolerance=0`, `tolerance=-1`, and `angle=0` give the same 144 triangles as
  the default, with no error.
- **Expected:** `ValueError` for values <= 0.

### 11. `import_stl`: garbage gives an empty mesh
- **Fixed:** import_stl raises ValueError "not an STL file, or a truncated one".
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `10-stl-import.py`
- **What happens:** a truncated binary STL and a text file `hello world` both return
  `Mesh(0 vertices, 0 triangles)`.
- **Expected:** `ValueError: not an STL file` or "truncated".

### 12. `export_glb` has no `edge_color`; `export_gltf` has one
- **Fixed:** export_glb takes edge_color.
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `11-gltf.py`
- **What happens:** `export_gltf(p, "x.gltf", edge_color="red")` works.
  `export_glb(p, "x.glb", edge_color="red")` raises `TypeError: export_glb() got an unexpected
  keyword argument 'edge_color'`.
- **Expected:** the same keyword arguments for both.

### 13. `render`: bad views fail late or not at all
- **Session:** `2026-10-12_21-32-28_files-mesh`, scripts `13-render.py`, `14-show.py`
- **What happens:** `view="diagonal"` raises `KeyError: 'diagonal'`, which does not list the names.
  `view=(0, 0, 0)` prints NumPy RuntimeWarnings and returns an empty picture (96 bytes).
  `size=(0, 0)` raises `ZeroDivisionError`. A `Vertex` is skipped without a word.
- **Expected:** `ValueError` with the valid views; reject a zero direction and a zero size.

### 14. `Mesh.center()` is the bbox center, `Shape.center()` the centroid
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `16-mesh-measures.py`
- **What happens:** `Cone(10, 0, 20).center()` z = -5 (the centroid), and
  `Cone(10, 0, 20).mesh().center()` z = 0 (the bbox center).
- **Expected:** the same meaning for both, or another name (`bbox().center`).

### 15. `.smb` drops name and color; `docs/files.md` calls it "exact and lossless"
- **Docs fixed (kernel plan U1):** `docs/files.md`, the file guides and the docstrings no longer say "lossless": the geometry is exact, but B-spline faces that are exactly planes, cylinders, cones, spheres or surfaces of revolution come back as those. Name and color are still dropped. Merged parts now come back with their cells (kernel plan X8).
- **Session:** `2026-10-12_21-26-31_files-exact`, script `08-smb-save-load.py`
- **What happens:** `load(save(...))` of a named, colored part gives `name None`, `color None`.
  The geometry is bit-exact.
- **Expected:** keep them (the kernel has attributes), or say "geometry only" in the docs.

### 16. STEP export replaces non-ASCII characters in names with `?`
- **Fixed:** names are written in ISO 10303-21's `\X2\` encoding (`\X4\` beyond 16 bits) and
  backslashes doubled; `named("Bügel")` comes back as `Bügel`, also in OpenCASCADE (kernel plan
  I10, 2026-10-22).
- **Session:** `2026-10-12_21-26-31_files-exact`, script `03-step-names-colors.py`
- **What happens:** `named("Bügel")` comes back as `B?gel`.
- **Expected:** STEP's `\X2\...\X0\` encoding (ISO 10303-21), which other CAD systems read.

### 17. Mesh Boolean error on merged meshes names the wrong cause
- **Fixed:** mesh Booleans build the kernel's mesh from the arrays (kernel plan W3, M1), so merged meshes
  and STL imports work: `tessellate(ShapeList([Box(10, 10, 10), Box(4, 4, 4).translate(20, 0, 0)])) -
  Box(2, 2, 20).mesh()` gives 1024.0 (2026-10-22).
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `16-mesh-measures.py`
- **What happens:** `tessellate(ShapeList([...])) - m` raises `TypeError: mesh Booleans need meshes
  produced by tessellate()`, although the mesh was made by `tessellate()`. A merged mesh has no
  kernel data.
- **Expected:** "... need meshes of a single body made by tessellate()".

### 18. `import_dxf`: outlines with many holes are slow (kernel face building grows with the square)
- **Session:** `2026-10-13_00-44-16_files-dxf` (measured while writing the guide)
- **What happens:** one outline with n circular holes: `create_planar_faces` takes 0.04 s for 100 holes,
  0.47 s for 400, 2.5 s for 900, 11 s for 1911. Building the outline alone and subtracting all holes with
  one 2D Boolean is not faster (16 s for 1911). smlibpy already knows which loop is a hole of which.
- **Expected:** near-linear time when the nesting is given.
- **Reproduce:** a LWPOLYLINE frame 200 x 160 with a 49 x 39 grid of CIRCLE r 1, `import_dxf`.
- **Workaround:** none; documented in `files/import_dxf.md`. A kernel entry point that takes the loops of
  a face explicitly (outer first, then holes) on an analytic plane would avoid the search.

