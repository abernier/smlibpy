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
