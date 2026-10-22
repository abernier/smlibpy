# Lane M: meshes, drawings and rays (batch 1: MESH-APEX, GLTF-COLOR, M3, M4, M5)

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

## Not done

- `Part.raycast_many`: a ray that grazes a curved face within the mesh's tolerance (1e-4 of the
  body's size) of its outline can come out a miss where `raycast` finds where it touches; the
  tracer is built once per call (not kept between calls). The kernel's grid stays 10 x 10 x 10:
  finer grids made no ray faster (the tracer sorts the triangles into a tree as well).
- `drawing_views` draws one part (or shell): no dimensions, title block or section views, and no
  hiding between several parts (fuse them, or draw each).
