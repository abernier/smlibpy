# Defects and surprises: files

## HIGH

### 1. `import_step`: assembly parts placed at the inverse of their placement (AS1 from AutoCAD)
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

### 3. `tessellate`: tolerance not kept near the poles of a sphere
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
- **Session:** `2026-10-12_21-26-31_files-exact`, script `02-step-unit.py`
- **What happens:** a 60 x 40 x 8 mm box written with `unit="inch"` reads back as 1524 x 1016 x
  203.2 mm (in smlibpy, and in any CAD system). `cm` gives 10x, `m` 1000x. `docs/files.md` shows
  `export_step(bracket, "bracket_inch.step", unit="inch")` on a model built in mm. That line
  writes a part 25.4 times too large.
- **Expected:** either scale the coordinates to the declared unit (most users mean "deliver in
  inches"), or change the docs example to `bracket.scale(1 / 25.4)`.
- **Workaround:** `export_step(part.scale(1 / 25.4), path, unit="inch")`, which reads back at 60 x 40 x 8.

### 5. glTF export writes millimeters; glTF defines meters
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `11-gltf.py`
- **What happens:** the positions are the model's mm values (bracket -30..30), with no scale node.
  Viewers that respect glTF units (Blender, AR viewers) show a 60 m bracket.
- **Expected:** a 0.001 scale on the root node (or an option), or at least a note in the docstring.
- **Workaround:** `export_glb([s.scale(0.001) for s in shapes], path)`.

### 6. `import_step`: names come only from the solid label; product names are ignored
- **Session:** `2026-10-12_21-26-31_files-exact`, script `05-step-foreign-occt.py`
- **What happens:** all 13 OpenCASCADE files import with `name = None`. They name the
  `PRODUCT` ('COMPOUND') and leave `MANIFOLD_SOLID_BREP('')` empty. Many CAD systems name parts
  this way. `docs/files.md` says "Names and colors come along".
- **Expected:** fall back to the product name (or the assembly instance name) when the solid
  label is empty.

## LOW

### 7. `load`: unknown extensions and missing `.smb` files give `KernelError: load failed`
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
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `09-stl-export.py`
- **What happens:** `tolerance=0`, `tolerance=-1`, and `angle=0` give the same 144 triangles as
  the default, with no error.
- **Expected:** `ValueError` for values <= 0.

### 11. `import_stl`: garbage gives an empty mesh
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `10-stl-import.py`
- **What happens:** a truncated binary STL and a text file `hello world` both return
  `Mesh(0 vertices, 0 triangles)`.
- **Expected:** `ValueError: not an STL file` or "truncated".

### 12. `export_glb` has no `edge_color`; `export_gltf` has one
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
- **Session:** `2026-10-12_21-26-31_files-exact`, script `08-smb-save-load.py`
- **What happens:** `load(save(...))` of a named, colored part gives `name None`, `color None`.
  The geometry is bit-exact.
- **Expected:** keep them (the kernel has attributes), or say "geometry only" in the docs.

### 16. STEP export replaces non-ASCII characters in names with `?`
- **Session:** `2026-10-12_21-26-31_files-exact`, script `03-step-names-colors.py`
- **What happens:** `named("Bügel")` comes back as `B?gel`.
- **Expected:** STEP's `\X2\...\X0\` encoding (ISO 10303-21), which other CAD systems read.

### 17. Mesh Boolean error on merged meshes names the wrong cause
- **Session:** `2026-10-12_21-32-28_files-mesh`, script `16-mesh-measures.py`
- **What happens:** `tessellate(ShapeList([...])) - m` raises `TypeError: mesh Booleans need meshes
  produced by tessellate()`, although the mesh was made by `tessellate()`. A merged mesh has no
  kernel data.
- **Expected:** "... need meshes of a single body made by tessellate()".
