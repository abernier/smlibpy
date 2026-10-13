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

What the fixes change, measured: the kernel's own fillet removal (`_core.remove_fillet`) gives
a box with four rounded edges back (6 faces, volume 24000.0; before: nothing removed). An
AddressSanitizer build reports no error for Booleans and for `remove_fillets` and
`remove_faces` on parts made in smlibpy. Both test suites pass. Defects that remain in the
kernel (crashes and loops in the feature executive's patching) are described in
`ai/todo/features.md`; `smlibpy.defeature` guards against them.

## Dropping a patch

When an upstream release fixes a defect:

1. Update the submodule to that release.
2. Delete the copy here (or, if the file changed upstream and the defect is still there,
   copy the new upstream file and apply the marked changes again).
3. Rebuild from scratch and run both test suites. For the vertex lookups, also check that
   `remove_fillet` on `Box(40, 30, 20)` with its 4 vertical edges rounded r 3 gives 6 faces and
   volume 24000.0; for the destructor, that an AddressSanitizer build reports nothing for
   `Box(40, 30, 20) - Cylinder(5, 40)`.
4. Remove the row from the table above.

When the last copy is gone, this directory and `smlibpy_patch_sources` in `CMakeLists.txt` can
go too.
