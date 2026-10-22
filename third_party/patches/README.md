# Kernel patches

smlibpy builds the SMLib kernel from the usd-brep submodule (`third_party/usd-brep`, release
1.0.0, commit c9c5979), which stays as published. A few of its source files have defects that
smlibpy cannot work around from outside. Fixed copies of those files live here, and
`CMakeLists.txt` compiles each one in place of the original:
`third_party/patches/<dir>/src/<file>` replaces `third_party/usd-brep/source/<dir>/src/<file>`
(`<dir>` is `SMLib` or `SM_API`). The configure step stops if a copy has no original of that
name.

Each copy is the upstream file with its notices unchanged, a notice at the top saying what was
changed and why (Apache License 2.0, section 4(b)), and every change marked
`smlibpy patch` in a comment. The copies are part of the sdist (`sdist.include` in
`pyproject.toml`) and go into every build: the normal one, the wheels, and the kernel built
once for all wheels (`SMLIBPY_KERNEL_ONLY`, then `SMLIBPY_KERNEL_DIR`).

## Changes

| File | Change | Defect |
|---|---|---|
| `SMLib/src/SmVertex.cpp` | `SmVertex::GetVertexuseOfFace` tests the face again | The face test was commented out together with the composite-face branch ("Remove Composite"), so the function returned the vertexuse of whichever face came first. `SmFilletRemoval` read its corner parameters from the wrong faces and removed nothing: upstream's known issue "`remove_fillet` removes nothing and reports success". Also feeds surface fitting through vertices (`SmFace.cpp`), UV boxes of loops (`SmLoopuse.cpp`), curve classification (`SmCurveClass.cpp`) and `SmVertex::HasParallelFaces`. |
| `SMLib/src/SmVertex.cpp` | `SmVertex::GetLoopOfFace` tests the face again (its face pointer is no longer set only in debug builds) | Same as above: it returned the loop of whichever face came first. Used by point classification (`SmPointClassification`, `SmPointClass.cpp`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::~SmProtoTopologyManager` cuts the links between ProtoVertices and ProtoEdges before deleting them | It deleted the ProtoEdges first; a ProtoVertex that still listed one then wrote into it (`SmProtoEdge::RemoveProtoVertex` from `~SmProtoVertex`). A write into freed memory at the end of every Boolean, found with AddressSanitizer on `Box(40, 30, 20) - Cylinder(5, 40)`. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` deletes the EdgeDefinitions of the short edges it removes without calling `Destruct()` first (where it deletes them after each ProtoVertex, and where it deletes the one of an edge it squeezed or deleted, which before the second change still called `Destruct()`; that place never deleted a curve a Brep used in the runs measured, 73 calls) | `Destruct()` deletes all curves of an EdgeDefinition. After imprinting, the Breps own them: the removed edge took its own along, and the other Brep's edge still used the rest. Booleans that glue coincident vertices then read freed curves (`SmEdge::CalculateBoundingBox`, `~SmEdgeuse`), and the process crashed now and then: fillet removal on an imported valve body crashed it in 3 of 3 runs, also behind the guard of `smlibpy.defeature` (the forked copy came through, the process did not). The destructor deletes exactly the curves no Brep took (see `SmEdgeDefinition::Imprint`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::SplitIntersectingProtoEdges` stops once a range solution has deleted `pPE2`, and returns `SM_ERR_BAD_INTERSECTIONS` when solutions are left; it asks `pPE2`, not `pPE1`, which ProtoVertex lies at `pPE2`'s split parameter; `sm_WhichPVToCombine` takes ProtoEdges without end ProtoVertices | The next solution split the deleted ProtoEdge (AddressSanitizer: a read of freed memory in `SmProtoEdge::Split`). Booleans of crossing holes whose seams lie tangent to the other hole, such as `Cylinder(3, 40).translate(0, 3, 0) + Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` and its cut, `&` and merge, killed the process. The solutions there are nine ranges of one ProtoEdge, each on all of the other; the Boolean cannot go on soundly. |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` stops gluing a Vertex once it has deleted it (an Edge to it squeezed, or the two Vertices glued), and does not look up the mate of a deleted Vertex | With two common Edges between two coincident Vertices, the next long Edge glued the deleted Vertex again (AddressSanitizer: a read of freed memory in `SmBrep::GlueVertices`, from the offset executive's `PiecewiseMerge`). Shells and offsets in the kernel's extended mode crashed the process at random: an L-shaped body of two boxes shelled with one opening in 1 run of 4 (`Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)`, 2.94), `(Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)).offset(6)` in every run, imported parts (issue #2's family). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::ResolveOverlappingProtoEdges` takes the ProtoEdges of a group it deletes out of the lists of coincident ProtoEdges of every ProtoFace (it stopped at the first one that listed them, as its comment wonders), and puts the new ProtoEdges into each list that had them; it returns `SM_ERR_BAD_INTERSECTIONS` for a group in which a ProtoEdge has no start or end ProtoVertex | `GlueCoincidentBrepVertices` read the deleted ProtoEdges from the other lists (AddressSanitizer: a read of freed memory): the plain shell of an imported part crashed in every run (crescendo part 40). It read the missing ProtoVertex of a ProtoEdge (an offset in the extended mode, 1 run in 10, after the change above). |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::IntersectTopology` fails on `SM_ERR_BAD_INTERSECTIONS` from `SplitIntersectingProtoEdges` (its other errors stay ignored) | Without it the crossing holes above gave valid bodies of the wrong volume that could not be tessellated (`h1 + h2` 1697.46 instead of 2199.24, OpenCASCADE). |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::DeleteFaces` fails with `SM_ERR_BAD_INTERSECTIONS` rather than delete a shell Vertex whose Shell still owns Faceuses | `SmBrep::DeleteVertex` deletes the Vertex's Shell with it, and the Faces left in that Shell were read when the Brep was post-processed and when it was deleted (AddressSanitizer: freed memory read in `SmEdge::GetBrep` from `SmMerge::BooleanPostProcess`, and in `~SmFaceuse`). `Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)`, a flat end cap tangent to the sphere, killed the process in 3 of 3 runs. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::ResolveIntersections` fails on `SM_ERR_BAD_INTERSECTIONS` from `ResolveOverlappingProtoEdges` (its other errors stay ignored) | The group that function cannot take out stays as it is; the Boolean must not go on with it. |
| `SMLib/src/SmMerge.cpp` | `SmMerge::BooleanPostProcess` takes only the Vertices still in the Brep (a set made after the Edges are merged, renewed after every Vertex it deletes) | A Vertex deleted earlier was read in `SmVertex::GetEdges` from `IsTopologicalVertex`: `Box(40, 30, 10).rotate(X, 45).shell(10, opening)` killed the process in 11 of 48 runs (the shell's Booleans; 0 of 96 since). |
| `SMLib/src/SmMerge.cpp` | `SmMerge::ManifoldBoolean` marks the common Vertices again (step 3.2c) when `CloseIntersectionLoop` has deleted one of them, also when it then failed (the Vertices of both Breps taken before and after the call, compared by pointer) | `CloseIntersectionLoop` squeezes coincident Vertices together (`CheckForSqueezeVertices`) before it can fail, and reports deleted topology only when it succeeds; the marking went on with the next Vertex of its list, one it had deleted (AddressSanitizer: a read of freed memory in `SmTopology::Mark`). Fusing the two halves of a tube along some loops closed with a kink, the way `sweep` went before 0.5.0 (and goes again where the profile cannot be carried along), killed the process: 2 of 60 random loops with `Circle(2)`, and one with `Rectangle(4, 1)`. |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::CreateFilletCorners` fails with `SM_ERR_INVALID_INPUT` when `SmFilletCorner::Create` makes no corner for a vertex, after deleting the list of edgeuses it kept in the corner's place; `CollectTangentEdgeSequence` walks only to solvers of the executive, each once, and stops where a solver does not end at the corner it came from | `Create` returns no corner for some ways edges meet at a vertex ("Corner Case Not Implemented"), and the executive went on with the vertex's list of edgeuses in `m_vVertexCornerMap` where the corner belonged. `CollectTangentEdgeSequence` and `SmFilletSolver::SetExtensionFlags` then called corner methods on that list (AddressSanitizer: a call to address 0). Filleting the two halves of a box edge that a cone touches tangentially, `(Box(10, 5, 20) - Cone(4, 5, 20))`, killed the process at any radius, and so did all-edge fillets of 7 of 337 imported parts and of upstream's `revolution_mold.smb`; the WebAssembly build trapped. |
| `SMLib/src/SmFilletExecutive.cpp` | `SmFilletExecutive::DoFilleting` shrinks only the fillet surfaces whose faces are still in the fillet Brep | The stitching of the fillet faces (`SmBrep::StitchFaces` in `CreateFilletBrep`) deletes degenerate lamina faces with their surfaces, and the FilletGeom of such a face still pointed to its surface: AddressSanitizer found it read freed memory in all-edge fillets of 2 imported parts, which killed the process. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::DoExtendedOffset` fails when two of the faces whose surfaces it extends use one surface, or a face uses a surface that belongs to another face | `ReplaceSurface()` gives the surface's owner face the new surface, not the face it is called for, and the extension deleted for the one face was handed out again, from the executive's table of extensions, for the other (AddressSanitizer: a read of freed memory in `GetCreateExtendedSurface`). `(Cone(3, 4, 6).rotate(Y, 90) + Cone(6, 2, 16).translate(-2, 2.5147, -4)).shell(2.4, <the face at x = 3>)` crashed in every run, and the WebAssembly build trapped. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::ShellBrep` deletes the offset body when `ReplaceImplicitOffsets` fails | It was kept (a leak), unlike after a failed stitch. Code reading; not seen in the runs measured. |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::RemoveExcessFaces` forgets the faces it removes, and their edgeuses, in the executive's relations (`m_vEUToEU`, `m_vFUToF`, `m_vEToF`, `m_vVToF`, `m_vBlendToFaces`) | `RemoveFaces` deletes them, and the rest of `DoExtendedOffset` still found them there: the side walls of lamina edges (`BuildSideWallOfEdgeuse` → `SmBrep::CreateEdgeEdgeBlend`) and then `PiecewiseMerge` read the freed edgeuses and faces. An offset whose faces collapse, such as `extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12)`, read freed memory natively and trapped in the WebAssembly build (smlibwasm). `ai/todo/features.md` (42). |
| `SMLib/src/SmFace.cpp` | `SmFace::HasSeamProblem` hands the seam curve it makes over to the caller's classification instead of copying it (in the classification it builds, and from the face properties it runs when called without them) | `SmCurveClassification::operator=` deep-copies a curve its source owns; the function assigned and then disowned the source, so the original curve belonged to nobody: 3.4 KB per call on a cylinder, 4.8 KB on a sphere, 12.7 KB on a torus, 8.3 KB per `heal_brep` of a cylinder with a sphere. smlibpy checks the seams of every body it imports from STEP. The copy also kept a pointer into the lost original (its UV curve, which `SplitAtSeam` reads), so the original could not just be freed. |
| `SMLib/src/SmFace.cpp` | `SmFace::GetPointsInFace` dithers its sample points with a generator of its own, seeded the same each call | It seeded the process-wide `rand()` from the clock, so its points, and the inner-shell classification that rays from them, changed from run to run (and every other user of `rand()` was reseeded). |
| `SMLib/src/SmShell.cpp` | `SmShell::IsInnerShellOf` takes the ray directions from wire and vertex shells from a generator of its own, seeded the same each call | As above (`srand(time(NULL))`). |
| `SMLib/src/SmCurve.cpp` | `SmCurve::CalculateTightBoundingBox` adds the knots of a B-spline only where they lie in the interval asked for | It added the last knot (and the tangent breaks) wherever they were: the tight box of an edge whose curve runs past the edge reached the curve's end. A box whose line edges a USD file had written over SMLib's unbounded line interval (-1234567 to 1234567) read back with `bbox()` reaching 1234560, in its edges, faces and every body made from it (the WebAssembly build reached that code only now and then and gave the right box). |
| `SMLib/src/SmPlane.cpp` | `SmPlane::IsNurbSurfacePlane` also requires every control point to be the candidate plane's point at its Greville abscissae, and takes rational surfaces only with equal weights | With `HIGHER_ORDER_USE_ANALYTICS` (`SmPlane.h`) the test compared the surface with the plane at 13 fixed parameters only. A B-spline face parameterized like a plane with a bump between them was taken for a plane, and every copy that adds analytic surfaces flattened it: `SmBrep::CopyFaces` (`Face.to_shell`), the `.smb` reader, the offset code (`Shell.thicken`) and tessellation. Of 40 random single-pole bumps, `to_shell()` flattened 10. |

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
  `KernelError` (`SM_ERR_INVALID_INPUT`), with AddressSanitizer reporting nothing; so do the 10
  imported parts whose all-edge fillets crashed (8 from the missing corners, 2 from the shrink).
  The corners were missing in no other fillet of those 479 imported parts, of the fuzz seeds 7 and
  8 (190 fillets and chamfers) or of the test suite, and no other result changed.
- Shells and offsets in the extended mode (the changes to `GlueCoincidentBrepVertices`,
  `ResolveOverlappingProtoEdges` and `DoExtendedOffset`): AddressSanitizer reports nothing for the
  L-shaped body, the cone offset, the two cones and issue #2's filleted boxes, nor for the shells
  and offsets of the 6 imported parts that crashed (crescendo parts 15, 19, 34, 40, 52, 65; one,
  part 81, still reads a null pointer in `SmBezierAux2d::BuildPolarBox`). Natively, with eight
  shell or offset attempts per call in the process, before: the L-shaped body crashed in 6 of 30
  runs, a second L-shaped body in 22 of 30, the cone offset and the two cones in 10 of 10,
  imported parts 15 and 34 in 6 of 6; after: 1 of 30, 0 of 30, 0 of 10 runs of 3 calls each, and
  0 of 6. Issue #2's filleted boxes still crash now and then (1 or 2 of 10 runs of 3 calls), in
  `SmEdge::CalculateBoundingBox` as a `ManifoldBoolean` of `PiecewiseMerge` starts; neither
  AddressSanitizer nor libgmalloc takes that path, and smlibpy runs these steps in a forked copy
  of the process. `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` runs the
  kernel steps in a process of their own. Over the fuzz seeds 7 and 8 (110 and 100
  shells and offsets) they turned 2 crashes into errors and one refused offset into a body (whose
  faces lie at the offset distance); 3 failures failed with another error, and no other result
  changed.
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
  `tests/test_tessellation.py` and `tests/test_measure.py` (121 passed). LeakSanitizer does not run
  on macOS arm64; the heap statistics stand in for it. Over 449 STEP files (611 bodies) of the
  classcad-mcp corpus, no volume, face count, validity or error changed with the seam and the
  random-number changes.
- The tight box: a USD file with such line edges reads back with `bbox()` of +-5, as the box is
  (`tests/test_io.py::test_usd_line_edges_are_written_as_long_as_the_edges`, which also checks that
  smlibpy no longer writes such files).
- Both test suites pass.

Defects that remain in the kernel, and what smlibpy does about them:

- Crashes and loops in the feature executive's patching (`ai/todo/features.md`, 37):
  `smlibpy.defeature` runs each step of `remove_fillets`, `remove_faces` and `surface_fillet` in
  a forked copy first (smlibwasm: in a probe worker with a kernel of its own).
- The extended offset mode still crashes now and then on filleted boxes (issue #2's family: 1 or
  2 of 10 runs of 3 calls), in `SmEdge::CalculateBoundingBox` on a freed Edge as a
  `ManifoldBoolean` of `PiecewiseMerge` starts; neither AddressSanitizer nor libgmalloc takes that
  path, so it is not located. The offset of crescendo part 81 reads a null pointer in
  `SmBezierAux2d::BuildPolarBox`. `shell`, `offset` and `thicken` run their kernel steps only in a
  forked copy (smlibwasm: the probe worker), so these raise `ModelingError`.
- Booleans in which the seam of a cylinder, cone or sphere lies in a tangent plane of the other
  operand return valid bodies of the wrong volume (`ai/plan/kernel-deep-dive.md`, B6); the site
  is not located, and the gaps of such bodies are about 1e-8, so no check catches them.
- `SmBrep::Point3DClassify` takes the region from one ray along +X, and once a tight bounding box
  (or `ComputePreciseProperties`) has run on a body, `BrepPointSolve` can find no face along +X
  where the ray crosses one. `ext.classify_points` lets rays in other directions vote;
  `SmApiBrepRelationship`, which smlibpy does not rely on, has the same cause.
- Small leaks on failure paths, not patched: `SmFilletCorner::Create` keeps its list of edgeuses
  when it makes no corner, and a failed extended shell keeps about 4.7 KB of curve copies
  (`SmOffsetGeometryCreation::ExtendTrimEdges`, found with macOS `leaks`).

## Checking with AddressSanitizer

Configure a separate build directory with
`-DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_FLAGS="-fsanitize=address -fno-omit-frame-pointer"`
(and `-DSKBUILD=ON`, which keeps its `_core` module in the build directory rather than writing it
over the one in `src/smlibpy`), put its `_core` module next to a copy of `src/smlibpy`, and run
the Python binary itself (on macOS not through `env` or `timeout`, which drop the `DYLD_`
variables) with
`DYLD_INSERT_LIBRARIES=$(clang -print-file-name=libclang_rt.asan_osx_dynamic.dylib)` and
`ASAN_OPTIONS=detect_leaks=0:strip_env=0` (`strip_env=0` keeps the sanitizer in the worker
processes of the MCP session tests); add `quarantine_size_mb=8192` where freed memory is read
long after it was freed. LeakSanitizer does not run on macOS arm64: malloc zone statistics
(`malloc_zone_statistics`), macOS `leaks` and resident-memory bounds stand in for it. With the
guard on, a defect in a forked copy shows as "the kernel crashed (signal 6 ...)" and its report
goes to stderr; `GUARD_SECONDS = 0` runs every step in the process, so the first report ends the
run.

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
   `tests/test_guards.py::test_rounds_that_crashed_the_kernel_raise`, which must still pass; for
   the changes to the offset code (`GlueCoincidentBrepVertices`, `ResolveOverlappingProtoEdges`,
   `DoExtendedOffset`), nothing for the steps of
   `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` and the plain shell of
   crescendo part 40 (with `quarantine_size_mb=8192`; the `ShellBrep` change has no check of its
   own, as its path never ran in the runs measured); for the plane test,
   `tests/test_surfaces.py::test_bspline_faces_with_a_bump_stay_curved` must still pass; for the
   seam check, `tests/test_step_import.py::test_seam_checks_on_import_free_their_curves` must still
   pass and AddressSanitizer report nothing for `tests/test_step_import.py`; for the tight box,
   `tests/test_io.py::test_usd_line_edges_are_written_as_long_as_the_edges` must still pass; for
   the `ManifoldBoolean` change, nothing for the loops of
   `tests/test_lane_S.py::test_the_former_sweep_of_kinked_loops_does_not_crash_the_kernel`, which
   must still pass.
4. Remove the row from the table above.

When the last copy is gone, this directory and `smlibpy_patch_sources` in `CMakeLists.txt` can
go too.
