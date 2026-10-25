// The shapes, as three.js objects. A body (Part, Shell, Sketch) is a THREE.Mesh whose geometry is
// the tessellation of its exact B-rep, with the lines of its edges as a child; its faces are
// THREE.Meshes, its edges and wires THREE.Lines, its vertices THREE.Points. They are added to
// scenes, moved, raycast, rendered and disposed as any other three object.
//
// The rules:
// - Coordinates are three's (Y up), in the object's own frame, as a geometry's are: what a query
//   gives (center(), bbox(), pointAt()) and what a method takes (a point, a direction, a
//   THREE.Plane, a THREE.Curve) is in the frame of the object it is called on.
// - Objects given to an operation are taken where they are in the world (their matrixWorld): a
//   tool moved with `tool.position.x = 10` cuts there. The result is in the frame of the object
//   the operation is called on, and has its transform, material and name, as its clone would.
// - Operations return new objects and leave their inputs as they were (smlibpy's values); what is
//   three's (transform, material, visibility) is changed in place as usual.
// - The faces, edges and vertices of a body are where the body is. Each is one object per body
//   (part.faces()[3] is the same object every time, and the one a raycast hit gives); add one as a
//   child of its body to draw it there, highlighted.
//
// Per-instance state lives in one object under a symbol, not in class fields: three's
// constructors assign `geometry` and `material` (and Mesh's reads `geometry` back) before a
// subclass's fields exist, and a field would shadow the accessors that make them lazy.
import * as THREE from 'three'
import { edges3, outline2 } from './convert.ts'
import {
  C,
  axis as toAxis,
  boundBox,
  box3,
  call,
  degrees,
  describe,
  location,
  matrix4,
  plane as toPlane,
  ray,
  sm,
  threePlane,
  vec,
  vector3,
  type SmBody,
} from './kernel.ts'
import { edgeAt, faceAt, faceOf, lineGeometry, polyline, tessellate, type Tessellation } from './tessellation.ts'

// --------------------------------------------------------------------------------------- state
const STATE = Symbol('smlibpy-three')

/** A kernel value and how many objects hold it (clones share it; the last dispose() frees it). */
interface Held<T> {
  value: T
  refs: number
}

/** A body's kernel value, and its tessellations by settings: clones share them, as three's clones
 * share their geometry, also those made before the first render. */
interface HeldBody extends Held<SmBody> {
  tessellations: Map<string, Tessellation>
}

interface State {
  /** False while three's constructor runs: what it assigns are its defaults. */
  ready: boolean
  /** Made by the package (an operation's result, a clone, a body's face): the constructor's
   * arguments are not the shape's. */
  internal: boolean
  /** A geometry or material assigned by the app (or, for a material, taken over from the object
   * an operation was called on); null: the object's own. */
  geometry: THREE.BufferGeometry | null
  material: THREE.Material | THREE.Material[] | null
  /** What the object made itself, on first use. */
  ownGeometry: THREE.BufferGeometry | null
  ownMaterial: THREE.Material | null
  disposed: boolean
  // bodies
  held: HeldBody | null
  tess: Tessellation | null
  tolerance: number | null
  angle: number
  faces: ShapeList<Face> | null
  edges: ShapeList<Edge> | null
  vertices: ShapeList<Vertex> | null
  // faces, edges, wires, vertices
  owner: Body | null
  index: number
  sub: sm.Face | sm.Edge | sm.Wire | sm.Vertex | null
  curve: Held<sm.Edge | sm.Wire> | null
}

function state(o: object): State {
  let s = (o as { [STATE]?: State })[STATE]
  if (s === undefined) {
    s = {
      ready: false,
      internal: false,
      geometry: null,
      material: null,
      ownGeometry: null,
      ownMaterial: null,
      disposed: false,
      held: null,
      tess: null,
      tolerance: null,
      angle: DEFAULT_ANGLE,
      faces: null,
      edges: null,
      vertices: null,
      owner: null,
      index: -1,
      sub: null,
      curve: null,
    }
    // (not enumerable: three's copy() and toJSON(), and R3F, never see it)
    Object.defineProperty(o, STATE, { value: s })
  }
  return s
}

const DEFAULT_ANGLE = (15 * Math.PI) / 180
const EDGE_ANGLE = (5 * Math.PI) / 180

// What three's constructors are given (assigned before the object is ready, so never kept), and what
// an object that has nothing to draw draws: no points, and bounds that no ray meets.
const PLACEHOLDER = new THREE.BufferGeometry()
PLACEHOLDER.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
PLACEHOLDER.boundingBox = new THREE.Box3()
PLACEHOLDER.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1)
const PLACEHOLDER_MATERIAL = new THREE.MeshBasicMaterial()

/**
 * Installs `geometry` and `material` accessors: an assigned value, else the object's own, made by
 * `geometry(o)` and `material(o)` on first use (a body tessellates when three first reads its
 * geometry: to render, raycast or measure it). Assigning null (or the own one back, as R3F does
 * when a material child is removed) restores the own one.
 */
function accessors(proto: object, geometry: (o: never) => THREE.BufferGeometry, material: (o: never) => THREE.Material): void {
  Object.defineProperty(proto, 'geometry', {
    configurable: true,
    get(this: object): THREE.BufferGeometry {
      const s = state(this)
      if (!s.ready) return PLACEHOLDER
      return s.geometry ?? geometry(this as never)
    },
    set(this: object, value: THREE.BufferGeometry | null | undefined) {
      const s = state(this)
      if (!s.ready) return
      s.geometry = value == null || value === s.ownGeometry ? null : value
    },
  })
  Object.defineProperty(proto, 'material', {
    configurable: true,
    get(this: object): THREE.Material | THREE.Material[] {
      const s = state(this)
      if (!s.ready) return PLACEHOLDER_MATERIAL
      return s.material ?? (s.ownMaterial ??= material(this as never))
    },
    set(this: object, value: THREE.Material | THREE.Material[] | null | undefined) {
      const s = state(this)
      if (!s.ready) return
      s.material = value == null || value === s.ownMaterial ? null : value
    },
  })
}

// The values an internal construction hands to the constructors (results of operations are
// made with `new Part()` and friends, which take them from here, so that the public constructors
// show only what an app gives).
let incomingBody: SmBody | null = null
let incomingSub: { owner: Body | null; index: number; sub: sm.Face | sm.Edge | sm.Wire | sm.Vertex } | null = null
// (set while clone() constructs the copy, which copy() then fills)
let cloning = false

/** @internal
 * True for an object the package constructs (a result, a clone, a face of a body): subclasses
 * leave their arguments alone, the shape comes from elsewhere. */
export function internal(o: THREE.Object3D): boolean {
  return state(o).internal
}

/** three's clone (`new this.constructor().copy(this)`), without the constructor making a shape. */
function cloneOf<T extends THREE.Object3D>(o: T, recursive?: boolean): T {
  cloning = true
  let copy: T
  try {
    copy = new (o.constructor as new () => T)()
  } finally {
    cloning = false
  }
  return copy.copy(o, recursive) as T
}

// ---------------------------------------------------------------------------------- the kernel
/** @internal
 * The kernel value of a body. */
export function kernelOf(body: Body): SmBody {
  const s = state(body)
  if (s.held === null) {
    throw new TypeError(s.disposed ? `this ${body.constructor.name} was disposed` : `an empty ${body.constructor.name} (made without a shape) has no body`)
  }
  return s.held.value
}

/** @internal
 * Gives `body` the kernel value `value` (a new one: the body holds it alone). */
export function setKernel(body: Body, value: SmBody): void {
  const s = state(body)
  releaseTessellation(body)
  s.held = { value, refs: 1, tessellations: new Map() }
  s.faces = s.edges = s.vertices = null
}

function hold(s: State, held: HeldBody | null): void {
  if (s.held === held) return
  // (the value held before is left to the garbage collector: faces or edges taken from it may
  // still be in use; only dispose() frees a value at once)
  if (s.held !== null) s.held.refs--
  s.held = held
  if (held !== null) held.refs++
  s.faces = s.edges = s.vertices = null
}

/** @internal
 * A body for a kernel value: a Part, Shell or Sketch. */
export function wrap(value: SmBody): Part | Shell | Sketch {
  incomingBody = value
  try {
    if (value instanceof sm.Sketch) return new Sketch()
    if (value instanceof sm.Shell) return new Shell()
    return new Part()
  } finally {
    incomingBody = null
  }
}

function wrapAny(value: unknown): unknown {
  if (value instanceof sm.Part || value instanceof sm.Shell) return wrap(value)
  if (value instanceof sm.Edge || value instanceof sm.Wire) return curveOf(value)
  if (Array.isArray(value)) return value.map(wrapAny)
  return value
}

function curveOf(value: sm.Edge | sm.Wire, owner: Body | null = null): Edge | Wire {
  incomingSub = { owner, index: -1, sub: value }
  try {
    return value instanceof sm.Wire ? new Wire() : new Edge()
  } finally {
    incomingSub = null
  }
}

function sub<T extends Face | Edge | Vertex>(cls: new () => T, owner: Body | null, index: number, value: sm.Face | sm.Edge | sm.Vertex): T {
  incomingSub = { owner, index, sub: value }
  try {
    return new cls()
  } finally {
    incomingSub = null
  }
}

/** @internal
 * `result` (just made by an operation called on `like`) gets what a clone of `like` would have:
 * its transform, name, flags and user data, the material it shows, its tessellation settings and
 * the settings of its edge lines.
 */
export function adopt<T extends Body>(result: T, like: Body): T {
  THREE.Object3D.prototype.copy.call(result, like, false)
  const r = state(result)
  const l = state(like)
  r.material = l.material ?? l.ownMaterial
  r.tolerance = l.tolerance
  r.angle = l.angle
  result.edgeLines.visible = like.edgeLines.visible
  const lines = state(like.edgeLines)
  state(result.edgeLines).material = lines.material ?? lines.ownMaterial
  return result
}

// ----------------------------------------------------------------------------------- placement
/** The object whose frame a shape is in: a face's, edge's or vertex's body, else the shape. */
function frameOf(o: THREE.Object3D): THREE.Object3D {
  return state(o).owner ?? o
}

const IDENTITY = new THREE.Matrix4()

// three's types told by their flags and members, not instanceof (a bundle may hold two copies of three)
const isObject3D = (x: unknown): x is THREE.Object3D => (x as THREE.Object3D | null)?.isObject3D === true
const isMatrix4 = (x: unknown): x is THREE.Matrix4 => (x as { isMatrix4?: boolean } | null)?.isMatrix4 === true
const isRay = (x: unknown): x is THREE.Ray => typeof (x as THREE.Ray | null)?.origin?.x === 'number' && typeof (x as THREE.Ray).direction?.x === 'number'

/** The transform from `shape`'s frame into `into`'s (both where they are in the world), or null if
 * there is none to make. `into` null: into the world. */
function relative(shape: THREE.Object3D, into: THREE.Object3D | null): THREE.Matrix4 | null {
  const a = frameOf(shape)
  const b = into === null ? null : frameOf(into)
  if (a === b) return null
  a.updateWorldMatrix(true, false)
  const m = a.matrixWorld.clone()
  if (b !== null) {
    b.updateWorldMatrix(true, false)
    m.premultiply(b.matrixWorld.clone().invert())
  }
  return m.elements.every((e, i) => Math.abs(e - IDENTITY.elements[i]) < 1e-12) ? null : m
}

/** @internal
 * The kernel value of a shape given to an operation of `into`, in `into`'s frame. */
export function operand(shape: unknown, into: THREE.Object3D | null, what: string): sm.Shape {
  let value: sm.Shape
  if (shape instanceof Body) value = kernelOf(shape)
  else if (shape instanceof Face || shape instanceof Edge || shape instanceof Wire || shape instanceof Vertex) value = subOf(shape)
  else throw new TypeError(`${what}: give a Part, Shell, Sketch, Face, Edge or Wire, not ${describe(shape)}`)
  const m = relative(shape, into)
  return m === null ? value : call(() => value.moved(location(m)))
}

function flatten<T>(items: readonly (T | Iterable<T>)[]): T[] {
  const out: T[] = []
  for (const item of items) {
    if (item !== null && typeof item === 'object' && Symbol.iterator in item && !isObject3D(item)) out.push(...(item as Iterable<T>))
    else out.push(item as T)
  }
  return out
}

// ------------------------------------------------------------------------------------- bodies
/** What a fillet, chamfer or shell takes: edges (or faces, whose edges are meant) of the body. */
export type EdgesLike = Edge | Face | Wire | Iterable<Edge | Face | Wire>
/** Faces of the body. */
export type FacesLike = Face | Iterable<Face>

/**
 * A body of exact faces: the base of Part, Shell and Sketch. A THREE.Mesh whose geometry is the
 * tessellation of the body (made when three first reads it), with the body's edges as a child
 * `edgeLines` (THREE.LineSegments).
 *
 * Raycasting it with three's Raycaster gives three's intersections, and on each the body's face
 * that was hit as `intersection.brep` (an edge for hits on `edgeLines`).
 */
export abstract class Body extends THREE.Mesh {
  declare readonly isBody: true
  /** The lines of the body's edges (a child of the body), and what raycasts hit its edges on. */
  readonly edgeLines: EdgeLines

  constructor(material?: THREE.Material | THREE.Material[] | null) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    const s = state(this)
    s.ready = true
    s.internal = incomingBody !== null || cloning
    if (incomingBody !== null) setKernel(this, incomingBody)
    this.edgeLines = new EdgeLines(this)
    this.add(this.edgeLines)
    if (material != null) this.material = material
  }

  /** Chord height of the tessellation in model units (null: 0.1 % of the body's diagonal). Setting
   * it tessellates again when three next reads the geometry. */
  get tolerance(): number | null {
    return state(this).tolerance
  }
  set tolerance(value: number | null) {
    if (value !== null && !(value > 0)) throw new RangeError(`tolerance is a positive length or null, not ${value}`)
    const s = state(this)
    if (s.tolerance === value) return
    s.tolerance = value
    releaseTessellation(this)
  }

  /** The largest angle between neighbouring triangle normals, in radians (default 15 degrees). */
  get angle(): number {
    return state(this).angle
  }
  set angle(value: number) {
    if (!(value > 0)) throw new RangeError(`angle is a positive number of radians, not ${value}`)
    const s = state(this)
    if (s.angle === value) return
    s.angle = value
    releaseTessellation(this)
  }

  // -- topology ---------------------------------------------------------------------------------
  /** The faces, in the kernel's order. The same objects every time. */
  faces(): ShapeList<Face> {
    const s = state(this)
    if (s.faces === null) {
      const value = kernelOf(this)
      s.faces = ShapeList.from([...call(() => value.faces())].map((f, i) => sub(Face, this, i, f))) as ShapeList<Face>
    }
    return ShapeList.from(s.faces) as ShapeList<Face>
  }

  /** The edges (seams, where a closed surface meets itself, left out), in the kernel's order. */
  edges(): ShapeList<Edge> {
    const s = state(this)
    if (s.edges === null) {
      const value = kernelOf(this)
      s.edges = ShapeList.from([...call(() => value.edges())].map((e, i) => sub(Edge, this, i, e))) as ShapeList<Edge>
    }
    return ShapeList.from(s.edges) as ShapeList<Edge>
  }

  vertices(): ShapeList<Vertex> {
    const s = state(this)
    if (s.vertices === null) {
      const value = kernelOf(this)
      s.vertices = ShapeList.from([...call(() => value.vertices())].map((v, i) => sub(Vertex, this, i, v))) as ShapeList<Vertex>
    }
    return ShapeList.from(s.vertices) as ShapeList<Vertex>
  }

  /** The faces' boundary loops. */
  wires(): ShapeList<Wire> {
    const value = kernelOf(this)
    return ShapeList.from([...call(() => value.wires())].map((w) => curveOf(w, this) as Wire)) as ShapeList<Wire>
  }

  // -- measuring --------------------------------------------------------------------------------
  /** The surface area. */
  get area(): number {
    const value = kernelOf(this)
    return call(() => value.area)
  }

  /** The center of mass (of the area, for sheets). */
  center(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const value = kernelOf(this)
    return vector3(call(() => value.center()), target)
  }

  /** The exact bounding box, in the body's frame (Box3.setFromObject gives the tessellation's,
   * in the world's). */
  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const value = kernelOf(this)
    return box3(call(() => value.bbox()), target)
  }

  /** The shortest distance to a point (in this body's frame) or to another shape (where it is). */
  distanceTo(other: THREE.Vector3Like | Body | Face | Edge | Wire | Vertex): number {
    const value = kernelOf(this)
    if (isObject3D(other)) {
      const o = operand(other, this, 'distanceTo')
      return call(() => value.distanceTo(o))
    }
    return call(() => value.distanceTo(vec(other)))
  }

  /** The point of the body nearest to `point` (both in its frame). */
  closestPoint(point: THREE.Vector3Like, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const value = kernelOf(this)
    return vector3(call(() => value.closestPoint(vec(point))), target)
  }

  /** The kernel's check of the body (true: sound). */
  isValid(): boolean {
    const value = kernelOf(this)
    return call(() => value instanceof sm.Part ? value.isValid() : value.check().length === 0)
  }

  /** The curves where a plane (in this body's frame) cuts the body. */
  intersectionCurves(other: THREE.Plane | Body | Face): ShapeList<Edge> {
    const value = kernelOf(this)
    const o = (other as THREE.Plane).isPlane ? toPlane(other as THREE.Plane) : (operand(other, this, 'intersectionCurves') as sm.Part | sm.Shell | sm.Face)
    return ShapeList.from([...call(() => value.intersectionCurves(o))].map((e) => curveOf(e, this) as Edge)) as ShapeList<Edge>
  }

  // -- placing ----------------------------------------------------------------------------------
  /**
   * Clones of this body, one at each of `locations` (moved by it, as `clone().applyMatrix4(m)`):
   * `plate.cut(hole.at(GridLocations(60, 40, 2, 2)))`. The clones share the body and its
   * tessellation.
   */
  at(locations: Iterable<THREE.Matrix4 | THREE.Vector3Like>): this[] {
    const out: this[] = []
    for (const l of locations) {
      const c = this.clone()
      if (isMatrix4(l)) c.applyMatrix4(l)
      else c.position.add(l as THREE.Vector3)
      out.push(c)
    }
    return out
  }

  // -- three ------------------------------------------------------------------------------------
  /** three's raycast, and on each intersection the face that was hit as `brep`. */
  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const from = intersects.length
    super.raycast(raycaster, intersects)
    const s = state(this)
    if (s.geometry !== null || s.tess === null || s.held === null) return
    const faces = this.faces()
    for (let i = from; i < intersects.length; i++) {
      const hit = intersects[i]
      if (hit.face) hit.brep = faces[faceAt(s.tess, hit.face.a)]
    }
  }

  override clone(recursive?: boolean): this {
    return cloneOf(this, recursive)
  }

  /** Shares the body (the kernel's, and its tessellation) and the material, as three's copy
   * shares geometry and material; the source's edge lines' settings go to this one's. */
  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, false)
    const s = state(this)
    const t = state(source)
    releaseTessellation(this)
    hold(s, t.held)
    s.tolerance = t.tolerance
    s.angle = t.angle
    s.geometry = t.geometry
    // (three's rule: the copy shows the source's material, the same object)
    const material = source.material
    s.material = Array.isArray(material) ? material.slice() : material
    this.edgeLines.copy(source.edgeLines, false)
    if (recursive) for (const child of source.children) if (child !== source.edgeLines) this.add(child.clone())
    const parameters = (source as { parameters?: object }).parameters
    if (parameters !== undefined) (this as { parameters?: object }).parameters = { ...parameters }
    return this
  }

  /**
   * Frees what the body made: its tessellation (once no clone draws it), its own materials and its
   * kernel body (once no clone holds it). Materials assigned to it are the app's, as with any
   * three object. The body stays in the scene as it was drawn; operations on it throw.
   */
  override dispose(): void {
    const s = state(this)
    if (s.disposed) return
    // (what three draws stays: the tessellation's arrays, which the renderer uploads again)
    const drawn = s.tess
    releaseTessellation(this)
    s.tess = drawn
    s.ownGeometry = drawn?.faces ?? null
    s.ownMaterial?.dispose()
    s.ownMaterial = null
    this.edgeLines.dispose()
    for (const list of [s.faces, s.edges, s.vertices]) for (const x of list ?? []) x.dispose()
    if (s.held !== null) {
      s.held.refs--
      if (s.held.refs <= 0) s.held.value.dispose()
      s.held = null
    }
    s.disposed = true
    s.faces = s.edges = s.vertices = null
    super.dispose?.()
  }
}

Object.defineProperty(Body.prototype, 'isBody', { value: true })

/** The tessellation three draws of a body: none for an empty body (or one disposed before it was
 * drawn), and none, with one console message, where the kernel cannot tessellate it (a render
 * loop that reads the geometry would throw every frame). */
function drawnTessellation(body: Body): Tessellation | null {
  const s = state(body)
  if (s.tess !== null) return s.tess
  if (s.held === null) return null
  try {
    return tessellationOf(body)
  } catch (e) {
    if (!failed.has(s.held)) {
      failed.add(s.held)
      console.error(`smlibpy-three: this ${body.constructor.name} could not be tessellated, so it is not drawn`, e)
    }
    return null
  }
}

const failed = new WeakSet<object>()

function tessellationOf(body: Body): Tessellation {
  const s = state(body)
  if (s.tess === null) {
    const value = kernelOf(body)
    const held = s.held!
    const key = `${s.tolerance}|${s.angle}`
    let tess = held.tessellations.get(key)
    if (tess === undefined) {
      const edges = [...body.edges()].map((e) => subOf(e) as sm.Edge)
      tess = call(() => tessellate(value, edges, s.tolerance, s.angle, EDGE_ANGLE))
      held.tessellations.set(key, tess)
    }
    tess.refs++
    s.tess = tess
    s.ownGeometry = tess.faces
  }
  return s.tess
}

function releaseTessellation(body: Body): void {
  const s = state(body)
  if (s.tess === null) return
  const tess = s.tess
  tess.refs--
  // (drawn by a clone still; else three frees the GPU side, and the arrays go with the body)
  if (tess.refs <= 0) {
    tess.faces.dispose()
    tess.edges.dispose()
    if (s.held !== null) for (const [key, t] of s.held.tessellations) if (t === tess) s.held.tessellations.delete(key)
  }
  s.tess = null
  s.ownGeometry = null
  for (const list of [s.faces, s.edges]) for (const x of list ?? []) releaseOwnGeometry(x)
}

function releaseOwnGeometry(o: THREE.Object3D): void {
  const s = state(o)
  s.ownGeometry?.dispose()
  s.ownGeometry = null
}

function bodyMaterial(body: Body): THREE.Material {
  const open = !(body instanceof Part)
  return new THREE.MeshStandardMaterial({
    color: 0xc7ccd4,
    roughness: 0.55,
    metalness: 0.05,
    side: open ? THREE.DoubleSide : THREE.FrontSide,
    // (faces a little behind the edges drawn on them)
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

accessors(
  Body.prototype,
  (b: Body) => drawnTessellation(b)?.faces ?? PLACEHOLDER,
  (b: Body) => bodyMaterial(b),
)

/**
 * The edges of a body as line segments: a child of the body. Raycasts hit them as three's
 * LineSegments are hit (within `raycaster.params.Line.threshold`, in world units), with the
 * body's edge that was hit as `intersection.brep`.
 */
export class EdgeLines extends THREE.LineSegments {
  declare readonly isEdgeLines: true
  constructor(owner?: Body) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    const s = state(this)
    s.ready = true
    s.owner = owner ?? null
  }

  /** The body whose edges these are. */
  get body(): Body | null {
    return state(this).owner
  }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const from = intersects.length
    super.raycast(raycaster, intersects)
    const owner = state(this).owner
    const s = owner === null ? null : state(owner)
    if (owner === null || s === null || s.tess === null || s.held === null || state(this).geometry !== null) return
    const edges = owner.edges()
    for (let i = from; i < intersects.length; i++) {
      const hit = intersects[i]
      if (hit.index !== undefined) hit.brep = edges[edgeAt(s.tess, hit.index / 2)]
    }
  }

  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, recursive)
    const s = state(this)
    const t = state(source)
    s.owner ??= t.owner
    s.geometry = t.geometry
    s.material = t.material ?? t.ownMaterial
    return this
  }

  /** Frees its own material (the geometry is its body's). */
  override dispose(): void {
    const s = state(this)
    s.ownMaterial?.dispose()
    s.ownMaterial = null
    super.dispose?.()
  }
}

Object.defineProperty(EdgeLines.prototype, 'isEdgeLines', { value: true })

accessors(
  EdgeLines.prototype,
  (e: EdgeLines) => {
    const owner = state(e).owner
    return (owner === null ? null : drawnTessellation(owner))?.edges ?? PLACEHOLDER
  },
  () => new THREE.LineBasicMaterial({ color: 0x20242c }),
)

/** A fillet's radius: one, one per edge, `{ start, end }` along each run of edges, or radii at
 * positions along it (0 to 1). */
export type FilletRadius = number | readonly number[] | { start: number; end: number } | ReadonlyMap<number, number>

/** Options of fillets (smlibpy's). */
export interface FilletOptions {
  /** null: circular rounds; "G2" or "G3": curvature-continuous blends ("G1" tangent ones). */
  continuity?: number | string | null
  /** The shape of a blend's cross-section: above 1 fuller, below 1 flatter. */
  fullness?: number
  /** Round the edges that continue the given ones tangentially too (default true). */
  propagate?: boolean
  /** Where three rounds meet: "patch" (default) or "mitre". */
  corners?: string
  /** Rounds stop this far from corners of three or more rounded edges, joined by one larger patch. */
  setback?: number | null
}

/** Options of chamfers (smlibpy's). */
export interface ChamferOptions {
  /** An asymmetric bevel: the setback on the other face of each edge (`length` is on `reference`). */
  length2?: number | null
  /** An asymmetric bevel: the angle between the bevel and the `reference` face, in radians. */
  angle?: number | null
  /** The face (or faces) of the part each edge lies on, which `length` is measured on. */
  reference?: Face | Iterable<Face> | null
  /** Bevel the edges that continue the given ones tangentially too (default true). */
  propagate?: boolean
  /** Where three bevels meet: "patch" (default) or "mitre". */
  corners?: string
}

/** A solid: Booleans, fillets, chamfers, shells, splits and sections; volume and mass. */
export class Part extends Body {
  declare readonly isPart: true
  /**
   * A part from a triangle mesh (a THREE.BufferGeometry of a closed surface: STL, a GLB's mesh,
   * three's BoxGeometry): its triangles, welded by position, become planar faces (`maxFaces` limits
   * them; triangles in one plane merge). Without a geometry, an empty part.
   */
  constructor(geometry?: THREE.BufferGeometry | null, material?: THREE.Material | THREE.Material[] | null, options: { maxFaces?: number } = {}) {
    super(material)
    if (internal(this) || geometry == null) return
    setKernel(this, call(() => sm.Part.fromMesh(meshOf(geometry), options.maxFaces)))
  }

  /** The volume. */
  get volume(): number {
    const value = kernelOf(this) as sm.Part
    return call(() => value.volume)
  }

  /** Mass, volume, area, center and inertia (in three's axes, about the center) for a density. */
  massProperties(density = 1): { mass: number; volume: number; area: number; center: THREE.Vector3; inertia: THREE.Matrix3 } {
    const value = kernelOf(this) as sm.Part
    const p = call(() => value.massProperties(density))
    const r = new THREE.Matrix3().setFromMatrix4(C)
    const i = new THREE.Matrix3().set(...(p.inertia.flat() as [number, number, number, number, number, number, number, number, number]))
    const inertia = r.clone().multiply(i).multiply(r.clone().transpose())
    return { mass: p.mass, volume: p.volume, area: p.area, center: vector3(p.center), inertia }
  }

  /** True where `point` (in this part's frame) is inside the part or on it. */
  contains(point: THREE.Vector3Like): boolean {
    const value = kernelOf(this) as sm.Part
    return call(() => value.contains(vec(point)))
  }

  /** The solids of a part of several. */
  solids(): ShapeList<Part> {
    const value = kernelOf(this) as sm.Part
    return ShapeList.from([...call(() => value.solids())].map((p) => adopt(wrap(p) as Part, this))) as ShapeList<Part>
  }

  // -- Booleans ---------------------------------------------------------------------------------
  /** This part and the others, fused (smlibpy's `a + b`). The others are taken where they are. */
  fuse(...others: (Part | Iterable<Part>)[]): Part {
    return this.boolean('fuse', others)
  }

  /** This part with the others cut away (smlibpy's `a - b`). */
  cut(...others: (Part | Iterable<Part>)[]): Part {
    return this.boolean('cut', others)
  }

  /** What this part and the others share (smlibpy's `a & b`). */
  intersect(...others: (Part | Iterable<Part>)[]): Part {
    return this.boolean('intersect', others)
  }

  private boolean(op: 'fuse' | 'cut' | 'intersect', others: readonly (Part | Iterable<Part>)[]): Part {
    const value = kernelOf(this) as sm.Part
    const tools = flatten(others).map((o) => operand(o, this, op) as sm.Part)
    return adopt(wrap(call(() => value[op](...tools))) as Part, this)
  }

  // -- features ---------------------------------------------------------------------------------
  /** Rounds edges of this part (faces: all their edges). */
  fillet(edges: EdgesLike, radius: FilletRadius, options: FilletOptions = {}): Part {
    const value = kernelOf(this) as sm.Part
    const e = this.own(edges, 'fillet')
    return adopt(wrap(call(() => value.fillet(e, radius, options))) as Part, this)
  }

  /** Bevels edges of this part. */
  chamfer(edges: EdgesLike, length: number, options: ChamferOptions = {}): Part {
    const value = kernelOf(this) as sm.Part
    const e = this.own(edges, 'chamfer')
    const o = {
      ...options,
      angle: options.angle == null ? options.angle : degrees(options.angle),
      reference: options.reference == null ? options.reference : this.own(options.reference, 'chamfer'),
    }
    return adopt(wrap(call(() => value.chamfer(e, length, o))) as Part, this)
  }

  /** A hollow part with walls `thickness` thick, open at `openings` (faces of this part). */
  shell(thickness: number, openings: FacesLike | null = null, options: { outward?: boolean } = {}): Part {
    const value = kernelOf(this) as sm.Part
    const o = openings === null ? null : (this.own(openings, 'shell') as sm.Face[])
    return adopt(wrap(call(() => value.shell(thickness, o, options))) as Part, this)
  }

  /** The part grown (or shrunk, for a negative distance) by `distance` all round. */
  offset(distance: number): Part {
    const value = kernelOf(this) as sm.Part
    return adopt(wrap(call(() => value.offset(distance))) as Part, this)
  }

  /** The part on the side of `plane` (in its frame) the plane's normal points to, as three's
   * clipping keeps it; 'below' the other side, 'both' both. A face or sheet splits it too. */
  split(plane: THREE.Plane | Face | Shell, keep?: 'above' | 'below'): Part
  split(plane: THREE.Plane | Face | Shell, keep: 'both'): [Part, Part]
  split(plane: THREE.Plane | Face | Shell, keep: 'above' | 'below' | 'both' = 'above'): Part | [Part, Part] {
    const value = kernelOf(this) as sm.Part
    const p = (plane as THREE.Plane).isPlane ? toPlane(plane as THREE.Plane) : (operand(plane, this, 'split') as sm.Face | sm.Shell)
    const out = call(() => value.split(p, keep as 'both'))
    return Array.isArray(out) ? (out.map((x) => adopt(wrap(x) as Part, this)) as [Part, Part]) : adopt(wrap(out) as Part, this)
  }

  /** The section where `plane` (in this part's frame) cuts it: a sketch. */
  section(plane: THREE.Plane): Sketch {
    const value = kernelOf(this) as sm.Part
    return adopt(wrap(call(() => value.section(toPlane(plane)))) as Sketch, this)
  }

  /** The part mirrored in `plane` (in its frame). */
  mirror(plane: THREE.Plane): Part {
    const value = kernelOf(this) as sm.Part
    return adopt(wrap(call(() => value.mirror(toPlane(plane)))) as Part, this)
  }

  /** The kernel edges for `edges`, which must be this part's (or a clone's). */
  private own(items: EdgesLike | FacesLike, what: string): (sm.Edge | sm.Face | sm.Wire)[] {
    const value = kernelOf(this)
    const list = isObject3D(items) ? [items] : [...(items as Iterable<Edge | Face | Wire>)]
    return list.map((x) => {
      if (!(x instanceof Edge || x instanceof Face || x instanceof Wire)) throw new TypeError(`${what}: give edges or faces of this part, not ${describe(x)}`)
      const owner = state(x).owner
      if (owner === null || state(owner).held?.value !== value) throw new RangeError(`${what}: the ${x.constructor.name.toLowerCase()} is not one of this part's`)
      return subOf(x) as sm.Edge | sm.Face | sm.Wire
    })
  }
}

Object.defineProperty(Part.prototype, 'isPart', { value: true })

/** A sheet: a surface body of open faces (drawn on both sides). */
export class Shell extends Body {
  declare readonly isShell: true
  /** A solid of the sheet grown by `thickness` (to the side its normals point to; `both`: half to
   * each side). */
  thicken(thickness: number, options: { both?: boolean } = {}): Part {
    const value = kernelOf(this) as sm.Shell
    return adopt(wrap(call(() => value.thicken(thickness, options))) as Part, this)
  }
}

Object.defineProperty(Shell.prototype, 'isShell', { value: true })

/** Options of extrusions. */
export interface ExtrudeOptions {
  /** Extrude to both sides (the amount to each). */
  both?: boolean
  /** Draft of the side walls, in radians (inward for positive). */
  taper?: number
  /** The direction (in the sketch's frame) instead of its normal. */
  direction?: THREE.Vector3Like | null
  corners?: 'sharp' | 'round'
}

/** Options of sweeps. */
export interface SweepOptions {
  sharpCorners?: boolean | null
  /** Keep this direction (in the sketch's frame) up along the path, or 'frenet'. */
  up?: THREE.Vector3Like | string | null
  /** Turn the profile by this many radians along the path. */
  twist?: number
  /** Where the profile is attached to the path: its center (default) or its origin. */
  anchor?: 'center' | 'origin'
}

/**
 * A planar region: drawn in its own 2D coordinates (x, y), which lie on the ground of its frame
 * (three's XZ plane; its y runs along -z, so a top view shows it as drawn) and face up (+y), as
 * smlibpy's sketches lie on XY and face +Z. Place it with its transform, or on a face with on().
 * Extrude, revolve and sweep it into parts.
 */
export class Sketch extends Shell {
  declare readonly isSketch: true
  /**
   * A sketch of three's 2D shapes (THREE.Shape with its holes, THREE.Path, any THREE.Curve<Vector2>:
   * what SVGLoader.createShapes or Font.generateShapes give): their lines, arcs, ellipses and
   * Bézier curves become the same exact curves, splines exact B-splines. Several shapes are fused.
   */
  constructor(shapes?: THREE.Curve<THREE.Vector2> | readonly THREE.Curve<THREE.Vector2>[] | null, material?: THREE.Material | THREE.Material[] | null) {
    super(material)
    if (internal(this) || shapes == null) return
    const list = Array.isArray(shapes) ? shapes : [shapes as THREE.Curve<THREE.Vector2>]
    if (!list.length) throw new RangeError('Sketch: give at least one shape')
    setKernel(this, call(() => {
      const regions = list.map((shape) => {
        const holes = ((shape as THREE.Shape).holes ?? []).map((h) => new sm.Wire(outline2(h)))
        return sm.makeFace(new sm.Wire(outline2(shape)), ...holes)
      })
      return regions.length === 1 ? regions[0] : regions[0].fuse(...regions.slice(1))
    }))
  }

  /** The region's area. */
  override get area(): number {
    const value = kernelOf(this) as sm.Sketch
    return call(() => value.area)
  }

  /** The length of its outline. */
  get perimeter(): number {
    const value = kernelOf(this) as sm.Sketch
    return call(() => value.perimeter)
  }

  /** The plane it lies on, in its frame. */
  get plane(): THREE.Plane {
    const value = kernelOf(this) as sm.Sketch
    return threePlane(call(() => value.plane))
  }

  /** A solid: the region moved `amount` along its normal (or `direction`). */
  extrude(amount: number, options: ExtrudeOptions = {}): Part {
    const value = kernelOf(this) as sm.Sketch
    const o = {
      ...options,
      taper: options.taper === undefined ? undefined : degrees(options.taper),
      direction: options.direction == null ? options.direction : vec(options.direction),
    }
    return adopt(wrap(call(() => value.extrude(amount, o))) as Part, this)
  }

  /** A solid of revolution about `axis` (a THREE.Ray in the sketch's frame, in its plane; default
   * the sketch's y axis) through `angle` radians. */
  revolve(axis: THREE.Ray | null = null, angle = 2 * Math.PI): Part {
    const value = kernelOf(this) as sm.Sketch
    return adopt(wrap(call(() => value.revolve(axis === null ? null : toAxis(axis), degrees(angle)))) as Part, this)
  }

  /** A solid: the region swept along `path` (an Edge or Wire where it is, or a THREE.Curve in the
   * sketch's frame). */
  sweep(path: Edge | Wire | THREE.Curve<THREE.Vector3>, options: SweepOptions = {}): Part {
    const value = kernelOf(this) as sm.Sketch
    const p = pathOf(path, this)
    const o = {
      ...options,
      twist: options.twist === undefined ? undefined : degrees(options.twist),
      up: options.up == null || typeof options.up === 'string' ? options.up : vec(options.up),
    }
    return adopt(wrap(call(() => value.sweep(p, o))) as Part, this)
  }

  /**
   * The sketch placed on `target`: a face (where it is in the world; the sketch's origin goes to
   * the face's center, its normal along the face's), a THREE.Plane, or a THREE.Matrix4 (both in
   * the sketch's frame).
   */
  on(target: Face | THREE.Plane | THREE.Matrix4): Sketch {
    const value = kernelOf(this) as sm.Sketch
    let t: sm.Plane | sm.Face | sm.Location
    if ((target as THREE.Plane).isPlane) t = toPlane(target as THREE.Plane)
    else if (isMatrix4(target)) t = location(target)
    else t = operand(target, this, 'on') as sm.Face
    return adopt(wrap(call(() => value.on(t))) as Sketch, this)
  }

  /** This region and the others (in the same plane, where they are), fused. */
  fuse(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    return this.boolean('fuse', others)
  }

  /** This region with the others cut away. */
  cut(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    return this.boolean('cut', others)
  }

  /** What this region and the others share. */
  intersect(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    return this.boolean('intersect', others)
  }

  private boolean(op: 'fuse' | 'cut' | 'intersect', others: readonly (Sketch | Iterable<Sketch>)[]): Sketch {
    const value = kernelOf(this) as sm.Sketch
    const tools = flatten(others).map((o) => operand(o, this, op) as sm.Sketch)
    return adopt(wrap(call(() => value[op](...tools))) as Sketch, this)
  }

  /** The region grown (shrunk, negative) by `distance` all round. */
  offset(distance: number, options: { corners?: 'round' | 'sharp' } = {}): Sketch {
    const value = kernelOf(this) as sm.Sketch
    return adopt(wrap(call(() => value.offset(distance, options))) as Sketch, this)
  }

  /** The region with its corners rounded (all, or those at `vertices`). */
  fillet(radius: number, vertices: Iterable<Vertex | THREE.Vector3Like> | null = null): Sketch {
    const value = kernelOf(this) as sm.Sketch
    const v = vertices === null ? null : [...vertices].map((x) => (x instanceof Vertex ? (subOf(x) as sm.Vertex) : vec(x)))
    return adopt(wrap(call(() => value.fillet(radius, v))) as Sketch, this)
  }
}

Object.defineProperty(Sketch.prototype, 'isSketch', { value: true })

/** @internal
 * A sweep path as the kernel's curve, in `into`'s frame. */
export function pathOf(path: Edge | Wire | THREE.Curve<THREE.Vector3>, into: THREE.Object3D | null): sm.Edge | sm.Wire {
  if (path instanceof Edge || path instanceof Wire) return operand(path, into, 'sweep') as sm.Edge | sm.Wire
  const edges = edges3(path)
  return edges.length === 1 ? edges[0] : call(() => new sm.Wire(edges))
}

/** A closed triangle mesh of three's (welded by position) as the kernel's mesh. */
function meshOf(geometry: THREE.BufferGeometry): sm.Mesh {
  const position = geometry.getAttribute('position')
  if (position === undefined) throw new TypeError('Part: the geometry has no positions')
  const index = geometry.getIndex()
  const count = index === null ? position.count : index.count
  const ids = new Map<string, number>()
  const vertices: number[] = []
  const triangles: number[] = []
  const p = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(position, index === null ? i : index.getX(i))
    // (welded at 1e-6 of the coordinates' size: meshes split per face, as BoxGeometry is, close up)
    const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = vertices.length / 3
      ids.set(key, id)
      vertices.push(p.x, -p.z, p.y)
    }
    triangles.push(id)
  }
  // (degenerate triangles, of two welded corners, left out)
  const kept: number[] = []
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]]
    if (a !== b && b !== c && a !== c) kept.push(a, b, c)
  }
  return new sm.Mesh(vertices, kept)
}

// --------------------------------------------------------------------------------- sub-shapes
/** @internal
 * The kernel value of a face, edge, wire or vertex. */
export function kernelOfShape(x: Face | Edge | Wire | Vertex): sm.Face | sm.Edge | sm.Wire | sm.Vertex {
  return subOf(x)
}

function subOf(x: Face | Edge | Wire | Vertex): sm.Face | sm.Edge | sm.Wire | sm.Vertex {
  const s = state(x)
  if (s.owner !== null) kernelOf(s.owner) // (throws for a disposed body)
  const value = s.sub ?? s.curve?.value ?? null
  if (value === null) throw new TypeError(`an empty ${x.constructor.name} (made without a curve) has no geometry`)
  return value
}

function takeSub(o: THREE.Object3D): void {
  const s = state(o)
  s.ready = true
  s.internal = incomingSub !== null || cloning
  if (incomingSub !== null) {
    s.owner = incomingSub.owner
    s.index = incomingSub.index
    const value = incomingSub.sub
    if (incomingSub.owner === null && (value instanceof sm.Edge || value instanceof sm.Wire)) s.curve = { value, refs: 1 }
    else s.sub = value
  }
}

function copySub(target: THREE.Object3D, source: THREE.Object3D): void {
  const s = state(target)
  const t = state(source)
  s.owner = t.owner
  s.index = t.index
  s.sub = t.sub
  if (s.curve !== t.curve) {
    if (s.curve !== null) s.curve.refs--
    s.curve = t.curve
    if (s.curve !== null) s.curve.refs++
  }
  s.geometry = t.geometry
  s.material = t.material ?? t.ownMaterial
  releaseOwnGeometry(target)
}

function disposeSub(o: THREE.Object3D): void {
  const s = state(o)
  releaseOwnGeometry(o)
  s.ownMaterial?.dispose()
  s.ownMaterial = null
  if (s.curve !== null) {
    s.curve.refs--
    if (s.curve.refs <= 0) s.curve.value.dispose()
    s.curve = null
    s.disposed = true
  }
}

/** The tessellation of a sub-shape's body, null for a curve of its own. */
function ownerTessellation(o: THREE.Object3D): Tessellation | null {
  const owner = state(o).owner
  return owner === null ? null : drawnTessellation(owner)
}

// (sub-shapes drawn alone are mostly highlights of a body's: hover, selection)
const HIGHLIGHT = 0xff7a1a

/**
 * A face of a body: a THREE.Mesh of the face's triangles, in its body's frame (add it as a child
 * of the body to draw it there; its own material is a highlight in front of the body's faces).
 */
export class Face extends THREE.Mesh {
  declare readonly isFace: true
  constructor() {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
  }

  /** The body the face belongs to. */
  get owner(): Body | null {
    return state(this).owner
  }

  /** Its place in `owner.faces()`. */
  get index(): number {
    return state(this).index
  }

  private get face(): sm.Face {
    return subOf(this) as sm.Face
  }

  /** "plane", "cylinder", "cone", "sphere", "torus", "bspline", ... */
  get geomType(): string {
    const f = this.face
    return call(() => f.geomType)
  }

  get area(): number {
    const f = this.face
    return call(() => f.area)
  }

  get isPlanar(): boolean {
    const f = this.face
    return call(() => f.isPlanar)
  }

  /** The radius of a cylinder, cone (at its base), sphere or torus face. */
  get radius(): number {
    const f = this.face
    return call(() => f.radius)
  }

  /** The plane of a planar face, in its body's frame. */
  get plane(): THREE.Plane {
    const f = this.face
    return threePlane(call(() => f.plane))
  }

  /** The axis of a cylinder, cone, sphere or torus face, in its body's frame. */
  get axis(): THREE.Ray {
    const f = this.face
    return ray(call(() => f.axis))
  }

  center(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const f = this.face
    return vector3(call(() => f.center()), target)
  }

  /** The outward normal at `point` (default: the face's center), in its body's frame. */
  normalAt(point: THREE.Vector3Like | null = null, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const f = this.face
    return vector3(call(() => f.normalAt(point === null ? null : vec(point))), target)
  }

  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const f = this.face
    return box3(call(() => f.bbox()), target)
  }

  /** The shortest distance to a point (in its body's frame) or to another shape (where it is). */
  distanceTo(other: THREE.Vector3Like | Body | Face | Edge | Wire | Vertex): number {
    const f = this.face
    const o = isObject3D(other) ? operand(other, this, 'distanceTo') : vec(other)
    return call(() => f.distanceTo(o))
  }

  /** The face's edges: its body's. */
  edges(): ShapeList<Edge> {
    return ownList(this, 'edges', (f) => (f as sm.Face).edges())
  }

  vertices(): ShapeList<Vertex> {
    return ownList(this, 'vertices', (f) => (f as sm.Face).vertices())
  }

  /** The faces of its body that share an edge with it. */
  neighbors(): ShapeList<Face> {
    return ownList(this, 'faces', (f) => (f as sm.Face).neighbors())
  }

  /** Its outer boundary. */
  outerWire(): Wire {
    const f = this.face
    return curveOf(call(() => f.outerWire()), state(this).owner) as Wire
  }

  /** A solid: the face moved `amount` along its normal (in its body's frame and place). */
  extrude(amount: number, options: ExtrudeOptions = {}): Part {
    const f = this.face
    const o = { ...options, taper: options.taper === undefined ? undefined : degrees(options.taper), direction: options.direction == null ? options.direction : vec(options.direction) }
    return adopt(wrap(call(() => f.extrude(amount, o))) as Part, state(this).owner!)
  }

  override raycast(): void {}

  override clone(recursive?: boolean): this {
    return cloneOf(this, recursive)
  }

  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, recursive)
    copySub(this, source)
    return this
  }

  override dispose(): void {
    disposeSub(this)
    super.dispose?.()
  }
}

Object.defineProperty(Face.prototype, 'isFace', { value: true })

accessors(
  Face.prototype,
  (f: Face) => {
    const s = state(f)
    const tess = ownerTessellation(f)
    return (s.ownGeometry ??= tess === null ? PLACEHOLDER : faceOf(tess, s.index))
  },
  () =>
    new THREE.MeshBasicMaterial({
      color: HIGHLIGHT,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
)

/** The sub-shapes of a face or edge, as its body's objects. */
function ownList<T extends Face | Edge | Vertex>(x: Face | Edge, kind: 'faces' | 'edges' | 'vertices', of: (k: sm.Shape) => Iterable<sm.Shape>): ShapeList<T> {
  const value = subOf(x)
  const owner = state(x).owner
  const items = [...call(() => of(value))]
  if (owner === null) {
    if (kind === 'vertices') return ShapeList.from(items.map((v) => sub(Vertex, null, -1, v as sm.Vertex))) as ShapeList<T>
    return new ShapeList<T>()
  }
  const all = (owner[kind] as () => ShapeList<T>).call(owner)
  return ShapeList.from(items.map((k) => find(all, k)).filter((x): x is T => x !== undefined)) as ShapeList<T>
}

/** The object of `list` whose kernel shape is `k`. */
function find<T extends Face | Edge | Vertex>(list: readonly T[], k: sm.Shape): T | undefined {
  for (const x of list) if (state(x).sub === k) return x
  for (const x of list) if ((state(x).sub as { equals(o: unknown): boolean } | null)?.equals(k)) return x
  return undefined
}

/**
 * An edge: a THREE.Line along the exact curve. Either an edge of a body (in its body's frame;
 * `owner` is the body), or a curve of its own (Line, Spline, Helix, ... or one of three's curves),
 * placed by its own transform.
 */
export class Edge extends THREE.Line {
  declare readonly isEdge: true
  /** An edge along one of three's curves (LineCurve3, CubicBezierCurve3, CatmullRomCurve3,
   * CurvePath, ...) in its own frame. Without a curve, an empty edge. */
  constructor(curve?: THREE.Curve<THREE.Vector3> | null, material?: THREE.Material | null) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
    if (material != null) this.material = material
    if (internal(this) || curve == null) return
    const edges = edges3(curve)
    if (edges.length !== 1) throw new RangeError(`Edge: the curve makes ${edges.length} edges; a Wire takes them`)
    setCurve(this, edges[0])
  }

  get owner(): Body | null {
    return state(this).owner
  }

  get index(): number {
    return state(this).index
  }

  private get edge(): sm.Edge {
    return subOf(this) as sm.Edge
  }

  /** "line", "circle" (also arcs), "ellipse", "bspline" or "other". */
  get geomType(): string {
    const e = this.edge
    return call(() => e.geomType)
  }

  get length(): number {
    const e = this.edge
    return call(() => e.length)
  }

  get isClosed(): boolean {
    const e = this.edge
    return call(() => e.isClosed)
  }

  get start(): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.start))
  }

  get end(): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.end))
  }

  /** The radius of a circle or arc. */
  get radius(): number {
    const e = this.edge
    return call(() => e.radius)
  }

  /** The center of a circle or arc. */
  get arcCenter(): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.arcCenter))
  }

  /** The point at fraction `t` of the length. */
  pointAt(t = 0.5, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.pointAt(t)), target)
  }

  /** The unit tangent at fraction `t` of the length. */
  tangentAt(t = 0.5, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.tangentAt(t)), target)
  }

  /** The point halfway along it. */
  center(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return this.pointAt(0.5, target)
  }

  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const e = this.edge
    return box3(call(() => e.bbox()), target)
  }

  /** The shortest distance to a point (in its frame) or to another shape (where it is). */
  distanceTo(other: THREE.Vector3Like | Body | Face | Edge | Wire | Vertex): number {
    const e = this.edge
    const o = isObject3D(other) ? operand(other, this, 'distanceTo') : vec(other)
    return call(() => e.distanceTo(o))
  }

  /** The faces of its body that meet at it. */
  faces(): ShapeList<Face> {
    return ownList(this, 'faces', (e) => (e as sm.Edge).faces())
  }

  vertices(): ShapeList<Vertex> {
    return ownList(this, 'vertices', (e) => (e as sm.Edge).vertices())
  }

  /** The same curve the other way round (a curve of its own, where this one is). */
  reversed(): Edge {
    const e = this.edge
    return placedCurve(call(() => e.reversed()), this) as Edge
  }

  /**
   * The exact curve as a THREE.Curve (getPoint(t) evaluates the kernel's curve at fraction t of
   * the length), for three's own uses of curves: `new THREE.TubeGeometry(edge.curve, 64, 1)`.
   */
  get curve(): THREE.Curve<THREE.Vector3> {
    return new ExactCurve(this)
  }

  /** three's raycast, with the edge itself as `brep`, for a curve of its own. An edge of a body
   * is hit on its body's edge lines, so drawn as a highlight it is not hit again. */
  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    if (state(this).owner !== null) return
    const from = intersects.length
    super.raycast(raycaster, intersects)
    for (let i = from; i < intersects.length; i++) intersects[i].brep = this
  }

  override clone(recursive?: boolean): this {
    return cloneOf(this, recursive)
  }

  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, recursive)
    copySub(this, source)
    return this
  }

  override dispose(): void {
    disposeSub(this)
    super.dispose?.()
  }
}

Object.defineProperty(Edge.prototype, 'isEdge', { value: true })

accessors(
  Edge.prototype,
  (e: Edge) => {
    const s = state(e)
    if (s.ownGeometry === null) {
      const tess = ownerTessellation(e)
      if (s.owner !== null) s.ownGeometry = tess === null ? PLACEHOLDER : lineGeometry(tess.edgePoints[s.index].slice())
      else s.ownGeometry = s.curve === null ? PLACEHOLDER : lineGeometry(curvePolyline(s.curve.value))
    }
    return s.ownGeometry
  },
  (e: Edge) => new THREE.LineBasicMaterial({ color: state(e).owner === null ? 0x20242c : HIGHLIGHT }),
)

/** @internal */
export function setCurve(o: Edge | Wire, value: sm.Edge | sm.Wire): void {
  const s = state(o)
  s.curve = { value, refs: 1 }
  s.owner = null
  s.index = -1
}

/** A curve of its own made from `like` (an edge or wire): where `like` is, with its transform. */
function placedCurve(value: sm.Edge | sm.Wire, like: Edge | Wire): Edge | Wire {
  const s = state(like)
  const c = curveOf(value)
  // (an edge of a body is where its body is)
  THREE.Object3D.prototype.copy.call(c, s.owner ?? like, false)
  return c
}

function curvePolyline(value: sm.Edge | sm.Wire): Float32Array {
  const d = value.bbox().diagonal
  return polyline(value, Math.max(d * 1e-3, 1e-6), EDGE_ANGLE)
}

/** A THREE.Curve along an edge's exact curve (in the edge's frame). */
class ExactCurve extends THREE.Curve<THREE.Vector3> {
  readonly edge: Edge
  constructor(edge: Edge) {
    super()
    this.edge = edge
  }

  override getPoint(t: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return this.edge.pointAt(t, target)
  }

  // (the kernel's point at a fraction of the length is already spaced by length)
  override getPointAt(u: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return this.edge.pointAt(u, target)
  }

  override getTangent(t: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return this.edge.tangentAt(t, target)
  }

  override getTangentAt(u: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return this.edge.tangentAt(u, target)
  }

  override getLength(): number {
    return this.edge.length
  }
}

/**
 * A wire: edges joined end to end, as one THREE.Line. A boundary loop of a body's face (in its
 * body's frame), or a curve of its own.
 */
export class Wire extends THREE.Line {
  declare readonly isWire: true
  /** A wire of edges (where they are, in this wire's frame) or of one of three's curve paths (a
   * THREE.CurvePath, in its own frame). Without either, an empty wire. */
  constructor(edges?: Iterable<Edge> | THREE.CurvePath<THREE.Vector3> | null, material?: THREE.Material | null) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
    if (material != null) this.material = material
    if (internal(this) || edges == null) return
    const kernel = typeof (edges as THREE.Curve<THREE.Vector3>).getPoint === 'function' ? edges3(edges as THREE.Curve<THREE.Vector3>) : [...(edges as Iterable<Edge>)].map((e) => operand(e, null, 'Wire') as sm.Edge)
    setCurve(this, call(() => new sm.Wire(kernel)))
  }

  get owner(): Body | null {
    return state(this).owner
  }

  private get wire(): sm.Wire {
    return subOf(this) as sm.Wire
  }

  get length(): number {
    const w = this.wire
    return call(() => w.length)
  }

  get isClosed(): boolean {
    const w = this.wire
    return call(() => w.isClosed)
  }

  /** Its edges, in order (curves of their own, in this wire's frame). */
  edges(): ShapeList<Edge> {
    const w = this.wire
    return ShapeList.from([...call(() => w.edges())].map((e) => placedCurve(e, this) as Edge)) as ShapeList<Edge>
  }

  pointAt(t = 0.5, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.pointAt(t)), target)
  }

  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const w = this.wire
    return box3(call(() => w.bbox()), target)
  }

  /** three's raycast for a wire of its own; a body's is drawn as a highlight, not hit. */
  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    if (state(this).owner === null) super.raycast(raycaster, intersects)
  }

  /** The region a closed, planar wire bounds. */
  toSketch(): Sketch {
    const w = this.wire
    const sketch = wrap(call(() => w.toSketch())) as Sketch
    THREE.Object3D.prototype.copy.call(sketch, state(this).owner ?? this, false)
    return sketch
  }

  override clone(recursive?: boolean): this {
    return cloneOf(this, recursive)
  }

  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, recursive)
    copySub(this, source)
    return this
  }

  override dispose(): void {
    disposeSub(this)
    super.dispose?.()
  }
}

Object.defineProperty(Wire.prototype, 'isWire', { value: true })

accessors(
  Wire.prototype,
  (w: Wire) => {
    const s = state(w)
    if (s.ownGeometry === null) {
      const value = s.sub ?? s.curve?.value ?? null
      s.ownGeometry = value === null ? PLACEHOLDER : lineGeometry(curvePolyline(value as sm.Wire))
    }
    return s.ownGeometry
  },
  (w: Wire) => new THREE.LineBasicMaterial({ color: state(w).owner === null ? 0x20242c : HIGHLIGHT }),
)

/** A vertex of a body: a THREE.Points of one point, in its body's frame. */
export class Vertex extends THREE.Points {
  declare readonly isVertex: true
  constructor() {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
  }

  get owner(): Body | null {
    return state(this).owner
  }

  get index(): number {
    return state(this).index
  }

  /** Where it is, in its body's frame. */
  get point(): THREE.Vector3 {
    const v = subOf(this) as sm.Vertex
    return vector3(call(() => v.point))
  }

  override raycast(): void {}

  override clone(recursive?: boolean): this {
    return cloneOf(this, recursive)
  }

  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, recursive)
    copySub(this, source)
    return this
  }

  override dispose(): void {
    disposeSub(this)
    super.dispose?.()
  }
}

Object.defineProperty(Vertex.prototype, 'isVertex', { value: true })

accessors(
  Vertex.prototype,
  (v: Vertex) => {
    const s = state(v)
    if (s.ownGeometry === null) {
      const p = s.sub === null ? null : vector3((s.sub as sm.Vertex).point)
      s.ownGeometry = p === null ? PLACEHOLDER : lineGeometry(Float32Array.of(p.x, p.y, p.z))
    }
    return s.ownGeometry
  },
  () => new THREE.PointsMaterial({ color: HIGHLIGHT, size: 8, sizeAttenuation: false, depthTest: false }),
)

// ----------------------------------------------------------------------------------- selections
type Item = Face | Edge | Vertex

/**
 * A list of faces, edges or vertices with smlibpy's selectors, in three's axes: `top()` is the
 * highest along +Y, `front()` the nearest along +Z, `parallelTo(new Vector3(0, 1, 0))` the ones
 * along Y. Points and directions are in the frame of the list's body.
 */
export class ShapeList<T = Item> extends Array<T> {
  /** The first item (a RangeError for an empty list). */
  get first(): T {
    if (!this.length) throw new RangeError('empty selection')
    return this[0]
  }

  get last(): T {
    if (!this.length) throw new RangeError('empty selection')
    return this[this.length - 1]
  }

  /** Array's filter, giving a ShapeList (so selectors go on). */
  override filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: unknown): ShapeList<S>
  override filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T>
  override filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T> {
    return super.filter(predicate, thisArg) as ShapeList<T>
  }

  /** The only item (a RangeError unless there is exactly one). */
  one(): T {
    if (this.length !== 1) throw new RangeError(`one(): the selection has ${this.length} items`)
    return this[0]
  }

  /** The items highest along +Y (smlibpy's top, +Z). */
  top(): ShapeList<T> {
    return select(this, 'top', [])
  }

  bottom(): ShapeList<T> {
    return select(this, 'bottom', [])
  }

  /** The items nearest along +Z (towards three's default camera; smlibpy's front, -Y). */
  front(): ShapeList<T> {
    return select(this, 'front', [])
  }

  back(): ShapeList<T> {
    return select(this, 'back', [])
  }

  right(): ShapeList<T> {
    return select(this, 'right', [])
  }

  left(): ShapeList<T> {
    return select(this, 'left', [])
  }

  /** The largest face (or longest edge). */
  largest(): T {
    return select(this, 'largest', [])
  }

  smallest(): T {
    return select(this, 'smallest', [])
  }

  /** The item nearest to a point. */
  nearest(point: THREE.Vector3Like): T {
    return select(this, 'nearest', [point])
  }

  /** The items whose geometry is one of these types ('plane', 'cylinder', 'line', 'circle', ...). */
  ofType(...geomTypes: string[]): ShapeList<T> {
    return select(this, 'ofType', geomTypes)
  }

  planar(): ShapeList<T> {
    return select(this, 'planar', [])
  }

  cylinders(): ShapeList<T> {
    return select(this, 'cylinders', [])
  }

  lines(): ShapeList<T> {
    return select(this, 'lines', [])
  }

  circles(): ShapeList<T> {
    return select(this, 'circles', [])
  }

  /** Edges along `direction`, faces whose normal is along it. */
  parallelTo(direction: THREE.Vector3Like): ShapeList<T> {
    return select(this, 'parallelTo', [direction])
  }

  perpendicularTo(direction: THREE.Vector3Like): ShapeList<T> {
    return select(this, 'perpendicularTo', [direction])
  }

  /** Faces whose normal points within `maxAngle` radians of `direction`. */
  facing(direction: THREE.Vector3Like, maxAngle = Math.PI / 180): ShapeList<T> {
    return select(this, 'facing', [direction, degrees(maxAngle)])
  }

  /** Sorted by a direction (position along it), a property name ('area', 'length', 'radius') or a function. */
  sortBy(key: THREE.Vector3Like | string | ((item: T) => number), reverse = false): ShapeList<T> {
    const k = key !== null && typeof key === 'object' ? new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(key.x, key.y, key.z)) : key
    return select(this, 'sortBy', [k, reverse])
  }

  /** The edges where faces meet convexly (outside corners). */
  convex(): ShapeList<T> {
    return select(this, 'convex', [])
  }

  concave(): ShapeList<T> {
    return select(this, 'concave', [])
  }

  /** The items in a box (in the body's frame). */
  within(box: THREE.Box3): ShapeList<T> {
    return select(this, 'within', [box])
  }

  /** The faces made, or changed, since `part`: `filleted.faces().newSince(part)`. */
  newSince(part: Body): ShapeList<T> {
    return select(this, 'newSince', [part])
  }
}

/** A kernel argument for an argument of a selector. */
function argument(a: unknown, items: Map<unknown, unknown>): unknown {
  if (a instanceof Body) return kernelOf(a)
  if (a instanceof Face || a instanceof Edge || a instanceof Vertex || a instanceof Wire) return subOf(a)
  if ((a as THREE.Box3 | null)?.isBox3) return boundBox(a as THREE.Box3)
  if (isRay(a)) return toAxis(a)
  if (typeof a === 'function') return (k: unknown) => (a as (x: unknown) => unknown)(items.get(k) ?? k)
  if (a !== null && typeof a === 'object' && typeof (a as THREE.Vector3Like).x === 'number' && typeof (a as THREE.Vector3Like).z === 'number') return vec(a as THREE.Vector3Like)
  return a
}

/** Runs the kernel's selector `name` on the kernel shapes of `list`, and gives back this package's objects. */
function select<T, R>(list: ShapeList<T>, name: string, args: unknown[]): R {
  const items = new Map<unknown, unknown>()
  const kernel = list.map((x) => {
    const k = x instanceof Body ? kernelOf(x) : subOf(x as Item)
    items.set(k, x)
    return k
  })
  const smList = sm.ShapeList.from(kernel) as unknown as Record<string, (...a: unknown[]) => unknown>
  const result = call(() => smList[name](...args.map((a) => argument(a, items))))
  const back = (k: unknown): unknown => {
    if (items.has(k)) return items.get(k)
    // (a shape the selector made anew: the same one of the list's body)
    for (const [key, value] of items) if ((key as { equals(o: unknown): boolean }).equals(k)) return value
    return wrapAny(k)
  }
  if (Array.isArray(result)) return ShapeList.from(result.map(back)) as R
  return back(result) as R
}

// --------------------------------------------------------------------------------- three's types
declare module 'three' {
  interface Intersection {
    /** The face of a body (Part, Shell, Sketch) a raycast hit, or the edge of one on its edge lines. */
    brep?: Face | Edge | Vertex
  }
}
