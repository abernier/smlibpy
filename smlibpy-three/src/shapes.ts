// The shapes, as three.js objects. A body (Part, Shell, Sketch) is a THREE.Mesh whose geometry is
// the tessellation of its exact B-rep, with the lines of its edges as a child; its faces are
// THREE.Meshes, its edges and wires THREE.Lines, its vertices THREE.Points. They are added to
// scenes, moved, raycast, rendered and disposed as any other three object.
//
// The rules:
// - Coordinates are three's, in the object's own frame, as a geometry's are: what a query
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
  axis as toAxis,
  boundBox,
  box3,
  call,
  degrees,
  describe,
  location,
  matrix4,
  plane as toPlane,
  radians,
  ray,
  sm,
  threePlane,
  vec,
  vector3,
  type SmBody,
} from './kernel.ts'
import { BODY_COLOR, edgeAt, faceAt, faceColors, faceOf, fromTessellationData, lineGeometry, polyline, tessellate, tessellationData, type Tessellation, type TessellationData } from './tessellation.ts'
import {
  DraftAnalysis,
  MassProperties,
  SectionProperties,
  closestPointsOf,
  continuityOf,
  curvatureOf,
  infoOf,
  problemOf,
  rayHitOf,
  type BodyInfo,
  type ClosestPoints,
  type Continuity,
  type Curvature,
  type Problem,
  type RayHit,
} from './properties.ts'
import * as deformations from './deform.ts'
import * as sheetMetal from './sheetmetal.ts'
import { tessellate as tessellateMesh, type TessellateOptions, type TriangleMesh } from './mesh.ts'
import { track } from './memory.ts'

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
  faces: ShapeList<BrepFace> | null
  edges: ShapeList<BrepEdge> | null
  vertices: ShapeList<BrepVertex> | null
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
 * The material an object of the package shows because it was given one (or took one over from the
 * object an operation was called on); null where it shows its own default. Other objects: their
 * material. (Files write the colors of these only.) */
export function assignedMaterial(o: THREE.Object3D): THREE.Material | THREE.Material[] | null {
  const s = (o as { [STATE]?: State })[STATE]
  if (s === undefined) return (o as { material?: THREE.Material | THREE.Material[] }).material ?? null
  return s.material
}

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

/** @internal
 * A BrepEdge or Wire for a kernel curve: of `owner` (a body's, where the body is) or of its own. */
export function curveOf(value: sm.Edge | sm.Wire, owner: Body | null = null): BrepEdge | Wire {
  incomingSub = { owner, index: -1, sub: value }
  try {
    return value instanceof sm.Wire ? new Wire() : new BrepEdge()
  } finally {
    incomingSub = null
  }
}

/** @internal
 * The object of class `cls` for a body's face, edge or vertex (`owner` null: a vertex of its own). */
export function sub<T extends BrepFace | BrepEdge | BrepVertex>(cls: new () => T, owner: Body | null, index: number, value: sm.Face | sm.Edge | sm.Vertex): T {
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
  // (a sheet or sketch made from a part draws both sides: it keeps its own material)
  r.material = result instanceof Part === like instanceof Part ? (l.material ?? l.ownMaterial) : null
  r.tolerance = l.tolerance
  r.angle = l.angle
  result.edgeLines.visible = like.edgeLines.visible
  const lines = state(like.edgeLines)
  state(result.edgeLines).material = lines.material ?? lines.ownMaterial
  return result
}

// ----------------------------------------------------------------------------------- placement
/** @internal
 * The object whose frame a shape is in: a face's, edge's or vertex's body, else the shape. */
export function frameOf(o: THREE.Object3D): THREE.Object3D {
  return state(o).owner ?? o
}

const IDENTITY = new THREE.Matrix4()

// three's types told by their flags and members, not instanceof (a bundle may hold two copies of three)
/** @internal */
export const isObject3D = (x: unknown): x is THREE.Object3D => (x as THREE.Object3D | null)?.isObject3D === true
/** @internal */
export const isMatrix4 = (x: unknown): x is THREE.Matrix4 => (x as { isMatrix4?: boolean } | null)?.isMatrix4 === true
/** @internal */
export const isRay = (x: unknown): x is THREE.Ray => typeof (x as THREE.Ray | null)?.origin?.x === 'number' && typeof (x as THREE.Ray).direction?.x === 'number'

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
  else if (shape instanceof BrepFace || shape instanceof BrepEdge || shape instanceof Wire || shape instanceof BrepVertex) value = subOf(shape)
  else throw new TypeError(`${what}: give a Part, Shell, Sketch, BrepFace, BrepEdge or Wire, not ${describe(shape)}`)
  const m = relative(shape, into)
  return m === null ? value : call(() => value.moved(location(m)))
}

/** @internal
 * The kernel's value for an argument of an operation of `into`: shapes where they are (in `into`'s
 * frame), three's points and directions, planes, rays, boxes and matrices as the kernel's; arrays and
 * Maps item by item; anything else as it is. */
export function toKernel(value: unknown, into: THREE.Object3D | null): unknown {
  if (value instanceof Body || value instanceof BrepFace || value instanceof BrepEdge || value instanceof Wire || value instanceof BrepVertex) return operand(value, into, 'an operation')
  const v = value as { isPlane?: boolean; isBox3?: boolean; x?: unknown; y?: unknown; z?: unknown } | null
  if (v?.isPlane === true) return toPlane(value as THREE.Plane)
  if (v?.isBox3 === true) return boundBox(value as THREE.Box3)
  if (isMatrix4(value)) return location(value)
  if (isRay(value)) return toAxis(value)
  if (v !== null && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') return vec(v as THREE.Vector3Like)
  if (Array.isArray(value)) return value.map((x) => toKernel(x, into))
  if (value instanceof Map) return new Map([...value].map(([k, x]) => [toKernel(k, into), toKernel(x, into)]))
  return value
}

/** @internal
 * The package's object for what a kernel call gave to an operation of `like`: bodies wrapped, with
 * `like`'s transform, name and material (`adopt`); faces, edges and vertices of `like`'s body as
 * its objects (a face of another body with that body wrapped first); other curves as curves of
 * their own where `like` is; vectors, boxes, planes, axes and locations as three's; lists item by
 * item. `like` null: as they are, at the world's origin. */
export function toThree(value: unknown, like: THREE.Object3D | null, made: Map<unknown, Body> = new Map()): unknown {
  const frame = like === null ? null : frameOf(like)
  const body = frame instanceof Body ? frame : null
  if (value instanceof sm.Part || value instanceof sm.Shell) {
    const known = made.get(value)
    if (known !== undefined) return known
    const b = wrap(value)
    if (body !== null) adopt(b, body)
    else if (frame !== null) THREE.Object3D.prototype.copy.call(b, frame, false)
    made.set(value, b)
    return b
  }
  if (value instanceof sm.Face) {
    if (body !== null && value.owner === state(body).held?.value) return shapeFor(body, value) ?? value
    // (a face of a new body: the body wrapped, once for all its faces)
    return value.owner === null ? value : (shapeFor(toThree(value.owner, like, made) as Body, value) ?? value)
  }
  if (value instanceof sm.Edge || value instanceof sm.Vertex) {
    const own = body === null ? undefined : shapeFor(body, value)
    if (own !== undefined) return own
    if (value instanceof sm.Vertex) {
      const v = sub(BrepVertex, null, -1, value)
      if (frame !== null) THREE.Object3D.prototype.copy.call(v, frame, false)
      return v
    }
    return frame === null ? curveOf(value) : placedCurve(value, frame)
  }
  if (value instanceof sm.Wire) return body !== null ? curveOf(value, body) : frame === null ? curveOf(value) : placedCurve(value, frame)
  if (value instanceof sm.Vector) return vector3(value)
  if (value instanceof sm.BoundBox) return box3(value)
  if (value instanceof sm.Plane) return threePlane(value)
  if (value instanceof sm.Axis) return ray(value)
  if (value instanceof sm.Location) return matrix4(value)
  if (value instanceof sm.ShapeList) return ShapeList.from([...value].map((x) => toThree(x, like, made)))
  if (Array.isArray(value)) return value.map((x) => toThree(x, like, made))
  return value
}

/** @internal
 * The face, edge or vertex object of `body` for a kernel face, edge or vertex of its body. */
export function shapeFor(body: Body, k: sm.Face | sm.Edge | sm.Vertex): BrepFace | BrepEdge | BrepVertex | undefined {
  const list: readonly (BrepFace | BrepEdge | BrepVertex)[] = k instanceof sm.Face ? body.faces() : k instanceof sm.Edge ? body.edges() : body.vertices()
  return find(list, k)
}

/** @internal */
export function flatten<T>(items: readonly (T | Iterable<T>)[]): T[] {
  const out: T[] = []
  for (const item of items) {
    if (item !== null && typeof item === 'object' && Symbol.iterator in item && !isObject3D(item)) out.push(...(item as Iterable<T>))
    else out.push(item as T)
  }
  return out
}

// ------------------------------------------------------------------------------------- bodies
/** What a fillet, chamfer or shell takes: edges (or faces, whose edges are meant) of the body. */
export type EdgesLike = BrepEdge | BrepFace | Wire | Iterable<BrepEdge | BrepFace | Wire>
/** Faces of the body. */
export type FacesLike = BrepFace | Iterable<BrepFace>

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
    track(this)
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
  faces(): ShapeList<BrepFace> {
    const s = state(this)
    if (s.faces === null) {
      const value = kernelOf(this)
      s.faces = ShapeList.from([...call(() => value.faces())].map((f, i) => sub(BrepFace, this, i, f))) as ShapeList<BrepFace>
    }
    return ShapeList.from(s.faces) as ShapeList<BrepFace>
  }

  /** The edges (seams, where a closed surface meets itself, left out), in the kernel's order. */
  edges(): ShapeList<BrepEdge> {
    const s = state(this)
    if (s.edges === null) {
      const value = kernelOf(this)
      s.edges = ShapeList.from([...call(() => value.edges())].map((e, i) => sub(BrepEdge, this, i, e))) as ShapeList<BrepEdge>
    }
    return ShapeList.from(s.edges) as ShapeList<BrepEdge>
  }

  vertices(): ShapeList<BrepVertex> {
    const s = state(this)
    if (s.vertices === null) {
      const value = kernelOf(this)
      s.vertices = ShapeList.from([...call(() => value.vertices())].map((v, i) => sub(BrepVertex, this, i, v))) as ShapeList<BrepVertex>
    }
    return ShapeList.from(s.vertices) as ShapeList<BrepVertex>
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
  distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number {
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
  intersectionCurves(other: THREE.Plane | Body | BrepFace): ShapeList<BrepEdge> {
    const value = kernelOf(this)
    const o = (other as THREE.Plane).isPlane ? toPlane(other as THREE.Plane) : (operand(other, this, 'intersectionCurves') as sm.Part | sm.Shell | sm.Face)
    return ShapeList.from([...call(() => value.intersectionCurves(o))].map((e) => curveOf(e, this) as BrepEdge)) as ShapeList<BrepEdge>
  }

  /** True if `other` holds the same kernel body (as a clone does). */
  equals(other: unknown): boolean {
    return other instanceof Body && state(this).held !== null && state(other).held === state(this).held
  }

  /** The body's summary: its type, how many faces, edges and vertices, its box (in its frame). */
  info(): BodyInfo {
    const value = kernelOf(this)
    return infoOf(call(() => value.info()))
  }

  /** The kernel's check of the body: what it finds wrong (nothing for a sound body). `level` 0 to 3, more thorough. */
  check(level?: number): Problem[] {
    const value = kernelOf(this)
    return call(() => value.check(level)).map((p) => problemOf(p, this))
  }

  /** The nearest points of this body and another shape (taken where it is), and the faces they lie on. */
  closestPoints(other: Body | BrepFace | BrepEdge | Wire): ClosestPoints {
    const value = kernelOf(this)
    const o = operand(other, this, 'closestPoints') as sm.Part | sm.Shell | sm.Face | sm.Edge | sm.Wire
    // (the other's face: by its place among the faces of the kernel's copy, moved into this frame)
    const otherFace = (k: sm.Face): BrepFace | null => {
      if (other instanceof BrepFace) return other
      if (!(other instanceof Body) || !(o instanceof sm.Part || o instanceof sm.Shell)) return null
      const i = [...o.faces()].findIndex((f) => f.equals(k))
      return i < 0 ? null : other.faces()[i]
    }
    return closestPointsOf(call(() => value.closestPoints(o)), this, otherFace)
  }

  /** The exact hits of a ray (in the body's frame) on its faces, nearest first: the kernel's ray
   * cast on the exact surfaces (three's raycast works on the tessellation). */
  intersectRay(ray: THREE.Ray): RayHit[] {
    const value = kernelOf(this)
    return call(() => value.raycast(vec(ray.origin), vec(ray.direction))).map((h) => rayHitOf(h, this))
  }

  /** The first exact hit of each ray (null where it misses), for many rays at once. */
  intersectRays(rays: Iterable<THREE.Ray>): (RayHit | null)[] {
    const value = kernelOf(this)
    const list = [...rays]
    const hits = call(() => value.raycastMany(list.map((r) => vec(r.origin)), list.map((r) => vec(r.direction))))
    return hits.map((h) => (h === null ? null : rayHitOf(h, this)))
  }

  /** Frees what the kernel keeps for queries of the body (its meshes and bounds); the body stays as
   * it is, and the next query builds what it needs again. */
  compact(): void {
    const value = kernelOf(this)
    call(() => value.compact())
  }

  /** The body's contour seen along `direction` (in its frame, from the body towards the viewer;
   * default +z, from the front): the curves where its faces turn away, as curves of their own where
   * the body is. */
  silhouette(direction?: THREE.Vector3Like): ShapeList<BrepEdge> {
    const value = kernelOf(this)
    return toThree(call(() => value.silhouette(direction === undefined ? undefined : vec(direction))), this) as ShapeList<BrepEdge>
  }

  /** A curve (taken where it is) projected onto the body along `direction` (in its frame): the
   * curves on its faces. `nearest` keeps what the projection reaches first. */
  project(curve: BrepEdge | Wire, direction?: THREE.Vector3Like, options: { nearest?: boolean } = {}): ShapeList<BrepEdge> {
    const value = kernelOf(this)
    const c = operand(curve, this, 'project') as sm.Edge | sm.Wire
    return toThree(call(() => value.project(c, direction === undefined ? undefined : vec(direction), options)), this) as ShapeList<BrepEdge>
  }

  /**
   * The body's edges and contours projected onto a plane (in its frame; default the XY plane, seen
   * from +z: a front view): a drawing view's visible lines, in the plane. `hidden: true` gives
   * [visible, hidden]; `tangentEdges` draws the edges between tangent faces too.
   */
  outline(plane?: THREE.Plane, options?: { hidden?: false; tangentEdges?: boolean }): ShapeList<BrepEdge>
  outline(plane: THREE.Plane | undefined, options: { hidden: true; tangentEdges?: boolean }): [ShapeList<BrepEdge>, ShapeList<BrepEdge>]
  outline(plane?: THREE.Plane, options: { hidden?: boolean; tangentEdges?: boolean } = {}): ShapeList<BrepEdge> | [ShapeList<BrepEdge>, ShapeList<BrepEdge>] {
    const value = kernelOf(this)
    const out = call(() => value.outline(plane === undefined ? undefined : toPlane(plane), options))
    return toThree(out, this) as ShapeList<BrepEdge> | [ShapeList<BrepEdge>, ShapeList<BrepEdge>]
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

  /**
   * The body's triangles as a TriangleMesh, in its frame with its transform and material, as an
   * operation's result: as finely as its geometry unless `options` say otherwise (`tolerance`,
   * `angle` in radians), `maxEdge` the longest edge a triangle may have.
   */
  toMesh(options: TessellateOptions = {}): TriangleMesh {
    return tessellateMesh(this, options.tolerance === undefined ? this.tolerance : options.tolerance, options.angle ?? this.angle, { maxEdge: options.maxEdge })
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

/** The result of `op` on a body's kernel value: a body of the same kind, where the body is. */
function same<T extends Body>(body: Body, op: (value: never) => SmBody): T {
  const value = kernelOf(body)
  return adopt(wrap(call(() => op(value as never))) as unknown as T, body)
}

/** `body` with its own material (one that draws its faces' colors), not the one it took over. */
function ownMaterial<T extends Body>(body: T): T {
  state(body).material = null
  return body
}

/** The faces of `body` given to a method (as kernel faces), which must be the body's (or a clone's). */
function ownFaces(body: Body, faces: FacesLike, what: string): sm.Face[] {
  const value = kernelOf(body)
  return (isObject3D(faces) ? [faces] : [...(faces as Iterable<BrepFace>)]).map((f) => {
    if (!(f instanceof BrepFace)) throw new TypeError(`${what}: give faces of this body, not ${describe(f)}`)
    const owner = state(f).owner
    if (owner === null || state(owner).held?.value !== value) throw new RangeError(`${what}: the face is not one of this body's`)
    return subOf(f) as sm.Face
  })
}

/** The edges of `body` given to a method (as kernel edges), which must be the body's (or a clone's). */
function ownEdges(body: Body, edges: BrepEdge | Iterable<BrepEdge>, what: string): sm.Edge[] {
  const value = kernelOf(body)
  return (isObject3D(edges) ? [edges] : [...(edges as Iterable<BrepEdge>)]).map((e) => {
    if (!(e instanceof BrepEdge)) throw new TypeError(`${what}: give edges of this body, not ${describe(e)}`)
    const owner = state(e).owner
    if (owner === null || state(owner).held?.value !== value) throw new RangeError(`${what}: the edge is not one of this body's`)
    return subOf(e) as sm.Edge
  })
}

/** A color as the kernel's (sRGB, 0 to 1). */
function srgb(color: THREE.ColorRepresentation): [number, number, number] {
  const out = { r: 0, g: 0, b: 0 }
  new THREE.Color(color).getRGB(out, THREE.SRGBColorSpace)
  return [out.r, out.g, out.b]
}

/** A placement target of `on()`: a face (where it is), a THREE.Plane or a THREE.Matrix4 (in `into`'s frame). */
function placement(target: BrepFace | THREE.Plane | THREE.Matrix4, into: THREE.Object3D): sm.Plane | sm.Face | sm.Location {
  if ((target as THREE.Plane).isPlane) return toPlane(target as THREE.Plane)
  if (isMatrix4(target)) return location(target)
  return operand(target, into, 'on') as sm.Face
}

/** What push, warp and flatten take as a region: a sketch, face or curve (where it is) or points (in the body's frame). */
export type RegionLike = Sketch | BrepFace | Wire | BrepEdge | Iterable<THREE.Vector3Like>

function regionOf(region: RegionLike, into: Body, what: string): sm.Sketch | sm.Face | sm.Wire | sm.Edge | sm.Vector[] {
  if (isObject3D(region)) return operand(region, into, what) as sm.Sketch | sm.Face | sm.Wire | sm.Edge
  return [...(region as Iterable<THREE.Vector3Like>)].map((p) => vec(p))
}

/** Options of push (smlibpy's): how far and which way the region of a face moves. */
export interface PushOptions {
  /** A distance along the face's normal there, or a Vector3 (in the body's frame). */
  by?: number | THREE.Vector3Like | null
  /** The point to move to instead. */
  to?: THREE.Vector3Like | null
  /** The direction to move along instead of the face's normal. */
  normal?: THREE.Vector3Like | null
  /** How far around `at` the face follows. */
  radius?: number | null
  continuity?: string
}

function pushOptions(o: PushOptions): Record<string, unknown> {
  return {
    ...o,
    by: o.by == null || typeof o.by === 'number' ? o.by : vec(o.by),
    to: o.to == null ? o.to : vec(o.to),
    normal: o.normal == null ? o.normal : vec(o.normal),
  }
}

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

/** @internal
 * The arrays of the tessellation three would draw of a body (made now if need be), for another
 * thread; null where there is none (an empty body, or one the kernel cannot tessellate). */
export function drawnData(body: Body): TessellationData | null {
  const tess = drawnTessellation(body)
  return tess === null ? null : tessellationData(tess)
}

/** @internal
 * Gives a body the tessellation another thread made of the same kernel body with the same settings
 * (`drawnData`), so that three draws it without tessellating it again. */
export function takeDrawn(body: Body, data: TessellationData): void {
  const s = state(body)
  if (s.held === null || s.tess !== null) return
  const key = `${s.tolerance}|${s.angle}`
  if (!s.held.tessellations.has(key)) s.held.tessellations.set(key, fromTessellationData(data))
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
  // (faces with colors of their own: the geometry carries the colors, faces without one the body color)
  const held = state(body).held
  const colored = held !== null && faceColors(held.value) !== null
  return new THREE.MeshStandardMaterial({
    color: colored ? 0xffffff : BODY_COLOR,
    vertexColors: colored,
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
  reference?: BrepFace | Iterable<BrepFace> | null
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

  /** Mass, volume, area, center and inertia (in three's axes, about the center) for a density;
   * `accuracy` the relative accuracy of the integration. */
  massProperties(density = 1, accuracy: number | null = null): MassProperties {
    const value = kernelOf(this) as sm.Part
    return new MassProperties(call(() => value.massProperties(density, accuracy)))
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

  /** What this part and the others share (smlibpy's `a & b`); with a sheet or a face, the piece of
   * it inside the part (a Shell). */
  intersect(sheet: Shell | BrepFace): Shell
  intersect(...others: (Part | Iterable<Part>)[]): Part
  intersect(...others: (Part | Shell | BrepFace | Iterable<Part>)[]): Part | Shell {
    const [first] = others
    if (others.length === 1 && ((first instanceof Shell && !(first instanceof Sketch)) || first instanceof BrepFace || first instanceof Sketch)) {
      const value = kernelOf(this) as sm.Part
      const sheet = operand(first, this, 'intersect') as sm.Shell | sm.Face
      return adopt(wrap(call(() => value.intersect(sheet))) as Shell, this)
    }
    return this.boolean('intersect', others as (Part | Iterable<Part>)[])
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

  /**
   * A hollow part with walls `thickness` thick, open at `openings` (faces of this part); `outward`
   * grows the walls outward, `corners` 'round' or 'sharp', `walls` other thicknesses for some faces
   * (a Map of faces to thicknesses, or [faces, thickness] pairs).
   */
  shell(thickness: number, openings: FacesLike | null = null, options: { outward?: boolean; corners?: string | null; walls?: ReadonlyMap<BrepFace, number> | Iterable<readonly [FacesLike, number]> | null } = {}): Part {
    const value = kernelOf(this) as sm.Part
    const o = openings === null ? null : ownFaces(this, openings, 'shell')
    const walls = options.walls == null ? options.walls : [...options.walls].map(([faces, t]) => [ownFaces(this, faces, 'shell'), t] as const)
    return adopt(wrap(call(() => value.shell(thickness, o, { ...options, walls }))) as Part, this)
  }

  /** The part grown (or shrunk, for a negative distance) by `distance` all round; `corners` 'round'
   * or 'sharp'. */
  offset(distance: number, options: { corners?: string } = {}): Part {
    const value = kernelOf(this) as sm.Part
    return adopt(wrap(call(() => value.offset(distance, options))) as Part, this)
  }

  /** The part on the side of `plane` (in its frame) the plane's normal points to, as three's
   * clipping keeps it; 'below' the other side, 'both' both. A face or sheet splits it too. */
  split(plane: THREE.Plane | BrepFace | Shell, keep?: 'above' | 'below'): Part
  split(plane: THREE.Plane | BrepFace | Shell, keep: 'both'): [Part, Part]
  split(plane: THREE.Plane | BrepFace | Shell, keep: 'above' | 'below' | 'both' = 'above'): Part | [Part, Part] {
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
    return same<Part>(this, (v: sm.Part) => v.mirror(toPlane(plane)))
  }

  // -- cells --------------------------------------------------------------------------------------
  /** The shells of the part: its outer skin and the walls of its voids. */
  shells(): ShapeList<Shell> {
    const value = kernelOf(this) as sm.Part
    return toThree(call(() => value.shells()), this) as ShapeList<Shell>
  }

  /** Its voids (closed cavities), as solids. */
  voids(): ShapeList<Part> {
    const value = kernelOf(this) as sm.Part
    return toThree(call(() => value.voids()), this) as ShapeList<Part>
  }

  /** A part of several cells (regions that keep the faces they share: several materials), of this
   * part and the others (taken where they are). */
  merge(...others: (Part | Iterable<Part>)[]): Part {
    const value = kernelOf(this) as sm.Part
    const parts = flatten(others).map((o) => operand(o, this, 'merge') as sm.Part)
    return adopt(wrap(call(() => value.merge(...parts))) as Part, this)
  }

  /** The cells of a merged part, as parts. */
  cells(): ShapeList<Part> {
    const value = kernelOf(this) as sm.Part
    return toThree(call(() => value.cells()), this) as ShapeList<Part>
  }

  /** The parts a merged part was made of. */
  get sources(): Part[] {
    const value = kernelOf(this) as sm.Part
    return toThree(call(() => value.sources), this) as Part[]
  }

  /** The cell of a merged part a point (in the part's frame) lies in; null outside. */
  cellAt(point: THREE.Vector3Like, tol: number | null = null): Part | null {
    const value = kernelOf(this) as sm.Part
    const cell = call(() => value.cellAt(vec(point), tol))
    return cell === null ? null : (toThree(cell, this) as Part)
  }

  /** Where a point (in the part's frame) lies: 'inside', 'outside', or 'on' with the face, edge or
   * vertex it lies on (within `tol`). */
  classify(point: THREE.Vector3Like, tol: number | null = null): ['inside' | 'outside' | 'on', BrepFace | BrepEdge | BrepVertex | null] {
    const value = kernelOf(this) as sm.Part
    const [where, shape] = call(() => value.classify(vec(point), tol))
    return [where as 'inside' | 'outside' | 'on', shape === null ? null : (toThree(shape, this) as BrepFace | BrepEdge | BrepVertex)]
  }

  // -- features -----------------------------------------------------------------------------------
  /** The sheets a fillet of these edges would add, without making it (to show it before). */
  filletPreview(edges: EdgesLike, radius: number, options: { propagate?: boolean } = {}): ShapeList<Shell> {
    const value = kernelOf(this) as sm.Part
    const e = this.own(edges, 'filletPreview')
    return toThree(call(() => value.filletPreview(e, radius, options)), this) as ShapeList<Shell>
  }

  /** The part with a tool's outline (a body, face, or curves, taken where they are) imprinted on its
   * faces (projected along `direction`, in the part's frame), splitting them; `nearest` imprints on
   * the faces the projection reaches first. */
  imprint(tool: Body | BrepFace | BrepEdge | Wire | Iterable<BrepFace | BrepEdge | Wire>, direction: THREE.Vector3Like | null = null, options: { nearest?: boolean } = {}): Part {
    const value = kernelOf(this) as sm.Part
    const t = isObject3D(tool) ? operand(tool, this, 'imprint') : [...(tool as Iterable<BrepFace | BrepEdge | Wire>)].map((x) => operand(x, this, 'imprint'))
    return adopt(wrap(call(() => value.imprint(t as never, direction === null ? null : vec(direction), options))) as Part, this)
  }

  /** Sections `step` apart along `axis` (in the part's frame; default +z, so that they lie as
   * sketches do, parallel to XY), as sketches. */
  slices(step: number, axis?: THREE.Vector3Like): Sketch[] {
    const value = kernelOf(this) as sm.Part
    return toThree(call(() => value.slices(step, axis === undefined ? undefined : vec(axis))), this) as Sketch[]
  }

  /** The part without its fillets (or those faces of them given, or those up to `maxRadius`); with
   * `partial`, the ones the kernel cannot remove stay. */
  removeFillets(faces: FacesLike | null = null, options: { maxRadius?: number | null; partial?: boolean } = {}): Part {
    const value = kernelOf(this) as sm.Part
    const f = faces === null ? null : ownFaces(this, faces, 'removeFillets')
    return adopt(wrap(call(() => value.removeFillets(f, options))) as Part, this)
  }

  /** The part without these faces (holes, bosses, pockets), the faces around closed over them. */
  removeFaces(faces: FacesLike, options: { partial?: boolean } = {}): Part {
    const value = kernelOf(this) as sm.Part
    return adopt(wrap(call(() => value.removeFaces(ownFaces(this, faces, 'removeFaces'), options))) as Part, this)
  }

  // -- molds --------------------------------------------------------------------------------------
  /** How every face drafts for a mold pulled along `direction` (in the part's frame); `minAngle`
   * (radians) the draft a face needs. */
  draftAnalysis(direction: THREE.Vector3Like, options: { minAngle?: number } = {}): DraftAnalysis {
    const value = kernelOf(this) as sm.Part
    const k = call(() => value.draftAnalysis(vec(direction), { minAngle: options.minAngle === undefined ? undefined : degrees(options.minAngle) }))
    return new DraftAnalysis(k, this, (faces) => ShapeList.from(faces) as ShapeList<BrepFace>)
  }

  /** The parting lines for a mold pulled along `direction` (in the part's frame): where the faces
   * turn from facing it to facing away. */
  partingLine(direction: THREE.Vector3Like): ShapeList<Wire> {
    const value = kernelOf(this) as sm.Part
    return toThree(call(() => value.partingLine(vec(direction))), this) as ShapeList<Wire>
  }

  /** The faces given tilted by `angle` (radians) about where they meet `neutralPlane` (a THREE.Plane
   * in the part's frame, or a face), for a mold pulled along that plane's normal. */
  draft(faces: FacesLike, angle: number, neutralPlane: THREE.Plane | BrepFace): Part {
    const value = kernelOf(this) as sm.Part
    const plane = (neutralPlane as THREE.Plane).isPlane ? toPlane(neutralPlane as THREE.Plane) : (operand(neutralPlane, this, 'draft') as sm.Face)
    return adopt(wrap(call(() => value.draft(ownFaces(this, faces, 'draft'), degrees(angle), plane))) as Part, this)
  }

  // -- editing faces ------------------------------------------------------------------------------
  /** The faces given moved by a matrix or a vector (in the part's frame), the faces around them
   * following. */
  moveFaces(faces: FacesLike, by: THREE.Matrix4 | THREE.Vector3Like): Part {
    const value = kernelOf(this) as sm.Part
    const b = isMatrix4(by) ? location(by) : vec(by)
    return adopt(wrap(call(() => value.moveFaces(ownFaces(this, faces, 'moveFaces'), b))) as Part, this)
  }

  /** The faces given moved along their normals by `distance`. */
  offsetFaces(faces: FacesLike, distance: number): Part {
    const value = kernelOf(this) as sm.Part
    return adopt(wrap(call(() => value.offsetFaces(ownFaces(this, faces, 'offsetFaces'), distance))) as Part, this)
  }

  /** A face pushed (or pulled) at a point of it (in the part's frame): a smooth bump or dent. */
  push(face: BrepFace, at: THREE.Vector3Like, options: PushOptions = {}): Part {
    const value = kernelOf(this) as sm.Part
    const [f] = ownFaces(this, face, 'push')
    return adopt(wrap(call(() => value.push(f, vec(at), pushOptions(options)))) as Part, this)
  }

  /** A region of a face moved by `by` (a distance along its normal or a Vector3), the face bending
   * smoothly around it. */
  warp(face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options: { continuity?: string } = {}): Part {
    const value = kernelOf(this) as sm.Part
    const [f] = ownFaces(this, face, 'warp')
    return adopt(wrap(call(() => value.warp(f, regionOf(region, this, 'warp') as never, typeof by === 'number' ? by : vec(by), options))) as Part, this)
  }

  /** A region of a face pressed flat onto a plane (a THREE.Plane in the part's frame, or a face). */
  flatten(face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options: { continuity?: string } = {}): Part {
    const value = kernelOf(this) as sm.Part
    const [f] = ownFaces(this, face, 'flatten')
    const p = (plane as THREE.Plane).isPlane ? toPlane(plane as THREE.Plane) : (operand(plane, this, 'flatten') as sm.Face)
    return adopt(wrap(call(() => value.flatten(f, regionOf(region, this, 'flatten') as never, p, options))) as Part, this)
  }

  // -- the same kind of body ----------------------------------------------------------------------
  /** The part placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (both in its frame):
   * its origin to the face's center, its z axis along the face's normal. */
  on(target: BrepFace | THREE.Plane | THREE.Matrix4): Part {
    return same<Part>(this, (v: sm.Part) => v.on(placement(target, this)))
  }

  /** A copy whose faces and edges are all NURBS. */
  toNurbs(): Part {
    return same<Part>(this, (v: sm.Part) => v.toNurbs())
  }

  /** The part with gaps, tolerances and topology repaired (mostly for imported parts). */
  heal(): Part {
    return same<Part>(this, (v: sm.Part) => v.heal() as sm.Part)
  }

  /** The part with these faces colored (the color stays with them through later operations, and
   * files keep it); null takes it off. */
  colorFaces(faces: FacesLike, color: THREE.ColorRepresentation | null): Part {
    const f = ownFaces(this, faces, 'colorFaces')
    return ownMaterial(same<Part>(this, (v: sm.Part) => v.colored(color === null ? null : srgb(color), { faces: f })))
  }

  /** The part with these faces named (the name stays with them through later operations). */
  nameFaces(faces: FacesLike, name: string | null): Part {
    const f = ownFaces(this, faces, 'nameFaces')
    return same<Part>(this, (v: sm.Part) => v.named(name, { faces: f }))
  }

  // -- deformations -----------------------------------------------------------------------------
  /** The part twisted about an axis (default: its y axis) by `angle` radians over its length; see `twist`. */
  twist(angle: number, options: deformations.TwistOptions = {}): Part {
    return deformations.twist(this, angle, options)
  }

  /** The part tapered along an axis (default: its y axis): its cross-sections scaled from 1 to `scale`; see `taper`. */
  taper(scale: number, options: deformations.TaperOptions = {}): Part {
    return deformations.taper(this, scale, options)
  }

  /** The part bent by `angle` radians (by default up, toward +y, about an axis along z); see `bend`. */
  bend(angle: number, options: deformations.BendOptions = {}): Part {
    return deformations.bend(this, angle, options)
  }

  /** The part wrapped around an axis laid out flat; see `unroll`. */
  unroll(options: deformations.UnrollOptions): Part {
    return deformations.unroll(this, options)
  }

  /** The part deformed by a lattice (in the part's frame); see `Lattice.apply`. */
  deform(lattice: deformations.Lattice, options: { tolerance?: number | null } = {}): Part {
    return lattice.apply(this, options)
  }

  // -- sheet metal ------------------------------------------------------------------------------
  /** The sheet folded along a line (a THREE.Ray in its frame, or a straight BrepEdge) by `angle` radians; see `fold`. */
  fold(line: THREE.Ray | BrepEdge, angle: number, options: sheetMetal.FoldOptions): Part {
    return sheetMetal.fold(this, line, angle, options)
  }

  /** The sheet with a flange along one of its straight edges; see `flange`. */
  flange(edge: BrepEdge | Iterable<BrepEdge>, length: number, options: sheetMetal.FlangeOptions): Part {
    return sheetMetal.flange(this, edge, length, options)
  }

  /** The bends of the sheet, their axes in its frame; see `bends`. */
  bends(options: { kFactor?: sheetMetal.KFactor } = {}): sheetMetal.Bend[] {
    return sheetMetal.bends(this, options)
  }

  /** The sheet with every bend flat again; see `unfold`. */
  unfold(options: sheetMetal.UnfoldOptions = {}): Part {
    return sheetMetal.unfold(this, options)
  }

  /** The flat pattern of the sheet, in the XY plane of its frame; see `flatPattern`. */
  flatPattern(options: sheetMetal.UnfoldOptions = {}): sheetMetal.FlatPattern {
    return sheetMetal.flatPattern(this, options)
  }

  /** The kernel edges for `edges`, which must be this part's (or a clone's). */
  private own(items: EdgesLike | FacesLike, what: string): (sm.Edge | sm.Face | sm.Wire)[] {
    const value = kernelOf(this)
    const list = isObject3D(items) ? [items] : [...(items as Iterable<BrepEdge | BrepFace | Wire>)]
    return list.map((x) => {
      if (!(x instanceof BrepEdge || x instanceof BrepFace || x instanceof Wire)) throw new TypeError(`${what}: give edges or faces of this part, not ${describe(x)}`)
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

  /** The sheet twisted about an axis (default: its y axis) by `angle` radians; see `twist`. */
  twist(angle: number, options: deformations.TwistOptions = {}): Shell {
    return deformations.twist(this, angle, options)
  }

  /** The sheet tapered along an axis (default: its y axis); see `taper`. */
  taper(scale: number, options: deformations.TaperOptions = {}): Shell {
    return deformations.taper(this, scale, options)
  }

  /** The sheet bent by `angle` radians (by default up, toward +y, about an axis along z); see `bend`. */
  bend(angle: number, options: deformations.BendOptions = {}): Shell {
    return deformations.bend(this, angle, options)
  }

  /** The sheet wrapped around an axis laid out flat; see `unroll`. */
  unroll(options: deformations.UnrollOptions): Shell {
    return deformations.unroll(this, options)
  }

  /** The sheet deformed by a lattice (in the sheet's frame); see `Lattice.apply`. */
  deform(lattice: deformations.Lattice, options: { tolerance?: number | null } = {}): Shell {
    return lattice.apply(this, options)
  }

  /** The sheet moved `distance` along its normals (a parallel surface). */
  offset(distance: number): Shell {
    return same<Shell>(this, (v: sm.Shell) => v.offset(distance))
  }

  /** The sheet cut along curves on it (taken where they are), keeping the side of `keep` (a point in
   * the sheet's frame on or near the side to keep), or both sides as faces of their own ('split'). */
  trim(curves: BrepEdge | Wire | Iterable<BrepEdge | Wire>, keep: THREE.Vector3Like | 'split'): Shell {
    const c = isObject3D(curves) ? operand(curves, this, 'trim') : [...(curves as Iterable<BrepEdge | Wire>)].map((x) => operand(x, this, 'trim'))
    return same<Shell>(this, (v: sm.Shell) => v.trim(c as never, typeof keep === 'string' ? keep : vec(keep)))
  }

  /** The sheet with its normals turned the other way. */
  flipped(): Shell {
    return same<Shell>(this, (v: sm.Shell) => v.flipped())
  }

  /** The sheet extended past its free edges (or those given of them) by `distance`; `continuity`
   * 'G1' or 'G2' with the surface. */
  extend(distance: number, options: { sides?: BrepEdge | Iterable<BrepEdge> | null; continuity?: string } = {}): Shell {
    const sides = options.sides == null ? options.sides : ownEdges(this, options.sides, 'extend')
    return same<Shell>(this, (v: sm.Shell) => v.extend(distance, { ...options, sides }))
  }

  /** The sheet with one of its free edges moved onto a curve (taken where it is), the surface
   * following over `extent` of its width. */
  matchEdge(edge: BrepEdge, target: BrepEdge | Wire, options: { extent?: number } = {}): Shell {
    const [e] = ownEdges(this, edge, 'matchEdge')
    const t = operand(target, this, 'matchEdge') as sm.Edge | sm.Wire
    return same<Shell>(this, (v: sm.Shell) => v.matchEdge(e, t, options))
  }

  /** Two neighbouring faces of the sheet as one. */
  mergeFaces(a: BrepFace, b: BrepFace): Shell {
    const [fa, fb] = ownFaces(this, [a, b], 'mergeFaces')
    return same<Shell>(this, (v: sm.Shell) => v.mergeFaces(fa, fb))
  }

  /** A face of the sheet pushed at a point (in the sheet's frame): a smooth bump or dent. */
  push(face: BrepFace, at: THREE.Vector3Like, options: PushOptions = {}): Shell {
    const [f] = ownFaces(this, face, 'push')
    return same<Shell>(this, (v: sm.Shell) => v.push(f, vec(at), pushOptions(options)))
  }

  /** A region of a face of the sheet moved by `by` (a distance along its normal or a Vector3). */
  warp(face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options: { continuity?: string } = {}): Shell {
    const [f] = ownFaces(this, face, 'warp')
    const r = regionOf(region, this, 'warp')
    return same<Shell>(this, (v: sm.Shell) => v.warp(f, r as never, typeof by === 'number' ? by : vec(by), options))
  }

  /** A region of a face of the sheet pressed flat onto a plane (a THREE.Plane in its frame, or a face). */
  flatten(face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options: { continuity?: string } = {}): Shell {
    const [f] = ownFaces(this, face, 'flatten')
    const r = regionOf(region, this, 'flatten')
    const p = (plane as THREE.Plane).isPlane ? toPlane(plane as THREE.Plane) : (operand(plane, this, 'flatten') as sm.Face)
    return same<Shell>(this, (v: sm.Shell) => v.flatten(f, r as never, p, options))
  }

  /** This sheet and other sheets, parts or faces (taken where they are), sewn into one where they meet. */
  fuse(...others: (Shell | Part | BrepFace | Iterable<Shell | Part | BrepFace>)[]): Shell {
    const tools = flatten(others).map((o) => operand(o, this, 'fuse') as sm.Shell)
    return same<Shell>(this, (v: sm.Shell) => v.fuse(...tools))
  }

  /** The sheet with what lies inside the parts (taken where they are) cut away. */
  cut(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell {
    const tools = flatten(others).map((o) => operand(o, this, 'cut') as sm.Part)
    return same<Shell>(this, (v: sm.Shell) => v.cut(...tools))
  }

  /** The piece of the sheet inside the parts (taken where they are). */
  intersect(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell {
    const tools = flatten(others).map((o) => operand(o, this, 'intersect') as sm.Part)
    return same<Shell>(this, (v: sm.Shell) => v.intersect(...tools))
  }

  /** The sheet mirrored in `plane` (in its frame). */
  mirror(plane: THREE.Plane): Shell {
    return same<Shell>(this, (v: sm.Shell) => v.mirror(toPlane(plane)))
  }

  /** The sheet placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (both in its frame). */
  on(target: BrepFace | THREE.Plane | THREE.Matrix4): Shell {
    return same<Shell>(this, (v: sm.Shell) => v.on(placement(target, this)))
  }

  /** A copy whose faces and edges are all NURBS. */
  toNurbs(): Shell {
    return same<Shell>(this, (v: sm.Shell) => v.toNurbs())
  }

  /** The sheet with gaps, tolerances and topology repaired; a Part where it closes around a volume. */
  heal(): Shell | Part {
    return same<Shell | Part>(this, (v: sm.Shell) => v.heal())
  }

  /** The sheet with these faces colored (files keep it); null takes it off. */
  colorFaces(faces: FacesLike, color: THREE.ColorRepresentation | null): Shell {
    const f = ownFaces(this, faces, 'colorFaces')
    return ownMaterial(same<Shell>(this, (v: sm.Shell) => v.colored(color === null ? null : srgb(color), { faces: f })))
  }

  /** The sheet with these faces named. */
  nameFaces(faces: FacesLike, name: string | null): Shell {
    const f = ownFaces(this, faces, 'nameFaces')
    return same<Shell>(this, (v: sm.Shell) => v.named(name, { faces: f }))
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

/** Options of sweeps (smlibpy's). */
export interface SweepOptions {
  /** Keep the corners of a path of several edges sharp (mitered), or round them. */
  sharpCorners?: boolean | null
  /** Keep the profile's angle to this direction (in the sketch's frame) along the path, or 'frenet'. */
  up?: THREE.Vector3Like | string | null
  /** Turn the profile along the path: radians in all, or a function of the fraction of the path. */
  twist?: number | ((s: number) => number)
  /** Grow the profile along the path: [start, end], [fraction, scale] pairs, or a function. */
  scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null
  /** The profile's point that goes along the path: its center (default), the sketch's origin, or a
   * point (the sketch's own 2D coordinates) or vertex of it. */
  anchor?: 'center' | 'origin' | THREE.Vector2Like | BrepVertex
}

/** A sweep's options as the kernel's. */
function sweepOptions(o: SweepOptions & { rails?: unknown }, into: THREE.Object3D | null): Record<string, unknown> {
  const twist = o.twist
  const anchor = o.anchor
  return {
    ...o,
    twist: twist === undefined ? undefined : typeof twist === 'function' ? (s: number) => degrees(twist(s)) : degrees(twist),
    up: o.up == null || typeof o.up === 'string' ? o.up : vec(o.up),
    anchor: anchor === undefined || typeof anchor === 'string' ? anchor : anchor instanceof BrepVertex ? kernelOfShape(anchor) : [anchor.x, anchor.y],
    // (the kernel takes rails in the free function only: no key for them otherwise)
    ...(o.rails === undefined ? {} : { rails: o.rails === null ? null : toKernel(o.rails, into) }),
  }
}

/**
 * A planar region: drawn in its own 2D coordinates (x, y), which are three's x and y: it lies in the
 * XY plane of its frame and faces +z, as three's ShapeGeometry does, and extrudes along +z, as
 * ExtrudeGeometry does. Place it with its transform, or on a face with on(). Extrude, revolve and
 * sweep it into parts.
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

  /** A solid of revolution about `axis` (a THREE.Ray in the sketch's frame, in its plane) through
   * `angle` radians; by default about the frame's y axis, as THREE.LatheGeometry revolves its points
   * (a sketch elsewhere than in a plane through that axis: about its plane's y axis through its
   * plane's origin). */
  revolve(axis: THREE.Ray | null = null, angle = 2 * Math.PI): Part {
    const value = kernelOf(this) as sm.Sketch
    const about = axis ?? latheAxis(value)
    return adopt(wrap(call(() => value.revolve(about === null ? null : toAxis(about), degrees(angle)))) as Part, this)
  }

  /** A solid: the region swept along `path` (a BrepEdge or Wire where it is, or a THREE.Curve in the
   * sketch's frame). */
  sweep(path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options: SweepOptions = {}): Part {
    const value = kernelOf(this) as sm.Sketch
    const p = pathOf(path, this)
    return adopt(wrap(call(() => value.sweep(p, sweepOptions(options, this) as never))) as Part, this)
  }

  /**
   * The sketch placed on `target`: a face (where it is in the world; the sketch's origin goes to
   * the face's center, its normal along the face's), a THREE.Plane, or a THREE.Matrix4 (both in
   * the sketch's frame).
   */
  override on(target: BrepFace | THREE.Plane | THREE.Matrix4): Sketch {
    return same<Sketch>(this, (v: sm.Sketch) => v.on(placement(target, this)))
  }

  /** This region and the others (in the same plane, where they are), fused. */
  override fuse(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    return this.boolean('fuse', others)
  }

  /** This region with the others cut away. */
  override cut(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    return this.boolean('cut', others)
  }

  /** What this region and the others share. */
  override intersect(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    return this.boolean('intersect', others)
  }

  private boolean(op: 'fuse' | 'cut' | 'intersect', others: readonly (Sketch | Iterable<Sketch>)[]): Sketch {
    const value = kernelOf(this) as sm.Sketch
    const tools = flatten(others).map((o) => operand(o, this, op) as sm.Sketch)
    return adopt(wrap(call(() => value[op](...tools))) as Sketch, this)
  }

  /** The region grown (shrunk, negative) by `distance` all round; `corners` 'round' or 'sharp'
   * (`round` rounds the outside corners of an inward offset too). */
  override offset(distance: number, options: { corners?: string; round?: boolean | null } = {}): Sketch {
    return same<Sketch>(this, (v: sm.Sketch) => v.offset(distance, options))
  }

  /** The regions this one or the others cover, but not both. */
  xor(...others: (Sketch | Iterable<Sketch>)[]): Sketch {
    const tools = flatten(others).map((o) => operand(o, this, 'xor') as sm.Sketch)
    return same<Sketch>(this, (v: sm.Sketch) => v.xor(...tools))
  }

  /** The region facing the other way. */
  override flipped(): Sketch {
    return same<Sketch>(this, (v: sm.Sketch) => v.flipped())
  }

  /** The region with its corners cut off (all, or those at `vertices`). */
  chamfer(length: number, vertices: Iterable<BrepVertex | THREE.Vector3Like> | null = null): Sketch {
    const v = vertices === null ? null : [...vertices].map((x) => (x instanceof BrepVertex ? (subOf(x) as sm.Vertex) : vec(x)))
    return same<Sketch>(this, (k: sm.Sketch) => k.chamfer(length, v))
  }

  /** Area, centroid and second moments of the region. */
  sectionProperties(): SectionProperties {
    const value = kernelOf(this) as sm.Sketch
    return new SectionProperties(call(() => value.sectionProperties()))
  }

  /** A solid: the region swung around an outline, as a rim or a frame is (smlibpy's swing): a
   * revolve about z whose circle is the outline (a sketch, face or curve around the z axis, parallel
   * to XY, taken where it is). The region stands in its frame's XZ plane, as for a lathe about z:
   * draw it with x the distance from the z axis and y the height, and stand it up with
   * `.on(new THREE.Matrix4().makeRotationX(Math.PI / 2))`, which turns its y to +z. */
  swing(outline: Sketch | BrepFace | Wire | BrepEdge): Part {
    const value = kernelOf(this) as sm.Sketch
    const o = operand(outline, this, 'swing') as sm.Sketch | sm.Face | sm.Wire | sm.Edge
    return adopt(wrap(call(() => value.swing(o))) as Part, this)
  }

  /** The region mirrored in `plane` (in its frame). */
  override mirror(plane: THREE.Plane): Sketch {
    return same<Sketch>(this, (v: sm.Sketch) => v.mirror(toPlane(plane)))
  }

  /** A copy whose curves are all NURBS. */
  override toNurbs(): Sketch {
    return same<Sketch>(this, (v: sm.Sketch) => v.toNurbs())
  }

  /** The region with these faces colored. */
  override colorFaces(faces: FacesLike, color: THREE.ColorRepresentation | null): Sketch {
    const f = ownFaces(this, faces, 'colorFaces')
    return ownMaterial(same<Sketch>(this, (v: sm.Sketch) => v.colored(color === null ? null : srgb(color), { faces: f })))
  }

  /** The region with these faces named. */
  override nameFaces(faces: FacesLike, name: string | null): Sketch {
    const f = ownFaces(this, faces, 'nameFaces')
    return same<Sketch>(this, (v: sm.Sketch) => v.named(name, { faces: f }))
  }

  /** The region with its corners rounded (all, or those at `vertices`). */
  fillet(radius: number, vertices: Iterable<BrepVertex | THREE.Vector3Like> | null = null): Sketch {
    const value = kernelOf(this) as sm.Sketch
    const v = vertices === null ? null : [...vertices].map((x) => (x instanceof BrepVertex ? (subOf(x) as sm.Vertex) : vec(x)))
    return adopt(wrap(call(() => value.fillet(radius, v))) as Sketch, this)
  }
}

Object.defineProperty(Sketch.prototype, 'isSketch', { value: true })

/** @internal
 * A sweep path as the kernel's curve, in `into`'s frame. */
export function pathOf(path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, into: THREE.Object3D | null): sm.Edge | sm.Wire {
  if (path instanceof BrepEdge || path instanceof Wire) return operand(path, into, 'sweep') as sm.Edge | sm.Wire
  const edges = edges3(path)
  return edges.length === 1 ? edges[0] : call(() => new sm.Wire(edges))
}

/** @internal
 * The axis a sketch revolves about by default: its frame's y axis, as THREE.LatheGeometry revolves
 * its points about y, where that axis lies in the sketch's plane (a sketch in the XY plane); else
 * null, the kernel's default (the y axis of the sketch's plane, through its origin). */
export function latheAxis(value: sm.Sketch): THREE.Ray | null {
  const plane = threePlane(call(() => value.plane))
  const size = Math.max(1, call(() => value.bbox()).diagonal)
  if (Math.abs(plane.constant) > 1e-9 * size || Math.abs(plane.normal.y) > 1e-12) return null
  return new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 1, 0))
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
      vertices.push(p.x, p.y, p.z)
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
export function kernelOfShape(x: BrepFace | BrepEdge | Wire | BrepVertex): sm.Face | sm.Edge | sm.Wire | sm.Vertex {
  return subOf(x)
}

function subOf(x: BrepFace | BrepEdge | Wire | BrepVertex): sm.Face | sm.Edge | sm.Wire | sm.Vertex {
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
  track(o)
  if (incomingSub !== null) {
    s.owner = incomingSub.owner
    s.index = incomingSub.index
    const value = incomingSub.sub
    if (incomingSub.owner === null && (value instanceof sm.Edge || value instanceof sm.Wire)) s.curve = { value, refs: 1 }
    else s.sub = value
    // (a face's name, given with nameFaces or read from a file, is the object's)
    if (value instanceof sm.Face) o.name = value.name ?? ''
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
 * (smlibpy's Face; three has a Face of its own, the face of a raycast hit.)
 */
export class BrepFace extends THREE.Mesh {
  declare readonly isBrepFace: true
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
  distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number {
    const f = this.face
    const o = isObject3D(other) ? operand(other, this, 'distanceTo') : vec(other)
    return call(() => f.distanceTo(o))
  }

  /** The face's edges: its body's (with `seams`, also the seams where its surface meets itself). */
  edges(seams = false): ShapeList<BrepEdge> {
    return ownList(this, 'edges', (f) => (f as sm.Face).edges(seams))
  }

  vertices(): ShapeList<BrepVertex> {
    return ownList(this, 'vertices', (f) => (f as sm.Face).vertices())
  }

  /** The faces of its body that share an edge with it. */
  neighbors(): ShapeList<BrepFace> {
    return ownList(this, 'faces', (f) => (f as sm.Face).neighbors())
  }

  /** Its outer boundary. */
  outerWire(): Wire {
    const f = this.face
    return curveOf(call(() => f.outerWire()), state(this).owner) as Wire
  }

  /** The boundaries of its holes. */
  innerWires(): ShapeList<Wire> {
    const f = this.face
    return toThree(call(() => f.innerWires()), this) as ShapeList<Wire>
  }

  /** All its boundaries, the outer one first. */
  wires(): ShapeList<Wire> {
    const f = this.face
    return toThree(call(() => f.wires()), this) as ShapeList<Wire>
  }

  /** The face's own color (given with colorFaces, or read from a file); null for none. */
  get color(): THREE.Color | null {
    const f = this.face
    const c = call(() => f.color)
    return c === null ? null : new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)
  }

  /** The cells of a merged part the face bounds (one outside, two between cells; none on a sheet). */
  get cells(): number[] {
    const f = this.face
    return call(() => f.cells)
  }

  /** The major radius of a torus face. */
  get majorRadius(): number {
    const f = this.face
    return call(() => f.majorRadius)
  }

  /** The half angle of a cone face, in radians. */
  get coneAngle(): number {
    const f = this.face
    return radians(call(() => f.coneAngle))
  }

  /** A point inside the face (not on its border), in its body's frame. */
  interiorPoint(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const f = this.face
    return vector3(call(() => f.interiorPoint()), target)
  }

  /** The face's point nearest to `point` (both in its body's frame). */
  closestPoint(point: THREE.Vector3Like, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const f = this.face
    return vector3(call(() => f.closestPoint(vec(point))), target)
  }

  /** The parameters (u, v, from 0 to 1 over the face) of its point nearest to `point`. */
  uvAt(point: THREE.Vector3Like, target: THREE.Vector2 = new THREE.Vector2()): THREE.Vector2 {
    const f = this.face
    const [u, v] = call(() => f.uvAt(vec(point)))
    return target.set(u, v)
  }

  /** The face's point at parameters u, v (0 to 1 over the face). */
  positionAt(u: number, v: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const f = this.face
    return vector3(call(() => f.positionAt(u, v)), target)
  }

  /** The curvature at a point (default: the face's center). */
  curvatureAt(point: THREE.Vector3Like | null = null): Curvature {
    const f = this.face
    return curvatureOf(call(() => f.curvatureAt(point === null ? null : vec(point))))
  }

  /** The smallest radius of curvature over the face. */
  minRadius(): number {
    const f = this.face
    return call(() => f.minRadius())
  }

  /** The face's surface as NURBS data: degrees, knots, control points (Vector3s, in its body's
   * frame) and weights (null for a non-rational surface). */
  nurbs(): { degrees: [number, number]; knots: [number[], number[]]; points: THREE.Vector3[][]; weights: number[][] | null } {
    const f = this.face
    const n = call(() => f.nurbs())
    return { degrees: [...n.degrees], knots: [[...n.knots[0]], [...n.knots[1]]], points: n.points.map((row) => row.map((p) => vector3(p))), weights: n.weights === null ? null : n.weights.map((row) => [...row]) }
  }

  /** The exact hits of a ray (in its body's frame) on this face, nearest first. */
  intersectRay(ray: THREE.Ray): RayHit[] {
    const f = this.face
    return call(() => f.raycast(vec(ray.origin), vec(ray.direction))).map((h) => rayHitOf(h, this))
  }

  /** A curve (taken where it is) projected onto the face along its normals: the curves on it. */
  project(curve: BrepEdge | Wire): ShapeList<BrepEdge> {
    const f = this.face
    const c = operand(curve, this, 'project') as sm.Edge | sm.Wire
    return toThree(call(() => f.project(c)), this) as ShapeList<BrepEdge>
  }

  /** The face's iso curves at parameter u or v (0 to 1). */
  iso(options: { u?: number | null; v?: number | null } = {}): ShapeList<BrepEdge> {
    const f = this.face
    return toThree(call(() => f.iso(options)), this) as ShapeList<BrepEdge>
  }

  /**
   * A drawing wrapped onto the face, as a label onto a can: a sketch or curves in their own
   * coordinates (as drawn in their XY plane, wherever they are placed), their origin at `at` (a point of
   * the face, in its body's frame; default its middle), their x axis along `direction`. The curves on
   * the face.
   */
  wrap(shape: BrepEdge | Wire | Sketch | Iterable<BrepEdge>, at: THREE.Vector3Like | BrepVertex | null = null, options: { direction?: THREE.Vector3Like | null } = {}): ShapeList<BrepEdge> {
    const f = this.face
    const drawing = shape instanceof Body ? kernelOf(shape) : isObject3D(shape) ? kernelOfShape(shape as BrepEdge | Wire) : [...(shape as Iterable<BrepEdge>)].map((e) => kernelOfShape(e) as sm.Edge)
    const where = at === null ? null : at instanceof BrepVertex ? (kernelOfShape(at) as sm.Vertex) : vec(at)
    return toThree(call(() => f.wrap(drawing as never, where, { direction: options.direction == null ? options.direction : vec(options.direction) })), this) as ShapeList<BrepEdge>
  }

  /** The face as a sketch (a planar face) where it is. */
  toSketch(): Sketch {
    const f = this.face
    return toThree(call(() => f.toSketch()), this) as Sketch
  }

  /** The face as a sheet of its own where it is. */
  toShell(): Shell {
    const f = this.face
    return toThree(call(() => f.toShell()), this) as Shell
  }

  /** The face moved `distance` along its normals, as a sheet. */
  offset(distance: number): Shell {
    const f = this.face
    return toThree(call(() => f.offset(distance)), this) as Shell
  }

  /** The face split along curves on it (taken where they are): the faces of the split sheet. */
  split(curves: BrepEdge | Wire | Iterable<BrepEdge | Wire>): ShapeList<BrepFace> {
    const f = this.face
    const c = isObject3D(curves) ? operand(curves, this, 'split') : [...(curves as Iterable<BrepEdge | Wire>)].map((x) => operand(x, this, 'split'))
    return toThree(call(() => f.split(c as never)), this) as ShapeList<BrepFace>
  }

  /** The face turned the other way, as a sheet. */
  flipped(): Shell {
    const f = this.face
    return toThree(call(() => f.flipped()), this) as Shell
  }

  /** The face's whole surface, its trims taken off, as a sheet. */
  untrimmed(): Shell {
    const f = this.face
    return toThree(call(() => f.untrimmed()), this) as Shell
  }

  /** The face extended past its edges (or those given of them) by `distance`, as a sheet. */
  extend(distance: number, options: { sides?: BrepEdge | Iterable<BrepEdge> | null; continuity?: string } = {}): Shell {
    const f = this.face
    const owner = state(this).owner
    const sides = options.sides == null || owner === null ? options.sides : ownEdges(owner, options.sides, 'extend')
    return toThree(call(() => f.extend(distance, { ...options, sides: sides as never })), this) as Shell
  }

  /** True for the same face of the same body (of a clone too). */
  equals(other: unknown): boolean {
    if (!(other instanceof BrepFace)) return false
    const a = state(this).sub as sm.Face | null
    const b = state(other).sub as sm.Face | null
    return a !== null && b !== null && call(() => a.equals(b))
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

Object.defineProperty(BrepFace.prototype, 'isBrepFace', { value: true })

accessors(
  BrepFace.prototype,
  (f: BrepFace) => {
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
function ownList<T extends BrepFace | BrepEdge | BrepVertex>(x: BrepFace | BrepEdge, kind: 'faces' | 'edges' | 'vertices', of: (k: sm.Shape) => Iterable<sm.Shape>): ShapeList<T> {
  const value = subOf(x)
  const owner = state(x).owner
  const items = [...call(() => of(value))]
  if (owner === null) {
    if (kind === 'vertices') return ShapeList.from(items.map((v) => sub(BrepVertex, null, -1, v as sm.Vertex))) as ShapeList<T>
    return new ShapeList<T>()
  }
  const all = (owner[kind] as () => ShapeList<T>).call(owner)
  return ShapeList.from(items.map((k) => find(all, k)).filter((x): x is T => x !== undefined)) as ShapeList<T>
}

/** The object of `list` whose kernel shape is `k`. */
function find<T extends BrepFace | BrepEdge | BrepVertex>(list: readonly T[], k: sm.Shape): T | undefined {
  for (const x of list) if (state(x).sub === k) return x
  for (const x of list) if ((state(x).sub as { equals(o: unknown): boolean } | null)?.equals(k)) return x
  return undefined
}

/**
 * An edge: a THREE.Line along the exact curve. Either an edge of a body (in its body's frame;
 * `owner` is the body), or a curve of its own (Segment, Spline, Helix, ... or one of three's curves),
 * placed by its own transform. (smlibpy's Edge, named as BrepFace and BrepVertex are.)
 */
export class BrepEdge extends THREE.Line {
  declare readonly isBrepEdge: true
  /** An edge along one of three's curves (LineCurve3, CubicBezierCurve3, CatmullRomCurve3,
   * CurvePath, ...) in its own frame. Without a curve, an empty edge. */
  constructor(curve?: THREE.Curve<THREE.Vector3> | null, material?: THREE.Material | null) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
    if (material != null) this.material = material
    if (internal(this) || curve == null) return
    const edges = edges3(curve)
    if (edges.length !== 1) throw new RangeError(`BrepEdge: the curve makes ${edges.length} edges; a Wire takes them`)
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
  distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number {
    const e = this.edge
    const o = isObject3D(other) ? operand(other, this, 'distanceTo') : vec(other)
    return call(() => e.distanceTo(o))
  }

  /** The faces of its body that meet at it. */
  faces(): ShapeList<BrepFace> {
    return ownList(this, 'faces', (e) => (e as sm.Edge).faces())
  }

  vertices(): ShapeList<BrepVertex> {
    return ownList(this, 'vertices', (e) => (e as sm.Edge).vertices())
  }

  /** The same curve the other way round (a curve of its own, where this one is). */
  reversed(): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.reversed()), this) as BrepEdge
  }

  /** How far the edge's curve, its ends and its faces may lie apart (the kernel's tolerance of the
   * edge; a RangeError for a curve of its own). */
  get tolerance(): number {
    const e = this.edge
    return call(() => e.tolerance)
  }

  /** True for a seam, where a closed surface meets itself. */
  get isSeam(): boolean {
    const e = this.edge
    return call(() => e.isSeam)
  }

  /** "convex", "concave" or "smooth": how the faces meet at the edge. */
  get convexity(): string {
    const e = this.edge
    return call(() => e.convexity)
  }

  /** The angle between the edge's faces, through the body, in radians (π/2 at a box's edges). */
  get dihedralAngle(): number {
    const e = this.edge
    return radians(call(() => e.dihedralAngle))
  }

  /** True where the faces meet convexly (an outside corner). */
  isConvex(): boolean {
    const e = this.edge
    return call(() => e.isConvex())
  }

  /** The direction of a straight edge. */
  get direction(): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.direction))
  }

  /** The normal of the plane of a planar curve (an arc's axis). */
  get normal(): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.normal))
  }

  /** How smoothly the edge's faces meet along it; `angleTol` in radians. */
  continuity(samples = 16, options: { angleTol?: number; curvatureTol?: number } = {}): Continuity {
    const e = this.edge
    return continuityOf(call(() => e.continuity(samples, { ...options, angleTol: options.angleTol === undefined ? undefined : degrees(options.angleTol) })))
  }

  /** The edge's point nearest to `point` (both in its frame). */
  closestPoint(point: THREE.Vector3Like | BrepVertex, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const e = this.edge
    return vector3(call(() => e.closestPoint(at(point) as sm.Vector | sm.Vertex)), target)
  }

  /** The fraction of the length at which the edge comes nearest to `point`. */
  paramAtPoint(point: THREE.Vector3Like | BrepVertex): number {
    const e = this.edge
    return call(() => e.paramAtPoint(at(point) as sm.Vector | sm.Vertex))
  }

  /** The part of the edge from `start` to `end`: fractions of the length or points on it. */
  trim(start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.trim(at(start), at(end))), this) as BrepEdge
  }

  /** The edge in two at a fraction of its length or a point on it. */
  split(where: number | THREE.Vector3Like | BrepVertex): [BrepEdge, BrepEdge] {
    const e = this.edge
    return call(() => e.split(at(where))).map((x) => placedCurve(x, this)) as [BrepEdge, BrepEdge]
  }

  /** The edge made longer by `distance` at its 'end' (default), 'start' or 'both'; `continuity`
   * 'G1', 'G2' or 'natural' for curves that are not lines or arcs. */
  extend(distance: number, options: { end?: string; continuity?: string } = {}): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.extend(distance, options)), this) as BrepEdge
  }

  /** Where the edge crosses another shape (taken where it is), in its frame. */
  intersections(other: Body | BrepFace | BrepEdge | Wire | Iterable<Body | BrepFace | BrepEdge | Wire>, options: { tolerance?: number | null } = {}): THREE.Vector3[] {
    const e = this.edge
    const o = toKernel(isObject3D(other) ? other : [...(other as Iterable<Body>)], this)
    return call(() => e.intersections(o as never, options)).map((p) => vector3(p))
  }

  /** The fractions of the length at which the edge crosses another shape. */
  intersectionParams(other: Body | BrepFace | BrepEdge | Wire | Iterable<Body | BrepFace | BrepEdge | Wire>, options: { tolerance?: number | null } = {}): number[] {
    const e = this.edge
    const o = toKernel(isObject3D(other) ? other : [...(other as Iterable<Body>)], this)
    return call(() => e.intersectionParams(o as never, options))
  }

  /** Where the edge crosses itself. */
  selfIntersections(options: { tolerance?: number | null } = {}): THREE.Vector3[] {
    const e = this.edge
    return call(() => e.selfIntersections(options)).map((p) => vector3(p))
  }

  /** The curvature (1 / radius) at a fraction of the length. */
  curvatureAt(t = 0.5): number {
    const e = this.edge
    return call(() => e.curvatureAt(t))
  }

  /** The radius of curvature at a fraction of the length (Infinity where it is straight). */
  radiusAt(t = 0.5): number {
    const e = this.edge
    return call(() => e.radiusAt(t))
  }

  /** The smallest radius of curvature along the edge. */
  minRadius(): number {
    const e = this.edge
    return call(() => e.minRadius())
  }

  /** The fraction of the length where the radius of curvature is smallest. */
  minRadiusAt(): number {
    const e = this.edge
    return call(() => e.minRadiusAt())
  }

  /** The fractions of the length where the curve turns the other way. */
  inflections(): number[] {
    const e = this.edge
    return call(() => e.inflections())
  }

  /** A parallel curve `distance` away, in the curve's plane (or `plane`, in its frame). */
  offset(distance: number, options: { plane?: THREE.Plane | null } = {}): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.offset(distance, { plane: options.plane == null ? options.plane : toPlane(options.plane) })), this) as BrepEdge
  }

  /** The curve as lines and arcs within `tolerance`, as a wire. */
  toArcs(tolerance?: number): Wire {
    const e = this.edge
    return placedCurve(call(() => e.toArcs(tolerance)), this) as Wire
  }

  /** The curve bent locally to pass through a point (in its frame), with a tangent there if given. */
  through(point: THREE.Vector3Like | BrepVertex, options: { tangent?: THREE.Vector3Like | null; at?: number | null } = {}): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.through(at(point) as never, { ...options, tangent: options.tangent == null ? options.tangent : vec(options.tangent) })), this) as BrepEdge
  }

  /** The curve with its ends moved onto points (and turned to tangents), in its frame. */
  match(options: { start?: THREE.Vector3Like | BrepVertex | null; end?: THREE.Vector3Like | BrepVertex | null; startTangent?: THREE.Vector3Like | null; endTangent?: THREE.Vector3Like | null } = {}): BrepEdge {
    const e = this.edge
    const o = {
      start: options.start == null ? options.start : at(options.start),
      end: options.end == null ? options.end : at(options.end),
      startTangent: options.startTangent == null ? options.startTangent : vec(options.startTangent),
      endTangent: options.endTangent == null ? options.endTangent : vec(options.endTangent),
    }
    return placedCurve(call(() => e.match(o as never)), this) as BrepEdge
  }

  /** The edges of its body that run on from this one tangentially, this one included. */
  tangentChain(): ShapeList<BrepEdge> {
    const e = this.edge
    return toThree(call(() => e.tangentChain()), this) as ShapeList<BrepEdge>
  }

  /** The curve as NURBS data: degree, knots, control points (Vector3s, in its frame) and weights
   * (null for a non-rational curve). */
  nurbs(): { degree: number; knots: number[]; points: THREE.Vector3[]; weights: number[] | null } {
    const e = this.edge
    const n = call(() => e.nurbs())
    return { degree: n.degree, knots: [...n.knots], points: n.points.map((p) => vector3(p)), weights: n.weights === null ? null : [...n.weights] }
  }

  /** The curve mirrored in `plane` (in its frame), a curve of its own where this one is. */
  mirror(plane: THREE.Plane): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.mirror(toPlane(plane))), this) as BrepEdge
  }

  /** The curve placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (in its frame): its
   * origin to the face's center, its z axis along the face's normal. */
  on(target: BrepFace | THREE.Plane | THREE.Matrix4): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.on(placement(target, this))), this) as BrepEdge
  }

  /** The curve with the knots it does not need taken out. */
  removeKnots(): BrepEdge {
    const e = this.edge
    return placedCurve(call(() => e.removeKnots()), this) as BrepEdge
  }

  /** True for the same edge of the same body (of a clone too), or the same curve. */
  equals(other: unknown): boolean {
    if (!(other instanceof BrepEdge)) return false
    const a = state(this).sub ?? state(this).curve?.value ?? null
    const b = state(other).sub ?? state(other).curve?.value ?? null
    return a !== null && b !== null && call(() => (a as sm.Edge).equals(b))
  }

  /** An edge of a NURBS curve's data (the inverse of nurbs()): degree, knots (every knot as often as
   * its multiplicity), control points (Vector3s) and weights (null: non-rational). */
  static fromNurbs(data: { degree: number; knots: readonly number[]; points: readonly THREE.Vector3Like[]; weights?: readonly number[] | null }): BrepEdge {
    return curveOf(call(() => sm.Edge.fromNurbs({ degree: data.degree, knots: data.knots, points: data.points.map((p) => vec(p)), weights: data.weights ?? null }))) as BrepEdge
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

Object.defineProperty(BrepEdge.prototype, 'isBrepEdge', { value: true })

accessors(
  BrepEdge.prototype,
  (e: BrepEdge) => {
    const s = state(e)
    if (s.ownGeometry === null) {
      const tess = ownerTessellation(e)
      if (s.owner !== null) s.ownGeometry = tess === null ? PLACEHOLDER : lineGeometry(tess.edgePoints[s.index].slice())
      else s.ownGeometry = s.curve === null ? PLACEHOLDER : lineGeometry(curvePolyline(s.curve.value))
    }
    return s.ownGeometry
  },
  (e: BrepEdge) => new THREE.LineBasicMaterial({ color: state(e).owner === null ? 0x20242c : HIGHLIGHT }),
)

/** A point given to a curve's method: a fraction of its length, a point, or a vertex, as the kernel's. */
function at(point: number | THREE.Vector3Like | BrepVertex): number | sm.Vector | sm.Vertex {
  if (typeof point === 'number') return point
  if (point instanceof BrepVertex) return kernelOfShape(point) as sm.Vertex
  return vec(point)
}

/** @internal */
export function setCurve(o: BrepEdge | Wire, value: sm.Edge | sm.Wire): void {
  const s = state(o)
  s.curve = { value, refs: 1 }
  s.owner = null
  s.index = -1
}

/** @internal
 * A curve of its own made from `like`: where `like` is (where its body is, for a face's, edge's or
 * vertex's), with its transform. */
export function placedCurve(value: sm.Edge | sm.Wire, like: THREE.Object3D): BrepEdge | Wire {
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
  readonly edge: BrepEdge
  constructor(edge: BrepEdge) {
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
  constructor(edges?: Iterable<BrepEdge | Wire> | THREE.CurvePath<THREE.Vector3> | null, material?: THREE.Material | null, options: { sort?: boolean } = {}) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
    if (material != null) this.material = material
    if (internal(this) || edges == null) return
    const kernel = typeof (edges as THREE.Curve<THREE.Vector3>).getPoint === 'function' ? edges3(edges as THREE.Curve<THREE.Vector3>) : [...(edges as Iterable<BrepEdge>)].map((e) => operand(e, null, 'Wire') as sm.Edge)
    setCurve(this, call(() => new sm.Wire(kernel, options)))
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
  edges(): ShapeList<BrepEdge> {
    const w = this.wire
    return ShapeList.from([...call(() => w.edges())].map((e) => placedCurve(e, this) as BrepEdge)) as ShapeList<BrepEdge>
  }

  pointAt(t = 0.5, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.pointAt(t)), target)
  }

  /** The unit tangent at a fraction of the length. */
  tangentAt(t = 0.5, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.tangentAt(t)), target)
  }

  get start(): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.start))
  }

  get end(): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.end))
  }

  /** The point halfway along it. */
  center(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.center()), target)
  }

  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const w = this.wire
    return box3(call(() => w.bbox()), target)
  }

  /** Its vertices, in order. */
  vertices(): ShapeList<BrepVertex> {
    const w = this.wire
    return toThree(call(() => w.vertices()), this) as ShapeList<BrepVertex>
  }

  /** The shortest distance to a point (in its frame) or another shape (where it is). */
  distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number {
    const w = this.wire
    const o = isObject3D(other) ? operand(other, this, 'distanceTo') : vec(other)
    return call(() => w.distanceTo(o))
  }

  /** The wire's point nearest to `point` (both in its frame). */
  closestPoint(point: THREE.Vector3Like, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const w = this.wire
    return vector3(call(() => w.closestPoint(vec(point))), target)
  }

  /** The wire in two at a fraction of its length or a point on it. */
  split(where: number | THREE.Vector3Like | BrepVertex): [Wire, Wire] {
    const w = this.wire
    return call(() => w.split(at(where))).map((x) => placedCurve(x, this)) as [Wire, Wire]
  }

  /** The part of the wire from `start` to `end`: fractions of the length or points on it. */
  trim(start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): Wire {
    const w = this.wire
    return placedCurve(call(() => w.trim(at(start), at(end))), this) as Wire
  }

  /** Where the wire crosses another shape (taken where it is), in its frame. */
  intersections(other: Body | BrepFace | BrepEdge | Wire | Iterable<Body | BrepFace | BrepEdge | Wire>, options: { tolerance?: number | null } = {}): THREE.Vector3[] {
    const w = this.wire
    const o = toKernel(isObject3D(other) ? other : [...(other as Iterable<Body>)], this)
    return call(() => w.intersections(o as never, options)).map((p) => vector3(p))
  }

  /** The wire as one edge (its edges joined into one curve). */
  toEdge(): BrepEdge {
    const w = this.wire
    return placedCurve(call(() => w.toEdge()), this) as BrepEdge
  }

  /** A parallel wire `distance` away in its plane (or `plane`, in its frame); `corners` 'round',
   * 'sharp' or 'chamfer'. */
  offset(distance: number, options: { corners?: string; plane?: THREE.Plane | null } = {}): Wire {
    const w = this.wire
    return placedCurve(call(() => w.offset(distance, { ...options, plane: options.plane == null ? options.plane : toPlane(options.plane) })), this) as Wire
  }

  /** The wire as lines and arcs within `tolerance`. */
  toArcs(tolerance?: number): Wire {
    const w = this.wire
    return placedCurve(call(() => w.toArcs(tolerance)), this) as Wire
  }

  /** The smallest radius of curvature along the wire. */
  minRadius(): number {
    const w = this.wire
    return call(() => w.minRadius())
  }

  /** The fraction of the length where the radius of curvature is smallest. */
  minRadiusAt(): number {
    const w = this.wire
    return call(() => w.minRadiusAt())
  }

  /** How smoothly the wire's edges meet (the worst joint); `angleTol` in radians. */
  continuity(options: { angleTol?: number; curvatureTol?: number } = {}): Continuity {
    const w = this.wire
    return continuityOf(call(() => w.continuity({ ...options, angleTol: options.angleTol === undefined ? undefined : degrees(options.angleTol) })))
  }

  /** The wire closed with a line from its end to its start. */
  close(): Wire {
    const w = this.wire
    return placedCurve(call(() => w.close()), this) as Wire
  }

  /** The wire the other way round. */
  reversed(): Wire {
    const w = this.wire
    return placedCurve(call(() => w.reversed()), this) as Wire
  }

  /** The plane of a planar wire, in its frame. */
  plane(): THREE.Plane {
    const w = this.wire
    return threePlane(call(() => w.plane()))
  }

  /** The wire mirrored in `plane` (in its frame). */
  mirror(plane: THREE.Plane): Wire {
    const w = this.wire
    return placedCurve(call(() => w.mirror(toPlane(plane))), this) as Wire
  }

  /** The wire placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (in its frame). */
  on(target: BrepFace | THREE.Plane | THREE.Matrix4): Wire {
    const w = this.wire
    return placedCurve(call(() => w.on(placement(target, this))), this) as Wire
  }

  /** The wire with its corners (all, or those at `vertices`) rounded. */
  fillet(radius: number, vertices: Iterable<THREE.Vector3Like | BrepVertex> | null = null): Wire {
    const w = this.wire
    const v = vertices === null ? null : [...vertices].map((x) => at(x) as sm.Vector | sm.Vertex)
    return placedCurve(call(() => w.fillet(radius, v)), this) as Wire
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

/** A vertex of a body: a THREE.Points of one point, in its body's frame. (smlibpy's Vertex, named
 * as BrepFace and BrepEdge are.) */
export class BrepVertex extends THREE.Points {
  declare readonly isBrepVertex: true
  /** A vertex of a body (made by the package), or a point of its own: `new BrepVertex(point)`. */
  constructor(point?: THREE.Vector3Like | null) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    takeSub(this)
    if (internal(this) || point == null) return
    state(this).sub = call(() => new sm.Vertex(vec(point)))
  }

  get x(): number {
    return this.point.x
  }

  get y(): number {
    return this.point.y
  }

  get z(): number {
    return this.point.z
  }

  /** The kernel's tolerance of the vertex. */
  get tolerance(): number {
    const v = subOf(this) as sm.Vertex
    return call(() => v.tolerance)
  }

  /** "convex", "concave" or "smooth": how the edges meet at a sketch's corner. */
  get convexity(): string {
    const v = subOf(this) as sm.Vertex
    return call(() => v.convexity)
  }

  center(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.point)
  }

  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const p = this.point
    return target.set(p, p.clone())
  }

  /** The edges of its body that meet at it. */
  edges(): ShapeList<BrepEdge> {
    const v = subOf(this) as sm.Vertex
    return toThree(call(() => v.edges()), this) as ShapeList<BrepEdge>
  }

  /** The faces of its body that meet at it. */
  faces(): ShapeList<BrepFace> {
    const v = subOf(this) as sm.Vertex
    return toThree(call(() => v.faces()), this) as ShapeList<BrepFace>
  }

  /** The shortest distance to a point (in its frame) or another shape (where it is). */
  distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number {
    const v = subOf(this) as sm.Vertex
    const o = isObject3D(other) ? operand(other, this, 'distanceTo') : vec(other)
    return call(() => v.distanceTo(o))
  }

  /** True for the same vertex of the same body (of a clone too), or the same point. */
  equals(other: unknown): boolean {
    if (!(other instanceof BrepVertex)) return false
    const a = state(this).sub as sm.Vertex | null
    const b = state(other).sub as sm.Vertex | null
    return a !== null && b !== null && call(() => a.equals(b))
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

Object.defineProperty(BrepVertex.prototype, 'isBrepVertex', { value: true })

accessors(
  BrepVertex.prototype,
  (v: BrepVertex) => {
    const s = state(v)
    if (s.ownGeometry === null) {
      const p = s.sub === null ? null : vector3((s.sub as sm.Vertex).point)
      s.ownGeometry = p === null ? PLACEHOLDER : lineGeometry(Float32Array.of(p.x, p.y, p.z))
    }
    return s.ownGeometry
  },
  (v: BrepVertex) =>
    state(v).owner === null
      ? new THREE.PointsMaterial({ color: 0x20242c, size: 6, sizeAttenuation: false })
      : new THREE.PointsMaterial({ color: HIGHLIGHT, size: 8, sizeAttenuation: false, depthTest: false }),
)

// ----------------------------------------------------------------------------------- selections
type Item = BrepFace | BrepEdge | BrepVertex

/**
 * A list of faces, edges or vertices with smlibpy's selectors, in three's directions: `top()` is the
 * highest along +y (up), `front()` the nearest along +z (towards three's default camera), `right()`
 * the furthest along +x; `parallelTo(new Vector3(0, 1, 0))` the ones along y. Points and directions
 * are in the frame of the list's body.
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

  /** The items highest along +y (up). */
  top(): ShapeList<T> {
    return this.maxBy(UP)
  }

  /** The items lowest along +y. */
  bottom(): ShapeList<T> {
    return this.minBy(UP)
  }

  /** The items furthest along +z (towards three's default camera). */
  front(): ShapeList<T> {
    return this.maxBy(FRONT)
  }

  /** The items furthest along -z. */
  back(): ShapeList<T> {
    return this.minBy(FRONT)
  }

  /** The items furthest along +x. */
  right(): ShapeList<T> {
    return this.maxBy(RIGHT)
  }

  /** The items furthest along -x. */
  left(): ShapeList<T> {
    return this.minBy(RIGHT)
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

  /** Sorted by a direction (position along it), a property name ('area', 'length', 'radius') or a
   * function; default along +y. */
  sortBy(key: SortKey<T> = UP, reverse = false): ShapeList<T> {
    return select(this, 'sortBy', [sortKey(key), reverse])
  }

  /** `parallelTo(direction)`, `ofType(name)` or `filter(predicate)`, by the criterion's kind. */
  filterBy(criterion: THREE.Vector3Like | string | ((item: T) => boolean)): ShapeList<T> {
    return select(this, 'filterBy', [sortKey(criterion as SortKey<T>)])
  }

  /** Sorted by distance from a point (in the body's frame), nearest first. */
  sortByDistance(point: THREE.Vector3Like, reverse = false): ShapeList<T> {
    return select(this, 'sortByDistance', [point, reverse])
  }

  /** Groups of items with equal keys (within `tol`), in ascending key order. */
  groupBy(key: SortKey<T> = UP, tol = 1e-4): ShapeList<T>[] {
    return select(this, 'groupBy', [sortKey(key), tol])
  }

  /** The items with the greatest key (all of them, within `tol`). */
  maxBy(key: SortKey<T> = UP, tol = 1e-4): ShapeList<T> {
    return select(this, 'maxBy', [sortKey(key), tol])
  }

  /** The items with the smallest key (all of them, within `tol`). */
  minBy(key: SortKey<T> = UP, tol = 1e-4): ShapeList<T> {
    return select(this, 'minBy', [sortKey(key), tol])
  }

  /** The edges where faces meet tangentially. */
  smooth(): ShapeList<T> {
    return select(this, 'smooth', [])
  }

  /** The edges that run on tangentially from these, these included. */
  tangentChain(): ShapeList<BrepEdge> {
    return select(this, 'tangentChain', [])
  }

  /** The edges where faces meet with continuous tangents (G1). */
  g1(): ShapeList<T> {
    return select(this, 'g1', [])
  }

  /** The edges where faces meet with continuous curvature (G2). */
  g2(): ShapeList<T> {
    return select(this, 'g2', [])
  }

  /** The faces that are fillets (rounds), up to `maxRadius`. */
  fillets(maxRadius: number | null = null): ShapeList<T> {
    return select(this, 'fillets', [maxRadius])
  }

  /** The items a ray (in the body's frame) hits. */
  hitBy(ray: THREE.Ray): ShapeList<T> {
    return select(this, 'hitBy', [ray])
  }

  /** The items through a point (within `tol`). */
  atPoint(point: THREE.Vector3Like, tol = 1e-4): ShapeList<T> {
    return select(this, 'atPoint', [point, tol])
  }

  /** The items that came from these shapes' faces and edges (through the operations since). */
  derivedFrom(...shapes: (Body | BrepFace | BrepEdge | Iterable<Body | BrepFace | BrepEdge>)[]): ShapeList<T> {
    return select(this, 'derivedFrom', flatten(shapes as (Body | BrepFace | BrepEdge)[]))
  }

  /** The edges (or faces) where what came from `a` meets what came from `b`. */
  joining(a: Body | BrepFace | BrepEdge | Iterable<Body | BrepFace | BrepEdge>, b: Body | BrepFace | BrepEdge | Iterable<Body | BrepFace | BrepEdge>): ShapeList<T> {
    return select(this, 'joining', [a, b])
  }

  /** The faces shared by two cells of a merged part. */
  shared(): ShapeList<T> {
    return select(this, 'shared', [])
  }

  /** The items of this list and another. */
  union(other: Iterable<T>): ShapeList<T> {
    return select(this, 'union', [[...other]])
  }

  /** The items of this list that are not in another. */
  difference(other: Iterable<T>): ShapeList<T> {
    return select(this, 'difference', [[...other]])
  }

  /** The items in both lists. */
  intersection(other: Iterable<T>): ShapeList<T> {
    return select(this, 'intersection', [[...other]])
  }

  /** The vertices of the items. */
  vertices(): ShapeList<BrepVertex> {
    return select(this, 'vertices', [])
  }

  /** The edges of the items. */
  edges(): ShapeList<BrepEdge> {
    return select(this, 'edges', [])
  }

  /** The faces of the items. */
  faces(): ShapeList<BrepFace> {
    return select(this, 'faces', [])
  }

  /** The wires of the items. */
  wires(): ShapeList<Wire> {
    return select(this, 'wires', [])
  }

  /** The average of the items' centers (in the body's frame). */
  center(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(select<T, THREE.Vector3>(this, 'center', []))
  }

  /** The box around the items (in the body's frame). */
  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    return target.copy(select<T, THREE.Box3>(this, 'bbox', []))
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

/** What sorts and groups go by: a direction (position along it), a property ('area', 'length',
 * 'radius', ...) or a function of an item. */
export type SortKey<T> = THREE.Vector3Like | string | ((item: T) => number)

const UP = Object.freeze(new THREE.Vector3(0, 1, 0))
const FRONT = Object.freeze(new THREE.Vector3(0, 0, 1))
const RIGHT = Object.freeze(new THREE.Vector3(1, 0, 0))

/** A direction as the axis through the origin the kernel sorts along; anything else as it is. */
function sortKey<T>(key: SortKey<T>): unknown {
  return key !== null && typeof key === 'object' ? new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(key.x, key.y, key.z)) : key
}

/** A kernel argument for an argument of a selector. */
function argument(a: unknown, items: Map<unknown, unknown>): unknown {
  if (a instanceof Body) return kernelOf(a)
  if (a instanceof BrepFace || a instanceof BrepEdge || a instanceof BrepVertex || a instanceof Wire) return subOf(a)
  if ((a as THREE.Box3 | null)?.isBox3) return boundBox(a as THREE.Box3)
  if (isRay(a)) return toAxis(a)
  if (typeof a === 'function') return (k: unknown) => (a as (x: unknown) => unknown)(items.get(k) ?? k)
  if (Array.isArray(a)) return a.map((x) => argument(x, items))
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
  // (what the selector gives back: the list's own objects, else its body's (faces of these edges),
  // else three's values)
  const like = list.length ? frameOf(list[0] as THREE.Object3D) : null
  const back = (k: unknown): unknown => {
    if (items.has(k)) return items.get(k)
    if (Array.isArray(k)) return k instanceof sm.ShapeList ? ShapeList.from([...k].map(back)) : k.map(back)
    if (k instanceof sm.Part || k instanceof sm.Shell) for (const [key, value] of items) if (key === k) return value
    return toThree(k, like)
  }
  return back(result) as R
}

// --------------------------------------------------------------------------------- three's types
declare module 'three' {
  interface Intersection {
    /** The face of a body (Part, Shell, Sketch) a raycast hit, or the edge of one on its edge lines. */
    brep?: BrepFace | BrepEdge | BrepVertex
  }
}
