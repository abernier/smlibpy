# The kernel

smlibpy is a Python layer over **SMLib**, a NURBS boundary-representation solid modeling
kernel with a long industrial history. NVIDIA released it, together with a C-style API and
Python bindings, as open source under the Apache License 2.0 in the
[usd-brep](https://github.com/NVIDIA-Omniverse/usd-brep) repository.

## How it fits together

```text
smlibpy (Python)         shapes, selections, sketches, features, STEP/glTF/STL/USD, viewer
  └─ smlibpy._core       one compiled extension module
       ├─ ext            smlibpy's own C++: exact geometry and topology access, transforms,
       │                 sweeps with all options, error-controlled integration of mass
       │                 properties and curve lengths, body splitting, surfaces fitted to
       │                 point clouds, point classification and distances, USD files
       │                 (usd-brep's conversion and stage composition, without OpenUSD)
       ├─ SmPyLib        NVIDIA's pybind11 bindings of SM_API (without the USD parts)
       ├─ SM_API         NVIDIA's C-style API over the kernel
       └─ SMLib          the kernel: geometry, topology, Booleans, fillets, sweeps, healing
```

The kernel sources come in as a git submodule (`third_party/usd-brep`) and are compiled
with CMake into a single, self-contained Python extension. The submodule stays as published.
Kernel defects that smlibpy cannot work around from outside are fixed in copies of ten kernel
source files in `third_party/patches`, which the build compiles in place of the originals:
fillet removal that removed nothing, reads and writes of freed memory in Booleans, fillets and
the offset code behind `shell`, `offset` and `thicken`, a plane test that flattened B-spline
faces with a bump, a seam check that leaked on every STEP import, and bounding boxes that
reached past the ends of an edge. Its README lists every change and what it was measured to
change. Where smlibpy needs more than the published bindings offer, its own C++ module
(`src/cpp/ext.cpp`) calls the kernel directly.

## Accuracy

- **Geometry** is exact: planes, cylinders, cones, spheres and tori are analytic; free-form
  geometry is NURBS. Booleans and fillets work on the exact surfaces.
- **Areas, volumes, centers and inertia** are integrated over the exact geometry to seven
  significant digits by default (`ACCURACY = 1e-7`; see [Measuring](analysis.md)), with an
  error estimate for each of them. The integration is smlibpy's own
  (`src/cpp/measure.cpp`): the kernel's (`SmBrep::ComputePreciseProperties`) controls its
  steps by the area alone and measures them against the running sum along each trim curve,
  so its volumes and moments can be far worse than asked for (the swept spring of
  `examples/spring.py`: 2.9e-5 at 1e-7, still 2.8e-7 at 1e-9 after 12 s). smlibpy integrates
  the same surface integrals over the faces' trim curves (Green's theorem in the parameter
  plane) with adaptive Gauss–Kronrod quadrature, split at the knots, until every estimate is
  ten times below the accuracy asked for. It evaluates B-spline surfaces itself, along each
  line of integration from the poles, and integrates the knot spans of dense faces with 7
  points instead of 15. It is also faster: the spring takes 55 ms instead of 1.1 s, a
  thickened surface with 46,000 knot spans on a face 0.6 s (the kernel: 0.4 s, 2e-8 off),
  most parts a few milliseconds. The validity check (`is_valid()`, and the check of each
  feature's input) integrates the same way at 1e-4, with the gaps between the faces; the
  quick checks inside operations (did a fillet or a deformation change the volume plausibly,
  can the tools of an empty cut hold the part) still use the kernel's integration at a coarse
  accuracy.
- **Edge lengths** are integrated per knot span to 1e-12 (the kernel's `SmCurve::Length`
  counts a span whose curve starts with a zero tangent as 0).
- **A body is as exact as its faces meet.** Faces that the kernel fits (B-spline chamfers,
  shell offsets, intersections of curved faces) close up only to about 1e-6 to 2e-5 mm; the
  volume of such a body depends on that by 1e-7 to 4e-6 of its value. Beyond 1e-5 the
  measures say so in a warning (see [Measuring](analysis.md)).
- **STEP export** writes the kernel's exact curves and surfaces. The test suite reads the
  files back with OpenCASCADE and checks validity and volume.
- **STEP import** rebuilds every face on its exact surface and keeps the file's topology,
  so faces share edges and vertices instead of being stitched by tolerance.

## Robustness work in smlibpy

Some kernel behaviour is wrapped so that it is predictable:

| Kernel behaviour | What smlibpy does |
|---|---|
| Plane cuts keep the other half than documented and leave the body open | `split` intersects with a half space instead |
| 2D Booleans reject some overlaps (two circles, for one) | falls back to 3D Booleans of thin slabs |
| The planar Boolean misclassifies whole faces where faces of a sketch touch each other at a point, as the faces of an exclusive or do (230 of 560 random results wrong) | combines such sketches face by face, checks the result against the overlaps of the faces by area and first moments, and raises where no way holds |
| Fillets larger than the geometry allows can come back as a "valid" solid | checks the radius against neighbouring edges and the volume change |
| The fillet code has no corner for some ways the selected edges meet at a vertex, went on without one, and killed the process (and shrank fillet surfaces it had deleted) | patched (`third_party/patches`): such fillets raise `KernelError` (`SM_ERR_INVALID_INPUT`), with a hint that no size works |
| A (start, end) radius with `continuity` gives a ruled chamfer; on a closed edge or across edges that run into each other tangentially it bends the radii | refuses those combinations (`ValueError`) |
| A chamfer is a round of straight section with one radius per edge, so its setback follows the angle between the faces at the edge | sets each edge's radius from its angle, all edges in one call, and refuses edges whose angle changes by more than 1 degree along them |
| Sweeps anchor the profile at the start point of its first curve, and the frame of each edge of a path is its own | sweeps the profile in its own frame with the center of its box (in its plane) on the start of the path, and along 3D paths joins tangent edges and carries the profile's orientation from edge to edge (the planar sweep of mitered paths keeps the kernel's anchor) |
| The skin of single open curves has no degree | lofts open curves through the skin primitive, with the degree `ruled` and `smooth` give |
| A full 360 degree non-manifold revolve returns an empty body | revolves each loop and subtracts the holes |
| Faces on cylinders, cones, spheres and tori need a seam edge, but NX and others write them without one | adds the seam along the surface when importing STEP |
| A few writers flag the bound of a face reversed (fillets on tori, around holes and bosses), so its loop runs the wrong way round; the kernel's seam check then reads the loop as the rest of the torus and cuts the face apart (2 to 30 % of the volume lost, and the body still "valid") | turns such loops round when importing STEP: in a closed shell each edge between two faces is used once each way, so the neighbouring faces decide |
| The seam has to lie where the surface's angle parameter starts | turns the surface frame to the seam edge of the file |
| The extended offset mode depends on memory layout and sometimes builds a face the kernel cannot integrate or mesh | `shell` uses the plain mode first, checks every result and falls back to the extended mode, which it repeats once, only after a result it refused |
| The STEP builder (`SmBrepConstructor`) makes a vertex for every edge end it is not given one for: a body read edge by edge had coincident vertices (a rounded box 48 for its 24) and loops whose edges did not link | starts each edge at the vertices made for the file's vertex ids and glues the few the builder still makes twice |
| The seam check (`SmFace::HasSeamProblem`) lost a curve on every periodic face, 3 to 13 KB per call and per STEP import | patched |
| A body that `CopyFaces` or `RemoveFaces` failed on crashes when it is deleted (a face of an import whose faces share no edges) | never deletes such a body; the copy raises `KernelError` |
| Arcs from the API are plain B-splines | arcs are trimmed kernel circles, so they keep radius and center |
| Mass properties control their integration steps by the area alone: a volume can be 300 times worse than the accuracy asked for | integrates areas, volumes, centers and inertia itself, with an error estimate for each |
| A curve's length leaves out a span that starts with a zero tangent (the outline of a cylinder had 30 mm top and bottom lines instead of 60) | integrates lengths and arc-length positions itself |
| Tessellation cuts each face into a grid placed by the curves along its borders, so a face that is straight in one direction and twisted along it gets one facet across (a twisted bar: 1 mm off) | estimates for every face how far the grid would be off and halves all faces of such a body until they are flat; other bodies keep the kernel's triangles |
| On a sphere the grid leaves long slivers along the seam near the poles (0.68 off at a tolerance of 0.01), and on a free-form face it can miss a bump between its lines | splits every edge whose middle lies off a sphere, torus, cone or cylinder by more than the tolerance, and halves a body whose free-form faces the grid misses at a control point |
| Plane recognition (`SmPlane::IsNurbSurfacePlane`) compared a B-spline face with the plane at 13 fixed parameters, so copies of a face with a bump between them (`to_shell`, `.smb`, `thicken`, meshes) came out flat | patched: every control point must lie on the plane |
| The tight bounding box of an edge took in the knots of its curve beyond the edge (a box whose edges a USD file had written over SMLib's unbounded lines measured 1234560) | patched |
| Mesh Booleans leave polygons with holes, which the mesh arrays read by their outer loops (an open mesh) | triangulates every polygon of the result first |
| Fitting a surface to scattered points takes 4 s for 100 points and minutes for 300 | fits clouds itself (least squares with smoothing): 20,000 points in 50 ms |
| A curve-face intersection fails where a ray runs parallel to a plane or along a cylinder without meeting it | `raycast` intersects such faces through their mesh and moves the points onto the exact surface |
| Blending two surfaces changes them, so a second blend of the same surfaces fails | `surface_fillet` blends copies |
| The bridge between two sheet edges (`SmBrep::CreateEdgeEdgeBlend`) turns the second edge twice where the edges run opposite ways (a twisted blend whose side edges cross), offsets the second edge's parameters wrongly where its interval does not start at 0, and rescales only the first derivative across the edges: its "G2" blend off a quarter cylinder r 20 has curvature 1.28 there instead of 0.05. SM_API drops its status | `blend` follows the kernel's steps with those right: pairs the nearest ends and turns the second edge once, reparameterizes all derivatives with the take-off, checks every status and the blend's corners |
| Trimming faces with curves on them (`SmBrep::TrimSurfaces`) merges with the body's own tolerance (a circle projected onto a B-spline sheet, 1e-4 off, merged nothing) and bounds the sides by the edges each merge reports, without the pieces a crossing curve splits off them (two crossing lines kept half a sheet instead of a quarter) | `trim` and `imprint` merge with a tolerance that covers the curves' measured gaps, cut each curve where it passes from face to face, and find the edges along the curves by where they lie |
| `SmStitch::StitchIntoSolid` (behind `SmApiStitchIntoSolid`) takes no tolerance: it closes gaps up to 1/200 of the body's diagonal (0.067 in a 200 mm box asked for 1e-4), and a body that `SmApiStitchIntoShell` sews shut has no solid region | `stitch` runs `SmApiStitchAdvanced` from the body's own tolerance up to the caller's, wraps a closed result as a Part, reports the edges sewn, the free edges and the widest gap, and turns an open result's faces to agree (`SmStitch::UnifyNormals` along sewn edges only) |
| `SmBSplineSurface::CreateExtendedSurface` halves the distance where an extension fails and doubles it again only while it stays below half of what was asked, so a surface can come back extended by half the distance or less without an error; it skips closed directions and poles silently, and the base `SmSurface` returns SM_ERR | `extend` and `extended` choose and check the sides first, grow a plane's own rectangle (it stays a plane), measure each side across its middle and extend it again or cut it back; analytic surfaces continued as they are get their type back |
| NLib's surface shaping (`N_SrfShapeDerivConstraints`, and the region warp and flattening, which the kernel compiles out) edits a surface's control points in place: on an analytic surface (`SmPlane`, `SmCylinder`, ...) that changes nothing, on a plane's bilinear net it moves the whole face, and `SmBrep::ReplaceSurface` never moves the face's edges, so an edit near one leaves the edge off its face (a hole's edge 1.2 mm off, the body still valid by smlibpy's check). On a rational surface (a cylinder's) moved control points crease it at every quarter turn | `push`, `warp` and `flatten` add a change of their own (a B-spline zero away from the edit, on its own knots) to the face's exact B-spline, through the weight function where the weights differ; every edge of the face is measured against the result and the edit refused where one would move |
| In the compiled-out NLib code (copied into `src/cpp/nlib_shape.cpp`): `N_PtsAreInPolygon` counts both edges at a vertex less than `NL_MTOL` above a row's ray, so a row through two vertices of the polygon is taken for outside it (a warp over a circle sank its ring and left its middle); `N_SrfShapeFlatten` reads the inside flags one control point off. `N_SrfFuncMultiplySrf` (compiled) loses its accuracy where the knots of its two splines lie close together (spans 4e-4 apart gave control points at 1e11) | both fixed in the copy (marked `smlibpy patch`); the edits move the change's knots onto the surface's where they lie within a quarter span of one, and check the result against the surface plus the change at 33 x 33 points |
| `SmBSplineSurface::JoinSurface` makes its two surfaces compatible in place (`N_MakeSrfsCompatible` elevates, inserts knots and reparameterizes) on an NLib stack it frees on return, so a surface that needed it is left with arrays in freed memory; its header has u and v the other way round, and it never checks that the boundaries meet (the wrong flag gives success and a surface 3 mm off) | `merge_faces` runs the same NLib steps on copies on a stack of its own, turns the surfaces so that the shared sides meet as the code expects, and measures the joined surface against both faces |
| The plane section (`intersect_brep_with_plane`) fits its curves to B-spline faces within 2e-3 only (a plane across a 30 x 20 sheet), and the intersection of two bodies fails (`SM_ERR`) where their surfaces do not meet, apart or nested | `intersection_curves` cuts with a planar sheet across the body (9e-6 off the sheet) and returns no curves where the bodies' surfaces are measured apart |
| The kernel's closest point on a face (`brep_closest_point`, behind `distance_to` of a point) can miss the nearest point of a folded B-spline face (5.83 where it is 5.71) | `surface(..., report=True)` measures each point of a fit from the nearest samples of a grid over the surface by Newton's method: 1500 points in 10 ms (`distance_to` itself still asks the kernel) |
| `SmBSplineSurface::CreateCoonsPatch` checks its four curves only with `SM_ASSERT` (compiled out) and reads four; `CreateNSidedPatch` reads a cross-derivative curve per boundary from an array its header says may be empty; `SmBrep::CreateCornerBlend` puts a three-sided loop's point curve at parameter 0 or 1 whatever the curve's interval, both of a two-sided loop's at one end, and where no edge lies on its surface's border only warns that it cannot tell which side the patch goes to. Its N-sided fill is tangent to about 1.4 degrees only | `fill` orders the loop itself, passes exactly what is read, puts the point curve where the sides meet, and checks every patch: through the curves, across each edge from its face (built again with the loop turned round where it folds back), tangent (0.5 degrees, 2 for N-sided fills) |
| `SmBSplineSurface::CreateGordonSurface` needs a compatible network and misses an incompatible one by up to 4e-2 on a 10 mm patch; given a compatible one it intersects the curves again and reparameterizes them to what it finds (5.7e-4 off), maps the crossings to [0, 1] right only for curves whose parameters start at 0, and fills fixed arrays of 640 curves without a count check | `network` makes the curves compatible (their crossings at common parameters), calls `N_CreateGordonSrf` with those parameters (3e-8 on the same network), refuses more than 640 curves, and measures the surface against the curves given |
| Moving a body with a 4x4 matrix (`SmBrep::Transform`) resets its tolerances from the box of its vertices, and the model size of the shared context with them: a moved torus (one vertex) gets tolerance 0 and its Booleans go wrong, a part over 500 across gets 1e-4 | applies rotations, reflections and uniform scales with a placement, as SM_API does, and sets the tolerances of a scaled body from its whole box |
| Point classification (`SmBrep::Point3DClassify`) takes the region from one ray along +X; once a tight bounding box was computed, that ray can miss a face it crosses (a point inside a cylinder fused with a torus came out outside) | `classify` lets rays in two more directions off the axes vote, two more when they disagree |
| A Boolean that misclassifies the operands can return an empty cut, and the intersection of the same pair, its natural check, then returns the whole part (a tool beside an earlier hole in a sphere, a corner box on an imported pulley) | accepts an empty cut only from tools that hold the part's volume and span its box, and checks points of an intersection that reaches out of an operand's box against the operands |
| A Boolean can return a closed, manifold body whose faces do not meet (an intersection of two cylinders of 250.2, more than its operand's 150.8) | `is_valid()` integrates a Boolean result once when asked and is False where the gaps between its faces make its volume uncertain by 1e-2 or more; features refuse such bodies |
| Booleans of crossing holes whose seams lie tangent to the other hole, and a flat end cap tangent to a sphere, read freed memory and killed the process | patched: they raise `KernelError` (`SM_ERR_BAD_INTERSECTIONS`) |
| A merge in which a part's seam lies tangent to another part can lose volume, and the stitcher behind `cells()` then crashed on it | `merge` raises when its result holds less than its largest part or more than all parts together, and `cells()` checks that the cells add up to the part |
| A section of a merged part drops cells, or fails | `section` cuts each cell and puts their regions side by side |
| A failed Boolean keeps both operands and leaves the context marked as doing a Boolean (it then builds no surface caches) | holds the operands' copies until the kernel takes them and clears the mark (`ext.boolean`) |
| The offset code behind shell, offset and thicken reads memory it has freed (in its extended mode, depending on memory layout): it glued a Vertex it had deleted, kept a deleted ProtoEdge in the lists of other ProtoFaces, and handed out an extended surface after deleting it, and the process crashed now and then | patches the three sites (`third_party/patches`), and runs the kernel steps in a forked copy of the process, whose body comes back as an exact copy |
| shell and offset return bodies whose faces do not meet, a shell without its cavity, or the part itself, and their wall check missed turned parts | refuses results whose faces leave gaps of 1e-3 of the volume, checks a closed shell against the part less its offset and the cavity where no wall reaches, and measures walls across the faces of a part with openings |
| usd-brep's conversion writes cones the omniSolid schema does not allow (a semi-angle of 0 or below) and writes a line edge as a B-spline over SMLib's unbounded line (2.5 km long), and trusts the arrays and values of a file it reads (a malformed array, a sphere whose refDirection is its axis or a weight of 0 crashes it; a cylinder axis of length 0 gives a wrong body) | writes such cones as cylinders or turned around and line edges as long as the edges; checks every array, reference and value (the rules of usd-brep's validator) before converting, and checks each body from other software with the kernel (`SmBrep::AssertValid`) before anything measures it |

## Known kernel limitations

From usd-brep's own list of known issues and from smlibpy's own testing, the ones that can
matter here:

- `heal` may report success without repairing everything; check `is_valid()` afterwards.
- Healing of imported periodic faces (tori, spheres) can go wrong.
- A Boolean in which the seam of a cylinder, cone or sphere lies in a tangent plane of the other
  operand can return a valid body of the wrong volume (a groove pin tangent to a bore: 24331.70
  instead of 24299.26). Its faces meet, so no check catches it. Turning that operand about its
  own axis before placing it (`Cylinder(2, 60).rotate(Z, 45)`) gave the right body in the cases
  measured; compare such volumes with a formula.
- Rounds where three fillets meet at a corner of mixed convexity can fail; round the
  edges in a different order or with different radii.
- Where the kernel has no corner for how the selected edges meet at a vertex (the two halves of
  an edge that another face touches tangentially), the fillet fails at any size
  (`SM_ERR_INVALID_INPUT`); select fewer edges there.
- `shell` cannot open a face whose rim meets its neighbours tangentially, such as a face
  bordered by fillets; shell first, then round the rim.
- The offset code behind `shell`, `offset` and `thicken` depends on memory layout in its extended
  mode: the same call can fail, succeed or crash (filleted boxes still crash it now and then).
  smlibpy runs it in a forked copy of the process (Linux, macOS; smlibwasm: in a kernel of its
  own), so a crash raises `ModelingError` and this process goes on, and it tries a mode again only
  after a result it refused, not after an error. A step longer than
  `smlibpy.defeature.GUARD_SECONDS` (20 s) is stopped.

## Building the kernel

The build compiles about 250 C++ files and takes a minute or two. It is single threaded
inside the kernel unless oneTBB is available (`-DSMLIBPY_USE_TBB=ON`, used for parallel
tessellation and Boolean preprocessing).
