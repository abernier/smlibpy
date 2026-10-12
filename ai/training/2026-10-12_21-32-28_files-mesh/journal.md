# Training: files · meshes and pictures (STL, glTF, OBJ, Mesh, render, show)

**Date:** 2026-10-12

## Goal

APIs: `tessellate`, `Shape.mesh`, `Mesh`, `export_stl`, `import_stl`, `export_glb`, `export_gltf`,
`export_obj`, `render`, `show`

Questions:
- What is the default tolerance? How do tolerance and angle change triangle counts and the real
  chord error?
- Mesh fields: vertices, triangles, normals; are vertices shared? closed? volume/area accuracy?
- Mesh Booleans: which meshes work; results?
- STL: binary vs ASCII, float32 precision, normals, several parts in one file, welding on import.
- glTF: units (glTF says meters), Z-up rotation, names, colors, edges, edge_color, default colors.
- OBJ: names, normals, several parts, Mesh input.
- render: views, sheet, size, edges, background, tolerance, colors, empty input, bytes, Vertex.
- show: path, open_browser=False, return value, title, content of the page.

## Runs

### 01-tessellate-defaults.py
`tessellate(Cylinder(10, 20))`: `Mesh(128 vertices, 252 triangles)`; `vertices` (n,3) float64,
`triangles` (m,3) int64, `normals` (m,3,3) float32 unit corner normals. Vertices are shared
(128 unique positions = 128 vertices), the mesh is closed (every edge used twice), outward
(volume > 0). 64 segments around. Area 1883.43 vs 1884.96, volume 6273.03 vs 6283.19 (-0.16 %).
`Shape.mesh()` = `tessellate()`.
- 📌 doc: default tolerance = 0.1 % of the bbox diagonal (0.0346 here); the kernel used 64
  segments, chord error 0.012, finer than needed.

### 02-tolerance-angle.py
Table in `files/02-tolerance-angle-table.json`. Cylinder r10: tol 1 / angle 45 -> 16 segments
(chord 0.19); tol 1 / angle 15 -> 32; default -> 64 (chord 0.012); tol 0.01 -> 128; tol 0.001 ->
411 segments (chord 0.00029), 1640 triangles. Angle 5 -> 128 segments whatever the tolerance >= 0.01.
- 📌 doc: both limits apply, the stricter wins; angle 45 vs 15 rarely matters at the default
  tolerance; angle 5 quadruples the triangles.
- Sphere r10: default 3584 triangles (volume -0.41 %); tol 0.001 -> 133984 triangles (-0.013 %).
- Box: always 12 triangles (planar faces ignore the tolerance).

### 03-sphere-deviation.py / 04-sphere-slivers.py
Real deviation of sphere meshes, sampled on each triangle:
default: max 0.103 (tol 0.035); tol 0.01 / angle 15 or 45: **0.678** (68 x tol), long sliver
triangles (7.2 mm edge) along the seam (azimuth ~ -2 deg) near the poles (z = +-9); tol 0.01 /
angle 5: 0.006 (ok); tol 0.001: 0.0014. The meshes are closed (0 open edges).
- 📌 doc + TODO MEDIUM: the tolerance is not a guarantee on spheres near the seam/poles; a
  smaller `angle` (5) removes the slivers.
![sphere](files/03-sphere-deviation-sphere-001-45.png)

### 05-mesh-inputs-booleans.py
- tessellate accepts Part, Sketch (normals +Z, volume 0), Face, Shell, ShapeList (merged into one
  mesh). A plain list -> `TypeError: cannot tessellate a list`; Edge/Wire -> `TypeError: cannot
  tessellate a Edge`.
- Mesh Booleans on Box(20) and Sphere(12): `&` volume -0.24 %, but `+` +31 %, `-` +171 % (!).
- Hand-built `Mesh(...)` or `import_stl` meshes -> `TypeError: mesh Booleans need meshes produced
  by tessellate()`. Empty intersection / coincident difference -> `Mesh(0 vertices, 0 triangles)`.
![bool](files/05-mesh-inputs-booleans-bool.png)

### 06-mesh-boolean-inspect.py / 07-mesh-boolean-faces.py / 08-mesh-boolean-cases.py
Box - Sphere(12) as meshes: 336 open edges; the box faces stay whole (2 triangles, 400 mm²
each, should be 261.8) while the inner sphere part is added. 9 cases x 3 ops vs exact Booleans:
correct only where no face of the result gets a hole (box-box offset: exact; sphere - box:
-0.5 %). Box - cylinder through: +2.6 %, 64 open edges; off-diagonal cylinder: volume -749 (negative);
box - small box inside one face triangle: volume 0 (exact 7968); `&` of that: 7947 (exact 32).
- 📌 doc + TODO HIGH: mesh Booleans give silent wrong, open meshes. Do Booleans on exact parts,
  then mesh.
![diff](files/06-diff.png)

### 09-stl-export.py
- Binary by default: 80-byte header `smlibpy binary STL`, count, 50 bytes per triangle
  (7284 bytes for 144 triangles). ASCII: `solid smlibpy`, 4.6 x larger.
- Triangle counts for the bracket (hole r4): None/1/0.1 -> 144, 0.01 -> 272, 0.001 -> 1048;
  volume error +1.4e-4 / +3.5e-5 / +2.1e-6. Angle 45/15 -> 144, 5 -> 528, 1 -> 2080.
- 📌 doc: several parts -> one mesh in the file (no solids, no names). Normals in the file
  match the winding. A sketch writes 2 triangles.
- `tolerance=0`, `tolerance=-1`, `angle=0` are accepted silently and give the default 144 (TODO LOW).
- Empty list -> `ValueError: need at least one array to concatenate` (TODO LOW).
- 100000 mm from the origin: box comes back exact (float32 holds these integers).

### 10-stl-import.py
- `import_stl` welds corners at 1e-9 into shared vertices: a 3584-triangle sphere comes back with
  1794 vertices (as tessellated), closed. `normals` is None.
- Binary keeps float32 (7 digits); ASCII writes `%e` (7 digits): y = 0.00123405 came back
  0.001232 in ASCII.
- Two touching boxes: corners welded across parts, 5 edges used > 2 times (non-manifold).
- Binary file whose header starts with `solid`: read correctly (size check first).
- 📌 doc + TODO LOW: truncated binary file and a text file `hello world` -> `Mesh(0 vertices,
  0 triangles)` with no error.
- STL meshes cannot take part in mesh Booleans.

### 11-gltf.py
- GLB: magic `glTF`, version 2, one JSON + one BIN chunk. One node + mesh per shape, named
  `name` or `<type>_<i>` (`part_3`, `edge_4`, `sketch_5`, `mesh_1`), plus a root node `z-up`
  rotating -90 deg about X.
- 📌 doc: coordinates in mm unchanged (bracket -30..30); glTF defines meters, so viewers that
  honour units (Blender) show a 60 m part (TODO MEDIUM).
- Triangles non-indexed (3 vertices per triangle, no `indices`), with normals. Edges as a
  `LINES` primitive (mode 1), seams left out (cylinder: 2 circles of 128 segments).
- Colors: own color, otherwise a palette by position (`#7c93b5`, `#d9925a`, `#79ad73`, ...;
  the index counts colored bodies too: unnamed second part got `#d9925a`). Edges `#1f2328`.
  Lines (Edge/Wire) orange `#d9480f`; Vertex -> POINTS (mode 0).
- `edges=False` -> 1 primitive per mesh (bracket alone: 11268 bytes).
- `export_gltf(..., edge_color="red")` works; `export_glb(..., edge_color=...)` -> TypeError (TODO LOW).
- `.gltf`: buffer embedded as base64 data URI.
- Empty list -> a valid empty 300-byte GLB, no error.

### 12-obj.py
- `o <name>` per shape (`part_<i>` when unnamed, also for meshes), `v` with 9 significant digits,
  `f` 1-based global indices; no normals, no colors/materials, no groups.
- Parsed back by hand: 80 vertices, 156 triangles, volume within 1.1e-4.
- tolerance/angle as for STL (144 -> 272 / 528).
- Empty list -> a file with only `# smlibpy`. Edge -> `TypeError: 'Edge' object is not iterable`.
- `load(.obj)` -> `KernelError: load failed`.

### 13-render.py
- Returns PNG bytes (`\x89PNG`), default 800 x 600; `path=` also writes the file.
- All named views, `sheet` and direction tuples work; `(0, 0, -1)` = `bottom` (same bytes size).
  In `bottom`, +X is still to the right (Y mirrored).
- `sheet`: front | top / right | iso at one scale, labels drawn. Odd sizes work (401 x 301).
- `edges=False` drops all lines; `background="#202020"` works; `tolerance=1.0` gives a faceted
  silhouette.
- Mixed input: Sketch, Edge (line), Spline, Mesh, Face, Vertex (silently skipped), nested list.
- Pictures are scaled to fit: a 10 and a 20 box give identical bytes.
- Errors: no shapes or only a Vertex -> `ValueError: nothing to render`; `view="diagonal"` ->
  `KeyError: 'diagonal'`; `size=(0, 0)` -> `ZeroDivisionError`; `view=(0, 0, 0)` -> no error,
  NumPy RuntimeWarnings and an empty picture (TODO LOW).
- Time: sphere 800 x 600 0.26 s, 1600 x 1200 1.06 s.
![sheet](files/13-sheet.png) ![mixed](files/13-mixed.png) ![variants](files/13-montage.png)

### 14-show.py
- `show(part, path=..., open_browser=False)` writes a 29 kB self-contained HTML page and returns
  `path` unchanged (str or Path). Title `smlibpy` by default, `title=` is HTML-escaped. HUD line:
  `<b>Part</b> · 7 faces · volume 18 797.9 · 60 × 40 × 8`; several shapes: `<b>4 shapes</b>`.
- three.js 0.170.0 from cdn.jsdelivr.net (needs internet to display); the model is embedded as GLB.
- Accepts Part, Sketch, Spline, Mesh together; `edges`, `tolerance`, `angle` (default 12, not 15).
- `Shape.show(**kw)` same; `_repr_html_` returns an iframe (notebook display).
- No path + `open_browser=False` -> a temp file `smlibpy-*.html` is written and returned.
- `show()` with nothing writes an empty viewer page, no error.

### 15-show-notebook.py
IPython is not installed in the venv; notebook branch not run. From the code: inline display only
when `path is None`; with a path the file is written (and the browser opened unless
`open_browser=False`), even in a notebook.

### 16-mesh-measures.py
- 📌 doc: `Mesh.center()` is the bbox center, not the centroid: cone center exact z=-5, mesh
  `center()` z=0 (TODO LOW). Volume centroid by hand: z=-5.
- Cone tol 0.01: volume -0.04 %, area -0.02 %.
- Open meshes: `volume` depends on the position (top face at z=5 -> 166.7, at z=15 -> 500).
  Reversed winding -> negative volume.
- `Mesh` is mutable (`m.vertices += [10, 0, 0]` moves it), has no `name`/`color`.
- `tessellate(ShapeList)` gives a merged mesh without kernel data: mesh Booleans on it raise
  `TypeError: mesh Booleans need meshes produced by tessellate()`.

### 17-doc-examples.py
All examples of the mesh docs, run in `files/`. STL tol 0.01: `Mesh(136 vertices, 272 triangles)`,
volume 18798.526 vs 18797.876. `scale(0.001)` keeps names. OBJ objects `bracket`, `cover`.
`render` returns `b'\x89PNG'`, 9666 bytes. `show` returns the path. `(Box(20)-Sphere(12)).mesh(0.01)`:
`Mesh(3816 vertices, 7648 triangles)`, volume 1620.01 vs 1616.28, area 2475.65 vs 2475.40.
![under](files/plate_under.png)

### 18-gltf-size.py
`.gltf` is 1.32 x the `.glb` (edges on or off). Bracket glb: 18080 bytes with edges, 11268
without. Sphere r10 glb: 259 kB (3584 triangles, default), 1.0 MB (0.01), 9.6 MB (0.001):
about 72 bytes per triangle.

### Coverage (meshes, STL, glTF, OBJ, render, show)
- [x] ran successfully: all ten APIs
- [x] every parameter: tolerance, angle, ascii, edges, edge_color, path, view (all names, sheet,
  tuples), size, background, title, open_browser
- [x] defaults measured: tolerance 0.1 % diag (01), binary STL (09), size 800 x 600 (13), title (14)
- [x] edge/error cases: empty lists, Edge/Wire/Vertex, junk STL, bad view, zero size, zero direction
- [x] realistic use: assembly to glb/obj/stl, sheet render, viewer page
- [x] spatial claims by numbers (bbox in glTF accessors, z-up rotation, chord errors, volumes)
- [ ] notebook branch of `show` (IPython not installed); viewer page not opened in a browser

### 19-shape-kinds-matrix.py
Vertex, Edge, Wire into every writer: STEP, `.smb`, STL, OBJ -> `TypeError: 'Edge' object is not
iterable` / `'Wire' ...` / for a Vertex `'float' object is not iterable` (TODO LOW #8). glb and
`show` accept all three (lines and points).

### 20-mesh-export-gltf.py
`Mesh.export("x.gltf")` works (a mesh has no edge lines); `show(mesh, path=...)` works.
