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
next to the module, found with `new URL('smlibwasm.wasm', import.meta.url)`, which Vite, webpack 5
and other bundlers resolve on their own. Node needs version 22.18 or later.

Vite's dev server bundles dependencies in advance and loses the file on the way; leave the package
out of that (a build needs nothing):

```js
// vite.config.js
export default { optimizeDeps: { exclude: ['@classcad/smlibwasm'] } }
```

## Size

What a browser loads, compressed as web servers send it (brotli at its best level, gzip for
comparison):

| | brotli | gzip | uncompressed |
|---|---|---|---|
| The kernel, `smlibwasm.wasm` | 1.7 MB | 2.4 MB | 6.7 MB |
| Its loader, `smlibwasm.mjs` | 21 kB | 24 kB | 86 kB |
| The library | 0.22 MB | 0.27 MB | 1.0 MB |
| The font of `Text` | 46 kB | 59 kB | 130 kB |
| **Together** | **2.0 MB** | **2.7 MB** | **7.9 MB** |

Browsers cache the kernel like any other file, so it loads once. The library is counted as
published, unminified; a bundler that minifies it makes it smaller.

## In the browser

A part's mesh goes straight into a renderer such as three.js:

```js
import * as THREE from 'three'
import { Box, Cylinder } from '@classcad/smlibwasm'

const part = Box(40, 30, 10).cut(Cylinder(6, 20))
const mesh = part.mesh(0.01) // chord height tolerance in mm
const geometry = new THREE.BufferGeometry()
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3))
geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1))
geometry.computeVertexNormals()
```

Files are read and written in memory: `toStep`, `toStl`, `toGlb`, `toObj` and `toDxf` give a
file's contents, and `fromStep`, `fromIges`, `fromStl` and `fromDxf` read them, from text or bytes:

```js
const part = fromStep(await file.text()) // a File from an <input type="file">
const glb = new Blob([toGlb(part)], { type: 'model/gltf-binary' })
```

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
  the options go (`Rectangle(20, 10, 3)`).
- **Operators** become methods: `a.fuse(b)`, `a.cut(b)` and `a.intersect(b)` for Python's `+`,
  `-` and `&`; `Pos(10, 0, 0).mul(Box(1, 1, 1))` for `*`; `vector.add(other)`.
- **Lists**: a `ShapeList` is an Array. Python's selection by a point, `faces().at(point)`, is
  `atPoint(point)`, since `at` takes an index; Python's `list[-1]` is `list.at(-1)` or
  `list.last`.
- **Errors**: Python's `ValueError` is a `RangeError`; `ModelingError` and `KernelError` are
  exported.
- **Files**: in Node, `exportStep(shapes, path)`, `importStep(path)` and the other path functions
  write and read files as smlibpy's do; `show(part)` opens the viewer in the browser.
  `fromUsd(text, { resolve })` gets the layers and files a stage references from
  `resolve(asset, from)`, where `importUsd(path)` and Python's `import_usd` read them from disk.

## Memory

Every body lives in the kernel's memory, which the JavaScript garbage collector does not see. A
body's kernel object is freed when the body is garbage collected; `part.dispose()` (or
`using part = ...`) frees it at once, which keeps memory flat in long loops. The faces, edges and
vertices of a disposed body go with it: using them throws a `TypeError`. Edges and wires of their
own (`Line`, `Polyline`, ...) have `dispose()` too.

A mesh (`part.mesh()`, `tessellate`) is its arrays: the kernel's mesh it is made from is freed as
soon as they are copied out, and mesh Booleans build one from the arrays when they need it.
`mesh.dispose()` frees what a mesh still holds in the kernel; the mesh stays usable.

## Running off the main thread

Every call is synchronous and runs on the thread that imported the package, so on a page's main
thread a long call (a fine mesh of a large part, the shell of a large part) freezes
the page until it returns. The package runs unchanged in a Web Worker, or a Node
`worker_threads` worker, each with a kernel of its own. Bodies move between kernels exactly as the
contents of `.smb` files, meshes as their typed arrays, which `postMessage` can transfer:

```js
// worker.js
import { Cylinder, fromSmb, toSmb } from '@classcad/smlibwasm'

onmessage = ({ data }) => {
  const part = fromSmb(data).cut(Cylinder(6, 20))
  const mesh = part.mesh()
  const reply = { smb: toSmb(part, { ascii: false }), vertices: mesh.vertices, triangles: mesh.triangles }
  postMessage(reply, [reply.smb.buffer, reply.vertices.buffer, reply.triangles.buffer])
}
```

```js
// main.js
import { Box, fromSmb, toSmb } from '@classcad/smlibwasm'

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
worker.onmessage = ({ data }) => console.log(fromSmb(data.smb).volume, data.triangles.length / 3)
worker.postMessage(toSmb(Box(40, 30, 10), { ascii: false }))
```

`worker.terminate()` stops a worker at once, whatever its kernel is doing.

`removeFillets`, `removeFaces` and `surfaceFillet` run each kernel step first in a probe worker,
a kernel of its own, on copies of the bodies, as smlibpy runs it first in a forked copy of its
process. A step that crashes the kernel there or takes longer than `GUARD_SECONDS` (20 s;
`setGuardSeconds(seconds)` sets it, `0` turns the probe off) is dropped, as in Python, and the
kernel the call runs on is left alone: SMLib's patching code loops for good on some parts (the
outer round of the enclosure example). The kernel steps of `shell`, `offset` and `thicken` run
only in the probe worker, whose body comes back as an exact copy (`.smb`): the kernel's offset
code can read memory it has freed, and the kernel the call runs on never runs it. The probe waits
for its worker with `Atomics.wait`, which Node allows on every thread and browsers only in workers
of a cross-origin isolated page (one served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`). On a page's main thread, or without cross-origin
isolation, the steps run directly, and a step that loops does not come back: remove fillets and
faces in a worker. There the package starts a small worker of its own when it is imported (a
browser starts a worker only while the thread that creates it is not busy), which starts the
probe worker, with the kernel, for the first step. The two are the package's
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
    isClose(other: VectorLike, tol?: number): boolean;
    isParallel(other: VectorLike, angleTol?: number): boolean;
    isPerpendicular(other: VectorLike, angleTol?: number): boolean;
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
    moved(loc: Location): Axis;
    at(origin: VectorLike): Axis;
    isParallel(other: Axis | VectorLike, angleTol?: number): boolean;
    distanceTo(point: VectorLike): number;
    project(point: VectorLike): Vector;
    positionAlong(point: VectorLike): number;
    equals(other: unknown): boolean;
    toString(): string;
}
export const X: Axis;
export const Y: Axis;
export const Z: Axis;
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
    constructor(origin?: VectorLike | Plane | Location | HasFacePlane, xDir?: VectorLike | null, zDir?: VectorLike);
    get normal(): Vector;
    get location(): Location;
    offset(distance: number): Plane;
    shifted(x?: number, y?: number, z?: number): Plane;
    flipped(): Plane;
    rotated(x?: number | XYZ, y?: number, z?: number): Plane;
    moved(loc: Location): Plane;
    at(origin: VectorLike): Plane;
    toLocal(point: VectorLike): Vector;
    fromLocal(point: VectorLike): Vector;
    contains(point: VectorLike, tol?: number): boolean;
    distanceTo(point: VectorLike): number;
    project(point: VectorLike): Vector;
    isCoplanar(other: Plane, tol?: number): boolean;
    mul(other: Location): Location;
    mul(other: VectorLike): Vector;
    mul<T>(other: Movable<T>): T;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Hit {
    readonly point: Vector;
    readonly distance: number;
    readonly normal: Vector;
    readonly face: any;
    readonly triangle: number | null;
    constructor(point: Vector, distance: number, normal: Vector, face?: any, triangle?: number | null);
}
export class Nurbs {
    readonly degree: number;
    readonly knots: number[];
    readonly points: Vector[];
    readonly weights: number[] | null;
    constructor(degree: number, knots: number[], points: Vector[], weights?: number[] | null);
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
    contains(point: VectorLike, tol?: number): boolean;
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
    mesh(tolerance?: number | null, angle?: number): Mesh;
    show(options?: Record<string, unknown>): unknown;
    export(path: string, options?: Record<string, unknown>): void;
    toString(): string;
}
export class ShapeList<T = Shape> extends Array<T> {
    one(): T;
    get first(): T;
    at(index: number): T | undefined;
    get last(): T;
    sortBy(key?: SortKey, reverse?: boolean): ShapeList<T>;
    filterBy(criterion: Axis | string | ((s: T) => boolean)): ShapeList<T>;
    sortByDistance(point: VectorLike, reverse?: boolean): ShapeList<T>;
    groupBy(key?: SortKey, tol?: number): ShapeList<T>[];
    maxBy(key?: SortKey, tol?: number): ShapeList<T>;
    minBy(key?: SortKey, tol?: number): ShapeList<T>;
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
    fillets(maxRadius?: number | null): ShapeList<T>;
    hitBy(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): ShapeList<T>;
    within(box: BoundBox): ShapeList<T>;
    atPoint(point: VectorLike, tol?: number): ShapeList<T>;
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
    on(target: unknown): ShapeList<T>;
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
    constructor(token?: symbol);
    dispose(): void;
    get geomType(): string;
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
    intersections(other: Edge): Vector[];
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    reversed(): Edge;
    nurbs(): Nurbs;
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
    close(): Wire;
    reversed(): Wire;
    add(other: Edge | Wire): Wire;
    plane(): Plane;
    fillet(radius: number, vertices?: Iterable<VectorLike | Vertex> | null): Wire;
    toSketch(): Sketch;
    toString(): string;
}
export class Face extends Shape {
    constructor(owner: _Body | null, kface: number);
    get owner(): _Body | null;
    get geomType(): string;
    get area(): number;
    center(): Vector;
    interiorPoint(): Vector;
    normalAt(point?: VectorLike | null): Vector;
    get isPlanar(): boolean;
    get plane(): Plane;
    get radius(): number;
    get axis(): Axis;
    bbox(): BoundBox;
    distanceTo(point: VectorLike | Shape): number;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit[];
    outerWire(): Wire;
    innerWires(): ShapeList<Wire>;
    wires(): ShapeList<Wire>;
    edges(seams?: boolean): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    faces(): ShapeList<Face>;
    neighbors(): ShapeList<Face>;
    toSketch(): Sketch;
    toShell(): Shell;
    extrude(amount: number, options?: ExtrudeOptions): Part;
    equals(other: unknown): boolean;
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
    toString(): string;
}
export interface FilletOptions {
    continuity?: number | string | null;
    fullness?: number;
}
export class Part extends _Body {
    get volume(): number;
    get area(): number;
    center(): Vector;
    massProperties(density?: number, accuracy?: number | null): MassProperties;
    isValid(): boolean;
    solids(): ShapeList<Part>;
    merge(...others: unknown[]): Part;
    cells(): ShapeList<Part>;
    classify(point: VectorLike, tol?: number | null): [string, Face | Edge | Vertex | null];
    contains(point: VectorLike, tol?: number | null): boolean;
    cellAt(point: VectorLike, tol?: number | null): Part | null;
    fuse(...others: (Part | Iterable<Part>)[]): Part;
    cut(...others: (Part | Iterable<Part>)[]): Part;
    intersect(...others: (Part | Iterable<Part>)[]): Part;
    fillet(edges: unknown, radius: FilletRadius, options?: FilletOptions): Part;
    chamfer(edges: unknown, length: number): Part;
    shell(thickness: number, openings?: unknown, options?: {
        outward?: boolean;
    }): Part;
    offset(distance: number): Part;
    split(plane: Plane | Face, keep: 'above' | 'below'): Part;
    split(plane: Plane | Face, keep: 'both'): [Part, Part];
    split(plane: Plane | Face): Part;
    section(plane?: Plane | Face): Sketch;
    twist(angle: number, options?: TwistOptions): Part;
    taper(scale: number, options?: TaperOptions): Part;
    bend(angle: number, options?: BendOptions): Part;
    deform(lattice: {
        apply(part: Part, options?: Record<string, unknown>): Part;
    }, options?: Record<string, unknown>): Part;
    removeFillets(faces?: unknown, options?: {
        maxRadius?: number | null;
        partial?: boolean;
    }): Part;
    removeFaces(faces: unknown, options?: {
        partial?: boolean;
    }): Part;
    draftAnalysis(direction: Axis | VectorLike, options?: {
        minAngle?: number;
    }): DraftAnalysis;
    partingLine(direction: Axis | VectorLike): ShapeList<Wire>;
    draft(faces: unknown, angle: number, neutralPlane: Plane | Face): Part;
    fold(line: Axis | Edge, angle: number, options: FoldOptions): Part;
    flange(edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part;
    bends(options?: {
        kFactor?: number;
    }): Bend[];
    unfold(options?: UnfoldOptions): Part;
    flatPattern(options?: UnfoldOptions): FlatPattern;
    toString(): string;
}
export class Shell extends _Body {
    get area(): number;
    center(): Vector;
    thicken(thickness: number, options?: {
        both?: boolean;
    }): Part;
    fuse(...others: unknown[]): Shell;
    toString(): string;
}
export interface ExtrudeOptions {
    both?: boolean;
    taper?: number;
    direction?: Axis | VectorLike | null;
}
export class Sketch extends Shell {
    get plane(): Plane;
    fuse(...others: unknown[]): Sketch;
    cut(...others: unknown[]): Sketch;
    intersect(...others: unknown[]): Sketch;
    xor(...others: unknown[]): Sketch;
    center(): Vector;
    get perimeter(): number;
    offset(distance: number, options?: {
        corners?: string;
        round?: boolean | null;
    }): Sketch;
    fillet(radius: number, vertices?: Iterable<VectorLike | Vertex> | null): Sketch;
    chamfer(length: number, vertices?: Iterable<VectorLike | Vertex> | null): Sketch;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): this;
    extrude(amount: number, options?: ExtrudeOptions): Part;
    revolve(axis?: Axis | null, angle?: number): Part;
    sweep(path: Edge | Wire, options?: {
        sharpCorners?: boolean | null;
    }): Part;
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
export function Spline(...args: (VectorLike | readonly VectorLike[] | {
    tangents?: readonly [VectorLike | null, VectorLike | null] | null;
    closed?: boolean;
})[]): Edge;
export function Bezier(...args: (VectorLike | readonly VectorLike[] | {
    weights?: readonly number[] | null;
})[]): Edge;
export function Helix(pitch: number, height: number, radius: number, options?: {
    center?: VectorLike;
    direction?: Axis | VectorLike;
    endRadius?: number | null;
    leftHanded?: boolean;
}): Edge;
export function FilletPolyline(...args: (VectorLike | readonly VectorLike[] | {
    radius: number;
    close?: boolean;
})[]): Wire;
export function makeCompatible(...edges: (Edge | Iterable<Edge>)[]): Edge[];
```

### Sketches and text

```ts
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
    ends?: string;
    corners?: string;
}): Sketch;
export function Hull(...items: unknown[]): Sketch;
export function makeFace(outer: Wire | Edge, ...holes: (Wire | Edge)[]): Sketch;
export interface TextOptions {
    font?: string | Uint8Array | null;
    align?: AlignLike;
    spacing?: number;
    lineSpacing?: number;
    kerning?: boolean;
    path?: Edge | Wire | null;
}
export function Text(text: string, size: number, options?: TextOptions): Sketch;
export class FontError extends RangeError {
    constructor(message: string);
}
export const DEFAULT_FONT: Uint8Array;
export function loadFont(source?: string | Uint8Array | null): Font;
export class Font {
    readonly path: string | null;
    readonly name: string;
    readonly unitsPerEm: number;
    readonly numGlyphs: number;
    readonly capHeight: number;
    constructor(source: string | Uint8Array);
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
    align?: AlignLike;
}): Part;
export function Cone(bottomRadius: number, topRadius: number, height: number, options?: {
    align?: AlignLike;
}): Part;
export function Sphere(radius: number, options?: {
    align?: AlignLike;
}): Part;
export function Torus(majorRadius: number, minorRadius: number, options?: {
    align?: AlignLike;
}): Part;
export function Wedge(length: number, width: number, height: number, topLength?: number, options?: {
    align?: AlignLike;
}): Part;
export function Hole(radius: number, depth: number): Part;
export function CounterBoreHole(radius: number, counterBoreRadius: number, counterBoreDepth: number, depth: number): Part;
export function CounterSinkHole(radius: number, counterSinkRadius: number, depth: number, angle?: number): Part;
export class Locations extends Array<Location> {
    constructor(...items: unknown[]);
    mul(other: Location | Locations): Locations;
    mul<T>(other: Shape | Iterable<T>): ShapeList<Any>;
    moved(location: Location): Locations;
    on(target: unknown): Locations;
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
}
export function extrude(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, amount: number, options?: ExtrudeFunctionOptions): Part | Shell;
export function revolve(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, axis?: Axis | null, angle?: number): Part | Shell;
export function loft(sections: readonly unknown[], options?: {
    ruled?: boolean;
    smooth?: boolean;
}): Part | Shell;
export interface SweepOptions {
    orient?: boolean;
    translational?: boolean;
    sharpCorners?: boolean | null;
}
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part | Shell;
export function fillet(edges: unknown, radius: FilletRadius, options?: FilletOptions): Part | Sketch;
export function chamfer(edges: unknown, length: number): Part | Sketch;
export function shell(part: Part, thickness: number, openings?: unknown, options?: {
    outward?: boolean;
}): Part;
export function offset(shape: Part | Sketch, distance: number, options?: {
    corners?: string;
    round?: boolean | null;
}): Part | Sketch;
export function mirror<S extends Shape>(shape: S, plane?: Plane | Face | Axis | ShapeList<Face>): S;
export function split(part: Part, plane: Plane | Face, keep?: 'above' | 'below' | 'both'): Part | [Part, Part];
export function merge(...parts: (Part | Iterable<Part>)[]): Part;
export function section(part: Part, plane?: Plane | Face): Sketch;
export function thicken(surface: Shell | Face, thickness: number): Part;
export let GUARD_SECONDS: number;
export function setGuardSeconds(seconds: number): number;
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
export interface TaperOptions extends RangeOptions {
    axis?: Axis;
}
export function taper(shape: Part, scale: number, options?: TaperOptions): Part;
export function taper(shape: Shell, scale: number, options?: TaperOptions): Shell;
export interface BendOptions extends RangeOptions {
    radius?: number | null;
    plane?: Plane;
}
export function bend(shape: Part, angle: number, options?: BendOptions): Part;
export function bend(shape: Shell, angle: number, options?: BendOptions): Shell;
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
    toString(): string;
}
```

### Surfaces

```ts
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options?: {
    interpolate?: boolean;
    controls?: number | readonly [number, number] | null;
    smoothing?: number;
}): Shell;
export function ruled(a: Edge | Wire, b: Edge | Wire): Shell;
export function stitch(...args: (Shell | Face | Part | Iterable<unknown> | {
    tolerance?: number | null;
})[]): Part | Shell;
export function surfaceFillet(a: Face | Shell, b: Face | Shell, radius: number, options?: {
    sides?: readonly [number, number];
}): Shell;
```

### Sheet metal

```ts
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
    readonly kFactor: number;
    constructor(part: Part, outline: Sketch, bends: Bend[], thickness: number, kFactor: number);
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
    kFactor?: number;
    fixed?: Face | null;
}
export function unfold(part: Part, options?: UnfoldOptions): Part;
export function flatPattern(part: Part, options?: UnfoldOptions): FlatPattern;
```

### Meshes

```ts
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
    moved(location: Location): Mesh;
    translate(x?: number | VectorLike, y?: number, z?: number): Mesh;
    rotate(axis?: Axis, angle?: number): Mesh;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): Mesh;
    scale(factor: number | VectorLike, center?: VectorLike): Mesh;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit[];
    isClosed(): boolean;
    fuse(other: Mesh): Mesh;
    cut(other: Mesh): Mesh;
    intersect(other: Mesh): Mesh;
    export(path: string, options?: Record<string, unknown>): void;
    toString(): string;
}
export function tessellate(shape: Shape | Iterable<Shape>, tolerance?: number | null, angle?: number): Mesh;
```

### Files

```ts
export function exportFile(shapes: unknown, path: string, options?: Record<string, Any>): void;
export interface StepExportOptions {
    unit?: string;
    name?: string | null;
    assembly?: boolean;
}
export function exportStep(shapes: unknown, path: string, options?: StepExportOptions): void;
export function toStep(shapes: unknown, options?: StepExportOptions): string;
export interface MeshOptions {
    tolerance?: number | null;
    angle?: number;
}
export function toStl(shapes: unknown, options?: MeshOptions & {
    ascii?: boolean;
}): Uint8Array;
export function exportStl(shapes: unknown, path: string, options?: MeshOptions & {
    ascii?: boolean;
}): void;
export function importStl(path: string): Mesh;
export function fromStl(data: string | Uint8Array): Mesh;
export function toObj(shapes: unknown, options?: MeshOptions): string;
export function exportObj(shapes: unknown, path: string, options?: MeshOptions): void;
export interface GltfOptions extends MeshOptions {
    edges?: boolean;
    edgeColor?: Any;
}
export function toGlb(shapes: unknown, options?: GltfOptions): Uint8Array;
export function exportGlb(shapes: unknown, path: string, options?: GltfOptions): void;
export function toGltf(shapes: unknown, options?: GltfOptions): string;
export function exportGltf(shapes: unknown, path: string, options?: GltfOptions): void;
export function toSmb(shapes: unknown, options?: {
    ascii?: boolean;
}): Uint8Array;
export function fromSmb(data: string | Uint8Array): Part | Shell;
export function save(shapes: unknown, path: string, options?: {
    ascii?: boolean;
}): void;
export function load(path: string): Any;
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
export function fromStepModel(data: string | Uint8Array, options?: {
    heal?: boolean;
    strict?: boolean;
}): StepModel;
export function readStep(path: string, options?: {
    heal?: boolean;
    strict?: boolean;
}): StepModel;
export function fromStep(data: string | Uint8Array, options?: {
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
export function fromIges(data: string | Uint8Array, options?: IgesImportOptions): Part | Shell | ShapeList<Part | Shell>;
export function importIges(path: string, options?: IgesImportOptions): Part | Shell | ShapeList<Part | Shell>;
export interface DxfReadOptions {
    layers?: Iterable<string> | string | null;
    unit?: string | null;
    tolerance?: number | null;
}
export interface DxfWriteOptions {
    unit?: string;
    plane?: Plane | null;
}
export function importDxfWires(path: string, options?: DxfReadOptions): ShapeList<Wire>;
export function fromDxfWires(data: string | Uint8Array, options?: DxfReadOptions): ShapeList<Wire>;
export function importDxf(path: string, options?: DxfReadOptions): Sketch;
export function fromDxf(data: string | Uint8Array, options?: DxfReadOptions): Sketch;
export function exportDxf(shapes: unknown, path: string, options?: DxfWriteOptions): void;
export function toDxf(shapes: unknown, options?: DxfWriteOptions): string;
export interface UsdExportOptions {
    mesh?: boolean;
    tolerance?: number | null;
    angle?: number;
}
export function toUsd(shapes: unknown, options?: UsdExportOptions): string;
export function exportUsd(shapes: unknown, path: string, options?: UsdExportOptions): void;
export interface UsdImportOptions {
    heal?: boolean;
    units?: string | null;
    placement?: boolean;
    check?: boolean;
    partial?: boolean;
}
export interface UsdReadOptions extends UsdImportOptions {
    resolve?: ((asset: string, from: string) => string | Uint8Array | null | undefined) | null;
}
export function fromUsd(data: string | Uint8Array, options?: UsdReadOptions): Part | Shell | ShapeList<Part | Shell>;
export function importUsd(path: string, options?: UsdImportOptions): Part | Shell | ShapeList<Part | Shell>;
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
    constructor(data: Uint8Array, image?: _RGBImage | null, frame?: Frame | null);
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
export interface RenderOptions {
    path?: string | null;
    view?: unknown;
    size?: readonly [number, number];
    edges?: boolean;
    background?: string | readonly number[];
    tolerance?: number | null;
    zoom?: number;
    lookAt?: unknown;
    frame?: Frame | Picture | Record<string, number> | readonly number[] | null;
    supersample?: number;
    colors?: string;
    lines?: boolean;
    drawing?: unknown;
    sheet?: unknown;
    section?: unknown;
    cap?: boolean;
    highlight?: unknown;
    highlightAt?: unknown;
    markers?: unknown;
    annotate?: boolean;
    xray?: boolean;
    xrayAlpha?: number;
    zebra?: unknown;
    curvature?: unknown;
}
export function render(...args: unknown[]): Picture;
export function diffImages(a: unknown, b: unknown, tolerance?: number): ImageDiff;
export interface PageOptions {
    title?: string;
    tolerance?: number | null;
    angle?: number;
    edges?: boolean;
    view?: readonly [number, number, number];
    margin?: number;
}
export function htmlPage(...args: unknown[]): string;
export interface ShowOptions {
    title?: string;
    path?: string | null;
    openBrowser?: boolean;
    tolerance?: number | null;
    angle?: number;
    edges?: boolean;
}
export function show(...args: unknown[]): string;
```

### Errors

```ts
export class ModelingError extends Error {
    constructor(message: string);
}
export class KernelError extends ModelingError {
    readonly operation: string;
    readonly status: string | null;
    readonly detail: string;
    readonly hint: string | null;
    constructor(operation: string, detail: string, status?: string | null, hint?: string | null);
}
export function setWarningHandler(handler: (message: string) => void): void;
```
