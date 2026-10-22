# Phase 1 (P0) of the kernel plan: what users see

One entry per item of [kernel-deep-dive.md](kernel-deep-dive.md): what users see now, what they
saw before, and whether it can break existing scripts. This becomes the release notes.

## Group W: smlibwasm runtime

**W1 · Failed kernel calls no longer use the wasm stack up** (wasm)
- Now: every kernel function restores the module's stack pointer when it throws (a kernel error,
  a trap). 40,000 failing calls leave the stack where it was; a viewer that picks on hover, retries
  of operations and raycasts that miss a face no longer wear the module down. The stack lies below
  the static data (`--stack-first`), so an overflow traps instead of overwriting kernel data.
- Before: each failure kept 16 to 900 bytes of the 4 MB stack (144 for a raw `ext.curve_data(0)`,
  336 for a raycast that misses a cylinder's side, a trap several KB). After about 240,000 failures
  (11,000 missed raycasts) every call failed for good, and before that the stack ran through the
  static data.
- Breaks scripts: no. The module is 85 KB larger (6.57 MB; compressed sizes unchanged), and
  `module.stackSave`/`stackRestore` now exist.

**W2 · removeFillets, removeFaces and surfaceFillet stop a kernel step that loops** (wasm)
- Now: as smlibpy runs each step first in a forked copy of its process, smlibwasm runs it first in
  a probe worker, a kernel of its own, on exact copies (.smb) of the bodies, and waits for it with
  `Atomics.wait`. A step that takes longer than `GUARD_SECONDS` (20 s; `setGuardSeconds(seconds)`
  sets it, `0` turns the probe off; both exported) or crashes the kernel there is dropped with the
  same ModelingError as in Python, and the caller's kernel is left alone. This works in Node (main
  thread and worker threads) and in Web Workers of a cross-origin isolated page (checked in
  headless Chromium). `removeFillets(round)` on the enclosure example's outer bottom round now
  throws "could not take out 1 of the 1 fillet faces" after the limit, and `{ partial: true }`
  keeps it; `removeFillets(undefined, { partial: true })` on the whole enclosure finishes (64 s
  with a 5 s limit, volume 38476.6064864591, as Python's 38476.606486459284).
- Before: the same calls busy-looped for good (killed after 90 to 300 s at full load); in a
  browser the tab froze.
- On a page's main thread, or in a page that is not cross-origin isolated, `Atomics.wait` is not
  allowed and the steps still run directly: a step that loops does not come back there. This is
  documented ("Running off the main thread" in docs/javascript.md, which also shows how to run the
  package in a worker). In a browser the package starts a small supervisor worker (no kernel) when
  it is imported in such a worker; the probe worker with its kernel starts with the first step.
- Breaks scripts: no. Each guarded step runs twice (probe, then for real), as in Python, and the
  probe worker holds a second kernel while it lives. Bundles must carry `_defeature_supervisor.js`
  and `_defeature_worker.js` (written as `new Worker(new URL(..., import.meta.url))`, which
  bundlers recognise); a probe worker that does not start within 30 s is given up with a warning.
- Deferred: the general `@classcad/smlibwasm/worker` entry (RPC with bodies as SMB bytes, per-call
  timeout and AbortSignal, terminate and respawn) is not part of this phase. The browser test page
  was not run in the Claude desktop app's browser pane: it starts no nested workers at all (not even
  without cross-origin isolation), unlike Chromium.

**W3 · Meshes no longer keep their kernel mesh; Mesh.dispose()** (both)
- Now: `tessellate()`/`shape.mesh()` copy the arrays out and free the kernel's PolyBrep at once;
  mesh Booleans build a kernel mesh from the arrays when they need it (and free it). What needs the
  tessellation's own mesh (`faceMeshes`, curvature maps in `render`) keeps it and frees it when
  done; `tessellate(face)` frees its copy of the face. `Mesh.dispose()` (and `[Symbol.dispose]`
  in JS) frees what a mesh still holds; the mesh stays usable. 15 kept meshes of a sphere (16k
  triangles each) now take 48 MB more instead of 349 MB; 60 meshes of 57k triangles take 543 MB
  RSS instead of failing with std::bad_alloc at the 51st; 200 `toStl` stay at 552-572 MB.
- Before: every Mesh held its PolyBrep (about 2.5 MB for the gear's 1484 triangles) until the
  garbage collector ran, which in a loop it did not; exports, renders and raycasts made such meshes
  out of sight. Python freed them by reference counting, but kept one per live mesh.
- Breaks scripts: no for the public API. A tessellated face's mesh used in a mesh Boolean now takes
  the turned triangles of its arrays (before, the kernel's unturned mesh). `Mesh._poly` is null for
  tessellations (internal). It also removes M1's symptom: mesh Booleans build the kernel mesh from
  the current arrays each time, so after `a.vertices += (100, 0, 0)` `(a & b).volume` is 0.0 (it
  was 1000.0, the old geometry); M1 itself is left to its group.

**W4 · Faces, edges and vertices of a disposed body say so** (wasm)
- Now: a face, edge or vertex whose body was disposed throws a TypeError ("the face's body was
  disposed: ...") on any use; a disposed body's `volume` says the body was disposed. Standalone
  edges and wires (`Line`, `Polyline`, ...) have `dispose()` and `[Symbol.dispose]`.
- Before: they read freed kernel memory: answers with another body's geometry
  (`center()` of a new box's face), traps ("function signature mismatch"), "is the part a closed
  solid?", or a fillet built from freed edges (5 of 100 runs).
- Breaks scripts: only scripts that used sub-shapes after `dispose()`, which gave wrong answers or
  crashed. The disposal errors are now TypeErrors (they were plain Errors, and through `kernelCall`
  KernelErrors).

**W5 · Unknown options and extra arguments are TypeErrors** (wasm)
- Now: every public function checks its options object as Python checks keywords, against a table
  generated from smlibpy's signatures (`js/src/_options.ts`, `tools/gen_js_options.py`;
  tests/test_js_options.py keeps it current, js/test/options.test.ts checks that every entry is
  checked and that the TypeScript option types match it). A key that is not an option is a
  TypeError naming the right one: `p.bends({ k_factor: 0.3 })` says "did you mean 'kFactor'?",
  `Rectangle(20, 10, { filet: 3 })` "did you mean 'fillet'?". A number in the options' place
  (`Rectangle(20, 10, 3)`) and extra arguments to constructors of parts, sketches and patterns
  are TypeErrors with Python's "takes 2 positional arguments but 3 were given". `offset(part, d,
  { corners })` is a TypeError, as in Python (a part's offset takes no options).
- Before: they were ignored: `k_factor` gave the default K (allowance 4.5239 instead of 4.0841,
  flat length 100.0 instead of 99.5602), typos vanished, `Rectangle(20, 10, 3)` dropped the 3.
- Breaks scripts: yes, scripts that passed a misspelt or Python-spelt option, or extra arguments,
  now throw where they silently got defaults. Keys that start with `_` are not checked.

**W6 · ShapeList.at(point) is a TypeError** (wasm)
- Now: `ShapeList.at` takes an index and throws a TypeError for anything else ("select by a point
  with atPoint(point)"); an `undefined` where edges or faces are expected (Python's `list[-1]`)
  says to use `list.at(-1)` or `list.last`. docs/javascript.md lists both under "From smlibpy".
- Before: `faces().at([0, 0, 15])` returned the first face (the bottom one), and `[-1]` failed
  far away with "'undefined' object is not iterable".
- Breaks scripts: only scripts that called `at` with a point, which got the wrong shape.

## Group Bcore: Boolean results and checks

**B1 · Moved, mirrored and scaled bodies keep their tolerances** (both)
- Now: `translate`, `rotate`, `moved`, `on`, `mirror`, `scale` and every pattern apply a rotation,
  a reflection or a uniform scale with a placement, as SM_API's own `SmApiTransform` does
  (`ext.transform_brep`, shared C++). The tolerances stay; a scaled body gets the tolerances of
  its size from its whole bounding box; shear and scales that differ between the axes take the
  kernel's way, then the same reset; no transform changes the shared context's model size any
  more. An O-ring groove `Cylinder(10, 40) - Torus(10, 1.5).translate(0, 0, 10)` is cut
  (12358.4417, as OpenCASCADE), a moved, rotated, mirrored or scaled torus intersects a box as
  the unmoved one does, and `Box(1000, 1000, 100) + Box(10, 10, 100.00005)` moved by (1, 0, 0)
  keeps its step (11 faces).
- Before: the kernel reset every tolerance from the box of the body's vertices: a torus (one
  vertex) and a full revolve of a circle got tolerance 0, parts over 500 across 1e-4, thin disks
  1e-6. The groove was ignored (12566.37, valid), `torus & box` gave the whole torus (355.31),
  one case hung, and one fuse differed between processes. In the seeded fuzz campaign (seeds 7
  and 8, 2,338 checked operations) the silent wrong Booleans fall from 2.58% to 0.91%, all
  operations from 2.45% to 1.20%, as the plan measured; the hang is gone. In the wasm (the whole
  group): Booleans 2.46% to 0.91%, all operations 2.36% to 1.24%.
- Breaks scripts: only scripts that relied on the wrong results. Booleans with moved tori and
  large parts give other (right) face counts and volumes.

**B11 · Point-in-solid classification: Part.classify, contains, cell_at** (both)
- Now: `part.classify(point, tol=None)` gives `("inside", None)`, `("outside", None)` (a cavity
  is outside) or `("on", the vertex, edge or face)`; `part.contains(point)` is True inside and
  on the surface; `part.cell_at(point)` gives the cell of a merged part as in `cells()` (TS:
  `classify`, `contains`, `cellAt`). New `ext.classify_points(brep, points, tolerance)` in both
  builds. It uses the kernel's `SmBrep::Point3DClassify`, but the kernel takes the region from
  one ray along +X, and once a tight bounding box has been computed that ray can miss a face it
  crosses: a point inside a cylinder fused with a torus came out outside (199 of 200 points near
  it). Two more rays in directions off the axes vote, two more when they disagree. About 0.02 ms
  per point on a small part, 0.8 ms on a plate of 206 faces (points off the surface; points on it
  need no ray). docs/analysis.md, the `raycast` guide and the raycast docstrings no longer
  recommend the parity of ray hits (wrong for grazing rays: 3 of 6 probes); a new guide
  `analysis/classify` covers the three methods, and the MCP's search sends "inside"/"outside"
  there.
- Before: no point query; the documented parity test called a point outside a cylinder whose ray
  grazes it inside, and a point in the material whose ray is tangent to a hole outside.
- Breaks scripts: no (additions).

**B2 · is_valid() checks Boolean results and the gaps between faces** (both)
- Now: a Boolean result is no longer marked sound unchecked; `is_valid()` (and the check every
  feature makes of its input) integrates its volume when asked. `is_valid()` is also False for a
  body whose faces leave gaps that make its volume uncertain by 1e-2 or more ("open between its
  faces, so that its volume is uncertain by 2.5e-01 of its value"): the kernel's intersection of
  two cylinders whose lowest lines touch (volume 250.206, more than its operand's 150.796, gaps
  0.25), the piece of `Torus(6, 4)` split by a plane that touches its outer seam (Python: gaps
  3.5), and `RevitWallHealerCrash.usda` from usd-brep's test files (gaps 2.4, volume 1.3e10),
  which the test suite counted as good. The validity check now uses smlibpy's own integration at
  1e-4 (with the gaps) instead of the kernel's at 1e-3; it costs the same (0.29 against 0.46 ms
  on a box minus a cylinder, 55 against 52 ms on a plate of 206 faces).
- Before: `is_valid()` returned the flag the Boolean had set without integrating, True for a
  negative volume (-776.53) and for the 250.206 above; it ignored the gaps, which only drove a
  RuntimeWarning.
- The threshold is 1e-2, not the plan's 1e-3: sound bodies reach 1.1e-3 (a sheet unfolded at a
  radius far below its thickness, `tests/test_sheet_metal.py::test_radius_range`, whose volume
  is exact to 1e-12) and 6.3e-4 (imported parts; over the 555 parts of the 448-file STEP corpus
  only a deliberately perturbed file reaches 1.7e-3). The wrong bodies measured start at 0.066.
  At 1e-2 no corpus part becomes invalid.
- Not done: the opt-in strict check by tight bounding boxes, which needs a name and belongs with
  the fuzz job (N3).
- Breaks scripts: scripts that tested `is_valid()` on such bodies now get False, and features
  refuse them ("the part is not a valid solid (open between its faces, ...)"). `is_valid()` on a
  fresh Boolean result now costs an integration (once per part). Offsets whose result leaves
  gaps are retried and then refused (one fuzz case, gaps 0.16).

**B3 · Empty cuts and whole-part intersections need evidence** (both)
- Now: an empty cut is accepted only from tools that together hold the part's volume (within
  1e-3) and whose boxes span its box; then, as before, the kernel's intersection must cover the
  part. An intersection that has as many faces as an operand, or whose box reaches out of an
  operand's box, has points of its surface (vertices, the middle of each edge, a point of each
  face) classified against every operand (B11, within 1e-4 of its size); a point outside is a
  ModelingError ("the kernel returned a result that is partly outside an operand"). `(Sphere(20)
  - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0)` raises "empty"; `&` of the same pair
  raises; so do the corner box cuts and intersections of the imported pulleys (crescendo parts 19
  and 40). The list form still gives 28160.6082 (OpenCASCADE: 28160.608175). ai/todo/parts.md
  #18 and #21 are reopened with this.
- Before: the cut returned `Part(0 faces)` with no error, and `&` the whole holed sphere (29089.8,
  valid; right: 929.188), because the kernel's intersection that confirmed the empty cut failed the
  same way.
- Cost: only where the trigger fires. A plate of 206 faces intersected with a box that contains it
  takes 16 ms for the Boolean and 12 ms for the check (the first classification of a body 60 ms
  more, once). A correct intersection that gives an operand back (`box & bigger_box`, `Sphere(5) &
  Box(20)`) passes.
- Breaks scripts: scripts that got an empty Part or the whole part from such a cut now get a
  ModelingError; the right result needs the tools combined until B10's NURBS retry.

**B6 · Seams tangent to the other operand: not landed** (both)
- Tried as the plan says: cylinders, cones and spheres turned about their own axis at creation
  (measured in the fuzz harness on top of B1-B3 and B7, which makes that a rigid placement). With
  37 degrees the sphere-seam case (csg-8-91: `Cylinder(2.5, 30).rotate(Y, 90) &
  Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5)` gives 81.7551, more than the sphere; three
  operations of that case) and two other wrong results become right, but five new silent results
  appear, three of them gross (two shells, a cut that comes back empty and invalid). With 197
  degrees the same five operations become right and the new ones are five inclusion-exclusion
  violations of 1e-6 to 2e-6; fillet errors rise from 37% to 40% and offset crashes from 1 to 3. The plan lands B6 only without new silent
  results, so it is not landed: a seam placement needs a decision (the plan's alternative, a
  pre-check that turns an operand only when its straight seam lies in a tangent plane of the
  other, is a different design). The groove pin (24331.7029 instead of OpenCASCADE's 24299.2587;
  wasm 24364.1472) and the cross holes (7057.1895 instead of 6931.7476; wasm 6994.4685) stay
  wrong and valid; tests document them as expected failures (`xfail(strict=True)` in
  tests/test_guards.py, `todo` in js/test/guards.test.ts). The skill's seam vertices at
  (r, 0, ±h/2) are unchanged.
- Breaks scripts: no (nothing changed).

**B7 · Failed Booleans free their operands** (both)
- Now: the copies that go into a kernel Boolean are held by handles until the kernel takes them
  (it changes the first and deletes the second only when it succeeds): part Booleans and their
  confirming intersection, `merge`, `Shell +`, the bend-zone intersection of sheet metal and the
  imprint of deformations; also the copies of `translate`/`rotate`/... (`ext.transform_brep`),
  `heal` and `to_nurbs`. A new `ext.boolean(brep1, brep2, operation, non_manifold=False)` clears
  the kernel's "doing a Boolean" mark when it fails (SmMerge left it set, checked in a C++
  probe; while it is set the kernel builds no surface caches). 100 failing cuts take 7.6 MB more
  RSS in Python (52.9 MB before), then about 1 MB per 100 (the kernel's own 6 to 10 KB per
  failure); in Node with garbage collection 3 MB (42 MB before).
- Before: each failed cut kept both copies, about 0.6 MB on a small part; wasm memory never
  shrinks.
- Breaks scripts: no.

Fuzz, seeds 7 and 8 (Python, 2,337 operations): errors 10.4%, silent 1.20% (analyser), crashes 8
(B1 alone: 10.2%, 1.20%, 9; before the group 10.1%, 2.45%, 9). Wasm (2,342 operations): errors
10.3%, silent 1.24%, traps 6 (before: 10.1%, 2.36%, 6). The analyser's invariants did not count three wrong results that
now raise: an intersection larger than its operand (csg-8-110), a shell and an offset whose faces
leave gaps (0.066, 0.16). The offset of the extended mode depends on what was computed on the
part before (an `is_valid()`, a tight box), so one offset that came out right before fails now and
another one the other way round (O1).

## Group Bcrash: Boolean and cells crashes

Kernel patches in `third_party/patches/SMLib/src` (README rows): K1 in `SmProtoTopology.cpp`, a
new copy of `SmTopologyIntersector.cpp` (two changes), and K3's vertex half in a new copy of
`SmMerge.cpp`. Each was confirmed with AddressSanitizer first (`build-asan`, procedure in the
patches README): every reproduction below read freed memory before and reads none now.

**B4 · Crossing holes raise KernelError instead of killing the process** (both)
- Now: cut, the list form, fuse, `&` and `merge` of crossing holes whose seams lie tangent to
  the other hole, such as `Box(20, 20, 20) - Cylinder(3, 40).translate(0, 3, 0) -
  Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`, raise `KernelError: cut failed
  (SM_ERR_BAD_INTERSECTIONS): the operands may touch only along an edge, at a point or
  tangentially (move one so they overlap) ...` (30 of 30 runs). There the kernel's curve
  intersector returns nine ranges of one ProtoEdge, each on all of the other;
  `SplitIntersectingProtoEdges` merged and deleted the other after the first and split it again
  for the next. K1 as planned: the NULL tests in `sm_WhichPVToCombine`, `pPE2` for `pPE2`'s
  parameter, and no further solutions once an input ProtoEdge is deleted. Leaving the loop alone,
  as the plan has it, gave valid bodies of the wrong volume that could not be tessellated (`h1 +
  h2` 1697.46 instead of OpenCASCADE's 2199.24, `h1 & h2` 627.21 instead of 62.72, the box cut
  7433.52 instead of 6931.74). So when solutions are left the function returns
  `SM_ERR_BAD_INTERSECTIONS`, and the patched `IntersectTopology`, which ignored its status, fails
  the Boolean on that code (its other errors stay ignored). The path where the deleted ProtoEdge
  was the last solution is unchanged; it ran 9 times in the fuzz seeds, the failing path only on
  these inputs. In the wasm the same inputs raised KernelError before too (after reading freed
  memory); the two intersections there give 62.721 (OpenCASCADE 62.7197), the rest raise.
- Before: the process died (exit 139) in 9 of the 10 reproductions; the z = 3.1 chain cut raised
  KernelError.
- Breaks scripts: no. These Booleans have no result either way; the seam placement of B6 would
  let some succeed.

**B5 · The end-cap cut, the rotated-box shell and cells() of a wrong merge no longer crash** (both)
- Now, the cut: `Sphere(1.5).rotate(Y, 90) - Cylinder(4, 10).rotate(X, 90).translate(0, -3.5,
  -2.504)` (a flat end cap tangent to the sphere) raises `KernelError: cut failed
  (SM_ERR_BAD_INTERSECTIONS)`; `&` of the pair still gives 14.137072. AddressSanitizer did not
  find the stale edge the plan assumed: the edge `BooleanPostProcess` read was alive and in the
  body, but its faces belonged to a shell that `SmTopologyIntersector::DeleteFaces` had freed
  with a shell vertex (`SmBrep::DeleteVertex` deletes a vertex's shell with it, and this shell
  still owned faces). Filtering the edge list by a fresh set (K3's first half) only moved the read
  to the deletion of the broken body, so it is not in the patch. The patched `DeleteFaces` fails
  the Boolean before it deletes a shell that still owns faces. In the wasm the cut trapped ("the
  kernel crashed (table index is out of bounds)"); it now raises the same KernelError.
- Now, the shell: `BooleanPostProcess` takes only the vertices still in the body (K3's second
  half: a set made after the edges are merged, renewed after each vertex it deletes; 7 skips in
  36 calls). `Box(40, 30, 10).rotate(X, 45).shell(10, opening)` crashed in 11 of 48 runs (5 of
  36 in another loop, and in 4 of 4 processes that called it 40 times); none in 96 runs since,
  nor in the test's 40 calls in one process. It still raises (the wall does not fit); that the
  axis-aligned wall check lets rotated parts through is O4's.
- Now, merge: `merge` checks its result: a volume below that of the largest part or above that of
  all parts together raises `ModelingError: merge: the kernel returned a result of volume ..., less
  than that of the largest part (...); a seam of one part that lies tangent to another can do
  this: turn that part about its axis or move it a little`. The merge whose `cells()` crashed in
  the stitcher, `(Cylinder(2.5, 30).rotate(Y, 90) - Cone(2.5, 6, 6).rotate(Y, 90).translate(15,
  0.6687, -3.5)).merge(Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5))`, was 518.314, less than
  the cut cylinder's 566.559 (right: 586.443, OpenCASCADE; the sphere not turned gives that).
  It raises now, so `cells()` never sees it. The volumes are integrated at the accuracy `volume`
  uses and kept, so `volume` and `cells()` reuse them; a merge of a plate with nine pins takes
  24 ms instead of 8. `cells()` itself is not isolated (N1): the stitch of another broken body
  could still crash.
- Before: exit 139 in 3 of 3 runs of the cut and of `cells()`; about one rotated-box shell in four.
- Breaks scripts: merges that the kernel got wrong in this way raise instead of returning a
  part of the wrong volume.

**B8 · cells() of inserts that touch the part around them** (both)
- Now: `ext.region_shells` (src/cpp/cells.cpp, both builds) splits each shell's faces into groups
  joined across edges the shell's faces use exactly twice; of the first shell's groups the one
  with the largest box is the outer boundary, the others are cavities (as separate cavity shells
  were). `Box(20, 20, 20).merge(Sphere(4).translate(6, 0, 0)).cells()` gives [7731.917,
  268.083]; so do a ball against an edge and two balls against opposite walls. Where an insert
  touches along a line, the cavity cannot be cut out (the kernel's cut of a tangent cylinder
  fails): `ModelingError: cells: the cells inside a cell could not be cut out of it (...); an
  insert that touches the part around it at a point or along a line can do this: move it off the
  wall or into it`. And `cells()` checks that the cells add up to the merged part's volume within
  1e-6: `ModelingError: cells: the cells add up to a volume of ..., the part has ...`.
  `cells()` of the plate with nine pins takes 39 ms instead of 29 (the check's integrations).
- Before: the outer cell kept the insert, with no error: [8000.0, 268.083] for the ball, [8502.655,
  502.655] for the tangent cylinder, more than the box. Fuzz seeds 7 and 8: 6 of the 7
  point-contact merges are now right; the line contact raises.
- Breaks scripts: scripts that used such cells got wrong volumes; inserts touching along a line
  now raise.

**B9 · section() of a merged part has every cell; split raises ModelingError** (both)
- Now: `section` of a merged part sections each cell the plane cuts (skipping the cells it
  misses) and returns their regions side by side in one sketch; a face between two cells that
  lies in the plane comes once. `merge(Box(40, 40, 20), Cylinder(6, 30)).section(Plane.XY)`: 2
  faces, 1600 (1486.903 + 113.097); `Plane.XZ` and `Plane.YZ`: 5 faces, 920. `split` checks its
  part first, as features do: a merged part raises `ModelingError: split: the part is not a valid
  solid (not a closed, manifold solid); ...`.
- Before: `Plane.XY` gave 1 face of 1486.903 (the insert dropped, no error), `Plane.XZ` raised
  `KernelError: section failed (SM_ERR)`, `Plane.YZ` gave 5 faces of 780; `split` raised
  `KernelError: split failed`.
- Breaks scripts: sections of merged parts have one region more per cell. A script that caught
  `KernelError` from `split` of a merged part no longer catches the error (`except
  ModelingError` catches both).

Fuzz, seeds 7 and 8 with the seeds' resolved parameters (Python, 2,342 operations): errors 10.5%,
silent 0.90%, crashes 5 (after group Bcore: 10.4%, 1.20%, 8). The changes: 2 Booleans that
crashed raise (csg-7-126 D, csg-8-145 I), the merge of csg-8-91 raises instead of crashing in
`cells()`, 6 cells of point contacts are right and 1 line contact raises. Only offset-8-350/360
flip otherwise, as they did for group Bcore (O1). Wasm (2,342): errors 10.3%, silent 0.98%,
traps 5 (before: 10.3%, 1.24%, 6); the same cells and merge changes, and csg-8-23's intersection
moves from 640.77182 to 640.77171 (both off the cells' 640.77204; the native build gives
640.77171 too when the case's earlier operations are left out), which the analyser's 1e-6 counts
as one more silent result. The remaining crashes are other groups': shell-8-290 dies in
`GlueCoincidentBrepVertices` in about 6 runs of 10, before and after (K2, O1).

## Group F: fillets and chamfers

Kernel patch K4 in a new copy of `third_party/patches/SMLib/src/SmFilletExecutive.cpp` (two README
rows), confirmed with AddressSanitizer first (`build-asan`): every reproduction below crashed or
read freed memory before and reports nothing now. F1, F3, F4 and F5 are changes to `Part.fillet`
and `Part.chamfer` in `shapes.py` and `shapes.ts`; the docs (`docs/features.md`, the skill's
`fillet.md` and `chamfer.md`, the docstrings) say what they refuse.

**F1 · Chamfers of edges at different angles no longer crash** (both)
- Now: a chamfer whose edges meet their faces at different angles bevels them all in one kernel
  call (`fillet_edges_per_edge`, a linear cross-section with each edge's own radius). All 18 edges
  of `RegularPolygon(10, 6).extrude(10)` by 1: valid, 38 faces, volume 2516.8275000 (OpenCASCADE
  2516.8275000), and the old edges lie 0.5 (120 degrees) and 0.7071 (90 degrees) from the body, as
  a setback of 1 along both faces gives. The plan's trapezoid prism, all edges: valid, 26 faces,
  every setback exact; its volume, 4392.3495, differs from OpenCASCADE's 4392.1087 by the corners
  where three bevels of different angles meet (B-spline patches in SMLib, planes in OpenCASCADE).
- Before: one kernel call per edge, with all edges taken before the first call, which replaced the
  edges next to its own: the process died (exit 139, 3 of 3 runs), and the wasm trapped
  ("the length may be too large", detail "the kernel crashed (function signature mismatch)").
  Box chamfers have only 90 degree edges and never took that path.
- Breaks scripts: no. Chamfers whose edges share one angle take the same call as before.

**F2 · Fillets the kernel has no corner for raise instead of crashing** (both)
- Now: filleting the two halves of a box edge that a cone touches tangentially, `p = Box(10, 5,
  20) - Cone(4, 5, 20)` and its two 2.5 mm edges at x = 5, z = 10, raises `KernelError: fillet
  failed (SM_ERR_INVALID_INPUT): the kernel cannot round the selection as given, at any size: an
  edge whose faces meet almost tangentially, or a vertex where the selected edges meet in a way
  it has no corner for (such as the two halves of an edge that another face touches
  tangentially); select fewer edges there`, at r 0.1 and 0.02, in both builds. So do part 100's
  pair of edges (0.15875), and in both builds the all-edge fillets of the 9 imported parts and of
  upstream's `revolution_mold.smb` that crashed (the wasm no longer traps on any of them).
- The cause, found with AddressSanitizer, is not a stale pointer: `SmFilletCorner::Create` has no
  corner for some ways edges meet at a vertex ("Corner Case Not Implemented"; here two rounded
  edges at a vertex of five edges), and `CreateFilletCorners` went on. The vertex then kept, in
  the executive's vertex-to-corner map, the list of its edgeuses where its corner belonged, and
  `CollectTangentEdgeSequence` and `SmFilletSolver::SetExtensionFlags` made virtual calls on that
  list (AddressSanitizer: a call to address 0; natively a jump through the list's own table,
  hence the garbage solver pointers 0x30 and 0x3d the plan saw). The patch fails
  `CreateFilletCorners` in that case and deletes the lists no corner owns; the walk in
  `CollectTangentEdgeSequence` also checks its corners and solvers (the plan's checks; they did
  not fire once the first change was in). Two of the imported parts (7 and 109) then still
  crashed elsewhere: `DoFilleting` shrank a fillet surface whose sliver face the stitching of the
  fillet faces had deleted (AddressSanitizer: heap-use-after-free). It now shrinks only surfaces
  of faces still in the fillet body, and those two raise `KernelError (SM_ERR)`.
- The hint: a fillet or chamfer that fails with `SM_ERR_INVALID_INPUT` (also the kernel's "edge
  cannot be filleted", which 10 imported parts gave before) now says that no size works, instead
  of "the radius may be too large".
- Measured: all-edge fillets of the 479 imported files: the 10 crashes now raise, the other 469
  results are identical (348 volumes, 121 errors). Fuzz seeds 7 and 8 (190 fillets and
  chamfers, resolved parameters): fillet-7-199 crashed and now raises; no other fillet changed.
  The test suite never takes the new paths.
- Not reproduced: the plan's crash of one of the halves alone (1 of 7 runs on 0.4.0): 0 of 80 runs
  on this branch, with the old code paths and the new, and no report in 8 runs under
  AddressSanitizer; the single edge raises the size error (its result is not a closed solid). I1
  (shared vertices on import) is not part of this group; the corner fix does not depend on it.
- Before: exit 139 at any radius; the wasm trapped with "the radius may be too large".
- Breaks scripts: no, these had no result. KernelErrors with `SM_ERR_INVALID_INPUT` have a new hint.

**F3 · A (start, end) radius with continuity raises ValueError** (both)
- Now: `part.fillet(edges, (start, end), continuity=...)` raises `ValueError: fillet: a (start, end)
  radius makes circular rounds only; continuity needs a constant radius` (smlibwasm: RangeError,
  for `{ start, end }`).
- Before: the kernel made the ruled variable chamfer, not tangent to the faces, with no error:
  `Box(40, 30, 20)`, one vertical edge, (2, 6) removed 173.3333 with G1, G2 and G3 alike (the
  circular round removes 74.3999), and `fullness` did nothing. The cause in the kernel is not
  known (the plan's patch is not planned).
- Breaks scripts: yes, scripts that passed `continuity` with a tuple raise; they were getting a
  chamfer, not a blend.

**F4 · A chamfer refuses an edge whose faces change their angle** (both)
- Now: `chamfer` measures the angle between the faces at 9 points along each edge; where it
  changes by more than 1 degree it raises `ModelingError: chamfer: the faces of an edge meet at an
  angle that changes along it (their normals are 60 to 120 degrees apart), and the bevel would
  reach 1 to 3 from the edge instead of 1; round such an edge with fillet(), whose radius stays
  the same along it` (a cylinder tilted by 30 degrees on a plate, the plan's probe). The same
  cylinder upright is chamfered as before. It costs 9 normal pairs per edge: under 2% (40 hole
  rims: 485 ms before, 494 ms now).
- Before: one radius from the angle at the edge's middle, so the setback ran from 1 to 3 along
  the edge, valid and silent.
- Breaks scripts: yes, chamfers of such edges (a hole into a tilted or curved face, crossing
  cylinders) raise; they got a bevel of the wrong size. In the fuzz seeds 4 chamfers that raised a
  KernelError or crashed now raise this ModelingError, and none of the 110 fillets and chamfers
  that succeeded changed. Fillets keep the midpoint angle for their size check (`_setback`); a
  chamfer with a radius law per edge is F8's.

**F5 · A (start, end) radius on a closed edge or a tangent chain raises ValueError** (both)
- Now: a tuple whose two radii differ raises `ValueError: fillet: a (start, end) radius cannot run
  around a closed edge (it would jump back to the start radius at the seam); give a constant
  radius`, and, for two selected edges that meet at a vertex within 10 degrees of tangent (the
  kernel's tangency tolerance for fillet corners), `ValueError: fillet: a (start, end) radius runs
  along each edge on its own, and two of the edges run into each other tangentially at (15, 15,
  5), where the kernel would bend both radii to one; give a constant radius`. A single edge, edges
  that meet at corners and `(r, r)` work as before.
- Before: valid, with no warning: on `Cylinder(10, 20)`'s rim (1, 3) rose linearly to 2.90 and
  fell back to 1 within the last 3% of the edge; on the plan's five-edge chain the radius ran
  1.07 -> 2.93 on one line, 2.46 -> 1.04 on another and 1.65 -> 1.99 -> 1.07 on the arcs.
- Breaks scripts: yes, for those selections; they got bent radii. Laws along a whole chain need
  C++ (F8).

## Group O: shell, offset and remove_faces

Kernel patches in the copies `SmProtoTopology.cpp`, `SmTopologyIntersector.cpp` and
`SmOffsetExecutive.cpp` of `third_party/patches` (six README rows), each confirmed with
AddressSanitizer first (`build-asan`). `shell`, `offset` and `thicken` in `shapes.py` and
`shapes.ts` run their kernel steps out of process and check their results; `remove_faces` in
`defeature.py` and `defeature.ts`. The docs (`docs/kernel.md`, `docs/javascript.md`,
`js/README.md`, `js/PORTING.md`, the skill's `shell.md`, `offset.md`, `thicken.md` and
`remove_faces.md`) say what changed. Measured on 154 imported STEP files (the largest part of each,
up to 250 faces: shell open at the top and closed, offset by +-0.5, as the plan's corpus runs):
HEAD's code on the patched kernel against the new code.

**O1 · shell, offset and thicken no longer kill the process** (both)
- Now: the kernel steps of `shell` (both modes), `offset` and `thicken` run in a forked copy of
  the process (Linux, macOS), whose body comes back as an exact binary `.smb` copy; this process
  never runs them. A crash there raises `ModelingError: shell: the kernel crashed (signal 11, in a
  copy of this process); this process is fine`, a step longer than `GUARD_SECONDS` (20 s,
  `smlibpy.defeature.GUARD_SECONDS`) `ModelingError: offset: the kernel did not finish within 20 s;
  smlibpy.defeature.GUARD_SECONDS sets the limit`, and the kernel's errors are raised as before.
  Ctrl-C stops the copy. smlibwasm runs them in its probe worker (a kernel of its own), which hands
  the body's `.smb` contents, or the error, back through a SharedArrayBuffer a piece at a time (a
  15 MB body came back intact); a trap there is the crash. Where there is no probe worker (a page's
  main thread, `GUARD_SECONDS = 0`, Windows) the steps run directly, and in smlibwasm a trap there
  ends the attempts.
- Kernel (K2, and two more sites the reproductions showed under AddressSanitizer):
  `GlueCoincidentBrepVertices` glued a Vertex it had already deleted (an Edge to it squeezed, or
  glued along another common Edge); `ResolveOverlappingProtoEdges` deleted ProtoEdges that other
  ProtoFaces still listed as coincident (the plain shell of imported part 40 crashed in every
  run), and read the missing ProtoVertex of a ProtoEdge; `DoExtendedOffset` handed out an extended
  surface after deleting it when two faces shared one surface (two cones fused at an angle). The
  first now stops at the deleted Vertex, the second cleans every list and fails such a group
  (`SM_ERR_BAD_INTERSECTIONS`; `ResolveIntersections` then fails the Boolean), the third fails the
  extended mode for shared surfaces. Of the plan's other K2 parts: the inline short-edge path no
  longer calls `Destruct()` either (in 73 calls it never deleted a curve a Brep used; the README is
  right now); the deleted-vertex sets stay per ProtoVertex, since the function already deletes
  every VertexDefinition of a deleted Vertex after each one.
- Measured natively with HEAD's Python (eight attempts in this process), before and after the
  kernel patches: the L-shaped body 6 of 30 runs crashed -> 1 of 30, a second L-shaped body
  (fuzz shell-8-290) 22 of 30 -> 0 of 30, the cone offset and the two cones 10 of 10 each -> 0 of
  10 (3 calls per run), imported parts 15 and 34 6 of 6 -> 0 of 6. The filleted boxes of issue #2
  (`Box(40, 30, 10)`, all edges r1, t 0.5 or r2, t 1; `Box(20, 20, 20)`, r2, t 1) still crash in
  the kernel now and then (2, 1 and 2 of 10 runs of 3 calls; raw extended steps 1 process in 20
  of 8 calls): `SmEdge::CalculateBoundingBox` on a freed Edge as a `ManifoldBoolean` of
  `PiecewiseMerge` starts. AddressSanitizer (about 480 extended steps) and libgmalloc never take
  that path, so its site is not known; it is contained by the copy. With the new code no case
  crashed. Imported parts: 6 files crashed with HEAD's code on the patched kernel, none now (the
  offset of part 81 reads a null pointer in `SmBezierAux2d::BuildPolarBox` under
  AddressSanitizer, not patched); 6 plain shells ran longer than 20 s in the copy and were stopped
  (parts 37, 40, 47, 101 and 118), which failed or crashed with HEAD's code too, except part 47's.
- Cost: a fork and an `.smb` write and read per step, about 1 ms on small parts; the 406-face
  plate with 400 holes: offset 16.1 s through the probe worker against 15.4 s without.
- Before: exit 139 at random (a shell of the L-shaped body in 1 of 4, every offset of the fused
  cone, issue #2's filleted box in 1 of 10); the wasm trapped and went on with a damaged heap.
- Breaks scripts: a step that takes longer than `GUARD_SECONDS` now fails (the slowest steps of
  the corpus that succeeded took 14 s; raise the limit for big parts): part 47's closed shell took
  30 s and gave a body without a cavity. In smlibwasm the extended mode can give another result
  than the caller's kernel would have (the probe's kernel has another history): fuzz offset-8-350
  now fails where it gave 325.9596. And `node --test` gives its test processes options that Node
  refuses for workers: the probe worker now starts without them (before, it never started there,
  so W2's guard did not run under `node --test`).

**O2 · shell and offset refuse bodies whose faces do not meet, or that have no cavity** (both)
- Now: a result is refused when its faces leave gaps of 1e-3 of its volume or more (`is_valid()`
  draws the line at 1e-2), when an inward shell does not lose volume, when a point of the part that
  no wall reaches is not in the shell's cavity, and, for a closed shell, when its volume is not the
  part's less its offset by the wall (the same kernel mode; equal to 1e-16 on the bodies tried).
  When every attempt is refused: `ModelingError: shell: the kernel could not build a valid result
  (it built a body whose faces do not meet, so that its volume is uncertain by 2.7e-01 of its
  value); ...`. `offset(0)` gives an equal copy without asking the kernel.
- Imported parts: closed shells of parts 50 and 163 gave 176918 and 232528, near the parts' own
  volume; now 84151 and 109940 (wall times area, as expected). Closed shells of parts 32, 47, 92,
  100, 111, 112, 122 and 124 gave the part back, or nearly (the equality clause accepted the
  kernel's extended mode returning the input), and are refused; so are the open shells of parts
  42, 92, 100, 124 and 137, which removed less than 0.1%, while those of 134 and 156 now have
  their cavity (1085.78 -> 524.04, 779.37 -> 375.65). Part 118's closed shell and part 57's offset
  (gaps 2.2e-3 and 2.0e-3) are refused. Fuzz seeds 7 and 8: 4 shells that returned the part or a
  body of one face are refused.
- Before: `(Box(20, 20, 10) - Cylinder(3, 20)).shell(4)` returned the plate itself (3717.2567,
  valid); shells without a cavity and bodies with open rims passed.
- Breaks scripts: yes, those that used such bodies. The shell guide's rounded box (all edges r5,
  open at the flat top) is one: its rim stays open (gaps 0.27); the error now says that the kernel
  cannot open a face whose rim meets its neighbours tangentially, and the guide rounds only the
  edges away from the opening (O3 is to make the original work).

**O4 · shell measures the walls across the part** (both)
- Now: with openings, `shell` measures the part across each face that is not an opening, into it
  (a ray from the middle of the face along its inward normal), and refuses two walls that do not
  fit (or one, to an opening) before the kernel runs: `ModelingError: shell: two walls of 2.94 do
  not fit into the part, which is 4 thick across the face at (-1, -5, -7.5); use a thinner wall`.
  A closed shell is checked on its result instead (as the plan has it): solid where the part is
  too thin for two walls, hollow where no wall reaches, the part less its offset. The axis test
  stays the first check. The rays cost about 6 ms per face on an imported part (0.9 s for 151).
- Before: the walls were measured along the world axes only: `Box(40, 30, 10).rotate(X, 45)`
  shelled by 6 gave a valid 10992.0 and by 10 the plate itself (10 faces); with an opening it
  crashed in 4 of 36 runs.
- Breaks scripts: yes, open shells of parts with a region thinner than two walls now raise, also
  where the kernel could cope: fuzz shell-8-349 (a sphere less a cylinder, a sliver 0.39 thick,
  walls 1.86) gave 311.16, which OpenCASCADE confirms; shell-7-297 (no reference: OpenCASCADE
  fails) and imported part 30 (a sliver 0.012 thick, walls 0.079; it gave 200.49, close to wall
  times area) raise too. The other 4 open shells of imported parts refused this way had removed
  less than 0.1% of the volume.

**O5 · remove_faces keeps the face its rounds enclose** (both)
- Now: a face that the selection encloses goes with it only where it is a feature's floor: one of
  its edges is a corner, or the selection's rim is. The top of a box with its rounded top edges
  selected stays, and a selection of rounds only goes to `remove_fillets`:
  `b = Box(20, 20, 10).fillet(top edges, 2); b.remove_faces(b.faces().fillets())` is 4000.0 with
  6 faces. A boss whose rim round alone is selected keeps its top (16785.398, the sharp boss). A
  pocket's floor inside its rounds still goes with the pocket's walls. Where the rim gives no
  direction (tangent or mixed edges), the result may change the volume by no more than the faces'
  area times the size of their box, and the part's box may not shrink.
- Before: 3200.0, the box 2 lower, valid; the rounded boss came back 1 lower (16706.858).
- Breaks scripts: no, except those that relied on the lowered body. Chamfers around a face still
  cannot be removed (the face goes with them, and the kernel cannot close the gap: an error).

**O6 · shell and offset do not repeat what fails** (both)
- Now: `shell` runs the kernel's plain mode once, then its extended mode, and that once more only
  when its result was refused; `offset` once, and once more after a refused result. No attempt
  follows a kernel error in the same mode, a crash, a step that did not finish, or (for a repeat)
  10 s of attempts.
- Before: shell tried 8 times (plain twice, extended six times), offset 8 times; over 420 runs on
  imported parts no repeat ever helped, and a failure cost up to 115 s (wasm 176 s). The imported
  parts' 536 steps took 1687 s with HEAD's code and take 591 s now.
- K12: `ShellBrep` deletes the offset body when `ReplaceImplicitOffsets` fails (hygiene; that path
  never ran here). LeakSanitizer is not available on macOS arm64; macOS `leaks` finds about 4.7 KB
  per failed extended shell, curve copies in `SmOffsetGeometryCreation::ExtendTrimEdges` (not
  patched), and the wasm's resident memory stays flat over 160 failed raw extended shells after the
  first 40 (old and new kernel). The plan's 2 MB per failed attempt (a measure of heap in use) is
  not seen in either.
- Breaks scripts: no. A part that only a later repeat could shell fails sooner (on the imported
  parts, every such late result was the part given back unchanged).
