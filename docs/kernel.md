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
| Sweeps anchor the profile at the start point of its first curve, and the frame of each edge of a path is its own | sweeps the profile in its own frame with the center of its box (in its plane) on the start of the path, and along 3D paths joins tangent edges and carries the profile's orientation from edge to edge |
| The sweep along a planar path of several edges frames each edge with the world's Z axis, so in a plane that is not horizontal its mitered pieces do not meet (no closed solid: any path in the YZ plane), and it moves the profile by the center of its box along the world axes | sweeps such a path in a frame of its own (its plane horizontal, its start along X), with the profile turned as on other paths, and moves the path by the difference between the kernel's anchor and the profile's own: along its normal and to the side (its offset curve; lines and arcs, otherwise a warning) |
| The fuse of two tubes whose end caps meet where a loop closes with a kink leaves faces without area (and now and then a shell of one such face: a void without volume, which OpenCASCADE reads from STEP as a body inside out); where `CloseIntersectionLoop` deleted a vertex and then failed, the Boolean read it after it was freed and the process died | takes such faces out of fused sweeps and stitches the faces around them again (`ext.remove_slivers`), or raises; patched (`third_party/patches`): the Boolean marks its vertices again |
| The skin of single open curves has no degree | lofts open curves through the skin primitive, with the degree `ruled` and `smooth` give |
| The curve sweep carries its frame along the path by the smallest turn and never passes NLib's sweep the frame vectors it can take (`curZ`): a profile rolls along a helix by some 30 degrees a turn. NLib places its sections where a polyline follows the path, at most 1000 a piece, so a twist along a straight path would get two sections and 60 turns of a helix got 7 a turn (0.7 % of the volume lost) | sweeps with the profile's x axis given along the path (`ext.oriented_sweep`: the helix's axis by default, `up=`, `twist=`), and makes NLib place a section for every 1/64 of a turn of that axis (a scale curve of 1 with that many control points) |
| A full turn is revolved by another routine than part of one, which gives surfaces of revolution for every wall that is not a plane (no cylinders, B-splines in STEP files); neither routine gives tori (the test is commented out), and angles between 359.99 and 359.99999 give no closed solid | gives the faces of revolves cylinders, cones, spheres (the kernel's own tests) and tori (`ext.analytic_revolutions`), and revolves within 0.01 degrees of a turn through a whole one |
| The curve sweep along a single line or arc makes B-spline faces where extrude and revolve make planes, cylinders and tori, and nothing stops a profile that reaches across the arc's axis from sweeping through itself (a "valid" body with too much volume) | sweeps a single line as an extrusion and a single arc as a revolve, and raises where the profile crosses the arc's axis |
| The draft sweep of a tapered extrusion makes the walls at sharp corners flat B-spline surfaces (inward tapers) or planes with B-spline slivers at the corners (outward ones), which the kernel's draft refuses (`IsPlanar(1e-7)` says no) and STEP files carry as B-splines; a hole that widens across the region shortened the body | extrudes straight and drafts the walls (`Part.draft`; kept where both give the same volume to 1e-7), drafts flat B-spline faces as planes (their control points in one plane), and raises where the tapered body does not reach the end |
| The curve sweep takes a scale law only as the distance between two curves at the path's parameters; NLib places a section for each control point of the law, and in the first and last span between sections the surface leaves a changing scale by about 0.017 / (sections - 1) of the change | builds the two curves from a scale along the path's length (65 points by arc length, which the kernel samples at 650), or gives `ext.oriented_sweep` the scale with 512 control points at least |
| The skin passes no cross-boundary derivatives (a loft leaves its sections where the interpolation goes), and when NLib cannot meet derivatives it skins again without them, silently; nothing makes a closed (periodic) skin | lofts with end tangents through derivative strips and measures the direction across the ends (`ext.skin`; `ModelingError` above 1e-6 rad), and makes closed lofts with NLib's C1-closed skin |
| `SmBrep::CreateFacesFromSurface` deletes the surface it splits into faces, so the caller must not read it afterwards | never reads a surface after handing it over (`ext.oriented_sweep`, `ext.skin`) |
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
- No loft or sweep along rails. The skin with side-boundary rails needs as many sections as the
  rails have control points (the fillets that use it place one at every knot of their rails), and
  the two-rail sweep only approximates its rails: 40 mm wavy rails were missed by 0.31 with its
  default 4 points between profiles, by 5e-3 with 64 and by 1.6e-4 with 1024 (1.5 s, 61065
  control points).
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
