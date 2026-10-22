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
