// Triangle meshes as three.js objects: smlibpy's Mesh (an STL file, a scan, the tessellation of a
// body) is a TriangleMesh, a THREE.Mesh whose geometry is its triangles, with the kernel's
// operations on triangles: mesh Booleans, sections and slices, decimation and repair, mass
// properties, a faceted part, an exact ray cast. (smlibpy's name, Mesh, is three's.)
//
// A TriangleMesh is placed by its transform, as a body is. Meshes given to its operations are taken
// where they are in the world; results are new TriangleMeshes in the frame of the mesh an operation
// is called on, with its transform, name and material, as its clone would have them. Points,
// planes and rays a method takes or gives are in the mesh's own frame, as its geometry's
// coordinates are.
//
// Per-instance state lives under a symbol, not in class fields, for the reasons shapes.ts gives:
// three's constructor assigns `geometry` and `material`, which are accessors here (the geometry is
// made when three first reads it, so the intermediate meshes of a chain of operations never make
// one).
import * as THREE from 'three'
import { axis as toAxis, box3, call, degrees, describe, location, plane as toPlane, sm, vec, vector3 } from './kernel.ts'
import { MassProperties, type RayHit } from './properties.ts'
import { Body, BrepFace, Part, ShapeList, curveOf, itemsOf, frameOf, operand, wrap, type Wire } from './shapes.ts'
import { track } from './memory.ts'

// --------------------------------------------------------------------------------------- state
const STATE = Symbol('smlibpy-three.mesh')

/** A kernel mesh, how many TriangleMeshes hold it (clones share it), and the geometry they draw; or
 * the geometry of three's an app assigned, which becomes the kernel's mesh when one is first needed. */
interface Held {
  value: sm.Mesh | null
  source: THREE.BufferGeometry | null
  refs: number
  geometry: THREE.BufferGeometry | null
}

/** The kernel's mesh of what a state holds (an assigned geometry welded on the first call). */
function valueOf(held: Held): sm.Mesh {
  return (held.value ??= call(() => weld(held.source as THREE.BufferGeometry)))
}

interface State {
  /** False while three's constructor runs: what it assigns are its defaults. */
  ready: boolean
  /** Made by the package (an operation's result, a clone): the constructor's arguments are not its triangles. */
  internal: boolean
  held: Held | null
  /** A geometry or material assigned by the app (a material: or taken over from what an operation
   * was called on); null: the mesh's own. */
  geometry: THREE.BufferGeometry | null
  material: THREE.Material | THREE.Material[] | null
  ownMaterial: THREE.Material | null
  /** What a disposed mesh still draws (three uploads a disposed geometry again). */
  drawn: THREE.BufferGeometry | null
  disposed: boolean
}

function state(o: object): State {
  let s = (o as { [STATE]?: State })[STATE]
  if (s === undefined) {
    s = { ready: false, internal: false, held: null, geometry: null, material: null, ownMaterial: null, drawn: null, disposed: false }
    // (not enumerable: three's copy() and toJSON(), and R3F, never see it)
    Object.defineProperty(o, STATE, { value: s })
  }
  return s
}

const DEFAULT_ANGLE = (15 * Math.PI) / 180
const Z = new THREE.Vector3(0, 0, 1)
const IDENTITY = new THREE.Matrix4()
// (corner normals that differ by more than this split a vertex: the edges of a box)
const COS_SPLIT = Math.cos(Math.PI / 180)

// What three's constructor is given (assigned before the mesh is ready, so never kept), and what a
// disposed mesh that was never drawn draws: no points, and bounds no ray meets.
const PLACEHOLDER = new THREE.BufferGeometry()
PLACEHOLDER.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
PLACEHOLDER.boundingBox = new THREE.Box3()
PLACEHOLDER.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1)
const PLACEHOLDER_MATERIAL = new THREE.MeshBasicMaterial()

// The kernel's mesh an internal construction hands to the constructor (results are made with
// `new TriangleMesh()`, which takes it from here), and whether clone() is constructing.
let incoming: sm.Mesh | null = null
let cloning = false

function meshFor(value: sm.Mesh): TriangleMesh {
  incoming = value
  try {
    return new TriangleMesh()
  } finally {
    incoming = null
  }
}

/** @internal
 * The kernel's mesh of a TriangleMesh, in its own frame. */
export function kernelMesh(mesh: TriangleMesh): sm.Mesh {
  const s = state(mesh)
  if (s.held === null) throw new TypeError(`this ${mesh.constructor.name} was disposed`)
  return valueOf(s.held)
}

/** @internal
 * The kernel's mesh of a TriangleMesh given to an operation of `into`, where it is in the world,
 * in `into`'s frame (`into` null: in the world). */
export function meshOperand(mesh: unknown, into: THREE.Object3D | null, what: string): sm.Mesh {
  if (!(mesh instanceof TriangleMesh)) throw new TypeError(`${what}: give a TriangleMesh, not ${describe(mesh)}`)
  const value = kernelMesh(mesh)
  const m = relative(mesh, into)
  return m === null ? value : call(() => value.moved(location(m)))
}

/** The transform from `o`'s frame into `into`'s (both where they are in the world), or null if
 * there is none to make. `into` null: into the world. */
function relative(o: THREE.Object3D, into: THREE.Object3D | null): THREE.Matrix4 | null {
  if (o === into) return null
  o.updateWorldMatrix(true, false)
  const m = o.matrixWorld.clone()
  if (into !== null) {
    into.updateWorldMatrix(true, false)
    m.premultiply(into.matrixWorld.clone().invert())
  }
  return m.elements.every((e, i) => Math.abs(e - IDENTITY.elements[i]) < 1e-12) ? null : m
}

/** @internal
 * A result of an operation called on `like` (a TriangleMesh), as `adopt` makes one. */
export function meshResult(value: sm.Mesh, like: TriangleMesh): TriangleMesh {
  return adopt(value, like)
}

/** A result of an operation called on `like`: in its frame, with its transform, name and the
 * material it shows. */
function adopt(value: sm.Mesh, like: TriangleMesh): TriangleMesh {
  const result = meshFor(value)
  THREE.Object3D.prototype.copy.call(result, like, false)
  const l = state(like)
  state(result).material = l.material ?? l.ownMaterial
  return result
}

// --------------------------------------------------------------------------------------- types
/** How bodies are tessellated into a TriangleMesh. */
export interface TessellateOptions {
  /** The largest distance of the triangles from the exact faces, in model units (null, the
   * default: 0.1 % of each body's diagonal). */
  tolerance?: number | null
  /** The largest angle between neighbouring triangle normals on curved faces, in radians (default
   * 15 degrees). */
  angle?: number
  /** The longest edge a triangle may have (default: no limit): evenly sized triangles, where the
   * tolerance alone leaves a flat face two long ones. */
  maxEdge?: number | null
}

/** Options of `TriangleMesh.decimate`: give one of `fraction` (its argument), `triangles` or
 * `tolerance`. */
export interface DecimateOptions {
  /** About how many triangles to leave. */
  triangles?: number | null
  /** How far the result may be from the mesh at most: it is decimated step by step while it stays
   * within this (a few decimations: seconds for 100 000 triangles). */
  tolerance?: number | null
  /** Edges where the triangles turn by more than this many radians (default 30 degrees) are
   * features: kept longest, and sharp in the result's normals. */
  featureAngle?: number
}

/** What `TriangleMesh.repaired` did. */
export interface RepairReport {
  /** Points that lay on each other (to 1e-9 of the largest coordinate), merged. */
  readonly mergedVertices: number
  /** Triangles without an area, and repeated ones, left out. */
  readonly removedTriangles: number
  /** Triangles turned to face the way their neighbours face (a closed piece outward). */
  readonly flippedTriangles: number
  /** Holes filled (as `fillHoles` fills them). */
  readonly filledHoles: number
  /** Borders that do not close on themselves, left open. */
  readonly openHoles: number
  /** Edges of the result not shared by two triangles: 0 for a closed mesh. */
  readonly openEdges: number
}

/** Where a ray meets a TriangleMesh's triangles (the kernel's ray cast), in the mesh's frame: a
 * RayHit on no face, on a triangle. */
export interface MeshHit extends RayHit {
  /** How far along the ray (its direction taken as a unit vector). */
  readonly distance: number
  /** The triangle's unit normal: the side its corners turn counterclockwise around (outward on a
   * closed mesh that faces outward). */
  readonly normal: THREE.Vector3
  readonly face: null
  /** The triangle's index: the `faceIndex` three's raycast gives for it. */
  readonly triangle: number
}

// --------------------------------------------------------------------------------------- the class
/**
 * A triangle mesh (smlibpy's Mesh): a THREE.Mesh whose geometry is its triangles, in the kernel's
 * order, with the kernel's corner normals where it has them (a tessellation's are the exact
 * surfaces' normals) and each triangle's own normal otherwise. Its
 * geometry is made when three first reads it; clones share it and the kernel's mesh, as three's
 * clones share their geometry. It raycasts, renders, exports (STLExporter, GLTFExporter) and
 * measures (Box3.setFromObject) as any mesh; `intersectRay` is the kernel's exact ray cast.
 *
 * Its own material is a MeshStandardMaterial drawn on both sides (meshes of scans and STL files
 * are often open). Assigning a geometry makes it the mesh, as a THREE.Mesh's geometry is its shape:
 * three draws it as it is, and the kernel's operations take it (its corners welded by position) when
 * one first needs it.
 */
export class TriangleMesh extends THREE.Mesh {
  declare readonly isTriangleMesh: true

  /**
   * A mesh of `source`: a THREE.BufferGeometry of triangles (an STL file's, three's BoxGeometry, a
   * body's geometry), its corners welded by position and its normals kept; or bodies and faces,
   * tessellated where they are in the world (`options`: how finely), into one mesh; or nothing:
   * an empty mesh. The mesh is in its own frame, which is the world's until it is moved.
   */
  constructor(source?: THREE.BufferGeometry | Body | BrepFace | Iterable<Body | BrepFace> | null, material?: THREE.Material | THREE.Material[] | null, options: TessellateOptions = {}) {
    super(PLACEHOLDER, PLACEHOLDER_MATERIAL)
    const s = state(this)
    s.ready = true
    s.internal = incoming !== null || cloning
    track(this)
    if (material != null) this.material = material
    if (s.internal) {
      if (incoming !== null) s.held = { value: incoming, source: null, refs: 1, geometry: null }
      return
    }
    let value: sm.Mesh
    if (source == null) value = new sm.Mesh([], [])
    else if ((source as THREE.BufferGeometry).isBufferGeometry === true) value = weld(source as THREE.BufferGeometry)
    else value = tessellated(itemsOf([source as Body | BrepFace | Iterable<Body | BrepFace>]), null, options.tolerance ?? null, options.angle ?? DEFAULT_ANGLE, options.maxEdge ?? null, 'TriangleMesh')
    s.held = { value, source: null, refs: 1, geometry: null }
  }

  // -- measuring --------------------------------------------------------------------------------
  /** The number of triangles. */
  get triangleCount(): number {
    const value = kernelMesh(this)
    return value.length
  }

  /** The surface area. */
  get area(): number {
    const value = kernelMesh(this)
    return call(() => value.area)
  }

  /** The volume it encloses (meaningful for a closed mesh). */
  get volume(): number {
    const value = kernelMesh(this)
    return call(() => value.volume)
  }

  /** The box around its points, in its frame (a RangeError for an empty mesh). */
  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    const value = kernelMesh(this)
    return box3(call(() => value.bbox()), target)
  }

  /** The middle of its box, in its frame (`centroid` is the center of mass). */
  getCenter(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const value = kernelMesh(this)
    return vector3(call(() => value.center()), target)
  }

  /** The center of mass of the volume a closed mesh encloses, in its frame (see `massProperties`). */
  get centroid(): THREE.Vector3 {
    const value = kernelMesh(this)
    return vector3(call(() => value.centroid))
  }

  /** One unit normal per triangle (x, y, z each), in the kernel's order. */
  get triangleNormals(): Float32Array {
    const value = kernelMesh(this)
    return Float32Array.from(call(() => value.triangleNormals))
  }

  /**
   * Mass, volume, area, center and inertia (about the center, in three's axes) of the volume it
   * encloses, for a uniform `density`, in its frame; exact for the triangles. The mesh must be
   * closed and face outward (a ModelingError otherwise: close it with `fillHoles` or `repaired`).
   */
  massProperties(density = 1): MassProperties {
    const value = kernelMesh(this)
    return new MassProperties(call(() => value.massProperties(density)))
  }

  /** True if every edge is shared by exactly two triangles (a watertight mesh). */
  isClosed(): boolean {
    const value = kernelMesh(this)
    return call(() => value.isClosed())
  }

  // -- rays ---------------------------------------------------------------------------------------
  /**
   * Every place where `ray` (in this mesh's frame, as its geometry's coordinates) meets the
   * triangles, nearest first, in its frame; through an edge or a corner, one hit. For a ray in
   * the world: `ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert())`. (Its `raycast`
   * is three's, for three's Raycaster.)
   */
  intersectRay(ray: THREE.Ray): MeshHit[] {
    const value = kernelMesh(this)
    return call(() => value.raycast(toAxis(ray))).map(hitOf)
  }

  /**
   * The first hit of each of `rays` (in this mesh's frame), or null where one misses: many rays in
   * one call (the kernel sorts the triangles into a grid once, then takes about 0.01 ms a ray).
   */
  intersectRays(rays: Iterable<THREE.Ray>): (MeshHit | null)[] {
    const value = kernelMesh(this)
    return call(() => {
      const axes = [...rays].map((r) => toAxis(r))
      return value.raycastMany(
        axes.map((a) => a.origin),
        axes.map((a) => a.direction),
      )
    }).map((h) => (h === null ? null : hitOf(h)))
  }

  // -- sections -----------------------------------------------------------------------------------
  /**
   * Where `plane` (in this mesh's frame) cuts it: polylines through the points where its
   * triangles cross the plane, longest first, placed where the mesh is (with its transform). Of a
   * closed mesh every loop is closed, outer loops counterclockwise seen from the plane's normal and
   * holes clockwise (`wire.toSketch()` makes a region of a closed loop). Empty where the plane
   * misses the mesh.
   */
  section(plane: THREE.Plane): ShapeList<Wire> {
    const value = kernelMesh(this)
    const p = toPlane(plane)
    return placedWires(call(() => value.section(p)), this)
  }

  /**
   * Sections across `axis` (a direction in this mesh's frame; default +z, as a part's slices), `step` apart: the
   * mesh cut into layers `step` thick from its lowest point along the axis up, each cut in its
   * middle (the contours of a printer's layers). Layers whose plane cuts nothing are left out.
   */
  slices(step: number, axis: THREE.Vector3Like = Z): ShapeList<Wire>[] {
    const value = kernelMesh(this)
    const d = vec(axis)
    return call(() => value.slices(step, d)).map((layer) => placedWires(layer, this))
  }

  // -- decimation and repair ---------------------------------------------------------------------
  /**
   * A mesh with fewer triangles, as near to this one as the kernel's quadric decimation keeps it:
   * `fraction` is the share of the triangles to remove (0.9 leaves a tenth); or give `triangles`
   * or `tolerance` in `options` instead. A closed mesh stays closed, an open one keeps its border.
   */
  decimate(fraction: number | null = null, options: DecimateOptions = {}): TriangleMesh {
    const value = kernelMesh(this)
    const o: { triangles?: number | null; tolerance?: number | null; featureAngle?: number } = {}
    if (options.triangles !== undefined) o.triangles = options.triangles
    if (options.tolerance !== undefined) o.tolerance = options.tolerance
    if (options.featureAngle !== undefined) o.featureAngle = degrees(options.featureAngle)
    return adopt(call(() => value.decimate(fraction, o)), this)
  }

  /** A copy with every hole (a border that closes on itself) filled with triangles that face as
   * the triangles beside them do. */
  fillHoles(): TriangleMesh {
    const value = kernelMesh(this)
    return adopt(call(() => value.fillHoles()), this)
  }

  /**
   * A repaired copy, and what was done: points that lie on each other merged, triangles without
   * an area and repeated ones left out, triangles turned to face as their neighbours do (a closed
   * piece outward), holes filled.
   */
  repaired(): [TriangleMesh, RepairReport] {
    const value = kernelMesh(this)
    const [mesh, r] = call(() => value.repaired())
    const report: RepairReport = Object.freeze({
      mergedVertices: r.mergedVertices,
      removedTriangles: r.removedTriangles,
      flippedTriangles: r.flippedTriangles,
      filledHoles: r.filledHoles,
      openHoles: r.openHoles,
      openEdges: r.openEdges,
    })
    return [adopt(mesh, this), report]
  }

  /**
   * A faceted part of a closed mesh: a planar face per triangle, neighbouring triangles in one
   * plane merged into one face. It has this mesh's transform and name, and the material the app
   * gave the mesh (else a part's own). More than `maxFaces` faces (0: no limit) is a
   * ModelingError, as Booleans on it get slow: decimate the mesh first.
   */
  toPart(maxFaces = 5000): Part {
    const value = kernelMesh(this)
    const part = wrap(call(() => value.toPart(maxFaces))) as Part
    THREE.Object3D.prototype.copy.call(part, this, false)
    const material = state(this).material
    if (material !== null) part.material = material
    return part
  }

  // -- Booleans -----------------------------------------------------------------------------------
  /** This mesh and the others (where they are), fused: the kernel's mesh Boolean. A ModelingError
   * where the kernel gives an open mesh or one of an impossible volume: then fuse the exact parts
   * and tessellate the result. */
  fuse(...others: (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh {
    return this.boolean('fuse', others)
  }

  /** This mesh with the others (where they are) cut away. */
  cut(...others: (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh {
    return this.boolean('cut', others)
  }

  /** What this mesh and the others (where they are) share. */
  intersect(...others: (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh {
    return this.boolean('intersect', others)
  }

  private boolean(op: 'fuse' | 'cut' | 'intersect', others: readonly (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh {
    const value = kernelMesh(this)
    const tools = itemsOf(others).map((o) => meshOperand(o, this, op))
    if (!tools.length) throw new RangeError(`${op}: give a TriangleMesh or more`)
    return adopt(
      call(() => tools.reduce((a, b) => a[op](b), value)),
      this,
    )
  }

  /** The mesh mirrored in `plane` (in its frame); its triangles keep facing outward. */
  mirror(plane: THREE.Plane): TriangleMesh {
    const value = kernelMesh(this)
    const p = toPlane(plane)
    return adopt(call(() => value.mirror(p)), this)
  }

  // -- three --------------------------------------------------------------------------------------
  override clone(recursive?: boolean): this {
    cloning = true
    let copy: this
    try {
      copy = new (this.constructor as new () => this)()
    } finally {
      cloning = false
    }
    return copy.copy(this, recursive)
  }

  /** Shares the kernel's mesh, its geometry and the material, as three's copy shares geometry and
   * material. */
  override copy(source: this, recursive = true): this {
    THREE.Object3D.prototype.copy.call(this, source, recursive)
    const s = state(this)
    const t = state(source)
    if (s.held !== t.held) {
      release(s)
      s.held = t.held
      if (t.held !== null) t.held.refs++
    }
    s.geometry = t.geometry
    s.drawn = t.drawn
    s.disposed = t.held === null && t.disposed
    // (three's rule: the copy shows the source's material, the same object)
    const material = source.material
    s.material = Array.isArray(material) ? material.slice() : material
    return this
  }

  /**
   * Frees what the mesh made: its geometry and its kernel mesh (once no clone holds them) and its
   * own material, and fires three's 'dispose'. A material assigned to it is the app's. It stays in
   * the scene as it was drawn; operations on it throw.
   */
  override dispose(): void {
    const s = state(this)
    if (s.disposed) return
    s.ownMaterial?.dispose()
    s.ownMaterial = null
    if (s.held !== null) s.drawn = s.held.geometry
    release(s)
    s.disposed = true
    super.dispose()
  }
}

Object.defineProperty(TriangleMesh.prototype, 'isTriangleMesh', { value: true })

/** Lets go of the mesh a state holds: the last holder frees its geometry and the kernel's mesh. */
function release(s: State): void {
  const held = s.held
  if (held === null) return
  s.held = null
  held.refs--
  if (held.refs <= 0) {
    held.geometry?.dispose()
    held.value?.dispose()
  }
}

// (an assigned geometry, which is the mesh from then on, as a THREE.Mesh's geometry is its shape:
// three draws it as it is, and the kernel takes it, welded, when an operation first needs it; else
// the mesh's own: the geometry made when three first reads it, shared by clones. Assigning null, or
// the own one back, draws the own. The material: an assigned one, else the own, made on first use.)
Object.defineProperty(TriangleMesh.prototype, 'geometry', {
  configurable: true,
  get(this: TriangleMesh): THREE.BufferGeometry {
    const s = state(this)
    if (!s.ready) return PLACEHOLDER
    if (s.geometry !== null) return s.geometry
    if (s.held !== null) return (s.held.geometry ??= geometryOf(valueOf(s.held)))
    return s.drawn ?? PLACEHOLDER
  },
  set(this: TriangleMesh, value: THREE.BufferGeometry | null | undefined) {
    const s = state(this)
    if (!s.ready) return
    if (value == null || value === s.held?.geometry) {
      s.geometry = null
      return
    }
    if (value === s.geometry) return
    if ((value as { isBufferGeometry?: boolean }).isBufferGeometry !== true) throw new TypeError(`TriangleMesh: a geometry is a THREE.BufferGeometry, not ${describe(value)}`)
    release(s)
    s.held = { value: null, source: value, refs: 1, geometry: null }
    s.geometry = value
    s.drawn = null
    s.disposed = false
  },
})

Object.defineProperty(TriangleMesh.prototype, 'material', {
  configurable: true,
  get(this: TriangleMesh): THREE.Material | THREE.Material[] {
    const s = state(this)
    if (!s.ready) return PLACEHOLDER_MATERIAL
    return s.material ?? (s.ownMaterial ??= new THREE.MeshStandardMaterial({ color: 0xc7ccd4, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }))
  },
  set(this: TriangleMesh, value: THREE.Material | THREE.Material[] | null | undefined) {
    const s = state(this)
    if (!s.ready) return
    s.material = value == null || value === s.ownMaterial ? null : value
  },
})

/**
 * One TriangleMesh of bodies and faces (Part, Shell, Sketch, BrepFace), each tessellated where it is:
 * in the frame of the first one, with its transform, name and material (a face's: its body's), as
 * the result of an operation called on it; the others moved into that frame. `tolerance` is the
 * largest distance of the triangles from the exact faces (null: 0.1 % of each body's diagonal),
 * `angle` the largest angle between neighbouring normals in radians, `maxEdge` the longest edge a
 * triangle may have. (`new TriangleMesh(bodies)` takes them into the world's frame instead.)
 */
export function tessellate(shapes: Body | BrepFace | Iterable<Body | BrepFace>, tolerance: number | null = null, angle: number = DEFAULT_ANGLE, options: { maxEdge?: number | null } = {}): TriangleMesh {
  const list = itemsOf([shapes])
  const first = list[0]
  if (!(first instanceof Body || first instanceof BrepFace)) {
    throw new TypeError(first === undefined ? 'tessellate: give a body or more' : `tessellate: give bodies (Part, Shell, Sketch) or faces, not ${describe(first)}`)
  }
  const frame = frameOf(first)
  const mesh = meshFor(tessellated(list, frame, tolerance, angle, options.maxEdge ?? null, 'tessellate'))
  THREE.Object3D.prototype.copy.call(mesh, frame, false)
  if (frame instanceof Body) state(mesh).material = frame.material
  return mesh
}

/** Bodies and faces, where they are in the world, tessellated into one kernel mesh in `into`'s
 * frame (null: the world's). */
function tessellated(shapes: readonly unknown[], into: THREE.Object3D | null, tolerance: number | null, angle: number, maxEdge: number | null, what: string): sm.Mesh {
  if (!shapes.length) throw new RangeError(`${what}: give a body or more`)
  const values = shapes.map((x) => {
    if (!(x instanceof Body || x instanceof BrepFace)) throw new TypeError(`${what}: give a THREE.BufferGeometry, or bodies (Part, Shell, Sketch) and faces, not ${describe(x)}`)
    return operand(x, into, what)
  })
  const options = maxEdge === null ? {} : { maxEdge }
  return call(() => sm.tessellate(values.length === 1 ? values[0] : sm.ShapeList.from(values), tolerance, degrees(angle), options))
}

// --------------------------------------------------------------------------------- conversions
/**
 * A mesh of three's (any BufferGeometry of triangles, indexed or not) as the kernel's: corners welded by position (at 1e-6, as `new Part(geometry)` welds them), so that
 * a geometry split per face (BoxGeometry) closes; triangles of two welded corners left out; its
 * normals, where it has them, kept as corner normals.
 */
function weld(geometry: THREE.BufferGeometry): sm.Mesh {
  const position = geometry.getAttribute('position')
  if (position === undefined) throw new TypeError('TriangleMesh: the geometry has no positions')
  const normal = geometry.getAttribute('normal') ?? null
  const index = geometry.getIndex()
  const count = index === null ? position.count : index.count
  const ids = new Map<string, number>()
  const vertices: number[] = []
  const triangles: number[] = []
  const normals: number[] = []
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const corners = [0, 0, 0]
  const at = [0, 0, 0]
  for (let i = 0; i + 2 < count; i += 3) {
    for (let c = 0; c < 3; c++) {
      const k = index === null ? i + c : index.getX(i + c)
      corners[c] = k
      p.fromBufferAttribute(position, k)
      const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)}`
      let id = ids.get(key)
      if (id === undefined) {
        id = vertices.length / 3
        ids.set(key, id)
        vertices.push(p.x, p.y, p.z)
      }
      at[c] = id
    }
    if (at[0] === at[1] || at[1] === at[2] || at[0] === at[2]) continue
    triangles.push(at[0], at[1], at[2])
    if (normal !== null) {
      for (const k of corners) {
        n.fromBufferAttribute(normal, k).normalize()
        normals.push(n.x, n.y, n.z)
      }
    }
  }
  return new sm.Mesh(vertices, triangles, normal === null ? null : normals)
}

/**
 * The kernel's mesh as three's geometry: its triangles in its order (so three's `faceIndex` is the
 * kernel's triangle), with its corner normals (or each triangle's own); a point
 * is one vertex where the normals of its corners agree, split where they differ.
 */
function geometryOf(m: sm.Mesh): THREE.BufferGeometry {
  const v = m.vertices
  const t = m.triangles
  const corner = m.normals
  const flat = corner === null ? m.triangleNormals : null
  const positions = new Float32Array(t.length * 3)
  const normals = new Float32Array(t.length * 3)
  const index = new Uint32Array(t.length)
  // the vertices made of each point: the first, and each one's next
  const first = new Int32Array(v.length / 3).fill(-1)
  const next = new Int32Array(t.length)
  let count = 0
  for (let i = 0; i < t.length; i++) {
    const p = t[i]
    // (corner normals: three per corner; a triangle's own: three per triangle)
    const n = corner ?? flat!
    const o = corner !== null ? i * 3 : i - (i % 3)
    const nx = n[o]
    const ny = n[o + 1]
    const nz = n[o + 2]
    let at = first[p]
    while (at >= 0 && normals[at * 3] * nx + normals[at * 3 + 1] * ny + normals[at * 3 + 2] * nz < COS_SPLIT) at = next[at]
    if (at < 0) {
      at = count++
      positions[at * 3] = v[p * 3]
      positions[at * 3 + 1] = v[p * 3 + 1]
      positions[at * 3 + 2] = v[p * 3 + 2]
      normals[at * 3] = nx
      normals[at * 3 + 1] = ny
      normals[at * 3 + 2] = nz
      next[at] = first[p]
      first[p] = at
    }
    index[i] = at
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.slice(0, count * 3), 3))
  geometry.setIndex(new THREE.BufferAttribute(count < 65536 ? Uint16Array.from(index) : index, 1))
  if (count > 0) {
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
  } else {
    geometry.boundingBox = new THREE.Box3()
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1)
  }
  return geometry
}

function hitOf(h: sm.Hit<null>): MeshHit {
  return Object.freeze({ point: vector3(h.point), distance: h.distance, normal: vector3(h.normal), face: null, triangle: h.triangle ?? -1 })
}

/** Wires of the kernel's (a section's polylines, in `like`'s frame) as wires of their own, placed
 * where `like` is. */
function placedWires(wires: Iterable<sm.Wire>, like: TriangleMesh): ShapeList<Wire> {
  return ShapeList.from(
    [...wires].map((w) => {
      const wire = curveOf(w) as Wire
      THREE.Object3D.prototype.copy.call(wire, like, false)
      return wire
    }),
  ) as ShapeList<Wire>
}
