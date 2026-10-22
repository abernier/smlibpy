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
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::GlueCoincidentBrepVertices` deletes the EdgeDefinitions of the short edges it removes without calling `Destruct()` first | `Destruct()` deletes all curves of an EdgeDefinition. After imprinting, the Breps own them: the removed edge took its own along, and the other Brep's edge still used the rest. Booleans that glue coincident vertices then read freed curves (`SmEdge::CalculateBoundingBox`, `~SmEdgeuse`), and the process crashed now and then: fillet removal on an imported valve body crashed it in 3 of 3 runs, also behind the guard of `smlibpy.defeature` (the forked copy came through, the process did not). The destructor deletes exactly the curves no Brep took (see `SmEdgeDefinition::Imprint`). |
| `SMLib/src/SmProtoTopology.cpp` | `SmProtoTopologyManager::SplitIntersectingProtoEdges` stops once a range solution has deleted `pPE2`, and returns `SM_ERR_BAD_INTERSECTIONS` when solutions are left; it asks `pPE2`, not `pPE1`, which ProtoVertex lies at `pPE2`'s split parameter; `sm_WhichPVToCombine` takes ProtoEdges without end ProtoVertices | The next solution split the deleted ProtoEdge (AddressSanitizer: a read of freed memory in `SmProtoEdge::Split`). Booleans of crossing holes whose seams lie tangent to the other hole, such as `Cylinder(3, 40).translate(0, 3, 0) + Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` and its cut, `&` and merge, killed the process. The solutions there are nine ranges of one ProtoEdge, each on all of the other; the Boolean cannot go on soundly. |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::IntersectTopology` fails on `SM_ERR_BAD_INTERSECTIONS` from `SplitIntersectingProtoEdges` (its other errors stay ignored) | Without it the crossing holes above gave valid bodies of the wrong volume that could not be tessellated (`h1 + h2` 1697.46 instead of 2199.24, OpenCASCADE). |
| `SMLib/src/SmTopologyIntersector.cpp` | `SmTopologyIntersector::DeleteFaces` fails with `SM_ERR_BAD_INTERSECTIONS` rather than delete a shell Vertex whose Shell still owns Faceuses | `SmBrep::DeleteVertex` deletes the Vertex's Shell with it, and the Faces left in that Shell were read when the Brep was post-processed and when it was deleted (AddressSanitizer: freed memory read in `SmEdge::GetBrep` from `SmMerge::BooleanPostProcess`, and in `~SmFaceuse`). `Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)`, a flat end cap tangent to the sphere, killed the process in 3 of 3 runs. |
| `SMLib/src/SmMerge.cpp` | `SmMerge::BooleanPostProcess` takes only the Vertices still in the Brep (a set made after the Edges are merged, renewed after every Vertex it deletes) | A Vertex deleted earlier was read in `SmVertex::GetEdges` from `IsTopologicalVertex`: `Box(40, 30, 10).rotate(X, 45).shell(10, opening)` killed the process in 11 of 48 runs (the shell's Booleans; 0 of 96 since). |
| `SMLib/src/SmOffsetExecutive.cpp` | `SmOffsetExecutive::RemoveExcessFaces` forgets the faces it removes, and their edgeuses, in the executive's relations (`m_vEUToEU`, `m_vFUToF`, `m_vEToF`, `m_vVToF`, `m_vBlendToFaces`) | `RemoveFaces` deletes them, and the rest of `DoExtendedOffset` still found them there: the side walls of lamina edges (`BuildSideWallOfEdgeuse` → `SmBrep::CreateEdgeEdgeBlend`) and then `PiecewiseMerge` read the freed edgeuses and faces. An offset whose faces collapse, such as `extrude(CenterArc((0, 0), 10, 0, 180), 20).thicken(-12)`, read freed memory natively and trapped in the WebAssembly build (smlibwasm). `ai/todo/features.md` (42). |

What the fixes change, measured on macOS arm64 with the normal build and an AddressSanitizer
build:

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
- Both test suites pass.

Defects that remain in the kernel (crashes and loops in the feature executive's patching) are
described in `ai/todo/features.md` (37); `smlibpy.defeature` guards against them.

## Checking with AddressSanitizer

Configure a separate build directory with
`-DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_FLAGS="-fsanitize=address -fno-omit-frame-pointer"`
(and `-DSKBUILD=ON`, which keeps its `_core` module in the build directory rather than writing it
over the one in `src/smlibpy`), put its `_core` module next to a copy of `src/smlibpy`, and run the Python binary itself (on
macOS not through `env` or `timeout`, which drop the `DYLD_` variables) with
`DYLD_INSERT_LIBRARIES=$(clang -print-file-name=libclang_rt.asan_osx_dynamic.dylib)` and
`ASAN_OPTIONS=detect_leaks=0:strip_env=0` (`strip_env=0` keeps the sanitizer in the worker
processes of the MCP session tests). With the guard on, a defect in a forked copy shows as
"the kernel crashed (signal 6 ...)" and its report goes to stderr; `GUARD_SECONDS = 0` runs every
step in the process, so the first report ends the run.

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
   still pass with the normal build.
4. Remove the row from the table above.

When the last copy is gone, this directory and `smlibpy_patch_sources` in `CMakeLists.txt` can
go too.
