// Functions that run in a worker (the package's entry `@classcad/smlibpy-three/worker`): a Web
// Worker or a Node worker thread with a kernel of its own, so that the page goes on while the kernel
// works, and a call that takes too long can be stopped. The functions are plain smlibpy-three, in a
// module of their own; they take and return the package's objects, which cross in both directions:
//
//     // models.js
//     import { Box, Cylinder, GridLocations, Z } from '@classcad/smlibpy-three'
//     export function plate(width) {
//       const box = new Box(width, 60, 10) // a plate in the XY plane, 10 thick
//       const pin = new Cylinder(3, 3, 20)
//       pin.rotation.x = Math.PI / 2 // along z, through the plate
//       return box.fillet(box.edges().parallelTo(Z), 6).cut(pin.at(GridLocations(width - 20, 40, 2, 2)))
//     }
//     export const round = (part, edge, radius) => part.fillet(edge, radius)
//
//     // cad.worker.js: the whole worker
//     import { expose } from '@classcad/smlibpy-three/worker'
//     expose(() => import('./models.js'))
//
//     // main.js
//     import { KernelWorker } from '@classcad/smlibpy-three/worker'
//     const cad = new KernelWorker(() => new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' }), { timeout: 30_000 })
//     let part = await cad.functions.plate(80) // a Part, made in the worker
//     scene.add(part)
//     const [hit] = raycaster.intersectObject(part.edgeLines)
//     part = await cad.functions.round(part, hit.brep, 2) // the edge picked here, rounded there
//
// What crosses, each body of a call once, also where it appears several times:
// - Bodies (Part, Shell, Sketch) as their exact kernel bodies, with what three needs of the object:
//   its transform, name, uuid, visibility, shadow, culling, render order and layers, its user data
//   (as JSON, as three copies it), its tessellation settings and whether its edge lines show. Going
//   to the worker, a body is there where it is here in the world: a stand-in parent (a THREE.Group)
//   stands where its parent is, so operands placed in groups cut where they do here. Coming back,
//   a body brings the tessellation three draws of it, made in the worker: the calling thread only
//   uploads it. Bodies arrive as Part, Shell or Sketch (a Box as a Part), without children.
// - Materials stay on their thread (they hold textures and the renderer's state): a body or curve
//   crosses with its material's color and name, and over there has a material of that color, which
//   stands for this thread's. What comes back with such a material (the body itself, its clone, the
//   result of an operation called on it, which shares its receiver's material as it does here) has
//   this thread's material again, the same object; anything else has the package's own material, in
//   the color of the one it had.
// - Faces, edges and vertices of bodies as their body and their place in it: the edge picked here
//   is the same edge of the same body there. A body's wires and edge lines as well.
// - Curves of their own (BrepEdge, Wire, Segment, Spline, ...) as their exact kernel curves, with their
//   transform; vertices of their own as their point. They arrive as BrepEdge, Wire and BrepVertex.
// - Triangle meshes (TriangleMesh) as their triangles, which the receiving thread takes over
//   without a copy (the sender keeps its own), with their transform and material as bodies have.
// - THREE.Group and THREE.Object3D with their children; ShapeLists, arrays, plain objects, Maps and
//   Sets item by item; THREE.BufferGeometry with its attributes; three's Vector2, Vector3, Vector4,
//   Quaternion, Euler, Matrix3, Matrix4, Color, Plane, Ray, Box2, Box3, Sphere and Line3 as their
//   numbers; numbers, strings, booleans, null, undefined, typed arrays and Dates as themselves.
// Anything else (a THREE.Mesh, a function, a record such as MassProperties) is a TypeError: return
// what it holds instead.
//
// Errors arrive as they were thrown, the package's ModelingError and KernelError (with operation,
// status, hint and trace) as such. The transport is smlibwasm's (KernelWorker, expose): one call at a
// time, timeouts and AbortSignals that end the call with its worker, a new worker for the call after
// one that timed out, crashed the kernel or ran it out of memory. This module converts what crosses
// at both ends. It does not load the kernel: on the calling thread the package (and its kernel)
// loads only when a body, curve or sub-shape comes back; a page whose worker returns plain data, a
// file or a BufferGeometry never loads it.
import * as THREE from 'three'
import { KernelWorker as Transport, expose as exposeTransport } from '@classcad/smlibwasm/worker'
import { FontError, KernelError, ModelingError } from './errors.ts'
import type { TriangleMesh } from './mesh.ts'
import type { Body, BrepEdge, EdgeLines, BrepFace, Part, ShapeList, Shell, Sketch, BrepVertex, Wire } from './shapes.ts'
import type { TessellationData } from './tessellation.ts'

// biome-ignore lint: the functions of a worker take and return anything
type Any = any

/** The names of the functions of `M` (a worker's module). */
export type FunctionName<M> = { [K in keyof M]: M[K] extends (...args: Any[]) => unknown ? K : never }[keyof M] & string

type Primitive = string | number | boolean | bigint | symbol | null | undefined
type ThreeValue =
  | THREE.Vector2
  | THREE.Vector3
  | THREE.Vector4
  | THREE.Quaternion
  | THREE.Euler
  | THREE.Matrix3
  | THREE.Matrix4
  | THREE.Color
  | THREE.Plane
  | THREE.Ray
  | THREE.Box2
  | THREE.Box3
  | THREE.Sphere
  | THREE.Line3

/**
 * What a value of type `T` is once it has crossed to or from a worker: bodies as Part, Shell or
 * Sketch and curves as BrepEdge or Wire (the classes of the package's results: a Box arrives as a Part,
 * a Segment as a BrepEdge), groups as THREE.Group or THREE.Object3D, lists, arrays and plain objects item
 * by item, the rest as it is (functions do not cross).
 */
export type Crossed<T> =
  0 extends 1 & T ? Any :
  T extends Primitive | Date | RegExp | ArrayBuffer | ArrayBufferView | ThreeValue ? T :
  T extends Sketch ? Sketch :
  T extends Part ? Part :
  T extends Shell ? Shell :
  T extends Wire ? Wire :
  T extends BrepEdge ? BrepEdge :
  T extends BrepFace ? BrepFace :
  T extends BrepVertex ? BrepVertex :
  T extends EdgeLines ? EdgeLines :
  T extends TriangleMesh ? TriangleMesh :
  T extends ShapeList<infer U> ? ShapeList<Crossed<U>> :
  T extends THREE.Group ? THREE.Group :
  T extends THREE.Object3D ? THREE.Object3D :
  T extends THREE.BufferGeometry ? THREE.BufferGeometry :
  T extends ReadonlyMap<infer K, infer V> ? Map<Crossed<K>, Crossed<V>> :
  T extends ReadonlySet<infer U> ? Set<Crossed<U>> :
  T extends readonly unknown[] ? { -readonly [K in keyof T]: Crossed<T[K]> } :
  T extends (...args: never[]) => unknown ? never :
  { [K in keyof T]: Crossed<T[K]> }

/** The functions of `M` as the calling thread calls them: each returns a promise of what the
 * function returns in the worker, as it arrives (`Crossed`). */
export type Remote<M> = {
  readonly [K in FunctionName<M>]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Crossed<Awaited<R>>> : never
}

/** A worker as `KernelWorker` takes it: a Web Worker, or a Node `worker_threads` Worker. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  terminate(): unknown
}

/** The options of a `KernelWorker`. */
export interface KernelWorkerOptions {
  /** Milliseconds a call may run before its worker is terminated (default: no limit); a call's own
   * `timeout` takes its place. */
  timeout?: number
  /** Milliseconds a new worker may take to load its kernel and its functions (default 60000). */
  startTimeout?: number
}

/** The options of one call (`KernelWorker.call`). */
export interface CallOptions {
  /** Milliseconds the call may run in the worker before the worker is terminated (default: the
   * KernelWorker's `timeout`). The time it waits for the calls before it, or for a new worker to
   * start, does not count. */
  timeout?: number
  /** Ends the call when it fires: a call that waits is dropped, one that runs ends with its worker. */
  signal?: AbortSignal
}

/** The key that marks what is no plain data in a message (a body, a curve, three's values), and
 * the message itself. */
const TAG = '$smlibpy-three'

// ================================================================================ the calling side
/**
 * The functions a worker exposes (`expose`), called from this thread: they take and return the
 * package's objects and three's values (see the module's comment for what crosses).
 *
 * `worker` makes the worker: a function that returns a new Web Worker or Node `worker_threads`
 * Worker (written as `new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' })`
 * where it is called, bundlers find and bundle the worker's module), or the URL of the worker's
 * module, of which `KernelWorker` makes a module worker itself (in Node: a worker thread). The
 * worker starts with the first call (or `start()`), and again after one was terminated; an idle
 * worker does not keep Node running.
 *
 * Calls run one at a time, in the order they were made; each resolves to what the function
 * returned in the worker, or rejects with what it threw: ModelingError and KernelError (the
 * package's, with operation, status, hint and trace), TypeError and RangeError as such, other errors
 * as an Error of their name. A call that runs longer than its timeout rejects with a `TimeoutError`
 * (DOMException), one whose signal fires with the signal's reason; both terminate the worker
 * (nothing else stops a kernel that is at work), and the calls after them run in a new one. So does
 * the call after one whose kernel crashed or ran out of memory, so every call finds a sound kernel.
 */
export class KernelWorker<M extends object = Record<string, (...args: Any[]) => unknown>> {
  readonly #transport: Transport<Record<string, (packet: Packet) => Packet>>
  /** Settles once the call made last went to the transport (calls go there in the order made). */
  #turn: Promise<void> = Promise.resolve()
  /** Calls that are made but not yet with the transport (their values are being converted). */
  #converting = 0
  /** Counts terminate()s: a call made before one does not start a new worker. */
  #generation = 0
  #remote: Remote<M> | null = null

  constructor(worker: URL | string | (() => WorkerLike), options: KernelWorkerOptions = {}) {
    this.#transport = new Transport(worker, options)
  }

  /**
   * Calls the worker's function `name` with `args`; resolves to what it returns, as it arrives
   * (bodies as Part, Shell or Sketch, curves as BrepEdge or Wire: `Crossed`). Bodies, curves, faces,
   * edges and vertices of bodies, groups, three's values and plain data cross in both directions
   * (see the module's comment); other objects are a TypeError.
   */
  async call<K extends FunctionName<M>>(
    name: K,
    args: M[K] extends (...a: infer A) => unknown ? A : never = [] as Any,
    options: CallOptions = {},
  ): Promise<M[K] extends (...a: Any[]) => infer R ? Crossed<Awaited<R>> : never> {
    if (typeof name !== 'string') throw new TypeError(`KernelWorker.call: the name of a function, not ${typeof name}`)
    if (!Array.isArray(args)) throw new TypeError('KernelWorker.call: the arguments must be an array')
    const generation = this.#generation
    const turn = this.#turn
    let next = () => {}
    this.#turn = new Promise<void>((resolve) => (next = resolve))
    this.#converting++
    const materials = new Materials()
    const answer = (async () => {
      try {
        await turn
        const packet = await pack([...args], materials, true)
        if (generation !== this.#generation) throw new DOMException('the worker was terminated', 'AbortError')
        // (with the transport before the next call converts its values: calls go in the order made)
        return this.#transport.call(name, [packet], options)
      } finally {
        this.#converting--
        next()
      }
    })()
    let result: Packet
    try {
      result = await answer
    } catch (e) {
      throw fromTransport(e)
    }
    return (await unpack(result, materials, false)) as Any
  }

  /** The worker's functions as functions of this thread: `functions.plate(80)` is
   * `call('plate', [80])`. */
  get functions(): Remote<M> {
    this.#remote ??= new Proxy({} as Remote<M>, {
      get: (_, name) => (typeof name === 'string' && name !== 'then' ? (...args: unknown[]) => this.call(name as Any, args as Any) : undefined),
    })
    return this.#remote
  }

  /** Starts the worker now (it starts with the first call otherwise); resolves once it has loaded
   * its kernel and functions, to their names. */
  start(): Promise<string[]> {
    return this.#transport.start()
  }

  /** The calls that wait or run. */
  get pending(): number {
    return this.#converting + this.#transport.pending
  }

  /** Terminates the worker, whatever it is doing; the calls that wait or run reject with an
   * `AbortError` (DOMException). The next call starts a new worker. */
  terminate(): void {
    this.#generation++
    this.#transport.terminate()
  }

  [Symbol.dispose](): void {
    this.terminate()
  }
}

/** An error of the transport as the package's: smlibwasm's ModelingError and KernelError (which the
 * worker made of the package's, see `toTransport`) as the package's ModelingError and KernelError, a
 * RangeError named FontError as its FontError. */
function fromTransport(e: unknown): unknown {
  if (!(e instanceof Error)) return e
  let out: Error
  if (e.name === 'KernelError') {
    const x = e as Error & { operation?: unknown; status?: unknown; hint?: unknown; detail?: unknown; trace?: unknown }
    // (the worker sent the package's message as the detail: smlibwasm makes the message anew)
    out = new KernelError(typeof x.detail === 'string' && x.detail !== '' ? x.detail : e.message, {
      operation: String(x.operation ?? ''),
      status: typeof x.status === 'string' ? x.status : null,
      hint: typeof x.hint === 'string' ? x.hint : null,
      trace: Array.isArray(x.trace) ? x.trace.map(String) : [],
    })
  } else if (e.name === 'ModelingError') out = new ModelingError(e.message)
  else if (e.name === 'FontError' && e instanceof RangeError) out = new FontError(e.message)
  else return e
  // (with the worker's stack, which the transport added to the error's)
  if (e.stack) out.stack = e.stack
  return out
}

// ================================================================================ the worker's side
/**
 * Answers the calls of a `KernelWorker` in this worker (a Web Worker or a Node worker thread) with
 * `functions`: an object of functions, or a function that loads them, such as
 * `() => import('./models.js')` (a module's exported functions). The functions take and return the
 * package's objects, and may return a promise.
 *
 * The worker listens for calls at once and answers them once the functions have loaded: a module
 * worker can only be sure to see the messages that come while it loads when it listens before it
 * waits.
 */
export function expose(functions: object | (() => object | Promise<object>)): void {
  exposeTransport(async () => {
    const loaded: unknown = typeof functions === 'function' ? await (functions as () => unknown)() : functions
    if (loaded === null || typeof loaded !== 'object') {
      throw new TypeError(`expose(): the functions must be an object (a module), not ${loaded === null ? 'null' : typeof loaded}`)
    }
    const table: Record<string, (packet: Packet) => Promise<Packet>> = {}
    for (const key of Object.keys(loaded)) {
      const fn = (loaded as Record<string, unknown>)[key]
      if (typeof fn === 'function') table[key] = (packet) => run(loaded, fn as (...args: unknown[]) => unknown, packet)
    }
    return table
  })
}

/** One call in the worker: its arguments as the package's objects, the function, its result as a
 * message. */
async function run(owner: object, fn: (...args: unknown[]) => unknown, packet: Packet): Promise<Packet> {
  const materials = new Materials()
  try {
    const args = (await unpack(packet, materials, true)) as unknown[]
    const result = await fn.apply(owner, args)
    return await pack(result, materials, false)
  } catch (e) {
    throw await toTransport(e)
  }
}

/** An error thrown in the worker as smlibwasm's transport carries it with its class and fields: the
 * package's ModelingError and KernelError as smlibwasm's (KernelError's message as its detail, which
 * it keeps; it makes the message anew), whose crash and out-of-memory errors also start a new worker
 * for the next call. */
async function toTransport(e: unknown): Promise<unknown> {
  // (the package's errors, and smlibwasm's own where one got this far, which the package translates)
  if (!(e instanceof ModelingError) && loading === null) return e
  const pkg = await load()
  const x = pkg.translate(e)
  if (x instanceof KernelError) {
    const out = new pkg.sm.KernelError(x.operation, x.message, x.status, x.hint)
    ;(out as { trace: readonly string[] }).trace = Object.freeze([...x.trace])
    if (x.stack) out.stack = x.stack
    return out
  }
  if (x instanceof ModelingError) {
    const out = new pkg.sm.ModelingError(x.message)
    if (x.stack) out.stack = x.stack
    return out
  }
  return x
}

// ================================================================================ the package
type Shapes = typeof import('./shapes.ts')
type Kernel = typeof import('./kernel.ts')
type Meshes = typeof import('./mesh.ts')
/** What this module uses of the package, which it loads (with the kernel) only when a value needs it. */
type Package = Pick<Shapes, 'Body' | 'BrepEdge' | 'EdgeLines' | 'BrepFace' | 'ShapeList' | 'BrepVertex' | 'Wire' | 'curveOf' | 'drawnData' | 'kernelOf' | 'kernelOfShape' | 'takeDrawn' | 'wrap'> &
  Pick<Kernel, 'call' | 'sm' | 'translate'> &
  Pick<Meshes, 'TriangleMesh' | 'kernelMesh'>

let loading: Promise<Package> | null = null

function load(): Promise<Package> {
  loading ??= Promise.all([import('./shapes.ts'), import('./kernel.ts'), import('./mesh.ts')]).then(([s, k, m]) => ({
    Body: s.Body,
    BrepEdge: s.BrepEdge,
    EdgeLines: s.EdgeLines,
    BrepFace: s.BrepFace,
    ShapeList: s.ShapeList,
    BrepVertex: s.BrepVertex,
    Wire: s.Wire,
    curveOf: s.curveOf,
    drawnData: s.drawnData,
    kernelOf: s.kernelOf,
    kernelOfShape: s.kernelOfShape,
    takeDrawn: s.takeDrawn,
    wrap: s.wrap,
    call: k.call,
    sm: k.sm,
    translate: k.translate,
    TriangleMesh: m.TriangleMesh,
    kernelMesh: m.kernelMesh,
  }))
  return loading
}

/** Whether `value` holds an object of the package, which only the package can convert (a body, a
 * curve, a sub-shape, a triangle mesh, a list of them). */
function needsPackage(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const v = value as Record<string, unknown>
  if (v.isBody === true || v.isBrepFace === true || v.isBrepEdge === true || v.isWire === true || v.isBrepVertex === true || v.isEdgeLines === true || v.isTriangleMesh === true) return true
  if (Array.isArray(value)) return Object.getPrototypeOf(value) !== Array.prototype || value.some((x) => needsPackage(x, seen))
  if (value instanceof Map) return [...value].some(([k, x]) => needsPackage(k, seen) || needsPackage(x, seen))
  if (value instanceof Set) return [...value].some((x) => needsPackage(x, seen))
  if (v.isObject3D === true) return (value as THREE.Object3D).children.some((c) => needsPackage(c, seen))
  if (isPlain(value)) return Object.values(value).some((x) => needsPackage(x, seen))
  return false
}

// ================================================================================ messages
/** A body as it crosses (in a call's table of bodies, which values refer to by place). */
interface BodyRecord {
  /** The kernel body: smlibwasm's transport sends it as the contents of an .smb file (exact). */
  value: unknown
  object: ObjectRecord
  /** Its parent's place in the message's `parents` (going to the worker), else -1. */
  parent: number
  tolerance: number | null
  angle: number
  /** Whether its edge lines show. */
  lines: boolean
  material: MaterialRecord | null
  lineMaterial: MaterialRecord | null
  /** Coming from the worker: the tessellation three draws of it, made there (null: none). */
  drawn: TessellationData | null
}

/** What three needs of an Object3D, as three's toJSON keeps it (without its geometry, material and
 * children). */
interface ObjectRecord {
  uuid: string
  name: string
  position: number[]
  quaternion: number[]
  scale: number[]
  order: string
  matrix: number[]
  matrixAutoUpdate: boolean
  matrixWorldAutoUpdate: boolean
  up: number[]
  visible: boolean
  castShadow: boolean
  receiveShadow: boolean
  frustumCulled: boolean
  renderOrder: number
  layers: number
  userData: unknown
}

/** A material (or each of an array of them) as it crosses: its place in the call's materials if it
 * stands for one of them, its color (three's working color space) and name. */
interface MaterialRecord {
  array: boolean
  items: { ref: number | null; color: number[] | null; name: string }[]
}

/** A call's arguments or result as a message: `value`, the bodies it refers to by place, and the
 * world matrices of the parents of what goes to the worker. */
interface Packet {
  [TAG]: 'packet'
  value: unknown
  bodies: BodyRecord[]
  parents: number[][]
  /** Whether reading it needs the package (and its kernel). */
  package: boolean
}

/**
 * The materials of one call, by place: on the calling thread those of the bodies and curves that
 * went to the worker (results that come back with their stand-ins get them again), in the worker
 * the stand-ins made for them.
 */
class Materials {
  readonly list: (THREE.Material | undefined)[] = []
  readonly places = new Map<THREE.Material, number>()
}

/** `value` as a message. `toWorker`: from the calling thread (its materials get places, its
 * objects' parents go along). */
async function pack(value: unknown, materials: Materials, toWorker: boolean): Promise<Packet> {
  const pkg = needsPackage(value) ? await load() : null
  const packer = new Packer(pkg, materials, toWorker)
  const out = packer.value(value, true)
  return { [TAG]: 'packet', value: out, bodies: packer.bodies, parents: packer.parents, package: packer.usesPackage }
}

class Packer {
  readonly bodies: BodyRecord[] = []
  readonly parents: number[][] = []
  usesPackage = false
  readonly #pkg: Package | null
  readonly #materials: Materials
  readonly #toWorker: boolean
  readonly #places = new Map<object, number>()
  readonly #parentPlaces = new Map<object, number>()
  readonly #seen = new Set<object>()

  constructor(pkg: Package | null, materials: Materials, toWorker: boolean) {
    this.#pkg = pkg
    this.#materials = materials
    this.#toWorker = toWorker
  }

  /** `v` as plain data and kernel values. `top`: not a child of an object that crosses too. */
  value(v: unknown, top: boolean): unknown {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function' || typeof v === 'symbol') throw new TypeError(`a ${typeof v} cannot go to or come from a worker`)
      return v
    }
    if (this.#seen.has(v)) throw new TypeError('a value that contains itself cannot go to or come from a worker')
    this.#seen.add(v)
    try {
      return this.#value(v as Record<string, unknown>, top)
    } finally {
      this.#seen.delete(v)
    }
  }

  #value(v: Record<string, unknown>, top: boolean): unknown {
    const pkg = this.#pkg
    // the package's objects (by their flags first: a BrepVertex has x, y and z too)
    if (pkg !== null) {
      if (v.isBody === true) return { [TAG]: 'Body', body: this.#body(v as unknown as Body) }
      if (v.isBrepFace === true || v.isBrepVertex === true || v.isBrepEdge === true) {
        const shape = v as unknown as BrepFace | BrepEdge | BrepVertex
        if (shape.owner !== null && shape.index >= 0) return { [TAG]: v.isBrepFace === true ? 'BrepFace' : v.isBrepEdge === true ? 'BrepEdge' : 'BrepVertex', body: this.#body(shape.owner), index: shape.index }
        if (shape.owner !== null && v.isBrepEdge === true) {
          // (a seam: its place among its body's edges with the seams)
          const index = shape.owner.edges({ seams: true }).indexOf(shape as BrepEdge)
          if (index >= 0) return { [TAG]: 'BrepEdge', body: this.#body(shape.owner), index, seams: true }
        }
        if (v.isBrepVertex === true) return this.#point(v as unknown as BrepVertex, top)
      }
      if (v.isBrepEdge === true || v.isWire === true) return this.#curve(v as unknown as BrepEdge | Wire, top)
      if (v.isEdgeLines === true) {
        const body = (v as unknown as EdgeLines).body
        if (body === null) throw new TypeError('edge lines of no body cannot go to or come from a worker')
        return { [TAG]: 'EdgeLines', body: this.#body(body) }
      }
      if (v.isTriangleMesh === true) {
        const mesh = v as unknown as TriangleMesh
        this.usesPackage = true
        // (the kernel's mesh: smlibwasm's transport sends its arrays, which the receiving thread takes over)
        return { [TAG]: 'TriangleMesh', mesh: pkg.kernelMesh(mesh), object: objectRecord(mesh), parent: top ? this.#parent(mesh) : -1, material: this.#material(mesh.material) }
      }
      if (v instanceof pkg.ShapeList) {
        this.usesPackage = true
        return { [TAG]: 'ShapeList', items: Array.from(v as unknown as unknown[], (x) => this.value(x, top)) }
      }
    }
    // three's
    if (v.isObject3D === true) {
      const o = v as unknown as THREE.Object3D
      if (o.type !== 'Object3D' && (v as { isGroup?: boolean }).isGroup !== true) throw new TypeError(`${typeName(o)} cannot go to or come from a worker: ${WHAT}`)
      return { [TAG]: o.type === 'Object3D' ? 'Object3D' : 'Group', object: objectRecord(o), parent: top ? this.#parent(o) : -1, children: o.children.map((c) => this.value(c, false)) }
    }
    if (v.isBufferGeometry === true) return geometryRecord(v as unknown as THREE.BufferGeometry)
    for (const [name, is, data] of MATH) if (is(v)) return { [TAG]: name, data: data(v as Any) }
    // plain data
    if (passes(v)) return v
    if (Array.isArray(v)) return Array.from(v, (x) => this.value(x, top))
    if (v instanceof Map) return { [TAG]: 'Map', entries: Array.from(v, ([key, x]) => [this.value(key, top), this.value(x, top)]) }
    if (v instanceof Set) return { [TAG]: 'Set', items: Array.from(v, (x) => this.value(x, top)) }
    if (isPlain(v)) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(v)) out[key] = this.value(v[key], top)
      return TAG in v ? { [TAG]: 'Object', entries: out } : out
    }
    throw new TypeError(`${typeName(v)} cannot go to or come from a worker: ${WHAT}`)
  }

  /** The place of a body in the message's table of bodies (added once). */
  #body(b: Body): number {
    const pkg = this.#pkg as Package
    let at = this.#places.get(b)
    if (at !== undefined) return at
    this.usesPackage = true
    const record: BodyRecord = {
      value: pkg.kernelOf(b),
      object: objectRecord(b),
      parent: this.#parent(b),
      tolerance: b.tolerance,
      angle: b.angle,
      lines: b.edgeLines.visible,
      material: this.#material(b.material),
      lineMaterial: this.#material(b.edgeLines.material),
      // (the worker tessellates what it sends back: the calling thread only draws it)
      drawn: this.#toWorker ? null : pkg.drawnData(b),
    }
    at = this.bodies.push(record) - 1
    this.#places.set(b, at)
    return at
  }

  /** An edge or wire: a body's wire (its edges are the body's), a curve in a body's frame (the curves
   * where a plane cuts it), or a curve of its own. */
  #curve(c: BrepEdge | Wire, top: boolean): unknown {
    const pkg = this.#pkg as Package
    this.usesPackage = true
    const value = pkg.kernelOfShape(c)
    const owner = c.owner
    if (owner !== null && c instanceof pkg.Wire) return { [TAG]: 'Wire', body: this.#body(owner), wire: value }
    const smp = pkg.call(() => pkg.sm.toSmp(value as never, { ascii: false }))
    if (owner !== null) return { [TAG]: 'Curve', smp, owner: this.#body(owner), object: null, parent: -1, material: null }
    return { [TAG]: 'Curve', smp, owner: -1, object: objectRecord(c), parent: top ? this.#parent(c) : -1, material: this.#material(c.material as THREE.Material) }
  }

  /** A vertex of its own: its point. */
  #point(v: BrepVertex, top: boolean): unknown {
    this.usesPackage = true
    return { [TAG]: 'Point', point: v.point.toArray(), object: objectRecord(v), parent: top ? this.#parent(v) : -1, material: this.#material(v.material as THREE.Material) }
  }

  /** Going to the worker: the place of `o`'s parent in the message's `parents`, where it is not at
   * the world's origin; else -1. */
  #parent(o: THREE.Object3D): number {
    const p = o.parent
    if (!this.#toWorker || p === null) return -1
    let at = this.#parentPlaces.get(p)
    if (at === undefined) {
      p.updateWorldMatrix(true, false)
      at = p.matrixWorld.equals(IDENTITY) ? -1 : this.parents.push(p.matrixWorld.toArray()) - 1
      this.#parentPlaces.set(p, at)
    }
    return at
  }

  #material(material: THREE.Material | THREE.Material[] | null | undefined): MaterialRecord | null {
    if (material == null) return null
    const list = Array.isArray(material) ? material : [material]
    const items = list.map((m) => {
      let ref = this.#materials.places.get(m) ?? null
      if (ref === null && this.#toWorker) {
        ref = this.#materials.list.push(m) - 1
        this.#materials.places.set(m, ref)
      }
      const color = (m as { color?: THREE.Color }).color
      return { ref, color: color?.isColor === true ? [color.r, color.g, color.b] : null, name: typeof m.name === 'string' ? m.name : '' }
    })
    return { array: Array.isArray(material), items }
  }
}

const IDENTITY = new THREE.Matrix4()
const WHAT = 'give bodies, curves, faces, edges and vertices of bodies, groups, geometries, three\'s math values or plain data'

/** The value of a message (from `pack`). `inWorker`: read by the worker (materials get stand-ins,
 * bodies stand-in parents). */
async function unpack(packet: unknown, materials: Materials, inWorker: boolean): Promise<unknown> {
  const p = packet as Packet | null
  if (p === null || typeof p !== 'object' || p[TAG] !== 'packet') {
    throw new TypeError("a message that is not smlibpy-three's: does the worker's module call expose() of '@classcad/smlibpy-three/worker'?")
  }
  const pkg = p.package ? await load() : null
  return new Unpacker(pkg, materials, inWorker, p).value(p.value)
}

class Unpacker {
  readonly #pkg: Package | null
  readonly #materials: Materials
  readonly #inWorker: boolean
  readonly #parents: THREE.Group[]
  readonly #bodies: (Part | Shell | Sketch)[]

  constructor(pkg: Package | null, materials: Materials, inWorker: boolean, packet: Packet) {
    this.#pkg = pkg
    this.#materials = materials
    this.#inWorker = inWorker
    // (stand-ins where the parents of what came are in the world)
    this.#parents = packet.parents.map((world) => {
      const g = new THREE.Group()
      g.matrixAutoUpdate = false
      g.matrix.fromArray(world)
      // (three updates a world matrix only where it was told to)
      g.matrixWorldNeedsUpdate = true
      return g
    })
    // (a body that came twice, as two objects that share it, is a clone of the first)
    const first = new Map<unknown, Part | Shell | Sketch>()
    this.#bodies = packet.bodies.map((r) => {
      const known = first.get(r.value)
      const b = known !== undefined ? known.clone(false) : (pkg as Package).wrap(r.value as never)
      if (known === undefined) first.set(r.value, b)
      else {
        // (its own materials, not the first's, before it gets those that came with it)
        b.material = null as never
        b.edgeLines.material = null as never
      }
      applyObject(b, r.object)
      b.tolerance = r.tolerance
      b.angle = r.angle
      if (r.drawn !== null) (pkg as Package).takeDrawn(b, r.drawn)
      b.edgeLines.visible = r.lines
      this.#material(b, r.material, 'mesh')
      this.#material(b.edgeLines, r.lineMaterial, 'line')
      this.#place(b, r.parent)
      return b
    })
  }

  value(v: unknown): unknown {
    if (v === null || typeof v !== 'object' || passes(v)) return v
    if (Array.isArray(v)) return v.map((x) => this.value(x))
    const r = v as Record<string, Any>
    const tag = r[TAG]
    if (tag === undefined) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(r)) out[key] = this.value(r[key])
      return out
    }
    for (const [name, , , make] of MATH) if (tag === name) return make(r.data)
    const pkg = this.#pkg as Package
    switch (tag) {
      case 'Object': {
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(r.entries)) out[key] = this.value(r.entries[key])
        return out
      }
      case 'Map':
        return new Map((r.entries as unknown[][]).map(([key, x]) => [this.value(key), this.value(x)]))
      case 'Set':
        return new Set((r.items as unknown[]).map((x) => this.value(x)))
      case 'BufferGeometry':
        return geometryOf(r)
      case 'Group':
      case 'Object3D': {
        const o = tag === 'Group' ? new THREE.Group() : new THREE.Object3D()
        applyObject(o, r.object)
        this.#place(o, r.parent)
        for (const child of r.children as unknown[]) o.add(this.value(child) as THREE.Object3D)
        return o
      }
      case 'Body':
        return this.#bodies[r.body]
      case 'BrepFace':
        return this.#sub(this.#bodies[r.body].faces(), r.index, 'face')
      case 'BrepEdge':
        return this.#sub(this.#bodies[r.body].edges({ seams: r.seams === true }), r.index, 'edge')
      case 'BrepVertex':
        return this.#sub(this.#bodies[r.body].vertices(), r.index, 'vertex')
      case 'EdgeLines':
        return this.#bodies[r.body].edgeLines
      case 'Wire':
        return pkg.curveOf(r.wire, this.#bodies[r.body])
      case 'Curve': {
        const value = pkg.call(() => pkg.sm.fromSmp(r.smp)) as Any
        if (r.owner >= 0) return pkg.curveOf(value, this.#bodies[r.owner])
        const c = pkg.curveOf(value)
        applyObject(c, r.object)
        this.#material(c, r.material, 'line')
        this.#place(c, r.parent)
        return c
      }
      case 'Point': {
        const p = new pkg.BrepVertex(new THREE.Vector3().fromArray(r.point))
        applyObject(p, r.object)
        this.#material(p, r.material, 'points')
        this.#place(p, r.parent)
        return p
      }
      case 'TriangleMesh': {
        // (an empty mesh given the arrays that came, as they are)
        const m = new pkg.TriangleMesh()
        const value = pkg.kernelMesh(m)
        value.vertices = r.mesh.vertices
        value.triangles = r.mesh.triangles
        value.normals = r.mesh.normals
        applyObject(m, r.object)
        this.#material(m, r.material, 'mesh')
        this.#place(m, r.parent)
        return m
      }
      case 'ShapeList':
        return pkg.ShapeList.from((r.items as unknown[]).map((x) => this.value(x)))
      default:
        throw new TypeError(`a message holds a value of an unknown kind (${String(tag)}): are the worker and this thread on the same smlibpy-three?`)
    }
  }

  #sub<T>(list: readonly T[], index: number, what: string): T {
    const x = list[index]
    if (x === undefined) throw new TypeError(`a ${what} that came from the other thread is not in its body here`)
    return x
  }

  /** In the worker: `o` goes to the stand-in of its parent, if it came with one. */
  #place(o: THREE.Object3D, parent: number): void {
    if (this.#inWorker && parent >= 0) this.#parents[parent].add(o)
  }

  /** `o` gets the material of `record`: in the worker a stand-in of its color (one for each of this
   * thread's materials); here this thread's material it stands for, else its own in that color. */
  #material(o: THREE.Object3D & { material: THREE.Material | THREE.Material[] }, record: MaterialRecord | null, kind: 'mesh' | 'line' | 'points'): void {
    if (record === null || !record.items.length) return
    const { list, places } = this.#materials
    if (this.#inWorker) {
      const made = record.items.map((item) => {
        if (item.ref === null) return standIn(item, kind)
        let m = list[item.ref]
        if (m === undefined) {
          m = standIn(item, kind)
          list[item.ref] = m
          places.set(m, item.ref)
        }
        return m
      })
      o.material = record.array ? made : made[0]
      return
    }
    const found = record.items.map((item) => (item.ref === null ? undefined : list[item.ref]))
    if (found.every((m) => m !== undefined)) {
      o.material = record.array ? (found as THREE.Material[]) : (found[0] as THREE.Material)
      return
    }
    const color = record.items[0].color
    const own = o.material
    const target = (Array.isArray(own) ? own[0] : own) as { color?: THREE.Color } | undefined
    if (color !== null && target?.color?.isColor === true) target.color.setRGB(color[0], color[1], color[2])
  }
}

/** A material in the worker that stands for one of the calling thread's: of its color and name. */
function standIn(item: MaterialRecord['items'][number], kind: 'mesh' | 'line' | 'points'): THREE.Material {
  const m = kind === 'mesh' ? new THREE.MeshStandardMaterial() : kind === 'line' ? new THREE.LineBasicMaterial() : new THREE.PointsMaterial()
  m.name = item.name
  if (item.color !== null) m.color.setRGB(item.color[0], item.color[1], item.color[2])
  return m
}

// ================================================================================ three's values
/** three's math values: their name in a message, how to tell them, their numbers, and how to make
 * them of their numbers (Ray and Line3 have no flags: told by their class). */
const MATH: [string, (v: Any) => boolean, (v: Any) => unknown[], (data: Any[]) => object][] = [
  ['Vector2', (v) => v.isVector2 === true, (v) => v.toArray(), (d) => new THREE.Vector2().fromArray(d)],
  ['Vector3', (v) => v.isVector3 === true, (v) => v.toArray(), (d) => new THREE.Vector3().fromArray(d)],
  ['Vector4', (v) => v.isVector4 === true, (v) => v.toArray(), (d) => new THREE.Vector4().fromArray(d)],
  ['Quaternion', (v) => v.isQuaternion === true, (v) => v.toArray(), (d) => new THREE.Quaternion().fromArray(d)],
  ['Euler', (v) => v.isEuler === true, (v) => v.toArray(), (d) => new THREE.Euler().fromArray(d as Any)],
  ['Matrix3', (v) => v.isMatrix3 === true, (v) => v.toArray(), (d) => new THREE.Matrix3().fromArray(d)],
  ['Matrix4', (v) => v.isMatrix4 === true, (v) => v.toArray(), (d) => new THREE.Matrix4().fromArray(d)],
  ['Color', (v) => v.isColor === true, (v) => v.toArray(), (d) => new THREE.Color().fromArray(d)],
  ['Plane', (v) => v.isPlane === true, (v) => [...v.normal.toArray(), v.constant], (d) => new THREE.Plane(new THREE.Vector3(d[0], d[1], d[2]), d[3])],
  ['Ray', (v) => v instanceof THREE.Ray, (v) => [...v.origin.toArray(), ...v.direction.toArray()], (d) => new THREE.Ray(new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(d[3], d[4], d[5]))],
  ['Box2', (v) => v.isBox2 === true, (v) => [...v.min.toArray(), ...v.max.toArray()], (d) => new THREE.Box2(new THREE.Vector2(d[0], d[1]), new THREE.Vector2(d[2], d[3]))],
  ['Box3', (v) => v.isBox3 === true, (v) => [...v.min.toArray(), ...v.max.toArray()], (d) => new THREE.Box3(new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(d[3], d[4], d[5]))],
  ['Sphere', (v) => v.isSphere === true, (v) => [...v.center.toArray(), v.radius], (d) => new THREE.Sphere(new THREE.Vector3(d[0], d[1], d[2]), d[3])],
  ['Line3', (v) => v instanceof THREE.Line3, (v) => [...v.start.toArray(), ...v.end.toArray()], (d) => new THREE.Line3(new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(d[3], d[4], d[5]))],
]

function objectRecord(o: THREE.Object3D): ObjectRecord {
  return {
    uuid: o.uuid,
    name: o.name,
    position: o.position.toArray(),
    quaternion: o.quaternion.toArray(),
    scale: o.scale.toArray(),
    order: o.rotation.order,
    matrix: o.matrix.toArray(),
    matrixAutoUpdate: o.matrixAutoUpdate,
    matrixWorldAutoUpdate: o.matrixWorldAutoUpdate,
    up: o.up.toArray(),
    visible: o.visible,
    castShadow: o.castShadow,
    receiveShadow: o.receiveShadow,
    frustumCulled: o.frustumCulled,
    renderOrder: o.renderOrder,
    layers: o.layers.mask,
    // (as three's copy() takes it)
    userData: JSON.parse(JSON.stringify(o.userData ?? {})),
  }
}

function applyObject(o: THREE.Object3D, r: ObjectRecord): void {
  o.uuid = r.uuid
  o.name = r.name
  o.rotation.order = r.order as THREE.EulerOrder
  o.position.fromArray(r.position)
  o.quaternion.fromArray(r.quaternion)
  o.scale.fromArray(r.scale)
  o.matrix.fromArray(r.matrix)
  o.matrixAutoUpdate = r.matrixAutoUpdate
  o.matrixWorldAutoUpdate = r.matrixWorldAutoUpdate
  o.matrixWorldNeedsUpdate = true
  o.up.fromArray(r.up)
  o.visible = r.visible
  o.castShadow = r.castShadow
  o.receiveShadow = r.receiveShadow
  o.frustumCulled = r.frustumCulled
  o.renderOrder = r.renderOrder
  o.layers.mask = r.layers
  o.userData = r.userData as Record<string, unknown>
}

/** A geometry as plain data: its attributes' arrays (copied as the message goes), index, groups,
 * draw range, bounds, name and user data. */
function geometryRecord(g: THREE.BufferGeometry): unknown {
  const attribute = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, name: string) => {
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) throw new TypeError(`the interleaved attribute '${name}' of a BufferGeometry cannot go to or come from a worker`)
    // (a view of a larger buffer, as a glTF's attributes are, alone: cloning a view copies all its buffer)
    const array = a.array.byteLength === a.array.buffer.byteLength ? a.array : a.array.slice()
    return { array, itemSize: a.itemSize, normalized: a.normalized, name: a.name }
  }
  const morphs = Object.keys(g.morphAttributes)
  if (morphs.length) throw new TypeError(`a BufferGeometry with morph attributes (${morphs.join(', ')}) cannot go to or come from a worker`)
  const index = g.getIndex()
  return {
    [TAG]: 'BufferGeometry',
    name: g.name,
    userData: JSON.parse(JSON.stringify(g.userData ?? {})),
    index: index === null ? null : attribute(index, 'index'),
    attributes: Object.entries(g.attributes).map(([name, a]) => [name, attribute(a, name)]),
    groups: g.groups.map((x) => ({ start: x.start, count: x.count, materialIndex: x.materialIndex })),
    drawRange: { start: g.drawRange.start, count: g.drawRange.count },
    box: g.boundingBox === null ? null : [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray()],
    sphere: g.boundingSphere === null ? null : [...g.boundingSphere.center.toArray(), g.boundingSphere.radius],
  }
}

function geometryOf(r: Record<string, Any>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const attribute = (a: Record<string, Any>) => {
    const out = new THREE.BufferAttribute(a.array, a.itemSize, a.normalized)
    out.name = a.name
    return out
  }
  g.name = r.name
  g.userData = r.userData
  if (r.index !== null) g.setIndex(attribute(r.index))
  for (const [name, a] of r.attributes as [string, Record<string, Any>][]) g.setAttribute(name, attribute(a))
  for (const x of r.groups as { start: number; count: number; materialIndex?: number }[]) g.addGroup(x.start, x.count, x.materialIndex)
  g.setDrawRange(r.drawRange.start, r.drawRange.count)
  const b = r.box as number[] | null
  if (b !== null) g.boundingBox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))
  const s = r.sphere as number[] | null
  if (s !== null) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3])
  return g
}

// ================================================================================ plain data
/** Whether `v` crosses as itself (structured cloning: the receiving thread gets a copy). */
function passes(v: object): boolean {
  return ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Date || v instanceof RegExp || (typeof Blob === 'function' && v instanceof Blob)
}

function isPlain(v: object): boolean {
  const proto = Object.getPrototypeOf(v)
  return proto === null || Object.getPrototypeOf(proto) === null
}

function typeName(v: object): string {
  const name = (v as { constructor?: { name?: string } }).constructor?.name
  return name ? `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}` : 'an object'
}
