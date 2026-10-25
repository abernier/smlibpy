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
       │                 point clouds, point classification and distances, hidden lines,
       │                 mesh tools, USD and OpenCASCADE files (usd-brep's conversion, stage
       │                 composition and OCCT bridge, without OpenUSD or OpenCASCADE)
       ├─ SmPyLib        NVIDIA's pybind11 bindings of SM_API (without the USD parts)
       ├─ SM_API         NVIDIA's C-style API over the kernel
       └─ SMLib          the kernel: geometry, topology, Booleans, fillets, sweeps, healing
```

The kernel sources come in as a git submodule (`third_party/usd-brep`) and are compiled
with CMake into a single, self-contained Python extension. The submodule stays as published.
Kernel defects that smlibpy cannot work around from outside are fixed in copies of fourteen
kernel source files and one header in `third_party/patches`, which the build uses in place of
the originals: fillet removal that removed nothing, reads and writes of freed memory in
Booleans, fillets and the offset code behind `shell`, `offset` and `thicken`, a crash of the
planar Boolean, a plane test that flattened B-spline faces with a bump, a seam check that leaked
on every STEP import, bounding boxes that reached past the ends of an edge, a read past a stack
array in the curve intersection, and error reports that release builds compiled out. Its README
lists every change and what it was measured to change. Where smlibpy needs more than the published bindings offer, its own C++ module
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
- **A body is as exact as its faces meet.** Faces that the kernel fits (B-spline chamfers and
  blends, shell offsets, intersections of curved faces) lie within about 1e-6 to 2e-5 mm of the
  exact surface and close up only that well. The volume of such a body is off by that distance
  times the fitted area: 1e-7 of its value on large parts, up to 1e-5 on small ones (a pin of
  radius 2 with both rims chamfered by the kernel: 1.1e-5). Beyond 1e-5 the measures say so in a
  warning (see [Measuring](analysis.md)). Chamfers of full circles between faces around one axis
  (shafts, holes, revolved parts) are exact cones (below), not fitted.
- **STEP export** writes the kernel's exact curves and surfaces. The test suite reads the
  files back with OpenCASCADE and checks validity and volume.
- **STEP import** rebuilds every face on its exact surface and keeps the file's topology,
  so faces share edges and vertices instead of being stitched by tolerance.
- **The builds differ in the last bits.** The native build for arm64 (macOS, Linux on ARM) lets
  the compiler contract `a * b + c` into one instruction (FMA), which rounds once instead of
  twice; x86_64 builds and smlibwasm's WebAssembly do not. Volumes then differ by about 1e-9 of
  their value, and now and then a step that is close to a tolerance in the kernel succeeds in one
  build and fails in the other: all-edge fillets of usd-brep's `vase1.smb` and `vase3.smb` succeed
  on arm64 and fail in smlibwasm, and in a native build without the contraction
  (`-ffp-contract=off`), where the kernel's drop of a corner's guess point onto the filleted edge
  finds not one point. `tools/parity.py` lists the known cases. The native build keeps the
  contraction: built without it on arm64, the test suite lost the two vase fillets and found a
  crash of the kernel (a sweep along a closed spline with a kink; Linux x86_64 crashed there too,
  fixed now), and seeds 7 and 8 of the fuzz run diverged from smlibwasm in 12 operations, not
  10. Without the contraction the native build does not compute as smlibwasm does (libm and the
  order of the kernel's work differ too), so turning it off buys no parity.

## Robustness work in smlibpy

Some kernel behaviour is wrapped so that it is predictable:

| Kernel behaviour | What smlibpy does |
|---|---|
| Plane cuts keep the other half than documented and leave the body open | `split` intersects with a half space instead |
| 2D Booleans reject some overlaps (two circles, for one) | falls back to 3D Booleans of thin slabs |
| The planar Boolean misclassifies whole faces where faces of a sketch touch each other at a point, as the faces of an exclusive or do (230 of 560 random results wrong) | combines such sketches face by face, checks the result against the overlaps of the faces by area and first moments, and raises where no way holds |
| The planar Boolean read the face of an edge that bounds no face through a null pointer (an edge the intersection left as a wire edge, in unions of exclusive-or sketches whose faces touch at points) and killed the process in about half the runs | patched (`third_party/patches`): it fails with `SM_ERR_BAD_INTERSECTIONS`, and the checked route takes its next way |
| Fillets larger than the geometry allows can come back as a "valid" solid | checks the radius against neighbouring edges and the volume change |
| The fillet code has no corner for some ways the selected edges meet at a vertex, went on without one, and killed the process (and shrank fillet surfaces it had deleted) | patched (`third_party/patches`): such fillets raise `KernelError` (`SM_ERR_INVALID_INPUT`), with a hint that no size works |
| A (start, end) radius with `continuity` gives a ruled chamfer; SM_API's law runs along each edge on its own, so on a closed edge it jumps back at the seam and across edges that run into each other tangentially the executive bends the radii to one | refuses continuity with a varying radius and laws that jump (`ValueError`), and spreads a law over each run of edges that meet tangentially itself (`SmFilletExecutive::CreateSequenceOfLaws`), linear or smooth through radii at points (`SmBSplineFilletLaw`) |
| A chamfer is a round of straight section with one radius per edge, so its setback follows the angle between the faces at the edge | sets each edge's radius from its angle, all edges in one call, and refuses edges whose angle changes by more than 1 degree along them |
| SM_API's fillet calls keep the fillet executive's record of a failure to themselves (which corner or edge, why, and the step that failed): every failure read "the radius may be too large" | drives the executive itself (`ext.round_edges`, the same calls and defaults) and names the corner or edge it could not build, and the step that failed (its private status, read through a pointer to the member) |
| SM_API has no chamfer with a different setback on each face, although the executive's solver takes two offsets | offsets the two faces of each edge so that the bevel meets them at the setbacks given (`length2`, `angle`); where one face's offset runs backwards farther than the solver takes (a sharp wedge, setbacks less alike than the cosine of its angle), a straight edge between planes with ends on planes at right angles to it is bevelled by cutting the bevel's prism |
| SM_API's fillets build the rounds' edges within 4 times each edge's tolerance, and rounds close to the largest radius that fits then come out open (a 10 mm cube rounded by 4.98, a 20 mm cube by 9.98) | tries a failed or refused fillet or chamfer once more within 1 times the edge's tolerance, as the kernel's own all-edge fillet does: those rounds are exact. Where the rounds fill more than 90% of the room between two edges that run alongside, the check of the result measures the gaps between its faces too (on Linux x86_64 the 20 mm cube's open round, gaps of 4e-2 of its volume, passed the cheaper checks) |
| SM_API mitres corners (the rounds run on until they meet, no corner patch) only for circular rounds of one radius | `corners="mitre"` sets the executive's corners of three convex rounded edges to mitres for every round and chamfer (its other corners skip their patch and would leave a hole, so they keep it) |
| The kernel fits the bevel of a circular edge with a B-spline: the volume of a chamfered pin of radius 2 was 1.1e-5 off | bevels full circles between faces around one axis (planes at right angles to it, cylinders, cones, straight faces of revolves) with a cut, or at a concave rim a fuse, of the solid of revolution of the bevel's line: an exact cone, checked against its volume; the kernel bevels the other edges, and a circle where that solid would take other material; the edges where such a cone meets a cylinder or cone, which the kernel's intersection fits (8e-6 short on a pin of radius 2), get their exact circles |
| A shell opening whose rim meets its neighbours tangentially keeps an open rim: the inner rounds run up to the outer edge and their edges lie off their faces | cuts planar openings of that kind out of the part shelled closed (their other rim edges must meet walls standing at right angles to them, or an ordinary opening, which the kernel opens) |
| `SmBrep::LocalOperation` (face edits, drafts) drops the cavities of a solid, and gives the faces it extends around the edited ones surfaces of its own (a cylinder a surface of extrusion of its rim, a cone a B-spline) | edits the outside and each cavity's solid apart and cuts the cavities out again (checked: they take what they should), and gives extended faces their cylinder or cone back where they lie on it |
| The kernel's offset moves the faces of a sheet that share no edges each on its own, and closes nothing between them (an open box of five separate faces offset inwards came back with no faces) | sews faces that touch along edges they do not share before the offset, where that turns no face |
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
| The extended offset mode depends on memory layout and sometimes builds a face the kernel cannot integrate or mesh | `shell` uses the plain mode first, checks every result and falls back to the extended mode, which it repeats once, only after a result it refused; the two modes give differently shaped cavities (round or sharp where faces grow apart), so `corners=` picks one and `info()["corners"]` says which a shell got |
| SM_API has no direct editing; `SmBrep::LocalOperation`, which rebuilds a Brep around new surfaces of some faces, takes faces that meet tangentially only when they change alike, fits the edges where a moved plane meets an extended cylinder, cone or sphere with B-splines (1e-7 of the radius), and drops the inner shells of a solid (its cavities), edited or not, reporting success | `move_faces` and `offset_faces` move and offset copies of the faces' own surfaces (keeping their parameters), take a tangent chain along (`offset_faces`) or ask for it (`move_faces`), put the exact circles back, check gaps, face count and volume, and refuse parts with a cavity; `shell(walls=)` of a closed shell edits its cavity as a body of its own and cuts it out |
| The STEP builder (`SmBrepConstructor`) makes a vertex for every edge end it is not given one for: a body read edge by edge had coincident vertices (a rounded box 48 for its 24) and loops whose edges did not link | starts each edge at the vertices made for the file's vertex ids and glues the few the builder still makes twice |
| The seam check (`SmFace::HasSeamProblem`) lost a curve on every periodic face, 3 to 13 KB per call and per STEP import | patched |
| A body that `CopyFaces` or `RemoveFaces` failed on crashes when it is deleted (a face of an import whose faces share no edges) | never deletes such a body; the copy raises `KernelError` |
| Arcs from the API are plain B-splines | arcs are trimmed kernel circles, so they keep radius and center |
| NLib caps a spiral fit at 1000 control points, so helices of more than 26 to 79 turns (by radius) failed their tolerance check, and the API fits at most 124.25 turns | raises the cap at start (`NL_CCPLIM`), and fits longer helices in pieces of whole turns joined into one curve |
| The curve intersection of the API takes the whole curves with a fixed tolerance of 0.001 and fails where it finds nothing: skew lines 0.0005 apart crossed, overlapping segments gave one point | intersects the edges' intervals itself (`SmCurve::GlobalCurveIntersect`) with 1e-6 or 1e-9 of the size; no point is an empty list, an overlap gives both its ends |
| SmPyLib registers no Python class for ellipses, so the calls that take a B-spline curve refused them (`project`, `sweep`, `ruled`) | registers ellipse, parabola and hyperbola curves |
| The curve offset of the API approximates within a fixed 0.001 (an offset of 2 was 1.99945 to 2.00085 from its spline) and makes a cusp or a loop where the curve bends more tightly than the distance | offsets splines itself (`SmBSplineCurve::CreateSimpleOffset`) within 1e-6 of the size, measured, with exact ends, and refuses where the curve's radius of curvature on that side reaches the distance; lines and arcs exactly |
| The point approximation of the API takes no tolerance (a fixed share of the points as control points) | fits through `SmBSplineCurve::ApproximatePoints` with the tolerance asked for, measures the distance of every point, and fits again with less where it is off |
| The conversion to lines and arcs of the API asks NLib for 0.001 and returns one rational B-spline 0.0037 off: NLib fits the arcs within ten times the tolerance it is given | asks for a tenth, measures both ways, asks for less while the result is off, and returns the spans as separate lines and arcs |
| The projection of a curve onto a body of the API (`SmApiProjectCurve`) passes no tolerance: its pieces were 9.4e-5 off a sphere of radius 10 | projects with `SmBrep::CreateParallelProjectionCurves` within 1e-7 of the size (2.5e-8 off that sphere), knows each piece's face, and keeps only what the curve sees where asked (`nearest=True`) |
| The projection onto one surface of the API takes the curve's own size as the tolerance of the drop and returned a piece of a cylinder's seam for a line in front of it; the drop of the API drops within 10 and lifts within 0.001 (7.5e-4 off a cylinder) | projects onto a face along its normals with `SmBrep::CreateNormalProjectionCurves` within 1e-8 of the size, trimmed to the face (`Face.project`) |
| A curve of a surface's parameter plane lifted onto it (`SmSurface::LiftCurve`) follows the parameters of the surface's NURBS form, whose speed varies on cylinders, cones and spheres: a line of a cylinder's parameter plane is no helix (0.16 off) | `Face.wrap` maps points by length along the face's parameter lines itself, fits them within 1e-7 of the size and trims the result to the face (`SmFace::CreateCurvesByTrimming`) |
| `SmBSplineCurve::ForceThroughPoint` missed its point by 1.9e-4 and moved the clamped start of the curve by 2e-4; the constraint solver of NLib is compiled out | `Edge.through` moves the control points itself (the least change that passes the point, ends kept, exact); `Edge.match` uses `SmCurve::DeformToEndPointTargets` |
| The 2D fillet of curves (`SmCurveFilletExecutive`) is unused and untested in the kernel, cannot be told which side to round and takes the first of four offset combinations it finds | rounds corners at splines and ellipses itself: the arc's center where the curves' offsets meet, refined until it lies at the radius from both curves to 1e-9 (OpenCASCADE's 2D fillet agrees to 5e-8) |
| The tight box of a curve (`SmCurve::CalculateTightBoundingBox`) takes the corners of the whole curve, not of the interval asked for | computes the box of a free curve from its ends, its corners in the interval and the points where its tangent is perpendicular to an axis |
| Mass properties control their integration steps by the area alone: a volume can be 300 times worse than the accuracy asked for | integrates areas, volumes, centers and inertia itself, with an error estimate for each |
| A curve's length leaves out a span that starts with a zero tangent (the outline of a cylinder had 30 mm top and bottom lines instead of 60) | integrates lengths and arc-length positions itself |
| Tessellation cuts each face into a grid placed by the curves along its borders, so a face that is straight in one direction and twisted along it gets one facet across (a twisted bar: 1 mm off) | estimates for every face how far the grid would be off and halves all faces of such a body until they are flat; other bodies keep the kernel's triangles |
| On a sphere the grid leaves long slivers along the seam near the poles (0.68 off at a tolerance of 0.01), and on a free-form face it can miss a bump between its lines | splits every edge whose middle lies off a sphere, torus, cone or cylinder by more than the tolerance, and halves a body whose free-form faces the grid misses at a control point |
| Plane recognition (`SmPlane::IsNurbSurfacePlane`) compared a B-spline face with the plane at 13 fixed parameters, so copies of a face with a bump between them (`to_shell`, `.smb`, `thicken`, meshes) came out flat | patched: every control point must lie on the plane |
| The tight bounding box of an edge took in the knots of its curve beyond the edge (a box whose edges a USD file had written over SMLib's unbounded lines measured 1234560) | patched |
| Mesh Booleans leave polygons with holes, which the mesh arrays read by their outer loops (an open mesh) | triangulates every polygon of the result first |
| Mesh Booleans give their result no normals | each result triangle takes the corner normals of the operand triangle it lies on (`Mesh` `+ - &`) |
| The quadric decimation (`SmPolyDecimate`) stops at an "accumulated error" that is no distance (0.05 collapsed a sphere of radius 10 to 390 triangles, 5.3 off), leaves folds (two triangles on the same points, back to back), pinched edges of four triangles and folded slivers, and collapses meshes of long thin triangles far beyond the share asked (a coarse cone to 4 triangles at 5 %) | `Mesh.decimate` stops by the share of points only, measures the distance itself for `tolerance=`, removes folds, unpinches and unfolds (edge flips, sliver merges), decimates again in steps where that is not enough, and refuses results far below the count asked |
| `SmPolyBrep::FillLaminaHoles` looks for the next edge of a hole among all border edges and fills holes with one polygon; the planar triangulation fails on long holes that zigzag about their plane | `Mesh.fill_holes` chains the border itself (holes that touch at a point apart), lets the kernel triangulate each hole and falls back to ear clipping and a fan |
| `SmPolyMerge::CleanupCoPlanarFaces` merges neighbouring polygons whose normals are within 0.01 of each other, also the triangles of a finely meshed sphere | `Mesh.to_part` merges triangles that lie in one plane within the mesh's tolerance (1e-7 of its size) before `SmBrep::CreateFromPolyBrep` |
| SmPyLib's `PolyBrep.ray_intersection` returned the hit polygon without a parent, so pybind11 raised "Could not activate keep_alive!" for every ray that hit | binds it again with the mesh as the polygon's parent (`third_party/patches` covers SMLib and SM_API sources, not SmPyLib's bindings); `Mesh.raycast_many` casts many rays at once |
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
| The plane section (`intersect_brep_with_plane`, `SmApiIntersectBrepWithPlane`) passes no tolerance to `SmBrep::CreatePlanarSectionCurves`, which then fits its curves to B-spline faces within a thousandth of each face's size (2e-3 off a plane across a 30 x 20 sheet, 1.5e-2 off a part thickened from it), and the intersection of two bodies fails (`SM_ERR`) where their surfaces do not meet, apart or nested | `Part.section` asks `SmBrep::CreatePlanarSectionCurves` for 1e-7 of the part's size (3e-6 off that part, 5 to 25 ms); `intersection_curves` cuts with a planar sheet across the body (9e-6 off the sheet) and returns no curves where the bodies' surfaces are measured apart |
| The kernel's closest point on a body or face (`brep_closest_point`, `SmFace::ClosestPoint`) stops at a local minimum where a B-spline face folds back towards the point (5.83 where it is 5.71) | `distance_to` and `closest_point` of a point (bodies and faces) start from the kernel's point and search every face, and every knot span of its surface, that could hold a nearer point (by the box of the span's control points), by Newton's method from the nearest points of a grid over it, then the edges of those faces; `surface(..., report=True)` measures each point of a fit the same way |
| Cylinders, cones, spheres, tori and surfaces of revolution evaluate to their seam for parameters up to about 1e-7 short of the end of their domain (`SmPolarConversion::ConvertToPolarParameter` asked `STEPInversion` with the context's zone tolerance), so ray and curve intersections missed the hits beside a seam (`Cylinder(10, 40).raycast((88.98, -1e-8, 4), (-1, 0, 0))` gave only the far side) | patched (`SmEllipse.cpp`) |
| `SmBSplineSurface::CreateCoonsPatch` checks its four curves only with `SM_ASSERT` (compiled out) and reads four; `CreateNSidedPatch` reads a cross-derivative curve per boundary from an array its header says may be empty; `SmBrep::CreateCornerBlend` puts a three-sided loop's point curve at parameter 0 or 1 whatever the curve's interval, both of a two-sided loop's at one end, and where no edge lies on its surface's border only warns that it cannot tell which side the patch goes to. Its N-sided fill is tangent to about 1.4 degrees only | `fill` orders the loop itself, passes exactly what is read, puts the point curve where the sides meet, and checks every patch: through the curves, across each edge from its face (built again with the loop turned round where it folds back), tangent (0.5 degrees, 2 for N-sided fills) |
| `SmBSplineSurface::CreateGordonSurface` needs a compatible network and misses an incompatible one by up to 4e-2 on a 10 mm patch; given a compatible one it intersects the curves again and reparameterizes them to what it finds (5.7e-4 off), maps the crossings to [0, 1] right only for curves whose parameters start at 0, and fills fixed arrays of 640 curves without a count check | `network` makes the curves compatible (their crossings at common parameters), calls `N_CreateGordonSrf` with those parameters (3e-8 on the same network), refuses more than 640 curves, and measures the surface against the curves given |
| Moving a body with a 4x4 matrix (`SmBrep::Transform`) resets its tolerances from the box of its vertices, and the model size of the shared context with them: a moved torus (one vertex) gets tolerance 0 and its Booleans go wrong, a part over 500 across gets 1e-4 | applies rotations, reflections and uniform scales with a placement, as SM_API does, and sets the tolerances of a scaled body from its whole box |
| Point classification (`SmBrep::Point3DClassify`) takes the region from one ray along +X; once a tight bounding box was computed, that ray can miss a face it crosses (a point inside a cylinder fused with a torus came out outside) | `classify` lets rays in two more directions off the axes vote, two more when they disagree |
| A Boolean that misclassifies the operands can return an empty cut, and the intersection of the same pair, its natural check, then returns the whole part (a tool beside an earlier hole in a sphere, a corner box on an imported pulley) | accepts an empty cut only from tools that hold the part's volume and span its box, and checks points of an intersection that reaches out of an operand's box against the operands |
| A Boolean can return a closed, manifold body whose faces do not meet (an intersection of two cylinders of 250.2, more than its operand's 150.8) | `is_valid()` integrates a Boolean result once when asked and is False where the gaps between its faces make its volume uncertain by 1e-2 or more; features refuse such bodies |
| Booleans of crossing holes whose seams lie tangent to the other hole, and a flat end cap tangent to a sphere, read freed memory and killed the process | patched: the kernel's Boolean fails (`SM_ERR_BAD_INTERSECTIONS`); smlibpy turns the hole first (next row) and gets the crossing holes right |
| A Boolean in which the faces cross along a curve that runs tangent to the seam of a cylinder, cone, sphere or torus returns a valid body of the wrong volume (a groove pin tangent to a bore: 24331.70 instead of 24299.26; the intersection of a cylinder and a sphere larger than the sphere) or fails | finds such seams (along each seam, the distance to the other body's planes, cylinders, cones, spheres and tori) and turns the body whose seam it is about its axis first (in a Boolean or merge of two solids), where that keeps its shape (every face a plane across the axis, or a cylinder, cone, sphere or torus about it): on copies, at up to three angles that clear the seam, passing over results whose volume lies outside the bounds the operands' set, and with the bodies as they are where the kernel fails with each. Where a seam touches at a point (`ext.seam_touches`), points on the result's faces near it are classified against the operands, and a result that disagrees is done again with NURBS copies of the operands whose seams touch, or refused; a split by a plane such a seam touches must give sides that hold the part's volume (half-space boxes of four sizes, then the kernel's slice) |
| A tool beside an earlier parallel hole or boss (their cylinders cross along lines) fails, or in a curved part cuts everything away | tries again with a NURBS copy of the tool, whose faces come back analytic, and checks the result's volume against the operands' |
| A merge in which a part's seam lies tangent to another part can lose volume, and the stitcher behind `cells()` then crashed on it (a null polar box, patched since) | `merge` raises when its result holds less than its largest part or more than all parts together, and `cells()` checks that the cells add up to the part |
| A section of a merged part drops cells, or fails | `section` cuts each cell and puts their regions side by side |
| A failed Boolean keeps both operands and leaves the context marked as doing a Boolean (it then builds no surface caches) | holds the operands' copies until the kernel takes them and clears the mark (`ext.boolean`) |
| The offset code behind shell, offset and thicken reads memory it has freed (in its extended mode, depending on memory layout): it glued a Vertex it had deleted, kept a deleted ProtoEdge in the lists of other ProtoFaces, handed out an extended surface after deleting it, deleted the curve of an Edge it had made when the imprint failed later (issue #2's filleted boxes) and kept boundary curves it had deleted; on imported parts it went on with an Edge an imprint had left half made, read a null polar box, and left loops naming the edgeuses and vertexuses it had deleted; the process crashed now and then | patches these sites (`third_party/patches`), and runs the kernel steps in a forked copy of the process, whose body comes back as an exact copy |
| shell and offset return bodies whose faces do not meet, a shell without its cavity, or the part itself, and their wall check missed turned parts | refuses results whose faces leave gaps of 1e-3 of the volume, checks a closed shell against the part less its offset and the cavity where no wall reaches, and measures walls across the faces of a part with openings |
| The extended (sharp) offset moves an edge whose faces meet at an angle `a` by `d / sin(a / 2)`, more than `d`, and cannot extend the faces of an acute wedge or around a hole that closes; its plain mode rolls a ball instead and builds those, exactly | `offset` bounds a sharp result by the first-order reach of the part's edges and corners (it refused a cone's correct offset as reaching beyond `d`), and offers the plain mode as `corners="round"` |
| The tight box of a face (`SmFace::CalculateTightBoundingBox`) takes in the extremes of its surface that it classifies on the face, and a point within the tolerance of one of the face's vertices or edges classifies on it, also off the face: the inner wall of a shelled twisted vase (the deform recipe) reached 1.3e-3 above the rim in about 2 of 5 runs (a point of its surface 1.4e-3 from a rim vertex of tolerance 1.8e-3), where its edges and its mesh end at the rim, and the shell was refused as reaching out of the part | the box check of `shell` and `offset` grants a face that reaches out of the box the tolerance of its edges and vertices, at most 1e-4 of the box's size |
| Release builds compile the kernel's error reports out (`SER` and the other failure macros of `SmMessages.h` only return), so every failure said only `SM_ERR at <binding>` | patched (`SmMessages.h`): each failure is reported to the error callback, which keeps the last 48; `KernelError.trace` (see "Where the kernel gave up" below) |
| usd-brep's conversion writes the UV curves of a loop that runs up and down a sphere's seam (no edges at its poles), which do not close (usd-brep's validator: BA.763) | writes such loops without UV curves, which a reader rebuilds from the 3D curves |
| usd-brep's conversion writes cones the omniSolid schema does not allow (a semi-angle of 0 or below) and writes a line edge as a B-spline over SMLib's unbounded line (2.5 km long), and trusts the arrays and values of a file it reads (a malformed array, a sphere whose refDirection is its axis or a weight of 0 crashes it; a cylinder axis of length 0 gives a wrong body) | writes such cones as cylinders or turned around and line edges as long as the edges; checks every array, reference and value (the rules of usd-brep's validator) before converting, and checks each body from other software with the kernel (`SmBrep::AssertValid`) before anything measures it |
| The relationship of two bodies (`SmApiBrepRelationship`) calls overlapping bodies "touching" (spheres with 18.6 in common, a pin through a plate: it classifies only vertices and one point per face), changes its answer with where the bodies are (face-touching boxes: "touching" at the origin, "interpenetrating" moved by 100) and with what was asked before (after a tight bounding box), and took 10 s for two plates of 168 faces | is never asked: an empty intersection or cut is accepted where the operands' boxes are apart, or where their meshes share no volume (nothing of the part left outside the tools), up to 1e-6 of it or a volume that shrinks with the meshes' tolerance (a concave face touching the other body); points of the meshes are classified where the mesh Booleans fail |
| A Boolean of a solid and a sheet returns a "Part" that is no solid (the sheet imprinted, or the piece of the sheet) | `part + sheet` and `part - sheet` raise `TypeError`; `sheet & part` and `sheet - part` trim the sheet and check the pieces lie on it; `split` takes sheets (the kernel's `SM_BO_SLICE`, which no binding names: both sides, checked to add up to the part, a free-form sheet that ends inside the part extended first) |
| Attributes on faces and edges go through Booleans, fillets, shells and copies (`SmAttribute`), but a merge keeps only the surviving object's | smlibpy's marks (`ShapeList.new`, `derived_from`) take the union of both, and come back from the forked offset steps alongside the `.smb` copy (which holds no attributes) |
| The validity check `sm_AssertValid` does nothing in release builds | `check()` calls `SmBrep::AssertValid` itself (compiled in every build), which names the face, edge or vertex, the test and the gap |
| The fillet geometry asked a missing boundary curve whether it was degenerate (`SmFilletGeom::MakeFaceBrep`), and the rollover read the surface of a side face it had not found (`SmFilletSolver::CreateCliffRollOverSideFG`): both killed the process (an all-edge chamfer and an all-edge fillet of Boolean parts) | patched (`third_party/patches`): the fillet fails, and the error names the edge |
| The solution filter of the curve intersection (`sm_FilterSolution`) evaluated the curves with their first derivative only and read the second where the first is zero, past its stack array (reached from the seam check of `SmBrep::AssertValid`) | patched: it evaluates the second derivative too |
| A body moved with a matrix that is no similarity (a scale that differs between the axes, a shear) has only B-spline faces and edges, and its first measure stores refitted trim curves in it (the volume of a stretched cylinder 6.8e-7 off) | recognizes planes, cylinders, cones, surfaces of revolution and extrusion, lines and circles on a copy right after the transform (`ConvertCurvesToAnalytics`, and `CreateAnalyticCurve` for circles), kept only where every face and edge lies within 1e-9 of the size of the old one |
| The bend volume's exact surfaces (`SmBendVolume::MakeExactBSpline1stOutSurface`) put bend cylinders at the axis point and sample the surface's parameter box, not the face, so deformed faces are fitted B-splines | samples the exact map on each face and edge and builds planes, cylinders, cones, lines and circles where the image is one (`src/cpp/deform_analytic.cpp`), with trims rebuilt within 1e-8, else the fit |
| The sheet-metal unbend fits the edges of a bend zone within 1e-4 (a hole across a bend became 3 arcs and 2 B-splines, 1.8e-5 off its circle) | takes the kernel's exact lines and arcs where it has them, else a fit within 1e-7 that keeps the curve's parameters, and makes the flat pattern's outline of lines, arcs and circles |
| SM_API's projection of a body onto a plane keeps only the visible half of what the hidden-curve removal (`SmHCR`) computes, and SmHCR's seam and smooth-edge flags turned a cylinder's front rim hidden | `outline(hidden=True)` calls SmHCR itself, filters seams and tangent edges by geometry, and drops edges seen end-on, slivers and hidden pieces under visible lines |
| `SmApiBooleanWithCurves` hands out the common edges of a merge after `BooleanPostProcess` deleted some of them (AddressSanitizer: freed edges in its result) | is not used; `ShapeList.joining` selects the edges where two bodies meet by exact classification, and the raw `_core.boolean_with_curves` is smlibpy's Boolean with the edges found that way |
| A union can return one operand with a vertex or two imprinted although the other reaches out of it (1358.54 for 1446.61), and a cut can return a body of no volume that reaches out of the part | the result's surface is checked to lie within the operands' boxes, and the operands' surfaces are classified against the result where it may be an operand given back or an operand's box reaches out of it; the union is tried again the other way round |
| Two Vertices of the faces a Boolean deletes can share one vertex Shell, which `DeleteVertex` deletes with the first, so that the second named a freed Shell (a torus touching a plate at a point killed the process) | patched: `DeleteFaces` deletes the Vertices the Shell does not list first |
| `CombineProtoEdge` and the deletion of an overlapping group leave the deleted ProtoEdge in the overlap and coincidence lists of other ProtoEdges and ProtoFaces, and in the ProtoEdge lists of its end ProtoVertices where `CombineProtoEdge` listed it twice (read in `ResolveOverlappingProtoEdges` and `FindProtoEdge`; extended offsets) | patched: they are taken out of every list, as often as they are listed, and the ProtoEdge that took the deleted one's EdgeDefinitions is listed in its place |
| The kernel's planar Boolean takes its tolerances from the extent of its operands: faces hundreds of times their size apart made it misjudge faces that touch (a unit square fused at a corner became a sliver of 0.2778 by a square 1000 away) | faces apart from the other operand's are set aside, and the groups of faces near each other go into the kernel one by one |
| A torus whose seam lies on its outer equator (OpenCASCADE's O-rings) gave a seam window from -359.99999999999994 to 0, which `SmEllipse::AdjustSTEPInterval` refuses | lets the window start at 0 (the importer and the builder) |
| The STEP builder gives each face its surface's whole parameter domain, so the kernel's search for a point inside a face missed narrow torus strips (`SmApiFaceInternalPoint` failed on valid imports) | narrows each face's domain to its trims once the body is built, in the directions the face takes less than half of |
| The part file's assembly reader and writer (`SmBrepData::WriteAssemblyToDB`, `ReadAssemblyFromDB`) are empty, and its binary writer writes each value of a Boolean tree twice | `.smp` files hold bodies and curves, with names and colors as attributes on copies; no placements or trees |
| usd-brep's OpenCASCADE bridge read cavities inside out and wrote inner shells reversed, turned re-aligned cylinder and cone frames by a quarter turn in u, wrote no curves on analytic faces and no edges at poles, wrote clockwise wires on concave faces, put free sheets in one shell and doubled vertices at loop joints | fixed in smlibpy's copy (`src/cpp/occt`, marked `smlibpy:`); the writer checks the model for what OpenCASCADE's check refuses before it returns |
| The kernel's ray tracer (`SmRayTracer`) hits triangles, not faces | `raycast_many` traces through a mesh made once per body and moves each hit onto the exact face, and casts exactly where the face is missed there |

## Known kernel limitations

From usd-brep's own list of known issues and from smlibpy's own testing, the ones that can
matter here:

- `heal` may report success without repairing everything; check `is_valid()` afterwards.
- No Boolean is known to kill the process any more (the torus touching a plate at a point did, until
  0.5.0); batch runs over unknown inputs can still set `smlibpy.defeature.GUARD_BOOLEANS = True`
  (below).
- The kernel's Boolean of meshes (`Mesh` `+ - &`) kills the process for the meshes of two internally
  tangent cylinders at a fine tolerance.
- The kernel's sweep places at most about 1000 sections along a path, so with its own frame
  (`orient=False`) it fails along more than about 60 turns of a helix: smlibpy sweeps such an edge
  in 2, 4 or 8 pieces of equal length and fuses them (`Helix` itself takes any number).
- Which way a sweep along a loop closed with a kink (`Spline(*pts, pts[0])`) goes depends on
  rounding inside the kernel's fuse of its halves, so a few such loops sweep in one build and
  raise in the other (4 of 60 hard loops, 2 each way; a native build without the contraction of
  `a * b + c` differs on 4 others). None gives a wrong body; close such paths smoothly where you
  can (`Spline(..., closed=True)`). Where the fuse leaves an edge whose B-spline repeats a control
  point inside it (`check()`: "Internal Coincident ControlPoints"), OpenCASCADE can make curves for
  a face's edges in its parameters that cross, and take the face for invalid when it reads the STEP
  file: of the 126 sample bodies (60 loops and three more, each with a circle and a rectangle), one
  circle of smlibwasm's (its `.brep` file reads as valid).
- The kernel's hidden curve removal behind `outline` and `drawing_views` (`SmHCR`) can judge a
  piece of a tilted view wrongly: seen along (1, 1, 1), the flange example as built
  (`examples/flange.py`) lacks an arc of its plate's rim and two pieces at its neck natively (61.4
  mm of 1096.1; smlibwasm, and the same body read back from `.smb`, draw them). Views along the
  axes were right in every case tested; check a tilted view of a symmetric part for symmetry.
- Healing of imported periodic faces (tori, spheres) can go wrong.
- A Boolean in which the faces cross along a curve tangent to a seam goes wrong in the kernel
  where smlibpy cannot move the seam away: the outer equator of a torus (no turn about the axis
  moves it, and the kernel's torus has no other place for it), and seams of free-form faces that
  are no cylinder, cone, sphere or torus. Seams of bodies of revolution are turned with the body,
  seams of other bodies (an earlier hole in a part) are moved on their face (the face's solid added
  and taken away again turned), and B-spline faces that are cylinders, cones, spheres or tori are
  recognized as such first. Where a seam still touches at a point, the result's faces are checked
  against the operands (16 x 16 points a face near the seam) and a wrong result is done again with
  NURBS copies or refused; a wrong body whose faces near the seam agree with the operands at those
  points can still pass (in 160 random cases of holes and torus slices, none was off by more than
  1e-4 of a piece, where OpenCASCADE and an integral differ by as much).
- Rounds where three fillets meet at a corner of mixed convexity can fail; round the
  edges in a different order or with different radii.
- The corner patch where three rounds meet is tangent continuous (G1) only, also for G2 and G3
  blends (`SmApiBrep.h`: "three-edge corner boundaries guarantee only G1").
- The fillet executive's set-back corners (`SmFilletCorner::SetSetBackDist`: the rounds end short
  of the vertex and a larger patch joins them) read freed memory in every case tried (the kernel's
  own test case too: patched, `SmCurveClass.cpp`), and merge into the faces only where each edge
  lists the edgeuse that runs along it first (as the kernel's own test box does; `SmApiCreateBox`'s
  boxes do not, and the merge failed on conflicting mates): `fillet(setback=)` reorders the edges'
  edgeuses first. Corners where a face turns inward (a pocket's rim) come out broken: only corners
  of all convex or all concave edges are set back. Corners between slanted faces (a frustum's) come
  out with gaps: refused (`KernelError`). Radius laws with set-back corners crashed the executive:
  refused (`ValueError`).
- A radius that varies around a closed run of several edges (the top outline of a rounded plate)
  gives broken rounds (an extra face, open), whatever edge the run starts at and also with the
  same radius and slope where it closes; smlibpy refuses it. Along open runs and around a single
  closed edge such laws are right.
- Of the raw kernel calls (`smlibpy._core`), `k.project_curve_to_surface` can return unrelated
  geometry (a slanted line in front of a cylinder came back as 25 mm of its seam: `SmApiProjectCurve`
  takes the curve's size as the tolerance of the drop), and `k.drop_curve_to_surface` drops within
  10 and lifts within 0.001. smlibpy calls neither; use `Face.project`.
- Where the kernel has no corner for how the selected edges meet at a vertex (the two halves of
  an edge that another face touches tangentially), the fillet fails at any size
  (`SM_ERR_INVALID_INPUT`); select fewer edges there.
- A chamfer with different setbacks on a sharp wedge (setbacks less alike than the cosine of the
  angle between the faces) offsets one face backwards farther than the kernel's solver takes:
  smlibpy cuts the bevel's prism along a straight edge between planes whose ends lie on planes at
  right angles to it; other such edges (curved, ending on a slanted face or where another bevelled
  edge ends) raise `ModelingError`.
- `move_faces` and `offset_faces` (the kernel's `LocalOperation`) cannot change which faces meet:
  a face pushed past another one, or one that would vanish, raises; use a Boolean there. The
  kernel gives the faces around the edited ones that it extends surfaces of its own (a vertical
  round of a box whose top is pulled up a surface of extrusion, a cone a B-spline): smlibpy puts
  their cylinders and cones back where they still lie on them. It drops cavities: smlibpy edits
  (and drafts) the outside and the cavities apart and cuts the cavities out again; a part with a
  body inside a cavity is refused.
- `shell` cannot open a face whose rim meets its neighbours tangentially, such as a face
  bordered by fillets. smlibpy cuts planar ones out of the part shelled closed, also next to an
  ordinary opening; for a curved one, one next to a drafted wall, or two such openings that meet,
  shell first, then round the rim.
- SM_API asks the fillet executive for its global merge before `SetFilletParameters`, which turns it
  off again, so fillets run without it. Turning it on for real changed no near-limit fillet and
  broke chamfers and G2 rounds of a box with a hole, so smlibpy leaves it off as well. What does
  make near-limit rounds exact is the finer approximation tolerance above.
- Very close to the limit rounds still fail (all edges of a 10 mm cube with r 4.99); fillets and
  chamfers of some parts made of Booleans fail where the kernel's rounds roll over an edge, and
  the error then names the corner or edge.
- The kernel's skin with side-boundary rails needs as many sections as the rails have control
  points (the fillets that use it place one at every knot of their rails), and its two-rail sweep
  only approximates its rails: 40 mm wavy rails were missed by 0.31 with its default 4 points
  between profiles, by 5e-3 with 64 and by 1.6e-4 with 1024 (1.5 s, 61065 control points).
  `loft(sections, rails=)` and `sweep(profile, path, rails=)` build Gordon surfaces instead
  (`N_CreateGordonSrf` on a network made to cross at common parameters), through sections and rails
  exactly; a Gordon surface is open, so closed sections and profiles along rails raise `ValueError`.
- `fill(..., tangent=True)` cannot meet sheets that stand steep to the loop (a cylinder's wall
  round its open top, a sphere cut at its equator): a four-sided patch over a smooth closed loop has
  both parameter directions along the loop at its corners, and every construction of the kernel's
  corner blend folds back over the wall (`ModelingError`; use `tangent=False`). Its N-sided fills
  (five sides and more) approximate the cross tangents and meet the sheets within about 1.4 degrees
  whatever tolerances it is given (`fill` checks 2 degrees). A three-sided tangent fill has a pole,
  and the kernel's offset of such a patch does not finish (`thicken` stops at `GUARD_SECONDS`); the
  patch sewn to its sheets is a valid part.
- The kernel's body writer (`.smb`) writes no attributes: names, colors and the K-factors of
  folded parts go into `.smp` files; a part read from `.smb` unfolds at 0.44 unless `k_factor=` is
  given.
- The offset code behind `shell`, `offset` and `thicken` depends on memory layout in its extended
  mode: the same call can fail, succeed or crash (some imported parts still crash it now and then,
  on a freed Vertex in `SmBrep::GlueVertices` or a Loopuse naming a freed Edgeuse, neither located,
  and AddressSanitizer once saw a read past the points of a curve classification in
  `sm_FixProblemsBySqueezing`, not seen again). smlibpy runs it in another process (a forked copy
  on Linux and macOS, a helper process on Windows; smlibwasm: in a kernel of its own), so a crash
  raises `ModelingError` and this process goes on, and it tries a mode again only after a result it
  refused, not after an error. A step longer than `smlibpy.defeature.GUARD_SECONDS` (20 s) is
  stopped.
- A few small leaks remain on the kernel's failure paths: the curve copies of EdgeDefinitions that
  some Booleans drop without imprinting them (152 bytes each, about 24 in a failed extended shell),
  and a curve copy of the classification of a fillet that fails after making its faces (about 16
  kB). `third_party/patches/README.md` lists them.

## Where the kernel gave up

A `KernelError` names the smlibpy call, the kernel's status and a hint. Its `trace` says where in
the kernel the call failed: the failures the kernel reported during the call, oldest first, the
last 48 of them, as `"SM_ERR at SmFilletExecutive.cpp:1603 (DoFillet)"` (the status, the kernel's
file and line, its function). It ends with the chain from the deepest function that failed to
the kernel's API function; what comes before are errors the kernel recovered from (a step it
tried another way). Steps in another process bring theirs back. Where the kernel's call runs over
several lines, the line is its last as clang builds it (macOS, smlibwasm) and its first as GCC and
MSVC do (Linux, Windows): `SmMerge.cpp:4445` below on Linux.

```python
try:
    Box(20, 20, 20) - Cylinder(3, 40).rotate(Z, 45) - Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)
except KernelError as e:
    print(e.status)       # SM_ERR
    print(e.trace[-3:])   # ('SM_ERR at SmMerge.cpp:7180 (MakeFaceuse)', 'SM_ERR at SmMerge.cpp:4449 (ManifoldBoolean)', 'SM_ERR at SmApiBrep.cpp:233 (SmApiBoolean)')
```

smlibwasm's `KernelError` has the same `status` and `trace`:

```js
try {
  Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 45)).cut(Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0))
} catch (e) {
  if (e instanceof KernelError) console.log(e.status, e.trace.slice(-3))   // the same as above
}
```

The trace is for bug reports and for maintainers: it changes with the kernel, and the builds can
give up in different places (both give up on the holes above in `SmMerge::MakeFaceuse`; on
others one build fails where the other does not). The raw layer reads it with
`ext.kernel_trace()` (the entries and how many there were since `ext.clear_kernel_trace()`).
Reporting a failure costs a function call on the kernel's error paths only; the test suites take
as long as before.

## Steps in another process

The kernel can crash (read or write memory it has freed) or loop on some inputs, and nothing stops
a kernel call from outside: Python handles Ctrl-C only once the call has returned. smlibpy runs the
kernel steps known to crash or loop in another process and waits for them there, at most
`smlibpy.defeature.GUARD_SECONDS` (20 s):

- the steps of `remove_fillets` and `remove_faces` (SMLib's patching code loops or crashes on some
  parts), `surface_fillet`, `shell`, `offset` and `thicken` (the offset code), and `Part.cells()`
  (the stitcher);
- fillets and chamfers of parts read from files (`import_step`, `load`, `import_usd`) and of the
  parts made from them: the fillet code crashed on 10 of 479 imported parts before it was patched;
- every Boolean (`+`, `-`, `&`, `merge`) once `smlibpy.defeature.GUARD_BOOLEANS = True` (off by
  default), for long batch runs over unknown inputs.

The step's result comes back as an exact copy (the kernel's binary `.smb` for bodies, anything else
pickled), and this process never runs the step itself. A step that crashes the kernel there raises
`ModelingError: <step>: the kernel crashed (signal 11, in a copy of this process); this process is
fine`, one that takes longer than `GUARD_SECONDS` `ModelingError: <step>: the kernel did not finish
within 20 s`, and Ctrl-C stops the step at once (`KeyboardInterrupt`); errors and warnings of the
step are raised here as they were raised there. Ctrl-C does not stop a kernel call that runs in
this process (any other step): it waits until the call returns.

`smlibpy.defeature.GUARD_PROCESS` says where the steps run: `"fork"`, a forked copy of the process
per step (Linux, macOS; about 1.5 ms); `"helper"`, one helper process for the session, started with
the first step and again after one crashed it or ran too long, which gets the bodies as `.smb`
files (Windows, and processes that must not fork); `"auto"` (the default), a fork where the system
can fork and the helper elsewhere. A frozen application, or a helper that does not start, runs the
steps in its own process (with a warning, once). There the kernel's deadline still holds a step to
`GUARD_SECONDS`: smlibpy sets it around the step (`smlibpy._core.ext.set_deadline`), and the loops
of the kernel's surface and topology intersections, where the steps found looping for good spend
their time, give up once it has passed (a patch, `SMLIBPY_DEADLINE_ER` in
`third_party/patches/SMLib/inc/SmMessages.h`); the step then fails as one that did not finish in
another process, within a few seconds of the deadline. A crash still ends the process there, and a
step that spends its time elsewhere in the kernel is not stopped. `GUARD_SECONDS = 0` runs the steps
in this process without a limit. smlibwasm runs the same steps in a probe worker, a kernel of its
own (`setGuardSeconds`, `setGuardBooleans`), and holds them to the deadline on a page's main
thread, where no probe worker runs.

```python
# not run
import smlibpy.defeature

smlibpy.defeature.GUARD_SECONDS = 120      # large imported parts
smlibpy.defeature.GUARD_BOOLEANS = True    # a batch over STEP files that must not end on a crash
smlibpy.defeature.GUARD_PROCESS = "helper" # an application that must not fork
```

## Threads

The kernel is not thread-safe: its one context keeps shared state without locks (the marks of its
traversals, the caches of curves, surfaces and bodies). Every function of smlibpy's kernel module
(`smlibpy._core`: also the methods of its objects, and the deletions that run when a body is
garbage collected) takes one lock, so the kernel runs one call at a time, whichever thread makes
it. The long calls let Python's GIL go while the kernel works: Booleans, fillets and chamfers,
shells and offsets, sweeps and lofts, tessellation (`mesh()` and the exporters), mass properties,
distances, deformations, removing fillets and faces, drafts, sheet-metal bends, surface fits, the
cells of a body, STEP and USD import, healing, stitching and mesh Booleans. Other Python threads
run on meanwhile, and those that call the kernel wait for it. A cut of a plate by a tool of 144
pins, 0.3 s in one kernel call, paused a thread that ticks every 5 ms for 7 ms (the whole 0.3 s
before); meshing the result at 0.01 mm, about 6 s, paused it for 18 ms. The short calls keep the GIL:
letting it go costs a thread switch, and a query takes microseconds.

So a GUI, a web server or a progress bar stays responsive while a model builds in another thread.
Threads that model at once get what one thread gets, but no sooner: there is one kernel, and they
take turns. To model in parallel, use processes (the MCP server runs each session's kernel in a
worker process of its own; `concurrent.futures.ProcessPoolExecutor` for a batch). A fork waits for a
kernel call of another thread to end, so that the forked copy starts with the kernel at rest (the
guarded steps above fork, and so does `multiprocessing` on Linux; Python warns that a process
with threads forks; a program that must not fork sets
`smlibpy.defeature.GUARD_PROCESS = "helper"`). smlibwasm runs on one thread; each `KernelWorker`
has a kernel of its own.

## What queries keep

A query keeps what the kernel computed for it on the body's curves and surfaces (evaluation grids,
trimmed-surface data, the spatial trees of its boxes) for as long as the body lives, and that can
outweigh the body: on a holed, filleted box of 129 KB, `bbox()` added 41 KB, `mesh()` 754 KB and
`distance_to()` 799 KB (smlibwasm: 90 KB, and 34, 541 and 573 KB). A query that finds them is
about 1.2 times as fast (twice for `closest_point()` after `distance_to()`); Booleans gained
nothing from them. `compact()` frees them: the body does not change, and the next query builds
what it needs again. Compact what is kept but no longer queried, such as the copies of a large
pattern after they were measured or exported:

```python
part = Box(40, 30, 10) - Cylinder(5, 20)
copies = [part.translate(i * 50, 0, 0) for i in range(20)]
boxes = [p.bbox() for p in copies]
for p in copies:
    p.compact()
```

## Checks of the kernel

Besides the test suites, the "Checks" workflow (`.github/workflows/checks.yml`) runs slower checks
of the kernel every night, on demand, and the fuzz run also on pull requests that change the
kernel, its patches or the modelling code (there with the seeds 7 and 8 only; nightly also with
the day's date as a seed). Each one runs locally the same way:

| Check | Command | What fails it |
|---|---|---|
| Fuzz: seeded random models (Booleans, fillets, chamfers, shells, offsets, slices) of primitives placed flush, touching, centred or on a face, each in a forked process, through smlibpy and, with `--wasm`, smlibwasm on the same parameters | `python tools/fuzz/fuzz.py [--seed N] [--wasm]` | a crash of the kernel whose signature (the kernel functions at the top of its stack, from gdb or lldb) `tools/fuzz/baseline.json` does not know; any hang; for the seeds 7 and 8 (the regression corpus) a result that breaks an invariant, crashes or diverges between smlibpy and smlibwasm where the baseline's runs did not; a share of such results more than 0.3 points above the baseline's |
| AddressSanitizer and LeakSanitizer over the tests of the guarded and patched kernel code and of smlibpy's own C++ (the `tests/test_lane_*.py` files and the files of the modelling, surfaces, sheet metal, I/O and guard tests), every kernel step in the test process | `python tools/sanitize/run.py --build build-asan` (third_party/patches/README.md says how to build it) | a test that fails (tests that measure memory, reach a known memory error or cannot run there are left out, `tools/sanitize/guard_off.py`); a memory error not in `tools/sanitize/known.txt`; a leak of the kernel or smlibpy's C++ not in `tools/sanitize/leaks.txt` |
| Upstream's kernel tests (usd-brep `prog_test`, 17 suites) against the patched kernel | configure with `-DSMLIBPY_PROG_TEST=ON`, then `python tools/oracles/prog_test.py` | a suite that does not pass |
| Upstream's tests of its Python bindings, against `smlibpy._core` | `python tools/oracles/smpylib_tests.py` | a test that fails, but for those of the `usd` submodule, which smlibpy builds without |
| Upstream's 200 `.smb` test files | `python tools/oracles/smb_files.py` | a file whose kind, face count, volume, validity or mesh differs from `tools/oracles/smb_files.json` |
| Crash loops: the calls that crashed the kernel (O1, O4 of the kernel plan), again and again in fresh processes with the guard off | `python tools/oracles/crash_loops.py --runs 20` | a crash of a case not marked known (two still crash now and then, contained by the guard: their rates are printed) |
| NVIDIA's BrepArray validator (usd-brep's `brep_validator`, 191 rules) on USD files, without OpenUSD: upstream's rule checker on a shim of the `pxr` calls it makes (`tools/oracles/usd_shim`). The test suites run it on what `export_usd` and `toUsd` write | `python tools/oracles/usd_validator.py FILE.usda ...` | a rule a file fails (the tests leave out BA.465, control points in the body's box, for bodies read from other software: upstream's own files fail it) |
| NVIDIA's validator itself (`brep_validator.validate_file`, with OpenUSD): the BrepArray rules and the asset validator's general USD rules. `pip install "usd-validation-nvidia[usd]"` brings OpenUSD and the asset validator on any platform, and the tool takes the BrepArray rules and the omniSolid schema from the submodule; `usd-brep[validation]` (Python 3.12 on Linux and Windows) brings all of it. The test suites run it on what `export_usd` and `toUsd` write and on a file broken on purpose; CI's Linux (Python 3.12), macOS and JavaScript jobs install it, and `SMLIBPY_REQUIRE_USD_VALIDATOR` fails these tests there instead of skipping them | `python tools/oracles/usd_validator.py --nvidia FILE.usda ...` | a BrepArray rule a file fails (BA.465 left out as above), or a general rule other than `UsdAsciiPerformanceChecker`, which asks for large arrays in binary (crate) files |
| smlibwasm against smlibpy: the text of the writers smlibwasm has its own copy of (STEP, USD, DXF, OBJ, glTF, STL) for the same bodies, and the numbers of some modelling steps, with the known differences of the builds (`KNOWN`) | `python tools/parity.py [--update]` writes or checks `tests/data/parity`; `js/test/lane_WN.test.ts` compares smlibwasm with it | text that differs but for numbers to 1e-9, a number off by more than 1e-7 of it, a count or an error that differs, a known difference that went away |

The fuzz run's invariants: every result is a valid body within its box's volume;
|A u B| + |A n B| = |A| + |B|, |A - B| = |A| - |A n B| and the cells of `A.merge(B)` add up to
|A u B| (1e-6); fillets, chamfers, shells and offsets of a single primitive have the exact volume
(2e-6), a shell removes volume, `offset(d).offset(-d)` of a primitive is the primitive; the parts
of a slice add up to the body. A new failure is made smaller (the edges a fillet rounds, the
openings of a shell) and written as a pytest file (`repro/` in the output directory, an artifact
of the workflow). Seeds 7 and 8 take about 55 s each language on an M-series Mac. A few Booleans
of seed 8 come out differently from run to run (they depend on where the kernel's objects lie in
memory), so the baseline (per platform: `--update-baseline --repeat 3` writes this platform's,
`--unite` adds a run's failures to it) unites several runs, a new failure of a known seed counts
only if two more runs, each in a fresh process, repeat it, and a divergence between a right result
and the way the baseline knows the case to fail does not count. Two crash sites were known
(`KNOWN_CRASHES` in `tools/fuzz/fuzz.py`): the stitcher's ray behind `cells()`
(`SmBezierAux2d::BuildPolarBox`) and the extended offset mode's merge on filleted boxes
(`SmEdge::CalculateBoundingBox`); both are patched now (`third_party/patches/README.md`), and
smlibpy still runs both steps in another process.

`baseline.json` has two platforms: darwin-arm64 (an M-series Mac) and linux-x86_64, which CI's
`ubuntu-latest` runs. The Linux baseline was made in a `linux/amd64` container (Python 3.12, Node
24), whose x86_64 arithmetic is the CI runners'; gdb cannot trace a process under that emulation,
so the crashes of its seeds 7 and 8 are known by case (the all-edge fillet of two cones, case
`fillet-7-185`, kills the process on Linux x86_64 where macOS raises), not by their kernel functions.

The checks ran on Linux for the first time in a container (`linux/amd64`, as CI's runners): the
test suite, upstream's `prog_test` suites, SmPyLib's tests, the 200 `.smb` files, the crash loops,
the fuzz run against both baselines and the sanitizers. Three things held on macOS only and are
fixed: a round close to the largest radius that fits came back open (now measured, see
[Robustness work in smlibpy](#robustness-work-in-smlibpy)), a sweep along a closed spline with a kink
crashed the kernel (a ProtoEdge left in the lists of its ProtoFaces, `third_party/patches`), and
`tools/parity.py` compared files written from bodies the platform made. NVIDIA's validator itself
(`validate_file`) ran there on 40 files of both builds from usd-brep's wheel, and runs on macOS
with `usd-validation-nvidia[usd]` and the submodule's BrepArray rules, with the same verdict for
each of those files: every file passes the BrepArray rules; of the asset validator's general rules
only `UsdAsciiPerformanceChecker` complains, which asks for large arrays in binary (crate) files.
The helper process for guarded steps (`GUARD_PROCESS = "helper"`, Windows' default) is tested on
macOS and Linux by choosing it; it has not run on Windows itself.

## Building the kernel

The build compiles about 250 C++ files and takes a minute or two. It is single threaded
inside the kernel unless oneTBB is available (`-DSMLIBPY_USE_TBB=ON`, used for parallel
tessellation and Boolean preprocessing).
