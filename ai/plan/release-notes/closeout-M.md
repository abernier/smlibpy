# Close-out M: meshes, drawings and files

The "Not done" entries of area M of 0.5.0 (kernel plan M4, M5, M6, M8, M9, M10; files I6, I10, I11,
I12, I14, X2, X5, X9, X10, X12, X13, X14), triaged and closed out. Tests: `tests/test_closeout_M.py`
and `js/test/closeout_M.test.ts` (20 each).

## Triage

| Entry | Triage |
|---|---|
| M5: `raycast_many` misses rays that graze a curved face within the mesh's tolerance (a defect) | FINISH |
| M6: decimation leaves a few folded slivers | FINISH |
| M6: decimation has fixed angles | FINISH (`feature_angle=`) |
| M4: `drawing_views` draws one body | FINISH (a list of bodies, a small completion of the planned feature) |
| M4: no dimensions, no title block | LATER |
| M8: `to_part` merges only planar regions | LATER |
| M9: `fill_holes` lays a flat patch | LATER |
| M10: `max_edge` cannot be combined with halving | LATER |
| M10: `max_aspect_ratio` not exposed | LATER |
| X10: `export_step` of a list leaves an empty body out silently (a defect) | FINISH |
| X10: `export_glb([])` and `export_obj([])` write empty files (a defect) | FINISH |
| I6: `OFFSET_CURVE_3D` not read | FINISH |
| I6: edges given only as `PCURVE`s not read | FINISH |
| I10: mirrored assembly placements not read | FINISH (placements that scale too) |
| I10: moved copies not written as instances | LATER |
| I11: an offset of a whole sphere does not import | FINISH |
| I11: OpenCASCADE cannot read an offset whose basis has C0 knots | LATER |
| I12: coordinate systems written without color | FINISH |
| I14: IGES offset curves (130) not read | FINISH |
| I14: IGES not written; binary and compressed IGES; the other surface forms not read | LATER |
| X2: USD inherits, specializes and variant sets not composed | LATER |
| X5: circles written as NURBS on NURBS faces stay NURBS; other writers' ellipses not restored | LATER |
| X12: USD materials of faces, collection bindings, textures | LATER |
| X13: USD curves read as a Shell without faces, not written | LATER |
| X9: `.smp` placements, points and meshes; `.smb` name and color | LATER |
| X14: 4 of 557 corpus solids read back refused (a defect) | FINISH |
| X14: 2 of 585 corpus bodies refused by the writer (a defect) | FINISH |
| X14: the spring example read back refused (a defect, in lane IX's notes) | FINISH |
| X14: binary `.brep` writing, names and colors, curves and points outside faces | LATER |

## Finished

- **Rays that graze a curved face (M5).** `Part.raycast_many` (smlibwasm `raycastMany`) traced each
  ray through a mesh of the body, which lies inside convex faces by up to its tolerance (1e-4 of the
  size): a ray that passed the mesh just outside it, along a sphere's or a boss's outline, came out a
  miss or went on to the face behind, where `raycast` touches the curved face. Each ray is now
  followed through a tree of boxes around the triangles as well: where it passes within twice the
  mesh's tolerance of a triangle before the one it meets (or anywhere, for a miss), the body is
  asked exactly (rays from points on the surface leave out the triangles at their start). Rays across
  a sphere's outline (from 3 tolerances inside to 0.3 outside): 297 of 2000 answered otherwise than
  `raycast` before, 0 now; rays along a boss's outline with a ring wall behind: 50 of 400 before, 0
  now; rays across a cylinder's outline and past a boss before a wall: 0. Not slower: a plate with
  144 holes, 20 000 rays from above: 0.10 ms a ray (0.12 before); 3000 rays from points on a part's
  surface, outward and inward: 0.18 s each (0.29 s before). The shared distance routines (points,
  segments and triangles, Ericson) are in `src/cpp/triangle_geometry.h`, which the mesh tools use
  too.
- **No folded slivers after decimation (M6).** `Mesh.decimate` left triangles folded over their
  neighbours where the kernel's collapses pushed a point through them: spheres of 15 000 to 56 000
  triangles taken to a fifth, a tenth and a twentieth kept 3, 9, 3 and 13 such slivers in 4 of 9
  cases. What stays folded after the repairs of 0.5.0 is now collapsed: a corner of three or four
  triangles that a folded triangle has (a point pushed through, a sliver's tip) goes, its triangles
  made one or two along their outer edges, else the folded triangle's shortest edge whose collapse
  keeps the mesh a manifold and turns no triangle over (up to 64 passes). All 9 cases: 0 folds,
  closed, the counts asked (within 5 %).
- **`Mesh.decimate(..., feature_angle=30.0)` (M6)**, smlibwasm `decimate(fraction, { featureAngle
  })`: the angle (0 to 180 degrees) over which the triangles turn at an edge for it to count as a
  feature, which the kernel's decimation keeps longest (SmPolyDecimate's feature angle) and which
  stays sharp in the result's normals. It was fixed at 30: a cylinder's rims stay sharp at 30 and
  are rounded over at 120 (the cap's corner normals tilt by more than 20 degrees). `ValueError`
  (smlibwasm `RangeError`) outside 0 to 180.
- **Empty bodies and empty lists in the writers (X10).** `export_step([part, empty])` left the empty
  body out without a word; `export_glb([])`, `export_gltf([])` and `export_obj([])` wrote files
  without anything in them. `export_step`/`to_step` of a list with a body without faces raises
  `ValueError: export_step: the Part 'gone' is empty: it has no faces to write (a Boolean that left
  nothing?)` (a body of curves only: "its edges() are curves, which it writes as such"), also with
  `assembly=True`; the mesh writers of nothing raise `ValueError: export_glb: nothing to write` (each
  naming itself: `to_glb`, `to_gltf`, `export_gltf`, `to_obj`, `export_obj`), and no file is written.
  smlibwasm: `RangeError` with the same messages (`exportStep`, `toStep`, `exportGlb`, ...).
- **STEP offset curves and edges given as curves on surfaces (I6).** A body with an
  `OFFSET_CURVE_3D` or an edge whose curve is a `PCURVE` was left out ("curve type OFFSET_CURVE_3D,
  which is not supported"). Offset curves: of a line a line, of a circle about the reference
  direction a circle (exact); others the kernel's offset curve (`SmOffsetCurve`, the new
  `ext.offset_curve_3d`, both builds) over the whole basis, as a NURBS within 1e-9 of its size. Curves
  on surfaces: on a plane the curve of its kind (lines, circles, ellipses, B-splines); along a
  parameter line of a cylinder, cone, sphere or torus a line or circle; on a B-spline surface the
  kernel's curve on it (`ext.curve_on_surface`); otherwise a NURBS through 257 of its points within
  1e-9 of their size. A cylinder whose top circle is an offset of a circle of radius 3, a rational
  B-spline circle, a line in its parameters, its seam as a line in its parameters, a B-spline in its
  parameters; a box with an edge as a line in its plane's and in its B-spline face's parameters: all
  valid, volumes exact to 1e-9.
- **Assembly placements that mirror or scale (I10).** A `CARTESIAN_TRANSFORMATION_OPERATOR_3D` as an
  instance's placement (a functionally defined transformation; also non-uniform) is read: the body
  is built where it is defined and mirrored or scaled whole, as `mirror` and `scale` do (0.5.0 left
  it out: "mirrored assembly placements are not supported yet"). A bracket placed mirrored in x and
  30 along x: its mirror image exactly (no volume between them); scaled by 2: 8 times its volume.
  Frames and curves of `read_step` under a mirroring placement stay right-handed and keep their
  sense.
- **An offset of a whole sphere imports (I11).** A sphere written as an `OFFSET_SURFACE` of another
  sphere failed ("import STEP failed": the kernel does not close a solid of an offset face with the
  sphere's seam and poles; smlibwasm built one of a quarter of the volume). An offset of a plane,
  sphere, cylinder, cone or torus is that kind of surface; where the kernel cannot close a solid of
  the offset faces, or one of another volume than the same faces built on the surfaces they are,
  the latter is taken. A sphere of radius 8 offset by 2 and one of 12 offset by -2: the sphere of
  radius 10, exact, in both builds. Offsets that read before read as before (offset faces kept).
- **Drawings of several bodies (M4).** `drawing_views` (smlibwasm `drawingViews`) takes a list of parts
  and shells as well (an assembly): they are drawn together, side by side in one body for the
  kernel's hidden curve removal, so that each hides the lines of the others behind it (bodies that
  overlap are not cut where they meet). A cylinder in front of a box hides 10 of each of the box's top
  and bottom edges in the front view (hidden 20, visible 160); the views are laid out around the box
  of all of them. An empty list raises `ValueError` ("nothing to draw"), anything but parts and
  shells `TypeError`.
- **Colors of coordinate systems (I12).** `export_step` writes a `StepFrame`'s color (a curve style,
  as NX colors its coordinate systems; `read_step` read such colors already): a frame written with
  a color reads back with it. OpenCASCADE reads such files as before.
- **IGES offset curves (I14, entity 130).** A face bounded by an offset curve was left out ("curve
  entity 130 ... which is not supported"). An offset curve at one distance is the base curve moved
  along its tangent x the normal of its plane (as STEP's offset curves; OpenCASCADE reads a square
  whose side is such an offset of a line to the same area, 50), turned with a mirroring
  transformation: of a line a line, of a circle about the normal a circle, others the kernel's
  offset curve (as for STEP). A disk bounded by an offset of a circle of radius 3 by 2: 25 pi exact;
  of a rational B-spline circle: 25 pi within 1e-10. An offset whose distance varies (flags 2 and 3)
  is named in the warning of what is left out.
- **`.brep` files: what read back refused, what the writer refused (X14).** In the 448-file corpus,
  4 of the 557 solids written read back refused, and 2 of the 585 bodies were refused by the writer;
  now all 585 bodies are written (4 ms median, 41 ms p90, 5.5 s the slowest, a part of 2079 faces)
  and 557 of the 559 solids read back (99 % within 6e-6 of their volume, all within 1e-4); the
  other two had their faults as they were read from STEP (an edge of 9e-9 shorter than its
  tolerance; a vertex moved 0.05 off its edges), and the reader refuses them as it refuses any
  broken body (`check=False` reads them).
  - Reading: the bridge gives every edge, vertex and face of a body one tolerance, the largest of the
    file, which made edges shorter than it (fillet edges of 0.005 against 0.0112) read back as
    broken ("an edge of length -0.0153 ... its curve does not run from its start to its end"). Each
    edge, vertex and face now gets the tolerance its geometry needs (`usd_tighten_tolerances`, also
    for USD files: twice what 21 and 51 samples find of the curve against its faces' surfaces and
    curves and its vertices, never more than the file's), where the file's is larger.
  - Writing: each edge, vertex and face gets its own tolerance (twice what its curve keeps from its
    curves on faces and vertices, at least the body's size's), where the writer gave a body's largest
    to all (a part with one edge of 0.0112 had every edge at 0.0224, a sphere of radius 0.2 among
    them, which OpenCASCADE took for invalid).
  - A face narrower than its edges' tolerance (a sliver of 0.002 between edges 0.16 long, part 78)
    has no side its curves can tell: the writer's check takes its area as the curves give it.
  - Faces on spheres that hold one of their frame's poles inside an edge (a cap around the pole
    without a seam, part 12) are written in a turned frame, the face away from both poles (the same
    surface).
  - A loop whose edges end apart by up to the tolerance may overshoot a period by that much (an edge
    0.0009 long that ends 0.00036 past a cone's seam, part 12); the writer tries that only where no
    loop within one period closes, the check allows it, and the reader takes such a boundary for one
    turn.
  - The writer's check samples each edge at 128 points (the area of a crescent 0.016 wide between
    arcs 35 long came out negative from 16) and allows curves fitted within the tolerance to pass a
    surface's range by as much.
  - A whole sphere of B-splines (STEP files of other systems) was written inside out on the side
    of its seam it was written on: both sides are tried.
  - The spring example (`examples/spring.py`) read back refused (a gap of 0.8): the reader boxed a
    plane's boundary by 24 points along each edge, which missed 0.8 of the long cut end (51 long,
    2.4 wide), and the plane's range then did not hold the face (its curves were made off the edge).
    It takes 256 points, the control points of the B-spline spans the edge takes and a thousandth
    of the box more on each side now: the spring reads back within 2e-7 of its volume, the bottle example's gap of 0.0076 is gone,
    and so is a gap of 0.57 that one corpus solid read back with.
  - OpenCASCADE (OCP 8.0) takes 582 of the 585 written bodies for valid: the sheet that crosses
    itself in its STEP file (as before), and two bodies OpenCASCADE takes for invalid in their STEP
    files too (part 12's solid with 16 cavities; a diagnostic sheet with gaps of 4 mm, which passed
    before only because every tolerance was written as 17 mm). 541 of the 558 bodies it measures
    have its volume within 1e-5 of smlibpy's, the others within 3.4e-4, as before (where smlibpy
    and OpenCASCADE measure the STEP files themselves apart).
  - Checked by hand (OpenCASCADE is not a test dependency); the tests cover the tolerances read and
    written, the spring and a cut sphere.

## Blocked

None.

## Later

- **M4: dimensions and a title block.** The plan's `drawing_views(part, views, projection)` makes
  the views with their visible and hidden lines; dimensions and title blocks are drawing features
  beyond it.
- **M8: non-planar regions in `to_part`.** The plan asked for coplanar merging; recognizing
  cylinders or free-form regions in a mesh is surface fitting.
- **M9: a curved patch in `fill_holes`.** The plan asked for `fill_holes` and `repaired`; the kernel's
  `FillLaminaHoles` lays a flat patch, and a faired patch is a new algorithm.
- **M10: `max_edge` with halving, `max_aspect_ratio`.** The plan asked for `max_edge=` with a warning
  where it forces the grid on a twisted face, which is there; the halving is the kernel's and takes
  no longest edge, and the kernel's `max_aspect_ratio` does not change its triangles (measured in the
  review), so exposing it would promise what it does not do.
- **I10: moved copies as instances.** The plan asked for shared bodies instanced; a moved copy is a
  new body, and knowing that it is a copy needs provenance kept through every move.
- **I11: offsets of C0 bases for OpenCASCADE.** The file is exact and valid STEP (`import_step` and
  other readers take it); OpenCASCADE needs a C1 basis for an offset. Writing a fitted face instead
  (the plan's alternative) gives up exactness; `export_step(part.to_nurbs(), ...)` writes NURBS.
- **I14: IGES writing, binary and compressed IGES, more surface forms.** The plan's item is a
  reader; ruled surfaces between conics, composite generatrices, untrimmed 120/122 faces and
  boundaries only in the parameters of analytic surfaces are further entity forms (each named in the
  warning of a body left out).
- **X2: inherits, specializes and variant sets.** The plan asked for placement, units, up axis,
  sublayers, references and payloads.
- **X5: circles on NURBS faces and other writers' ellipses.** The plan's reader and writer changes
  are there; a face's UV curves follow the NURBS parameters, which the schema's circle does not keep,
  and the kernel's `CreateAnalyticCurve` knows lines and circles only.
- **X12: face materials, collection bindings, textures.** The plan asked for per-body colors from
  material bindings and `export_usd(materials=True)`.
- **X13: USD curves.** The plan asked for warnings and a clear TypeError.
- **X9: `.smp` placements, points and meshes; `.smb` name and color.** The plan asked for names and
  colors in `.smp` or `.smb`; `.smp` has them.
- **X14: binary writing, names and colors, curves and points outside faces.** The plan asked for the
  bridge's bodies in and out; the format has no names or colors (OpenCASCADE's XCAF documents do),
  every OpenCASCADE tool reads ASCII, and wires and points outside faces are counted in a warning.

## Behaviour changes

- `export_step` and `to_step` of a list that holds a body without faces raise `ValueError` (smlibwasm
  `RangeError`) where the body was left out of the file without a word. Leave such bodies out
  yourself:
  ```python
  export_step([b for b in bodies if b.faces()], "out.step")   # 0.5.0 left the empty ones out itself
  ```
- `export_glb([])`, `export_gltf([])`, `export_obj([])` (and `to_glb`, `to_gltf`, `to_obj`) raise
  `ValueError: export_glb: nothing to write` where they wrote a file with nothing in it. The STEP
  writer's "nothing to write" now names itself (`export_step: nothing to write`, `to_step: ...`);
  code that matched the old message with `match="nothing to write"` still matches.
  ```python
  if shapes:
      export_glb(shapes, "scene.glb")
  ```
- `import_step` and `read_step` read bodies they left out with a warning: those with offset curves
  (`OFFSET_CURVE_3D`), edges given as curves on surfaces (`PCURVE`) and instances placed by a
  transformation that mirrors or scales; a file can give more bodies than before. IGES bodies with
  offset curves (130) are read too.
- A closed STEP shell with offsets of planes, spheres, cylinders, cones or tori is built twice (as
  offsets, and on the surfaces they are), and the second is taken where the first is no solid or has
  another volume; such imports take longer.
- `.brep` files: each edge, vertex and face is written with a tolerance of its own (most at the
  body's size's, 2e-5 for a part of 10 mm), where every one had the body's largest; files differ from
  0.5.0's in those numbers. Bodies read from `.brep` and USD files get the tolerances their geometry
  needs where the file's one tolerance is larger: the kernel's check can now report a gap that the
  large tolerance covered (as a warning; `check=True` refuses only gaps over 1e-3 of the size).
- `Part.raycast_many` casts a ray exactly (as `raycast`) where it passes within twice the mesh's
  tolerance of the body's mesh: such rays cost what `raycast` costs; the hits are `raycast`'s.
- `drawing_views` takes a list of bodies; it raised `AttributeError` for one.
- `Mesh.decimate` collapses triangles that stay folded: a result can hold a few triangles fewer
  than in 0.5.0.
- `export_step` writes the color of a `StepFrame` (a `STYLED_ITEM` with a curve style on its
  `AXIS2_PLACEMENT_3D`) where it left it out.
