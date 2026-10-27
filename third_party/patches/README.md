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
| `SMLib/inc/SmMessages.h` | `SMLIBPY_DEADLINE_ER` and `smlibpy_deadline` (header-only, per thread): a deadline that smlibpy sets around a step (`smlibpy._core.ext.set_deadline`, `src/cpp/deadline.cpp`); once it has passed, the check reports `SM_ERR_METHOD_FAILURE_QUITING` to the error callback and returns it, and so does every later check until the deadline is set again. No deadline is set by default, and then the check reads no clock | Not a defect but a limit: nothing stops a kernel call from outside. Steps of the feature executive ran for good inside one surface intersection (the enclosure example's `remove_fillets(partial=True)`: three steps, each sampled in `SmSurfaceIntersector::DoIntersection` under `SmFeature::BuildPatch` → `SmMerge::ManifoldBoolean` → `SmFace::FaceIntersect`; lldb counted 0 new entries into the executive's and the Boolean's functions in 20 s), which froze a browser's main thread, where the WebAssembly kernel cannot run in another thread, and Python where no other process can be started. The checks sit in the loops below, where such steps spend their time, and fail through the error paths those loops already have |
| `SMLib/src/SmVertex.cpp` | `SmVertex::GetVertexuseOfFace` tests the face again | The face test was commented out together with the composite-face branch ("Remove Composite"), so the function returned the vertexuse of whichever face came first. `SmFilletRemoval` read its corner parameters from the wrong faces and removed nothing: upstream's known issue "`remove_fillet` removes nothing and reports success". Also feeds surface fitting through vertices (`SmFace.cpp`), UV boxes of loops (`SmLoopuse.cpp`), curve classification (`SmCurveClass.cpp`) and `SmVertex::HasParallelFaces`. |
| `SMLib/src/SmVertex.cpp` | `SmVertex::GetLoopOfFace` tests the face again (its face pointer is no longer set only in debug builds) | Same as above: it returned the loop of whichever face came first. Used by point classification (`SmPointClassification`, `SmPointClass.cpp`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::~SmProtoTopologyManager` cuts the links between ProtoVertices and ProtoEdges before deleting them | It deleted the ProtoEdges first; a ProtoVertex that still listed one then wrote into it (`SmProtoEdge::RemoveProtoVertex` from `~SmProtoVertex`). A write into freed memory at the end of every Boolean, found with AddressSanitizer on `Box(40, 30, 20) - Cylinder(5, 40)`. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` deletes the EdgeDefinitions of the short edges it removes without calling `Destruct()` first (where it deletes them after each ProtoVertex, and where it deletes the one of an edge it squeezed or deleted, which before the second change still called `Destruct()`; that place never deleted a curve a Brep used in the runs measured, 73 calls) | `Destruct()` deletes all curves of an EdgeDefinition. After imprinting, the Breps own them: the removed edge took its own along, and the other Brep's edge still used the rest. Booleans that glue coincident vertices then read freed curves (`SmEdge::CalculateBoundingBox`, `~SmEdgeuse`), and the process crashed now and then: fillet removal on an imported valve body crashed it in 3 of 3 runs, also behind the guard of `smlibpy.defeature` (the forked copy came through, the process did not). The destructor deletes exactly the curves no Brep took (see `SmEdgeDefinition::Imprint`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::SplitIntersectingProtoEdges` stops once a range solution has deleted `pPE2`, and returns `SM_ERR_BAD_INTERSECTIONS` when solutions are left; it asks `pPE2`, not `pPE1`, which ProtoVertex lies at `pPE2`'s split parameter; `sm_WhichPVToCombine` takes ProtoEdges without end ProtoVertices | The next solution split the deleted ProtoEdge (AddressSanitizer: a read of freed memory in `SmProtoEdge::Split`). Booleans of crossing holes whose seams lie tangent to the other hole, such as `Cylinder(3, 40).translate(0, 3, 0) + Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` and its cut, `&` and merge, killed the process. The solutions there are nine ranges of one ProtoEdge, each on all of the other; the Boolean cannot go on soundly. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` stops gluing a Vertex once it has deleted it (an Edge to it squeezed, or the two Vertices glued), and does not look up the mate of a deleted Vertex | With two common Edges between two coincident Vertices, the next long Edge glued the deleted Vertex again (AddressSanitizer: a read of freed memory in `SmBrep::GlueVertices`, from the offset executive's `PiecewiseMerge`). Shells and offsets in the kernel's extended mode crashed the process at random: an L-shaped body of two boxes shelled with one opening in 1 run of 4 (`Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)`, 2.94), `(Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)).offset(6)` in every run, imported parts (issue #2's family). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::ResolveOverlappingProtoEdges` takes the ProtoEdges of a group it deletes out of the lists of coincident ProtoEdges of every ProtoFace (it stopped at the first one that listed them, as its comment wonders), and puts the new ProtoEdges into each list that had them; it returns `SM_ERR_BAD_INTERSECTIONS` for a group in which a ProtoEdge has no start or end ProtoVertex | `GlueCoincidentBrepVertices` read the deleted ProtoEdges from the other lists (AddressSanitizer: a read of freed memory): the plain shell of an imported part crashed in every run (crescendo part 40). It read the missing ProtoVertex of a ProtoEdge (an offset in the extended mode, 1 run in 10, after the change above). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::SplitIntersectingProtoEdges` takes the ProtoEdge it deletes after `CombineProtoEdge` out of the lists of overlapping ProtoEdges of every ProtoEdge and of coincident ProtoEdges of every ProtoFace, and lists the ProtoEdge that took its EdgeDefinitions in its place; `ResolveOverlappingProtoEdges` takes each ProtoEdge of a group it deletes out of the overlap lists of the ProtoEdges outside the group; both take a ProtoEdge they delete out of the ProtoEdge lists of every ProtoVertex, and `~SmProtoEdge` and `ResolveOverlappingProtoEdges` remove it from its end ProtoVertices every time they list it | `CombineProtoEdge` moved the EdgeDefinitions and only the deleted ProtoEdge's own list; the others kept pointing to it, and `ResolveOverlappingProtoEdges` read it when it gathered an overlapping group (AddressSanitizer: a read of freed memory in `SmProtoEdge::GetOverlappingPEGroup`, from the extended offset mode's `PiecewiseMerge`, depending on memory layout: `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` crashed its process in about 1 to 3 runs of 100). A group is gathered along the lists one way only, and the upper piece of a split copies the lists of the ProtoEdge it was split from, so ProtoEdges outside a deleted group listed its members too (19 such lists in that test's steps and the guard and fillet tests, 364 over the fuzz seeds 7 and 8, 2 coincidence lists of ProtoFaces). `CombineProtoEdge` also lists the ProtoEdge it keeps a second time in its end ProtoVertices (`AddProtoEdge` adds "even if already there"); once such a ProtoEdge was deleted as a member of a group, the second entry outlived it and `FindProtoEdge` read it (AddressSanitizer: a read of freed memory in `SmProtoEdge::IsSameProtoEdge`; the extended offset of `Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)` in every run, once the lists above were right). Close-out W found the stale coincidence-list entry independently: `UpdateFaces` read it when the Boolean imprinted its EdgeDefinitions (AddressSanitizer: `SmProtoTopologyManager::UpdateFaces` from `SmEdgeDefinition::Imprint`), and `sweep(Circle(2), path)` along a closed spline with a kink (the second loop of `tests/test_lane_S.py::test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel`) killed the process on Linux x86_64 and in a native arm64 build without the contraction of `a * b + c`; smlibwasm trapped in `GetOverlappingPEGroup` in the extended offset of the fused cone after the extended shell of an L-shaped body (`js/test/guards.test.ts`) once the deadline's checks had moved its memory layout. The two fixes were merged into this one. |
| `SMLib/src/SmProtoTopology.cpp` | `SmEdgeDefinition::Imprint` deletes, when `SmBrep::MakeEdgeInFace` fails, only the curves the Brep did not take (those without an owner), for Brep 1 and for the copy and the UV curve of Brep 2 | `MakeEdgeInFace` gives the curves it is passed to the new Edge (`SetCurve`, `SetOwner`) before it links the Edge into the Face's loops, and it can fail after that: the Edge stays in the Brep with them. `Imprint` deleted them all the same (`Destruct()`), `ImprintIntersections` goes on after a failed imprint, and the next Boolean of the offset executive's `PiecewiseMerge` read the freed curve (AddressSanitizer: a read of freed memory in `SmEdge::CalculateBoundingBox`; malloc stack logging showed the same free in every native crash). Shells in the extended mode of issue #2's filleted boxes crashed the process now and then. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoEdge::CombineProtoEdge` deletes the curves of the EdgeDefinitions it leaves with the ProtoEdge its caller deletes (`Destruct()`); `SmProtoTopologyManager::RemoveCoincidentNoEdgeProtoVertex` deletes the ProtoVertex it takes out of the manager | `CombineProtoEdge` moves every other EdgeDefinition only (it takes each out of the list it walks); those left behind went with the ProtoEdge `SplitIntersectingProtoEdges` deletes, before the imprint, and their curves (the copies `SmProtoTopologyManager::CreateProtoEdge` makes) belonged to no one: LeakSanitizer listed them in failed extended shells of filleted boxes. The ProtoVertex had no ProtoEdges and nothing deleted it once out of the manager's list: about 1.5 kB in every mitered sweep along a planar path. |
| `SMLib/src/SmAdvSurfaceIntersector.cpp` | `SmAdvSurfaceIntersector::FindInteriorCurves` tests smlibpy's deadline (`SMLIBPY_DEADLINE_ER`) before each pair of surface pieces it tries for a start point | A step that runs for good spent its time here (see the deadline row of `SmMessages.h`); past the deadline the search fails as a failed intersection does. |
| `SMLib/src/SmSurfaceIntersector.cpp` | `SmSurfaceIntersector::TraceCurve` tests the deadline before each step of its trace, and `SmSurfaceIntersector::FindBoundaryStartPoints` before each boundary curve it intersects with the other surface | As above: the trace fails where it already fails when the step size cannot be computed, the boundary search where a curve's box or intersection fails. With the first two checks alone, the enclosure's steps still ran 2 s past a deadline in `FindBoundaryStartPoints`. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::IntersectTopology` tests the deadline before each pair of faces it intersects and each pair of ProtoEdges it splits, and `SmTopologyIntersector::CloseIntersectionLoop` when it starts and before each edge at the vertex it tries | As above: the Boolean fails where it already fails on a failed face intersection, before it edits either Brep; `CloseIntersectionLoop` fails where it already fails when an edge's intersection fails, before it relates or inserts anything (`SmMerge::ManifoldBoolean` ignores its failures and goes on with the next vertex). With the other checks alone, smlibwasm still spent 6 to 8 s past a 2 s deadline in the gap closing of one of the enclosure's Booleans (`IIREdgeBrep`, `MergeCurveClasses`: a profile of a module linked with function names); see `SmSurfaceDropCurve.cpp`. |
| `SMLib/src/SmSurfaceDropCurve.cpp` | `SmSurfaceDropCurve::DoTrace` tests the deadline when it starts, and `SmSurfaceDropCurve::FindBoundaryStartPoints` before each iso boundary curve of the surface it intersects with the curve | As above: past the deadline a curve drops to a surface as a drop that failed (`FindBoundaryStartPoints` already fails when that intersection fails). The UV trim curves of the gap closing above (`SmEdgeuse::CreateUVTrimCurve` under `IIREdgeBrep`, which `CloseIntersectionLoop` calls once per vertex) still took 4 to 5 s of CPU past the deadline in smlibwasm with the checks of `CloseIntersectionLoop` alone. |
| `SMLib/src/SmFeatureExecutive.cpp` | `SmFeatureExecutive::ExtSurfaceRebuild` tests the deadline before it extends the surface of each face along the void | As above: `ExtSurfaceRebuild` ignores the status of its Booleans, so once the deadline had passed (they fail at once then) it still extended every remaining surface, seconds each (420 of 496 samples of a looping step after its deadline in `SmBSplineSurface::CreateExtendedSurface`). Past the deadline the rebuild fails as a failed rebuild does: `SmFeature::BuildPatch` frees the patch and goes on with the next loop; the patch under construction is freed by its owner object. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::IntersectTopology` fails on `SM_ERR_BAD_INTERSECTIONS` from `SplitIntersectingProtoEdges` (its other errors stay ignored) | Without it the crossing holes above gave valid bodies of the wrong volume that could not be tessellated (`h1 + h2` 1697.46 instead of 2199.24, OpenCASCADE). |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::DeleteFaces` fails with `SM_ERR_BAD_INTERSECTIONS` rather than delete a shell Vertex whose Shell still owns Faceuses | `SmBrep::DeleteVertex` deletes the Vertex's Shell with it, and the Faces left in that Shell were read when the Brep was post-processed and when it was deleted (AddressSanitizer: freed memory read in `SmEdge::GetBrep` from `SmMerge::BooleanPostProcess`, and in `~SmFaceuse`). `Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)`, a flat end cap tangent to the sphere, killed the process in 3 of 3 runs. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::DeleteFaces` deletes the shell Vertices whose Vertexuse names a vertex Shell that lists another Vertex before the others | Two Vertices of the deleted faces can end up in one vertex Shell, which lists one of them: `SmBrep::DeleteVertex` deletes the Shell with that one, and the other Vertexuse then named the freed Shell, which the next `DeleteVertex` read (AddressSanitizer: a read of freed memory in `SmVertexuse::GetShell`). `(Box(20, 16, 4) - Sphere(6).rotate(X, 90).translate(1.4007, 0, -1.5863)) & Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)`, a torus touching the plate at a point, killed the process in every run and trapped the WebAssembly build; it is empty now, and the union, the cuts and the other order are right. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::ResolveIntersections` fails on `SM_ERR_BAD_INTERSECTIONS` from `ResolveOverlappingProtoEdges` (its other errors stay ignored) | The group that function cannot take out stays as it is; the Boolean must not go on with it. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::IntersectInsertRelate` deletes its ProtoTopologyManager, and the curves of its EdgeDefinitions (`Destruct()`, which only an imprint hands to the Breps), when `IntersectTopology` or `ResolveIntersections` fails | It returned without freeing the manager, which only the success path deleted: every Boolean that failed there lost the manager, its ProtoEdges, EdgeDefinitions and intersection curves, about 450 kB per failed Boolean of the crossing holes above (macOS `leaks`; 0 after). smlibpy's `ext.boolean` falls back to the kernel's own Boolean where a turned seam fails at every angle. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::FixGaps` takes the Edge that one Brep lost when it combined two Vertices out of the relations also when the other Brep lost none | It did so only when both Breps lost an Edge; the mate of the deleted Edge stayed in the maps, and the marking of the common Edges in `SmMerge::ManifoldBoolean` read the deleted Edge (AddressSanitizer: a read of freed memory in `SmTopology::Mark`): the extended shell of the L-shaped body of `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail`, depending on memory layout (5 of 48 perturbed runs). |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::ImprintIntersections` returns `SM_ERR_BAD_INTERSECTIONS` when an imprint failed and left an Edge without a Vertex at one end, and `IntersectInsertRelate` then fails the Boolean (after freeing its manager) | `SmBrep::MakeEdgeInFaceWithVU` can fail after it has connected only the start of a new closed Edge. The Boolean goes on after a failed imprint, and read the missing end Vertex: in `SmEdgeuse::CreateUVTrimCurve` (address 0x98) and, with that guarded, in `SmTopologyTraverser::CollectFaces`. The extended shell of an imported part (crescendo part 52) crashed the process in 24 of 40 runs. Failed imprints that leave no such Edge go on as before. |
| `SMLib/src/SmMerge.cpp` | `SmMerge::BooleanPostProcess` takes only the Vertices still in the Brep (a set made after the Edges are merged, renewed after every Vertex it deletes) | A Vertex deleted earlier was read in `SmVertex::GetEdges` from `IsTopologicalVertex`: `Box(40, 30, 10).rotate(X, 45).shell(10, opening)` killed the process in 11 of 48 runs (the shell's Booleans; 0 of 96 since). |
| `SMLib/src/SmMerge.cpp` | `SmMerge::ManifoldBoolean` marks the common Vertices again (step 3.2c) when `CloseIntersectionLoop` has deleted one of them, also when it then failed (the Vertices of both Breps taken before and after the call, compared by pointer) | `CloseIntersectionLoop` squeezes coincident Vertices together (`CheckForSqueezeVertices`) before it can fail, and reports deleted topology only when it succeeds; the marking went on with the next Vertex of its list, one it had deleted (AddressSanitizer: a read of freed memory in `SmTopology::Mark`). Fusing the two halves of a tube along some loops closed with a kink, the way `sweep` went before 0.5.0 (and goes again where the profile cannot be carried along), killed the process: 2 of 60 random loops with `Circle(2)`, and one with `Rectangle(4, 1)`. |
| `SMLib/src/SmMerge.cpp` | `SmMerge::BooleanTrees` deletes the two operands of a Boolean that failed and the results still on its stack | They had been taken out of the caller's list and belonged to no one: every Brep of a failed tree but those not reached yet was lost (the segments of a mitered planar sweep whose Boolean fails). The caller keeps what is left in its list. |
| `SMLib/src/SmMerge.cpp` | `SmMerge::MergeEdge` deletes the copy of a curve it made, and takes it out of the relations, when no Edge gets it (`MakeWireEdge` failed before it gave the Edge its curve) | The copy was lost with every such failure: a line in the Boolean of a failed extended shell (LeakSanitizer). |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::CreateFilletCorners` fails with `SM_ERR_INVALID_INPUT` when `SmFilletCorner::Create` makes no corner for a vertex, after deleting the list of edgeuses it kept in the corner's place, and names the first such vertex in the executive's error record; `CollectTangentEdgeSequence` walks only to solvers of the executive, each once, and stops where a solver does not end at the corner it came from | `Create` returns no corner for some ways edges meet at a vertex ("Corner Case Not Implemented"), and the executive went on with the vertex's list of edgeuses in `m_vVertexCornerMap` where the corner belonged. `CollectTangentEdgeSequence` and `SmFilletSolver::SetExtensionFlags` then called corner methods on that list (AddressSanitizer: a call to address 0). Filleting the two halves of a box edge that a cone touches tangentially, `(Box(10, 5, 20) - Cone(4, 5, 20))`, killed the process at any radius, and so did all-edge fillets of 7 of 337 imported parts and of upstream's `revolution_mold.smb`; the WebAssembly build trapped. |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::DoFilleting` shrinks only the fillet surfaces whose faces are still in the fillet Brep | The stitching of the fillet faces (`SmBrep::StitchFaces` in `CreateFilletBrep`) deletes degenerate lamina faces with their surfaces, and the FilletGeom of such a face still pointed to its surface: AddressSanitizer found it read freed memory in all-edge fillets of 2 imported parts, which killed the process. |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::CreateSmoothEdgeSequence` makes each Edge of a smooth sequence the owner of the joined curve (or the copy of it) it gives it | `SetCurve` does not set the owner, and `~SmEdge` deletes only a curve it owns: the joined curves and the caches the corners built on them (`SmFilletCorner::CalcCornerVertGeom`, `SmFilletVertex::CalcRailIntEdgeuse`) were lost with every fillet along tangent edges: 189 kB for the top run of a rounded plate (`Rectangle(40, 30, fillet=5).extrude(10)`, the selection `propagate=True` makes from one edge; 154 kB in the WebAssembly build), also in 0.4. |
| `SMLib/src/SmFilletGeom.cpp` | `SmFilletGeom::MakeFaceBrep` leaves a missing (null) boundary curve to its copy loop, which fails the fillet face (`SM_ERR_NULL_POINTER`), instead of asking it whether it is degenerate | A read of address 0: chamfering all edges of `Box(30, 20, 15) + Cylinder(5.0231, 20).rotate(X, 90).translate(8.998, 6.843, 3.2765)` by 0.25 killed the process (AddressSanitizer: SEGV in `MakeFaceBrep`); the WebAssembly build read its memory at 0 and built a broken body. |
| `SMLib/src/SmFilletSolver.cpp` | `SmFilletSolver::CreateCliffRollOverSideFG` fails (`SM_ERR_NULL_POINTER`) without a side face | `ProcessRollOver` sets a rail's side edge on its last segment without looking for the face beyond it, and passed the missing face on: the all-edge fillet (r 0.5) of `Box(30, 20, 15) + Cone(3.7793, 0.8306, 12).translate(9.4467, -7.915, 6.1887)` killed the process (AddressSanitizer: SEGV reading address 0x98 in `SmFace::GetSurface`). |
| `SMLib/src/SmCurveClass.cpp` | `sm_SetDoFilletingGeometry` hands an edge's old curve to the curve classification that is classifying it, which frees it when done, instead of the edge deleting it when it takes the curve of the edge it coincides with | Where the curve classified is the edge's own (the corners of set-back fillets: `SmFilletCorner::InsertIntersectionTopology` merges a fillet edge's own curve into the faces it lies on), the classification went on with the freed curve (AddressSanitizer: a read of freed memory in `SmCurveClassification::MergeInterval`), and every set-back corner killed the process, the kernel's own test case too (`smFilletTest.cpp`, case 303). `fillet(setback=)` (see below). |
| `SMLib/src/SmBSplineSurfaceNLib.cpp` | `SmBSplineSurface::CreateCornerBlend` keeps the copies of the boundaries' UV curves in its cleanup list before an N-sided patch (`sCleanUV.Clear()` taken out) | It released them as if the tangent fields made from them owned them; they do not (`SmCrvOnSurf`'s owner flag 0), and `CreateNSidedPatch` does not take them: every corner patch of five or more sides lost them (LeakSanitizer: the copies of `sm_CreateNonRationalCurve` and the curves `DropCurve` made for it, 20.7 kB in 288 objects over the set-back tests of `tests/test_closeout_F.py`, 0 after). Set-back corners have six. |
| `SMLib/src/SmBSplineSurfaceNLib.cpp` | `SmBSplineSurface::CreateCornerBlend` puts the bottom and top boundaries of a four-sided patch on the unit interval before it makes them compatible, as it already put the left and right ones | It left them to `SmBSplineCurve::MakeCurvesCompatible`, which rescales curves to the unit interval only when their intervals differ (`N_CrvsMakeCompatibleKnotTol`), so a bottom and a top of one interval kept it. `sm_CreateCoonsSrf` blends across the sides over [0, 1] all the same, after scaling the cross tangents to the curves' derivatives at the corners: those along the left and right sides (the bottom's and top's derivatives) were off by a factor of that interval's length, and the patch tilted away from its sheets along them. Arcs get their arc length as interval (`sm_CreateNonRationalCurve`), so a bottom and a top arc of one length kept the same one: `fill` of a sphere's round hole whose rim came as one edge, or as two equal halves (four equal quarter arcs, [0, 3 pi] each), met the sphere 19.5 degrees off along two of them: the holes of `Sphere(10)` at -z, x and y, and the holes of a turned sphere wherever its rim came so. 0.009 degrees after. B-spline sides keep the intervals they are given, which differ between pieces of one curve, and were rescaled before. |
| `SMLib/src/SmTangentField.cpp` | `SmTangentField::Evaluate` takes the field's derivative between two points of the field as projected onto its surface, past the zones at its ends where `EvaluatePoint` returns the stored end values (within 1e-8 of them) | Its divided difference (a step h of 1e-8) ran from the parameter given: from a point t in the zone at the start it went from the stored value to the projected field at t + h, and came out (t + h) / h times too large. `SmCurve::ApproximateCurve` steps in from an end by 1e-4 of the first span for a tangent that is not zero (at the end itself both points lay in the zone: zero), and so came into the zone wherever that span was shorter than 1e-4. The cross tangents of `SmBSplineSurface::CreateCornerBlend`'s Coons patches then had end derivatives (the patch's twists) 1.85 and 2.7 times too large where a side's first knot span was 8.5e-5 long, and the patch, which averages the twists of the two sides at a corner, tilted off its sheets near those corners. `fill` of a round hole in a B-spline sheet whose rim touched the sheet's knot lines where the patch's corners are (the rim's knots lie there, 6.7e-4 from the corners) was refused 1.65 to 20.6 degrees off; within 0.009 degrees after. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::DoExtendedOffset` fails when two of the faces whose surfaces it extends use one surface, or a face uses a surface that belongs to another face | `ReplaceSurface()` gives the surface's owner face the new surface, not the face it is called for, and the extension deleted for the one face was handed out again, from the executive's table of extensions, for the other (AddressSanitizer: a read of freed memory in `GetCreateExtendedSurface`). `(Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16).translate(-2, 2.5147, -4)).shell(2.4, <the face at x = 3>)` crashed in every run, and the WebAssembly build trapped. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::ShellBrep` deletes the offset body when `ReplaceImplicitOffsets` fails | It was kept (a leak), unlike after a failed stitch. Code reading; not seen in the runs measured. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::ShellBrep` deletes the offset body when the Boolean of it with the input fails, and when the merge of the two fails | A failed Boolean keeps both operands, and the caller keeps only the input: the offset body, with the caches built on it, was lost with every failed shell, from 10 kB to 1 MB (extended shells of filleted boxes: 0.88 MB for three, two of which fail). |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::RemoveExcessFaces` forgets the faces it removes, and their edgeuses, in the executive's relations (`m_vEUToEU`, `m_vFUToF`, `m_vEToF`, `m_vVToF`, `m_vBlendToFaces`) | `RemoveFaces` deletes them, and the rest of `DoExtendedOffset` still found them there: the side walls of lamina edges (`BuildSideWallOfEdgeuse` → `SmBrep::CreateEdgeEdgeBlend`) and then `PiecewiseMerge` read the freed edgeuses and faces. An offset whose faces collapse, such as `extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12)`, read freed memory natively and trapped in the WebAssembly build (smlibwasm). `ai/todo/features.md` (42). |
| `SMLib/src/SmSurface.cpp` | `SmSurface::CreateNaturalUVTrimCurves` empties its output arrays when it fails | It adds each boundary curve to the arrays as it makes it, and on failure its cleanup objects deleted the curves made so far, which stayed in the arrays. `SmSurface::CoincidenceCheck` (and `SmPlane`'s) ignores the status, went on with the freed curves and deleted them again (AddressSanitizer: a read of freed memory in `CoincidenceCheck`, from the extended offset mode's `PiecewiseMerge`): the shell of an imported part (crescendo part 65) crashed the process in about half of the runs. |
| `SMLib/src/SmFace.cpp` | `SmFace::HasSeamProblem` hands the seam curve it makes over to the caller's classification instead of copying it (in the classification it builds, and from the face properties it runs when called without them) | `SmCurveClassification::operator=` deep-copies a curve its source owns; the function assigned and then disowned the source, so the original curve belonged to nobody: 3.4 KB per call on a cylinder, 4.8 KB on a sphere, 12.7 KB on a torus, 8.3 KB per `heal_brep` of a cylinder with a sphere. smlibpy checks the seams of every body it imports from STEP. The copy also kept a pointer into the lost original (its UV curve, which `SplitAtSeam` reads), so the original could not just be freed. |
| `SMLib/src/SmFace.cpp` | `SmFace::GetPointsInFace` dithers its sample points with a generator of its own, seeded the same each call | It seeded the process-wide `rand()` from the clock, so its points, and the inner-shell classification that rays from them, changed from run to run (and every other user of `rand()` was reseeded). |
| `SMLib/src/SmShell.cpp` | `SmShell::IsInnerShellOf` takes the ray directions from wire and vertex shells from a generator of its own, seeded the same each call | As above (`srand(time(NULL))`). |
| `SMLib/src/SmCurve.cpp` | `SmCurve::CalculateTightBoundingBox` adds the knots of a B-spline only where they lie in the interval asked for | It added the last knot (and the tangent breaks) wherever they were: the tight box of an edge whose curve runs past the edge reached the curve's end. A box whose line edges a USD file had written over SMLib's unbounded line interval (-1234567 to 1234567) read back with `bbox()` reaching 1234560, in its edges, faces and every body made from it (the WebAssembly build reached that code only now and then and gave the right box). |
| `SMLib/src/SmCurve.cpp` | `sm_FilterSolution` (curve/curve intersection) evaluates both curves with their second derivatives | `sm_UnitizeTangent` reads the second derivative where the first is zero, and the function had evaluated only two vectors per curve: a read past the stack array (AddressSanitizer, `SmVector3d::Dot` from `sm_UnitizeTangent`), reached from `SmFace::HasSeamProblem` when `SmBrep::AssertValid` checked a body read from a damaged OpenCASCADE `.brep` file (`import_brep`, `check=True`): usd-brep's `extrusion.brep` with its extrusion direction zeroed, which `tests/test_lane_IX.py::test_brep_check_of_a_curve_with_zero_tangent` reads (the unpatched kernel aborts in it under AddressSanitizer). The value read decided only the direction of a tangent at a zero first derivative. |
| `SMLib/src/SmBSplineSurface.cpp` | `SmBSplineSurface::CopyAndAddAnalytics` keeps the analytic surface that one of the `IsNurbSurface...` tests found (cone or cylinder, sphere, surface of revolution or of extrusion, plane) only where every point of the B-spline at its knots and at three points inside each knot span (64 even steps across more than 64 spans) lies on it within `SM_EFF_ZERO_SQRT` of the size (`SmSurface::DropPoint`); else an exact copy | The tests compare the surfaces at a few fixed parameters: the cone's at seven points of the iso curves at the ends of the straight direction (`SmCurve::IsArc`). A rational cylinder sheet with the middle control point of its first quarter pushed out by 0.5 (area 316.27) was taken for the cylinder (314.16) by every copy that adds analytic surfaces: `SmBrep::Mirror`, the `.smb` reader, `SmBrep::CopyFaces` (`Face.to_shell`), the offset code (`Shell.thicken`), and the recognition after a scale that differs between the axes (`recognize_analytics`, which samples every span itself now too). The plane test above checks control points; this one covers the other kinds. |
| `SMLib/src/SmPlane.cpp` | `SmPlane::IsNurbSurfacePlane` also requires every control point to be the candidate plane's point at its Greville abscissae, and takes rational surfaces only with equal weights | With `HIGHER_ORDER_USE_ANALYTICS` (`SmPlane.h`) the test compared the surface with the plane at 13 fixed parameters only. A B-spline face parameterized like a plane with a bump between them was taken for a plane, and every copy that adds analytic surfaces flattened it: `SmBrep::CopyFaces` (`Face.to_shell`), the `.smb` reader, the offset code (`Shell.thicken`) and tessellation. Of 40 random single-pole bumps, `to_shell()` flattened 10. |
| `SMLib/src/SmPrimitiveCreation.cpp` | `SmPrimitiveCreation::Boolean2D` fails with `SM_ERR_BAD_INTERSECTIONS` when an edgeuse of a coincident edge of either operand lies on no face | After intersecting the two regions it classifies the faces along each coincident edge and read the mark of each edgeuse's face; an edge the intersection had left as a wire edge of a shell has edgeuses without a face, and the call read through a null pointer (address 0x38) and killed the process. A 2D union of two exclusive-or sketches whose faces touch at points crashed in 7 of 13 runs, depending on memory layout (`tests/test_lane_C.py::test_union_of_touching_xor_sketches_does_not_crash`); in the WebAssembly build such a read does not trap, it reads whatever lies at that address. smlibpy's checked route (C1) then takes its next way, and the union is right in every run. |
| `SMLib/src/SmPrimitiveCreation.cpp` | `SmPrimitiveCreation::CreateSweepAlongPlanarPath` deletes the curves it makes for its work on every path (the extended path segments, the copies of the profile, the cutting lines and the curves of the Breps' intersections); `ExtendPathCurves` keeps each extension and deletes the curve it replaces; `SweepProfilesAlongPath` deletes its copy of the path; the Breps left after a failed Boolean of the segments are deleted; a cutting line the kernel cannot extend fails the sweep | None of these curves went into a Brep (`CreateCurveSweep` and `ProjectAndTrim` work on copies of their own), and `ExtendPathCurves` wrote each extension over its pointer to the curve it extended: all were lost, 12.7 kB a sweep of a circle along a path of two lines (10.5 kB in the WebAssembly build). Where no extension came back the code went on with a null curve. |
| `SMLib/src/SmPrimitiveCreation.cpp` | `SmPrimitiveCreation::CreateCone` deletes the iso curve of an end that gets no cap (an apex) | It made both end curves and used only those of the caps: 72 bytes and the curve's knots lost with every cone that comes to a point (`SmApiCreateCone`; LeakSanitizer, the sanitizer job's tests). |
| `SMLib/src/SmPrimitiveCreation.cpp` | New `smlibpy_SetSweepProfileReference` (declared in smlibpy's `src/cpp/ext.cpp`, set for one call by `ext.curve_sweep` and `ext.planar_path_sweep`): `CreateCurveSweep` with `bMoveProfileCenterToPath`, and `CreateSweepAlongPlanarPath` (`PositionProfileCurves`, `SweepProfilesAlongPath`), put the point given for the profile on the start of the path in place of the middle of the box of the profile curves' control points | That box is larger than the curves where an arc does not span whole quadrants or a spline's control polygon reaches past it, so the kernel swept such a profile beside its own middle: a sector of 80 degrees of radius 10 sat 0.0211 off the center of its box along a spline and a mitered path, and up to 0.075 along a 3D polyline; and the mitered planar-path sweep moved an asymmetric profile turned off the world axes by up to a third of its size (smlibpy offset the path to make up for that, which splines cannot be). smlibpy puts a profile's own anchor (`sweep(anchor=)`) on the path. Not a memory defect. |
| `SMLib/src/NL_SrfAdv.cpp` | `N_FillNSidedHole` frees its local stack (`N_EndNurbs`) when it returns, and puts the knots it inserts into the surfaces it returns on the caller's stack of those surfaces | NLib's N-sided fill never freed the stack it did its work on: every `SmBSplineSurface::CreateNSidedPatch`, smlibpy's `fill()` of three or five and more sides, lost 0.1 to 1 MB (92 kB for an octant of a sphere bounded by three arcs, 23 kB for five splines; 77 and 23 kB in the WebAssembly build), also in 0.4. The returned surfaces were already on the caller's stack but for the knot vectors of the insertion, which went on the local one. |
| `SMLib/src/SmBrep.cpp` | `SmBrep::DeleteEdge` fails (`SM_ERR`), before it changes anything, for a manifold Edge between the two sides of one Face (the Loopuse of its primary Edgeuse is the mate of its radial's Loopuse) | Taking it out by merging the "two" Faces left the deleted Edgeuses in the surviving loop, and `SmLoopuse::CollectEdgeuses` wrote into them (AddressSanitizer: a write into freed memory from `SmMerge::BooleanPostProcess` inside the fillet executive): the all-edge fillet of `Cone(3, 0, 10).rotate(Y, 90) - Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1, 0)` at r 0.721755 (fuzz case fillet-7-185; the normal build raised `SM_ERR_NULL_POINTER`). It fails with `SM_ERR` now; r 0.3 rounds as before. |
| `SMLib/src/SmBrep.cpp` | `SmBrep::DeleteEdge` leaves no Loopuse of the Faces of the Edgeuses it deletes with one of them as its first Edgeuse (it moves it on along the loop to one that stays) | It set the first Edgeuse of the four Loopuses of the Edge only, to the next Edgeuse, which can be one of the four (at a strut or seam) or belong to another Loopuse (`SetEdgeuse` refuses that, silently): the next `DeleteEdge` of `GlueCoincidentBrepVertices` and the Boolean's `CollectFaces` read the freed Edgeuse (AddressSanitizer: `SmLoopuse::GetEdgeuses`, `SmLoopuse::GetEdges`): the extended shell of crescendo part 52, 4 of 24 perturbed runs. |
| `SMLib/src/SmBrep.cpp` | `SmBrep::DeleteEdge` turns the two Loopuses of the loop that survives the merge (`pSurvLU` and its mate) into the loop vertex when the closed Edge it deletes is the only Edge of both Faces | It chose them by the loops' orientations, which assumes one outer and one inner loop: when both are outer loops (two caps of spheres, or of surfaces of revolution, closed by one circle), it put the loop vertex on one Loopuse of each loop, deleted the radial loop, and the surviving `pLU` still named the freed Edgeuse. `SmBrep::ShrinkGeometry` read it at the end of the extended shell (valgrind: a read of freed memory in `SmLoopuse::GetEdgeuses` from `SmFace::CreateUVTrimCurves`, then SIGSEGV; the extended shells of filleted boxes of `tests/test_lane_FO.py` and `tests/test_closeout_K2.py` crashed the Linux build in 2 of 8 runs). With the allocations moved at random (macOS, the three shells eight times per process, a check of every Loopuse's ring after each `DeleteEdge` of `GlueCoincidentBrepVertices`): 6 of 200 processes left such a Loopuse before, 0 of 200 after (4 of them deleted such an Edge). The same on Linux (CI): 70 of 200 before (46 of them crashed), 0 of 400 after (131 deleted such an Edge); valgrind finds no invalid access in 8 runs of the shells (before: reports in 2 of 8). |
| `SMLib/src/SmBrep.cpp` | `SmBrep::SqueezeEdge` moves a Loopuse whose first Edgeuse is one of the squeezed Edge's on along its loop to an Edgeuse that stays (every Loopuse of the Faces of its Edgeuses) | It moved it to the clockwise neighbour, which at a strut is of the same Edge and deleted with it: `SmLoopuse::GetEdges` read the freed Edgeuse from `SmMerge::FixFoundFaceCoincidence` after `GlueCoincidentBrepVertices` had squeezed an Edge (the extended offset of an imported part). |
| `SMLib/src/SmBrep.cpp` | `SmBrep::MakeEdgeInFaceWithVU` finds the partner of a stale LoopVertexuse anywhere in its Vertex's list of Vertexuses, and fails before it deletes either pair when one of them has none | It looked at the two neighbours in the list only, and at a Vertex of many uses the partner can lie elsewhere (crescendo part 81: 30 Vertexuses, the partner 19 places away). It then failed after it had deleted the start Vertex's pair, and the Loopuses of the loop it no longer deleted named the freed Vertexuses (AddressSanitizer: a read of freed memory in `SmLoopuse::GetVertices` from the next Boolean of `PiecewiseMerge`; 1 or 2 of 12 perturbed runs). |
| `SMLib/src/SmBrep.cpp` | `SmBrep::DeleteFace` takes the Face out of the Brep and deletes it also when the shell bookkeeping after it deleted the Face's Faceuses fails, and `~SmBrep` deletes a Face without Faceuses as it is | The Face stayed in the Brep without Faceuses, and `~SmBrep` read through the null Faceuse (AddressSanitizer: SEGV at 0xa0): a Brep that `RemoveFaces` had failed on could not be deleted, and smlibpy kept such copies (of the faces of an imported body whose faces share no edges and whose vertices lie 1e-3 apart) for the life of the process, 118 kB a failed `Face.to_shell()` (82 kB in the WebAssembly build). smlibpy deletes them now (`src/cpp/ext.cpp`, `src/cpp/slivers.cpp`). |
| `SMLib/src/SmBrep.cpp` | `SmBrep::CopyFaces` deletes the curves and the surface copy it made for a face that `MakeFaceWithCurves` could not build, except those the destination Brep uses | They were lost with every face that could not be built again: 1 to 4 kB a face of the imported body above, 384 bytes in a union of exclusive-or sketches. |
| `SMLib/src/SmEdgeuse.cpp` | `SmEdgeuse::CreateUVTrimCurve` fails (`SM_ERR`) for an Edge without a Vertex at one of its ends | It read through the null pointer (address 0x98, `SmVertex::GetPoint`) on the half-made Edge of a failed `MakeEdgeInFaceWithVU`, from the sectoring of the closed Edge's Vertex in that same function (see `ImprintIntersections` above). |
| `SMLib/src/SmOffsetGeometryCreation.cpp` | `SmOffsetGeometryCreation::ExtendTrimEdges` keeps its clean-up objects for the three extended trim curves until all three are trimmed | It stopped them before the trims, and a trim that failed lost the three curves: about 4.7 kB per failed extended shell of a filleted box (macOS `leaks`). |
| `SMLib/src/SmSurfaceCache.cpp` | `SmBezierAux2d::BuildPolarBox` takes the surface of the tree (its owner) for a node whose aux data has none, and fails where there is none either | The aux data of nodes subdivided after the tree was built have no surface, and the function called through the null pointer (SEGV at address 0): the extended offsets of crescendo parts 81 and 19 (half of the runs of part 81), and the stitcher behind `cells()` on the kernel's own merge of `Cone(3, 0, 4).rotate(X, 90)` and `Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3)` (fuzz case csg-153), whose cells now come back. The tree's owner is the surface the node's box is computed on anyway. |
| `SMLib/src/SmEllipse.cpp` | `SmPolarConversion::ConvertToPolarParameter` asks `STEPInversion` for the angle of a point inside the interval with a zone tolerance of rounding size (`100 * SM_EFF_ZERO` of the point's size) | With the default zone tolerance (the context's, 1e-5), `STEPInversion` took every point within a hundredth of it of a closed ellipse's end for its start, and the conversion then returned the end angle: a cylinder, cone, sphere, torus or surface of revolution (whose parameters go through this conversion) evaluated to its seam for parameters up to about 1e-7 short of the end of its domain (`Cylinder(10, 40)` at u = 2 pi 10 - 1e-7 gave y = -2.4e-15 for -9.0e-8). The kernel's ray and curve intersections, which converge there, missed the hits beside a seam: `Cylinder(10, 40).raycast((88.98, -1e-8, 4), (-1, 0, 0))` gave only the far side, also in 0.4.0, and so did cones, spheres and tori for rays within 1e-7 of their seams. |

What the fixes change, measured on macOS arm64 with the normal build and an AddressSanitizer
build:

- The analytic copies (`SmBSplineSurface.cpp`): the bumped cylinder sheet stays a B-spline through
  `scale((1, 1, 2))` (632.5432, it came back a cylinder of 628.3185), `.smb` and `to_shell()`
  (316.2716 for 314.1593); a sheet that is the cylinder is still recognized, and the primitives,
  fillets and mirrors keep their planes, cylinders, cones and spheres (a mirrored torus is a
  surface of revolution, as in 0.4: the kernel's torus test is compiled out). A mirror of a plate
  of 106 faces takes 47 ms. The failed Boolean (`SmTopologyIntersector.cpp`): three failed raw
  Booleans of the crossing holes lost 1.33 MB (macOS `leaks`), now nothing. AddressSanitizer
  reports nothing for `tests/test_lane_BT.py`, `tests/test_guards.py`, `tests/test_lane_S.py`,
  `tests/test_sheet_metal.py` and `tests/test_lane_DA.py` with both changes.
- The fuse of the halves of the two loops closed with a kink that killed the process raises
  `KernelError` (`fuse failed`) in 10 of 10 runs, and AddressSanitizer reports nothing for 255
  sweeps of random such loops (circles and rectangles, 90 of them with the halves fused as before
  0.5.0), nor for `tests/test_lane_S.py` and `tests/test_modeling.py`. Before: a read of freed
  memory in `SmTopology::Mark`. Over 120 random loops (180 sweeps with circles and
  rectangles), the halves fused as before 0.5.0 give the bodies they gave then wherever they gave
  one, and the 3 that crashed raise.
  `tests/test_lane_S.py::test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel` runs
  them in a process of their own.
- The ProtoEdge a range solution deletes (`SplitIntersectingProtoEdges`): AddressSanitizer reports
  nothing for the kinked sweep in a native build without the contraction (`-ffp-contract=off`, where
  it reported the read of freed memory), which gives a valid tube of 1333.82238 (smlibwasm
  1333.82240); `tests/test_lane_S.py` passes on Linux x86_64 (it was killed with signal 11), and the
  test suite, the crash loops and the fuzz seeds give what they gave before on macOS arm64.
- The overlap lists of the ProtoEdge a range solution deletes (`SplitIntersectingProtoEdges`): two
  WebAssembly modules whose data sections are byte for byte the same (so their memory layout is the
  same), one without this change: the steps of `js/test/guards.test.ts`'s `offsets that read freed
  kernel memory fail` trap in `ResolveOverlappingProtoEdges` without it (a module linked with
  function names gave the place) and fail cleanly with it, as all 24 do in another layout. Neither
  AddressSanitizer (300 fresh processes of the native build, whose paths depend on addresses; a
  WebAssembly build with AddressSanitizer) nor `SAFE_HEAP` reached the read: the kernel takes this
  path only for some addresses.
- The deadline (`SmMessages.h`, the intersectors, the drop curve and the feature executive): the
  looping steps of the enclosure example's `remove_fillets(partial=True)` (they ran for good) return
  0.0 to 0.4 s after deadlines of 0.5, 2 and 4 s natively, and in smlibwasm 0.0 to 0.3 s after
  deadlines of 0.5 and 2 s and at most 2.4 s after 4 s; with `GUARD_SECONDS = 2` the whole
  `remove_fillets` raises after 2.10 s (smlibwasm 2.05 s), and the kernel works on. AddressSanitizer
  reports nothing for the checks giving up at once (a deadline already passed) and at random points
  (deadlines of 0.5 to 50 ms) in 14 kinds of steps (Booleans of boxes, cylinders, spheres, cones and
  tori, tangent and crossing holes, fillets, shells, offsets, fillet and face removal, sweeps), each
  followed by the same step without a deadline, which gives what it gave before; nor for the three
  steps replayed at deadlines of 0.05, 0.3, 1 and 3 s, nor for the default tests of
  `tools/sanitize/run.py` with `tests/test_closeout_W.py` (747 passed). Without a deadline a check
  reads no clock and returns at once; both test suites pass as before.
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
  in 24 processes of their own (5 of 40 such processes crashed with the old kernel, so it fails
  there with a probability above 95 %; with six processes it failed in 6 of 9 runs).
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
- The leaks of close-out K2, per call with the normal build (malloc zone statistics; smlibwasm:
  `memoryUsage().used`), before and after: `fill()` of three arcs 91.9 kB and of five splines 23.3
  kB, now 0 (smlibwasm 77.3 and 23.0 kB, now 0); the fillet of a rounded plate's top run 189 kB, now 0
  (153.5 kB, now 0); a refused `propagate=False` fillet of one of its edges 24.5 kB, now 45 bytes
  (19.6 kB, now 0); the failed all-edge fillet of the two cones at r 0.6 348 kB, now 16.4 kB (281 kB, now 14.0 kB; the rest is the curve copy of `MergeInterval`, below); a
  circle swept along a mitered path of two lines 12.7 kB, now 0 (10.5 kB, now 0); three raw extended
  shells of filleted boxes, most of which fail, 879 kB, now 128 bytes (437 kB, now 163 bytes); a failed
  `Face.to_shell()` of the imported body above 118 kB, now 0 (82 kB, now 0); a cone that comes to a
  point 72 bytes, now 0.
  `tests/test_closeout_K2.py` and `js/test/closeout_K2.test.ts` check each of them, and
  `tools/sanitize/leaks.txt` no longer lists them, so the sanitizer run counts them again: over its default tests (745 passed) it reports no memory
  error and no leak of the kernel.
- The memory errors of close-out K2: AddressSanitizer reports nothing for the fillets of the two
  cones at r 0.721755, 0.75, 0.7, 0.6, 0.5 and 0.3 (their three edges and all edges); before, a write
  into freed memory at 0.721755. Extended offsets of imported parts (raw shell and two offsets,
  twice per process, random allocations between them): crescendo part 81 0 of 36 processes (before:
  the null polar box in about half, the freed Vertexuses of `MakeEdgeInFaceWithVU` in 1 or 2 of 12),
  part 19 0 of 24, part 52 1 of 16 (with the half-made Edge and `SqueezeEdge` patched but not yet
  `DeleteEdge`, 4 of 24: Loopuses naming the Edgeuses it freed); the offset steps of
  `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail`, 48 processes of 8 rounds,
  report nothing (before: 15 of 48, 5 of them the Edge `FixGaps` kept). Natively (20 to 50 processes
  each): part 81 crashed in 11 of 20 before and in 3 of 30 after, part 19 in none before or after,
  part 52 in 15 of 20 before and in 1 of 20 after. The extended shells of filleted boxes succeed and fail about as before (21 and 13
  of 108 calls succeed after and before; the mode is unsteady, depending on memory layout).
  `tests/test_closeout_K2.py::test_extended_offsets_that_read_a_squeezed_edge_do_not_crash` runs the
  offset steps in six processes of their own. A workload of Booleans, fillets and a shell (a plate
  with 100 holes and 49 bosses) gives the same bodies in the same time (5.4 to 6.6 s against 5.7 to
  6.8 s). The stitcher: `cells()` of the kernel's merge of csg-153 gives its three cells
  (`tests/test_lane_WN.py::test_cells_of_a_merge_that_crashed_the_stitcher_come_back`).
- The polar conversion (`SmEllipse.cpp`): a cylinder evaluates at u = 2 pi 10 - 1e-7 to y = -9.0e-8
  (before: the seam, -2.4e-15). Rays at y = +-1e-12 to +-1e-3 beside the seams of a cylinder, a cone,
  a sphere and a torus hit all their faces (82 rays each; before, the cylinder missed the near side
  for every ray within about 1e-7 of its seam), through the kernel's own curve-face intersection and
  through `raycast`. The kernel's Boolean of a tool beside an earlier hole in a sphere (`Sphere(20) -
  Cylinder(6, 60)`, then `- Cylinder(3, 60).translate(8, 0, 0)`), which gave an empty body (and its
  intersection the whole part), fails now; smlibpy's retry with a NURBS copy of the tool gives the
  same right results as before (28160.608 and 929.188). No other result of either suite changed.
- The four-sided corner blend (`SmBSplineSurfaceNLib.cpp`): `fill` of the round holes of
  `Sphere(10)`, cut 8 from its center towards each axis, on the sphere as it is and turned by
  quarter turns about x, y and z (smlibpy-three's `Ball` among them): every hole fills, its cap
  within 0.0094 degrees of the sphere, 4141.58 each (smlibpy's `fill` now cuts a rim that comes in
  pieces into four equal sides as well). Before, 5 of the 6 holes of the sphere as it is were
  refused at 19.5 degrees: those whose rim came as one edge or two equal halves, four equal arcs
  once cut. Holes cut 2.5 to
  8 below its center: 0.0002 to 0.0022 degrees (before 19.5 to 63.9 degrees, refused). Holes
  whose opposite sides came on different intervals, which the kernel rescaled before, fill as
  before: the round holes of a paraboloid sheet 0.0008 to 0.0021 degrees.
  `tests/test_lane_U.py::test_fill_closes_the_holes_of_a_turned_sphere_alike` and
  `js/test/lane_U.test.ts` check them; no other test of either suite needed a change.
- The tangent field's derivative (`SmTangentField.cpp`): round holes cut in the paraboloid sheet of
  `tests/test_lane_U.py` (knots every 5 along x and y) whose rims touch its knot lines where the
  patch's corners are, of radius 5 at x 0, 5 and 7 and of radius 2.5 at x 2.5, fill within 0.0025
  degrees (0.0086 for the radius 2.5); before, they were refused at 7.02, 1.65, 20.6 and 5.36
  degrees. The twists of the radius-5 hole's corners now agree to 2e-6; before, two corners were
  2.1 and 4.2 apart. The holes that filled before (radii 3, 4, 6, 8 and 10) give the same angles,
  and a sphere's holes the same caps within 2.5e-4 (the more accurate twists).
  `tests/test_lane_U.py::test_fill_a_round_hole_whose_rim_touches_the_sheet_s_knot_lines` and
  `js/test/lane_U.test.ts` check them; no other test of either suite needed a change.
- Both test suites pass.

Defects that remain in the kernel, and what smlibpy does about them:

- Crashes and loops in the feature executive's patching (`ai/todo/features.md`, 37):
  `smlibpy.defeature` runs each step of `remove_fillets`, `remove_faces` and `surface_fillet` in
  another process (a forked copy, or a helper process; smlibwasm: a probe worker with a kernel of
  its own), whose result comes back as an exact copy.
- The extended offset mode still crashes now and then on some imported parts (raw kernel calls,
  shell and two offsets twice per process), in sites AddressSanitizer locates rarely or not at all:
  crescendo part 81 in 3 of 30 processes natively, in `SmBrep::GlueVertices` from
  `GlueCoincidentBrepVertices` on a Vertex already freed (`SmVertex::GetShells` read reused memory;
  AddressSanitizer reported nothing in 36 processes, and the crash did not come under lldb), and part
  52 in 1 of 20 natively and 1 of 16 under AddressSanitizer: a Loopuse still names an Edgeuse that
  `DeleteEdge` freed in `GlueCoincidentBrepVertices`, read by `SmMerge::FixFoundFaceCoincidence`
  (`SmLoopuse::GetEdges`). The patched `DeleteEdge` moves every Loopuse of the Brep off the Edgeuses it
  deletes, so the stale name comes another way (an Edgeuse ring that still links a freed Edgeuse, or a
  Loopuse outside the Brep's Faces): not located. `shell`, `offset` and `thicken` run their kernel
  steps only in a forked copy (smlibwasm: the probe worker), so these raise `ModelingError`.
- Booleans in which the seam of a cylinder, cone, sphere or torus runs tangent to a face of the
  other operand return valid bodies of the wrong volume (`ai/plan/kernel-deep-dive.md`, B6); the
  site is not located, and the gaps of such bodies are about 1e-8, so no check of the gaps
  catches them.
  smlibpy finds such seams (also against B-spline faces, by the kernel's projection) and turns the
  operand that owns the seam about its axis first where it is a body of revolution, or moves the
  seam on its face where it is not (the face's cylinder, cone or sphere added and taken away again
  turned, kept where the body's volume stays), on copies whose B-spline faces are recognized as
  analytic where a B-spline face's seam touches (`src/cpp/seams.cpp`, in `ext.boolean`). A torus'
  outer equator (no turn moves it, and `SmTorus` has no other place for it) and seams of free-form
  faces keep the defect; where such a seam touches at a point (`seam_touches`), smlibpy checks the
  result's faces against the operands, does a wrong result again with NURBS copies of the operands
  or refuses it, and splits by a plane only into sides that hold the part's volume.
- Found with AddressSanitizer and the fuzz run of the kernel plan, not located or not fixed: the
  extended offset mode reads past a curve classification's points (`SmCurveClassification::FindInterval`
  from `sm_FixProblemsBySqueezing`, depending on memory layout, seen once; `tests/test_guards.py` and
  `js/test/guards.test.ts`, `offsets that read freed kernel memory fail`, run their steps once more
  in another memory layout when they crash); the Boolean of the meshes of two internally tangent
  cylinders at a fine tolerance (`tessellate(...) & tessellate(...)`) kills the process;
  `SmApiBooleanWithCurves` returns common edges that `BooleanPostProcess` deleted (not patched:
  smlibpy does not call it, and binds `_core.boolean_with_curves` again as its own Boolean with the
  edges found by classification, `src/cpp/nogil.cpp`). `SmBSplineSurface::CreateHelicalSweep` keeps
  a pointer to an `NL_SURFACE` on its own stack; nothing calls it, and `tests/test_lane_U.py` fails
  if something starts to.
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
  faces it lies on, and `sm_SetDoFilletingGeometry` gave that edge a new curve and deleted the old
  one while `SmCurveClassification::MergeInterval` was still classifying it (AddressSanitizer: a
  read of freed memory). Every set-back corner tried killed the process, the kernel's own test
  case too (`smFilletTest.cpp`, case 303: all edges of a box, r 1, setback 1.25). The copy of
  `SmCurveClass.cpp` above stops that read (all edges of a 20 mm cube, r 1 with setback 1.25 and
  r 2 with setback 3, and of a 10 mm cube, r 1 with setback 1.5, with the kernel test's solver
  settings and SM_API's, built from `SmApiCreateBox` in a program of its own: AddressSanitizer
  found a read of freed memory in each before, nothing after). The merge then failed:
  `SmTopologyIntersector::Relate` found a vertex or edge already mated to another (`SM_ERR` from
  `MergeCurveOnSurfaces`, the fillet half merged: 7 faces, 25 open edges); merging a copy of the
  curve instead (tried before) gave open bodies (84 open edges, 4 of the 6 planes gone). The
  kernel's test box (`TestFiles/pt_TestFiles/Solids/box.smb`) merges with the same settings (168
  edges, 66 faces, closed), and the difference is the order of each edge's edgeuses: in the test
  box each edge lists the edgeuse that runs along it (`SM_OT_SAME`) first, while `SmApiCreateBox`
  lists the opposite one first at 5 of its 12 edges. Ruled out on the way: plane or B-spline
  surfaces, line or B-spline UV curves, the lines' parameter range, rounding, tolerances, the
  naturally-trimmed flag, the direction of the edges (reversed to the test box's: still open;
  reversing one edge of the test box: open), where the box lies, and the order the edges are
  loaded in. `SmEdge::ResetPrimaryEdgeuse` to the `SM_OT_SAME` edgeuse alone made every
  `SmApiCreateBox` case above closed and valid; `ext.round_edges(setback=)` does so for every edge
  first (nothing but the order of the lists changes), and `fillet(setback=)` offers set-back corners
  where all edges at the vertex are convex or all concave. Where a face turns inward at the vertex
  (the rim of a pocket, `SmFilletConcaveNxNCorner`, which hands setbacks to the convex corner's code)
  the bodies came out broken (an invalid body of 59 times the volume): those corners keep their
  patch. Radius laws with set-back corners crashed (`SIGSEGV`): refused. Corners between slanted
  faces (a frustum's) come out with gaps of up to 5.9: refused by the result check (`KernelError`).
  The same reordering changed nothing for the near-limit cubes of F7 (r 4.98 to 4.995: the same
  bodies). 240 random parts (boxes with pockets and bosses, prisms of 3 to 8 sides, a box with a
  cylinder) rounded with random radii and setbacks: no crash; the results are valid or refused.
- Silent inaccuracies the fuzz baseline (`tools/fuzz/baseline.json`) records, also in 0.4: a cone
  whose base touches a cylinder's cap, `Cone(3, 0, 16).translate(4.4987, -2, 10) - Cylinder(6, 4)`
  (fuzz case csg-8-98 E), is valid and 2.9e-6 off (150.79601567, exact 150.79644737); the
  difference of `Cone(6, 0, 8)` and `Box(8, 10, 16).translate(-2, 1, 0)` (csg-8-157 D) is off in
  some runs and right in others, depending on memory layout (the fuzz run calls it unsteady).
- Small leaks on failure paths, not patched: `SmFilletCorner::Create` keeps its list of edgeuses
  when it makes no corner; the fillet executive's circular cross-section solver now and then loses a
  skinned surface (144 bytes), and a loft of a composite profile the curve it joined (1 kB); a fillet
  that fails in `SmFilletGeom::InsertIntersectionTopology` a curve copy of `MergeInterval` with its
  cache (about 11 kB, the two cones at r 0.6); some Booleans the copy of the curve
  `SmProtoTopologyManager::CreateProtoEdge` makes for an EdgeDefinition they drop without imprinting
  it (152 bytes each, about 24 in the extended shells of `tests/test_lane_FO.py`; freeing the curves no
  Brep took after the imprint, by their owners, read curves of Edges that `GlueCoincidentBrepVertices`
  had deleted since: crescendo part 52 natively). `SmBrepData::FromBrep` (the `.smb` writer and usd-brep's USD export) loses the
  attribute index arrays of the edges (`sm_ExtractAttributes`): 8 bytes an edge that carries
  attributes. `tools/sanitize/leaks.txt` lists those the sanitizer run meets (LeakSanitizer, macOS
  arm64, LLVM 21). The leaks of the N-sided fill, the fillet corners, refused and failed fillets, the
  mitered sweep, failed extended shells, face copies the kernel cannot build and cones that come to a
  point are patched (the rows above).

## Checking with AddressSanitizer

`tools/sanitize/run.py` does it (and CI's "Checks" workflow runs it every night on Linux):
configure a separate build directory with
`-DCMAKE_BUILD_TYPE=RelWithDebInfo -DSKBUILD=ON -DCMAKE_CXX_FLAGS="-fsanitize=address -fsanitize-recover=address -fno-omit-frame-pointer"`
(`-DSKBUILD=ON` keeps its `_core` module in the build directory rather than writing it over the
one in `src/smlibpy`; `-fsanitize-recover=address` lets a run go on after a report), build it, and
run `python tools/sanitize/run.py --build <dir> [tests]` (by default the tests of the guarded and
patched kernel code and of the C++ added for 0.5.0: `DEFAULT_TESTS` in `run.py`). It puts the module next to a copy of
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

The first runs of this check (LLVM 21 on macOS arm64) found a heap-buffer-overflow in
`SmCurveClassification::FindInterval` from `sm_FixProblemsBySqueezing` in the extended offset mode's
merge (the steps of `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail`), and
leaks in `SmPrimitiveCreation::CreateSweepAlongPlanarPath` (the copies of the profile and path of each
segment, about 10 kB a mitered sweep) and `SmProtoTopologyManager::CreateProtoEdge`. The leaks are
patched (close-out K2); the overflow was not seen again (48 processes of 8 rounds of those steps with
random allocations between them, six AddressSanitizer runs of `tests/test_guards.py` and the
sanitizer job over its default tests), so it is not located and stays in `known.txt`. It also found smlibpy's own leak of the curves it
handed the kernel's sweeps, skins and offset profiles, which copy them (fixed).

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
   the analytic copies (`SmBSplineSurface.cpp`), `tests/test_modeling.py::test_bumped_cylinder_sheets_stay_bumped`
   must still pass; for the intersection manager of a failed Boolean,
   `tests/test_lane_WN.py::test_failed_booleans_free_the_kernel_s_intersections` must still pass and
   AddressSanitizer report nothing for `tests/test_lane_BT.py`; for
   the error reports, `tests/test_lane_WN.py::test_kernel_errors_say_where_the_kernel_gave_up`
   (with upstream's header in a release build the trace is empty); for the curve intersection's
   filter, `tests/test_lane_IX.py::test_brep_check_of_a_curve_with_zero_tangent` must pass under
   AddressSanitizer (the unpatched kernel aborts in it); for the leaks of close-out K2 (`NL_SrfAdv.cpp`,
   the fillet executive and geometry, the sweep, the offset executive and geometry, `SmMerge.cpp`,
   `SmProtoTopology.cpp`, the face copies of `SmBrep.cpp`), `tests/test_closeout_K2.py` and
   `js/test/closeout_K2.test.ts` must still pass; for its memory errors (`SmBrep.cpp`'s `DeleteEdge`,
   `SqueezeEdge` and `MakeEdgeInFaceWithVU`, `SmEdgeuse.cpp`, `SmSurfaceCache.cpp`, the half-made
   Edge and `FixGaps` of `SmTopologyIntersector.cpp`), AddressSanitizer must report nothing for the
   fillets of the two cones and for the extended offsets of crescendo parts 81, 19 and 52 with random
   allocations between them, and `tests/test_closeout_K2.py::test_all_edge_fillet_of_two_cones_fails_cleanly`
   and `tests/test_lane_WN.py::test_cells_of_a_merge_that_crashed_the_stitcher_come_back` must pass;
   for the order in which `DeleteFaces` deletes shell Vertices (close-out K1),
   `tests/test_closeout_K1.py::test_a_torus_touching_a_plate_at_a_point_no_longer_kills_the_process`
   must pass and AddressSanitizer report nothing for its cases; for the ProtoEdge lists
   (`SplitIntersectingProtoEdges`, `ResolveOverlappingProtoEdges`, `~SmProtoEdge`), nothing for the
   extended offset of `Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)` by 6
   and the loops of `tests/test_lane_S.py::test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel`;
   for set-back corners (`SmCurveClass.cpp`, `SmBSplineSurfaceNLib.cpp`),
   `tests/test_closeout_F.py::test_set_back_corners` must pass with no AddressSanitizer report and no
   leak; for the sweep's profile reference (`SmPrimitiveCreation.cpp`),
   `tests/test_closeout_S.py::test_arcs_that_do_not_span_whole_quadrants_sit_by_their_own_box` must
   pass; for the polar conversion (`SmEllipse.cpp`), `tests/test_closeout_U.py::test_raycast_beside_a_seam`
   and `test_seam_evaluation_is_not_snapped`; for the deadline (`SmMessages.h`, the intersectors, the
   drop curve, the feature executive),
   `tests/test_closeout_W.py::test_the_kernels_deadline_stops_its_intersections_and_is_cleared` and
   `test_the_enclosure_round_that_loops_returns_at_the_deadline_without_another_process`, and
   AddressSanitizer must report nothing for those with the deadline giving up at once.
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

