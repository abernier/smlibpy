diff --git a/src/smlibpy/skill/references/files/export_stl.md b/src/smlibpy/skill/references/files/export_stl.md
new file mode 100644
index 0000000..f8c0d5b
--- /dev/null
+++ b/src/smlibpy/skill/references/files/export_stl.md
@@ -0,0 +1,60 @@
+# export_stl
+
+Writes shapes as one triangle mesh to an STL file, for 3D printing and mesh tools.
+
+## Signature
+`export_stl(shapes, path, *, tolerance=None, angle=15.0, ascii=False)`
+
+- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, `Mesh`, or a list of them.
+- `tolerance`: the largest distance between the mesh and the exact surface, in mm. The default
+  is 0.1 % of each body's bbox diagonal.
+- `angle`: the largest angle in degrees between neighbouring triangles on curved faces.
+- `ascii`: `False` (default) writes binary STL. `True` writes text that is 4.6 times larger.
+
+## Returns
+`None`. Binary file: an 80-byte header (`smlibpy binary STL`), the triangle count, then
+50 bytes per triangle. Normals in the file agree with the winding (outward for solids).
+
+## Tolerance and triangle count
+Bracket 60 x 40 x 8 with a hole of r = 4 (volume 18797.876):
+
+| tolerance | angle | triangles | mesh volume error |
+|---|---|---|---|
+| default, 1, 0.1 | 15 | 144 | +1.4e-4 |
+| 0.01 | 15 | 272 | +3.5e-5 |
+| 0.001 | 15 | 1048 | +2.1e-6 |
+| default | 5 | 528 | |
+| default | 1 | 2080 | |
+
+Both limits apply and the stricter one wins. Planar faces ignore both: a box is always 12
+triangles. On a cylinder of r = 10, tolerance 0.001 gives 411 segments. On a sphere, also set
+`angle=5`: with only a small tolerance, sliver triangles near the poles stay up to 0.68 mm off
+the surface (see `Mesh.md`). For 3D printing, `tolerance=0.01` is plenty.
+
+## Gotchas
+- Several parts go into **one** unnamed mesh. STL has no names, no colors, no units. Readers
+  assume mm, but nothing in the file says so.
+- Coordinates are float32 (about 7 digits). Far from the origin the resolution drops, to about
+  0.01 mm at 100 m. ASCII is no more precise: it writes 7 digits too.
+- A `Sketch` or face becomes 2 triangles per planar face: an open mesh, useless for printing.
+- `tolerance=0`, negative values and `angle=0` are accepted without an error and give the
+  default mesh.
+- Mesh Booleans give wrong results. Do Booleans on the exact parts before you export.
+
+## Errors
+- `ValueError: need at least one array to concatenate`: the list was empty.
+- `TypeError: cannot tessellate a Edge`: edges and wires have no triangles.
+
+## Example
+```python
+part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
+export_stl(part, "bracket.stl")                      # binary, default tolerance
+export_stl(part, "bracket_fine.stl", tolerance=0.01) # finer: 0.01 mm chord error
+m = import_stl("bracket_fine.stl")
+print(m, round(m.volume, 3), round(part.volume, 3))
+# Mesh(136 vertices, 272 triangles) 18798.526 18797.876
+```
+
+## Related
+`import_stl`, `Mesh` / `tessellate` (same `tolerance`/`angle`), `export_glb` (keeps names and
+colors), `export_step` (exact).
diff --git a/src/smlibpy/skill/references/files/import_stl.md b/src/smlibpy/skill/references/files/import_stl.md
new file mode 100644
index 0000000..8def890
--- /dev/null
+++ b/src/smlibpy/skill/references/files/import_stl.md
@@ -0,0 +1,47 @@
+# import_stl
+
+Reads a binary or ASCII STL file as a `Mesh`. `load("x.stl")` does the same thing.
+
+## Signature
+`import_stl(path)`
+
+## Returns
+A `Mesh` with shared vertices. Corners at the same position (rounded to 1e-9) are welded into
+one vertex. An STL written from a closed part therefore comes back closed, with the same vertex
+count as the tessellation. `normals` is `None`. The normals stored in the file are ignored, and
+`triangle_normals` is computed from the winding.
+
+Binary or ASCII is decided by the file size (84 + 50 x count). A binary file whose header
+starts with `solid` is read correctly.
+
+## What you can do with it
+- `volume`, `area`, `bbox()`, `len(m)` (triangles), `triangle_normals`.
+- Export it again: `export_stl`, `export_glb`, `export_obj`, `render`, `show` all accept a `Mesh`.
+
+## What you cannot do
+- It is not a `Part`. There are no faces, no fillets, no exact Booleans, no `export_step`.
+- Mesh Booleans raise `TypeError: mesh Booleans need meshes produced by tessellate()`.
+- `name` and `color` do not exist on a `Mesh`.
+
+## Gotchas
+- **No error for garbage.** A truncated binary file or a text file returns
+  `Mesh(0 vertices, 0 triangles)`. Check `len(m) > 0`.
+- Several parts in one STL come back as one mesh. Where parts touch, their corners are welded
+  together, and the mesh becomes non-manifold (two touching boxes: 5 edges used by more than
+  two triangles). `volume` is still the sum.
+- The coordinates went through float32: expect differences in the 7th digit compared with the
+  model.
+- `center()` is the bbox center, not the centroid.
+
+## Example
+```python
+part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
+export_stl(part, "bracket.stl")                      # binary, default tolerance
+export_stl(part, "bracket_fine.stl", tolerance=0.01) # finer: 0.01 mm chord error
+m = import_stl("bracket_fine.stl")
+print(m, round(m.volume, 3), round(part.volume, 3))
+# Mesh(136 vertices, 272 triangles) 18798.526 18797.876
+```
+
+## Related
+`export_stl`, `Mesh`, `load`.
diff --git a/src/smlibpy/skill/references/files/export_glb.md b/src/smlibpy/skill/references/files/export_glb.md
new file mode 100644
index 0000000..057edfb
--- /dev/null
+++ b/src/smlibpy/skill/references/files/export_glb.md
@@ -0,0 +1,51 @@
+# export_glb / export_gltf
+
+Writes shapes as a glTF 2.0 scene: triangle meshes with colors and names, plus the B-rep edges
+as lines. Use it for web viewers, presentations and other tools that show meshes.
+
+## Signatures
+`export_glb(shapes, path, *, tolerance=None, angle=15.0, edges=True)`: one binary `.glb` file.
+`export_gltf(shapes, path, **kwargs)`: one `.gltf` JSON file with the buffer embedded as a
+base64 data URI (1.3 times larger). It takes the same keyword arguments plus
+`edge_color` (default `"#1f2328"`).
+
+- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, vertices, or lists of them.
+- `tolerance`, `angle`: as in `tessellate`.
+- `edges`: draw the edges of faces as a line primitive. Seams of round faces are left out.
+
+## Returns
+`None`. The file has one node and one mesh per shape, named `shape.name`. Unnamed shapes get
+`<type>_<i>`, counted from 1 over the whole list: `part_3`, `sketch_5`, `edge_4`, `mesh_1`.
+A root node `z-up` turns the model -90 degrees about X, so it stands upright in Y-up viewers.
+
+## Colors
+- A body's own color (`colored(...)`) becomes its material color.
+- Bodies without a color get a palette color by their position in the list: `#7c93b5`,
+  `#d9925a`, `#79ad73`, `#c97878`, ... Colored bodies count too: an unnamed second part gets
+  `#d9925a`, even when the first one has its own color.
+- Edge lines are `#1f2328`. Edges and wires you pass as shapes are orange `#d9480f`, and a
+  vertex is a point.
+
+## Gotchas
+- **Units:** positions are written in mm, and glTF defines meters. Blender and AR viewers show
+  a 60 mm part as 60 m. When the receiver respects units, scale first:
+  `export_glb([s.scale(0.001) for s in shapes], path)`. `scale` keeps names and colors.
+- Triangles are not indexed (3 vertices each, about 72 bytes per triangle). A sphere of r = 10
+  takes 259 kB at the default tolerance, 1 MB at 0.01 and 9.6 MB at 0.001.
+- `export_glb` has no `edge_color` keyword argument (`TypeError`). Only `export_gltf` has it.
+- An empty list writes a valid, empty scene without an error.
+- smlibpy cannot read glTF back (`load("x.glb")` fails with `KernelError: load failed`).
+
+## Example
+```python
+bracket = part.colored("steelblue")
+cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
+export_glb([bracket, cover], "assembly.glb")                  # mm, Z up, edges as lines
+export_glb([s.scale(0.001) for s in (bracket, cover)], "assembly_m.glb")  # meters for Blender & co.
+export_gltf(bracket, "bracket.gltf", edges=True, edge_color="red")
+print([s.scale(0.001).name for s in (bracket, cover)])   # ['bracket', 'cover']
+```
+(`part` is the bracket from `export_stl.md`.)
+
+## Related
+`show` (embeds the same GLB in an HTML page), `export_stl`, `export_obj`, `tessellate`.
diff --git a/src/smlibpy/skill/references/files/export_obj.md b/src/smlibpy/skill/references/files/export_obj.md
new file mode 100644
index 0000000..40b9957
--- /dev/null
+++ b/src/smlibpy/skill/references/files/export_obj.md
@@ -0,0 +1,37 @@
+# export_obj
+
+Writes shapes as Wavefront OBJ: one named object per shape, triangles only.
+
+## Signature
+`export_obj(shapes, path, *, tolerance=None, angle=15.0)`
+
+- `shapes`: parts, shells, sketches, faces, meshes, or lists of them.
+- `tolerance`, `angle`: as in `tessellate`. For the 60 x 40 x 8 bracket with a hole of r = 4:
+  default 144 triangles, `tolerance=0.01` 272, `angle=5` 528.
+
+## Returns
+`None`. The file is plain text:
+```
+# smlibpy
+o bracket
+v -30 -20 -4          (9 significant digits, mm)
+f 1 2 3               (1-based, numbered across the whole file)
+```
+Unnamed shapes are called `part_<i>` (meshes too), counted from 1 over the list.
+
+## Gotchas
+- No normals, no colors or materials (`.mtl`), no units. Use `export_glb` when colors matter.
+- Vertices are shared within an object, not between objects.
+- An empty list writes a file with only `# smlibpy`, without an error.
+- Edges and wires cannot be written (`TypeError: 'Edge' object is not iterable`).
+- smlibpy cannot read OBJ back (`load("x.obj")` fails with `KernelError: load failed`).
+
+## Example
+```python
+export_obj([bracket, cover], "assembly.obj", tolerance=0.01)
+print([l.strip() for l in open("assembly.obj") if l.startswith("o ")])   # ['o bracket', 'o cover']
+```
+(`bracket` and `cover` as in `export_glb.md`.)
+
+## Related
+`export_stl`, `export_glb`, `tessellate`.
diff --git a/src/smlibpy/skill/references/files/render.md b/src/smlibpy/skill/references/files/render.md
new file mode 100644
index 0000000..542cc63
--- /dev/null
+++ b/src/smlibpy/skill/references/files/render.md
@@ -0,0 +1,57 @@
+# render
+
+Draws shapes into a PNG in software: no browser, no GPU. Use it to look at what you built.
+
+## Signature
+`render(*shapes, path=None, view="iso", size=(800, 600), edges=True, background="white", tolerance=None)`
+
+- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, or lists of them (nested
+  lists are fine). Vertices are skipped.
+- `path`: also write the PNG to this file (`str` or `Path`).
+- `view`: the direction from the model towards the camera, Z up:
+  - `"iso"` (1, -1.25, 0.75): from front-right, above.
+  - `"front"` (from -Y), `"back"` (+Y), `"left"` (-X), `"right"` (+X), `"top"` (+Z), `"bottom"`
+    (-Z). In `top` and `bottom`, +X points right.
+  - a tuple `(x, y, z)`, for example `(1, -1, -1)` to look from below.
+  - `"sheet"`: four tiles, front | top on the first row and right | iso on the second, all at
+    one scale and labelled.
+- `size`: (width, height) in pixels. For `"sheet"`, each tile is half of it.
+- `edges`: draw the B-rep edges in dark gray. Hidden edges and seams are never drawn.
+- `background`: any color `colored()` accepts (`"white"`, `"#202020"`, `(r, g, b)`).
+- `tolerance`: the tessellation tolerance. The default is 0.1 % of each body's size, and a
+  coarse value such as 1.0 shows facets.
+
+## Returns
+The PNG file as `bytes` (starting `b'\x89PNG'`), also when `path` is given. Display it in a
+notebook with `IPython.display.Image(render(part))`.
+
+## Colors
+A shape's own color, otherwise a palette color by its position in the argument list (`#7c93b5`
+blue-gray, `#d9925a` orange, `#79ad73` green, ...). Edges and wires you pass are drawn as
+lines in a darker shade of their color. Meshes have no color, so they get the palette color
+of their position.
+
+## Gotchas
+- **Pictures are scaled to fit.** A 10 mm box and a 20 mm box give byte-identical PNGs. Prove
+  sizes with `bbox()`, not with pictures. In a `sheet`, all four tiles share one scale.
+- Use `view="sheet"` for placement questions: a feature on a hidden side shows there.
+- Solids are culled from behind. Open surfaces are lit on both sides.
+- Speed: a sphere at 800 x 600 takes 0.26 s, at 1600 x 1200 it takes 1.1 s.
+
+## Errors
+- `ValueError: nothing to render`: no shapes, or only vertices.
+- `KeyError: 'diagonal'`: an unknown view name. The valid names are listed above.
+- `ZeroDivisionError` for `size=(0, 0)`.
+- `view=(0, 0, 0)` raises no error: you get NumPy warnings and an empty picture.
+
+## Example
+```python
+plate = (Box(40, 30, 10) - Cylinder(6, 20)).colored("steelblue")
+png = render(plate, path="plate.png")                                   # iso, 800 x 600
+render(plate, path="plate_views.png", view="sheet", size=(1000, 760))  # front, top, right, iso
+render(plate, path="plate_under.png", view=(1, -1, -1), edges=False, background="#202020")
+print(png[:4], len(png))
+```
+
+## Related
+`show` (interactive 3D in the browser), `tessellate`, `export_glb`.
diff --git a/src/smlibpy/skill/references/files/show.md b/src/smlibpy/skill/references/files/show.md
new file mode 100644
index 0000000..4cbf8bc
--- /dev/null
+++ b/src/smlibpy/skill/references/files/show.md
@@ -0,0 +1,44 @@
+# show
+
+Opens shapes in an interactive 3D viewer (three.js): orbit, pan, zoom, `F` to frame.
+
+## Signature
+`show(*shapes, title="smlibpy", path=None, open_browser=True, tolerance=None, angle=12.0, edges=True)`
+`shape.show(**kwargs)` does the same for one shape.
+
+- `shapes`: parts, shells, sketches, faces, meshes, edges, wires, vertices, or lists of them.
+- `path`: where to write the HTML page. Without a path, a temp file `smlibpy-*.html` is used.
+- `open_browser`: open the page in the default browser. **In scripts, agents and CI, pass
+  `open_browser=False`.**
+- `title`: the page title (HTML-escaped).
+- `tolerance`, `angle`, `edges`: as in `export_glb`. The default `angle` is 12, not 15.
+
+## Returns
+- Outside a notebook: the path, exactly as you passed it (`str` or `Path`), or the temp file
+  path.
+- In Jupyter, when `path` is None: the page is shown inline in an iframe, and the IPython
+  `HTML` object is returned. With a `path`, a notebook writes the file like a script (and opens
+  the browser unless `open_browser=False`).
+
+## The page
+- One self-contained HTML file (29 kB for a simple part). The model is embedded as GLB.
+- three.js 0.170.0 is loaded from `cdn.jsdelivr.net`, so viewing needs internet access.
+- An info line at the bottom: `Part · 7 faces · volume 18 797.9 · 60 × 40 × 8` for one shape,
+  `4 shapes` for several.
+- The colors and default palette are the same as in `export_glb`, and dark mode is followed.
+
+## Gotchas
+- An agent cannot see the browser. To check a model, use `render(..., view="sheet")` and read
+  the PNG. Use `show` to hand a model to a person.
+- `show()` with no shapes writes an empty viewer page, without an error.
+- A shape at the end of a notebook cell shows itself (`_repr_html_`).
+
+## Example
+```python
+page = show(plate, cover, title="plate", path="plate.html", open_browser=False)
+print(page)   # plate.html
+```
+(`plate` from `render.md`, `cover` from `export_glb.md`.)
+
+## Related
+`render` (PNG, no browser), `export_glb`.
diff --git a/src/smlibpy/skill/references/files/Mesh.md b/src/smlibpy/skill/references/files/Mesh.md
new file mode 100644
index 0000000..d19a79b
--- /dev/null
+++ b/src/smlibpy/skill/references/files/Mesh.md
@@ -0,0 +1,69 @@
+# Mesh / tessellate
+
+`tessellate` turns an exact shape into an indexed triangle mesh. `Mesh` is that mesh: plain
+NumPy arrays, used for STL/OBJ/glTF, render and quick measurements.
+
+## Signatures
+`tessellate(shape, tolerance=None, angle=15.0)`
+`shape.mesh(tolerance=None, angle=15.0)`: the same thing as a method.
+`Mesh(vertices, triangles, normals=None)`: build a mesh by hand.
+
+- `shape`: a `Part`, `Shell`, `Sketch`, `Face` or `ShapeList`. A `ShapeList` is merged into one
+  mesh. A plain Python `list`, an `Edge` or a `Wire` raises `TypeError`.
+- `tolerance`: the largest mesh-to-surface distance in mm. Default: 0.1 % of the bbox diagonal.
+- `angle`: the largest angle in degrees between neighbouring triangles on curved faces.
+
+## Fields
+| Field | Type | Meaning |
+|---|---|---|
+| `vertices` | `(n, 3)` float64 | positions, shared between triangles of one body |
+| `triangles` | `(m, 3)` int64 | vertex indices, counterclockwise seen from outside |
+| `normals` | `(m, 3, 3)` float32 or `None` | unit corner normals of the exact surface. `None` for `import_stl` and hand-built meshes |
+| `triangle_normals` | `(m, 3)` | computed from the winding |
+| `len(m)` | int | number of triangles |
+| `area`, `volume` | float | from the triangles |
+| `bbox()`, `center()` | | `center()` is the **bbox center**, not the centroid |
+
+## Tolerance and triangle count
+| Shape | tolerance / angle | triangles | volume error |
+|---|---|---|---|
+| Cylinder(10, 20) | default (0.035) / 15 | 252 (64 segments) | -0.16 % |
+| Cylinder(10, 20) | 0.001 / 15 | 1640 (411 segments) | |
+| Sphere(10) | default / 15 | 3584 | -0.41 % |
+| Sphere(10) | 0.01 / 5 | 16128 | -0.10 % |
+| Sphere(10) | 0.001 / 15 | 133984 | -0.013 % |
+| Box | anything | 12 | 0 |
+
+The stricter of the two limits wins. A mesh of a closed part is closed and outward, so `volume`
+is positive.
+
+## Gotchas
+- **Mesh Booleans (`m1 + m2`, `m1 - m2`, `m1 & m2`) give wrong results without an error.** Box
+  minus sphere came out at +171 % volume with 336 open edges, and other cases gave negative
+  volumes. They only work where no face of the result gets a hole. Always do the Boolean on
+  the exact parts and mesh the result.
+- Mesh Booleans also need meshes of one body made by `tessellate`. Meshes from `import_stl`,
+  `Mesh(...)` or `tessellate(ShapeList)` raise `TypeError: mesh Booleans need meshes produced
+  by tessellate()`.
+- The tolerance is not a hard limit near the poles of spheres. `Sphere(10)` with
+  `tolerance=0.01` had sliver triangles 0.68 mm off the surface. Add `angle=5`: the largest
+  deviation then drops to 0.006.
+- `volume` only means something for closed meshes. For an open mesh it changes when you move
+  the mesh, and reversed winding makes it negative.
+- Unlike shapes, a `Mesh` is mutable: `m.vertices += [10, 0, 0]` moves it in place. It has no
+  `name` or `color`.
+- Use the exact shape for measurements (`part.volume`, `part.area`). Mesh values are off by
+  the tolerance.
+
+## Example
+```python
+solid = Box(20, 20, 20) - Sphere(12)       # Boolean on exact parts first
+m = solid.mesh(tolerance=0.01)             # then mesh
+print(m, m.vertices.shape, m.triangles.shape, m.normals.shape)
+print(round(m.volume, 2), round(solid.volume, 2), round(m.area, 2), round(solid.area, 2))
+# Mesh(3816 vertices, 7648 triangles) (3816, 3) (7648, 3) (7648, 3, 3)
+# 1620.01 1616.28 2475.65 2475.4
+```
+
+## Related
+`export_stl`, `import_stl`, `export_glb`, `export_obj`, `render`.
