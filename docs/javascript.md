# JavaScript

smlibwasm (`@classcad/smlibwasm` on npm) is smlibpy for JavaScript and TypeScript: the same
modeling API on the same kernel, SMLib, compiled to WebAssembly. It runs in the browser and in Node, needs no server and has no
dependencies. Parts are built, measured and exported where the page runs.

```js
import { Box, Cylinder, GridLocations, Z, toStep } from '@classcad/smlibwasm'

let plate = Box(80, 60, 10)
plate = plate.fillet(plate.edges().parallelTo(Z), 8)
plate = plate.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 10)))

console.log(plate.volume.toFixed(2)) // 45440.00
const step = toStep(plate) // the STEP file as text
```

## Install

```bash
npm install @classcad/smlibwasm
```

The package is an ES module with type declarations. Importing it loads the kernel: the import
waits for it once, and every call after that is synchronous. The kernel is a WebAssembly file
next to the module, found with `new URL('smlibwasm.wasm', import.meta.url)`, which Vite and
webpack 5 resolve on their own and copy into the build. esbuild and Bun bundle the package but
not the file: copy `smlibwasm.wasm` next to the bundle, or say where it is with `init` (below).
Node needs version 22.18 or later.

Vite's dev server bundles dependencies in advance and loses the file on the way; leave the package
out of that (a build needs nothing):

```js
// vite.config.js
export default { optimizeDeps: { exclude: ['@classcad/smlibwasm'] } }
```

### Loading the kernel from elsewhere

`init` from `@classcad/smlibwasm/init` says where the kernel comes from: a CDN or another path
(`locateFile`), bytes fetched or cached already (`wasmBinary`), a module compiled once and handed
to every worker (`wasmModule`), or Emscripten's own hook (`instantiateWasm`). It loads the
package and resolves to its exports:

```js
import { init } from '@classcad/smlibwasm/init'

const { Box } = await init({ locateFile: (file) => `https://cdn.example.com/smlibwasm/${file}` })
```

The options count only before the package loads the kernel, which it does when anything first
imports `@classcad/smlibwasm`: take the package from `init`'s promise, or call `init` in a module
that is imported before the first module that imports the package. Options that come later are an
`Error`. A kernel that fails to load (a wrong URL, bytes that are no WebAssembly) rejects the
promise. `@classcad/smlibwasm/init` itself does not load the kernel.

## Size

What a browser loads, compressed as web servers send it (brotli at its best level, gzip for
comparison):

| | brotli | gzip | uncompressed |
|---|---|---|---|
| The kernel, `smlibwasm.wasm` | 2.2 MB | 3.2 MB | 9.4 MB |
| Its loader, `smlibwasm.mjs` | 22 kB | 24 kB | 87 kB |
| The library | 0.52 MB | 0.60 MB | 2.1 MB |
| The font of `Text` | 46 kB | 59 kB | 130 kB |
| The dictionary of WOFF2 fonts (Brotli's) | 59 kB | 60 kB | 79 kB |
| **Together** | **2.9 MB** | **3.9 MB** | **11.9 MB** |

Browsers cache the kernel like any other file, so it loads once. The library is counted as
published, unminified; a bundler that minifies it makes it smaller.

## In the browser

In a three.js app, [smlibpy-three](three.md) does this for you: its parts, faces and edges are
three.js objects already, in three's coordinates. By hand, a part's mesh and edges go into a
renderer such as three.js:

```js
import * as THREE from 'three'
import { Box, Cylinder } from '@classcad/smlibwasm'

const part = Box(40, 30, 10).cut(Cylinder(6, 20))

// faces: three corners per triangle, each with the kernel's normal of the exact surface there
const { vertices, triangles, normals } = part.mesh(0.01) // chord height tolerance in mm
const position = new Float32Array(triangles.length * 3)
triangles.forEach((v, i) => position.set(vertices.subarray(3 * v, 3 * v + 3), 3 * i))
const faces = new THREE.BufferGeometry()
faces.setAttribute('position', new THREE.BufferAttribute(position, 3))
faces.setAttribute('normal', new THREE.BufferAttribute(normals, 3))

// edges: the part's own, as line segments
const points = []
for (const edge of part.edges()) {
  const n = edge.geomType === 'line' ? 1 : 64
  for (let i = 0; i < n; i++) points.push(edge.pointAt(i / n), edge.pointAt((i + 1) / n))
}
const edges = new THREE.BufferGeometry().setFromPoints(points)

const model = new THREE.Group()
model.add(new THREE.Mesh(faces, new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })))
model.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 'black' })))
model.rotation.x = -Math.PI / 2 // Z up (smlibwasm) to Y up (three.js)
scene.add(model)
```

Files are read and written in memory: `toStep`, `toStl`, `toGlb`, `toObj`, `toDxf`, `toUsd`, `toBrep`,
`toSmb` and `toSmp` give a file's contents, and `fromStep`, `fromIges`, `fromStl`, `fromDxf`, `fromUsd`,
`fromBrep`, `fromSmb` and `fromSmp` read them, from text or bytes (smlibpy has the same pairs: `to_step`,
`from_step`, ...):

```js
const part = fromFile(await file.arrayBuffer(), file.name) // a File from an <input type="file">
const glb = new Blob([toGlb(part)], { type: 'model/gltf-binary' })
const download = new Blob([toFile(part, 'bracket.step')]) // .step, .stl, .glb, .gltf, .obj, .smb, .smp, .dxf, .svg, .usda, .brep
```

`Text` takes the page's own font, also a web font as browsers download it (WOFF2, WOFF, TTF, OTF):

```js
const font = loadFont(await (await fetch('/fonts/inter.woff2')).arrayBuffer()) // read once, kept
const label = Text('SMLIB 42', 8, { font })
```

`toSmp` writes SMLib's part file, which keeps several exact bodies with their names and colors,
and curves; `fromSmp` reads it (and part files of other SMLib programs).

`fromStepModel(data)` reads a STEP file with the coordinate systems, curves and points it holds
besides its bodies (`readStep(path)` in Node); `toStep` writes them, a `StepModel` whole or
`new StepCurve('path', wire)`, `new StepPoint('CRP', vector)` and `new StepFrame('MCS', plane)`
beside the bodies (an edge, a vector or a plane alone is written unnamed). `htmlPage(part)` is a page with a 3D viewer for an
iframe (`iframe.srcdoc = htmlPage(part)`), and `render(part)` draws a PNG (`picture.data`) without
a GPU.

## From smlibpy to smlibwasm

The functions, classes, checks and error messages are smlibpy's, so the rest of these docs
applies. The differences come from the language:

- **Names** are camelCase: `parallel_to` is `parallelTo`, `mass_properties` is `massProperties`.
  Classes keep their names (`Box`, `Part`, `ShapeList`).
- **Keyword arguments** become an options object at the end:
  `Rectangle(40, 20, { fillet: 2 })`, `sketch.extrude(10, { both: true })`. Its keys are checked
  as Python checks keywords: an unknown one is a `TypeError` that names the right one
  (`{ k_factor: 0.3 }` copied from Python: "did you mean 'kFactor'?"), and so is a number where
  the options go (`Rectangle(20, 10, 3)`). Choices are string unions, as Python's `Literal`s:
  `{ corners: 'round' }`, where a misspelled choice does not compile. An option renamed in a
  release keeps working under its old name until the next one, with a warning (Python's
  `DeprecationWarning`; `setWarningHandler` says where warnings go): `{ angleTol: 1 }` is
  `{ angleTolerance: 1 }` since 0.6.0. The declarations have the new names only.
- **Methods and functions**: every operation is both, as in Python (`part.draft(faces, 3,
  Plane.XY)` is `draft(part, faces, 3, Plane.XY)`; see [Concepts](concepts.md#methods-and-functions)).
- **Operators** become methods: `a.fuse(b)`, `a.cut(b)` and `a.intersect(b)` for Python's `+`,
  `-` and `&`; `Pos(10, 0, 0).mul(Box(1, 1, 1))` for `*`; `vector.add(other)`.
- **Lists**: a `ShapeList` is an Array. Python's selection by a point, `faces().at(point)`, is
  `atPoint(point)`, since `at` takes an index; Python's `list[-1]` is `list.at(-1)` or
  `list.last`. Python's `edges().new(since=part)` is `edges().newSince(part)` (`new` names no
  method well in JavaScript).
- **Errors**: Python's `ValueError` is a `RangeError`; `ModelingError` and `KernelError` are
  exported. A `KernelError`'s `trace` says where the kernel gave up, as in Python
  ([the kernel](kernel.md#where-the-kernel-gave-up)).
- **Results** agree with smlibpy's to about 1e-9 of their value: smlibpy's build for macOS on
  arm64 rounds `a * b + c` once (FMA), the WebAssembly build twice. Now and then a step close to a
  tolerance in the kernel succeeds in one and fails in the other (all-edge fillets of usd-brep's
  `vase1.smb`: smlibpy on macOS arm64 rounds them; smlibwasm cannot, nor can a native build
  without FMA); `tools/parity.py` lists the known cases. The file writers write smlibpy's files
  to the byte but for the writer's name.
- **Types**: the free functions say what they give (`extrude(sketch, 3)` is a `Part`, an open curve
  a `Part | Shell`; `split(part, plane, 'both')` two parts), `render`, `show` and `htmlPage` check
  their options (`{ veiw: 'top' }` does not compile), so do `exportFile`, `toFile`, `Shape.export`
  and `Mesh.export` (`FileOptions`: the options of the formats), `Part.deform` (a `Lattice`), `Hull`
  (`HullItem`) and `new Locations(...)` (`LocationLike`), and the types of options and selections can
  be named (`RenderOptions`, `FilletOptions`, `FoldOptions`, `EdgesLike`, `ShapesLike`, ...). The
  declarations leave out the internal members (names that start with `_`) and type-check without
  Node's types and without `skipLibCheck`; `load(path)` gives a union, which `instanceof Part`
  narrows.
- **Files**: in Node, `exportStep(shapes, path)`, `importStep(path)` and the other path functions
  write and read files as smlibpy's do; `show(part)` opens the viewer in the browser. Every format
  also has functions for files in memory (`toStep`, `fromStep`, ..., as Python's `to_step`,
  `from_step`), and `toFile`/`fromFile` pick the format by the file's name.
  `fromUsd(text, { resolve })` gets the layers and files a stage references from
  `resolve(asset, from)`, where `importUsd(path)` and Python's `import_usd` read them from disk.
- **The kernel itself**: `@classcad/smlibwasm/kernel` is Python's `smlibpy._core`, see
  [below](#the-raw-kernel-layer).

## Memory

Every body lives in the kernel's memory, which the JavaScript garbage collector does not see. A
body's kernel object is freed when the body is garbage collected, and the collector frees such
objects only between tasks of the event loop: a loop that builds parts without returning to the
event loop (a parametric regeneration, an optimiser, a batch) keeps every body it made until it
ends, named or not. `part.dispose()` (or `using part = ...`) frees one body at once. The faces,
edges and vertices of a disposed body go with it: using them throws a `TypeError`. Edges and wires
of their own (`Line`, `Polyline`, ...) have `dispose()` too.

Disposing the result is not enough in such a loop: the operands of a chain such as
`Box(30, 20, 10).cut(Cylinder(4, 20)).fillet(...)` (the box, the cylinder, the cut) have no name to
dispose them by. `scope(fn)` runs `fn` and disposes, when it returns, every kernel object it made
that its result does not hold; what the result holds (parts, sketches, faces, meshes, also in
arrays, ShapeLists, Maps, Sets and plain objects) stays. 400 regenerations of that chain grew the
kernel's memory from 64 to 191 MB, and to 133 MB with each result disposed; in `scope` it stays at
64 MB:

```js
for (const width of widths) {
  const volume = scope(() => {
    const c = Box(width, 20, 10).cut(Cylinder(4, 20))
    return c.fillet(c.edges().filter((e) => e.center().z > 4), 2).volume
  })
}
// in a three.js app: rebuild a mesh and keep only its arrays
const mesh = scope(() => model(params).mesh())
```

Objects made before the scope stay as they are; scopes nest (what an inner scope returns belongs to
the outer one); where `fn` throws, what it made is freed. `fn` must return its result, not a
promise (an async function goes on after its first `await`, where the scope cannot follow it), and
must not keep what it makes anywhere but in its result: a body stored in a variable outside is
disposed with the rest. smlibwasm frees its own intermediates the same way (the tools and refused
results of Booleans, the half space of `split`, the curves of sketches and text, the cells of a
merge, the unplaced body of a primitive with `align`, the loops of a revolve or a tapered or
two-sided extrusion, the sheets of a face's `extrude`, `offset` and `thicken`, the views of
`drawingViews`, the bends of `fold` and `flange`), so a call leaves behind only what it returns, as
in Python: a loop that disposes each result stays flat.

A mesh (`part.mesh()`, `tessellate`) is its arrays: the kernel's mesh it is made from is freed as
soon as they are copied out, and mesh Booleans build one from the arrays when they need it.
`mesh.dispose()` frees what a mesh still holds in the kernel; the mesh stays usable.

A query keeps what the kernel computed for it on the body's curves and surfaces for as long as the
body lives, and that can outweigh the body: on a holed, filleted box of 90 KB, `bbox()` added
34 KB, `mesh()` 541 KB and `distanceTo()` 573 KB. `part.compact()` frees it: the body does not
change, and the next query builds what it needs again (a query that finds it is about 1.2 times as
fast). Compact the bodies an app keeps but no longer queries, such as the copies of a large
pattern after they were meshed:

```js
const part = Box(40, 30, 10).cut(Cylinder(5, 20))
const copies = Array.from({ length: 20 }, (_, i) => part.translate(i * 50, 0, 0))
const meshes = copies.map((p) => p.mesh())
for (const p of copies) p.compact()
```

The kernel's memory can grow to 4 GB, as far as a 32-bit WebAssembly module reaches (a browser
may stop it earlier), and it never shrinks; each thread's kernel has its own. `memoryUsage()`
tells how much of it the kernel's objects take (`used`), how far it has grown (`heap`) and how far
it can grow (`limit`), in bytes, and how many kernel objects JavaScript holds that are not freed
yet (`handles`). A call that finds it used up fails with a `KernelError` of status
`SM_ERR_OUT_OF_MEMORY` that says how much is in use and how far the memory has grown (a browser
that refuses to grow it further stops it below its limit): dispose of parts no longer needed, use
`scope`, or let the event loop run. Once they are disposed the kernel works again. (The module
holds 8 MB in reserve, which `used` leaves out, for the step that finds the memory used up: that
step finishes, so the kernel does not run out in the middle of its work, and the next steps fail
before the kernel runs until enough is freed to take the reserve again.)

```js
const { used, limit, handles } = memoryUsage()
if (used > 0.8 * limit) console.warn(`the kernel holds ${(used / 2 ** 20).toFixed(0)} MB in ${handles} objects`)
```

The kernel can crash (read memory it should not, call through a broken pointer): natively that ends
smlibpy's process, or the copy of it a guarded step runs in. Here the WebAssembly module stops the
call (a trap), and the call fails with a `KernelError` that says "the kernel crashed". The module
answers the next call, but on its memory as the crash left it, so what it computes from then on may
be wrong: the first crash warns (`setWarningHandler`), `memoryUsage().crashes` counts them, and the
steps that retry or fall back on another way (shell, offset, removing fillets and faces, Booleans
that turn a seam, sweeps that try another mode, raycasts that ask a face's mesh, ...) end at a
crash rather than go on on that memory. For the rest of the task the crash happened in, no step
falls back: one that needs to fails with the error it met (the next task of the event loop has the
fallbacks again). An app that goes on after a crash loads the module again (reloads the page), or
models in a `KernelWorker` (below), which starts a new kernel after a crash.

## The raw kernel layer

`@classcad/smlibwasm/kernel` is the kernel as Python's `smlibpy._core` has it, for the calls
smlibwasm does not wrap: `k` holds every function of `smlibpy._core` (156: intersections, offset
curves, partial primitives, pipe sweeps, stitching, CSG trees, ...) with its names, parameters and
defaults, the methods of its classes as functions (`k.brep_area(b)` for Python's `b.area()`,
`k.poly_ray_intersection(mesh, ...)`) and its enums (`k.BooleanOp.UNION`, `k.ContinuityType.G1`).
Python's keyword arguments are a trailing object:

```js
import { BrepHandle, k } from '@classcad/smlibwasm/kernel'

const quarter = new BrepHandle(k.create_partial_cylinder([0, 0, 0], 10, 20, 0, 90)) // freed with it
console.log(k.brep_volume(quarter.brep, { relative_accuracy: 1e-9 })) // 1570.796...
const circle = k.create_circle([0, 0, 0], 5)
const offset = k.offset_curve(circle, 2) // a circle of radius 7
console.log(k.curve_length(offset), k.evaluate_continuity(circle, 0.25) === k.ContinuityType.C1_G2_G3)
k.ext.delete_curve(circle)
k.ext.delete_curve(offset)
```

Kernel objects are numbers (their address in the kernel's memory; 0 is none), points `[x, y, z]`,
lists of numbers `Float64Array`s, Python's tuples arrays and its dicts plain objects. A result
that is a new body, curve or surface is the caller's: free it with `k.ext.delete_brep(b)` (or
`delete_curve`, `delete_surface`, `delete_polybrep`), or give it to a `BrepHandle` (`CurveHandle`,
...), which frees it with the last reference. Some calls consume or change their arguments, as
their Python docstrings say (`boolean_union` consumes both bodies). Errors are Python's: a
`ValueError` is a `RangeError`, a `TypeError` a `TypeError`, a kernel failure an `Error` with the
kernel's status, a `TessellationError` an `Error` of that name with its `report`.

Like `smlibpy._core`, this layer is no stable API: it follows SmPyLib, the kernel's Python bindings
in usd-brep, whose own code the module runs for most of these calls. The calls smlibwasm uses have
bindings of their own with the same names, parameters and results.

## Running off the main thread

Every call is synchronous and runs on the thread that imported the package, so on a page's main
thread a long call (a fine mesh of a large part, the shell of a large part) freezes the page
until it returns. `@classcad/smlibwasm/worker` runs functions in a worker (a Web Worker, or a Node
`worker_threads` worker), a kernel of its own, while the page goes on. The functions are plain
smlibwasm, in a module of their own that the page, Node and the worker can all import:

```js
// models.js
import { Box, Cylinder, GridLocations, Z } from '@classcad/smlibwasm'

export function plate(width, holes, radius) {
  const box = Box(width, 60, 10)
  const rounded = box.fillet(box.edges().parallelTo(Z), radius)
  return rounded.cut(GridLocations((width - 20) / (holes - 1), 40, holes, 2).mul(Cylinder(3, 10)))
}

export const grams = (part) => part.volume * 7.85e-3 // steel
```

```js
// cad.worker.js: the whole worker
import { expose } from '@classcad/smlibwasm/worker'

expose(() => import('./models.js'))
```

```js
// main.js
import { KernelWorker } from '@classcad/smlibwasm/worker'

const cad = new KernelWorker(() => new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' }), { timeout: 30_000 })
const part = await cad.call('plate', [80, 3, 6]) // a Part, made in the worker
const weight = await cad.call('grams', [part]) // and back into it
```

The worker starts with the first call (`cad.start()` starts it at once) and runs one call at a
time, in the order they come; `cad.functions.plate(80, 3, 6)` is the same call. What crosses:

- **Bodies** (`Part`, `Shell`, `Sketch`) as the contents of binary `.smb` files, exact, with their
  name, color and sketch plane; faces, edges and vertices of a body as the body and their place in
  it, so that `part.fillet(edge, 1)` in the worker fillets the edge picked here.
- **Meshes** as their typed arrays, which the receiving thread takes over without a copy
  (transferred); the sender keeps its own.
- **Vectors, locations, planes, axes and boxes** as their numbers; numbers, strings, arrays, plain
  objects and typed arrays as themselves. Anything else, such as a standalone `Line` or a
  `StepModel`, is a `TypeError`: return what it holds instead.

A call resolves to what the function returned, or rejects with what it threw, as the same class:
`ModelingError`, `KernelError` (with its operation, status and hint), `TypeError`, `RangeError`.
`call(name, args, { timeout, signal })` limits one call: a call that runs longer than `timeout`
milliseconds (the `KernelWorker`'s `timeout` by default; none unless given) rejects with a
`TimeoutError`, and one whose `AbortSignal` fires with the signal's reason. The time a call waits
for the calls before it, or for the worker to start, does not count; a call that waits is simply
dropped. A call that runs is stopped with its worker: `terminate()` stops a worker at once,
whatever its kernel is doing, which nothing else can. The next call starts a new worker, and so
does the call after one whose kernel crashed (also where the function caught the error) or ran out
of memory, so that every call finds a sound kernel. `cad.terminate()` stops the worker and rejects
the calls that wait.

The page loads the kernel only for what needs it: a body, mesh, face, edge or vertex that goes to
the worker or comes back. A page whose worker returns plain data, a file (`toGlb`, `toStep`) or a
mesh's arrays (`{ vertices: mesh.vertices, ... }`) never loads it. In Node, give the module's URL:
`new KernelWorker(new URL('./cad.worker.js', import.meta.url))`; an idle worker does not keep Node
running. webpack 5 bundles the worker as it is; Vite with `worker: { format: 'es' }` in its config
(Vite 5 and later). Vite 4 cannot: it stalls on workers nested three deep ("Unexpected early exit",
also for three files that only start each other), and a worker of yours that imports the package
starts the package's supervisor, which starts its probe worker. With Vite 4, use the package on the
page's main thread, or bundle the worker with Vite 5 or webpack.

The kernel steps that can crash or loop run in a probe worker, a kernel of its own, on copies of
the bodies, as smlibpy runs them in another process: those of `removeFillets`, `removeFaces`,
`surfaceFillet`, `shell`, `offset`, `thicken` and `cells()`, fillets and chamfers of parts read from
files (`fromStep`, `fromSmb`, `fromUsd` and the parts made from them) and, after
`setGuardBooleans(true)`, every Boolean. What the step made comes back as an exact copy (`.smb`),
and the kernel the call runs on never runs the step: the kernel's offset code can read memory it
has freed, and SMLib's patching code loops for good on some parts (the outer round of the
enclosure example). A step that crashes the kernel there or takes longer than `GUARD_SECONDS`
(20 s; `setGuardSeconds(seconds)` sets it, `0` turns the probe off) fails with a `ModelingError`
(`removeFillets` and `removeFaces` drop it and go on), and the kernel the call runs on is left
alone. The probe waits
for its worker with `Atomics.wait`, which Node allows on every thread and browsers only in workers
of a cross-origin isolated page (one served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`). On a page's main thread, or without cross-origin
isolation, the steps run directly: a step that crashes the kernel there ends the operation with a
`ModelingError` (its memory may be damaged, see "Memory"), and the kernel's deadline holds a step
to `GUARD_SECONDS`: the loops of the kernel's surface and topology intersections, where the steps
found looping for good spend their time (the outer round of the enclosure example), give up once it
has passed, and the step fails as one that took too long (`removeFillets` and `removeFaces` drop it
and go on). It returns at the next test in those loops, within a few seconds of the deadline; a
step that spends its time elsewhere in the kernel is not stopped, and a `KernelWorker` call with a
timeout stops any call. There the package
starts a small worker of its own when it is imported (a browser starts a worker only while the
thread that creates it is not busy), which starts the probe worker, with the kernel, for the first
step. The two are the package's
`_defeature_supervisor.js` and `_defeature_worker.js`, loaded as
`new Worker(new URL('./_defeature_supervisor.js', import.meta.url))`, which bundlers recognise. A
probe worker that does not start within 30 s is given up, with a warning, and the steps run
directly. Where the two files are missing (a bundle that left them out), Node says so at the first
step and runs the steps directly; a browser finds out only when the worker fails to load, so its
first step waits those 30 s.

## API

The API reference has a page of its own: [WASM API](api/wasm.md), every export of
`@classcad/smlibwasm` as a TypeScript declaration, beside the [Python API](api/index.md) and the
[three.js API](api/three.md).
