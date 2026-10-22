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
