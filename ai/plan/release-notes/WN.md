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
