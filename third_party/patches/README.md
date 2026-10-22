# Kernel patches

smlibpy builds the SMLib kernel from the usd-brep submodule (`third_party/usd-brep`, release
1.0.0, commit c9c5979), which stays as published. A few of its source files have defects that
smlibpy cannot work around from outside. Fixed copies of those files live here, and
`CMakeLists.txt` compiles each one in place of the original:
`third_party/patches/<dir>/src/<file>` replaces `third_party/usd-brep/source/<dir>/src/<file>`
(`<dir>` is `SMLib` or `SM_API`). A header, `third_party/patches/<dir>/inc/<file>`, comes before
`source/<dir>/inc` in the include path of the kernel and of everything built with it (SmPyLib,
smlibpy's C++, the WebAssembly module), so every file that includes it gets the copy. The
configure step stops if a copy has no original of that name.

Each copy is the upstream file with its notices unchanged, a notice at the top saying what was
changed and why (Apache License 2.0, section 4(b)), and every change marked
`smlibpy patch` in a comment. The copies are part of the sdist (`sdist.include` in
`pyproject.toml`) and go into every build: the normal one, the wheels, and the kernel built
once for all wheels (`SMLIBPY_KERNEL_ONLY`, then `SMLIBPY_KERNEL_DIR`).

## Changes

| File | Change | Defect |
|---|---|---|
| `SMLib/inc/SmMessages.h` | In release builds, `SER`, `SER_MSG`, `SERN`, `SERN_MSG`, `SERZ`, `SER_DELETE`, `SER_DELETE_ALL_PARTS`, `NER`, `NER_MSG`, `NERN`, `AERS`, `AERS_MSG`, `AERN` and `AERN_MSG` report the failure they return to the kernel's error callback (`smos_InvokeErrorCallback`, with the file, the line and the function), as debug builds do through `smos_ErrorMessage`, without its formatting | Release builds compiled the error trace out: these macros only returned, so the callback that SmPyLib installs to collect a trail heard of nothing, and every kernel error said only `SM_ERR at <binding>.cpp`. smlibpy's own callback (`src/cpp/trace.cpp`, in place of SmPyLib's trail, which kept the first 4 kB where the failing chain comes last) keeps the last 48 failures: `KernelError.trace` |
| `SMLib/src/SmVertex.cpp` | `SmVertex::GetVertexuseOfFace` tests the face again | The face test was commented out together with the composite-face branch ("Remove Composite"), so the function returned the vertexuse of whichever face came first. `SmFilletRemoval` read its corner parameters from the wrong faces and removed nothing: upstream's known issue "`remove_fillet` removes nothing and reports success". Also feeds surface fitting through vertices (`SmFace.cpp`), UV boxes of loops (`SmLoopuse.cpp`), curve classification (`SmCurveClass.cpp`) and `SmVertex::HasParallelFaces`. |
| `SMLib/src/SmVertex.cpp` | `SmVertex::GetLoopOfFace` tests the face again (its face pointer is no longer set only in debug builds) | Same as above: it returned the loop of whichever face came first. Used by point classification (`SmPointClassification`, `SmPointClass.cpp`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::~SmProtoTopologyManager` cuts the links between ProtoVertices and ProtoEdges before deleting them | It deleted the ProtoEdges first; a ProtoVertex that still listed one then wrote into it (`SmProtoEdge::RemoveProtoVertex` from `~SmProtoVertex`). A write into freed memory at the end of every Boolean, found with AddressSanitizer on `Box(40, 30, 20) - Cylinder(5, 40)`. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` deletes the EdgeDefinitions of the short edges it removes without calling `Destruct()` first (where it deletes them after each ProtoVertex, and where it deletes the one of an edge it squeezed or deleted, which before the second change still called `Destruct()`; that place never deleted a curve a Brep used in the runs measured, 73 calls) | `Destruct()` deletes all curves of an EdgeDefinition. After imprinting, the Breps own them: the removed edge took its own along, and the other Brep's edge still used the rest. Booleans that glue coincident vertices then read freed curves (`SmEdge::CalculateBoundingBox`, `~SmEdgeuse`), and the process crashed now and then: fillet removal on an imported valve body crashed it in 3 of 3 runs, also behind the guard of `smlibpy.defeature` (the forked copy came through, the process did not). The destructor deletes exactly the curves no Brep took (see `SmEdgeDefinition::Imprint`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::SplitIntersectingProtoEdges` stops once a range solution has deleted `pPE2`, and returns `SM_ERR_BAD_INTERSECTIONS` when solutions are left; it asks `pPE2`, not `pPE1`, which ProtoVertex lies at `pPE2`'s split parameter; `sm_WhichPVToCombine` takes ProtoEdges without end ProtoVertices | The next solution split the deleted ProtoEdge (AddressSanitizer: a read of freed memory in `SmProtoEdge::Split`). Booleans of crossing holes whose seams lie tangent to the other hole, such as `Cylinder(3, 40).translate(0, 3, 0) + Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` and its cut, `&` and merge, killed the process. The solutions there are nine ranges of one ProtoEdge, each on all of the other; the Boolean cannot go on soundly. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` stops gluing a Vertex once it has deleted it (an Edge to it squeezed, or the two Vertices glued), and does not look up the mate of a deleted Vertex | With two common Edges between two coincident Vertices, the next long Edge glued the deleted Vertex again (AddressSanitizer: a read of freed memory in `SmBrep::GlueVertices`, from the offset executive's `PiecewiseMerge`). Shells and offsets in the kernel's extended mode crashed the process at random: an L-shaped body of two boxes shelled with one opening in 1 run of 4 (`Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)`, 2.94), `(Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)).offset(6)` in every run, imported parts (issue #2's family). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::ResolveOverlappingProtoEdges` takes the ProtoEdges of a group it deletes out of the lists of coincident ProtoEdges of every ProtoFace (it stopped at the first one that listed them, as its comment wonders), and puts the new ProtoEdges into each list that had them; it returns `SM_ERR_BAD_INTERSECTIONS` for a group in which a ProtoEdge has no start or end ProtoVertex | `GlueCoincidentBrepVertices` read the deleted ProtoEdges from the other lists (AddressSanitizer: a read of freed memory): the plain shell of an imported part crashed in every run (crescendo part 40). It read the missing ProtoVertex of a ProtoEdge (an offset in the extended mode, 1 run in 10, after the change above). |
| `SMLib/src/SmProtoTopology.cpp` | `SmEdgeDefinition::Imprint` deletes, when `SmBrep::MakeEdgeInFace` fails, only the curves the Brep did not take (those without an owner), for Brep 1 and for the copy and the UV curve of Brep 2 | `MakeEdgeInFace` gives the curves it is passed to the new Edge (`SetCurve`, `SetOwner`) before it links the Edge into the Face's loops, and it can fail after that: the Edge stays in the Brep with them. `Imprint` deleted them all the same (`Destruct()`), `ImprintIntersections` goes on after a failed imprint, and the next Boolean of the offset executive's `PiecewiseMerge` read the freed curve (AddressSanitizer: a read of freed memory in `SmEdge::CalculateBoundingBox`; malloc stack logging showed the same free in every native crash). Shells in the extended mode of issue #2's filleted boxes crashed the process now and then. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::IntersectTopology` fails on `SM_ERR_BAD_INTERSECTIONS` from `SplitIntersectingProtoEdges` (its other errors stay ignored) | Without it the crossing holes above gave valid bodies of the wrong volume that could not be tessellated (`h1 + h2` 1697.46 instead of 2199.24, OpenCASCADE). |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::DeleteFaces` fails with `SM_ERR_BAD_INTERSECTIONS` rather than delete a shell Vertex whose Shell still owns Faceuses | `SmBrep::DeleteVertex` deletes the Vertex's Shell with it, and the Faces left in that Shell were read when the Brep was post-processed and when it was deleted (AddressSanitizer: freed memory read in `SmEdge::GetBrep` from `SmMerge::BooleanPostProcess`, and in `~SmFaceuse`). `Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)`, a flat end cap tangent to the sphere, killed the process in 3 of 3 runs. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::ResolveIntersections` fails on `SM_ERR_BAD_INTERSECTIONS` from `ResolveOverlappingProtoEdges` (its other errors stay ignored) | The group that function cannot take out stays as it is; the Boolean must not go on with it. |
| `SMLib/src/SmMerge.cpp` | `SmMerge::BooleanPostProcess` takes only the Vertices still in the Brep (a set made after the Edges are merged, renewed after every Vertex it deletes) | A Vertex deleted earlier was read in `SmVertex::GetEdges` from `IsTopologicalVertex`: `Box(40, 30, 10).rotate(X, 45).shell(10, opening)` killed the process in 11 of 48 runs (the shell's Booleans; 0 of 96 since). |
| `SMLib/src/SmMerge.cpp` | `SmMerge::ManifoldBoolean` marks the common Vertices again (step 3.2c) when `CloseIntersectionLoop` has deleted one of them, also when it then failed (the Vertices of both Breps taken before and after the call, compared by pointer) | `CloseIntersectionLoop` squeezes coincident Vertices together (`CheckForSqueezeVertices`) before it can fail, and reports deleted topology only when it succeeds; the marking went on with the next Vertex of its list, one it had deleted (AddressSanitizer: a read of freed memory in `SmTopology::Mark`). Fusing the two halves of a tube along some loops closed with a kink, the way `sweep` went before 0.5.0 (and goes again where the profile cannot be carried along), killed the process: 2 of 60 random loops with `Circle(2)`, and one with `Rectangle(4, 1)`. |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::CreateFilletCorners` fails with `SM_ERR_INVALID_INPUT` when `SmFilletCorner::Create` makes no corner for a vertex, after deleting the list of edgeuses it kept in the corner's place, and names the first such vertex in the executive's error record; `CollectTangentEdgeSequence` walks only to solvers of the executive, each once, and stops where a solver does not end at the corner it came from | `Create` returns no corner for some ways edges meet at a vertex ("Corner Case Not Implemented"), and the executive went on with the vertex's list of edgeuses in `m_vVertexCornerMap` where the corner belonged. `CollectTangentEdgeSequence` and `SmFilletSolver::SetExtensionFlags` then called corner methods on that list (AddressSanitizer: a call to address 0). Filleting the two halves of a box edge that a cone touches tangentially, `(Box(10, 5, 20) - Cone(4, 5, 20))`, killed the process at any radius, and so did all-edge fillets of 7 of 337 imported parts and of upstream's `revolution_mold.smb`; the WebAssembly build trapped. |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::DoFilleting` shrinks only the fillet surfaces whose faces are still in the fillet Brep | The stitching of the fillet faces (`SmBrep::StitchFaces` in `CreateFilletBrep`) deletes degenerate lamina faces with their surfaces, and the FilletGeom of such a face still pointed to its surface: AddressSanitizer found it read freed memory in all-edge fillets of 2 imported parts, which killed the process. |
| `SMLib/src/SmFilletGeom.cpp` | `SmFilletGeom::MakeFaceBrep` leaves a missing (null) boundary curve to its copy loop, which fails the fillet face (`SM_ERR_NULL_POINTER`), instead of asking it whether it is degenerate | A read of address 0: chamfering all edges of `Box(30, 20, 15) + Cylinder(5.0231, 20).rotate(X, 90).translate(8.998, 6.843, 3.2765)` by 0.25 killed the process (AddressSanitizer: SEGV in `MakeFaceBrep`); the WebAssembly build read its memory at 0 and built a broken body. |
| `SMLib/src/SmFilletSolver.cpp` | `SmFilletSolver::CreateCliffRollOverSideFG` fails (`SM_ERR_NULL_POINTER`) without a side face | `ProcessRollOver` sets a rail's side edge on its last segment without looking for the face beyond it, and passed the missing face on: the all-edge fillet (r 0.5) of `Box(30, 20, 15) + Cone(3.7793, 0.8306, 12).translate(9.4467, -7.915, 6.1887)` killed the process (AddressSanitizer: SEGV reading address 0x98 in `SmFace::GetSurface`). |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::DoExtendedOffset` fails when two of the faces whose surfaces it extends use one surface, or a face uses a surface that belongs to another face | `ReplaceSurface()` gives the surface's owner face the new surface, not the face it is called for, and the extension deleted for the one face was handed out again, from the executive's table of extensions, for the other (AddressSanitizer: a read of freed memory in `GetCreateExtendedSurface`). `(Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16).translate(-2, 2.5147, -4)).shell(2.4, <the face at x = 3>)` crashed in every run, and the WebAssembly build trapped. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::ShellBrep` deletes the offset body when `ReplaceImplicitOffsets` fails | It was kept (a leak), unlike after a failed stitch. Code reading; not seen in the runs measured. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::RemoveExcessFaces` forgets the faces it removes, and their edgeuses, in the executive's relations (`m_vEUToEU`, `m_vFUToF`, `m_vEToF`, `m_vVToF`, `m_vBlendToFaces`) | `RemoveFaces` deletes them, and the rest of `DoExtendedOffset` still found them there: the side walls of lamina edges (`BuildSideWallOfEdgeuse` → `SmBrep::CreateEdgeEdgeBlend`) and then `PiecewiseMerge` read the freed edgeuses and faces. An offset whose faces collapse, such as `extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12)`, read freed memory natively and trapped in the WebAssembly build (smlibwasm). `ai/todo/features.md` (42). |
| `SMLib/src/SmSurface.cpp` | `SmSurface::CreateNaturalUVTrimCurves` empties its output arrays when it fails | It adds each boundary curve to the arrays as it makes it, and on failure its cleanup objects deleted the curves made so far, which stayed in the arrays. `SmSurface::CoincidenceCheck` (and `SmPlane`'s) ignores the status, went on with the freed curves and deleted them again (AddressSanitizer: a read of freed memory in `CoincidenceCheck`, from the extended offset mode's `PiecewiseMerge`): the shell of an imported part (crescendo part 65) crashed the process in about half of the runs. |
| `SMLib/src/SmFace.cpp` | `SmFace::HasSeamProblem` hands the seam curve it makes over to the caller's classification instead of copying it (in the classification it builds, and from the face properties it runs when called without them) | `SmCurveClassification::operator=` deep-copies a curve its source owns; the function assigned and then disowned the source, so the original curve belonged to nobody: 3.4 KB per call on a cylinder, 4.8 KB on a sphere, 12.7 KB on a torus, 8.3 KB per `heal_brep` of a cylinder with a sphere. smlibpy checks the seams of every body it imports from STEP. The copy also kept a pointer into the lost original (its UV curve, which `SplitAtSeam` reads), so the original could not just be freed. |
| `SMLib/src/SmFace.cpp` | `SmFace::GetPointsInFace` dithers its sample points with a generator of its own, seeded the same each call | It seeded the process-wide `rand()` from the clock, so its points, and the inner-shell classification that rays from them, changed from run to run (and every other user of `rand()` was reseeded). |
| `SMLib/src/SmShell.cpp` | `SmShell::IsInnerShellOf` takes the ray directions from wire and vertex shells from a generator of its own, seeded the same each call | As above (`srand(time(NULL))`). |
| `SMLib/src/SmCurve.cpp` | `SmCurve::CalculateTightBoundingBox` adds the knots of a B-spline only where they lie in the interval asked for | It added the last knot (and the tangent breaks) wherever they were: the tight box of an edge whose curve runs past the edge reached the curve's end. A box whose line edges a USD file had written over SMLib's unbounded line interval (-1234567 to 1234567) read back with `bbox()` reaching 1234560, in its edges, faces and every body made from it (the WebAssembly build reached that code only now and then and gave the right box). |
| `SMLib/src/SmCurve.cpp` | `sm_FilterSolution` (curve/curve intersection) evaluates both curves with their second derivatives | `sm_UnitizeTangent` reads the second derivative where the first is zero, and the function had evaluated only two vectors per curve: a read past the stack array (AddressSanitizer, `SmVector3d::Dot` from `sm_UnitizeTangent`), reached from `SmFace::HasSeamProblem` when `SmBrep::AssertValid` checked a body read from a damaged OpenCASCADE `.brep` file (`import_brep`, `check=True`): usd-brep's `extrusion.brep` with its extrusion direction zeroed, which `tests/test_lane_IX.py::test_brep_check_of_a_curve_with_zero_tangent` reads (the unpatched kernel aborts in it under AddressSanitizer). The value read decided only the direction of a tangent at a zero first derivative. |
| `SMLib/src/SmPlane.cpp` | `SmPlane::IsNurbSurfacePlane` also requires every control point to be the candidate plane's point at its Greville abscissae, and takes rational surfaces only with equal weights | With `HIGHER_ORDER_USE_ANALYTICS` (`SmPlane.h`) the test compared the surface with the plane at 13 fixed parameters only. A B-spline face parameterized like a plane with a bump between them was taken for a plane, and every copy that adds analytic surfaces flattened it: `SmBrep::CopyFaces` (`Face.to_shell`), the `.smb` reader, the offset code (`Shell.thicken`) and tessellation. Of 40 random single-pole bumps, `to_shell()` flattened 10. |
| `SMLib/src/SmPrimitiveCreation.cpp` | `SmPrimitiveCreation::Boolean2D` fails with `SM_ERR_BAD_INTERSECTIONS` when an edgeuse of a coincident edge of either operand lies on no face | After intersecting the two regions it classifies the faces along each coincident edge and read the mark of each edgeuse's face; an edge the intersection had left as a wire edge of a shell has edgeuses without a face, and the call read through a null pointer (address 0x38) and killed the process. A 2D union of two exclusive-or sketches whose faces touch at points crashed in 7 of 13 runs, depending on memory layout (`tests/test_lane_C.py::test_union_of_touching_xor_sketches_does_not_crash`); in the WebAssembly build such a read does not trap, it reads whatever lies at that address. smlibpy's checked route (C1) then takes its next way, and the union is right in every run. |

What the fixes change, measured on macOS arm64 with the normal build and an AddressSanitizer
build:

- The fuse of the halves of the two loops closed with a kink that killed the process raises
  `KernelError` (`fuse failed`) in 10 of 10 runs, and AddressSanitizer reports nothing for 255
  sweeps of random such loops (circles and rectangles, 90 of them with the halves fused as before
  0.5.0), nor for `tests/test_lane_S.py` and `tests/test_modeling.py`. Before: a read of freed
  memory in `SmTopology::Mark`. Over 120 random loops (180 sweeps with circles and
  rectangles), the halves fused as before 0.5.0 give the bodies they gave then wherever they gave
  one, and the 3 that crashed raise.
  `tests/test_lane_S.py::test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel` runs
  them in a process of their own.
- The kernel's own fillet removal (`_core.remove_fillet`) gives a box with four rounded edges
  back: 6 faces, volume 24000.0. Before, it removed nothing (10 faces, the rounded box).
  `tests/test_defeature.py::test_kernel_fillet_removal` checks it.
- AddressSanitizer reports nothing for `Box(40, 30, 20) - Cylinder(5, 40)` (before: a write into
  freed memory at the end of every Boolean), for `tests/test_defeature.py` and
  `tests/test_draft.py` with every kernel step in the test process
  (`smlibpy.defeature.GUARD_SECONDS = 0`), and for all 30 kernel steps of
  `remove_fillets(partial=True)` on the valve body `../models/solid/Ventil.stp` (before: 4 of
  them read freed curves). The rest of the test suite is clean as well; its last report, the
  `thicken` case of `tests/test_guards.py` that read freed memory in the kernel's offset code
  (`ai/todo/features.md`, 42), is gone with the `SmOffsetExecutive` change, and so are the
  reports for the same half cylinder thickened by -10.5, -11 and -20 (a kernel-only probe).
- The valve body: `remove_fillets(partial=True)` finishes in 10 of 10 runs, 5 with the guard and
  5 without (64 to 71 faces, 3 of 13 fillets go, 13 to 16 s). Before the
  `GlueCoincidentBrepVertices` change it crashed the process in 3 of 3 runs.
- The crossing holes and the end cap above raise `KernelError` (`SM_ERR_BAD_INTERSECTIONS`), in
  30 of 30 runs each, and AddressSanitizer reports nothing for them or for 12 rotated-box shells
  (before: a read of freed memory in each Boolean). The rotated-box shell crashed in 11 of 48 runs
  and in none of 96 since. `tests/test_guards.py::test_booleans_that_read_freed_kernel_memory_raise`
  runs them in a process of their own. Over the fuzz seeds 7 and 8 the changes turned 2 crashing
  Booleans into errors and changed no other result.
- Fillets: the cone-touched box edge above and all-edge fillets of `revolution_mold.smb` raise
  `KernelError` (`SM_ERR_INVALID_INPUT`, naming the vertex: `the corner at (5, 0, 10)`, read from the
  error record by smlibpy's `ext.round_edges`), with AddressSanitizer reporting nothing; so do the 10
  imported parts whose all-edge fillets crashed (8 from the missing corners, 2 from the shrink).
  The corners were missing in no other fillet of those 479 imported parts, of the fuzz seeds 7 and
  8 (190 fillets and chamfers) or of the test suite, and no other result changed.
- The fillet geometry and rollover (`SmFilletGeom.cpp`, `SmFilletSolver.cpp`): of 514 fillets and
  chamfers of random Boolean parts (boxes, cylinders and cones cut from or fused to a box, all edges;
  8 seeds, each fillet in a process of its own) 2 killed the process, also on the clean `next` tree;
  after, both raise `KernelError` naming the edge, and AddressSanitizer reports nothing for them, for
  the fillet and chamfer tests of `tests/test_modeling.py`, `tests/test_guards.py` and
  `tests/test_lane_FO.py`, or for 120 more random all-edge fillets (seeds 1 and 3). No other result
  of the 514 changed.
- Shells and offsets in the extended mode (the changes to `GlueCoincidentBrepVertices`,
  `ResolveOverlappingProtoEdges` and `DoExtendedOffset`): AddressSanitizer reports nothing for the
  L-shaped body, the cone offset, the two cones and issue #2's filleted boxes, nor for the shells
  and offsets of the 6 imported parts that crashed (crescendo parts 15, 19, 34, 40, 52, 65; one,
  part 81, still reads a null pointer in `SmBezierAux2d::BuildPolarBox`). Natively, with eight
  shell or offset attempts per call in the process, before: the L-shaped body crashed in 6 of 30
  runs, a second L-shaped body in 22 of 30, the cone offset and the two cones in 10 of 10,
  imported parts 15 and 34 in 6 of 6; after: 1 of 30, 0 of 30, 0 of 10 runs of 3 calls each, and
  0 of 6. Issue #2's filleted boxes still crashed now and then (1 or 2 of 10 runs of 3 calls), in
  `SmEdge::CalculateBoundingBox` as a `ManifoldBoolean` of `PiecewiseMerge` starts; neither
  AddressSanitizer nor libgmalloc took that path then (the site was found later with malloc stack
  logging: the curves of a failed imprint, below). `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` runs the
  kernel steps in a process of their own. Over the fuzz seeds 7 and 8 (110 and 100
  shells and offsets) they turned 2 crashes into errors and one refused offset into a body (whose
  faces lie at the offset distance); 3 failures failed with another error, and no other result
  changed.
- The curves of a failed imprint (`SmEdgeDefinition::Imprint`): the extended shell of a 20 mm cube
  with all edges rounded by 2 (wall 1, top open) and of issue #2's boxes (40 x 30 x 10, rounds 1
  and 2, walls 0.5 and 1), 8 raw `k.shell_brep` calls per process: before, 27, 8 and 7 of 300
  processes crashed, after 0 of 300 each. Under lldb every native crash stopped in
  `SmEdge::CalculateBoundingBox` on a curve that malloc stack logging showed freed by `Destruct()`
  in `Imprint` (6 of 6), and a breakpoint there found a curve with an owner in the runs that
  crashed and in none of the others. AddressSanitizer (random allocations between the calls to
  vary the layout): 6 of 200 processes reported that read before, 0 of 200 after.
  `tests/test_lane_FO.py::test_extended_shells_of_filleted_boxes_keep_their_curves` runs the calls
  in six processes of their own (with the old kernel it failed in 6 of 9 runs).
- The natural trim curves (`SmSurface::CreateNaturalUVTrimCurves`): crescendo part 65 (shell, then
  offset by +0.5 and -0.5, extended mode, 2 calls per process): before 17 of 40 processes crashed,
  after 0 of 40; AddressSanitizer reported the read in 97 of 100 perturbed processes before, in
  none after, with the same outcomes of every call. No test of its own: the part is not in the
  repository, and no part made with smlibpy reached that path.
- The plane test: a 21 x 21 cubic sheet with one control point raised by 5 between the sample
  parameters keeps its bump through `Face.to_shell()` (area 3607.471, not the plane's 3600.0), an
  `.smb` round trip (top at 2.2222, not 0) and `thicken(2)` (7212.841, not 7200.0), and its mesh is
  no longer flat; B-spline faces that are planes (`Box(...).to_nurbs()`) still come back as planes
  from `.smb`. `tests/test_surfaces.py::test_bspline_faces_with_a_bump_stay_curved` checks it.
- The seam check: `ext.seam_problems` on a cylinder, a sphere and a torus, `heal_brep` and STEP
  imports of a box with a hole leave the heap as it was (malloc zone statistics; before: 3408, 4848
  and 12672 bytes per call, 8256 per `heal_brep`, 3408 per import); 1000 checks of a torus with a
  cylinder and 100 imports grew a process by 16.7 MB, now by less than 0.5 MB (the WebAssembly build:
  2000 checks 28 MB, now 0.6 MB). AddressSanitizer reports nothing for `tests/test_step_import.py`
  (which runs the seam repairs of `SplitAtSeam` on the curves handed over), `tests/test_io.py`,
  `tests/test_tessellation.py` and `tests/test_measure.py` (121 passed). LeakSanitizer did not run
  then (Apple's clang has none on macOS arm64); the heap statistics stood in for it. Over 449 STEP files (611 bodies) of the
  classcad-mcp corpus, no volume, face count, validity or error changed with the seam and the
  random-number changes.
- The error reports (`SmMessages.h`): a failed call's `KernelError.trace` ends with the chain from
  the deepest failing kernel function to the API function (crossing holes: `IntersectTopology`,
  `IntersectInsertRelate`, `ManifoldBoolean`, `SmApiBoolean`; a fillet the kernel has no corner for:
  `CreateFilletCorners`, `DoFillet`, `SmApiFilletEdges`), in both builds. Reporting costs a call
  on the failure paths only: the Python suite took 74.2 and 75.6 s against 73.6 and 75.1 s before
  (two runs each), and the kernel reported 1769 failures in it (in 21597 kernel calls of the test
  process; most are errors it recovers from); the WebAssembly module is 7.82 MB, 188 kB more
  (1.85 MB with brotli, 46 kB more). No result changed (both suites, the parity files of
  `tools/parity.py`), and AddressSanitizer reports nothing for `test_defeature`, `test_guards`,
  `test_draft`, `test_io` and `test_lane_WN`.
- The tight box: a USD file with such line edges reads back with `bbox()` of +-5, as the box is
  (`tests/test_io.py::test_usd_line_edges_are_written_as_long_as_the_edges`, which also checks that
  smlibpy no longer writes such files).
- The planar Boolean: the 2D union of two exclusive-or sketches whose faces touch at points (case 16 of 40
  random ones checked against OpenCASCADE) finishes in 24 of 24 fresh processes with the right area,
  219.190364 (before: a crash in 7 of 13 runs, in `SmTopology::IsMarked` called from `Boolean2D` with a null
  face). The 1134 results of the C1 oracle families (exclusive ors, pairs of them, islands, rings and the
  repros, against OpenCASCADE) are as before: right, except one exclusive or that raises `ModelingError`.
  AddressSanitizer reports nothing for them; it never takes the crashing path itself (its allocator lays
  memory out the same way every run), so the null read was located with lldb in the normal build.
- The curve intersection's solution filter (`SmCurve.cpp`, `sm_FilterSolution`): 16 writes and 137
  reads of `.brep` files and 1500 fuzzed ones (truncated, tokens and lines swapped, deleted or
  replaced) report nothing under AddressSanitizer; before, usd-brep's `extrusion.brep` with its
  extrusion direction zeroed read past the stack array when the kernel checked it. No result of
  either test suite changed (the value read decided only a tangent's direction where the first
  derivative is zero).
- Both test suites pass.

Defects that remain in the kernel, and what smlibpy does about them:

- Crashes and loops in the feature executive's patching (`ai/todo/features.md`, 37):
  `smlibpy.defeature` runs each step of `remove_fillets`, `remove_faces` and `surface_fillet` in
  another process (a forked copy, or a helper process; smlibwasm: a probe worker with a kernel of
  its own), whose result comes back as an exact copy.
- The extended offset mode still crashes on some imported parts (raw kernel calls, shell and two
  offsets per process): crescendo part 52 in 24 of 40 processes, where `ImprintIntersections` goes
  on after `SmBrep::MakeEdgeInFaceWithVU` has connected only the start of a closed Edge (its
  sectoring of the end Vertex then reads the missing end Vertex in
  `SmEdgeuse::CreateUVTrimCurve`, address 0x98, and with that read guarded the Boolean crashes
  later in `SmTopologyTraverser::CollectFaces` on the half-made Edge, 6 of 40: the fix belongs in
  the imprint, which should fail the Boolean instead of going on); crescendo parts 81 and 19 read a
  null pointer in `SmBezierAux2d::BuildPolarBox` (half of the runs of part 81). `shell`, `offset`
  and `thicken` run their kernel steps only in a forked copy (smlibwasm: the probe worker), so
  these raise `ModelingError`.
- Booleans in which the seam of a cylinder, cone, sphere or torus runs tangent to a face of the
  other operand return valid bodies of the wrong volume (`ai/plan/kernel-deep-dive.md`, B6); the
  site is not located, and the gaps of such bodies are about 1e-8, so no check catches them.
  smlibpy finds such seams and turns the operand that owns the seam about its axis first
  (`src/cpp/seams.cpp`, in `ext.boolean`) where it is a body of revolution; a seam of another
  body, a torus' outer equator and seams on B-spline faces keep the defect.
- Found with AddressSanitizer and the fuzz run of the kernel plan, not located or not fixed: the
  extended offset mode reads a ProtoEdge that `SplitIntersectingProtoEdges` deleted
  (`SmProtoEdge::GetOverlappingPEGroup` from `ResolveOverlappingProtoEdges`, depending on memory
  layout; `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` crashes its
  process in about 1 to 3 runs of 100); the all-edge fillet of `Cone(3, 0, 10).rotate(Y, 90) -
  Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1, 0)` writes freed memory in
  `SmLoopuse::CollectEdgeuses` from `SmMerge::BooleanPostProcess` inside the fillet executive (the
  normal build raises `SM_ERR_NULL_POINTER`); `(Box(20, 16, 4) - Sphere(6).rotate(X,
  90).translate(1.4007, 0, -1.5863)) & Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)` kills
  the process (the WebAssembly build traps); the Boolean of the meshes of two internally tangent
  cylinders at a fine tolerance (`tessellate(...) & tessellate(...)`) kills it too;
  `SmApiBooleanWithCurves` returns common edges that `BooleanPostProcess` deleted (smlibpy does
  not call it). `SmBSplineSurface::CreateHelicalSweep` keeps a pointer to an `NL_SURFACE` on its
  own stack; nothing calls it, and `tests/test_lane_U.py` fails if something starts to.
- `SmBrep::Point3DClassify` takes the region from one ray along +X, and once a tight bounding box
  (or `ComputePreciseProperties`) has run on a body, `BrepPointSolve` can find no face along +X
  where the ray crosses one. `ext.classify_points` lets rays in other directions vote;
  `SmApiBrepRelationship`, which smlibpy does not rely on, has the same cause.
- SM_API's `SmApiFilletEdges`, `SmApiFilletEdgesPerEdge`, `SmApiVariableRadiusFillet` and
  `SmApiSetBevelCorners` ask the fillet executive for its global merge before `SetFilletParameters`,
  which turns it off again. Not patched: with the request moved after it (a copy of
  `SM_API/src/SmApiBrep.cpp`, measured on macOS arm64), all-edge fillets of 10, 20 and 40 mm cubes
  near the limit (r 4.9 to 4.99, 9.9 to 9.98, 19.96) and the stepped block's rollover (r 1.5 and 3 on
  a 1 mm step) gave the same bodies or errors as before, and the chamfer and the G2 round of all
  edges of `Box(40, 30, 20) - Cylinder(5, 40)` (1 mm) became open bodies, which smlibpy refuses
  (`tests/test_lane_FO.py::test_sm_api_global_merge_stays_off`). smlibpy's `ext.round_edges` keeps
  global merge off as well. What makes `SmApiCircularFillet` exact near the limit is its solvers'
  approximation tolerance (the Brep's tolerance, where `SetFilletParameters` takes 4 times the
  edge's): with 1 times the edge's tolerance those cubes were exact (to 3e-9), and its
  cross-sections, self-intersection handler, angle tolerances and global merge made no difference.
  `ext.round_edges` takes the factor (`tolerance_factor`), and `fillet` and `chamfer` try 1 after a
  failure with 4: over 514 fillets and chamfers of random Boolean parts the finer tolerance changed
  no result by more than 3e-6 and made 4 near-limit ones succeed, but it failed the chamfer of
  `examples/gear` that SM_API's builds, so it comes second (`smlibpy/shapes.py`, `_with_finer_rounds`).
- The fillet executive's set-back corners (`SmFilletCorner::SetSetBackDist`; SM_API has no entry
  for them): `SmFilletCorner::InsertIntersectionTopology` merges a fillet edge's own curve into the
  faces it lies on, and `sm_SetDoFilletingGeometry` gives that edge a new curve and deletes the old
  one while `SmCurveClassification::MergeInterval` is still classifying it (AddressSanitizer: a
  read of freed memory). Every set-back corner tried killed the process, the kernel's own test
  case too (`smFilletTest.cpp`, case 303: all edges of a box, r 1, setback 1.25). Merging a copy of
  the curve stops the crash, but the bodies then come out open (a 20 mm cube, all edges r 1,
  setback 1.25: 84 open edges, 4 of its 6 planes gone). Not patched: smlibpy offers no setbacks
  (`corners="mitre"` uses the executive's bevel corners, which are sound).
- Small leaks on failure paths, not patched: `SmFilletCorner::Create` keeps its list of edgeuses
  when it makes no corner, and a failed extended shell keeps about 4.7 KB of curve copies
  (`SmOffsetGeometryCreation::ExtendTrimEdges`, found with macOS `leaks`).

## Checking with AddressSanitizer

`tools/sanitize/run.py` does it (and CI's "Checks" workflow runs it every night on Linux):
configure a separate build directory with
`-DCMAKE_BUILD_TYPE=RelWithDebInfo -DSKBUILD=ON -DCMAKE_CXX_FLAGS="-fsanitize=address -fsanitize-recover=address -fno-omit-frame-pointer"`
(`-DSKBUILD=ON` keeps its `_core` module in the build directory rather than writing it over the
one in `src/smlibpy`; `-fsanitize-recover=address` lets a run go on after a report), build it, and
run `python tools/sanitize/run.py --build <dir> [tests]` (by default `tests/test_defeature.py`,
`test_guards.py`, `test_draft.py` and `test_io.py`). It puts the module next to a copy of
`src/smlibpy`, preloads the sanitizer's runtime (`LD_PRELOAD`; on macOS
`DYLD_INSERT_LIBRARIES`, for which it runs the Python binary itself, not a wrapper such as `env`
or `timeout`, which drop the `DYLD_` variables), runs every kernel step in the test process
(`GUARD_SECONDS = 0`), and reads the reports: a memory error fails the run unless
`tools/sanitize/known.txt` names it, and so does a leak of the kernel or of smlibpy's C++ unless
`tools/sanitize/leaks.txt` names it. LeakSanitizer runs on Linux and, on macOS, with LLVM's clang
(`-DCMAKE_CXX_COMPILER=$(brew --prefix llvm)/bin/clang++`); Apple's clang has none, and there
`--no-leaks` checks memory errors only (malloc zone statistics, macOS `leaks` and resident-memory
bounds stand in for the leak check). With the guard on, a defect in a forked copy shows as "the
kernel crashed (signal 6 ...)" and its report goes to stderr; add `quarantine_size_mb=8192` to
`ASAN_OPTIONS` where freed memory is read long after it was freed.

The first runs of this check (LLVM 21 on macOS arm64) found what the two lists hold: a
heap-buffer-overflow in `SmCurveClassification::FindInterval` from `sm_FixProblemsBySqueezing` in
the extended offset mode's merge (the steps of
`tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail`), and leaks in
`SmPrimitiveCreation::CreateSweepAlongPlanarPath` (the copies of the profile and path of each
segment, about 10 kB a mitered sweep) and `SmProtoTopologyManager::CreateProtoEdge`; neither is
patched yet. It also found smlibpy's own leak of the curves it handed the kernel's sweeps, skins
and offset profiles, which copy them (fixed).

## Dropping a patch

When an upstream release fixes a defect:

1. Update the submodule to that release.
2. Delete the copy here (or, if the file changed upstream and the defect is still there,
   copy the new upstream file and apply the marked changes again).
3. Rebuild from scratch and run both test suites; `test_kernel_fillet_removal` covers the
   vertex lookups. For the destructor, an AddressSanitizer build must report nothing for
   `Box(40, 30, 20) - Cylinder(5, 40)`; for the glue change, nothing for
   `remove_fillets(partial=True)` on the valve body with `GUARD_SECONDS = 0`; for the offset
   change, nothing for `extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12)`; for the
   `SplitIntersectingProtoEdges`, `DeleteFaces` and `BooleanPostProcess` changes, nothing for the
   cases of `tests/test_guards.py::test_booleans_that_read_freed_kernel_memory_raise`, which must
   still pass with the normal build; for the fillet changes, nothing for the cases of
   `tests/test_guards.py::test_rounds_that_crashed_the_kernel_raise` and
   `tests/test_lane_FO.py::test_fillet_errors_name_the_corner_the_kernel_could_not_build`, which must
   still pass; for the fillet geometry and rollover changes, `tests/test_lane_FO.py::test_fillets_that_crashed_the_kernel_raise`
   must still pass and AddressSanitizer report nothing for its two cases; for
   the changes to the offset code (`GlueCoincidentBrepVertices`, `ResolveOverlappingProtoEdges`,
   `DoExtendedOffset`), nothing for the steps of
   `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` and the plain shell of
   crescendo part 40 (with `quarantine_size_mb=8192`; the `ShellBrep` change has no check of its
   own, as its path never ran in the runs measured); for the imprint's curves
   (`SmEdgeDefinition::Imprint`), `tests/test_lane_FO.py::test_extended_shells_of_filleted_boxes_keep_their_curves`
   must still pass, and AddressSanitizer report nothing for 200 processes of 8 extended shells of
   the 20 mm cube with rounded edges, with random allocations between them; for the natural trim
   curves (`SmSurface.cpp`), nothing for the extended shell of crescendo part 65 in the same way; for the plane test,
   `tests/test_surfaces.py::test_bspline_faces_with_a_bump_stay_curved` must still pass; for the
   seam check, `tests/test_step_import.py::test_seam_checks_on_import_free_their_curves` must still
   pass and AddressSanitizer report nothing for `tests/test_step_import.py`; for the tight box,
   `tests/test_io.py::test_usd_line_edges_are_written_as_long_as_the_edges` must still pass; for
   the `ManifoldBoolean` change, nothing for the loops of
   `tests/test_lane_S.py::test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel`, which
   must still pass; for the planar Boolean,
   `tests/test_lane_C.py::test_union_of_touching_xor_sketches_does_not_crash` must still pass; for
   the error reports, `tests/test_lane_WN.py::test_kernel_errors_say_where_the_kernel_gave_up`
   (with upstream's header in a release build the trace is empty); for the curve intersection's
   filter, `tests/test_lane_IX.py::test_brep_check_of_a_curve_with_zero_tangent` must pass under
   AddressSanitizer (the unpatched kernel aborts in it).
4. Remove the row from the table above.

When the last copy is gone, this directory, `smlibpy_patch_sources` and `smlibpy_patch_headers`
in `CMakeLists.txt` can go too.

## Compiled-out functions

Some kernel functions sit in `#if NLIB_UNUSED` blocks, which nothing defines. Where smlibpy needs one,
it is copied into its own C++ (`src/cpp`), not patched here, renamed with a `smlibpy_` prefix so that it
cannot clash with the kernel should a later release compile it in:

| File | Functions | Changes |
|---|---|---|
| `src/cpp/nlib_shape.cpp` | `N_SrfShapeRegionWarp`, `N_SrfShapeFlatten` and what they call (`N_SrfShapeCreateRatBasis`, `N_SrfShapeRemoveKnots`, `N_BasisSplitNLongestSpans`, `N_SrfFuncEvalRatBasis`, `N_PtsAreInPolygon`) from `NL_SrfShape.cpp`, `NL_BasisAdv.cpp`, `NL_FuncsAdv.cpp`, `NL_FrameBasic.cpp` | `N_PtsAreInPolygon` counted both edges at a vertex less than `NL_MTOL` above a row's ray (a row through two vertices of the polygon came out as outside it); `N_SrfShapeFlatten` read the inside flags one control point off. Used by `warp` and `flatten` (`src/cpp/shape_edit.cpp`). |

