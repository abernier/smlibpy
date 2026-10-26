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

A part's mesh and edges go into a renderer such as three.js:

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
  `{ corners: 'round' }`, where a misspelled choice does not compile.
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

The exports of `@classcad/smlibwasm` as TypeScript declarations. The [API reference](api.md) describes each of them
under its Python name: `parallel_to` there is `parallelTo` here.

### Geometry

```ts
export const TOLERANCE = 0.000001;
export type VectorLike = Vector | ArrayLike<number>;
export type Matrix = Float64Array;
export class Vector {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    constructor(x?: number | VectorLike, y?: number, z?: number);
    toArray(): [number, number, number];
    add(other: VectorLike): Vector;
    sub(other: VectorLike): Vector;
    mul(s: number): Vector;
    div(s: number): Vector;
    neg(): Vector;
    equals(other: unknown): boolean;
    toString(): string;
    get length(): number;
    dot(other: VectorLike): number;
    cross(other: VectorLike): Vector;
    normalized(): Vector;
    distanceTo(other: VectorLike): number;
    angleTo(other: VectorLike): number;
    isClose(other: VectorLike, tolerance?: number): boolean;
    isParallel(other: VectorLike, angleTolerance?: number): boolean;
    isPerpendicular(other: VectorLike, angleTolerance?: number): boolean;
    rotate(axis: Axis | VectorLike, angle: number): Vector;
    projectTo(plane: Plane): Vector;
    anyPerpendicular(): Vector;
}
export class Axis {
    static X: Axis;
    static Y: Axis;
    static Z: Axis;
    readonly origin: Vector;
    readonly direction: Vector;
    constructor(origin?: VectorLike, direction?: VectorLike);
    neg(): Axis;
    reversed(): Axis;
    moved(location: Location): Axis;
    at(origin: VectorLike): Axis;
    isParallel(other: Axis | VectorLike, angleTolerance?: number): boolean;
    distanceTo(point: VectorLike): number;
    project(point: VectorLike): Vector;
    positionAlong(point: VectorLike): number;
    equals(other: unknown): boolean;
    toString(): string;
}
export const X: Axis;
export const Y: Axis;
export const Z: Axis;
export interface Movable<T> {
    moved(location: Location): T;
}
export class Location {
    constructor(position?: VectorLike | Plane | Location | Matrix | number[][] | null, rotation?: VectorLike | null);
    static about(axis: Axis, angle: number): Location;
    get matrix(): number[][];
    get position(): Vector;
    get rotation(): Vector;
    get xDir(): Vector;
    get yDir(): Vector;
    get zDir(): Vector;
    get plane(): Plane;
    inverse(): Location;
    rotateVector(v: VectorLike): Vector;
    mul(other: Location): Location;
    mul(other: VectorLike): Vector;
    mul(other: Axis): Axis;
    mul(other: Plane): Plane;
    mul<T>(other: Movable<T>): T;
    mul<T>(other: readonly T[]): unknown[];
    equals(other: unknown): boolean;
    toString(): string;
}
export interface XYZ {
    x?: number;
    y?: number;
    z?: number;
}
export function Pos(x?: number | VectorLike | XYZ, y?: number, z?: number): Location;
export function Rot(x?: number | VectorLike | XYZ, y?: number, z?: number): Location;
export class Plane {
    static XY: Plane;
    static YZ: Plane;
    static ZX: Plane;
    static XZ: Plane;
    static YX: Plane;
    static ZY: Plane;
    static top: Plane;
    static bottom: Plane;
    static front: Plane;
    static back: Plane;
    static left: Plane;
    static right: Plane;
    readonly origin: Vector;
    readonly xDir: Vector;
    readonly yDir: Vector;
    readonly zDir: Vector;
    constructor(origin?: VectorLike | Plane | Location | Face, xDir?: VectorLike | null, zDir?: VectorLike);
    get normal(): Vector;
    get location(): Location;
    offset(distance: number): Plane;
    shifted(x?: number, y?: number, z?: number): Plane;
    flipped(): Plane;
    rotated(x?: number | XYZ, y?: number, z?: number): Plane;
    moved(location: Location): Plane;
    at(origin: VectorLike): Plane;
    toLocal(point: VectorLike): Vector;
    fromLocal(point: VectorLike): Vector;
    contains(point: VectorLike, tolerance?: number): boolean;
    distanceTo(point: VectorLike): number;
    project(point: VectorLike): Vector;
    isCoplanar(other: Plane, tolerance?: number): boolean;
    mul(other: Location): Location;
    mul(other: VectorLike): Vector;
    mul<T>(other: Movable<T>): T;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Hit<F extends Face | null = Face | null> {
    readonly point: Vector;
    readonly distance: number;
    readonly normal: Vector;
    readonly face: F;
    readonly triangle: number | null;
    constructor(point: Vector, distance: number, normal: Vector, face?: F, triangle?: number | null);
}
export class Nurbs {
    readonly degree: number;
    readonly knots: number[];
    readonly points: Vector[];
    readonly weights: number[] | null;
    constructor(degree: number, knots: number[], points: Vector[], weights?: number[] | null);
}
export class NurbsSurface {
    readonly degrees: [number, number];
    readonly knots: [
        number[],
        number[]
    ];
    readonly points: Vector[][];
    readonly weights: number[][] | null;
    constructor(degrees: [number, number], knots: [
        number[],
        number[]
    ], points: Vector[][], weights?: number[][] | null);
}
export class Curvature {
    readonly k1: number;
    readonly k2: number;
    readonly dir1: Vector;
    readonly dir2: Vector;
    readonly normal: Vector;
    readonly point: Vector;
    constructor(k1: number, k2: number, dir1: Vector, dir2: Vector, normal: Vector, point: Vector);
    get mean(): number;
    get gaussian(): number;
}
export class Continuity {
    readonly level: string | null;
    readonly gap: number;
    readonly angle: number;
    readonly curvatureJump: number;
    readonly point: Vector;
    constructor(level: string | null, gap: number, angle: number, curvatureJump: number, point: Vector);
}
export class ClosestPoints {
    readonly point: Vector;
    readonly otherPoint: Vector;
    readonly distance: number;
    readonly face: Face | null;
    readonly otherFace: Face | null;
    constructor(point: Vector, otherPoint: Vector, distance: number, face?: Face | null, otherFace?: Face | null);
}
export class BoundBox {
    min: Vector;
    max: Vector;
    constructor(min: VectorLike, max: VectorLike);
    static ofPoints(points: Iterable<VectorLike>): BoundBox;
    get size(): Vector;
    get center(): Vector;
    get diagonal(): number;
    union(other: BoundBox): BoundBox;
    contains(point: VectorLike, tolerance?: number): boolean;
    toString(): string;
}
export const Align: {
    readonly MIN: "min";
    readonly CENTER: "center";
    readonly MAX: "max";
};
export type Align = (typeof Align)[keyof typeof Align];
export type AlignLike = Align | string | null | readonly (Align | string | null)[];
```

### Shapes

```ts
export const ACCURACY = 1e-7;
export type ColorLike = string | readonly number[];
export type EdgesLike = Edge | Face | Wire | (Iterable<EdgesLike> & object);
export type FacesLike = Face | (Iterable<FacesLike> & object);
export type SourcesLike = Part | Shell | Face | Edge | (Iterable<SourcesLike> & object);
export type RegionLike = Sketch | Face | Wire | Edge | Iterable<VectorLike>;
export type WallsLike = ReadonlyMap<Face, number> | Iterable<readonly [FacesLike, number]>;
export interface IsoOptions {
    u?: number | null;
    v?: number | null;
}
export interface BodyOptions {
    name?: string | null;
    color?: ColorLike | null;
    plane?: Plane | null;
}
export abstract class Shape {
    abstract vertices(): ShapeList<Vertex>;
    abstract edges(): ShapeList<Edge>;
    wires(): ShapeList<Wire>;
    faces(): ShapeList<Face>;
    moved(location: Location): this;
    translate(x?: number | VectorLike, y?: number, z?: number): this;
    rotate(axis?: Axis, angle?: number): this;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): this;
    scale(factor: number | VectorLike, center?: VectorLike): this;
    on(target: Plane | Face | Location | ShapeList<Face> | Sketch): this;
    abstract bbox(): BoundBox;
    abstract center(): Vector;
    distanceTo(other: VectorLike | Shape): number;
    mesh(tolerance?: number | null, angle?: number, options?: {
        maxEdge?: number | null;
    }): Mesh;
    show(options?: ShowOptions): string;
    export(path: string, options?: FileOptions): void;
    toString(): string;
}
export type SortKey = Axis | string | ((s: Any) => number);
export class ShapeList<T = Shape> extends Array<T> {
    one(): T;
    get first(): T;
    at(index: number): T | undefined;
    get last(): T;
    sortBy(key?: SortKey, reverse?: boolean): ShapeList<T>;
    filterBy(criterion: Axis | string | ((s: T) => boolean)): ShapeList<T>;
    sortByDistance(point: VectorLike, reverse?: boolean): ShapeList<T>;
    groupBy(key?: SortKey, tolerance?: number): ShapeList<T>[];
    maxBy(key?: SortKey, tolerance?: number): ShapeList<T>;
    minBy(key?: SortKey, tolerance?: number): ShapeList<T>;
    top(): ShapeList<T>;
    bottom(): ShapeList<T>;
    right(): ShapeList<T>;
    left(): ShapeList<T>;
    back(): ShapeList<T>;
    front(): ShapeList<T>;
    largest(): T;
    smallest(): T;
    nearest(point: VectorLike): T;
    filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: unknown): ShapeList<S>;
    filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T>;
    map<U>(fn: (value: T, index: number, array: T[]) => U, thisArg?: unknown): U[];
    ofType(...geomTypes: string[]): ShapeList<T>;
    lines(): ShapeList<T>;
    circles(): ShapeList<T>;
    planar(): ShapeList<T>;
    cylinders(): ShapeList<T>;
    parallelTo(axis: Axis | VectorLike): ShapeList<T>;
    perpendicularTo(axis: Axis | VectorLike): ShapeList<T>;
    facing(direction: Axis | VectorLike, maxAngle?: number): ShapeList<T>;
    convex(): ShapeList<T>;
    concave(): ShapeList<T>;
    smooth(): ShapeList<T>;
    tangentChain(): ShapeList<Edge>;
    g1(): ShapeList<T>;
    g2(): ShapeList<T>;
    fillets(maxRadius?: number | null): ShapeList<T>;
    hitBy(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): ShapeList<T>;
    within(box: BoundBox): ShapeList<T>;
    atPoint(point: VectorLike, tolerance?: number): ShapeList<T>;
    newSince(since: SourcesLike): ShapeList<T>;
    derivedFrom(...shapes: SourcesLike[]): ShapeList<T>;
    joining(a: SourcesLike, b: SourcesLike): ShapeList<T>;
    shared(): ShapeList<T>;
    union(other: Iterable<T>): ShapeList<T>;
    difference(other: Iterable<T>): ShapeList<T>;
    intersection(other: Iterable<T>): ShapeList<T>;
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    wires(): ShapeList<Wire>;
    center(): Vector;
    bbox(): BoundBox;
    moved(location: Location): ShapeList<T>;
    on(target: Plane | Face | Location | ShapeList<Face> | Sketch): ShapeList<T>;
    translate(x?: number | VectorLike, y?: number, z?: number): ShapeList<T>;
    rotate(axis?: Axis, angle?: number): ShapeList<T>;
    toString(): string;
}
export class Vertex extends Shape {
    constructor(x?: number | VectorLike, y?: number, z?: number);
    get point(): Vector;
    get x(): number;
    get y(): number;
    get z(): number;
    get tolerance(): number;
    center(): Vector;
    bbox(): BoundBox;
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    distanceTo(other: VectorLike | Shape): number;
    get convexity(): string;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Edge extends Shape {
    dispose(): void;
    get geomType(): string;
    get tolerance(): number;
    get length(): number;
    get start(): Vector;
    get end(): Vector;
    get isClosed(): boolean;
    get isSeam(): boolean;
    get convexity(): string;
    get dihedralAngle(): number;
    isConvex(): boolean;
    get direction(): Vector;
    get radius(): number;
    get arcCenter(): Vector;
    get normal(): Vector;
    pointAt(t?: number): Vector;
    tangentAt(t?: number): Vector;
    center(): Vector;
    bbox(): BoundBox;
    distanceTo(point: VectorLike | Shape): number;
    continuity(samples?: number, options?: {
        angleTolerance?: number;
        curvatureTolerance?: number;
    }): Continuity;
    closestPoint(point: VectorLike | Vertex): Vector;
    paramAtPoint(point: VectorLike | Vertex): number;
    trim(start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Edge;
    split(at: number | VectorLike | Vertex): [Edge, Edge];
    extend(distance: number, options?: {
        end?: 'start' | 'end' | 'both';
        continuity?: 'G1' | 'G2' | 'natural';
    }): Edge;
    intersections(other: Shape | Iterable<Shape>, options?: {
        tolerance?: number | null;
    }): Vector[];
    intersectionParams(other: Shape | Iterable<Shape>, options?: {
        tolerance?: number | null;
    }): number[];
    selfIntersections(options?: {
        tolerance?: number | null;
    }): Vector[];
    curvatureAt(t?: number): number;
    radiusAt(t?: number): number;
    minRadius(): number;
    minRadiusAt(): number;
    inflections(): number[];
    offset(distance: number, options?: {
        plane?: Plane | null;
    }): Edge;
    toArcs(tolerance?: number): Wire;
    through(point: VectorLike | Vertex, options?: {
        tangent?: VectorLike | null;
        at?: number | null;
    }): Edge;
    match(options?: {
        start?: VectorLike | Vertex | null;
        end?: VectorLike | Vertex | null;
        startTangent?: VectorLike | null;
        endTangent?: VectorLike | null;
    }): Edge;
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    tangentChain(): ShapeList<Edge>;
    reversed(): Edge;
    nurbs(): Nurbs;
    static fromNurbs(nurbs: Nurbs | {
        degree: number;
        knots: readonly number[];
        points: readonly VectorLike[];
        weights?: readonly number[] | null;
    }): Edge;
    removeKnots(): Edge;
    add(other: Edge | Wire): Wire;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Wire extends Shape {
    constructor(edges: Edge | Wire | Iterable<Edge | Wire | Iterable<Edge | Wire>>, options?: {
        sort?: boolean;
    });
    dispose(): void;
    edges(): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    wires(): ShapeList<Wire>;
    get isClosed(): boolean;
    get start(): Vector;
    get end(): Vector;
    get length(): number;
    center(): Vector;
    bbox(): BoundBox;
    pointAt(t?: number): Vector;
    tangentAt(t?: number): Vector;
    distanceTo(point: VectorLike | Shape): number;
    split(at: number | VectorLike | Vertex): [Wire, Wire];
    trim(start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Wire;
    intersections(other: Shape | Iterable<Shape>, options?: {
        tolerance?: number | null;
    }): Vector[];
    toEdge(): Edge;
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp' | 'chamfer';
        plane?: Plane | null;
    }): Wire;
    toArcs(tolerance?: number): Wire;
    minRadius(): number;
    minRadiusAt(): number;
    closestPoint(point: VectorLike): Vector;
    continuity(options?: {
        angleTolerance?: number;
        curvatureTolerance?: number;
    }): Continuity;
    close(): Wire;
    reversed(): Wire;
    add(other: Edge | Wire): Wire;
    plane(): Plane;
    fillet(radius: number, vertices?: VectorLike | Vertex | Iterable<VectorLike | Vertex> | null): Wire;
    toSketch(): Sketch;
    toString(): string;
}
export class Face extends Shape {
    get owner(): Part | Shell | null;
    get color(): [number, number, number] | null;
    get name(): string | null;
    get cells(): number[];
    get geomType(): string;
    get area(): number;
    center(): Vector;
    interiorPoint(): Vector;
    normalAt(point?: VectorLike | null): Vector;
    get isPlanar(): boolean;
    get plane(): Plane;
    get radius(): number;
    get majorRadius(): number;
    get coneAngle(): number;
    get axis(): Axis;
    bbox(): BoundBox;
    distanceTo(point: VectorLike | Shape): number;
    closestPoint(point: VectorLike): Vector;
    uvAt(point: VectorLike): [number, number];
    positionAt(u: number, v: number): Vector;
    curvatureAt(point?: VectorLike | null): Curvature;
    minRadius(): number;
    nurbs(): NurbsSurface;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<Face>[];
    project(curve: Edge | Wire): ShapeList<Edge>;
    iso(options?: IsoOptions): ShapeList<Edge>;
    wrap(shape: Edge | Wire | Sketch | Iterable<Edge>, at?: VectorLike | Vertex | null, options?: {
        direction?: VectorLike | null;
    }): ShapeList<Edge>;
    outerWire(): Wire;
    innerWires(): ShapeList<Wire>;
    wires(): ShapeList<Wire>;
    edges(options?: {
        seams?: boolean;
    }): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    faces(): ShapeList<Face>;
    neighbors(): ShapeList<Face>;
    toSketch(): Sketch;
    toShell(): Shell;
    offset(distance: number): Shell;
    split(curves: Edge | Wire | Iterable<Edge | Wire>): ShapeList<Face>;
    flipped(): Shell;
    untrimmed(): Shell;
    extend(distance: number, options?: {
        sides?: Edge | Iterable<Edge> | null;
        continuity?: 'natural' | 'G1' | 'G2';
    }): Shell;
    extrude(amount: number, options?: ExtrudeOptions): Part;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Problem {
    readonly shape: Face | Edge | Vertex | Part | Shell;
    readonly message: string;
    readonly value: number | null;
    readonly tolerance: number | null;
    readonly category: string;
    readonly test: string;
    readonly other: Face | Edge | Vertex | Part | Shell | null;
    constructor(shape: Face | Edge | Vertex | Part | Shell, message: string, value?: number | null, tolerance?: number | null, category?: string, test?: string, other?: Face | Edge | Vertex | Part | Shell | null);
    toString(): string;
}
export class MassProperties {
    readonly mass: number;
    readonly volume: number;
    readonly area: number;
    readonly center: Vector;
    readonly inertia: number[][];
    readonly density: number;
    constructor(mass: number, volume: number, area: number, center: Vector, inertia: number[][], density: number);
    get principalMoments(): [number, number, number];
    get principalAxes(): [Vector, Vector, Vector];
    get radiiOfGyration(): [number, number, number];
    inertiaAbout(point: VectorLike): number[][];
    momentAbout(axis: Axis): number;
    toString(): string;
}
export class SectionProperties {
    readonly area: number;
    readonly centroid: Vector;
    readonly plane: Plane;
    readonly ixx: number;
    readonly iyy: number;
    readonly ixy: number;
    constructor(area: number, plane: Plane, ixx: number, iyy: number, ixy: number, extent: [number, number, number, number]);
    get polar(): number;
    get principalMoments(): [number, number];
    get principalAxes(): [Vector, Vector];
    get radiiOfGyration(): [number, number];
    get sectionModuli(): [number, number];
    toString(): string;
}
export type FilletRadius = number | readonly number[] | {
    start: number;
    end: number;
} | ReadonlyMap<number, number>;
export interface FilletOptions {
    continuity?: number | string | null;
    fullness?: number;
    propagate?: boolean;
    corners?: 'patch' | 'mitre' | 'miter';
    setback?: number | null;
}
export interface ChamferOptions {
    length2?: number | null;
    angle?: number | null;
    reference?: unknown;
    propagate?: boolean;
    corners?: 'patch' | 'mitre' | 'miter';
}
export class Part extends Shape {
    get volume(): number;
    get area(): number;
    center(): Vector;
    massProperties(density?: number, accuracy?: number | null): MassProperties;
    isValid(options?: {
        strict?: boolean;
    }): boolean;
    solids(): ShapeList<Part>;
    shells(): ShapeList<Shell>;
    voids(): ShapeList<Part>;
    info(): {
        type: string;
        faces: number;
        edges: number;
        vertices: number;
        bbox: [
            number[],
            number[]
        ];
        corners?: string;
        solids: number;
        voids: number;
    };
    merge(...others: (Part | Iterable<Part>)[]): Part;
    get sources(): Part[];
    cells(): ShapeList<Part>;
    classify(point: VectorLike, tolerance?: number | null): [string, Face | Edge | Vertex | null];
    contains(point: VectorLike, tolerance?: number | null): boolean;
    cellAt(point: VectorLike, tolerance?: number | null): Part | null;
    fuse(...others: (Part | Iterable<Part>)[]): Part;
    cut(...others: (Part | Iterable<Part>)[]): Part;
    intersect(sheet: Shell | Face): Shell;
    intersect(...others: (Part | Iterable<Part>)[]): Part;
    fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part;
    filletPreview(edges: EdgesLike, radius: number, options?: {
        propagate?: boolean;
    }): ShapeList<Shell>;
    chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part;
    shell(thickness: number, openings?: FacesLike | null, options?: {
        outward?: boolean;
        corners?: 'round' | 'sharp' | null;
        walls?: WallsLike | null;
    }): Part;
    offset(distance: number, options?: {
        corners?: 'sharp' | 'round';
    }): Part;
    split(plane: Plane | Face | Shell | ShapeList<Face>, keep: 'above' | 'below'): Part;
    split(plane: Plane | Face | Shell | ShapeList<Face>, keep: 'both'): [Part, Part];
    split(plane: Plane | Face | Shell | ShapeList<Face>): Part;
    imprint(tool: Part | Shell | Face | ShapeList<Face> | Edge | Wire | Iterable<Edge | Wire>, direction?: Axis | VectorLike | null, options?: {
        nearest?: boolean;
    }): Part;
    section(plane?: Plane | Face): Sketch;
    slices(step: number, axis?: Axis | VectorLike): Sketch[];
    static fromMesh(mesh: Mesh, maxFaces?: number): Part;
    twist(angle: number, options?: TwistOptions): Part;
    taper(scale: number, options?: TaperOptions): Part;
    bend(angle: number, options?: BendOptions): Part;
    unroll(options: UnrollOptions): Part;
    deform(lattice: Lattice, options?: {
        tolerance?: number | null;
    }): Part;
    removeFillets(faces?: FacesLike | null, options?: {
        maxRadius?: number | null;
        partial?: boolean;
    }): Part;
    removeFaces(faces: FacesLike, options?: {
        partial?: boolean;
    }): Part;
    draftAnalysis(direction: Axis | VectorLike, options?: {
        minAngle?: number;
    }): DraftAnalysis;
    partingLine(direction: Axis | VectorLike): ShapeList<Wire>;
    draft(faces: FacesLike, angle: number, neutralPlane: Plane | Face): Part;
    moveFaces(faces: FacesLike, by: Location | VectorLike): Part;
    offsetFaces(faces: FacesLike, distance: number): Part;
    push(face: Face, at: VectorLike, options?: PushOptions): Part;
    warp(face: Face, region: RegionLike, by: number | VectorLike, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Part;
    flatten(face: Face, region: RegionLike, plane: Plane | Face, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Part;
    fold(line: Axis | Edge, angle: number, options: FoldOptions): Part;
    flange(edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part;
    bends(options?: {
        kFactor?: KFactor;
    }): Bend[];
    unfold(options?: UnfoldOptions): Part;
    flatPattern(options?: UnfoldOptions): FlatPattern;
    toString(): string;
    name: string | null;
    color: ColorLike | null;
    dispose(): void;
    named(name: string | null, options?: {
        faces?: FacesLike | null;
    }): this;
    colored(color: ColorLike | null, options?: {
        faces?: FacesLike | null;
    }): this;
    faces(): ShapeList<Face>;
    edges(options?: {
        seams?: boolean;
    }): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    wires(): ShapeList<Wire>;
    bbox(): BoundBox;
    distanceTo(other: VectorLike | Shape): number;
    closestPoints(other: Part | Shell | Face | Edge | Wire): ClosestPoints;
    closestPoint(point: VectorLike): Vector;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<Face>[];
    raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<Face> | null)[];
    compact(): void;
    intersectionCurves(other: Part | Shell | Face | Plane): ShapeList<Edge>;
    silhouette(direction?: Axis | VectorLike): ShapeList<Edge>;
    project(curve: Edge | Wire, direction?: Axis | VectorLike, options?: {
        nearest?: boolean;
    }): ShapeList<Edge>;
    outline(plane?: Plane, options?: {
        hidden?: false;
        tangentEdges?: boolean;
    }): ShapeList<Edge>;
    outline(plane: Plane | undefined, options: {
        hidden: true;
        tangentEdges?: boolean;
    }): [ShapeList<Edge>, ShapeList<Edge>];
    outline(plane?: Plane, options?: {
        hidden?: boolean;
        tangentEdges?: boolean;
    }): ShapeList<Edge> | [ShapeList<Edge>, ShapeList<Edge>];
    toNurbs(): this;
    heal(): this | Part;
    check(level?: number): Problem[];
    equals(other: unknown): boolean;
}
export class Shell extends Shape {
    static fromNurbs(nurbs: NurbsSurface | {
        readonly degrees: readonly [number, number];
        readonly knots: readonly [
            readonly number[],
            readonly number[]
        ];
        readonly points: readonly (readonly VectorLike[])[];
        readonly weights?: readonly (readonly number[])[] | null;
    }): Shell;
    get area(): number;
    center(): Vector;
    thicken(thickness: number, options?: {
        both?: boolean;
    }): Part;
    offset(distance: number): Shell;
    trim(curves: Edge | Wire | Iterable<Edge | Wire>, keep: VectorLike | string): this;
    flipped(): this;
    extend(distance: number, options?: {
        sides?: Edge | Iterable<Edge> | null;
        continuity?: 'natural' | 'G1' | 'G2';
    }): this;
    matchEdge(edge: Edge, target: Edge | Wire, options?: {
        extent?: number;
    }): Shell;
    mergeFaces(a: Face, b: Face): Shell;
    push(face: Face, at: VectorLike, options?: PushOptions): Shell;
    warp(face: Face, region: RegionLike, by: number | VectorLike, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Shell;
    flatten(face: Face, region: RegionLike, plane: Plane | Face, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Shell;
    fuse(...others: (Shell | Part | Face | Iterable<Shell | Part | Face>)[]): Shell;
    cut(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
    intersect(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
    toString(): string;
    name: string | null;
    color: ColorLike | null;
    dispose(): void;
    named(name: string | null, options?: {
        faces?: FacesLike | null;
    }): this;
    colored(color: ColorLike | null, options?: {
        faces?: FacesLike | null;
    }): this;
    faces(): ShapeList<Face>;
    edges(options?: {
        seams?: boolean;
    }): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    wires(): ShapeList<Wire>;
    bbox(): BoundBox;
    distanceTo(other: VectorLike | Shape): number;
    closestPoints(other: Part | Shell | Face | Edge | Wire): ClosestPoints;
    closestPoint(point: VectorLike): Vector;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<Face>[];
    raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<Face> | null)[];
    compact(): void;
    intersectionCurves(other: Part | Shell | Face | Plane): ShapeList<Edge>;
    silhouette(direction?: Axis | VectorLike): ShapeList<Edge>;
    project(curve: Edge | Wire, direction?: Axis | VectorLike, options?: {
        nearest?: boolean;
    }): ShapeList<Edge>;
    outline(plane?: Plane, options?: {
        hidden?: false;
        tangentEdges?: boolean;
    }): ShapeList<Edge>;
    outline(plane: Plane | undefined, options: {
        hidden: true;
        tangentEdges?: boolean;
    }): [ShapeList<Edge>, ShapeList<Edge>];
    outline(plane?: Plane, options?: {
        hidden?: boolean;
        tangentEdges?: boolean;
    }): ShapeList<Edge> | [ShapeList<Edge>, ShapeList<Edge>];
    toNurbs(): this;
    heal(): this | Part;
    check(level?: number): Problem[];
    equals(other: unknown): boolean;
    info(): {
        type: string;
        faces: number;
        edges: number;
        vertices: number;
        bbox: [
            number[],
            number[]
        ];
        corners?: string;
    };
}
export interface PushOptions {
    by?: number | VectorLike | null;
    to?: VectorLike | null;
    normal?: VectorLike | null;
    radius?: number | null;
    continuity?: 'G0' | 'G1' | 'G2';
}
export interface ExtrudeOptions {
    both?: boolean;
    taper?: number;
    direction?: Axis | VectorLike | null;
    corners?: 'sharp' | 'round';
}
export class Sketch extends Shell {
    flipped(): this;
    get plane(): Plane;
    fuse(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    cut(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    intersect(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    xor(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    center(): Vector;
    get perimeter(): number;
    sectionProperties(): SectionProperties;
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp' | 'chamfer';
    }): Sketch;
    fillet(radius: number, vertices?: VectorLike | Vertex | Iterable<VectorLike | Vertex> | null): Sketch;
    chamfer(length: number, vertices?: VectorLike | Vertex | Iterable<VectorLike | Vertex> | null): Sketch;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): this;
    extrude(amount: number, options?: ExtrudeOptions): Part;
    revolve(axis?: Axis | null, angle?: number): Part;
    sweep(path: Edge | Wire, options?: {
        orient?: boolean;
        translational?: boolean;
        sharpCorners?: boolean | null;
        up?: Axis | VectorLike | string | null;
        twist?: number | ((s: number) => number);
        scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null;
        anchor?: 'center' | 'origin' | VectorLike | Vertex;
    }): Part;
    swing(outline: Sketch | Face | Wire | Edge): Part;
    toString(): string;
}
```

### Curves

```ts
export function Line(start: VectorLike, end: VectorLike): Edge;
export function PolarLine(start: VectorLike, length: number, angle: number, plane?: Plane): Edge;
export function Polyline(...args: (VectorLike | readonly VectorLike[] | {
    close?: boolean;
})[]): Wire;
export function CenterArc(center: VectorLike, radius: number, startAngle: number, arcSize: number, plane?: Plane): Edge;
export function ThreePointArc(start: VectorLike, through: VectorLike, end: VectorLike): Edge;
export function RadiusArc(start: VectorLike, end: VectorLike, radius: number, plane?: Plane): Edge;
export function SagittaArc(start: VectorLike, end: VectorLike, sagitta: number, plane?: Plane): Edge;
export function TangentArc(start: VectorLike, end: VectorLike, tangent: VectorLike): Edge;
export function EllipticalArc(center: VectorLike, xRadius: number, yRadius: number, startAngle?: number, endAngle?: number, plane?: Plane): Edge;
export function ParabolicArc(vertex: VectorLike, focalLength: number, start: number, end: number, plane?: Plane): Edge;
export function HyperbolicArc(center: VectorLike, xRadius: number, yRadius: number, start: number, end: number, plane?: Plane): Edge;
export function ConicArc(start: VectorLike, apex: VectorLike, end: VectorLike, rho?: number): Edge;
export function Spline(...args: (VectorLike | readonly VectorLike[] | {
    tangents?: readonly (VectorLike | null)[] | null;
    closed?: boolean;
})[]): Edge;
export function fitCurve(points: Iterable<VectorLike>, options?: {
    tolerance?: number | null;
    degree?: number;
    tangents?: readonly [VectorLike | null, VectorLike | null] | readonly VectorLike[] | null;
    closed?: boolean;
}): Edge;
export function Bezier(...args: (VectorLike | readonly VectorLike[] | {
    weights?: readonly number[] | null;
})[]): Edge;
export function Helix(pitch: number, height: number, radius: number, options?: {
    center?: VectorLike;
    direction?: Axis | VectorLike;
    endRadius?: number | null;
    leftHanded?: boolean;
}): Edge;
export function Spiral(startRadius: number, endRadius: number, turns: number, plane?: Plane, options?: {
    clockwise?: boolean;
}): Edge;
export function FilletPolyline(...args: (VectorLike | readonly VectorLike[] | {
    radius: number;
    close?: boolean;
})[]): Wire;
export function makeCompatible(...edges: (Edge | Iterable<Edge>)[]): Edge[];
```

### Sketches and text

```ts
export interface Coordinates {
    x?: number | null;
    y?: number | null;
}
export class Profile {
    constructor(start?: VectorLike | {
        heading?: number;
    }, options?: {
        heading?: number;
    });
    get point(): Vector;
    get start(): Vector;
    get heading(): number;
    get length(): number;
    lineTo(...args: (number | VectorLike | Coordinates)[]): Profile;
    lineBy(dx?: number | VectorLike, dy?: number): Profile;
    forward(length?: number | null | Coordinates, options?: Coordinates): Profile;
    turn(angle: number): Profile;
    turnTo(heading: number): Profile;
    arc(radius: number, angle: number): Profile;
    arcTo(...args: (number | VectorLike | {
        through?: VectorLike | null;
    })[]): Profile;
    fillet(radius: number): Profile;
    chamfer(length: number): Profile;
    mirror(axis: Axis): Profile;
    close(options?: {
        align?: AlignLike;
    }): Sketch;
    wire(): Wire;
    toString(): string;
}
export interface PlacementOptions {
    rotation?: number;
    align?: AlignLike;
}
export interface CornerOptions {
    fillet?: number;
    chamfer?: number;
}
export function Rectangle(width: number, height: number, options?: CornerOptions & PlacementOptions): Sketch;
export function RoundedRectangle(width: number, height: number, radius: number, options?: {
    align?: AlignLike;
}): Sketch;
export function Circle(radius: number, options?: {
    align?: AlignLike;
}): Sketch;
export function Ellipse(xRadius: number, yRadius: number, options?: PlacementOptions): Sketch;
export interface PolygonOptions extends CornerOptions {
    align?: AlignLike;
}
export function Polygon(...args: (VectorLike | readonly VectorLike[] | PolygonOptions)[]): Sketch;
export function RegularPolygon(radius: number, sides: number, options?: {
    inscribed?: boolean;
} & CornerOptions & PlacementOptions): Sketch;
export function Triangle(width: number, height: number, options?: {
    apex?: number | null;
} & CornerOptions & PlacementOptions): Sketch;
export type TrapezoidOptions = CornerOptions & PlacementOptions;
export function Trapezoid(width: number, height: number, leftAngle: number, rightAngle?: number | null | TrapezoidOptions, options?: TrapezoidOptions): Sketch;
export function Slot(length: number, width: number, options?: PlacementOptions): Sketch;
export function ArcSlot(radius: number, width: number, angle: number, options?: PlacementOptions): Sketch;
export function Stroke(path: Edge | Wire, width: number, options?: {
    ends?: 'round' | 'flat';
    corners?: 'round' | 'sharp' | 'chamfer';
}): Sketch;
export type HullItem = VectorLike | Vertex | Edge | Wire | Sketch | Face | readonly HullItem[];
export function Hull(...items: HullItem[]): Sketch;
export function makeFace(outer: Wire | Edge, ...holes: (Wire | Edge)[]): Sketch;
export interface TextOptions {
    font?: string | BytesLike | Font | null;
    align?: AlignLike;
    spacing?: number;
    lineSpacing?: number;
    kerning?: boolean;
    path?: Edge | Wire | null;
}
export function Text(text: string, size: number, options?: TextOptions): Sketch;
export type Point = readonly [number, number];
export type Segment = readonly Point[];
export type Contour = Segment[];
export class PairAdjustment {
    readonly advance1: number;
    readonly placement1: number;
    readonly advance2: number;
    readonly placement2: number;
    constructor(advance1?: number, placement1?: number, advance2?: number, placement2?: number);
    toString(): string;
}
export class FontError extends RangeError {
    constructor(message: string);
}
export const DEFAULT_FONT: Uint8Array;
export function loadFont(source?: string | BytesLike | null): Font;
export class Font {
    readonly path: string | null;
    readonly name: string;
    readonly unitsPerEm: number;
    readonly numGlyphs: number;
    readonly capHeight: number;
    constructor(source: string | BytesLike);
    toString(): string;
    glyphIndex(char: string): number | null;
    characters(): string[];
    advance(glyph: number): number;
    kerning(left: number, right: number): PairAdjustment;
    get kerningSource(): string | null;
    outline(glyph: number): Contour[];
}
```

### Parts and patterns

```ts
export function Box(length: number, width: number, height: number, options?: {
    align?: AlignLike;
}): Part;
export function Cylinder(radius: number, height: number, options?: {
    arcSize?: number;
    align?: AlignLike;
}): Part;
export function Cone(bottomRadius: number, topRadius: number, height: number, options?: {
    arcSize?: number;
    align?: AlignLike;
}): Part;
export function Sphere(radius: number, options?: {
    arcSize1?: number;
    arcSize2?: number;
    arcSize3?: number;
    align?: AlignLike;
}): Part;
export function Torus(majorRadius: number, minorRadius: number, options?: {
    minorStartAngle?: number;
    minorEndAngle?: number;
    majorAngle?: number;
    align?: AlignLike;
}): Part;
export function Pyramid(length: number, width: number, height: number, options?: {
    align?: AlignLike;
}): Part;
export function Wedge(length: number, width: number, height: number, topLength?: number, options?: {
    align?: AlignLike;
}): Part;
export function AnnularSector(innerRadius: number, outerRadius: number, height: number, arcSize: number, options?: {
    align?: AlignLike;
}): Part;
export function Hole(radius: number, depth: number): Part;
export function CounterBoreHole(radius: number, counterBoreRadius: number, counterBoreDepth: number, depth: number): Part;
export function CounterSinkHole(radius: number, counterSinkRadius: number, depth: number, angle?: number): Part;
export type LocationLike = Location | Plane | Locations | Face | Vertex | VectorLike | ShapeList<Face>;
export class Locations extends Array<Location> {
    constructor(...items: LocationLike[]);
    mul(other: Location | Locations): Locations;
    mul<T>(other: Shape | Iterable<T>): ShapeList<Any>;
    moved(location: Location): Locations;
    on(target: Plane | Face | Location | ShapeList<Face> | Sketch): Locations;
    get points(): Vector[];
    toString(): string;
}
export function GridLocations(xSpacing: number, ySpacing: number, xCount: number, yCount: number, options?: {
    centered?: boolean;
}): Locations;
export function PolarLocations(radius: number, count: number, options?: {
    startAngle?: number;
    angularRange?: number;
    rotate?: boolean;
}): Locations;
export function HexLocations(spacing: number, xCount: number, yCount: number, options?: {
    centered?: boolean;
}): Locations;
```

### Features

```ts
export interface ExtrudeFunctionOptions {
    both?: boolean;
    taper?: number;
    direction?: Axis | VectorLike | null;
    corners?: 'sharp' | 'round';
}
export function extrude(profile: Sketch | Face | ShapeList<Sketch | Face>, amount: number, options?: ExtrudeFunctionOptions): Part;
export function extrude(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, amount: number, options?: ExtrudeFunctionOptions): Part | Shell;
export function revolve(profile: Sketch | Face | ShapeList<Sketch | Face>, axis?: Axis | null, angle?: number): Part;
export function revolve(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, axis?: Axis | null, angle?: number): Part | Shell;
export type LoftOptions = {
    ruled?: boolean;
    smooth?: boolean;
    startTangent?: Axis | VectorLike | Face | ShapeList<Face> | null;
    endTangent?: Axis | VectorLike | Face | ShapeList<Face> | null;
    closed?: boolean;
    rails?: Edge | Wire | readonly (Edge | Wire)[] | null;
};
export function loft(sections: readonly (Sketch | Face | ShapeList<Sketch | Face>)[], options?: LoftOptions): Part;
export function loft(sections: readonly (Sketch | Face | Wire | Edge | ShapeList<Any>)[], options?: LoftOptions): Part | Shell;
export interface SweepOptions {
    orient?: boolean;
    translational?: boolean;
    sharpCorners?: boolean | null;
    up?: Axis | VectorLike | string | null;
    twist?: number | ((s: number) => number);
    scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null;
    anchor?: 'center' | 'origin' | VectorLike | Vertex;
    rails?: Edge | Wire | null;
}
export function sweep(profile: Sketch | Face | ShapeList<Sketch | Face>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part;
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part | Shell;
export function swing(profile: Sketch | Face, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part;
export function swing(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part | Shell;
export function fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part;
export function fillet(vertices: Vertex | readonly Vertex[], radius: number): Sketch;
export function fillet(edges: EdgesLike | Vertex | readonly Vertex[], radius: FilletRadius, options?: FilletOptions): Part | Sketch;
export function chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part;
export function chamfer(vertices: Vertex | readonly Vertex[], length: number): Sketch;
export function chamfer(edges: EdgesLike | Vertex | readonly Vertex[], length: number, options?: ChamferOptions): Part | Sketch;
export function shell(part: Part, thickness: number, openings?: FacesLike | null, options?: {
    outward?: boolean;
    corners?: 'round' | 'sharp' | null;
    walls?: WallsLike | null;
}): Part;
export type OffsetFunctionOptions = {
    corners?: 'round' | 'sharp' | 'chamfer';
    plane?: Plane | null;
};
export function offset(shape: Part, distance: number, options?: {
    corners?: 'sharp' | 'round';
}): Part;
export function offset(shape: Sketch, distance: number, options?: {
    corners?: 'round' | 'sharp' | 'chamfer';
}): Sketch;
export function offset(shape: Shell | Face, distance: number): Shell;
export function offset(shape: Wire, distance: number, options?: {
    corners?: 'round' | 'sharp' | 'chamfer';
    plane?: Plane | null;
}): Wire;
export function offset(shape: Edge, distance: number, options?: {
    plane?: Plane | null;
}): Edge;
export function offset(shape: Part | Sketch | Shell | Face | Wire | Edge, distance: number, options?: OffsetFunctionOptions): Part | Sketch | Shell | Wire | Edge;
export function mirror<S extends Shape>(shape: S, plane?: Plane | Face | Axis | ShapeList<Face>): S;
export function split(part: Part, plane: Plane | Face | Shell, keep: 'both'): [Part, Part];
export function split(part: Part, plane: Plane | Face | Shell, keep?: 'above' | 'below'): Part;
export function split(part: Part, plane: Plane | Face | Shell, keep?: 'above' | 'below' | 'both'): Part | [Part, Part];
export function merge(...parts: (Part | Iterable<Part>)[]): Part;
export function section(part: Part, plane?: Plane | Face): Sketch;
export function thicken(surface: Shell | Face, thickness: number, options?: {
    both?: boolean;
}): Part;
export function fuse(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function fuse(shape: Shell, ...others: (Shell | Part | Face | Iterable<Shell | Part | Face>)[]): Shell;
export function fuse(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
export function cut(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function cut(shape: Shell, ...others: (Part | Iterable<Part>)[]): Shell;
export function cut(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
export function intersect(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function intersect(shape: Shell, ...others: (Part | Iterable<Part>)[]): Shell;
export function intersect(shape: Part, sheet: Shell | Face): Shell;
export function intersect(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
export function xor(sketch: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function imprint(part: Part, tool: Part | Shell | Face | ShapeList<Face> | Edge | Wire | Iterable<Edge | Wire>, direction?: Axis | VectorLike | null, options?: {
    nearest?: boolean;
}): Part;
export function filletPreview(edges: EdgesLike, radius: number, options?: {
    propagate?: boolean;
}): ShapeList<Shell>;
export function draft(part: Part, faces: FacesLike, angle: number, neutralPlane: Plane | Face): Part;
export function moveFaces(part: Part, faces: FacesLike, by: Location | VectorLike): Part;
export function offsetFaces(part: Part, faces: FacesLike, distance: number): Part;
export function removeFaces(part: Part, faces: FacesLike, options?: {
    partial?: boolean;
}): Part;
export function removeFillets(part: Part, faces?: FacesLike | null, options?: {
    maxRadius?: number | null;
    partial?: boolean;
}): Part;
export function push(shape: Part, face: Face, at: VectorLike, options?: PushOptions): Part;
export function push(shape: Shell, face: Face, at: VectorLike, options?: PushOptions): Shell;
export function warp(shape: Part, face: Face, region: RegionLike, by: number | VectorLike, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Part;
export function warp(shape: Shell, face: Face, region: RegionLike, by: number | VectorLike, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Shell;
export function flatten(shape: Part, face: Face, region: RegionLike, plane: Plane | Face, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Part;
export function flatten(shape: Shell, face: Face, region: RegionLike, plane: Plane | Face, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Shell;
export function extend(shape: Edge, distance: number, options?: {
    end?: 'start' | 'end' | 'both';
    continuity?: 'G1' | 'G2' | 'natural';
}): Edge;
export function extend(shape: Shell | Face, distance: number, options?: {
    sides?: Edge | Iterable<Edge> | null;
    continuity?: 'natural' | 'G1' | 'G2';
}): Shell;
export function trim(shape: Shell, curves: Edge | Wire | Iterable<Edge | Wire>, keep: VectorLike | string): Shell;
export function trim(shape: Edge, start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Edge;
export function trim(shape: Wire, start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Wire;
export function matchEdge(sheet: Shell, edge: Edge, target: Edge | Wire, options?: {
    extent?: number;
}): Shell;
export function mergeFaces(sheet: Shell, a: Face, b: Face): Shell;
export function project(shape: Face, curve: Edge | Wire): ShapeList<Edge>;
export function project(shape: Part | Shell, curve: Edge | Wire, direction?: Axis | VectorLike, options?: {
    nearest?: boolean;
}): ShapeList<Edge>;
export function outline(shape: Part | Shell, plane?: Plane, options?: {
    hidden?: false;
    tangentEdges?: boolean;
}): ShapeList<Edge>;
export function outline(shape: Part | Shell, plane: Plane | undefined, options: {
    hidden: true;
    tangentEdges?: boolean;
}): [ShapeList<Edge>, ShapeList<Edge>];
export function silhouette(shape: Part | Shell, direction?: Axis | VectorLike): ShapeList<Edge>;
export function intersectionCurves(shape: Part | Shell, other: Part | Shell | Face | Plane): ShapeList<Edge>;
export function partingLine(part: Part, direction: Axis | VectorLike): ShapeList<Wire>;
export function slices(shape: Part, step: number, axis?: Axis | VectorLike): Sketch[];
export function slices(shape: Mesh, step: number, axis?: Axis | VectorLike): ShapeList<Wire>[];
export function scale<S extends Shape | Mesh>(shape: S, factor: number | VectorLike, center?: VectorLike): S;
export let GUARD_SECONDS: number;
export let GUARD_BOOLEANS: boolean;
export function setGuardBooleans(on: boolean): boolean;
export function setGuardSeconds(seconds: number): number;
export class FaceDraft {
    readonly face: Face;
    readonly minAngle: number;
    readonly maxAngle: number;
    readonly kind: string;
    constructor(face: Face, minAngle: number, maxAngle: number, kind: string);
    equals(other: unknown): boolean;
    toString(): string;
}
export class DraftAnalysis {
    readonly direction: Vector;
    readonly minAngle: number;
    readonly faces: readonly FaceDraft[];
    constructor(direction: Vector, minAngle: number, faces: readonly FaceDraft[]);
    get positive(): ShapeList<Face>;
    get insufficient(): ShapeList<Face>;
    get vertical(): ShapeList<Face>;
    get undercut(): ShapeList<Face>;
    get ok(): boolean;
    angles(face: Face): [number, number];
    get length(): number;
    toString(): string;
}
```

### Deformations

```ts
export interface RangeOptions {
    start?: number | null;
    end?: number | null;
    tolerance?: number | null;
}
export interface TwistOptions extends RangeOptions {
    axis?: Axis;
}
export function twist(shape: Part, angle: number, options?: TwistOptions): Part;
export function twist(shape: Shell, angle: number, options?: TwistOptions): Shell;
export function twist(shape: Edge, angle: number, options?: TwistOptions): Edge;
export function twist(shape: Wire, angle: number, options?: TwistOptions): Wire;
export function twist(shape: VectorLike, angle: number, options?: TwistOptions): Vector;
export function twist(shape: readonly VectorLike[], angle: number, options?: TwistOptions): Vector[];
export interface TaperOptions extends RangeOptions {
    axis?: Axis;
}
export function taper(shape: Part, scale: number, options?: TaperOptions): Part;
export function taper(shape: Shell, scale: number, options?: TaperOptions): Shell;
export function taper(shape: Edge, scale: number, options?: TaperOptions): Edge;
export function taper(shape: Wire, scale: number, options?: TaperOptions): Wire;
export function taper(shape: VectorLike, scale: number, options?: TaperOptions): Vector;
export function taper(shape: readonly VectorLike[], scale: number, options?: TaperOptions): Vector[];
export interface BendOptions extends RangeOptions {
    radius?: number | null;
    plane?: Plane;
}
export function bend(shape: Part, angle: number, options?: BendOptions): Part;
export function bend(shape: Shell, angle: number, options?: BendOptions): Shell;
export function bend(shape: Edge, angle: number, options?: BendOptions): Edge;
export function bend(shape: Wire, angle: number, options?: BendOptions): Wire;
export function bend(shape: VectorLike, angle: number, options?: BendOptions): Vector;
export function bend(shape: readonly VectorLike[], angle: number, options?: BendOptions): Vector[];
export interface UnrollOptions {
    radius: number;
    axis?: Axis;
    start?: VectorLike | null;
    tolerance?: number | null;
}
export function unroll(shape: Part, options: UnrollOptions): Part;
export function unroll(shape: Shell, options: UnrollOptions): Shell;
export function unroll(shape: Edge, options: UnrollOptions): Edge;
export function unroll(shape: Wire, options: UnrollOptions): Wire;
export function unroll(shape: VectorLike, options: UnrollOptions): Vector;
export function unroll(shape: readonly VectorLike[], options: UnrollOptions): Vector[];
export type LatticeLayers = number | null | readonly number[];
export type LatticeIndex = readonly [LatticeLayers, LatticeLayers, LatticeLayers];
export class Lattice {
    points: number[][][][];
    constructor(box: BoundBox | {
        bbox(): BoundBox;
    }, counts?: number | readonly number[], options?: {
        margin?: number;
    });
    get counts(): [number, number, number];
    get box(): BoundBox;
    get rest(): readonly (readonly (readonly (readonly number[])[])[])[];
    get offsets(): number[][][][];
    layer(axis: Axis | string, index: number): [LatticeLayers, LatticeLayers, LatticeLayers];
    move(index: LatticeIndex, offset: VectorLike): this;
    scale(index: LatticeIndex, factor: number | VectorLike, center?: VectorLike | null): this;
    rotate(index: LatticeIndex, axis: Axis, angle: number): this;
    reset(): this;
    copy(): Lattice;
    map(point: VectorLike): Vector;
    apply(shape: Part, options?: {
        tolerance?: number | null;
    }): Part;
    apply(shape: Shell, options?: {
        tolerance?: number | null;
    }): Shell;
    apply(shape: Edge, options?: {
        tolerance?: number | null;
    }): Edge;
    apply(shape: Wire, options?: {
        tolerance?: number | null;
    }): Wire;
    apply(shape: VectorLike, options?: {
        tolerance?: number | null;
    }): Vector;
    apply(shape: readonly VectorLike[], options?: {
        tolerance?: number | null;
    }): Vector[];
    toString(): string;
}
export function deform(shape: Part, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Part;
export function deform(shape: Shell, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Shell;
export function deform(shape: Edge, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Edge;
export function deform(shape: Wire, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Wire;
export function deform(shape: VectorLike, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Vector;
export function deform(shape: readonly VectorLike[], lattice: Lattice, options?: {
    tolerance?: number | null;
}): Vector[];
```

### Surfaces

```ts
export class FitReport {
    readonly maxDistance: number;
    readonly rmsDistance: number;
    readonly distances: number[];
    constructor(maxDistance: number, rmsDistance: number, distances: number[]);
}
type SurfaceOptions = {
    interpolate?: boolean;
    controls?: number | readonly [number, number] | null;
    smoothing?: number;
    report?: boolean;
};
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options: SurfaceOptions & {
    report: true;
}): [Shell, FitReport];
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options?: SurfaceOptions): Shell;
export function nurbsSurface(points: readonly (readonly VectorLike[])[] | NurbsSurfaceData, knots?: readonly [
    readonly number[],
    readonly number[]
] | null, degrees?: number | readonly [number, number] | null, weights?: readonly (readonly number[])[] | null): Shell;
export function ruled(a: Edge | Wire, b: Edge | Wire): Shell;
export class StitchReport {
    readonly sewnEdges: number;
    readonly openEdges: number;
    readonly maxGap: number;
    readonly turnedFaces: number;
    readonly tolerance: number;
    constructor(sewnEdges: number, openEdges: number, maxGap: number, turnedFaces: number, tolerance: number);
}
type StitchOptions = {
    tolerance?: number | null;
    report?: boolean;
};
export function stitch(...args: [
    ...StitchPiece[],
    StitchOptions & {
        report: true;
    }
]): [Part | Shell, StitchReport];
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell;
export function surfaceFillet(a: Face | Shell, b: Face | Shell, radius: number, options?: {
    radius2?: number | null;
    shape?: 'round' | 'chamfer';
    sides?: readonly [number, number];
    trim?: boolean;
}): Shell;
export function blend(edgeA: Edge, edgeB: Edge, options?: {
    continuity?: 'G1' | 'G2' | 'G3' | number;
    tension?: number | readonly [number, number];
    join?: boolean;
}): Shell;
export function fill(boundary: Edge | Wire | Iterable<Edge | Wire>, options?: {
    tangent?: boolean;
}): Shell;
export function network(u: Iterable<Edge | Wire>, v: Iterable<Edge | Wire>): Shell;
```

### Sheet metal

```ts
export type KFactor = number | string | ((radius: number, thickness: number, angle: number) => number) | ReadonlyMap<number, number> | Readonly<Record<string, number>> | readonly (readonly [number, number])[] | null;
export interface BendAllowanceOptions {
    radius: number;
    thickness: number;
    kFactor?: number;
}
export interface DevelopedLengthOptions extends BendAllowanceOptions {
    angle?: number | Iterable<number>;
}
export function bendAllowance(angle: number, options: BendAllowanceOptions): number;
export function bendDeduction(angle: number, options: BendAllowanceOptions): number;
export function developedLength(...args: [
    ...legs: number[],
    options: DevelopedLengthOptions
]): number;
export class Bend {
    readonly angle: number;
    readonly radius: number;
    readonly thickness: number;
    readonly kFactor: number;
    readonly length: number;
    readonly axis: Axis | null;
    readonly line: Edge | null;
    readonly direction: string | null;
    constructor(angle: number, radius: number, thickness: number, kFactor: number, length: number, axis?: Axis | null, line?: Edge | null, direction?: string | null);
    get allowance(): number;
    equals(other: unknown): boolean;
    toString(): string;
}
export class FlatPattern {
    readonly part: Part;
    readonly outline: Sketch;
    readonly bends: Bend[];
    readonly thickness: number;
    readonly kFactor: number | null;
    constructor(part: Part, outline: Sketch, bends: Bend[], thickness: number, kFactor: number | null);
    get bendLines(): ShapeList<Edge>;
    get size(): Vector;
    equals(other: unknown): boolean;
    toString(): string;
}
export interface FoldOptions {
    radius: number;
    kFactor?: number;
    fixed?: VectorLike | Shape | null;
    partial?: boolean;
}
export function fold(part: Part, line: Axis | Edge, angle: number, options: FoldOptions): Part;
export interface FlangeOptions {
    angle?: number;
    radius: number;
    kFactor?: number;
}
export function flange(part: Part, edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part;
export interface UnfoldOptions {
    kFactor?: KFactor;
    fixed?: Face | null;
}
export function unfold(part: Part, options?: UnfoldOptions): Part;
export function flatPattern(part: Part, options?: UnfoldOptions): FlatPattern;
```

### Meshes

```ts
export class RepairReport {
    readonly mergedVertices: number;
    readonly removedTriangles: number;
    readonly flippedTriangles: number;
    readonly filledHoles: number;
    readonly openHoles: number;
    readonly openEdges: number;
    constructor(mergedVertices: number, removedTriangles: number, flippedTriangles: number, filledHoles: number, openHoles: number, openEdges: number);
}
export class Mesh {
    vertices: Float64Array;
    triangles: Uint32Array;
    normals: Float32Array | null;
    constructor(vertices: ArrayLike<number>, triangles: ArrayLike<number>, normals?: ArrayLike<number> | null);
    get length(): number;
    dispose(): void;
    get triangleNormals(): Float64Array;
    get area(): number;
    get volume(): number;
    bbox(): BoundBox;
    center(): Vector;
    get centroid(): Vector;
    massProperties(density?: number): MassProperties;
    moved(location: Location): Mesh;
    translate(x?: number | VectorLike, y?: number, z?: number): Mesh;
    rotate(axis?: Axis, angle?: number): Mesh;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): Mesh;
    scale(factor: number | VectorLike, center?: VectorLike): Mesh;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<null>[];
    raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<null> | null)[];
    isClosed(): boolean;
    section(plane?: Plane | Face): ShapeList<Wire>;
    slices(step: number, axis?: Axis | VectorLike): ShapeList<Wire>[];
    decimate(fraction?: number | null, options?: {
        triangles?: number | null;
        tolerance?: number | null;
        featureAngle?: number;
    }): Mesh;
    fillHoles(): Mesh;
    repaired(): [Mesh, RepairReport];
    toPart(maxFaces?: number): Part;
    fuse(other: Mesh): Mesh;
    cut(other: Mesh): Mesh;
    intersect(other: Mesh): Mesh;
    export(path: string, options?: FileOptions): void;
    toString(): string;
}
export function tessellate(shape: Shape | Iterable<Shape>, tolerance?: number | null, angle?: number, options?: {
    maxEdge?: number | null;
}): Mesh;
```

### Files

```ts
export type ShapesLike = Shape | Mesh | (Iterable<ShapesLike> & object);
export type StepItemsLike = Shape | Mesh | Vector | Plane | StepCurve | StepPoint | StepFrame | StepModel | (Iterable<StepItemsLike> & object);
export type FileItemsLike = StepItemsLike | DxfShapesLike;
export type FileOptions = StepExportOptions | (MeshOptions & {
    ascii?: boolean;
}) | GltfOptions | DxfWriteOptions | SvgOptions | UsdExportOptions;
export function exportFile(shapes: FileItemsLike, path: string, options?: FileOptions): void;
export function toFile(shapes: FileItemsLike, name: string, options?: FileOptions): string | Uint8Array;
export function fromFile(data: string | BytesLike, name: string): Part | Shell | Sketch | Mesh | ShapeList<Part | Shell> | Shape | ShapeList<Shape>;
export interface StepExportOptions {
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in';
    name?: string | null;
    assembly?: boolean;
}
export function exportStep(shapes: StepItemsLike, path: string, options?: StepExportOptions): void;
export function toStep(shapes: StepItemsLike, options?: StepExportOptions): string;
export interface MeshOptions {
    tolerance?: number | null;
    angle?: number;
    maxEdge?: number | null;
}
export function toStl(shapes: ShapesLike, options?: MeshOptions & {
    ascii?: boolean;
}): Uint8Array;
export function exportStl(shapes: ShapesLike, path: string, options?: MeshOptions & {
    ascii?: boolean;
}): void;
export function importStl(path: string): Mesh;
export function fromStl(data: string | BytesLike): Mesh;
export function toObj(shapes: ShapesLike, options?: MeshOptions): string;
export function exportObj(shapes: ShapesLike, path: string, options?: MeshOptions): void;
export interface GltfOptions extends MeshOptions {
    edges?: boolean;
    edgeColor?: Any;
}
export function toGlb(shapes: ShapesLike, options?: GltfOptions): Uint8Array;
export function exportGlb(shapes: ShapesLike, path: string, options?: GltfOptions): void;
export function toGltf(shapes: ShapesLike, options?: GltfOptions): string;
export function exportGltf(shapes: ShapesLike, path: string, options?: GltfOptions): void;
export function toSmb(shapes: ShapesLike, options?: {
    ascii?: boolean;
}): Uint8Array;
export function fromSmb(data: string | BytesLike): Part | Shell;
export function toSmp(shapes: ShapesLike, options?: {
    ascii?: boolean;
}): Uint8Array;
export function fromSmp(data: string | BytesLike): Shape | ShapeList<Shape>;
export function save(shapes: ShapesLike, path: string, options?: {
    ascii?: boolean;
}): void;
export function load(path: string): Part | Shell | Sketch | Mesh | ShapeList<Part | Shell> | Shape | ShapeList<Shape>;
export class StepFrame {
    readonly name: string;
    readonly plane: Plane;
    readonly product: string;
    readonly color: readonly number[] | null;
    constructor(name: string, plane: Plane, product?: string, color?: readonly number[] | null);
    get location(): Location;
    equals(other: unknown): boolean;
    toString(): string;
}
export class StepCurve {
    readonly name: string;
    readonly shape: Edge | Wire;
    readonly product: string;
    readonly color: readonly number[] | null;
    constructor(name: string, shape: Edge | Wire, product?: string, color?: readonly number[] | null);
    equals(other: unknown): boolean;
    toString(): string;
}
export class StepPoint {
    readonly name: string;
    readonly point: Vector;
    readonly product: string;
    readonly color: readonly number[] | null;
    constructor(name: string, point: Vector, product?: string, color?: readonly number[] | null);
    equals(other: unknown): boolean;
    toString(): string;
}
export class StepModel {
    readonly bodies: ShapeList<Part | Shell>;
    readonly frames: StepFrame[];
    readonly curves: StepCurve[];
    readonly points: StepPoint[];
    readonly skipped: string[];
    constructor(bodies: ShapeList<Part | Shell>, frames?: StepFrame[], curves?: StepCurve[], points?: StepPoint[], skipped?: string[]);
    frame(name: string, product?: string | null): Plane;
    equals(other: unknown): boolean;
    toString(): string;
}
export function fromStepModel(data: string | BytesLike, options?: {
    heal?: boolean;
    strict?: boolean;
}): StepModel;
export function readStep(path: string, options?: {
    heal?: boolean;
    strict?: boolean;
}): StepModel;
export function fromStep(data: string | BytesLike, options?: {
    heal?: boolean;
    strict?: boolean;
}): Part | Shell | ShapeList<Part | Shell>;
export function importStep(path: string, options?: {
    heal?: boolean;
    strict?: boolean;
}): Part | Shell | ShapeList<Part | Shell>;
export interface IgesImportOptions {
    heal?: boolean;
    strict?: boolean;
}
export function fromIges(data: string | BytesLike, options?: IgesImportOptions): Part | Shell | ShapeList<Part | Shell>;
export function importIges(path: string, options?: IgesImportOptions): Part | Shell | ShapeList<Part | Shell>;
export interface DxfReadOptions {
    layers?: Iterable<string> | string | null;
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft' | null;
    tolerance?: number | null;
}
export interface DxfWriteOptions {
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft';
    plane?: Plane | null;
    curves?: 'exact' | 'arcs';
    tolerance?: number;
}
export function importDxfWires(path: string, options?: DxfReadOptions): ShapeList<Wire>;
export function fromDxfWires(data: string | BytesLike, options?: DxfReadOptions): ShapeList<Wire>;
export function importDxf(path: string, options?: DxfReadOptions): Sketch;
export function fromDxf(data: string | BytesLike, options?: DxfReadOptions): Sketch;
export type DxfShapesLike = ShapesLike | DrawingView | (Iterable<DxfShapesLike> & object);
export function exportDxf(shapes: DxfShapesLike, path: string, options?: DxfWriteOptions): void;
export function toDxf(shapes: DxfShapesLike, options?: DxfWriteOptions): string;
export class DrawingView {
    readonly name: string;
    readonly direction: Vector;
    readonly visible: ShapeList<Edge>;
    readonly hidden: ShapeList<Edge>;
    constructor(name: string, direction: Vector, visible: ShapeList<Edge>, hidden: ShapeList<Edge>);
    bbox(): BoundBox;
    toString(): string;
}
export interface DrawingViewsOptions {
    projection?: 'first-angle' | 'third-angle';
    hidden?: boolean;
    tangentEdges?: boolean;
    gap?: number | null;
}
export function drawingViews(part: Part | Shell | Iterable<Part | Shell>, views?: string | readonly string[], options?: DrawingViewsOptions): DrawingView[];
export type SvgItemsLike = DrawingView | Edge | Wire | Face | Shell | readonly SvgItemsLike[];
export interface SvgOptions {
    margin?: number | null;
    stroke?: number | null;
}
export function toSvg(shapes: SvgItemsLike, options?: SvgOptions): string;
export function exportSvg(shapes: SvgItemsLike, path: string, options?: SvgOptions): void;
export interface UsdExportOptions {
    mesh?: boolean;
    tolerance?: number | null;
    angle?: number;
    materials?: boolean;
    maxEdge?: number | null;
}
export function toUsd(shapes: ShapesLike, options?: UsdExportOptions): string;
export function exportUsd(shapes: ShapesLike, path: string, options?: UsdExportOptions): void;
export interface UsdImportOptions {
    heal?: boolean;
    units?: string | null;
    placement?: boolean;
    check?: boolean;
    strict?: boolean;
}
export interface UsdReadOptions extends UsdImportOptions {
    resolve?: ((asset: string, from: string) => string | Uint8Array | null | undefined) | null;
}
export function fromUsd(data: string | BytesLike, options?: UsdReadOptions): Part | Shell | ShapeList<Part | Shell>;
export function importUsd(path: string, options?: UsdImportOptions): Part | Shell | ShapeList<Part | Shell>;
export interface BrepImportOptions {
    heal?: boolean;
    check?: boolean;
    strict?: boolean;
}
export function toBrep(shapes: ShapesLike): string;
export function exportBrep(shapes: ShapesLike, path: string): void;
export function importBrep(path: string, options?: BrepImportOptions): Part | Shell | ShapeList<Part | Shell>;
export function fromBrep(data: string | BytesLike, options?: BrepImportOptions): Part | Shell | ShapeList<Part | Shell>;
export type BytesLike = Uint8Array | ArrayBufferView | ArrayBuffer;
```

### Pictures and the viewer

```ts
export interface Frame {
    scale: number;
    midX: number;
    midY: number;
}
export const VIEWS: Readonly<Record<string, readonly [number, number, number]>>;
export interface ImageLike {
    width: number;
    height: number;
    data: ArrayLike<number>;
}
export class Picture {
    readonly data: Uint8Array;
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly frame: Frame | null;
    save(path: string): void;
    toString(): string;
}
export class ImageDiff {
    readonly changed: number;
    readonly total: number;
    readonly fraction: number;
    readonly bbox: [number, number, number, number] | null;
    readonly picture: Picture;
    constructor(changed: number, total: number, fraction: number, bbox: [number, number, number, number] | null, picture: Picture);
    save(path: string): void;
    toString(): string;
}
export type Renderable = Shape | Mesh | StepModel | (Iterable<Renderable> & object);
export type RenderView = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | (string & {}) | VectorLike | {
    azimuth?: number;
    elevation?: number;
} | {
    direction: VectorLike;
    up?: VectorLike | null;
};
export type RenderPoint = VectorLike | Shape | BoundBox;
export type RenderMarker = RenderPoint | readonly [RenderPoint, string] | readonly [RenderPoint, string, ColorLike | null] | {
    position: RenderPoint;
    label?: string;
    color?: ColorLike | null;
};
export type CurvatureKind = 'mean' | 'gaussian' | 'max' | 'min' | (string & {});
export interface RenderOptions {
    path?: string | null;
    view?: RenderView | 'sheet';
    size?: readonly [number, number];
    edges?: boolean;
    background?: string | readonly number[];
    tolerance?: number | null;
    zoom?: number;
    lookAt?: RenderPoint | null;
    frame?: Frame | Picture | Record<string, number> | readonly number[] | null;
    supersample?: number;
    colors?: 'native' | 'distinct';
    lines?: boolean;
    drawing?: boolean | 'first-angle' | 'third-angle' | (string & {}) | {
        projection?: string;
        side?: string;
        iso?: boolean;
    } | null;
    sheet?: boolean | readonly (RenderView | null)[] | null;
    section?: Plane | Face | readonly [Face] | readonly [RenderPoint, VectorLike] | {
        origin: RenderPoint;
        normal: VectorLike;
        cap?: boolean;
    } | false | null;
    cap?: boolean;
    highlight?: Shape | Mesh | readonly (Shape | Mesh | readonly (Shape | Mesh)[])[] | null;
    highlightAt?: VectorLike | Iterable<RenderPoint> | null;
    markers?: VectorLike | {
        position: RenderPoint;
        label?: string;
        color?: ColorLike | null;
    } | Iterable<RenderMarker> | null;
    annotate?: boolean;
    xray?: boolean;
    xrayAlpha?: number;
    zebra?: boolean | {
        stripes?: number;
        width?: number;
        direction?: 'vertical' | 'horizontal' | (string & {}) | VectorLike;
    } | null;
    curvature?: CurvatureKind | {
        kind?: CurvatureKind;
        range?: number | readonly [number, number] | null;
    } | false | null;
}
export function render(...shapes: Renderable[]): Picture;
export function render(...args: [
    ...shapes: Renderable[],
    options: RenderOptions
]): Picture;
export function diffImages(a: Picture | ImageLike | Uint8Array | ArrayBuffer | string, b: Picture | ImageLike | Uint8Array | ArrayBuffer | string, tolerance?: number): ImageDiff;
export interface PageOptions {
    title?: string;
    tolerance?: number | null;
    angle?: number;
    edges?: boolean;
    view?: readonly [number, number, number];
    margin?: number;
}
export function htmlPage(...shapes: ShapesLike[]): string;
export function htmlPage(...args: [
    ...shapes: ShapesLike[],
    options: PageOptions
]): string;
export interface ShowOptions {
    title?: string;
    path?: string | null;
    openBrowser?: boolean;
    tolerance?: number | null;
    angle?: number;
    edges?: boolean;
}
export function show(...shapes: ShapesLike[]): string;
export function show(...args: [
    ...shapes: ShapesLike[],
    options: ShowOptions
]): string;
```

### Errors and memory

```ts
export class ModelingError extends Error {
    constructor(message: string);
}
export class KernelError extends ModelingError {
    readonly operation: string;
    readonly status: string | null;
    readonly detail: string;
    readonly hint: string | null;
    readonly trace: readonly string[];
    constructor(operation: string, detail: string, status?: string | null, hint?: string | null);
}
export interface MemoryUsage {
    readonly used: number;
    readonly heap: number;
    readonly limit: number;
    readonly handles: number;
    readonly crashes: number;
}
export function memoryUsage(): MemoryUsage;
export function scope<T>(fn: () => T): T;
export function setWarningHandler(handler: (message: string) => void): void;
```

### The worker entry: @classcad/smlibwasm/worker

```ts
export type FunctionName<M> = {
    [K in keyof M]: M[K] extends (...args: any[]) => unknown ? K : never;
}[keyof M] & string;
export type Remote<M> = {
    readonly [K in FunctionName<M>]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};
export interface WorkerLike {
    postMessage(message: unknown, transfer?: readonly Transferable[]): void;
    terminate(): unknown;
}
export interface KernelWorkerOptions {
    timeout?: number;
    startTimeout?: number;
}
export interface CallOptions {
    timeout?: number;
    signal?: AbortSignal;
}
export class KernelWorker<M extends object = Record<string, (...args: any[]) => unknown>> {
    constructor(worker: URL | string | (() => WorkerLike), options?: KernelWorkerOptions);
    call<K extends FunctionName<M>>(name: K, args?: M[K] extends (...a: infer A) => unknown ? A : never, options?: CallOptions): Promise<M[K] extends (...a: any[]) => infer R ? Awaited<R> : never>;
    get functions(): Remote<M>;
    start(): Promise<string[]>;
    get pending(): number;
    terminate(): void;
}
export function expose(functions: object | (() => object | Promise<object>)): void;
```

### Loading the kernel: @classcad/smlibwasm/init

```ts
export interface InitOptions {
    locateFile?: (path: string, prefix: string) => string;
    wasmBinary?: ArrayBuffer | ArrayBufferView;
    wasmModule?: WebAssembly.Module;
    instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => unknown;
}
export function init(options?: InitOptions): Promise<typeof import('./index.ts')>;
```

### The raw kernel layer (no stable API): @classcad/smlibwasm/kernel

```ts
export interface Kernel {
    [name: string]: Any;
}
export const module: Any;
export type Signature = readonly (string | readonly [
    string,
    unknown
])[];
export const k: Kernel;
export const ext: Any;
export function kernelCall<T>(operation: string, fn: () => T, hint?: string | null): T;
export interface MemoryUsage {
    readonly used: number;
    readonly heap: number;
    readonly limit: number;
    readonly handles: number;
    readonly crashes: number;
}
export function memoryUsage(): MemoryUsage;
export abstract class Handle {
    constructor(kind: string, p: number);
    readonly id: number;
    release(): number;
    get alive(): boolean;
    dispose(): void;
}
export function scope<T>(fn: () => T): T;
export class BrepHandle extends Handle {
    sound: number;
    props: Any;
    tags: [
        number[][],
        number[][]
    ] | null;
    shells: [
        Any[],
        number[][]
    ] | null;
    merged: {
        parts: Any[];
        placement: Float64Array;
        cells: Any[][] | null;
    } | null;
    sources: Any[] | null;
    meshes: Map<string, any>;
    imported: boolean;
    constructor(brep: number);
    get brep(): number;
    set brep(brep: number);
}
export class CurveHandle extends Handle {
    constructor(curve: number);
    get curve(): number;
}
export class SurfaceHandle extends Handle {
    constructor(surface: number);
    get surface(): number;
}
export class PolyHandle extends Handle {
    constructor(poly: number);
    get poly(): number;
}
export function setWarningHandler(handler: (message: string) => void): void;
```
