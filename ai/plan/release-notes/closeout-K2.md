# Closeout K2: kernel memory defects and leaks (offset, fillet, sweep, fill)

What the 0.5.0 notes left under "Not done" for the kernel's memory errors and leaks in the offset,
fillet, sweep and fill code, triaged: finished, blocked by the kernel, or later. Everything applies to
smlibpy (Python) and smlibwasm (JavaScript) alike: the fixes are kernel patches
(`third_party/patches/SMLib/src`, each change marked `smlibpy patch` and listed in
`third_party/patches/README.md`) and smlibpy's shared C++ (`src/cpp`), compiled into both builds.
Tests: `tests/test_closeout_K2.py`, `js/test/closeout_K2.test.ts`. Numbers: macOS arm64; leaks per
call with the normal build (malloc zone statistics; smlibwasm: `memoryUsage().used`), memory errors
with an AddressSanitizer and LeakSanitizer build (LLVM 21) and random allocations between the calls
to vary the memory layout; "before" is 5c7666f.

## Finished

- **`fill()` of three or five and more sides no longer leaks.** NLib's N-sided fill
  (`N_FillNSidedHole`, behind `SmBSplineSurface::CreateNSidedPatch`) never freed the stack it did its
  work on. Per fill: an octant of a sphere bounded by three arcs 91.9 kB, now 0; five splines 23.3 kB,
  now 0 (smlibwasm: 77.3 and 23.0 kB, now 0); 0.1 to 1 MB for others, also in 0.4. The patch frees the
  local stack when the function returns and puts the knots it inserts into the returned surfaces on
  the caller's stack. The patches meet their boundary curves as before (to 1e-6, tested).
- **Fillets along tangent edges no longer leak.** The fillet executive joins the curves of a smooth run
  of edges and gives each edge the joined curve or a copy, which no edge owned
  (`SmFilletExecutive::CreateSmoothEdgeSequence`): they and the caches the corners built on them
  (`SmFilletCorner::CalcCornerVertGeom`) were lost. A fillet of a rounded plate's top run (the
  selection `propagate=True` makes from one edge): 189 kB, now 0 (smlibwasm 153.5 kB, now 0); also in
  0.4.
- **Refused and failed fillets no longer leak** (found while measuring the entry above). A fillet the
  executive refuses at a corner lost the intersection curves `sm_SrfSrfIntersection` had collected and
  the fillet surfaces of its solvers: 24.5 kB per refused `propagate=False` fillet of one of those top
  edges, now 45 bytes (smlibwasm 19.6 kB, now 0). A fillet that fails after the executive has made its
  fillet faces lost the whole intermediate fillet Brep: 348 kB per failed all-edge fillet of the two
  cones below at r 0.6 (it fails in `SmFilletGeom::InsertIntersectionTopology`), now 16.4 kB (smlibwasm
  281 kB, now 14.0 kB; the rest is a curve copy of `SmCurveClassification::MergeInterval` with its
  cache, see Blocked). LeakSanitizer had not reported it: the kernel's context still reached it.
- **Sweeps along mitered planar paths no longer leak.** `CreateSweepAlongPlanarPath` lost the copies of
  the profile and the path it made for every segment, the extended segments (each extension was
  written over the pointer to the curve it extended), its cutting lines, the curves of the segments'
  intersections, the ProtoVertices the Boolean of the segments took out and, when that Boolean
  failed, the segments themselves. A circle swept along a path of two lines: 12.7 kB a sweep, now 0
  (smlibwasm 10.5 kB, now 0). Where the kernel makes no extension of a cutting line the sweep now fails
  instead of going on with a null curve.
- **Failed extended shells no longer leak (the 4.7 kB; `CreateProtoEdge` in part).** A shell whose
  last Boolean (or merge) failed lost the offset body with the caches built on it, the trim curves of
  a failed extension (`SmOffsetGeometryCreation::ExtendTrimEdges`, about 4.7 kB), a line
  `SmMerge::MergeEdge` had copied, and the curves of the EdgeDefinitions `CombineProtoEdge` leaves
  behind (some of `SmProtoTopologyManager::CreateProtoEdge`'s copies; the rest: Blocked). Three raw
  extended shells of filleted boxes, most of which fail: 879 kB, now 128 bytes (smlibwasm 437 kB, now 163 bytes). They succeed and
  fail about as before (the mode is unsteady: 21 and 13 of 108 calls succeed after and before).
- **Cones that come to a point no longer leak** (found by the sanitizer job): `CreateCone` made the
  iso curve of the apex and used it for nothing, 72 bytes and its knots per cone (`SmApiCreateCone`).
- **Face copies the kernel cannot build are freed, not kept for the life of the process (T2).** A face
  of an imported body whose faces share no edges and whose vertices lie 1e-3 apart cannot be copied
  (`Face.to_shell()`): `CopyFaces` fails, then `RemoveFaces` on a copy of the whole body. `RemoveFaces`
  left a Face without Faceuses in that copy, which `~SmBrep` read through (a SEGV at 0xa0), so smlibpy
  kept both copies: 118 kB a failed copy (smlibwasm 82 kB), now 0. Kernel patches: `DeleteFace` takes
  such a Face out and deletes it even when its bookkeeping fails, `~SmBrep` deletes a Face without
  Faceuses, and `CopyFaces` deletes the curves and surface of a face it could not build. smlibpy
  deletes the copies (`src/cpp/ext.cpp`, `src/cpp/slivers.cpp`).
- **The all-edge fillet of two cones no longer writes freed memory.** `Cone(3, 0, 10).rotate(Y, 90) -
  Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1, 0)`: the Boolean inside the fillet took out an Edge
  between the two sides of one Face as if it joined two Faces, and `SmLoopuse::CollectEdgeuses` wrote
  into the Edgeuses it had freed (fuzz case fillet-7-185; the normal build raised
  `SM_ERR_NULL_POINTER`). `SmBrep::DeleteEdge` refuses such an Edge before it changes anything: the
  fillet raises `KernelError` (`SM_ERR`); r 0.3 rounds as before (90.0851). AddressSanitizer reports
  nothing for its fillets at r 0.721755, 0.75, 0.7, 0.6, 0.5 and 0.3, of its three edges and of all.
- **Extended offsets of imported parts: the crash sites of the notes are patched.** The imprint that
  leaves an Edge half made (crescendo part 52): `ImprintIntersections` fails the Boolean
  (`SM_ERR_BAD_INTERSECTIONS`) when a failed imprint left an Edge without a Vertex at one end, and
  `SmEdgeuse::CreateUVTrimCurve` refuses such an Edge instead of reading address 0x98. The two
  `SmBezierAux2d::BuildPolarBox` crashes (parts 81 and 19): the polar box of a node subdivided after
  its tree was built takes the tree's surface instead of calling through a null pointer. Patched on the
  way, all reads of freed memory in the same Booleans: `MakeEdgeInFaceWithVU` looked for a
  LoopVertexuse's partner next to it only and failed after deleting half of what it deletes (part 81);
  `SqueezeEdge` and `DeleteEdge` left Loopuses naming the Edgeuses they deleted (part 52); `FixGaps`
  kept an Edge it had squeezed away in the relations when only one Brep lost one (the L-shaped shell
  of `test_offsets_that_read_freed_kernel_memory_fail`). Raw kernel calls (shell and two offsets,
  twice per process): part 81 AddressSanitizer 0 of 36 processes (before: the null polar box in half,
  the freed Vertexuses in 1 or 2 of 12), natively 3 of 30 crash (before 11 of 20; see Blocked); part
  19 0 of 24 and 0 of 20; part 52 natively 1 of 20 (before 15 of 20: the half-made Edge), under
  AddressSanitizer 1 of 16 (4 of 24 before the `DeleteEdge` change). The offset steps of
  `test_offsets_that_read_freed_kernel_memory_fail`: 0 of 48 perturbed processes of 8 rounds report
  anything (before: 15 of 48). `shell`, `offset` and `thicken` still run these steps in a forked copy
  (smlibwasm: the probe worker).
- **`cells()` of the merge that crashed the stitcher now works.** The same polar box patch: the kernel's
  own merge of `Cone(3, 0, 4).rotate(X, 90)` and `Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3)`
  (fuzz case csg-153), whose stitcher ended the process (smlibwasm trapped), gives three valid cells
  that add up to that merge. (`Part.merge` gives the right merge anyway, B6.)
- Documentation: `third_party/patches/README.md` (a row per change, the measurements, the defects that
  remain, the checks for dropping the patches), `docs/kernel.md` (the offset and stitcher rows, the fuzz
  run's known crash sites), the `cells()` docstrings in both languages; `tools/sanitize/leaks.txt` no
  longer lists the fixed leaks, so `tools/sanitize/run.py` counts them again. No API changed.

## Blocked

- **The heap-buffer-overflow in `sm_FixProblemsBySqueezing`** (`SmCurveClassification::FindInterval`,
  extended offset merge, layout dependent). The first sanitizer job saw it once, in the steps of
  `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail`. Tried: those steps in 48
  AddressSanitizer processes of 8 rounds each with random allocations between them (0 reports; on
  5c7666f the same probe gave 15 reports in 48, all of them other sites: the deleted ProtoEdge of
  `ResolveOverlappingProtoEdges`, which close-out K1 patches, and the Edge `FixGaps` kept, patched
  here), six AddressSanitizer runs of `tests/test_guards.py` (0 reports in the test processes), and
  the sanitizer job over its default tests (745 passed, 0 reports). Never reproduced, so neither located nor
  confirmed fixed: it stays in `tools/sanitize/known.txt` (with
  `test_offsets_that_read_freed_kernel_memory_fail` among the tests that reach it), and the steps
  run in a forked copy.
- **Extended offsets of imported parts, what remains** (contained by the forked copy). Crescendo
  part 81 crashes natively in 3 of 30 processes (raw shell and two offsets, twice per process), always
  in `SmBrep::GlueVertices` from `GlueCoincidentBrepVertices` on a freed Vertex (`SmVertex::GetShells`
  read reused memory, located with a SIGSEGV backtrace handler); AddressSanitizer reported nothing in
  36 processes and lldb never saw it crash, so the free is not located. Part 52 crashes in 1 of 20
  natively and reports in 1 of 16 processes under AddressSanitizer: a Loopuse still names an Edgeuse that
  `DeleteEdge` freed in `GlueCoincidentBrepVertices`, read by `SmMerge::FixFoundFaceCoincidence`.
  Tried: moving the first Edgeuse of the Loopuses of the deleted Edgeuses' Faces off them (4 of 16
  processes still reported), then of every Loopuse of the Brep (the patch kept here); the stale name
  must come through an Edgeuse ring that still links the freed Edgeuse, or a Loopuse outside the
  Brep's Faces.
- **Small leaks left on failure paths** (found while measuring; also on 5c7666f). The copies
  `SmProtoTopologyManager::CreateProtoEdge` makes for EdgeDefinitions that some Booleans drop without
  imprinting them (152 bytes each, about 24 in the extended shells of `tests/test_lane_FO.py`): after
  the `CombineProtoEdge` patch the rest come from elsewhere; freeing the curves no Brep took after the
  imprint (by their owners) read curves of Edges that `GlueCoincidentBrepVertices` had deleted since
  (crescendo part 52 crashed in 9 of 20 processes natively), so it was taken out again and the leak
  stays in `tools/sanitize/leaks.txt`. A fillet that fails in `SmFilletGeom::InsertIntersectionTopology`
  keeps a curve copy of `SmCurveClassification::MergeInterval` with its cache (about 16 kB; that file
  is another lane's patch).

## Later

- None: every entry of this area is a defect.

## Behaviour changes

- `cells()` of a body whose stitch crashed the kernel (a null polar box) returns its cells instead of
  raising `KernelError` ("cells failed: the kernel crashed"). Such bodies come from the kernel's own
  wrong merges (`Part.merge` checks its result and raises on them); where it matters, check the cells
  against the part:

  ```python
  cells = part.cells()
  assert abs(sum(c.volume for c in cells) - part.volume) < 1e-6 * part.volume
  ```

  ```ts
  const cells = part.cells()
  if (Math.abs(cells.reduce((t, c) => t + c.volume, 0) - part.volume) > 1e-6 * part.volume) throw new Error('cells')
  ```

- The all-edge fillet of the two cones above raises `KernelError` with status `SM_ERR` where it raised
  `SM_ERR_NULL_POINTER` (after writing freed memory). Match the error, not the status:
  `except KernelError:` (smlibwasm: `e instanceof KernelError`).
- Raw extended shells and offsets (`smlibpy._kernel.k.shell_brep` and `k.offset_brep` with
  `extended_offset=True`, the same in smlibwasm's `k`) that went on with a half-made Edge fail with
  `SM_ERR_BAD_INTERSECTIONS`; `shell`, `offset` and `thicken` try their next mode, as after any
  failure. usd-brep's raw `_core.merge_breps` and `_core.evaluate_csg_tree` (which smlibpy does not
  use) delete the operands of a Boolean that fails inside them: they consumed them before too, but
  left them allocated.
