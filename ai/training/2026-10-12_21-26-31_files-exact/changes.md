diff --git a/src/smlibpy/skill/references/files/generic.md b/src/smlibpy/skill/references/files/generic.md
new file mode 100644
index 0000000..b2f9e3f
--- /dev/null
+++ b/src/smlibpy/skill/references/files/generic.md
@@ -0,0 +1,57 @@
+# Files: formats and what they keep
+
+smlibpy writes six formats and reads three. Only STEP and `.smb` keep the exact geometry.
+Everything else is a triangle mesh.
+
+| Format | Write | Read | Geometry | Bodies | Names | Colors | Units in file |
+|---|---|---|---|---|---|---|---|
+| STEP `.step` `.stp` | `export_step` | `import_step` | exact (analytic + B-spline) | many | yes (solid label) | yes | declared (`unit=`), converted to mm on import |
+| SMLib `.smb` | `save` | `load` | exact, binary bit-identical | **one** | no | no | none (mm) |
+| STL `.stl` | `export_stl` | `import_stl` → `Mesh` | triangles, float32 | merged into one mesh | no | no | none |
+| glTF `.glb` `.gltf` | `export_glb`, `export_gltf` | no | triangles + edge lines | one node per shape | yes | yes | written in mm, but glTF means meters |
+| OBJ `.obj` | `export_obj` | no | triangles, no normals | one object per shape | yes | no | none |
+| PNG | `render` | | a picture | | | yes | |
+| HTML | `show` | | an interactive viewer | | | yes | |
+
+`export(shapes, path)` and `shape.export(path)` choose the writer by extension. `load(path)`
+chooses the reader (`.step`/`.stp`/`.p21`, `.stl`; everything else is read as `.smb`).
+
+## Which format
+- **Deliver a CAD model: STEP.** Every CAD system reads it. Names, colors and exact surfaces
+  survive. Read it back and compare `volume` before you hand it over.
+- **Cache an intermediate body between scripts: `.smb`** with `ascii=False` (bit-exact). Set
+  the name and color again after `load`.
+- **3D printing: STL** with `tolerance=0.01`.
+- **Show it to people: `.glb`** (colors, names, edges), or `show(..., path=..., open_browser=False)`
+  for a page to open.
+- **Check it yourself: `render(..., view="sheet")`**, then read the PNG.
+
+## Units
+- All modeling is in mm. No writer scales the coordinates.
+- `export_step(unit="inch")` only writes "inch" into the header. Scale the model first:
+  `export_step(part.scale(1 / 25.4), path, unit="inch")`. Otherwise the file is 25.4 times too
+  large.
+- `import_step` converts any file unit to mm: a file that declares inch with a 60 x 40 x 8 box
+  reads back as 1524 x 1016 x 203.2.
+- glTF viewers that respect units (Blender, AR) show mm values as meters. Export
+  `[s.scale(0.001) for s in shapes]` for them.
+
+## Assemblies
+- `export_step([a, b, c], path)` writes one product with several named solids, not an
+  assembly tree. Each solid is placed where it is in the model.
+- `import_step` applies assembly placements and returns a `ShapeList` with one `Part` per
+  instance. Check foreign assemblies with a picture: in the AutoCAD AS1 file every part was
+  placed at the inverse of its placement, with no error.
+
+## Shape kinds
+| Shape | STEP | `.smb` | STL / OBJ / glTF | render, show |
+|---|---|---|---|---|
+| `Part` | solid (a two-solid part becomes two solids) | yes | yes | yes |
+| `Shell`, `Sketch`, `Face` | surface, comes back as `Shell` | comes back as `Shell` | open mesh | yes |
+| `Mesh` | `TypeError` | `AttributeError` | yes | yes |
+| `Edge`, `Wire` | `TypeError: 'Edge' object is not iterable` | same | glTF only (lines) | yes (lines) |
+| `Vertex` | `TypeError: 'float' object is not iterable` | same | glTF only (a point) | render skips it, show draws it |
+
+## Related
+`export.md`, `export_step.md`, `import_step.md`, `save_load.md`, `export_stl.md`,
+`import_stl.md`, `export_glb.md`, `export_obj.md`, `render.md`, `show.md`, `Mesh.md`.
diff --git a/src/smlibpy/skill/references/files/export.md b/src/smlibpy/skill/references/files/export.md
new file mode 100644
index 0000000..1277136
--- /dev/null
+++ b/src/smlibpy/skill/references/files/export.md
@@ -0,0 +1,53 @@
+# export / Shape.export
+
+Writes shapes to a file and picks the format from the extension. It is a thin dispatcher to
+the format functions.
+
+## Signatures
+`export(shapes, path, **kwargs)`
+`shape.export(path, **kwargs)` on any `Part`, `Shell`, `Sketch`, `Face`, and on `Mesh`.
+
+| Extension (any case) | Calls | Useful keyword arguments |
+|---|---|---|
+| `.step`, `.stp` | `export_step` | `unit`, `name` |
+| `.stl` | `export_stl` | `tolerance`, `angle`, `ascii` |
+| `.glb` | `export_glb` | `tolerance`, `angle`, `edges` |
+| `.gltf` | `export_gltf` | `tolerance`, `angle`, `edges`, `edge_color` |
+| `.obj` | `export_obj` | `tolerance`, `angle` |
+| `.smb` | `save` | `ascii` |
+
+- `shapes`: one shape or a list (nested lists are flattened). `path`: `str` or `pathlib.Path`.
+- `kwargs` go to the format function unchanged. A keyword argument that the format does not
+  take raises `TypeError`.
+
+## Returns
+`None`.
+
+## Gotchas
+- STEP and `.smb` are exact. STL, glTF and OBJ are triangle meshes. Deliver STEP for CAD, and a
+  mesh format for printing or viewing.
+- `.stp` with `unit="inch"` only declares inches. The coordinates are not scaled (see
+  `export_step`).
+- `.smb` holds one body. `export([a, b], "x.smb")` raises.
+- `Mesh.export` works for `.stl`, `.obj`, `.glb` and `.gltf`. For `.step` it raises `TypeError`,
+  for `.smb` it raises `AttributeError`.
+- No extension, or `.iges`, `.3mf` and other formats, raise `ValueError` before anything is
+  written.
+- `load` is the reverse for `.step`/`.stp`, `.stl` and `.smb` only. glTF and OBJ cannot be read
+  back.
+
+## Errors
+- `ValueError: unknown file type '.iges'; use .step, .stl, .glb, .gltf, .obj or .smb`.
+- `TypeError: export_step() got an unexpected keyword argument 'tolerance'`: a mesh keyword
+  argument used on an exact format, or the other way round.
+
+## Example
+```python
+bracket.export("bracket.step")                # exact
+bracket.export("bracket.stl", tolerance=0.01) # mesh, 0.01 mm chord error
+export([bracket, cover], "assembly.glb")      # meshes with names and colors
+print(type(load("bracket.step")).__name__, type(load("bracket.stl")).__name__)   # Part Mesh
+```
+
+## Related
+`export_step`, `export_stl`, `export_glb`, `export_obj`, `save_load.md`, `generic.md`.
diff --git a/src/smlibpy/skill/references/files/export_step.md b/src/smlibpy/skill/references/files/export_step.md
new file mode 100644
index 0000000..5de77b8
--- /dev/null
+++ b/src/smlibpy/skill/references/files/export_step.md
@@ -0,0 +1,72 @@
+# export_step
+
+Writes parts and surfaces to a STEP AP214 file with the exact geometry. The format to deliver
+a CAD model in.
+
+## Signature
+`export_step(shapes, path, *, unit="mm", name=None)`
+
+- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, or a list of them (nested lists are flattened).
+- `path`: `str` or `pathlib.Path`. The extension is not checked.
+- `unit`: `"mm"` (default), `"cm"`, `"m"`, `"um"`, `"inch"` (or `"in"`). It **only declares** the
+  unit. The coordinates are written unchanged (see Gotchas).
+- `name`: the STEP product name. Default: the file name without its extension.
+
+## Returns
+`None`. The file holds one `PRODUCT` and one solid (`MANIFOLD_SOLID_BREP`, or
+`BREP_WITH_VOIDS` for a hollow part) per solid, plus one open sheet per surface. Planes,
+cylinders, cones, spheres, tori, lines, circles and ellipses are written as analytic entities.
+Everything else is written as B-splines with the kernel's control points.
+
+## What is kept
+- Geometry: reading the file back gives the same face and edge counts, the same face types,
+  the same bbox, and the volume to about 1e-8 relative.
+- Names: `part.named("bracket")` becomes the label of its solid, and `import_step` gives it
+  back. An unnamed body gets the product name when it is alone in the file, otherwise
+  `<product>_<i>` (`assembly_3`, counted from 1 over all bodies).
+- Colors: `part.colored(...)` is written as a surface color for the whole body. It comes back
+  as a float tuple `(r, g, b)` in 0..1, not as the string you gave.
+- Order: bodies come back in the order you wrote them, at their places.
+
+## Gotchas
+- **`unit` does not scale.** If you write a mm model with `unit="inch"`, it reads back 25.4 times
+  larger: a 60 mm box becomes 1524 mm. For an inch file, scale first:
+  `export_step(part.scale(1 / 25.4), path, unit="inch")`. Likewise, `"cm"` gives 10x and
+  `"m"` gives 1000x.
+- A list of parts is not written as an assembly tree. You get one product with several solids,
+  and each solid carries its own name.
+- A `Part` with two disjoint solids (from a fuse of parts that do not touch) is written as two
+  solids. It comes back as a `ShapeList` of two `Part`s, both with the same name.
+- A `Sketch` or `Face` is written as a surface and comes back as a `Shell`, not as a `Sketch`.
+- Names must be ASCII. Other characters become `?` (`"Bügel"` becomes `"B?gel"`). Quotes are
+  fine.
+- `colored()` does not check the color. A bad color fails at export time with
+  `ValueError: unknown color 'notacolor'`.
+- Edges, wires and meshes cannot be written (no wireframe in STEP export).
+
+## Errors
+- `ValueError: unknown unit 'MM'; use mm, cm, m, um or inch`: the unit names are case
+  sensitive. No file is written.
+- `ValueError: nothing to write`: the list is empty.
+- `TypeError: cannot write a Mesh to STEP`: use `export_stl`/`export_glb` for meshes.
+- `TypeError: 'Edge' object is not iterable` (or `'Wire'`, or `'float'` for a `Vertex`): you
+  passed something that is not a body. Edges, wires and vertices cannot be exported. Make a
+  face or a part from them first.
+
+## Example
+```python
+bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
+cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
+export_step([bracket, cover], "assembly.step")
+
+back = import_step("assembly.step")
+print([p.name for p in back], round(back[0].volume, 3), round(bracket.volume, 3))
+# ['bracket', 'cover'] 18797.876 18797.876
+
+# an inch file: scale the model first, then declare the unit
+export_step(bracket.scale(1 / 25.4), "bracket_inch.step", unit="inch")
+print(import_step("bracket_inch.step").bbox().size)   # Vector(60, 40, 8)
+```
+
+## Related
+`import_step`, `export` (by extension), `save` (native, bit-exact, one body), `generic.md`.
diff --git a/src/smlibpy/skill/references/files/import_step.md b/src/smlibpy/skill/references/files/import_step.md
new file mode 100644
index 0000000..d5ac0e4
--- /dev/null
+++ b/src/smlibpy/skill/references/files/import_step.md
@@ -0,0 +1,72 @@
+# import_step
+
+Reads the solids and surfaces of a STEP file (AP203, AP214, AP242) as exact smlibpy bodies.
+`load("x.step")` does the same thing.
+
+## Signature
+`import_step(path, *, heal=True)`
+
+- `path`: `str` or `pathlib.Path`. `load()` sends `.step`, `.stp` and `.p21` here (in any
+  letter case).
+- `heal`: run the kernel's healer on solids that come out invalid. Valid solids are never
+  touched.
+
+## Returns
+The return type depends on how many bodies the file holds:
+- One body: a `Part` (a solid) or a `Shell` (a surface model or a sheet).
+- Several bodies: a `ShapeList` of them, in file order, each at its place in the assembly.
+
+Handle both cases:
+```python
+r = import_step(path)
+parts = r if isinstance(r, ShapeList) else [r]
+```
+
+Lengths are converted to mm, whatever unit the file declares. Faces keep their exact surface
+types, so a cylinder stays a cylinder and a B-spline keeps its control points. A hollow solid
+(`BREP_WITH_VOIDS`) comes back as one `Part` with its cavity.
+
+## Names and colors
+- `p.name` is the label of the solid in the file. Many CAD systems leave that label empty and
+  name only the product. Files written by OpenCASCADE, for example, come back with
+  `name = None`. Product and assembly instance names are not read.
+- `p.color` is a tuple `(r, g, b)` in 0..1, or `None`. Predefined STEP colors come back as
+  ints (`(1, 0, 0)`), RGB colors as floats.
+
+## Gotchas
+- **Always check `is_valid()` on what you import.** A broken body does not raise. A solid with
+  a missing face came back as a `Part` with `is_valid() == False` and a meaningless volume (8000
+  for an open 20 mm cube), with `heal=True` as well.
+- **Check foreign assemblies with a picture.** In the AutoCAD AS1 assembly every part was placed
+  at the inverse of its placement, with no error (bolts 18 mm away from their nuts). Render
+  with `view="sheet"`, or measure `distance_to` between parts that should touch.
+- One `Part` written with two disjoint solids comes back as a `ShapeList` of two parts.
+- A `Sketch` written to STEP comes back as a `Shell`.
+- A single-body file gives a bare `Part`, so `len(r)` and `for p in r` fail on it. Use the
+  pattern above.
+- Not read: wireframe geometry, references to external files, PMI, and assembly placements
+  that mirror a part (`ModelingError: mirrored assembly placements are not supported yet`).
+
+## Errors
+- `ModelingError: the STEP file holds no B-rep solids or surfaces`: a wireframe-only or empty
+  file.
+- `ValueError: not a STEP file (no DATA section)`: the file is not STEP.
+- `FileNotFoundError` for a missing file.
+- `KernelError` for the operation `import STEP`, with the hint "the file may hold faces the
+  kernel cannot rebuild".
+
+## Example
+```python
+r = import_step("assembly.step")
+parts = r if isinstance(r, ShapeList) else [r]
+for p in parts:
+    print(type(p).__name__, p.name, p.color, p.is_valid(), round(p.volume, 3))
+# Part bracket (0.2745..., 0.5098..., 0.7058...) True 18797.876
+# Part cover (0.8509..., 0.5725..., 0.3529...) True 4800.0
+```
+OpenCASCADE reference files (box, cylinder, sphere, torus, cone, fillets, holes, revolve,
+loft, sweep, hollow, chamfer, shell) all read back valid, with the volume within 2.2e-7 of
+OpenCASCADE's value.
+
+## Related
+`load`, `export_step`, `Part.heal`, `Part.is_valid`, `render` (to check an import), `generic.md`.
diff --git a/src/smlibpy/skill/references/files/save_load.md b/src/smlibpy/skill/references/files/save_load.md
new file mode 100644
index 0000000..12d6210
--- /dev/null
+++ b/src/smlibpy/skill/references/files/save_load.md
@@ -0,0 +1,59 @@
+# save / load
+
+`save` writes one body to SMLib's native `.smb` format. `load` reads `.smb`, STEP and STL,
+and picks the format from the extension.
+
+## Signatures
+`save(shapes, path, *, ascii=True)`
+`load(path)`
+
+- `save` takes exactly one body: a `Part`, `Shell`, `Sketch`, `Face`, or a list with one of
+  them.
+- `ascii=True` (the default) writes a text file. `ascii=False` writes a binary file, about 40 %
+  of the size.
+- `load` decides by the extension, in any letter case:
+  - `.step`, `.stp`, `.p21`: same as `import_step`.
+  - `.stl`: same as `import_stl`, gives a `Mesh`.
+  - anything else: read as `.smb`.
+
+## Returns
+`load` of an `.smb` gives a `Part`. A body that does not enclose a volume (a sketch, face or
+surface) comes back as a `Shell`.
+
+## .smb compared with STEP
+| | `.smb` | STEP |
+|---|---|---|
+| Geometry | binary: bit-identical. ASCII: within ~1e-15 | same surface types, volume within ~1e-8 |
+| Bodies per file | one (two-solid parts stay one `Part`) | any number |
+| Names, colors | **lost** | kept |
+| Other software | SMLib only | every CAD system |
+
+Use `.smb` to cache an intermediate result between scripts. Use STEP to deliver a model.
+
+## Gotchas
+- `.smb` stores no name and no color. `load` returns `name None`, `color None`. Set them
+  again with `.named()` and `.colored()`.
+- A list of two parts raises. Fuse them, or save each to its own file.
+- `load("x.glb")` or `load("x.obj")` does not say "unknown format". These files are handed to
+  the native reader and fail with `KernelError: load failed`. smlibpy cannot read glTF or OBJ.
+- A missing `.smb` file also gives `KernelError: load failed`, not `FileNotFoundError`.
+  A missing `.step` file gives `FileNotFoundError`.
+- A `Sketch` comes back as a `Shell`: its plane is lost.
+
+## Errors
+- `ValueError: an .smb file holds one body; fuse the parts or save them separately`.
+- `AttributeError: 'Mesh' object has no attribute '_brep'`: you passed a mesh to `save`.
+- `KernelError: load failed`: a missing file, or a file that is not `.smb`.
+
+## Example
+```python
+save(bracket, "bracket.smb")                  # ASCII, exact
+save(bracket, "bracket_bin.smb", ascii=False) # binary, bit-exact
+again = load("bracket.smb")
+print(again.volume == bracket.volume, again.name)   # True None
+again = again.named(bracket.name).colored(bracket.color)   # name and color are not stored
+```
+
+## Related
+`export` (writes `.smb` with `save` when the extension is `.smb`), `export_step`,
+`import_step`, `import_stl`.
