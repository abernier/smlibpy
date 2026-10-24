# Plan: smlibpy and smlibwasm against the SMLib kernel

This plan compares smlibpy (Python) and smlibwasm (its WebAssembly/TypeScript port) with the
kernel they wrap: SMLib from usd-brep 1.0.0 (commit c9c5979), on branch `next` at e1af14d
(release 0.4.0), as of 2026-10-21. The work was split into 17 slices: 13 planned areas plus 4
gap areas that a completeness critic added (NLib shape tools, USD conformance, real-world
input corpora, randomized fuzzing). Every finding was checked by a separate verifier, who
re-ran or wrote probes in Python and in the wasm build and read the kernel source; 35 agents
took part. Of 220 findings, 143 were confirmed, 76 confirmed in part (stated here in their
corrected form) and 1 refuted. The critic also ran upstream's own test oracles against the
patched kernel: SmPyLib's `test_omni_solid.py` against `smlibpy._core` (366 passed; the 39
failures are the excluded `sm.usd` submodule or docstring checks) and all 17 `prog_test`
suites (all pass). The three patched kernel files therefore do not regress upstream's tests.
One caveat on the wasm numbers: `js/wasm` is a link to the main checkout's build, made 6
minutes before the last C++ commit (cc93ec2, USD meshes by default), so some wasm probes may
have run on a build that differs slightly from this branch's `js/cpp` and `src/cpp`.

Status (2026-10-22): phase 1 is done, on branch `fix/kernel-review`. The P0 items (and B11) came
first, in seven commits: 1e82ba4 (W), 3d1d3aa (Bcore), a19b674 (Bcrash), f1edb4f (F), 8194dcd
(O), de5795c (SCUMA) and 90677eb (TIX). The P1 to P3 items and the P0 leftovers followed in nine
lanes, merged with the integration commit 8c92eec: BT, Booleans and topology (5948e4d, 3305dfe,
163033d, 8525ff9); FO, fillets, offsets and face edits (ace33c7, 90cc398, 6802aa4, 9757bdf); S,
sweeps and primitives (ae96cce, 9f7c692, e969994, e6a8a48); C, curves (97384e9, f097364,
126bb76); U, surfaces (600614c, b2bad32, d88756e, a311eab); IX, files (8952bee, eb2cb77,
970f486, 6e43570, 97195f6); M, meshes and drawings (1f1023d, bd60eab); DA, analysis, deformation
and sheet metal (17d7458, 312d0bc, 197d83e); WN, smlibwasm and the runtime (b660ed1, 6a10005,
45602fd, 911b1f9, 13fb24c, ba28379). Every item below has a "Status (phase 1)" note, with its
commit: an item whose P0 status changed has a second, "follow-up" note, and the items of a table
have theirs under the table. Of the 176 items, 162 are done and 14 partial (B6, B19, F7, F10,
F11, O1, S10, U9, U12, I6, I10, X14, W16, N2); none is left undone. What users see, and what is
still open, is in [release-notes-0.5.0.md](release-notes-0.5.0.md), the release notes for 0.5.0.

Status (close-out, 2026-10-23): the release notes' "Not done" entries were triaged in eight lanes
and merged into `fix/kernel-review` (48f6074, 1240edf): R, regressions and documentation errors the
final verification found (f9fdcf2, 289ae5b, e024388); K1, Booleans, cells and topology (ffb80d9,
2b79952, b8d52ea, b7e74c2); K2, kernel memory defects and leaks (2ebcb64, 36e0f59); F, fillets,
chamfers, shell and offset (36825f7, 912c830, 5076b93); S, sweeps, lofts, primitives and curves
(34ab364, 2315ce7, 861f164); U, surfaces, deformation, sheet metal and measuring (dc07edb, 0a3538c,
5744724, 86027ab); M, meshes, drawings and files (7bd25a9, b4462a6); W, the smlibwasm runtime and
infrastructure (c10f34c, 9947011). Each entry was finished (every defect), blocked (a kernel defect
or limit kept after a real attempt, with its evidence) or left for later (beyond the item's "Do").
The items it touched have a "Status (close-out)" note. No item is partial any more in the plan's
sense: what remains is a known kernel limitation (B6, F5, F7, F9, F10, O1, S1, U4, D1, M4, and the
builds' last bits, W16), cannot run here (W7 with Vite 4; N2's Linux and Windows jobs, verified on CI
at the first push), or is later work; the release notes list them under "Known kernel limitations"
and "Later". At 1240edf: Python 1474 passed, 31 skipped; JS 1171 tests, 1155 pass, 0 fail, 16
skipped; the sanitizer job over the default tests and the close-out tests reports no memory
error and no counted leak (875 passed; the 7 heap-growth tests of `test_closeout_K2.py` measure
nothing under AddressSanitizer's allocator).

How to read it:

- Backticked IDs are finding IDs; the appendix lists all of them. Where several slices found
  the same defect, one item lists all their IDs.
- Priority: **P0** = silent wrong result, crash, hang or leak; **P1** = high-value missing
  capability or major weakness; **P2** = medium; **P3** = low. High-value defects that raise
  an error rather than return a wrong result are P1. A defect of the P0 kind that the verifier
  rated low value is listed as P2 and marked so. Where a wrong result sits lower for another
  reason (a documented limit, or one that needs extreme input), the item says why.
- Effort and value are the verifiers' ratings; an item's effort is that of its main finding
  unless stated. "Both" means Python and wasm. C++ in `src/cpp` reaches both builds, because
  `js/CMakeLists.txt` compiles it into the wasm.
- Numbers come from the verifiers' probes (macOS arm64 natively, Node for the wasm).
  Repository paths are relative to the repository root. Kernel paths (`SMLib/...`,
  `SM_API/...`, `NL_*`) are relative to `third_party/usd-brep/source`; patched copies live
  in `third_party/patches`. Reproductions assume `from smlibpy import *`.
- Kernel defects are listed in their theme. The kernel patches they need are collected in
  [Kernel patches](#kernel-patches) as K1-K12.

## The short list

Silent wrong results and crashes first, then the highest value per effort.

1. **B1** Fix the tolerance reset in `ext.transform_brep`. Every moved torus gets tolerance 0
   and every moved part whose diagonal exceeds 500 mm gets a 10x looser one. It is the main
   source of silent wrong Booleans in the fuzz campaign: the Boolean silent-wrong rate falls
   from 2.58% to 0.91% (wasm 2.46% to 0.97%); over all operations it falls from 2.45% to
   1.20%, a rate that also counts 7 circular-chamfer accuracy cases. Small.
2. **B2 + O2** Make the result checks real. Stop marking Boolean results sound unchecked,
   and reject shell/offset results whose faces leave gaps above 1e-3 or that have no cavity.
   Today `is_valid()` is True for a negative volume and for an intersection larger than its
   operand, and 35 of 1018 accepted corpus shell/offset results were wrong. Small.
3. **O4 + O5** Check shell walls in the part's own geometry, and stop `remove_faces` from
   taking the face its rounds enclose. A box rotated by 10 deg gets two 6 mm walls in a 10 mm
   part (valid, 10992.000), and the box rotated by 45 deg and shelled by 10 with an opening
   segfaults in 4 of 36 runs. Removing the rounds around a box's top face also removes the
   face (valid, 3200.0 instead of 4000.0). Small.
4. **B3** Stop accepting empty cuts that only the same kernel confirms: `part - tool`
   returns an empty Part with no error. Small.
5. **U1** Patch `SmPlane::IsNurbSurfacePlane`. `to_shell()`, `.smb` load, `thicken()` and
   `mesh()` flatten B-spline faces that are parameterized like a plane (poles at the Greville
   abscissae) and have a local bump between the 13 sample parameters the test uses (26 of 40
   random single-pole bumps, through `to_shell()`). Small.
6. **M1** Rebuild the kernel mesh when the Mesh arrays change. After the documented
   `m.vertices += ...`, mesh Booleans use the old geometry. Small.
7. **F1** Chamfer with one `fillet_edges_per_edge` call. Today a chamfer whose edges have
   different angles, e.g. all edges of a hexagonal prism (90 and 120 deg), kills the process.
   Small.
8. **B4** Patch `SplitIntersectingProtoEdges`: cut, fuse, `&` and merge of cross-drilled
   holes segfault. Small.
9. **T2** Never delete a Brep after a failed `RemoveFaces` in `ext.copy_faces`. Today
   `Face.to_shell/translate/rotate/to_sketch/extrude` kill the process on a STEP import whose
   faces share no edges and whose vertex points sit up to 1e-3 off (low-precision writers).
   Small.
10. **X1** Add value checks to the USD reader. One bad number in a `.usda` segfaults
    `import_usd` or a later `mesh()`, hangs `.volume`, or imports a wrong body that reports
    valid. Small.
11. **W1** Restore the wasm stack pointer after failed kernel calls. Every failure leaks
    16-904 bytes of the 4 MB stack (a trap 7,696). After about 240k errors (or 11k missed
    raycasts) the module is broken for good, and before that it overwrites static data. Small.
12. **B7 + I2** Fix the two measured leaks (both builds). A failed Boolean leaks both operand
    copies (about 0.6 MB each time natively). `SmFace::HasSeamProblem` leaks 3-13 KB per
    periodic face on every STEP import. Small / medium.
13. **T1** Take edge convexity from `SmEdge::CalcOuterAngle`. `concave()`/`convex()` are
    wrong on imported parts and differ between Python and wasm; the kernel call is exact and
    22x faster. Small.
14. **O1 + O6 + N1** Take the extended offset mode out of the user's process and cut its
    retries. shell/offset segfault at random: 25-40% of runs on an L-shaped box, and issue #2
    reproduces on macOS in 2 of 10. Medium.
15. **A1** Compute the exact distance between nearly parallel faces. Skew cylinders 2 mm
    apart report 2.485, an overestimated clearance with no warning. Medium.

Items 8, 12 and 14 include kernel patches (K1, K6, K2) that need an AddressSanitizer or
LeakSanitizer run first; N2 makes that a CI job, and the manual procedure in
`third_party/patches/README.md` serves until then.

Small fixes that can ride along: **F3** (ValueError for variable-radius continuity, P0),
**W6** (`ShapeList.at` in TS, P0), **W3** (free the PolyBrep right after copying the mesh
arrays, P0; the draft adds `dispose()`), **C4** (Helix: set `NL_CCPLIM` at init, P1), **I3**
(O-ring tori in STEP: one line, P1), **X3** (non-ASCII names in USD, P1).

Next at medium effort: **I1** (share the file's vertices in the STEP builder: 7.6% of
imported parts get duplicate vertices, and 7 of the 9 parts whose fillets crash have them, so
it likely removes most of F2's corpus trigger) and **W5** (check option keys in TS, P0; the
allowed keys must be generated from Python's signatures).

## Workstreams

Item labels: **B** Booleans, cells and result checks · **F** fillets and chamfers ·
**O** shell, offset and direct editing · **S** sweeps, lofts, extrusions and primitives ·
**C** curves · **U** surfaces and sheets · **T** topology, history and validity ·
**I** STEP import and export · **X** USD, SMB and other formats · **M** meshes and drawings ·
**A** measuring and analysis · **D** deformation and sheet metal · **W** smlibwasm runtime and
parity · **N** runtime, infrastructure and CI.

### B. Booleans, cells and result checks

Goal: a Boolean returns the right body or raises, and a result that passes `is_valid()` has
been checked, not assumed.

**B1 · P0 · Moved bodies lose or change their tolerances** · `fuzz-transform-tolerance-reset` · small · both
- Status (phase 1): done, 3d1d3aa (group Bcore): rigid, mirror and uniform-scale transforms
  keep the tolerances (no kernel patch); the groove, the moved torus and the 1000 mm step give
  OpenCASCADE's results; fuzz Boolean silent rate 2.58% -> 0.91%.
- Wrong: `ext.transform_brep` (`src/cpp/ext.cpp:550-559`) calls `brep->Transform(t, TRUE)`.
  For orthonormal matrices the kernel still passes a scale (1,1,1). It then re-derives every
  tolerance from the vertex bounding box (`SmBrep.cpp:28899-28968`) and resets the shared
  context's model size. One-vertex bodies (Torus, the full revolve of a circle,
  `Torus(align=...)`) get tolerance 0. Parts whose vertex-box diagonal exceeds 500 go from
  1e-5 to 1e-4, and thin disks go to 1e-6. Every translate, rotate, moved, on, mirror, scale
  and pattern goes through it. Effects: an O-ring groove is ignored, `torus & box` returns
  the whole torus, and `Box(1000,1000,100) + Box(10,10,100.00005).translate(0,0,2.5e-5)`
  gives 11 faces in place but 6 when both operands are moved by (1,0,0). One fuzz case
  hangs for over 40 s, and one torus fuse gave 1200.0 in one process and 1940.22 in another.
- Do: split the matrix in `transform_brep`. Rigid: `Transform(SmAxis2Placement, nullptr,
  FALSE)`, as `SmApiTransform` does. Uniform scale: scale with `bScaleTol` FALSE, then
  `SmTol::SetModelSizeEstimate` from the full `CalculateBoundingBox`. Reflection: rigid, then
  `SmBrep::Mirror`. General affine: today's path, then the same full-box reset. Restore the
  context's model size afterwards. Tests: the O-ring groove, `Torus.translate & box`, scale
  and mirror of a torus, a part of 400 mm or more, and the fuzz invariant
  `op(A+v, B+v) == op(A, B)+v`. No kernel patch: patching `SmBrep::Transform` would add a
  copy of a 30k-line file.
- Repro:
  ```python
  (Cylinder(10, 40) - Torus(10, 1.5).translate(0, 0, 10)).volume   # 12566.3706, valid: groove ignored
  (Torus(8, 1.5) & Box(4, 4, 4).translate(8, 0, 0)).volume          # 28.5863
  (Torus(8, 1.5).translate(0, 0, 5) & Box(4, 4, 4).translate(8, 0, 5)).volume  # 355.3058, the whole torus
  ```

**B2 · P0 · Boolean results are marked sound without a check** · `fuzz-sound-shortcut` · small · both
- Status (phase 1): done, 3d1d3aa: no unchecked `sound`; `is_valid()` integrates at 1e-4 with
  the gaps. The gap threshold is 1e-2, not 1e-3 (a sound unfolded bend measures 1.1e-3,
  imported parts up to 6.3e-4); the opt-in strict check by tight boxes is not done (N3).
  Review: `sound` is a level (a Boolean of sound operands, trusted by the next Boolean only; the
  kernel's coarse sign, for the checks of operations; the gaps measured, for `is_valid()`), so
  chains of Booleans, feature inputs, sweeps and imports cost what they did on origin/next.
- Wrong: `_boolean_problem` (`shapes.py:2176-2189`) sets `sound = True` for any closed,
  manifold result of sound operands, and `is_valid()` then returns the cached flag.
  `is_valid()` also ignores the gap measure, which only drives a RuntimeWarning. Examples:
  `Box(10,10,10) - Torus(10,3).translate(-10,5,0)` has volume -776.529 and is valid. An
  intersection of two cylinders (below) has volume 250.206, larger than its operand
  (150.796), and is valid; the matching difference has volume 0 and is valid.
- Do: stop setting `sound` unchecked. Leave it unset, so that `is_valid()` (and
  `_require_valid` before the next feature) integrates only when asked. The coarse sign check
  costs up to twice the Boolean (0.7 ms against 0.9-1.5 ms for box - cylinder; 43 ms against
  21 ms on a 211-face plate). In `_solid_problem`, report "faces leave gaps" when a 1e-4
  integration gives gaps above 1e-3. That catches the example (gaps 0.252), and the sign
  catches the negative and zero volumes. Bounding-box containment also catches the example,
  but only with tight boxes (`bbox()` costs 8 times the Boolean on the 211-face part); loose
  boxes ignore trimming. Use it in the fuzz job (N3) and as an opt-in strict check. Mirror
  in `shapes.ts`. The same gap check goes into shell/offset (O2) and fillet results.
- Repro:
  ```python
  a = Cylinder(2, 12); b = Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)
  i = a & b
  print(i.volume, a.volume, i.is_valid())   # 250.206 150.796 True; i.bbox() runs x -2..16
  ```

**B3 · P0 · Empty cuts and unchanged intersections are accepted** · `bool-silent-empty-overlap`, `input-corpus-empty-cut-accepted` · small · both
- Status (phase 1): done, 3d1d3aa: the volume and box evidence for empty cuts, and
  intersections classified with B11 when they have an operand's face count or reach out of an
  operand's box (the face count alone missed the pulleys). parts.md #18/#21 reopened.
- Status (close-out): done, K1 (ffb80d9, b8d52ea): where a union or intersection may be an operand
  given back, or an operand's box reaches out of the result, points of the operands' surfaces are
  classified against it, and a result reaching out of the operands' boxes is refused; a refused
  union or intersection of one tool is tried again the other way round. `(Cylinder(5, 5) + Box(20,
  4, 16).rotate(X, 90).translate(0, -3, -0.5)) + Cylinder(2, 12).translate(2, -2.3693, 3.5)` is
  1446.6121 (OpenCASCADE 1446.612107; it was 1358.54); fuzz csg-8-110 D, a cut of no volume reaching
  to x = 16, raises.
- Wrong: an empty DIFFERENCE is accepted when a kernel INTERSECTION of the same pair covers
  the part, and that intersection fails the same way, so the misclassification confirms
  itself. On a holed sphere, a cut beside the hole gives `Part(0 faces)`, no error, in both
  builds; the list form gives the right 28160.6. `&` of the same pair returns the whole
  holed sphere (29089.8, valid; right: 929.188). Imported pulleys (crescendo parts 19 and
  40): `part - corner box` is empty and `part & box` is the whole part. ai/todo/parts.md
  #18/#21 count this class as fixed; on curved bodies it is not.
- Do: before accepting an empty DIFFERENCE, require independent evidence that the tools can
  cover the part: total tool volume at least the part's volume times (1 - 1e-5), and the
  tools' boxes cover the part's box. Otherwise treat the result as a failure (retries, then
  raise). Accept an INTERSECTION that returns an operand unchanged (same face count and box)
  only when the other operand contains it: classify sample points with B11 (the kernel's
  `brep_relationship` "contains" answer is exact only when the boundaries are apart). Do not
  bound every result by a coarse volume (see Not planned). Python and TS; reopen parts.md
  #18/#21.
- Repro:
  ```python
  (Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0)  # Part(0 faces), no error
  (Sphere(20) - Cylinder(6, 60)) & Cylinder(3, 60).translate(8, 0, 0)  # 29089.8, valid; right 929.188
  ```

**B4 · P0 · Crossing holes segfault in SplitIntersectingProtoEdges** · `bool-proto-edge-null-crash` · small · both
- Status (phase 1): done, a19b674 (group Bcrash): K1 as planned, plus
  `SM_ERR_BAD_INTERSECTIONS` when solutions are left and a patched `IntersectTopology` that
  fails on it (leaving the loop alone gave valid bodies of the wrong volume). All reproductions
  raise KernelError; ASan clean. wasm takes another path there: the cuts, fuses and merges raise
  plain `SM_ERR`, and the intersection of the two holes gives the right 62.721 (both tests say
  so).
- Status (phase 1, follow-up): done, 5948e4d (lane BT): with B6's turn the crossing holes compute in
  both builds (`&` 62.720938, union 2199.225772, the cuts 6931.74757); the kernel's own Boolean of
  them still fails cleanly (K1).
- Wrong: in the patched `SmProtoTopology.cpp`, `sm_WhichPVToCombine` (486-513) dereferences
  NULL ProtoVertices, line 6811 passes `pPE1` where `pPE2` belongs, and lines 6862-6868
  delete an edge the solution loop still uses. Cut, fuse, intersection and `Part.merge` of
  crossing holes exit with 139. smlibpy's "combine the tools" retry crashes too. In the wasm
  the NULL read does not trap and ends in a KernelError after reading garbage.
- Do: kernel patch K1. Add the reproductions to `tests/test_guards.py` (expect KernelError),
  plus an AddressSanitizer run. The seam placement of B6 also removes these inputs.
- Repro:
  ```python
  Box(20, 20, 20) - Cylinder(3, 40).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)  # exit 139
  Cylinder(3, 40).translate(0, 3, 0) & Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)                    # exit 139
  ```

**B5 · P0 · Boolean segfault in BooleanPostProcess; cells() segfault in the stitcher** · `fuzz-boolean-postprocess-crash` · medium · both
- Status (phase 1): done, a19b674: ASan placed the cut in `SmTopologyIntersector::DeleteFaces`
  (a vertex shell that still owned faces), which now fails; K3's edge filter only moved the
  read and was dropped; K3's vertex half is in `SmMerge.cpp`. `merge` checks its volume, so
  `cells()` never sees the crashing body; `cells()` is not isolated (N1).
- Status (phase 1, follow-up): done, 6a10005 (lane WN, N1): `cells()` runs its stitcher in another
  process; the BuildPolarBox crash of a cone and cylinder merge is a KernelError.
- Status (close-out): done, K1 (ffb80d9) and K2 (2ebcb64): `DeleteFaces` deletes first the shell
  Vertices whose Vertexuse names a vertex Shell that lists another Vertex (ASan: a freed Shell read
  in `SmVertexuse::GetShell`), so the torus touching a plate at a point (`(Box(20, 16, 4) -
  Sphere(6).rotate(X, 90).translate(1.4007, 0, -1.5863)) & Torus(6, 2.5).rotate(Y,
  90).translate(7.5, 0, 10.5)`) no longer kills the process: the intersection is empty, the union
  1616.2075, the cuts the operands, in both builds. The null polar box the stitcher read is patched
  (`SmSurfaceCache.cpp`): `cells()` of fuzz csg-153's merge gives three valid cells that add up to
  it.
- Wrong: the cut below exits with 139 in 3 of 3 runs, in `SmMerge::BooleanPostProcess`
  (IsTopological on a stale edge of `m_sIntersectionEdges`); `&` of the same pair works
  (14.137071). The wasm reports "operands may touch" over a trap. Separately, `Part.cells()`
  crashes (3 of 3) in `SmApiStitchIntoSolid` (`cells.cpp:56` -> FindInfiniteRegion -> RayFire
  -> BuildPolarBox) on a merge the sphere-seam defect (B6) already made wrong (518.314
  instead of 586.44).
- Do: reproduce under ASan or MallocScribble, then patch K3. Guard `cells()` with the volume
  sum check of B8 before stitching, or run `region_shells` isolated (N1). An opt-in
  `GUARD_BOOLEANS` through N1 is cheap (fork measured at 1.4 ms).
- Repro:
  ```python
  Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)  # exit 139
  ```

**B6 · P0 · Seams tangent to the other operand give valid bodies with the wrong volume** · `bool-seam-tangent-wrong`, `fuzz-seam-tangency`, `fuzz-mitigations-measured` · medium · both
- Status (phase 1): deferred, 3d1d3aa: seams turned at creation (37 and 197 deg) fixed 5
  operations but brought 5 new silent results each, so it did not land. The groove pin and
  cross holes are strict expected failures in both suites; needs a design decision.
- Status (phase 1, follow-up): partial, 5948e4d (lane BT): `src/cpp/seams.cpp` finds seams that run
  tangent to the other operand's planes, cylinders, cones, spheres and tori where the faces cross,
  and `ext.boolean` turns the body of revolution that owns the seam about its axis (on copies, at up
  to three angles, passing over results outside the operands' volume bounds). Groove pin
  24299.258668 (exact), cross holes 6931.74757, the sphere-seam intersection 13.625854; fuzz (3,270
  cases) silent 76 -> 72 natively, 79 -> 72 in the wasm. Not done: seams of operands that are no
  body of revolution, a torus' outer equator (slice-7-390; a revolve normalises to the same torus,
  so the retry does not help), seams on B-spline faces. The strict xfails became tests.
- Status (close-out): done, with a known kernel limitation, K1 (ffb80d9, b8d52ea):
  `src/cpp/seams.cpp` moves the seam of an earlier hole or boss on its face (the face's solid filled
  and recut turned, kept where the volume stays to 1e-7), looks at B-spline faces of the other
  operand, and recognizes a B-spline seam face as analytic first; parts merged into an earlier merge
  are turned or moved too. Where a seam touches at a point (new `ext.seam_touches`), 16 x 16 points
  of each result face near it are classified against the operands, and a wrong result is done again
  with NURBS copies (`_seam_retry`) or refused; a split by a plane touching such a seam keeps only
  sides that add up. 160 cases against OpenCASCADE: silent wrong 106 -> 7 (torus caps 1e-4 to 2e-4,
  a torus tool 3.6e-5), errors 38 -> 8; A-25's union 23635.9574 and intersection 194.5466, its cut
  raises; slice-7-390 5.80689 + 1889.15715 in both builds; fuzz slices silent 0.93 % and 1.85 % ->
  0. Blocked: the kernel's defect along a torus' outer equator or a free-form seam (no turn, fill
  and recut, NURBS copy, swapped operands or revolve from another latitude moves it;
  `SmFace::MoveSeam` takes no seam edge), so some such Booleans raise.
- Wrong: when a primitive's seam line lies in a tangent plane of the other operand, the
  manifold Boolean returns a closed, valid body of the wrong volume; the mesh volume
  disagrees too, so the B-rep itself is inconsistent. A groove pin tangent to a bore gives
  24331.7029 instead of 24299.2587 (wasm 24364.1472; at y=-5 it is 162.22 off). Two cross
  holes give 7057.19 instead of 6931.75. A rotated sphere whose seam is tangent to a
  cylinder: `Cylinder(2.5,30).rotate(Y,90) & Sphere(2).rotate(X,90).translate(0,-0.5,2.5)`
  gives 81.7551, more than the sphere (33.51). A plane whose trace on `Torus(6,4)` is tangent
  to the outer-equator seam splits it into pieces that do not add up (595.066 + 1889.157
  against 1894.964), with only a RuntimeWarning, and `section()` raises SM_ERR.
- Measured mitigations: placing the seams off the axis planes fixed every tested cylinder and
  sphere case, but only with both operands rotated (197 deg and 45 deg were exact). Over 830
  fuzz cases, rotated seams moved failures around (silent rate over all operations 1.20% ->
  1.24%, crashes 8 -> 5, some new silent shell and cut results, changed face counts). Done
  through today's `rotate()`, they also set every torus tolerance to 0. A torus' v-seam is
  its outer equator; no rigid placement moves it. A NURBS copy of the tool does not help
  (the groove pin gives 24461.48), so B10's retry does not cover this class.
- Do: after B1, create cylinders, cones and spheres with their seam off the axis planes at
  creation (`SmPrimitiveCreation` crRefFrame, or a rigid transform once B1 is fixed). Land it
  only if fuzz seeds 7 and 8 (N3) show no new silent results, and update the docs that place
  seam vertices at (r, 0, ±h/2) (skill `selection/Vertex.md`). For tori rely on the gap
  check of B2 (case (b) has gap 4.0), and retry split/section with the torus rebuilt by a
  revolve whose circle starts at another latitude. Tests: groove pin and cross holes
  against analytic volumes.
- Repro:
  ```python
  (Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
  # volume 24331.7029, is_valid True; exact 24299.2587
  ```

**B7 · P0 · Failed Booleans leak both operand copies** · `infra-bool-fail-leak` · small · both
- Status (phase 1): done, 3d1d3aa: `ext.boolean` clears DoingBoolean on failure, and every
  Boolean holds its copies in handles; 100 failing cuts +7.6 MB instead of +52.9 MB. Review:
  deform's imprint goes through `ext.boolean(imprinting=True)`, and `boolean_2d` operands are
  held in handles too.
- Wrong: on failure the kernel keeps both operands (`SmApiBrep.h:42-56`: pBrep2 is deleted
  only on success), but `_run_boolean` passes raw copies that no handle owns. One failed cut
  leaks about 0.6 MB on a small part (581.9 KB measured; raw kernel 583.5 KB, 6.4 KB when
  both are freed). 300 failing cuts add 170 MB; in the wasm, 600 failed cuts add 234.8 MB.
  The same pattern is in `_boolean_problem`, `merge` (`_take(h)` before the call),
  `Shell.__add__` and the deform and sheet-metal Booleans. A failed Boolean also leaves the
  context's DoingBoolean flag set (latent; no wrong result observed).
- Do: hold the copies in `BrepHandle`s and release the tool's handle only on success
  (`BrepHandle.release()` in TS). Document "freed only on success", since the SmPyLib
  docstring says "Consumes". Reset DoingBoolean in a re-bound boolean on failure. RSS
  regression test: 100 failing cuts (N2).
- Repro:
  ```python
  for _ in range(100):
      try: Box(40, 30, 20) - Cylinder(3, 40).translate((-5, 0, 0)) - Cylinder(3, 40)
      except KernelError: pass      # RSS +56.7 MB after 100
  ```

**B8 · P0 · cells() double-counts inserts that touch at a point or along a line** · `fuzz-cells-point-contact` · small · both
- Status (phase 1): done, a19b674: `region_shells` splits shells at edges used exactly twice,
  and `cells()` checks the sum (1e-6); point contacts are right, line contacts raise. Review:
  the sum check allows 10 times the gaps between the faces (fitted chamfers, imported parts).
- Wrong: `region_shells` (`cells.cpp:72-108`) returns one joined shell when an insert touches
  the housing at a point or a line, and `cells()` then cuts no cavity. The cells sum to more
  than the part; a tangent `Cylinder(4,10)` gives an outer cell of 8502.655 inside a box of
  8000. Both builds.
- Do: raise ModelingError in `cells()` when the cell volumes differ from the merged volume by
  more than 1e-6 relative. Then split joined shells by manifold traversal (cross only edges
  with exactly two uses on the region's side), or subtract each other cell inside the outer
  shell. Grouping faces by edge connectivity does not separate line contacts.
- Repro:
  ```python
  Box(20, 20, 20).merge(Sphere(4).translate(6, 0, 0)).cells()   # [8000.0, 268.083]; right [7731.917, 268.083]
  ```

**B9 · P0 · section() of a merged part drops a cell** · `bool-merged-section-split` · medium · both
- Status (phase 1): done, a19b674: `section` per cell, combined with `ext.combine`; `split`
  checks validity first.
- Wrong: `Part.section` treats a merged part as one region set. With Plane.XY the insert's
  disc vanishes silently; with Plane.XZ it raises a bare KernelError. `Part.split` on a merged
  part raises KernelError "split failed", not the ModelingError that `merge.md:24-26`
  documents. Refusing Booleans on merged parts is documented and stays.
- Do: section each cell the plane cuts (skip the cells it misses, which raise) and combine
  the faces with `ext.combine`. Let `split` call `_require_valid` first.
  `non_manifold_boolean` is not a general fallback (see Not planned).
- Repro:
  ```python
  merge(Box(40, 40, 20), Cylinder(6, 30)).section(Plane.XY)   # 1 face, 1486.903; right: 2 regions, 1600
  ```

**B10 · P1 · Retry cuts beside an earlier parallel hole with a NURBS tool** · `bool-nurbs-retry`, `fuzz-mitigations-measured` · small · both
- Status (phase 1): done, 5948e4d (lane BT): `_nurbs_retry` retries a tool with a cylinder or cone
  parallel to, off the axis of and overlapping one of the part or of an earlier tool as a NURBS
  copy, before the combine-tools retry for one tool and after it for several (lists keep their
  analytic result); the result must pass `_boolean_problem` and the operands' volume bounds.
  14612.252843, 44714.493828, 18081.621062, 256.773802, 28160.608302 and 929.188310, all of which
  raised; hole faces come back as cylinders.
- Gap: a tool that overlaps an earlier parallel cylindrical hole fails, with a hint to
  combine the tools that the user cannot follow:
  `(Box(40,40,10)-Cylinder(6,30)) - Cylinder(3,30).translate(8,0,0)`, the same in a cylinder,
  a boss fuse, and intersections. A NURBS copy of the tool (`k.turn_to_nurbs`) gives the
  analytic values (14612.2528, 18081.6211, 28160.6083, and 256.7738 for `&`) in about 8-25 ms, and
  the result faces come back analytic. Over random fuzz failures the same retry rescued only
  1 of 87.
- Do: retry with a NURBS copy only for this class (the tool has a cylindrical or conical face
  parallel to, and overlapping, a face of the part), before the combine-tools retry. Check
  the result with B2/B3. Tests: the six probes in both suites.

**B11 · P1 · Point-in-solid classification** · `bool-point-classify`, `topo-classify` · small · both
- Status (phase 1): done, 3d1d3aa: `Part.classify/contains/cell_at` over `ext.classify_points`,
  which votes with extra rays: `Point3DClassify`'s +X ray misses faces once a tight box has
  been computed (a kernel defect found on the way).
- Gap: there is no point-in-solid query, and the documented ray-parity recipe
  (`docs/analysis.md:88-100`, `raycast.md:58-60`) is wrong in 3 of 6 probes. Rays that graze
  a cylinder or a sphere count as inside; a point in material whose ray is tangent to a hole
  wall counts as outside, and boundary points cannot be reported. `SmBrep::Point3DClassify`
  (`SmBrep.cpp:24687-24841`) is complete and classified the same points correctly in
  0.01-1.3 ms, including FACE/EDGE/VERTEX and void regions.
- Do: `ext.classify_points(brep, points, tol)` (vectorized; default zone tolerance) in
  `src/cpp/ext.cpp` and `js/cpp/bind_smlibpy.cpp`. `Part.contains(point, tol)`,
  `Part.classify(point)` (inside/outside/on plus the Face/Edge/Vertex) and
  `Part.cell_at(point)`. Caveat the parity recipe in the docs now. Needed by B13 and B15.

**B12 · P1 · Split a part by a sheet; trim a sheet by a part** · `bool-split-by-sheet`, `surface-split-body-by-sheet` · medium · both
- Status (phase 1): done, 3305dfe (lane BT): `ext.slice` (SM_BO_SLICE; U and V of the sheet swapped
  for 'below') and `ext.extended_sheet` for one-face B-spline sheets that end inside the part;
  `split(Plane | Face | Shell)` with both sides checked to add up, `Shell.__sub__`/`__and__` checked
  to lie on the sheet, `part & sheet` a Shell, `part +/- sheet` a TypeError; surfaces.md #11 fixed.
  Not done: sheets of several faces or analytic sheets that end inside the part (U6's
  `Face.extended` is the general tool), `Part.merge(sheet)`.
- Status (close-out): done for one-face sheets, K1 (ffb80d9): a plane, cylinder, cone or sphere face
  that ends inside the part is extended as itself (`Face.extend`): `Box(20, 20, 20)` split by a face
  of `Cylinder(30, 8).translate(0, -25, 0)` gives 2226.0814 + 5773.9181 (integral 5773.9216). Later:
  sheets of several faces (`ModelingError`) and `Part.merge(sheet)`.
- Gap: `split` takes planes only, and `sheet - part` raises TypeError. `part ± sheet`
  returning invalid "Parts" (11 faces, volume 8000) is already open as ai/todo/surfaces.md
  #11. The kernel's SM_BO_SLICE (value 10; SmApiBoolean accepts it, but it is not bound by
  name) splits a box by a wavy sheet correctly (4800 / 3200). DIFFERENCE and INTERSECTION
  with the sheet as the first operand trim the sheet (857.93 / 86.5262). A public workaround
  exists: thicken the sheet by -40 and use it as a half space (4135.93 + 3864.07 = 8000.0);
  +40 fails on the concave side.
- Do: `ext.slice(brep, sheet)` in `src/cpp` and `js/cpp` (keeps the wasm enum whitelist).
  `Part.split(Plane | Face | Shell, keep='above'|'below'|'both')`, with 'both' via MERGE and
  `cells()`. Extend the sheet first when it does not span the part (U6). Raise "the surface
  does not cut through the part" when SLICE acts as a DIFFERENCE because the sheet only nicks
  the body. `Shell.cut`/`Shell.intersect` (or `__sub__`/`__and__`) return Shells, and
  `Part ± Shell` raises TypeError pointing to split, imprint and `Shell.cut`. Closes #11.

**B13 · P1 · Do not trust brep_relationship for empty results** · `vol-relationship-defect`, `fuzz-empty-acceptance`, `bool-relationship-touching` · small · both
- Status (phase 1): done, 3305dfe, with fixes in 163033d (lane BT): `brep_relationship` is no longer
  asked; an empty intersection is right where the loose boxes are apart or the operands' meshes
  share no volume (a concave contact by a tenth of the tolerance), an empty cut where the tools
  cover the part and nothing of its mesh is left outside; classified points where the mesh Booleans
  fail and for tangent or coincident surfaces (the kernel's mesh Boolean of internally tangent
  cylinders crashes). The 168-face plates take 0.12 to 0.18 s instead of 11.4 s; 61 right empties of
  the fuzz are accepted; docs/kernel.md has the row.
- Wrong: `k.brep_relationship` (SmApiBrepRelationship) reports overlapping bodies as
  "touching": spheres with 18.6 mm³ in common, a pin through a plate. Its answer also depends
  on position (face-touching boxes are "touching" at the origin and "interpenetrating" moved
  by (101.3,-57.9,33.1)) and on call history (plates 3 mm apart are "separate" fresh but
  "touching"/0.0 after a tight `bbox()`). It takes 10.75 s on two 168-face plates. smlibpy
  uses it to accept empty intersections, so a correct empty `plate & other` takes 11.2 s
  instead of 0.13 s, correct empties are refused at some positions, and a wrong empty would
  be accepted under "touching". Upstream documents the sampling limit
  (`SmApiQueries.cpp:147-149`). P1, not P0: the wrong acceptances seen (3 of 59 accepted
  empties in the fuzz campaign) come from moved tori (B1); otherwise the risk is latent, and
  what users see today is refusals and slowness.
- Do: in `_boolean_problem` return at once when the loose boxes are disjoint (`_disjoint`
  exists and is unused there). Otherwise accept an empty intersection only when
  `vol(A.mesh(1e-3·diag) & B.mesh(1e-3·diag))` is below 1e-6 of the smaller volume (1-21 ms
  in the probes), falling back to `_body_distance`. Do not use `k.brep_relationship`'s
  touching/separate labels in result checks, and document its behaviour in
  `docs/kernel.md`. A public `relation()`/`interferes()` has low value, since
  `(a & b).volume` works; if added, build it on B11 and A1.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| B14 | P2 | `bool-imprint` | No public imprint, though `k.boolean_with_options(imprinting=True)` works in both builds (a rectangle on a top face gives 48 + 352, volume unchanged). Caveats: a coplanar single-circle sketch imprints nothing, silently; projection across a cylinder seam splits half a patch; a later fillet removes the imprint. | `Part.imprint(Part \| Shell \| Face \| Sketch)`; coplanar sketches as a thin slab through the face; check that the face count grew and the volume did not change; return the new faces. No C++. Curve imprint: U3. | small | both |
| B15 | P2 | `bool-cells-provenance` | Every cell of a merged part gets the first input's name and color (4 cells, all "steel"), also in STEP. | Classify an interior point of each cell against each input (B11); name and color cells by the inputs that contain them; `cell.sources`; export with them. | medium | both |
| B16 | P2 (low-value wrong result) | `bool-solids-island`, `topo-solids-nested` | `((Box(20,20,20) - Box(10,10,10)) + Box(4,4,4)).solids()` gives [7064.0]; `cells()` gives [7000, 64]. Known: parts.md LOW #2. | Split only regions that share no face with another solid region, e.g. group `region_shells` by shared faces. Not by `material_census` count (see Not planned). | small | both |
| B17 | P3 | `bool-new-edges` | No access to the edges a Boolean made (plate + boss: exactly 1 circle; an oblique hole: 4 ellipse pieces), which users want to fillet. | Expose `k.boolean_with_curves` as `part.fuse(boss, edges=True)` or `part.boolean_edges`; bind it in wasm. T3 gives the same selection in general. | small | both |
| B18 | P3 | `bool-section-tangent` | `Cylinder(5,20).section(Plane.XZ.offset(5))` raises a bare KernelError (split and point contact are handled). | Raise ValueError "the plane only touches the part". | small | both |
| B19 | P3 | `fuzz-error-hints` | In the 830 fuzz cases every Boolean error had one tool, yet each advised combining tools; the hint is relevant only when that tool overlaps an earlier cut of the part (parts.md #18, the B10 class). 9 of 10 "intersect ... empty" errors were correct empties; wasm traps read "operands may touch"; NULL_POINTER fillets read "radius may be too large". | Hints from evidence: combine-tools with several tools, a coincident coplanar face, or a tool that overlaps a face of an earlier cut (or point to B10's retry); "the kernel crashed in <op>" for NULL_POINTER or a trap (today only in `.detail`); fillet "degenerate vertex" (with F8, which rewrites the same fillet message); shell names the face; `cells()` errors not as "cut". | small | both |

Status (phase 1) of the items in the table:

- B14: done, 3305dfe (lane BT), one method with U3's since the merge: `Part.imprint` of parts,
  sheets, faces and sketches (a thin slab for coplanar ones), the pieces tagged as the tool's
  descendants, checked (more faces, same volume, valid).
- B14 (close-out): later: pieces descending from the sheet that imprints them is a provenance rule
  beyond the Do.
- B15: done, 163033d (lane BT): `Part.sources`, cells named and colored after their sources, STEP
  solids too. glTF, OBJ, STL and USD of a merged part are unchanged.
- B16: done, 163033d (lane BT): `solids()` groups solid regions by shared faces; parts.md LOW #2
  fixed.
- B17: done another way, 163033d (lane BT): `ShapeList.joining(a, b)` by exact classification.
  `k.boolean_with_curves` is not used or bound: ASan shows it hands out edges `BooleanPostProcess`
  freed.
- B17 (close-out): done, K1 (ffb80d9): the kernel function stays unpatched (nothing calls it); the
  raw `_core.boolean_with_curves` is bound again (`nogil.cpp`) as smlibpy's Boolean plus the
  result's edges on both operands' surfaces: the probe that killed Python runs clean under ASan and
  gives `ShapeList.joining`'s edges in all 8 test cases. Python only.
- B18: done, 163033d (lane BT): ValueError where the kernel fails or a region lies outside and a
  plane moved by 1e-5 of the size misses; every section checked to lie in the part.
- B19: partial, 163033d (lane BT): hints from evidence (a tangent round face, operands that only
  touch, coincident faces with their place, a tool beside a parallel hole, several tools, crash
  notes), shell hints with the place, `cells()` naming the insert. The fillet 'degenerate vertex' is
  F8's naming of the corner instead.
- B19 (close-out): done, K1 (2b79952): `SM_ERR_NULL_POINTER` fillets say the kernel failed inside
  (never "the radius may be too large") and name what the executive recorded, now in smlibwasm too
  (fuzz fillet-7-161). Later: a search for a vertex where the executive recorded nothing, offset
  hints beyond the crash note.

### F. Fillets and chamfers

Goal: fillets and chamfers either build what was asked or fail with a message that names the
cause; no process deaths.

**F1 · P0 · Chamfers of edges with different angles segfault** · `fillet-chamfer-mixed-angle-crash` · small · both
- Status (phase 1): done, f1edb4f (group F): one `fillet_edges_per_edge` call; the hexagonal
  prism matches OpenCASCADE.
- Wrong: when the per-edge lengths differ, `Part.chamfer` loops `k.fillet_edges` over edge
  handles taken before the loop (`shapes.py:2466-2476`, `shapes.ts:2776-2781`). After the
  first call the later handles point at replaced edges. Python exits with 139; the wasm says
  "the length may be too large". Box chamfers have only 90 deg edges, so tests miss it.
- Do: one call, `k.fillet_edges_per_edge(h.brep, kedges, radii, [k.FilletXSect.LINEAR]*n)`,
  in both ports (verified: valid, 2516.8275, 38 faces, setbacks 0.5 and 0.7071). Add the
  repro as a test.
- Repro: `p = RegularPolygon(10, 6).extrude(10); p.chamfer(p.edges(), 1)  # exit 139`

**F2 · P0 · Fillets of tangent edge pairs segfault in CollectTangentEdgeSequence** · `fuzz-fillet-tangent-sequence-crash`, `input-corpus-fillet-tangent-sequence-crash` · medium · both
- Status (phase 1): done, f1edb4f: K4 differs on ASan evidence: the cause is a missing fillet
  corner (`CreateFilletCorners` went on), not a stale pointer; a second fix in `DoFilleting`'s
  shrink loop. The crashes raise `SM_ERR_INVALID_INPUT` with a new hint. The single-edge crash
  did not reproduce (0 of 80).
- Status (close-out): done, K2 (2ebcb64): the all-edge fillet of `Cone(3, 0, 10).rotate(Y, 90) -
  Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1, 0)` (fuzz fillet-7-185) wrote freed memory in
  `SmLoopuse::CollectEdgeuses` (it killed the process on Linux x86_64): `SmBrep::DeleteEdge` refuses
  a manifold Edge between the two sides of one Face before it changes anything. `KernelError`
  `SM_ERR`, ASan clean at six radii; r 0.3 still 90.0851.
- Wrong: on `Box(10,5,20) - Cone(4,5,20)`, filleting the two 2.5 mm halves of the box edge
  that the cone touches tangentially exits with 139 (3 of 3, also at r = 0.02); one half
  alone crashed in 1 of 7 runs. Imported part 100 crashes with edges 0 and 1 at 0.15875 (3 of
  3). All-edge fillets crash on 9 of 337 corpus parts and on upstream's
  `revolution_mold.smb`. The faulting solver pointer is non-NULL garbage (0x30, 0x3d), so
  the NULL checks first proposed would not stop it; a stale or freed corner or solver is
  likely. The wasm traps and says "radius may be too large".
- Do: (1) I1 likely removes the trigger for most of the corpus parts: 7 of the 9 crashing
  parts have duplicate vertices, part 100's crashing pair runs between duplicated corners, and
  fillet corners are per vertex object. Nobody has tested a build with shared vertices yet:
  re-run the 9 parts after I1 to confirm. (2) ASan on both reproducers, then kernel patch K4.
  (3) Until then, run fillets of imported bodies isolated (N1). B19 and F8 fix the message.
- Repro:
  ```python
  p = Box(10, 5, 20) - Cone(4, 5, 20)
  sel = p.edges().filter(lambda e: abs(e.center().x - 5) < 1e-6 and abs(e.center().z - 10) < 1e-6)
  p.fillet(sel, 0.1)    # 2 edges of length 2.5: exit 139
  ```

**F3 · P0 · Variable radius with continuity gives a ruled chamfer** · `fillet-variable-blend-is-chamfer` · small · both
- Status (phase 1): done, f1edb4f: ValueError/RangeError for a (start, end) radius with
  continuity (review: only where start and end differ; (2, 2) makes the blend).
- Wrong: `fillet(edges, (start, end), continuity='G1'|'G2'|'G3')` returns the ruled variable
  chamfer, not tangent to its faces, silently; fullness is ignored. The cause lies in the
  kernel's variable-radius plus blend-curve path and is not identified.
- Do: raise ValueError("fillet: a (start, end) radius makes circular rounds only; continuity
  needs a constant radius") in both ports, and document it.
- Repro:
  ```python
  b = Box(40, 30, 20); e = b.edges().parallel_to(Z)[0]
  b.volume - b.fillet(e, (2, 6), continuity='G2').volume   # 173.3333 (the chamfer); without continuity 74.3999
  ```

**F4 · P0 · Chamfer setback follows the edge angle** · `fillet-chamfer-varying-angle-setback` · medium · both
- Status (phase 1): done, f1edb4f: ModelingError when the face angle spreads by more than 1
  degree along an edge (9 samples); fillets keep the midpoint angle (F8).
- Wrong: chamfer computes one radius per edge from the normals at the edge midpoint
  (`shapes.py:2459-2465`). Where a hole or boss meets a tilted or curved face the angle
  changes along the edge, and so does the setback. The fillet size check (`_setback`) uses
  the same shortcut, and the volume check has no bound for ellipse edges.
- Do: now, measure the angle at about 9 points and raise ModelingError when it varies by more
  than about 1 deg. Later, in the fillet wrapper of F8: an `SmBSplineFilletLaw` r(t) =
  L / tan(θ(t)/2) with `SM_FS_VARIABLE_RADIUS` and a linear section (periodic for closed
  edges).
- Repro (probe): plate `Box(60,60,10)` plus `Cylinder(5,60).rotate(Y,30)` standing on it;
  chamfer the ellipse edge by 1. The plate-side setback over 16 samples runs 3.0, 2.77, ...,
  1.0; with an untilted cylinder it is 1.0 everywhere.

**F5 · P0 · (start, end) radii bend on tangent chains and closed edges** · `fillet-variable-law-chains` · small · both
- Status (phase 1): done, f1edb4f: ValueError/RangeError on closed edges and for selected edges
  meeting within 10 degrees of tangent; laws along whole chains are F8's.
- Status (close-out): done, with a known kernel limitation, F (36825f7): a `(start, end)` radius or
  a `{position: radius}` map runs along each tangent run (`ext.round_edges` `chains`, `law_at`,
  `law_radii`; `CreateSequenceOfLaws`, `SmBSplineFilletLaw`), a map also around a single closed
  edge: a box's 5-edge top run with (1, 3) 11795.8763, 1.02 rising linearly to 3.0; a rim with {0:
  1, 0.5: 3} 1, 2, 3, 2, 1. Blocked: varying laws around closed runs of several edges (a 19-face
  open body from every start, also with the edgeuses reordered): `ValueError`.
- Wrong: the law is per edge, and where tangent rounds meet the kernel forces equal radii.
  On a 5-edge open chain with (1, 3) the radius runs [1.07, 2.0, 2.93], [2.46, 1.85, 1.04]
  and, on the arcs, [1.65, 1.99, 1.07]. On a closed rim it rises linearly to 2.90 and snaps
  back to 1 within the last 3% at the seam. Valid, no warning; the docs promise "linearly
  along each edge".
- Do: now, ValueError for a tuple on a closed edge or on edges that meet tangentially.
  Later (F8): chain-spanning laws with `CreateSequenceOfLaws` and `SmBSplineFilletLaw`,
  e.g. `Part.fillet(edges, radius=RadiusLaw(...))`.
- Repro: `c = Cylinder(10, 20); c.fillet(c.edges().top(), (1, 3))` gives a radius of 2.90 at
  t = 0.97 and 1.80 at t = 0.99.

**F6 · P1 · Tangent chains: propagation and the right message** · `fillet-tangent-chain-propagation` · medium · both
- Status (phase 1): done, ace33c7 (lane FO): `propagate=True` (default) for fillet and chamfer,
  `Edge.tangent_chain()` and `ShapeList.tangent_chain()`, radii carried to the added edges, and with
  `propagate=False` a hint naming the run-on vertices. OpenCASCADE's volumes to 1e-12. No pre-check:
  the kernel rounds some edges that run on tangentially at both ends.
- Status (close-out): K2 (2ebcb64): `CreateSmoothEdgeSequence` gives each Edge of a smooth run the
  joined curve as its own, so the curves and the corner caches built on them (`CalcCornerVertGeom`)
  are freed: 189 kB to 0 per fillet of a rounded plate's top run (smlibwasm 153.5 kB to 0). Refused
  and failed fillets free their intersection curves, solver surfaces and fillet Brep (24.5 kB to 45
  B; 348 kB to 16.4 kB, the rest a `MergeInterval` curve copy, blocked).
- Wrong/gap: an edge that runs tangentially into unselected edges at both ends fails at every
  radius with "the radius may be too large": the top edge of a rounded-rectangle plate, one
  straight edge of a slot. Tangent at one end works. `fillet.md:24-27` says both work.
- Do: `propagate=True` grows the selection across G1 vertices (smlibpy's adjacency and
  tangency tests suffice); `ShapeList.chain()` / `Edge.tangent_chain()`. With
  `propagate=False`, a pre-check that names the tangent vertex. Correct `fillet.md`.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| F7 | P2 | `fillet-globalmerge-reset` | SM_API turns global merge on before `SetFilletParameters`, which resets it (`SmApiBrep.cpp` 2069/2071, 2117/2119, 2164/2166, 2319/2321). Not shown that this is why `circular_fillet` is exact near the limit (cube 10, r 4.98: 526.738 against an invalid `fillet_edges`); near-limit `fillet_edges` results differ between runs. | Kernel patch K5, landed only with a before/after run (near-limit cubes, the stepped-block rollover, both suites); then re-check `fillet.md`'s near-limit table. | small | both |
| F8 | P2 | `fillet-error-info` | Every fillet failure says "the radius may be too large"; the executive's `SmFilletErrorInfo` is discarded by SM_API. Whether it names the culprit is unverified. | First the pre-checks (F4, F6) and B19's evidence-based hints (same message). Then `src/cpp/fillet.cpp`, one executive wrapper returning the error info and carrying laws (F4, F5), setbacks and bevels (F10), asymmetric chamfers (F9) and the constant-distance solver `SmConstantDistanceFS` (implemented, not in SM_API). Bind in `js/cpp`. | medium | both |
| F9 | P2 | `fillet-asymmetric-chamfer` | Two-distance and distance-angle chamfers: known open ai/todo/features.md #23. `SmConstantRadiusFS` with a second radius and a linear section gives rails at exactly 4 and 2; circular sections refuse it. Corners unverified. | `Part.chamfer(edges, length, length2=None, *, angle=None, reference_face=None)` through F8. A straight-edge-only version can be composed with a prism cut. | medium | both |
| F12 | P2 (low-value wrong result) | `fuzz-chamfer-circular-accuracy` | Chamfers of circular edges are fitted B-splines with volume errors up to 1.1e-5 (docs say 1e-7 to 4e-6). | Correct `docs/kernel.md` now; exact cones are more than small work. | medium | both |
| F10 | P3 | `fillet-corner-styles` | `k.set_bevel_corners` is bound and unused (mitred corners: valid, 7805.1936 against 7804.6961); setbacks need C++. | `corners='patch'\|'mitre'`, `setback=` through F8; document that setbacks need every edge at the vertex rounded. | medium | both |
| F11 | P3 | `fillet-preview-and-g2-corner-docs` | G2/G3 edge blends are right, but corner patches where three rounds meet are G1 only (`SmApiBrep.h:437-438`); the docs do not say so. `fillet_preview` is bound and unused. | One sentence in `docs/features.md`, `fillet.md` and the docstring; optional `Part.fillet_preview`. | small | both |

Status (phase 1) of the items in the table:

- F7: partial, 90cc398 (lane FO): K5 measured and not landed (no near-limit gain; two chamfers
  became open bodies). The cause of `circular_fillet`'s exactness is the solvers' approximation
  tolerance: fillet and chamfer try again within 1 times the edge tolerance
  (`ext.round_edges(tolerance_factor)`), and cubes 10 (r 4.98), 20 (9.97, 9.98) and 40 (19.96) are
  exact. r 4.99 and the stepped block's rollover still fail.
- F7 (close-out): blocked, F (5076b93): r 4.99 and the rollover fail at every approximation
  tolerance tried (4 to 0.1 times the edge's: a 14-face body with gaps of 3.6), with mitred corners
  and with the edgeuse order that fixed set-back corners; both are refused. W (c10f34c): rounds
  whose setbacks fill more than 90 % of the room between two edges measure the result's gaps (on
  Linux x86_64 the 20 mm cube at 9.97 came back open, 2132.03, and passed).
- F8: done, 90cc398 (lane FO): `ext.round_edges` (src/cpp/fillet.cpp) drives the executive as SM_API
  does (bit-identical bodies) and returns its SmFilletErrorInfo: errors name the corner or edge (37
  of 38 failures of 514 random cases). The executive's status (SmFilStatus) is private.
- F8 (close-out): done, F (36825f7): `ext.round_edges` returns the executive's private status as
  `stage` (read through a pointer to the member), and the errors say the failed step in words.
- F9: done, 90cc398 (lane FO): `chamfer(length2=, angle=, reference=)` through SmConstantRadiusFS's
  second radius; OpenCASCADE's volumes to 1e-12; features.md #23 fixed.
- F9 (close-out): done for straight edges between planes, F (36825f7): where a sharp wedge's
  setbacks differ more than its cosine allows, such an edge with ends on planes at right angles to
  it is bevelled by a prism cut, checked against its triangle times its length (the 60 degree edge
  with 4/1, 6/1 and 8/0.5: exact). Blocked beyond it (curved edges, slanted ends): `ModelingError`.
- F12: done beyond the plan, 6802aa4 (lane FO): full circles between coaxial faces are bevelled by
  a Boolean with the bevel's solid of revolution (exact cones, checked against Pappus), the docs
  corrected. Other edges keep the kernel's fitted bevels. Since the merge the tool's faces are cones
  (S4), and the bevel's edge on a cylinder comes back as a fitted B-spline (8e-6 short on a pin of
  radius 2; the volume stays exact); its edge on a plane is a circle.
- F12 (close-out): done, F (36825f7): `ext.exact_circles` makes the bevel's edge on a cylinder or
  cone, between coaxial cones or cylinders and for a plane across a cone, cylinder or sphere an
  exact circle (it was 8e-6 short). Later: exact bevels of edges that are not full circles.
- F10: partial, 6802aa4 (lane FO): `corners='mitre'` (SetBevel on convex corners of three edges) for
  every round and chamfer. Not done: setbacks; every set-back corner read freed memory
  (MergeInterval), and the fixed copy gave open bodies (patches README).
- F10 (close-out): done, with known kernel limitations, F (36825f7, 912c830): `fillet(setback=)`
  over `ext.round_edges(setback=)`. The kernel merges set-back corners only where each edge lists
  its `SM_OT_SAME` edgeuse first (the kernel's `box.smb` does; `SmApiCreateBox` not at 5 of 12
  edges), so the edgeuses are reordered first (`SmEdge::ResetPrimaryEdgeuse`); `SmCurveClass.cpp`
  patched for the read of freed memory, `SmBSplineSurfaceNLib.cpp` for the N-sided corner patch's
  leak (20.7 kB to 0). A 20 mm cube r 2 setback 3: 7781.609270, valid; 240 random parts: no crash.
  Blocked: corners where a face turns inward (`SmFilletConcaveNxNCorner`), between slanted faces,
  and laws with setbacks: refused.
- F11: partial, 6802aa4 (lane FO): the G1 corner note in docs/features.md, the skill's fillet guide,
  the docstrings and docs/kernel.md. `fillet_preview` not added (crash-prone, would need isolation,
  untrimmed surfaces only).
- F11 (close-out): done, F (36825f7): `Part.fillet_preview` and `filletPreview` over
  `SmApiFilletPreview` (bound by hand in smlibwasm; parts read from files previewed in another
  process); 100 random Boolean parts without a crash.

### O. Shell, offset and direct editing

Goal: shell and offset never kill the process, never return a body that only looks valid,
and fail fast when the kernel cannot do them.

**O1 · P0 · The extended offset mode segfaults at random** · `fuzz-offset-glue-uaf`, `input-corpus-extended-offset-crash`, `offset-issue2-crash`, `infra-guard-result-transfer` · medium · both
- Status (phase 1): partial, 8194dcd (group O): K2 plus two more sites ASan showed
  (`ResolveOverlappingProtoEdges`, `DoExtendedOffset`); shell, offset and thicken run their
  kernel steps only in a forked copy (smlibwasm: the probe worker) and get the body back as
  `.smb`. Issue #2's filleted boxes still crash the kernel now and then (site not located),
  contained by the copy.
- Status (phase 1, follow-up): partial, ace33c7 (lane FO, O1+): two more sites patched, the curves
  of a failed `MakeEdgeInFace` in `SmEdgeDefinition::Imprint` (issue #2's boxes: 0 of 300 processes
  crash, 7 to 27 before) and `SmSurface::CreateNaturalUVTrimCurves` (new copy `SmSurface.cpp`).
  Still crashing, contained by the other process: crescendo part 52 (a half-made edge in
  ImprintIntersections), parts 81 and 19 (BuildPolarBox), and the layout-dependent ASan reports in
  FindInterval and of a deleted ProtoEdge.
- Status (close-out): done, with known kernel limitations, K1 (b8d52ea), K2 (2ebcb64) and W
  (c10f34c): a deleted ProtoEdge leaves every overlap and coincidence list and every ProtoVertex
  list as often as it is listed (`SmProtoTopology.cpp`); the half-made Edge fails the Boolean
  (`SM_ERR_BAD_INTERSECTIONS`) and `CreateUVTrimCurve` refuses it; the polar box takes its tree's
  surface (`SmSurfaceCache.cpp`); `MakeEdgeInFaceWithVU`, `SqueezeEdge`, `DeleteEdge` and `FixGaps`
  leave no freed uses behind. Raw steps: part 52 crashes in 1 of 20 processes (15 before), part 81
  in 3 of 30 (11 of 20), part 19 never; the guard test's steps report in 0 of 48 perturbed ASan
  processes (15 before). Blocked: the rest of parts 81 and 52 (not located) and the `FindInterval`
  overflow (not reproduced), contained by the forked copy.
- Wrong: the extended mode, used by every `offset_brep` and by shell from its third attempt,
  crashes in `SmBrep::GlueVertices` <- `GlueCoincidentBrepVertices` <-
  `ImprintIntersections` <- `ManifoldBoolean` <- `PiecewiseMerge` <- `DoExtendedOffset`, or
  in `SmEdge::CalculateBoundingBox` on the same path. Rates: the L-shaped box below 12 of 30
  runs (7 of 28 in the verifier's rerun); issue #2 on macOS 2 of 10 (R1/t0.5) and 1 of 10
  (R2/t1); shells crash on 5 of 337 corpus STEP parts and 10 of 142 upstream `.smb` parts,
  offsets on 6 of 337 and 2 of 142. It depends on memory layout: ASan and
  ASLR-off runs miss it. Code reading of the patched `SmProtoTopology.cpp` found candidates:
  the deleted-vertex sets are reset per ProtoVertex; the kk loop passes a vertex that
  `SqueezeEdge` already deleted; the inline short-edge path still calls `Destruct()`
  (line 6078; only the batch path was patched, so the patches README overstates the fix). The
  root cause is not confirmed. `defeature._guarded` is a weak guard here: the parent re-runs
  the work (1.3x on a realistic part) and can still hit a layout-dependent use-after-free.
- Do: (1) Isolation (N1): run extended shell, offset and thicken attempts in a child that
  returns the body as `.smb` bytes; the parent never re-runs them. (2) Retry policy (O6).
  (3) Kernel patch K2 after an ASan or libgmalloc loop of the L-box confirms the site; correct
  the patches README about line 6078. (4) A local wall test (O4). (5) Where the rim meets its
  neighbours tangentially, say so ("the kernel cannot open a face whose rim meets its
  neighbours tangentially") instead of "the wall may be thicker".
- Repro:
  ```python
  p = Box(6, 20, 12) + Box(4, 10, 6).translate(1, -5, -6)
  p.shell(2.94, p.faces().filter(lambda f: abs(f.center().z + 9) < 1e-6))   # exit 139 in 25-40% of runs
  (Cone(6, 0, 8).rotate(Y, 90) + Cylinder(4, 12).translate(-6.7843, 0, 0)).offset(6)  # exit 139, 2 of 2
  ```

**O2 · P0 · shell/offset accept bodies whose faces do not meet, or that have no cavity** · `input-corpus-checked-accepts-broken`, `offset-shell-unchanged`, `offset-shell-open-rim` · small · both
- Status (phase 1): done, 8194dcd: gaps >= 1e-3, cavity points classified, closed shells
  against V - V(offset). The plan's 0.5·t·area heuristic refused correct thick shells and was
  not used.
- Status (close-out): R (289ae5b): the box check grants a face that reaches out of the part's box
  the largest tolerance of its edges and vertices, at most 1e-4 of the box's size
  (`SmFace::CalculateTightBoundingBox` takes in surface points within a vertex's tolerance, off the
  face): the deform recipe's twisted vase shells in 12 of 12 runs (5 of 12 were refused).
- Wrong: `_checked` accepts any closed manifold result with the right box and kernel-volume
  sign. On the corpora, 35 of 1018 accepted results were wrong: gaps from 1e-3 to 5.6, open
  meshes, e.g. crescendo part 58 shell with field volumes [6061.47, 943.66, 943.66]. 8 shells
  removed less than 0.1% (no cavity), and the case below returns its input unchanged through
  the equality clause (`shapes.py:2572`). In the guide's rounded-box shell, the inner rounds'
  edges lie 2 mm off their surfaces (gaps 2.694e-01; O3).
- Do: in `_checked` use `result._props(1e-4)` (cached, about the same cost) and reject gaps
  above 1e-3: clean results close to 1e-6..2e-5, and the corpus shows a clean gap between
  the two groups. Shell must remove real volume (e.g. after <= before - 0.5·t·area of the
  faces that are not openings). Offset short-circuits a distance of 0 to a copy before the
  equality clause goes (`offset.md` promises an equal copy). When the attempts run out:
  ModelingError "the kernel built a body whose faces do not meet". Both ports.
- Repro:
  ```python
  (Box(20, 20, 10) - Cylinder(3, 20)).shell(4)   # 3717.2567, 7 faces, valid: the input unchanged
  ```

**O4 · P0 · The shell wall check measures along world axes** · `offset-shell-rotated-wallcheck` · small · both
- Status (phase 1): done, 8194dcd: one ray per face into the part for open shells; closed
  shells checked on the result.
- Wrong: `_check_wall_fits` compares the wall with the world-axis bbox, so rotated,
  imported or angled parts bypass it, and the wrong hollow bodies of ai/todo/features.md
  24/25 (marked fixed) come back. A 10 deg rotation is enough. With an opening,
  `Box(40,30,10).rotate(X,45).shell(10, opening)` segfaulted in 4 of 36 runs (the
  axis-aligned case 0 of 12; it raises ModelingError): EXC_BAD_ACCESS in `SmVertex::GetEdges`
  <- `IsTopologicalVertex` <- `SmMerge::BooleanPostProcess` <- `ManifoldBoolean` <-
  `SmOffsetExecutive::ShellBrep`, a read of freed memory (the pointer slot held the double
  cos 45 deg). Single raw `k.shell_brep` calls never crashed (15 per mode); the crash needs
  `_checked`'s 8 attempts in one process.
- Do: for a closed shell, `inner = offset(-t)` must succeed and the result's volume must be
  V - V(inner) (one extra offset). With openings, raycast inward from sample points on each
  face that is not an opening; the opposite wall must be at least 2t away (t where it is an
  opening). Keep the axis test as a first filter (an oriented box from
  `Part.principal_axes` is a cheap extra one). Reopen 24/25; port to TS. For the crash, O6's
  cap on attempts is the mitigation, and kernel patch K3 targets the site.
- Repro:
  ```python
  Box(40, 30, 10).rotate(X, 45).shell(6)    # valid, 10992.000: two 6 mm walls in a 10 mm part
  Box(40, 30, 10).rotate(X, 45).shell(10)   # valid, 10000.000, 10 faces: a wrong body (input 12000, 6 faces)
  ```

**O5 · P0 · remove_faces of the rounds around a face also removes the face** · `offset-remove-faces-enclosed` · small · both
- Status (phase 1): done, 8194dcd: rounds-only selections go to `remove_fillets`; an enclosed
  face goes only where it or the rim has a sharp edge (keeps a blind hole's floor); `_spill`
  bound for undirected features.
- Wrong: `_complete` (`defeature.py:403-420`) adds every face whose neighbours are all
  selected, so the top face of a box with rounded top edges joins the "feature". The result
  is valid and 20% smaller. Chamfers around a face cannot be removed at all.
- Do: send all-fillet selections to `remove_fillets`. In `_complete`, add an enclosed face
  only when the selection's outer rim (its edges to unselected faces) has non-smooth edges.
  For `_feature_kind == 0`, bound the volume change and require that the box does not shrink.
  Port to `defeature.ts`. Not the "shared edges must be sharp" rule (see Not planned).
- Repro:
  ```python
  b = Box(20, 20, 10); b = b.fillet(b.edges().top(), 2)      # 3934.3954, 10 faces
  b.remove_faces(b.faces().fillets()).volume                 # 3200.0, top at z=3; remove_fillets gives 4000.0
  ```

**O6 · P0 · shell/offset retries never help; failed extended attempts leak** · `input-corpus-retry-policy`, `wasmbind-failed-shell-leak` · small · both
- Status (phase 1): done, 8194dcd: plain, extended, and one repeat only after a refused result;
  no repeat after an error, crash or timeout. K12 is in (hygiene; its path never ran); the 2 MB
  per attempt was not seen.
- Status (close-out): K2 (2ebcb64): a failed extended shell frees the offset body (`ShellBrep`), the
  trim curves of a failed extension (`ExtendTrimEdges`) and `MergeEdge`'s curve copy: three raw
  extended shells of filleted boxes 879 kB to 128 B (smlibwasm 437 kB to 163 B).
- Wrong: shell tries [plain, plain, extended x6] and offset 8 times. Over 420 corpus runs no
  offset retry ever succeeded, and of the shells only the first extended attempt did.
  Failures cost up to 115 s natively and 176 s in the wasm (on the main thread). In the wasm,
  failed extended attempts retain about 2 MB in roughly half the attempts (layout-dependent;
  1.3 KB per call natively). One raw attempt in 8 traps ("function signature mismatch"),
  the same memory-safety defect as O1, and `_checked` keeps retrying on the damaged heap.
- Do: shell: plain once, extended at most twice. Offset: one attempt, plus one retry only
  after a rejected result, never after SM_ERR. Stop after a trap or after two identical
  statuses; add a wall-clock budget. Update `docs/kernel.md:95` ("offset can take a few
  attempts"). Kernel patch K12 (free `pBrepShell` on failure exits) as hygiene; pin the rest
  with LeakSanitizer, since the patch alone is unproven.
- Repro (wasm): `const b = Box(20, 20, 20); const f = b.fillet(b.edges(), 2);
  f.shell(1, f.faces().top())` raises KernelError after about 640 ms and retains about 5.3 MB
  per call.

**O3 · P1 · Shell openings whose rim meets its neighbours tangentially** · `offset-shell-open-rim` · medium · both
- Status (phase 1): done for planar openings, 90cc398 (lane FO): such openings are shelled closed
  and the cavity's face under each opening is cut out through the wall, checked to take exactly the
  wall; their other rim edges must meet walls at right angles to them (outward: the whole rim
  tangent). Not done: curved openings, openings next to another or to a drafted wall, K12's
  tangent-sector cap.
- Status (close-out): done next to an ordinary opening, F (36825f7): the cavity face reaches that
  opening's plane before the prism cut (a box rounded on its vertical and bottom edges, open at the
  top and +x: 9869.8523). Later: curved openings, next to a drafted wall, two that meet.
- Wrong/gap: a shell with a planar opening whose rim is tangent to its neighbours (every
  rounded enclosure, tray or cup; the guide's own example) leaves the rim open. The inner
  rounds run up to the outer edge, edges lie off their faces, the mesh is 8-11% off (10199.96
  against 11134.39), and every measure warns. A side opening reports a wrong `Part.volume`
  (14134.39 against 13534.39) with only a warning. With O2 these are rejected; this item makes
  them succeed.
- Do: for such openings, or as the fallback: `closed = self.shell(t)` without openings, then
  cut the opening's prism outward from the matching inner face. It is exact on every probed
  case and costs one closed shell plus one Boolean. It is right only where the inner offsets
  end at the inner face (G1 rims or vertical walls; drafted walls leave a sliver), so restrict
  it to smooth rims. Optional, unverified: kernel patch K12's
  tangent-sector change. Fix the guide example in `shell.md` (it also raised KernelError in 1
  of about 25 runs).
- Repro: `b = Box(60, 40, 20); b = b.fillet(b.edges(), 5); b.shell(2, b.faces().planar().top())`
  gives valid, 50 faces, 11134.3949, gaps 2.694e-01.

**O7 · P1 · Offset sheets and faces** · `offset-sheet-offset`, `surface-sheet-offset` · small · both
- Status (phase 1): done, 90cc398 (lane FO): `Shell.offset`, `Face.offset` and `offset()` of sheets
  and faces in the other process, checked by the distance of every face (in place of the bbox
  bound); `thicken(..., both=)`. Sheets whose faces share no edges offset face by face.
- Status (close-out): done, F (36825f7): faces that touch along edges they do not share are sewn
  first (within 1e-7 of the size, where no face turns): an open box of five separate faces offset by
  -1 gives 1692.0.
- Gap: Shell has no offset (`offset(sheet, 2)` raises AttributeError, and TypeError in the
  wasm), and `operations.thicken` lacks `both=`. `k.offset_brep` works on sheets with its
  default flags: a single face gives an exact offset surface (distance 2.0 at every sample),
  and a 5-face open cup at -1 gives 1692.0. With `extended_offset=False,
  self_intersection=False` it returns a multi-face sheet's faces unmoved and unsewn.
- Do: `Shell.offset(d)` and `Face.offset(d) -> Shell` with the default flags, plus distance
  and bbox checks; `operations.offset` accepts Shell; add `both=` to `operations.thicken`
  (Python and TS). `offset_brep` is already bound in the wasm.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| O8 | P2 | `offset-acute-bbox` | `offset(+d)` rejects exact sharp offsets of parts with acute convex edges: `Cone(5,2,10).offset(1)` (kernel 819.13424 = analytic) and a tapered extrusion raise. | Bound the bbox growth by d / sin(α_min/2), or check only the lower bound plus the volume; suggest `corners='round'` (O9) where sharp mode fails (wedges). | small | both |
| O9 | P2 | `offset-rounded-mode` | `Part.offset` is always sharp; the kernel's rounded mode is bound and exact (Steiner: 2610.50144 for a 10 mm cube grown by 2) and survives the wedge. `operations.ts:370` drops options for Parts. | `offset(d, corners='sharp'\|'round')` mapping to `extended_offset`; fix the TS options; document that inward rounding rounds only concave edges. | small | both |
| O10 | P2 | `offset-direct-edit` | No move/offset/resize of faces. `SmBrep::LocalOperation` (used only by draft) does them exactly when the new surface keeps the face's parameterization: box top +5 gives 1500.0; hole r3 to r5 gives 3214.604017; per-face shell 7840.0, gaps 1e-14. Partly reachable with `remove_faces` plus a Boolean. | Generalise `face_draft.cpp`'s `draft_impl` into `local_edit(brep, faces, maps)`: `Part.move_faces`, `Part.offset_faces` (push-pull, hole and boss resize, tangent chains together), `shell(thickness={faces: t2})`. Bind in `js/cpp`. | large | both |
| O11 | P3 | `offset-two-sided-draft` | A two-sided draft about a planar parting line is exact today with split + draft each half + fuse (23273.6153, analytic). Only stepped parting lines need per-face neutral planes. | Add the recipe to `draft.md`. | small | both |
| O12 | P3 | `fuzz-shell-mode-shape` | The plain mode gives rounded inner blends, the extended mode sharp corners; which one a user gets depends on which succeeds (274.643 against 275.8722 on one body). | Document it, or `shell(corners=...)` that picks the mode and fails instead of switching; report the mode in `info()`. Goes with O6. | small | both |

Status (phase 1) of the items in the table:

- O8: done, 6802aa4 (lane FO): a sharp result is bounded by the first-order reach of the part's
  edges and corners; the sharp mode's error suggests `corners='round'`.
- O9: done, 6802aa4 (lane FO): `offset(d, corners='sharp'|'round')`, the TS options fixed; Steiner's
  2610.50144.
- O9 (close-out): later: `Shell.offset(corners=)` (the kernel's rounded mode returns inward offsets
  of sheets unchanged).
- O10: done, 9757bdf (lane FO): `face_edit.edit_faces` (src/cpp/face_edit.cpp over LocalOperation,
  exact circles restored), `move_faces`, `offset_faces`, `shell(walls=)`. Parts with cavities are
  refused (LocalOperation drops inner shells); extended rounds can come back as extrusions.
- O10 (close-out): done, F (36825f7): parts with cavities are edited, and drafted, outside and
  cavity apart, the cavities cut out again and checked (a box with a cavity: top +2 25400, the
  cavity's top +1 23100); extended faces get their cylinder or cone back where they lie on it (four
  cylinders r 3; a cone hole 13694.272626297588, exact). Later: edits that change which faces meet.
- O11: done, 9757bdf (lane FO): the recipe in docs/features.md and the skill's draft guide
  (23273.6153, exact). No per-face neutral planes.
- O11 (close-out): later: per-face neutral planes for stepped parting lines.
- O12: done, 9757bdf (lane FO): `shell(corners=None|'round'|'sharp')`, `info()['corners']`.

### S. Sweeps, lofts, extrusions and primitives

Goal: sweeps put the profile where the docs say, keep its attitude, and give analytic faces
wherever the geometry is analytic.

**S1 · P0 · Non-planar multi-edge sweeps turn the profile at joints** · `sweep-3d-path-joints-and-closed` · medium · both
- Status (phase 1): done, de5795c (group SCUMA): tangent edges joined (`ext.join_curves`),
  frames carried across corners (read off a swept ribbon along twisted pieces), closed
  non-planar paths swept once and stitched. Review: open profiles along a closed edge are swept
  in one go again (they were halved and refused). Review: paths are tested for planarity at 18
  points per edge (symmetric 3D loops closed with a kink lay in a plane at the 5 points before
  and went to the planar-path sweep: ModelingError); open paths whose joined sweep fails (circles
  along 19 of 31 random 3D fillet polylines) go edge by edge, turned afresh, with a warning unless
  the profile is round. Kinked closures still raise for other loops than before (circles along 12
  of 60 random loops that swept; 9 sweeps that raised go now); the old way as a fallback crashed
  the kernel's Boolean on 4 of the 60.
- Status (phase 1, follow-up): done, ae96cce (lane S): the regressions are fixed: round profiles
  along closed paths of tangent edges sweep in one go (60 of 60), kinked loops go the 0.4 way, with
  turned seams or other split points where the carried one fails (60 of 60 random loops; 0.4: 37),
  fused sweeps are cleaned of faces without area (`ext.remove_slivers`) and checked, and
  `SmMerge::ManifoldBoolean` is patched.
- Status (close-out): blocked for 4 of 60 hard kinked loops, S (34ab364): which fallback goes
  depends on rounding in the kernel's fuse; 12 more retries got 2 more loops through in both builds,
  and a native build without FMA differs on 4 others. With K1's `SmProtoTopology.cpp` patch the two
  loops that crashed natively now and then (ASan: `UpdateFaces`) are clean, and so is the Linux
  x86_64 crash of the second kinked loop (W). A failing loop raises.
- Status (verification): since the profile meets itself where a kinked loop closes (S3), the two
  caps there share the profile's points on the axis of the turn, and the fuse leaves a face whose
  loop touches itself at such a point in 57 of 63 rectangle sweeps. OpenCASCADE took one of them for
  invalid (kinked loop 44: `BRepCheck_NotClosed`, its wire explorer turns the wrong way at that
  vertex), from STEP and from `.brep`; one rectangle had a vertex 1.1e-5 from its edge (tolerance
  5e-6). The STEP and `.brep` writers write such a loop as the loops between (the readers join them
  again), the `.brep` writer leaves out an edge a loop runs along and straight back (a strut: the
  `.brep` files of circles round 3 of 60 loops in each build were invalid), and fused sweeps take
  gaps up to 1e-4 of their size into their tolerances (`ext.update_tolerances`): all 126 sample
  bodies (60 kinked loops and the plan's three, with a circle and a rectangle) and the 240 fillet
  polyline sweeps read into OpenCASCADE as valid solids of their volume from STEP and `.brep` (in
  smlibwasm all but the STEP file of the circle round loop 1, under known limitations), and the
  rectangles but one (loop 54, a vertex tolerance the fuse set, as before) pass the strict check.
- Wrong: each piece is re-oriented by the smallest rotation from the sketch normal to that
  edge's start tangent (`operations.py:209-218, 262, 293-294`), not by carrying the frame
  along the path. A non-round profile turns by up to 90 deg at a joint; the body stays valid
  with volume = area x length, and a section through the joint fails. Closed paths turn
  about 10 deg at the halves' joint and 44 deg at the closure (asymmetric periodic spline).
  Smooth closed paths give exact volumes for circles; only a kinked closure
  (`Spline(*pts, pts[0])`) makes the fuse fail.
- Do: (a) join G1 chains into one B-spline (`ext.join_curves`, C6) and sweep once. (b) At G0
  corners in 3D, carry the frame (rotate the previous end frame by the tangent change).
  Stitching uncapped pieces closes only at G1 joints; G0 corners still need a fuse or a
  mitre. (c) Closed non-planar edges: sweep once uncapped and stitch the end loops; non-round
  profiles need the closing twist spread along the path (S3). Port to `operations.ts`.
- Repro: `sweep(Rectangle(4, 2), FilletPolyline((0,0,0), (0,0,40), (40,0,40), (40,40,40),
  radius=8))` is valid (905.062 = area x length), but the profile turns 90 deg at the last
  arc-line joint (end cap 4 x 2 in x,z where the carried frame gives 2 x 4), and a section at
  that joint raises SM_ERR.

**S2 · P0 · Sweeps anchor asymmetric profiles off the path** · `sweep-profile-anchor-world-bbox` · small · both
- Status (phase 1): partial, de5795c: profiles swept in their own frame on single edges and 3D
  paths; planar mitered multi-edge paths keep the kernel's anchor (changing it changes their
  roll: needs a decision); no `anchor=` option.
- Status (phase 1, follow-up): done but the optional `anchor=`, ae96cce (lane S): mitered planar
  paths are swept in a frame of their own and moved onto the profile's own box center (offset
  curves; a warning where a spline has none).
- Status (close-out): done, S (34ab364): `sweep(anchor='center'|'origin'|point|Vertex)` on every
  route; kernel patch `smlibpy_SetSweepProfileReference` (`SmPrimitiveCreation.cpp`, through
  `ext.curve_sweep(reference=)` and the new `ext.planar_path_sweep`) puts the given point on the
  path, not the middle of the control points' box: an 80-degree sector sat 0.0211 to 0.075 off, now
  exact; mitered paths with splines sit by their own box, without the warning.
- Wrong: the kernel anchors the profile at the centre of the world-axis bbox of the
  already-turned profile. On oblique and helical paths, asymmetric profiles (triangles, L and
  T sections, thread teeth) shift by an amount that depends on the path direction; paths
  along X, Y or Z are right. This contradicts `sweep.md`.
- Do: sweep in the profile's own frame: map the path by the inverse of the orienting
  rotation, sweep, transform back with `ext.transform_brep`. Optional
  `anchor='center'|'origin'|point`. Port to TS.
- Repro: `sweep(Polygon((0,0), (10,0), (0,10)), Line((0,0,0), (10,10,10)))` starts 1.6667 mm
  before the path start, along the path (wasm the same).

**S5 · P0 · loft of single open curves ignores ruled= and smooth=** · `surface-loft-open-ignores-ruled` · small · both
- Status (phase 1): done, de5795c: open sections through `create_skin_primitive` with the
  degree of `ruled`/`smooth`.
- Wrong: when every open section is one edge, loft calls `k.create_skin_surface` and never
  reads `ruled` or `smooth` (`operations.py:157-166`, TS the same).
  `k.create_skin_primitive` with degree min(3, n-1) reproduces today's default exactly for
  3, 4 and 5 line sections and 4 spline sections.
- Do: route single-edge open sections through `k.create_skin_primitive([1]*n, curves,
  degree, False)`; no default result changes.
- Repro (probe): three straight lines at z = 0, 10 (shifted 8 in y) and 20; `loft(...,
  ruled=True)` passes through y = 6.0 at z = 5 instead of 4.0, the same as the default (area
  266.7411); the wasm too.

**S3 · P1 · Sweep orientation control (helix roll, twist)** · `sweep-frame-orientation` · large · both
- Status (phase 1): done, 9f7c692, with fixes in e969994 (lane S): `ext.oriented_sweep` gives NLib's
  sweep the profile's x axis (curZ) and a section for every 1/64 turn; `sweep(up=, twist=)`, the
  helix axis (`ext.helix_axis`) by default along helices. The #10 section is 2.0001 x 1.0039. Not
  done: an option for the kernel's rolling frame, frenet on straight pieces, a twist along closed
  paths with corners.
- Status (close-out): done, S (34ab364): the turn a profile gains round a non-planar loop with
  corners is spread along the length (it jumped 8.5064, 5.7148 and 29.7502 degrees at the closing
  corner; now the shares match the lengths to 1e-4 degrees), with split fallbacks and a warning;
  `up='frenet'` where the profile would spin raises a clear `ValueError` after 8 doublings. Later: a
  named rolling-frame mode, the helix default for near-helices.
- Gap: along a helix the profile rolls about 30 deg per turn (ai/todo/features.md #10,
  open). NLib's `N_CreateSweepScale` takes `curZ`, the local Z vector at every path point,
  but its only caller (`SmBSplineSurfaceNLib.cpp:5821-5832`) passes NULL. The loft workaround
  in `sweep.md` is exact to 0.01% but heavy.
- Do: either a kernel route (an orientation curve in `SmSweepOptions`, passed down to
  `N_CreateSweepScale`) or `ext.oriented_sweep` in `src/cpp`, which copies
  `CreateCurveSweep`'s setup (about 150 lines). Build curZ perpendicular to the tangent:
  `up=axis`, `'frenet'`, or `twist=` as a law. Default for helix paths: the helix axis. Test:
  the #10 section stays 2 x 1.

**S4 · P1 · Full revolves give surfaces of revolution, not cylinders** · `sweep-revolve-360-not-analytic` · medium · both
- Status (phase 1): done, 9f7c692 (lane S): `ext.analytic_revolutions` (cones, cylinders and spheres
  by the kernel's own tests, tori from the generating arc), a whole turn within 0.01 deg,
  `Face.axis` of surfaces of revolution in both builds, types.md fixed; 150 random lathe profiles
  keep volume, validity and face count. Spline generators and spindle-torus arcs stay surfaces of
  revolution.
- Gap: at 360 deg the kernel takes a branch that skips `CopyAndAddAnalytics`
  (`SmPrimitiveCreation.cpp:2866-2873`), so multi-edge profiles revolve into
  SURFACE_OF_REVOLUTION faces, while 90, 180 and 359 deg give cylinders. `faces().cylinders()`
  is empty, `Face.radius` and `Face.axis` raise (`surface_info` has no case for it), draft
  refuses, and STEP writes rational B-splines (7039 against 4106 bytes) that re-import as
  B-splines. Volumes are exact. Partial revolves of arcs never give tori
  (`IsNurbSurfaceTorus` is commented out). Angles in [359.999, 359.99999) fail with a
  misleading hint. `selection/types.md:23` misstates where "revolution" faces come from.
- Do: `ext.analytic_revolutions(brep)` after `Sketch.revolve` and the open-curve revolve,
  for 360 deg and for partial arcs: a generator line parallel to the axis becomes SmCylinder,
  an oblique line SmCone, an arc centred on the axis SmSphere, an arc off the axis SmTorus,
  with the frame's x axis through the seam vertex as `step_build.cpp` does, then
  `ReplaceSurface`. Add a SmSurfOfRevolution case to `Face.axis` in both builds; snap
  |angle - 360| < 1e-3 to 360; fix `types.md`. Tests: the revolved tube has 2 cylinders and
  radius 10, draft works, STEP has CYLINDRICAL_SURFACE.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| S6 | P2 | `curve-planar-path-aliasing` | `_is_planar_path` samples t = 0, .25, .5, .75, 1, so chained helices with an even number of whole turns per piece (the documented long-helix workaround) count as planar. Sweep then takes the mitre route and non-round profiles fail with a misleading "corners" error; round profiles still come out right. The mitre route also has no fallback: arcs meeting at a kink fail even with `Circle(1)`, while `sharp_corners=False` works. | Planarity from control points (`Curve.is_planar` is bound, or `_coplanar` on the poles) in both ports; on ModelingError from `sweep_along_planar_path` with `sharp_corners` defaulted, fall back to per-edge sweeps and say so. Regression: the `Helix.md` chain with a Rectangle. | small | both |
| S7 | P2 | `sweep-scale-law` | `ext.curve_sweep` already takes `scale_reference`/`scale_curve` (both builds); `sweep()` passes None. Verified: a frustum 1466.0801 against 1466.0766; a tapered spring close to analytic. | `sweep(..., scale=(s0, s1) \| [(t, s)] \| callable)`: build the reference line and law curve (law starts at 1), pre-scale the profile, sample by arc length. No binding. | small | both |
| S8 | P2 | `sweep-line-arc-bspline` | Single-edge sweeps along a line or arc give B-spline faces where extrude and revolve give planes and cylinders; the result type depends on how the path was split. | Line paths -> `extrude(direction=...)`; arc paths -> partial revolve of the oriented sketch (planes and cylinders; circular profiles stay "revolution" until S4 converts arcs to tori). Adds the axis-crossing check features #13 lacks. | small | both |
| S9 | P2 | `sweep-taper-outward-slivers`, `offset-taper-walls-undraftable` | Tapered extrusions never give plane walls: inward tapers give flat B-spline walls, outward tapers planes plus 2 B-spline slivers per corner (14 faces). Draft refuses the walls (`face_draft.cpp` asks `IsPlanar(1e-7)`; `Face.is_planar` tests poles), contrary to `draft.md:38-39`; STEP writes NURBS. | Extrude straight and `Part.draft` the side walls for every taper: identical volumes, exact planes, cylinders and cones for convex, concave and holed profiles (e.g. 9869.58064, 8183.09063). Keep `draft_sweep` as fallback; `corners='round'` via `draft_sweep(fillet_corners=True)`; let `face_draft` accept planar B-splines by the pole test. | small | both |
| S10 | P2 | `sweep-loft-rails-tangency`, `surface-rails-and-tangent-loft` | No rails, spine, end tangency, closed lofts or two-rail sweeps. Corrected scope: `CreateSkinnedSurface`'s rails are side-boundary curves (open-section skins and 2-rail sweeps, not guides for closed solids); a closed loft needs `N_CreateSkinSrf` directly; end tangency is dropped silently when the kernel retries without derivatives; the two-rail `CreateSweepSurface` misses its rails by 2.3e-2 with 4 points between profiles and 1.1e-3 with 40. | `ext.skin(sections, rails, start/end tangent faces)` and `ext.rail_sweep` that raises the point count until the rails fit (or reports the deviation); `loft(rails=, start_tangent=, end_tangent=)`, `sweep(rails=)`; verify tangency afterwards; the guards of U4. | large | both |
| S11 | P2 (low-value leak) | `sweep-curve-copy-leaks` | SM_API copies sweep inputs and Curve is bound `py::nodelete`, so revolve, loft, open extrude, taper and the planar-path sweep leak their copied curves (1500 revolves: +3.64 MB); the wasm heap never shrinks. | An owning `CurveHandle` variant of `Wire._copy_curves`, or try/finally deletes at `operations.py:82/86, 105, 134, 170, 281` and `shapes.py:3270, 3285, 3319, 3321`, and the TS twins. | small | both |
| S12 | P3 | `sweep-swung-primitive` | `k.create_swung_primitive` is exact (Ellipse(30,20) outline: 75398.2237 = π·30·20·40) and unused; not bound in wasm. | `swing(profile, outline)`; bind in `bind_kernel_creation.cpp`. | small | both |
| S13 | P3 | `sweep-partial-primitives` | Partial cylinder, cone, sphere and torus, cylindrical box and pyramid are bound and exact but not offered; a partial cylinder is already reachable by revolve. | `angle=`/`arc_size=` options and `AnnularSector`; bind in wasm. | small | both |
| S14 | P3 | `sweep-extrude-direction-in-plane` | A direction in the sketch plane gives a bare KernelError; 1e-4 off the plane gives a valid 0.0005 mm body. | ValueError when \|d·n\| < 1e-9·\|d\|; warn below 1e-3. | small | both |

Status (phase 1) of the items in the table:

- S6: done, 9f7c692 (lane S): planarity from control points; a mitre failure goes piece by piece
  with a warning.
- S7: done, e969994 (lane S): `sweep(scale=)` (pairs, points with a monotone cubic, functions)
  through the kernel's scale curves or `ext.oriented_sweep(scales=)`; the frustum 1466.07658 (exact
  1466.07657).
- S7 (close-out): done, S (34ab364): the scale curve's points are doubled up to 257 while it is more
  than 1e-7 off the law (radius within 1.3e-6, was 1.2e-3). Later: mitered planar paths with `up`,
  `twist` or `scale`.
- S8: done, e969994 (lane S): single lines as extrusions, single arcs as revolves, with the
  axis-crossing check (features #13 for single arcs).
- S8 (close-out): done, S (34ab364): new `ext.planar_faces` turns the flat B-spline walls of oblique
  extrusions into planes; `extrude(taper=, direction=)` across the normal and a taper of an open
  curve raise `ValueError` (they were ignored). Later: analytic walls of translational arc sweeps.
- S9: done, e969994 (lane S): straight extrusion and `Part.draft` where the volumes agree,
  `corners='round'`, flat B-spline faces drafted, the hole-widening check.
- S10: partial, e969994 (lane S): `loft(start_tangent=, end_tangent=, closed=)` over `ext.skin`,
  tangency measured. Not done: rails, spine and `sweep(rails=)`; the skin's rails need a section per
  rail control point, and the two-rail sweep approximates its rails (0.31 off with 4 points, 1.6e-4
  with 1024).
- S10 (close-out): done for open sections and profiles, S (34ab364, 2315ce7): `loft(rails=)` and
  `sweep(rails=)` through Gordon surfaces (new `ext.gordon` on `N_CreateGordonSrf`, the network made
  compatible within 1e-8), rails and sections within 1e-7; `start_tangent` and `end_tangent` take a
  face (`ext.skin(start_face=, end_face=)`). Later: a spine, closed sections or profiles along rails
  (a 22 degree crease).
- S11: done, e969994 (lane S, `_freed` at every copy site) and 6a10005 (lane WN, the sweeps, skins
  and offset profiles).
- S11 (close-out): K2 (2ebcb64): the kernel's mitered planar sweep frees its temporary curves,
  extensions, cutting lines and failed segments (12.7 kB to 0 a sweep, smlibwasm 10.5 kB to 0), and
  `CreateCone` its apex's iso curve (72 B a pointed cone).
- S12: done, e6a8a48 (lane S): `swing()` over its own `ext.swung` (N_CreateSwungSrf with the scale
  measured at +X); `create_swung_primitive` picks the wrong side and divides by 0, so it is not
  used.
- S12 (close-out): later: analytic faces and other axes for `swing`.
- S13: done, e6a8a48 (lane S): `arc_size`, `arc_size1/2/3`, `major_angle`, `AnnularSector`; the
  partial primitives bound in the wasm. Not done: a torus' minor angles, Pyramid.
- S13 (close-out): done, S (34ab364): `Torus(minor_start_angle=, minor_end_angle=)` (the half torus
  4934.802201, exact) and `Pyramid(l, w, h, align=)`.
- S14: done, e6a8a48 (lane S): ValueError below a sine of 1e-5 (the kernel's own limit, not 1e-9), a
  warning below 1e-3, and oblique extrusions checked and made again turned.
- S14 (close-out): done, S (34ab364): where the turned extrusions fail, the profile is swept along
  the line and checked against the volume: 7200 of 7200 valid with the exact volume (16 of 1200 per
  angle raised).

### C. Curves

Goal: curves can be cut, joined, extended, offset, fitted and measured, with tolerances that
scale with the model.

**C1 · P0 · 2D & and - are wrong for faces that touch at vertices** · `curve-2d-boolean-multiface` · small · both
- Status (phase 1): done, de5795c: face-by-face Booleans checked by area and first moments
  against an OpenCASCADE oracle (560 random results: 230 wrong before, 0 after); the kernel's
  xor is never run on touching operands. Review: the check's tolerance comes from the operands'
  area (it came from the loose box of the faces' planes, and passed a sliver for a unit square
  1000 from another), and faces that cannot be measured raise the contact error.
- Status (phase 1, follow-up): done, 97384e9 (lane C): the crash of xor unions located in
  `SmPrimitiveCreation::Boolean2D` (a wire edge's missing face) and patched to fail with
  SM_ERR_BAD_INTERSECTIONS; 24 of 24 runs right. Not done: why the intersection leaves the wire
  edge; the far-apart lattice sliver.
- Status (close-out): done, K1 (ffb80d9): `Sketch._boolean2d_apart` runs groups of faces near each
  other alone where the whole spans more than ten times the largest group (the kernel takes its
  planar tolerances from the operands' extent): 60 of 60 random lattices right in both builds (9 and
  12 slivers, 46 and 43 errors before).
- Wrong: `boolean_2d` misclassifies a face of the left operand that the tool's boundary does
  not cross, when that face touches the operand's other faces at vertices (as xor results
  do). The wasm gives different wrong values (54.9061 and 55.6337). The order matters
  (`t & abc` is right). Area identities cannot detect it: the lost area always lands in the
  complementary result. Disjoint multi-face sketches (lettering, islands) are right. This
  extends the open ai/todo/sketches.md #20.
- Do: when `self` has more than one face, run & and - face by face and combine the pieces
  (the faces are disjoint), and xor as (a - b) + (b - a), in `shapes.py` and `shapes.ts`.
  Put this case and the known xor divergence (Python 702.18, wasm 67.09, right 689.46) into
  the parity tests (N5).
- Repro:
  ```python
  abc = Circle(5) ^ Circle(5).translate(4, 0) ^ Circle(5).translate(2, 4)
  t = Polygon((-20, -20), (20, -20), (0, 20))
  (abc & t).area, (abc - t).area      # 86.6355, 23.9044; right 110.5398, 0
  ```

**C2 · P1 · Trim, split and locate points on edges** · `curve-split-trim` · small · both
- Status (phase 1): done, 97384e9 (lane C): `Edge.trim`, `split`, `param_at`, `closest_point`,
  `Wire.trim`, `split`, pieces keeping their curves (`ext.trimmed_curve`); A2's
  `Edge.param_at_point` delegates to `param_at`.
- Gap: Edge has no trim, split, `param_at` or `closest_point`, and `distance_to` drops the
  parameter that `k.curve_closest_point` returns. `ext.trimmed_curve` is bound in both builds:
  a trimmed circle stays an exact circle, and a spline split at an intersection rejoins to
  3.6e-15.
- Do: `Edge.trim(t0, t1)`, `Edge.split(at)` (fraction or point), `Edge.param_at(point)`,
  `Edge.closest_point(point)`, `Wire.split`/`Wire.trim`; arc-length fractions as in
  `point_at`; TS twins. No new C++. `Edge.closest_point`/`param_at` are shared with A2.

**C3 · P1 · Ellipse curves reach Python untyped** · `curve-ellipse-binding-type` · small · Python
- Status (phase 1): done, 97384e9 (lane C): Ellipse, Parabola and Hyperbola registered as
  BSplineCurve subclasses (src/cpp/curve_tools.cpp); the gotchas are gone from the guides.
- Wrong: SmPyLib registers BSplineCurve, Line and Circle but not SmEllipse, SmParabola or
  SmHyperbola (`SmPyTypes.cpp:1182-1184`). pybind11 hands ellipses to Python as `Curve`, and
  every binding typed `SmBSplineCurve*` raises TypeError: `Part.project`, sweep along an
  ellipse, `ruled()` with an ellipse edge, open-profile surface sweeps,
  `sweep(sharp_corners=False)` along a path with an ellipse, `k.offset_curve`,
  `k.convert_to_lines_and_arcs`. This includes ellipse edges taken from bodies. The wasm
  works: project gives 2 edges of 39.6632, sweep 498.4275, ruled 396.636. ai/todo/curves.md
  #13.
- Do: register `py::class_<SmEllipse, SmBSplineCurve, ...>("Ellipse")`, plus Parabola and
  Hyperbola, in `src/cpp/module.cpp` after `bind_types`; drop the gotcha from `Helix.md` and
  `generic.md`.

**C4 · P1 · Helix turn limit** · `curve-helix-limit`, `infra-helix-ccplim` · small · both
- Status (phase 1): done, 97384e9 (lane C): `NL_CCPLIM = 2^20` at init in both modules, and above
  120 turns pieces of 100 turns joined into one edge (200 turns: radius within 7.8e-5). Sweeps along
  helices keep their own limit (about 60 turns).
- Status (close-out): done, S (34ab364): sweeps with the kernel's frame (`orient=False`) along more
  than about 60 turns go in 2, 4 or 8 pieces: 80 turns valid within 8.6e-5, 100 and 150 within 4e-6.
- Gap: helices above about 26-79 turns fail (ai/todo/curves.md #15). Cause: NLib's mutable
  global `NL_CCPLIM = 1000` caps the spiral fit (`NL_Spiral.cpp:128`). `SmApiCreateHelix`
  also has a hard cap of 124.25 turns and its own dense 3D tolerance check. With
  `NL_CCPLIM = 1 << 20`, every case up to 124 turns succeeds within that check (80 turns:
  10054.349 against 10054.370 analytic; 124 turns at r 50: 7939 poles in 2.7 ms). A scaled
  tolerance alone does not help (50 turns at r 20 already need 997 poles at 1e-3).
- Do: set `NL_CCPLIM` once at init in `src/cpp/module.cpp` and `js/cpp/module.cpp`. Above
  124.25 turns, split into whole-turn pieces joined by `SmBSplineCurve::CreateByJoining`
  (already used in `step_build.cpp:213`) into one Edge. Update `Helix.md` (no manual
  chaining) and add a 200-turn helix test. Sweeps along long helices have a separate limit
  (60 turns work, 100 fail).

**C5 · P1 · Curve intersections with a fixed 0.001 mm tolerance** · `curve-intersections` · medium · both
- Status (phase 1): done, 97384e9 (lane C): `ext.intersect_curves`, `self_intersections` and
  `intersect_curve_faces` (GlobalCurveIntersect, overlaps as ranges); `Edge.intersections(...,
  tolerance=)` with edges, wires, faces and bodies, `intersection_params`, `Wire.intersections`,
  `Edge.self_intersections`; selection.md #3 and #11 fixed.
- Wrong/gap: `Edge.intersections` goes through `SmApiIntersectCurves` with a fixed absolute
  tolerance of 0.001 and SM_ERR on no solution. Skew lines 0.0005 apart are reported as
  crossing; on a 0.01 mm part, parallel lines "intersect"; overlapping collinear segments
  give one point; no hit raises (ai/todo/selection.md #3); seams are reported twice (#11);
  no parameters are returned. `edge.intersections(edge)` silently returns self-crossings.
  Curve x sheet/body points (`k.intersect_curve_brep/face`) are bound but not public. P1, not
  P0: the false crossings need gaps below the fixed 0.001 mm (near-misses or tiny parts) or an
  edge intersected with itself.
- Do: `ext.intersect_curves(a, b, tol)` on `SmCurve::GlobalCurveIntersect` with a
  size-relative tolerance: [] on no solution, duplicates merged, overlaps as ranges.
  `Edge.intersections(Edge | Wire | Face | Part, tolerance=)`, `Edge.intersection_params`,
  `Wire.intersections`; faces and bodies through `intersect_curve_face/brep` (SM_ERR on a
  miss becomes []). Optional `Edge.self_intersections()`. Bind in `js/cpp`.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| C6 | P2 | `curve-extend-join` | No `Edge.extend`, no join of a wire into one edge. `CreateExtendedCurve` (G1/G2/C∞) and `CreateByJoining` are real (not bound; the join is already used in `step_build.cpp`). | `ext.extend_curve`, `ext.join_curves`; `Edge.extend(d, end=, continuity=)`, `Wire.joined()`/`to_edge()` (raise on gaps above 1e-6). Used by S1 and C4. | medium | both |
| C7 | P2 | `curve-offset-open` | No offset of edges or wires as curves; Stroke refuses splines; the bound `k.offset_curve` is only 7e-4 accurate. | `Wire.offset`/`Edge.offset`: lines and arcs through `_planar.offset_chain` (exact), splines through `ext.offset_curve` on `CreateSimpleOffset` with about 1e-6·size, reporting the gap; then Stroke takes splines. | medium | both |
| C8 | P2 | `curve-fit-tolerance` | `Spline` interpolates every point (200 points -> 202 poles); SM_API's approximation has no tolerance. `SmBSplineCurve::ApproximatePoints(..., pdOptTolerance)` is real (not probed live). | `fit_curve(points, tolerance=, degree=3, tangents=, closed=)` over `ext.approximate_points`, reporting the achieved deviation; per-point tangents. | medium | both |
| C9 | P2 | `curve-analysis` | No curvature, radius, inflection or joint-continuity query on edges and wires; the free-curve bbox is sampled (curves #16: 0.7998 against 1.0069). | `ext.curve_geometry` (EvaluateGeometric), `ext.curve_properties` (GlobalPropertyAnalysis), `ext.curve_box`; `Edge.curvature_at`, `radius_at`, `min_radius`, `inflections`; `min_radius` in sweep's error hint. Joint continuity (`Wire.continuity`) belongs to A4; not `k.evaluate_continuity` for G2. | medium | both |
| C10 | P2 | `curve-lines-arcs` | No conversion to lines and arcs for CNC DXF. `k.convert_to_lines_and_arcs` returns one rational B-spline 3.7 times outside its fixed 0.001. | `ext.lines_and_arcs(curve, tol)` on `SubdivideToLinesAndArcs`, split per span into exact lines and arcs, deviation checked; `Edge.to_arcs`, `export_dxf(curves='arcs')`. | medium | both |
| C11 | P2 | `curve-from-nurbs` | No public constructor from degree, knots, poles and weights (`Edge.nurbs()` has no inverse); Bezier is single-span. | `Edge.from_nurbs(Nurbs)` / `NurbsCurve(...)` over `_canonical_curve` with knot-count checks; TS `fromNurbs`. | small | both |
| C12 | P2 | `surface-project-accuracy`, `curve-on-face`, `curve-project-to-surface-defect` | `Part.project` fits to about 1e-4 and returns pieces on both sides without their faces (`CreateParallelProjectionCurves` is called without tolerance or distance; with 1e-7 it fits to 2.53e-8, and a projection distance keeps only the near piece). Normal projection onto a face, UV lifting onto freeform faces and iso curves are missing (text around a cylinder already works with `bend()`). `k.project_curve_to_surface` returns unrelated geometry (a seam line), because `SmApiProjectCurve` uses the curve's bbox diagonal as tolerance; smlibpy does not call it. | `ext.project_curve(brep, curve, dir, tol, distance)` returning faces -> `project(curve, dir, nearest=True)`; `src/cpp` drop/lift/iso on `DropAndTrimCurve`/`LiftCurve`/`CreateIsoParametricCurve` with model tolerances -> `Face.project`, `Face.wrap`, `Face.iso`. Record the SM_API defect in `docs/kernel.md` (optional patch K9). | medium | both |
| C13 | P3 | `curve-spline-perf-seam` | `Spline` assembles its basis in O(n²) Python (1600 points: 4.16 s, wasm 0.073 s); closed splines are only C1 at the seam (curvature 0.0135 against 0.0574; documented). | Evaluate only the p+1 non-zero basis functions and solve the banded system; periodic interpolation for closed splines in both ports. | small | both |
| C14 | P3 | `curve-conics-spiral` | No conic or spiral constructors; exact conics already work with `Bezier(weights=)`, and a planar spiral with `Helix(..., tiny height, end_radius=)` (undocumented). | Document both, or add `ParabolicArc`, `HyperbolicArc`, `ConicArc(rho)`, `Spiral` as thin wrappers. | small | both |
| C15 | P3 (documented limit) | `fillet-wire-fillet-silent-skip`, `fillet-curve-executive` | `Wire.fillet` skips arc and spline corners and points that are not vertices, silently (documented, but `Sketch.fillet` raises). Spline and ellipse corners: `SmCurveFilletExecutive` is untested and has side-selection bugs. | Raise for named corners that cannot be rounded; round line-arc corners of planar wires through `_planar`. For spline corners, an own offset-curve implementation costs about the same as fixing the kernel class. | small | both |
| C16 | P3 | `nlib-shape-curve-through-and-match` | Edges cannot be edited: no "pass through this point", no "move an end". `SmCurve::DeformToEndPointTargets` is live and exact (0.031 ms); `ForceThroughPoint` misses its point by 1.9e-4 and moves the clamped start. | `Edge.through(point, tangent=)` in pure Python (minimum-norm least squares on `_basis`); `Edge.match(start=, end=, tangents)` via `DeformToEndPointTargets` (about 40 lines of C++). Not `ForceThroughPoint`. | medium | both |

Status (phase 1) of the items in the table:

- C6: done, 97384e9 (lane C): `Edge.extend`, `Wire.to_edge`, `ext.extend_curve`.
- C7: done, f097364 (lane C): `ext.offset_curve` (CreateSimpleOffset, src/cpp/curve_ops.cpp),
  `Edge.offset`, `Wire.offset`, Stroke along splines. No 3D offset.
- C7 (close-out): done, S (34ab364): a closed edge with a corner where it starts offsets into one
  closed edge both ways (it gave the rounding arc alone at +1 and raised at -1). Later: offsets of
  non-planar curves, trimmed cusps.
- C8: done, f097364 (lane C): `fit_curve`, `Spline(tangents=)` per point.
- C8 (close-out): done, S (34ab364): `fit_curve(points, tangents=[one per point], tolerance=)` over
  the new `ext.approximate_tangents` (400 points: 36 control points within 0.05, 60 within 0.005).
- C9: done, f097364 (lane C): `ext.curve_geometry`, `curve_properties`, `curve_box`;
  `Edge.curvature_at`, `radius_at`, `min_radius`, `inflections`, `Wire.min_radius`; exact free-curve
  boxes; the sweep hint. Wire.continuity is A4's.
- C10: done, f097364 (lane C): `ext.lines_and_arcs`, `to_arcs`, `export_dxf(curves='arcs')`.
- C11: done, 126bb76 (lane C): `Edge.from_nurbs` with checks of the data.
- C12: done, 126bb76 (lane C): `ext.project_curve` within 1e-7, `project(nearest=True)`,
  `Face.project`, `Face.iso`, `Face.wrap`. K9 not made: smlibpy calls neither SM_API projection
  (recorded in docs/kernel.md).
- C12 (close-out): done, S (34ab364): pieces a closed face's seam cuts are joined (`Face.project`
  across a seam gave nothing; `wrap` and `Part.project` gave two or three pieces), and
  `nearest=True` checks each piece between its crossings of the body's edges and silhouettes (a 1 mm
  bridge splits a plate's piece). Later: `Face.wrap` keeping every length.
- C13: done, 126bb76 (lane C): banded interpolation in linear time, periodic closed splines.
- C14: done, 126bb76 (lane C): `ParabolicArc`, `HyperbolicArc`, `ConicArc`, `Spiral`.
- C15: done beyond the minimum, 126bb76 (lane C): planar wires through `_planar`; spline and ellipse
  corners by an own offset-based fillet (OpenCASCADE agrees to 5e-8). SmCurveFilletExecutive is not
  used.
- C15 (close-out): later: rounding arc and spline corners of non-planar wires.
- C16: done, 126bb76 (lane C): `Edge.through` (minimum-norm move), `Edge.match`
  (DeformToEndPointTargets).
- C16 (close-out): later: a global `Edge.through`, `Wire.match_to`.

### U. Surfaces and sheets

Goal: freeform surface work (blend, fill, trim, extend, stitch) is possible without leaving
smlibpy, and exact faces stay exact.

**U1 · P0 · Plane recognition flattens B-spline faces with bumps** · `nlib-shape-plane-recognition-erases-bumps` · small · both
- Status (phase 1): done, de5795c: K7 (control points at their Greville abscissae, equal
  weights). The sphere and revolution recognizers also sample; not patched.
- Wrong: with `HIGHER_ORDER_USE_ANALYTICS` defined, `SmPlane::IsNurbSurfacePlane` skips its
  degree and pole guard and compares normals at 3 and points at 10 fixed parameters. A
  B-spline face parameterized like a plane, with a bump between those parameters, becomes
  an exact plane in every copy that adds analytics: `Face.to_shell` (CopyFaces), `.smb` load
  (`ReadFromFile` hard-codes `bAddAnalytics=TRUE`), `Shell.thicken`, the SmBrep copy
  constructor, and both tessellation paths (`ConvertToPolyBrep` and `convert_by_halving` at
  `tessellate.cpp:354`). `mesh()`, STL, GLB, OBJ and the viewer therefore show it flat too.
  `to_shell()` flattened 26 of 40 random single-pole bumps; the same sheet with equally
  spaced poles survives (thicken 7212.23). `.smb` load also re-promotes every
  recognizable B-spline (`to_nurbs()` results come back as cylinders and planes), so "exact,
  lossless" (`exporters.py:7`) is wrong for surface types.
- Do: kernel patch K7. Until it lands, build `ext.copy_faces` output with
  `MergeBrep(..., bAddAnalytics=FALSE)`, and copy with `SmBrep(*brep, &map, nullptr, TRUE,
  FALSE)` in `convert_by_halving` (the grid path needs K7). Audit the sphere and revolution
  recognizers (extrusion and cone compare control points exactly). Correct the `.smb`
  wording. Tests: the values below, in both suites.
- Repro (probe): a 21 x 21 uniform cubic grid with control points at 60 x the Greville
  abscissae and z = 5 only at pole (16, 9); `s = surface(grid, interpolate=False)` has zmax
  2.2222 and area 3607.471. `s.faces()[0].to_shell()` is a plane of area 3600.0,
  `s.thicken(2).volume` is 7200.0 (about 7215 expected), and the `.smb` round trip gives
  zmax 0.0.

**U2 · P1 · Blend (bridge) surface between two sheet edges** · `surface-bridge-blend`, `fillet-edge-edge-blend`, `sweep-blend-primitive` · medium · both
- Status (phase 1): done, 600614c (lane U): `ext.edge_blend` (src/cpp/blend.cpp) redoes
  `CreateEdgeEdgeBlend` and `CreateBlendSurface` without their defects (the twist was a double
  reversal of the second rail; the rescale of every derivative; all statuses checked) and `blend()`.
  Closed edges are refused.
- Status (close-out): done, U (dc07edb): closed edges too: both rails rebuilt as cubic interpolants
  of the same knots through points at equal steps of length, run on an eighth round, skinned, cut
  back to two faces and sewn along two seams (tubes r 10 and r 6: area 1033.631, tangent to 4e-6
  degrees); a closed and an open edge are refused.
- Gap: nothing bridges two free sheet edges tangentially. `k.create_blend_primitive` is
  bound in Python, unused and not in the wasm. It gives tangent rails (normal angle at most
  3.3e-4 deg), and its result stitches and thickens (338.553). But the face/edge SM_API
  overload drops the inner status (always SM_SUCCESS) and hard-codes G2. Both values of
  `same_dir_curves` "succeed": on one pair they give different blends (106.383 and 130.094);
  on a pair whose edges run in opposite directions both give a twisted blend with crossed
  side edges (215.919 and 234.062, where an untwisted bridge needs at least about 447). The
  root cause of that twist is not determined.
- Do: `ext.edge_blend` in `src/cpp` over the edgeuse overload (`CreateBlendPrimitive` /
  `SmBrep::CreateEdgeEdgeBlend`), with `lCurvesDirFlag` from the nearest pairing of the curve
  ends, `SmCurvatureType` G1/G2/G3, take-off lengths, and a status check. First verify that
  the edgeuse overload's direction guess (or the explicit flag) untwists the opposite pair;
  check the result for crossed side edges before returning it.
  `blend(edge_a, edge_b, continuity='G2', tension=(1, 1), join=False) -> Shell` in
  `surfaces.py`; bind in `js/cpp` and port.

**U3 · P1 · Trim sheets with curves that lie on them; imprint curves** · `surface-trim-with-curves` · medium · both
- Status (phase 1): done, 600614c (lane U): `ext.trim_with_curves` (src/cpp/trim.cpp), `Shell.trim`,
  `Face.split`, `surface_fillet(trim=True)`, and `Part.imprint(tool, direction, nearest=)`, one
  method with B14's since the merge. `trim_project_parallel` is not bound in the wasm (nothing uses
  it).
- Status (close-out): done, U (dc07edb): `src/cpp/trim.cpp` cuts a curve where it leaves the faces
  and where it comes back, so curves past a B-spline sheet's border or across a hole trim and split
  (to 1e-9). Later: `Shell.trim` along a direction.
- Gap (corrected): holes and outlines projected along a direction are already reachable:
  `stitch((big_box - prism) & sheet)` equals the kernel trim to 1e-7. Two things are missing.
  (1) Trimming or splitting a sheet with curves already on it (`surface_fillet` rails,
  `intersection_curves` results): `SmBrep::TrimSurfaces`, C++ only. (2) Imprinting a curve
  onto a solid's faces: `k.trim_project_parallel` SPLIT keeps solids valid, but splits every
  face the projection crosses on a box and only the near side of a closed cylinder face.
- Do: `ext.trim_with_curves` -> `Shell.trim(curve, keep=point|'split')`, `Face.split`;
  `surface_fillet(..., trim=True)`, which trims both inputs to the blend's rails and stitches
  them (probe: one sewn 3-face sheet, 1514.159); `Part.imprint(curve, direction,
  nearest=True)` with one rule for which faces get split. Bind `trim_project_parallel` and the
  new call in the wasm.

**U4 · P1 · Coons patches, N-sided fills and curve networks** · `surface-boundary-fill`, `surface-kernel-construction-guards` · large · both
- Status (phase 1): done, b2bad32 (lane U): `ext.fill_loop` and `ext.network_surface`
  (src/cpp/fill.cpp, not surfaces.cpp; `N_CreateGordonSrf` with compatible crossing parameters, 3e-8
  on the probe network) with the guards in the wrappers; `fill()` and `network()`. Not done: mixed
  loops with `tangent=True`, steep sheets, N-sided tangency better than about 1.4 degrees.
- Status (close-out): blocked, U (5744724) and K2 (2ebcb64): steep sheets fold back in every
  construction tried, N-sided fills stay at 1.346 to 1.348 degrees for every tolerance tried (`fill`
  checks 2 degrees, the docstrings say so), and three-sided tangent fills keep the pole whose offset
  does not finish; the N-sided fill's own leak (`N_FillNSidedHole`, 91.9 and 23.3 kB a fill) is
  patched (`NL_SrfAdv.cpp`). Later: mixed loops with `tangent=True`.
- Gap: no surface from boundary curves. C++ probes: a Coons patch matches its boundary
  midpoints; an N-sided fill gives 3 patches; a Gordon surface missed its own curves by up to
  4.15e-2 on a 10 mm patch, most likely because the probe's network was incompatible
  (crossings at different parameters). A wrapper must reparametrize to common crossings and
  measure the deviation. Guards the wrappers need: Coons checks its 4 curves only with
  `SM_ASSERT` (compiled out); N-sided reads a derivative curve per boundary; Gordon and the
  two-rail sweep fill fixed `NL_CURVE*[640]` arrays without a count check;
  `SmApiCreateOffsetSurface` fits to an absolute 1e-3; `SmSurface::CreateExtendedSurface`
  returns SM_ERR for analytic surfaces; `SmEdge::GetContinuity` ignores its argument.
- Do: `src/cpp/surfaces.cpp`: `coons`, `fill` (N-sided, or `SmBrep::CreateCornerBlend` for
  tangency to neighbours), `network` with a measured deviation; `fill(edges, tangent=True)`
  and `network(u, v)` (ModelingError above 1e-4 of the size); the guards above; record them
  in `docs/kernel.md` when wired.

**U5 · P1 · stitch: honour the tolerance, return Parts, report gaps, unify normals** · `heal-stitch-tolerance-tjunction-region`, `surface-stitch-unify-normals` · small · both
- Status (phase 1): done, b2bad32 (lane U): `ext.stitch_faces` (StitchAdvanced doubling up to
  `tolerance`, UnifyNormals along sewn edges of open results), `stitch(report=True)` and
  `StitchReport`, `flipped()`; surfaces.md #9, #10 and #12 fixed.
- Wrong (corrected): `stitch()` ignores `tolerance` (`StitchIntoSolid` closes gaps up to
  diag/200; a 0.067 gap was closed with `tolerance=1e-4`), returns a closed sewn body as a
  Shell (ai/todo/surfaces.md #9), hides the gaps it closed (#10), and leaves open results
  with mixed normals, so `thicken` fails (#12). T-junctions do get sewn (the reviewer's claim
  was wrong). `k.stitch_advanced` (bound, unused) with an explicit tolerance fixes #9 and #10:
  a tee becomes a valid Part of 2000; faces moved by 0.5 give a valid 1977.45 with a max gap
  of 0.222; gaps above the tolerance are refused. `k.unify_normals` fixes #12 (thicken then
  gives 190.0). There is no public flip, and mirroring twice does not flip. P1, not P0:
  closing gaps is what stitch is for; the defects are that the tolerance is ignored and the
  closed gaps are not reported, both already open as surfaces.md #9/#10.
- Do: rewrite `stitch` on `stitch_advanced` (t from max(1e-7, brep tolerance), doubling up
  to `tolerance`), `unify_normals` on open results, a Part when closed, and a report
  (stitched and open edges, max gaps). Add `Shell.flipped()`/`Face.flipped()`. Bind
  `stitch_advanced` and `unify_normals` in `js/cpp`. Close #9, #10, #12.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| U6 | P2 | `surface-extend-untrim` | No extending of a sheet past its edges and no untrim. `CreateExtendedSurface` (G1, G1_G2, C∞) is exact in a C++ probe (3 mm on all sides); analytic surfaces need conversion or a larger domain. `ext.face_from_surface` untrims (cylinder face back to 1005.31 = 2π·4·40). | `ext.extend_surface`; `Face.extended(d, sides=, continuity=)`, `Shell.extend`, `Face.untrimmed()`. Needed by B12 when a sheet does not span the part. | medium | both |
| U7 | P2 | `nlib-shape-face-push-constraints` | No local push/pull of a face through a point. `N_SrfShapeDerivConstraints` is compiled, exact (point and normal constraints) and takes 0.01-0.1 ms. Traps: editing an analytic face's NURBS is a silent no-op, planes become bilinear nets (the whole face moves), and on trimmed faces a hole edge ended 1.2 mm off its face with `is_valid()` True. | `src/cpp/shape_edit.cpp` `push_face`: copy without analytics, `CopyAnalyticAsNurb`, elevate to degree 3, insert knots around the point, freeze boundary rows for G0/G1/G2, solve, check every edge's distance (refine or raise), `ReplaceSurface`. `Part.push(face, at, by=/to=, normal=, radius=, continuity=)`. Needs U1. | medium | both |
| U8 | P3 | `nlib-shape-warp-flatten-compiled-out` | Region warp, flatten and polyline warp sit in `#if NLIB_UNUSED` blocks; the 10 functions (2238 lines) compile cleanly against today's headers and work (exact outside the region, edges in place). | Copy them into `src/cpp/nlib_shape.cpp` (not whole-file kernel patches); knot-removal tolerance 1e-6·size, not 1%; `Shell.warp`, `Shell.flatten`, later `bead`. After U7. | large | both |
| U9 | P3 | `nlib-shape-match-edge-to-curve` | No edge matching. `AdjustBoundaryCurve` matches an iso-boundary to a curve exactly and locally (7.11e-15); when the target's ends differ from the corners, the adjacent edges move too. | `Shell.match_edge(edge, target, extent=)`; rebuild the adjacent edges' 3D curves (`ReplaceCurve`) and shared vertices instead of refusing. | medium | both |
| U10 | P3 | `nlib-shape-joinsurface` | Two sheets sharing a full boundary cannot become one face. `step_build.cpp`'s `move_seam` already wraps `JoinSurface` (its u/v flag quirk is documented there); `N_MakeSrfsCompatible` works in place on a local stack. | `Shell.merge_faces(a, b)` on throwaway copies, verified by sampling. | small | both |
| U11 | P3 | `nlib-shape-bridge-pitfalls` | Implementer notes for U7/U8: use `CopyAnalyticAsNurb` and the copying `SmBSplineSurface` constructor. `CreateHelicalSweep` stores a pointer to a stack `NL_SURFACE` (latent use-after-free, unreachable today). | Follow the notes in `shape_edit.cpp`; patch `CreateHelicalSweep` only if the helical sweep is wired. | small | both |
| U12 | P3 | `fillet-surface-fillet-options` | `surface_fillet` offers one circular radius; the bound call also makes chamfers and two-distance chamfers (rails exact at 4 and 2), and the executive can trim the base faces (C++, not probed). | `surface_fillet(..., radius2=, shape='round'\|'chamfer')`; a face-to-face fillet later. | medium | both |
| U13 | P3 | `surface-from-nurbs-data` | No surface from explicit NURBS data; `CreateCanonical` is already called in `step_build.cpp`. | `nurbs_surface(poles, knots, degrees, weights=)` with validation; `Face.nurbs()` (A3). | small | both |
| U14 | P3 | `surface-intersection-curves-api` | `intersection_curves` raises SM_ERR for apart or nested bodies and AttributeError for a Plane (documented gotchas). | Accept Plane via `intersect_brep_with_plane`; return [] when the bodies are apart or nested. | small | both |
| U15 | P3 (documented limit) | `surface-fit-error-discarded` | `surface(cloud)` drops the fit's errors; documented, with a manual check. The fit's `max_error` is measured at projected parameters (18.263 where the true worst distance is 7.371). | Expose rms and the residuals under that name, or a fast true-distance check; do not raise at 3 x rms (see Not planned). | small | both |

Status (phase 1) of the items in the table:

- U6: done, b2bad32 (lane U): `ext.extend_face` and `ext.untrim_face` (src/cpp/extend.cpp),
  `Face.extended`, `Shell.extend`, `Face.untrimmed`. Trims are not kept; one face only.
- U6 (close-out): later: keeping trims, and extending sheets of several faces.
- U7: done, d88756e (lane U): `push_face` (src/cpp/shape_edit.cpp), `Part.push` and `Shell.push`.
- U7 (close-out): later: pushes that move edges or cross a seam.
- U8: done, d88756e (lane U): NLib's region warp and flatten copied into src/cpp/nlib_shape.cpp with
  two upstream bugs fixed; `warp`, `flatten`. Not done: `bead`, `side=`, knot removal after a warp.
- U8 (close-out): done, U (0a3538c): knot removal within 1e-6 of the size after `warp` and `flatten`
  (a box top flattened: 21 x 21 control points instead of 39 x 39). Later: `side=`, `bead`.
- U9: partial, a311eab (lane U): `Shell.match_edge` (AdjustBoundaryCurve; neighbours follow moved
  corners). Not done: tangency across the side edges, `stitch(match=True)`.
- U9 (close-out): later: tangency across the side edges and `stitch(match=True)`; the crease is
  documented in both docstrings.
- U10: done, a311eab (lane U): `Shell.merge_faces` (N_MakeSrfsCompatible and N_SrfJoin on stacks of
  its own). Not done: `Part.merge_faces`, `stitch(merge=True)`.
- U10 (close-out): later: `stitch(merge=True)`, `Part.merge_faces`.
- U11: done, a311eab (lane U): nothing reachable needed a fix; a test keeps `CreateHelicalSweep`
  unwired, and the new NLib code follows the notes.
- U12: partial, a311eab (lane U): `surface_fillet(radius2=, shape='chamfer')`. Not done: the
  face-to-face fillet with base trimming.
- U12 (close-out): later: the face-to-face fillet with base trimming.
- U13: done, a311eab (lane U): `nurbs_surface()` with checks and exact clamping.
- U14: done, a311eab (lane U): a Plane (as a sheet across the body) and a Face accepted, [] for
  bodies apart or nested.
- U14 (close-out): U (dc07edb): `Part.section` asks `CreatePlanarSectionCurves` for 1e-7 of the
  part's size (`ext.plane_section`): curves on a thickened B-spline sheet 3.2e-6 off (the kernel's
  up to 1.5e-2, its areas up to 0.13 % too large).
- U15: done, a311eab (lane U): `surface(report=True)` and `FitReport` with true distances
  (`ext.surface_distances`).

### T. Topology, history and validity

Goal: selections and validity answers can be trusted on imported and edited bodies.

**T1 · P0 · Edge convexity is noise on imported edges** · `topo-convexity` · small · both
- Status (phase 1): done, 90677eb (group TIX): `ext.edge_angles` (`CalcOuterAngle`), new
  `Edge.dihedral_angle`; Python and wasm agree.
- Wrong: `Edge.convexity` compares `f1.distance_to(p ± into·eps)` with eps = 1e-4 x edge
  length. Imported edges lie up to the file's tolerance off their faces (6.6e-4 here), so the
  two distances tie. On the valve body the four mirror-symmetric edges read concave, concave,
  convex, convex in Python and concave, convex, concave, concave in the wasm; the kernel gives
  230.74 deg (convex) for all four. After `.smb` recognition, smlibpy and the kernel disagree
  on 5 of 151 edges. `part.edges().concave()` then selects the wrong edges, silently. 734
  edges take 1173 ms in Python against 53 ms in the kernel.
- Do: `ext.edge_angles(brep, edges)` from `SmEdge::CalcOuterAngle` at the mid parameter.
  `smooth` where |angle - 180| < 0.5, convex above, concave below; batch it in
  `ShapeList.convex/concave/smooth`; add `Edge.dihedral_angle`; use it in `_sharp_edges`.
  Keep the current code as the fallback for seams, non-manifold edges, open shells and the
  inner edges of merged parts (there `CalcOuterAngle` returns SM_ERR_WARNING and an obtuse
  angle). Bind `ext__edge_angles`.
- Repro: `p = import_step('../models/solid/Ventil.stp')`; the 4 edges at (±15.503, ±14.475,
  1.039) report concave, concave, convex, convex; CalcOuterAngle gives 230.74 deg for each.

**T2 · P0 · Face copies segfault after a failed RemoveFaces** · `heal-copyfaces-crash-after-failed-removefaces` · small · both
- Status (phase 1): done, 90677eb: failed copies are kept for the life of the process and raise
  KernelError; the later step (single-face sheets through `SmBrepConstructor`) is not done.
- Status (close-out): K2 (2ebcb64): failed face copies are freed: `DeleteFace` deletes a Face
  without Faceuses also when its bookkeeping fails, `~SmBrep` deletes such a Face, and `CopyFaces`
  frees what it made for a face it could not build; `ext.copy_faces` and `slivers.cpp` delete the
  copies (117.8 kB to 0 per failed copy, smlibwasm 82 kB to 0).
- Wrong: `ext.copy_faces` (`ext.cpp:561-593`) falls back to copy + `RemoveFaces` when
  `CopyFaces` fails, and deletes the copy when `RemoveFaces` fails too; `~SmBrep` then
  crashes (EXC_BAD_ACCESS at 0xa0). Callers: `Face.to_shell`, `Face.translate/rotate`,
  `Face.to_sketch`, `Face.extrude`, `stitch` of faces. Trigger: an imported STEP body whose
  faces share no edges and whose vertex points sit up to 1e-3 off (low-precision writers).
  The wasm raises "copy face failed" after reading low memory.
- Do: never delete a Brep whose `RemoveFaces` or `CopyFaces` failed: keep it in a
  never-freed list (no such pattern exists in `src/cpp` yet) and raise KernelError. Audit
  `combine()` the same way. Later, build single-face sheets of tolerance-violating bodies
  through `SmBrepConstructor`, as `step_build.cpp` does. Regression test in a subprocess.
  I5 stitches such bodies on import, which removes this trigger wherever stitching succeeds
  (it repaired this file); the fix here is still needed for bodies it cannot stitch.
- Repro: export `Box(20,10,10) - Cylinder(3,20)` to STEP and rewrite it so each
  ORIENTED_EDGE has its own EDGE_CURVE and VERTEX_POINTs, with copied points moved by up to
  1e-3. `r = import_step(...)` gives an invalid Part, and `r.faces()[0].to_shell()` exits
  with 139 (gaps of 0 and 1e-4 work).

**T3 · P1 · Face and edge provenance through operations** · `topo-history` · medium · both
- Status (phase 1): done, 3305dfe (lane BT): `SmTagsAttribute` (src/cpp/history.cpp; Merge and
  Coincident take the union), `ShapeList.new(since)` and `derived_from`, old selections mapped to
  their descendants before geometry, tags carried across the other process. Not done: bodies read
  from files get new tags, vertices have none.
- Status (close-out): later: tags for bodies read from files, and on vertices.
- Gap: a selection taken before an edit that splits faces cannot be used after it
  (`cut.fillet(box.edges().top(), 1)` raises "is not an edge of this part"). Kernel attribute
  propagation keeps tags through Booleans (both halves of a split face keep their parent's
  tag), fillets and chamfers (new faces untagged), offset and shell, copy and transform. On
  plate + boss, exactly the two new intersection circles are untagged.
- Do: `ext.tag_topology` (an `SmGenericAttribute` subclass whose Merge keeps the union of
  ids) and `ext.topology_tags`; tag lazily in `_copy_brep`; `ShapeList.new(since=...)` and
  `ShapeList.derived_from(...)`; `_own_edges/_own_faces` map old selections to descendants
  before geometric matching. TS `newSince`/`derivedFrom`; document in `docs/selecting.md`
  and the fillet guide.

**T4 · P1 · A validity report that names the problem** · `topo-check`, `infra-assert-valid`, `heal-check-report` · medium · both
- Status (phase 1): done, 3305dfe (lane BT): `ext.check_brep` (AssertValid, owners mapped to
  indices), `tolerance_gaps`, `body.check()` and `Problem`, `is_valid(strict=True)`,
  `Edge.tolerance`, `Vertex.tolerance`, `Shell.heal()` returning a Part when closed. Not done:
  `heal(report=True)` from SmHealData.
- Status (close-out): later: `heal(report=True)` from `SmHealData`, as the Do says.
- Gap: `is_valid()` checks closed, manifold, finite box and volume sign only. The kernel's
  `SmBrep::AssertValid` is built in release, runs `ValidatePointers` and a check-only
  `ValidateAndUpdateTolerances`, and names the entity, test and value. The imported valve is
  valid for smlibpy while AssertValid reports 34 problems at level 0 and 42 at level 2 (bad
  loop vertices, bad vertex topology, missing seams, gaps of 3.23e-05 above a tolerance of
  2.63e-05). A cube filleted at r 4.99 passes levels 0-1 and fails level 2 (24 reports).
  Generated parts pass cleanly in 0.7-15 ms. It misses global self-intersection (the wrong
  6 mm shell passes). `Shell.heal()` never returns a Part. Free edges and the reason a part
  is invalid are already reachable; a full `SmHealData` problem report is large.
- Do: minimal first: `ext.check_brep(brep, level)` from AssertValid (owners mapped to
  face/edge/vertex indices) and `ext.tolerance_gaps`; `Part.check(level) -> [Problem(shape,
  message, value)]`, `is_valid(strict=True)`, `Edge/Vertex.tolerance`; `Shell.heal()` returns
  a Part when the result encloses a region. `heal(report=True)` from `SmHealData` later.
  Bind in `js/cpp`. Run checks before any measure: measuring stores refit trims in the Brep
  and can change a broken body's answers (X6, T6).

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| T5 | P2 | `topo-face-attributes` | No per-face color or name. STEP face colors are read but dropped (only the solid's is used) and never written; glTF/USD export one material per body. `SM_AI_COLOR` with `SmColorAttribute` (which has a color Merge) is the kernel's own slot and propagates through Booleans and fillets. | `ext.set_face_attrs`/`face_attrs`; `Face.color`, `Part.colored(color, faces=)`; STYLED_ITEM per ADVANCED_FACE in and out; per-face glTF/USD materials. `.smb` drops attributes: X9. | large | both |
| T6 | P3 | `topo-scale-analytics` | After a non-uniform scale every face is a B-spline. A copy with analytics recognition right after `transform_brep` restores planes, lines and cylinders (circular rims stay B-spline); planar selection already works. Measuring first stores refit UV trims in the Brep, which then keep a 6.8e-7 volume error, and `.smb` output depends on which queries ran (8590 against 32910 bytes). So a measure changes the Brep, contrary to `_kernel.py:63-65` ("a body's Brep does not change once wrapped"). | Recognize in `_transformed` right after `transform_brep` for non-similarities, keep the original if anything changes beyond tolerance; gains `cylinders()`/`radius` after axis-aligned scales and analytic STEP. Land after B1, which changes the same path. Correct the `BrepHandle` docstring; cached measures and T8's handle sharing must not assume an unchanging Brep. | small | both |
| T7 | P3 | `topo-shells-voids` | Shells, cavities and the cells a face bounds are not public; the data is in `brep_dump`/`material_census`. | `Part.shells()`, `Part.voids()`, `Face.cells`, `ShapeList.shared()`, solids/voids in `info()`. | small | both |
| T8 | P3 | `topo-named-cache` | `named()`/`colored()` deep-copy the Brep and drop cached measures (23.9 ms per volume after `named()` on the valve). Selections already work through geometric matching. | Share the handle only with a per-wrapper identity token, since `__eq__`/`__hash__` compare the handle. A shared Brep still changes when one wrapper measures it (T6). | small | both |

Status (phase 1) of the items in the table:

- T5: done, 8525ff9 (lane BT): `ext.set_face_colors` and `set_face_names` (SM_AI_COLOR and a name
  attribute), `colored`/`named(faces=)`, `Face.color`, `Face.name`; STEP in and out, glTF, USD
  meshes, render; X9's `.smp` keeps them. `.smb` and USD BrepArrays hold none.
- T5 (close-out): later: face colors and names in `.smb`, USD `BrepArray`, OBJ and the live view.
- T6: done, 8525ff9 (lane BT): `ext.recognize_analytics` right after non-similarity transforms, kept
  only within 1e-9 of the size; the BrepHandle docstring corrected. Circular rims stay B-splines.
- T6 (close-out): done, K1 (2b79952): circles are restored too (`restore_analytic_curves`):
  `Cylinder(5, 10).scale((1, 1, 2))` has 2 circle edges, and STEP writes `CIRCLE`. Later:
  ellipsoids, recognition of STEP imports.
- T7: done, 8525ff9 (lane BT): `ext.brep_shells`, `Part.shells`, `Part.voids`, `Face.cells`,
  `ShapeList.shared`, the info keys.
- T8: done, 8525ff9 (lane BT): the handle shared with an identity per wrapper; smlibwasm counts the
  holders before it frees.

### I. STEP import and export

Goal: real-world STEP files import whole, fast and topologically sound; exports keep what
other CAD systems need.

**I1 · P0 · The STEP builder duplicates vertices** · `input-corpus-duplicate-vertices-cause`, `topo-step-dup-vertices` · medium · both
- Status (phase 1): done, 90677eb: file vertex ids in the edge specs and a deterministic glue
  of what the constructor still doubles; corpus coincident-vertex bodies 48 -> 4, no volume or
  validity changed.
- Wrong: `step_build.cpp:636` starts every edge with `StartEdge(o, nullptr, nullptr,
  nullptr)`, and `SmBrepConstructor::EndLoop` makes a new vertex wherever no linked
  neighbour exists yet. Part 100 has 20 VERTEX_POINTs and 26 Brep vertices (6 coincident
  pairs). 42 of 555 corpus parts have duplicates (497 pairs; housing-69 meshes open); the
  valve body has 106 vertices at 102 positions with 8 broken loop links, which AssertValid
  flags. 7 of the 9 parts whose fillets crash have duplicates (F2). `is_valid()` is True,
  and `heal()` keeps them, although `heal.md:10` and `SmPyHeal.cpp:27` say heal merges
  coincident vertices. On the valve no failure could be traced to its 4 duplicates (cuts at
  all 4 sites succeed, and a smlibpy STEP round trip still leaves 4 broken links); the harm
  shown is the fillet-crash link on the corpus parts.
- Do: carry the file's vertex ids in the edge specs (for seams added by `_add_seams`, the
  vertex of the circle they start on). In `build()` keep an id -> SmVertex* map and pass it
  as `pOptExistingStartVertex/EndVertex`. Tests: file vertex count == Brep vertex count, and
  consecutive edgeuses of every loop share their vertex, on the valve, `AWVLogoCube.stp` and
  an OCCT hex part. Fix `heal.md`, or merge with `SmBrep::CombineCoincidentVertices` in heal.
- Repro: `p = import_step('crescendo-01a13a09-part-0-1-1-100.step')` (classcad-mcp STEP
  corpus): 26 vertices for 20 in the file; `E = p.edges(); p.fillet(ShapeList([E[0], E[1]]),
  0.15875)` exits with 139.

**I2 · P0 · Every STEP import leaks in SmFace::HasSeamProblem** · `wasmbind-seam-curve-leak`, `infra-step-import-leak` · medium · both
- Status (phase 1): done, 90677eb: K6 (with a second transfer the plan did not name) and K10;
  the leaks are 0 by malloc zone statistics (LeakSanitizer does not run on macOS arm64).
- Wrong: `SmFace::HasSeamProblem` (`SmFace.cpp:15661-15691` for U, `15805-15838` for V)
  deep-copies the owned seam curve and then disowns the original, which leaks. smlibpy
  calls it through `ext.seam_problems` on every imported body (`step_import.py:580, 654,
  668`; TS 798, 881, 897), and `heal_brep` reaches it too. Native: +3408 bytes per call on a
  cylinder, 4848 on a sphere, 12672 on a torus, 0 on a box; about 17 KB per import of a small
  filleted part, 2.0 MB per import of the 412-face part 146. Wasm: 2888 bytes per call;
  `heal_brep` 7158 bytes per call. `Part.heal` grows by 3.3 KB per call (untraced; possibly
  the same path).
- Do: kernel patch K6. Meanwhile, calling `seam_problems` only once per body (I8) reduces
  the leak, since it leaks per call. RSS and mallinfo tests (N2).
- Repro: importing a box with one hole in a loop grows native memory by 3408 bytes per
  import (wasm: 2896 per import, even after `dispose()`); a box alone: 0.

**I3 · P1 · O-ring tori fail to import** · `input-corpus-torus-seam-window` · small · both
- Status (phase 1): done, 8952bee (lane IX): the tube window starts at 0 where the seam angle is
  within 1e-9 deg of it, in both ports and in step_build.cpp; parts 73, 89 and 153 import valid.
- Wrong: for a torus whose seam runs along the outer equator, `v0` is +6e-15 and
  `v_start = v0 - 360` gives -359.99999999999994, which `SmEllipse::AdjustSTEPInterval`
  rejects. 3 of 154 classcad-mcp parts fail, and the Citrus Epsilon assembly aborts whole.
- Do: `v_start = 0.0 if abs(v0) < 1e-9 else (v0 - 360.0 if v0 > 0 else v0)` in
  `step_import.py:170` and `step_import.ts:299`; optionally clamp in `step_build.cpp`. Test
  with an OCCT O-ring (22.2066 = 2π²·4.5·0.25).

**I4 · P1 · BREP_WITH_VOIDS: the correct build is rejected** · `input-corpus-void-tolerance` · small · both
- Status (phase 1): done, 8952bee (lane IX): volumes through `_props()`, a tolerance from the
  pieces' gaps, the orientation that is clearly closer; a failing fallback raises ModelingError
  naming the body. The Kraken motor imports valid; the tests are white-box (no constructed file
  reproduces it).
- Wrong: the void-region build of the Kraken X60 motor agrees with the expected volume to
  2.7-6.6 mm³ of 195,950 (plausible, not proven exact; OpenCASCADE gives 195991.4) but fails
  a 1e-6 relative test; 16 fallback Booleans then fail after 18.5 s with "the
  operands may touch", and the import emits 15 RuntimeWarnings.
- Do: volumes through `_props()` (no warnings); tol = max(1e-6·V, 2·Σ gaps_i·|V_i|); take
  the orientation that is clearly closer (2.71 against 151.97); if the Boolean fallback
  fails, raise ModelingError naming the body. The accepted body does not mesh closed
  (OpenCASCADE also calls it invalid), so tests must not assert a closed mesh.

**I5 · P1 · Unshared STEP faces import as silently invalid bodies** · `heal-step-import-no-stitch-fallback` · small · both
- Status (phase 1): done, 8952bee (lane IX): heal, `stitch_into_solid`, then `stitch_advanced`
  doubling from the declared uncertainty or the measured gaps up to 1e-3 of the size, kept only if
  valid with its gaps; open shells sewn; warnings; the wasm binds `stitch_advanced`.
- Wrong: when faces do not share edges, `_build_body` returns an invalid Part without a
  warning, and `heal()` cannot fix it; `k.stitch_into_solid` on a copy repairs it exactly
  (box with hole: valid, 14 edges, 1717.2567; also with vertex gaps of 1e-4 and 1e-3).
- Do: `stitch_into_solid` on a copy first (it doubles its own tolerance). If that fails,
  `stitch_advanced` with a tolerance taken from the measured vertex gaps, not from the file's
  UNCERTAINTY_MEASURE_WITH_UNIT alone (smlibpy itself declares 1e-7 in files whose gaps are
  1e-3): a doubling loop from max(declared, 1e-7) up to a size-relative cap, as in U5. Heal,
  keep if sound; stitch open shells too. Warn with the largest gap closed when stitching
  succeeds, and naming body and product when it fails. This also removes T2's crash trigger.
  Prevalence is unknown (the 6781-file corpus is mostly agent output).

**I6 · P1 · One unreadable body aborts the whole file** · `heal-step-import-one-bad-body-aborts` · small · both
- Status (phase 1): partial, 8952bee (lane IX): bodies built one by one, a failing one left out with
  a warning, `strict=`, `StepModel.skipped`, entity ids in the reader's messages. Not done:
  OFFSET_CURVE_3D and PCURVE-only edges, which no real file at hand holds.
- Status (close-out): done, M (7bd25a9): `OFFSET_CURVE_3D` (lines and circles exact, others through
  the new `ext.offset_curve_3d` within 1e-9) and `PCURVE` edges are read.
- Status (verification): the reader offset along the tangent x the reference direction; ISO 10303-42
  (and OpenCASCADE 8.0) offset along the reference direction x the tangent, so it read a circle of
  radius 7 offset by 2 about its axis as radius 9 (an invalid body of 961.328, a warning about its
  mass properties only). Fixed in both builds; five files (circles, a B-spline circle, a line, both
  signs and both axis senses) read as OpenCASCADE reads them (tests/test_closeout_V.py). IGES 130
  keeps the tangent x the normal, as OpenCASCADE reads it.
- Wrong: any exception in one body ends `import_step`/`read_step` with a bare
  NotImplementedError that names neither entity, body nor product.
- Do: build each body in try/except, warn with name, entity id and reason, return the rest;
  `import_step(strict=False)`, `StepModel.skipped`. Then OFFSET_CURVE_3D (`SmOffsetCurve`) and
  PCURVE-only edges (`SmSTEPSurface`). The extras reader already catches per item
  (`step_reader.py:709`).

**I7 · P1 · Assembly instances are rebuilt from scratch** · `input-corpus-assembly-instances` · small · both
- Status (phase 1): done, 8952bee (lane IX): built bodies cached per BodyData and moved to each
  placement; the shooter pivot imports 251 instances valid in 50.5 s.
- Wrong: `interpret()` returns the same BodyData for every instance, but each is built
  again. Citrus shooter_pivot: 251 instances of 152 bodies (24,298 faces built for 11,981).
  Citrus Epsilon: 1472 instances of 714 bodies; the import did not finish in 20 min (the
  motor alone 15 x 11.6 s).
- Do: cache built bodies per `id(BodyData)` with their matrix; later instances
  `copy().transform(m_k · m_0⁻¹)` and get their own name and color.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| I8 | P2 | `input-corpus-import-check-cost` | 3-4 coarse kernel integrations per closed body (part 78: 1.9 of 8.2 s), `inverted_faces` 1.9 s, a second `seam_problems` 0.4 s. | Integrate once per built shell (cache `_kernel_props(1e-4)` or pass the volume on); reuse one `seam_problems` result; `inverted_faces` only where loops were turned. Not `brep_measure` everywhere (see Not planned). | small | both |
| I9 | P2 | `input-corpus-face-uv-domain` | Imported faces keep the surface's whole UV domain; `CalculateAnInternalPoint` misses narrow torus strips, so `Face.interior_point()` and `export_step` of 2 of 337 valid imports raise a raw RuntimeError. Separately, `Part.fillet`'s size pre-check lets a raw RuntimeError from `Edge.distance_to` escape (`fillet1019.smb`). | `CalculateUVDomainFromUVTrimCurves` + `SetUVDomain` after `EndBrep`; a fallback point in `step.py`/`step.ts`; kernel queries inside `kernel_call`; catch the pre-check error. | small | both |
| I10 | P2 | `heal-step-export-no-assembly`, `topo-assembly` | `export_step` writes one PRODUCT holding every body (documented in `export_step.md:17, 35-36`, though `docs/files.md:24` calls the file "assembly.step"). | One PRODUCT per named body under a root (NAUO, CDSR, ITEM_DEFINED_TRANSFORMATION), shared BrepHandles instanced; round trip with `import_step` and OCP. A full Assembly type is a product decision (Not planned). | medium | both |
| I11 | P2 (low-value wrong result) | `input-corpus-step-export-offset` | A body with an offset surface goes to NURBS whole on export; `to_nurbs` fits offset faces loosely, so a STEP round trip of `vase.smb` changes the volume by 0.77% and planes come back as B-splines, without a warning. Only imported or `.smb` bodies. | Write OFFSET_SURFACE (the reader supports it), or convert only those faces with a checked fit. | medium | both |
| I12 | P3 | `heal-step-export-curves` | `export_step` cannot write edges, wires, points or frames; `read_step` reads them. | GEOMETRIC_CURVE_SET, named points and AXIS2_PLACEMENT_3D; round-trip tests. | small | both |
| I13 | P3 | `heal-step-uncertainty-constant` | The declared 1e-7 matches OCCT; it changes meaning with `unit=` (1e-7 m = 1e-4 mm). | A fixed value in mm, converted to the file unit. | small | both |
| I14 | P3 | `heal-iges-absent` | No IGES; NLib has entity-to-NURBS converters only. | An `iges_reader.py` translator (trim loops, `stitch_advanced`) if IGES is ever needed. | large | both |

Status (phase 1) of the items in the table:

- I8: done, 8952bee (lane IX): one integration per shell, the seam check only on inverted faces.
- I9: done, 8952bee (lane IX): `tighten_uv_domains` after EndBrep (only directions a face takes less
  than half of), kernel queries in kernel_call, the fillet pre-check.
- I10: partial, 8952bee (lane IX): `export_step(assembly=True)`, names encoded (files.md #16). Not
  done: instances of moved copies (no provenance).
- I10 (close-out): done for placements, M (7bd25a9): `CARTESIAN_TRANSFORMATION_OPERATOR_3D`
  placements that mirror or scale are read. Later: moved copies written as instances.
- I11: done, eb2cb77 (lane IX): OFFSET_SURFACE with the kernel's basis or its extension; SmCylinder
  as CYLINDRICAL_SURFACE; a warning where a body still goes to NURBS. Not done: offsets of C0
  B-spline bases stay unreadable for OpenCASCADE; an offset of a whole sphere does not import.
- I11 (close-out): done, M (7bd25a9): closed shells of offsets of planes, spheres, cylinders, cones
  and tori are also built on those surfaces, which are taken where the offset build fails or has
  another volume (a sphere's offset imports exact; smlibwasm had a quarter of the volume). Later: C0
  bases for OpenCASCADE.
- I12: done, eb2cb77 (lane IX): curves, points and frames in `export_step`; `StepCurve`,
  `StepPoint`, `StepFrame` exported.
- I12 (close-out): done, M (b4462a6): `StepFrame` colors written.
- I13: done, eb2cb77 (lane IX): 1e-7 mm converted to the file's unit.
- I14: done, 970f486 (lane IX): `iges_reader.py`/`.ts` into the STEP builder; a reader only.
- I14 (close-out): done, M (b4462a6): entity 130 at one distance read. Later: writing, binary and
  compressed IGES, more entity forms.

### X. USD, SMB and other formats

Goal: USD and `.smb` round trips keep bodies, placements, names and types; malformed files
raise errors instead of crashing.

**X1 · P0 · One bad value in a .usda crashes, hangs or misimports** · `usd-conformance-value-crash` · small · both
- Status (phase 1): done, 90677eb: value checks per validator rule before conversion; the
  not-planned cone rule is not enforced.
- Wrong: `check()` in `src/cpp/usd.cpp` validates array sizes and indices only, and
  `read_field` accepts nan and inf. Mutating one value of a smlibpy export: a sphere
  refDirection parallel to its axis, or zero, segfaults inside `ext.usd_read` (no frame check
  in the vendored `SmuConvert.cpp:2783-2806`); a surface weight of 0 makes `mesh()` segfault;
  a torus axis of 0 made `volume` hang in one file (wasm 60 s) and gave half the volume in
  another (394.78 against 789.57). Accepted as valid but wrong: a cylinder axis of 0 (748.27
  against 785.40), an edge weight of 0 or an edge CV of nan (500 against 1000), and a cone
  axis of (0,0,-2), because vectors are not normalised (408.41 -> 496.58). `docs/kernel.md:84`
  says a malformed file cannot crash smlibpy.
- Do: extend `check()` with the validator's value rules: non-finite numbers,
  intersectTol3d <= 0, weights <= 0, radii <= 0, zero-length axis/refDirection/direction,
  reversed ranges. Normalise vectors; orthonormalise nearly orthogonal frames and reject
  parallel ones. Do not hard-reject cone semiAngle outside (0, π/2) (see Not planned).
  Throw `std::invalid_argument` naming prim, body, entity and rule code. Correct
  `docs/kernel.md:84` now; add the fuzz cases to both test suites (subprocess).
- Repro: `export_usd(Sphere(5), 'a.usda', mesh=False)`, set the sphere's refDirection to
  (0, 0, 1) in the file, `import_usd('a.usda')`: exit 139.

**X2 · P0 · import_usd ignores placement, units, up axis and composition** · `heal-usd-import-ignores-xform-units`, `usd-conformance-composition` · medium · both
- Status (phase 1): done, 90677eb: placement, units, up axis, subLayers, references and
  payloads (`import_usd(..., units, placement, check)`, `fromUsd(..., { resolve })`). A stage
  without `metersPerUnit`/`upAxis` is read as is (mm, Z up), unlike USD's fallback; inherits,
  specializes and variants are not composed.
- Status (close-out): later: inherits, specializes and variant sets.
- Wrong: `usd_read` reads only the BrepArray arrays, extent and displayColor. xformOps on
  the prim and its ancestors, `metersPerUnit` and `upAxis` are ignored, without a warning:
  assemblies collapse onto their local origins and sizes are off by 10x or 1000x. Prims
  declared `class` or `over` and prims with `active = false` are imported as bodies.
  References, payloads and subLayers are ignored ("holds no BrepArray prims"). Prims are
  named '/' + leaf, so equal leaf names collide. Upstream bakes the world transform but does
  not handle `metersPerUnit` or `upAxis` either.
- Do: (small) skip class, over and inactive prims; name bodies by prim path; compose
  `xformOp:*` (translate, rotate*, orient, scale, transform, `xformOpOrder`,
  `!resetXformStack!`) down the tree and apply world · units · up axis with
  `ext.transform_brep` (after B1); `import_usd(path, units=None, placement=True)`. (Larger)
  resolve references, payloads and sublayers: Python reads referenced `.usda` files relative
  to the file (cycle guard, depth limit), the wasm takes `fromUsd(text, {resolve})`;
  unresolved references named in the error. Tests with pxr-authored nested xforms and cm
  units.
- Repro: `export_usd(Box(10, 10, 10), 'a.usda', mesh=False)`; add `double3
  xformOp:translate = (100, 0, 0)` and `uniform token[] xformOpOrder = ["xformOp:translate"]`
  to /World and set `metersPerUnit = 0.01`. `import_usd('a.usda').bbox()` is ±5; expected x
  950..1050 mm. The wasm gives the same.

**X4 · P0 · Re-exported line edges span 2.5 km; the native bbox becomes 1.2e6** · `usd-conformance-analytic-line-reexport` · small · both
- Status (phase 1): done, 90677eb: the writer trims lines to the edge; K8 for files written the
  old way.
- Wrong: the vendored writer approximates non-B-spline edge curves over their natural
  interval (`SmuConvert.cpp:2183-2195`), so each analytic line edge (BrepCurve3dLineAPI
  files, OCCT imports) is written as a B-spline over SMLib's unbounded ±1234567. The file then
  fails the validator (BA.365). Re-importing it natively gives `bbox()` ((-5,-5,-5),
  (1234560,1234560,1234560)) for the body, its edges and faces, which survives translate and
  Booleans; the wasm gives ±5 for the same file. Cause: `SmCurve::CalculateTightBoundingBox`
  adds knot points outside the interval, and `SmEdge` reaches that code only when a loose-box
  test fails, which depends on rounding. Volume and mesh are right.
- Do: trim the curve to the edge interval before `ApproximateCurve` in the vendored writer
  (or write analytic edges, X5), and kernel patch K8. Test: import a line-edge box, export,
  assert max |CV| <= extent and the re-imported bbox.
- Repro:
  ```python
  b = import_usd('box_lines.usda')      # a 10 mm box whose 12 edges are BrepCurve3dLineAPI lines
  export_usd(b, 're.usda', mesh=False)  # edge CVs reach 1234572 (validator: BA.365)
  import_usd('re.usda').bbox()          # max (1234560, 1234560, 1234560); the wasm gives ±5
  ```
  A re-export of `third_party/usd-brep/TestFiles/usd_TestFiles/RevitWallHealerCrash.usda`
  (33 line edges) reaches max |edge CV| 1245067.

**X8 · P0 · A merged part saved as .smb loads as a Shell** · `heal-smb-load-merged-part-becomes-shell`, `topo-smb-merged` · small · both
- Status (phase 1): done, 90677eb: Part or Shell by enclosed regions, as `import_usd` decides.
- Wrong: `load()` (`exporters.py:424-427`) and `fromSmb` (`exporters.ts:870-873`) return a
  Shell when `is_valid()` is False, which every merged part is by design. Cells and volume
  are lost on the "exact and lossless" format; USD round-trips the same part (Part, 2 cells),
  STEP splits it into 2 Parts.
- Do: decide as `import_usd` does: a Part when the Brep has a finite, non-void region; a
  Shell otherwise. Round-trip test in both suites.
- Repro: `m = Box(10,10,10).merge(Box(10,10,10).translate(10,0,0)); save(m, 'm.smb');
  load('m.smb')` gives a Shell of 11 faces with no `cells()` or `volume`.

**X6 · P0 · Geometrically broken BrepArrays import as valid** · `usd-conformance-geometric-check` · medium · both
- Status (phase 1): done, 90677eb: `SmBrep::AssertValid` on bodies smlibpy did not write;
  `check=False` skips it; RevitWallHealerCrash.usda is now refused.
- Wrong: validator files 440, 465, 582, 310 and 365 import as Parts that report valid but
  are wrong (a unit cube of volume 0.5, a bbox of 0..100, a body whose mesh fails, STEP export
  "non-finite number"); 763/764 import as empty Shells. AssertValid (T4) flags each in
  0.3-16 ms. The reported volume depends on call order, because `is_valid()` (the kernel's
  ComputePreciseProperties) changes a broken body (440: 0.49999 -> 1.0). `heal=True` repairs
  465 but not 440 or 582.
- Do: run AssertValid in `usd_read` before anything measures the body; raise ValueError
  (prim, body, entity, gap) above 1e-3 x diagonal and warn below; option `check=True` or
  skip for `customData.source == 'smlibpy'`. Enforce the value rules (X1), orphan edges
  (582), UV loop closure (763/764) and empty bodies (X10); not the containment rules (see
  Not planned).
- Repro:
  ```python
  d = 'third_party/usd-brep/TestFiles/brep_validator/'
  b = import_usd(d + 'Test_BA_440_Non_positive_NURBS_surface_weights.usda')[0]
  b.volume                   # 0.5 with a gap RuntimeWarning (true 1.0; 1.0 if is_valid() ran first)
  b.is_valid()               # True
  export_step(b, 'b.step')   # ValueError: non-finite number in STEP output
  ```

**X3 · P1 · Non-ASCII names break export_usd** · `usd-conformance-unicode-names` · small · both
- Status (phase 1): done, 8952bee (lane IX): prim names map one code point to `_`, the name is
  written as `displayName` and read back; 'Größe', 'café' and '部品' round-trip in both builds.
- Wrong: `prim_name` (`usd.cpp:392-406`) sanitises byte by byte with `std::isalnum`. On macOS
  that leaves invalid UTF-8, and `export_usd` raises UnicodeDecodeError for "Größe", "café"
  or "部品" (also through MCP `save(format='usd')`). The wasm writes "Gr____e" and "______",
  which collide. STEP turns "Größe" into "Gr??e" (the \X2\ encoding is the open
  ai/todo/files.md #16).
- Do: decode UTF-8 and map one code point at a time; write the original as `displayName`
  (or `customData` `smlibpy:name`) and prefer it on read; tests in both suites.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| X5 | P2 | `usd-conformance-analytic-edges` | A USD round trip turns line and circle edges into B-splines (`circles()` 2 -> 0, `Edge.radius` raises, STEP writes B-splines); faces stay analytic. `import_usd.md:22` promises the same edges. | Reader: call `restore_analytic_curves` (move it out of `face_draft.cpp`'s anonymous namespace) in `usd_read`. Writer: emit BrepCurve3dLine/Circle/EllipseAPI in the vendored `SmuConvert.cpp` (about 2156-2203 and 1623). Needed for X14 export. | medium | both |
| X7 | P2 | `usd-conformance-partial-import` | The first failing body discards the file; `str(KernelError)` is "import_usd failed (SM_ERR)", the prim name only in `.detail`. | `std::invalid_argument` with the prim path (-> ValueError), or the detail in the message; `import_usd(partial=False)` / `fromUsd({partial})` with one warning per skipped body (upstream has `allow_partial`). | small | both |
| X9 | P3 | `heal-smb-part-container-attributes` | `.smb` holds one body without name or color (ai/todo/files.md #15). `SmBrepData::WritePartToFile` holds several Breps with attributes but no placements (the assembly reader and writer are stubs; binary boolean-tree nodes are written twice). USD already round-trips several bodies with names, colors and cells. | `write_part`/`read_part` with `SM_AI_COLOR` and a name attribute (`.smp`), or name and color on `.smb`. | medium | both |
| X10 | P2 (low-value wrong result) | `usd-conformance-empty-bodies` | An empty body is written as a schema-invalid BrepArray (inverted ±1e20 extent, `shellCount [0]`) with `mesh=False`, and fails with "tessellate failed" with `mesh=True` (STL too). | Raise "export_usd: <name> is empty" as `export_step` does; reject shell-less bodies in `check()`. | small | both |
| X11 | P2 | `wasmapi-python-in-memory-io` | Python has no in-memory I/O; the TS port has `toStep`/`fromStep`, `toStl`, `toGlb`, `toDxf`/`fromDxf`, `toUsd`/`fromUsd`, `toSmb`/`fromSmb`. The writers already build the text in memory. | `to_step`/`from_step`, `from_step_model`, `to_stl`/`from_stl`, `to_obj`, `to_glb`, `to_gltf`, `to_dxf`/`from_dxf`, `to_usd`/`from_usd`, `to_smb`/`from_smb`; `export_*`/`import_*` wrap them; fonts from bytes. | small | Python |
| X12 | P3 | `usd-conformance-materials` | Material bindings are dropped; the corpus materials are MDL reached through references, with a PreviewSurface fallback. Per-body colors from bindings are reachable; per-face colors need T5. | After X2's reference resolution: walk `outputs:surface` to the PreviewSurface `diffuseColor`; per-body color; optional `export_usd(materials=True)`. | medium | both |
| X13 | P3 | `usd-conformance-mixed-dimension` | A solid with wire edges, loose faces or points is an invalid Part from USD and a Shell from `.smb`; `export_usd(edge)` gives "'Edge' object is not iterable". | Warn naming the extra components; a clear TypeError for curves. | small | both |
| X14 | P3 | `usd-conformance-occt-brep` | OCCT `.brep` import through usd-brep's OCCT bridge works on all 29 corpus files in a prototype (analytic types kept, 1-15 ms each); export needs X5 (16 of 29 fail to re-read without it); +0.38 MB of wasm (+6%), import alone +0.23 MB. STEP already gives OCCT tools exact interop. | Vendor the bridge into `src/cpp/occt`, import first; export after X5. | large | both |

Status (phase 1) of the items in the table:

- X5: done, 970f486 (lane IX): line, circle and ellipse edges written with the schema's APIs;
  `restore_analytic_curves` (now in analytic.cpp) on import, circles only on analytic faces.
- X5 (close-out): later: circles on NURBS faces, other writers' ellipses.
- X7: done, 970f486 (lane IX): `partial=`, the body named in the error.
- X9: done, 6e43570 (lane IX): `.smp` part files (`ext.part_bytes`, `ext.part_items`) with names,
  colors and curves; `.smb` unchanged.
- X9 (close-out): later: `.smp` placements, points and meshes; `.smb` names and colors.
- X10: done, 6e43570 (lane IX): ValueError for empty bodies in `export_usd` and `tessellate`.
  `export_step` still leaves an empty body among others out silently.
- X10 (close-out): done, M (7bd25a9): `export_step` of a list with an empty body, and the mesh
  writers of nothing, raise.
- X11: done, 6e43570 (lane IX): Python's in-memory I/O, fonts from bytes.
- X12: done, 6e43570 (lane IX): material bindings read (preview surfaces, node graphs, references),
  `export_usd(materials=True)`. Not done: materials of faces, collection bindings, textures.
- X12 (close-out): later: face materials, collection bindings, textures.
- X13: done, 6e43570 (lane IX): warnings for bodies of mixed dimension; TypeErrors naming the
  writers that take curves.
- X13 (close-out): later: USD curves.
- X14: partial, 97195f6 (lane IX): usd-brep's OCCT bridge vendored in src/cpp/occt with its defects
  fixed, import and export, pcurves, the writer's check, the SmCurve `sm_FilterSolution` patch. Not
  done: binary writing, names and colors, loose curves, the edges the staging rebuilds backwards (4
  of 557 corpus solids).
- X14 (close-out): done, M (7bd25a9, b4462a6): tolerances per edge, vertex and face in the reader
  and writer (`usd_tighten_tolerances`), sliver faces, caps round a pole, loops that overshoot a
  period, a check at 128 points an edge, planes boxed by 256 points and the spans' control points:
  of the corpus 585 of 585 bodies written and 557 of 559 solids read back; the spring example within
  2e-7. Later: binary writing, names and colors, loose curves and points.

### M. Meshes and drawings

Goal: meshes are as accurate as asked and consistent with their arrays; drawings come out as
exact vectors.

**M1 · P0 · Mesh Booleans use the kernel mesh from before an array edit** · `mesh-stale-kernel-mesh` · small · both
- Status (phase 1): done, de5795c (the symptom went with W3 in 1e82ba4): a checksum guards the
  kept kernel mesh; `Mesh.translate/rotate/mirror/scale/moved` added.
- Wrong: a Mesh keeps the kernel PolyBrep it was tessellated from, and `_poly_brep()`
  returns it without comparing it with the arrays (`mesh.py:65-75`, `mesh.ts:116-117`). After
  the documented way to move a mesh (`m.vertices += [10, 0, 0]`, `Mesh.md:74`), or after
  assigning new arrays, mesh Booleans run on the old geometry; render, raycast and exports
  use the new one. `tessellate(Face)` also keeps an unflipped kernel mesh for flipped
  triangles.
- Do: a fingerprint or version counter of the arrays, taken when `_poly` is set and compared
  in `_poly_brep()`/`_polyBrep()`, rebuilding through `ext.poly_from_triangles` on a
  mismatch; `Mesh.translate/rotate/scale/mirror/moved/transformed` returning new Meshes.
  (Read-only arrays would break the documented in-place `+=`.) Also fix the mesh-Boolean docs
  that contradict each other (`import_stl.md:23`, `export_stl.md:40`, `Mesh.md`) and close the
  stale ai/todo/files.md #17 (merged-mesh Booleans work: 186.0).
- Repro:
  ```python
  a = Box(20, 20, 20).mesh(); b = Sphere(5).mesh()
  b.vertices += [10, 0, 0]
  (a - b).volume      # 7478.54 (the unmoved result); right 7738.2. Mesh(b.vertices, b.triangles) gives 7739.27
  ```

**M2 · P0 · Sphere meshes are 68x off the tolerance near the poles** · `mesh-sphere-pole-slivers` · medium · both
- Status (phase 1): done, de5795c: edge splitting on surfaces of revolution, halving for
  free-form faces the grid misses (free-form splitting was too slow).
- Wrong (known, ai/todo/files.md #3): the grid tessellator leaves long slivers near both
  poles of sphere faces whose pole regions are untrimmed. 48 of 14080 triangles exceed 0.02,
  with edges up to 7.24 mm. Halving gives 0.329, `max_edge_length=2` 0.137; `angle=5` helps
  only at coarse tolerances (0.001 is still 40% over). Hemispheres and ball ends made by
  Booleans stay within tolerance (0.0076 at 0.01). A related, separate defect: on an
  interpolated 21 x 21 sheet with one point raised 5 mm, the grid path at 0.01 reaches only
  zmax 0.1629 (halving 5.0), and "auto" picks grid. The sphere case is documented (the
  `Mesh.md` gotchas, with `angle=5`, which helps only at coarse tolerances); the item stays P0
  for the undocumented freeform case.
- Do: a deviation pass in `src/cpp/tessellate.cpp` (both builds): for triangles whose
  longest edge exceeds sqrt(8·R·tol), estimate the deviation (closed form for analytic
  surfaces, closest point otherwise), split the longest edge and its neighbour onto the
  surface, repeat until within tolerance (about 0.3% of the triangles; stays watertight).
  Check the grid result of freeform faces with `grid_deviation`, as `choose_algorithm`
  already does for twisted faces. Then close #3.
- Repro: `tessellate(Sphere(10), 0.01, 15)` deviates up to 0.6783 from the sphere.

**M3 · P1 · Mesh vertices pass through float32** · `mesh-float32-vertices`, `wasmbind-float32-mesh-arrays` · small · both
- Status (phase 1): done, 1f1023d (lane M): `ext.poly_arrays` with float64 points in both builds,
  used by meshes and render; glTF positions relative to a node translation per shape; OBJ with 12
  digits; STL stays float32.
- Wrong: SmPyLib's `polybrep_to_numpy_arrays` and its copy in `js/cpp/mesh.cpp` return
  float32 points; Mesh stores float64 and the docs say float64. Worst vertex error at
  tolerance 0.001: 4.7e-4 at 1e4 mm, 3.8e-3 at 1e5 mm (3.8x the tolerance), 3.1e-2 at 1e6 mm;
  a box at 1e6 mm has mesh volume 1107.72 against 1113.12. Parts within 1 m of the origin
  are off by at most 1e-5. Affected: `Mesh.volume/area/bbox`, OBJ, meshes rebuilt from arrays.
  P1, not P0: the error exceeds the tolerance only for parts more than 10 m from the origin.
- Do: `ext.poly_arrays` in `src/cpp` with double points (adapt `js/cpp/mesh.cpp`), used by
  `mesh.py`, `render.py` and `mesh.ts`; narrow to float32 only in the STL and glTF writers;
  glTF positions relative to each body's centre with the centre as node translation.

**M4 · P1 · Exact drawing views with hidden lines** · `mesh-hidden-lines-hcr`, `surface-silhouette-is-hlr` · medium · both
- Status (phase 1): done, 1f1023d (lane M): `ext.hidden_lines` (SmHCR, post-processed),
  `outline(plane, hidden=, tangent_edges=)`, `silhouette()` as contour generators (draft's
  `_contour`, also on Shells), `drawing_views`, `export_svg`, DXF layers VISIBLE and HIDDEN.
- Status (close-out): done, with a known kernel limitation, R (f9fdcf2, e024388) and M (b4462a6):
  `_drawn` leaves out specks within 10 times the tolerance (judged by control points), keeps a piece
  it cannot rebuild as projected and draws a line lying on a longer one once: `Torus(20,
  5).outline(Plane.YZ)` no longer raises (8 edges, 111.416); 27 shapes x 6 views, with and without
  hidden lines: 0 errors in both builds. `drawing_views` takes a list of bodies. Blocked: SmHCR
  misjudges pieces of tilted views (the flange along (1, 1, 1) natively 61.4 mm short; not located).
  Later: dimensions and a title block.
- Gap: drawings exist only as raster images; `outline()` gives visible lines only. SmHCR
  computes hidden curves and SM_API discards them (84 ms per view on the valve).
  `silhouette()` returns SmHCR's visible curves, not contour generators: a box seen along
  (1,1,1) gives its 9 visible edges (180 mm) instead of the 6-edge outline (120 mm); a torus
  from +X gives 157.08 against 314.159. Raw HCR output needs post-processing (edges seen
  end-on, hidden pieces under visible lines, slivers), and with smooth edges off no fillet
  tangent lines appear.
- Do: `src/cpp/hidden_lines.cpp` `ext.hidden_lines(brep, dir, tol, angle, seams,
  smooth_edges) -> (visible, hidden)` projected to the view plane;
  `Part.outline(plane, hidden=False, tangent_edges=False)`; `silhouette()` returns contour
  generators only, through `draft.cpp`'s exact silhouettes (also for Shells);
  `drawing_views(part, views, projection)` exported by `export_dxf` with VISIBLE/HIDDEN
  layers (a DASHED linetype) and a small SVG writer. Bind in `js/cpp`.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| M5 | P2 | `mesh-batch-raycast` | `Mesh.raycast` tests every triangle (15.7 ms per ray on 134k triangles); the cached kernel ray tracer is about 400x faster (0.036 ms). `Part.raycast` is 0.06-0.2 ms per ray, except when the kernel's curve-face intersection fails: then it re-meshes the whole body on every call (4.5 ms per ray on `Cylinder(10,20)` along its axis; 713 ms on a 150-face plate). | Cache `face_meshes` on the body handle (cheap); `ext.poly_first_hits(poly, origins, dirs)` -> `Mesh.raycast_many`, `Part.raycast_many` refined onto the exact faces; bind in wasm. | medium | both |
| M6 | P2 | `mesh-decimate` | No decimation; `SmPolyDecimate` works and keeps meshes closed (50%: max deviation 0.0022). Its "maximum error" is an accumulated quadric (0.05 collapsed a sphere to 390 triangles, 5.3 mm off). | `ext.decimate_poly(poly, fraction, feature_angle, keep_boundary)`; `Mesh.decimate(fraction=, triangles=, tolerance=)` with smlibpy measuring the deviation; closed and volume checks. | medium | both |
| M7 | P2 | `mesh-section` | No section of a mesh; `k.PolyBrep.section_plane` works (177.690 against 177.699) but returns unordered segments, and a plane on a planar mesh face gives an incomplete loop (174.70). | `Mesh.section(plane) -> Wires` (kernel or numpy crossings, chained), nudging coplanar planes; `Mesh.slices`, `Part.slices`. | small | both |
| M8 | P2 | `mesh-to-part` | STL meshes can become faceted Parts with public calls (`stitch` of `make_face` per triangle; 3584 triangles in 3.0 s), but undocumented; `SmBrep::CreateFromPolyBrep` takes 0.22 s. Booleans on large faceted parts get slow (14080 triangles: 40 s). | `Mesh.to_part()` / `Part.from_mesh(mesh, max_faces=5000)` with coplanar merging and a size guard; document it. | small | both |
| M9 | P3 | `mesh-repair` | Open STL meshes can only be detected. `FillLaminaHoles` closed small holes in a probe (only 3-edge holes tested). | `Mesh.fill_holes()`, `Mesh.repaired()` reporting what was done. | small | both |
| M10 | P3 | `mesh-tess-params` | `max_edge_length` is plumbed but not public (tolerance 0.1: longest edge 100 -> 12.9 with 10); with it, twisted faces silently fall back to grid. `max_aspect_ratio` has no effect on triangles. `allow_partial`: addressed by the smlibpy-three draft (Phase 0). | `max_edge=` on `tessellate`/`mesh`/`export_*`; warn when it forces grid on a twisted face. | small | both |
| M11 | P3 | `mesh-mass-properties` | No mesh centroid or inertia (`k.PolyBrep.mass_properties` works); `bbox()`/`center()` of an empty mesh raise a bare numpy error in Python (TS already raises a clear RangeError). | `Mesh.mass_properties(density)` (numpy or kernel), `Mesh.centroid`; a clear error for empty meshes. | small | both |
| M12 | P3 | `mesh-export-normals-indexing` | OBJ is written without normals; glTF is unindexed (3888 corners against 712 unique on the bracket); mesh Boolean results have no normals. | `vn` lines; deduplicated corners and an index accessor; normals transferred from the operands. | small | both |
| M13 | P3 | `mesh-pyray-keepalive` | `_core.PolyBrep.ray_intersection` (SmPyLib) raises "Could not activate keep_alive!" on every hit; smlibpy does not use it. | Use M5's binding instead; note it in `docs/kernel.md` (the patch mechanism covers SMLib and SM_API only). | small | Python |

Status (phase 1) of the items in the table:

- M5: done, 1f1023d (lane M): `raycast_many` (the kernel's ray tracer, hits moved onto the faces),
  face meshes cached.
- M5 (close-out): done, M (7bd25a9): a ray that passes within twice the mesh's tolerance of a
  triangle before its hit (or anywhere, for a miss) is cast exactly (`src/cpp/rays.cpp`, a box
  tree): of 2000 rays across a sphere's outline 297 differed from `raycast`, now none. U (dc07edb):
  `raycast` beside a seam, kernel patch `SmEllipse.cpp` (`ConvertToPolarParameter` asked
  `STEPInversion` with the zone tolerance).
- M6: done, bd60eab (lane M): `Mesh.decimate` (SmPolyDecimate with its folds repaired, the distance
  measured).
- M6 (close-out): done, M (7bd25a9): folded slivers collapsed after decimation (0 in 9 cases), and
  `feature_angle=`.
- M7: done, bd60eab (lane M): `Mesh.section`, `Mesh.slices`, `Part.slices`.
- M8: done, bd60eab (lane M): `Mesh.to_part`, `Part.from_mesh` (CreateFromPolyBrep after a strict
  coplanar merge).
- M8 (close-out): later: non-planar regions.
- M9: done, bd60eab (lane M): `Mesh.fill_holes`, `Mesh.repaired`.
- M9 (close-out): later: a faired patch.
- M10: done, bd60eab (lane M): `max_edge=` with the twisted-face warning.
- M10 (close-out): later: `max_edge` with halving, `max_aspect_ratio`.
- M11: done, bd60eab (lane M): `Mesh.mass_properties`, `Mesh.centroid`, the empty-mesh error.
- M12: done, bd60eab (lane M): OBJ normals, indexed glTF, normals of mesh Booleans.
- M13: done, bd60eab (lane M): `PolyBrep.ray_intersection` bound again with the mesh as parent
  (Python); docs/kernel.md row.

Leftovers of the smlibpy-three overlap: the cone apex normals (MESH-APEX) and linear glTF colors
  (GLTF-COLOR) are done, 1f1023d (lane M).

### A. Measuring and analysis

Goal: distances, closest points, curvature and continuity are numbers a user can rely on.

**A1 · P0 · Body distance overestimates clearances between nearly parallel faces** · `vol-distance-skew-faces` · medium · both
- Status (phase 1): done, de5795c: `ext.nearest_points` (damped Newton on the joint
  parameters); 101 random pairs within 1e-15 of OpenCASCADE.
- Wrong: `_body_distance` (`shapes.py:1708-1756`, `shapes.ts:1953-2005`) seeds only from
  mesh vertices and alternates closest-point projections for at most 500 steps. Between
  nearly parallel curved faces convergence is linear and the cap is hit: still 2.4845 after
  500 steps and 2.00072 after 3000 at 5 deg. The result is returned without a warning, in
  the dangerous direction for fit and interference checks. `analysis/distance_to.md` promises
  1e-11.
- Do: seed from a UV grid inside every face; finish with Newton on (u1, v1, u2, v2) using
  `ext.surface_derivatives`, falling back to curve-surface Newton on boundary edges; as a
  stopgap, warn when the cap is hit. Best in C++ for both builds. Fix `distance_to.md`, which
  also recommends `len((a & b).faces()) > 0` as an overlap test (11 s on separate many-faced
  parts until B13). Tests at 1, 5 and 10 deg.
- Repro:
  ```python
  a = Cylinder(5, 200)
  b = Cylinder(5, 200).rotate(Axis.X, 5).translate((12, 0, 0))
  a.distance_to(b)     # 2.4853 (1 deg: 2.1197, 10 deg: 2.0162); the gap is 2.0
  ```

**A2 · P1 · Closest points between shapes** · `vol-closest-points`, `vol-face-edge-closest` · small · both
- Status (phase 1): done, 17d7458 (lane DA): `closest_points` and `ClosestPoints`, distances to
  faces, edges and wires (`ext.nearest_curve_points`), `Face.closest_point`, `uv_at`, `position_at`,
  `Edge.closest_point`, `param_at_point`, `Wire.closest_point`; on A1's Newton.
- Status (close-out): U (dc07edb, 0a3538c): `distance_to(point)` and `closest_point` find the
  nearest point of a B-spline face that folds back (`ext.nearest_point`: every face and knot span
  that could hold a nearer point): none of 215 cloud points farther than a 300 x 300 sampling (the
  kernel: 5, up to 0.245); about 2 ms on a thickened sheet.
- Gap: `Part.distance_to` returns only the number, although `_body_distance` holds the
  witness pair; edges and wires raise TypeError. Face and Edge have no `closest_point`,
  although `k.Face.closest_point` and `k.Edge.closest_point` are bound in both builds, respect
  trims, and return the point and parameter (ai/todo/analysis.md #9). Face-to-body distance
  already works through `face.to_shell()`.
- Do: `Part/Shell.closest_points(other) -> (p, q, distance)` with the faces they lie on;
  `distance_to`/`closest_points` accept Edge and Wire (seeded by `k.curve_closest_point`);
  `Face.closest_point`, `Face.uv_at`, `Edge.closest_point`, `Edge.param_at_point` (with C2),
  `Wire.closest_point`. TS twins. The pair inherits A1's defect until A1 is fixed.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| A3 | P2 | `vol-curvature-query`, `surface-face-analysis` | No numeric curvature or surface access. `ext.face_curvatures` is bound in both builds and called nowhere (a sphere of R10 gives k1 = k2 = 0.1). `Face.radius` gives only a torus' minor radius; `surface_data` holds the major radius and a cone's angle. | `Face.curvature_at` (with principal directions), `Face.min_radius`, `Face.position_at(u, v)`, `Face.parameters(point)`, `Face.nurbs()`, `Face.isocurve(u=, v=)` (CreateIsoParametricCurve, clipped), `major_radius`, `cone_angle`; `Edge.curvature_at` (with C9). The wasm bindings exist. | medium | both |
| A4 | P2 | `vol-continuity`, `topo-continuity` | No G0/G1/G2 query across edges; "smooth" is a 0.5 deg test at the midpoint. `SmEdge::GetContinuity` told G1 from G2 rounds in a probe, but its source has defects: the G2 test compares a normal with itself (`SmGeomUtility.cpp:5822`), uses the raw second derivative as curvature, gets the wrong derivative arrays (`SmEdgeuse.cpp:726-727`), ignores its tolerance argument, and returns DISCONTINUOUS (1) for the creases of a G2 blend. | `Edge.continuity(samples=16)` in `src/cpp/surface_eval.cpp`: gap, normal angle and normal-curvature jump across the edge, with the worst point; `ShapeList.g1()/g2()`; `Wire.continuity`; multi-sample convexity. | medium | both |
| A7 | P2 (low-value hang) | `input-corpus-measure-budget` | `measure.cpp` has panel and round caps but no time budget: a body with a face crossing its surface seam (built through private internals; no public input known) ran `.volume` for over 40 s. `is_valid()` already says invalid in milliseconds. | Refuse faces that `seam_problems` flags as crossed, or add a per-face evaluation budget. | small | both |
| A5 | P3 | `vol-section-props` | No section properties; exact today through `sketch.extrude(1).mass_properties()` minus A/12 (to 1e-12), and thin-wall properties through `thicken`. | `Sketch.section_properties()` in Python over that route; C++ moments later if wanted. | small | both |
| A6 | P3 | `vol-massprops-extras` | No inertia about a point or axis, no radii of gyration; the parallel-axis recipe is documented. | `inertia_about(point)`, `moment_about(axis)`, `radii_of_gyration`. | small | both |

Status (phase 1) of the items in the table:

- A3: done, 17d7458 (lane DA): `ext.face_curvature`, `face_min_radius`, `face_iso_curves`;
  `Face.curvature_at`, `min_radius`, `nurbs`, `isocurve` (C12's `Face.iso` uses the same binding),
  `major_radius`, `cone_angle`; `Face.parameters` is `Face.uv_at`.
- A4: done, 17d7458 (lane DA): `ext.edge_continuity`, `Edge.continuity`, `Wire.continuity`, `g1()`,
  `g2()`, convexity at several points.
- A7: done, 17d7458 (lane DA): an evaluation budget per face in measure.cpp, KernelError for a
  crossed seam.
- A5: done, 17d7458 (lane DA): `Sketch.section_properties()`.
- A6: done, 17d7458 (lane DA): `inertia_about`, `moment_about`, `radii_of_gyration`.

### D. Deformation and sheet metal

Goal: sheet-metal unfolding takes real K-factor rules and rolled parts; deformations keep
analytic faces where the image is analytic.

**D1 · P1 · Per-bend K-factors** · `vol-kfactor-table` · small · both
- Status (phase 1): done, 17d7458 (lane DA): fold, flange and bend record their K on the part;
  `k_factor=` takes a function, a mapping, (r/t, k) pairs or 'din6935'; resolved per bend,
  `Bend.k_factor`. Not done: records in files (a part read back unfolds at 0.44).
- Status (close-out): done for `.smp`, U (dc07edb): fold records (axis, inside radius, K) written as
  a smlibpy attribute in `.smp` (ASCII and binary) and restored by `from_smp` and `load`: a part
  folded at 0.33 and 0.45 and read back unfolds to 200 (it was 200.314). Blocked: `.smb` (the
  kernel's body writer keeps no attributes). Later: STEP.
- Gap: `unfold`, `flat_pattern` and `bends` take one K-factor for every bend, and
  `fold()`/`flange()` do not record theirs, so a fold round trip is lossy: a 200 mm blank
  folded at R1 with k 0.33 and at R6 with k 0.45 unfolds to 199.623 or 200.377, never 200.
  A dict raises TypeError.
- Do: `k_factor` as a float, a callable (radius, thickness, angle) -> k, a mapping from
  inside radius to k, (r/t, k) pairs, or `'din6935'`; resolve per bend in `_unfold`; report
  it in `Bend.k_factor`; record fold's K on the part. TS the same; document in
  `docs/sheet-metal.md`.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| D2 | P2 | `vol-deform-analytic` | `bend` and `taper` turn faces with an analytic image into B-splines: `Box(200,40,10).bend(90, radius=25)` has 4 B-spline faces where `fold` gives cylinders; a tapered cylinder has no cone. `cylinders()`, `circles()`, `radius` and `axis` fail, STEP writes NURBS, and `bends()` of a `Part.bend` result is [] (unfold raises). | `SmBendVolume::MakeExactBSpline1stOutSurface/Curve` in `deform.cpp` before fitting; recognition after taper, lattice and affine maps; keep unmoved faces analytic (D7); fix the "no NURBS can reproduce" wording; point sheet parts to `fold`. | large | both |
| D3 | P2 | `vol-unroll` | Rolled sheets cannot be flattened: a 90 deg segment without flats fails (SM_ERR_INVALID_INPUT), a J-shape with a flat on one side only too, and a 270 deg ring is refused. `SmUnbendVolume` is complete and used only inside `sheet_unbend`. | An "unbend" piece in `deform.cpp`; `deform.unroll`/`Part.unroll`; `unfold` unrolls bodies without a flat region or with bends over 180 deg at r + k·t; document the limits. | medium | both |
| D4 | P3 | `vol-deform-docs-stale` | `docs/deform.md:45-46`, `deform/generic.md:38-39, 69` and `bend.md:51-52` still say `part.volume` is 4e-4 off on bent parts and teach `accuracy=1e-10`; `part.volume` comes from `measure.cpp` now (9999.999986 for a bent 10000 box). | Update the docs; mark ai/todo/deform.md #2 fixed. | small | both |
| D5 | P3 | `vol-sm-hole-splines` | Bend-zone holes are 1e-4 fits (documented). New: `flat_pattern` returns a hole that crossed the bend as 3 arcs and 2 B-splines, awkward for DXF/CAM. | Merge co-circular pieces (and lines and arcs within 1e-6) in the flat-pattern contour; refitting the bend region at 1e-6 is optional. | medium | both |
| D6 | P3 | `vol-deform-curves` | Edges and wires cannot be deformed; only `Lattice.map` exposes a point map. | `deform_curve` on the per-edge fitter; Edge/Wire in twist, taper, bend and Lattice; a public `map_point` for each deformation. | medium | both |
| D7 | P3 | `nlib-shape-lattice-locality` | The docs say "more points give more local control", but a Bezier lattice moves the whole box; faces the map leaves in place still become B-splines. | Fix the wording and point local edits to U7; keep unmoved faces analytic (D2). Optional, not probed: `SmBSplineSurface::DegreeReduction` (live, unused) might shrink the degree-12 lattice faces. | small | both |

Status (phase 1) of the items in the table:

- D2: done, 312d0bc (lane DA): src/cpp/deform_analytic.cpp, a recognition of its own by sampling the
  exact map (MakeExactBSpline1st... not used); a bent plate is sheet metal; STEP writes the
  cylinders. No torus or sphere images.
- D2 (close-out): R (f9fdcf2): a twist keeps the cylinders, cones, spheres and tori about its axis
  that full circles about it bound (`src/cpp/deform.cpp`: the faces, edges and vertices a twist
  leaves in place): `twist(Cylinder(5, 40), 90)` is a cylinder and two planes, 3141.592654, exact;
  54 of 162 survey results have no B-spline face (0 before). Later (U): torus and sphere images of
  bends (the torus' seam).
- D3: done, 312d0bc (lane DA): an unbend piece, `unroll`, rolled parts, curls and bends over 180
  degrees.
- D3 (close-out): later: rolled parts and end bends that span only part of the width.
- D4: done, 312d0bc (lane DA): the docs and deform #2.
- D5: done, 197d83e (lane DA): the outline as lines, arcs and circles; bend-zone edges within 1e-7;
  the depth by edges. Bend-zone faces stay 1e-4 fits.
- D5 (close-out): done, U (dc07edb, 5744724): bend-zone faces fitted keeping their parameters
  (`fit_surface_keeping_parameters`) within 1e-6, exact where they can be, their trims rebuilt after
  the edges: a hole wholly inside a bend zone unfolds valid (its wall's area was 2.6 for 113), a
  square hole's walls round trip to 3e-14.
- D6: done, 197d83e (lane DA): `deform_curve`; the deformations take edges, wires and points (in
  place of a `map_point` each).
- D6 (close-out): done, U (86027ab): checked: `twist`, `taper`, `bend`, `unroll` and `Lattice.map`
  map points as they map bodies (vertex images on the deformed body to 1e-9); no separate
  `map_point`.
- D7: done, 197d83e (lane DA) and the release's docs commit (the pointer to `Part.push`); unmoved
  faces keep their type with D2. DegreeReduction not used.
- D7 (close-out): done, R (f9fdcf2): the `Lattice` docstrings and docs/deform.md say a lattice is a
  global map and point a local bump to `Part.push` and `Part.warp`.

### W. smlibwasm runtime and parity

Goal: the wasm build stays usable in long-running pages: no stack or heap exhaustion, no
frozen tabs, no silently wrong answers from stale objects or ignored options.

**W1 · P0 · Failed kernel calls leak the wasm stack pointer** · `wasmbind-stack-pointer-leak` · small · wasm
- Status (phase 1): done, 1e82ba4 (group W): every bound function restores the stack on throw;
  `--stack-first`.
- Wrong: embind restores the shadow stack only for invokers that pass arguments on it, so
  every kernel error thrown as a JS exception, and every trap, leaves `__stack_pointer`
  lower: 16 bytes per raw kernel error, 336 per `raycast` that misses the side face, 904 per
  failed `Part.shell`, 7,696 per trap. At about 3.9 MB of the 4 MB stack every call fails
  for good ("Cylinder failed", then "offset is out of bounds"). Before that the stack runs
  through static data (no `--stack-first`). That is about 240k errors, 11k missed raycasts
  (a viewer that picks on hover gets there in minutes), 4,300 failed shells or 500 traps.
- Do: link with `-sEXPORTED_RUNTIME_METHODS=FS,stackSave,stackRestore` and wrap every bound
  function in `kernel.ts` (`namespaced()`, `keywords()`, the ext/deform submodules) with a
  save, and a restore on throw; verified: 300,000 failing calls leave the stack pointer
  unchanged. Add `-Wl,--stack-first` so an overflow traps instead of corrupting data. Test:
  20,000 missed raycasts, then `Box(30,20,10).cut(Cylinder(4,20)).volume` is still 5497.3452.
- Repro:
  ```ts
  const c = Cylinder(5, 20)
  for (let i = 0; i < 20000; i++) c.raycast([4.9, 4.9, -30], [0, 0, 1])   // 336 bytes of stack each
  ```

**W2 · P0 · No time limit or isolation for kernel steps in the wasm** · `wasmapi-defeature-guard-hang`, `wasmbind-no-worker-no-cancel`, `offset-wasm-trap-guard` · large · wasm
- Status (phase 1): done, 1e82ba4 (probe worker with `Atomics.wait` for `removeFillets`,
  `removeFaces`, `surfaceFillet`; group O fixed its start under `node --test` and reused it for
  shell/offset/thicken). The page's main thread still runs steps directly; the
  `@classcad/smlibwasm/worker` RPC entry is deferred.
- Status (phase 1, follow-up): done, b660ed1 (lane WN): `@classcad/smlibwasm/worker` (`expose`,
  `KernelWorker` with timeouts, AbortSignal and respawn; bodies as `.smb`). Not done: the deadline
  counter in the feature executive and main-thread async variants.
- Status (close-out): done, W (c10f34c): a deadline inside the kernel (`ext.set_deadline`,
  `SMLIBPY_DEADLINE_ER` in the patched `SmMessages.h`, checked in `SmAdvSurfaceIntersector`,
  `SmSurfaceIntersector`, `SmTopologyIntersector`, `SmSurfaceDropCurve` and
  `SmFeatureExecutive::ExtSurfaceRebuild`, where samples and profiles found the looping steps; lldb
  saw no new entries into the executive's loops the plan named). A guarded step run in this kernel
  is held to `GUARD_SECONDS`: the enclosure's round with 2 s raises after 2.10 s (Python) and 2.05 s
  (smlibwasm); ASan 747 passed, 0 reports.
- Wrong: `removeFillets(partial=true)` on the shipped enclosure and bottle examples
  busy-loops forever in the wasm (killed after 200-300 s at 99% CPU); Python's fork guard
  finishes the same calls (enclosure: 39 of 51 removed, 49.9 s). In a browser the
  tab freezes. Use-after-free in the wasm mostly corrupts memory silently instead of
  trapping. What exists: the package already runs unchanged in a Web Worker or
  `worker_threads` (4 workers built 80 models in 562 ms against 1,672 ms in one), toSmb/fromSmb
  move bodies losslessly, and `terminate()` stopped a stuck worker in 203 ms.
- Do: (now) a "Running off the main thread" section in `docs/javascript.md`. (Then)
  `@classcad/smlibwasm/worker`: RPC with bodies as SMB bytes and meshes as transferables,
  per-call timeout and AbortSignal, terminate and respawn. In `defeature._guarded`, where
  `Atomics.wait` is allowed (workers, Node), dry-run each step in a probe worker on the SMB
  with `GUARD_SECONDS`; async variants for the main thread. Longer term, a deadline counter in
  the feature executive's loops (would also cover Windows Python). Resetting mark flags after
  a trap is not a fix (Not planned).
- Repro: `model()[0].removeFillets(undefined, { partial: true })` on `js/examples`' enclosure
  never returns.

**W3 · P0 · Meshes keep their kernel PolyBrep until the GC runs** · `wasmapi-mesh-polybrep-retained` · small · wasm
- Status (phase 1): done, 1e82ba4: meshes free their PolyBrep once the arrays are copied;
  `Mesh.dispose()` in both languages.
- Wrong: every Mesh keeps its PolyBrep (about 2.5 MB for the gear's 1484-triangle mesh),
  freed only by a FinalizationRegistry the GC does not run in time. 25 x
  `Sphere(20).mesh(0.005)` grow RSS to 2060 MB (686 MB after 5; 357-471 MB when the poly is
  freed);
  after about 50 large meshes `tessellate` fails with std::bad_alloc; 200 x `toStl` grow
  304 -> 728 MB. Internal temporaries (exporters, USD, render, htmlPage) are never freed.
- Do: Mesh `dispose()` and `Symbol.dispose` are addressed by the smlibpy-three draft
  (Phase 0). Still open: free the PolyBrep right after copying the arrays in
  `tessellate()`/`mesh()` (mesh Booleans rebuild it through `poly_from_triangles`; render
  curvature and `faceMeshes` ask for it explicitly), dispose internal temporaries, and a
  clear out-of-memory message (W8). Freeing early saves memory in Python too.
- Repro:
  ```ts
  const s = Sphere(20)
  for (let i = 0; i < 60; i++) s.mesh(0.005)     // 57k triangles each
  // RSS 2060 MB after 25 meshes; KernelError 'tessellate failed' (std::bad_alloc) at iteration 51.
  // Disposing each mesh's poly keeps RSS at 357-471 MB over 25.
  ```

**W4 · P0 · Sub-shapes of a disposed body read freed memory** · `wasmapi-use-after-dispose`, `wasmbind-stale-subshapes-after-dispose` · small · wasm
- Status (phase 1): done, 1e82ba4: sub-shapes of a disposed body throw a TypeError; standalone
  edges and wires have `dispose()`.
- Wrong: Face, Edge and Vertex keep raw kernel pointers after their body is disposed. Some
  answer with another body's geometry, some trap ("function signature mismatch"), and
  `Box(10,10,10).fillet(oldEdges, 1)` returned a result built from freed memory in 5 of 100
  runs (300 runs hung). `volume` on the disposed body says "is the part a closed solid?".
  Standalone Edges and Wires hold a CurveHandle with no public dispose.
- Do: turn `_f/_e/_v` into getters that check the owner's liveness (`BrepHandle.alive`) and
  throw "the part was disposed"; route measures through `_brep`; test. The draft's
  `Edge.owner`/`Vertex.owner` (Phase 0) provide the owner link. Give standalone Edges and
  Wires a public `dispose()` for their CurveHandle (W9's `scope()` then covers them too).
- Repro:
  ```ts
  const p = Box(10, 20, 30); const fs = p.faces(); p.dispose()
  for (let i = 0; i < 5; i++) Box(1, 2, 3)
  fs[0].center()    // Vector(0, 0, -1.5): a face of one of the new boxes, no error
  ```

**W5 · P0 · Unknown options and extra arguments are ignored** · `wasmapi-unknown-options-silent` · medium · wasm
- Status (phase 1): done, 1e82ba4: `js/src/_options.ts` generated from Python's signatures
  (`tools/gen_js_options.py`), checked in 91 entry points, kept in sync by tests in both
  suites.
- Wrong: options are destructured with defaults and never checked. A user who copies
  `k_factor` from the Python docs gets the default silently; `Rectangle(20, 10, {filet: 3})`
  and `Box(10, 10, 10, {aling: 'min'})` ignore the typo; `Rectangle(20, 10, 3)` drops the 3.
  Python raises TypeError for all of them. TypeScript catches only literal objects.
- Do: `_opts(name, options, allowed)` throwing TypeError with a camelCase suggestion, the
  allowed keys generated from Python's signatures with a test keeping them in sync;
  positional-count checks for constructors.
- Repro: `p.bends({ k_factor: 0.3 })[0].allowance` is 4.5239 (default K); with `kFactor` it
  is 4.0841; `flatPattern({ k_factor: 0.3 }).size.x` is 100.0 against 99.5602.

**W6 · P0 · ShapeList.at(point) returns the first element in JS** · `wasmapi-shapelist-at-point` · small · wasm
- Status (phase 1): done, 1e82ba4: `ShapeList.at` takes an index only.
- Wrong: ShapeList inherits `Array.prototype.at`, so Python's `faces().at(point)`, ported to
  JS, turns the point into index 0: `faces().at([0, 0, 15])` returns the bottom face. A
  negative index (`[-1]`) gives undefined and fails later in fillet. The rename to `atPoint`
  is listed only in `js/PORTING.md`.
- Do: override `at()` to throw TypeError for non-numbers ("select by point with
  atPoint(point)"); name the mistake in `_flattenEdges`/`_flattenFaces`; list `atPoint` in
  `docs/javascript.md` under "From smlibpy".
- Repro:
  ```ts
  Box(10, 20, 30).faces().at([0, 0, 15]).center()          // Vector(0, 0, -15): the bottom face
  Box(10, 20, 30).faces().atPoint([0, 0, 15]).first.center() // Vector(0, 0, 15)
  ```

**W7 · P1 · Bundlers and loader options** · `wasmbind-no-init-options`, `wasmapi-browser-runtime` · small · wasm
- Status (phase 1): done, b660ed1 (lane WN): the loader is patched after every link
  (`js/scripts/patch-loader.cmake`) and `@classcad/smlibwasm/init` takes locateFile, wasmBinary,
  wasmModule or instantiateWasm; webpack 5, esbuild and Vite 4.5 and 7.3 bundle the package. Not
  done: Vite 4 bundling a module worker that imports the package.
- Status (close-out): blocked (Vite 4), W (c10f34c): Vite 4.5.14 cannot build module workers nested
  three deep (three trivial files reproduce it); Vite 5.4.21 and webpack 5 build it, and
  docs/javascript.md gives the way round.
- Wrong/gap: the generated loader's `import("node:module")` breaks webpack 5 web builds
  (UnhandledSchemeError) and esbuild browser bundles, contrary to `docs/javascript.md:26-28`;
  Vite builds with a warning; bun does not emit the .wasm. The module is created at import
  with no options (`kernel.ts:26`), so CDNs, CSP setups and Electron cannot redirect it.
  `show()` throwing in a browser is intended and documented.
- Do: post-process the loader in `build-wasm.sh`/`prepack.mjs` to
  `import(/* webpackIgnore: true */ /* @vite-ignore */ "node:module")` (verified: webpack
  bundles and emits the .wasm); tell esbuild users to externalize `node:*`. Then an optional
  `init({ locateFile, wasmBinary, instantiateWasm })` before creation. The draft's kernel-free
  `@classcad/smlibwasm/geometry` entry (Phase 0) covers imports that should not load the
  6.5 MB module.

**W8 · P1 · Clear out-of-memory and C++ exception errors** · `wasmbind-opaque-cpp-exceptions`, `infra-wasm-oom` · small · wasm
- Status (phase 1): done, b660ed1 (lane WN): C++ exceptions caught by type without allocating
  (`runtime__exception_info`), `_cppError`, status SM_ERR_OUT_OF_MEMORY with a hint,
  `memoryUsage()`; `guard()` catches bad_alloc. EXPORT_EXCEPTION_HANDLING_HELPERS not used
  (deprecated, allocates).
- Status (close-out): done, W (c10f34c): a test caps the module at 160 MB and fills it until the
  kernel fails (`SM_ERR_OUT_OF_MEMORY`; the kernel works again after the parts are disposed); the
  hint says how far the memory grew.
- Wrong: `bind_kernel*.cpp` and `bind_topology.cpp` have no `guard()`, so C++ exceptions
  (std::bad_alloc when memory runs out) reach JS as an opaque `WebAssembly.Exception`: not an
  Error, no message, not a KernelError. Every later call throws the same object until an
  event-loop turn and a GC. Out-of-memory traps read "the kernel crashed (table index is out
  of bounds)". Memory use is not observable.
- Do: wrap all entry points in `smjs::guard` with `catch (std::bad_alloc&)` -> "the kernel
  ran out of memory (N MB in use)" (a `catch (...)` does not intercept JS exceptions thrown
  through `val`, so it is safe); optionally `EXPORT_EXCEPTION_HANDLING_HELPERS`;
  `memoryUsage()`; document the 4 GB cap.

**W9 · P1 · Synchronous loops never free; the port keeps its intermediates** · `wasmbind-sync-builds-never-free`, `wasmapi-gc-growth-scope` · medium · wasm
- Status (phase 1): done, 6a10005 (lane WN): `scope(fn)`, internal scopes in the public functions
  that make intermediates (35 left of 70 calls before, 0 now), `memoryUsage().handles` (the plan's
  kernelMemory), the Memory docs corrected.
- Status (close-out): done, R (f9fdcf2) and W (c10f34c): 26 methods and constructors that kept their
  intermediates (`Sketch.revolve`: +267 MB over 400 calls) run in `scope`; 400 disposed revolves
  leave no object. Later: `scope` following async functions.
- Wrong: finalizers run only between tasks, and the port disposes almost nothing itself (10
  `dispose()` calls in `js/src`). 1,000 synchronous regenerations grow wasm memory from 64 to
  476 MB while the JS heap stays at 14-22 MB; yielding every 10 iterations stays at 64 MB.
  Disposing only the result still grows (64 -> 133 MB over 400), contrary to
  `docs/javascript.md:100-102`.
- Do: dispose eagerly inside the port (rejected `_checked` attempts, failed tries, tool
  copies for Booleans and patterns, sketch temporaries); a `scope(() => ...)` API that frees
  every handle not reachable from the return value; `kernelMemory()`; document that
  finalizers run only between tasks.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| W10 | P2 | `wasmbind-trap-leaves-kernel-state`, `offset-wasm-trap-guard` (with W2) | Traps happen in normal use (extended shell on a filleted box, 1 in 8 raw attempts), and `kernelCall`/`_checked` keep retrying on the damaged heap, showing only the last SM_ERR; "the module stays usable" is optimistic. Stuck mark locks and DoingBoolean are benign by design and were not observed. | Count traps; warn after the first; stop retrying after a trap (O6); optionally mark the module poisoned or re-instantiate; correct `kernel.ts` and the docs. | small | wasm |
| W11 | P2 | `wasmapi-typings` | `render`/`show`/`htmlPage` take `...unknown[]`; free functions return unions without overloads (`extrude(sketch, 3).volume` does not compile); most option types are not exported; `node:fs` and `Symbol.dispose` leak into the d.ts (only with `skipLibCheck: false`). | Overloads, typed render arguments, exported option types, a structural `NodeFs`, `stripInternal`. | medium | wasm |
| W12 | P3 | `wasmapi-docs-body-methods-missing` | `api.mjs` drops `_Body`, so `dispose`, `named`, `colored`, `raycast`, `closestPoint`, `heal` and others are missing from the generated JS reference. | Flatten inherited members into Part/Shell/Sketch, or publish `Body`. | small | wasm |
| W13 | P3 | `wasmapi-fonts-woff2-seac` | WOFF2, CFF2 and seac accents fail in the wasm, and in Python unless fontTools is installed (no extra installs it). | Compose seac natively in both readers (cheap); WOFF2 needs Brotli and the glyf transform. | large | both |
| W14 | P3 | `wasmapi-input-types-inconsistent` | `fromDxf`, `fromDxfWires` and `loadFont` reject ArrayBuffer; `Text` rejects a Font; no in-memory `load()`. | One `_bytes` helper; accept Font; `fromFile(data, name)`. | small | wasm |
| W15 | P3 | `wasmapi-kernel-layer-unreachable`, `wasmbind-raw-kernel-gap` | `k` cannot be imported from the package; 94 of 156 `_core` functions are not bound in the wasm (none is used by smlibpy). | A documented-unstable `@classcad/smlibwasm/kernel` subpath; generate bindings and `signatures.ts` from SmPyLib's `py::arg` lists; bind new kernel calls in the same change. | medium | wasm |
| W16 | P3 | `input-corpus-wasm-fillet-divergence` | All-edge fillets of `vase1.smb`/`vase3.smb` succeed natively (3 of 3) and fail in the wasm (2 of 2, a real SM_ERR); 447 STEP and 187 `.smb` files otherwise import identically. The cause may be native FMA contraction rather than the wasm. | Add them to the cross-build list (N5); trace with N6. | medium | wasm |

Status (phase 1) of the items in the table:

- W10: done, 45602fd (lane WN): crashes counted, warned once and named; shell, offset and the
  defeaturing steps stop at one; a KernelWorker respawns. The module is not loaded again;
  `reset_after_trap` stays Not planned.
- W10 (close-out): done, W (c10f34c): about 110 fallbacks pass a crash on, and none runs for the
  rest of that event-loop task. Later: loading the module again.
- W11: done, 45602fd and 8c92eec (lane WN, integration): overloads, typed render options, exported
  types, `scripts/declarations.mjs`. A few options stay loosely typed.
- W11 (close-out): done, W (c10f34c): `FileOptions`, a `Lattice` and `{ tolerance }` for
  `Part.deform`, `HullItem`, `LocationLike`.
- W12: done, 45602fd (lane WN): inherited members in both API references.
- W13: done, 911b1f9 (lane WN): WOFF2, CFF2 and seac in both readers (own Brotli and inflate);
  fontTools no longer used.
- W13 (close-out): R (f9fdcf2): `Text` raises `FontError`, which `smlibpy` exports. Later: variable
  font instances, fonts of a collection other than the first.
- W14: done, 911b1f9 (lane WN): `_asBytes`, `fromFile`, `toFile`, `Text` takes a Font.
- W15: done, 911b1f9 (lane WN): `@classcad/smlibwasm/kernel`, SmPyLib's binders compiled against a
  pybind11 stand-in; signatures.ts is held to SmPyLib's py::arg lists by a test, not generated.
- W16: partial, 13fb24c (lane WN): traced (LoadInitialValues from CalcCornerVertGeom) and explained
  (native FMA: a build with -ffp-contract=off fails as the wasm does), listed in tools/parity.py's
  KNOWN. The build flags are left as a decision.
- W16 (close-out): done (the decision), W (c10f34c): the native build keeps contracting: without it
  the suite lost the two vase fillets and the fuzz seeds diverged in 12 operations instead of 10;
  recorded in docs/kernel.md and `tools/parity.py`'s KNOWN.

W2's worker entry and the docs' three.js snippet (DOCS-SNIPPET) are done, b660ed1 (lane WN).

### N. Runtime, infrastructure and CI

Goal: kernel crashes stay out of the user's process, and memory errors, leaks and
regressions are found by CI rather than by users.

**N1 · P1 · A general isolation utility that returns results** · `infra-guard-result-transfer` (with O1) · medium · both
- Status (phase 1): partly, with O1 (8194dcd): `defeature._isolated` returns the body as `.smb`
  and never re-runs the step, for shell, offset and thicken; fillets, `cells()` and opt-in
  Booleans are not isolated yet.
- Status (phase 1, follow-up): done, 6a10005 (lane WN): `smlibpy._guard.isolated` (a fork, or a
  helper process with `GUARD_PROCESS`), results back as `.smb` and pickles, never re-run; used by
  defeaturing, `surface_fillet`, shell, offset, thicken, `cells()`, fillets of imported parts and
  opt-in `GUARD_BOOLEANS`; smlibwasm's probe worker returns values. The helper was tested on macOS
  by forcing it, not on Windows.
- Gap: `defeature._guarded` forks, lets the child run the work, and then runs it again in
  the parent. That costs 1.3x on a realistic part (2.6x was fork overhead on a tiny call),
  and a layout-dependent use-after-free can still kill the parent. It covers only
  defeaturing and `surface_fillet`; shell, offset and thicken run unguarded, and Ctrl-C
  cannot stop a kernel call.
- Do: `smlibpy._guard.isolated(what, fn, inputs)`: the child serializes result Breps with
  `write_to_file` (the rest pickled over a pipe), and the parent reads them back with
  `read_brep_from_file` and never re-runs the step. Use it for extended shell, offset and
  thicken attempts (O1), fillets of imported bodies (F2), `cells()` (B5) and opt-in Booleans.
  On Windows and macOS spawn, a persistent helper process speaking `.smb`. Document that
  Ctrl-C works only for guarded steps. Wasm: W2.

**N2 · P1 · Sanitizer, leak and upstream-oracle jobs** · `infra-asan-ci` · medium · both
- Status (phase 1): partial, 6a10005 (lane WN): `.github/workflows/checks.yml`,
  `tools/sanitize/run.py` (ASan and LSan with known and leak lists; 134 passed on macOS with LLVM
  21), `tools/oracles` (prog_test 17 of 17, SmPyLib 366 passed, 200 `.smb` files, crash loops); it
  found smlibpy's leaked curve copies (fixed). Not done: a run on Linux; found and not fixed: the
  FindInterval overflow and the leaks in CreateSweepAlongPlanarPath and CreateProtoEdge.
- Status (close-out): W (c10f34c) and K2 (2ebcb64): the Linux-only defects found in an emulated
  container are fixed (an open round near the largest radius, a freed ProtoEdge in
  `SplitIntersectingProtoEdges`, parity files from platform bodies, the IX evaluator's first span,
  the oracle list); the leaks of `CreateSweepAlongPlanarPath` are patched and `CreateProtoEdge`'s in
  part. Blocked here: the `FindInterval` overflow (not reproduced), the rest of `CreateProtoEdge`'s
  leak, and the Linux and Windows runs, which CI verifies at the first push.
- Gap: CI runs Release builds only; the ASan procedure in `third_party/patches/README.md` is
  manual, macOS-only and sets `detect_leaks=0`; there are no RSS tests (B7 and I2 went
  unnoticed; a leak checker reports I2 immediately).
- Do: a scheduled or manual Linux job (RelWithDebInfo, `-fsanitize=address`, `LD_PRELOAD`,
  `detect_leaks=1` with suppressions) over `test_defeature`, `test_guards`, `test_draft` and
  `test_io` with `GUARD_SECONDS=0`; two RSS tests in the normal suite (100 failed cuts, 100
  STEP imports). Also run upstream's oracles, which are cheap and check new patches: SmPyLib's
  `test_omni_solid.py` against `_core` through a shim, and the 17 `prog_test` suites (about
  20 s), plus a load test over upstream's 188 `pt_TestFiles` `.smb` files (186 load today; 2
  raise KernelError "load failed", not investigated). The ASan build reported nothing over 192
  shell attempts on the crashing inputs (the crashes depend on memory layout), so add crash
  loops of the public calls with ASLR on (the O1 and O4 inputs) beside it.

**N3 · P1 · A seeded fuzz job** · `fuzz-ci-job` · medium · both
- Status (phase 1): done, 6a10005 (lane WN): `tools/fuzz` (generator, fork-per-case runners for both
  builds, invariants, minimiser, repro writer, baseline of seeds 7 and 8). The baseline is
  darwin-arm64 only.
- Status (close-out): done, W (c10f34c, 9947011): a linux-x86_64 baseline from three emulated runs
  of seeds 7 and 8, which CI's first fuzz job confirms or replaces.
- Gap: no randomized modelling tests and no randomized Python/wasm cross-check. The scratch
  harness found most crash signatures in this plan.
- Do: `tools/fuzz/`: a seeded generator biased toward degenerate placements, a fork-per-case
  runner, a minimiser, and invariants (inclusion-exclusion, |A-B| = |A| - |A∩B|, cell sums,
  primitive formulas, box containment, the gap measure, split sums, the offset round trip, a
  mesh check of empty results, translation invariance, Python vs wasm to 1e-6). Nightly with
  seed = date, and on PRs that touch `src/cpp`, the patches, `shapes`/`operations`/`defeature`
  or `js`, with seeds 7 and 8 as a regression corpus. 10 minutes on macOS arm64 and Linux
  x86_64. Fail on a new crash signature, a hang, a new invariant violation or divergence, or
  a silent rate above baseline + 0.3 points; upload the minimised repro. Weekly on the ASan
  build. Measured: 410 mixed cases take about 33 s in Python; seed 7 was bit-identical over
  3 runs. B6 and B10 are gated on it.

| Item | Pri | IDs | What is wrong or missing | Proposal | Effort | Affects |
|---|---|---|---|---|---|---|
| N4 | P2 | `usd-conformance-no-validator-gate` | `docs/files.md:51` says the test suite checks USD files with NVIDIA's validator; nothing does. smlibpy's own exports pass it (shim run), so a gate would have caught X3, X4 and X10. `tests/test_io.py:188` counts `RevitWallHealerCrash.usda` as good although its `mesh()` fails. | A CI step with `usd-brep[validation]` (`validate_file`, brep only) on `export_usd` output including a non-ASCII name, a line-edge re-export and an empty part (exempt BA.465/365/310 for foreign re-exports), or the ~250-line pxr shim (no OpenUSD; also for `toUsd`). Fix the docs line now. | small | both |
| N5 | P3 | `wasmapi-cross-language-parity-tests` | The JS tests are ports of the Python tests with the same numbers, but the hand-ported writers (STEP, DXF, OBJ, glTF, USD) have no golden comparison since the OCC readback is skipped, and the js blocks of `docs/javascript.md` and `js/README.md` never run. | Python writes golden text and JSON, a TS test compares; run the js doc blocks; include the known divergences (sketches #20, files #19, W16, convexity before T1). | medium | both |
| N6 | P2 | `infra-error-trace-empty` | Release builds compile the kernel's error trace out (SER and friends are plain returns), so every KernelError says only "SM_ERR at <binding>". | Kernel patch K11 (header) with a trail that keeps its tail; measure the overhead; `KernelError.trace`. Mainly for maintainers and bug reports. | medium | both |
| N7 | P3 | `infra-rand-time-seed` | `SmFace::GetPointsInFace` and `SmShell::IsInnerShellOf` reseed the process-wide `rand()` from the clock; no changed result was shown, but it breaks the guard's "deterministic" premise and clobbers the C rand state. | Kernel patch K10 (local fixed-seed generator). `SM_DEFINED_HASH_ORDER` is blocked by 10 static_asserts in 4 files (large). | small | both |
| N8 | P3 | `infra-gil-held` | No kernel call releases the GIL: a 0.29 s Boolean paused another thread for 0.293 s. The MCP already isolates the kernel in worker processes. | If wanted: one recursive kernel mutex taken by every entry point including deletions and finalizers; release the GIL only in heavy calls. | medium | Python |
| N9 | P3 | `infra-cache-retention` | Query caches stay for the part's lifetime (`bbox()` +42.6 KB, `distance_to` +361 KB per part in a 300-copy pattern); bounded by the part, not a leak. | `ext.drop_caches` / `Part.compact()` after measuring the trade-off. | small | both |

Status (phase 1) of the items in the table:

- N4: done, 13fb24c (lane WN): `tools/oracles/usd_validator.py` on a pxr shim, run on export_usd and
  toUsd output; it found BA.763 (fixed); the docs line corrected. No CI step with the real
  usd-brep[validation].
- N4 (close-out): done, W (c10f34c): CI's Linux job installs `usd-brep[validation]`, and a test runs
  NVIDIA's `validate_file` on the files of ten bodies (skipped where the package cannot be installed:
  its wheels are for Python 3.12 on Linux and Windows). Lane W ran it once in a linux/amd64 container
  on 40 files of both builds: all pass the BrepArray rules.
- N4 (verification): done: `tools/oracles/usd_validator.py --nvidia` runs `validate_file` from
  usd-brep's wheel or, on any platform, from `usd-validation-nvidia[usd]` with the submodule's
  BrepArray rules and schema. Tests of both suites (export_usd and toUsd: 19 files with a non-ASCII
  name, line-edge and foreign re-exports, BA.465 exempt for those; a file broken on purpose must
  fail) pass on macOS, where lane W's 40 files get the container run's verdicts. CI's Linux (3.12),
  macOS and JavaScript jobs install it without continue-on-error and set
  `SMLIBPY_REQUIRE_USD_VALIDATOR`, so the tests fail there instead of skipping without it.
- N5: done, 13fb24c (lane WN): `tools/parity.py`, golden files in tests/data/parity, the JS
  comparisons, the docs' js blocks run; 18 modelling steps.
- N5 (close-out): done, W (c10f34c): 56 capability steps in `tools/parity.py`; smlibwasm agrees to
  1e-7.
- N6: done, 13fb24c (lane WN): K11 (`SmMessages.h`), src/cpp/trace.cpp, `KernelError.trace`.
- N6 (close-out): R (f9fdcf2): smlibwasm's `section` and the fillet's crash note keep the kernel
  trace of the error they replace.
- N7: done, 90677eb (K10), its test in 13fb24c. SM_DEFINED_HASH_ORDER not attempted.
- N8: done, ba28379 (lane WN): one recursive kernel lock on every entry point, the GIL let go in
  long calls, 22 SmPyLib functions bound again, fork hooks.
- N8 (close-out): later: the GIL in SmPyLib's short methods, free-threaded Python, the fork warning.
- N9: done, ba28379 (lane WN): `ext.drop_caches`, `compact()`; nothing compacts by itself (the
  measured trade-off).
- N9 (close-out): later: automatic compaction.

## Kernel patches

New changes for `third_party/patches`, in the format of `third_party/patches/README.md`: a
fixed copy of the upstream file with every change marked `smlibpy patch`, a row in the
README's table, and the check that lets the patch be dropped later. K1, K2 and K12 extend
files that are already patched; the others add copies. The mechanism covers `.cpp` files in
`SMLib/src` and `SM_API/src`; K11 needs it extended to a header. Patches marked "after
ASan" fix a site found by reading the code and must be confirmed under AddressSanitizer (or
libgmalloc/MallocScribble) before they land.

| # | File | Function: change | Defect | Evidence | Before it lands |
|---|---|---|---|---|---|
| K1 | `SMLib/src/SmProtoTopology.cpp` (patched) | `sm_WhichPVToCombine`: return NULL when the start or end ProtoVertex is NULL, test each before `ContainsPoint`. `SplitIntersectingProtoEdges`: line 6811 uses `pPE2` (`sm_WhichPVToCombine(pPE2, dT21, pNewPV21)`); after a range-solution combine deletes `pPE2ToCombine` (6862-6868), leave the solution loop when it was `pPE1` or `pPE2`. | NULL dereference and use of a deleted ProtoEdge: Boolean of crossing holes exits with 139 | `bool-proto-edge-null-crash`; B4 | The 4 reproductions raise KernelError; ASan clean; `prog_test` booleans suite |
| K2 | `SMLib/src/SmProtoTopology.cpp` (patched) | `GlueCoincidentBrepVertices`: keep `sDeletedVertices1/2` across all ProtoVertices (move the ReSet out of the ii loop); after `GlueVertices`/`SqueezeEdge`, clear the FinalVertex of VertexDefinitions that point to the deleted vertex; skip `GlueVertices` when either vertex is deleted; leave the kk loop once `pBrep1Vtx2` is deleted; give the inline short-edge path (line 6078, still calling `Destruct()`) the batch path's ownership fix and correct the README, which says the function no longer calls `Destruct()`. | Freed SmVertex in `sm_RmFromSpatialTree` <- `GlueVertices` in the offset executive's `PiecewiseMerge`: shell/offset segfault at random | `fuzz-offset-glue-uaf`, `input-corpus-extended-offset-crash`, `offset-issue2-crash`; O1 | After ASan: root cause not confirmed. A 30-run loop of the L-box under libgmalloc (25-40% crash today) and the issue #2 cases; ASan with `GUARD_SECONDS=0` |
| K3 | `SMLib/src/SmMerge.cpp` (new) | `BooleanPostProcess`: when `bCheckAllEdges` is FALSE, intersect `m_sIntersectionEdges` with a fresh set of `m_vTI.m_pBrep->GetEdges()` before the `IsTopological` loop (not `pEdge->GetBrep()`, which reads the possibly freed edge). Likewise intersect the vertex list (`m_sIntersectionVertices` plus the removed edges' vertices) with a fresh `GetVertices()` set before the `IsTopologicalVertex` loop; the code already notes "intermitent cases when deleted vertices get here" (line 1217) and skips them by a size heuristic. Code reading only. | Stale edge read at a garbage address in `SmEdge::GetBrep` <- `IsTopological`; freed SmVertex read in `SmVertex::GetEdges` <- `IsTopologicalVertex` on the shell path (`ShellBrep` -> `ManifoldBoolean`) | `fuzz-boolean-postprocess-crash`, `offset-shell-rotated-wallcheck`; B5, O4 | After ASan on `Sphere(1.5).rotate(Y,90) - Cylinder(4,10).rotate(X,90).translate(0,-3.5,-2.504)`, and a crash loop with ASLR on over `Box(40,30,10).rotate(X,45).shell(10, opening)` (4 of 36 runs crash today) |
| K4 | `SMLib/src/SmFilletExecutive.cpp` (new) | `CollectTangentEdgeSequence` (4571-4690): check every corner and solver pointer, and test the next solver against the executive's full solver list (`rFilletSolvers` is NULLed as entries are consumed); return SM_ERR instead. | Dereference of a garbage solver pointer (0x30, 0x3d) in `SmFilletSolver::GetOtherFilletCorner` | `fuzz-fillet-tangent-sequence-crash`, `input-corpus-fillet-tangent-sequence-crash`; F2 | After ASan: the checks alone would not catch a stale pointer, and a single edge crashed in 1 of 7 runs, so the defect may sit upstream. I1 likely removes most corpus triggers (7 of the 9 crashing parts have duplicate vertices); re-run them after I1 |
| K5 | `SM_API/src/SmApiBrep.cpp` (new) | The four fillet entry points (lines 2069/2071, 2117/2119, 2164/2166, 2319/2321): call `SetDoGlobalMerge(TRUE)` after `SetFilletParameters`, which resets it (`SmFilletExecutive.cpp:731, 893`). | Global merge requested by SM_API is silently undone | `fillet-globalmerge-reset`; F7 | A before/after run on the near-limit cubes, the stepped-block rollover and both suites; the effect on near-limit fillets is unproven |
| K6 | `SMLib/src/SmFace.cpp` (new) | `HasSeamProblem` (U 15661-15691, V 15805-15838): transfer the original seam classification instead of deep-copying it and disowning the original. Keep `m_cpUVCurve1` consistent: `operator=` copies it as a raw pointer and the caller later passes the classification to `SplitAtSeam`, so construct the result on the original curve (`ReSet(curve, ..., owned=TRUE)`) or clear ownership on the source and assign shallowly. | Leak of the seam curve per periodic face direction (3408 bytes per call on a cylinder); every STEP import, `seam_problems`, `heal_brep` | `wasmbind-seam-curve-leak`, `infra-step-import-leak`; I2 | ASan with `detect_leaks=1` (the README runs `detect_leaks=0`); an RSS test over 100 imports (N2) |
| K7 | `SMLib/src/SmPlane.cpp` (new) | `IsNurbSurfacePlane`: after building the candidate plane, require every control point to lie within dTol of it and to equal the plane's image of its Greville abscissae; rational surfaces only with equal weights; keep the sampled test as a quick reject. | B-spline faces with a local bump are recognised as planes (normals at 3 and points at 10 fixed parameters) | `nlib-shape-plane-recognition-erases-bumps`; U1 | Tests: the 21 x 21 bump keeps area 3607.471 through `to_shell()`, zmax 2.2222 through `.smb`, and thickens to about 7215; both suites |
| K8 | `SMLib/src/SmCurve.cpp` (new) | `CalculateTightBoundingBox` (10244-10276): add only the knot points that lie in `crInterval`. | Tight box of an edge whose curve runs past the edge interval includes points outside it (native bbox 1234560; the wasm differs because the code is reached only when a loose-box test fails) | `usd-conformance-analytic-line-reexport`; X4 | Re-import of a re-exported line-edge box gives bbox ±5 in both builds |
| K9 | `SM_API/src/SmApiCurves.cpp` (optional) | `SmApiProjectCurve`: tolerance from `SmTol::GetApproxTol3d(pCurve)` or 1e-6 x size instead of the curve's bbox diagonal; `SmApiDropCurveToSrf`: the same tolerance for drop and lift. | `k.project_curve_to_surface` returns unrelated geometry (a seam line); smlibpy does not call it | `curve-project-to-surface-defect`; C12 | Optional: C12 calls `DropAndTrimCurve` directly; at least record the defect in `docs/kernel.md` |
| K10 | `SMLib/src/SmFace.cpp`, `SMLib/src/SmShell.cpp` (with K6) | `GetPointsInFace`, `IsInnerShellOf`: replace `srand(time(NULL))`/`rand()` with a local fixed-seed generator. | Inner-shell classification reseeds the process-wide `rand()` from the clock | `infra-rand-time-seed`; N7 | Low value; no changed result has been shown |
| K11 | `SMLib/inc/SmMessages.h` (new kind: a header) | Release `SER`, `SER_MSG`, `NER`, `NERN`, `SERN`, `SER_DELETE*` call `smos_InvokeErrorCallback` before returning. Needs `target_include_directories(... BEFORE ...)` for `smlib` and `sm_api` in `CMakeLists.txt`, since only `.cpp` files are replaced today. | Kernel error traces compiled out in release | `infra-error-trace-empty`; N6 | A trail that keeps its tail (recovered errors would fill the 4 KB that keeps the first entries); measure the overhead on the suites |
| K12 | `SMLib/src/SmOffsetExecutive.cpp` (patched) | `ShellBrep`: delete `pBrepShell` on the `SER(ReplaceImplicitOffsets)` failure exit (about line 278), as the stitch loop does with `SER_DELETE`. Optional and unverified: in the tangent-sector branch (about 1493), treat an edge with one shell face and one offset face as non-tangent, so a cap face is built. | Failed extended shells retain about 2 MB in the wasm; shell openings with a tangent rim stay open | `wasmbind-failed-shell-leak`, `offset-shell-open-rim`; O6, O3 | LeakSanitizer on the extended path; the 2 MB is likely a symptom of K2's corrupted path, so this patch alone is unproven |

Status (phase 1), each confirmed under AddressSanitizer before it landed where it fixes a memory
defect (rows and checks in `third_party/patches/README.md`): K1 as planned plus a status that
`IntersectTopology` now fails on (a19b674). K2 (8194dcd) without moving the ReSet (not needed),
plus two sites ASan showed: `ResolveOverlappingProtoEdges` and `DoExtendedOffset`. K3 only in
its vertex half (a19b674): the edge filter moved the read elsewhere, and the cut's real site, a
vertex shell that `SmTopologyIntersector::DeleteFaces` freed with its faces, got its own patch.
K4 (f1edb4f) fixes a missing fillet corner, the cause ASan found, plus the plan's checks and a
shrink of deleted surfaces; 90cc398 records the corner's vertex for F8. K5 not landed (90cc398):
measured with the request moved after `SetFilletParameters`, no near-limit fillet changed and
two chamfers of a box with a hole became open bodies;
`tests/test_lane_FO.py::test_sm_api_global_merge_stays_off` pins it. K6 and K10 (90677eb), K6
with a second transfer of the classifications. K7 (de5795c). K8 (90677eb). K9 not done: smlibpy
calls neither SM_API projection (C12 uses `CreateParallelProjectionCurves` and
`CreateNormalProjectionCurves`), and the defect is recorded in `docs/kernel.md`. K11 done
(13fb24c), with a trail of smlibpy's own (`src/cpp/trace.cpp`) that keeps the last 48 entries;
`CMakeLists.txt` puts `third_party/patches/<dir>/inc` first. K12 (8194dcd), hygiene only: its
path never ran, and the 2 MB was not seen.

Patches beyond K1 to K12, from phase 1's later lanes: `SmProtoTopology.cpp`
`SmEdgeDefinition::Imprint` keeps the curves a failed `MakeEdgeInFace` gave its Edge, and a new
copy of `SmSurface.cpp` empties `CreateNaturalUVTrimCurves`' outputs on failure (O1, ace33c7);
new copies of `SmFilletGeom.cpp` (`MakeFaceBrep` with a missing boundary curve) and
`SmFilletSolver.cpp` (`CreateCliffRollOverSideFG` without a side face) for two fillet crashes
found measuring F7 (90cc398); `SmMerge.cpp` `ManifoldBoolean` marks its vertices again after
`CloseIntersectionLoop` deleted one (S1, ae96cce); a new copy of `SmPrimitiveCreation.cpp`,
whose `Boolean2D` fails on an edgeuse without a face (C1, 97384e9); and `SmCurve.cpp`
`sm_FilterSolution` evaluates second derivatives (X14, 97195f6). Fifteen kernel files are
patched now (three in 0.4.0). Tried and not landed: a copy of `SmFilletCorner.cpp` for set-back
corners (F10: the crash stopped, the bodies came out open), a null guard in
`SmEdgeuse::CreateUVTrimCurve` (O1: the crash moved on), and a copy of `SmApiBrep.cpp` for K5.

Fixed outside the kernel on purpose: the transform tolerance reset (B1, in
`ext.transform_brep`; patching `SmBrep::Transform` would add a 30k-line file), the helix cap
(C4, `NL_CCPLIM` set at init), the DoingBoolean flag (B7, reset in a re-bound boolean), the
360 deg revolve branch that skips `CopyAndAddAnalytics` and the commented-out torus test
(S4, the post-pass `ext.analytic_revolutions` instead of patching `SmPrimitiveCreation.cpp`
and `SmBSplineSurface.cpp`), the crash after a failed `RemoveFaces` (T2, never deleting
such a Brep in `ext.copy_faces`; a patch to `~SmBrep`/`RemoveFaces` stays an option after
ASan), the missing frame and value checks of the USD converter (X1, in `check()` of
`src/cpp/usd.cpp`), the construction calls without input guards (U4, guards in the new
wrappers), the defects of `SmEdge::GetContinuity` (A4, an own implementation), and the
SmPyLib binding defects, which the patch mechanism does not cover (C3 ellipse registration
in `src/cpp/module.cpp`; M13 `ray_intersection`). Not patched: `SmApiBrepRelationship`'s
misclassification (B13; smlibpy stops relying on it and documents it), and the seam-tangency
defect (B6; its site in the kernel is not located, so smlibpy turns the operand that owns the
seam, 5948e4d). The vendored USD converter (X4, X5) is smlibpy's own code in `src/cpp/usd` and
is changed directly. Only if the
features are wired: `SmBSplineSurface::CreateHelicalSweep` (U11, stack `NL_SURFACE`),
`SmCurveFilletExecutive.cpp:138-140` (C15), an orientation curve in `SmSweepOptions` (S3,
alternatively `ext.oriented_sweep` without a patch), and a deadline counter in the feature
executive's loops (W2).

Status (phase 1): the later lanes took the routes without a patch here too: S3 through
`ext.oriented_sweep`, C15 through a fillet of its own at curves, U2 through `ext.edge_blend`, U4
through guarded wrappers, A4 through `ext.edge_continuity`, B17 through `ShapeList.joining` (not
`SmApiBooleanWithCurves`, which hands out freed edges), and the compiled-out NLib shaping
functions of U8 copied into `src/cpp/nlib_shape.cpp` with two fixes. `CreateHelicalSweep` stays
unwired (a test checks it), and there is no deadline counter in the feature executive (W2 stops
steps from outside instead).

Status (close-out): twelve more kernel files are built from patched copies, twenty-eight in all
(three in 0.4.0), each with rows and checks in `third_party/patches/README.md` and confirmed under
AddressSanitizer where it fixes a memory defect. New copies: `NL_SrfAdv.cpp` (the N-sided fill's
stack, K2), `SmBrep.cpp` (`DeleteEdge` refuses an Edge between the two sides of one Face and leaves
no Loopuse on a deleted Edgeuse, `SqueezeEdge`, `MakeEdgeInFaceWithVU`, `DeleteFace`, `~SmBrep` and
`CopyFaces`, K2), `SmEdgeuse.cpp` (a half-made Edge refused, K2), `SmSurfaceCache.cpp` (the null polar
box, K2), `SmOffsetGeometryCreation.cpp` (`ExtendTrimEdges`' clean-up, K2), `SmCurveClass.cpp` (the
set-back corners' read of freed memory, F), `SmBSplineSurfaceNLib.cpp` (the corner patches' UV
curves, F), `SmEllipse.cpp` (the evaluation beside a seam, U), and for W2's deadline
`SmAdvSurfaceIntersector.cpp`, `SmSurfaceIntersector.cpp`, `SmSurfaceDropCurve.cpp` and
`SmFeatureExecutive.cpp`. Changed copies: `SmMessages.h` (`SMLIBPY_DEADLINE_ER`), `SmProtoTopology.cpp`
(a deleted ProtoEdge leaves every list, K1 and W; `CombineProtoEdge` frees what it leaves, K2),
`SmTopologyIntersector.cpp` (the vertex Shell order in `DeleteFaces`, K1; the half-made Edge and
`FixGaps`, K2; the deadline, W), `SmPrimitiveCreation.cpp` (the sweep's profile reference, S; the
mitered sweep's and `CreateCone`'s leaks, K2), `SmMerge.cpp`, `SmOffsetExecutive.cpp`,
`SmFilletExecutive.cpp` and `SmFilletGeom.cpp` (leaks on failure paths, K2). The deadline counter
the plan put in the feature executive's loops went into the intersection loops instead, where the
looping steps spend their time (W2). `SmApiBooleanWithCurves` stays unpatched: nothing calls it, and
`_core.boolean_with_curves` is bound again (B17).

## Overlap with the smlibpy-three draft

The smlibpy-three draft now in progress on this branch adds to smlibwasm 0.5 and smlibpy
(its Phase 0): `Mesh.faceIds`/`face_ids`, `Mesh.dispose()` and `Symbol.dispose`,
`Shape.edgeLines`/`edge_lines`, `Edge.owner`/`Vertex.owner`, `allow_partial` body
tessellation, a kernel-free `@classcad/smlibwasm/geometry` entry, brand flags, `_vec`/`Pos`/`Rot`
guards against three.js objects, and a linear glTF `baseColorFactor`.

| Finding | Item | Addressed by the draft (Phase 0) | Still open here |
|---|---|---|---|
| `wasmapi-mesh-polybrep-retained` | W3 | `Mesh.dispose()`/`Symbol.dispose`, with a test that wasm memory stays flat over 8 rebuilds of the spring (measured 64 -> 93 MB, then flat) | Free the PolyBrep right after tessellation, dispose internal temporaries, clear out-of-memory message |
| `mesh-tess-params` | M10 | `allow_partial` in the body tessellation (Python and TS) | `max_edge=` and the twisted-face warning |
| `wasmbind-no-init-options` | W7 | The kernel-free `@classcad/smlibwasm/geometry` entry, so geometry-only imports do not load the module | The webpack/esbuild loader fix and `init()` options |
| `wasmapi-use-after-dispose`, `wasmbind-stale-subshapes-after-dispose` | W4 | `Edge.owner`/`Vertex.owner`, the owner link the liveness check needs | The liveness check itself |

The other draft items (face ids, edge lines, brands, the three.js guards, the glTF color
space) have no counterpart among the findings.

Status (phase 1): the column "Still open here" is done: W3 (1e82ba4: the PolyBrep freed once the
arrays are copied; the out-of-memory message with W8, b660ed1), M10 (`max_edge=` and the
warning, bd60eab), W7 (the loader fix and `init`, b660ed1) and W4 (the liveness check, 1e82ba4).
The draft's linear glTF color and the cone apex normals landed as GLTF-COLOR and MESH-APEX
(1f1023d).

## Not planned

| What | Finding | Reason |
|---|---|---|
| Return a removed feature as its own solid from the feature executive | `offset-feature-extract` (refuted) | One exact Boolean already gives it: `boss - boss.remove_faces(...)` = 141.37167, identical to the kernel's feature Brep. |
| Retry every failed Boolean with a NURBS tool | `fuzz-mitigations-measured` | Rescued 1 of 87 random failures; only the targeted retry B10 is planned. |
| Retry all-edge fillets with `circular_fillet` | fillet verifier note, `fuzz-mitigations-measured` | Rescued 0 of 10 in the fuzz campaign, and it rounds every edge of the body. |
| Rotate seams with today's `rotate()`, or move a torus' seam by placement | `fuzz-mitigations-measured`, `fuzz-seam-tangency` | Before B1 it sets every torus tolerance to 0; a rigid placement cannot move a torus' equator seam. |
| Bound every Boolean result by a coarse volume or tight box | `bool-silent-empty-overlap` | 2x the Boolean (coarse volume) and 8x (tight box) on a 211-face part; the coarse error 5.8e-4 sits near the proposed 1e-3 margin. |
| `non_manifold_boolean` as a general cut/split fallback for merged parts | `bool-merged-section-split` | SM_ERR when the tool crosses a cell boundary. |
| Split `solids()` whenever `material_census` counts more solids | `bool-solids-island` | Would split merged parts, whose touching cells stay one solid by design. |
| "Shared edges must be sharp" rule in `remove_faces` | `offset-remove-faces-enclosed` | Leaves a filleted pocket floor behind as an extra face (7 faces instead of 6). |
| Patch `SmFilletStandardSolver.cpp:4012` for variable-radius continuity | `fillet-variable-blend-is-chamfer` | The flag only adds derivative surfaces; the cause is elsewhere in the variable-radius path. |
| NULL checks alone in `CollectTangentEdgeSequence` | `input-corpus-fillet-tangent-sequence-crash` | The faulting pointer is garbage, not NULL (K4 needs ASan first). |
| Fork guards that re-run the work in the parent as the crash fix | `offset-issue2-crash`, `infra-guard-result-transfer` | Doubles the guarded kernel time and misses layout-dependent use-after-free; N1 returns results instead. |
| `reset_after_trap` clearing the kernel's mark flags | `offset-wasm-trap-guard`, `wasmbind-trap-leaves-kernel-state` | Other state stays damaged; stuck marks are benign by design and were not observed. |
| Raise when a surface fit's max error exceeds 3 x rms | `surface-fit-error-discarded` | Fires on ordinary scan noise (ratio 4.0 for sigma 0.1). |
| Sheet offsets with `extended_offset=False, self_intersection=False` | `surface-sheet-offset` | Returns a multi-face sheet's faces unmoved and unsewn. |
| A "heal=True may repair it" hint for broken USD bodies | `usd-conformance-geometric-check` | heal repairs 465 but not 440 or 582. |
| Hard-reject cone semiAngle outside (0, π/2) in USD | `usd-conformance-value-crash` | Negative angles are turned around, 0 imports, and usd-brep's own writer emits such cones. |
| Enforce the validator's containment rules (BA_040-050/310/365/465) on import | `usd-conformance-geometric-check` | Upstream's own valid files fail BA_465; the real defects are caught geometrically. |
| Resolve USD materials within the layer only | `usd-conformance-materials` | The corpus materials come through references; this gives no color for them. |
| Replace the kernel integration by `brep_measure` throughout STEP import | `input-corpus-import-check-cost` | 3x slower on part 78; much faster only on some bodies. |
| Expose `max_aspect_ratio`; make halving accept `max_edge` | `mesh-tess-params` | The ratio does not affect triangles; halving with a max edge divides faces to a thousandth of their size. |
| A scaled helix tolerance as the whole fix | `curve-helix-limit` | Runs into the fitter's span cap and the hard 124.25-turn limit. |
| Release the GIL with cheap queries left unlocked | `infra-gil-held` | Unsafe: queries and finalizers touch the shared context. |
| Share the BrepHandle in `named()`/`colored()` as is | `topo-named-cache` | Equality compares handles, so differently named bodies would compare equal. |
| Refuse `match_edge` when adjacent edges move | `nlib-shape-match-edge-to-curve` | Refuses exactly the gap-closing use. |
| A grep-based CI check that Python's `k.*` calls exist in the wasm | `wasmapi-kernel-layer-unreachable` | The TS tests are ports and already fail at runtime on a missing binding. |
| A full Assembly tree type and `import_step(as_assembly=True)` | `topo-assembly` | A product-scope decision; assemblies go to ClassCAD (skill `SKILL.md:47-56`). I10 covers named products per body. |
| Per-site user hints from the kernel trace | `infra-error-trace-empty` | Speculative; the trace serves maintainers. |
| Build the wasm without fast-math flags | `input-corpus-wasm-fillet-divergence` | There are no such flags; native FMA contraction is the more likely cause. |
| Use `SmCurveFilletExecutive` as a ready routine | `fillet-curve-executive` | Untested, with side-selection bugs; an own implementation costs about the same. |
| Expose `k.brep_relationship` as a public relationship query | `vol-relationship-defect` | Misclassifies and depends on history; B11/A1 give a sound base. |

## Appendix: index

Every finding, grouped by review slice. Verdict, value and effort are the verifier's. "Item"
is the plan item (letters as in [Workstreams](#workstreams)); the title states the finding in
its verified (corrected) form.

### Slice bool: Booleans, cells, cutting, classification

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `bool-seam-tangent-wrong` | confirmed | high | medium | B6 | Seam lines tangent to the other operand give valid bodies with the wrong volume |
| `bool-proto-edge-null-crash` | confirmed | high | small | B4 | Segfault in SplitIntersectingProtoEdges on crossing holes (cut, fuse, &, merge) |
| `bool-silent-empty-overlap` | partial | high | small | B3 | Empty cut and whole-part intersection accepted on curved bodies |
| `bool-nurbs-retry` | confirmed | high | small | B10 | A NURBS copy of the tool fixes cuts beside an earlier parallel hole |
| `bool-point-classify` | confirmed | high | small | B11 | No point-in-solid query; the documented ray-parity test is wrong |
| `bool-split-by-sheet` | partial | high | medium | B12 | No split of a part by a sheet; SM_BO_SLICE works (Part +/- Shell known) |
| `bool-imprint` | confirmed | medium | small | B14 | No public imprint; the kernel imprinting Boolean works |
| `bool-merged-section-split` | partial | medium | medium | B9 | section() of a merged part drops a cell silently |
| `bool-cells-provenance` | confirmed | medium | medium | B15 | Cells of a merged part do not know their inputs |
| `bool-relationship-touching` | partial | low | small | B13 | brep_relationship reports overlap as touching (documented limit) |
| `bool-solids-island` | partial | low | small | B16 | solids() keeps an island in a cavity with its housing (known) |
| `bool-new-edges` | confirmed | low | small | B17 | No access to the edges a Boolean created |
| `bool-section-tangent` | confirmed | low | small | B18 | section() with a tangent plane raises a bare KernelError |

### Slice fillet: Fillets and chamfers

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `fillet-chamfer-mixed-angle-crash` | confirmed | high | small | F1 | Chamfer of edges with different angles segfaults |
| `fillet-variable-blend-is-chamfer` | partial | medium | small | F3 | Variable radius with continuity gives a ruled chamfer silently |
| `fillet-chamfer-varying-angle-setback` | confirmed | medium | medium | F4 | Chamfer setback varies with the edge angle (1.0 to 3.0 for 1) |
| `fillet-tangent-chain-propagation` | partial | high | medium | F6 | Edge tangent at both ends fails with a radius message; no propagation |
| `fillet-variable-law-chains` | partial | medium | small | F5 | Per-edge (start, end) radii bend on tangent chains and closed edges |
| `fillet-globalmerge-reset` | partial | medium | small | F7 | SM_API turns global merge on before SetFilletParameters resets it |
| `fillet-error-info` | partial | medium | medium | F8 | Fillet failure details from the executive are discarded |
| `fillet-asymmetric-chamfer` | partial | medium | medium | F9 | Two-distance chamfers (known #23); kernel two-offset route |
| `fillet-wire-fillet-silent-skip` | partial | low | small | C15 | Wire.fillet skips arc corners silently (documented; inconsistent) |
| `fillet-curve-executive` | partial | low | medium | C15 | 2D fillets at spline corners; SmCurveFilletExecutive untested |
| `fillet-edge-edge-blend` | confirmed | medium | medium | U2 | Edge-to-edge blend surface (create_blend_primitive) not public |
| `fillet-surface-fillet-options` | confirmed | low | medium | U12 | surface_fillet: chamfer and two-distance options, base trimming |
| `fillet-corner-styles` | confirmed | low | medium | F10 | Bevel and setback corner styles |
| `fillet-preview-and-g2-corner-docs` | confirmed | low | small | F11 | G2 rounds have G1 corner patches; fillet_preview unused |

### Slice offset: Offsets, shell, drafts, feature executive

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `offset-shell-open-rim` | confirmed | high | medium | O2, O3 | Shell with a tangent rim leaves the rim open; passes is_valid() |
| `offset-remove-faces-enclosed` | partial | high | small | O5 | remove_faces of fillets around a face removes the face |
| `offset-shell-rotated-wallcheck` | confirmed | high | small | O4 | Shell wall check uses world axes; rotated parts give wrong bodies |
| `offset-direct-edit` | confirmed | medium | large | O10 | Direct editing (move/offset faces) via SmBrep::LocalOperation |
| `offset-issue2-crash` | partial | high | medium | O1 | Issue #2 shell crash reproduces on macOS (2/10); extended mode |
| `offset-shell-unchanged` | partial | medium | small | O2 | shell() returns the input unchanged when the cavity vanishes |
| `offset-acute-bbox` | confirmed | medium | small | O8 | offset(+d) rejects exact offsets of acute parts |
| `offset-taper-walls-undraftable` | confirmed | medium | small | S9 | Tapered polygon walls are planar B-splines draft refuses |
| `offset-rounded-mode` | confirmed | medium | small | O9 | No rounded (rolling-ball) offset of a part |
| `offset-sheet-offset` | confirmed | medium | small | O7 | Sheets and faces cannot be offset; thicken() lacks both |
| `offset-wasm-trap-guard` | partial | low | medium | W2, W10 | wasm defeaturing has no time limit or isolation |
| `offset-feature-extract` | refuted | low | small | not planned | Removed feature as a solid (refuted: one Boolean away) |
| `offset-two-sided-draft` | partial | low | small | O11 | Two-sided draft is exact via split + draft + fuse; docs recipe |

### Slice sweep: Primitives, extrusions, revolves, sweeps, lofts

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `sweep-revolve-360-not-analytic` | confirmed | high | medium | S4 | 360 deg revolves give surfaces of revolution, not cylinders |
| `sweep-3d-path-joints-and-closed` | partial | medium | medium | S1 | Non-planar multi-edge sweeps turn the profile at joints |
| `sweep-frame-orientation` | confirmed | high | large | S3 | Sweep orientation control (helix roll #10) via NLib curZ |
| `sweep-profile-anchor-world-bbox` | confirmed | medium | small | S2 | Sweep anchors asymmetric profiles off the path on oblique paths |
| `sweep-scale-law` | confirmed | medium | small | S7 | Scale-law sweeps bound but unused |
| `sweep-line-arc-bspline` | partial | medium | small | S8 | Single line/arc sweeps give B-spline faces |
| `sweep-loft-rails-tangency` | partial | medium | large | S10 | Loft rails, end tangency, closed lofts (kernel, with limits) |
| `sweep-swung-primitive` | confirmed | low | small | S12 | Swung primitive bound but unused |
| `sweep-taper-outward-slivers` | partial | medium | small | S9 | Tapered extrusions never give plane walls; extrude + draft does |
| `sweep-curve-copy-leaks` | confirmed | low | small | S11 | Revolve, loft, taper and planar sweeps leak copied curves |
| `sweep-partial-primitives` | confirmed | low | small | S13 | Partial primitives bound but not offered |
| `sweep-blend-primitive` | confirmed | low | medium | U2 | Bridge surface: SM_API wrapper ignores status, twisted blends |
| `sweep-extrude-direction-in-plane` | confirmed | low | small | S14 | extrude direction in the sketch plane: bare error or sliver |

### Slice curve: Curves

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `curve-planar-path-aliasing` | partial | medium | small | S6 | Sampled planarity calls chained even-turn helices planar |
| `curve-2d-boolean-multiface` | partial | medium | small | C1 | 2D & and - wrong for faces touching at vertices |
| `curve-intersections` | confirmed | medium | medium | C5 | Edge.intersections: 0.001 tolerance, false hits, no parameters |
| `curve-split-trim` | confirmed | high | small | C2 | No Edge trim/split/param_at/closest_point |
| `curve-from-nurbs` | confirmed | medium | small | C11 | No public NURBS curve constructor |
| `curve-ellipse-binding-type` | confirmed | medium | small | C3 | Ellipse curves reach Python untyped: project/sweep/ruled raise |
| `curve-fit-tolerance` | confirmed | medium | medium | C8 | No curve fit within a tolerance |
| `curve-spline-perf-seam` | confirmed | low | small | C13 | Spline is O(n^2) in Python; closed splines C1 at the seam |
| `curve-analysis` | confirmed | medium | medium | C9 | No curvature, inflection or join-continuity queries on curves |
| `curve-offset-open` | confirmed | medium | medium | C7 | No offset of open edges or wires |
| `curve-on-face` | partial | low | large | C12 | No normal projection, UV wrap or iso curves on faces |
| `curve-lines-arcs` | confirmed | medium | medium | C10 | No conversion to lines and arcs for CNC DXF |
| `curve-helix-limit` | partial | medium | small | C4 | Helix turn limit: split and join (scaled tolerance not enough) |
| `curve-extend-join` | confirmed | medium | medium | C6 | No extend of an edge or join of a wire into one edge |
| `curve-project-to-surface-defect` | confirmed | low | small | C12 | SmApiProjectCurve uses the curve size as tolerance (raw k.* only) |
| `curve-conics-spiral` | partial | low | small | C14 | No conic or spiral constructors (possible via Bezier/Helix) |

### Slice surface: Surfaces

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `surface-trim-with-curves` | partial | high | medium | U3 | Trim sheets with curves on them; imprint curves |
| `surface-bridge-blend` | confirmed | high | medium | U2 | Blend (bridge) surface between sheet edges |
| `surface-boundary-fill` | confirmed | high | large | U4 | Coons, N-sided fill and curve networks |
| `surface-extend-untrim` | confirmed | medium | medium | U6 | Extend a sheet; untrim a face |
| `surface-split-body-by-sheet` | confirmed | medium | medium | B12 | Split a solid with a freeform sheet |
| `surface-silhouette-is-hlr` | confirmed | medium | medium | M4 | silhouette() returns visible HLR curves, not contours |
| `surface-project-accuracy` | confirmed | medium | medium | C12 | project(): 1e-4 fits, both sides, no faces |
| `surface-sheet-offset` | partial | medium | small | O7 | Shell.offset missing (use the default kernel flags) |
| `surface-loft-open-ignores-ruled` | confirmed | medium | small | S5 | loft of single open curves ignores ruled= and smooth= |
| `surface-fit-error-discarded` | partial | low | small | U15 | Surface fit errors not exposed (documented limitation) |
| `surface-stitch-unify-normals` | confirmed | medium | small | U5 | Open stitch results keep mixed normals; no flip |
| `surface-face-analysis` | confirmed | medium | medium | A3 | No Face position/parameters/curvature/NURBS/iso access |
| `surface-rails-and-tangent-loft` | confirmed | medium | large | S10 | Two-rail sweeps and tangent lofts |
| `surface-from-nurbs-data` | confirmed | low | small | U13 | No surface from explicit NURBS data |
| `surface-intersection-curves-api` | confirmed | low | small | U14 | intersection_curves rejects Plane and raises on no crossing |
| `surface-kernel-construction-guards` | confirmed | low | small | U4 | Guards needed before wiring surface constructors |

### Slice topo: Topology, attributes, history

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `topo-history` | confirmed | high | medium | T3 | No face/edge provenance through operations |
| `topo-convexity` | confirmed | high | small | T1 | Edge.convexity is noise on imported edges; Python and wasm differ |
| `topo-classify` | confirmed | medium | small | B11 | No point-in-solid query (Point3DClassify) |
| `topo-scale-analytics` | partial | low | small | T6 | Recognize analytics after non-uniform scale (cylinders, STEP) |
| `topo-step-dup-vertices` | partial | low | medium | I1 | STEP import makes duplicate vertices (hygiene; see cause) |
| `topo-check` | confirmed | medium | medium | T4 | No validity report; AssertValid names entity and value |
| `topo-face-attributes` | confirmed | medium | large | T5 | No per-face color/name; kernel attributes would carry them |
| `topo-assembly` | partial | medium | large | I10 | export_step writes one product (named products per body) |
| `topo-solids-nested` | confirmed | low | small | B16 | solids() keeps a body inside a cavity with its housing |
| `topo-smb-merged` | confirmed | low | small | X8 | Merged part saved as .smb loads as a Shell |
| `topo-continuity` | confirmed | low | small | A4 | Edge continuity not queryable |
| `topo-shells-voids` | confirmed | low | small | T7 | Shells, voids and face-to-cell mapping not public |
| `topo-named-cache` | partial | low | small | T8 | named()/colored() deep-copy the Brep |

### Slice heal: Healing, stitching, file I/O

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `heal-usd-import-ignores-xform-units` | confirmed | high | medium | X2 | import_usd ignores xformOps, metersPerUnit, upAxis |
| `heal-copyfaces-crash-after-failed-removefaces` | confirmed | high | small | T2 | Face copies segfault after a failed RemoveFaces |
| `heal-stitch-tolerance-tjunction-region` | partial | high | small | U5 | stitch ignores tolerance and returns Shells (T-junctions do sew) |
| `heal-step-import-no-stitch-fallback` | confirmed | medium | small | I5 | Unshared STEP faces import invalid; stitching repairs them |
| `heal-check-report` | partial | medium | medium | T4 | No gap/tolerance report; Shell.heal never gives a Part |
| `heal-step-import-one-bad-body-aborts` | confirmed | medium | small | I6 | One unreadable STEP body aborts the file |
| `heal-smb-load-merged-part-becomes-shell` | confirmed | medium | small | X8 | load() of a merged .smb part returns a Shell |
| `heal-smb-part-container-attributes` | partial | low | medium | X9 | .smb holds one body without name/color (#15) |
| `heal-step-export-no-assembly` | partial | medium | medium | I10 | export_step: one product, no per-part products (documented) |
| `heal-step-export-curves` | confirmed | low | small | I12 | export_step cannot write curves, points or frames |
| `heal-iges-absent` | confirmed | low | large | I14 | No IGES translator |
| `heal-step-uncertainty-constant` | partial | low | small | I13 | STEP uncertainty depends on unit= |

### Slice mesh: Tessellation, meshes, drawings, ray tracing

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `mesh-stale-kernel-mesh` | confirmed | high | small | M1 | Mesh Booleans use the kernel mesh from before array edits |
| `mesh-float32-vertices` | confirmed | medium | small | M3 | Mesh vertices pass through float32 |
| `mesh-hidden-lines-hcr` | confirmed | high | medium | M4 | Exact hidden lines (SmHCR) discarded; drawings only raster |
| `mesh-batch-raycast` | confirmed | medium | medium | M5 | Slow ray casting; kernel ray tracer ~400x faster |
| `mesh-decimate` | confirmed | medium | medium | M6 | Mesh decimation not reachable |
| `mesh-section` | confirmed | medium | small | M7 | No mesh section by a plane |
| `mesh-to-part` | partial | medium | small | M8 | No direct mesh-to-Part (possible but slow and undocumented) |
| `mesh-repair` | confirmed | low | small | M9 | No mesh hole filling or repair |
| `mesh-sphere-pole-slivers` | partial | medium | medium | M2 | Sphere meshes 68x off the tolerance near poles (known #3) |
| `mesh-tess-params` | confirmed | low | small | M10 | max_edge (and partial meshes) not exposed |
| `mesh-mass-properties` | partial | low | small | M11 | No mesh centroid/inertia; empty-mesh bbox error (Python) |
| `mesh-export-normals-indexing` | confirmed | low | small | M12 | OBJ without normals; glTF unindexed |
| `mesh-pyray-keepalive` | confirmed | low | small | M13 | _core PolyBrep.ray_intersection raises on every hit |

### Slice vol: Measurement, deformation, sheet metal

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `vol-distance-skew-faces` | confirmed | high | medium | A1 | distance_to overestimates nearly parallel clearances (2.485 for 2.0) |
| `vol-relationship-defect` | partial | high | small | B13 | brep_relationship misclassifies, depends on history, slow |
| `vol-closest-points` | partial | medium | small | A2 | No closest-point pair; edges and wires refused |
| `vol-face-edge-closest` | confirmed | medium | small | A2 | Face and Edge have no closest_point/parameter |
| `vol-curvature-query` | confirmed | medium | small | A3 | No numeric curvature queries |
| `vol-continuity` | confirmed | medium | medium | A4 | No G0/G1/G2 analysis; kernel GetContinuity defective |
| `vol-section-props` | partial | low | small | A5 | No section properties (reachable via extrude) |
| `vol-deform-analytic` | confirmed | medium | large | D2 | bend and taper lose analytic face types |
| `vol-unroll` | confirmed | medium | medium | D3 | Rolled sheets cannot be unfolded |
| `vol-kfactor-table` | confirmed | medium | small | D1 | One K-factor for every bend; fold does not record K |
| `vol-sm-hole-splines` | partial | low | medium | D5 | Holes across a bend come back as arcs and splines in flat patterns |
| `vol-deform-curves` | confirmed | low | medium | D6 | Edges and wires cannot be deformed |
| `vol-deform-docs-stale` | confirmed | low | small | D4 | Deform docs still describe the old 4e-4 volume error |
| `vol-massprops-extras` | partial | low | small | A6 | No inertia about a point/axis or radii of gyration |

### Slice wasmapi: smlibwasm public API and parity

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `wasmapi-defeature-guard-hang` | confirmed | high | large | W2 | removeFillets/removeFaces hang forever in wasm |
| `wasmapi-mesh-polybrep-retained` | confirmed | high | small | W3 | Meshes keep their kernel PolyBrep; heap fills |
| `wasmapi-unknown-options-silent` | confirmed | medium | medium | W5 | Unknown options and extra arguments ignored silently |
| `wasmapi-use-after-dispose` | confirmed | medium | small | W4 | Sub-shapes of a disposed body call freed memory |
| `wasmapi-shapelist-at-point` | confirmed | medium | small | W6 | ShapeList.at(point) returns the first element in JS |
| `wasmapi-typings` | partial | medium | medium | W11 | Loose TypeScript typings |
| `wasmapi-docs-body-methods-missing` | confirmed | low | small | W12 | JS API reference omits _Body methods |
| `wasmapi-python-in-memory-io` | confirmed | medium | small | X11 | Python has no in-memory file I/O |
| `wasmapi-gc-growth-scope` | partial | low | medium | W9 | No scope API; heap grows until finalizers run (documented) |
| `wasmapi-browser-runtime` | partial | medium | medium | W7 | No loader options or Worker guidance |
| `wasmapi-fonts-woff2-seac` | confirmed | low | large | W13 | WOFF2, CFF2 and seac fonts fail in wasm |
| `wasmapi-input-types-inconsistent` | confirmed | low | small | W14 | In-memory readers accept different input types |
| `wasmapi-cross-language-parity-tests` | partial | low | medium | N5 | No golden comparison of TS and Python writer output |
| `wasmapi-kernel-layer-unreachable` | confirmed | low | small | W15 | Raw kernel layer not exported from the package |

### Slice wasmbind: smlibwasm bindings, build and runtime

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `wasmbind-stack-pointer-leak` | confirmed | high | small | W1 | Failed calls leak the wasm stack pointer; module breaks |
| `wasmbind-sync-builds-never-free` | confirmed | medium | medium | W9 | Synchronous loops never free; port keeps intermediates |
| `wasmbind-opaque-cpp-exceptions` | confirmed | medium | small | W8 | C++ exceptions reach JS as opaque WebAssembly.Exception |
| `wasmbind-no-worker-no-cancel` | partial | medium | large | W2 | No worker helper, timeout or cancel (package runs in workers) |
| `wasmbind-seam-curve-leak` | confirmed | medium | small | I2 | SmFace::HasSeamProblem leaks the seam curve |
| `wasmbind-trap-leaves-kernel-state` | partial | medium | small | W10 | Traps in normal use are hidden by retries |
| `wasmbind-failed-shell-leak` | partial | medium | large | O6 | Failed extended shells retain ~2 MB in wasm (layout-dependent) |
| `wasmbind-stale-subshapes-after-dispose` | confirmed | medium | small | W4 | Stale sub-shapes answer with another body's geometry |
| `wasmbind-float32-mesh-arrays` | confirmed | low | small | M3 | Mesh arrays float32 in both bindings |
| `wasmbind-raw-kernel-gap` | confirmed | low | medium | W15 | 94 of 156 _core functions unbound in wasm |
| `wasmbind-no-init-options` | partial | medium | small | W7 | Loader breaks webpack 5 and esbuild; no init options |

### Slice infra: Configuration and cross-cutting runtime

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `infra-bool-fail-leak` | confirmed | high | small | B7 | Failed Booleans leak both operand copies |
| `infra-helix-ccplim` | partial | high | small | C4 | NL_CCPLIM caps the helix fit; set it at init |
| `infra-guard-result-transfer` | partial | medium | medium | N1, O1 | Guard re-runs work in the parent; return results as .smb |
| `infra-assert-valid` | confirmed | medium | medium | T4 | AssertValid not exposed |
| `infra-error-trace-empty` | partial | medium | medium | N6 | Kernel error traces compiled out in release |
| `infra-rand-time-seed` | partial | low | small | N7 | Inner-shell classification reseeds rand() from the clock |
| `infra-gil-held` | partial | low | medium | N8 | No kernel call releases the GIL |
| `infra-wasm-oom` | confirmed | low | small | W8 | wasm out-of-memory reported as a kernel crash |
| `infra-step-import-leak` | partial | low | medium | I2 | STEP import leak per curved face (cause: HasSeamProblem) |
| `infra-cache-retention` | confirmed | low | small | N9 | Query caches stay for the part's lifetime |
| `infra-asan-ci` | confirmed | medium | medium | N2 | No sanitizer or leak job in CI |

### Slice nlib-shape: NLib shape tools

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `nlib-shape-plane-recognition-erases-bumps` | confirmed | high | small | U1 | Plane recognition flattens B-spline faces with bumps |
| `nlib-shape-face-push-constraints` | confirmed | medium | medium | U7 | Local push/pull of a face (N_SrfShapeDerivConstraints) |
| `nlib-shape-warp-flatten-compiled-out` | confirmed | low | large | U8 | Region warp/flatten compiled out; revivable |
| `nlib-shape-match-edge-to-curve` | partial | low | medium | U9 | Match a sheet edge to a curve (AdjustBoundaryCurve) |
| `nlib-shape-curve-through-and-match` | confirmed | low | medium | C16 | Edit curves: through a point, match ends |
| `nlib-shape-lattice-locality` | partial | low | small | D7 | Lattice docs overstate locality |
| `nlib-shape-joinsurface` | partial | low | small | U10 | Merge two sheets into one face (JoinSurface) |
| `nlib-shape-bridge-pitfalls` | partial | low | small | U11 | NLib/SMLib bridge traps (CreateHelicalSweep, analytic edits) |

### Slice usd-conformance: USD conformance and OCCT .brep

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `usd-conformance-value-crash` | confirmed | high | small | X1 | One bad value in a .usda crashes, hangs or silently misimports |
| `usd-conformance-geometric-check` | partial | medium | medium | X6 | Geometrically broken BrepArrays import as valid |
| `usd-conformance-unicode-names` | confirmed | high | small | X3 | Non-ASCII names break export_usd (Python) or collide (wasm) |
| `usd-conformance-analytic-edges` | confirmed | medium | medium | X5 | USD round trip turns analytic edges into B-splines |
| `usd-conformance-analytic-line-reexport` | partial | medium | small | X4 | Re-exported line edges span 2.5 km; native bbox 1.2e6 |
| `usd-conformance-materials` | partial | low | medium | X12 | Material bindings dropped on import |
| `usd-conformance-partial-import` | confirmed | medium | small | X7 | One bad body discards the file; reason hidden |
| `usd-conformance-composition` | confirmed | medium | medium | X2 | References, payloads, sublayers, class and inactive prims |
| `usd-conformance-occt-brep` | confirmed | low | large | X14 | OCCT .brep import via usd-brep's bridge |
| `usd-conformance-no-validator-gate` | confirmed | medium | small | N4 | Nothing runs NVIDIA's validator on smlibpy output |
| `usd-conformance-empty-bodies` | confirmed | low | small | X10 | Empty bodies write schema-invalid USD |
| `usd-conformance-mixed-dimension` | confirmed | low | small | X13 | Mixed-dimension bodies: invalid Part vs Shell |

### Slice input-corpus: Real-world input corpora

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `input-corpus-torus-seam-window` | confirmed | high | small | I3 | O-ring tori fail STEP import (v_start -360) |
| `input-corpus-void-tolerance` | confirmed | high | small | I4 | BREP_WITH_VOIDS: correct build rejected, import fails after 18 s |
| `input-corpus-duplicate-vertices-cause` | confirmed | high | medium | I1 | Cause of duplicate STEP vertices; 7 of 9 fillet crashes |
| `input-corpus-fillet-tangent-sequence-crash` | partial | high | medium | F2 | Fillet segfault in CollectTangentEdgeSequence (stale pointer) |
| `input-corpus-extended-offset-crash` | confirmed | high | medium | O1 | shell/offset segfault in GlueCoincidentBrepVertices |
| `input-corpus-checked-accepts-broken` | confirmed | high | small | O2 | shell/offset accept bodies whose faces do not meet |
| `input-corpus-retry-policy` | confirmed | medium | small | O6 | shell/offset retries never help and cost minutes |
| `input-corpus-assembly-instances` | confirmed | medium | small | I7 | STEP assemblies rebuild every instance |
| `input-corpus-import-check-cost` | partial | medium | small | I8 | STEP import repeats kernel integrations |
| `input-corpus-empty-cut-accepted` | confirmed | high | small | B3 | part - box returns an empty Part on imported pulleys |
| `input-corpus-face-uv-domain` | partial | medium | small | I9 | Imported faces keep the full UV domain; interior_point fails |
| `input-corpus-step-export-offset` | confirmed | low | medium | I11 | Offset surfaces: whole body to NURBS on STEP export |
| `input-corpus-wasm-fillet-divergence` | confirmed | low | medium | W16 | wasm fails two fillets native completes |
| `input-corpus-measure-budget` | partial | low | small | A7 | No time budget in the integrator (no public repro) |

### Slice fuzz: Randomized robustness campaign

| ID | Verdict | Value | Effort | Item | Title |
|---|---|---|---|---|---|
| `fuzz-transform-tolerance-reset` | partial | high | small | B1 | transform_brep resets tolerances from the vertex box |
| `fuzz-offset-glue-uaf` | confirmed | high | medium | O1 | shell/offset crash at random in GlueCoincidentBrepVertices |
| `fuzz-sound-shortcut` | confirmed | high | small | B2 | Boolean results marked sound without a check |
| `fuzz-empty-acceptance` | confirmed | medium | medium | B13 | Empty results accepted by a position-dependent relationship |
| `fuzz-boolean-postprocess-crash` | partial | medium | medium | B5 | Boolean segfault in BooleanPostProcess; cells() stitch crash |
| `fuzz-fillet-tangent-sequence-crash` | partial | medium | small | F2 | Fillet of two collinear edges at a tangency segfaults |
| `fuzz-cells-point-contact` | partial | medium | small | B8 | cells() double-counts inserts touching at a point or line |
| `fuzz-seam-tangency` | confirmed | medium | medium | B6 | Sphere and torus seam tangency give impossible valid results |
| `fuzz-mitigations-measured` | confirmed | low | small | B6, B10 | Measured: NURBS retry 1/87, rotated seams move failures |
| `fuzz-ci-job` | confirmed | medium | medium | N3 | No randomized robustness job |
| `fuzz-error-hints` | confirmed | low | small | B19 | Error hints do not fit the failure |
| `fuzz-shell-mode-shape` | confirmed | low | small | O12 | Shell cavity shape depends on which mode succeeds |
| `fuzz-chamfer-circular-accuracy` | confirmed | low | medium | F12 | Circular-edge chamfers beyond the documented accuracy |
