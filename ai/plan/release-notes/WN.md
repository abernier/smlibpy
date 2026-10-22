# Lane WN, batch 1: the worker entry, loading and bundling, out of memory, the three.js snippet

Items W2+ (the rest of W2), W7, W8 and DOCS-SNIPPET of the kernel plan. All of them are wasm
(smlibwasm) only: smlibpy (Python) is unchanged.

## Fixed

- wasm: C++ exceptions of the kernel's bindings reach JavaScript as errors with a message (W8).
  `bind_kernel*.cpp` and `bind_topology.cpp` let them out as an opaque `WebAssembly.Exception`: no
  `Error`, no message, not a `KernelError`, and each kept its 108-byte C++ object (2,000 of them
  kept 216 kB). Now `std::bad_alloc` is an `Error` "SM_ERR_OUT_OF_MEMORY: the kernel ran out of
  memory (std::bad_alloc)", `std::length_error` and the other exceptions Python makes a
  `ValueError` of a `RangeError`, any other an `Error` with its message, as `guard` makes them for
  smlibpy's own C++ (which now also catches `bad_alloc`); the C++ object is freed. Through the
  public API memory that is used up is a `KernelError` of status `SM_ERR_OUT_OF_MEMORY` whose hint
  says how much is in use and to dispose of parts: `make faces failed (SM_ERR_OUT_OF_MEMORY): the
  kernel ran out of memory (0 MB in use, at most 4096 MB): dispose() parts you no longer need, or
  let the event loop run so that the garbage collector frees them`. A trap after an allocation
  failed (malloc set ENOMEM), or with the module's memory within 64 MB of its 4 GB, says
  `SM_ERR_OUT_OF_MEMORY: the kernel crashed when it ran out of memory (...)` instead of "the
  kernel crashed (table index is out of bounds)".
- wasm: the loader bundles for the browser (W7). Its `import("node:module")` failed webpack 5
  (`UnhandledSchemeError`) and esbuild (`Could not resolve "node:module"`), and Vite warned. A
  build step (`js/scripts/patch-loader.cmake`, run after every link) makes the name at run time
  with `/* webpackIgnore: true */ /* @vite-ignore */`; webpack 5.105, esbuild 0.27 and Vite 4.5
  then bundle it without an error or warning, and Node loads it as before.
- wasm: the package bundles with Vite and webpack again (W7; unreleased, from phase 1's probe
  worker). Vite 4.5 refused it ("unable to parse the worker options": the workers were named by a
  constant), Vite 7.3 too ("Circular worker imports detected": the probe worker imported the kernel,
  whose module started the supervisor, which starts the probe worker), and both, with webpack,
  copied every file of the package (also the `.d.ts`) into the build for a URL whose name was a
  template. The worker options are literal, the kernel's modules no longer import `_guard.ts` (the
  package's entry does, first), and Node's file names are built off `import.meta.url`. Checked in
  a browser (the desktop app's Chromium): a Vite 7 build and a webpack 5 build of a page whose
  worker imports the package, and a Vite 7 build of a page that uses the package on its main thread.
- docs/javascript.md: the three.js snippet gave each mesh vertex the mean normal of the triangles
  around it (`computeVertexNormals` on shared vertices), up to 88.9 degrees off the surface at the
  box's edges (measured with three r186), and had no edges and no Y-up. It now gives each triangle
  corner its own vertex with the kernel's corner normal (0 degrees off on flat faces), draws the
  part's own edges as line segments (64 per curve) and turns the model to three.js's Y up.

## New

- wasm: `@classcad/smlibwasm/worker` (W2): functions in a Web Worker or Node worker thread with a
  kernel of its own. The worker's module calls `expose(() => import('./models.js'))` (or
  `expose({ ... })`); the page makes `new KernelWorker(() => new Worker(new URL('./cad.worker.js',
  import.meta.url), { type: 'module' }), { timeout })` (or gives the module's URL) and calls
  `call(name, args, { timeout, signal })`, or `functions.name(...args)`. Bodies (`Part`, `Shell`,
  `Sketch`) cross as binary `.smb` with name, color and sketch plane; faces, edges and vertices as
  their body and index (each body once per message, so `face.owner === part` over there); meshes
  as their typed arrays, transferred (the sender keeps a copy of its own); vectors, locations,
  planes, axes, boxes, NURBS data and hits as numbers; plain data as itself; anything else is a
  `TypeError`. Errors keep their class (`ModelingError`, `KernelError` with operation, status,
  hint, `TypeError`, `RangeError`, `WebAssembly.RuntimeError`) and the worker's stack. A call that
  runs longer than its timeout rejects with a `TimeoutError` (DOMException) and one whose
  `AbortSignal` fires with the signal's reason; both terminate the worker, and the next call starts
  a new one; a call that waits is only dropped. A worker whose kernel crashed or ran out of memory
  is replaced too. `start()`, `pending`, `terminate()` (rejects the calls that wait or run; the
  next call starts a new worker). The page loads no kernel unless a body, mesh or sub-shape comes
  back (checked with module load hooks). An idle Node worker does not keep Node running. W2's
  case: `removeFillets` of the enclosure example's outer bottom round, run without the probe worker
  (as on a page's main thread), loops for good; a call with `{ timeout: 4000 }` ends after 4 s and
  the next call runs in a new worker.
- wasm: `@classcad/smlibwasm/init` (W7): `init({ locateFile | wasmBinary | wasmModule |
  instantiateWasm })` before the package loads the kernel, for CDNs, Electron, bytes from a cache,
  a module compiled once for many workers, and bundlers that leave the `.wasm` out (esbuild, Bun);
  resolves to the package. A kernel that fails to load rejects (it waited for good through
  Emscripten's own hook).
- wasm: `memoryUsage()` (W8): `{ used, heap, limit }` in bytes: what the kernel's objects take, how
  far the module's memory grew, and its limit (4 GB less 64 kB). The docs' Memory section names the
  limit and the out-of-memory error.
- wasm: the API section of the JavaScript docs lists the two new entries (`scripts/api.mjs`
  `ENTRIES`); its "Errors" section is "Errors and memory".
- wasm, for those who call the kernel directly: `k.runtime.memory_usage()` (also `failed`, whether
  an allocation failed since the last look) and `k.runtime.exception_info(rethrow)`
  (`js/cpp/bind_runtime.cpp`).

## Behaviour changes

| Where (wasm) | Now | Before |
|---|---|---|
| a kernel binding that throws a C++ exception (`k.*`, and every public call made of them) | `Error` (`std::bad_alloc`: "SM_ERR_OUT_OF_MEMORY: ..."), `RangeError` for `invalid_argument`, `length_error` and the like | a `WebAssembly.Exception`: no `Error`, no message |
| memory that is used up, through `kernelCall` (every public operation) | `KernelError`, status `SM_ERR_OUT_OF_MEMORY`, the out-of-memory hint in place of the operation's | `KernelError`, status null, the operation's hint (or the raw exception) |
| a trap after an allocation failed, or near the 4 GB limit | detail "SM_ERR_OUT_OF_MEMORY: the kernel crashed when it ran out of memory (...)", status `SM_ERR_OUT_OF_MEMORY` | "the kernel crashed (...)", status null |
| `std::bad_alloc` in smlibpy's own bindings (`k.ext.*`) | message "SM_ERR_OUT_OF_MEMORY: the kernel ran out of memory (std::bad_alloc)" | "std::bad_alloc" |

Migration: code that caught the opaque exception now gets an `Error`:

```js
// before
try { build() } catch (e) { if (e instanceof WebAssembly.Exception) console.warn('out of memory?') }
// after
try { build() } catch (e) { if (e instanceof KernelError && e.status === 'SM_ERR_OUT_OF_MEMORY') console.warn(e.hint) }
```

Code that copied the three.js snippet of the old docs keeps working, with wrong shading at sharp
edges; the new snippet replaces it:

```js
// before: shared vertices, averaged normals
geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1))
geometry.computeVertexNormals()
// after: a vertex per triangle corner, with the kernel's normal
const position = new Float32Array(mesh.triangles.length * 3)
mesh.triangles.forEach((v, i) => position.set(mesh.vertices.subarray(3 * v, 3 * v + 3), 3 * i))
geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
```

Internal (no public change): `ModelingError` and `KernelError` live in `js/src/_errors.ts`, which
loads no kernel (`kernel.ts` and `index.ts` export the same classes); `_workerArgv` and the worker
names moved to `_threads.ts` (`_guard.ts` re-exports them); `index.ts`, not `kernel.ts`, imports
`_guard.ts` first; the kernel's module is made through `_loader.ts`.

## Not done

- W8's `EXPORT_EXCEPTION_HANDLING_HELPERS`: deprecated in Emscripten 5.0.4, and its
  `getExceptionMessage` allocates (and writes through a null pointer when that fails), so it can
  fail exactly when the memory is used up. `runtime.exception_info` throws the exception back into
  C++, which catches it by type without allocating; the kernel's bindings were not wrapped one by
  one in `guard`.
- A real out-of-memory trap is not in the tests (it needs the whole 4 GB): the rule that names it
  (`_crashText`) is tested on its own, and the `bad_alloc` path with an allocation of 4 GB, which
  fails at once.
- Vite 4 cannot bundle a module worker that imports the package: it stalls ("Unexpected early
  exit") on the package's own defeature workers inside the user's worker. Vite 7.3 and webpack 5
  do. esbuild and Bun bundle the package but do not copy `smlibwasm.wasm` (documented: copy it, or
  `init({ locateFile })`).
- No Python counterparts and no skill references: the worker entry, `init` and `memoryUsage` are
  JavaScript-only (Python forks for isolation and its kernel shares the process's memory); the
  skill is smlibpy's (Python) guide. `js/PORTING.md` lists them as JavaScript-only.
- `KernelWorker` runs one call at a time in one worker (no pool) and does not hand a compiled
  module to the workers it respawns (a worker can call `init({ wasmModule })` itself).
- W2's in-kernel deadline counter and main-thread async variants of `removeFillets`/`removeFaces`
  (the plan's longer-term part) are not in this lane's batch.
- W9 plans `kernelMemory()`: `memoryUsage()` is that function.

# Lane WN, batch 2: isolated kernel steps that return results (N1), scope() and the port's temporaries (W9), sanitizer, leak and upstream-oracle checks (N2), the fuzz run (N3)

Items W9, N1, N2 and N3 of the kernel plan.

## Fixed

- Both: guarded kernel steps run once (N1). `defeature._guarded` (smlibpy) and its smlibwasm
  counterpart ran each step of `remove_fillets`, `remove_faces` and `surface_fillet` first in a
  copy (a fork; the probe worker) and then again in the user's process, which cost the step twice
  (1.3x on a realistic part) and let a crash that depends on memory layout still kill the process.
  Now `smlibpy._guard.isolated(what, fn, *args)` (smlibwasm: `_isolatedValue`) brings the copy's
  result back: bodies as binary `.smb` (the kernel's own exact format), the rest pickled (JSON in
  smlibwasm), and errors and warnings raised as they were raised there. The process the user runs
  never runs the step. Measured with counters on the kernel calls: 0 calls in the user's process
  (before: one per step).
- Both: `Part.cells()` of some merges ended the process (smlibwasm: trapped), in the stitcher's ray
  (`SmBezierAux2d::BuildPolarBox` from `SmBrep::FindInfiniteRegion`; B5's second half). Found by
  the fuzz run on its first random seed (20261022, case csg-153:
  `Cone(3, 0, 4).rotate(X, 90).merge(Cylinder(1.5, 16).rotate(Y, 90).translate(-5, 0, 3)).cells()`,
  exit 139 in 3 of 3 runs before). It runs in another process now (N1): `KernelError: cells failed`,
  and the process goes on. The same merge holds 149.19267 in smlibpy and 145.98511 in smlibwasm (a
  divergence, not investigated: N5).
- smlibpy: the copies of curves handed to the kernel's sweeps, skins and offset profiles were never
  freed (N2's leak check found it). SmPyLib marks these calls "Pure" (they copy what they are
  given): `Sketch.revolve`, tapered `extrude`, `offset` of a sketch, `loft` of solids, `extrude` and
  `revolve` of open curves and mitered `sweep`s leaked 320 to 2350 bytes per call (malloc zone
  statistics: revolve of a rectangle 1280 bytes a call, a two-section loft 2352). Now 0. smlibwasm
  had the same leak, now 0 too (`memoryUsage().used`).
- smlibwasm: the port frees its own temporaries (W9). The garbage collector frees kernel objects
  only between tasks of the event loop, so the intermediates of a call (a Boolean's refused
  results and combined tools, the half space of `split`, the curves of sketch constructors and
  `Text`, the profiles of `sweep`, the cells of a merge) stayed until the loop ended. The public
  functions that make them (Booleans, `split`, `cells`, `Polygon`, `RegularPolygon`, `Triangle`,
  `Trapezoid`, `Slot`, `ArcSlot`, `Hull`, `Text`, `sweep`, `loft`, `revolve`, `fromDxf`,
  `importDxf`, `stitch`, `flatPattern`, `surfaceFillet`) run in an internal `scope` now, and leave
  only what they return (a probe over 70 calls: 35 of the port's own intermediates left behind
  before, 0 now).
- docs/javascript.md said that `part.dispose()` "keeps memory flat in long loops". It does not: 400
  synchronous regenerations of `Box(30, 20, 10).cut(Cylinder(4, 20)).fillet(...)` grew the module's
  memory from 64 to 191 MB, and to 133 MB with each result disposed (the box, the cylinder and the
  cut stay until the loop ends). The Memory section now says so and shows `scope`, with which the
  same loop stays at 64 MB (0 kernel objects left).
- tests/test_guards.py's own test leaked the curves it handed `rotational_sweep`.

## New

- smlibpy: `smlibpy._guard` (N1), the isolation of kernel steps, with two ways to get the other
  process, chosen by `smlibpy.defeature.GUARD_PROCESS`: `"fork"` (a forked copy per step, Linux and
  macOS, about 1.5 ms) and `"helper"` (one helper process for the session,
  `python -c "from smlibpy._guard import _serve; _serve()"`, started with the first step and again
  after a step crashed it or ran too long; the bodies go to it as `.smb` files, faces, edges and
  vertices as their indices); `"auto"` (default) forks where the system can and uses the helper
  elsewhere (Windows). A frozen application, or a helper that does not start within 30 s, runs the
  steps in its own process (a `RuntimeWarning` says so once). Ctrl-C stops a guarded step at once
  in both ways (the helper ignores SIGINT; its caller ends it); it does not stop a kernel call in
  the user's process. Documented in docs/kernel.md ("Steps in another process") and the skill
  (`parts/guards`).
- Both: more steps run guarded (N1): `Part.cells()` (the stitcher crashed on some merges, B5),
  fillets and chamfers of parts read from files (`import_step`, `load`, `import_usd`; smlibwasm
  `fromStep`, `fromSmb`, `fromUsd`) and of the parts made from them (F2's corpus crashes; marked by
  `BrepHandle.imported`, carried by every result made from such a part and across a
  `KernelWorker`), and, opt-in, every Boolean and merge: `smlibpy.defeature.GUARD_BOOLEANS = True`
  (smlibwasm `setGuardBooleans(true)`, `GUARD_BOOLEANS`).
- smlibwasm: `scope(fn)` (W9): runs `fn` and disposes every kernel object it made that its result
  does not hold (also in arrays, ShapeLists, Maps, Sets and plain objects); scopes nest; where `fn`
  throws, what it made is freed; a promise is a TypeError. JavaScript-only (Python frees each
  object at its last reference); docs/javascript.md "Memory", js/README.md, js/PORTING.md.
- smlibwasm: `memoryUsage().handles` (W9, the plan's `kernelMemory()`): the kernel objects
  JavaScript holds and has not freed yet.
- N2: `.github/workflows/checks.yml` ("Checks", nightly, on demand; the fuzz job also on pull
  requests that touch the kernel or the modelling code):
  - `tools/sanitize/run.py`: AddressSanitizer and LeakSanitizer over `test_defeature`,
    `test_guards`, `test_draft` and `test_io` with every kernel step in the test process; fails on
    a memory error not in `tools/sanitize/known.txt` and on a leak of the kernel or smlibpy's C++
    not in `tools/sanitize/leaks.txt` (Python's own leaks and the module's import are not counted).
    LeakSanitizer runs on Linux, and on macOS with LLVM's clang (the patches README said it does
    not run on macOS arm64: Apple's clang has none). Locally: LLVM 21 on macOS arm64, 134 passed,
    no unknown reports.
  - `tools/oracles/prog_test.py` and the CMake option `SMLIBPY_PROG_TEST` (new file
    `tools/oracles/prog_test.cmake`): upstream's 17 `prog_test` suites against the patched kernel,
    17 of 17 pass in 10 s.
  - `tools/oracles/smpylib_tests.py` with the shim `tools/oracles/shim/_omni_solid.py`:
    upstream's `test_omni_solid.py` against `smlibpy._core`: 366 passed, 33 left out (the `usd`
    submodule, which smlibpy builds without, and two docstring checks).
  - `tools/oracles/smb_files.py`: upstream's 200 `.smb` test files against
    `tools/oracles/smb_files.json` (198 load; `Platform.smb` and `SmallBox.smb` raise KernelError).
  - `tools/oracles/crash_loops.py`: the O1 and O4 inputs, 20 fresh processes each with the guard
    off. Two still crash now and then and are marked known: the L-shaped box's extended shell (1 of
    30 runs of 8 calls) and issue #2's filleted boxes (10 of 30 runs of 3 shells); the fused cone,
    the two cones and the rotated box crashed in 0 of 30.
  - The two memory regression tests the plan asked for (100 failed cuts, 100 STEP imports) were
    already in both suites (B7, I2); new: per-call heap tests of the sweeps, skins and offset
    profiles (both languages).
- N3: `tools/fuzz/` (`gen.py`, `run_py.py`, `run_wasm.ts` and `run_wasm.py`, `check.py`,
  `minimise.py`, `repro.py`, `fuzz.py`, `baseline.json`): seeded random models (Booleans,
  fillets, chamfers, shells, offsets, slices of primitives placed flush, touching, centred or on a
  face), each case in a forked process, through smlibpy and smlibwasm on the same parameters,
  checked against invariants (inclusion-exclusion, |A - B| = |A| - |A n B|, the sum of cells, exact
  volumes of primitives, the offset round trip, split sums, box containment) and against the
  baseline of seeds 7 and 8 (the regression corpus) and its silent rate (+0.3 points). New
  failures are made smaller and written as pytest files. Seeds 7 and 8: 410 cases each, about 55 s
  per language, no crash, no hang, no trap; silent rates 0.65 % and 1.2 to 1.3 % (smlibpy), 12 and
  4 to 7 smlibpy/smlibwasm divergences (a few Booleans of seed 8 come out differently from run to
  run in smlibpy: the baseline unites three runs, and a new failure of a known seed counts only if
  two more runs repeat it). The first random seed (20261022) found the `cells()` crash above, a
  known site (`SmBezierAux2d::BuildPolarBox`), which the run tolerates with its trap in smlibwasm.
  The CI command (seeds 7, 8 and the date, both languages) takes about 3 minutes here.
  docs/kernel.md "Checks of the kernel" describes the jobs.

## Behaviour changes

| Where | Now | Before |
|---|---|---|
| smlibpy on Windows: `remove_fillets`, `remove_faces`, `surface_fillet`, `shell`, `offset`, `thicken`, `cells()`, fillets of imported parts | the kernel step runs in a helper process (started once, about 0.2 s), and a crash or a step longer than `GUARD_SECONDS` is a `ModelingError` | in the process itself: a crash ended it, a loop never returned |
| smlibpy and smlibwasm: `remove_fillets`, `remove_faces`, `surface_fillet` | the step runs only in the copy (fork, helper, probe worker); its result comes back | the step ran in the copy and then again in the user's process |
| `Part.cells()` | runs the stitcher in another process; a crash there is a `KernelError` of `cells` | in the process |
| `fillet`, `chamfer` of a part read from a file (or made from one) | the kernel step runs in another process (about 12 ms more per call on a small part: the fork and the `.smb` copy of the result) | in the process |
| smlibwasm `memoryUsage()` | `{ used, heap, limit, handles }` | `{ used, heap, limit }` |
| smlibwasm: the warning when the probe worker's files are missing | "...; the kernel steps that can crash (of removeFillets, removeFaces, surfaceFillet, shell, offset, thicken and cells) run in this kernel, without a time limit" | "...; the kernel steps of removeFillets, removeFaces, surfaceFillet, shell, offset and thicken run in this kernel, without a time limit" |

Migration: code that replaced kernel functions to test or trace them (mock, monkeypatch) no
longer sees the calls of guarded steps where they run in a helper process (Windows, or
`GUARD_PROCESS = "helper"`) or in smlibwasm's probe worker; run them in the process:

```python
# before (Windows ran these steps in the process)
monkeypatch.setattr(smlibpy.shapes.ext, "region_shells", fake)
part.cells()
# after
monkeypatch.setattr(smlibpy.defeature, "GUARD_SECONDS", 0)  # the kernel in this process
monkeypatch.setattr(smlibpy.shapes.ext, "region_shells", fake)
part.cells()
```

```js
// before
ext.region_shells = fake
part.cells()
// after
const old = setGuardSeconds(0) // the kernel on this thread
ext.region_shells = fake
part.cells()
setGuardSeconds(old)
```

Code that compared the keys of `memoryUsage()` exactly sees `handles` as well:

```js
// before
assert.deepEqual(Object.keys(memoryUsage()).sort(), ['heap', 'limit', 'used'])
// after
assert.deepEqual(Object.keys(memoryUsage()).sort(), ['handles', 'heap', 'limit', 'used'])
```

## Not done

- N1's helper process is tested on macOS (the guard tests and the lane's tests in both ways, the
  whole guard, defeature, surfaces and modelling suites with `GUARD_PROCESS = "helper"`), not on
  Windows itself; CI's Windows job is its first run there. macOS keeps forking by default (the
  plan's "Windows and macOS spawn"): fork works there and costs no copies; `GUARD_PROCESS =
  "helper"` chooses the helper.
- N2's Linux jobs have not run: no Linux machine here (Docker's daemon was not running). The
  sanitizer run was checked on macOS arm64 with LLVM 21 (ASan and LSan), the oracles on macOS
  arm64. `tools/oracles/smb_files.json` was made on macOS arm64 (volumes compared to 1e-6).
- The sanitizer run found kernel defects that are listed, not fixed: a heap-buffer-overflow in
  `SmCurveClassification::FindInterval` from `sm_FixProblemsBySqueezing` in the extended offset
  mode's merge (`tools/sanitize/known.txt`; the steps of
  `test_offsets_that_read_freed_kernel_memory_fail`; possibly the unlocated crash of issue #2),
  and leaks in `SmPrimitiveCreation::CreateSweepAlongPlanarPath` (the copies of the profile and
  path per segment, about 10 kB per mitered sweep) and `SmProtoTopologyManager::CreateProtoEdge`
  (`tools/sanitize/leaks.txt`). Lane C has a patched `SmPrimitiveCreation.cpp`; the sweep leak's
  fix (delete `sNewProfileCurves` after each segment and `crvCopy` in `SweepProfilesAlongPath`:
  `SmApiCreateCurveSweep` says `CreateCurveSweep` works on copies) belongs there.
- N3's baseline covers darwin-arm64 only; on Linux x86_64 the run compares crashes, hangs and
  silent rates (against darwin-arm64's) until `python tools/fuzz/fuzz.py --wasm --repeat 3
  --update-baseline` writes Linux's. Crash signatures (gdb, lldb) are not exercised: seeds 7 and 8
  no longer crash. The minimiser handles edge selections and openings, not operands.
- W9: `scope` cannot follow an async function (TypeError); objects kept outside a scope's result
  are disposed. Public functions not in the list above may still leave intermediates to the
  garbage collector (none found by the probe over 70 calls).

# Lane WN, batch 3: crashes of the WebAssembly kernel (W10), the package's typings (W11), the JS API reference (W12)

Items W10, W11 and W12 of ai/plan/kernel-deep-dive.md (findings `wasmbind-trap-leaves-kernel-state`,
`offset-wasm-trap-guard`, `wasmapi-typings`, `wasmapi-docs-body-methods-missing`).

## Fixed

- smlibwasm, W10: a crash of the kernel (a trap of the WebAssembly module: "function signature
  mismatch", "memory access out of bounds") no longer hides behind retries and the operation's own
  hint. The shell of a filleted box with `setGuardSeconds(0)` (as on a page's main thread) crashed
  on its fourth call and said `shell failed: the kernel cannot open a face whose rim meets its
  neighbours tangentially; ...`; it now says `shell failed: the kernel crashed (function signature
  mismatch), and its memory may be damaged: load the module again before relying on its results (a
  KernelWorker does so by itself); the kernel cannot open a face ...`, and the first crash warns
  (`setWarningHandler`) naming the kernel call (`the kernel crashed in shell_brep (...)`).
  `kernel.ts` and the docs no longer say that the module "stays usable".
- smlibwasm, W10: shell and offset stop at a crash of the kernel also when it happens in
  the check of a result (the offset that measures a closed shell), which took it for a refusal and
  tried the next attempt on the memory the crash left (O6 had stopped them only at a crash in the
  attempt itself).
- smlibwasm, W10: `removeFillets` and `removeFaces` with their steps in this kernel (a page's main
  thread, `setGuardSeconds(0)`) dropped a step that crashed the kernel and tried the next ones on the
  damaged memory: four crashes and "the kernel could not take out 4 of the 4 fillet faces", or with
  `partial: true` the part given back unchanged without a word. The first crash now ends the
  operation with a `ModelingError` that says so. A crash in the probe worker (a kernel of its own,
  which is replaced) still only drops that step.
- smlibwasm, W10: a `KernelWorker` whose kernel crashed while a function ran, but whose function
  caught the error and returned, kept that kernel for the next call; it starts a new one now.
- smlibwasm, W11: the package's declarations type-check in an app without Node's types and with
  `skipLibCheck: false` (they named `node:fs`, and `Symbol.dispose` without the lib that declares
  it), and leave out the internal members (`_brep`, `_like`, `_ownFaces`, ... and functions such as
  `_fs`): `scripts/declarations.mjs`, run by `npm run build`, does what `stripInternal` does for
  `@internal`, by the `_` of the names.
- smlibwasm, W11: `extrude(sketch, 3).volume` did not compile (`Property 'volume' does not exist on
  type 'Part | Shell'`); `render(part, { veiw: 'top', sise: [100, 100] })` compiled. The free
  functions have overloads (a sketch or face gives a `Part`, an open curve `Part | Shell`; vertices
  give `fillet`/`chamfer` a `Sketch`; `offset` of a part a `Part`, of a sketch a `Sketch`;
  `split(part, plane, 'both')` `[Part, Part]`), and `render`, `show` and `htmlPage` take their
  options typed (`RenderOptions`, `ShowOptions`, `PageOptions`).
- smlibwasm, W12: the generated API section of docs/javascript.md left out every member Part, Shell
  and Sketch inherit from the internal `_Body` (`dispose`, `named`, `colored`, `raycast`,
  `closestPoint`, `heal`, `bbox`, `vertices`, `info`, ...), showed `class Part extends _Body` with
  `_Body` nowhere, and the constructors only the package calls (`new Face(owner, kface)`). They are
  members of Part, Shell and Sketch now, which extend `Shape`, and those constructors are left out.
- smlibpy, W12: the API reference (docs/api.md, mkdocstrings) left the same members out of `Part`,
  `Sketch` and `Shell` (`named`, `colored`, `raycast`, `closest_point`, `heal`, ...): they are listed
  under each now.

## New

- smlibwasm: `memoryUsage().crashes`, how often the kernel crashed since the module was loaded
  (after a crash its memory may be damaged). A JavaScript-only key, as `memoryUsage()` is.
- smlibwasm: exported types, to name in an app's own code: the options (`FilletOptions`,
  `ExtrudeOptions`, `ExtrudeFunctionOptions`, `SweepOptions`, `FoldOptions`, `FlangeOptions`,
  `UnfoldOptions`, `BendAllowanceOptions`, `DevelopedLengthOptions`, `TwistOptions`, `TaperOptions`,
  `BendOptions`, `RangeOptions`, `TextOptions`, `PlacementOptions`, `CornerOptions`,
  `PolygonOptions`, `TrapezoidOptions`, `StepExportOptions`, `MeshOptions`, `GltfOptions`,
  `DxfReadOptions`, `DxfWriteOptions`, `BodyOptions`), the selections and values (`EdgesLike`,
  `FacesLike`, `ShapesLike`, `Renderable`, `RenderView`, `RenderPoint`, `RenderMarker`,
  `CurvatureKind`, `ColorLike`, `FilletRadius`, `SortKey`, `Coordinates`, `Matrix`, `Movable`, `XYZ`,
  `LatticeIndex`, `LatticeLayers`, glyph outlines `Point`, `Segment`, `Contour`) and result classes
  (`DraftAnalysis`, `FaceDraft`, `PairAdjustment`) as types. `Hit` is generic over its face: a
  body's `raycast` gives `Hit<Face>[]` (`hit.face.geomType` without a check), a mesh's `Hit<null>[]`.
- smlibpy: `typing.overload`s on `extrude`, `revolve`, `loft`, `sweep`, `fillet`, `chamfer`,
  `offset` and `split`, and `mirror` typed to give what it takes, as the TypeScript says.
- `npm run build` makes the published declarations with `scripts/declarations.mjs`; `node
  scripts/api.mjs <dist> <page>` writes the API section from other declarations into another page.

## Behaviour changes

- smlibwasm: in this kernel (a page's main thread, `setGuardSeconds(0)`), a crash of the kernel in
  a step of `removeFillets` or `removeFaces` ends the operation with a `ModelingError` (its `name`
  is `_KernelFault`), also with `partial: true`, where the step was dropped and the next one tried.
  Run such steps in a `KernelWorker` (a new kernel after a crash) or where the probe worker runs
  (Node, a cross-origin isolated page's workers), which drops only the step:

  ```js
  // before: the crash was dropped, and the part came back as it was
  const plain = part.removeFillets(null, { partial: true })
  // after: the operation ends at the crash; in a KernelWorker the next call gets a new kernel
  const plain = await cad.call('withoutFillets', [part]) // (expose(() => import('./models.js')))
  ```
- smlibwasm: the message of a KernelError for a crash names the crash before the operation's hint;
  code that matched the hint at the start of the message matches it anywhere:

  ```js
  // before
  if (/^shell failed: the kernel cannot open/.test(e.message)) ...
  // after
  if (e instanceof KernelError && e.operation === 'shell' && /the kernel cannot open/.test(e.message)) ...
  ```
- smlibwasm: the first crash of the kernel warns through `setWarningHandler` (`console.warn` by
  default). A handler that turns warnings into errors throws at the crash.
- smlibwasm: `memoryUsage()` has the key `crashes`:

  ```js
  // before
  assert.deepEqual(Object.keys(memoryUsage()).sort(), ['handles', 'heap', 'limit', 'used'])
  // after
  assert.deepEqual(Object.keys(memoryUsage()).sort(), ['crashes', 'handles', 'heap', 'limit', 'used'])
  ```
- smlibwasm (TypeScript only; nothing changes at run time): code that compiled because a parameter
  was `unknown` or a result `any` may not compile now. `load(path)` gives `Part | Shell | Sketch |
  Mesh | ShapeList<Part | Shell>` (it gave `any`); `render`/`show`/`htmlPage` options are checked,
  also options built in a variable without a type (`size: number[]` is no `[number, number]`);
  passing the wrong kind of value where the function threw a TypeError at run time is a compile
  error (`toStep(3)`, `part.removeFaces(part.edges())`, `sketch.fuse(edge)`). `Face.owner` is
  `Part | Shell | null`, `Hit.face` `Face | null` (it was `any`). The internal members (`_brep`,
  `_h`, `_like`, ...) are not in the declarations:

  ```ts
  // before
  const part = load('bracket.step')
  console.log(part.volume)
  const options = { view: 'top', size: [400, 300] }
  render(part, options)
  // after
  const part = load('bracket.step')
  if (!(part instanceof Part)) throw new Error('bracket.step holds no single part')
  console.log(part.volume)
  const options: RenderOptions = { view: 'top', size: [400, 300] }
  render(part, options)
  ```
- smlibwasm: the declarations reference `/// <reference lib="esnext.disposable" />` where they name
  `Symbol.dispose` (TypeScript 5.2 or later reads it): an app on an older lib gets the type of
  `Symbol.dispose` from there. Their API section lists the inherited members under each class; the
  constructors of `Face`, `Edge` and `Picture` are no longer shown (they take internal types).

## Not done

- W10: the module is not marked unusable or loaded again after a crash: every handle points into
  its memory, so a new module would lose them; the warning, `memoryUsage().crashes` and the
  `KernelWorker` (which does start a new kernel) are the ways out. The plan's
  `ext.reset_after_trap()` (clearing the kernel's mark locks and DoingBoolean) was left out, as the
  verifier advised: those flags are benign by design and were never seen stuck, and clearing them
  would not undo what a broken pointer wrote. Retry loops other than those of shell, offset and the
  defeaturing steps (a Boolean's fallbacks, the 2D Booleans' slab fallback, raycasts over faces)
  still try their next way after a crash; the warning makes it visible, and the result may be
  wrong. A crash in the probe worker leaves this kernel's count at 0 (that kernel is replaced).
- W11: `Shape.export(path, options)`, `Mesh.export`, `exportFile` and `Part.deform` keep their
  loose options (`Record<string, unknown>`: the options of the format the extension picks);
  `Hull(...items)`, `new Locations(...items)` and `Locations.mul` keep `unknown`/`any`. The
  published declarations still declare the internal base class `_Body` (Part and Shell extend it),
  without its internal members.
- The declarations were checked with TypeScript 5.9 (bundler and nodenext resolution, lib es2022 +
  dom, no @types/node, `skipLibCheck: false`), not with older TypeScript versions.

# Lane WN, batch 4: fonts without fontTools (W13), files in memory (W14), the raw kernel layer (W15)

Items W13 (both languages), W14 (smlibwasm; `Text` taking a `Font` in both) and W15 (smlibwasm).

## Fixed

- smlibpy and smlibwasm: WOFF2 fonts, variable CFF2 fonts and CFF accents built with seac are read
  (W13). smlibwasm threw a FontError for all three ("WOFF2 fonts are not supported; convert the font
  to TTF or OTF", "accented glyphs built with seac are not supported"); smlibpy read them only with
  fontTools installed, which no extra installs ("accented glyphs built with seac need the fontTools
  package"). Both readers now do it themselves, the same way: WOFF2's table directory, collection
  directory and Brotli-compressed data (a Brotli decoder after RFC 7932, `_brotli.py` and
  `_brotli.ts`, with RFC 7932's dictionary), its transformed `glyf`/`loca` tables (triplet-coded
  points, composite glyphs, explicit bounding boxes, the overlap bitmap) and `hmtx` table; CFF2
  (32-bit INDEX counts, `blend` and `vsindex` in charstrings and private dicts, FDSelect format 4)
  drawn at the default instance; seac composed from StandardEncoding's base and accent glyphs by the
  font's charset (as fontTools composes it). Checked against fontTools on the generated test fonts,
  34 WOFF2 files at hand (Inter, Inter Tight, JetBrains Mono, Big Shoulders from Google Fonts; Lato,
  Roboto Slab, Font Awesome from mkdocs) and Apple's CFF2 fonts (SF India, October/November India):
  cmap, advances and the exact area of every outline agree; 596 of the 599 system fonts as before
  (the other three differ as they did: a font matrix, a font without `head`). The TypeScript reader
  draws every glyph of those fonts to the last bit as the Python reader does.
- smlibwasm: WOFF fonts with compressed tables are read in browsers too (W13): their zlib data was
  inflated with `node:zlib`, which only Node has ("a WOFF font with compressed tables needs node:zlib
  ..."). `_inflate.ts` (zlib, RFC 1950/1951; also what unpacks the Brotli dictionary) inflates them
  everywhere, its errors as zlib's (checked against `node:zlib` on 19,200 streams, damaged ones
  among them).
- smlibwasm: `fromDxf`, `fromDxfWires`, `loadFont` and `new Font(...)` take an `ArrayBuffer` and any
  view of one (W14), as `fromStep`, `fromStl`, `fromSmb` and `fromUsd` did (`fromStl`/`fromSmb` took
  only `Uint8Array`s and `ArrayBuffer`s; they take any view now too); they threw "... a string or
  bytes (a Uint8Array), not ArrayBuffer". `Text({ font })` takes a `Font` (it threw "... not Font").
- smlibwasm: the raw kernel layer is reachable and complete (W15): `k` could not be imported from the
  package, and 94 of the 156 functions of `smlibpy._core`, the methods of its classes (`Brep.area`,
  `Face.centroid`, `Edge.point_at`, `PolyBrep.ray_intersection`, ...) and three enums
  (`ContinuityType`, `CurveParameterization`, `TrimType`) were missing.

## New

- smlibpy and smlibwasm: `Text(..., font=load_font(path))` / `Text(..., { font: loadFont(bytes) })`:
  a `Font` that was read once (W14).
- smlibwasm: `fromFile(data, name)` and `toFile(shapes, name, options)`: `load` and `exportFile` of
  files in memory, the format by the extension of `name` (`.step`/`.stp`/`.p21`, `.stl`, `.smb`,
  `.dxf`, `.usda`/`.usd` read; `.step`, `.stl`, `.glb`, `.gltf`, `.obj`, `.smb`, `.dxf`, `.usda`
  written), for `<input type="file">` and downloads (W14). The type `BytesLike` (a `Uint8Array`, an
  `ArrayBuffer` or another view of one) is what every reader of files in memory takes.
- smlibwasm: `@classcad/smlibwasm/kernel`, Python's `smlibpy._core`, no stable API like it (W15):
  `k` (every function of `smlibpy._core` with its names, parameters and defaults, keywords as a
  trailing object; the methods of its classes as `k.<class>_<method>`, `k.brep_area(b)`; its enums),
  `ext`, `module` (`module.FS`), `kernelCall`, the handles (`BrepHandle`, ..., and their base class
  `Handle`, now exported), `memoryUsage`, `scope`. The calls the module had no binding for are
  SmPyLib's own code: `js/cpp/smpylib.cpp` compiles SmPyLib's binders (all but USD's) against a
  stand-in for pybind11 (`js/cpp/pyshim`), which collects every function and method into a table
  with its py::arg names and defaults; `k.smpylib` has them all, `k.<name>` where the module's own
  bindings have none. Their errors are Python's: `ValueError` a RangeError, `TypeError` a TypeError,
  a kernel failure an Error with the status, a `TessellationError` an Error of that name with its
  `report`, `failures`, `status` and `status_name`. The hand-written bindings' parameters are held to
  SmPyLib's (all 65 that SmPyLib has agree), and both give the same results (lane_WN.test.ts).
- `tools/make_test_fonts.py` makes `test-seac.otf`, `test-variable.otf` (CFF2 from three masters,
  with two item variation data) and `test-quadratic.woff2`, `test-quadratic-plain.woff2`,
  `test-cubic.woff2` (through Node's zlib where the brotli module is missing);
  `tests/data/brotli-vectors.json` holds streams of the reference encoder for both suites.

## Behaviour changes

- smlibpy: `font.py` no longer uses fontTools: WOFF2 files and CFF2 outlines, which it handed to
  fontTools, and glyphs its reader could not draw, which it drew with fontTools when that was
  installed, are read by the reader itself. A glyph it cannot draw (an unknown charstring operator)
  raises its FontError also where fontTools is installed; no such glyph is known (fontTools leaves the
  same operators out). Variable CFF2 fonts are drawn at their default instance, as fontTools drew
  them:

  ```python
  # before: needed fontTools (pip install fonttools brotli)
  Text("Label", 5, font="Inter.woff2")
  # after: works without it
  Text("Label", 5, font="Inter.woff2")
  ```
- smlibpy: a WOFF table whose zlib data is damaged raises a FontError (a ValueError) where it raised
  `zlib.error`:

  ```python
  # before
  except zlib.error: ...
  # after
  except FontError: ...  # (ValueError)
  ```
- smlibwasm: such a table is a FontError where it was node's zlib Error; WOFF tables are inflated by
  the package's own inflate also in Node.
- smlibwasm: the TypeErrors for what is no file contents say "a string or bytes (a Uint8Array or an
  ArrayBuffer)" (`fromStep`, `fromStl`, `fromSmb`, `fromUsd`, `fromDxf`, `fromDxfWires`, `loadFont`,
  `Font`); `fromStl`/`fromSmb` said "expected a string or a Uint8Array", `fromUsd` threw TextDecoder's
  error:

  ```js
  // before
  assert.throws(() => fromStl(42), /expected a string or a Uint8Array/)
  // after
  assert.throws(() => fromStl(42), /fromStl takes the file's contents: a string or bytes/)
  ```
- smlibwasm: `k` has more members: the 94 functions, the class methods as `<class>_<method>`
  (`brep_area`, `face_centroid`, `poly_ray_intersection`, ...), the three enums and `k.smpylib`.
  Code that listed `Object.keys(k)` sees them. Calls through `k` that were bound before are bound as
  before.
- smlibwasm: the WebAssembly module is larger, 7.6 MB (6.7 MB before), 1.81 MB with brotli (about
  0.13 MB more): the kernel code of the 94 calls and SmPyLib's binders. The library adds the Brotli
  dictionary for WOFF2 fonts (79 kB, 59 kB with brotli) and the WOFF2, CFF2 and inflate code. The
  size table of docs/javascript.md has the numbers.

## Not done

- W13: a WOFF2 collection gives its first font (as a TTC does); variable fonts are drawn at their
  default instance (no axis values can be chosen); the Brotli decoder holds the whole output in
  memory (fine for fonts). Python decodes Brotli with its own decoder also where the C `brotli`
  module is installed (a 96 kB font from 31 kB in 17 ms, so it was not worth a second path). seac
  was checked on the generated font and against fontTools only: no font with seac accents was at
  hand.
- W15: `signatures.ts` is not generated from SmPyLib's py::arg lists: the module reports those lists
  itself (`smpylib__table()`), the calls it had no binding for use them directly, and a test holds
  the hand-written table to them; the CI check that greps smlibpy for `k.<name>` was not added, as
  every SmPyLib call is now bound (smlibpy's own `ext` calls still need their bindings in
  `bind_smlibpy.cpp`). Not in the table: SmPyLib's USD functions (no OpenUSD in the module), the
  constructors and Python special methods of its classes, the value classes (`Vec3`, `Vec2`,
  `Axis2Placement`: arrays and `{origin, x, y}` here), and the borrowed-geometry check of
  `SmPyBorrowedGeometry.cpp` (a no-op here: nothing tracks the curves and surfaces read from a Brep,
  as in the hand-written bindings). Results are not wrapped: new kernel objects are numbers the
  caller frees, and calls that consume their arguments (`boolean_union`) consume them, as their
  docstrings say.

# Lane WN, batch 5: NVIDIA's validator on smlibpy's USD files (N4), parity with smlibpy (N5), where the kernel gave up (N6), the C library's rand() (N7), the vase fillets (W16)

Commit on `fix/kr-WN`; kernel plan items N4, N5, N6, N7 and W16.

## Fixed

- Both: a `KernelError` said only where the binding called the kernel ("SmApiFilletEdges failed:
  SM_ERR (1001) at SmPyFillets.cpp:81"): release builds compiled the kernel's error reports out
  (`SER` and the other failure macros only returned). Kernel patch K11
  (`third_party/patches/SMLib/inc/SmMessages.h`, the first patched header: `CMakeLists.txt` puts
  `third_party/patches/<dir>/inc` before the kernel's own headers) reports each failure to the
  error callback, and `KernelError.trace` lists the last 48: the failing chain from the deepest
  kernel function to the API function, after the errors the kernel recovered from (N6).
- Both: USD files of bodies read from another program's file (and checked, X6) failed NVIDIA's
  validator: `SmBrep::AssertValid` leaves UV curves on the body, and the loop of a sphere's face
  that runs up and down its seam (no edges at its poles) does not close in them (BA.763;
  usd-brep's own `cubeWithVoid.usda` and `Cone_SmConnect_Brep.usda`, read and written again;
  they passed before X6). Such loops are written without UV curves
  (`src/cpp/usd/SmuConvert.cpp`), which readers rebuild; they read back the same. Found by the
  validator gate (N4).
- Python: a fillet or chamfer of a part read from a file, with `GUARD_SECONDS = 0` or where no
  helper process starts, freed the body of its result: the step ran in this process and returned
  the copy that the step's handle still held, which freed it with itself (AddressSanitizer: reads
  of freed memory in `brep_measure` and `CalculateTightBoundingBox`; the whole suite crashed once
  in the parity test's all-edge fillet of `vase1.smb`). From batch 2 (fillets of imported parts
  isolated, F2); smlibwasm's port took the copy and was right.
- docs/files.md said the test suite checks the USD files with NVIDIA's validator; nothing did.
  Now it does (N4).
- N7 (K10, the kernel no longer reseeds the process-wide `rand()` from the clock) was done with
  I2 in P0 (90677eb); this batch adds its test (Python: the C library's `rand()` sequence goes on
  across a void Boolean and `solids()` of two bodies).

## New

- Python `KernelError.trace`, TS `KernelError.trace` (a frozen array): where the kernel gave up,
  as `"SM_ERR_BAD_INTERSECTIONS at SmTopologyIntersector.cpp:2185 (IntersectTopology)"`; `()`/`[]`
  where the error did not come from a kernel function (or the kernel crashed). It comes back
  from smlibpy's other process (`smlibpy._guard`), from smlibwasm's probe worker and from a
  `KernelWorker`, and survives the errors raised again with another hint (fillets the kernel
  cannot round, Booleans). docs/kernel.md "Where the kernel gave up"; skill `features/generic`,
  `parts/guards`.
- Raw layer, both: `ext.kernel_trace()` (the entries and how many there were since the last
  clear), `ext.clear_kernel_trace()`. `kernel_call`/`kernelCall` clear it when they start.
  C++: `src/cpp/trace.cpp` (shared), `js/cpp/bind_trace.cpp`.
- `tools/oracles/usd_validator.py`: usd-brep's `brep_validator` (191 BrepArray rules) on `.usda`
  files without OpenUSD, on a shim of the `pxr` calls it makes (`tools/oracles/usd_shim`, about
  400 lines; calibrated: each of upstream's `Test_BA_xxx` files fails its rule, the good ones
  pass). Both suites run it on what `export_usd`/`toUsd` write: 19 kinds of bodies (analytic,
  NURBS, cavities, cells, sheets, text, sweeps, lofts, 1e6 from the origin, 0.01 small, several
  bodies with meshes), upstream's files read and written again, and a box read with analytic line
  edges. The JS test needs a Python 3.10 (`SMLIBPY_PYTHON`, else `python3`) and skips without.
- `tools/parity.py` and `tests/data/parity`: the text of smlibpy's writers (STEP, USD, DXF, OBJ,
  glTF, STL) for bodies read from `.smb` files, and the numbers of 18 modelling steps, which
  `js/test/lane_WN.test.ts` compares with smlibwasm (text token by token, numbers to 1e-9;
  results to 1e-7, counts and errors exactly), with the known divergences of the builds and why
  (`KNOWN`). `python tools/parity.py --update` writes them; the Python suite checks they are
  current. The writers agree to the byte but for their names.
- The ```js examples of docs/javascript.md and js/README.md run in the JS suite (with an app's
  values where a block takes them, a stand-in for `three`; the worker example as its three
  files), and print what their comments say.
- W16: the vase fillets' failure in smlibwasm is traced (`SmFilletStandardSolver.cpp:558`,
  `LoadInitialValues`, from `CalcCornerVertGeom`: the drop of a corner's guess point onto the
  filleted edge finds not one point) and explained: the native arm64 build contracts `a * b + c`
  into FMA instructions. A native build with `-ffp-contract=off` fails both fillets the same way,
  reads `vase1.smb` with smlibwasm's volume to the last digit (1103972.4296165158; FMA:
  ...174), and gives the fuzz run's cone/cylinder merge smlibwasm's 145.98511 (FMA: 149.19267;
  OpenCASCADE: 150.26185 for the union). docs/kernel.md "Accuracy" and docs/javascript.md say so.

## Behaviour changes

- Both: `KernelError.detail` no longer ends in ". Kernel trace: ..." where the kernel raised with
  its `ERR` messages (smlibpy's callback takes the place of SmPyLib's trail, which nothing feeds
  now); those sites are in `trace`, with every other failing site. The message (`str(e)`) and
  `status` are unchanged.

  ```python
  # before
  if "SmFilletExecutive" in e.detail: ...
  # after
  if any("SmFilletExecutive" in t for t in e.trace): ...
  ```
- Both: `export_usd`/`toUsd` write no UV curves for a loop whose UV curves do not close (only
  bodies read from other files and checked carry UV curves at all). Readers rebuild them; a script
  that read the `brep:curveUv` arrays of such a file finds `vertexCount` 0 there.
- Raw layer: the kernel's error callback is smlibpy's (`src/cpp/trace.cpp`), installed after
  SmPyLib's; code that installed its own with `smos_SetErrorCallback` (C++) replaces it.
- smlibwasm: the module is larger by the calls the failure macros make: 7.82 MB, 188 kB more
  (1.85 MB with brotli, 46 kB more); the size table of docs/javascript.md and js/README.md say so.

## Not done

- N4: no CI step with the real `usd-brep[validation]` (OpenUSD and NVIDIA's asset validator): its
  wheels are for Python 3.12 on Linux and Windows and could not run here. The shim runs the same
  rule code (upstream's `brep_validator.py`) everywhere, but not the asset validator's general USD
  rules. BA.465 (control points in the body's box) is left out for bodies read from other files,
  which upstream's own files fail (as the plan says). Names outside ASCII (X3) and empty parts
  (X10) belong to another lane: the gate's test is an xfail on this branch (UnicodeDecodeError;
  an empty part written with an inverted extent: BA.025/030/035/701) and checks the files once
  they are refused or written well.
- N5: 18 modelling steps, not the 100 of the review's probe (the JS suite is a port of the Python
  suite with the same numbers). The golden files are made on darwin-arm64; other platforms compare
  within the tolerances (not run here). The cases that need files beside the repository (DXF #19,
  the valve's convexity) run where those are. glTF is compared as JSON (Python and JavaScript
  format JSON differently).
- N6: no per-site hints (Not planned). `SE`/`SE_MSG` (errors the kernel ignores on purpose) and
  `AER`/`AER_MSG` (boolean asserts) do not report. The trace is per thread; on Windows the
  kernel keeps its callback per thread, and `clear_kernel_trace()` installs it on the calling
  thread. Overhead: measured as suite times (Python) and module size; smlibwasm's suite time was
  not compared.
- W16: not fixed. The WebAssembly build cannot contract; compiling the native kernel with
  `-ffp-contract=off` would make Python on arm64 fail the vase fillets too. Over the fuzz seeds 7
  and 8 it removed 15 of the 19 smlibpy/smlibwasm divergences of the baseline and added 8 others
  (the six operations of csg-8-124 after its first Boolean, which that build makes and smlibwasm
  refuses, and slice-7-402): libm and other differences remain. Left as a decision; the cases are
  in `tools/parity.py`'s `KNOWN`. That x86_64 builds behave like smlibwasm in these cases is
  expected (their default target has no FMA) but not verified.
- N7: `SM_DEFINED_HASH_ORDER` was not attempted (10 `static_assert`s in 4 files). No JS test of
  the C library's random state (the module's C library is its own; K10 is shared C++).
- `tests/test_guards.py::test_offsets_that_read_freed_kernel_memory_fail` (24 extended-mode
  offset steps in one process, the known issue #2 family) crashed the process in 1 of 100 runs
  of its steps at HEAD and 3 of 100 (and 1 of 30) with this batch: the use of freed memory
  depends on the heap's layout, which the trace callback changes (it no longer makes a string
  per error report). Not caused by the callback, which writes only into its own ring.

# Lane WN, batch 6: threads (N8), what queries keep (N9)

Items: N8 (`infra-gil-held`), N9 (`infra-cache-retention`).

## Fixed

- Python (N8): a kernel call froze every other Python thread for as long as it ran (no call let
  the GIL go; the GIL was the kernel's only lock). Every entry point of `smlibpy._core` now takes
  one recursive kernel lock (`src/cpp/kernel_lock.cpp`: each pybind11 function record's
  dispatcher is swapped for one that locks first, so SmPyLib's functions, the methods and
  properties of its classes, smlibpy's own and the deletions that finalizers call all take it: a
  test walks the module and finds 675 functions, methods and properties, all locked but the two
  that only count). The long calls let the GIL go around their kernel work: smlibpy's Booleans (`ext.boolean`), tessellation, `brep_measure`,
  `brep_properties`, distances, deformations, defeaturing, drafts, sheet-metal bends, surface
  fits, cells, point classification, curve sweeps, STEP building and checks, USD reading and
  writing, and 22 of SmPyLib's functions bound again in `src/cpp/nogil.cpp` with the same
  signature and docstring (Booleans, fillets and chamfers, `shell_brep`, `offset_brep`, sweeps,
  `create_skin_primitive`, `heal_brep`, stitching, `poly_boolean`). A thread waits for the lock
  with the GIL let go (the thread that holds it may need the GIL to finish). Measured (a thread
  ticking every 5 ms): a cut of 0.3 s in one kernel call paused it 0.29 s before, 7 ms now;
  meshing that part at 0.01 mm (6.1 s) 6.05 s before, 18 ms now. 8 threads modelling at once for
  30 s (5379 operations, 486,197 waits for the lock) got exactly the results of one thread, and
  AddressSanitizer reported nothing over 60 s of it; with the GIL let go but no lock the same run
  gave wrong volumes and kernel errors within seconds. Overhead of the lock: about 20 ns a call
  (81 against 62 ns for `Brep.face_count()`, 337 against 311 ns for `ext.face_indices`; a
  `Box(...).volume` 183 µs either way).
- Python (N8): `os.fork` (the guard's forked steps, `multiprocessing` on Linux) waits for a kernel
  call of another thread to end and gives the copy a free lock (`os.register_at_fork`). Without it
  the copy started with the lock held by a thread it does not have and waited for ever (the test
  fails that way with the hook taken out).

## New

- Both (N9): `compact()` on `Part`, `Sketch` and `Shell` (Python and TypeScript, `_Body`), and
  the raw `ext.drop_caches(brep)` -> `(count, bytes)` (`src/cpp/caches.cpp`; `[count, bytes]` in
  JavaScript, `js/cpp/bind_caches.cpp`). The kernel keeps what a query computes on a body's
  curves, surfaces and the body itself (SmAObject's own cache; the global cache queue is compiled
  out) for the body's whole life. Measured on 300 placed copies of a holed, filleted box
  (malloc's statistics; wasm: `memoryUsage().used`):

  | per copy | smlibpy | smlibwasm |
  |---|---|---|
  | the body | 128.9 KB | 89.7 KB |
  | after `bbox()` | +41.5 KB | +34.2 KB |
  | after `mesh()` | +754.1 KB | +541.0 KB |
  | after `distance_to()` | +799.1 KB | +573.3 KB |
  | after `compact()` | +0.0 to 0.3 KB | +0.0 to 0.2 KB |

  The trade-off: a query that finds the caches is about 1.2 times as fast as one that builds them
  (`closest_point()` after `distance_to()` 1.96 times); a cut gained nothing (0.99 to 1.02).
  Compacting costs 0.01 to 0.03 ms a body. So it is a call for the user (bodies kept but no
  longer queried, such as the copies of a pattern after they were meshed), not done after every
  query. docs/kernel.md "What queries keep", docs/javascript.md "Memory", the skill reference
  `analysis/compact`, docs/api.md's lists of `_Body`'s members.
- Python (N8): `ext.kernel_lock_waits()` (how often an entry point found the lock taken) and
  `ext.kernel_locked(fn)` (whether a function of the module takes it), for the tests;
  `ext.nogil_rebound()` and `ext.nogil_mismatches()` (the SmPyLib functions bound again, and those
  whose docstring would differ, which stay SmPyLib's: none). docs/kernel.md "Threads".

## Behaviour changes

- Python (N8): other threads run while a long kernel call works, and their own kernel calls wait
  for it. Results do not change; nothing a script did before breaks. What is new for a program with
  threads: a thread that called the kernel during another's long call used to wait for the GIL and
  now waits for the kernel lock (the same wait, but other Python code runs meanwhile). Threads do
  not model in parallel (one kernel); for that, use processes:

  ```python
  # before and after: threads take turns in the kernel
  with ThreadPoolExecutor() as pool:
      parts = list(pool.map(build, sizes))
  # in parallel: processes, each with a kernel of its own
  with ProcessPoolExecutor() as pool:
      volumes = list(pool.map(volume_of, sizes))   # (bodies cross processes as .smb, see save/load)
  ```
- Python (N8): at interpreter exit, a finalizer that frees a body while a daemon thread is still
  in a kernel call no longer waits (the daemon thread never gives the lock back): it raises
  `RuntimeError("the kernel is busy in another thread while Python exits")`, which the handles'
  `__del__` swallows (the body is left to the process's end).
- Python raw layer (N8): `k.boolean`, `k.fillet_edges`, `k.shell_brep` and the other 19 functions
  bound again are new function objects (same name, signature and docstring, in `k` and in their
  category submodule). Where the kernel left no trace, their `RuntimeError` names
  `nogil.cpp:<line>` as the binding site instead of `SmPyBooleans.cpp:<line>` and the like.

  ```python
  # before
  if "SmPyFillets.cpp" in str(e): ...
  # after: the kernel's own site, where it reported one
  if any("SmFilletExecutive" in t for t in e.trace): ...
  ```
- N9: none; `compact()` and `ext.drop_caches` are new.

## Not done

- N8: SmPyLib's functions not bound again keep the GIL during their kernel work (they take the
  lock): the methods of its classes (`Brep.bounding_box(True)`, up to 22 ms in the suite;
  `Brep.copy`, `write_to_file`), `read_brep_from_file` and `read_part_from_file` (`.smb`, up to
  14 ms; their helpers are file-local in SmPyLib), SmPyLib's `tessellate` and `curve_sweep`, the
  non-manifold sweeps and the other short calls. The list in `nogil.cpp` covers what smlibpy uses
  that took longer than 10 ms in the test suite. Short calls keep the GIL on purpose: letting it go
  costs a thread switch, which a loop of thousands of queries would pay each time. STEP files are
  parsed in Python (the GIL is Python's there).
- N8: no concurrency inside the kernel (one SmContext with unlocked shared state; upstream allows
  no concurrent SmApi calls). Free-threaded Python (3.13t) is not declared supported by the module
  (pybind11's `mod_gil_not_used`), so such an interpreter turns the GIL back on; the lock would
  serialize the kernel there too. Checked on macOS arm64 only: Windows has no fork (no hook; the
  helper process runs the guarded steps), Linux not run; `_Py_IsFinalizing` is used before 3.13,
  `Py_IsFinalizing` from 3.13.
- N8: with threads, the guarded steps (shell, offset, fillets of imported parts, ...) still fork,
  and Python 3.12 warns (`DeprecationWarning: This process ... is multi-threaded, use of fork() may
  lead to deadlocks in the child`); `_guard`'s `warnings.catch_warnings()` does not silence it
  reliably, since that is not thread-safe. The kernel lock is free in the copy; Python's own locks
  that other threads held at the fork are not, as with any fork. `GUARD_PROCESS = "helper"` avoids
  forking (docs/kernel.md "Threads" says so); choosing it by itself when threads run was left alone.
- N8: the copies in `nogil.cpp` must follow SmPyLib: `tests/test_lane_WN.py` holds a hash of each
  upstream binding's source (from `m.def` to its docstring) and fails when one changes.
- N9: no automatic compaction after queries (the trade-off above; repeated queries of one body are
  common in selectors). `compact()` is on bodies only: faces and edges belong to their body, and
  meshes have `dispose()`.
