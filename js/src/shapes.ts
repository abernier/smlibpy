// Shapes: vertices, edges, wires, faces, sketches, shells and parts.
//
// Every shape is an immutable value. Operations never modify a shape; they return a new one.
// Faces, edges and vertices taken from a body (`part.faces()`) stay valid for as long as you hold
// them and can be passed back to operations on that body
// (`part.fillet(part.edges().parallelTo(Z), 2)`).

import { BrepHandle, CurveHandle, KernelError, ModelingError, _isRuntimeError, _opts, _warn, ext, k, kernelCall } from './kernel.ts'
import {
  TOLERANCE,
  Axis,
  BoundBox,
  Hit,
  Nurbs,
  Location,
  Plane,
  Vector,
  X,
  Y,
  Z,
  _apply,
  _applyVector,
  _degrees,
  _direction,
  _formatE,
  _formatG,
  _identity,
  _radians,
  _vec,
  type Matrix,
  type VectorLike,
} from './geometry.ts'
import { det3, eigh3, mean3, spread } from './_linalg.ts'
import { Line, ThreePointArc, _arcCurve, _filletWire } from './curves.ts'
import { _rayTriangles, faceMeshes, tessellate, type Mesh } from './mesh.ts'
import { show } from './viewer.ts'
import { exportFile } from './exporters.ts'
import { CORNER_STYLES, cornerKind, mirrorSketch, offsetRegion, rebuiltBrep, roundCorners } from './_regions.ts'
import { type _Job, _isolated, _smb, filletFaces, removeFaces as _removeFaces, removeFillets as _removeFillets } from './defeature.ts'
import { type BendOptions, type TaperOptions, type TwistOptions, bend as _bend, taper as _taper, twist as _twist } from './deform.ts'
import { type DraftAnalysis, _range, draftAnalysis as _draftAnalysis, draftFaces, partingLine as _partingLine } from './draft.ts'
import { sweep as _sweep, swing as _swing } from './operations.ts'
import { Box } from './parts.ts'
import {
  type Bend,
  type FlangeOptions,
  type FlatPattern,
  type FoldOptions,
  type UnfoldOptions,
  bends as _bends,
  flange as _flange,
  flatPattern as _flatPattern,
  fold as _fold,
  unfold as _unfold,
} from './sheetmetal.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any

/**
 * Relative accuracy of areas, volumes, centers and inertia: volumes and areas to `ACCURACY` of
 * their value, centers to `ACCURACY` times the size of the body (its bounding box diagonal),
 * inertia to `ACCURACY` times its largest principal moment. `massProperties(density, accuracy)`
 * takes another.
 */
export const ACCURACY = 1e-7

// The integration (src/cpp/measure.cpp) estimates its error and refines until the estimate is
// below accuracy * _MARGIN. The estimates are pessimistic for smooth integrands; with the margin,
// the errors measured against closed forms and converged references are 100 to 10^6 times below
// the accuracy asked for.
const _MARGIN = 0.1

// Faces that meet only within a tolerance leave gaps, and the volume then depends on the field it
// is integrated with (the kernel's (0, 0, z) against (x, 0, 0) and (0, y, 0)): by 1e-7 to 3e-6 for
// fitted chamfers, sweeps cut by planes and shells of curved faces. Beyond _GAPS (and the accuracy
// asked for) the volume measure says so.
const _GAPS = 1e-5

// Faces whose gaps reach 1e-2 of the volume do not bound one solid: a Boolean that left a face out
// (0.25), a wrong shell from the fuzz campaign (0.066), a torus split along its seam (4.0). Sound
// bodies stay below 2e-3: imported parts up to 6e-4, a sheet unfolded at a radius far below its
// thickness 1.1e-3.
const _BROKEN_GAPS = 1e-2

// How far a body was found a sound solid (BrepHandle.sound, see Part._solidProblem): the closed,
// manifold result of a Boolean of sound operands, which the next Boolean takes as sound and nothing
// else does; closed, manifold and of positive volume by the kernel's coarse integration (the checks
// of operations); and that with the gaps between its faces measured (isValid()).
const _TRUSTED = 1
const _CHECKED = 2
const _SOUND = 3

// Fillet corners take two edges whose directions differ by less than this (degrees) for edges that
// run into each other tangentially: the kernel's default tangency tolerance.
const _FILLET_TANGENT_DEG = 10.0

// A chamfer bevels each edge with one cross-section, so its setback equals the length only where
// the faces meet at the angle measured; along an edge whose angle changes by more than this
// (degrees) the setback would change with it.
const _CHAMFER_ANGLE_SPREAD = 1.0

// A shell or offset whose faces leave gaps of this much of its volume or more is refused. Over 1018
// shells and offsets of imported parts, the sound ones stayed below 6.5e-4 and those with 1e-3 or
// more were wrong (faces off their edges, rims left open, meshes that do not close).
const _OFFSET_GAPS = 1e-3

// A shell or offset attempt whose result was refused is tried once more (the kernel's extended mode
// depends on memory layout), but not after this many seconds; an attempt that failed is not
// repeated, since the kernel fails the same way again.
const _RETRY_SECONDS = 10.0

// Shapes that only smlibwasm makes (edges, bodies) take this as their constructor's argument.
const INTERNAL = Symbol('smlibwasm.internal')

const inspect = Symbol.for('nodejs.util.inspect.custom')

/** A color: a CSS name ("steelblue"), "#4682b4", or [r, g, b] (0..1 or 0..255). */
export type ColorLike = string | readonly number[]

/** Metadata a body carries: a name (exporters, the viewer) and a display color. */
export interface BodyOptions {
  name?: string | null
  color?: ColorLike | null
  /** (a sketch's plane) */
  plane?: Plane | null
}

export function _t(p: ArrayLike<number>): [number, number, number] {
  return [Number(p[0]), Number(p[1]), Number(p[2])]
}

/** Python's `type(x).__name__`, for messages. */
export function _typeName(x: unknown): string {
  if (x === null || x === undefined) return String(x)
  if (typeof x === 'object' || typeof x === 'function') return (x as { constructor?: { name?: string } }).constructor?.name ?? 'object'
  return typeof x
}

/** The value as Python's repr would show it, for messages. */
function _repr(x: unknown): string {
  if (typeof x === 'string') return `'${x}'`
  if (Array.isArray(x)) return `(${x.map(_repr).join(', ')})`
  return String(x)
}

function _isIterable(x: unknown): x is Iterable<unknown> {
  return x != null && typeof (x as Any)[Symbol.iterator] === 'function'
}

/** A Python ValueError (or IndexError) as JavaScript has it: a RangeError. */
function _isValueError(e: unknown): boolean {
  return e instanceof RangeError
}

// =============================================================================== Shape
/** Base class of all shapes. */
export abstract class Shape {
  // -- topology -----------------------------------------------------------------------------
  /** All vertices of this shape. */
  abstract vertices(): ShapeList<Vertex>

  /** All edges of this shape. */
  abstract edges(): ShapeList<Edge>

  /** All wires (closed edge loops of faces, or the shape itself if it is a wire). */
  wires(): ShapeList<Wire> {
    return new ShapeList<Wire>()
  }

  /** All faces of this shape. */
  faces(): ShapeList<Face> {
    return new ShapeList<Face>()
  }

  // -- placement ----------------------------------------------------------------------------
  abstract _transformed(m: Matrix): Shape

  /** A copy of this shape moved by a location (`location.mul(shape)`). */
  moved(location: Location): this {
    return this._transformed(location._m) as this
  }

  /** A copy moved by `(x, y, z)`. */
  translate(x: number | VectorLike = 0, y = 0, z = 0): this {
    return this._transformed(_translation(x, y, z)) as this
  }

  /** A copy rotated by `angle` degrees about `axis`. */
  rotate(axis: Axis = Z, angle = 0): this {
    return this._transformed(Location.about(axis, angle)._m) as this
  }

  /** A mirrored copy (reflection in `plane`, a plane or a planar face; by default the XZ plane,
   * which flips Y). */
  mirror(plane: Plane | Face | Axis | ShapeList<Face> = Plane.XZ): this {
    return this._transformed(_reflection(plane)) as this
  }

  /** A scaled copy. `factor` is a number or per-axis factors `[sx, sy, sz]`, none of them zero
   * (RangeError: that would flatten the shape). */
  scale(factor: number | VectorLike, center: VectorLike = [0, 0, 0]): this {
    return this._transformed(_scaling(factor, center)) as this
  }

  /**
   * Place this shape, designed around the world XY plane, onto a plane or face.
   *
   * The shape's origin goes to the plane origin (a face's center), its X axis to the plane's X
   * direction and its Z axis to the plane normal. `sketch.on(face)` is the usual way to draw on
   * a face.
   */
  on(target: Plane | Face | Location | ShapeList<Face> | Sketch): this {
    return this.moved(_asPlane(target).location)
  }

  // -- measurement --------------------------------------------------------------------------
  /** Tight axis-aligned bounding box. */
  abstract bbox(): BoundBox

  /** Center of mass (centroid) of the shape. */
  abstract center(): Vector

  /** Minimum distance to a point (and, for bodies, to another body). */
  distanceTo(_other: VectorLike | Shape): number {
    throw new TypeError(`a ${_typeName(this)} has no distance`)
  }

  // -- output -------------------------------------------------------------------------------
  /** Triangulate the shape (see `tessellate`). */
  mesh(tolerance: number | null = null, angle = 15): Mesh {
    return tessellate(this, tolerance, angle)
  }

  /** Show the shape in the viewer (see `show`). */
  show(options: Record<string, unknown> = {}): unknown {
    return show(this, options)
  }

  /** Write the shape to a file; the format follows the extension (step, stl, glb, ...). */
  export(path: string, options: Record<string, unknown> = {}): void {
    exportFile(this, path, options)
  }

  toString(): string {
    return `${_typeName(this)}()`
  }

  [inspect](): string {
    return this.toString()
  }
}

export function _asPlane(target: unknown): Plane {
  if (target instanceof Plane) return target
  if (target instanceof Location) return target.plane
  if (target instanceof ShapeList) return _asPlane(target.one())
  if (target instanceof Face) return target.plane
  if (target instanceof Sketch) return target.plane
  throw new TypeError(`cannot use ${_typeName(target)} as a plane`)
}

// =============================================================================== ShapeList
/** What shapes are sorted and grouped by: an axis, a name ("length", "area", "volume",
 * "radius", "x", "y", "z", "size") or a function of a shape. */
export type SortKey = Axis | string | ((s: Any) => number)

function _keyFn(key: SortKey): (s: Any) => number {
  if (key instanceof Axis) {
    const ax = key
    return (s) => ax.positionAlong(s.center())
  }
  if (typeof key === 'function') return key
  if (typeof key === 'string') {
    const name = key.toLowerCase()
    if (['length', 'area', 'volume', 'radius'].includes(name)) return (s) => s[name]
    if (['x', 'y', 'z'].includes(name)) {
      const ax = ({ x: X, y: Y, z: Z } as Record<string, Axis>)[name]
      return (s) => ax.positionAlong(s.center())
    }
    if (name === 'size' || name === 'measure') return _measure
    if (name === 'distance') throw new RangeError('use .sortByDistance(point)')
  }
  throw new TypeError(`cannot sort by ${_repr(key)}`)
}

function _measure(s: Any): number {
  for (const name of ['volume', 'area', 'length']) {
    if (!(name in s)) continue
    const v = s[name]
    if (v != null) return Number(v)
  }
  return 0
}

/** The items sorted by a key computed once each (stable, as Python's sorted). */
function _sorted<T>(items: Iterable<T>, f: (s: T) => number, reverse = false): ShapeList<T> {
  const keyed = Array.from(items, (s) => [f(s), s] as [number, T])
  keyed.sort((a, b) => (reverse ? b[0] - a[0] : a[0] - b[0]))
  return _list(keyed.map(([, s]) => s))
}

/** A ShapeList of the items. */
export function _list<T>(items: Iterable<T>): ShapeList<T> {
  const out = new ShapeList<T>()
  for (const s of items) out.push(s)
  return out
}

function _eq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const equals = (a as { equals?: (o: unknown) => boolean } | null)?.equals
  return typeof equals === 'function' && equals.call(a, b)
}

/**
 * A list of shapes with selection helpers.
 *
 * Every selector returns a new ShapeList, so selectors chain:
 *
 *     part.edges().parallelTo(Z).maxBy(X)
 *     part.faces().planar().facing(Z.neg())
 *
 * A one-element list can be used wherever a single shape is expected
 * (`sketch.on(part.faces().top())`). Use `one()` to require exactly one.
 */
export class ShapeList<T = Shape> extends Array<T> {
  // (Array's species: filter, slice and concat give ShapeLists; `new ShapeList(...shapes)`)

  // -- picking ------------------------------------------------------------------------------
  /** The only element; throws if the list does not hold exactly one shape. */
  one(): T {
    if (this.length !== 1) {
      throw new RangeError(`expected exactly one shape, got ${this.length}` + (this.length ? ' - narrow the selection or use [0]' : ''))
    }
    return this[0]
  }

  get first(): T {
    if (!this.length) throw new RangeError('empty selection')
    return this[0]
  }

  /** The shape at `index` (Array's `at`: a negative index counts from the end). Python's
   * `at(point)` selects by a point; here that is `atPoint(point)`. */
  override at(index: number): T | undefined {
    if (typeof index !== 'number') throw new TypeError('ShapeList.at takes an index; select by a point with atPoint(point)')
    return super.at(index)
  }

  get last(): T {
    if (!this.length) throw new RangeError('empty selection')
    return this[this.length - 1]
  }

  // -- ordering -----------------------------------------------------------------------------
  /** Sort by position along an axis, by "length"/"area"/"volume"/"radius", or by any function
   * of a shape. */
  sortBy(key: SortKey = Z, reverse = false): ShapeList<T> {
    return _sorted(this, _keyFn(key), reverse)
  }

  /** `parallelTo(axis)`, `ofType(name)` or `filter(predicate)`, depending on the argument. */
  filterBy(criterion: Axis | string | ((s: T) => boolean)): ShapeList<T> {
    if (criterion instanceof Axis) return this.parallelTo(criterion)
    if (typeof criterion === 'string') return this.ofType(criterion)
    return this.filter((s) => criterion(s))
  }

  sortByDistance(point: VectorLike, reverse = false): ShapeList<T> {
    const p = _vec(point)
    return _sorted(this, (s) => (s as Any).center().distanceTo(p), reverse)
  }

  /** Group shapes with equal key (within `tol`), groups in ascending key order. */
  groupBy(key: SortKey = Z, tol = 1e-4): ShapeList<T>[] {
    const f = _keyFn(key)
    const pairs = Array.from(this, (s) => [f(s), s] as [number, T]).sort((a, b) => a[0] - b[0])
    const groups: ShapeList<T>[] = []
    let last: number | null = null
    for (const [v, s] of pairs) {
      if (last === null || Math.abs(v - last) > tol) {
        groups.push(new ShapeList<T>())
        last = v
      }
      groups[groups.length - 1].push(s)
    }
    return groups
  }

  /** The shapes with the largest key (all of them, if several tie). */
  maxBy(key: SortKey = Z, tol = 1e-4): ShapeList<T> {
    const groups = this.groupBy(key, tol)
    return groups.length ? groups[groups.length - 1] : new ShapeList<T>()
  }

  /** The shapes with the smallest key (all of them, if several tie). */
  minBy(key: SortKey = Z, tol = 1e-4): ShapeList<T> {
    const groups = this.groupBy(key, tol)
    return groups.length ? groups[0] : new ShapeList<T>()
  }

  /** Highest shapes (largest Z). */
  top(): ShapeList<T> {
    return this.maxBy(Z)
  }

  /** Lowest shapes (smallest Z). */
  bottom(): ShapeList<T> {
    return this.minBy(Z)
  }

  /** Shapes furthest along +X. */
  right(): ShapeList<T> {
    return this.maxBy(X)
  }

  /** Shapes furthest along -X. */
  left(): ShapeList<T> {
    return this.minBy(X)
  }

  /** Shapes furthest along +Y. */
  back(): ShapeList<T> {
    return this.maxBy(Y)
  }

  /** Shapes furthest along -Y. */
  front(): ShapeList<T> {
    return this.minBy(Y)
  }

  /** The biggest shape by volume, area or length. */
  largest(): T {
    if (!this.length) throw new RangeError('empty selection')
    let best = this[0]
    let bestKey = _measure(best)
    for (let i = 1; i < this.length; i++) {
      const key = _measure(this[i])
      if (key > bestKey) {
        best = this[i]
        bestKey = key
      }
    }
    return best
  }

  /** The smallest shape by volume, area or length. */
  smallest(): T {
    if (!this.length) throw new RangeError('empty selection')
    let best = this[0]
    let bestKey = _measure(best)
    for (let i = 1; i < this.length; i++) {
      const key = _measure(this[i])
      if (key < bestKey) {
        best = this[i]
        bestKey = key
      }
    }
    return best
  }

  /** The shape whose center is closest to `point`. */
  nearest(point: VectorLike): T {
    if (!this.length) throw new RangeError('empty selection')
    return this.sortByDistance(point)[0]
  }

  // -- filtering ----------------------------------------------------------------------------
  /** Keep the shapes for which `predicate(shape)` is true. */
  override filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: unknown): ShapeList<S>
  override filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T>
  override filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T> {
    const out = new ShapeList<T>()
    for (let i = 0; i < this.length; i++) if (predicate.call(thisArg, this[i], i, this)) out.push(this[i])
    return out
  }

  /** A plain array of what `fn` gives for each shape. */
  override map<U>(fn: (value: T, index: number, array: T[]) => U, thisArg?: unknown): U[] {
    const out: U[] = []
    for (let i = 0; i < this.length; i++) out.push(fn.call(thisArg, this[i], i, this))
    return out
  }

  /** Keep shapes of the given geometry types, e.g. "line", "circle", "plane", "cylinder",
   * "bspline". */
  ofType(...geomTypes: string[]): ShapeList<T> {
    const wanted = new Set(geomTypes.map((g) => g.toLowerCase()))
    return this.filter((s) => wanted.has((s as Any).geomType))
  }

  /** Straight edges (also straight B-spline edges, such as the edges of a chamfer). */
  lines(): ShapeList<T> {
    return this.filter((s) => s instanceof Edge && s._isStraight())
  }

  /** Circular edges (full circles and arcs). */
  circles(): ShapeList<T> {
    return this.ofType('circle')
  }

  /** Planar faces (also flat B-spline faces). */
  planar(): ShapeList<T> {
    return this.filter((s) => s instanceof Face && s.isPlanar)
  }

  /** Cylindrical faces. */
  cylinders(): ShapeList<T> {
    return this.ofType('cylinder')
  }

  /** Straight edges along `axis`, or planar faces whose normal is along `axis`. */
  parallelTo(axis: Axis | VectorLike): ShapeList<T> {
    const d = _direction(axis, 'parallelTo')
    return this.filter((s) => {
      const dir = _directionOf(s)
      return dir !== null && dir.isParallel(d)
    })
  }

  /** Straight edges perpendicular to `axis`, or planar faces containing it. */
  perpendicularTo(axis: Axis | VectorLike): ShapeList<T> {
    const d = _direction(axis, 'perpendicularTo')
    return this.filter((s) => {
      const dir = _directionOf(s)
      return dir !== null && dir.isPerpendicular(d)
    })
  }

  /**
   * Faces whose outward normal points along `direction` (within `maxAngle` degrees).
   *
   * A curved face counts only when its normal does so everywhere on the face: the wall of a hole
   * or a boss faces no direction, and a fillet only with a `maxAngle` that takes in all its
   * normals.
   */
  facing(direction: Axis | VectorLike, maxAngle = 1e-3): ShapeList<T> {
    const d = _direction(direction, 'facing')
    const out = new ShapeList<T>()
    for (const s of this) {
      if (!(s instanceof Face)) continue
      try {
        let ok: boolean
        if (s.geomType === 'plane') {
          ok = s.normalAt().angleTo(d) <= maxAngle
        } else {
          // One normal first: most curved faces turn away from d there already. Then the least
          // n . d over the face.
          ok = s.normalAt(s.interiorPoint()).angleTo(d) <= maxAngle && _degrees(Math.acos(_range(s, d)[0])) <= maxAngle
        }
        if (ok) out.push(s)
      } catch (e) {
        if (!(e instanceof KernelError || _isValueError(e))) throw e
      }
    }
    return out
  }

  /** Edges on outside corners (material angle below 180 degrees), and the outside corners of a
   * sketch (vertices where the region's angle is below 180 degrees). */
  convex(): ShapeList<T> {
    const kinds = _convexities(this)
    return this.filter((_, i) => kinds[i] === 'convex')
  }

  /** Edges on inside corners (material angle above 180 degrees), and the inside corners of a
   * sketch. */
  concave(): ShapeList<T> {
    const kinds = _convexities(this)
    return this.filter((_, i) => kinds[i] === 'concave')
  }

  /** Edges where two faces meet tangentially, such as the borders of a fillet, and the vertices
   * of a sketch where two edges meet tangentially. */
  smooth(): ShapeList<T> {
    const kinds = _convexities(this)
    return this.filter((_, i) => kinds[i] === 'smooth')
  }

  /** Fillet faces: rounds of convex edges and fillets of concave ones, found by geometry (with
   * the corner patches where fillets meet), up to `maxRadius`. See the defeature module. */
  fillets(maxRadius: number | null = null): ShapeList<T> {
    return filletFaces(this as unknown as Iterable<Face>, maxRadius) as unknown as ShapeList<T>
  }

  /**
   * The faces (or bodies) of the list that a ray meets, nearest first: each once, in the order the
   * ray meets them (see `Part.raycast`). Only the shapes in the list count, so
   * `part.faces().planar().hitBy(...)` looks past the faces that are not planar.
   *
   * The ray starts at `origin` and runs along `direction` (an axis or a vector); an axis alone is a
   * ray from its origin along its direction. A ray through an edge meets the faces on both sides of it.
   */
  hitBy(origin: VectorLike | Axis, direction: VectorLike | Axis | null = null): ShapeList<T> {
    for (const s of this) {
      if (!(s instanceof Face || s instanceof _Body)) throw new TypeError(`hitBy takes faces and bodies, not a ${_typeName(s)}`)
    }
    const first = new Map<unknown, number>()
    const faces = [...this].filter((s): s is T & Face => s instanceof Face)
    if (faces.length) {
      let box = faces[0].bbox()
      for (const f of faces.slice(1)) box = box.union(f.bbox())
      for (const h of _raycast(faces, origin, direction, box, false)) if (!first.has(h.face)) first.set(h.face, h.distance) // (nearest first)
    }
    for (const s of this) {
      if (s instanceof _Body && !first.has(s)) {
        const hits = s.raycast(origin, direction)
        if (hits.length) first.set(s, hits[0].distance)
      }
    }
    const met: [number, number, T][] = []
    const seen = new Set<unknown>()
    this.forEach((s, i) => {
      if (first.has(s) && !seen.has(s)) {
        seen.add(s)
        met.push([first.get(s)!, i, s])
      }
    })
    met.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    return _list(met.map((m) => m[2]))
  }

  /** Shapes whose bounding box lies inside `box`. */
  within(box: BoundBox): ShapeList<T> {
    return this.filter((s) => {
      const b = (s as Any).bbox() as BoundBox
      return box.contains(b.min) && box.contains(b.max)
    })
  }

  /** Shapes passing through `point` (vertices at, edges/faces touching it). (Python's `at`;
   * Array has an `at` of its own.) */
  atPoint(point: VectorLike, tol = 1e-4): ShapeList<T> {
    const p = _vec(point)
    return this.filter((s) => (s as Any).distanceTo(p) <= tol)
  }

  // -- set operations and expansion ---------------------------------------------------------
  /** The shapes of both lists, each once (Python's `|`). */
  union(other: Iterable<T>): ShapeList<T> {
    const out = _list(this)
    for (const s of other) if (!out.some((x) => _eq(x, s))) out.push(s)
    return out
  }

  /** The shapes not in `other` (Python's `-`). */
  difference(other: Iterable<T>): ShapeList<T> {
    const o = Array.from(other)
    return this.filter((s) => !o.some((x) => _eq(x, s)))
  }

  /** The shapes also in `other` (Python's `&`). */
  intersection(other: Iterable<T>): ShapeList<T> {
    const o = Array.from(other)
    return this.filter((s) => o.some((x) => _eq(x, s)))
  }

  vertices(): ShapeList<Vertex> {
    return _unique(this.flatMap((s) => [...(s as Any).vertices()]) as Vertex[])
  }

  edges(): ShapeList<Edge> {
    return _unique(this.flatMap((s) => [...(s as Any).edges()]) as Edge[])
  }

  faces(): ShapeList<Face> {
    return _unique(this.flatMap((s) => [...(s as Any).faces()]) as Face[])
  }

  wires(): ShapeList<Wire> {
    return _list(this.flatMap((s) => [...(s as Any).wires()]) as Wire[])
  }

  /** Average of the members' centers. */
  center(): Vector {
    if (!this.length) throw new RangeError('empty selection')
    let c = new Vector()
    for (const s of this) c = c.add((s as Any).center())
    return c.div(this.length)
  }

  bbox(): BoundBox {
    if (!this.length) throw new RangeError('empty selection')
    let b = (this[0] as Any).bbox() as BoundBox
    for (let i = 1; i < this.length; i++) b = b.union((this[i] as Any).bbox())
    return b
  }

  // -- placement of the whole list ----------------------------------------------------------
  moved(location: Location): ShapeList<T> {
    return _list(this.map((s) => (s as Any).moved(location) as T))
  }

  /** Every shape placed onto a plane or face (see `Shape.on`). */
  on(target: unknown): ShapeList<T> {
    const loc = _asPlane(target).location
    return _list(this.map((s) => (s as Any).moved(loc) as T))
  }

  translate(x: number | VectorLike = 0, y = 0, z = 0): ShapeList<T> {
    return _list(this.map((s) => (s as Any).translate(x, y, z) as T))
  }

  rotate(axis: Axis = Z, angle = 0): ShapeList<T> {
    return _list(this.map((s) => (s as Any).rotate(axis, angle) as T))
  }

  override toString(): string {
    if (this.length > 6) return `ShapeList([${this.slice(0, 3).map(String).join(', ')}, ... ${this.length} shapes])`
    return `ShapeList([${this.map(String).join(', ')}])`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** The convexity of each edge, and of each corner of a sketch (null for other shapes), with one
 * kernel call for the edges of each body. */
function _convexities(items: readonly unknown[]): (string | null)[] {
  const edges = items.filter((s): s is Edge => s instanceof Edge)
  const angles = new Map<Edge, number | null>()
  _outerAngles(edges).forEach((a, i) => angles.set(edges[i], a))
  return items.map((s) => {
    if (s instanceof Edge) {
      const a = angles.get(s) ?? null
      return a !== null ? _angleKind(a) : s._probedConvexity()
    }
    if (s instanceof Vertex && s._owner instanceof Sketch) return s.convexity
    return null
  })
}

/** The kernel's outer angle of each edge in degrees (`ext.edge_angles`: above 180 at a convex
 * edge), one call per body; null where the kernel cannot tell (an edge that does not lie between
 * two faces of a solid, a standalone curve). */
function _outerAngles(edges: readonly Edge[]): (number | null)[] {
  const out: (number | null)[] = edges.map(() => null)
  const bodies = new Map<_Body, number[]>()
  edges.forEach((e, i) => {
    if (e._e && e._owner !== null) {
      const idx = bodies.get(e._owner)
      if (idx) idx.push(i)
      else bodies.set(e._owner, [i])
    }
  })
  for (const [owner, idx] of bodies) {
    const angles: (number | null)[] = ext.edge_angles(owner._brep, idx.map((i) => edges[i]._e))
    idx.forEach((i, j) => {
      out[i] = angles[j] ?? null
    })
  }
  return out
}

/** The convexity of an edge with this outer angle (degrees): smooth within half a degree of 180,
 * as the faces' normals are within half a degree. */
function _angleKind(outer: number): string {
  return Math.abs(outer - 180) < 0.5 ? 'smooth' : outer > 180 ? 'convex' : 'concave'
}

/** The shapes, each once (by `_identity()`). */
export function _unique<T>(items: Iterable<T>): ShapeList<T> {
  const out = new ShapeList<T>()
  const seen = new Set<unknown>()
  for (const s of items) {
    const identity = (s as { _identity?: () => string })._identity
    const key = typeof identity === 'function' ? identity.call(s) : s
    if (!seen.has(key)) {
      seen.add(key)
      out.push(s)
    }
  }
  return out
}

/** The error for a face, edge or vertex of a body that `dispose()` freed: they went with it (the
 * kernel's numbers of them point into freed memory). */
function _ownerDisposed(what: string): TypeError {
  return new TypeError(`the ${what}'s body was disposed: dispose() frees a body with its faces, edges and vertices; take them from a body that is still in use`)
}

function _directionOf(s: unknown): Vector | null {
  if (s instanceof Edge) return s._isStraight() ? s.direction : null
  if (s instanceof Face) return s.isPlanar ? s.normalAt() : null
  if (s instanceof Sketch) return s.plane.zDir
  return null
}

// =============================================================================== Vertex
/** A point. Vertices of bodies come from `.vertices()`; `new Vertex(x, y, z)` makes one. */
export class Vertex extends Shape {
  _owner: _Body | null = null
  _kv = 0
  _p: Vector

  constructor(x: number | VectorLike = 0, y = 0, z = 0) {
    super()
    this._p = typeof x === 'number' ? new Vector(x, y, z) : _vec(x)
  }

  static _of(owner: _Body | null, kvertex: number): Vertex {
    const v = new Vertex(k.vertex_point(kvertex))
    v._owner = owner
    v._kv = kvertex
    return v
  }

  /** The kernel vertex (0 for a point); a TypeError once its body was disposed. */
  get _v(): number {
    if (this._owner !== null && !this._owner._h.alive) throw _ownerDisposed('vertex')
    return this._kv
  }

  get point(): Vector {
    return this._p
  }

  get x(): number {
    return this._p.x
  }

  get y(): number {
    return this._p.y
  }

  get z(): number {
    return this._p.z
  }

  center(): Vector {
    return this._p
  }

  bbox(): BoundBox {
    return new BoundBox(this._p, this._p)
  }

  vertices(): ShapeList<Vertex> {
    return new ShapeList<Vertex>(this)
  }

  edges(): ShapeList<Edge> {
    if (!this._v) return new ShapeList<Edge>()
    return _list((k.vertex_edges(this._v) as number[]).map((e) => Edge._of(this._owner, e)))
  }

  override faces(): ShapeList<Face> {
    if (!this._v) return new ShapeList<Face>()
    return _list((k.vertex_faces(this._v) as number[]).map((f) => new Face(this._owner, f)))
  }

  override distanceTo(other: VectorLike | Shape): number {
    if (other instanceof Shape) return other.distanceTo(this._p)
    return this._p.distanceTo(other)
  }

  /** For a corner of a sketch: "convex" where the region's angle is below 180 degrees (an
   * outside corner), "concave" above (an inside corner, also every corner of a square hole),
   * "smooth" where the two edges meet tangentially. */
  get convexity(): string {
    if (!(this._owner instanceof Sketch)) {
      throw new RangeError('convexity is defined for the corners of a sketch; for a part, select its edges (part.edges().convex())')
    }
    return cornerKind(this._owner, this._p)
  }

  _transformed(m: Matrix): Vertex {
    return new Vertex(_apply(m, this._p))
  }

  _identity(): string {
    return this._v ? `v:${this._v}` : `p:${this._p.x},${this._p.y},${this._p.z}`
  }

  equals(other: unknown): boolean {
    if (!(other instanceof Vertex)) return false
    if (this._v && other._v) return this._v === other._v
    return this._p.isClose(other._p)
  }

  *[Symbol.iterator](): IterableIterator<number> {
    yield* this._p
  }

  override toString(): string {
    return `Vertex(${_formatG(this._p.x)}, ${_formatG(this._p.y)}, ${_formatG(this._p.z)})`
  }
}

// =============================================================================== Edge
/**
 * A bounded curve: a line segment, an arc, a circle, an ellipse or a NURBS curve.
 *
 * Edges come from bodies (`part.edges()`) or from curve constructors such as `Line`,
 * `ThreePointArc` and `Spline`. Parameters along an edge (`pointAt(t)`) run from 0 at the start
 * to 1 at the end, proportional to arc length.
 */
export class Edge extends Shape {
  _owner: _Body | null = null
  _ke = 0
  _c: CurveHandle | null = null
  _rev = false
  _cache: [number, number] | null = null

  /** (create edges with Line(), ThreePointArc(), Spline(), ... or take them from a shape) */
  constructor(token?: symbol) {
    super()
    if (token !== INTERNAL) throw new TypeError('create edges with Line(), ThreePointArc(), Spline(), ... or take them from a shape')
  }

  static _of(owner: _Body | null, kedge: number, reversed = false): Edge {
    const e = new Edge(INTERNAL)
    e._owner = owner
    e._ke = kedge
    e._rev = reversed
    return e
  }

  /** The kernel edge (0 for a standalone curve); a TypeError once its body was disposed. */
  get _e(): number {
    if (this._owner !== null && !this._owner._h.alive) throw _ownerDisposed('edge')
    return this._ke
  }

  /** Wrap a new standalone kernel curve (takes ownership). */
  static _fromCurve(curve: number): Edge {
    const e = new Edge(INTERNAL)
    e._c = new CurveHandle(curve)
    return e
  }

  /** Frees the kernel's curve of a standalone edge now, not when the garbage collector gets to
   * it; the edges that share it (`reversed()`, wires made of the edge) cannot be used afterwards.
   * An edge of a body belongs to the body: dispose the body. */
  dispose(): void {
    this._c?.dispose()
  }

  [Symbol.dispose](): void {
    this.dispose()
  }

  // -- kernel access ------------------------------------------------------------------------
  _curve(): number {
    return this._e ? k.edge_curve(this._e) : this._c!.curve
  }

  _range(): [number, number] {
    if (this._cache === null) {
      const [t0, t1] = this._e ? k.edge_parameter_range(this._e) : k.curve_parameter_range(this._curve())
      this._cache = [Number(t0), Number(t1)]
    }
    return this._cache
  }

  /** A new standalone kernel curve with this edge's extent and direction. */
  _copyCurve(): number {
    const c = this._e ? ext.edge_curve(this._e) : ext.copy_curve(this._c!.curve)
    if (this._rev) ext.reverse_curve(c)
    return c
  }

  /** Kernel parameter at fraction `t` of the arc length (in edge direction). */
  _param(t: number): number {
    const [t0, t1] = this._range()
    if (this._rev) t = 1 - t
    if (t <= 0) return t0
    if (t >= 1) return t1
    if (this.geomType === 'line') return t0 + (t1 - t0) * t
    const s = t * ext.curve_length(this._curve(), t0, t1)
    const [u] = ext.curve_parameter_at_length(this._curve(), t0, s)
    return Math.min(Math.max(u, t0), t1)
  }

  // -- properties ---------------------------------------------------------------------------
  /** "line", "circle" (also arcs), "ellipse", "bspline" or "other". */
  get geomType(): string {
    return ext.curve_kind(this._curve())
  }

  get length(): number {
    const [t0, t1] = this._range()
    return Number(ext.curve_length(this._curve(), t0, t1))
  }

  get start(): Vector {
    const [t0, t1] = this._range()
    return new Vector(k.curve_evaluate(this._curve(), this._rev ? t1 : t0))
  }

  get end(): Vector {
    const [t0, t1] = this._range()
    return new Vector(k.curve_evaluate(this._curve(), this._rev ? t0 : t1))
  }

  get isClosed(): boolean {
    return this.start.isClose(this.end, 1e-7)
  }

  /** True for the seam of a closed surface (an edge used twice by one face). */
  get isSeam(): boolean {
    if (!this._e) return false
    const fs: number[] = k.edge_faces(this._e)
    if (fs.length !== 1) return false
    let uses = 0
    for (const loop of k.face_boundary_loops(fs[0]) as [number, boolean][][]) for (const [e] of loop) if (e === this._e) uses++
    return uses > 1
  }

  /** "convex" for an outside corner (material angle below 180 degrees), "concave" for an inside
   * corner, "smooth" where the faces meet tangentially (within half a degree). Taken at the middle
   * of the edge. Edges with a single face count as convex. */
  get convexity(): string {
    const a = _outerAngles([this])[0]
    return a !== null ? _angleKind(a) : this._probedConvexity()
  }

  /** The angle between the two faces of the edge through the material, in degrees, at the middle
   * of the edge: 90 at the edges of a box, 270 at the inside corner of an L, 180 where the faces
   * meet tangentially. RangeError for an edge that does not lie between two faces. */
  get dihedralAngle(): number {
    const a = _outerAngles([this])[0]
    if (a !== null) return 360 - a
    const fs: number[] = this._e ? k.edge_faces(this._e) : []
    if (fs.length !== 2) throw new RangeError('dihedralAngle: the edge does not lie between two faces')
    const p = this.center()
    const turn = new Face(this._owner, fs[0]).normalAt(p).angleTo(new Face(this._owner, fs[1]).normalAt(p))
    return this._probedConvexity() === 'concave' ? 180 + turn : 180 - turn
  }

  /** The convexity from the faces' normals and a step into face 1, for edges the kernel's outer
   * angle does not cover (an edge of a sheet, an inner edge of a merged part). On edges that lie
   * off their faces by more than the step (imported bodies) the step can read noise. */
  _probedConvexity(): string {
    if (!this._e) return 'convex'
    const fs: number[] = k.edge_faces(this._e)
    if (fs.length !== 2) return 'convex'
    const f1 = new Face(this._owner, fs[0])
    const f2 = new Face(this._owner, fs[1])
    const p = this.center()
    const n1 = f1.normalAt(p)
    const n2 = f2.normalAt(p)
    if (n1.angleTo(n2) < 0.5) return 'smooth'
    const t = this.tangentAt(0.5)
    const eps = 1e-4 * Math.max(this.length, 1e-9)
    let into = n1.cross(t)
    // pick the in-face direction of face 1 that stays on the face
    if (f1.distanceTo(p.add(into.mul(eps))) > f1.distanceTo(p.sub(into.mul(eps)))) into = into.neg()
    return n2.dot(into) < 0 ? 'convex' : 'concave'
  }

  /** True on an outside corner (see `convexity`). */
  isConvex(): boolean {
    return this.convexity === 'convex'
  }

  /** Unit direction of a straight edge (start to end). */
  get direction(): Vector {
    if (!this._isStraight()) throw new RangeError(`direction is only defined for straight edges, this is a ${this.geomType}`)
    return this.end.sub(this.start).normalized()
  }

  /** A line, or a B-spline whose control points lie on a line (chamfers, mirrored lines and the
   * like make those). */
  _isStraight(): boolean {
    const kind = this.geomType
    if (kind === 'line') return true
    if (kind !== 'bspline') return false
    return _collinear(ext.curve_data(this._curve()).poles)
  }

  _circle(): Any {
    if (this.geomType !== 'circle') throw new RangeError(`not a circular edge but a ${this.geomType}`)
    return ext.curve_data(this._curve())
  }

  /** Radius of a circular edge. */
  get radius(): number {
    return Number(this._circle().radius)
  }

  /** Center of a circular edge. */
  get arcCenter(): Vector {
    return new Vector(this._circle().placement.origin)
  }

  /** Axis direction of a circular edge. */
  get normal(): Vector {
    return new Vector(this._circle().placement.z_dir)
  }

  /** Point at fraction `t` of the edge length (0 = start, 1 = end). */
  pointAt(t = 0.5): Vector {
    return new Vector(k.curve_evaluate(this._curve(), this._param(t)))
  }

  /** Unit tangent at fraction `t` of the edge length, pointing along the edge. */
  tangentAt(t = 0.5): Vector {
    const d = new Vector(ext.curve_eval(this._curve(), this._param(t), 1)[1]).normalized()
    return this._rev ? d.neg() : d
  }

  /** The point halfway along the edge (use `arcCenter` for a circle's center). */
  center(): Vector {
    return this.pointAt(0.5)
  }

  bbox(): BoundBox {
    if (this._e) {
      const [lo, hi] = k.edge_bounding_box(this._e, true)
      return new BoundBox(lo, hi)
    }
    let pts: Vector[] = []
    for (let i = 0; i <= 32; i++) pts.push(this.pointAt(i / 32))
    if (this.geomType === 'line') pts = [this.start, this.end]
    return BoundBox.ofPoints(pts)
  }

  override distanceTo(point: VectorLike | Shape): number {
    const p = point instanceof Vertex ? point.point : _vec(point as VectorLike)
    if (this._e) return Number(k.edge_closest_point(this._e, p.toArray())[2])
    return Number(k.curve_closest_point(this._curve(), p.toArray())[2])
  }

  /** Points where this edge crosses another edge. */
  intersections(other: Edge): Vector[] {
    const [pts, ta, tb] = kernelCall('edge intersections', () => k.intersect_curves(this._curve(), other._curve()))
    const [a0, a1] = this._range()
    const [b0, b1] = other._range()
    const out: Vector[] = []
    for (let i = 0; i < pts.length; i++) {
      const u = ta[i]
      const v = tb[i]
      if (a0 - 1e-9 <= u && u <= a1 + 1e-9 && b0 - 1e-9 <= v && v <= b1 + 1e-9) out.push(new Vector(pts[i]))
    }
    return out
  }

  // -- topology -----------------------------------------------------------------------------
  vertices(): ShapeList<Vertex> {
    if (this._e) {
      const [a, b] = k.edge_vertices(this._e)
      const vs = [Vertex._of(this._owner, a), Vertex._of(this._owner, b)]
      if (this._rev) vs.reverse()
      return _unique(vs)
    }
    return _unique([new Vertex(this.start), new Vertex(this.end)])
  }

  edges(): ShapeList<Edge> {
    return new ShapeList<Edge>(this)
  }

  override faces(): ShapeList<Face> {
    if (!this._e) return new ShapeList<Face>()
    return _list((k.edge_faces(this._e) as number[]).map((f) => new Face(this._owner, f)))
  }

  // -- derived edges ------------------------------------------------------------------------
  /** The same edge traversed the other way. */
  reversed(): Edge {
    const e = new Edge(INTERNAL)
    e._owner = this._owner
    e._ke = this._e
    e._c = this._c
    e._rev = !this._rev
    e._cache = this._cache
    return e
  }

  /**
   * This edge as a NURBS curve, from its start to its end: degree, knots, control points and
   * weights. Exact for lines, arcs (rational) and B-splines; other curves are approximated within
   * 1e-7.
   */
  nurbs(): Nurbs {
    const c = this._copyCurve()
    let d: Any
    try {
      d = ext.curve_data(c, true)
    } finally {
      ext.delete_curve(c)
    }
    return new Nurbs(Number(d.degree), d.knots.map(Number), d.poles.map((p: number[]) => new Vector(p[0], p[1], p[2])),
      d.weights == null ? null : d.weights.map(Number))
  }

  /**
   * The same curve with the knots it does not need taken out: a B-spline with fewer control points
   * (the kernel's knot removal, which keeps the curve within about 1e-6 of where it was). Lines,
   * arcs and other analytic curves come back as they are.
   */
  removeKnots(): Edge {
    const c = this._copyCurve()
    kernelCall('removeKnots', () => k.remove_curve_knots(c))
    return Edge._fromCurve(c)
  }

  _transformed(m: Matrix): Edge {
    return Edge._fromCurve(_transformCurve(this._copyCurve(), m))
  }

  /** A wire of this edge and the other (Python's `+`). */
  add(other: Edge | Wire): Wire {
    return new Wire([this, other])
  }

  _identity(): string {
    return this._e ? `e:${this._e}` : `c:${this._c!.id}`
  }

  equals(other: unknown): boolean {
    return other instanceof Edge && this._identity() === other._identity()
  }

  override toString(): string {
    const s = this.start
    const e = this.end
    const f = (v: number) => _formatG(v, 4)
    return `Edge(${this.geomType}, (${f(s.x)}, ${f(s.y)}, ${f(s.z)}) -> (${f(e.x)}, ${f(e.y)}, ${f(e.z)}))`
  }
}

function _collinear(points: readonly (readonly number[])[]): boolean {
  const sv = spread(points).values
  return sv.length > 0 && sv[0] > 0 && (sv[1] ?? 0) <= 1e-10 * sv[0]
}

export function _coplanar(points: readonly (readonly number[])[]): boolean {
  const sv = spread(points).values
  return sv.length > 2 && sv[0] > 0 && sv[2] <= 1e-10 * sv[0]
}

// numpy's allclose: |a - b| <= atol + rtol * |b| everywhere
function _allclose(a: readonly number[], b: readonly number[], atol: number, rtol = 1e-5): boolean {
  return a.every((x, i) => Math.abs(x - b[i]) <= atol + rtol * Math.abs(b[i]))
}

function _rotation(m: Matrix): number[] {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
}

function _gram(r: number[]): number[] {
  const g = new Array<number>(9)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g[i * 3 + j] = r[i * 3] * r[j * 3] + r[i * 3 + 1] * r[j * 3 + 1] + r[i * 3 + 2] * r[j * 3 + 2]
  return g
}

export function _isRigid(m: Matrix): boolean {
  const r = _rotation(m)
  return _allclose(_gram(r), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-12) && det3(r) > 0
}

/** True for a rotation, reflection or uniform scale (with any translation): the maps that take
 * lines to lines and circles to circles. */
export function _similarity(m: Matrix): boolean {
  const g = _gram(_rotation(m))
  const s2 = (g[0] + g[4] + g[8]) / 3
  return s2 > 0 && _allclose(g, [s2, 0, 0, 0, s2, 0, 0, 0, s2], 1e-12 * Math.max(1, s2))
}

/** The image of a line or circle under a similarity as an exact line or circle (a new curve), or
 * null for other curves. */
function _exactImage(curve: number, m: Matrix): number | null {
  const kind = ext.curve_kind(curve)
  if (kind !== 'line' && kind !== 'circle') return null
  const [t0, t1] = k.curve_parameter_range(curve)
  const image = (t: number) => _apply(m, new Vector(k.curve_evaluate(curve, t)))
  const a = image(t0)
  const e = image(t1)
  if (kind === 'line') return kernelCall('transform', () => k.create_line_segment(a.toArray(), e.toArray()))
  if (a.distanceTo(e) > 1e-9 * Math.max(1, a.length)) return ThreePointArc(a, image(0.5 * (t0 + t1)), e)._copyCurve()
  const b = image(t0 + (t1 - t0) / 3)
  const c = image(t0 + (2 * (t1 - t0)) / 3)
  const ab = b.sub(a)
  const ac = c.sub(a)
  const n = ab.cross(ac)
  const center = a.add(ab.cross(n).mul(ac.dot(ac)).sub(ac.cross(n).mul(ab.dot(ab))).div(2 * n.dot(n)).mul(-1))
  return _arcCurve(new Vector(0, 0, 0), center.distanceTo(a), 0, 360, new Plane(center, a.sub(center), n.normalized()))
}

/** Apply a 4x4 matrix to a standalone kernel curve (consumes `curve`). */
export function _transformCurve(curve: number, m: Matrix): number {
  if (_isRigid(m)) {
    const placement = k.Axis2Placement([m[3], m[7], m[11]], [m[0], m[4], m[8]], [m[1], m[5], m[9]])
    k.transform(curve, placement)
    return curve
  }
  if (_similarity(m)) {
    // Mirrored and uniformly scaled lines and circles stay lines and circles.
    const exact = _exactImage(curve, m)
    if (exact !== null) {
      ext.delete_curve(curve)
      return exact
    }
  }
  // Other maps: NURBS are invariant under affine maps of their poles.
  const d = ext.curve_data(curve)
  ext.delete_curve(curve)
  const poles = (d.poles as number[][]).map((p) => _apply(m, new Vector(p)).toArray())
  return _canonicalCurve(poles, d.knots, d.degree, d.weights)
}

/** Calls `fn` with standalone kernel curves (copies made for a kernel call) and deletes them
 * afterwards. The kernel's sweeps, revolves and skins copy the curves they are given and leave them to
 * the caller: a few KB a call, and the WebAssembly heap never shrinks (Python's `_freed`). */
export function _freed<T>(curves: number[], fn: (curves: number[]) => T): T {
  try {
    return fn(curves)
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
}

export function _canonicalCurve(poles: readonly (readonly number[])[], knots: Iterable<number>, degree: number, weights: Iterable<number> | null): number {
  const uniq: number[] = []
  const mult: number[] = []
  for (const kv of knots) {
    if (uniq.length && Math.abs(kv - uniq[uniq.length - 1]) <= 1e-14 * Math.max(1, Math.abs(kv))) mult[mult.length - 1] += 1
    else {
      uniq.push(Number(kv))
      mult.push(1)
    }
  }
  return k.create_canonical_curve(poles.map(_t), uniq, mult, weights == null ? null : Array.from(weights, Number), Math.trunc(degree))
}

// =============================================================================== Wire
/** A chain of edges, open or closed. `new Wire([edge, edge, ...])` orders and orients the edges. */
export class Wire extends Shape {
  _edges: readonly Edge[]

  constructor(edges: Edge | Wire | Iterable<Edge | Wire | Iterable<Edge | Wire>>, options: { sort?: boolean } = {}) {
    super()
    _opts('Wire', options)
    const sort = options.sort ?? true
    const flat: Edge[] = []
    if (!(edges instanceof Edge || edges instanceof Wire) && !_isIterable(edges)) {
      throw new TypeError(`a wire is made of edges, got ${_typeName(edges)}`)
    }
    const items: unknown[] = edges instanceof Edge || edges instanceof Wire ? [edges] : Array.from(edges as Iterable<unknown>)
    for (const it of items) {
      if (it instanceof Wire) flat.push(...it._edges)
      else if (it instanceof Edge) flat.push(it)
      else if (Array.isArray(it)) flat.push(...new Wire(it as Edge[], { sort: false })._edges)
      else throw new TypeError(`a wire is made of edges, got ${_typeName(it)}`)
    }
    if (!flat.length) throw new RangeError('a wire needs at least one edge')
    this._edges = Object.freeze(sort ? _chain(flat) : flat)
  }

  static _raw(edges: readonly Edge[]): Wire {
    const w = Object.create(Wire.prototype) as Wire
    w._edges = Object.freeze([...edges])
    return w
  }

  /** Frees the kernel's curves of the wire's standalone edges now (see `Edge.dispose`); the edges
   * cannot be used afterwards, here or elsewhere. */
  dispose(): void {
    for (const e of this._edges) e.dispose()
  }

  [Symbol.dispose](): void {
    this.dispose()
  }

  edges(): ShapeList<Edge> {
    return _list(this._edges)
  }

  vertices(): ShapeList<Vertex> {
    return _unique(this._edges.flatMap((e) => [...e.vertices()]))
  }

  override wires(): ShapeList<Wire> {
    return new ShapeList<Wire>(this)
  }

  get isClosed(): boolean {
    return this.start.isClose(this.end, 1e-6)
  }

  get start(): Vector {
    return this._edges[0].start
  }

  get end(): Vector {
    return this._edges[this._edges.length - 1].end
  }

  get length(): number {
    let s = 0
    for (const e of this._edges) s += e.length
    return s
  }

  /** Length-weighted average of the edge midpoints. */
  center(): Vector {
    let total = 0
    let c = new Vector()
    for (const e of this._edges) {
      const L = e.length
      c = c.add(e.center().mul(L))
      total += L
    }
    return total ? c.div(total) : this._edges[0].start
  }

  bbox(): BoundBox {
    let b = this._edges[0].bbox()
    for (const e of this._edges.slice(1)) b = b.union(e.bbox())
    return b
  }

  /** Point at fraction `t` of the total length. */
  pointAt(t = 0.5): Vector {
    const lengths = this._edges.map((e) => e.length)
    let s = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0)
    const lastEdge = this._edges[this._edges.length - 1]
    for (let i = 0; i < this._edges.length; i++) {
      const e = this._edges[i]
      const L = lengths[i]
      if (s <= L || e === lastEdge) return e.pointAt(L ? s / L : 0)
      s -= L
    }
    return this.end
  }

  tangentAt(t = 0.5): Vector {
    const lengths = this._edges.map((e) => e.length)
    let s = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0)
    const lastEdge = this._edges[this._edges.length - 1]
    for (let i = 0; i < this._edges.length; i++) {
      const e = this._edges[i]
      const L = lengths[i]
      if (s <= L || e === lastEdge) return e.tangentAt(L ? s / L : 0)
      s -= L
    }
    return lastEdge.tangentAt(1)
  }

  override distanceTo(point: VectorLike | Shape): number {
    return Math.min(...this._edges.map((e) => e.distanceTo(point)))
  }

  /** This wire closed with a straight line from its end to its start. */
  close(): Wire {
    if (this.isClosed) return this
    return Wire._raw([...this._edges, Line(this.end, this.start)])
  }

  reversed(): Wire {
    return Wire._raw(this._edges.map((e) => e.reversed()).reverse())
  }

  _transformed(m: Matrix): Wire {
    return Wire._raw(this._edges.map((e) => e._transformed(m)))
  }

  _copyCurves(): number[] {
    return this._edges.map((e) => e._copyCurve())
  }

  /** A wire of this one and the other (Python's `+`). */
  add(other: Edge | Wire): Wire {
    return new Wire([this, other])
  }

  /** The plane of a planar wire (normal by the right-hand rule along the wire). */
  plane(): Plane {
    const pts: Vector[] = []
    for (let i = 0; i < 64; i++) pts.push(this.pointAt(i / 64))
    return _fitPlane(pts, this.isClosed)
  }

  /** Round the corners between straight edges with tangent arcs (planar wires). */
  fillet(radius: number, vertices: Iterable<VectorLike | Vertex> | null = null): Wire {
    return _filletWire(this, radius, vertices)
  }

  /** The planar region bounded by this closed wire. */
  toSketch(): Sketch {
    return Sketch._fromWires([this])
  }

  override toString(): string {
    const kind = this.isClosed ? 'closed' : 'open'
    return `Wire(${this._edges.length} edges, ${kind}, length=${_formatG(this.length)})`
  }
}

/** The wire with consecutive collinear line segments joined into one. */
export function _mergedLines(wire: Wire): Wire {
  const edges = [...wire.edges()]
  if (edges.length < 2) return wire
  const collinear = (a: Edge, b: Edge) =>
    a.geomType === 'line' && b.geomType === 'line' && a.end.isClose(b.start, 1e-9) && a.direction.angleTo(b.direction) < 1e-7
  const out: Edge[] = []
  for (const e of edges) {
    if (out.length && collinear(out[out.length - 1], e)) out[out.length - 1] = Line(out[out.length - 1].start, e.end)
    else out.push(e)
  }
  if (out.length > 2 && wire.isClosed && collinear(out[out.length - 1], out[0])) {
    out[0] = Line(out[out.length - 1].start, out[0].end)
    out.pop()
  }
  return out.length !== edges.length ? Wire._raw(out) : wire
}

/** Order edges head to tail, reversing where needed. Leaves them alone if they don't chain. */
export function _chain(edges: Edge[], tol = 1e-6): Edge[] {
  if (edges.length < 2) return edges
  const rest = edges.slice()
  const chain = [rest.shift()!]
  while (rest.length) {
    const end = chain[chain.length - 1].end
    const start = chain[0].start
    let found = false
    for (let i = 0; i < rest.length; i++) {
      const e = rest[i]
      if (e.start.isClose(end, tol)) {
        chain.push(rest.splice(i, 1)[0])
      } else if (e.end.isClose(end, tol)) {
        chain.push(rest.splice(i, 1)[0].reversed())
      } else if (e.end.isClose(start, tol)) {
        chain.unshift(rest.splice(i, 1)[0])
      } else if (e.start.isClose(start, tol)) {
        chain.unshift(rest.splice(i, 1)[0].reversed())
      } else continue
      found = true
      break
    }
    if (!found) return edges // not a single chain; keep the given order
  }
  return chain
}

/** Approximate enclosed area of a closed planar wire (sampled polygon). */
export function _loopArea(wire: Wire, samples = 24): number {
  const pts: Vector[] = []
  for (const e of wire.edges()) {
    const n = e.geomType === 'line' ? 1 : samples
    for (let i = 0; i < n; i++) pts.push(e.pointAt(i / n))
  }
  const c = new Vector(mean3(pts.map((p) => p.toArray())))
  let s = new Vector()
  for (let i = 0; i < pts.length; i++) s = s.add(pts[i].sub(c).cross(pts[(i + 1) % pts.length].sub(c)))
  return 0.5 * s.length
}

export function _fitPlane(points: readonly Vector[], closed = true): Plane {
  const pts = points.map((p) => p.toArray())
  const c = new Vector(mean3(pts))
  // Newell normal for closed polygons: orientation follows the traversal.
  let n = new Vector()
  if (closed) {
    for (let i = 0; i < points.length; i++) n = n.add(points[i].sub(c).cross(points[(i + 1) % points.length].sub(c)))
  }
  if (n.length < 1e-12) n = new Vector(spread(pts).directions[2])
  return new Plane(c, null, n.normalized())
}

// =============================================================================== Face
/** A bounded piece of a surface, belonging to a body (a part, shell or sketch). */
export class Face extends Shape {
  readonly _owner: _Body | null
  readonly _kf: number
  _info: Any = null
  _m: Any = null

  constructor(owner: _Body | null, kface: number) {
    super()
    this._owner = owner
    this._kf = kface
  }

  /** The kernel face; a TypeError once its body was disposed. */
  get _f(): number {
    if (this._owner !== null && !this._owner._h.alive) throw _ownerDisposed('face')
    return this._kf
  }

  /** The body this face belongs to. */
  get owner(): _Body | null {
    return this._owner
  }

  // -- geometry -----------------------------------------------------------------------------
  _surfaceInfo(): Any {
    if (this._info === null) this._info = ext.surface_data(k.face_surface(this._f), false)
    return this._info
  }

  /** "plane", "cylinder", "cone", "sphere", "torus", "revolution", "extrusion", "bspline",
   * "offset" or "other". */
  get geomType(): string {
    const info = this._surfaceInfo()
    const kind: string = info.kind
    if (kind === 'cone' && Math.abs(info.semi_angle_deg ?? 1) < 1e-12) return 'cylinder'
    return kind
  }

  /** Area and first moments, integrated to `ACCURACY` (see `Part.massProperties`). */
  _measure(): Any {
    if (this._m === null) this._m = kernelCall('face area', () => ext.face_measure(this._f, ACCURACY * _MARGIN))
    return this._m
  }

  get area(): number {
    return Number(this._measure().area)
  }

  /** Area centroid. For curved faces it may lie off the face; see `interiorPoint`. */
  center(): Vector {
    const p = this._measure()
    const a = p.signed_area
    if (Math.abs(a) < 1e-300) return new Vector(k.face_interior_point(this._f))
    return new Vector(p.origin).add(new Vector(p.first_moments).div(a))
  }

  /** A point guaranteed to lie on the face. */
  interiorPoint(): Vector {
    return new Vector(k.face_interior_point(this._f))
  }

  /** Outward unit normal at the face point closest to `point` (default: the center). */
  normalAt(point: VectorLike | null = null): Vector {
    if (point == null && this.geomType === 'plane') {
      const pl = this._surfaceInfo().placement
      const n = new Vector(pl.z_dir)
      return this._naturalIsOutward() ? n : n.neg()
    }
    const p = point != null ? _vec(point) : this.center()
    const [, uvs] = k.surface_closest_point(k.face_surface(this._f), p.toArray())
    const uv = uvs[0]
    return new Vector(k.face_outward_normal_at_uv(this._f, uv[0], uv[1]))
  }

  _naturalIsOutward(): boolean {
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(this._f)
    const u = 0.5 * (u0 + u1)
    const v = 0.5 * (v0 + v1)
    const n0 = new Vector(k.face_normal_at_uv(this._f, u, v))
    const n1 = new Vector(k.face_outward_normal_at_uv(this._f, u, v))
    return n0.dot(n1) > 0
  }

  /** True for planes and for flat B-spline faces (control points in one plane). */
  get isPlanar(): boolean {
    const kind = this.geomType
    if (kind === 'plane') return true
    if (kind === 'bspline') {
      const poles = ext.surface_data(k.face_surface(this._f), true).poles
      if (_coplanar(poles)) return true
    }
    return Boolean(k.surface_is_planar(k.face_surface(this._f), 1e-7))
  }

  /** The face's plane: origin at its centroid, normal pointing out of the body. */
  get plane(): Plane {
    return this._planeOfFace()
  }

  _planeOfFace(): Plane {
    if (!this.isPlanar) throw new RangeError(`a ${this.geomType} face has no plane; use normalAt() or a planar face`)
    const n = this.normalAt()
    if (this._owner instanceof Sketch) {
      const sp = this._owner.plane
      if (sp.zDir.isParallel(n)) return new Plane(this.center(), sp.xDir, sp.zDir)
    }
    return new Plane(this.center(), null, n)
  }

  /** Radius of a cylinder, sphere or cone (at its base), minor radius of a torus. */
  get radius(): number {
    const info = this._surfaceInfo()
    if ('minor_radius' in info) return Number(info.minor_radius)
    if ('radius' in info) return Number(info.radius)
    throw new RangeError(`a ${this.geomType} face has no radius`)
  }

  /** Axis of a cylinder, cone, sphere, torus or surface of revolution. */
  get axis(): Axis {
    const info = this._surfaceInfo()
    const pl = info.placement
    if (pl == null || this.geomType === 'plane') throw new RangeError(`a ${this.geomType} face has no axis`)
    return new Axis(pl.origin, pl.z_dir)
  }

  bbox(): BoundBox {
    const [lo, hi] = k.face_bounding_box(this._f, true)
    return new BoundBox(lo, hi)
  }

  override distanceTo(point: VectorLike | Shape): number {
    const p = point instanceof Vertex ? point.point : _vec(point as VectorLike)
    return Number(k.face_closest_point(this._f, p.toArray())[1])
  }

  /** Where a ray meets this face, nearest first (see `Part.raycast`). */
  raycast(origin: VectorLike | Axis, direction: VectorLike | Axis | null = null): Hit[] {
    return _raycast([this], origin, direction, this.bbox())
  }

  // -- topology -----------------------------------------------------------------------------
  _loops(): Wire[] {
    const loops: [number, boolean][][] = k.face_boundary_loops(this._f)
    return loops.map((loop) => Wire._raw(loop.map(([e, fwd]) => Edge._of(this._owner, e, !fwd))))
  }

  outerWire(): Wire {
    return this._loops()[0]
  }

  innerWires(): ShapeList<Wire> {
    return _list(this._loops().slice(1))
  }

  override wires(): ShapeList<Wire> {
    return _list(this._loops())
  }

  /** The face's edges (seam edges only with `seams`). */
  edges(seams = false): ShapeList<Edge> {
    const out = new ShapeList<Edge>()
    const counts = new Map<number, number>()
    const loops: [number, boolean][][] = k.face_boundary_loops(this._f)
    for (const loop of loops) for (const [e] of loop) counts.set(e, (counts.get(e) ?? 0) + 1)
    const seen = new Set<number>()
    for (const loop of loops) {
      for (const [e] of loop) {
        if (seen.has(e) || (counts.get(e)! > 1 && !seams)) continue
        seen.add(e)
        out.push(Edge._of(this._owner, e))
      }
    }
    return out
  }

  vertices(): ShapeList<Vertex> {
    return _list((k.face_vertices(this._f) as number[]).map((v) => Vertex._of(this._owner, v)))
  }

  override faces(): ShapeList<Face> {
    return new ShapeList<Face>(this)
  }

  /** Faces sharing an edge with this one. */
  neighbors(): ShapeList<Face> {
    const out = _unique(this.edges().flatMap((e) => [...e.faces()]))
    return out.filter((f) => !f.equals(this))
  }

  // -- conversion ---------------------------------------------------------------------------
  /** A sketch holding a copy of this (planar) face. */
  toSketch(): Sketch {
    const plane = this.plane
    const b = kernelCall('copy face', () => ext.copy_faces(this._owner!._brep, [this._f]))
    return Sketch._wrap(b, { plane })
  }

  /** A sheet body holding a copy of this face. */
  toShell(): Shell {
    const b = kernelCall('copy face', () => ext.copy_faces(this._owner!._brep, [this._f]))
    return Shell._wrap(b)
  }

  /** Extrude a planar face along its normal (see `Sketch.extrude`). */
  extrude(amount: number, options: ExtrudeOptions = {}): Part {
    return this.toSketch().extrude(amount, options)
  }

  _transformed(m: Matrix): Face {
    const moved = this.toShell()._transformed(m)
    return moved.faces()[0]
  }

  _identity(): string {
    return `f:${this._f}`
  }

  equals(other: unknown): boolean {
    return other instanceof Face && this._f === other._f
  }

  override toString(): string {
    const c = this.center()
    const f = (v: number) => _formatG(v, 4)
    return `Face(${this.geomType}, area=${_formatG(this.area)}, center=(${f(c.x)}, ${f(c.y)}, ${f(c.z)}))`
  }
}

// =============================================================================== bodies
/** A shape backed by one kernel Brep: a Part, a Shell or a Sketch. */
export class _Body extends Shape {
  _h!: BrepHandle
  name: string | null = null
  color: ColorLike | null = null

  /** (create bodies with the constructors: Box(), Rectangle(), ...) */
  constructor(token?: symbol) {
    super()
    if (token !== INTERNAL) throw new TypeError(`create a ${new.target.name} with the constructors (Box(), Rectangle(), ...)`)
  }

  /** A body of this class around a new Brep (takes ownership). */
  static _wrap<B extends _Body>(this: new (token: symbol) => B, brep: number, options: BodyOptions = {}): B {
    const b = new this(INTERNAL)
    b._h = new BrepHandle(brep)
    b.name = options.name ?? null
    b.color = options.color ?? null
    if (b instanceof Sketch) {
      b._plane = options.plane ?? Plane.XY
      b._loops = null
    }
    return b
  }

  get _brep(): number {
    return this._h.brep
  }

  _copyBrep(): number {
    return k.brep_copy(this._brep)
  }

  /** A body of the same type and metadata around `brep`. */
  _like(brep: number): this {
    return (this.constructor as typeof _Body)._wrap.call(this.constructor as Any, brep, { name: this.name, color: this.color }) as this
  }

  /** Frees the kernel's body now, not when the garbage collector gets to it. Faces, edges and
   * vertices taken from it must not be used afterwards. */
  dispose(): void {
    this._h.dispose()
  }

  [Symbol.dispose](): void {
    this.dispose()
  }

  // -- metadata (returns copies; shapes are immutable) --------------------------------------
  /** The same body with a name (used by exporters and the viewer). */
  named(name: string): this {
    const b = this._like(this._copyBrep())
    b.name = name
    return b
  }

  /** The same body with a display color ("steelblue", "#4682b4" or [r, g, b]). */
  colored(color: ColorLike): this {
    const b = this._like(this._copyBrep())
    b.color = color
    return b
  }

  // -- topology -----------------------------------------------------------------------------
  override faces(): ShapeList<Face> {
    return _list((k.brep_faces(this._brep) as number[]).map((f) => new Face(this, f)))
  }

  /** All edges. Seam edges (where a closed surface such as a cylinder meets itself) are left out
   * unless `seams` is true. */
  edges(seams = false): ShapeList<Edge> {
    const all: number[] = k.brep_edges(this._brep)
    if (seams) return _list(all.map((e) => Edge._of(this, e)))
    const skip = new Set<number>(ext.seam_edges(this._brep))
    return _list(all.filter((_, i) => !skip.has(i)).map((e) => Edge._of(this, e)))
  }

  vertices(): ShapeList<Vertex> {
    return _list((k.brep_vertices(this._brep) as number[]).map((v) => Vertex._of(this, v)))
  }

  override wires(): ShapeList<Wire> {
    return _list(this.faces().flatMap((f) => [...f.wires()]))
  }

  // -- geometry -----------------------------------------------------------------------------
  bbox(): BoundBox {
    const [lo, hi] = k.brep_bounding_box(this._brep, true)
    return new BoundBox(lo, hi)
  }

  /** A box around the body that may be slightly too large; far cheaper than `bbox()` (for
   * overlap tests and size scales). */
  _looseBox(): BoundBox {
    const [lo, hi] = k.brep_bounding_box(this._brep, false)
    return new BoundBox(lo, hi)
  }

  center(): Vector {
    throw new TypeError(`a ${_typeName(this)} has no center`)
  }

  /**
   * Minimum distance to a point or to another body.
   *
   * For a point inside a part, and for a body nested in another, it is the distance to the
   * surface (the wall clearance). Bodies that touch or overlap are 0 apart.
   */
  override distanceTo(other: VectorLike | Shape): number {
    if (other instanceof _Body) return _bodyDistance(this, other)
    if (other instanceof Shape && !(other instanceof Vertex)) {
      throw new TypeError(`distanceTo takes a point or a body (Part, Shell, Sketch), not a ${_typeName(other)}`)
    }
    const p = other instanceof Vertex ? other.point : _vec(other)
    return Number(k.brep_closest_point(this._brep, p.toArray())[1])
  }

  closestPoint(point: VectorLike): Vector {
    return new Vector(k.brep_closest_point(this._brep, _vec(point).toArray())[0])
  }

  /**
   * Where a ray meets this body's faces, nearest first: the exact points (`Hit`: point, distance
   * from the start, the face, its outward normal there).
   *
   * The ray starts at `origin` and runs along `direction` (an axis or a vector); an axis alone is a
   * ray from its origin along its direction. Points behind the start are not hits. A ray through an
   * edge or a vertex hits once, a ray along a face where it enters the face. `hits[0]` is what the
   * ray sees first; `hits.length` is odd from inside a closed part, except where the ray grazes a
   * face (to test a point, use `Part.contains`).
   */
  raycast(origin: VectorLike | Axis, direction: VectorLike | Axis | null = null): Hit[] {
    return _raycast(this.faces(), origin, direction, this._looseBox())
  }

  // -- geometric queries --------------------------------------------------------------------
  /** The curves where this body's surface meets another body's surface, each one once. */
  intersectionCurves(other: _Body): ShapeList<Edge> {
    const [curves] = kernelCall('intersection curves', () => k.intersect_breps(this._brep, other._brep))
    // Where faces of the two bodies lie in one plane, the kernel hands out curves on their
    // borders twice (also reversed).
    return _distinctCurves(curves, 1e-6 * Math.max(1, this._looseBox().union(other._looseBox()).diagonal))
  }

  /** Silhouette curves on the body as seen along `direction` (an axis or a vector). */
  silhouette(direction: Axis | VectorLike = [0, 0, 1]): ShapeList<Edge> {
    const d = _direction(direction, 'silhouette')
    const curves: number[] = kernelCall('silhouette', () => k.create_silhouette_curves(this._brep, [0, 0, 0], d.toArray()))
    return _list(curves.map((c) => Edge._fromCurve(c)))
  }

  /** Project a curve onto the body along `direction` (an axis or a vector); returns the curves on
   * its faces. */
  project(curve: Edge | Wire, direction: Axis | VectorLike = [0, 0, -1]): ShapeList<Edge> {
    const d = _direction(direction, 'project')
    const out = new ShapeList<Edge>()
    for (const e of curve.edges()) {
      const c = e._copyCurve()
      let res: number[]
      try {
        res = kernelCall('project', () => k.project_curve(this._brep, c, d.toArray()))
      } finally {
        ext.delete_curve(c)
      }
      for (const r of res) out.push(Edge._fromCurve(r))
    }
    return out
  }

  /** The body's edges projected onto a plane (a 2D drawing view). */
  outline(plane: Plane = Plane.XY): ShapeList<Edge> {
    const curves = kernelCall('outline', () => k.project_brep_onto_plane(this._brep, plane.origin.toArray(), plane.zDir.toArray()))
    // The kernel can hand out the same projected curve twice (on Linux on ARM a cylinder's
    // circles seen edge-on come with a copy each); a drawing view needs each line once.
    return _distinctCurves(curves, 1e-7 * Math.max(this.bbox().diagonal, 1))
  }

  _transformed(m: Matrix): Shape {
    // (the kernel takes the matrix column by column)
    const columns: number[] = []
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) columns.push(m[r * 4 + c])
    return this._like(_held(this._copyBrep(), (h) => kernelCall('transform', () => ext.transform_brep(h.brep, columns))))
  }

  // -- body conversions ---------------------------------------------------------------------
  /** A copy whose faces and edges are all NURBS (analytic types converted). */
  toNurbs(): this {
    return this._like(_held(this._copyBrep(), (h) => kernelCall('toNurbs', () => k.turn_to_nurbs(h.brep))))
  }

  /** Repair gaps, tolerances and topology (mostly needed for imported data). */
  heal(): this {
    return this._like(_held(this._copyBrep(), (h) => kernelCall('heal', () => k.heal_brep(h.brep))))
  }

  _identity(): string {
    return `b:${this._h.id}`
  }

  equals(other: unknown): boolean {
    return other instanceof _Body && this._h === other._h
  }

  /** Counts and measures in one object. */
  info(): { type: string; faces: number; edges: number; vertices: number; bbox: [number[], number[]] } {
    const b = this.bbox()
    return {
      type: _typeName(this),
      faces: k.brep_face_count(this._brep),
      edges: k.brep_edge_count(this._brep),
      vertices: k.brep_vertex_count(this._brep),
      bbox: [b.min.toArray(), b.max.toArray()],
    }
  }
}

/** Edges of new kernel curves, each curve once: one whose ends and midpoint lie within `tol` of
 * those of a curve kept already (either way round) is left out. */
function _distinctCurves(curves: Iterable<number>, tol: number): ShapeList<Edge> {
  const kept: [Edge, Vector, Vector, Vector][] = []
  for (const c of curves) {
    const e = Edge._fromCurve(c)
    const a = e.start
    const b = e.end
    const m = e.pointAt(0.5)
    const repeated = kept.some(
      ([, ka, kb, km]) =>
        m.distanceTo(km) <= tol && Math.min(a.distanceTo(ka) + b.distanceTo(kb), a.distanceTo(kb) + b.distanceTo(ka)) <= tol,
    )
    if (!repeated) kept.push([e, a, b, m])
  }
  return _list(kept.map(([e]) => e))
}

/** The matrix of a move by `(x, y, z)` (Shape.translate, Mesh.translate). */
export function _translation(x: number | VectorLike = 0, y = 0, z = 0): Matrix {
  const v = typeof x === 'number' ? new Vector(x, y, z) : _vec(x)
  const m = _identity()
  m[3] = v.x
  m[7] = v.y
  m[11] = v.z
  return m
}

/** The matrix of a reflection in a plane or a planar face (Shape.mirror, Mesh.mirror). */
export function _reflection(plane: Plane | Face | Axis | ShapeList<Face>): Matrix {
  const pl = _asPlane(plane)
  const n = pl.zDir.toArray()
  const d = pl.origin.dot(pl.zDir)
  const m = _identity()
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 4 + j] -= 2 * n[i] * n[j]
  m[3] = 2 * n[0] * d
  m[7] = 2 * n[1] * d
  m[11] = 2 * n[2] * d
  return m
}

/** The matrix of a scale about `center` (Shape.scale, Mesh.scale). */
export function _scaling(factor: number | VectorLike, center: VectorLike = [0, 0, 0]): Matrix {
  const f = typeof factor === 'number' ? [factor, factor, factor] : _vec(factor).toArray()
  if (!f.every((x) => Number.isFinite(x) && x !== 0)) {
    throw new RangeError(`scale: every factor must be finite and not zero (got ${_repr(typeof factor === 'number' ? factor : Array.from(factor as ArrayLike<number>))})`)
  }
  const c = _vec(center)
  const m = _identity()
  m[0] = f[0]
  m[5] = f[1]
  m[10] = f[2]
  m[3] = c.x - f[0] * c.x
  m[7] = c.y - f[1] * c.y
  m[11] = c.z - f[2] * c.z
  return m
}

export function _disjoint(a: BoundBox, b: BoundBox, tol = 1e-9): boolean {
  const amin = a.min.toArray()
  const amax = a.max.toArray()
  const bmin = b.min.toArray()
  const bmax = b.max.toArray()
  return [0, 1, 2].some((i) => amax[i] < bmin[i] - tol || bmax[i] < amin[i] - tol)
}

/** Whether tools can cover a part, so that a cut by them can leave nothing: together they hold at
 * least its volume, and their boxes span its box. Necessary, not sufficient; the volumes are the
 * quick ones, with a margin of 1e-3. */
function _canCover(tools: readonly Part[], part: Part): boolean {
  try {
    if (tools.reduce((sum, t) => sum + t._quickVolume(), 0) < part._quickVolume() * (1 - 1e-3)) return false
  } catch (e) {
    if (!(e instanceof KernelError)) throw e
    return false
  }
  let hull = tools[0]._looseBox()
  for (const t of tools.slice(1)) hull = hull.union(t._looseBox())
  let box = part._looseBox()
  const tol = 1e-6 * box.diagonal + 1e-5
  if (hull.contains(box.min, tol) && hull.contains(box.max, tol)) return true
  box = part.bbox() // the loose box can stick out of the tools' boxes where the part does not
  return hull.contains(box.min, tol) && hull.contains(box.max, tol)
}

/** Whether points of an intersection's surface lie outside one of its operands. The kernel can
 * take a tool beside an earlier hole in a curved part, or a corner box of an imported pulley, as
 * containing the part, and return all of it. Points beyond an operand's loose box are outside it;
 * the points are classified where the result may be an operand given back unchanged (as many faces
 * and the same vertices). (Loose boxes ignore trimming: the result of a split, the part and a
 * half-space box, often reaches out of the half-space box's.) */
export function _intersectionProblem(result: Part, operands: readonly Part[]): string | null {
  const box = result._looseBox()
  const tol = 1e-6 * box.diagonal + 1e-5
  const near = Math.max(1e-4 * box.diagonal, 1e-5) // the new edges are fitted, to about 2e-5
  const problem = 'partly outside an operand (the kernel took one operand for inside the other)'
  let points: number[][] | null = null
  for (const x of operands) {
    const xb = x._looseBox()
    if (!(xb.contains(box.min, tol) && xb.contains(box.max, tol))) {
      points ??= _surfacePoints(result)
      if (!points.every((p) => xb.contains(p, near))) return problem
    }
  }
  const n = k.brep_face_count(result._brep)
  if (!operands.some((x) => k.brep_face_count(x._brep) === n && _sameVertices(result, x, tol))) return null
  points ??= _surfacePoints(result)
  for (const x of operands) {
    if (x._classify(points, near).some(([where]) => where === 'outside')) return problem
  }
  return null
}

/** Whether two bodies have as many vertices and each vertex of `a` lies near one of `b` (within
 * `tol`, or up to 4 `tol`: cells of a grid; for the quick test of a body given back unchanged,
 * where too many is safe). */
function _sameVertices(a: _Body, b: _Body, tol: number): boolean {
  const cellsOf = (body: _Body): number[][] =>
    (k.brep_vertices(body._brep) as number[]).map((v) => (k.vertex_point(v) as number[]).map((c) => Math.floor(c / tol)))
  const pa = cellsOf(a)
  const pb = cellsOf(b)
  if (pa.length !== pb.length) return false
  const cells = new Set(pb.map((c) => c.join(',')))
  const around = [0, -1, 1].flatMap((i) => [0, -1, 1].flatMap((j) => [0, -1, 1].map((m) => [i, j, m])))
  return pa.every((c) => around.some(([i, j, m]) => cells.has(`${c[0] + i},${c[1] + j},${c[2] + m}`)))
}

/** What is wrong with the result of a shell or an offset (see `Part._checked`), or null. */
export function _offsetProblem(result: Part, box: BoundBox, tol: number, before: number, smaller: boolean | null): string | null {
  const problem = result._solidProblem()
  if (problem !== null) return `a body that is ${problem}`
  const rb = result.bbox()
  const [lo, hi, rlo, rhi] = [box.min.toArray(), box.max.toArray(), rb.min.toArray(), rb.max.toArray()]
  if ([0, 1, 2].some((i) => rlo[i] < lo[i] - tol || rhi[i] > hi[i] + tol)) return 'a body that reaches out of the box it must fit in'
  const p = result._props(1e-4)
  if (!(p.gaps < _OFFSET_GAPS)) return `a body whose faces do not meet, so that its volume is uncertain by ${_formatE(p.gaps, 1)} of its value`
  const after = Number(p.volume)
  const slack = 1e-9 * Math.abs(before)
  if (smaller === true && !(after < before - slack)) return `a body whose volume did not go down (${_formatG(before, 10)} -> ${_formatG(after, 10)})`
  if (smaller === false && !(after > before + slack)) return `a body whose volume did not go up (${_formatG(before, 10)} -> ${_formatG(after, 10)})`
  if (smaller === null && !(Math.abs(after - before) > slack)) return `a body of the part's own volume (${_formatG(after, 10)})`
  return null
}

/** The indices of kernel faces in their body, for the probe worker. */
function _faceIndices(body: _Body, faces: readonly number[]): number[] {
  return Array.from(ext.face_indices(body._brep, [...faces]) as ArrayLike<number>, Number)
}

/** Points on a body's surface: its vertices, the middle of each edge, and a point of each face
 * (the middle of its parameter domain where that lies on the face, else one the kernel finds). */
function _surfacePoints(body: _Body): number[][] {
  const points: number[][] = (k.brep_vertices(body._brep) as number[]).map((v) => k.vertex_point(v))
  for (const e of k.brep_edges(body._brep) as number[]) {
    const [a, b] = k.edge_parameter_range(e)
    points.push(k.curve_evaluate(k.edge_curve(e), 0.5 * (a + b)))
  }
  for (const f of k.brep_faces(body._brep) as number[]) {
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(f)
    const u = 0.5 * (u0 + u1)
    const v = 0.5 * (v0 + v1)
    let inside = false
    try {
      inside = k.face_classify_uv(f, u, v) === 'inside'
    } catch (e) {
      if (!_isRuntimeError(e)) throw e // (on a face whose seam the kernel cannot resolve)
    }
    try {
      points.push(inside ? k.face_point_at_uv(f, u, v) : k.face_interior_point(f))
    } catch (e) {
      if (!_isRuntimeError(e)) throw e // the kernel cannot place a point on this face: its edges stand in
    }
  }
  return points.map((p) => Array.from(p))
}

/** The tools in groups whose members' boxes do not overlap (so that each group can go into one
 * Boolean); empty tools are left out. */
function _disjointBatches<B extends _Body>(tools: readonly B[]): B[][] {
  const items: [B, number[]][] = []
  for (const t of tools) {
    if (k.brep_face_count(t._brep)) {
      const [lo, hi] = k.brep_bounding_box(t._brep, false)
      items.push([t, [...lo, ...hi].map(Number)])
    }
  }
  const batches: [B[], number[][]][] = []
  for (const [t, b] of items) {
    let placed = false
    for (const [members, boxes] of batches) {
      const apart = boxes.every((box) => [0, 1, 2].some((i) => box[3 + i] < b[i] - 1e-9 || b[3 + i] < box[i] - 1e-9))
      if (apart) {
        members.push(t)
        boxes.push(b)
        placed = true
        break
      }
    }
    if (!placed) batches.push([[t], [b]])
  }
  return batches.map(([members]) => members)
}

function _closest(body: _Body, p: readonly number[]): number[] {
  return (k.brep_closest_point(body._brep, [Number(p[0]), Number(p[1]), Number(p[2])])[0] as number[]).map(Number)
}

function _dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Distance between the surfaces of two bodies (0 where they touch or overlap).
 *
 * The kernel's own body distance is wrong where the nearest points form a line (parallel
 * cylinders) and far from the origin. Here: the mesh vertices of each body nearest to the other
 * give starting points; from the best ones, `ext.nearest_points` takes closest points in turn on
 * either body and finishes with Newton's method on the parameters of the faces they lie on, which
 * ends in a pair of exact surface points. (Closest points in turn alone settle slowly between
 * nearly parallel faces: two skew cylinders 2 apart at 5 degrees were still 2.4845 apart after 500
 * rounds.)
 */
function _bodyDistance(a: _Body, b: _Body, seeds = 6, sample = 400): number {
  if (k.brep_face_count(a._brep) === 0 || k.brep_face_count(b._brep) === 0) throw new RangeError('distanceTo: an empty body has no distance')
  const starts: [number, _Body, _Body, number[]][] = []
  const ab = a.bbox() // each once: the tight box costs as much as the rest
  const bb = b.bbox()
  const pairs: [_Body, BoundBox, _Body, BoundBox][] = [
    [a, ab, b, bb],
    [b, bb, a, ab],
  ]
  for (const [x, xb, y, yb] of pairs) {
    const lo = yb.min.toArray()
    const hi = yb.max.toArray()
    const corners = x.vertices().map((v) => v.point.toArray() as number[])
    const mesh = tessellate(x, Math.max(xb.diagonal * 1e-3, 1e-6)) // tessellate's default tolerance
    let pts: number[][] = []
    for (let i = 0; i < mesh.vertices.length; i += 3) pts.push([mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]])
    pts.push(...corners)
    const gap = pts.map((p) => Math.hypot(...[0, 1, 2].map((j) => Math.max(0, Math.max(lo[j] - p[j], p[j] - hi[j])))))
    const order = pts.map((_, i) => i).sort((i, j) => gap[i] - gap[j])
    pts = order.slice(0, sample).map((i) => pts[i])
    const found = pts.map((p, i) => [_dist(_closest(y, p), p), i] as [number, number]).sort((u, v) => u[0] - v[0] || u[1] - v[1])
    const taken: number[][] = []
    const spacing = 1e-3 * Math.max(xb.diagonal, 1e-9)
    for (const [d, i] of found) {
      if (taken.length >= seeds) break
      if (taken.every((t) => _dist(pts[i], t) > spacing)) {
        taken.push(pts[i])
        starts.push([d, x, y, pts[i]])
      }
    }
  }
  let best = Infinity
  let unsettled = 0
  const first = starts.slice().sort((u, v) => u[0] - v[0]).slice(0, 2 * seeds)
  for (const [, x, y, start] of first) {
    const r = kernelCall('distanceTo', () => ext.nearest_points(x._brep, y._brep, start))
    if (r.distance < best) {
      best = r.distance
      unsettled = r.gain
    }
  }
  const scale = Math.max(ab.diagonal, bb.diagonal, 1)
  if (unsettled > 1e-9 * scale) {
    _warn(`distanceTo: the nearest points did not settle; the distance ${_formatG(best)} may be too large (the last step still gained ${unsettled.toPrecision(2)})`)
  }
  return best <= 1e-12 * scale ? 0 : best
}

/** "separate", "touching", "interpenetrating", "a_contains_b" or "b_contains_a" (null if the
 * kernel cannot tell). */
export function _relationship(a: _Body, b: _Body): string | null {
  try {
    return String(k.brep_relationship(a._brep, b._brep).relationship)
  } catch (e) {
    if (!_isRuntimeError(e)) throw e
    return null
  }
}

/** The bodies in `items`: a body, a face (its sheet) or any nesting of lists of them. */
export function _bodies(items: unknown, name = 'combine'): _Body[] {
  if (items instanceof _Body) return [items]
  if (items instanceof Face) return [items.toShell()]
  if (typeof items === 'string' || items instanceof Shape || !_isIterable(items)) {
    throw new TypeError(`cannot ${name} a body with a ${_typeName(items)} value; use parts (or a list of parts)`)
  }
  const out: _Body[] = []
  for (const it of items) out.push(..._bodies(it, name))
  return out
}

/**
 * Mass properties of a part.
 *
 * `inertia` is the inertia tensor about the center of mass (axes parallel to the world axes),
 * row by row; `principalMoments` and `principalAxes` are its eigen-decomposition.
 */
function _raycast(
  faces: Iterable<Face>,
  origin: VectorLike | Axis,
  direction: VectorLike | Axis | null,
  box: BoundBox,
  onePerPoint = true,
  meshes = new Map<unknown, Mesh[]>(), // a body -> its faces' meshes (for faces the kernel cannot intersect; rays of one body can share them)
): Hit[] {
  let o: Vector
  let d: Vector
  if (origin instanceof Axis && direction == null) {
    o = origin.origin
    d = origin.direction.normalized()
  } else if (direction == null) {
    throw new TypeError('raycast takes an origin and a direction, or an axis')
  } else {
    o = _vec(origin as VectorLike)
    d = _direction(direction, 'raycast')
  }
  if (![o.x, o.y, o.z].every(Number.isFinite)) throw new RangeError('raycast: the origin must be finite')
  const size = Math.max(box.diagonal, 1e-9)
  let reach = -Infinity
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    reach = Math.max(reach, new Vector(x, y, z).sub(o).dot(d))
  }
  reach += 1e-3 * size
  if (reach <= 0) return [] // the body is behind the start
  const tol = 1e-9 * Math.max(size, o.length)
  const hits: Hit[] = []
  kernelCall('raycast', () => {
    const ray: number = k.create_line_segment(o.toArray(), o.add(d.mul(reach)).toArray())
    try {
      for (const f of faces) {
        if (!_rayMeetsBox(o, d, reach, k.face_bounding_box(f._f, false), tol)) continue
        let found: Vector[]
        try {
          const [curves, points]: [number[], number[][]] = k.intersect_curve_face(ray, f._f)
          found = points.map((p) => new Vector(p))
          for (const c of curves) { // the ray runs along the face: it meets it where it enters it
            const ends = [new Vector(k.curve_start_point(c)), new Vector(k.curve_end_point(c))]
            found.push(ends[0].sub(o).dot(d) <= ends[1].sub(o).dot(d) ? ends[0] : ends[1])
            ext.delete_curve(c)
          }
        } catch (e) {
          // The kernel fails where a ray runs parallel to a plane or along a cylinder without
          // meeting it (and on some other faces): there the face's mesh finds the hits, and they
          // are moved onto the exact surface.
          if (!_isRuntimeError(e)) throw e
          found = _meshHits(f, o, d, reach, tol, meshes)
        }
        for (const q of found) {
          const t = q.sub(o).dot(d)
          if (t >= -tol) hits.push(new Hit(q, Math.max(t, 0), f.normalAt(q), f))
        }
      }
    } finally {
      ext.delete_curve(ray)
    }
  })
  hits.sort((a, b) => a.distance - b.distance)
  if (!onePerPoint) return hits
  const out: Hit[] = []
  for (const h of hits) { // through an edge or a vertex: one hit
    const last = out[out.length - 1]
    if (!last || h.distance - last.distance > 10 * tol || h.point.sub(last.point).length > 10 * tol) out.push(h)
  }
  return out
}

/** The points where the ray crosses the mesh of face `f`, moved onto its exact surface. */
function _meshHits(f: Face, o: Vector, d: Vector, reach: number, tol: number, meshes: Map<unknown, Mesh[]>): Vector[] {
  const owner = f._owner!
  if (!meshes.has(owner)) meshes.set(owner, faceMeshes(owner))
  const [index] = ext.face_indices(owner._brep, [f._f])
  const m = meshes.get(owner)![index]
  const out: Vector[] = []
  const [ts] = _rayTriangles(o, d, m.vertices, m.triangles, tol)
  const srf = k.face_surface(f._f)
  for (const t0 of ts.filter((t) => t <= reach).sort((a, b) => a - b)) {
    if (out.length && Math.abs(t0 - out[out.length - 1].sub(o).dot(d)) < 1e-6 * Math.max(reach, 1)) continue // (an edge between two triangles)
    let t = t0
    for (let i = 0; i < 30; i++) { // Newton along the ray, against the tangent plane at the closest point
      const p = o.add(d.mul(t))
      const [q, uvs] = k.surface_closest_point(srf, p.toArray())
      const n = new Vector(k.face_normal_at_uv(f._f, uvs[0][0], uvs[0][1]))
      const dn = d.dot(n)
      if (Math.abs(dn) < 1e-12) break
      const step = new Vector(q).sub(p).dot(n) / dn
      t += step
      if (Math.abs(step) <= tol) break
    }
    const q = o.add(d.mul(t))
    if (f.distanceTo(q) <= 100 * tol) out.push(q)
  }
  return out
}

function _rayMeetsBox(o: Vector, d: Vector, reach: number, box: [number[], number[]], tol: number): boolean {
  const [lo, hi] = box
  let t0 = 0
  let t1 = reach
  const oa = [o.x, o.y, o.z]
  const da = [d.x, d.y, d.z]
  for (let a = 0; a < 3; a++) {
    const low = lo[a] - tol
    const high = hi[a] + tol
    if (Math.abs(da[a]) < 1e-300) {
      if (oa[a] < low || oa[a] > high) return false
      continue
    }
    let ta = (low - oa[a]) / da[a]
    let tb = (high - oa[a]) / da[a]
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta)
    t1 = Math.min(t1, tb)
    if (t0 > t1) return false
  }
  return true
}

export class MassProperties {
  readonly mass: number
  readonly volume: number
  readonly area: number
  readonly center: Vector
  readonly inertia: number[][]
  readonly density: number

  constructor(mass: number, volume: number, area: number, center: Vector, inertia: number[][], density: number) {
    this.mass = mass
    this.volume = volume
    this.area = area
    this.center = center
    this.inertia = inertia
    this.density = density
  }

  get principalMoments(): [number, number, number] {
    return eigh3(this.inertia.flat()).values
  }

  get principalAxes(): [Vector, Vector, Vector] {
    const [a, b, c] = eigh3(this.inertia.flat()).vectors
    return [new Vector(a), new Vector(b), new Vector(c)]
  }

  toString(): string {
    const c = this.center
    return `MassProperties(mass=${_formatG(this.mass)}, volume=${_formatG(this.volume)}, area=${_formatG(this.area)}, center=(${_formatG(c.x)}, ${_formatG(c.y)}, ${_formatG(c.z)}))`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** A fillet radius: one for all edges, one per edge, or `{ start, end }` varying linearly along
 * each edge (Python's `(start, end)` tuple). */
export type FilletRadius = number | readonly number[] | { start: number; end: number }

/** How a fillet's cross-section is shaped. */
export interface FilletOptions {
  /** null for a circular fillet. "G2" or "G3" make a curvature-continuous blend ("G1" a
   * tangent blend) instead of a circular arc: no visible highlight seam, as used for consumer
   * and Class-A surfaces. */
  continuity?: number | string | null
  /** Shape of a blend cross-section; above 1 fuller, below 1 flatter. */
  fullness?: number
}

/**
 * A solid: one or more closed volumes.
 *
 * Combine parts with `fuse` (union), `cut` (difference) and `intersect` (intersection). Each
 * takes parts or any iterables of parts.
 */
export class Part extends _Body {
  // -- measures -----------------------------------------------------------------------------
  /** Area, volume and moments (density 1) to the relative `accuracy` (default `ACCURACY`),
   * integrated by smlibpy's C++ with an error estimate (src/cpp/measure.cpp). Kept with the body,
   * which does not change: the next query costs nothing. No warnings: for the checks inside
   * operations; the public measures go through `_measured`. */
  _props(accuracy: number | null = null): Any {
    const acc = accuracy ?? ACCURACY
    const cached = this._h.props
    if (cached != null && cached.accuracy <= acc) return cached
    const p = kernelCall('mass properties', () => ext.brep_measure(this._brep, acc * _MARGIN), 'is the part a closed solid?')
    p.accuracy = acc
    const [vx, vy, vz] = p.field_volumes
    p.gaps = vz ? Math.max(Math.abs(vx - vz), Math.abs(vy - vz)) / Math.abs(vz) : 0
    this._h.props = p
    return p
  }

  /** `_props` for the user: says when the numbers are not what was asked for (the integration
   * did not reach the accuracy, or the body's faces leave gaps that make its volume uncertain
   * beyond the fifth digit), each thing once per part. */
  _measured(accuracy: number | null = null): Any {
    const p = this._props(accuracy)
    const asked = accuracy ?? ACCURACY
    const notes: string[] = []
    if (!p.converged && p.relative_error > asked) {
      notes.push(`mass properties: the integration reached a relative accuracy of ${_formatE(p.relative_error, 1)}, not ${_formatE(asked, 0)}`)
    }
    if (p.gaps > Math.max(asked, _GAPS)) {
      notes.push(
        `mass properties: the faces of this part do not meet exactly (there are gaps between them), so its volume is uncertain by about ${_formatE(p.gaps, 0)} of its value: integrated as the faces are, ${_formatG(p.volume, 10)}`,
      )
    }
    const said: Set<string> = (p.said ??= new Set<string>())
    for (const note of notes) {
      if (!said.has(note)) {
        said.add(note)
        _warn(note)
      }
    }
    return p
  }

  /** The kernel's own integration (SmBrep::ComputePreciseProperties) at a coarse accuracy, for
   * the quick checks of operations (the sign of a volume, a rough change). Cheap, but its error is
   * not bounded by `accuracy`: the volume can be 300 times worse. A body whose faces are misbuilt
   * can fail it. */
  _kernelProps(accuracy: number): Any {
    return kernelCall('mass properties', () => ext.brep_properties(this._brep, accuracy, 1.0), 'is the part a closed solid?')
  }

  /** The volume for a plausibility check with a margin of 1e-3 or more: the measured one if the
   * part has it, else the kernel's quick integration at `accuracy` (see `_kernelProps`). */
  _quickVolume(accuracy = 1e-6): number {
    if (this._h.props != null) return Number(this._h.props.volume)
    return Number(this._kernelProps(accuracy).volume)
  }

  get volume(): number {
    return Number(this._measured().volume)
  }

  /** Total surface area. */
  get area(): number {
    return Number(this._measured().area)
  }

  /** Center of mass (uniform density). */
  override center(): Vector {
    const p = this._measured()
    if (p.volume === 0) throw new RangeError('the part has no volume, so it has no center')
    return new Vector(p.origin).add(new Vector(p.first_moments).div(p.volume))
  }

  /**
   * Mass, center of mass and inertia tensor for a uniform `density`.
   *
   * `accuracy` is the relative accuracy of the results (default `ACCURACY`, 1e-7; from 1e-10 to
   * 1e-2): volume, mass and area to `accuracy` of their value, the center to `accuracy` times the
   * size of the part (its bounding box diagonal), the inertia to `accuracy` times its largest
   * principal moment.
   */
  massProperties(density = 1.0, accuracy: number | null = null): MassProperties {
    if (!(density > 0)) throw new RangeError('massProperties: the density must be positive')
    if (accuracy != null && !(1e-10 <= accuracy && accuracy <= 1e-2)) throw new RangeError('massProperties: accuracy must be between 1e-10 and 1e-2')
    const p = this._measured(accuracy)
    const volume = Number(p.volume)
    if (volume === 0) throw new RangeError('massProperties: the part has no volume')
    const d = new Vector(p.first_moments).div(volume) // centroid relative to the origin of integration
    const [xx, yy, zz, yz, zx, xy] = p.second_moments
    const io = [
      [yy + zz, -xy, -zx],
      [-xy, xx + zz, -yz],
      [-zx, -yz, xx + yy],
    ]
    const dv = d.toArray()
    const dd = d.dot(d)
    const ic = io.map((row, i) => row.map((x, j) => density * (x - volume * ((i === j ? dd : 0) - dv[i] * dv[j]))))
    return new MassProperties(density * volume, volume, Number(p.area), new Vector(p.origin).add(d), ic, density)
  }

  /**
   * True if the part is a closed, manifold solid that encloses a positive volume and whose faces
   * meet.
   *
   * (A body whose faces point inward, or that encloses no volume, such as a profile revolved
   * about an axis through it, is not valid; nor is one whose faces leave gaps that make its volume
   * uncertain by 1e-2 of its value or more.)
   */
  isValid(): boolean {
    return this._solidProblem(null, true) === null
  }

  /** Why this is not a sound solid ("empty", "inside out (negative volume)", "open between its
   * faces, ...", ...), or null: this catches broken bodies, not small errors. The checks of
   * operations take the sign of the kernel's coarse volume (or of `volume`, which the caller
   * integrated anyway), and the gaps between the faces only if the part was measured: the gap
   * measure costs 3 to 6 times as much on curved bodies. With `gaps` (`isValid()`) the part is
   * measured. A body found sound is not checked again. */
  _solidProblem(volume: number | null = null, gaps = false): string | null {
    if (this._h.sound >= (gaps ? _SOUND : _CHECKED)) return null
    let problem = this._shapeProblem()
    let measured: Any = null
    if (problem === null) {
      try {
        measured = gaps ? this._props(1e-4) : this._h.props // measured now, or already
        if (measured != null) volume = Number(measured.volume)
        else if (volume === null) volume = Number(this._kernelProps(1e-3).volume)
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        return 'a body whose volume cannot be integrated'
      }
      const v = volume as number
      const tiny = 1e-9 * this._extent() ** 3
      if (v < -tiny) problem = 'inside out (negative volume)'
      else if (!(v > tiny)) problem = 'without volume' // also a NaN volume
      else if (measured != null && !(measured.gaps < _BROKEN_GAPS)) problem = `open between its faces, so that its volume is uncertain by ${_formatE(measured.gaps, 1)} of its value`
    }
    this._h.sound = problem !== null ? 0 : measured != null ? _SOUND : _CHECKED
    return problem
  }

  /** The checks of `_solidProblem` that need no volume integration. */
  _shapeProblem(): string | null {
    const b = this._brep
    if (k.brep_face_count(b) === 0) return 'empty'
    if (!k.brep_is_manifold_solid(b)) return 'not a closed, manifold solid'
    const size = this._extent()
    if (!(Number.isFinite(size) && size > 0)) return 'degenerate (its bounding box is not finite or has zero size)' // a body scaled by 0 has a NaN box
    return null
  }

  /** Diagonal of the kernel's loose bounding box (the tight `bbox()` can cost more than a volume
   * integration). */
  _extent(): number {
    const [lo, hi] = k.brep_bounding_box(this._brep, false)
    return _dist(lo, hi)
  }

  /** Refuse to run a feature on a broken body (the kernel may crash on one). */
  _requireValid(what: string): void {
    const problem = this._solidProblem()
    if (problem !== null) {
      throw new ModelingError(`${what}: the part is not a valid solid (${problem}); check isValid() after each step and fix the step that broke it`)
    }
  }

  /** The separate bodies of this part. */
  solids(): ShapeList<Part> {
    const parts: number[] = kernelCall('solids', () => ext.separate_bodies(this._brep))
    return _list(parts.map((b) => Part._wrap(b, { name: this.name, color: this.color })))
  }

  /**
   * This part and others as one part made of cells. Where parts overlap, the overlap becomes a
   * cell of its own; cells that touch share the faces between them (each such face bounds two
   * cells: the body is non-manifold). For simulation meshes that must match across materials, and
   * for models of several materials.
   *
   * `cells()` gives the cells as parts of their own; `volume` is the volume of the union. A merged
   * part is not a manifold solid: `isValid()` is false, and Booleans, fillets and shells take its
   * cells rather than the part itself.
   *
   * A result whose volume is less than that of the largest part, or more than that of all parts
   * together, is wrong: `ModelingError`.
   */
  merge(...others: unknown[]): Part {
    const tools = _bodies(others, 'merge')
    if (!tools.length) throw new RangeError('merge needs another part')
    for (const t of tools) {
      if (!(t instanceof Part) || t instanceof Sketch) throw new TypeError(`merge takes parts, not a ${_typeName(t)}`)
    }
    const b = _held(this._copyBrep(), (h) => {
      for (const t of tools) {
        kernelCall('merge', () => _combine(h, t, k.BooleanOp.MERGE, true), 'the parts may only touch along an edge or at a point')
      }
    })
    const merged = Part._wrap(b, { name: this.name, color: this.color })
    const problem = _mergeProblem(merged, [this, ...(tools as Part[])])
    if (problem !== null) {
      merged.dispose()
      throw new ModelingError(
        `merge: the kernel returned a result ${problem}; a seam of one part that lies tangent to another can do this: turn that part about its axis or move it a little`,
      )
    }
    return merged
  }

  /**
   * The cells of a part made by `merge`, each as a part of its own (every closed region of the
   * body; a cavity is not a cell). A part that is one solid: `[itself]`.
   */
  cells(): ShapeList<Part> {
    const d = ext.brep_dump(this._brep, false)
    if (d.regions.filter((r: { infinite: boolean; void: boolean }) => !r.infinite && !r.void).length <= 1) return new ShapeList(this)
    const regions: number[][] = kernelCall('cells', () => ext.region_shells(this._brep))
    const solids = regions.map((shells) => shells.map((b) => Part._wrap(b, { name: this.name, color: this.color })))
    const touching = 'an insert that touches the part around it at a point or along a line can do this: move it off the wall or into it'
    const out = new ShapeList<Part>()
    for (const [outer, ...cavities] of solids) {
      let part: Part
      try {
        part = cavities.length ? outer.cut(cavities) : outer
      } catch (e) {
        if (!(e instanceof ModelingError)) throw e
        throw new ModelingError(`cells: the cells inside a cell could not be cut out of it (${e.message}); ${touching}`)
      }
      let problem: string | null
      try {
        part._props() // measured for the sum below, so that the check sees the gaps too
        problem = part._solidProblem()
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        problem = 'a body whose volume cannot be integrated'
      }
      if (problem !== null) throw new ModelingError(`cells: a cell is not a sound solid (${problem})`)
      out.push(part)
    }
    // The cells fill the part: a cell that kept another inside it counts that one twice (an insert
    // of 268 in 8000). Faces that meet only within a tolerance (fitted chamfers, imported parts)
    // integrate a little differently in the part and in its cells: by up to about their gaps.
    const p = this._props()
    const whole = Number(p.volume)
    const total = out.reduce((sum, c) => sum + Number(c._props().volume), 0)
    const slack = Math.max(1e-6, 10 * Math.max(Number(p.gaps), ...out.map((c) => Number(c._props().gaps))))
    if (!(Math.abs(total - whole) <= slack * Math.abs(whole))) {
      throw new ModelingError(`cells: the cells add up to a volume of ${_formatG(total, 10)}, the part has ${_formatG(whole, 10)}; ${touching}`)
    }
    return out
  }

  // -- points -------------------------------------------------------------------------------
  /**
   * Where a point lies: `['inside', null]` in the material, `['outside', null]` (also in a cavity),
   * or `['on', shape]` on the surface within `tol` (default: the part's own tolerance, 1e-5 for most
   * parts), with the vertex, edge or face it lies on (the vertex rather than its edges, an edge
   * rather than its faces).
   *
   * The kernel classifies the point exactly (SmBrep::Point3DClassify), also where a ray from it
   * would graze a face or pass through an edge, which the parity of `raycast` hits gets wrong.
   */
  classify(point: VectorLike, tol: number | null = null): [string, Face | Edge | Vertex | null] {
    const [where, index] = this._classify([point], tol)[0]
    if (where === 'face') return ['on', new Face(this, k.brep_faces(this._brep)[index])]
    if (where === 'edge') return ['on', Edge._of(this, k.brep_edges(this._brep)[index])]
    if (where === 'vertex') return ['on', Vertex._of(this, k.brep_vertices(this._brep)[index])]
    return [where, null]
  }

  /** True if the point lies in the material of this part or on its surface (within `tol`, see
   * `classify`); false outside and in a cavity. */
  contains(point: VectorLike, tol: number | null = null): boolean {
    return this._classify([point], tol)[0][0] !== 'outside'
  }

  /** The cell of a merged part (see `merge`) that holds the point, as in `cells`; null outside, in a
   * cavity and on a face (also one between two cells). For a part that is one solid: the part
   * itself or null. */
  cellAt(point: VectorLike, tol: number | null = null): Part | null {
    const cell = this._classify([point], tol)[0][2]
    return cell < 0 ? null : this.cells()[cell]
  }

  /** `ext.classify_points` for these points: per point [where, index, cell], where one of 'inside',
   * 'outside', 'face', 'edge', 'vertex'. */
  _classify(points: Iterable<VectorLike>, tol: number | null = null): [string, number, number][] {
    if (tol != null && !(Number.isFinite(tol) && tol > 0)) throw new RangeError(`classify: the tolerance must be positive (got ${tol})`)
    const pts = Array.from(points, (p) => _vec(p).toArray())
    return kernelCall('classify', () => ext.classify_points(this._brep, pts, tol ?? 0.0))
  }

  // -- booleans -----------------------------------------------------------------------------
  _boolean(others: unknown, op: number, name: string): Part {
    const tools = _bodies(others, name)
    for (const t of tools) {
      if (t instanceof Sketch || !(t instanceof Part || t instanceof Shell)) {
        const extra = t instanceof Sketch ? '; extrude it first' : ''
        throw new TypeError(`cannot ${name} a ${_typeName(t)} with a Part${extra}`)
      }
    }
    if (!tools.every((t) => t instanceof Part)) return this._like(this._runBoolean(tools, op, name)) // sheets: imprint or trim, unchecked
    const parts = tools as Part[]
    let result: Part | null = null
    let failure: KernelError | null = null
    let problem: string | null = null
    try {
      result = this._like(this._runBoolean(parts, op, name))
      problem = this._booleanProblem(result, parts, op)
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      result = null
      failure = e
      problem = null
    }
    if (result !== null && problem === null) return result
    if (parts.length > 1) {
      // Tools that overlap each other (two holes side by side) can fail one after the other where
      // the combined tool works: combine them first.
      try {
        const combine = op === k.BooleanOp.INTERSECTION ? k.BooleanOp.INTERSECTION : k.BooleanOp.UNION
        const combined = parts[0]._like(parts[0]._runBoolean(parts.slice(1), combine, name))
        if (k.brep_face_count(combined._brep) === 0 && op === k.BooleanOp.INTERSECTION) return this._like(combined._copyBrep()) // the tools have nothing in common
        if (combined._solidProblem() === null) {
          const retry = this._like(this._runBoolean([combined], op, name))
          if (this._booleanProblem(retry, [combined], op) === null) return retry
        }
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
      }
    }
    const broken = [this as Part, ...parts].filter((x) => x._solidProblem() !== null)
    if (broken.length) {
      const which = broken[0] === this ? 'the part' : 'a tool'
      throw new ModelingError(`${name}: ${which} is not a valid solid (${broken[0]._solidProblem()}); check isValid() of the operands and fix the step that broke them`)
    }
    const hint =
      'the operands may touch only along an edge, at a point or tangentially (move one so they overlap), or a tool overlaps an earlier cut or boss along a parallel face (combine the tools first and apply them at once: part.cut(tool1.fuse(tool2)))'
    if (failure !== null) {
      const error = new KernelError(failure.operation, failure.detail, failure.status, hint)
      ;(error as Any).cause = failure
      throw error
    }
    throw new ModelingError(`${name}: the kernel returned a result that is ${problem}; ${hint}`)
  }

  _runBoolean(tools: readonly _Body[], op: number, name: string): number {
    return _held(this._copyBrep(), (h) => {
      for (const t of tools) kernelCall(name, () => _combine(h, t, op), 'the operands may touch only in a degenerate way, or an operand is broken')
    })
  }

  /** What is wrong with a Boolean result, or null. An empty result is right where the operands
   * say so (a cut by a tool that encloses the part, an intersection of bodies apart from each
   * other). */
  _booleanProblem(result: Part, tools: readonly Part[], op: number): string | null {
    if (k.brep_face_count(result._brep) !== 0) {
      const problem = result._shapeProblem()
      if (problem === null && [this as Part, ...tools].every((x) => x._h.sound >= _TRUSTED || x._solidProblem() === null)) {
        // Closed and manifold, from sound operands. Its volume, which costs up to twice the
        // Boolean, is not integrated here, so that a chain of Booleans integrates nothing: the next
        // Boolean trusts it. isValid() and the next feature check it (it can be inside out or leave
        // a face out).
        const found = op === k.BooleanOp.INTERSECTION ? _intersectionProblem(result, [this as Part, ...tools]) : null
        if (found === null) result._h.sound = _TRUSTED
        return found
      }
      return problem ?? result._solidProblem()
    }
    if (op === k.BooleanOp.UNION) return 'empty'
    if (op === k.BooleanOp.INTERSECTION) {
      if (tools.length > 1) return null // the common volume of several tools may well be empty
      const rel = _relationship(this, tools[0])
      return rel === 'separate' || rel === 'touching' ? null : 'empty'
    }
    // The intersection of the part and a tool that confirms an empty cut below can fail the same
    // way as the cut (a tool beside an earlier hole in a sphere: the cut is empty, the intersection
    // the whole part). So first the tools must be able to cover the part.
    if (!_canCover(tools, this)) return 'empty'
    let whole: number
    try {
      whole = this._kernelProps(1e-6).volume
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      return 'empty'
    }
    for (const t of tools) {
      if (_relationship(t, this) === 'separate') continue
      // right only if the tool covers the whole part
      try {
        const common = Part._wrap(this._runBoolean([t], k.BooleanOp.INTERSECTION, 'cut'))
        if (common._kernelProps(1e-6).volume >= whole * (1 - 1e-5)) return null
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
      }
    }
    return 'empty'
  }

  /** Union with other parts (Python's `+`). */
  fuse(...others: (Part | Iterable<Part>)[]): Part {
    return this._boolean(others, k.BooleanOp.UNION, 'fuse')
  }

  /** Subtract other parts (Python's `-`). */
  cut(...others: (Part | Iterable<Part>)[]): Part {
    return this._boolean(others, k.BooleanOp.DIFFERENCE, 'cut')
  }

  /** Keep only the volume shared with the other parts (Python's `&`). */
  intersect(...others: (Part | Iterable<Part>)[]): Part {
    return this._boolean(others, k.BooleanOp.INTERSECTION, 'intersect')
  }

  // -- topology selection on this part ------------------------------------------------------
  /** Kernel edges of this part for the given edge selection. */
  _ownEdges(edges: unknown): number[] {
    const sel = _flattenEdges(edges)
    const out: number[] = []
    let candidates: [number, Vector, Vector, Vector][] | null = null
    const tol = 1e-6 * Math.max(1, this.bbox().diagonal)
    for (const e of sel) {
      if (e._e && e._owner !== null && e._owner._h === this._h) {
        out.push(e._e)
        continue
      }
      // An edge of another body (e.g. an earlier version of this part): match by geometry.
      if (candidates === null) {
        candidates = []
        for (const ke of k.brep_edges(this._brep) as number[]) {
          const own = Edge._of(this, ke)
          candidates.push([ke, own.start, own.end, own.center()])
        }
      }
      const s = e.start
      const t = e.end
      const m = e.center()
      const match = candidates.find(
        ([, a, b, c]) => c.isClose(m, tol) && ((a.isClose(s, tol) && b.isClose(t, tol)) || (a.isClose(t, tol) && b.isClose(s, tol))),
      )
      if (!match) throw new RangeError(`${e} is not an edge of this part`)
      out.push(match[0])
    }
    if (!out.length) throw new RangeError('no edges selected')
    return out
  }

  _ownFaces(faces: unknown): number[] {
    const sel = _flattenFaces(faces)
    const out: number[] = []
    const tol = 1e-6 * Math.max(1, this.bbox().diagonal)
    let ownFaces: Face[] | null = null
    for (const f of sel) {
      if (f._owner !== null && f._owner._h === this._h) {
        out.push(f._f)
        continue
      }
      // A face of another body: the face of ours that contains its interior point and has the
      // same area.
      if (ownFaces === null) ownFaces = [...this.faces()]
      const p = f.interiorPoint()
      const area = f.area
      const match = ownFaces.find((g) => g.distanceTo(p) <= tol && Math.abs(g.area - area) <= 1e-6 * Math.max(1, area))
      if (!match) throw new RangeError(`${f} is not a face of this part`)
      out.push(match._f)
    }
    return out
  }

  /** The selected edges without seams and tangent (smooth) edges, which cannot be rounded. */
  _sharpEdges(edges: unknown, operation: string): Edge[] {
    const sel = _flattenEdges(edges).filter((e) => !e.isSeam)
    const angles = _outerAngles(sel)
    const out: Edge[] = []
    sel.forEach((e, i) => {
      const a = angles[i]
      if (a !== null) {
        if (_angleKind(a) === 'smooth') return
      } else {
        const fs = e.faces()
        if (fs.length === 2) {
          const p = e.center()
          try {
            if (fs[0].normalAt(p).angleTo(fs[1].normalAt(p)) < 0.5) return
          } catch (err) {
            if (!(err instanceof KernelError || _isValueError(err))) throw err
          }
        }
      }
      out.push(e)
    })
    if (!out.length) throw new RangeError(`${operation}: the selection holds only seam or smooth edges, nothing to ${operation}`)
    return out
  }

  /** Reject rounds that cannot fit: on a face, two edges running alongside each other must be
   * further apart than their setbacks. (The kernel does not always notice and may return an
   * invalid solid.) */
  _checkRoundSizes(edges: readonly Edge[], setbacks: readonly number[], what: string, sizeName: string): void {
    const setbackOf = new Map<string, number>()
    edges.forEach((e, i) => setbackOf.set(e._identity(), setbacks[i]))
    edges.forEach((e, i) => {
      const s = setbacks[i]
      const ends = new Set(e.vertices().map((v) => v._identity()))
      const samples = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => e.pointAt(t))
      for (const f of e.faces()) {
        for (const g of f.edges()) {
          if (g._identity() === e._identity() || g.vertices().some((v) => ends.has(v._identity()))) continue // the same edge, or a neighbour meeting it at a corner
          const total = s + (setbackOf.get(g._identity()) ?? 0)
          const dists = samples.map((p) => _distanceToEdge(g, p))
          const near = Math.min(...dists)
          if (near >= total - 1e-9 || Math.max(...dists) > 1.5 * Math.max(near, 1e-12)) continue // far enough, or not running alongside
          const limit = setbackOf.has(g._identity()) ? near / 2 : near
          throw new ModelingError(
            `${what}: the ${sizeName} is too large; the rounds on edges ${_formatG(near, 4)} apart would overlap (largest possible setback here: ${_formatG(limit, 4)})`,
          )
        }
      }
    })
  }

  /**
   * A `{ start, end }` radius runs along each edge on its own. Refuse the edges where it cannot: a
   * closed edge (the radius would jump back at its seam) and edges that run into each other
   * tangentially (the kernel gives the rounds one radius where they meet and bends both radii to it).
   */
  static _checkRadiusLaw(edges: readonly Edge[]): void {
    const at = new Map<string, Vector[]>() // vertex -> directions of the edges ending there
    for (const e of edges) {
      if (e.isClosed) {
        throw new RangeError('fillet: a (start, end) radius cannot run around a closed edge (it would jump back to the start radius at the seam); give a constant radius')
      }
      for (const v of e.vertices()) {
        const p = v.center()
        const d = e.tangentAt(p.sub(e.start).length <= p.sub(e.end).length ? 0.0 : 1.0)
        for (const d2 of at.get(v._identity()) ?? []) {
          const a = d.angleTo(d2)
          if (Math.min(a, 180.0 - a) < _FILLET_TANGENT_DEG) {
            throw new RangeError(
              `fillet: a (start, end) radius runs along each edge on its own, and two of the edges run into each other tangentially at ${_fmtPoint(p)}, where the kernel would bend both radii to one; give a constant radius`,
            )
          }
        }
        if (!at.has(v._identity())) at.set(v._identity(), [])
        at.get(v._identity())!.push(d)
      }
    }
  }

  /** Angles (degrees) between the normals of an edge's two faces at 9 points along it, leaving out
   * points where a normal cannot be evaluated (the apex of a cone). */
  static _faceAngles(e: Edge): number[] {
    const fs = e.faces()
    const out: number[] = []
    for (const t of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
      const p = e.pointAt(t)
      try {
        out.push(fs[0].normalAt(p).angleTo(fs[1].normalAt(p)))
      } catch (err) {
        if (!(err instanceof KernelError || _isValueError(err))) throw err
      }
    }
    return out
  }

  /** Distance from the edge to where a circular round of `radius` meets the faces. */
  static _setback(e: Edge, radius: number): number {
    const fs = e.faces()
    if (fs.length !== 2) return radius
    const p = e.center()
    const theta = _radians(fs[0].normalAt(p).angleTo(fs[1].normalAt(p)))
    return theta > 1e-6 ? radius * Math.tan(theta / 2) : radius
  }

  /**
   * Check a fillet or chamfer result: a valid solid whose volume changed in the right direction
   * and by no more than the rounds can take away or add.
   *
   * `sizes` are the radii (`shape` "circular" or "blend") or the setbacks (`shape` "chamfer").
   * Near the size limit the kernel can return a valid-looking body with whole regions missing.
   */
  _checkVolumeChange(result: Part, edges: readonly Edge[], what: string, sizes: readonly number[], shape: string): void {
    const size = new Set(sizes).size === 1 ? sizes[0] : Math.max(...sizes)
    const bound = _roundVolumeBound(edges, sizes, shape)
    const accuracy = bound !== null ? 1e-6 : 1e-4 // the bound needs the change accurately
    let before: number | null = null
    let after: number | null = null
    let problem = result._shapeProblem()
    if (problem === null) {
      try {
        before = this._kernelProps(accuracy).volume
        after = result._kernelProps(accuracy).volume
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
      }
      problem = result._solidProblem(after) // integrates once more only if that failed
    }
    if (problem !== null) {
      throw new KernelError(what, `kernel result is ${problem}`, null, `the ${shape !== 'chamfer' ? 'radius' : 'length'} may be too large for the selected edges (it is ${_formatG(size, 4)})`)
    }
    if (before === null || after === null) return
    const convex = _convexities(edges).map((kind) => kind === 'convex')
    const grows = after > before * (1 + 1e-3)
    if ((convex.every(Boolean) && grows) || (!convex.some(Boolean) && after < before * (1 - 1e-3))) {
      throw new KernelError(what, 'kernel result failed the volume check', null, 'the size is too large for the selected edges')
    }
    if (bound !== null && Math.abs(after - before) > bound + 1e-5 * Math.abs(before)) {
      const sizeName = shape === 'chamfer' ? 'length' : 'radius'
      throw new ModelingError(
        `${what}: the kernel returned a wrong body (the volume changed by ${_formatG(Math.abs(after - before))}, at most ${_formatG(bound)} is possible); the ${sizeName} ${_formatG(size, 4)} is too close to the largest the selected edges allow, use a smaller one`,
      )
    }
  }

  _withEdges(edges: unknown): [BrepHandle, number[]] {
    const own = this._ownEdges(edges)
    const [copy, , mapped] = ext.copy_with_map(this._brep, [], own, [])
    return [new BrepHandle(copy), [...mapped]]
  }

  _withFaces(faces: unknown): [BrepHandle, number[]] {
    const own = this._ownFaces(faces)
    const [copy, mapped] = ext.copy_with_map(this._brep, own, [], [])
    return [new BrepHandle(copy), [...mapped]]
  }

  // -- features -----------------------------------------------------------------------------
  /**
   * Round edges.
   *
   * @param edges Edges of this part (a selection, a single edge, or faces whose edges to round).
   * @param radius Fillet radius. `{ start, end }` varies the radius linearly along each edge
   *   (where they differ: circular rounds only, not on closed edges or on edges that run into each
   *   other tangentially). An array with one radius per edge rounds edges differently.
   */
  fillet(edges: unknown, radius: FilletRadius, options: FilletOptions = {}): Part {
    _opts('Part.fillet', options)
    const { continuity = null, fullness = 1.0 } = options
    this._requireValid('fillet')
    const varying = typeof radius === 'object' && !Array.isArray(radius) && !ArrayBuffer.isView(radius) ? (radius as { start: number; end: number }) : null
    const list = Array.isArray(radius) || ArrayBuffer.isView(radius) ? Array.from(radius as ArrayLike<number>, Number) : null
    const given = varying ? [varying.start, varying.end].map(Number) : list ?? [Number(radius)]
    if (given.some((r) => !(r > 0))) throw new RangeError('fillet: the radius must be positive')
    if (varying && continuity != null && given[0] !== given[1]) {
      // the kernel makes a ruled chamfer of it, not tangent to the faces
      throw new RangeError('fillet: a (start, end) radius makes circular rounds only; continuity needs a constant radius')
    }
    const sel = this._sharpEdges(edges, 'fillet')
    if (varying && Number(varying.start) !== Number(varying.end)) Part._checkRadiusLaw(sel)
    let radii: number[]
    if (varying) radii = new Array(sel.length).fill(Math.max(varying.start, varying.end))
    else if (list) radii = list
    else radii = new Array(sel.length).fill(Number(radius))
    if (radii.length === sel.length) {
      this._checkRoundSizes(sel, sel.map((e, i) => Part._setback(e, radii[i])), 'fillet', 'radius')
    }
    const [h, kedges] = this._withEdges(sel)
    const cont = _continuity(continuity)
    _roundCall(
      'fillet',
      () => {
        if (varying) {
          k.variable_radius_fillet(h.brep, kedges, {
            start_radius: Number(varying.start),
            end_radius: Number(varying.end),
            xsect_type: cont === null ? 1 : 2,
            continuity: cont || 1,
          })
        } else if (list) {
          if (list.length !== kedges.length) throw new RangeError(`${list.length} radii for ${kedges.length} edges`)
          const xs = new Array(kedges.length).fill(cont ? k.FilletXSect.BLEND : k.FilletXSect.CIRCULAR)
          k.fillet_edges_per_edge(h.brep, kedges, list, xs, { continuity: cont || 1, thumbweight: fullness })
        } else if (cont === null) {
          k.fillet_edges(h.brep, kedges, { radius: Number(radius) })
        } else {
          k.fillet_edges(h.brep, kedges, { radius: Number(radius), xsect_type: 2, continuity: cont, thumbweight: fullness })
        }
      },
      'the radius may be too large for the selected edges',
    )
    const result = this._like(_take(h))
    let sizes: number[]
    if (varying) sizes = new Array(sel.length).fill(Math.max(varying.start, varying.end))
    else if (list) sizes = list
    else sizes = new Array(sel.length).fill(Number(radius))
    this._checkVolumeChange(result, sel, 'fillet', sizes, cont === null ? 'circular' : 'blend')
    return result
  }

  /**
   * Bevel edges. `length` is the setback measured along both adjacent faces.
   *
   * The faces of each edge must meet at the same angle all along it (within 1 degree); where they
   * do not (a hole into a tilted or curved face), use `fillet`.
   */
  chamfer(edges: unknown, length: number): Part {
    this._requireValid('chamfer')
    if (!(Number(length) > 0)) throw new RangeError('chamfer: the length must be positive')
    const sel = this._sharpEdges(edges, 'chamfer')
    this._checkRoundSizes(sel, new Array(sel.length).fill(Number(length)), 'chamfer', 'length')
    const radii: number[] = []
    for (const e of sel) {
      const fs = e.faces()
      if (fs.length === 2) {
        const p = e.center()
        const theta = _radians(fs[0].normalAt(p).angleTo(fs[1].normalAt(p)))
        const r = theta > 1e-6 ? length / Math.tan(theta / 2) : length
        const angles = Part._faceAngles(e)
        if (angles.length && Math.max(...angles) - Math.min(...angles) > _CHAMFER_ANGLE_SPREAD) {
          const [lo, hi] = [Math.min(...angles), Math.max(...angles)]
          throw new ModelingError(
            `chamfer: the faces of an edge meet at an angle that changes along it (their normals are ${_formatG(lo, 4)} to ${_formatG(hi, 4)} degrees apart), and the bevel would reach ${_formatG(r * Math.tan(_radians(lo) / 2), 4)} to ${_formatG(r * Math.tan(_radians(hi) / 2), 4)} from the edge instead of ${_formatG(Number(length), 4)}; round such an edge with fillet(), whose radius stays the same along it`,
          )
        }
        radii.push(r)
      } else {
        radii.push(length)
      }
    }
    const [h, kedges] = this._withEdges(sel)
    _roundCall(
      'chamfer',
      () => {
        if (radii.every((r) => Math.abs(r - radii[0]) < 1e-12)) {
          k.fillet_edges(h.brep, kedges, { radius: radii[0], xsect_type: 0 })
        } else {
          // per-edge radii with a linear cross-section, in one call: a call per edge replaces
          // the edges next to it, and the next call would use freed edges
          k.fillet_edges_per_edge(h.brep, kedges, radii, new Array(kedges.length).fill(k.FilletXSect.LINEAR))
        }
      },
      'the length may be too large for the selected edges',
    )
    const result = this._like(_take(h))
    this._checkVolumeChange(result, sel, 'chamfer', new Array(sel.length).fill(Number(length)), 'chamfer')
    return result
  }

  /**
   * Hollow the part out to walls of `thickness`, removing the `openings` faces.
   *
   * The walls grow inward (the outside keeps its size) unless `outward` is true.
   *
   * Walls that do not fit into the part (measured across it from each face), and results the
   * kernel gets wrong (faces that do not meet, no cavity, the part given back, a closed shell of the
   * wrong volume), throw a ModelingError. The kernel step runs in the probe worker (a kernel of its
   * own; on a page's main thread in this one), so that a crash of its offset code throws a
   * ModelingError too, and it is stopped after `GUARD_SECONDS` (20 s; `setGuardSeconds(seconds)`
   * raises it for large parts).
   */
  shell(thickness: number, openings: unknown = null, options: { outward?: boolean } = {}): Part {
    _opts('Part.shell', options)
    const outward = options.outward ?? false
    this._requireValid('shell')
    if (!(Math.abs(Number(thickness)) > 0)) throw new RangeError('shell: the thickness must not be zero')
    const faces = openings != null ? this._ownFaces(openings) : []
    const t = Math.abs(Number(thickness))
    const rays = this._inwardRays(faces)
    if (!outward) this._checkWallFits(t, faces, rays)
    const d = outward ? t : -t
    const hint = this._shellHint(faces)
    const offsets = new Map<boolean, number>() // volume of the part offset by d, by mode (for a closed shell)
    const offsetVolume = (extended: boolean): number => {
      if (!offsets.has(extended)) {
        const work = (): number => kernelCall('shell', () => k.offset_brep(this._brep, d, { extended_offset: extended }))
        const off = Part._wrap(_isolated('shell', work, () => ({ op: 'offset_brep', bodies: [_smb(this)], distance: d, options: { extended_offset: extended } })))
        try {
          offsets.set(extended, k.brep_face_count(off._brep) ? Number(off._props(1e-4).volume) : 0)
        } finally {
          off.dispose()
        }
      }
      return offsets.get(extended)!
    }
    const attempt = (extended: boolean): Part => {
      const work = (): number => kernelCall('shell', () => k.shell_brep(this._brep, d, { extended_offset: extended, faces_to_shell: faces }), hint)
      // In the probe worker (smlibpy: in a copy of its process): the kernel's offset code can crash,
      // mostly in its extended mode, which depends on memory layout.
      const job = (): _Job => ({ op: 'shell_brep', bodies: [_smb(this)], distance: d, options: { extended_offset: extended }, faces: _faceIndices(this, faces) })
      return this._like(_isolated('shell', work, job, hint))
    }
    return this._checked(
      'shell',
      [
        [false, () => attempt(false)],
        [true, () => attempt(true)],
        [true, () => attempt(true)],
      ],
      { grow: outward ? t : 0, smaller: outward ? null : true, problem: (result, extended) => this._shellProblem(result, d, faces, rays, extended, offsetVolume), hint },
    )
  }

  /** For each face that is not an opening: a point on it, the direction into the part there, how
   * deep the part is along it (to the face it meets first), and whether that face is an opening.
   * The checks of `shell` measure the part along these. */
  _inwardRays(openings: readonly number[]): [Vector, Vector, number, boolean][] {
    const faces = this.faces()
    const box = this._looseBox()
    // (a face is met again at the start within its tolerance, and so is a face that meets it there at
    // a sharp angle, or lies on it in an imported part)
    const near = 1e-4 * Math.max(box.diagonal, 1)
    const meshes = new Map<unknown, Mesh[]>()
    const out: [Vector, Vector, number, boolean][] = []
    for (const f of faces) {
      if (openings.includes(f._f)) continue
      let p: Vector
      let n: Vector
      let hits: Hit[]
      try {
        const [[u0, v0], [u1, v1]] = k.face_uv_domain(f._f)
        let u = 0.5 * (u0 + u1)
        let v = 0.5 * (v0 + v1)
        if (k.face_classify_uv(f._f, u, v) !== 'inside') {
          const [, uvs] = k.surface_closest_point(k.face_surface(f._f), f.interiorPoint().toArray())
          ;[u, v] = [uvs[0][0], uvs[0][1]]
        }
        p = new Vector(k.face_point_at_uv(f._f, u, v))
        n = new Vector(k.face_outward_normal_at_uv(f._f, u, v)).normalized().neg()
        hits = _raycast(faces, p, n, box, true, meshes).filter((h) => h.distance >= near)
      } catch (e) {
        if (!_isRuntimeError(e)) throw e // a face the kernel cannot place a point on
        continue
      }
      if (hits.length) out.push([p, n, hits[0].distance, openings.includes(hits[0].face._f)])
    }
    return out
  }

  /** Refuse inward walls that cannot fit: along each axis the part must be thicker than its walls
   * (two, or one where an opening faces that way). With openings, so must it be across each face,
   * into the part (`rays`, see `_inwardRays`), since a rotated or angled part bypasses the axes. The
   * kernel returns wrong bodies there, or crashes. (A closed shell is checked on its result: see
   * `_shellProblem`.) */
  _checkWallFits(t: number, openings: readonly number[], rays: readonly [Vector, Vector, number, boolean][]): void {
    const box = this.bbox()
    const tol = 1e-6 * Math.max(box.diagonal, 1)
    const lo = box.min.toArray()
    const hi = box.max.toArray()
    const openSides = new Set<string>()
    for (const kf of openings) {
      const f = new Face(this, kf)
      if (!f.isPlanar) continue
      const n = f.normalAt().toArray()
      const c = f.center().toArray()
      for (let i = 0; i < 3; i++) {
        if (Math.abs(Math.abs(n[i]) - 1) < 1e-9) {
          const side = n[i] > 0 ? 1 : -1
          const level = side > 0 ? hi[i] : lo[i]
          if (Math.abs(c[i] - level) <= tol) openSides.add(`${i},${side}`)
        }
      }
    }
    ;['X', 'Y', 'Z'].forEach((axis, i) => {
      const walls = 2 - (openSides.has(`${i},1`) ? 1 : 0) - (openSides.has(`${i},-1`) ? 1 : 0)
      const size = hi[i] - lo[i]
      if (walls && walls * t >= size - tol) {
        if (walls === 2) {
          throw new ModelingError(`shell: two walls of ${_formatG(t, 4)} do not fit into the part, which is ${_formatG(size, 4)} thick along ${axis}; use a thinner wall`)
        }
        throw new ModelingError(`shell: a wall of ${_formatG(t, 4)} does not fit into the part, which is ${_formatG(size, 4)} deep along ${axis} from the opening; use a thinner wall`)
      }
    })
    for (const [p, , depth, opening] of openings.length ? rays : []) {
      const walls = opening ? 1 : 2
      if (walls * t >= depth - tol) {
        const at = `(${_formatG(p.x, 4)}, ${_formatG(p.y, 4)}, ${_formatG(p.z, 4)})`
        if (walls === 2) {
          throw new ModelingError(`shell: two walls of ${_formatG(t, 4)} do not fit into the part, which is ${_formatG(depth, 4)} thick across the face at ${at}; use a thinner wall`)
        }
        throw new ModelingError(`shell: a wall of ${_formatG(t, 4)} does not fit into the part, which is ${_formatG(depth, 4)} deep from the face at ${at} to the opening; use a thinner wall`)
      }
    }
  }

  /** What a failed shell says: that the kernel cannot open a face whose rim meets its neighbours
   * tangentially (the flat top of a rounded box), or else that the wall may be too thick. */
  _shellHint(openings: readonly number[]): string {
    for (const kf of openings) {
      for (const e of new Face(this, kf).edges()) {
        if (e.convexity === 'smooth') {
          return 'the kernel cannot open a face whose rim meets its neighbours tangentially; shell the part before rounding the rim, or shell it closed and cut the opening out'
        }
      }
    }
    return 'the wall may be thicker than the part allows'
  }

  /** What is wrong with `result` as this part shelled by `d` (inward when negative), or null. Checked
   * at the middle of each ray (`rays`) into the part: where walls grow inward and the part is too
   * thin for two (a closed shell; with openings `shell` refuses such a part), the walls meet, and the
   * point lies in the material. Where the point is farther from the faces than the walls reach (any
   * point of the part, for walls that grow outward), it lies in the cavity; the extended mode's walls
   * reach farther at inside corners, which it makes sharp. A closed shell is the part less its offset
   * by `d` (`offsetVolume` of the mode), or that offset less the part. */
  _shellProblem(
    result: Part,
    d: number,
    openings: readonly number[],
    rays: readonly [Vector, Vector, number, boolean][],
    extended: boolean,
    offsetVolume: (extended: boolean) => number,
  ): string | null {
    const t = Math.abs(d)
    const tol = 1e-6 * Math.max(this._extent(), 1)
    const reach = d > 0 ? 0 : extended ? 4 * t : t
    const solid: Vector[] = []
    const hollow: Vector[] = []
    for (const [p, n, depth, opening] of rays) {
      if (d < 0 && !opening && depth <= 2 * t) {
        solid.push(p.add(n.mul(depth / 2)))
        continue
      }
      const q = p.add(n.mul(opening && d < 0 ? (depth + t) / 2 : depth / 2))
      if (this.distanceTo(q) > reach + tol) hollow.push(q)
    }
    const points = [...solid, ...hollow]
    const where = points.length ? result._classify(points) : []
    for (let i = 0; i < points.length; i++) {
      const q = points[i]
      const at = `(${_formatG(q.x, 4)}, ${_formatG(q.y, 4)}, ${_formatG(q.z, 4)})`
      if (i < solid.length && where[i][0] === 'outside') {
        return `a body with a cavity where its walls meet: ${at}, within ${_formatG(t, 4)} of the faces on both sides, is not in its material`
      }
      if (i >= solid.length && where[i][0] === 'inside') return `a body without its cavity: ${at}, which no wall reaches, lies in its material`
    }
    if (openings.length) return null
    let moved: number
    try {
      moved = offsetVolume(extended)
    } catch (e) {
      if (!(e instanceof ModelingError)) throw e // (also a KernelError, or a crash in the probe worker)
      return `a hollow body that cannot be checked: the kernel cannot offset the part by ${_formatG(d, 4)} (${e.message})`
    }
    if (d < 0 && !(moved > 0)) {
      return `a hollow body, but two walls of ${_formatG(t, 4)} do not fit into the part: the kernel finds nothing of it left when it shrinks it by ${_formatG(t, 4)}`
    }
    const whole = Number(this._props(1e-4).volume)
    const expect = Math.abs(whole - moved)
    const got = Number(result._props(1e-4).volume)
    if (!(Math.abs(got - expect) <= 1e-4 * whole)) {
      return `a hollow body of volume ${_formatG(got, 10)}, where the part less its offset by ${_formatG(d, 4)} has ${_formatG(expect, 10)}`
    }
    return null
  }

  /** Grow (positive) or shrink (negative) the part by `distance` everywhere (0 gives an equal
   * copy).
   *
   * Results the kernel gets wrong (faces that do not meet, a change of the wrong sign) throw a
   * ModelingError. The kernel step runs in the probe worker and is stopped after `GUARD_SECONDS`
   * (20 s), as for `shell`. */
  offset(distance: number): Part {
    this._requireValid('offset')
    const d = Number(distance)
    if (d === 0) return this._like(this._copyBrep())
    const work = (): number => kernelCall('offset', () => k.offset_brep(this._brep, d))
    // (always the extended mode, which depends on memory layout and can crash: it runs in the probe
    // worker, smlibpy: in a copy of its process)
    const attempt = (): Part => this._like(_isolated('offset', work, () => ({ op: 'offset_brep', bodies: [_smb(this)], distance: d, options: { extended_offset: true } })))
    return this._checked(
      'offset',
      [
        [true, attempt],
        [true, attempt],
      ],
      { grow: Math.max(d, 0), smaller: d < 0 },
    )
  }

  /** The first result of `attempts` that passes the checks: a valid solid within the part's box
   * (grown by `grow`), whose faces meet (gaps below _OFFSET_GAPS), whose volume went down
   * (`smaller`), up (`smaller: false`) or changed (null), and in which `problem` finds nothing wrong.
   *
   * Each attempt is a mode (the kernel's extended offset mode or not) and a function that makes the
   * result. An attempt in the mode of the one before runs only when that one's result was refused,
   * within _RETRY_SECONDS: the kernel fails the same way again, and only its extended mode, which
   * depends on memory layout, ever gave a better result. A step that crashed the kernel (a trap, or
   * a crash in the probe worker) or did not finish ends the attempts. */
  _checked(
    name: string,
    attempts: readonly [boolean, () => Part][],
    options: { grow: number; smaller: boolean | null; problem?: ((result: Part, extended: boolean) => string | null) | null; hint?: string },
  ): Part {
    const { grow, smaller, problem = null, hint = 'try a smaller value' } = options
    const box = this.bbox()
    const tol = 1e-6 * Math.max(box.diagonal, 1) + grow
    const before = Number(this._props(1e-4).volume)
    const start = Date.now()
    let error: KernelError | null = null
    let refused: string | null = null
    let last: [boolean, boolean] | null = null // the mode of the attempt before, and whether it failed
    for (const [mode, attempt] of attempts) {
      if (last !== null && last[0] === mode && (last[1] || Date.now() - start > _RETRY_SECONDS * 1000)) continue
      let result: Part
      try {
        result = attempt()
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        // a trap: the kernel crashed here, and its memory may be damaged
        if (typeof WebAssembly !== 'undefined' && (e as Any).cause instanceof WebAssembly.RuntimeError) throw e
        error = e
        last = [mode, true]
        continue
      }
      last = [mode, false]
      const why = _offsetProblem(result, box, tol, before, smaller) ?? (problem ? problem(result, mode) : null)
      if (why === null) return result
      refused ??= why
      result.dispose()
    }
    if (error !== null) throw error
    throw new ModelingError(`${name}: the kernel could not build a valid result (it built ${refused}); ${hint}`)
  }

  /**
   * Cut the part with a plane.
   *
   * `keep = "above"` keeps the side the plane normal points to, "below" the other side, "both"
   * returns `[above, below]`.
   */
  split(plane: Plane | Face, keep: 'above' | 'below'): Part
  split(plane: Plane | Face, keep: 'both'): [Part, Part]
  split(plane: Plane | Face): Part
  split(plane: Plane | Face, keep: string = 'above'): Part | [Part, Part] {
    const pl = _asPlane(plane)
    if (keep === 'both') return [this.split(pl, 'above'), this.split(pl, 'below')]
    if (keep !== 'above' && keep !== 'below') throw new RangeError('keep must be "above", "below" or "both"')
    this._requireValid('split')
    // Intersect with a half-space box: exact, and caps the cut (the kernel's plane cut leaves the
    // body open).
    const bb = this.bbox()
    const size = 4 * (bb.diagonal + bb.center.distanceTo(pl.origin)) + 1
    const side = keep === 'above' ? pl : pl.flipped()
    const halfspace = Box(size, size, size)
      .translate(0, 0, size / 2)
      .moved(new Plane(pl.project(bb.center), side.xDir, side.zDir).location)
    const kept = kernelCall('split', () => this.intersect(halfspace))
    if (k.brep_face_count(kept._brep) === 0) throw new ModelingError(`split: nothing of the part lies ${keep} the plane`)
    return kept
  }

  /**
   * The cross-section of the part in a plane, as a sketch. Of a part made by `merge`, the sections
   * of the cells the plane cuts, side by side (a region per cell).
   */
  section(plane: Plane | Face = Plane.XY): Sketch {
    const pl = _asPlane(plane)
    if (!k.brep_is_manifold_solid(this._brep)) {
      // The kernel sections the whole body, where a face between two cells bounds both: the region
      // of a cell inside another was dropped, or the section failed.
      let cells: ShapeList<Part>
      try {
        cells = this.cells()
      } catch (e) {
        if (!(e instanceof ModelingError) || e instanceof KernelError) throw e
        throw new ModelingError(`section: ${e.message}`)
      }
      if (cells.length > 1) {
        const regions: Face[] = []
        for (const cell of cells) {
          let piece: Sketch
          try {
            piece = cell.section(pl)
          } catch (e) {
            if (e instanceof RangeError) continue // the plane misses this cell
            throw e
          }
          // a face between two cells that lies in the plane comes from both
          for (const f of piece.faces()) if (!regions.some((g) => _sameRegion(f, g))) regions.push(f)
        }
        if (!regions.length) throw new RangeError('the plane does not cut the part')
        const sheets = regions.map((f) => f.toShell())
        try {
          return Sketch._wrap(kernelCall('section', () => ext.combine(sheets.map((sh) => sh._brep))), { plane: pl })
        } finally {
          for (const sh of sheets) sh.dispose()
        }
      }
    }
    const curves: number[] = kernelCall('section', () => k.intersect_brep_with_plane(this._brep, pl.origin.toArray(), pl.zDir.toArray()))
    if (!curves.length) throw new RangeError('the plane does not cut the part')
    const b = kernelCall('section', () => k.create_planar_faces([...curves]))
    return Sketch._wrap(b, { plane: pl })
  }

  // -- deformations (the deform module) -----------------------------------------------------
  /** Twist about an axis (default Z) by `angle` degrees over the part; see `twist`. */
  twist(angle: number, options: TwistOptions = {}): Part {
    return _twist(this, angle, options)
  }

  /** Scale cross-sections toward an axis (default Z) from 1 to `scale`; see `taper`. */
  taper(scale: number, options: TaperOptions = {}): Part {
    return _taper(this, scale, options)
  }

  /** Bend around an axis by `angle` degrees (default: along X, toward +Z); see `bend`. */
  bend(angle: number, options: BendOptions = {}): Part {
    return _bend(this, angle, options)
  }

  /** Deform with a `Lattice` (same as `lattice.apply(part)`). */
  deform(lattice: { apply(part: Part, options?: Record<string, unknown>): Part }, options: Record<string, unknown> = {}): Part {
    return lattice.apply(this, options)
  }

  /** The part with fillets taken out and their edges sharp again: `faces` (fillet faces of this
   * part), or all fillets up to `maxRadius`. With `partial` the fillets the kernel cannot take
   * out stay. See the defeature module. */
  removeFillets(faces: unknown = null, options: { maxRadius?: number | null; partial?: boolean } = {}): Part {
    _opts('Part.removeFillets', options)
    return _removeFillets(this, faces, options)
  }

  /** The part with `faces` (a hole, a boss, a pocket) cut out and the gap closed by the faces
   * around it. With `partial` the features the kernel cannot close stay. See the defeature
   * module. */
  removeFaces(faces: unknown, options: { partial?: boolean } = {}): Part {
    _opts('Part.removeFaces', options)
    return _removeFaces(this, faces, options)
  }

  /** Draft angle of every face for the pull direction, with the faces grouped by whether they
   * release (see `DraftAnalysis`). */
  draftAnalysis(direction: Axis | VectorLike, options: { minAngle?: number } = {}): DraftAnalysis {
    _opts('Part.draftAnalysis', options)
    return _draftAnalysis(this, direction, options)
  }

  /** The closed lines where the part's surface turns from facing `direction` to facing away from
   * it (see `partingLine`). */
  partingLine(direction: Axis | VectorLike): ShapeList<Wire> {
    return _partingLine(this, direction)
  }

  /**
   * Tilt faces by a draft angle, so that a molded or cast part comes out of its mold.
   *
   * Each face turns about the line where it meets the neutral plane and keeps its size there. The
   * normal of the neutral plane is the pull direction, the way the mold moves off the part: a
   * positive angle turns each face to look more along it, so the part narrows and pockets and
   * holes widen along the normal, on either side of the plane. Afterwards `draftAnalysis` of that
   * direction finds `angle` more draft on each of the faces.
   *
   * Planes can be drafted, and cylinders and cones whose axis runs along the normal (a cylinder
   * becomes a cone). A face that meets a drafted face tangentially, such as a fillet between two
   * walls, must be drafted with it; the faces around the drafted ones are extended or trimmed to
   * meet them.
   *
   * @param faces Faces of this part (a selection or a single face).
   * @param angle Draft angle in degrees, between -90 and 90 and not 0. A face's draft may be 89
   *   degrees at most.
   * @param neutralPlane Where the faces keep their size, a Plane or a planar face. A face's
   *   normal points out of the part: the top face drafts for a mold that moves up, the bottom face
   *   for one that moves down (use `Plane.XY` there).
   */
  draft(faces: unknown, angle: number, neutralPlane: Plane | Face): Part {
    return draftFaces(this, faces, angle, neutralPlane)
  }

  // -- sheet metal (the logic is in the sheetmetal module) ----------------------------------
  /** Fold this sheet along a line on its top or bottom face (see `fold`). */
  fold(line: Axis | Edge, angle: number, options: FoldOptions): Part {
    _opts('Part.fold', options)
    return _fold(this, line, angle, options)
  }

  /** Add a flange along a straight outer edge of this sheet (see `flange`). */
  flange(edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part {
    _opts('Part.flange', options)
    return _flange(this, edge, length, options)
  }

  /** The bends of this sheet metal part (see `bends`). */
  bends(options: { kFactor?: number } = {}): Bend[] {
    _opts('Part.bends', options)
    return _bends(this, options)
  }

  /** This sheet metal part unfolded flat (see `unfold`). */
  unfold(options: UnfoldOptions = {}): Part {
    _opts('Part.unfold', options)
    return _unfold(this, options)
  }

  /** The flat pattern of this sheet metal part on XY (see `flatPattern`). */
  flatPattern(options: UnfoldOptions = {}): FlatPattern {
    _opts('Part.flatPattern', options)
    return _flatPattern(this, options)
  }

  override toString(): string {
    let vol: string
    try {
      // the volume to the default accuracy: kept with the part for the next query
      vol = `volume=${_formatG(this._props().volume)}`
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      vol = 'not a closed solid'
    }
    const n = k.brep_face_count(this._brep)
    const label = this.name ? `'${this.name}', ` : ''
    return `Part(${label}${n} faces, ${vol})`
  }
}

function _fmtPoint(p: Vector): string {
  return `(${_formatG(p.x)}, ${_formatG(p.y)}, ${_formatG(p.z)})`
}

/** The axis and the positive angle of a revolve (a negative angle turns the other way). */
/** The axis and the positive angle of a revolve (a negative angle turns the other way). Within 0.01
 * degrees of a whole turn it is a whole turn: the kernel returns no closed solid for angles above
 * 359.99 and below 359.99999, where its whole turn starts. */
export function _revolveAxisAngle(ax: Axis, angle: number): [Axis, number] {
  angle = Number(angle)
  if (angle === 0 || !Number.isFinite(angle)) throw new RangeError('revolve: the angle must not be zero')
  if (Math.abs(angle) > 360 + 1e-9) throw new RangeError('revolve: the angle is at most 360 degrees')
  if (angle < 0) {
    ax = new Axis(ax.origin, ax.direction.neg())
    angle = -angle
  }
  return [ax, angle > 360 - WHOLE_TURN ? 360 : angle]
}

// How close to 360 degrees a revolve is a whole turn (degrees).
export const WHOLE_TURN = 0.01

// Extrusion directions: within this sine of the sketch plane the kernel refuses them (SM_ERR), below
// the other the solid is less than a thousandth of the amount thick (a warning).
const IN_PLANE = 1e-5
const NEAR_PLANE = 1e-3

/** A revolve's kernel body (taken over) wrapped as `cls`, with cylinders, cones, spheres and tori
 * where its surfaces of revolution are one. The kernel revolves through a whole turn into surfaces of
 * revolution where part of a turn gives cylinders, cones and spheres, and gives tori in neither (a
 * revolved tube had no cylinders: no `Face.radius`, no draft, B-splines in STEP files). Where the
 * body with them is not the same (its faces, its volume or area), the body as it was. */
export function _analyticRevolve<B extends Part | Shell>(b: number, cls: typeof Part | typeof Shell): B {
  const before = (cls as typeof Part)._wrap(b) as unknown as B
  let c: number | null
  try {
    c = ext.analytic_revolutions(b)
  } catch (e) {
    if (!_isRuntimeError(e)) throw e
    return before
  }
  if (c === null || c === 0) return before
  const after = (cls as typeof Part)._wrap(c) as unknown as B
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-7 * Math.max(Math.abs(x), Math.abs(y))
  try {
    if (k.brep_face_count(c) !== k.brep_face_count(b)) return before
    if (after instanceof Part) {
      if (after._solidProblem() !== null || !close(after.volume, (before as Part).volume)) return before
    } else if (!close((after as Shell).area, (before as Shell).area)) return before
  } catch (e) {
    if (!(e instanceof KernelError)) throw e
    return before
  }
  return after
}

/** Throw if a feature returned a broken solid (inside out, without volume, open). */
export function _requireSolid(part: Part, what: string, hint: string): Part {
  const problem = part._solidProblem()
  if (problem !== null) throw new ModelingError(`${what}: the kernel returned a body that is ${problem}; ${hint}`)
  return part
}

/** The most volume rounds of the given sizes can remove (convex edges) or add (concave edges):
 * each edge's round cross-section swept along it, plus a little at the corners where rounds
 * meet. null where an edge is neither straight nor circular, and where an edge runs on into one
 * that is not rounded (see `_runsOn`). */
function _roundVolumeBound(edges: readonly Edge[], sizes: readonly number[], shape: string): number | null {
  let total = 0
  const corner = new Map<string, number>()
  const count = new Map<string, number>()
  const rounded = new Set(edges.map((e) => e._identity()))
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    const r = sizes[i]
    const kind = e.geomType
    if (kind !== 'line' && kind !== 'circle') return null
    const fs = e.faces()
    if (fs.length !== 2) return null
    if (_runsOn(e, rounded)) return null
    const p = e.center()
    let theta: number
    try {
      theta = _radians(fs[0].normalAt(p).angleTo(fs[1].normalAt(p)))
    } catch (err) {
      if (!(err instanceof KernelError || _isValueError(err))) throw err
      return null
    }
    theta = Math.min(Math.max(theta, 1e-6), Math.PI - 1e-6)
    let setback: number
    let area: number
    if (shape === 'chamfer') {
      setback = r
      area = 0.5 * setback ** 2 * Math.sin(theta)
    } else {
      setback = r * Math.tan(theta / 2)
      if (shape === 'circular') area = r * r * (Math.tan(theta / 2) - theta / 2)
      else area = 0.5 * setback ** 2 * Math.sin(theta) // a blend stays inside the triangle between its setback lines
    }
    let length = e.length
    if (kind === 'circle') length *= 1 + setback / e.radius // the round's centroid runs at most this far out
    total += area * length
    for (const v of e.vertices()) {
      const key = `${v.point.x},${v.point.y},${v.point.z}` // not the vertex's identity: a dropped vertex's number is reused
      corner.set(key, Math.max(corner.get(key) ?? 0, setback))
      count.set(key, (count.get(key) ?? 0) + 1)
    }
  }
  let extra = 0
  for (const [key, c] of corner) if ((count.get(key) ?? 0) > 1) extra += 0.1 * c ** 3
  return 1.1 * total + extra
}

/** True if `e` runs on past one of its ends into an edge that is not rounded: one that leaves the
 * shared vertex less than 90 degrees away from the direction in which `e` arrives (tangentially,
 * as around a rounded corner, or at a kink, as around a polygon). The kernel extends the round
 * there until it leaves the material, which can take away much more than the edge's own share. */
function _runsOn(e: Edge, rounded: Set<string>): boolean {
  for (const v of e.vertices()) {
    const own = _leaving(e, v.point)
    for (const g of v.edges()) {
      if (rounded.has(g._identity())) continue
      if (own.some((a) => _leaving(g, v.point).some((b) => a.dot(b) < -1e-6))) return true
    }
  }
  return false
}

/** The directions in which an edge leaves its end at `p` (both ends of a closed edge). */
function _leaving(e: Edge, p: Vector): Vector[] {
  if (e.isClosed) return [e.tangentAt(0), e.tangentAt(1).neg()]
  if (e.start.distanceTo(p) <= e.end.distanceTo(p)) return [e.tangentAt(0)]
  return [e.tangentAt(1).neg()]
}

/** Distance from a point to an edge (analytic for straight edges). */
function _distanceToEdge(e: Edge, p: Vector): number {
  if (e.geomType === 'line') {
    const a = e.start
    const ab = e.end.sub(a)
    const t = Math.max(0, Math.min(1, p.sub(a).dot(ab) / Math.max(ab.dot(ab), 1e-300)))
    return a.add(ab.mul(t)).distanceTo(p)
  }
  return e.distanceTo(p)
}

/** Release a handle's Brep to a new owner. */
export function _take(h: BrepHandle): number {
  return h.release()
}

/** Runs `work` on a Brep that a handle holds until `work` is done, and gives it back: a failure
 * frees it (the kernel keeps what it was given when it fails). */
export function _held(brep: number, work: (h: BrepHandle) => void): number {
  const h = new BrepHandle(brep)
  try {
    work(h)
    return h.release()
  } finally {
    h.dispose() // (nothing left to free once released)
  }
}

/** Two faces of sections in one plane that are the same region (within 1e-6 of their size). */
function _sameRegion(a: Face, b: Face): boolean {
  const ba = a.bbox()
  const bb = b.bbox()
  const tol = 1e-6 * Math.max(ba.diagonal, bb.diagonal)
  return (
    ba.min.distanceTo(bb.min) <= tol &&
    ba.max.distanceTo(bb.max) <= tol &&
    Math.abs(a.area - b.area) <= 1e-6 * Math.max(a.area, b.area) &&
    a.center().distanceTo(b.center()) <= tol
  )
}

/** What is wrong with the result of a merge, or null. Its volume, that of the union, lies between
 * that of the largest part and that of all parts together (within 1e-3); a result outside that is
 * wrong. The volumes are integrated as precisely as `volume` asks (it costs about as much as a
 * coarse integration), so that they are there when `volume` and `cells()` ask. */
function _mergeProblem(merged: Part, parts: Part[]): string | null {
  let volumes: number[]
  try {
    volumes = parts.map((p) => p._props().volume as number)
  } catch (e) {
    if (e instanceof KernelError) return null // a part whose volume cannot be integrated (not refused before either)
    throw e
  }
  let whole: number
  try {
    whole = merged._props().volume
  } catch (e) {
    if (e instanceof KernelError) return 'whose volume cannot be integrated'
    throw e
  }
  const largest = Math.max(...volumes)
  const sum = volumes.reduce((a, v) => a + v, 0)
  if (whole < largest * (1 - 1e-3)) return `of volume ${_formatG(whole, 6)}, less than that of the largest part (${_formatG(largest, 6)})`
  if (whole > sum * (1 + 1e-3)) return `of volume ${_formatG(whole, 6)}, more than that of all parts together (${_formatG(sum, 6)})`
  return null
}

/** Combine a copy of a tool into the Brep a handle owns (`ext.boolean`). The kernel changes that
 * Brep and deletes the copy when it succeeds, and keeps both when it fails: the handles hold them
 * until then and free them on a failure. */
function _combine(h: BrepHandle, tool: _Body, op: number, nonManifold = false): void {
  const th = new BrepHandle(tool._copyBrep())
  try {
    ext.boolean(h.brep, th.brep, op, nonManifold) // the result is h's Brep, changed
    th.release()
  } finally {
    th.dispose()
  }
}

// A fillet or chamfer that fails with SM_ERR_INVALID_INPUT fails at any size: the kernel takes an edge
// for one it cannot round, or has no corner for the way the selected edges meet at a vertex.
const _ROUND_SELECTION_HINT =
  'the kernel cannot round the selection as given, at any size: an edge whose faces meet almost tangentially, or a vertex where the selected edges meet in a way it has no corner for (such as the two halves of an edge that another face touches tangentially); select fewer edges there'

/** `kernelCall` for fillets and chamfers, with the hint for a selection the kernel cannot round. */
function _roundCall<T>(operation: string, fn: () => T, hint: string): T {
  try {
    return kernelCall(operation, fn, hint)
  } catch (e) {
    if (!(e instanceof KernelError) || e.status !== 'SM_ERR_INVALID_INPUT') throw e
    const error = new KernelError(e.operation, e.detail, e.status, _ROUND_SELECTION_HINT)
    ;(error as Any).cause = e
    throw error
  }
}

export function _continuity(c: number | string | null | undefined): number | null {
  if (c == null) return null
  if (typeof c === 'string') c = Number.parseInt(c.toUpperCase().replace(/^G+/, ''), 10)
  if (c !== 1 && c !== 2 && c !== 3) throw new RangeError('continuity must be G1, G2 or G3')
  return c
}

export function _flattenEdges(items: unknown): Edge[] {
  if (items instanceof Edge) return [items]
  if (items instanceof Face || items instanceof Wire) return [...items.edges()]
  if (!_isIterable(items)) throw new TypeError(_notIterable(items, 'edges'))
  const out: Edge[] = []
  for (const it of items) out.push(..._flattenEdges(it))
  return out
}

export function _flattenFaces(items: unknown): Face[] {
  if (items instanceof Face) return [items]
  if (!_isIterable(items)) throw new TypeError(_notIterable(items, 'faces'))
  const out: Face[] = []
  for (const it of items) out.push(..._flattenFaces(it))
  return out
}

/** Python's message for what is no list, and what an `undefined` mostly is in code ported from
 * Python: an element taken with a negative index, which JavaScript lists do not have. */
function _notIterable(items: unknown, what: string): string {
  const message = `'${_typeName(items)}' object is not iterable`
  if (items !== undefined) return message
  return `${message}: no ${what} given (undefined); for the last of a list, list[-1] in Python, use list.at(-1) or list.last`
}

/** A sheet body: one or more faces that do not enclose a volume (surfaces). */
export class Shell extends _Body {
  get area(): number {
    let a = 0
    for (const f of this.faces()) a += f.area
    return a
  }

  override center(): Vector {
    let total = 0
    let c = new Vector()
    for (const f of this.faces()) {
      const a = f.area
      c = c.add(f.center().mul(a))
      total += a
    }
    if (total === 0) throw new RangeError('float division by zero')
    return c.div(total)
  }

  /** Turn the sheet into a solid of `thickness` (along the face normals; a negative thickness
   * grows against them). With `both` the solid is `thickness` thick in total, half of it to each
   * side of the sheet.
   *
   * The kernel step runs in the probe worker, so that a crash of its offset code throws a
   * ModelingError, and is stopped after `GUARD_SECONDS` (20 s), as for `Part.shell`. */
  thicken(thickness: number, options: { both?: boolean } = {}): Part {
    _opts('Shell.thicken', options)
    const d = Number(thickness)
    if (d === 0) throw new RangeError('thicken: the thickness must not be zero')
    const hint =
      'the kernel cannot offset this sheet (closed grid surfaces and surfaces with a pole fail; build closed shapes with revolve, loft or extrude, or thicken less than the smallest concave radius)'
    if (options.both) {
      // one side, then the other, fused: the two halves share the sheet
      return this.thicken(d / 2).fuse(this.thicken(-d / 2))
    }
    const work = (): number => kernelCall('thicken', () => k.shell_brep(this._brep, d, { create_solid: true }), hint)
    // (the kernel's extended offset mode, which depends on memory layout and can crash: it runs in the
    // probe worker, smlibpy: in a copy of its process)
    const job = (): _Job => ({ op: 'shell_brep', bodies: [_smb(this)], distance: d, options: { create_solid: true }, faces: [] })
    const b = _isolated('thicken', work, job, hint)
    return _requireSolid(Part._wrap(b, { name: this.name, color: this.color }), 'thicken', hint)
  }

  /** Union with other sheets (Python's `+`). */
  fuse(...others: unknown[]): Shell {
    return this._like(_held(this._copyBrep(), (h) => {
      for (const t of _bodies(others)) kernelCall('fuse', () => _combine(h, t, k.BooleanOp.UNION))
    }))
  }

  override toString(): string {
    return `${_typeName(this)}(${k.brep_face_count(this._brep)} faces, area=${_formatG(this.area)})`
  }
}

/** How a sketch is extruded. */
export interface ExtrudeOptions {
  /** Extrude the amount to both sides of the sketch. */
  both?: boolean
  /** Draft angle in degrees; positive narrows the solid away from the sketch. */
  taper?: number
  /** Extrude along this direction (an axis or a vector) instead of the normal; the amount is measured
   * along it. A direction in the sketch plane throws a `RangeError`; one less than 0.06 degrees (a sine
   * of 1e-3) off the plane warns, as the solid is then less than amount / 1000 thick. */
  direction?: Axis | VectorLike | null
  /** With a taper, the corners the taper pulls apart: 'sharp' (the walls extended until they meet)
   * or 'round' (rounded off, as an offset rounds them). */
  corners?: 'sharp' | 'round'
}

/**
 * A planar region (with holes, possibly several pieces) on a plane.
 *
 * Sketch constructors build in the world XY plane around the origin; place a sketch with
 * `.on(planeOrFace)`, `plane.mul(sketch)` or `Pos(...).mul(sketch)`. Combine sketches with
 * `fuse`, `cut`, `intersect` and `xor`, change them with `offset`, `fillet`, `chamfer` and
 * `mirror`, then turn them into parts with `extrude`, `revolve`, `sweep` or `loft`. Outlines that
 * are awkward as combinations of shapes are drawn with `Profile`.
 */
export class Sketch extends Shell {
  _plane: Plane = Plane.XY
  _loops: Any = null

  override _like(brep: number): this {
    return Sketch._wrap(brep, { plane: this._plane, name: this.name, color: this.color }) as this
  }

  static _fromWires(wires: readonly Wire[], plane: Plane | null = null): Sketch {
    const curves: number[] = []
    for (const w of wires) {
      if (!w.isClosed) throw new RangeError('a sketch region needs closed wires; use wire.close()')
      curves.push(..._mergedLines(w)._copyCurves())
    }
    if (plane === null) {
      plane = wires[0].plane()
      if (plane.zDir.dot(Z.direction) < -1e-9 || (Math.abs(plane.zDir.z) < 1e-9 && plane.zDir.dot([1, 1, 0]) < 0)) plane = plane.flipped()
    }
    const b = kernelCall('make face', () => k.create_planar_faces(curves), 'the wire must be planar and must not cross itself')
    return Sketch._wrap(b, { plane })
  }

  /** The sketch plane; extrusions follow its normal. */
  get plane(): Plane {
    return this._plane
  }

  override _transformed(m: Matrix): Sketch {
    const s = super._transformed(m) as Sketch
    const p = this._plane
    const origin = _apply(m, p.origin)
    const x = _applyVector(m, p.xDir)
    const y = _applyVector(m, p.yDir)
    const z = x.cross(y)
    s._plane = new Plane(origin, x, z)
    return s
  }

  // -- 2D booleans --------------------------------------------------------------------------
  _boolean2d(other: unknown, op: number, name: string): Sketch {
    let tools: _Body[]
    try {
      tools = _bodies(other, name)
    } catch (e) {
      if (!(e instanceof TypeError)) throw e
      throw new TypeError(
        `cannot ${name} a ${_typeName(other)} with a Sketch: both sides must be sketches (or a list of sketches). Make a region from curves with makeFace(...) or new Profile(...).close()`,
      )
    }
    for (const t of tools) {
      if (!(t instanceof Sketch)) throw new TypeError(`cannot ${name} a ${_typeName(t)} with a Sketch`)
      if (!this.plane.isCoplanar(t.plane, 1e-6 * Math.max(1, this._looseBox().union(t._looseBox()).diagonal))) {
        throw new RangeError(`cannot ${name} sketches in different planes; place both on the same plane first`)
      }
    }
    const sketches = tools as Sketch[]
    let result: Sketch = this
    if (op === k.BooleanOp2D.UNION || op === k.BooleanOp2D.DIFFERENCE) {
      // Tools that do not overlap each other go into one kernel call.
      for (const batch of _disjointBatches(sketches)) result = result._boolean2dWith(batch, op, name)
    } else {
      for (const t of sketches) result = result._boolean2dWith([t], op, name)
    }
    return result
  }

  _boolean2dWith(tools: readonly Sketch[], op: number, name: string, split = true): Sketch {
    if (!tools.length) return this
    const emptySelf = !k.brep_face_count(this._brep)
    if (emptySelf || !tools.some((t) => k.brep_face_count(t._brep))) {
      if (op === k.BooleanOp2D.INTERSECTION) return this._empty()
      if (emptySelf && op !== k.BooleanOp2D.DIFFERENCE) return kernelCall(name, () => this._like(ext.combine(tools.map((t) => t._brep))))
      return this
    }
    let box = tools[0]._looseBox()
    for (const t of tools.slice(1)) box = box.union(t._looseBox())
    if (_disjoint(this._looseBox(), box)) {
      if (op === k.BooleanOp2D.UNION || op === k.BooleanOp2D.EXCLUSIVE_OR) {
        return kernelCall(name, () => this._like(ext.combine([this._brep, ...tools.map((t) => t._brep)])))
      }
      if (op === k.BooleanOp2D.DIFFERENCE) return this
      return this._empty()
    }
    if (split) {
      let contact = this._contact()
      for (const t of tools) contact = contact ?? t._contact()
      if (contact !== null) return this._boolean2dByFaces(tools, op, name, contact)
    }
    // The kernel's planar Boolean is exact and fast on bodies built from their curves. On bodies
    // that were moved it can fail, or return a wrong union without an error, so both operands are
    // rebuilt first.
    const a = rebuiltBrep(this)
    const pieces = tools.map((t) => rebuiltBrep(t))
    if (a !== null && pieces.every((x) => x !== null)) {
      let b: number
      if (pieces.length > 1) {
        b = kernelCall(name, () => ext.combine(pieces))
        for (const x of pieces) ext.delete_brep(x)
      } else {
        b = pieces[0] as number
      }
      // The kernel changes a and deletes b when it succeeds with a region, and keeps both when it
      // fails or the region is empty: the handles hold them until then.
      const ha = new BrepHandle(a as number)
      const hb = new BrepHandle(b)
      try {
        const made: number = kernelCall(name, () => k.boolean_2d(ha.brep, hb.brep, { operation: op }))
        if (made) {
          ha.release()
          hb.release()
          const result = this._like(made) // (a, changed)
          if (this._boolean2dPlausible(tools, result, op)) return result
        }
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
      } finally {
        ha.dispose()
        hb.dispose()
      }
    } else {
      for (const x of [a, ...pieces]) if (x !== null) ext.delete_brep(x)
    }
    // The kernel refused: Booleans of thin slabs in 3D (slower, but robust).
    let tool = tools[0]
    if (tools.length > 1) tool = kernelCall(name, () => tool._like(ext.combine(tools.map((t) => t._brep))))
    if (op === k.BooleanOp2D.EXCLUSIVE_OR) {
      return this._slabOrEmpty(tool, k.BooleanOp2D.DIFFERENCE, name)._boolean2d(tool._slabOrEmpty(this, k.BooleanOp2D.DIFFERENCE, name), k.BooleanOp2D.UNION, name)
    }
    return this._slabOrEmpty(tool, op, name)
  }

  _empty(): Sketch {
    return this._like(ext.copy_faces(this._brep, []))
  }

  _slabOrEmpty(other: Sketch, op: number, name: string): Sketch {
    try {
      return this._slabBoolean(other, op, name)
    } catch (e) {
      if (e instanceof ModelingError && e.message.includes('empty')) return this._empty()
      throw e
    }
  }

  /** A point where two faces of the sketch, or two loops of one face, touch (a vertex of one at a
   * vertex of the other, as in an exclusive or of circles); null if none do. */
  _contact(): Vector | null {
    const points: Vector[] = []
    const loops: number[] = []
    let n = 0
    for (const f of this.faces()) {
      for (const w of f.wires()) {
        for (const v of w.vertices()) {
          points.push(v.point)
          loops.push(n)
        }
        n += 1
      }
    }
    if (n < 2) return null
    const tol = 1e-6 * Math.max(1, this._looseBox().diagonal)
    const order = points.map((_, i) => i).sort((i, j) => points[i].x - points[j].x)
    for (let a = 0; a < order.length; a++) {
      const i = order[a]
      for (const j of order.slice(a + 1)) {
        if (points[j].x - points[i].x > tol) break
        if (loops[i] !== loops[j] && points[i].distanceTo(points[j]) <= tol) return points[i]
      }
    }
    return null
  }

  /** Each face as a sketch of its own. */
  _faceSketches(): Sketch[] {
    return kernelCall('copy face', () => this.faces().map((f) => this._like(ext.copy_faces(this._brep, [f._f]))))
  }

  /** The faces of sketches whose regions do not overlap, in one sketch (no Boolean). */
  _combined(pieces: readonly Sketch[]): Sketch {
    const kept = pieces.filter((p) => k.brep_face_count(p._brep))
    if (!kept.length) return this._empty()
    return kernelCall('combine', () => this._like(ext.combine(kept.map((p) => p._brep))))
  }

  /** A planar Boolean of sketches with faces that touch each other at a point.
   *
   * There the kernel's planar Boolean misclassifies whole faces without an error, in either
   * operand: of `abc = Circle(5) ^ Circle(5).translate(4, 0) ^ Circle(5).translate(2, 4)` and a
   * triangle around it, `&` kept 54.9061 of 110.5398 and `-` left 55.6337 behind (Python: 86.6355
   * and 23.9044). The intersection of two single faces is reliable, so `&` is taken face by face.
   * The other operations are computed in the ways below, each checked against those overlaps (area
   * and first moments); the first that holds is the result. */
  _boolean2dByFaces(tools: readonly Sketch[], op: number, name: string, contact: Vector): Sketch {
    const own = this._faceSketches()
    const other: Sketch[] = []
    const owner: number[] = []
    tools.forEach((t, n) => {
      for (const g of t._faceSketches()) {
        other.push(g)
        owner.push(n)
      }
    })
    const wrong = (): ModelingError =>
      new ModelingError(
        `${name}: the sketches have faces that touch each other at a point, as at ${_fmtPoint(contact)}, and the kernel's planar Boolean gives a wrong region there (checked against the overlaps of the faces); move one of the shapes that make those faces a little, so that no two faces meet at a single point`,
      )
    let box = this.bbox() // (the loose boxes of planar faces can be far larger than the faces)
    for (const t of tools) box = box.union(t.bbox())
    const ref = box.center
    const measure = (sketches: Iterable<Sketch>): number[] =>
      kernelCall(name, () => {
        const total = [0, 0, 0, 0]
        for (const s of sketches) {
          for (const f of s.faces()) {
            const a = f.area
            const m = f.center().sub(ref).mul(a)
            total[0] += a
            total[1] += m.x
            total[2] += m.y
            total[3] += m.z
          }
        }
        return total
      })
    // (a face that cannot be measured: the kernel's regions are wrong)
    const measured = <T>(fn: () => T): T => {
      try {
        return fn()
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        throw wrong()
      }
    }
    const areas = measured(() => [...own, ...other].map((f) => measure([f])[0]))
    // The areas to 1e-7 of the operands' (the kernel's own are exact to about 1e-12 on lines and
    // 1e-10 on arcs), the first moments to that times the size.
    const tol = 1e-7 * areas.reduce((sum, a) => sum + a, 0) + 1e-12
    const common = new Map<string, [number, number, Sketch]>()
    own.forEach((f, i) => {
      other.forEach((g, j) => {
        if (!_disjoint(f._looseBox(), g._looseBox())) {
          const piece = f._boolean2dWith([g], k.BooleanOp2D.INTERSECTION, name, false)
          if (k.brep_face_count(piece._brep)) common.set(`${i},${j}`, [i, j, piece])
        }
      })
    })
    const pairs = [...common.values()]
    // (an overlap larger than one of its two faces is wrong)
    if (measured(() => pairs.some(([i, j, piece]) => measure([piece])[0] > Math.min(areas[i], areas[own.length + j]) + tol))) throw wrong()

    const minus = (a: number[], b: number[]): number[] => a.map((x, i) => x - b[i])
    const holds = (result: Sketch, want: number[]): boolean => {
      let got: number[]
      try {
        got = minus(measure([result]), want)
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        return false // a face of the result is broken: it does not hold
      }
      return Math.abs(got[0]) <= tol && Math.hypot(got[1], got[2], got[3]) <= tol * box.diagonal
    }
    const first = (ways: Array<() => Sketch>, want: number[]): Sketch => {
      for (const way of ways) {
        let result: Sketch
        try {
          result = way()
        } catch (e) {
          if (!_isRuntimeError(e)) throw e // a KernelError, ModelingError or a kernel call that failed
          continue
        }
        if (holds(result, want)) return result
      }
      throw wrong()
    }
    // Pieces that do not overlap, joined by unions so that they share their vertices as the
    // kernel's own regions do (pieces that merely lie side by side do not extrude).
    const assembled = (pieces: readonly Sketch[]): Sketch => {
      const kept = pieces.filter((p) => k.brep_face_count(p._brep))
      if (!kept.length) return this._empty()
      const joined = (): Sketch => {
        let result = kept[0]
        for (const p of kept.slice(1)) result = p._boolean2dWith([result], k.BooleanOp2D.UNION, name, false)
        return this._like(result._copyBrep())
      }
      try {
        return first([joined], measure(kept))
      } catch (e) {
        if (!(e instanceof ModelingError)) throw e
        return this._combined(kept)
      }
    }
    // f less the sketches `whole`, whose faces `faces` overlap it by `overlaps`
    const cut = (f: Sketch, whole: readonly Sketch[], faces: readonly Sketch[], overlaps: readonly Sketch[]): Sketch => {
      if (!faces.length) return f
      const oneByOne = (): Sketch => {
        let parts = [f]
        for (const g of faces) {
          parts = parts.flatMap((p) =>
            _disjoint(p._looseBox(), g._looseBox()) ? [p] : p._boolean2dWith([g], k.BooleanOp2D.DIFFERENCE, name, false)._faceSketches(),
          )
        }
        return f._combined(parts)
      }
      const tool = whole.length === 1 ? whole[0] : f._combined(whole)
      return first(
        [
          () => f._boolean2dWith(whole, k.BooleanOp2D.DIFFERENCE, name, false),
          oneByOne,
          () => f._slabOrEmpty(tool, k.BooleanOp2D.DIFFERENCE, name),
        ],
        minus(measure([f]), measure(overlaps)),
      )
    }
    const mine = (): Sketch[] =>
      own.map((f, i) => {
        const js = pairs.filter(([a]) => a === i).map(([, j]) => j)
        const whole = [...new Set(js.map((j) => owner[j]))].sort((a, b) => a - b).map((n) => tools[n])
        return cut(f, whole, js.map((j) => other[j]), js.map((j) => common.get(`${i},${j}`)![2]))
      })

    const run = (): Sketch => {
      if (op === k.BooleanOp2D.INTERSECTION) return assembled(pairs.map(([, , p]) => p))
      if (op === k.BooleanOp2D.DIFFERENCE) return assembled(mine())
      const operands = measure([this, ...tools])
      const whole = minus(operands, measure(pairs.map(([, , p]) => p)))
      if (op === k.BooleanOp2D.UNION) {
        const tool = tools.length === 1 ? tools[0] : this._combined(tools)
        return first(
          [
            () => this._boolean2dWith(tools, op, name, false),
            () => assembled([...mine(), ...other]),
            () => this._slabOrEmpty(tool, op, name),
          ],
          whole,
        )
      }
      // exclusive or: what is in one sketch only, from either side
      const theirs = other.map((g, j) => {
        const is = pairs.filter(([, b]) => b === j).map(([i]) => i)
        return cut(g, [this], is.map((i) => own[i]), is.map((i) => common.get(`${i},${j}`)![2]))
      })
      return first([() => assembled([...mine(), ...theirs])], minus(whole, measure(pairs.map(([, , p]) => p))))
    }
    return measured(run) // (a face that cannot be measured, or a kernel call outside the ways)
  }

  /** A cheap check of a union or exclusive or: its area is at least the larger operand's (minus
   * the overlap for xor). Skipped for large sketches, where areas are slow. */
  _boolean2dPlausible(tools: readonly Sketch[], result: Sketch, op: number): boolean {
    if (op !== k.BooleanOp2D.UNION) return true
    if (k.brep_edge_count(this._brep) + tools.reduce((n, t) => n + k.brep_edge_count(t._brep), 0) > 64) return true
    const a = this.area
    const b = tools.reduce((s, t) => s + t.area, 0)
    const r = result.area
    const tol = 1e-6 * Math.max(1, a, b)
    return Math.max(a, b) - tol <= r && r <= a + b + tol
  }

  _slabBoolean(other: Sketch, op: number, name: string): Sketch {
    const n = this._plane.zDir
    const thickness = Math.max(this._looseBox().union(other._looseBox()).diagonal * 0.05, 1e-3)
    const a = this.extrude(thickness, { direction: n })
    const b = other.extrude(thickness, { direction: n })
    // The slabs' Booleans run unchecked: pieces of the result may touch along an edge, which is
    // fine for the faces taken from it.
    let solid: Part
    if (op === k.BooleanOp2D.UNION) solid = a._like(a._runBoolean([b], k.BooleanOp.UNION, name))
    else if (op === k.BooleanOp2D.DIFFERENCE) solid = a._like(a._runBoolean([b], k.BooleanOp.DIFFERENCE, name))
    else solid = a._like(a._runBoolean([b], k.BooleanOp.INTERSECTION, name))
    const base = solid
      .faces()
      .filter(
        (f) =>
          f.isPlanar && Math.abs(this._plane.distanceTo(f.interiorPoint())) <= 1e-9 * Math.max(1, thickness) && f.normalAt().dot(n) < 0,
      )
    if (!base.length) throw new ModelingError(`${name}: the result is empty`)
    const b2 = kernelCall(name, () => ext.copy_faces(solid._brep, base.map((f) => f._f)))
    return this._like(b2)
  }

  /** The union with other sketches (Python's `+`). */
  override fuse(...others: unknown[]): Sketch {
    return this._boolean2d(others, k.BooleanOp2D.UNION, 'fuse')
  }

  /** The region less other sketches (Python's `-`). */
  cut(...others: unknown[]): Sketch {
    return this._boolean2d(others, k.BooleanOp2D.DIFFERENCE, 'cut')
  }

  /** The region common to this and other sketches (Python's `&`). */
  intersect(...others: unknown[]): Sketch {
    return this._boolean2d(others, k.BooleanOp2D.INTERSECTION, 'intersect')
  }

  /** The region in exactly one of the sketches (Python's `^`). */
  xor(...others: unknown[]): Sketch {
    return this._boolean2d(others, k.BooleanOp2D.EXCLUSIVE_OR, 'xor')
  }

  // -- measures -----------------------------------------------------------------------------
  /** Area centroid of the region. */
  override center(): Vector {
    if (!this.faces().length) throw new RangeError('the sketch is empty; it has no center')
    return super.center()
  }

  /** Total length of the boundary: outlines and holes. */
  get perimeter(): number {
    let s = 0
    for (const f of this.faces()) for (const w of f.wires()) for (const e of w.edges()) s += e.length
    return s
  }

  // -- 2D operations ------------------------------------------------------------------------
  /**
   * Grow (positive `distance`) or shrink (negative) the region; holes move the other way.
   *
   * `corners` shapes the corners that the offset pulls apart (convex ones when growing, concave
   * ones when shrinking): "round" (arcs of radius |distance|), "sharp" (the sides extended until
   * they meet) or "chamfer" (a straight cut across). Lines stay lines and arcs stay arcs. Parts
   * that grow into each other merge, parts that get too thin vanish; shrinking away the whole
   * region throws ModelingError. `round: false` is the older spelling of `corners: "sharp"`.
   */
  offset(distance: number, options: { corners?: string; round?: boolean | null } = {}): Sketch {
    _opts('Sketch.offset', options)
    let corners = options.corners ?? 'round'
    const round = options.round ?? null
    if (round !== null) corners = round ? 'round' : 'sharp'
    if (!CORNER_STYLES.includes(corners)) throw new RangeError(`offset: corners is 'round', 'sharp' or 'chamfer', not '${corners}'`)
    if (distance === 0) return this
    const result = offsetRegion(this, distance, corners)
    if (result !== null) return result
    if (corners === 'chamfer') {
      throw new ModelingError("offset: chamfered corners need outlines of lines and arcs; this sketch has a spline or an ellipse edge (use corners: 'round' or 'sharp')")
    }
    return this._kernelOffset(distance, corners === 'round')
  }

  /** The kernel's offset, for outlines with splines and ellipses. */
  _kernelOffset(distance: number, round: boolean): Sketch {
    let result: Sketch | null = null
    for (const f of this.faces()) {
      const loops = f.wires()
      // The outer loop moves outward to grow; holes move inward (they shrink).
      let region = this._offsetLoop(loops[0], Math.abs(distance), { grow: distance > 0, round })
      for (const w of loops.slice(1)) {
        const hole = this._offsetLoop(w, Math.abs(distance), { grow: distance < 0, round })
        if (hole !== null) region = region !== null ? region.cut(hole) : null
      }
      if (region !== null && region.faces().length) result = result === null ? region : result.fuse(region)
    }
    if (result === null) throw new ModelingError(`offset: shrinking by ${_formatG(Math.abs(distance))} removes the whole region; use a smaller distance`)
    return result
  }

  /** Region bounded by a loop moved `distance` outward (grow) or inward. */
  _offsetLoop(wire: Wire, distance: number, options: { grow: boolean; round: boolean }): Sketch | null {
    const { grow, round } = options
    const reference = Math.abs(_loopArea(wire))
    for (const side of [k.OffsetType.LEFT, k.OffsetType.RIGHT]) {
      let b: number
      try {
        b = kernelCall(
          'offset',
          () => k.create_offset_profile(wire._copyCurves(), distance, { offset_type: side, round_corners: round }),
          'the offset may collapse the region',
        )
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        if (!grow) continue
        throw e
      }
      const piece = Sketch._wrap(b, { plane: this._plane })
      if (piece.area > reference === grow) return piece
    }
    return null
  }

  /**
   * Round corners of the region with tangent arcs of `radius`.
   *
   * `vertices`: the corners to round, as vertices of this sketch (a selection such as
   * `s.vertices().concave()`) or points; null rounds every sharp corner. Corners between lines and
   * arcs are rounded exactly; a corner that does not fit, a point that is not a corner, or a
   * smooth corner throws ModelingError.
   */
  fillet(radius: number, vertices: Iterable<VectorLike | Vertex> | null = null): Sketch {
    if (!(radius > 0)) throw new RangeError('fillet: the radius must be positive')
    return roundCorners(this, Number(radius), vertices, 'fillet')
  }

  /** Bevel corners of the region: cut back `length` along both edges of each corner (measured
   * along the edge) and join the two points with a line. `vertices` as for `fillet`; null bevels
   * every sharp corner. */
  chamfer(length: number, vertices: Iterable<VectorLike | Vertex> | null = null): Sketch {
    if (!(length > 0)) throw new RangeError('chamfer: the length must be positive')
    return roundCorners(this, Number(length), vertices, 'chamfer')
  }

  /**
   * A mirrored copy: about an Axis in the sketch plane (`s.mirror(Y)`), or in a plane or planar
   * face (by default the XZ plane, which flips Y).
   *
   * Lines stay lines and arcs stay arcs. The sketch keeps facing the same way when the mirror is
   * an axis in its own plane, so the mirrored profile extrudes to the same side.
   */
  override mirror(plane: Plane | Face | Axis | ShapeList<Face> = Plane.XZ): this {
    return mirrorSketch(this, plane) as this
  }

  // -- to 3D --------------------------------------------------------------------------------
  /**
   * Extrude the region into a solid.
   *
   * With a taper (degrees; positive narrows the solid away from the sketch, holes widen) the walls
   * are drafted planes, cones and cylinders (as `Part.draft` makes them), B-spline surfaces where the
   * profile has other curves. `corners` shapes the corners the taper pulls apart (convex ones of an
   * outward taper, concave ones of an inward one): 'sharp' (the walls extended until they meet) or
   * 'round' (rounded off, as an offset rounds them).
   *
   * @param amount Distance along the sketch normal (negative goes the other way).
   */
  extrude(amount: number, options: ExtrudeOptions = {}): Part {
    _opts('Sketch.extrude', options)
    const { both = false, taper = 0, direction = null, corners = 'sharp' } = options
    if (amount === 0) throw new RangeError('extrude amount must not be zero')
    if (corners !== 'sharp' && corners !== 'round') throw new RangeError(`extrude: corners is 'sharp' or 'round', got ${_repr(corners)}`)
    this._requireRegion('extrude')
    const d = direction != null ? _direction(direction, 'extrude') : this._plane.zDir
    if (direction != null) this._checkDirection(d, Math.abs(Number(amount)) * (both ? 2 : 1), !taper)
    if (taper) {
      const out = this._extrudeTaper(amount, taper, both, corners === 'round')
      out.name = this.name
      out.color = this.color
      return out
    }
    let src: Sketch = this
    let dist = Number(amount)
    if (both) {
      src = this.translate(d.mul(-Math.abs(dist)))
      dist = 2 * Math.abs(dist)
    }
    const sign = dist > 0 ? 1 : -1
    let part = src._sweptAlong(d.mul(sign), Math.abs(dist))
    if (direction != null && Math.abs(d.dot(this._plane.zDir)) < 1 - 1e-12) part = src._oblique(part, d.mul(sign), Math.abs(dist))
    part.name = this.name
    part.color = this.color
    return part
  }

  _sweptAlong(d: Vector, dist: number): Part {
    const h = new BrepHandle(this._copyBrep())
    kernelCall('extrude', () => k.non_manifold_linear_sweep(h.brep, d.toArray(), dist))
    return Part._wrap(_take(h))
  }

  /** An extrusion along a direction across the normal, checked (`isValid`) and made again turned
   * about the normal where the kernel made it inside out or open. In planes that are not parallel to a
   * principal one the kernel breaks some such extrusions of profiles with curved edges: of 1200
   * (circles, rectangles, hexagons, ellipses and slots in random planes, both directions, one side and
   * both) 1 at 6 degrees off the plane, 25 at 0.6 and 0.06 degrees, 192 at 0.006 (the same before
   * 0.5.0). Turned about the normal through the sketch's origin, extruded and turned back, all but 16
   * at each of those angles come out valid with the exact volume; where none of three turns does,
   * `ModelingError`. */
  _oblique(part: Part, d: Vector, dist: number): Part {
    if (part.isValid()) return part
    const axis = new Axis(this._plane.origin, this._plane.zDir)
    for (const angle of [113, 180, 37]) {
      const again = this.rotate(axis, angle)._sweptAlong(d.rotate(axis.direction, angle), dist).rotate(axis, -angle)
      if (again.isValid()) return again
    }
    throw new ModelingError(
      'extrude: the kernel made this extrusion along the direction invalid (inside out or open); extrude along the sketch normal, or along a direction further from the sketch plane',
    )
  }

  /** Throw where an extrusion direction lies in the sketch plane, warn where it nearly does (where it
   * is `used`: a taper extrudes along the normal). The kernel refused a direction within a sine of
   * 1e-5 of the plane with a bare `KernelError` (SM_ERR), and made a valid sliver above that (5 along
   * a direction 1e-4 off the plane: 0.0005 thick). */
  _checkDirection(d: Vector, thickness: number, used: boolean): void {
    const n = this._plane.zDir
    const sine = Math.abs(d.dot(n))
    if (!(sine > IN_PLANE)) throw new RangeError(`extrude: the direction lies in the sketch plane; it must cross the plane (its normal is ${_fmtPoint(n)})`)
    if (used && sine < NEAR_PLANE) {
      _warn(
        `extrude: the direction is ${_formatG((Math.asin(sine) * 180) / Math.PI, 3)} degrees off the sketch plane, so the solid is only ${_formatG(thickness * sine, 3)} thick (amount is measured along the direction)`,
      )
    }
  }

  _extrudeTaper(amount: number, taper: number, both: boolean, roundCorners = false): Part {
    if (!(Math.abs(taper) < 90)) throw new RangeError('extrude: the taper must be between -90 and 90 degrees')
    let result = this._sweptTaper(amount, taper, roundCorners)
    if (!roundCorners && result.faces().some((f) => f.geomType === 'bspline')) {
      const drafted = this._draftedExtrusion(amount, taper)
      if (drafted !== null && Math.abs(drafted.volume - result.volume) <= 1e-7 * result.volume) result = drafted
    }
    if (both) result = result.fuse(this._extrudeTaper(-amount, taper, false, roundCorners))
    return result
  }

  /** The tapered extrusion as a straight one with its walls drafted (`Part.draft`): planes, cones and
   * cylinders. The kernel's draft sweep makes the walls at sharp corners flat B-spline surfaces
   * (inward tapers) or planes with B-spline slivers at the corners (outward ones), which selections by
   * type miss, draft refuses and STEP files carry as B-splines. Null where draft cannot make it (curves
   * other than lines and arcs, walls that run into each other). */
  _draftedExtrusion(amount: number, taper: number): Part | null {
    const n = this._plane.zDir.mul(amount > 0 ? 1 : -1)
    const straight = this.extrude(amount)
    const walls = straight.faces().filter((f) => !(f.geomType === 'plane' && Math.abs(f.normalAt().dot(n)) > 0.5))
    try {
      return straight.draft(walls, taper, new Plane(this._plane.origin, null, n))
    } catch (e) {
      if (!(e instanceof ModelingError)) throw e
      return null
    }
  }

  /** The tapered extrusion by the kernel's draft sweep (`k.draft_sweep`), each loop on its own. */
  _sweptTaper(amount: number, taper: number, roundCorners: boolean): Part {
    const hint = 'the taper may close the profile before the end'
    const parts: Part[] = []
    for (const f of this.faces()) {
      const loops = f.wires()
      const outer = kernelCall(
        'extrude',
        () => _freed(loops[0]._copyCurves(), (curves) => k.draft_sweep(curves, Number(amount), Number(taper), { fillet_corners: roundCorners })),
        hint,
      )
      let part = _requireSolid(Part._wrap(outer), 'extrude', hint)
      this._reaches(part, amount, taper)
      for (const w of loops.slice(1)) {
        // A hole runs the other way round than the outline; the kernel sweeps a loop along the
        // side its orientation gives, so turn it like the outline. The hole widens where the
        // outline narrows.
        const hole = Part._wrap(
          kernelCall(
            'extrude',
            () => _freed(w.reversed()._copyCurves(), (curves) => k.draft_sweep(curves, Number(amount), -Number(taper), { fillet_corners: roundCorners })),
            hint,
          ),
        )
        part = part.cut(_requireSolid(hole, 'extrude', hint))
      }
      // (a hole that widens across the region before the end: a ring tapered by 10 degrees came out
      // 5.67 high where 10 were asked for)
      if (loops.length > 1) this._reaches(part, amount, taper)
      parts.push(part)
    }
    let result = parts[0]
    for (const p of parts.slice(1)) result = result.fuse(p)
    return result
  }

  /** Throws if a tapered extrusion does not reach `amount` from the sketch plane. */
  _reaches(part: Part, amount: number, taper: number): void {
    const n = this._plane.zDir.mul(amount > 0 ? 1 : -1)
    const o = this._plane.origin
    const reach = Math.max(...part.vertices().map((v) => v.point.sub(o).dot(n)))
    if (reach < Math.abs(amount) - 1e-6 * Math.max(1, Math.abs(amount))) {
      throw new ModelingError(
        `extrude: the taper of ${_formatG(taper)} degrees closes the profile after ${_formatG(reach)} of ${_formatG(Math.abs(amount))}; use a smaller taper or a shorter extrusion`,
      )
    }
  }

  /**
   * Revolve the region about an axis in its plane.
   *
   * The default axis is the sketch's local Y axis through its plane origin. For the centered
   * constructors (`Rectangle`, `Circle`, ...) and for `makeFace` that origin is the middle of the
   * region, so pass `axis` unless the sketch was drawn beside its origin
   * (`Polygon([10, 0], [20, 0], ...)`). A negative `angle` turns the other way. The axis must not
   * cross the region (ModelingError).
   */
  revolve(axis: Axis | null = null, angle = 360): Part {
    this._requireRegion('revolve')
    let ax = axis ?? new Axis(this._plane.origin, this._plane.yDir)
    ;[ax, angle] = _revolveAxisAngle(ax, angle)
    const n = this._plane.zDir
    if (!ax.direction.isPerpendicular(n)) throw new RangeError('revolve: the axis must lie in the sketch plane (it is not parallel to it)')
    this._checkAxisBeside(ax, axis === null)
    const o = ax.origin.toArray()
    const d = ax.direction.toArray()
    const hint =
      'the axis must not cross the region' +
      (axis === null ? ` (the default axis is the sketch's Y axis through ${_fmtPoint(ax.origin)}; pass an axis)` : '')
    const result = kernelCall(
      'revolve',
      () => {
        let out: Part | null = null
        for (const f of this.faces()) {
          const loops = f.wires()
          const revolved = (w: Wire) => _freed(w._copyCurves(), (curves) => k.rotational_sweep(curves, o, d, Number(angle), { cap_ends: true }))
          let piece = _analyticRevolve<Part>(revolved(loops[0]), Part)
          for (const w of loops.slice(1)) piece = piece.cut(_analyticRevolve<Part>(revolved(w), Part))
          out = out === null ? piece : out.fuse(piece)
        }
        return out
      },
      hint,
    )
    if (result === null) throw new RangeError('empty sketch')
    _requireSolid(result, 'revolve', hint)
    result.name = this.name
    result.color = this.color
    return result
  }

  _requireRegion(what: string): void {
    if (!k.brep_face_count(this._brep)) {
      throw new ModelingError(`${what}: the sketch is empty (0 faces); the Boolean or offset that made it removed everything`)
    }
  }

  /** Throw if the axis runs through the region (the kernel then returns a body without volume, or
   * an inside-out one, for a full turn). */
  _checkAxisBeside(ax: Axis, isDefault: boolean): void {
    const n = this._plane.zDir
    const side = ax.direction.cross(n) // in the plane, across the axis
    const o = ax.origin
    let lo = Infinity
    let hi = -Infinity
    for (const f of this.faces()) {
      for (const e of f.outerWire().edges()) {
        const count = e.geomType === 'line' ? 1 : 32
        for (let i = 0; i <= count; i++) {
          const v = e.pointAt(i / count).sub(o).dot(side)
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
    }
    const tol = 1e-7 * Math.max(1, this.bbox().diagonal)
    if (lo < -tol && hi > tol) {
      const where = isDefault
        ? `; the default axis is the sketch's local Y axis through its plane origin ${_fmtPoint(o)}, pass an axis (for example new Axis([0, 0, 0], [0, 1, 0]))`
        : ''
      throw new ModelingError(`revolve: the axis crosses the region${where}`)
    }
  }

  /** Sweep the region along a path (see `sweep`: the center of the region's box goes to the start of
   * the path; `up` and `twist` set its attitude along it, `scale` its size). */
  sweep(
    path: Edge | Wire,
    options: {
      sharpCorners?: boolean | null
      up?: Axis | VectorLike | string | null
      twist?: number | ((s: number) => number)
      scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null
    } = {},
  ): Part {
    _opts('Sketch.sweep', options)
    return _sweep(this, path, { sharpCorners: options.sharpCorners ?? null, up: options.up ?? null, twist: options.twist ?? 0, scale: options.scale ?? null }) as Part
  }

  /** Swing the region around an outline: a revolve about Z whose circle is the outline (see `swing`:
   * the region drawn as for a lathe in the XZ plane, the outline a closed curve around the Z axis
   * parallel to XY, scaled at each height to pass through the region's outline on the +X side). */
  swing(outline: Sketch | Face | Wire | Edge): Part {
    return _swing(this, outline) as Part
  }

  override toString(): string {
    return `Sketch(${k.brep_face_count(this._brep)} faces, area=${_formatG(this.area)})`
  }
}
