# Closeout K1: Booleans, cells and topology

What the 0.5.0 notes left under "Not done" for Booleans, cells and topology (B*, T*, and C1's
far-apart faces), triaged: finished, blocked by the kernel, or later. Everything applies to smlibpy
(Python) and smlibwasm (JavaScript) alike unless marked; the C++ is shared (`src/cpp`,
`third_party/patches`). Tests: `tests/test_closeout_K1.py`, `js/test/closeout_K1.test.ts`.

## Finished

- **A torus touching a plate at a point no longer kills the process.** `(Box(20, 16, 4) -
  Sphere(6).rotate(X, 90).translate(1.4007, 0, -1.5863)) & Torus(6, 2.5).rotate(Y, 90).translate(7.5,
  0, 10.5)` exited with 139 (smlibwasm trapped) in every run. AddressSanitizer located it in
  `SmTopologyIntersector::DeleteFaces`: two Vertices of the faces a Boolean deletes ended up in one
  vertex Shell (each Vertexuse naming it, the Shell listing one), `SmBrep::DeleteVertex` deleted the
  Shell with the Vertex it lists, and deleting the other read the freed Shell (`SmVertexuse::GetShell`).
  Kernel patch: those other Vertices are deleted first. The intersection is the empty part (they
  touch at a point), the union 1616.2075 (the plate's 875.9872 plus the torus' 740.2203), the cuts
  the operands, in both builds; AddressSanitizer reports nothing for any of them.
- **A union that gives back one operand although the other reaches out of it is caught.**
  `(Cylinder(5, 5) + Box(20, 4, 16).rotate(X, 90).translate(0, -3, -0.5)) + Cylinder(2,
  12).translate(2, -2.3693, 3.5)` gave 1358.54, the first operand with two vertices imprinted; now
  1446.6121 (OpenCASCADE 1446.612107). A union holds every point of its operands' surfaces, and a cut
  none of its tools' inside it: where the result may be an operand given back (as many faces, its
  vertices among the result's) or an operand's box reaches out of the result's, these points are
  classified against the result; a result whose surface reaches out of the operands' boxes (a cut out
  of the part's) is refused. A refused union or intersection of one tool is tried again the other way
  round (checked as the first try, against the operands' volumes and with the gaps between its faces
  measured), after the NURBS retry of B10. Found on the way: `Cylinder(2, 12) - Cylinder(1.5,
  30).rotate(Y, 90).translate(1, -0.5, 2.4787)` (fuzz csg-8-110 D) returned a body of no volume that
  reached to x = 16 (`is_valid()` False, no error): now `ModelingError` "the kernel returned a result
  that is partly outside the part". Chains of Booleans still integrate nothing (the test of it holds).
- **The deleted ProtoEdge read in `ResolveOverlappingProtoEdges` is patched.** `SplitIntersectingProtoEdges`
  combines two ProtoEdges and deletes one, and `CombineProtoEdge` moved only the deleted one's own
  overlap list: other ProtoEdges, and the coincidence lists of ProtoFaces, kept pointing to it, and
  `ResolveOverlappingProtoEdges` read it when it gathered a group (the AddressSanitizer report of the
  0.5.0 notes, from the extended offset's `PiecewiseMerge`, 1 to 3 crashes in 100 runs of
  `test_offsets_that_read_freed_kernel_memory_fail`). The same happened when a resolved group was
  deleted: a group is gathered along the lists one way only, and the upper piece of a split copies its
  parent's lists, so ProtoEdges outside the group listed its members. Kernel patch: a deleted
  ProtoEdge is taken out of every list, and the ProtoEdge that took its EdgeDefinitions listed in its
  place. Instrumented, the guard, fillet and lane BT tests removed 19 stale entries, the fuzz seeds 7
  and 8 364 (and 2 from the lists of ProtoFaces). With the lists right, a ProtoEdge that
  `CombineProtoEdge` had kept became a member of an overlapping group and was deleted while its end
  ProtoVertices still listed it a second time (`CombineProtoEdge` adds it there again, and
  `AddProtoEdge` adds "even if already there"): `FindProtoEdge` read it (AddressSanitizer: a read of
  freed memory in `SmProtoEdge::IsSameProtoEdge`, in every run of the extended offset of
  `Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)` by 6; 0 on 5c7666f, where
  that ProtoEdge was never deleted). A deleted ProtoEdge now leaves every list of a ProtoVertex too,
  as often as it is listed. AddressSanitizer reports nothing in this code over the sanitizer job's
  tests and the fuzz seeds (the one report left in the fuzz run is the known one of the fillet
  executive, fuzz case fillet-7-185, outside this area).
- **`smlibpy._core.boolean_with_curves` no longer hands out freed edges.** usd-brep's binding of
  `SmApiBooleanWithCurves` returned common edges that `BooleanPostProcess` had deleted, and
  pybind11 read them (`Box(10, 10, 10)` + `Box(10, 10, 5).translate(5, 0, -2.5)` killed Python). The
  kernel function is left as it is (smlibpy and smlibwasm do not call it); the raw binding is bound
  again, with the same arguments, result and docstring, as smlibpy's Boolean plus the edges of the
  result that lie on the surfaces of both operands, tested at three points each as
  `ShapeList.joining` tests them (the same edges in all 8 cases of the test). Python only (smlibwasm
  never bound it).
- **Seams of bodies that are no bodies of revolution, and seams on and against B-spline faces (B6).**
  The seam of an earlier hole that a tool touches tangentially where their faces cross is moved on
  its face before the Boolean: the hole's cylinder, cone or sphere (over the face's extent along its
  axis) is added and cut away again turned about its axis, or for a boss cut away and added again,
  on a copy kept only where the body's volume stays (to 1e-7) and the seam no longer touches.
  B-spline faces of the other operand are now looked at too (the kernel's projection, only near the
  seam), and a body whose B-spline seam face touches is used as a copy with its faces recognized as
  cylinders, cones, spheres or tori first. Measured on 160 random cases (60 holes in a box whose
  seam a sphere, cylinder or torus touches, the same 60 with `to_nurbs()` parts, 40 torus slices
  through the seam vertex), against OpenCASCADE in the 146 cases where its own results add up (504
  results): before, 106 were wrong without an error and 38 raised; now 7 and 8. Of the 7, one is
  3.6e-5 off (a torus tool) and 5 are the torus caps, 1e-4 to 2e-4 off on caps of 0.2 to 1.8, the
  same before and after (OpenCASCADE and smlibpy differ from each other there by as much as each
  from an integral). Examples:
  `(Box(20, 20, 20) - Cylinder(3.174, 40).translate(-2.051, -2.981, 0)) & Sphere(3.159).translate(1.123,
  0.178, 2.221)` 111.1921 (was 6.9039); the groove pin with a NURBS part 24299.2603 (was 24656.1472)
  and with a NURBS pin 24299.2587 (was 24461.4800). Booleans of a 64-face imported B-spline part
  take as long as before (0.11 to 0.16 s for 6 cuts, in both).
- **Merges of more than two parts turn and move seams for every part merged in.** A part merged into
  an earlier merge (a body of several cells) goes in turned or with its seams moved, as in a merge of
  two (`part.merge(other).merge(pin)` of the groove pin: cells adding up to the union, the part's
  cell 24299.2587).
- **2D Booleans of faces far apart (C1).** A unit square fused to its neighbour at a corner, with a
  third square 1000 away, became a sliver of 0.2778 without an error: in 9 of 60 random lattices
  natively (12 in smlibwasm), and 46 (43) more raised "touch each other at a point"; a union of
  sketches with pieces far apart on both sides gave 9.419 of 12.427 in smlibwasm. The kernel's planar
  Boolean takes its tolerances from the extent of its operands. Faces apart from the other operand's
  (by their boxes) are now set aside where the whole spans ten times the largest group of faces near
  each other, and each group goes into the kernel alone: 60 of 60 lattices right in both builds, and
  `+ - & ^` of the far pieces exact.
- **A sheet of one plane, cylinder, cone or sphere face that ends inside the part splits it (B12).**
  `split` extended only a free-form face; an analytic face raised "the surface does not cut through
  the part". It is now extended as itself (`Face.extend`, which keeps a cylinder a cylinder): a face
  of `Cylinder(30, 8).translate(0, -25, 0)` splits `Box(20, 20, 20)` into 2226.0814 and 5773.9181
  (the integral: 5773.9216).

- **Circular rims after a scale along the axis are circles (T6).** The kernel's recognition after a
  scale that differs between the axes gave back cylinders, cones and planes, but their rims stayed
  B-spline edges: `Cylinder(5, 10).scale((1, 1, 2)).edges().circles()` found none, and STEP files got
  B-spline curves. The recognition now also gives back circles (`SmCurve::CreateAnalyticCurve`, as
  for mirrored bodies, on edges whose faces are no B-splines; every edge checked against the old one
  to 1e-9 of the size): `edge.radius` is 5, the STEP file has `CIRCLE`s and no `B_SPLINE_CURVE`, the
  volume stays exact, and the rims of a hole, a cone or a sphere's cut scaled along the axis are
  circles too. Elliptic rims (a scale across the axis) stay B-splines.
- **A fillet the kernel fails inside names the round it could not build in smlibwasm too (B19).**
  For `SM_ERR_NULL_POINTER` the message says the kernel failed inside the fillet, which says nothing
  about the radius (it never says "the radius may be too large" there), and where the fillet
  executive recorded what it could not build it names it (F8). smlibwasm left that place out of the
  crash message: fuzz case fillet-7-161 (`Torus(8, 1.5) - Sphere(2.5).translate(7, 7, -2.8573)`,
  its one edge rounded by 0.495553) now names "the round of the closed edge through (6.18121,
  5.0668, -1.49998)" in both. Over the fuzz seeds 7 and 8 every fillet failure inside the kernel
  (2 of 43 fillet and chamfer failures) gets this message, and one of them names a place.

## Blocked

- **A torus' outer equator (B6).** No turn about the torus' axis moves it, and filling and recutting
  the face does not either: `SmTorus` starts its second parameter at the outer equator, with no other
  place for it, and the kernel moves seams only in healing (`SmFace::MoveSeam` takes B-spline
  surfaces only, and only where edges cross the seam). The tilted split of `Torus(6, 4).rotate(Y,
  90)` at z = 10 (fuzz slice-7-390) still gives 5.8069 + 1842.7020 for 1894.9640; of the 160
  campaign cases one union and intersection with a torus whose equator touches (A-25: 23610.47 and
  220.03, where point classification gives 23635.96 and 194.55) is wrong. Tried: turning (no
  effect), the fill and recut (the same seam comes back), a NURBS copy and the operands the other
  way round (the same values), a revolve of the circle from another latitude (normalized to the same
  torus).
- **Seams of free-form faces (B6).** A seam of a closed B-spline face that is no cylinder, cone,
  sphere or torus (a revolved spline, a closed loft) has no other place the kernel can move it to
  (see above), and no analytic copy to move it on; such Booleans keep the defect.

## Later

- `Part.merge(sheet)` (conformal cells along a sheet, B12): B12's "Do" asked for `split(sheet,
  'both')`, which is done; a merge along a sheet is a new operation.
- Split along sheets of several faces that end inside the part (B12): `Face.extend` grows one face;
  growing a sheet of several faces is beyond U6 and B12.
- Pieces a sheet imprints descending from the sheet (B14): the "Do" asked for an imprint that keeps
  the volume and returns the new faces; which side of a sheet a piece "comes from" is a new rule.
- History tags for bodies read from files, and tags on vertices (T3): the "Do" tags faces and edges
  of bodies smlibpy makes; files (`.smb` holds no attributes) and vertices are an extension.
- `heal(report=True)` from `SmHealData` (T4): the plan item itself says "later".
- Face colors and names in `.smb` files (X9's), USD `BrepArray` prims, OBJ and the MCP live view
  (T5): the "Do" asked for STEP and per-face glTF/USD materials, which are done; STL has no colors.
- Ellipsoids, and recognition of STEP imports (T6): the "Do" asked for the kernel's recognition after
  the transform (planes, lines, cylinders; circles are done above); the kernel has no ellipsoid
  surface, and recognizing the B-spline faces of files that are read is a new importer option.
- A fillet hint that names a vertex where the fillet executive recorded nothing (B19): the "Do"'s
  "degenerate vertex" hint is F8's naming of the corner or edge from the executive's record (above);
  where there is no record, smlibpy has no evidence of a vertex, and finding one (rounding the edges
  in groups) is a new search. Offset hints beyond the crash note: the "Do" asked for the shell's
  face, which is done.

## Behaviour changes

- Booleans that returned wrong bodies silently now return right ones or raise: unions that gave back
  an operand, cuts that reached out of the part (`ModelingError` "the kernel returned a result that
  is partly outside the part"), and Booleans along the seam of an earlier hole or of a B-spline face.
  Code that measured such results and fixed them up gets the right body:

  ```python
  part = Box(20, 20, 20) - Cylinder(3.174, 40).translate(-2.051, -2.981, 0)
  common = part & Sphere(3.159).translate(1.123, 0.178, 2.221)   # 0.4/0.5: 6.9039; now 111.1921
  try:
      rest = Cylinder(2, 12) - Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)
  except ModelingError:          # was a body of no volume (is_valid() False)
      ...
  ```
- Some Booleans that raised now return parts: a union or intersection of one tool is tried again with
  the operands the other way round (`part & ring` above raised `KernelError`; now 213.1874). Code that
  caught the error to fall back gets the part.
- A hole whose seam a tool touches goes in with its seam moved on its face: in the result its seam
  edge and the vertices where it meets the rims lie at another angle. Select holes by geometry:

  ```python
  wall = part.faces().cylinders().filter_by(lambda f: abs(f.radius - 3.174) < 1e-9)
  ```
- A B-spline body whose seam touches the other operand goes in recognized: faces that were
  `bspline` in the operand (a `to_nurbs()` copy) can come back as `cylinder`, `cone`, `sphere` or
  `torus` in the result. Select by shape (`faces().cylinders()`) or test `not f.is_planar`.
- 2D Booleans of sketches with faces far apart give their faces in another order (the groups near
  each other first, the faces set aside after them), and the squares that raised "touch each other at
  a point" next to a far face are fused. Select faces by position or area, not index:

  ```python
  squares = Rectangle(1, 1).translate(1000.5, 0.5)
  for i, j in [(0, 2), (3, 2), (3, 3), (4, 1), (4, 3)]:
      squares = squares + Rectangle(1, 1).translate(i + 0.5, j + 0.5)   # raised; now 6 faces of 1
  far = squares.faces().sort_by(X)[-1]
  ```
- `split` along a sheet of one plane, cylinder, cone or sphere face that ends inside the part splits
  it, the face going on as itself (it raised `ModelingError`); a sheet of several faces still raises.
  Code that caught the error to extend the sheet itself can drop that:

  ```python
  wall = Cylinder(30, 8).translate(0, -25, 0).faces().cylinders()[0]
  # before: box.split(wall.extend(100), "both") after catching ModelingError
  outside, inside = Box(20, 20, 20).split(wall.to_shell(), "both")
  ```
- The rims of a part scaled along an axis are `circle` edges where they were `bspline`
  (`Cylinder(5, 10).scale((1, 1, 2))`, a hole or a cone scaled along its axis). Code that selected
  them as B-splines selects circles:

  ```python
  tall = Cylinder(5, 10).scale((1, 1, 2))
  rims = tall.edges().circles()          # 0.5.0: tall.edges().filter_by(lambda e: e.geom_type == "bspline")
  ```
- smlibwasm: the message of a fillet or chamfer that fails inside the kernel names what the fillet
  executive could not build, as smlibpy's does ("... (it could not build the round of the closed
  edge through (...)), which says nothing about the radius ..."). Match on the status
  (`e.status === 'SM_ERR_NULL_POINTER'`), not the whole text.
- `smlibpy._core.boolean_with_curves` (raw) returns the edges on both operands' surfaces (the
  intersection curves and the rims where one stands on the other) instead of the kernel's list of
  common edges, which could hold deleted ones; merged coplanar edges are not in it. Use
  `ShapeList.joining` in scripts.
