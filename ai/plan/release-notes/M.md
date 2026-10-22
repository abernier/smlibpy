# Lane M: meshes, drawings and rays (MESH-APEX, GLTF-COLOR, M3-M13)

Everything applies to smlibpy (Python) and smlibwasm (JavaScript) alike unless marked "wasm".

## Fixed

- Normals at the apex of a cone are right (MESH-APEX). The tessellator gave every triangle corner
  at a point where the surface has no normal one normal: at the apex of `Cone(10, 0, 20)` the one
  of a single line of the cone, up to 127 degrees off the surface beside the corner (113 on a
  tilted cone, 72 on a revolved spline nose, 19 on a flat cone). Such a corner now gets the
  surface's normal a little inside its triangle: within 0.02 degrees on all of them. Poles of
  spheres keep their normals. Shading in glTF, the viewer and `render` no longer shows a dark
  wedge at the tip of a cone.
- glTF colors are linear, as the format defines `baseColorFactor` (GLTF-COLOR). The sRGB values
  of colors were written as they were, so viewers (three.js, Blender, the HTML viewer of `show`)
  showed them lighter than asked: the default `#7c93b5` is now written as (0.2016, 0.2918,
  0.4621). Edge and curve colors too.
- Mesh points keep double precision (M3). They went through SmPyLib's float32 extraction (and its
  copy in the wasm): 7 digits, so a sphere 100 m from the origin was meshed 3.8 times the
  tolerance off, and a box 1 km out had mesh volume 1107.72 for 1113.12. `Mesh.vertices` (already
  float64) now hold the kernel's points exactly; `Mesh.volume`, `area`, `bbox()`, `raycast`, mesh
  Booleans of round-tripped meshes, OBJ and glTF follow. glTF positions (float32 by the format)
  are stored relative to the middle of each shape, whose node carries it as its `translation`, so
  a far part keeps its shape there too; OBJ writes 12 significant digits instead of 9. STL stays
  float32 by its format.
- `silhouette(direction)` returns the contour of the body (M4): the curves where its faces turn
  away from the viewer, and the edges between faces that face the viewer and faces that face
  away, all of it, seen or hidden. It returned the visible curves of the kernel's hidden-line pass:
  a box along (1, 1, 1) gave its 9 visible edges (180 mm) instead of its 6-edge outline (120 mm),
  a torus from the side half its contour (157.08 of 314.16), and which rim pieces came back was
  not consistent. It now also works on sheets (`Shell`), and arcs of one circle come joined (a
  sphere's rim is one `circle`).
- `parting_line` of a torus along -X works (it raised "a face still faces both ways after the
  split"): where the kernel's traced silhouettes leave such a face, the faces are split along
  those traced for the opposite direction (the same curves).
- `Part.raycast` no longer meshes the whole body again for every ray where the kernel's
  curve-face intersection fails (a ray along a cylinder's axis, along a plane): the faces' meshes
  are made once per body and kept with it (M5).
- `bbox()` and `center()` of an empty mesh (the result of `a - a`, a disjoint `&`) raise
  `ValueError: an empty mesh has no bounding box`, as in smlibwasm; Python raised numpy's
  "zero-size array to reduction operation minimum which has no identity" (M11).
- OBJ files carry the mesh's normals (M12): each corner names its normal (`f 3//7 ...`, each
  distinct normal once). Without them readers smoothed a box across its edges, or shaded curved
  faces flat.
- Mesh Boolean results have normals (M12): each triangle takes the corner normals of the operand
  triangle it lies on (turned on the inside of a cut), so `a.mesh() - b.mesh()` shades like its
  operands (on a sphere's part of a union the normals are radial to 3e-8). Before, the result had
  none, and was shaded flat. Meshes without normals (`import_stl`, `Mesh(...)`) still give a result
  without.
- smlibpy._core's `PolyBrep.ray_intersection` (SmPyLib's binding) raised "Could not activate
  keep_alive!" for every ray that hit (it returned the hit polygon without a parent). It is bound
  again with the mesh as the parent, and returns its hits (M13; Python only, the binding is not in
  smlibwasm). `third_party/patches` covers SMLib and SM_API sources, not SmPyLib's bindings;
  docs/kernel.md lists it.

## New

- Hidden lines: `outline(plane, hidden=True)` returns `(visible, hidden)`, the lines of a view
  that lie behind the body too (M4). Each line once: hidden pieces under visible lines are cut
  away, edges seen end-on, slivers and seams of round faces are dropped. `tangent_edges=True`
  draws the edges between tangent faces (fillet tangent lines). From the kernel's hidden curve
  removal (SmHCR), which SM_API kept only the visible half of: `ext.hidden_lines(brep,
  plane_point, plane_normal, seams, smooth_edges)` (src/cpp/hidden_lines.cpp; wasm
  `ext__hidden_lines`, js/cpp/bind_drawing.cpp). TypeScript: `outline(plane, { hidden: true,
  tangentEdges })`.
- `drawing_views(part, views=("front", "top", "left"), *, projection="first-angle", hidden=True,
  tangent_edges=False, gap=None)` -> `list[DrawingView]`: the views of a part laid out in the XY
  plane in first-angle (ISO) or third-angle (ASME) projection; `DrawingView(name, direction,
  visible, hidden)`. TypeScript: `drawingViews(part, views, options)`, class `DrawingView`.
- `export_dxf` writes drawing views on the layers VISIBLE and HIDDEN, the hidden layer with a
  DASHED linetype (3 mm dashes, 1.5 mm gaps).
- SVG: `export_svg(shapes, path, *, margin=None, stroke=None)` and `smlibpy.drawing.to_svg`
  (TypeScript `exportSvg`, `toSvg`), and `export(shapes, "x.svg")`: drawing views (hidden lines
  dashed), edges, wires, sketches; lines and circular arcs exact; prints at true size.
- `Mesh.raycast_many(origins, directions)` and `raycast_many` of parts, shells and sketches
  (TypeScript `raycastMany`): the first hit of each of many rays, `None` for a miss (M5). Meshes
  go through the kernel's grid ray tracer (0.01 ms a ray on 250 000 triangles, where `raycast`
  takes 36 ms; 0.8 s to build the tracer per call). Bodies trace through a mesh made once per body
  and move each hit onto the exact face the mesh meets first (a plate with 144 holes: 0.05 ms a
  ray against 1 ms for `raycast`); where that face is missed there, the ray is cast exactly.
  `ext.mesh_first_hits`, `ext.body_first_hits` (src/cpp/rays.cpp, wasm in js/cpp/mesh.cpp).
- `ext.poly_arrays(poly, face_varying_normals=False, brep=None)`: a kernel mesh as arrays with
  float64 points (src/cpp/poly_arrays.cpp; wasm `ext__poly_arrays`). `PolyBrep.to_numpy_arrays`
  (SmPyLib) and `k.poly_mesh` (wasm) stay as they were, float32.
- `Mesh.decimate(fraction=None, *, triangles=None, tolerance=None)` (TS `decimate(fraction, {
  triangles, tolerance })`): fewer triangles by the kernel's quadric decimation (SmPolyDecimate),
  which keeps a closed mesh closed and an open one's border (M6). `fraction` is the share of the
  triangles to remove, `triangles` about how many to leave, `tolerance` the largest distance from
  the mesh: smlibpy decimates step by step and measures the distance itself at the points of both
  meshes and the middles of their triangles (the kernel's "maximum error" is an accumulated
  quadric value: 0.05 took a sphere of radius 10 to 390 triangles, 5.3 off). `Sphere(10)` at
  0.001 (136 872 triangles): `decimate(0.9)` 13 674 triangles within 0.01 in 2 s,
  `decimate(tolerance=0.01)` about 12 700 in 6 s. The result's normals are its own (crease angle
  30 degrees). The kernel's flaws are repaired: folds (triangles on the same points back to
  back), pinched edges of four triangles, folded slivers (edge flips, sliver merges), and where
  that is not enough the decimation runs again in steps. It raises `ModelingError` where a
  closed mesh would come back open, an open mesh with another border, or the kernel collapses the
  mesh far below the count asked (a coarse cone: 4 triangles at 5 %).
- `Mesh.section(plane) -> ShapeList[Wire]` (M7): where a plane cuts a mesh, chained into closed
  loops (outer counterclockwise seen from the plane's normal, holes clockwise; open polylines for
  open meshes), straight runs joined; a plane through a flat part of the mesh cuts it just
  beside that, on the side where the cut encloses more (the kernel's `section_plane` left an
  incomplete loop there). `Mesh.slices(step, axis=Z)` and `Part.slices(step, axis=Z)` (a
  `Sketch` per layer): sections in the middle of layers `step` thick from the lowest point up.
- `Mesh.to_part(max_faces=5000)` and `Part.from_mesh(mesh, max_faces=5000)` (TS `toPart`,
  `Part.fromMesh`): a faceted part of a closed mesh by `SmBrep::CreateFromPolyBrep`, triangles in
  one plane merged into one face first (a box with a bore meshed at 0.01: 102 faces), checked
  valid and of the mesh's volume (M8). More faces than `max_faces` raise `ModelingError`
  (Booleans get slow: 14 080 faces took 40 s), as does an open mesh. 3584 triangles convert in
  0.2 s where faces built one by one took 3 s.
- `Mesh.fill_holes()` and `Mesh.repaired() -> (Mesh, report)` (M9): holes closed (the kernel's
  triangulation of each hole, ear clipping or a fan where it fails; holes that touch at a point
  one by one), and for `repaired` first points on each other merged, triangles without area and
  repeated ones left out, triangles turned to face as their neighbours (a closed piece outward).
  The report counts `merged_vertices`, `removed_triangles`, `flipped_triangles`, `filled_holes`,
  `open_holes`, `open_edges` (TS camelCase keys: `mergedVertices`, ...).
- `max_edge=` on `tessellate`, `Shape.mesh`, `export_stl`, `export_obj`, `export_glb`,
  `export_gltf`, `export_usd` and `gltf_document` (TS `{ maxEdge }`): the longest edge a triangle
  may have (M10). `Box(100, 100, 2) - Cylinder(5, 10)` at 0.1: 144 triangles with edges of 100;
  `max_edge=10`: 706, all under 13. With it the kernel's grid meshes every face; a body with a
  twisted face that the grid then misses by more than twice the tolerance gets a
  `RuntimeWarning` saying how far (`Box(10, 10, 40).twist(90)` at 0.01, `max_edge=5`: about 0.13).
- `Mesh.mass_properties(density=1.0) -> MassProperties` and `Mesh.centroid` (M11): mass, center
  and inertia of what a closed mesh encloses, exact for its triangles (equal to the kernel's
  `SmApiPolyBrepComputeMassProperties`: volume to 1e-12, inertia to 1e-9); an open or inward mesh
  raises `ModelingError`.
- C++ (src/cpp/mesh_tools.cpp, wasm js/cpp/bind_mesh_tools.cpp): `ext.mesh_nearest_points`
  (nearest points on a mesh, a tree of boxes), `ext.crease_normals`, `ext.decimate_triangles`,
  `ext.repair_triangles`, `ext.brep_from_triangles`.

## Behaviour changes

- `silhouette()` returns the whole contour, not the visible curves (see Fixed). Scripts that took
  the visible outline from it, or picked pieces by index, change:

  ```python
  # before: the visible half of a torus's contour, in pieces, mixed with boundary edges
  side = Torus(20, 5).silhouette((1, 0, 0))            # 157.08 mm
  # after: the contour, seen and hidden (314.16 mm); the visible lines of the view:
  seen = Torus(20, 5).outline(Plane.YZ)                # projected onto the plane
  seen, hidden = Torus(20, 5).outline(Plane.YZ, hidden=True)
  ```

  A box seen from +Z gives its top edges as before. Curves of spheres, cylinders and tori come as
  `circle` and `line` pieces where they were `bspline`; a sphere's rim is one circle.
- glTF files: `baseColorFactor` holds linear values (`#7c93b5` -> 0.2016, 0.2918, 0.4621), and
  each node a `translation` (the middle of its shape) with positions relative to it. Readers that
  take the accessors' positions without the node transform get them off by that translation:

  ```python
  # before: positions in model coordinates
  pos = accessor_positions(doc, mesh=0)
  # after: add the node's translation
  pos = accessor_positions(doc, mesh=0) + doc["nodes"][0].get("translation", [0, 0, 0])
  ```

  Shapes centered on the origin get no translation. Colors read back from a file are linear:
  `srgb = 1.055 * c ** (1 / 2.4) - 0.055` (or `12.92 * c` below 0.0031308).
- OBJ coordinates have 12 significant digits (were 9): `v 1.5 0 0` stays, `v 3.14159265`
  becomes `v 3.14159265359`.
- Mesh points differ from before in the last digits (float64, not float32 widened): meshes
  near the origin change by less than 1e-6 mm. Corner normals at the apex of cones change (see
  Fixed).
- glTF triangles are indexed (M12): each distinct (point, normal) pair of the corners is written
  once and the triangles as an `indices` accessor (16-bit, 32-bit above 65 535 pairs); a sphere
  of radius 10 at 0.001 is 3.3 MB where it was 9.6 MB. Readers that took `POSITION` as three
  corners per triangle go through the indices now (three.js, Blender and every glTF viewer do):

  ```python
  # before: corners in triangle order
  tris = positions.reshape(-1, 3, 3)
  # after
  acc = doc["accessors"][prim["indices"]]
  index = np.frombuffer(buf, np.uint16 if acc["componentType"] == 5123 else np.uint32,
                        acc["count"], doc["bufferViews"][acc["bufferView"]]["byteOffset"])
  tris = positions[index].reshape(-1, 3, 3)
  ```
- OBJ faces name normals: `f 1 2 3` is now `f 1//1 2//1 3//1`, with `vn` lines (see Fixed).
  Readers that split face entries on spaces and took the whole entry as a number:

  ```python
  # before
  a, b, c = (int(x) for x in line.split()[1:])
  # after
  a, b, c = (int(x.split("/")[0]) for x in line.split()[1:])
  ```
- Mesh Boolean results have `normals` (were `None`) where an operand has them (see Fixed):

  ```python
  # before: result.normals is None, so code fell back to triangle_normals
  n = result.normals if result.normals is not None else result.triangle_normals
  # after: corner normals (m, 3, 3); the flat ones are still result.triangle_normals
  ```
- `Mesh.bbox()`/`center()` of an empty mesh raise `ValueError: an empty mesh has no bounding
  box` (was numpy's ValueError about a zero-size array): code that caught `ValueError` still does.
- tools/gen_js_options.py output: `toStl`, `exportGltf` and the other mesh exports take `maxEdge`
  (tests/test_js_options.py updated).

## Not done

- `Part.raycast_many`: a ray that grazes a curved face within the mesh's tolerance (1e-4 of the
  body's size) of its outline can come out a miss where `raycast` finds where it touches; the
  tracer is built once per call (not kept between calls). The kernel's grid stays 10 x 10 x 10:
  finer grids made no ray faster (the tracer sorts the triangles into a tree as well).
- `drawing_views` draws one part (or shell): no dimensions, title block or section views, and no
  hiding between several parts (fuse them, or draw each).
- `Mesh.decimate`: the kernel's decimation can leave a few folded slivers that neither flips nor
  merges undo (a sphere of 56 000 triangles taken to a tenth: 6 of 5590, each about a thousandth
  of the mean area), and its counts differ by a few triangles from run to run (it breaks ties in
  an order that depends on memory). Meshes of long thin triangles (a coarse mesh of a cone) are
  refused rather than decimated. `tolerance=` decimates several times (6 s for 137 000
  triangles). Edges sharper than 30 degrees are features to the kernel and the crease angle of the
  result's normals; neither can be set.
- `Mesh.fill_holes` fills a hole with a patch across it (a lid on a sphere without its cap), not
  the surface that was there; meshes that cross themselves stay crossed.
- `Mesh.to_part` merges only triangles in one plane; curved regions stay one face per triangle
  (no fitting of surfaces to meshes).
- `max_edge` cannot be combined with the halving of twisted faces (the kernel's halving then
  divides the faces down to a thousandth): it warns instead. `max_aspect_ratio` is not exposed:
  it has no effect on the kernel's triangles.
