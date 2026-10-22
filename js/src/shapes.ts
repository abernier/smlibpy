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
  ClosestPoints,
  Continuity,
  Curvature,
  Hit,
  Nurbs,
  NurbsSurface,
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
  _matmul,
  _radians,
  _vec,
  type Matrix,
  type VectorLike,
} from './geometry.ts'
import { det3, eigh3, mean3, spread } from './_linalg.ts'
import { toRgb } from './colors.ts'
import { EllipticalArc, Line, ThreePointArc, _arcCurve, _basisDers, _filletWire, _span } from './curves.ts'
import { _rayTriangles, faceMeshes, tessellate, type Mesh } from './mesh.ts'
import { show } from './viewer.ts'
import { exportFile } from './exporters.ts'
import { CORNER_STYLES, cornerKind, mirrorSketch, offsetRegion, offsetWire, rebuiltBrep, roundCorners } from './_regions.ts'
import { visiblePieces, wrap as _wrap } from './_face_curves.ts'
import { type _Job, _isolated, _smb, filletFaces, removeFaces as _removeFaces, removeFillets as _removeFillets } from './defeature.ts'
import {
  type BendOptions,
  type TaperOptions,
  type TwistOptions,
  type UnrollOptions,
  bend as _bend,
  taper as _taper,
  twist as _twist,
  unroll as _unroll,
} from './deform.ts'
import { type DraftAnalysis, _range, draftAnalysis as _draftAnalysis, draftFaces, partingLine as _partingLine } from './draft.ts'
import { _wallThicknesses, moveFaces as _moveFaces, offsetFaces as _offsetFaces, shellWalls } from './face_edit.ts'
import { sweep as _sweep, swing as _swing } from './operations.ts'
import { Box } from './parts.ts'
import { ruled } from './surfaces.ts'
import { _checked, _flatten, _push, _warp } from './shaping.ts'
import { _matchEdge, _mergeFaces } from './sheet_edit.ts'
import { Polygon, Rectangle } from './sketches.ts'
import {
  type Bend,
  type FlangeOptions,
  type FlatPattern,
  type FoldOptions,
  type KFactor,
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

// A sharp offset may reach this many times farther than its first-order reach (see
// Part._sharpOffsetReach) before it is refused: curved faces extended past an edge bend away from
// their tangent planes (two spherical caps offset by 1 reached 0.98 of it). The reach counts up to
// _SHARP_OFFSET_REACH (an edge of 4.6 degrees): beyond that, and at faces that meet back to back, a
// sharp offset is refused where it reaches farther (corners: "round" builds such parts).
const _SHARP_OFFSET_SLACK = 1.25
const _SHARP_OFFSET_REACH = 25.0

// Shapes that only smlibwasm makes (edges, bodies) take this as their constructor's argument.
const INTERNAL = Symbol('smlibwasm.internal')

// Bodies by number (`_Body._key`, counted by `_bodyCount`), and how many bodies hold each Brep that
// `named()` or `colored()` shares (kernel plan T8); a body that let go of a shared Brep holds
// `_DISPOSED`.
let _bodyCount = 0
const _SHARES = new WeakMap<BrepHandle, number>()
const _DISPOSED: BrepHandle = Object.assign(Object.create(BrepHandle.prototype), { _p: 0, id: 0 })

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

  /** The edges of the list and the edges that continue them tangentially (see
   * `Edge.tangentChain`): what `fillet` and `chamfer` round for this selection. Other shapes are
   * left out. */
  tangentChain(): ShapeList<Edge> {
    return _list(_tangentChains([...this].filter((s): s is Edge & T => s instanceof Edge))[0])
  }

  /** Edges whose two faces meet at least tangentially all along them ("G1" or "G2" by
   * `Edge.continuity`): the borders of fillets and blends. */
  g1(): ShapeList<T> {
    return this.filter((s) => {
      const level = _levelOf(s)
      return level === 'G1' || level === 'G2'
    })
  }

  /** Edges whose two faces meet with equal curvature as well ("G2" by `Edge.continuity`): the
   * borders of curvature-continuous blends (`fillet(..., { continuity: 'G2' })`), seams of smooth
   * surfaces. */
  g2(): ShapeList<T> {
    return this.filter((s) => _levelOf(s) === 'G2')
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

  // -- history ------------------------------------------------------------------------------
  /**
   * The faces or edges that are new since the given bodies: made by the operations that led from
   * them to this list's body, descending from no face or edge of theirs (Python's `new`).
   *
   * `since` is a body (part, shell, sketch) or a list of them, or faces and edges (then only those
   * count as old). After a Boolean, the curves along which the bodies' faces cross
   * (`plate.fuse(boss).edges().newSince([plate, boss])`: the circle where a boss reaching into the
   * plate meets its top; where an edge of one body lies on the other, such as the bottom edge of a
   * boss standing on the plate, that edge is not new: `joining` finds both); after a fillet,
   * chamfer or shell, its new faces (`rounded.faces().newSince(part)`) and their edges.
   *
   * smlibwasm marks every face and edge of every body it makes, and the kernel carries the marks
   * along: a copy keeps them, both halves of a split face keep their parent's, a face merged from
   * two keeps both. A moved, turned, mirrored or scaled copy gets new marks (it is a shape of its
   * own). A body read from a file, and a section, have new marks everywhere, so all of them counts
   * as new.
   */
  newSince(since: unknown): ShapeList<T> {
    const old = _historyTags(since, 'newSince')
    const tags = _itemTags(this, 'newSince')
    return this.filter((_, i) => ![...tags[i]].some((t) => old.has(t)))
  }

  /**
   * The faces or edges that descend from the given shapes: faces from faces, edges from edges,
   * both from a body (part, shell, sketch). A face that an operation split, trimmed, moved along
   * with the part or merged with another descends from it; one the operation made anew does not.
   *
   * `plate.cut(holes).faces().derivedFrom(holes)` gives the walls of the holes;
   * `cut.edges().derivedFrom(box.edges().top())` the pieces of the top edges of a box that a slot
   * cut. A body's faces and edges are marked as described in `newSince`.
   */
  derivedFrom(...shapes: unknown[]): ShapeList<T> {
    const wanted = _historyTags(shapes, 'derivedFrom')
    const tags = _itemTags(this, 'derivedFrom')
    return this.filter((_, i) => [...tags[i]].some((t) => wanted.has(t)))
  }

  /**
   * The edges that lie on the surfaces of both `a` and `b`: where two bodies that a Boolean combined
   * meet, the edges to round or chamfer after it. `plate.fuse(boss).edges().joining(plate, boss)`
   * gives the circle where the boss stands on the plate, also where the boss's bottom face lay on the
   * plate's top (which `newSince` does not count as new: the circle is the boss's bottom edge),
   * `block.cut(hole).edges().joining(block, hole)` the rims of the hole. `a` and `b` are bodies
   * (parts, shells, sketches) or lists of them (an edge on any of them counts).
   *
   * Each edge is tested at a quarter, half and three quarters of the way along it: there it lies on
   * a face of a body (within the edge's tolerance, at least 1e-6 of the bodies' size) where
   * `Part.classify` puts it on the body's surface. Edges of a merged face (a face of each body lying
   * in one plane, merged by a union) are not on both surfaces and are not taken.
   */
  joining(a: unknown, b: unknown): ShapeList<T> {
    const firsts = _joinedBodies(a)
    const seconds = _joinedBodies(b)
    const odd = this.find((s) => !(s instanceof Edge))
    if (odd !== undefined) throw new TypeError(`joining selects edges, not a ${_typeName(odd)}`)
    const size = Math.max(firsts[0]._looseBox().union(seconds[seconds.length - 1]._looseBox()).diagonal, 1.0)
    return this.filter((s) => {
      const e = s as unknown as Edge
      const tol = Math.max(e._e != null ? e.tolerance : 0.0, 1e-6 * size)
      const box = e.bbox()
      if (!firsts.some((x) => !_disjoint(box, x._looseBox(), tol)) || !seconds.some((x) => !_disjoint(box, x._looseBox(), tol))) return false
      const points = [0.25, 0.5, 0.75].map((t) => e.pointAt(t))
      return _onAny(firsts, points, tol) && _onAny(seconds, points, tol)
    })
  }

  /** The faces that lie between two cells of a merged part (see `Part.merge`): where two materials
   * meet, the faces a simulation mesh must match across or a contact condition goes on.
   * `merge(block, insert).faces().shared()`; `Face.cells` says which two cells. */
  shared(): ShapeList<T> {
    const odd = this.find((s) => !(s instanceof Face))
    if (odd !== undefined) throw new TypeError(`shared selects faces, not a ${_typeName(odd)}`)
    return this.filter((s) => (s as unknown as Face).cells.length > 1)
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
 * kernel call for the edges of each body. An edge whose faces meet tangentially at its middle is
 * smooth only if they do at 5 points along it; else it takes the kind where they turn most (a
 * crease that a fillet runs out into, a blend that is tangent only in places). */
function _convexities(items: readonly unknown[]): (string | null)[] {
  const edges = items.filter((s): s is Edge => s instanceof Edge)
  const angles = new Map<Edge, number | null>()
  _outerAngles(edges).forEach((a, i) => angles.set(edges[i], a))
  const tangent = edges.filter((e) => {
    const a = angles.get(e) ?? null
    return a !== null && _angleKind(a) === 'smooth'
  })
  _outerAnglesAlong(tangent, 5).forEach((along, i) => {
    if (!along.length) return
    let worst = along[0]
    for (const a of along) if (Math.abs(a - 180) > Math.abs(worst - 180)) worst = a
    if (_angleKind(worst) !== 'smooth') angles.set(tangent[i], worst)
  })
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

/** The kernel's outer angles of each edge at `samples` points along it (`ext.edge_outer_angles`),
 * one call per body; [] where the kernel cannot tell. */
function _outerAnglesAlong(edges: readonly Edge[], samples: number): number[][] {
  const out: number[][] = edges.map(() => [])
  const bodies = new Map<_Body, number[]>()
  edges.forEach((e, i) => {
    if (e._e && e._owner !== null) {
      const idx = bodies.get(e._owner)
      if (idx) idx.push(i)
      else bodies.set(e._owner, [i])
    }
  })
  for (const [owner, idx] of bodies) {
    const angles: number[][] = ext.edge_outer_angles(owner._brep, idx.map((i) => edges[i]._e), samples)
    idx.forEach((i, j) => {
      out[i] = [...angles[j]]
    })
  }
  return out
}

/** The continuity level from the largest gap, angle and curvature jump between two sides. */
function _continuityLevel(gap: number, gapTol: number, angle: number, angleTol: number, jump: number, curvature: number,
  curvatureTol: number, length: number): string | null {
  if (!(gap <= gapTol)) return null
  if (!(angle <= angleTol)) return 'G0'
  if (!(jump <= curvatureTol * curvature + 1e-3 / Math.max(length, 1e-9))) return 'G1' // (NaN: no curvature to compare)
  return 'G2'
}

/** The continuity level of an edge between two faces, null for anything else (and where the faces
 * cannot be evaluated at the edge). */
function _levelOf(s: unknown): string | null {
  if (!(s instanceof Edge) || !s._ke) return null
  try {
    return s.continuity().level
  } catch (e) {
    if (e instanceof RangeError || e instanceof KernelError) return null
    throw e
  }
}

/** The convexity of an edge with this outer angle (degrees): smooth within half a degree of 180,
 * as the faces' normals are within half a degree. */
function _angleKind(outer: number): string {
  return Math.abs(outer - 180) < 0.5 ? 'smooth' : outer > 180 ? 'convex' : 'concave'
}

/** The shapes, each once (by `_identity()`). */
/** A body's shells (`ext.brep_shells`) and the cells each face bounds (as `Part.cells` counts them),
 * read once (kernel plan T7). */
function _shellsOf(body: _Body): [Any[], number[][]] {
  const h = body._h
  if (h.shells === null) {
    const shells: Any[] = ext.brep_shells(h.brep)
    const cells: Set<number>[] = Array.from({ length: k.brep_face_count(h.brep) }, () => new Set<number>())
    for (const s of shells) if (s.kind === 'cell') for (const f of s.faces) cells[f].add(s.cell)
    h.shells = [shells, cells.map((c) => [...c].sort((a, b) => a - b))]
  }
  return h.shells as [Any[], number[][]]
}

/** Per face of a body, the cells it bounds (`Face.cells`). */
function _faceCells(body: _Body): number[][] {
  return _shellsOf(body)[1]
}

/** Colors and names (`ext.face_attrs` of the same body, read back from a file, or from a STEP
 * file's faces) on the faces of a Brep in its order; nothing where the counts differ. */
export function _putFaceAttrs(brep: number, colors: readonly Any[], names: readonly Any[]): void {
  const faces: number[] = k.brep_faces(brep)
  if (faces.length !== colors.length || faces.length !== names.length) return
  let pick = colors.flatMap((c, i) => (c != null && c.length === 3 ? [i] : []))
  if (pick.length) ext.set_face_colors(brep, pick.map((i) => faces[i]), pick.map((i) => Array.from(colors[i] as ArrayLike<number>, Number)))
  pick = names.flatMap((n, i) => (n ? [i] : []))
  if (pick.length) ext.set_face_names(brep, pick.map((i) => faces[i]), pick.map((i) => String(names[i])))
}

/** What a kernel step in a probe worker carries of a body besides its `.smb` copy: the tags of its
 * faces and edges and its faces' colors and names (`.smb` files hold none). */
function _carried(brep: number): Any[] {
  return [...ext.topology_tags(brep), ext.face_attrs(brep)]
}

/** The tags of a body's faces and edges, in its order (`ext.topology_tags`, read once). */
function _topologyTags(body: _Body): [number[][], number[][]] {
  const h = body._h
  if (h.tags === null) h.tags = ext.topology_tags(h.brep)
  return h.tags as [number[][], number[][]]
}

/** The tags of each face or edge of bodies (none for an edge of no body). */
function _itemTags(items: readonly unknown[], what: string): Set<number>[] {
  const out: Set<number>[] = items.map(() => new Set<number>())
  const groups = new Map<BrepHandle, [_Body, number[], number[]]>()
  items.forEach((s, i) => {
    if (!(s instanceof Face || s instanceof Edge)) throw new TypeError(`${what} selects faces and edges, not a ${_typeName(s)}`)
    const owner = s._owner
    if (!(owner instanceof _Body) || (s instanceof Edge && !s._e)) return
    let g = groups.get(owner._h)
    if (!g) groups.set(owner._h, (g = [owner, [], []]))
    ;(s instanceof Face ? g[1] : g[2]).push(i)
  })
  for (const [owner, faces, edges] of groups.values()) {
    const [ft, et] = _topologyTags(owner)
    if (faces.length) {
      const idx = ext.face_indices(owner._brep, faces.map((i) => (items[i] as Face)._f)) as number[]
      faces.forEach((i, n) => (out[i] = new Set(idx[n] >= 0 ? ft[idx[n]] : [])))
    }
    if (edges.length) {
      const idx = ext.edge_indices(owner._brep, edges.map((i) => (items[i] as Edge)._e)) as number[]
      edges.forEach((i, n) => (out[i] = new Set(idx[n] >= 0 ? et[idx[n]] : [])))
    }
  }
  return out
}

/** The tags of bodies (of all their faces and edges), faces and edges, also in lists. */
/** The bodies of an argument of `ShapeList.joining`: a body or a list of them. */
function _joinedBodies(x: unknown): _Body[] {
  if (x instanceof _Body) return [x]
  if (x != null && typeof x === 'object' && Symbol.iterator in x && !(x instanceof Shape)) {
    const out = [...(x as Iterable<unknown>)]
    if (out.length && out.every((y) => y instanceof _Body)) return out as _Body[]
  }
  throw new TypeError(`joining takes bodies (parts, shells, sketches) or lists of them, not a ${_typeName(x)}`)
}

/** Whether every point lies on the surface of one of the bodies, within `tol`. */
function _onAny(bodies: readonly _Body[], points: readonly Vector[], tol: number): boolean {
  let left = [...points]
  for (const x of bodies) {
    if (!left.length) break
    const on = x instanceof Part ? x._classify(left, tol).map(([where]) => where === 'face' || where === 'edge' || where === 'vertex') : left.map((p) => x.distanceTo(p) <= tol)
    left = left.filter((_, i) => !on[i])
  }
  return !left.length
}

function _historyTags(shapes: unknown, what: string): Set<number> {
  const out = new Set<number>()
  const items: unknown[] = []
  const walk = (x: unknown): void => {
    if (x instanceof _Body) {
      const [ft, et] = _topologyTags(x)
      for (const t of [...ft, ...et]) for (const tag of t) out.add(tag)
    } else if (x instanceof Face || x instanceof Edge) {
      items.push(x)
    } else if (x instanceof Wire) {
      items.push(...x.edges())
    } else if (typeof x !== 'string' && !(x instanceof Shape) && _isIterable(x)) {
      for (const y of x as Iterable<unknown>) walk(y)
    } else {
      throw new TypeError(`${what} takes bodies, faces and edges (or lists of them), not a ${_typeName(x)}`)
    }
  }
  walk(shapes)
  for (const t of _itemTags(items, what)) for (const tag of t) out.add(tag)
  return out
}

/** Per face (`faces`) or edge of another body, the kernel faces or edges of `body` that descend
 * from it (carry one of its tags); seam edges are left out. */
function _descendants(body: _Body, items: readonly unknown[], faces: boolean): number[][] {
  const tags = _itemTags(items, 'select')
  const [ft, et] = _topologyTags(body)
  const own = (faces ? k.brep_faces(body._brep) : k.brep_edges(body._brep)) as number[]
  const seams = faces ? new Set<number>() : new Set<number>(ext.seam_edges(body._brep) as number[])
  const holders = new Map<number, number[]>() // tag -> the faces or edges of the body that carry it
  ;(faces ? ft : et).forEach((mine, j) => {
    if (seams.has(j)) return
    for (const tag of mine) {
      let list = holders.get(tag)
      if (!list) holders.set(tag, (list = []))
      list.push(j)
    }
  })
  return tags.map((t) => {
    const found = new Set<number>()
    for (const tag of t) for (const j of holders.get(tag) ?? []) found.add(j)
    return [...found].sort((a, b) => a - b).map((j) => own[j])
  })
}

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

  /** How far the edges and faces that meet at this vertex may pass from its point: the kernel's
   * tolerance of the vertex (1e-5 on most parts; larger where the surfaces of an imported, stitched
   * or healed body meet less exactly). RangeError for a vertex of no body (`new Vertex(x, y, z)`). */
  get tolerance(): number {
    if (!this._v) throw new RangeError('tolerance: a vertex of no body has no tolerance')
    return Number(ext.vertex_tolerance(this._v))
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

  /** How far this edge's curve, its ends and the faces it bounds may lie apart: the kernel's
   * tolerance of the edge (1e-5 on most parts; larger where the surfaces of an imported, stitched
   * or healed body meet less exactly). RangeError for an edge of no body (a curve made with `Line`,
   * `Spline`, ...). */
  get tolerance(): number {
    if (!this._e) throw new RangeError('tolerance: an edge of no body has no tolerance')
    return Number(ext.edge_tolerance(this._e))
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
   * corner, "smooth" where the faces meet tangentially (within half a degree) all along the edge.
   * Taken at the middle of the edge; an edge that is tangent there but not at points along it
   * takes the kind where its faces turn most. Edges with a single face count as convex. */
  get convexity(): string {
    return _convexities([this])[0] as string
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
    return this._probedConvexity(0.5, 1) === 'concave' ? 180 + turn : 180 - turn
  }

  /** The convexity from the faces' normals and a step into face 1, for edges the kernel's outer
   * angle does not cover (an edge of a sheet, an inner edge of a merged part): at the middle, and
   * where the faces meet tangentially there, at the point along the edge (of `samples`) where their
   * normals differ most. On edges that lie off their faces by more than the step (imported bodies)
   * the step can read noise. */
  _probedConvexity(at = 0.5, samples = 5): string {
    if (!this._e) return 'convex'
    const fs: number[] = k.edge_faces(this._e)
    if (fs.length !== 2) return 'convex'
    const f1 = new Face(this._owner, fs[0])
    const f2 = new Face(this._owner, fs[1])
    const p = this.pointAt(at)
    const n1 = f1.normalAt(p)
    const n2 = f2.normalAt(p)
    if (n1.angleTo(n2) < 0.5) {
      if (samples <= 1) return 'smooth'
      let turn = -1
      let where = at
      for (let i = 0; i < samples; i++) {
        const t = (i + 0.5) / samples
        const q = this.pointAt(t)
        const a = f1.normalAt(q).angleTo(f2.normalAt(q))
        if (a > turn || (a === turn && t > where)) turn = a, where = t
      }
      return turn < 0.5 ? 'smooth' : this._probedConvexity(where, 1)
    }
    const t = this.tangentAt(at)
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
    // exact: the ends, the corners and where the tangent is perpendicular to an axis
    const [t0, t1] = this._range()
    const [lo, hi] = kernelCall('bbox', () => ext.curve_box(this._curve(), t0, t1))
    return new BoundBox(lo, hi)
  }

  /** Distance to a point, or to a body (see `Part.distanceTo`). */
  override distanceTo(point: VectorLike | Shape): number {
    if (point instanceof _Body) return point.distanceTo(this)
    const p = point instanceof Vertex ? point.point : _vec(point as VectorLike)
    if (this._e) return Number(k.edge_closest_point(this._e, p.toArray())[2])
    return Number(k.curve_closest_point(this._curve(), p.toArray())[2])
  }

  /**
   * Where on the edge the point nearest to `point` lies, as a fraction of the edge's length from
   * its start (0) to its end (1): `edge.pointAt(edge.paramAtPoint(p))` is `edge.closestPoint(p)`
   * (the same as `paramAt`, build123d's name).
   */
  paramAtPoint(point: VectorLike | Vertex): number {
    return this.paramAt(point)
  }

  /**
   * How the two faces of the edge meet, checked at `samples` points along it (`Continuity`): "G2"
   * where their curvatures across the edge agree as well, "G1" where they meet tangentially (a
   * circular fillet's border), "G0" at a crease, `null` where they leave a gap wider than the edge's
   * tolerance.
   *
   * `angleTol` is the largest angle (degrees) between the faces' normals for G1; `curvatureTol` the
   * largest difference of their curvatures across the edge for G2, relative to the larger of them
   * (and at least `1e-3 / length`, so that nearly flat faces count as G2). RangeError for an edge
   * that does not lie between two faces.
   */
  continuity(samples = 16, options: { angleTol?: number; curvatureTol?: number } = {}): Continuity {
    _opts('Edge.continuity', options)
    const { angleTol = 0.5, curvatureTol = 0.01 } = options
    if (!this._e) throw new RangeError('continuity: the edge does not lie between two faces (it is a free curve)')
    if (!(Math.trunc(samples) >= 1)) throw new RangeError('continuity: samples must be at least 1')
    const r = kernelCall('continuity', () => ext.edge_continuity(this._e, Math.trunc(samples)))
    const level = _continuityLevel(r.gap, Math.max(Number(r.tolerance), 1e-7), r.angle, angleTol, r.jump, r.curvature,
      curvatureTol, r.length)
    const at = level === null ? r.gap_at : level === 'G0' ? r.angle_at : r.jump_at
    return new Continuity(level, Number(r.gap), Number(r.angle), Number(r.jump), new Vector(at))
  }


  /** The point of the edge nearest to `point`. */
  closestPoint(point: VectorLike | Vertex): Vector {
    return this._closest(point)[0]
  }

  /** Where the point of the edge nearest to `point` lies along it: the fraction of the length from
   * the start, as `pointAt` takes it (`e.pointAt(e.paramAt(p))` is `e.closestPoint(p)`). */
  paramAt(point: VectorLike | Vertex): number {
    return this._fraction(this._closest(point)[1])
  }

  /** The nearest point of the edge, its kernel parameter and its distance. */
  _closest(point: VectorLike | Vertex): [Vector, number, number] {
    const p = point instanceof Vertex ? point.point : _vec(point)
    const [q, u, d] = this._e ? k.edge_closest_point(this._e, p.toArray()) : k.curve_closest_point(this._curve(), p.toArray())
    const [t0, t1] = this._range()
    return [new Vector(q), Math.min(Math.max(Number(u), t0), t1), Number(d)]
  }

  /** The fraction of the length (in edge direction) at kernel parameter `u`. */
  _fraction(u: number): number {
    const [t0, t1] = this._range()
    u = Math.min(Math.max(u, t0), t1)
    let f: number
    if (u <= t0 || t1 <= t0) f = 0
    else if (u >= t1) f = 1
    else if (this.geomType === 'line') f = (u - t0) / (t1 - t0)
    else {
      const total = Number(ext.curve_length(this._curve(), t0, t1))
      f = total > 0 ? Number(ext.curve_length(this._curve(), t0, u)) / total : 0
    }
    f = Math.min(Math.max(f, 0), 1)
    return this._rev ? 1 - f : f
  }

  /** The kernel parameter of `at`: a fraction of the length or a point on the edge. */
  _at(at: number | VectorLike | Vertex, what: string): number {
    if (typeof at === 'number') {
      if (!(at >= 0 && at <= 1)) throw new RangeError(`${what}: a fraction of the edge runs from 0 to 1, got ${_formatG(at)}`)
      return this._param(at)
    }
    const p = at instanceof Vertex ? at.point : _vec(at)
    const [q, u, d] = this._closest(p)
    const tol = 1e-6 * Math.max(1, this.length)
    if (d > tol) {
      throw new RangeError(`${what}: the point ${_fmtPoint(p)} lies ${_formatG(d)} off the edge (the nearest point of the edge is ` +
        `${_fmtPoint(q)}); pass a point on the edge or a fraction from 0 to 1`)
    }
    return u
  }

  /** The edge between kernel parameters lo < hi, in edge direction (a new curve). */
  _piece(lo: number, hi: number, what: string): Edge {
    const c = kernelCall(what, () => ext.trimmed_curve(this._curve(), lo, hi))
    if (this._rev) ext.reverse_curve(c)
    return Edge._fromCurve(c)
  }

  /**
   * The part of the edge from `start` to `end`, each a fraction of the length (as in `pointAt`) or a
   * point on the edge. The part keeps the curve: a trimmed arc is an arc, a trimmed spline the same
   * spline. `start` must come before `end` along the edge.
   *
   *     const arc = CenterArc([0, 0], 10, 0, 180).trim(0.25, 0.75)   // the arc from 45 to 135 degrees
   */
  trim(start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Edge {
    const u0 = this._at(start, 'trim')
    const u1 = this._at(end, 'trim')
    const [lo, hi] = this._rev ? [u1, u0] : [u0, u1]
    const [t0, t1] = this._range()
    if (!(hi - lo > 1e-12 * Math.max(1, Math.abs(t1 - t0)))) {
      throw new RangeError('trim: the start must come before the end along the edge (fractions from 0 at its start to 1 at its end)')
    }
    return this._piece(lo, hi, 'trim')
  }

  /**
   * The edge cut in two at `at`, a fraction of the length or a point on the edge: the part before and
   * the part after, each keeping the curve.
   *
   *     const [a, b] = Line([0, 0], [10, 0]).split(0.3)   // 3 and 7 long
   */
  split(at: number | VectorLike | Vertex): [Edge, Edge] {
    const u = this._at(at, 'split')
    const [t0, t1] = this._range()
    const length = this.length
    const before = u > t0 ? Number(ext.curve_length(this._curve(), t0, u)) : 0
    if (Math.min(before, length - before) <= 1e-9 * Math.max(1, length)) {
      throw new RangeError('split: the point is an end of the edge; there is nothing to split')
    }
    const a = this._piece(t0, u, 'split')
    const b = this._piece(u, t1, 'split')
    return this._rev ? [b, a] : [a, b]
  }

  /**
   * The edge made longer by `distance` at its `end` ('end', 'start' or 'both'), for cut tools and
   * paths that must run past a body.
   *
   * Lines and arcs (circles and ellipses) go on as themselves. Other curves are continued as
   * `continuity` says: 'G1' straight along the end tangent, 'G2' with the curvature at the end,
   * 'natural' as the curve's own polynomial goes on. The added length is `distance` in every case.
   *
   *     const groovePath = Spline([0, 0], [20, 8], [40, 0]).extend(5, { end: 'both' })
   */
  extend(distance: number, options: { end?: string; continuity?: string } = {}): Edge {
    _opts('Edge.extend', options)
    const { end = 'end', continuity = 'G1' } = options
    if (!(typeof distance === 'number' && Number.isFinite(distance) && distance > 0)) {
      throw new RangeError(`extend: the distance must be positive, got ${String(distance)} (use trim to shorten an edge)`)
    }
    if (!['start', 'end', 'both'].includes(end)) throw new RangeError(`extend: end must be 'start', 'end' or 'both', got '${end}'`)
    const modes: Record<string, number> = { G1: 1, G2: 2, natural: 0 }
    if (!(continuity in modes)) throw new RangeError(`extend: continuity must be 'G1', 'G2' or 'natural', got '${continuity}'`)
    if (this.isClosed) throw new RangeError('extend: a closed edge has no ends to extend')
    let e: Edge = this
    if (end === 'start' || end === 'both') e = e._extended(distance, true, modes[continuity])
    if (end === 'end' || end === 'both') e = e._extended(distance, false, modes[continuity])
    return e
  }

  _extended(d: number, atStart: boolean, continuity: number): Edge {
    const kind = this.geomType
    const a = this.start
    const b = this.end
    if (kind === 'line') {
      const u = b.sub(a).normalized()
      return atStart ? Line(a.sub(u.mul(d)), b) : Line(a, b.add(u.mul(d)))
    }
    if (kind === 'circle' || kind === 'ellipse') {
      const data = ext.curve_data(this._curve())
      const pl = data.placement
      const c = new Vector(pl.origin)
      const xd = new Vector(pl.x_dir)
      const zd = new Vector(pl.z_dir)
      const yd = zd.cross(xd)
      const [r1, r2] = kind === 'circle' ? [Number(data.radius), Number(data.radius)] : [Number(data.radius1), Number(data.radius2)]
      const angle = (p: Vector): number => {
        const q = p.sub(c)
        return Math.atan2(q.dot(yd) / r2, q.dot(xd) / r1)
      }
      // the turn of the edge about zd: +1 counterclockwise, -1 clockwise
      const sense = a.sub(c).cross(this.tangentAt(0)).dot(zd) > 0 ? 1 : -1
      const turn = 2 * Math.PI
      let span = (((sense * (angle(b) - angle(a))) % turn) + turn) % turn
      span = span || turn
      const add = _ellipseAngleForLength(r1, r2, angle(atStart ? a : b), d, atStart ? -sense : sense)
      if (span + add >= turn - 1e-9) {
        throw new RangeError(`extend: the arc would reach around its whole ${kind} (it is ${_formatG(this.length)} long); extend it less`)
      }
      const a0 = atStart ? angle(a) - sense * add : angle(a)
      const total = span + add
      const plane = new Plane(c, xd, zd)
      if (kind === 'circle') {
        const point = (t: number): Vector => plane.fromLocal([r1 * Math.cos(t), r1 * Math.sin(t), 0])
        return ThreePointArc(point(a0), point(a0 + (sense * total) / 2), point(a0 + sense * total))
      }
      const lo = _degrees(sense > 0 ? a0 : a0 - total)
      const arc = EllipticalArc([0, 0], r1, r2, lo, lo + _degrees(total), plane)
      return sense > 0 ? arc : arc.reversed()
    }
    const c = this._copyCurve()
    try {
      return Edge._fromCurve(kernelCall('extend', () => ext.extend_curve(c, d, atStart, continuity),
        "the curve cannot be extended that far with this continuity; extend it less, or with continuity: 'G1'"))
    } finally {
      ext.delete_curve(c)
    }
  }

  /**
   * Points where this edge meets `other`: an edge, a wire, a face, a body (its faces) or a list of
   * them, in order along this edge.
   *
   * Where the two run along each other, the points where that overlap starts and ends. Points closer
   * than `tolerance` to the other shape count as on it (default: 1e-6, or 1e-9 of the size of the two
   * where that is larger); points closer than that to each other count once. No point is an empty
   * list.
   */
  intersections(other: Shape | Iterable<Shape>, options: { tolerance?: number | null } = {}): Vector[] {
    _opts('Edge.intersections', options)
    return this._hits(other, options.tolerance ?? null, 'intersections').map((h) => h[1])
  }

  /** Where this edge meets `other` (see `intersections`), as fractions of its length (as `pointAt`
   * and `split` take them), in order. */
  intersectionParams(other: Shape | Iterable<Shape>, options: { tolerance?: number | null } = {}): number[] {
    _opts('Edge.intersectionParams', options)
    return this._hits(other, options.tolerance ?? null, 'intersectionParams').map((h) => h[0])
  }

  /** Points where the edge crosses itself (a figure eight, a looping spline), in order along it; the
   * closing point of a closed edge does not count. */
  selfIntersections(options: { tolerance?: number | null } = {}): Vector[] {
    _opts('Edge.selfIntersections', options)
    const tol = _hitTolerance(this, null, options.tolerance ?? null)
    const [t0, t1] = this._range()
    const sols = kernelCall('selfIntersections', () => ext.self_intersections(this._curve(), t0, t1, tol))
    const span = 1e-9 * Math.max(1, Math.abs(t1 - t0))
    const closed = this.isClosed
    const hits: [number, Vector][] = []
    for (const s of sols) {
      const [u, v] = s.t
      if (closed && Math.min(u, v) - t0 <= span && t1 - Math.max(u, v) <= span) continue
      hits.push([this._fraction(u), new Vector(s.point)])
    }
    return _mergedHits(hits, tol, closed).map((h) => h[1])
  }

  /** (fraction along this edge, point) where it meets other, in order, merged within the tolerance. */
  _hits(other: unknown, tolerance: number | null, what: string): [number, Vector][] {
    const tol = _hitTolerance(this, other, tolerance)
    const [t0, t1] = this._range()
    let params: number[] = []
    if (other instanceof Edge) {
      if (other._identity() === this._identity()) {
        throw new RangeError(`${what}: an edge lies on itself everywhere; use selfIntersections() for the points where it crosses itself`)
      }
      const [b0, b1] = other._range()
      const sols = kernelCall(what, () => ext.intersect_curves(this._curve(), t0, t1, other._curve(), b0, b1, tol))
      for (const s of sols) {
        params.push(s.t[0])
        if (s.end != null) params.push(s.end[0])
      }
    } else if (other instanceof Wire || Array.isArray(other)) {
      const items: unknown[] = other instanceof Wire ? [...other.edges()] : other
      const hits = items.flatMap((item) => this._hits(item, tol, what))
      return _mergedHits(hits.sort((p, q) => p[0] - q[0]), tol, this.isClosed)
    } else if (other instanceof Face || other instanceof _Body) {
      const faces = [...other.faces()]
      const sols = kernelCall(what, () => ext.intersect_curve_faces(this._curve(), t0, t1, faces.map((f) => f._f), tol))
      params = sols.map((s: Any) => Number(s.t))
    } else {
      throw new TypeError(`${what}: expected an Edge, Wire, Face or body (or a list of them), got ${_typeName(other)}`)
    }
    const curve = this._curve()
    const hits: [number, Vector][] = params.map((u) => [this._fraction(u), new Vector(k.curve_evaluate(curve, u))])
    return _mergedHits(hits.sort((p, q) => p[0] - q[0]), tol, this.isClosed)
  }

  // -- curvature ----------------------------------------------------------------------------
  /** The curvature at fraction `t` of the length (as `pointAt`): one over the radius of the circle
   * that fits the edge best there; 0 where it runs straight. */
  curvatureAt(t = 0.5): number {
    const g = ext.curve_geometry(this._curve(), this._param(t))
    return Math.hypot(g.curvature[0], g.curvature[1], g.curvature[2])
  }

  /** The radius of curvature at fraction `t` of the length (`Infinity` where the edge runs
   * straight): the radius of the circle that fits the edge best there. */
  radiusAt(t = 0.5): number {
    const c = this.curvatureAt(t)
    return c > 0 ? 1.0 / c : Infinity
  }

  /**
   * The smallest radius of curvature of the edge and where it is: `[radius, t]`, `t` a fraction of
   * the length (as `pointAt`). A line gives `[Infinity, 0]`, an arc its radius. A sweep profile that
   * reaches farther from the path than this folds over itself.
   *
   *     const [r, t] = path.minRadius()
   */
  minRadius(): [number, number] {
    const kind = this.geomType
    if (kind === 'line' || this._isStraight()) return [Infinity, 0.0]
    if (kind === 'circle') return [this.radius, 0.0]
    const [t0, t1] = this._range()
    const curve = this._curve()
    const sols = kernelCall('minRadius', () => ext.curve_properties(curve, t0, t1, 'min_radius', 0.0, 1e-9 * Math.max(1.0, this.length)))
    const candidates = [t0, t1]
    for (const s of sols) {
      candidates.push(Number(s.t))
      if (s.end != null) candidates.push(Number(s.end))
    }
    let bestK = -1.0
    let bestU = t0
    for (const u of candidates) {
      const g = ext.curve_geometry(curve, Math.min(Math.max(u, t0), t1))
      const ku = Math.hypot(g.curvature[0], g.curvature[1], g.curvature[2])
      if (ku > bestK) {
        bestK = ku
        bestU = u
      }
    }
    return [bestK > 0 ? 1.0 / bestK : Infinity, this._fraction(bestU)]
  }

  /**
   * Where the edge changes the side it bends to (an S-curve has one), as fractions of its length (as
   * `pointAt`), in order: points where its curvature passes through zero. Lines, arcs and curves that
   * bend one way only have none; a straight stretch between two bends counts once, at its middle,
   * where the bends go opposite ways.
   */
  inflections(): number[] {
    const kind = this.geomType
    if (kind === 'line' || kind === 'circle' || kind === 'ellipse') return []
    const [t0, t1] = this._range()
    const curve = this._curve()
    const sols = kernelCall('inflections', () => ext.curve_properties(curve, t0, t1, 'inflections', 0.0, 1e-9 * Math.max(1.0, this.length)))
    const span = t1 - t0
    const out: number[] = []
    for (const s of sols) {
      const u = Number(s.t)
      const w = s.end != null ? Number(s.end) : u
      const a = Math.min(u, w)
      const b = Math.max(u, w)
      const before = _binormal(curve, a, -1, t0, t1, span)
      const after = _binormal(curve, b, 1, t0, t1, span)
      if (before === null || after === null || before.dot(after) >= 0) continue
      const f = this._fraction(0.5 * (a + b))
      if (0.0 < f && f < 1.0 && !out.some((g) => Math.abs(f - g) <= 1e-9)) out.push(f)
    }
    return out.sort((x, y) => x - y)
  }

  // -- offsets, lines and arcs --------------------------------------------------------------
  /**
   * The edge moved `distance` sideways in its plane: an open edge to its left for a positive
   * distance (seen from the side the plane's normal points to), to its right for a negative one; a
   * closed edge (a circle, a closed spline) outward for a positive distance.
   *
   * Lines stay lines and arcs stay arcs, exactly. Splines and ellipses are offset by the kernel
   * within 1e-6 of their size. Where the edge bends toward that side more tightly than the distance
   * (a radius of curvature below it, see `minRadius`), the offset would fold over itself and a
   * ModelingError says where.
   *
   * `plane`: the plane the edge lies in, whose normal tells left from right. Default: the XY plane
   * for an edge at one height, else the plane the edge lies in, its normal toward +Z (+Y, then +X,
   * for vertical planes).
   *
   *     const rail = Spline([0, 0], [20, 8], [40, 0]).offset(3) // 3 to the left (+Y side)
   */
  offset(distance: number, options: { plane?: Plane | null } = {}): Edge {
    _opts('Edge.offset', options)
    if (_offsetDistance(distance, 'offset') === 0) return this
    return offsetWire([this], distance, 'round', options.plane ?? null, 'offset')[0]
  }

  /**
   * The edge as lines and circular arcs within `tolerance` of it, end to end along it: for CNC,
   * laser and plasma cutters and DXF readers that take only LINE and ARC
   * (`exportDxf(..., { curves: 'arcs' })`). Lines and arcs come back as they are; splines and
   * ellipses become chains of arcs that join tangentially (lines where they run straight). Both
   * ways, every point of one lies within `tolerance` of the other.
   *
   *     const cut = Spline([0, 0], [10, 5], [20, -3], [30, 4]).toArcs(0.01) // 26 arcs
   */
  toArcs(tolerance = 0.01): Wire {
    if (!(typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance > 0)) {
      throw new RangeError(`toArcs: the tolerance must be positive, got ${String(tolerance)}`)
    }
    const kind = this.geomType
    if (kind === 'line' || kind === 'circle') return Wire._raw([this])
    if (this._isStraight()) return Wire._raw([Line(this.start, this.end)])
    const c = this._copyCurve()
    let r: Any
    try {
      r = kernelCall('toArcs', () => ext.lines_and_arcs(c, tolerance))
    } finally {
      ext.delete_curve(c)
    }
    const dev = Number(r.deviation)
    if (!r.pieces.length || dev > tolerance) {
      throw new ModelingError(`toArcs: the lines and arcs come no closer than ${_formatG(dev, 3)} to the ${kind}, more than the ` +
        `tolerance ${_formatG(tolerance)}; use a larger tolerance`)
    }
    return Wire._raw(r.pieces.map((p: Any) => (p.kind === 'line' ? Line(p.start, p.end) : ThreePointArc(p.start, p.mid, p.end))))
  }

  // -- editing ------------------------------------------------------------------------------
  /** A new kernel B-spline of this edge (lines and arcs as the B-splines they are). */
  _plainBspline(): number {
    const n = this.nurbs()
    return _canonicalCurve(n.points.map((p) => p.toArray()), n.knots, n.degree, n.weights)
  }

  /**
   * This edge bent to pass through `point` (and there in the direction `tangent`, if given): the
   * smallest move of its control points that does it, with the ends of the edge and its directions
   * at the ends kept. For "make this curve pass here" edits of splines, sweep paths and outlines;
   * lines and arcs become cubic B-splines.
   *
   * Options: `tangent`, the direction of the edge at that point (its length does not count; it is
   * the direction the edge runs in); `at`, where along the edge the point goes, as a fraction of its
   * length (strictly between 0 and 1; default: where the edge comes closest to the point).
   *
   * The change is local: it moves the few control points near `at` (knots are inserted there when
   * the edge has too few), so a point far from the edge makes a bump, not a new curve.
   *
   *     const path = Spline([0, 0], [20, 10], [40, 0]).through([20, 15])
   */
  through(point: VectorLike | Vertex, options: { tangent?: VectorLike | null; at?: number | null } = {}): Edge {
    _opts('Edge.through', options)
    const { tangent = null, at = null } = options
    const p = point instanceof Vertex ? point.point : _vec(point)
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw new RangeError('through: the point must be finite')
    let t: Vector | null = null
    if (tangent != null) {
      t = _vec(tangent)
      if (!(t.length > 0) || ![t.x, t.y, t.z].every(Number.isFinite)) throw new RangeError('through: the tangent must be a direction (not zero)')
      t = t.normalized()
    }
    if (at != null && !(typeof at === 'number' && at > 0 && at < 1)) {
      throw new RangeError(`through: at is a fraction of the edge strictly between 0 and 1 (its ends stay), got ${String(at)}`)
    }
    const need = t === null ? 1 : 2
    let q = 3
    let d: Any
    let u = 0
    kernelCall('Edge.through', () => {
      const base = Edge._fromCurve(this._plainBspline())
      u = at != null ? base._param(at) : base._closest(p)[1]
      const [t0, t1] = base._range()
      if (!(t0 < u && u < t1)) {
        throw new RangeError('through: the point is nearest to an end of the edge, and the ends stay; pass at to say where along the edge it goes')
      }
      d = ext.curve_data(base._curve(), true)
      const degree = Number(d.degree)
      q = Math.max(3, degree)
      // the knots after raising the degree (every knot once more per degree)
      const knots: number[] = Array.from(d.knots as ArrayLike<number>, Number)
      const raised: number[] = []
      for (let i = 0; i < knots.length;) {
        let j = i
        while (j < knots.length && knots[j] === knots[i]) j++
        for (let r = 0; r < j - i + q - degree; r++) raised.push(knots[i])
        i = j
      }
      // knots in the spans around u until enough control points that are free to move (not the
      // first two or the last two) act there
      const inserts: number[] = []
      let enough = false
      for (let it = 0; it < 12 && !enough; it++) {
        const kv = [...raised, ...inserts].sort((a, b) => a - b)
        const m = kv.length - q - 1
        const s = _span(kv, q, u)
        let free = 0
        for (let i = s - q; i <= s; i++) if (i >= 2 && i <= m - 3) free++
        if (free >= need + 1) {
          enough = true
          break
        }
        const lo = Math.max(q, s - q)
        const hi = Math.min(m, s + q + 1) // the spans s - q .. s + q
        const spans = [...new Set(kv.slice(lo, hi + 1))].sort((a, b) => a - b)
        for (let i = 0; i + 1 < spans.length; i++) if (spans[i + 1] > spans[i]) inserts.push((spans[i] + spans[i + 1]) / 2)
      }
      if (!enough) throw new ModelingError('through: the edge cannot be refined enough to move')
      const c = ext.refine_curve(base._curve(), q, inserts)
      try {
        d = ext.curve_data(c, true)
      } finally {
        ext.delete_curve(c)
      }
    })
    const kv: number[] = Array.from(d.knots as ArrayLike<number>, Number)
    const P: number[][] = (d.poles as number[][]).map((x) => [Number(x[0]), Number(x[1]), Number(x[2])])
    const w: number[] | null = d.weights == null ? null : Array.from(d.weights as ArrayLike<number>, Number)
    const m = P.length
    const s = _span(kv, q, u)
    const ders = _basisDers(kv, q, s, u, 1)
    const idx = Array.from({ length: q + 1 }, (_, j) => s - q + j)
    const N = ders[0]
    const dN = ders[1]
    let R = N
    let dR = dN
    if (w !== null) { // rational: R = N w / W, linear in the control points for fixed weights
      const ww = idx.map((i) => w[i])
      const W = N.reduce((a, x, j) => a + x * ww[j], 0)
      const dW = dN.reduce((a, x, j) => a + x * ww[j], 0)
      R = N.map((x, j) => (x * ww[j]) / W)
      dR = N.map((x, j) => (dN[j] * ww[j] * W - x * ww[j] * dW) / (W * W))
    }
    const combo = (row: number[]) => [0, 1, 2].map((c) => row.reduce((a, x, j) => a + x * P[idx[j]][c], 0))
    const here = combo(R)
    const rows = [R]
    const rhs = [[p.x - here[0], p.y - here[1], p.z - here[2]]]
    if (t !== null) {
      const slope = combo(dR)
      const speed = Math.hypot(slope[0], slope[1], slope[2])
      rows.push(dR)
      rhs.push([t.x * speed - slope[0], t.y * speed - slope[1], t.z * speed - slope[2]])
    }
    const free = idx.map((i, j) => [i, j]).filter(([i]) => i >= 2 && i <= m - 3).map(([, j]) => j)
    const A = rows.map((row) => free.map((j) => row[j]))
    const G = A.map((a) => A.map((b) => a.reduce((s2, x, j) => s2 + x * b[j], 0)))
    const scale = Math.max(1, ...G.flat().map(Math.abs))
    // the smallest move (least squares, minimum norm): A^T (A A^T)^-1 B
    let Y: number[][]
    if (G.length === 1) {
      if (Math.abs(G[0][0]) <= 1e-14 * scale) throw new ModelingError('through: the edge cannot be bent there (its control points do not reach the point)')
      Y = [rhs[0].map((x) => x / G[0][0])]
    } else {
      const det = G[0][0] * G[1][1] - G[0][1] * G[1][0]
      if (Math.abs(det) <= 1e-14 * scale * scale) throw new ModelingError('through: the edge cannot be bent there (its control points do not reach the point)')
      Y = [
        [0, 1, 2].map((c) => (G[1][1] * rhs[0][c] - G[0][1] * rhs[1][c]) / det),
        [0, 1, 2].map((c) => (-G[1][0] * rhs[0][c] + G[0][0] * rhs[1][c]) / det),
      ]
    }
    free.forEach((j, f) => {
      for (let c = 0; c < 3; c++) P[idx[j]][c] += A.reduce((s2, row, r) => s2 + row[f] * Y[r][c], 0)
    })
    return kernelCall('Edge.through', () => Edge._fromCurve(_canonicalCurve(P, kv, q, w)))
  }

  /**
   * This edge with its ends moved to `start` and `end` and its directions there set to
   * `startTangent` and `endTangent` (each optional: what is not given stays), bent smoothly in
   * between: the parts near the ends move as a whole, the middle blends. For closing gaps, snapping a
   * curve onto a point or another curve, and making it leave or arrive tangentially. Lines and arcs
   * become B-splines (cubic at least).
   *
   * The kernel's own end deformation (`SmCurve::DeformToEndPointTargets`); the ends land on their
   * targets exactly.
   *
   *     const snapped = spline.match({ end: other.start, endTangent: other.tangentAt(0) }) // G1 joint
   */
  match(options: { start?: VectorLike | Vertex | null; end?: VectorLike | Vertex | null; startTangent?: VectorLike | null; endTangent?: VectorLike | null } = {}): Edge {
    _opts('Edge.match', options)
    const { start = null, end = null, startTangent = null, endTangent = null } = options
    const point = (v: VectorLike | Vertex | null, what: string): number[] => {
      if (v == null) return []
      const q = v instanceof Vertex ? v.point : _vec(v)
      if (![q.x, q.y, q.z].every(Number.isFinite)) throw new RangeError(`match: ${what} must be finite`)
      return q.toArray()
    }
    const direction = (v: VectorLike | null, what: string): number[] => {
      if (v == null) return []
      const q = _vec(v)
      if (!(q.length > 0) || ![q.x, q.y, q.z].every(Number.isFinite)) throw new RangeError(`match: ${what} must be a direction (not zero)`)
      return q.toArray()
    }
    const targets = [point(start, 'start'), point(end, 'end'), direction(startTangent, 'startTangent'), direction(endTangent, 'endTangent')]
    if (!targets.some((x) => x.length)) throw new RangeError('match: give start, end, startTangent or endTangent')
    const [c, dev] = kernelCall('Edge.match', () => {
      const base = this._plainBspline()
      try {
        return ext.deform_ends(base, ...targets)
      } finally {
        ext.delete_curve(base)
      }
    })
    const e = Edge._fromCurve(c)
    const size = Math.max(1, this.bbox().diagonal, ...[...targets[0], ...targets[1]].map(Math.abs))
    if (dev > 1e-9 * size) throw new ModelingError(`match: the ends came no closer than ${_formatG(dev, 3)} to their targets`)
    return e
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

  /**
   * This edge and the edges that continue it tangentially, through vertices where the next edge
   * runs on in the same direction (within 10 degrees) between faces that meet this edge's faces
   * smoothly, and so on along the run: all top edges of a plate with rounded corners, the outline
   * of a slot. This edge comes first. `fillet` and `chamfer` round the whole run of each selected
   * edge (their `propagate`). An edge of no part is its own chain.
   */
  tangentChain(): ShapeList<Edge> {
    return _list(_tangentChains([this])[0])
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
   * The edge of a NURBS curve given by its data: the inverse of `nurbs()`, for control points read
   * from a file or another program, curves edited by moving control points and B-splines of many
   * spans (a `Bezier` is one span).
   *
   * `nurbs`: a `Nurbs`, or `{ degree, knots, points, weights }`: the degree (1 to 32), the knot
   * vector with every knot as often as its multiplicity (`points.length + degree + 1` knots, not
   * decreasing; the ends need not repeat), the control points (2D points lie at z = 0) and a
   * positive weight per point, or `null` for a non-rational curve.
   *
   * The curve runs from `knots[degree]` to `knots[knots.length - degree - 1]`; where the ends do not
   * repeat `degree + 1` times, it starts and ends inside the control polygon.
   *
   *     const n = edge.nurbs()
   *     const points = [...n.points]
   *     points[2] = points[2].add([0, 0, 5]) // pull one control point up
   *     const bent = Edge.fromNurbs(new Nurbs(n.degree, n.knots, points, n.weights))
   */
  static fromNurbs(nurbs: Nurbs | { degree: number; knots: readonly number[]; points: readonly VectorLike[]; weights?: readonly number[] | null }): Edge {
    const [degree, knots, points, weights] = _nurbsData(nurbs)
    return kernelCall('Edge.fromNurbs', () => Edge._fromCurve(_canonicalCurve(points, knots, degree, weights)))
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

/** The distance within which an edge or wire meets another shape: as given, else 1e-6, or 1e-9 of
 * the size of the two where that is larger. */
function _hitTolerance(shape: Edge | Wire, other: unknown, tolerance: number | null): number {
  if (tolerance != null) {
    if (!(typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance > 0)) {
      throw new RangeError(`the tolerance must be positive, got ${String(tolerance)}`)
    }
    return tolerance
  }
  let box = shape.bbox()
  for (const item of Array.isArray(other) ? other : [other]) if (item instanceof Shape) box = box.union(item.bbox())
  return Math.max(TOLERANCE, 1e-9 * box.diagonal)
}

/** Hits sorted along an edge or wire, those within `tol` of the one before dropped (on a closed one
 * also the last where it is the first, the closing point). */
function _mergedHits(hits: [number, Vector][], tol: number, closed: boolean): [number, Vector][] {
  const out: [number, Vector][] = []
  for (const h of hits) {
    if (out.length && h[1].distanceTo(out[out.length - 1][1]) <= tol) continue
    out.push(h)
  }
  if (closed && out.length > 1 && out[out.length - 1][1].distanceTo(out[0][1]) <= tol) out.pop()
  return out
}

/** C' x C'' a little before (side -1) or after (+1) parameter u, stepping farther while the curve
 * runs straight there; null where that leaves [t0, t1]. */
function _binormal(curve: number, u: number, side: number, t0: number, t1: number, span: number): Vector | null {
  let step = 1e-6 * span
  while (step <= 0.25 * span) {
    const w = u + side * step
    if (!(t0 < w && w < t1)) return null
    const d = ext.curve_eval(curve, w, 2)
    const d1 = new Vector(d[1])
    const b = d1.cross(new Vector(d[2]))
    if (b.length * span > 1e-9 * d1.dot(d1)) return b // (curvature x length > 1e-9)
    step *= 8.0
  }
  return null
}

function _offsetDistance(distance: unknown, what: string): number {
  if (!(typeof distance === 'number' && Number.isFinite(distance))) {
    throw new RangeError(`${what}: the distance must be a finite number, got ${String(distance)}`)
  }
  return distance
}

/** The angle (radians, >= 0) to turn from `start` (radians, in the sense +-1) along the ellipse
 * x = r1 cos t, y = r2 sin t to cover `length`. */
function _ellipseAngleForLength(r1: number, r2: number, start: number, length: number, sense: number): number {
  const speed = (t: number): number => Math.hypot(r1 * Math.sin(t), r2 * Math.cos(t))
  // length from start over phi (composite Simpson, 2048 panels per turn)
  const arc = (phi: number): number => {
    const n = Math.max(64, 2 * Math.ceil((512 * phi) / Math.PI))
    const h = phi / n
    let s = speed(start) + speed(start + sense * phi)
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * speed(start + sense * i * h)
    return (s * h) / 3
  }
  let phi = Math.min(length / Math.max(Math.min(r1, r2), 1e-300), 2 * Math.PI)
  for (let i = 0; i < 50; i++) {
    const step = (arc(phi) - length) / speed(start + sense * phi)
    phi -= step
    if (phi < 0) phi = 0.5 * (phi + step)
    if (Math.abs(step) <= 1e-15 * Math.max(1, phi)) break
  }
  return phi
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

/** The checked degree, knots, control points and weights of NURBS data (Edge.fromNurbs): clear
 * errors where the kernel would only say SM_ERR, or would take a knot vector of the wrong length. */
export function _nurbsData(nurbs: unknown): [number, number[], number[][], number[] | null] {
  const what = 'Edge.fromNurbs'
  const n = nurbs as Any
  if (n === null || typeof n !== 'object' || !('degree' in n) || !('knots' in n) || !('points' in n)) {
    throw new TypeError(`${what} takes a Nurbs or { degree, knots, points, weights }, not ${_typeName(nurbs)}`)
  }
  const degree = n.degree
  if (typeof degree !== 'number' || !Number.isInteger(degree) || degree < 1 || degree > 32) {
    throw new RangeError(`${what}: the degree is a whole number from 1 to 32, got ${String(degree)}`)
  }
  const pts = [...(n.points as Iterable<VectorLike>)].map((p) => _vec(p))
  if (pts.length < degree + 1) throw new RangeError(`${what}: a curve of degree ${degree} needs at least ${degree + 1} control points, got ${pts.length}`)
  if (!pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) {
    throw new RangeError(`${what}: the control points must be finite numbers`)
  }
  const kv = [...(n.knots as Iterable<number>)].map(Number)
  if (kv.length !== pts.length + degree + 1) {
    throw new RangeError(`${what}: ${pts.length} control points of degree ${degree} take ${pts.length + degree + 1} knots ` +
      `(points + degree + 1, every knot as often as its multiplicity), got ${kv.length}`)
  }
  if (!kv.every(Number.isFinite)) throw new RangeError(`${what}: the knots must be finite numbers`)
  for (let i = 1; i < kv.length; i++) {
    if (kv[i] < kv[i - 1]) {
      throw new RangeError(`${what}: the knots must not decrease, but knot ${i + 1} (${_formatG(kv[i])}) is less than knot ${i} (${_formatG(kv[i - 1])})`)
    }
  }
  const lo = kv[degree]
  const hi = kv[kv.length - degree - 1]
  if (!(hi > lo)) {
    throw new RangeError(`${what}: the curve's knot range, knots[${degree}] to knots[${kv.length - degree - 1}], is empty (${_formatG(lo)} to ${_formatG(hi)})`)
  }
  for (let i = 0; i < kv.length;) {
    let j = i
    while (j < kv.length && kv[j] === kv[i]) j++
    if ((lo < kv[i] && kv[i] < hi && j - i > degree) || j - i > degree + 1) {
      throw new RangeError(`${what}: the knot ${_formatG(kv[i])} is repeated ${j - i} times; at most ${degree} times inside ` +
        `the curve (more would break it) and ${degree + 1} times at its ends`)
    }
    i = j
  }
  let w: number[] | null = null
  if (n.weights != null) {
    w = [...(n.weights as Iterable<number>)].map(Number)
    if (w.length !== pts.length) throw new RangeError(`${what}: one weight per control point (${pts.length}), got ${w.length}`)
    if (!w.every((x) => Number.isFinite(x) && x > 0)) throw new RangeError(`${what}: the weights must be positive numbers`)
  }
  return [degree, kv, pts.map((p) => p.toArray()), w]
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

  /** Distance to a point, or to a body (see `Part.distanceTo`). */
  override distanceTo(point: VectorLike | Shape): number {
    if (point instanceof _Body) return point.distanceTo(this)
    return Math.min(...this._edges.map((e) => e.distanceTo(point)))
  }

  /** The edge (index) and the fraction along it of `at`: a fraction of the wire's length or a point
   * on the wire. */
  _locate(at: number | VectorLike | Vertex, what: string): [number, number] {
    if (typeof at === 'number') {
      if (!(at >= 0 && at <= 1)) throw new RangeError(`${what}: a fraction of the wire runs from 0 to 1, got ${_formatG(at)}`)
      const lengths = this._edges.map((e) => e.length)
      let s = at * lengths.reduce((x, y) => x + y, 0)
      for (let i = 0; i < lengths.length; i++) {
        const L = lengths[i]
        if (s <= L || i === lengths.length - 1) return [i, Math.min(Math.max(L ? s / L : 0, 0), 1)]
        s -= L
      }
    }
    const p = at instanceof Vertex ? at.point : _vec(at as VectorLike)
    let best = 0
    let d = Infinity
    this._edges.forEach((e, i) => {
      const di = e.distanceTo(p)
      if (di < d) [best, d] = [i, di]
    })
    if (d > 1e-6 * Math.max(1, this.length)) {
      throw new RangeError(`${what}: the point ${_fmtPoint(p)} lies ${_formatG(d)} off the wire; pass a point on the wire or a fraction from 0 to 1`)
    }
    return [best, this._edges[best].paramAt(p)]
  }

  /** The wire cut in two at `at`, a fraction of its length or a point on it: the part before and the
   * part after. At a vertex the edges stay as they are; elsewhere the edge there is split
   * (`Edge.split`). */
  split(at: number | VectorLike | Vertex): [Wire, Wire] {
    const [i, f] = this._locate(at, 'split')
    const edges = [...this._edges]
    const L = edges[i].length
    const eps = 1e-9 * Math.max(1, L)
    let first: Edge[]
    let second: Edge[]
    if (f * L <= eps) [first, second] = [edges.slice(0, i), edges.slice(i)]
    else if ((1 - f) * L <= eps) [first, second] = [edges.slice(0, i + 1), edges.slice(i + 1)]
    else {
      const [a, b] = edges[i].split(f)
      ;[first, second] = [[...edges.slice(0, i), a], [b, ...edges.slice(i + 1)]]
    }
    if (!first.length || !second.length) throw new RangeError('split: the point is an end of the wire; there is nothing to split')
    return [Wire._raw(first), Wire._raw(second)]
  }

  /** The part of the wire from `start` to `end`, each a fraction of its length or a point on it;
   * `start` must come before `end` along the wire. */
  trim(start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Wire {
    const [i, f] = this._locate(start, 'trim')
    const [j, g] = this._locate(end, 'trim')
    const edges = this._edges
    if (j < i || (j === i && (g - f) * edges[i].length <= 1e-9 * Math.max(1, edges[i].length))) {
      throw new RangeError('trim: the start must come before the end along the wire (fractions from 0 at its start to 1 at its end)')
    }
    if (i === j) return Wire._raw([edges[i].trim(f, g)])
    const out: Edge[] = []
    if ((1 - f) * edges[i].length > 1e-9 * Math.max(1, edges[i].length)) out.push(f <= 0 ? edges[i] : edges[i].trim(f, 1))
    out.push(...edges.slice(i + 1, j))
    if (g * edges[j].length > 1e-9 * Math.max(1, edges[j].length)) out.push(g >= 1 ? edges[j] : edges[j].trim(0, g))
    if (!out.length) throw new RangeError('trim: the start and the end are the same point of the wire; there is nothing between')
    return Wire._raw(out)
  }

  /** Points where this wire meets `other` (see `Edge.intersections`), in order along the wire; a
   * point where two of its edges meet counts once. */
  intersections(other: Shape | Iterable<Shape>, options: { tolerance?: number | null } = {}): Vector[] {
    _opts('Wire.intersections', options)
    const tol = _hitTolerance(this, other, options.tolerance ?? null)
    const hits: [number, Vector][] = []
    const lengths = this._edges.map((e) => e.length)
    const total = lengths.reduce((x, y) => x + y, 0) || 1
    let before = 0
    this._edges.forEach((e, i) => {
      for (const [t, p] of e._hits(other, tol, 'intersections')) hits.push([(before + t * lengths[i]) / total, p])
      before += lengths[i]
    })
    return _mergedHits(hits.sort((p, q) => p[0] - q[0]), tol, this.isClosed).map((h) => h[1])
  }

  /**
   * The wire as one edge: its curves joined into one B-spline curve (a wire of one edge gives that
   * edge). The edges must meet end to end (within 1e-6); where they meet at a corner, the edge has a
   * corner there too.
   *
   * One edge makes a single sweep or loft rail, a single SPLINE in DXF and a single curve for
   * `makeCompatible`.
   *
   *     const rail = FilletPolyline([0, 0], [30, 0], [30, 20], { radius: 5 }).toEdge()
   */
  toEdge(): Edge {
    const edges = this._edges
    if (edges.length === 1) return edges[0]
    for (let i = 0; i + 1 < edges.length; i++) {
      const gap = edges[i].end.distanceTo(edges[i + 1].start)
      if (gap > 1e-6) {
        throw new RangeError(`toEdge: the edges do not meet: a gap of ${_formatG(gap)} at ${_fmtPoint(edges[i].end)}; join only edges ` +
          'that run end to end (Wire sorts them)')
      }
    }
    const curves = this._copyCurves()
    try {
      return Edge._fromCurve(kernelCall('toEdge', () => ext.join_curves(curves)))
    } finally {
      for (const c of curves) ext.delete_curve(c)
    }
  }

  /**
   * The wire moved `distance` sideways in its plane, as a parallel curve: an open wire to its left
   * for a positive distance (seen from the side the plane's normal points to), to its right for a
   * negative one; a closed wire outward for a positive distance, inward for a negative one (as
   * `Sketch.offset` grows and shrinks).
   *
   * Lines stay lines and arcs stay arcs, exactly; splines and ellipses are offset within 1e-6 of the
   * wire's size (`Edge.offset`). `corners` shapes the corners the offset pulls apart: 'round' (arcs
   * of radius |distance|), 'sharp' (the sides extended until they meet) or 'chamfer' (a straight cut
   * across); at the corners it pushes together, the sides are cut where they cross. Where the offset
   * would fold over or run into itself (an edge bends more tightly than the distance, an edge
   * vanishes, parts of the wire lie closer than the distance), a ModelingError says where; a region's
   * offset that merges and drops parts is `Sketch.offset`.
   *
   * `plane`: the plane the wire lies in, whose normal tells left from right (see `Edge.offset` for
   * the default).
   *
   *     const wall = Polyline([0, 0], [40, 0], [40, 30]).offset(2, { corners: 'sharp' })
   */
  offset(distance: number, options: { corners?: string; plane?: Plane | null } = {}): Wire {
    _opts('Wire.offset', options)
    const { corners = 'round' } = options
    if (!CORNER_STYLES.includes(corners)) throw new RangeError(`offset: corners is 'round', 'sharp' or 'chamfer', not '${corners}'`)
    if (_offsetDistance(distance, 'offset') === 0) return this
    return Wire._raw(offsetWire([...this._edges], distance, corners, options.plane ?? null, 'offset'))
  }

  /** The wire as lines and circular arcs within `tolerance` (see `Edge.toArcs`). */
  toArcs(tolerance = 0.01): Wire {
    return Wire._raw(this._edges.flatMap((e) => [...e.toArcs(tolerance).edges()]))
  }

  /** The smallest radius of curvature of the wire's edges and where it is: `[radius, t]`, `t` a
   * fraction of the wire's length (as `pointAt`). The corners where edges meet do not count (a corner
   * has no radius; see `fillet`). */
  minRadius(): [number, number] {
    const lengths = this._edges.map((e) => e.length)
    const total = lengths.reduce((a, b) => a + b, 0) || 1.0
    let best = Infinity
    let at = 0.0
    let before = 0.0
    this._edges.forEach((e, i) => {
      const [r, t] = e.minRadius()
      if (r < best) {
        best = r
        at = (before + t * lengths[i]) / total
      }
      before += lengths[i]
    })
    return [best, at]
  }

  /** The point of the wire nearest to `point`. */
  closestPoint(point: VectorLike): Vector {
    const p = _vec(point)
    let best: Vector | null = null
    for (const e of this._edges) {
      const q = e.closestPoint(p)
      if (best === null || q.sub(p).length < best.sub(p).length) best = q
    }
    return best as Vector
  }

  /**
   * How the edges of the wire meet at its joints (and where a closed wire closes) (`Continuity`):
   * "G2" where their curvature vectors agree as well, "G1" where they meet tangentially (within
   * `angleTol` degrees), "G0" at a corner, `null` where an edge does not start where the one before
   * ends (within 1e-6). `curvatureTol` is relative to the larger curvature (and at least
   * `1e-3 / length`). RangeError for a wire of one open edge, which has no joint.
   */
  continuity(options: { angleTol?: number; curvatureTol?: number } = {}): Continuity {
    _opts('Wire.continuity', options)
    const { angleTol = 0.5, curvatureTol = 0.01 } = options
    const edges = this._edges
    const pairs: [Edge, Edge][] = []
    for (let i = 0; i + 1 < edges.length; i++) pairs.push([edges[i], edges[i + 1]])
    if (this.isClosed) pairs.push([edges[edges.length - 1], edges[0]])
    if (!pairs.length) throw new RangeError('continuity: the wire has no joints (one open edge)')
    const worst = new Map<string, [number, Vector]>()
    const curvatures: number[] = []
    for (const [a, b] of pairs) {
      const p = a.end
      const q = b.start
      const ka = _curvatureVector(a, 1)
      const kb = _curvatureVector(b, 0)
      const values: [string, number][] = [['gap', p.sub(q).length], ['angle', a.tangentAt(1).angleTo(b.tangentAt(0))],
        ['jump', ka.sub(kb).length]]
      for (const [key, value] of values) {
        const w = worst.get(key)
        if (w === undefined || value > w[0]) worst.set(key, [value, p])
      }
      curvatures.push(Math.max(ka.length, kb.length))
    }
    const gap = worst.get('gap')![0]
    const angle = worst.get('angle')![0]
    const jump = worst.get('jump')![0]
    const length = this.length
    const level = _continuityLevel(gap, Math.max(1e-6, 1e-9 * length), angle, angleTol, jump, Math.max(...curvatures),
      curvatureTol, length)
    const at = worst.get(level === null ? 'gap' : level === 'G0' ? 'angle' : 'jump')![1]
    return new Continuity(level, gap, angle, jump, at)
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

  /**
   * Round corners with tangent arcs of `radius`: every sharp corner, or those at `vertices` (points
   * or vertices). A planar wire's corners are rounded in its plane, as `Sketch.fillet` does: between
   * lines and arcs exactly, next to splines and ellipses with the arc whose center lies at `radius`
   * from both curves (the curves are cut where it touches them). A wire that is not planar has its
   * corners between lines rounded. A corner a wire that is not planar has next to another curve, a
   * smooth corner that is named and a point that is not a corner throw a ModelingError; a radius that
   * does not fit throws a RangeError. Open wires keep their ends.
   */
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
/** The curvature vector of an edge at fraction `t` (towards the center of curvature, of length
 * 1 / radius); the same in either direction along the edge. */
function _curvatureVector(e: Edge, t: number): Vector {
  const [, d1, d2] = ext.curve_eval(e._curve(), e._param(t), 2)
  const a = new Vector(d1)
  const b = new Vector(d2)
  const s = a.length
  if (!(s > 0)) return new Vector()
  return a.cross(b).cross(a).div(s ** 4)
}

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

  /**
   * The face's own color as [r, g, b] from 0 to 1, or null: then it shows in its body's color.
   *
   * Faces get one with `body.colored(color, { faces })` and from STEP files that color single faces.
   * It stays with the face through later operations (kernel plan T5): with both pieces of a face a
   * Boolean splits, with the walls of a hole cut by a tool whose faces have one, with a face moved,
   * mirrored or scaled, with the offsets of a face in a shell; faces an operation makes anew (a
   * fillet's round, the rim around a shell's opening) have none.
   */
  get color(): [number, number, number] | null {
    const [color] = ext.face_attr(this._f)
    return color === null ? null : [Number(color[0]), Number(color[1]), Number(color[2])]
  }

  /** The face's name (`body.named(name, { faces })`, or from the `ADVANCED_FACE` of a STEP file), or
   * null. It stays with the face as `color` does. */
  get name(): string | null {
    const [, name] = ext.face_attr(this._f)
    return name
  }

  /** The cells of its part that this face bounds, as indices into `Part.cells()`: one for a face on
   * the outside or on the wall of a cavity, two for a face between two cells of a merged part (see
   * `ShapeList.shared`), `[]` for a face of a sheet or a sketch. */
  get cells(): number[] {
    if (this._owner === null) return []
    const own: number = ext.face_indices(this._owner._brep, [this._f])[0]
    return own >= 0 ? [..._faceCells(this._owner)[own]] : []
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
    if (this._m === null) {
      const m = kernelCall('face area', () => ext.face_measure(this._f, ACCURACY * _MARGIN))
      if (m.exhausted && this._owner !== null) _unmeasurable(this._owner, Number(ext.face_indices(this._owner._brep, [this._f])[0]), 'face area')
      this._m = m
    }
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

  /** Major radius of a torus: from its axis to the middle of its tube (`radius` is the tube's). */
  get majorRadius(): number {
    const info = this._surfaceInfo()
    if (!('major_radius' in info)) throw new RangeError(`a ${this.geomType} face has no major radius (only a torus has)`)
    return Number(info.major_radius)
  }

  /** Half the opening angle of a cone, in degrees: the angle between its axis and its side. */
  get coneAngle(): number {
    if (this.geomType !== 'cone') throw new RangeError(`a ${this.geomType} face has no cone angle`)
    return Math.abs(Number(this._surfaceInfo().semi_angle_deg))
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

  /** Distance to a point, or to a body (see `Part.distanceTo`). */
  override distanceTo(point: VectorLike | Shape): number {
    if (point instanceof _Body) return point.distanceTo(this)
    const p = point instanceof Vertex ? point.point : _vec(point as VectorLike)
    return Number(k.face_closest_point(this._f, p.toArray())[1])
  }

  /** The point of the face nearest to `point` (within its boundary). */
  closestPoint(point: VectorLike): Vector {
    const p = point instanceof Vertex ? point.point : _vec(point)
    return new Vector(k.face_closest_point(this._f, p.toArray())[0])
  }

  _domain(): [number, number, number, number] {
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(this._f)
    return [Number(u0), Number(u1), Number(v0), Number(v1)]
  }

  /** The surface parameters of the face's point nearest to `point` (of a seam's two, the one on the face). */
  _uv(point: VectorLike): [number, number] {
    const q = this.closestPoint(point)
    const [, uvs] = k.surface_closest_point(k.face_surface(this._f), q.toArray())
    for (const uv of uvs as number[][]) if (k.face_classify_uv(this._f, uv[0], uv[1]) !== 'outside') return [Number(uv[0]), Number(uv[1])]
    return [Number(uvs[0][0]), Number(uvs[0][1])]
  }

  /**
   * The parameters `[u, v]` of the face's point nearest to `point`, as fractions (0 to 1) of the
   * face's parameter box: `face.positionAt(...face.uvAt(p))` is `face.closestPoint(p)`.
   */
  uvAt(point: VectorLike): [number, number] {
    const [u0, u1, v0, v1] = this._domain()
    const [u, v] = this._uv(point)
    return [u1 > u0 ? (u - u0) / (u1 - u0) : 0, v1 > v0 ? (v - v0) / (v1 - v0) : 0]
  }

  /**
   * The point of the face's surface at `(u, v)`, fractions (0 to 1) of the face's parameter box. A
   * trimmed face (a plate with a hole, a face cut by another) does not cover its whole box: points
   * there lie on the surface beyond the face's boundary.
   */
  positionAt(u: number, v: number): Vector {
    const [u0, u1, v0, v1] = this._domain()
    return new Vector(k.face_point_at_uv(this._f, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v))
  }

  /**
   * The curvature of the face at its point nearest to `point` (default: a point inside the face):
   * both principal curvatures, their directions and the outward normal (`Curvature`). Curvatures
   * are positive where the face bends away from its outward normal (a ball, a boss), negative where
   * it bends towards it (a bore): a cylinder of radius 5 has `k1 = 0.2, k2 = 0`, its bore
   * `k1 = 0, k2 = -0.2`.
   */
  curvatureAt(point: VectorLike | null = null): Curvature {
    const p = point == null ? this.interiorPoint() : _vec(point)
    const [u, v] = this._uv(p)
    const r = kernelCall('curvatureAt', () => ext.face_curvature(this._f, u, v))
    return new Curvature(Number(r.k1), Number(r.k2), new Vector(r.d1), new Vector(r.d2), new Vector(r.normal), new Vector(r.point))
  }

  /**
   * The smallest radius of curvature on the face, `1 / max(|k1|, |k2|)`: `Infinity` for a plane, the
   * radius of a cylinder or sphere, the smaller of a torus' tube radius and its inner radius, at the
   * narrow end of a cone. Free-form faces are sampled on a 24 x 24 grid of their parameters and
   * refined from the sharpest points (singular points such as a pole are left out). Compare it with
   * a wall thickness or a cutter radius.
   */
  minRadius(): number {
    const kind = this.geomType
    if (kind === 'plane') return Infinity
    if (kind === 'cylinder' || kind === 'sphere') return this.radius
    return Number(kernelCall('minRadius', () => ext.face_min_radius(this._f, 24)).radius)
  }

  /**
   * The face's surface as a NURBS (`NurbsSurface`): degrees, knots, control points and weights.
   * Exact for every kind (planes, cylinders, cones, spheres, tori as rational surfaces). It is the
   * whole surface, untrimmed: the face may cover only part of it.
   */
  nurbs(): NurbsSurface {
    const d = ext.surface_data(k.face_surface(this._f), true)
    if (d.poles == null) throw new RangeError(`nurbs: the ${this.geomType} surface has no NURBS form`)
    const du = Number(d.u_degree)
    const dv = Number(d.v_degree)
    const ku: number[] = Array.from(d.u_knots, Number)
    const kv: number[] = Array.from(d.v_knots, Number)
    const nu = ku.length - du - 1
    const nv = kv.length - dv - 1
    const poles: Vector[] = (d.poles as number[][]).map((p) => new Vector(p[0], p[1], p[2]))
    if (poles.length !== nu * nv) throw new RangeError("nurbs: the surface's control net does not match its knots")
    const points: Vector[][] = []
    for (let i = 0; i < nu; i++) points.push(poles.slice(i * nv, (i + 1) * nv))
    let weights: number[][] | null = null
    if (d.weights != null) {
      const w: number[] = Array.from(d.weights, Number)
      weights = []
      for (let i = 0; i < nu; i++) weights.push(w.slice(i * nv, (i + 1) * nv))
    }
    return new NurbsSurface([du, dv], [ku, kv], points, weights)
  }

  /**
   * The curve of constant `u` (or constant `v`) of the face's surface, at a fraction (0 to 1) of the
   * face's parameter box, clipped to the face: one edge per piece that lies on it (a plate with a
   * hole in the way gives two). Exact: lines, arcs or B-splines of the surface itself. Give one of
   * `u` and `v` (`isocurve(0.5)`, `isocurve(null, 0.5)`). The same as `iso`.
   */
  isocurve(u: number | null = null, v: number | null = null): ShapeList<Edge> {
    return this._isoCurves(u, v, 'isocurve')
  }

  /** `iso` (and `isocurve`): the face's curves of constant `u` or `v`, a fraction of its parameter
   * box, clipped to the face (`ext.face_iso_curves`). */
  _isoCurves(u: number | null, v: number | null, what: string): ShapeList<Edge> {
    if ((u == null) === (v == null)) throw new RangeError(`${what}: give u or v (exactly one of u and v)`)
    const t = Number(u ?? v)
    if (!(t >= 0 && t <= 1)) throw new RangeError(`${what}: ${u != null ? 'u' : 'v'} is a fraction of the face's range, from 0 to 1 (got ${_formatG(t)})`)
    const [u0, u1, v0, v1] = this._domain()
    const value = u != null ? u0 + (u1 - u0) * t : v0 + (v1 - v0) * t
    const curves: number[] = kernelCall(what, () => ext.face_iso_curves(this._f, u != null, value))
    return _list(curves.map((c) => Edge._fromCurve(c)))
  }

  /** Where a ray meets this face, nearest first (see `Part.raycast`). */
  raycast(origin: VectorLike | Axis, direction: VectorLike | Axis | null = null): Hit[] {
    return _raycast([this], origin, direction, this.bbox())
  }

  // -- curves on the face -------------------------------------------------------------------
  /**
   * The curve projected onto this face along its normals: every point to the nearest point of the
   * face's surface, the result trimmed to the face (pieces where it leaves the face and comes back).
   * Within 1e-7 of the size of the face and the curve. For curves drawn near a freeform face; along
   * one direction, see `Part.project`.
   */
  project(curve: Edge | Wire): ShapeList<Edge> {
    const size = Math.max(1, this.bbox().union(curve.bbox()).diagonal)
    const out = new ShapeList<Edge>()
    for (const e of curve.edges()) {
      const c = e._copyCurve()
      let res: [number, number][]
      try {
        // (the kernel's tolerance bounds the drop; along the surface the curve comes within about
        // five times it)
        res = kernelCall('Face.project', () => ext.normal_project([this._f], c, 1e-8 * size))
      } finally {
        ext.delete_curve(c)
      }
      for (const [cv] of res) out.push(Edge._fromCurve(cv))
    }
    return out
  }

  /**
   * The curve of the face along which one of its surface parameters is constant: `u` or `v` as a
   * fraction (0 to 1) of the face's range of that parameter. Trimmed to the face: several pieces
   * where the face has holes or notches. For styling lines, inspection curves and rails on freeform
   * faces. Which parameter runs which way depends on the surface: on a cylinder's side `v` is
   * constant around it (`iso(null, 0.5)`: the circle half way up) and `u` along it. Exact: lines,
   * arcs or B-splines of the surface itself, ending exactly where the face's edges cross them.
   * `isocurve` is the same.
   */
  iso(u: number | null = null, v: number | null = null): ShapeList<Edge> {
    return this._isoCurves(u, v, 'iso')
  }

  /**
   * A drawing on XY wrapped onto this face, as a label onto a can: its origin goes to `at` (a point
   * of the face; default its middle), its X axis along the face in `direction` (default: the face's
   * first parameter direction there; it follows the parameter line nearest to it), its Y axis
   * across, so that it reads from outside. Lengths stay along the two parameter lines through `at`:
   * on planes and cylinders the whole drawing keeps its size (text around a cylinder); on cones and
   * doubly curved faces it stretches away from those lines. Around a closed face (a cylinder) the
   * drawing continues across the seam; what leaves the face is cut off (also in its holes). Returns
   * the curves on the face, fitted within 1e-7 of its size, cut where they cross its seam.
   *
   * `shape`: an edge, a wire, a sketch or edges, drawn on XY (z is ignored). `at`: where the
   * drawing's origin goes, a point of the face's surface (default: the middle of the face's
   * parameter range). Options: `direction`, where its X axis points (projected onto the face).
   *
   *     const label = can.faces().cylinders()[0].wrap(Text('SMLIB', 8), [0, -20, 0], { direction: [1, 0, 0] })
   */
  wrap(shape: Edge | Wire | Sketch | Iterable<Edge>, at: VectorLike | Vertex | null = null, options: { direction?: VectorLike | null } = {}): ShapeList<Edge> {
    _opts('Face.wrap', options)
    return _wrap(this, shape, at, options.direction ?? null)
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

  /** A sheet of this face moved by `distance` along its normal (`normalAt`: out of the part it bounds;
   * a negative distance moves it in): the offset surface, trimmed as the face is (see `Shell.offset`). */
  offset(distance: number): Shell {
    return this.toShell().offset(distance)
  }

  /**
   * The pieces of this face cut along curves that lie on it, as the faces of a new sheet.
   *
   * @param curves Edges or wires on the face (see `Shell.trim`): each runs from border to border,
   *   or closes a loop.
   *
   * The face's own body does not change: to split the faces of a part where they are, use
   * `Part.imprint`; of a sheet, `Shell.trim` with `keep` `'split'`.
   */
  split(curves: Edge | Wire | Iterable<Edge | Wire>): ShapeList<Face> {
    return this.toShell().trim(curves, 'split').faces()
  }

  /** A copy of this face, turned over: a sheet of one face whose normal points the other way (see
   * `Shell.flipped`). */
  flipped(): Shell {
    return this.toShell().flipped()
  }

  /**
   * The whole surface this face lies on, as a sheet of one face: its holes and cut borders are gone.
   *
   * A cylindrical face cut out of a box comes back as the whole cylinder the cut left it on (its
   * full height and all around), a B-spline face as its whole surface. A plane has no border of its
   * own: it comes back as the smallest rectangle around the face, along the plane's own directions.
   * The sheet's normal follows this face's (`normalAt`).
   */
  untrimmed(): Shell {
    return Shell._wrap(kernelCall('untrimmed', () => ext.untrim_face(this._f)))
  }

  /**
   * The face's surface grown past its sides, as a sheet of one face: to make a sheet reach across a
   * part before cutting or splitting it with it, or to give a blend room.
   *
   * @param distance How far past each side, measured along the surface (across the middle of the
   *   side).
   * @param options `sides`: edges of this face: grow past the sides they lie on only (default: past
   *   every side that can grow). `continuity`: how the surface goes on: `'natural'` (default) as it
   *   is (a plane stays the plane, a cylinder or sphere the same cylinder or sphere, a B-spline
   *   surface follows its own polynomials), `'G1'` straight on along its tangents, `'G2'` bending on
   *   with the curvature it has at the side.
   *
   * The sides are those of the face's surface rectangle, along its parameter directions: the four
   * edges of a box's face or of a sheet from `surface`, the two ends of a cylinder along its axis.
   * Trims (holes, a border cut at a slant) are dropped: the result is the rectangle, grown. A side
   * where the surface closes around (a full cylinder, around it) or shrinks to a point (a sphere's
   * pole, a cone's tip) cannot grow: it is left out by default, and naming its edge throws a
   * RangeError; so does an edge that does not run along a side.
   *
   * @returns A sheet of one face, its normal following this face's (`normalAt`).
   */
  extended(distance: number, options: { sides?: Edge | Iterable<Edge> | null; continuity?: string } = {}): Shell {
    _opts('Face.extended', options)
    return Shell._wrap(_extendedFace(this, distance, options.sides ?? null, options.continuity ?? 'natural', 'extended'))
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
// How a body was made where its operation had a choice, by the body's handle (the record goes with
// the body): { corners: 'round' } for the result of shell or offset. info() reports it.
const _MADE = new WeakMap<BrepHandle, Record<string, string>>()

/** `body`, with `record` noted as how it was made (see `_MADE`). */
function _made<T extends _Body>(body: T, record: Record<string, string>): T {
  _MADE.set(body._h, { ...record })
  return body
}

/** A shape backed by one kernel Brep: a Part, a Shell or a Sketch. */
export class _Body extends Shape {
  _h!: BrepHandle
  name: string | null = null
  color: ColorLike | null = null
  /** (tells bodies apart: two can share a Brep, kernel plan T8) */
  _key: number = ++_bodyCount

  /** (create bodies with the constructors: Box(), Rectangle(), ...) */
  constructor(token?: symbol) {
    super()
    if (token !== INTERNAL) throw new TypeError(`create a ${new.target.name} with the constructors (Box(), Rectangle(), ...)`)
  }

  /** A body of this class around a new Brep (takes ownership). */
  static _wrap<B extends _Body>(this: new (token: symbol) => B, brep: number, options: BodyOptions = {}): B {
    const b = new this(INTERNAL)
    b._h = new BrepHandle(brep)
    // Faces and edges an operation made anew get tags of their own; the kernel carries tags along
    // through later operations (ShapeList.newSince, ShapeList.derivedFrom).
    ext.tag_topology(brep)
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

  /** A body of the same type and metadata around the same Brep, which is not copied: its faces,
   * edges and the measures cached of it are this body's (kernel plan T8). It is a shape of its own
   * all the same: not equal to this one, and a member of selections apart from it; `dispose()` of
   * one frees the Brep only once no other body holds it. */
  _shared(): this {
    const b = Object.assign(Object.create(Object.getPrototypeOf(this)), this) as this
    b._key = ++_bodyCount
    _SHARES.set(this._h, (_SHARES.get(this._h) ?? 1) + 1)
    return b
  }

  /** A copy whose selected faces (as `Part._ownFaces` takes them) get `colors` and `names`
   * (`ext.set_face_colors`, `ext.set_face_names`: one for all, `[]` or `''` to take them off; null
   * leaves them as they are). */
  _withFaceAttrs(what: string, faces: unknown, colors: number[][] | null, names: string[] | null): this {
    const own = Part.prototype._ownFaces.call(this as unknown as Part, faces)
    if (!own.length) throw new RangeError(`${what}: no faces selected`)
    const [copy, mapped] = ext.copy_with_map(this._brep, own, [], [])
    const b = this._like(
      _held(copy, (h) =>
        kernelCall(what, () => {
          if (colors !== null) ext.set_face_colors(h.brep, mapped, colors)
          if (names !== null) ext.set_face_names(h.brep, mapped, names)
        }),
      ),
    )
    // (the same body but for the attributes: what was found or measured of it holds)
    b._h.sound = this._h.sound
    b._h.props = this._h.props
    b._h.tags = this._h.tags
    b._h.shells = this._h.shells
    _sameSources(this._h, b._h)
    return b
  }

  /** Frees the kernel's body now, not when the garbage collector gets to it. Faces, edges and
   * vertices taken from it must not be used afterwards. A body that shares its Brep with others
   * (`named()`, `colored()`) lets go of it, and the last of them frees it. */
  dispose(): void {
    const shares = _SHARES.get(this._h) ?? 1
    if (shares > 1) {
      _SHARES.set(this._h, shares - 1)
      this._h = _DISPOSED
      return
    }
    this._h.dispose()
  }

  [Symbol.dispose](): void {
    this.dispose()
  }

  // -- metadata (returns new shapes; shapes are immutable) ----------------------------------
  /**
   * The same body with a name (used by exporters and the viewer).
   *
   * With `faces` (faces of this body, or of an earlier version of it: as `Part.fillet` takes edges),
   * the body keeps its own name and those faces get this one (`Face.name`, null takes it off): it
   * stays with the faces and their pieces through later operations, and STEP files write it on the
   * face. `part.faces().filter((f) => f.name === 'seal')` finds them again.
   */
  named(name: string | null, options: { faces?: unknown } = {}): this {
    _opts('_Body.named', options)
    if (options.faces !== undefined && options.faces !== null) {
      if (name !== null && typeof name !== 'string') throw new TypeError(`named: a name is a string, not a ${_typeName(name)}`)
      return this._withFaceAttrs('named', options.faces, null, [name ?? ''])
    }
    const b = this._shared()
    b.name = name
    return b
  }

  /**
   * The same body with a display color ("steelblue", "#4682b4" or [r, g, b]).
   *
   * With `faces` (faces of this body, or of an earlier version of it), the body keeps its own color
   * and those faces get this one (`Face.color`; null takes it off): it stays with the faces through
   * later operations (the walls of a hole keep the color of the tool's faces), and STEP, glTF and USD
   * files and pictures show it on them:
   *
   *     const tool = Cylinder(5, 20)
   *     let plate = Box(60, 40, 8).cut(tool.colored('red', { faces: tool.faces() }))
   *     plate = plate.colored('steelblue', { faces: plate.faces().top() })
   */
  colored(color: ColorLike | null, options: { faces?: unknown } = {}): this {
    _opts('_Body.colored', options)
    if (options.faces !== undefined && options.faces !== null) {
      const rgb = color === null ? [] : toRgb(color).map(Number)
      return this._withFaceAttrs('colored', options.faces, [rgb], null)
    }
    const b = this._shared()
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
   * Minimum distance to a point, another body, a face, an edge or a wire.
   *
   * For a point inside a part, and for a body nested in another, it is the distance to the
   * surface (the wall clearance). Bodies that touch or overlap are 0 apart, and so are a body and
   * a curve that touches or crosses its surface.
   */
  override distanceTo(other: VectorLike | Shape): number {
    if (other instanceof _Body) return _bodyDistance(this, other)
    if (other instanceof Face || other instanceof Edge || other instanceof Wire) return this.closestPoints(other).distance
    if (other instanceof Shape && !(other instanceof Vertex)) {
      throw new TypeError(`distanceTo takes a point, a body, a face, an edge or a wire, not a ${_typeName(other)}`)
    }
    const p = other instanceof Vertex ? other.point : _vec(other)
    return Number(k.brep_closest_point(this._brep, p.toArray())[1])
  }

  /**
   * The nearest points of this body and another body, a face, an edge or a wire (`ClosestPoints`):
   * the point on this body, the point on the other, their distance and the faces they lie on. The
   * points are exact surface points (and curve points), as for `distanceTo`; where the shapes touch
   * or overlap, the distance is 0 and the points are one place where they meet.
   */
  closestPoints(other: _Body | Face | Edge | Wire): ClosestPoints {
    if (other instanceof Face) {
      const r = _nearestBodies(this, other.toShell())
      return new ClosestPoints(r.point, r.otherPoint, r.distance, r.face, other)
    }
    if (other instanceof _Body) return _nearestBodies(this, other)
    if (other instanceof Edge || other instanceof Wire) return _curveDistance(this, other)
    throw new TypeError(`closestPoints takes a body, a face, an edge or a wire, not a ${_typeName(other)}`)
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
  /**
   * The curves where this body's surface meets another body's surface, each one once.
   *
   * `other` is a Part, Shell or Sketch, a face (the face itself, bounded by its edges), or a `Plane`
   * (unbounded: where it cuts this body's faces, as `Part.section` cuts a part). Bodies that do not
   * meet, apart or one inside the other, give an empty list.
   */
  intersectionCurves(other: _Body | Face | Plane): ShapeList<Edge> {
    if (other instanceof Plane) {
      // (a planar sheet across the body: the kernel's plane section, intersect_brep_with_plane, fits
      // its curves to B-spline faces within 2e-3 only)
      const box = this._looseBox()
      const middle = box.center.sub(other.zDir.mul(box.center.sub(other.origin).dot(other.zDir)))
      if (box.center.sub(middle).length > box.diagonal / 2 + 1e-6 * Math.max(1, box.diagonal)) return _list([])
      const span = 2 * box.diagonal + 1
      other = Rectangle(span, span).on(new Plane(middle, other.xDir, other.zDir))
    }
    if (other instanceof Face) other = other.toShell()
    if (!(other instanceof _Body)) {
      throw new TypeError(`intersectionCurves takes a body (Part, Shell, Sketch), a face or a plane, not a ${_typeName(other)}`)
    }
    const body = other
    const a = this._looseBox()
    const b = body._looseBox()
    const tol = 1e-6 * Math.max(1, a.union(b).diagonal)
    if (_disjoint(a, b, tol)) return _list([])
    let curves: number[]
    try {
      ;[curves] = kernelCall('intersection curves', () => k.intersect_breps(this._brep, body._brep))
    } catch (e) {
      // (the kernel's intersection fails where the surfaces do not meet: apart, or nested)
      if (e instanceof KernelError && _bodyDistance(this, body) > tol) return _list([])
      throw e
    }
    // Where faces of the two bodies lie in one plane, the kernel hands out curves on their
    // borders twice (also reversed).
    return _distinctCurves(curves, tol)
  }

  /** Silhouette curves on the body as seen along `direction` (an axis or a vector). */
  silhouette(direction: Axis | VectorLike = [0, 0, 1]): ShapeList<Edge> {
    const d = _direction(direction, 'silhouette')
    const curves: number[] = kernelCall('silhouette', () => k.create_silhouette_curves(this._brep, [0, 0, 0], d.toArray()))
    return _list(curves.map((c) => Edge._fromCurve(c)))
  }

  /** Project a curve onto the body along `direction` (an axis or a vector); returns the curves on
   * its faces. */
  /**
   * Project a curve onto the body along `direction` (an axis or a vector); returns the curves on its
   * faces, fitted within 1e-7 of the size of the body and the curve.
   *
   * Every face the projection meets gets its pieces: the near side and the far side of the body, and
   * faces seen edge-on (pieces along the direction). `nearest: true` keeps what the projection
   * reaches first: the parts seen from the curve along the direction, cut where another part of the
   * body hides them.
   */
  project(curve: Edge | Wire, direction: Axis | VectorLike = [0, 0, -1], options: { nearest?: boolean } = {}): ShapeList<Edge> {
    _opts('_Body.project', options)
    const { nearest = false } = options
    const d = _direction(direction, 'project')
    const faces = this.faces()
    const size = Math.max(1, this._looseBox().union(curve.bbox()).diagonal)
    const out = new ShapeList<Edge>()
    for (const e of curve.edges()) {
      const c = e._copyCurve()
      let res: [number, number][]
      try {
        res = kernelCall('project', () => ext.project_curve(faces.map((f) => f._f), c, d.toArray(), 1e-7 * size))
      } finally {
        ext.delete_curve(c)
      }
      const pieces = res.map(([cv, i]): [Edge, Face] => [Edge._fromCurve(cv), faces[i]])
      if (nearest) out.push(...visiblePieces(this, e, pieces, d, size))
      else out.push(...pieces.map(([p]) => p))
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
    // A moved copy is a shape of its own: its faces and edges descend from none of the original's
    // (copies in a pattern can be told apart; a selection of the original is not taken for the
    // copy's).
    const moved = this._like(
      _held(this._copyBrep(), (h) => {
        kernelCall('transform', () => ext.transform_brep(h.brep, columns))
        if (!_similarity(m)) {
          // A scale that differs between the axes (or a shear) makes every face and edge a B-spline:
          // the kernel's recognition gives back the planes, cylinders, cones, surfaces of revolution
          // and lines, before anything measures the copy (a measure stores refitted trim curves in it,
          // which kept a 6.8e-7 volume error) (kernel plan T6).
          const r = _rotation(m)
          const size = this._looseBox().diagonal * Math.sqrt(r.reduce((s, x) => s + x * x, 0))
          const recognized: number | null = kernelCall('transform', () => ext.recognize_analytics(h.brep, 1e-9 * Math.max(1, size)))
          if (recognized) {
            ext.delete_brep(h.brep)
            h.brep = recognized
          }
        }
        ext.tag_topology(h.brep, true)
      }),
    )
    _sameSources(this._h, moved._h, m)
    return moved
  }

  // -- body conversions ---------------------------------------------------------------------
  /** A copy whose faces and edges are all NURBS (analytic types converted). */
  toNurbs(): this {
    return this._like(_held(this._copyBrep(), (h) => kernelCall('toNurbs', () => k.turn_to_nurbs(h.brep))))
  }

  /** Repair gaps, tolerances and topology (mostly needed for imported data). A sheet whose faces
   * close around a volume once healed comes back as a `Part`. */
  heal(): this | Part {
    const healed = this._like(_held(this._copyBrep(), (h) => kernelCall('heal', () => k.heal_brep(h.brep))))
    if (healed instanceof Shell && !(healed instanceof Sketch) && k.brep_is_manifold_solid(healed._brep)) {
      const part = Part._wrap(healed._copyBrep(), { name: this.name, color: this.color })
      if (part._solidProblem() === null) return part
    }
    return healed
  }

  /**
   * What the kernel's own validity checks find wrong with the body: per failed test a `Problem`
   * with the face, edge or vertex it is about (or the body), a message, and the value and tolerance
   * it measured. An empty list: nothing found.
   *
   * `level` 0 checks the structure (how faces, loops, edges and vertices connect, the pointers
   * between them) and the gaps between vertices, edges and faces against their tolerances; 1 also
   * the geometry; 2 (the default) everything, the slow tests too. That takes some milliseconds on
   * parts smlibwasm makes, about 0.1 s on an imported part of 170 faces.
   *
   * The tests look at each face, edge and vertex and its neighbours (SmBrep::AssertValid): they do
   * not see a body that runs through itself. Use them where `isValid` cannot tell what is wrong:
   * after importing, stitching or healing, or where an operation on a part fails that `isValid()`
   * accepts.
   */
  check(level = 2): Problem[] {
    if (level !== 0 && level !== 1 && level !== 2) throw new RangeError(`check: the level must be 0, 1 or 2 (got ${level})`)
    const reports = kernelCall('check', () => ext.check_brep(this._brep, level)) as Any[]
    let faces: number[] | null = null
    let edges: number[] | null = null
    let vertices: number[] | null = null
    const shape = (kind: string | null, index: number): Any => {
      if (kind === 'face') return new Face(this, (faces ??= k.brep_faces(this._brep) as number[])[index])
      if (kind === 'edge') return Edge._of(this, (edges ??= k.brep_edges(this._brep) as number[])[index])
      if (kind === 'vertex') return Vertex._of(this, (vertices ??= k.brep_vertices(this._brep) as number[])[index])
      return kind === 'body' ? this : null
    }
    return reports.map(
      (r) => new Problem(shape(r.kind, r.index), r.message, r.value, r.tolerance, r.category, r.test, shape(r.other_kind, r.other_index)),
    )
  }

  _identity(): string {
    // (each body: a renamed or recolored one shares its Brep, kernel plan T8)
    return `b:${this._key}`
  }

  equals(other: unknown): boolean {
    return other instanceof _Body && this === other
  }

  /** Counts and measures in one object. A body made by `shell` or `offset` also says how the corners
   * of its new walls came out: `corners` is `'round'` or `'sharp'`. */
  info(): { type: string; faces: number; edges: number; vertices: number; bbox: [number[], number[]]; corners?: string } {
    const b = this.bbox()
    return {
      type: _typeName(this),
      faces: k.brep_face_count(this._brep),
      edges: k.brep_edge_count(this._brep),
      vertices: k.brep_vertex_count(this._brep),
      bbox: [b.min.toArray(), b.max.toArray()],
      ..._MADE.get(this._h),
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

/** The cylinders and cones of a body: a point of the axis, its direction, the face's loose box. */
function _roundFaces(body: _Body): [Vector, Vector, BoundBox][] {
  const out: [Vector, Vector, BoundBox][] = []
  for (const f of k.brep_faces(body._brep) as number[]) {
    const info = ext.surface_data(k.face_surface(f), false)
    if (info.kind === 'cylinder' || info.kind === 'cone') {
      const [lo, hi] = k.face_bounding_box(f, false)
      out.push([new Vector(info.placement.origin), new Vector(info.placement.z_dir).normalized(), new BoundBox(lo, hi)])
    }
  }
  return out
}

/** Whether a cylinder or cone of the tool lies parallel to one of the part, off its axis, where the
 * boxes of the two faces overlap: a tool beside an earlier hole or boss, whose faces cross that
 * one's along lines (kernel plan B10). */
export function _parallelRounds(part: _Body, tool: _Body): boolean {
  const mine = _roundFaces(part)
  if (!mine.length) return false
  for (const [o, d, box] of _roundFaces(tool)) {
    for (const [o2, d2, box2] of mine) {
      if (d.cross(d2).length > 1e-9) continue
      const w = o2.sub(o)
      const off = w.sub(d.mul(w.dot(d))) // from one axis to the other
      if (off.length <= 1e-9 * (1 + box.diagonal + box2.diagonal)) continue // on one axis: they cross along circles, if at all
      if (!_disjoint(box, box2, 1e-6 * (box.diagonal + box2.diagonal))) return true
    }
  }
  return false
}

/**
 * How the planes, cylinders and spheres of a tool meet those of a part, for the hint of a Boolean
 * that failed (kernel plan B19): `beside` (a cylinder of the tool crosses a parallel cylinder of the
 * part along lines: a tool beside a hole or boss), `tangent` (where a cylinder or sphere touches a
 * plane, cylinder or sphere tangentially) and `coincident` (where a face of the tool lies on one of
 * the part: the same plane, cylinder or sphere, over an area), each place as "at z = 5" (a plane
 * across an axis) or "near (x, y, z)"; null where there is none. The faces must be near each other
 * (their boxes overlap); not otherwise checked.
 */
function _surfaceContacts(part: _Body, tool: _Body): { beside: boolean; tangent: string | null; coincident: string | null } {
  type Surf = [string, Vector, Vector, number, BoundBox]
  const surfaces = (body: _Body): Surf[] => {
    const out: Surf[] = []
    for (const f of k.brep_faces(body._brep) as number[]) {
      const info = ext.surface_data(k.face_surface(f), false)
      let kind: string = info.kind
      if (kind === 'cone' && Math.abs(info.semi_angle_deg ?? 1) < 1e-12) kind = 'cylinder'
      if (kind === 'plane' || kind === 'cylinder' || kind === 'sphere') {
        const [lo, hi] = k.face_bounding_box(f, false)
        out.push([kind, new Vector(info.placement.origin), new Vector(info.placement.z_dir).normalized(), Number(info.radius ?? 0), new BoundBox(lo, hi)])
      }
    }
    return out
  }
  const place = (a: BoundBox, b: BoundBox, normal: Vector | null = null, level: Vector | null = null): string => {
    if (normal !== null && level !== null) {
      const n = normal.toArray()
      const l = level.toArray()
      for (let i = 0; i < 3; i++) if (Math.abs(Math.abs(n[i]) - 1) < 1e-9) return `at ${'xyz'[i]} = ${_formatG(l[i], 4)}`
    }
    const [a0, a1, b0, b1] = [a.min.toArray(), a.max.toArray(), b.min.toArray(), b.max.toArray()]
    const c = [0, 1, 2].map((i) => (Math.max(a0[i], b0[i]) + Math.min(a1[i], b1[i])) / 2)
    return `near (${c.map((v) => _formatG(v, 4)).join(', ')})`
  }
  // the second largest extent of the boxes' overlap (an area, not a line or a point, where it is not 0)
  const spread = (a: BoundBox, b: BoundBox): number => {
    const [a0, a1, b0, b1] = [a.min.toArray(), a.max.toArray(), b.min.toArray(), b.max.toArray()]
    return [0, 1, 2].map((i) => Math.min(a1[i], b1[i]) - Math.max(a0[i], b0[i])).sort((x, y) => x - y)[1]
  }
  const tol = 1e-6 * Math.max(part._looseBox().diagonal, tool._looseBox().diagonal, 1)
  const found: { beside: boolean; tangent: string | null; coincident: string | null } = { beside: false, tangent: null, coincident: null }
  const mine = surfaces(part)
  for (const s of surfaces(tool)) {
    const [kind, o, d, r, box] = s
    for (const s2 of mine) {
      const [kind2, o2, d2, r2, box2] = s2
      if (_disjoint(box, box2, tol)) continue
      const area = spread(box, box2) > 1e-4 * Math.max(box.diagonal, box2.diagonal)
      if (kind === 'plane' && kind2 === 'plane') {
        if (d.cross(d2).length <= 1e-9 && Math.abs(o2.sub(o).dot(d)) <= tol && area) found.coincident ??= place(box, box2, d, o)
      } else if (kind === 'cylinder' && kind2 === 'cylinder') {
        if (d.cross(d2).length > 1e-9) continue
        const w = o2.sub(o)
        const apart = w.sub(d.mul(w.dot(d))).length
        if (apart <= tol && Math.abs(r - r2) <= tol && area) found.coincident ??= place(box, box2)
        else if (Math.abs(apart - (r + r2)) <= tol || (Math.abs(r - r2) > tol && Math.abs(apart - Math.abs(r - r2)) <= tol)) found.tangent ??= place(box, box2)
        else if (Math.abs(r - r2) + tol < apart && apart < r + r2 - tol) found.beside = true
      } else if (kind === 'sphere' && kind2 === 'sphere') {
        const apart = o2.sub(o).length
        if (apart <= tol && Math.abs(r - r2) <= tol) found.coincident ??= place(box, box2)
        else if (Math.abs(apart - (r + r2)) <= tol || (Math.abs(r - r2) > tol && Math.abs(apart - Math.abs(r - r2)) <= tol)) found.tangent ??= place(box, box2)
      } else if (kind === 'plane' || kind2 === 'plane') {
        const [plane, round] = kind === 'plane' ? [s, s2] : [s2, s]
        const [, po, pn] = plane
        const [rk, ro, rd, rr] = round
        if (rk === 'cylinder' && Math.abs(rd.dot(pn)) > 1e-9) continue // (a cylinder meets a plane across its axis in a circle or an ellipse)
        if (Math.abs(Math.abs(ro.sub(po).dot(pn)) - rr) <= tol) found.tangent ??= place(box, box2)
      }
    }
  }
  return found
}

/** A shell's or offset's kernel error, saying that the kernel crashed or failed inside (not the
 * hint's guess about the size) where it did (kernel plan B19). */
function _crashed(e: KernelError, name: string): KernelError {
  const crash = _crashNote(e, name)
  if (crash === null) return e
  const error = new KernelError(e.operation, e.detail, e.status, `${crash}, a defect of the kernel rather than of the part`)
  ;(error as Any).cause = e
  return error
}

/** For a kernel failure that is a crash (a trap, a crash in the probe worker) or a null pointer the
 * kernel met inside (SM_ERR_NULL_POINTER): what the error says of it instead of a guess about the
 * inputs; null for other failures (kernel plan B19). */
export function _crashNote(e: unknown, operation: string): string | null {
  if (!(e instanceof KernelError)) return null
  const detail = e.detail ?? ''
  const at = detail.indexOf('the kernel crashed')
  if (at >= 0) {
    const inner = detail.slice(at)
    const open = inner.indexOf('(')
    const close = inner.lastIndexOf(')')
    const why = open >= 0 && close > open ? inner.slice(open + 1, close) : ''
    return `the kernel crashed in the ${operation}` + (why ? ` (${why})` : '')
  }
  if (e.status === 'SM_ERR_NULL_POINTER') return `the kernel failed inside the ${operation} (it met a null pointer of its own)`
  return null
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

/** What is wrong with the result of a shell or an offset (see `Part._checked`), or null. `wider` gives
 * the box's margin for a result that reaches beyond `tol` (computed only then). */
export function _offsetProblem(
  result: Part,
  box: BoundBox,
  tol: number,
  before: number,
  smaller: boolean | null,
  wider: (() => number) | null = null,
): string | null {
  const problem = result._solidProblem()
  if (problem !== null) return `a body that is ${problem}`
  const rb = result.bbox()
  const [lo, hi, rlo, rhi] = [box.min.toArray(), box.max.toArray(), rb.min.toArray(), rb.max.toArray()]
  const reachesOut = (margin: number): boolean => [0, 1, 2].some((i) => rlo[i] < lo[i] - margin || rhi[i] > hi[i] + margin)
  if (reachesOut(tol) && (wider === null || reachesOut(wider()))) return 'a body that reaches out of the box it must fit in'
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
  return _nearestBodies(a, b, seeds, sample).distance
}

/** `_bodyDistance` with the nearest points and their faces (Python's `_body_distance(points=True)`). */
function _nearestBodies(a: _Body, b: _Body, seeds = 6, sample = 400): ClosestPoints {
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
  let pair: [number[], number[], number | null, number | null] = [[0, 0, 0], [0, 0, 0], null, null] // on a, on b, faces
  const first = starts.slice().sort((u, v) => u[0] - v[0]).slice(0, 2 * seeds)
  for (const [, x, y, start] of first) {
    const r = kernelCall('distanceTo', () => ext.nearest_points(x._brep, y._brep, start))
    if (r.distance < best) {
      best = r.distance
      unsettled = r.gain
      pair = x === a ? [r.a, r.b, r.face_a, r.face_b] : [r.b, r.a, r.face_b, r.face_a]
    }
  }
  const scale = Math.max(ab.diagonal, bb.diagonal, 1)
  if (unsettled > 1e-9 * scale) {
    _warn(`distanceTo: the nearest points did not settle; the distance ${_formatG(best)} may be too large (the last step still gained ${unsettled.toPrecision(2)})`)
  }
  const [pa, pb, fa, fb] = pair
  return new ClosestPoints(new Vector(pa), new Vector(pb), best <= 1e-12 * scale ? 0 : best, fa ? new Face(a, fa) : null,
    fb ? new Face(b, fb) : null)
}

/**
 * The nearest points of a body and an edge or a wire: for each edge, the body's distance from
 * points along the curve (by its parameter) gives starting points; from the best few,
 * `ext.nearest_curve_points` takes closest points in turn and finishes with Newton's method on the
 * parameters of the curve and of the face it meets, as `_bodyDistance` does for two bodies.
 */
function _curveDistance(body: _Body, curve: Edge | Wire, samples = 64, seeds = 4): ClosestPoints {
  if (k.brep_face_count(body._brep) === 0) throw new RangeError('distanceTo: an empty body has no distance')
  let best = Infinity
  let found: Any = null
  let unsettled = 0
  for (const e of curve.edges()) {
    const c = e._curve()
    const [t0, t1] = e._range()
    const near: [number, number][] = []
    for (let i = 0; i <= samples; i++) {
      const t = t0 + ((t1 - t0) * i) / samples
      const p = new Vector(k.curve_evaluate(c, t)).toArray() as number[]
      near.push([_dist(_closest(body, p), p), t])
    }
    near.sort((u, v) => u[0] - v[0] || u[1] - v[1])
    const taken: number[] = []
    for (const [, t] of near) {
      if (taken.length >= seeds) break
      if (taken.every((u) => Math.abs(t - u) > (t1 - t0) / samples)) taken.push(t)
    }
    for (const t of taken) {
      const r = kernelCall('distanceTo', () => ext.nearest_curve_points(body._brep, c, t0, t1, t))
      if (r.distance < best) {
        best = r.distance
        found = r
        unsettled = r.gain
      }
    }
  }
  const scale = Math.max(body._looseBox().diagonal, curve.bbox().diagonal, 1)
  if (unsettled > 1e-9 * scale) {
    _warn(`distanceTo: the nearest points did not settle; the distance ${_formatG(best)} may be too large (the last step still gained ${unsettled.toPrecision(2)})`)
  }
  return new ClosestPoints(new Vector(found.a), new Vector(found.b), best <= 1e-12 * scale ? 0 : best,
    found.face_a ? new Face(body, found.face_a) : null, null)
}

/** Called where the integration ran out of a face's evaluation budget (measure.cpp): throws for a
 * face that crosses its surface's seam, which the integration cannot converge on (it ran for
 * minutes); otherwise the result stands, not converged, and says so. */
function _unmeasurable(body: _Body, face: number, what = 'mass properties'): void {
  const problems: Any[] = ext.seam_problems(body._brep, false, [face])
  const crossed = problems.filter((p) => p.crossed)
  if (crossed.length) {
    const why = `face ${face} of the body crosses the seam of its surface (along ${crossed[0].crossed}), so its area and volume cannot be integrated: the body is broken (isValid() is false); rebuild the step that made it, or heal() it`
    throw new KernelError(what, why, null, why)
  }
}

/** tessellate's default tolerance for a body (1e-3 of its box diagonal), times `scale`. */
function _meshTolerance(body: _Body, scale = 1): number {
  return Math.max(body.bbox().diagonal * 1e-3 * scale, 1e-6)
}

/** The volume the meshes of a body and a tool have in common (`op` INTERSECTION) or of the body's
 * left outside the tools (DIFFERENCE), the meshes made to `scale` times tessellate's default
 * tolerance; null where the kernel's mesh Boolean fails (as it can where the meshes have faces in
 * common). The meshes lie within their tolerance of the bodies, inside them where the surfaces are
 * convex: bodies that only touch have no volume in common, or (where a concave face of one touches
 * the other) a volume that shrinks with the tolerance. */
function _meshOverlap(a: Part, tools: readonly Part[], op: number, scale = 1): number | null {
  try {
    let mesh = tessellate(a, _meshTolerance(a, scale))
    for (const t of tools) {
      const tm = tessellate(t, _meshTolerance(t, scale))
      mesh = op === k.BooleanOp.INTERSECTION ? mesh.intersect(tm) : mesh.cut(tm)
      if (!mesh.triangles.length) return 0
    }
    return Math.abs(mesh.volume)
  } catch (e) {
    if (!(e instanceof ModelingError || e instanceof RangeError)) throw e
    return null
  }
}

/** Points on the mesh of a body (its corners and the middles of its triangles, within `tol` of the
 * surface) that lie in a box, at most `limit` of them, spread over the list. */
function _surfaceSamples(body: _Body, near: BoundBox, tol: number, limit = 2000): [number, number, number][] {
  const mesh = tessellate(body, tol)
  const v = mesh.vertices
  const t = mesh.triangles
  const lo = near.min.toArray().map((x) => x - tol)
  const hi = near.max.toArray().map((x) => x + tol)
  // its corners, the middles of its triangles, and, in a triangle longer than a twelfth of the box,
  // points on a grid that far apart (the side of a long cylinder is a few triangles from end to end:
  // their corners and middles can all lie outside a box that the cylinder crosses)
  const spacing = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 12, tol)
  const all: [number, number, number][] = []
  for (let i = 0; i < v.length; i += 3) all.push([v[i], v[i + 1], v[i + 2]])
  for (let i = 0; i < t.length; i += 3) {
    const corners = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3].map((j) => [v[j], v[j + 1], v[j + 2]])
    if (![0, 1, 2].every((d) => Math.max(...corners.map((p) => p[d])) >= lo[d] && Math.min(...corners.map((p) => p[d])) <= hi[d])) continue
    const [a, b, c] = corners
    all.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3])
    const longest = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]), Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]))
    const n = Math.min(Math.max(Math.ceil(longest / spacing), 1), 16)
    if (n < 2) continue
    for (let p = 0; p <= n; p++) {
      for (let q = 0; p + q <= n; q++) {
        const [u, w] = [p / n, q / n]
        all.push([0, 1, 2].map((d) => a[d] + (b[d] - a[d]) * u + (c[d] - a[d]) * w) as [number, number, number])
      }
    }
  }
  let pts = all.filter((p) => p.every((x, i) => x >= lo[i] && x <= hi[i]))
  if (pts.length > limit) {
    // (numpy's linspace(0, n - 1, limit).astype(int))
    const n = pts.length
    pts = Array.from({ length: limit }, (_, i) => pts[Math.trunc((i * (n - 1)) / (limit - 1))])
  }
  return pts
}

/** `_emptyIsRight` by classifying points instead (where the mesh Booleans fail, or could crash): no
 * point of one operand's mesh lies inside the other by more than twice the mesh's tolerance
 * (INTERSECTION), or none of the part's lies outside every tool (DIFFERENCE). */
export function _classifiedEmpty(a: Part, tools: readonly Part[], op: number): boolean {
  // (twice the tolerance: the kernel's meshes keep to their tolerance only about; a sphere's for
  // 0.0346 lies up to 0.0356 inside it)
  const tol = Math.max(_meshTolerance(a), ...tools.map((t) => _meshTolerance(t)))
  if (op === k.BooleanOp.INTERSECTION) {
    const b = tools[0]
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const pts = _surfaceSamples(x, y._looseBox(), tol)
      if (pts.length && y._classify(pts, 2 * tol).some(([where]) => where === 'inside')) return false
    }
    return true
  }
  const pts = _surfaceSamples(a, a._looseBox(), tol)
  const covered = pts.map(() => false)
  for (const t of tools) t._classify(pts, 2 * tol).forEach(([where], i) => (covered[i] = covered[i] || where !== 'outside'))
  return covered.every((c) => c)
}

/** Whether an empty intersection (one tool) or cut is right: the meshes of the operands have no
 * volume in common (in the cut: none of the part is left outside the tools), up to 1e-6 of the
 * smaller volume, or a volume that shrinks to less than half at a tenth of the tolerance (where a
 * concave face touches the other body, the meshes overlap by about the tolerance). Where the mesh
 * Booleans fail, points of the meshes are classified (`_classifiedEmpty`). (The kernel's
 * brep_relationship is not asked: it calls overlapping bodies "touching", such as spheres with 18.6
 * in common or a pin through a plate, its answer changes with where the bodies are and with what was
 * asked of them before, and it took 10 s for two plates of 168 faces.) */
function _emptyIsRight(a: Part, tools: readonly Part[], op: number): boolean {
  try {
    // The kernel's mesh Boolean can crash where the meshes have faces in common or touch
    // tangentially (internally tangent cylinders, at a tenth of the tolerance): classify points there.
    if (tools.some((t) => {
      const c = _surfaceContacts(a, t)
      return c.tangent !== null || c.coincident !== null
    })) return _classifiedEmpty(a, tools, op)
    const volumes = [a._quickVolume(), ...(op === k.BooleanOp.INTERSECTION ? tools.map((t) => t._quickVolume()) : [])]
    const small = 1e-6 * Math.max(Math.min(...volumes.map(Math.abs)), 1e-300)
    const coarse = _meshOverlap(a, tools, op)
    if (coarse !== null && coarse <= small) return true
    const fine = coarse !== null ? _meshOverlap(a, tools, op, 0.1) : null
    if (fine !== null) return fine <= small || fine < 0.5 * (coarse as number)
    return _classifiedEmpty(a, tools, op)
  } catch (e) {
    if (!(e instanceof KernelError || e instanceof RangeError)) throw e
    return false
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

/**
 * Something the kernel's validity checks find wrong with a body (see `check`): the face, edge or
 * vertex it is about, or the body itself (`shape`); what is wrong, with the value measured and the
 * tolerance where there are (`message`); the value measured (a gap, a distance, an angle) and the
 * tolerance it was held against (`value`, `tolerance`, or null); the kind of test (`category`:
 * "gap", "geometric", "topological", "values", "degenerate", ...: the kernel's SmAssertType) and
 * its short name (`test`: "Bad Gap", "Bad Loop Connection Vertex"); a second face, edge or vertex
 * the test compared with (`other`, or null).
 */
export class Problem {
  readonly shape: Face | Edge | Vertex | Part | Shell
  readonly message: string
  readonly value: number | null
  readonly tolerance: number | null
  readonly category: string
  readonly test: string
  readonly other: Face | Edge | Vertex | Part | Shell | null

  constructor(
    shape: Face | Edge | Vertex | Part | Shell,
    message: string,
    value: number | null = null,
    tolerance: number | null = null,
    category = '',
    test = '',
    other: Face | Edge | Vertex | Part | Shell | null = null,
  ) {
    this.shape = shape
    this.message = message
    this.value = value
    this.tolerance = tolerance
    this.category = category
    this.test = test
    this.other = other
  }

  toString(): string {
    return `Problem(${this.shape}, ${JSON.stringify(this.message)})`
  }

  [inspect](): string {
    return this.toString()
  }
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

  /**
   * The radius of gyration about each principal axis, `sqrt(moment / mass)`, in the order of
   * `principalMoments`: the distance from the axis at which the whole mass would have the same
   * moment of inertia.
   */
  get radiiOfGyration(): [number, number, number] {
    const [a, b, c] = this.principalMoments.map((m) => Math.sqrt(Math.max(m, 0) / this.mass))
    return [a, b, c]
  }

  /**
   * The inertia tensor about `point` (axes parallel to the world axes): `inertia` moved by the
   * parallel-axis theorem, `inertia + mass * (d.d * I - d d^T)` with `d` from the center of mass to
   * the point.
   */
  inertiaAbout(point: VectorLike): number[][] {
    const d = _vec(point).sub(this.center).toArray()
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    return this.inertia.map((row, i) => row.map((x, j) => x + this.mass * ((i === j ? dd : 0) - d[i] * d[j])))
  }

  /**
   * The moment of inertia about an axis (for example a shaft's axis or a pivot): `n^T I n` with the
   * inertia tensor about a point of the axis and its unit direction `n`.
   */
  momentAbout(axis: Axis): number {
    if (!(axis instanceof Axis)) throw new TypeError(`momentAbout takes an Axis, not a ${_typeName(axis)}`)
    const n = axis.direction.normalized().toArray()
    const m = this.inertiaAbout(axis.origin)
    let s = 0
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += n[i] * m[i][j] * n[j]
    return s
  }

  toString(): string {
    const c = this.center
    return `MassProperties(mass=${_formatG(this.mass)}, volume=${_formatG(this.volume)}, area=${_formatG(this.area)}, center=(${_formatG(c.x)}, ${_formatG(c.y)}, ${_formatG(c.z)}))`
  }

  [inspect](): string {
    return this.toString()
  }
}

/**
 * Section properties of a planar region (see `Sketch.sectionProperties`): the area and the second
 * moments of area of a profile, for beams, frames and extrusions.
 *
 * The moments are about the centroid, in the axes of `plane` (the sketch plane moved to the
 * centroid): `ixx = ∫ y² dA` about its x axis, `iyy = ∫ x² dA` about its y axis and the product
 * `ixy = ∫ x y dA`, in mm⁴.
 */
export class SectionProperties {
  readonly area: number
  readonly centroid: Vector
  readonly plane: Plane
  readonly ixx: number
  readonly iyy: number
  readonly ixy: number
  readonly _extent: [number, number, number, number] // min x, max x, min y, max y about the centroid

  constructor(area: number, plane: Plane, ixx: number, iyy: number, ixy: number, extent: [number, number, number, number]) {
    this.area = area
    this.centroid = plane.origin
    this.plane = plane
    this.ixx = ixx
    this.iyy = iyy
    this.ixy = ixy
    this._extent = extent
  }

  /** The polar moment about the centroid, `ixx + iyy` (the torsion constant only of a circle or a ring). */
  get polar(): number {
    return this.ixx + this.iyy
  }

  /** The second moments about the principal axes through the centroid, ascending. */
  get principalMoments(): [number, number] {
    const m = (this.ixx + this.iyy) / 2
    const r = Math.hypot((this.ixx - this.iyy) / 2, this.ixy)
    return [m - r, m + r]
  }

  /** Unit directions (in world coordinates, in the plane) of the principal axes, in the order of `principalMoments`. */
  get principalAxes(): [Vector, Vector] {
    const [lo] = this.principalMoments
    // an eigenvector of [[ixx, -ixy], [-ixy, iyy]] for the smaller moment, and the one across it
    let u: [number, number]
    if (Math.abs(this.ixy) <= 1e-300) u = this.ixx <= this.iyy ? [1, 0] : [0, 1]
    else {
      const a = [this.ixy, this.ixx - lo] as const // (ixx - lo) x - ixy y = 0
      const b = [this.iyy - lo, this.ixy] as const // -ixy x + (iyy - lo) y = 0
      u = Math.hypot(...a) >= Math.hypot(...b) ? [a[0], a[1]] : [b[0], b[1]]
    }
    const px = this.plane.xDir
    const py = this.plane.yDir
    const first = px.mul(u[0]).add(py.mul(u[1])).normalized()
    return [first, this.plane.zDir.cross(first).normalized()]
  }

  /** `[sqrt(ixx / area), sqrt(iyy / area)]`. */
  get radiiOfGyration(): [number, number] {
    return [Math.sqrt(Math.max(this.ixx, 0) / this.area), Math.sqrt(Math.max(this.iyy, 0) / this.area)]
  }

  /**
   * The elastic section moduli `[ixx / c_y, iyy / c_x]`, with `c` the distance from the centroid to
   * the farthest fiber of the region across each axis (the smaller modulus of a section that is
   * not symmetric).
   */
  get sectionModuli(): [number, number] {
    const [x0, x1, y0, y1] = this._extent
    return [this.ixx / Math.max(-y0, y1), this.iyy / Math.max(-x0, x1)]
  }

  toString(): string {
    const c = this.centroid
    return `SectionProperties(area=${_formatG(this.area)}, centroid=(${_formatG(c.x)}, ${_formatG(c.y)}, ${_formatG(c.z)}), ixx=${_formatG(this.ixx)}, iyy=${_formatG(this.iyy)}, ixy=${_formatG(this.ixy)})`
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
  /** Round the edges that continue the selected ones tangentially too (`Edge.tangentChain`): one
   * top edge of a plate with rounded corners rounds the whole outline. An added edge takes the
   * radius of the selected edge it continues. `false` rounds the selected edges only; where the
   * kernel then fails, the error names a selected edge that runs on tangentially into one that is
   * not selected (the kernel cannot always round such an edge alone). Default true. */
  propagate?: boolean
  /** Where three rounded edges meet: "patch" (the default) joins their rounds with a corner patch (a
   * ball corner where the radii are equal); "mitre" runs the rounds on until they meet each other,
   * along mitre lines without a patch (the look of a machined part). Mitred are the corners where
   * three rounded convex edges meet and no other edge; a selection without such a corner throws a
   * RangeError. */
  corners?: string
}

/** Which edges a chamfer bevels. */
export interface ChamferOptions {
  /** An asymmetric bevel: the setback on the other face of each edge (`length` is the one on its
   * `reference` face). */
  length2?: number | null
  /** An asymmetric bevel: the angle (degrees) between the bevel and the `reference` face of each edge
   * (`length2` follows from it: `length * tan(angle)` where the faces meet at 90 degrees). */
  angle?: number | null
  /** A face of the part (or several) that each edge lies on: `length` is measured on it. `length2` and
   * `angle` need it. */
  reference?: unknown
  /** Bevel the edges that continue the selected ones tangentially too (`Edge.tangentChain`), as
   * `fillet` does; `false` bevels the selected edges only. The edges a run adds must lie on a
   * reference face too. Default true. */
  propagate?: boolean
  /** The corners where three bevelled edges meet, as for `fillet`: "patch" (the default) cuts them off
   * with a corner face, "mitre" runs the bevels on until they meet (the corners of three bevelled
   * convex edges and no other edge). */
  corners?: string
}

/**
 * A solid: one or more closed volumes.
 *
 * Combine parts with `fuse` (union), `cut` (difference) and `intersect` (intersection). Each
 * takes parts or any iterables of parts.
 */
export class Part extends _Body {
  /** The bends `fold()` and `flange()` made, with the K-factor each was made with, as [axis origin,
   * axis direction, inside radius, kFactor]; `unfold()` takes them (sheetmetal.ts). Kept by the
   * operations that keep the name and color (`_like`), moved with the part. */
  _folds: readonly (readonly [number[], number[], number, number])[] = []

  override _like(brep: number): this {
    const b = super._like(brep)
    b._folds = this._folds
    return b
  }

  override _transformed(m: Matrix): Shape {
    const b = super._transformed(m) as Part
    if (this._folds.length) {
      const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
      const scale = Math.abs(det3(r)) ** (1 / 3)
      b._folds = this._folds.map(([origin, direction, radius, kf]) => {
        const o = _apply(m, new Vector(origin))
        const d = new Vector(
          r[0] * direction[0] + r[1] * direction[1] + r[2] * direction[2],
          r[3] * direction[0] + r[4] * direction[1] + r[5] * direction[2],
          r[6] * direction[0] + r[7] * direction[1] + r[8] * direction[2],
        ).normalized()
        return [o.toArray(), d.toArray(), radius * scale, kf] as const
      })
    }
    return b
  }

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
    if ((p.exhausted ?? -1) >= 0) _unmeasurable(this, Number(p.exhausted))
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
   *
   * With `strict`, the kernel's own checks of each face, edge and vertex (`check`, all of them)
   * must find nothing too: an imported, stitched or healed body can be closed and enclose its
   * volume while its edges and vertices lie farther from its faces than their tolerances allow. (Of
   * 1471 Boolean results of a random test campaign that `isValid()` accepts, 34 fail the strict
   * test.)
   */
  isValid(options: { strict?: boolean } = {}): boolean {
    _opts('Part.isValid', options)
    // (the checks first: measuring stores refitted trim curves in the body)
    if (options.strict && k.brep_face_count(this._brep) && this.check(2).length) return false
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

  /** The separate bodies of this part: those that share no face, a body inside a cavity of another
   * (a captive part) too. Cells of a merged part that touch stay one solid (see `merge`); a body
   * keeps its cavities. */
  solids(): ShapeList<Part> {
    const parts: number[] = kernelCall('solids', () => ext.separate_bodies(this._brep))
    return _list(parts.flatMap((b) => _islands(Part._wrap(b, { name: this.name, color: this.color }))))
  }

  /**
   * The closed sheets that bound the part, each a `Shell` of copies of its faces (joined along
   * their edges): first the outside of each solid, then the wall of each cavity (and the outside of
   * a body that floats in one). For a part with a cavity, `shells()[1]` is the cavity's wall: the
   * faces to check the wall thickness on or to put a boundary condition on, which
   * `part.faces().derivedFrom(part.shells()[1])` selects on the part itself. Faces between two
   * cells of a merged part bound no space around it and lie in no shell (see `ShapeList.shared`).
   */
  shells(): ShapeList<Shell> {
    const [shells] = _shellsOf(this)
    const order = [...shells.filter((s) => s.kind === 'outside'), ...shells.filter((s) => s.kind === 'void')]
    const kfaces: number[] = k.brep_faces(this._brep)
    return _list(
      order.map((s) =>
        Shell._wrap(
          _held(kernelCall('shells', () => ext.copy_faces(this._brep, (s.faces as number[]).map((i) => kfaces[i]))), (h) =>
            kernelCall('shells', () => k.stitch_into_shell(h.brep)), // (the copies' edges joined again)
          ),
        ),
      ),
    )
  }

  /** The cavities of the part (closed spaces inside it, kernel plan T7), each a part of its own: the
   * space inside a cavity's wall, less a body that floats in it. With them the part fills its
   * outside: `part.volume` plus their volumes. Empty for a part without cavities. `info()` counts
   * them. */
  voids(): ShapeList<Part> {
    const regions: number[][] = kernelCall('voids', () => ext.void_shells(this._brep))
    const solids = regions.map((shells) => shells.map((b) => Part._wrap(b)))
    return _list(
      solids.map(([wall, ...inside]) => {
        const cavity = inside.length ? wall.cut(inside) : wall
        const problem = cavity._solidProblem()
        if (problem !== null) throw new ModelingError(`voids: a cavity came out as a body that is ${problem}`)
        return cavity
      }),
    )
  }

  /** Counts and measures in one object: as for every body, and `solids` (how many `solids()`) and
   * `voids` (how many cavities, `voids()`). */
  override info(): { type: string; faces: number; edges: number; vertices: number; bbox: [number[], number[]]; corners?: string; solids: number; voids: number } {
    const [shells, faces] = _shellsOf(this)
    const root = new Map<number, number>()
    for (const s of shells) if (s.kind === 'cell') root.set(s.cell, s.cell)
    const find = (c: number): number => {
      while (root.get(c) !== c) {
        root.set(c, root.get(root.get(c)!)!)
        c = root.get(c)!
      }
      return c
    }
    for (const between of faces) for (const c of between.slice(1)) root.set(find(c), find(between[0])) // cells that share a face are one solid
    const solids = new Set([...root.keys()].map(find)).size
    const voids = new Set(shells.filter((s) => s.kind === 'void').map((s) => s.region)).size
    return { ...super.info(), solids, voids }
  }

  /**
   * This part and others as one part made of cells. Where parts overlap, the overlap becomes a
   * cell of its own; cells that touch share the faces between them (each such face bounds two
   * cells: the body is non-manifold). For simulation meshes that must match across materials, and
   * for models of several materials.
   *
   * `cells()` gives the cells as parts of their own, each named and colored after the parts it lies
   * in (`cell.sources`); `volume` is the volume of the union. A merged part is not a manifold solid:
   * `isValid()` is false, and Booleans, fillets and shells take its cells rather than the part
   * itself. `exportStep` writes each cell as a solid of its own, with its name and color.
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
    merged._h.merged = { parts: [this as Part, ...(tools as Part[])], placement: _identity(), cells: null }
    return merged
  }

  /** For a cell of a merged part (see `cells`): the parts given to `merge` whose material it lies in,
   * in the order they were given (a cell where two parts overlap lies in both; a part that was itself
   * merged stands for the parts it was merged from). They are the parts as given, not moved along
   * with the merged part. Empty for other parts. */
  get sources(): Part[] {
    return [...(this._h.sources ?? [])]
  }

  /**
   * The cells of a part made by `merge`, each as a part of its own (every closed region of the
   * body; a cavity is not a cell). A part that is one solid: `[itself]`.
   *
   * Each cell is named and colored after the parts given to merge that it lies in (its `sources`):
   * the names joined by `&` ("steel&brass" where a steel and a brass part overlap), the color of the
   * last of them that has one; the merged part's own name and color where none of them has one. The
   * kernel keeps no record of the parts: smlibwasm classifies a point inside each cell against them.
   */
  cells(): ShapeList<Part> {
    const d = ext.brep_dump(this._brep, false)
    if (d.regions.filter((r: { infinite: boolean; void: boolean }) => !r.infinite && !r.void).length <= 1) return new ShapeList(this)
    const regions: number[][] = kernelCall('cells', () => ext.region_shells(this._brep))
    const solids = regions.map((shells) => shells.map((b) => Part._wrap(b, { name: this.name, color: this.color })))
    let sources: Part[][] | null = null
    try {
      sources = _cellSources(this, solids)
    } catch (e) {
      if (!(e instanceof ModelingError) && !(e instanceof RangeError)) throw e // (the cells still come, named as the merged part)
    }
    const touching = 'an insert that touches the part around it at a point or along a line can do this: move it off the wall or into it'
    const out = new ShapeList<Part>()
    for (const [outer, ...cavities] of solids) {
      let part: Part
      try {
        part = cavities.length ? outer.cut(cavities) : outer
      } catch (e) {
        if (!(e instanceof ModelingError)) throw e
        // (the cut's own hint is about tools, which the user did not give)
        const why = e instanceof KernelError ? (e.status ? `the kernel's cut failed (${e.status})` : "the kernel's cut failed") : "the kernel's cut returned no sound solid"
        const gap = 1e-6 * Math.max(outer._extent(), 1)
        const insert = cavities.find((c) => outer.distanceTo(c) <= gap)
        let where = touching
        if (insert !== undefined) {
          const c = insert._looseBox().center
          where = `the insert at (${_formatG(c.x, 4)}, ${_formatG(c.y, 4)}, ${_formatG(c.z, 4)}) touches the part around it at a point or along a line: move it off the wall or into it`
        }
        throw new ModelingError(`cells: the cells inside a cell could not be cut out of it (${why}); ${where}`)
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
      if (sources !== null) {
        part._h.sources = sources[out.length]
        ;[part.name, part.color] = _sourceLabel(sources[out.length], this.name, this.color)
      }
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
    if (!tools.every((t) => t instanceof Part)) {
      // A sheet encloses no volume: the kernel's Boolean of a part and a sheet imprints the sheet
      // or keeps a piece of it, in a body that is no solid.
      if (op === k.BooleanOp.INTERSECTION && tools.length === 1) return (tools[0] as Shell).intersect(this) as Any // the piece of the sheet inside the part
      const kind = _typeName(tools.find((t) => !(t instanceof Part)))
      throw new TypeError(
        `cannot ${name} a ${kind} with a Part: a sheet encloses no volume; to split the part along it use part.split(sheet), ` +
          `to cut its outline into the part's faces part.imprint(sheet), to trim the sheet sheet - part or sheet & part`,
      )
    }
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
    if (parts.length === 1) {
      const retry = this._nurbsRetry(parts, op, name)
      if (retry !== null) return retry
    } else {
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
      const retry = this._nurbsRetry(parts, op, name)
      if (retry !== null) return retry
    }
    const broken = [this as Part, ...parts].filter((x) => x._solidProblem() !== null)
    if (broken.length) {
      const which = broken[0] === this ? 'the part' : 'a tool'
      throw new ModelingError(`${name}: ${which} is not a valid solid (${broken[0]._solidProblem()}); check isValid() of the operands and fix the step that broke them`)
    }
    const hint = this._booleanHint(parts, op, name, failure)
    if (failure !== null) {
      const error = new KernelError(failure.operation, failure.detail, failure.status, hint)
      ;(error as Any).cause = failure
      throw error
    }
    throw new ModelingError(`${name}: the kernel returned a result that is ${problem}; ${hint}`)
  }

  /** What a Boolean that failed says, from what the operands show (kernel plan B19): that the kernel
   * crashed or failed inside (a null pointer of its own); that a tool runs beside a parallel hole or
   * boss of the part (the B10 case the NURBS retry did not save), which the tools of both cuts
   * combined avoid; that the operands only touch (no point of one lies inside the other), or that a
   * round face of a tool touches a face of the part tangentially; that a face of a tool lies on a
   * face of the part; that several tools were also tried combined. With none of these, that none of
   * them shows. */
  _booleanHint(tools: readonly Part[], op: number, name: string, failure: KernelError | null): string {
    const clauses: string[] = []
    const crash = _crashNote(failure, name)
    if (crash !== null) clauses.push(`${crash}, a defect of the kernel rather than of the operands; moving or turning a tool a little may avoid it`)
    const near = tools.filter((t) => !_disjoint(this._looseBox(), t._looseBox(), 1e-6 * this._extent()))
    const contacts = near.map((t) => _surfaceContacts(this, t))
    if (contacts.some((c) => c.beside)) {
      clauses.push(
        'a tool runs beside a parallel hole or boss of the part and overlaps it (smlibwasm tried it again as a NURBS copy, which failed too): combine the tools first and apply them at once, this one and the one that made that hole or boss: part.cut(tool1.fuse(tool2))',
      )
    }
    // (points classified, not the meshes' Boolean: that crashes on meshes of tangent cylinders)
    const touching = crash === null && near.some((t) => _classifiedEmpty(this, [t], k.BooleanOp.INTERSECTION))
    if (touching) clauses.push('the operands touch only along an edge, at a point or tangentially (no point of one lies inside the other): move one so they overlap, or apart')
    else {
      const tangent = contacts.find((c) => c.tangent !== null)?.tangent
      if (tangent != null) clauses.push(`a round face of a tool touches a face of the part tangentially (${tangent}): move the tool so that it cuts into that face, or stays clear of it`)
    }
    const coincident = contacts.find((c) => c.coincident !== null)?.coincident
    if (coincident != null) clauses.push(`a face of a tool lies on a face of the part (${coincident}): let the tool reach past that face, or stop short of it`)
    if (tools.length > 1) clauses.push('smlibwasm also applied the tools combined into one, which failed too: apply them one at a time to find the one that fails')
    if (!clauses.length) {
      clauses.push(
        'the operands neither only touch, nor have faces on or tangent to each other, nor is a tool beside a parallel hole; move or turn a tool a little, and check isValid({ strict: true }) of the operands',
      )
    }
    return clauses.join('; ')
  }

  /** The Boolean again with a NURBS copy of each tool that has a cylinder or cone parallel to one
   * of the part (or of an earlier tool), off its axis, where their faces overlap: a tool beside an
   * earlier hole or boss (kernel plan B10). The kernel fails there with the analytic tool and gets
   * the right body with the NURBS one, whose faces come back analytic. Null where no tool is such a
   * tool, or the retry fails or is wrong too. */
  _nurbsRetry(tools: readonly Part[], op: number, name: string): Part | null {
    const nurbs = tools.map((t, i) => [this as Part, ...tools.slice(0, i)].some((x) => _parallelRounds(x, t)))
    if (!nurbs.some(Boolean)) return null
    try {
      const retry = this._like(this._runBoolean(tools.map((t, i) => (nurbs[i] ? t.toNurbs() : t)), op, name))
      if (this._booleanProblem(retry, tools, op) !== null || _volumeProblem(retry, this, tools, op)) return null
      return retry
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      return null
    }
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
      if (_disjoint(this._looseBox(), tools[0]._looseBox())) return null
      return _emptyIsRight(this, tools, op) ? null : 'empty'
    }
    // The tools must be able to cover the part, and the part's mesh must have nothing left outside
    // theirs. (An intersection of the part and a tool, which confirmed an empty cut before, can fail
    // the same way as the cut: a tool beside an earlier hole in a sphere made the cut empty and the
    // intersection the whole part.)
    if (!_canCover(tools, this)) return 'empty'
    const near = tools.filter((t) => !_disjoint(t._looseBox(), this._looseBox()))
    return near.length && _emptyIsRight(this, near, op) ? null : 'empty'
  }

  /** Union with other parts (Python's `+`). */
  fuse(...others: (Part | Iterable<Part>)[]): Part {
    return this._boolean(others, k.BooleanOp.UNION, 'fuse')
  }

  /** Subtract other parts (Python's `-`). */
  cut(...others: (Part | Iterable<Part>)[]): Part {
    return this._boolean(others, k.BooleanOp.DIFFERENCE, 'cut')
  }

  /** Keep only the volume shared with the other parts (Python's `&`). With one sheet (a Shell or
   * a face) instead: the piece of the sheet inside the part, as a Shell (`sheet.intersect(part)`). */
  intersect(sheet: Shell | Face): Shell
  intersect(...others: (Part | Iterable<Part>)[]): Part
  intersect(...others: unknown[]): Part | Shell {
    return this._boolean(others, k.BooleanOp.INTERSECTION, 'intersect')
  }

  // -- topology selection on this part ------------------------------------------------------
  /** Kernel edges of this part for the given edge selection. An edge of an earlier version of the
   * part stands for the edges of this one that descend from it (the pieces a cut left of it, the
   * edge it was merged into); one of a body this part does not descend from, for the edge in the
   * same place. */
  _ownEdges(edges: unknown): number[] {
    const sel = _flattenEdges(edges)
    const out: number[] = []
    let candidates: [number, Vector, Vector, Vector][] | null = null
    const tol = 1e-6 * Math.max(1, this.bbox().diagonal)
    const foreign = sel.filter((e) => !(e._e && e._owner !== null && e._owner._h === this._h))
    const mapped = new Map<Edge, number[]>()
    if (foreign.length) _descendants(this, foreign, false).forEach((d, i) => mapped.set(foreign[i], d))
    for (const e of sel) {
      if (e._e && e._owner !== null && e._owner._h === this._h) {
        out.push(e._e)
        continue
      }
      const descendants = mapped.get(e)
      if (descendants?.length) {
        out.push(...descendants)
        continue
      }
      // An edge of another body: match by geometry.
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
    return [...new Set(out)]
  }

  /** Kernel faces of this part for the given face selection: as `_ownEdges`. */
  _ownFaces(faces: unknown): number[] {
    const sel = _flattenFaces(faces)
    const out: number[] = []
    const tol = 1e-6 * Math.max(1, this.bbox().diagonal)
    let ownFaces: Face[] | null = null
    const foreign = sel.filter((f) => !(f._owner !== null && f._owner._h === this._h))
    const mapped = new Map<Face, number[]>()
    if (foreign.length) _descendants(this, foreign, true).forEach((d, i) => mapped.set(foreign[i], d))
    for (const f of sel) {
      if (f._owner !== null && f._owner._h === this._h) {
        out.push(f._f)
        continue
      }
      const descendants = mapped.get(f)
      if (descendants?.length) {
        out.push(...descendants)
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
    return [...new Set(out)]
  }

  /** The selected edges without seams and tangent (smooth) edges, which cannot be rounded. */
  /** A selection of edges as edges of this part: an edge of an earlier version of the part
   * becomes the edges that descend from it (its pieces, the edge it was merged into), with its entry
   * of `sizes` (one per selected edge) repeated for each; one of a body this part does not descend
   * from, the edge in the same place (see `_ownEdges`). The checks of fillets and chamfers then
   * measure the edges that are rounded. */
  _resolved(edges: unknown, sizes: number[] | null = null): [Edge[], number[] | null] {
    const sel = _flattenEdges(edges)
    if (sel.every((e) => e._e && e._owner !== null && e._owner._h === this._h)) return [sel, sizes]
    const out: Edge[] = []
    const grown: number[] = []
    const perEdge = sizes !== null && sizes.length === sel.length
    sel.forEach((e, i) => {
      const mine = this._ownEdges([e]).map((ke) => Edge._of(this, ke))
      out.push(...mine)
      if (perEdge) for (const _ of mine) grown.push(sizes[i])
    })
    return [out, perEdge ? grown : sizes]
  }

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
  _checkRoundSizes(edges: readonly Edge[], setbacks: readonly (number | Map<string, number>)[], what: string, sizeName: string): void {
    // (a setback is one for both faces of an edge, or one per face, by the face's identity: an asymmetric chamfer)
    const on = (setback: number | Map<string, number>, f: Face): number =>
      typeof setback === 'number' ? setback : setback.get(f._identity()) ?? Math.max(...setback.values())
    const setbackOf = new Map<string, number | Map<string, number>>()
    edges.forEach((e, i) => setbackOf.set(e._identity(), setbacks[i]))
    edges.forEach((e, i) => {
      const s = setbacks[i]
      const ends = new Set(e.vertices().map((v) => v._identity()))
      const samples = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => e.pointAt(t))
      for (const f of e.faces()) {
        for (const g of f.edges()) {
          if (g._identity() === e._identity() || g.vertices().some((v) => ends.has(v._identity()))) continue // the same edge, or a neighbour meeting it at a corner
          const other = setbackOf.get(g._identity())
          const total = on(s, f) + (other === undefined ? 0 : on(other, f))
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
   * `_roundCall` for a fillet or chamfer of `sel`. Without `propagate`, a failure names a selected
   * edge that runs on tangentially into an edge that is not selected, if there is one: the kernel
   * cannot always round such an edge alone (a top edge of a plate with rounded corners, at any
   * radius), and its own status says nothing about it.
   */
  static _rounding<T>(what: string, fn: () => T, hint: string, sel: readonly Edge[], propagate: boolean): T {
    try {
      return _roundCall(what, fn, hint)
    } catch (e) {
      if (!(e instanceof KernelError) || propagate) throw e
      const better = _runOnHint(sel, what)
      if (better === null) throw e
      const error = new KernelError(e.operation, e.detail, e.status, better)
      ;(error as Any).cause = e
      throw error
    }
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
   *
   * Where three rounds meet, the corner patch is tangent continuous (G1) only, also with
   * `continuity: "G2"` or `"G3"`: zebra stripes kink there (the kernel's corner patches are G1
   * whatever the continuity of the rounds).
   *
   * A round the kernel cannot build throws a KernelError naming the corner or edge its fillet code
   * could not build, where it recorded one.
   */
  fillet(edges: unknown, radius: FilletRadius, options: FilletOptions = {}): Part {
    _opts('Part.fillet', options)
    const { continuity = null, fullness = 1.0, propagate = true, corners = 'patch' } = options
    this._requireValid('fillet')
    const mitre = _cornerStyle('fillet', corners)
    const varying = typeof radius === 'object' && !Array.isArray(radius) && !ArrayBuffer.isView(radius) ? (radius as { start: number; end: number }) : null
    const list = Array.isArray(radius) || ArrayBuffer.isView(radius) ? Array.from(radius as ArrayLike<number>, Number) : null
    const given = varying ? [varying.start, varying.end].map(Number) : list ?? [Number(radius)]
    if (given.some((r) => !(r > 0))) throw new RangeError('fillet: the radius must be positive')
    if (varying && continuity != null && given[0] !== given[1]) {
      // the kernel makes a ruled chamfer of it, not tangent to the faces
      throw new RangeError('fillet: a (start, end) radius makes circular rounds only; continuity needs a constant radius')
    }
    const [resolved, sizes] = this._resolved(edges, list)
    const selection = this._sharpEdges(resolved, 'fillet')
    if (sizes && sizes.length !== selection.length) throw new RangeError(`${sizes.length} radii for ${selection.length} edges`)
    const [sel, src] = propagate ? _tangentChains(selection) : [selection, selection.map((_, i) => i)]
    const perEdge = sizes ? src.map((i) => sizes[i]) : null
    if (varying && Number(varying.start) !== Number(varying.end)) {
      if (sel.length > selection.length) {
        const g = sel[selection.length]
        const from = sel[src[selection.length]]
        const p = g.vertices().map((v) => v.point).reduce((a, b) => (from.distanceTo(b) < from.distanceTo(a) ? b : a))
        throw new RangeError(
          `fillet: a (start, end) radius runs along each edge on its own, and a selected edge runs on tangentially into another edge at ${_fmtPoint(p)}, which propagate=True rounds with it; give a constant radius, or propagate=False to round the selected edges only`,
        )
      }
      Part._checkRadiusLaw(sel)
    }
    let radii: number[]
    if (varying) radii = new Array(sel.length).fill(Math.max(varying.start, varying.end))
    else if (perEdge) radii = perEdge
    else radii = new Array(sel.length).fill(Number(radius))
    this._checkRoundSizes(sel, sel.map((e, i) => Part._setback(e, radii[i])), 'fillet', 'radius')
    if (mitre) _requireMitredCorners('fillet', sel)
    const cont = _continuity(continuity)
    const hint = 'the radius may be too large for the selected edges'
    const section = cont === null ? 1 : 2 // circular, or a blend curve
    const attempt = (factor: number): Part => {
      const [h, kedges] = this._withEdges(sel)
      Part._rounding(
        'fillet',
        () => {
          if (varying) {
            _roundEdges('fillet', hint, h.brep, kedges, sel, [Number(varying.start)], [section], {
              law: [Number(varying.start), Number(varying.end)],
              continuity: cont || 1,
              toleranceFactor: factor,
              mitre,
            })
          } else if (perEdge) {
            _roundEdges('fillet', hint, h.brep, kedges, sel, perEdge, new Array(kedges.length).fill(section), {
              continuity: cont || 1,
              thumbweight: fullness,
              toleranceFactor: factor,
              mitre,
            })
          } else {
            _roundEdges('fillet', hint, h.brep, kedges, sel, [Number(radius)], [section], { continuity: cont || 1, thumbweight: fullness, toleranceFactor: factor, mitre })
          }
        },
        hint,
        sel,
        propagate,
      )
      const result = this._like(_take(h))
      this._checkVolumeChange(result, sel, 'fillet', radii, cont === null ? 'circular' : 'blend')
      return result
    }
    return _withFinerRounds(attempt)
  }

  /**
   * Bevel edges. `length` is the setback measured along both adjacent faces.
   *
   * An asymmetric bevel: `length2` is the setback on the other face of each edge, `length` the one on
   * its `reference` face; or `angle` (degrees) is the angle between the bevel and the reference face
   * (`length2` follows from it: `length * tan(angle)` where the faces meet at 90 degrees). `reference`
   * is a face of this part (or several) that each edge lies on; `length2` and `angle` need it.
   *
   * The faces of each edge must meet at the same angle all along it (within 1 degree); where they
   * do not (a hole into a tilted or curved face), use `fillet`.
   *
   * `propagate` bevels the edges that continue the selected ones tangentially too
   * (`Edge.tangentChain`), as `fillet` does; `false` bevels the selected edges only. The edges a run
   * adds must lie on a reference face too.
   *
   * `corners` sets the corners where three bevelled edges meet, as for `fillet`: "patch" cuts them off
   * with a corner face, "mitre" runs the bevels on until they meet (the corners of three bevelled
   * convex edges and no other edge).
   */
  chamfer(edges: unknown, length: number, options: ChamferOptions = {}): Part {
    _opts('Part.chamfer', options)
    const { length2 = null, angle = null, reference = null, propagate = true, corners = 'patch' } = options
    this._requireValid('chamfer')
    const mitre = _cornerStyle('chamfer', corners)
    length = Number(length)
    if (!(length > 0)) throw new RangeError('chamfer: the length must be positive')
    if (length2 != null && angle != null) throw new RangeError('chamfer: give length2 or angle, not both')
    if (length2 != null && !(Number(length2) > 0)) throw new RangeError('chamfer: length2 must be positive')
    if (angle != null && !(Number(angle) > 0 && Number(angle) < 180)) throw new RangeError('chamfer: the angle must lie between 0 and 180 degrees')
    const two = angle != null || (length2 != null && Number(length2) !== length)
    if (two && reference == null) {
      throw new RangeError('chamfer: length2 and angle need reference=, the face (or faces) of each edge on which length is measured')
    }
    const refs = two ? this._ownFaces(reference) : []
    const selection = this._sharpEdges(this._resolved(edges)[0], 'chamfer')
    const selected = new Set(selection.map((e) => e._identity()))
    const sel = propagate ? _tangentChains(selection)[0] : selection
    const radii: number[] = []
    const radii2: number[] = []
    const firsts: number[] = []
    const setbacks: (number | Map<string, number>)[] = []
    let backwards: string | null = null // why an unequal bevel may fail
    for (const e of sel) {
      let fs: Face[] = [...e.faces()]
      if (two) {
        const on = fs.map((f, i) => (refs.some((r) => f._f === r) ? i : -1)).filter((i) => i >= 0)
        if (fs.length !== 2 || on.length !== 1) {
          throw new RangeError(
            `chamfer: the edge from ${_fmtPoint(e.start)} to ${_fmtPoint(e.end)} ${on.length > 1 ? 'lies on two reference faces' : 'does not lie on a reference face'}; give the face of each edge on which length is measured` +
              (on.length > 1 || selected.has(e._identity()) ? '' : ' (it continues a selected edge tangentially: add its face, or propagate=False)'),
          )
        }
        fs = [fs[on[0]], fs[1 - on[0]]]
      }
      if (fs.length === 2) {
        const p = e.center()
        const theta = _radians(fs[0].normalAt(p).angleTo(fs[1].normalAt(p)))
        const r = theta > 1e-6 ? length / Math.tan(theta / 2) : length
        const angles = Part._faceAngles(e)
        if (angles.length && Math.max(...angles) - Math.min(...angles) > _CHAMFER_ANGLE_SPREAD) {
          const [lo, hi] = [Math.min(...angles), Math.max(...angles)]
          throw new ModelingError(
            `chamfer: the faces of an edge meet at an angle that changes along it (their normals are ${_formatG(lo, 4)} to ${_formatG(hi, 4)} degrees apart), and the bevel would reach ${_formatG(r * Math.tan(_radians(lo) / 2), 4)} to ${_formatG(r * Math.tan(_radians(hi) / 2), 4)} from the edge instead of ${_formatG(length, 4)}; round such an edge with fillet(), whose radius stays the same along it`,
          )
        }
        if (two) {
          const [s1, s2] = Part._chamferSetbacks(e, theta, length, length2, angle)
          // the kernel bevels between the lines where the faces, offset by r1 and r2, meet: those lines
          // project onto the faces at the setbacks
          const r1 = (s2 + s1 * Math.cos(theta)) / Math.sin(theta)
          const r2 = (s1 + s2 * Math.cos(theta)) / Math.sin(theta)
          if (backwards === null && !(r1 > 0 && r2 > 0)) {
            // (faces that meet at an acute angle, setbacks less alike than the cosine of the angle: one
            // face's offset runs backwards, which the kernel's solver takes only so far)
            backwards = `chamfer: the faces of the edge from ${_fmtPoint(e.start)} to ${_fmtPoint(e.end)} meet at ${_formatG(180 - (theta * 180) / Math.PI, 4)} degrees, and the kernel could not bevel them with setbacks this different (${_formatG(s1, 4)} and ${_formatG(s2, 4)}); bring them closer (each at least ${_formatG(Math.cos(Math.PI - theta), 4)} times the other always works)`
          }
          radii.push(r1)
          radii2.push(r2)
          firsts.push(fs[0]._f)
          setbacks.push(new Map([[fs[0]._identity(), s1], [fs[1]._identity(), s2]]))
        } else {
          radii.push(r)
          setbacks.push(length)
        }
      } else {
        radii.push(length)
        setbacks.push(length)
      }
    }
    this._checkRoundSizes(sel, setbacks, 'chamfer', 'length')
    if (mitre) _requireMitredCorners('chamfer', sel)
    const hint = 'the length may be too large for the selected edges'
    // (the volume bound of a bevel is its triangle, half the product of its setbacks)
    const sizes = setbacks.map((b) => (typeof b === 'number' ? b : Math.sqrt([...b.values()].reduce((x, y) => x * y, 1))))
    const bevel = (keep: readonly number[]): Part => {
      // the kernel's bevels of the edges sel[i], i in keep
      const edges = keep.map((i) => sel[i])
      const rs = keep.map((i) => radii[i])
      const attempt = (factor: number): Part => {
        let h: BrepHandle
        if (two) {
          const [copy, kfaces, kedges] = ext.copy_with_map(
            this._brep,
            keep.map((i) => firsts[i]),
            this._ownEdges(edges),
            [],
          )
          h = new BrepHandle(copy)
          Part._rounding(
            'chamfer',
            () => _roundEdges('chamfer', hint, h.brep, [...kedges], edges, rs, [0], { radii2: keep.map((i) => radii2[i]), faces: [...kfaces], toleranceFactor: factor, mitre }),
            hint,
            edges,
            propagate,
          )
        } else {
          let kedges: number[]
          ;[h, kedges] = this._withEdges(edges)
          Part._rounding(
            'chamfer',
            () => {
              if (rs.every((r) => Math.abs(r - rs[0]) < 1e-12)) {
                _roundEdges('chamfer', hint, h.brep, kedges, edges, [rs[0]], [0], { toleranceFactor: factor, mitre })
              } else {
                // per-edge radii with a linear cross-section, in one call: a call per edge replaces
                // the edges next to it, and the next call would use freed edges
                _roundEdges('chamfer', hint, h.brep, kedges, edges, rs, new Array(kedges.length).fill(0), { toleranceFactor: factor, mitre })
              }
            },
            hint,
            edges,
            propagate,
          )
        }
        const result = this._like(_take(h))
        this._checkVolumeChange(
          result,
          edges,
          'chamfer',
          keep.map((i) => sizes[i]),
          'chamfer',
        )
        return result
      }
      try {
        return _withFinerRounds(attempt)
      } catch (e) {
        if (!(e instanceof ModelingError) || backwards === null) throw e // (a KernelError is a ModelingError)
        const error = new ModelingError(backwards)
        ;(error as Any).cause = e
        throw error
      }
    }
    const everything = sel.map((_, i) => i)
    const cones = this._conicalBevels(sel, setbacks)
    if (cones.size) {
      // the kernel's bevels of the other edges, then the exact ones; where one of those does not take what
      // it should (other material in its way), the kernel bevels all
      const rest = everything.filter((i) => !cones.has(i))
      const result = rest.length ? bevel(rest) : this._like(this._copyBrep())
      const applied = result._appliedBevels([...cones.values()])
      if (applied !== null) return applied
      return bevel(everything)
    }
    return bevel(everything)
  }

  /**
   * The exact bevels of the closed circular `edges` between faces coaxial with them (a plane at right
   * angles to the axis, a cylinder or a cone around it, a face of a revolve whose meridian is straight
   * there), by index: the solid of revolution each cuts off
   * (a convex edge) or fills in (a concave edge), its volume, and whether it fills in. `setbacks` holds
   * each edge's setback, or its setbacks by face. The kernel fits such bevels with B-splines (volumes off
   * by up to 1e-5 of the part's); this one is a surface of revolution of the bevel's line, exact.
   */
  _conicalBevels(edges: readonly Edge[], setbacks: readonly (number | Map<string, number>)[]): Map<number, [Part, number, boolean]> {
    const out = new Map<number, [Part, number, boolean]>()
    edges.forEach((e, i) => {
      if (!(e.isClosed && e.geomType === 'circle')) return
      const fs = [...e.faces()]
      const kind = e.convexity
      if (fs.length !== 2 || (kind !== 'convex' && kind !== 'concave')) return
      const center = e.arcCenter
      const axis = e.normal.normalized()
      const near = 1e-9 * Math.max(e.radius, 1)
      for (const f of fs) {
        if (f.geomType !== 'plane' && f.geomType !== 'cylinder' && f.geomType !== 'cone' && f.geomType !== 'revolution') return
        if (f.geomType === 'revolution') continue // (no axis to read: sampled below)
        const placement = f._surfaceInfo().placement
        if (!(Math.abs(new Vector(placement.z_dir).normalized().dot(axis)) > 1 - 1e-12)) return
        const off = new Vector(placement.origin).sub(center)
        if (f.geomType !== 'plane' && off.sub(axis.mul(off.dot(axis))).length > near) return
      }
      const setback = setbacks[i]
      const s = fs.map((f) => (typeof setback === 'number' ? setback : Number(setback.get(f._identity()))))
      const c = e.pointAt(0)
      const t = e.tangentAt(0)
      const normals = fs.map((f) => f.normalAt(c))
      const ways = [0, 1].map((j) => {
        // into each face, at right angles to the edge
        const w = normals[j].cross(t).normalized()
        return w.dot(normals[1 - j]) < 0 !== (kind === 'convex') ? w.neg() : w
      })
      if (!fs.every((f, j) => f.geomType !== 'revolution' || _straightAround(f, center, axis, c, ways[j].mul(s[j]), normals[j]))) return
      const q = c.sub(center)
      const radial = q.sub(axis.mul(q.dot(axis))).normalized()
      const rz = (p: Vector): [number, number] => [p.sub(center).dot(radial), p.sub(center).dot(axis)]
      const corner = rz(c)
      const p1 = rz(c.add(ways[0].mul(s[0])))
      const p2 = rz(c.add(ways[1].mul(s[1])))
      // the bevel's line runs on a little past both faces, and the profile closes beyond the edge, so
      // that the tool meets the faces only along the bevel (no faces on faces)
      let ext_ = 0.25
      for (const [a, b] of [
        [p1, p2],
        [p2, p1],
      ]) {
        if (a[0] < b[0]) ext_ = Math.min(ext_, (0.5 * a[0]) / (b[0] - a[0]))
      }
      const m = [0.5 * (p1[0] + p2[0]), 0.5 * (p1[1] + p2[1])]
      const profile: [number, number][] = [
        [p1[0] + (p1[0] - p2[0]) * ext_, p1[1] + (p1[1] - p2[1]) * ext_],
        [p2[0] + (p2[0] - p1[0]) * ext_, p2[1] + (p2[1] - p1[1]) * ext_],
        [2 * corner[0] - m[0], 2 * corner[1] - m[1]],
      ]
      if (Math.min(p1[0], p2[0], profile[2][0]) <= near || ext_ <= 1e-3) return // (the bevel reaches the axis)
      const area = 0.5 * Math.abs((p1[0] - corner[0]) * (p2[1] - corner[1]) - (p1[1] - corner[1]) * (p2[0] - corner[0]))
      const volume = ((2 * Math.PI * (corner[0] + p1[0] + p2[0])) / 3) * area
      const plane = new Plane(center, radial, radial.cross(axis)) // (its y direction is the axis)
      let tool: Part
      try {
        tool = Polygon(...profile)
          .on(plane)
          .revolve(new Axis(center, axis), 360)
      } catch (err) {
        if (!(err instanceof ModelingError)) throw err
        return
      }
      out.set(i, [tool, volume, kind === 'concave'])
    })
    return out
  }

  /** The part with the `tools` of `_conicalBevels` cut away, and those that fill fused on (each kind in
   * one Boolean), or null where that does not change the volume by the tools' bevels (other material in
   * their way). */
  _appliedBevels(tools: readonly [Part, number, boolean][]): Part | null {
    let result: Part = this
    for (const fills of [false, true]) {
      const group = tools.filter(([, , f]) => f === fills)
      if (!group.length) continue
      const before = Number(result._props(1e-6).volume)
      let after: Part
      try {
        after = fills ? result.fuse(group.map(([t]) => t)) : result.cut(group.map(([t]) => t))
      } catch (err) {
        if (!(err instanceof ModelingError)) throw err
        return null
      }
      if (after._solidProblem() !== null) return null
      const change = Math.abs(Number(after._props(1e-6).volume) - before)
      const volume = group.reduce((sum, [, v]) => sum + v, 0)
      if (!(Math.abs(change - volume) <= 1e-6 * volume + 1e-10 * Math.abs(before))) return null
      result = after // (a Boolean keeps the name and the color of its first operand)
    }
    return result
  }

  /**
   * The setbacks of an asymmetric chamfer of `e` on its reference face and on its other face, whose
   * normals are `theta` (radians) apart: `length` and `length2`, or the setback on the other face that
   * tilts the bevel by `angle` degrees against the reference face.
   */
  static _chamferSetbacks(e: Edge, theta: number, length: number, length2: number | null, angle: number | null): [number, number] {
    const wedge = Math.PI - theta // the angle between the faces, on the side the bevel cuts across
    if (angle == null) return [length, Number(length2)]
    const a = _radians(Number(angle))
    if (wedge + a >= Math.PI - 1e-9) {
      throw new RangeError(
        `chamfer: a bevel at ${_formatG(Number(angle), 4)} degrees to the reference face does not meet the other face of the edge from ${_fmtPoint(e.start)} to ${_fmtPoint(e.end)}, which meets it at ${_formatG((wedge * 180) / Math.PI, 4)} degrees; use an angle below ${_formatG(180 - (wedge * 180) / Math.PI, 4)}`,
      )
    }
    return [length, (length * Math.sin(a)) / Math.sin(wedge + a)]
  }

  /**
   * Hollow the part out to walls of `thickness`, removing the `openings` faces.
   *
   * The walls grow inward (the outside keeps its size) unless `outward` is true.
   *
   * `corners` says how the new side of the walls turns where the part's faces grow apart (the inside
   * of a concave edge for walls that grow inward, the outside of a convex edge and corner for walls
   * that grow outward): `'round'` keeps the wall's thickness all round with a round of radius
   * `thickness`; `'sharp'` extends the faces until they meet, so that the wall is thicker there (up
   * to `thickness / sin(a / 2)` at an edge of angle `a`). The default, null, takes `'round'` where
   * the kernel builds it and `'sharp'` where it does not; the result's `info().corners` says which.
   * Given `'round'` or `'sharp'`, a shell the kernel cannot build that way throws instead.
   *
   * `walls` gives faces walls of their own thickness: `[faces, thickness]` pairs, or a Map of faces
   * to thicknesses (`walls: [[part.faces().bottom(), 5]]`). The face of the shell across such a wall
   * is offset by the difference, and the faces around it are extended or trimmed to meet it (as
   * `offsetFaces`). Faces that meet smoothly (a wall and the round beside it) need one thickness.
   *
   * The kernel leaves the rim of an opening open where it meets its neighbours tangentially (the flat
   * top of a box rounded on all edges): planar openings of that kind, whose other rim edges meet walls
   * standing at right angles to them, are cut out of the part shelled closed instead (the inner
   * rounds then end at the rim).
   *
   * Walls that do not fit into the part (measured across it from each face), and results the
   * kernel gets wrong (faces that do not meet, no cavity, the part given back, a closed shell of the
   * wrong volume), throw a ModelingError. The kernel step runs in the probe worker (a kernel of its
   * own; on a page's main thread in this one), so that a crash of its offset code throws a
   * ModelingError too, and it is stopped after `GUARD_SECONDS` (20 s; `setGuardSeconds(seconds)`
   * raises it for large parts).
   */
  shell(thickness: number, openings: unknown = null, options: { outward?: boolean; corners?: string | null; walls?: unknown } = {}): Part {
    _opts('Part.shell', options)
    const outward = options.outward ?? false
    const corners = options.corners ?? null
    if (corners !== null && corners !== 'round' && corners !== 'sharp') {
      throw new RangeError(`shell: corners must be "round" or "sharp" (or null for either), not '${corners}'`)
    }
    this._requireValid('shell')
    if (!(Math.abs(Number(thickness)) > 0)) throw new RangeError('shell: the thickness must not be zero')
    const faces = openings != null ? this._ownFaces(openings) : []
    const t = Math.abs(Number(thickness))
    const own = options.walls != null ? _wallThicknesses(this, options.walls, t, faces) : []
    if (own.length) {
      const shelled = this.shell(thickness, faces.map((f) => new Face(this, f)), { outward, corners })
      return _made(shellWalls(this, shelled, own, t, outward, !faces.length), _MADE.get(shelled._h) ?? {})
    }
    const rays = this._inwardRays(faces)
    if (!outward) this._checkWallFits(t, faces, rays)
    const d = outward ? t : -t
    const hint = corners === null ? this._shellHint(faces, t, rays, outward) : `${this._shellHint(faces, t, rays, outward)}, or try corners="${corners === 'round' ? 'sharp' : 'round'}"`
    const cut = this._openingsToCut(faces, t, outward)
    if (cut.length) {
      // The kernel leaves the rim of such an opening open (its inner rounds run up to the outer edge, and
      // their edges lie off their faces): shell the part without them, then cut each out.
      const byCutting = (): Part => {
        const rest = faces.filter((f) => !cut.includes(f))
        const base = this.shell(thickness, rest.map((f) => new Face(this, f)), { outward, corners })
        return _made(base._cutOpenings(cut.map((f) => new Face(this, f)), t, outward), _MADE.get(base._h) ?? {})
      }
      return this._checked('shell', [[true, byCutting]], {
        grow: outward ? t : 0,
        smaller: outward ? null : true,
        problem: (result) => this._shellProblem(result, d, faces, rays, true, () => 0),
        hint,
      })
    }
    const offsets = new Map<boolean, number>() // volume of the part offset by d, by mode (for a closed shell)
    const offsetVolume = (extended: boolean): number => {
      if (!offsets.has(extended)) {
        const work = (): number => kernelCall('shell', () => k.offset_brep(this._brep, d, { extended_offset: extended }))
        const off = Part._wrap(_isolated('shell', work, () => ({ op: 'offset_brep', bodies: [_smb(this)], tags: [_carried(this._brep)], distance: d, options: { extended_offset: extended } })))
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
      const job = (): _Job => ({ op: 'shell_brep', bodies: [_smb(this)], tags: [_carried(this._brep)], distance: d, options: { extended_offset: extended }, faces: _faceIndices(this, faces) })
      // (The plain mode rolls a ball where the faces grow apart, the extended one extends them until
      // they meet.)
      return _made(this._like(_isolated('shell', work, job, hint)), { corners: extended ? 'sharp' : 'round' })
    }
    const modes = corners === 'round' ? [false] : corners === 'sharp' ? [true, true] : [false, true, true]
    return this._checked(
      'shell',
      modes.map((m): [boolean, () => Part] => [m, () => attempt(m)]),
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

  /**
   * The openings `shell` cuts out of the part shelled without them (see `_cutOpenings`): when one has a
   * rim edge that meets its neighbour tangentially (the kernel leaves such a rim open), the planar ones
   * whose rim edges all do, or (walls growing inward) meet walls that stand at right angles to the
   * opening for at least the wall's thickness (the cavity's face under the opening then ends where the
   * inner walls do). An opening next to another one is left to the kernel, and so are all of them when
   * an opening with a tangent rim is not such a face: then [].
   */
  _openingsToCut(openings: readonly number[], t: number, outward: boolean): number[] {
    const kinds: [number, boolean, boolean][] = [] // kernel face, has a tangent rim edge, can be cut out
    for (const kf of openings) {
      const f = new Face(this, kf)
      let smooth = false
      let fits = f.isPlanar
      const n = fits ? f.normalAt() : null
      for (const e of f.edges()) {
        const others = e.faces().filter((g) => g._f !== kf)
        if (others.length !== 1 || openings.includes(others[0]._f)) {
          fits = false // a seam, or the edge of another opening
          continue
        }
        if (e.convexity === 'smooth') smooth = true
        else if (fits && (outward || !Part._straightWall(e, others[0], n!, t))) fits = false
      }
      kinds.push([kf, smooth, fits])
    }
    if (!kinds.some(([, smooth]) => smooth) || kinds.some(([, smooth, fits]) => smooth && !fits)) return []
    return kinds.filter(([, smooth]) => smooth).map(([kf]) => kf)
  }

  /** True if `wall` stands at right angles to the opening's normal `n` along its edge `e` and keeps
   * doing so for `t` beneath it (a plane, or a cylinder or extrusion along `n`). */
  static _straightWall(e: Edge, wall: Face, n: Vector, t: number): boolean {
    try {
      for (const u of [0.25, 0.5, 0.75]) {
        const p = e.pointAt(u)
        const m = wall.normalAt(p)
        const q = p.sub(n.mul(t))
        if (Math.abs(m.dot(n)) > 1e-6 || wall.distanceTo(q) > 1e-6 * Math.max(t, 1.0)) return false
        if (wall.normalAt(q).angleTo(m) > 1e-3) return false
      }
    } catch (e) {
      if (!(e instanceof KernelError || e instanceof RangeError)) throw e
      return false
    }
    return true
  }

  /**
   * This shell (of a part, made without `openings`) with each opening cut out: the cavity's face under
   * it (the part's face offset by `t`, or for walls grown outward the face itself) extruded through the
   * wall. Throws a ModelingError where there is no such face, or where a cut takes more than the wall
   * over that face (the part reaches over the opening).
   */
  _cutOpenings(openings: readonly Face[], t: number, outward: boolean): Part {
    let out: Part = this
    for (const f of openings) {
      const n = f.normalAt()
      const depth = outward ? 0 : t
      const under = f.interiorPoint().sub(n.mul(depth))
      const tol = 1e-6 * Math.max(this._extent(), 1.0)
      const caps = out.faces().filter((g) => g.isPlanar && g.normalAt().dot(n) < -1 + 1e-9 && g.distanceTo(under) <= tol)
      if (caps.length !== 1) {
        throw new ModelingError(`shell: the part shelled closed has no single face under the opening at ${_fmtPoint(f.center())} to cut it out from`)
      }
      const g = caps[0]
      if (g.area > f.area * (1 + 1e-9) + tol || g.vertices().some((v) => f.distanceTo(v.point.add(n.mul(depth))) > tol)) {
        throw new ModelingError(`shell: the face under the opening at ${_fmtPoint(f.center())} reaches past the opening`)
      }
      const sk = g.toSketch()
      const amount = 1.5 * t
      const prism = sk.extrude(sk.plane.zDir.dot(n) > 0 ? amount : -amount) as Part
      const before = Number(out._props(1e-6).volume)
      const cut = kernelCall('shell', () => out.cut(prism), 'the opening could not be cut out of the part shelled closed')
      const removed = before - Number(cut._props(1e-6).volume)
      const expect = g.area * t
      if (!(Math.abs(removed - expect) <= 1e-6 * before + 1e-4 * expect)) {
        throw new ModelingError(
          `shell: cutting the opening at ${_fmtPoint(f.center())} out of the part shelled closed took ${_formatG(removed, 10)} instead of the wall over it, ${_formatG(expect, 10)} (the part reaches over the opening)`,
        )
      }
      out = cut
    }
    return out
  }

  /** What a failed shell says: that the kernel cannot open a face whose rim meets its neighbours
   * tangentially (the flat top of a rounded box), or else that the wall may be too thick. */
  _shellHint(openings: readonly number[], t: number | null = null, rays: readonly [Vector, Vector, number, boolean][] = [], outward = false): string {
    for (const kf of openings) {
      for (const e of new Face(this, kf).edges()) {
        if (e.convexity === 'smooth') {
          return 'the kernel cannot open a face whose rim meets its neighbours tangentially; shell the part before rounding the rim, or shell it closed and cut the opening out'
        }
      }
    }
    // where the walls of t fit worst (kernel plan B19)
    if (t !== null) {
      // (outward: a hole or inside round tighter than the wall, which the outer wall closes; inward,
      // the kernel's extended mode makes the inner wall sharp where a round is tighter, and succeeds)
      const tight = outward ? this._tightestRound(openings, outward) : null
      if (tight !== null && tight[0] < t) {
        const [r, p] = tight
        return `the hole or inside round at (${_formatG(p.x, 4)}, ${_formatG(p.y, 4)}, ${_formatG(p.z, 4)}) has a radius of ${_formatG(r, 4)}, less than the wall of ${_formatG(t, 4)}, and the outer wall would close it; shell the part before cutting or rounding it there, or use a thinner wall`
      }
      if (!outward && rays.length) {
        const [p, , depth, opening] = rays.reduce((a, b) => (b[2] / (b[3] ? 1 : 2) < a[2] / (a[3] ? 1 : 2) ? b : a))
        const walls = opening ? 1 : 2
        if (depth < (walls + 1) * t) {
          return `the part is ${_formatG(depth, 4)} thick across the face at (${_formatG(p.x, 4)}, ${_formatG(p.y, 4)}, ${_formatG(p.z, 4)}), room for ${walls === 1 ? 'a wall' : 'two walls'} of ${_formatG(t, 4)} and little more; use a thinner wall`
        }
      }
    }
    return 'the wall may be thicker than the part allows'
  }

  /** The radius and a point of the tightest cylinder, sphere or torus (its tube) of the part that is
   * not an opening and that walls growing inward (`outward`: outward) shrink: a round of a convex
   * edge, a boss (a hole); null where there is none. */
  _tightestRound(openings: readonly number[], outward: boolean): [number, Vector] | null {
    let best: [number, Vector] | null = null
    for (const f of k.brep_faces(this._brep) as number[]) {
      if (openings.includes(f)) continue
      const info = ext.surface_data(k.face_surface(f), false)
      const kind: string = info.kind
      let r: number
      if ((kind === 'cone' && Math.abs(info.semi_angle_deg ?? 1) < 1e-12) || kind === 'cylinder') r = Number(info.radius)
      else if (kind === 'sphere') r = Number(info.radius ?? 0)
      else if (kind === 'torus') r = Number(info.minor_radius ?? 0)
      else continue
      if (!(r > 0) || (best !== null && r >= best[0])) continue
      const face = new Face(this, f)
      let p: Vector
      let n: Vector
      try {
        p = face.interiorPoint()
        n = face.normalAt(p)
      } catch (e) {
        if (!_isRuntimeError(e) && !(e instanceof RangeError)) throw e
        continue
      }
      // the center of the round: on the axis (cylinder), the center (sphere), on the tube's center
      // circle (torus)
      const o = new Vector(info.placement.origin)
      const d = new Vector(info.placement.z_dir).normalized()
      let center: Vector
      if (kind === 'sphere') center = o
      else if (kind === 'torus') {
        const q = p.sub(d.mul(p.sub(o).dot(d)))
        center = o.add(q.sub(o).normalized().mul(Number(info.major_radius)))
      } else center = o.add(d.mul(p.sub(o).dot(d)))
      const convex = p.sub(center).dot(n) > 0 // the outward normal points away from the center
      if (convex !== outward) best = [r, p]
    }
    return best
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
   * `corners: "sharp"` (the default) moves each face by `distance` and extends the faces until they
   * meet again: edges and corners stay sharp, and an edge whose faces meet at an angle `a` moves out
   * by `distance / sin(a / 2)`. `"round"` rolls a ball of radius `distance` along the part: where
   * faces grow apart (the convex edges and corners of a growing part) it fills in cylinders and
   * spheres, so that every point of the result lies at `distance` from the part (a clearance body,
   * the skin of an overmould). Shrinking with `"round"` rounds the concave edges, which grow apart
   * inward; the convex ones stay sharp. The sharp mode fails where faces would vanish or cross (an
   * acute wedge, a hole that closes, a groove narrower than twice the distance); the rounded mode
   * builds those.
   *
   * Results the kernel gets wrong (faces that do not meet, a change of the wrong sign) throw a
   * ModelingError. The kernel step runs in the probe worker and is stopped after `GUARD_SECONDS`
   * (20 s), as for `shell`. */
  offset(distance: number, options: { corners?: string } = {}): Part {
    _opts('Part.offset', options)
    const { corners = 'sharp' } = options
    if (corners !== 'sharp' && corners !== 'round') throw new RangeError(`offset: corners must be "sharp" or "round" for a part, not '${corners}'`)
    this._requireValid('offset')
    const d = Number(distance)
    if (d === 0) return this._like(this._copyBrep())
    const extended = corners === 'sharp' // (the kernel's extended mode extends the faces, the other one rolls)
    const hint = extended
      ? 'try a smaller distance, or corners="round", which rounds the edges whose faces grow apart instead of extending the faces (it builds acute wedges and holes that close)'
      : 'try a smaller distance'
    const work = (): number => kernelCall('offset', () => k.offset_brep(this._brep, d, { extended_offset: extended }), hint)
    // (the kernel's offset code can crash, mostly in its extended mode, which depends on memory layout:
    // it runs in the probe worker, smlibpy: in a copy of its process)
    const attempt = (): Part =>
      _made(this._like(_isolated('offset', work, () => ({ op: 'offset_brep', bodies: [_smb(this)], tags: [_carried(this._brep)], distance: d, options: { extended_offset: extended } }), hint)), {
        corners,
      })
    if (!extended) {
      // every point lies at |d| from the part: in its box grown by d; a repeat gives the same
      return this._checked('offset', [[false, attempt]], { grow: Math.max(d, 0), smaller: d < 0, hint })
    }
    // the sharp mode moves edges and corners farther than d (a cone's base edge by d / sin(a / 2))
    const wider = d > 0 ? (): number => d * _SHARP_OFFSET_SLACK * Math.min(this._sharpOffsetReach(), _SHARP_OFFSET_REACH) : null
    return this._checked(
      'offset',
      [
        [true, attempt],
        [true, attempt],
      ],
      { grow: Math.max(d, 0), wider, smaller: d < 0, hint },
    )
  }

  /** How far a sharp offset by 1 (the kernel's extended mode) moves the points of the part, to first
   * order: 1 on its faces; 1 / cos(t / 2) at an edge whose face normals are t apart (sampled at 5
   * points along it); and at a vertex, the point where the moved tangent planes of three of its faces
   * meet (each three whose normals span space). Infinite at an edge whose faces meet back to back. */
  _sharpOffsetReach(): number {
    let reach = 1
    for (const e of this.edges()) {
      const fs = e.faces()
      if (fs.length !== 2) continue
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const p = e.pointAt(t)
        let c: number
        try {
          c = fs[0].normalAt(p).dot(fs[1].normalAt(p))
        } catch (err) {
          if (!(err instanceof KernelError || _isValueError(err))) throw err
          continue // (the apex of a cone)
        }
        if (1 + c < 1e-12) return Infinity
        reach = Math.max(reach, Math.sqrt(2 / (1 + c)))
      }
    }
    for (const v of this.vertices()) {
      const normals: Vector[] = []
      for (const f of v.faces()) {
        let n: Vector
        try {
          n = f.normalAt(v.point)
        } catch (err) {
          if (!(err instanceof KernelError || _isValueError(err))) throw err
          continue
        }
        if (normals.every((m) => n.dot(m) < 1 - 1e-9)) normals.push(n)
      }
      for (let i = 0; i < normals.length; i++) {
        for (let j = i + 1; j < normals.length; j++) {
          for (let m = j + 1; m < normals.length; m++) {
            // the point x with a.x = b.x = c.x = 1
            const [a, b, c] = [normals[i], normals[j], normals[m]]
            const [bc, ca, ab] = [b.cross(c), c.cross(a), a.cross(b)]
            const det = a.dot(bc)
            if (Math.abs(det) > 1e-6) reach = Math.max(reach, bc.add(ca).add(ab).div(det).length)
          }
        }
      }
    }
    return reach
  }

  /** The first result of `attempts` that passes the checks: a valid solid within the part's box
   * (grown by `grow`, or by what `wider` gives, asked only for a result beyond that), whose faces meet
   * (gaps below _OFFSET_GAPS), whose volume went down (`smaller`), up (`smaller: false`) or changed
   * (null), and in which `problem` finds nothing wrong.
   *
   * Each attempt is a mode (the kernel's extended offset mode or not) and a function that makes the
   * result. An attempt in the mode of the one before runs only when that one's result was refused,
   * within _RETRY_SECONDS: the kernel fails the same way again, and only its extended mode, which
   * depends on memory layout, ever gave a better result. A step that crashed the kernel (a trap, or
   * a crash in the probe worker) or did not finish ends the attempts. */
  _checked(
    name: string,
    attempts: readonly [boolean, () => Part][],
    options: {
      grow: number
      smaller: boolean | null
      problem?: ((result: Part, extended: boolean) => string | null) | null
      hint?: string
      wider?: (() => number) | null
    },
  ): Part {
    const { grow, smaller, problem = null, hint = 'try a smaller value', wider = null } = options
    const box = this.bbox()
    const tol = 1e-6 * Math.max(box.diagonal, 1) + grow
    let margin: number | null = null // (wider's, once asked)
    const wide = wider === null ? null : (): number => (margin ??= 1e-6 * Math.max(box.diagonal, 1) + wider())
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
        if (typeof WebAssembly !== 'undefined' && (e as Any).cause instanceof WebAssembly.RuntimeError) throw _crashed(e, name)
        error = e
        last = [mode, true]
        continue
      }
      last = [mode, false]
      const why = _offsetProblem(result, box, tol, before, smaller, wide) ?? (problem ? problem(result, mode) : null)
      if (why === null) return result
      refused ??= why
      result.dispose()
    }
    if (error !== null) throw _crashed(error, name)
    throw new ModelingError(`${name}: the kernel could not build a valid result (it built ${refused}); ${hint}`)
  }

  /**
   * Cut the part with a plane or along a sheet.
   *
   * `keep = "above"` keeps the side the plane normal points to, "below" the other side, "both"
   * returns `[above, below]`.
   *
   * A sheet (a `Shell`, or a face that is not planar: a curved split surface, a surface fitted to a
   * scan) splits the part along its surface; "above" is the side its normals point to (`normalAt`).
   * The sheet must cut through the part. A sheet of one free-form face whose edges end inside the
   * part is extended beyond them, tangentially, until it does (the face's trim is not kept); other
   * sheets throw a ModelingError ("the surface does not cut through the part"). The two sides
   * together hold the part's volume, which is checked. A planar face (or a sketch) stands for its
   * plane.
   */
  split(plane: Plane | Face | Shell | ShapeList<Face>, keep: 'above' | 'below'): Part
  split(plane: Plane | Face | Shell | ShapeList<Face>, keep: 'both'): [Part, Part]
  split(plane: Plane | Face | Shell | ShapeList<Face>): Part
  split(plane: Plane | Face | Shell | ShapeList<Face>, keep: string = 'above'): Part | [Part, Part] {
    let tool: unknown = plane
    if (tool instanceof ShapeList) tool = tool.one()
    if (tool instanceof Face && !tool.isPlanar) return this._splitBySheet(tool.toShell(), keep, !tool._naturalIsOutward())
    if (tool instanceof Shell && !(tool instanceof Sketch)) return this._splitBySheet(tool, keep, false)
    const pl = _asPlane(tool as Any)
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
   * The part with its faces split where a tool crosses them, without changing its shape: split
   * lines for drafts, patches for the loads and supports of a simulation, regions of a face of their
   * own to color, draft or select (a label area, a parting line, a seal track). Nothing is added or
   * taken away: the volume stays.
   *
   * @param tool A part (the faces are split where its surface crosses them), a sheet or a face that
   *   crosses faces of the part, or a sketch (or a planar face) lying on a face of the part, whose
   *   outline is cut into that face (keep its region within the face: where it reaches past the
   *   face's edges, the neighbouring faces can get split lines close to them). Or curves: edges or
   *   wires, which without a direction must lie on the part's faces (`intersectionCurves`,
   *   `project`).
   * @param direction For curves only: move them along this direction (an axis or a vector) onto the
   *   part first, where they cross its faces as they move (an outline projected onto them). Only
   *   ahead of the curves: a part behind them is not reached.
   * @param options `nearest`: with a direction, split only the faces the projection meets first: the
   *   side of the part facing the curves (default `true`). `false` splits every face the projection
   *   crosses, also on the far side (a box's top and bottom face).
   *
   * The pieces of the part's faces that lie inside a tool part, or inside the sketch's region,
   * descend from the tool: `part.imprint(tool).faces().derivedFrom(tool)` selects them. A fillet or
   * chamfer across a split line removes it again. A curve across the seam of a closed face (a
   * cylinder's) gives a face on each side of the seam.
   *
   * ModelingError where the tool crosses no face of the part, and where the kernel's result is no
   * longer the part (another volume, or a broken body).
   */
  imprint(
    tool: Part | Shell | Face | ShapeList<Face> | Edge | Wire | Iterable<Edge | Wire>,
    direction: Axis | VectorLike | null = null,
    options: { nearest?: boolean } = {},
  ): Part {
    _opts('Part.imprint', options)
    const curves = _asCurves(tool)
    if (curves !== null) return this._imprintedCurves(curves, direction, options.nearest ?? true)
    if (direction != null) {
      throw new TypeError('imprint: direction moves curves onto the part; a part, a sheet, a face or a sketch is imprinted where it is')
    }
    let given: unknown = tool
    if (given instanceof ShapeList) given = given.one()
    if (!(given instanceof Part || given instanceof Shell || given instanceof Face)) {
      throw new TypeError(`imprint takes a part, a sheet, a face, a sketch or curves (edges or wires), not a ${_typeName(given)}`)
    }
    tool = given
    this._requireValid('imprint')
    let region: Part | null = tool instanceof Part ? tool : null
    let result: Part | null
    if (tool instanceof Part) {
      tool._requireValid('imprint')
      result = this._imprinted(tool)
    } else if (tool instanceof Sketch || (tool instanceof Face && tool.isPlanar)) {
      const sketch = tool instanceof Sketch ? tool : (tool as Face).toSketch()
      const sheet = tool instanceof Sketch ? tool : (tool as Face).toShell()
      // (a thin slab through the plane: the pieces of faces in the plane inside it lie in the
      // sketch's region)
      region = sketch.extrude(Math.max(1e-3 * this._extent(), 1e-6), { both: true })
      result = this._imprinted(sheet)
      if (result === null && this._liesOnFace(sketch.plane)) {
        // The kernel can imprint nothing of an outline in the plane of a face: the slab's walls cut
        // it in.
        result = this._imprinted(region)
      }
    } else {
      result = this._imprinted(tool instanceof Face ? tool.toShell() : tool)
    }
    if (result === null) throw new ModelingError('imprint: the tool crosses no face of the part')
    if (region !== null) {
      // the pieces inside the tool's region descend from the tool
      const faces = [...result.faces()]
      const points = faces.map((f) => f.interiorPoint())
      const tol = 1e-6 * Math.max(1, region._extent())
      const where = region._classify(points, tol)
      const inside = faces.filter((_, i) => where[i][0] !== 'outside').map((f) => f._f)
      if (inside.length) {
        // (the result is new: nothing has read its tags yet)
        ext.add_face_tags(result._brep, inside, [..._historyTags(tool, 'imprint')].sort((a, b) => a - b))
        result._h.tags = null
      }
    }
    return result
  }

  /** This part with its faces split where the tool's surface crosses them (the kernel's Boolean
   * with imprinting), checked: a valid solid of the same volume (within 1e-6, or its gaps); null
   * where no face was split. */
  _imprinted(tool: _Body): Part | null {
    const result = this._like(
      _held(this._copyBrep(), (h) => {
        kernelCall('imprint', () => _combineImprint(h, tool), 'the tool may only touch the part\'s faces, or run along one of its edges')
      }),
    )
    if (k.brep_face_count(result._brep) <= k.brep_face_count(this._brep)) return null
    let problem = result._solidProblem()
    if (problem === null) {
      try {
        const a = this._props()
        const b = result._props()
        const slack = Math.max(1e-6, 10 * Math.max(Number(a.gaps), Number(b.gaps)))
        if (!(Math.abs(Number(b.volume) - Number(a.volume)) <= slack * Math.abs(Number(a.volume)))) {
          problem = `of another volume (${_formatG(Number(b.volume), 10)}, the part has ${_formatG(Number(a.volume), 10)})`
        }
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        problem = 'a body whose volume cannot be integrated'
      }
    }
    if (problem !== null) {
      throw new ModelingError(
        `imprint: the kernel returned a body ${problem}; move the tool a little, so that its surface crosses the part's faces rather than running along them`,
      )
    }
    return result
  }

  /** Whether a planar face of this part lies in a plane. */
  _liesOnFace(plane: Plane): boolean {
    const tol = 1e-6 * Math.max(1, this._extent())
    const n = plane.zDir.normalized()
    for (const f of this.faces()) {
      if (f.geomType !== 'plane') continue
      const fp = f.plane
      if (Math.abs(Math.abs(fp.zDir.normalized().dot(n)) - 1) <= 1e-9 && Math.abs(fp.origin.sub(plane.origin).dot(n)) <= tol) return true
    }
    return false
  }

  /** `split` along a sheet (`turned`: whose faces' normals point against those of the face it was
   * taken from). */
  _splitBySheet(sheet: Shell, keep: string, turned: boolean): Part | [Part, Part] {
    if (keep !== 'above' && keep !== 'below' && keep !== 'both') throw new RangeError('keep must be "above", "below" or "both"')
    if (k.brep_face_count(sheet._brep) === 0) throw new RangeError('split: the sheet is empty')
    this._requireValid('split')
    let pieces = this._sliced(sheet)
    if (pieces === null && sheet.faces().length === 1 && sheet.faces()[0].geomType === 'bspline') {
      // A free-form sheet whose edges end inside the part: extended beyond them (its normals point as
      // before, the surface's).
      const reach = 2 * (this.bbox().diagonal + sheet.bbox().diagonal)
      const wide = Shell._wrap(kernelCall('split', () => ext.extended_sheet(sheet.faces()[0]._f, reach), "the sheet's surface cannot be extended"))
      pieces = this._sliced(wide)
    }
    if (pieces === null) {
      throw new ModelingError(
        'split: the surface does not cut through the part (its edges end inside the part, or it misses it); make the sheet reach past the part on every side',
      )
    }
    const [above, below] = turned ? [pieces[1], pieces[0]] : pieces
    return keep === 'above' ? above : keep === 'below' ? below : [above, below]
  }

  /** The parts of this part above and below a sheet (the kernel's SLICE, keeping the side its
   * normals point to, and again with the sheet turned); null where the sheet does not cut through
   * the part: a side is empty or no solid, or the two do not add up to the part's volume (a sheet
   * that only dents the part or misses it, from which the kernel returns the part less a dent, or
   * all of it). */
  _sliced(sheet: Shell): [Part, Part] | null {
    const out: Part[] = []
    for (const below of [false, true]) {
      let piece: Part
      try {
        // (the sheet turned for the other side: its faces as B-spline faces, their U and V swapped)
        const tool = below ? sheet.toNurbs() : sheet
        piece = Part._wrap(
          _held(this._copyBrep(), (h) => {
            const t = new BrepHandle(tool._copyBrep())
            try {
              h.brep = kernelCall('split', () => ext.slice(h.brep, t.brep, below))
              t.release()
            } finally {
              t.dispose()
            }
          }),
          { name: this.name, color: this.color },
        )
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        return null
      }
      if (k.brep_face_count(piece._brep) === 0 || piece._solidProblem() !== null) return null
      out.push(piece)
    }
    let p: Any
    let parts: Any[]
    try {
      p = this._props()
      parts = out.map((x) => x._props())
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      return null
    }
    const whole = Number(p.volume)
    const volumes = parts.map((x) => Number(x.volume))
    const slack = Math.max(1e-6, 10 * Math.max(Number(p.gaps), ...parts.map((x) => Number(x.gaps))))
    if (Math.min(...volumes) <= slack * whole || !(Math.abs(volumes[0] + volumes[1] - whole) <= slack * whole)) return null
    return [out[0], out[1]]
  }

  /** `imprint` of curves: the part with its faces split along them (moved along `direction` onto
   * the part first, where one is given). */
  _imprintedCurves(tool: Edge | Wire | (Edge | Wire)[], direction: Axis | VectorLike | null, nearest: boolean): Part {
    let edges = _curvesOf(tool, 'imprint')
    if (direction != null) {
      const d = _direction(direction, 'imprint')
      edges = _sweptOnto(this, edges, d)
      if (nearest) edges = edges.filter((e) => _seenAlong(this, e, d))
      if (!edges.length) throw new ModelingError('imprint: the curves, moved along the direction, miss the part')
    }
    const before = this.faces().length
    const out = this._like(_trimWithCurves(this, edges, new Vector(), 2, 'imprint'))
    if (out.faces().length <= before) {
      throw new ModelingError('imprint: the curves split no face: each must run across a face from border to border, or close a loop on it')
    }
    let problem = out._solidProblem()
    if (problem === null && Math.abs(out.volume - this.volume) > 1e-6 * Math.max(Math.abs(this.volume), 1e-12)) {
      problem = `of another volume (${_formatG(out.volume)} instead of ${_formatG(this.volume)})`
    }
    if (problem !== null) throw new ModelingError(`imprint: the kernel returned a body that is ${problem}`)
    return out
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
    const touches = 'the plane only touches the part (along a line or a curve, or at a point), so the section has no area; move the plane into the part'
    let b: number
    try {
      const curves: number[] = kernelCall('section', () => k.intersect_brep_with_plane(this._brep, pl.origin.toArray(), pl.zDir.toArray()))
      if (!curves.length) throw new RangeError('the plane does not cut the part')
      b = kernelCall('section', () => k.create_planar_faces([...curves]))
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      // A plane tangent to a face meets the part along a line, which bounds no face.
      if (this._onOneSide(pl)) throw new RangeError(touches)
      const error = new KernelError(
        e.operation,
        e.detail,
        e.status,
        'the kernel could not make faces of the curves where the plane meets the part; a plane through an edge, or tangent to a face, inside the part can do this: move the plane a little',
      )
      ;(error as Any).cause = e
      throw error
    }
    const section = Sketch._wrap(b, { plane: pl })
    // A plane tangent to a part along a closed curve (the top of a torus) gives that curve, and the
    // kernel fills it with a face that lies outside the part.
    const points = section.faces().map((f) => f.interiorPoint())
    if (this._classify(points, 1e-6 * Math.max(this._extent(), 1.0)).some(([where]) => where === 'outside')) {
      section.dispose()
      if (this._onOneSide(pl)) throw new RangeError(touches)
      throw new ModelingError('section: the kernel returned a region that lies outside the part; move the plane a little')
    }
    return section
  }

  /** Whether the part lies on one side of a plane that meets it: a plane a little beyond the given
   * one, on one side or the other, misses the part (the given one only touches it). */
  _onOneSide(plane: Plane): boolean {
    const step = 1e-5 * Math.max(this._extent(), 1.0)
    for (const s of [step, -step]) {
      const p = plane.offset(s)
      const curves: number[] = kernelCall('section', () => k.intersect_brep_with_plane(this._brep, p.origin.toArray(), p.zDir.toArray()))
      for (const c of curves) ext.delete_curve(c)
      if (!curves.length) return true
    }
    return false
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

  /** Unroll this part from around an axis (default Z) into a flat one, the layer at `radius`
   * keeping its length; see `unroll`. */
  unroll(options: UnrollOptions): Part {
    return _unroll(this, options)
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

  // -- direct editing (the face_edit module) ------------------------------------------------
  /**
   * Move faces of the part, and extend or trim the faces around them to meet them again: push or
   * pull a face, move a hole, a boss or a pocket.
   *
   * `by` is a vector or a Location (a rotation and a translation: it also turns the faces). A face
   * moved along itself stays where it is (a plane moved within its plane); the faces around it decide
   * what changes. Faces that meet a moved face tangentially (a round, the other half of a slot) must
   * be moved with it. Exact: planes, cylinders, cones, spheres, tori and free-form faces keep their
   * shape, and the edges where a plane meets a cylinder, cone or sphere stay circles.
   *
   * Throws a ModelingError where the kernel cannot rebuild the part, where the moved faces change
   * which faces meet (a face vanishes; use a Boolean), and where the result's faces do not meet.
   *
   * @param faces Faces of this part (a selection or a single face).
   * @param by A vector, or a Location.
   */
  moveFaces(faces: unknown, by: Location | VectorLike): Part {
    return _moveFaces(this, faces, by)
  }

  /**
   * Offset faces of the part along their normals by `distance`, and extend or trim the faces around
   * them to meet them again: push-pull by a distance, resize a hole or a boss.
   *
   * A positive distance moves the faces out of the material: the part grows, a hole narrows and a
   * boss widens; a negative one moves them in. Faces that meet an offset face tangentially (a round,
   * the other half of a slot, a fillet chain) are offset with it, and so on along the tangent chain.
   * Exact: a plane moves, a cylinder, cone, sphere or torus changes its radius, a free-form face
   * becomes its offset surface.
   *
   * Throws a ModelingError where a radius would reach 0, where the kernel cannot rebuild the part,
   * where the offset faces change which faces meet (a face vanishes; use a Boolean), and where the
   * volume does not change the way the distance says.
   *
   * @param faces Faces of this part (a selection or a single face).
   * @param distance How far to move them, along their outward normals.
   */
  offsetFaces(faces: unknown, distance: number): Part {
    return _offsetFaces(this, faces, distance)
  }

  // -- local edits of a face (the logic is in the shaping module) ---------------------------
  /**
   * Push or pull a face at a point: a smooth dent or bump, local to the point, its edges in place.
   *
   * The point moves exactly, the face's edges not at all: an edit that would move one (a hole's
   * edge, a border cut across the surface, within `radius` of the point) throws a RangeError; take a
   * smaller radius or a point farther from it. The face becomes a B-spline surface; a plane, cylinder
   * or sphere stays exactly what it was away from the change.
   *
   * @param face A face of the part.
   * @param at The point of the face that moves (a point off the face: the face's point nearest to it).
   * @param options `by`: how far it moves: a distance along the face's outward normal there
   *   (positive: out of the part, a bump; negative: a dent), or a vector. `to`: where it moves to,
   *   instead of `by`. `normal`: the face's normal at the moved point (default: as it was there).
   *   `radius`: how far from the point the face changes, along the face (a square around the point
   *   along the surface's two directions, blended in smoothly; default: up to the face's nearest edge,
   *   smaller where that would still move an edge). `continuity`: how the face stays joined to its
   *   neighbours where the change reaches its border: `'G0'` (its edges stay), `'G1'` (default; also
   *   its tangent planes along them) or `'G2'` (also its curvature).
   * @returns A new part (this one does not change).
   */
  push(face: Face, at: VectorLike, options: PushOptions = {}): Part {
    _opts('Part.push', options)
    return _checked(this, _push(this, face, at, options.by ?? null, options.to ?? null, options.normal ?? null, options.radius ?? null,
      options.continuity ?? 'G1'), 'push')
  }

  /**
   * Raise or sink a region of a face: a smooth bump over an outline drawn on the face.
   *
   * The face changes only near the region, within the rectangle around it along the surface's two
   * directions (the region itself for a rectangle drawn along them); the highest point lies near the
   * region's middle (at it, for a region symmetric along both directions, with `'G2'`). Where that
   * rectangle reaches an edge of the face (a hole), the edge would move: a RangeError.
   *
   * @param face A face of the part.
   * @param region The outline on the face: a closed Wire (on a curved face, `project` one onto it), a
   *   Sketch or Face placed on the face (its outline), or the corner points of a polygon on the face.
   * @param by How far the region rises at its highest point: a distance along the face's outward
   *   normal at the region's middle (positive: out of the part; negative: a recess), or a vector.
   * @param options `continuity`: how the change meets the rest of the face at the region's border:
   *   `'G2'` (default; curvature continuous), `'G1'` (tangent) or `'crease'` (a sharp border).
   * @returns A new part (this one does not change).
   */
  warp(face: Face, region: unknown, by: number | VectorLike, options: { continuity?: string } = {}): Part {
    _opts('Part.warp', options)
    return _checked(this, _warp(this, face, region, by, options.continuity ?? 'G2'), 'warp')
  }

  /**
   * Press a region of a face onto a plane: a flat area (a seat, a pad, a label area) on a curved face,
   * blended into the rest of it.
   *
   * Inside the region the face lies in the plane, but for a border where it blends into the rest
   * (3/16 of the region's width with `'G2'`, 2/16 with `'G1'`, 1/16 with `'crease'`); outside the
   * rectangle around the region (along the surface's two directions) it does not change. Where that
   * rectangle reaches an edge of the face (a hole), the edge would move: a RangeError.
   *
   * @param face A face of the part.
   * @param region The outline on the face, as for `warp`.
   * @param plane The plane (or a planar face) the region is pressed onto, along its normal.
   * @param options `continuity`: how the flat area meets the rest of the face: `'G2'` (default),
   *   `'G1'` or `'crease'`.
   * @returns A new part (this one does not change).
   */
  flatten(face: Face, region: unknown, plane: Plane | Face, options: { continuity?: string } = {}): Part {
    _opts('Part.flatten', options)
    return _checked(this, _flatten(this, face, region, plane, options.continuity ?? 'G2'), 'flatten')
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
  bends(options: { kFactor?: KFactor } = {}): Bend[] {
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
/** Points on a face: an interior point and those of a 2 x 2 grid of its parameters that lie inside it. */
function _faceSamples(f: Face): Vector[] {
  const out = [f.interiorPoint()]
  try {
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(f._f)
    for (const a of [0.25, 0.75]) {
      for (const b of [0.25, 0.75]) {
        const [u, v] = [u0 + a * (u1 - u0), v0 + b * (v1 - v0)]
        if (k.face_classify_uv(f._f, u, v) === 'inside') out.push(new Vector(k.face_point_at_uv(f._f, u, v)))
      }
    }
  } catch (e) {
    // a face the kernel cannot sample: its interior point only
    if (e instanceof TypeError) throw e
  }
  return out
}

/** The distance from `q` to a box (0 inside it). */
function _boxDistance(box: BoundBox, q: Vector): number {
  const [lo, hi, p] = [box.min.toArray(), box.max.toArray(), q.toArray()]
  let sum = 0
  for (let i = 0; i < 3; i++) sum += Math.max(lo[i] - p[i], 0, p[i] - hi[i]) ** 2
  return Math.sqrt(sum)
}

/**
 * What is wrong with `result` as `sheet` offset by `d`, or null. Every point of an offset lies at least
 * `|d|` from the sheet, on the side `d` points to (along the normal at its nearest point), and each
 * face has points at `|d|` (the offset of the face it came from; corners that the faces' extensions
 * close lie farther).
 */
function _sheetOffsetProblem(sheet: Shell, result: Shell, d: number): string | null {
  const faces = [...result.faces()]
  if (!faces.length) return 'no faces'
  const source = [...sheet.faces()].map((h) => [h, h.bbox()] as const)
  const t = Math.abs(d)
  const tol = 1e-6 * Math.max(sheet.bbox().diagonal, t, 1.0)
  // the nearest face, trying faces by the distance to their boxes
  const closest = (q: Vector): [number, Face] => {
    let best = Infinity
    let face = source[0][0]
    for (const [boxDistance, h] of source.map(([h, b]) => [_boxDistance(b, q), h] as const).sort((x, y) => x[0] - y[0])) {
      if (boxDistance > best) break
      const dist = h.distanceTo(q)
      if (dist < best) [best, face] = [dist, h]
    }
    return [best, face]
  }
  for (const f of faces) {
    let nearest = Infinity
    for (const q of _faceSamples(f)) {
      const [dist, g] = closest(q)
      if (dist < t - tol) return `a face ${_formatG(dist)} from the sheet, nearer than ${_formatG(t)}, at ${_fmtPoint(q)}`
      const p = new Vector(k.face_closest_point(g._f, q.toArray())[0])
      if (q.sub(p).dot(g.normalAt(p)) * d < 0) return `a face on the other side of the sheet, at ${_fmtPoint(q)}`
      nearest = Math.min(nearest, dist)
    }
    if (nearest > t + tol) return `a face that lies nowhere at ${_formatG(t)} from the sheet (it comes no nearer than ${_formatG(nearest)})`
  }
  return null
}

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

/**
 * True if `g` continues `e` tangentially through their vertex `v`: it leaves `v` within the
 * kernel's tangency angle of the direction in which `e` arrives there, and its two faces meet those
 * of `e` smoothly (their normals at `v` pair up within the same angle), as the next edge around a
 * rounded corner does. `g` must be an edge a round can follow: not a seam and not smooth itself.
 */
function _continues(e: Edge, g: Edge, v: Vertex): boolean {
  const p = v.point
  const along = _leaving(g, p)
  if (!_leaving(e, p).some((a) => along.some((b) => a.neg().angleTo(b) < _FILLET_TANGENT_DEG))) return false
  const fe = e.faces()
  const fg = g.faces()
  if (fe.length !== 2 || fg.length !== 2) return false
  let ne: Vector[]
  let ng: Vector[]
  try {
    ne = fe.map((f) => f.normalAt(p))
    ng = fg.map((f) => f.normalAt(p))
  } catch (err) {
    if (err instanceof KernelError || _isValueError(err)) return false
    throw err
  }
  const t = _FILLET_TANGENT_DEG
  if (!((ne[0].angleTo(ng[0]) < t && ne[1].angleTo(ng[1]) < t) || (ne[0].angleTo(ng[1]) < t && ne[1].angleTo(ng[0]) < t))) return false
  return g.convexity !== 'smooth'
}

/**
 * `edges`, then the edges that continue them tangentially (`_continues`), and the edges that
 * continue those, as far as the chains go; with the index in `edges` of the edge each one was
 * reached from (the nearest along its chain).
 */
function _tangentChains(edges: readonly Edge[]): [Edge[], number[]] {
  const out = [...edges]
  const src = out.map((_, i) => i)
  const seen = new Set(out.map((e) => e._identity()))
  for (let i = 0; i < out.length; i++) {
    const e = out[i]
    if (!e._e || e._owner === null) continue
    for (const v of e.vertices()) {
      for (const g of v.edges()) {
        const key = g._identity()
        if (!seen.has(key) && _continues(e, g, v)) {
          seen.add(key)
          out.push(g)
          src.push(src[i])
        }
      }
    }
  }
  return [out, src]
}

/** The hint for a round of `sel` (without propagation) that the kernel refused: the first
 * selected edge that an edge that is not selected continues tangentially, and where. */
function _runOnHint(sel: readonly Edge[], what: string): string | null {
  const keys = new Set(sel.map((e) => e._identity()))
  for (const e of sel) {
    if (!e._e || e._owner === null) continue
    const ends = e
      .vertices()
      .filter((v) => v.edges().some((g) => !keys.has(g._identity()) && _continues(e, g, v)))
      .map((v) => _fmtPoint(v.point))
    if (ends.length) {
      const verb = what === 'chamfer' ? 'bevel' : 'round'
      return `the edge from ${_fmtPoint(e.start)} to ${_fmtPoint(e.end)} runs on tangentially into an edge that is not selected at ${ends.join(' and ')}, which the kernel cannot always ${verb} alone; select the whole run (propagate=True, the default, or edge.tangent_chain())`
    }
  }
  return null
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
/** The closed regions of a body that are not cavities (numbered as `ext.region_shells` numbers
 * them), grouped across the faces two of them share: the touching cells of a merged part form one
 * group, a body inside a cavity of another a group of its own. */
export function _solidGroups(brep: number): number[][] {
  const d = ext.brep_dump(brep, false)
  const regions: { infinite: boolean; void: boolean; shells: number[] }[] = d.regions
  const cell = new Map<number, number>() // region -> its number among the regions that are not cavities
  regions.forEach((r, i) => {
    if (!r.infinite && !r.void) cell.set(i, cell.size)
  })
  const regionOf = new Map<number, number>()
  regions.forEach((r, i) => r.shells.forEach((s) => regionOf.set(s, i)))
  const parent = Array.from({ length: cell.size }, (_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (const f of d.faces as { uses: ({ shell: number | null } | null)[] }[]) {
    const sides = new Set<number>()
    for (const u of f.uses) if (u != null && u.shell != null && regionOf.has(u.shell)) sides.add(regionOf.get(u.shell)!)
    const found = [...sides].filter((r) => cell.has(r)).map((r) => cell.get(r)!)
    if (found.length === 2) parent[root(found[0])] = root(found[1])
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < cell.size; i++) {
    const r = root(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(i)
  }
  return [...groups.values()]
}

/** A body of `ext.separate_bodies` as the bodies in it that share no face. The kernel keeps a body
 * inside a cavity of another with that one (SmBrep::CreateOneBrepPerBody keeps nested shells
 * together). Each group of `_solidGroups` becomes a body as `Part.cells` builds a cell (its outer
 * shell less its cavities), a group of several cells their merge. Where that fails, the body stays
 * whole, as the kernel gave it (kernel plan B16). */
function _islands(part: Part): Part[] {
  let groups: number[][]
  try {
    if (Number(k.brep_material_census(part._brep).solid_count) <= 1) return [part] // (cheap)
    groups = _solidGroups(part._brep)
  } catch (e) {
    if (!_isRuntimeError(e)) throw e
    return [part]
  }
  if (groups.length <= 1) return [part]
  try {
    const regions: number[][] = kernelCall('solids', () => ext.region_shells(part._brep))
    const solids = regions.map((shells) => shells.map((b) => Part._wrap(b, { name: part.name, color: part.color })))
    const bodies = groups.map((group) => {
      const cells = group.map((c) => {
        const [outer, ...cavities] = solids[c]
        return cavities.length ? outer.cut(cavities) : outer
      })
      return cells.length === 1 ? cells[0] : cells[0].merge(cells.slice(1))
    })
    part.dispose()
    return bodies
  } catch (e) {
    if (!(e instanceof ModelingError)) throw e // (also a KernelError)
    return [part]
  }
}

/** Carries what a merged part was merged from, and a cell's sources, over to a copy of it moved by
 * the placement `m` (kernel plan B15). */
function _sameSources(src: BrepHandle, dst: BrepHandle, m: Matrix | null = null): void {
  if (src.merged !== null) {
    dst.merged = { parts: src.merged.parts, placement: m === null ? src.merged.placement : _matmul(m, src.merged.placement), cells: null }
  }
  dst.sources = src.sources
}

/** The inverse of an affine placement (a rotation, a translation, a mirror, a scale). */
function _affineInverse(m: Matrix): Matrix {
  const a = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ]
  const det = det3([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]])
  const out = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      // the cofactor of a[c][r]
      const rows = [0, 1, 2].filter((i) => i !== c)
      const cols = [0, 1, 2].filter((j) => j !== r)
      const minor = a[rows[0]][cols[0]] * a[rows[1]][cols[1]] - a[rows[0]][cols[1]] * a[rows[1]][cols[0]]
      out[r * 4 + c] = ((r + c) % 2 ? -minor : minor) / det
    }
  }
  for (let r = 0; r < 3; r++) out[r * 4 + 3] = -(out[r * 4] * m[3] + out[r * 4 + 1] * m[7] + out[r * 4 + 2] * m[11])
  out[15] = 1
  return out
}

// The tries of _cellPoints, round by round: [the face of the cell, the step into it as a part of the
// merged part's size].
const _CELL_TRIES: [number, number][][] = [
  [[0, 0.03]],
  [[0, 0.003], [1, 0.03]],
  [[1, 0.003], [2, 0.03], [2, 0.003]],
  [[0, 3e-4], [1, 3e-4], [2, 3e-4]],
]

/** Per cell of a merged part (given as its solids from `ext.region_shells`, the outer one first), a
 * point inside it: from a point on one of the outer solid's first three faces, a step into the cell
 * that the part itself classifies into that cell, round by round (_CELL_TRIES) for the cells not
 * found yet (the classification costs about 0.25 ms a point on a part of 28 cells). Null where none
 * is found. */
function _cellPoints(part: Part, solids: readonly (readonly Part[])[]): (Vector | null)[] {
  const size = Math.max(part._extent(), 1)
  const starts = solids.map(([outer]) =>
    [...outer.faces()].slice(0, 3).map((f): [Vector, Vector] | null => {
      try {
        const p = f.interiorPoint()
        return [p, f.normalAt(p)]
      } catch (e) {
        if (!_isRuntimeError(e) && !(e instanceof RangeError)) throw e
        return null // a face the kernel cannot place a point on
      }
    }),
  )
  const found: (Vector | null)[] = solids.map(() => null)
  for (const tries of _CELL_TRIES) {
    const points: Vector[] = []
    const owners: number[] = []
    starts.forEach((mine, i) => {
      if (found[i] !== null) return
      for (const [face, step] of tries) {
        const start = mine[face]
        if (start == null) continue
        points.push(start[0].sub(start[1].mul(step * size)))
        owners.push(i)
      }
    })
    if (!points.length) break
    part._classify(points).forEach(([where, , cell], j) => {
      const i = owners[j]
      if (where === 'inside' && cell === i && found[i] === null) found[i] = points[j]
    })
  }
  return found
}

/** Per point, the parts a merged part was merged from whose material holds it (a part that was
 * itself merged stands for its own parts); the part itself for a part that was not merged. */
function _mergeSources(part: Part, points: readonly Vector[]): Part[][] {
  const info = part._h.merged
  if (info === null) return part._classify(points).map(([where]) => (where !== 'outside' ? [part] : []))
  const back = _affineInverse(info.placement)
  const local = points.map((p) => _apply(back, p))
  const out: Part[][] = points.map(() => [])
  for (const x of info.parts as Part[]) {
    _mergeSources(x, local).forEach((more, i) => {
      for (const s of more) if (!out[i].includes(s)) out[i].push(s)
    })
  }
  return out
}

/** Per cell of a merged part (in the order of `ext.region_shells`, given as `solids` where the
 * caller has them), the parts given to merge that it lies in; null for a part that does not come
 * from a merge. A point inside each cell (`_cellPoints`) is classified against the parts; a cell
 * where none is found has no sources. */
export function _cellSources(part: Part, solids: readonly (readonly Part[])[] | null = null): Part[][] | null {
  const info = part._h.merged
  if (info === null) return null
  if (info.cells === null) {
    if (solids === null) {
      const regions: number[][] = kernelCall('cells', () => ext.region_shells(part._brep))
      solids = regions.map((shells) => shells.map((b) => Part._wrap(b)))
    }
    const points = _cellPoints(part, solids)
    const known = points.flatMap((p, i) => (p === null ? [] : [i]))
    const found = known.length ? _mergeSources(part, known.map((i) => points[i]!)) : []
    const cells: Part[][] = solids.map(() => [])
    known.forEach((i, j) => (cells[i] = found[j]))
    info.cells = cells
  }
  return info.cells as Part[][]
}

/** The name and color of a cell of a merged part: the names of its sources joined by `&` (each
 * once), the color of the last of them that has one; `name` and `color` (the merged part's) where
 * none has one. */
export function _sourceLabel(sources: readonly Part[], name: string | null, color: ColorLike | null): [string | null, ColorLike | null] {
  const names: string[] = []
  for (const s of sources) if (s.name && !names.includes(s.name)) names.push(s.name)
  const colors = sources.filter((s) => s.color != null).map((s) => s.color)
  return [names.length ? names.join('&') : name, colors.length ? colors[colors.length - 1] : color]
}

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

/** Whether the volume of a Boolean's result lies outside the bounds the operands' set (within 1e-3):
 * a union holds the largest body and no more than all; an intersection no more than the smallest; a
 * difference no more than the part, and no less than the tools can take of it. The volumes are
 * integrated as precisely as `volume` asks, so that they are there when it asks. */
function _volumeProblem(result: Part, part: Part, tools: readonly Part[], op: number): boolean {
  const v = k.brep_face_count(result._brep) ? (result._props().volume as number) : 0
  const a = part._props().volume as number
  const b = tools.map((t) => t._props().volume as number)
  const sum = b.reduce((x, y) => x + y, 0)
  if (op === k.BooleanOp.UNION) return !(Math.max(a, ...b) * (1 - 1e-3) <= v && v <= (a + sum) * (1 + 1e-3))
  if (op === k.BooleanOp.INTERSECTION) return !(v <= Math.min(a, ...b) * (1 + 1e-3))
  return !(a - sum - 1e-3 * a <= v && v <= a * (1 + 1e-3))
}

/** What is wrong with the result of a merge, or null. Its volume, that of the union, lies between
 * that of the largest part and that of all parts together (within 1e-3); a result outside that is
 * wrong. The volumes are integrated as precisely as `volume` asks (it costs about as much as a
 * coarse integration), so that they are there when `volume` and `cells()` ask. */
export function _mergeProblem(merged: Part, parts: Part[]): string | null {
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
 * Brep (or gives a new one in its place, where it turned a seam) and deletes the copy when it
 * succeeds, and keeps both when it fails: the handles hold them until then and free them on a
 * failure. */
function _combine(h: BrepHandle, tool: _Body, op: number, nonManifold = false): void {
  const th = new BrepHandle(tool._copyBrep())
  try {
    h.brep = ext.boolean(h.brep, th.brep, op, nonManifold)
    th.release()
  } finally {
    th.dispose()
  }
}

/** `_combine` with the kernel's imprinting Boolean: the faces of the Brep a handle owns split where
 * a copy of the tool crosses them (the copy deleted). */
function _combineImprint(h: BrepHandle, tool: _Body): void {
  const th = new BrepHandle(tool._copyBrep())
  try {
    h.brep = ext.boolean(h.brep, th.brep, k.BooleanOp.UNION, false, true)
    th.release()
  } finally {
    th.dispose()
  }
}

// A fillet or chamfer that fails with SM_ERR_INVALID_INPUT fails at any size: the kernel takes an edge
// for one it cannot round, or has no corner for the way the selected edges meet at a vertex.
const _ROUND_SELECTION_HINT =
  'the kernel cannot round the selection as given, at any size: an edge whose faces meet almost tangentially, or a vertex where the selected edges meet in a way it has no corner for (such as the two halves of an edge that another face touches tangentially); select fewer edges there'

/** `kernelCall` for fillets and chamfers, with the hint for a selection the kernel cannot round (and
 * where the kernel failed, see `_roundEdges`). */
function _roundCall<T>(operation: string, fn: () => T, hint: string): T {
  try {
    return kernelCall(operation, fn, hint)
  } catch (e) {
    // a failure inside the kernel (a crash, a null pointer of its own) says nothing about the size,
    // which passed the checks against the faces before (kernel plan B19)
    const crash = _crashNote(e, operation)
    if (crash !== null) {
      const failure = e as KernelError
      const size = operation === 'chamfer' ? 'length' : 'radius'
      const error = new KernelError(
        failure.operation,
        failure.detail,
        failure.status,
        `${crash}, which says nothing about the ${size} (it fits the faces around the edges): round the edges in smaller groups to find the one it fails at`,
      )
      ;(error as Any).cause = e
      throw error
    }
    if (!(e instanceof KernelError) || e.status !== 'SM_ERR_INVALID_INPUT') throw e
    const where: string | undefined = (e as Any)._where
    const error = new KernelError(
      e.operation,
      e.detail,
      e.status,
      where ? `the kernel cannot round the selection as given, at any size: it could not build ${where}; select fewer edges there` : _ROUND_SELECTION_HINT,
    )
    ;(error as Any).cause = e
    throw error
  }
}

/**
 * `attempt(4)`, a fillet or chamfer as SM_API makes it, and where the kernel fails or its body is refused,
 * `attempt(1)`: its rounds' edges four times closer to the faces (in edge tolerances). Rounds close to the
 * largest radius that fits fail with SM_API's tolerance (a 10 mm cube rounded by 4.98 came out open) and are
 * exact with the finer one, as SmApiCircularFillet builds them; the finer one fails some rounds that the
 * coarser builds, so it comes second. Selections the kernel cannot round at any size (`SM_ERR_INVALID_INPUT`)
 * are not tried again. The error is the first attempt's.
 */
function _withFinerRounds(attempt: (factor: number) => Part): Part {
  try {
    return attempt(4.0)
  } catch (first) {
    if (!(first instanceof ModelingError)) throw first // (a KernelError is a ModelingError)
    if (first instanceof KernelError && first.status === 'SM_ERR_INVALID_INPUT') throw first
    try {
      return attempt(1.0)
    } catch (e) {
      if (!(e instanceof ModelingError)) throw e
      throw first
    }
  }
}

// The fillet executive's comments on failures it records, in words (lower case, without its prefix).
const _ROUND_COMMENTS: Record<string, string> = {
  'corner case not implemented': 'it has no corner for the way the rounded edges meet there',
  'corner edge computation failure': 'it could not compute the edges of the corner',
  'vertex computation failure': 'it could not compute the vertices of the corner',
}

/** What the kernel's fillet executive could not build, in words (from its record, see
 * `ext.round_edges`): the corner at a vertex, the round of a selected edge, or the round at a point,
 * and why where it says; null where it recorded none. */
function _roundFailure(record: Any, edges: readonly Edge[]): string | null {
  let comment = String(record.comment ?? '')
  for (const prefix of ['Fillet Corner Error:', 'Fillet Edge Error:', 'Fillet Error:']) {
    if (comment.startsWith(prefix)) comment = comment.slice(prefix.length)
  }
  comment = comment.trim().replace(/\.+$/, '').toLowerCase()
  const why = _ROUND_COMMENTS[comment] ?? comment
  let what: string
  const index = Number(record.edge ?? -1)
  if (record.vertex != null) what = `the corner at ${_fmtPoint(new Vector(...(record.vertex as [number, number, number])))}`
  else if (index >= 0 && index < edges.length) {
    const e = edges[index]
    what = e.isClosed ? `the round of the closed edge through ${_fmtPoint(e.start)}` : `the round of the edge from ${_fmtPoint(e.start)} to ${_fmtPoint(e.end)}`
  } else if (record.location != null) what = `the round at ${_fmtPoint(new Vector(...(record.location as [number, number, number])))}`
  else return null
  return what + (why ? ` (${why})` : '')
}

/**
 * Round `kedges` of `brep` (a copy; `edges` are this part's edges they are) in place with
 * `ext.round_edges` (the kernel's fillet executive, as `k.fillet_edges` and its siblings drive it). A
 * failure throws a KernelError whose hint begins with the corner or edge the executive names
 * (`_where`, see `_roundFailure`), then `hint`.
 */
function _roundEdges(
  operation: string,
  hint: string,
  brep: number,
  kedges: readonly number[],
  edges: readonly Edge[],
  radii: readonly number[],
  sections: readonly number[],
  options: {
    radii2?: readonly number[]
    faces?: readonly number[]
    law?: readonly number[]
    continuity?: number
    thumbweight?: number
    toleranceFactor?: number
    mitre?: boolean
  } = {},
): void {
  const { radii2 = [], faces = [], law = [], continuity = 1, thumbweight = 1.0, toleranceFactor = 4.0, mitre = false } = options
  const record = kernelCall(
    operation,
    () => ext.round_edges(brep, [...kedges], radii.map(Number), sections.map(Number), radii2.map(Number), [...faces], law.map(Number), continuity, thumbweight, toleranceFactor, mitre),
    hint,
  )
  const status = record.status
  if (status == null) return
  const where = _roundFailure(record, edges)
  const detail = `${operation} failed: ${status}` + (record.comment ? ` (${record.comment})` : '')
  const error = new KernelError(operation, detail, status, where ? `the kernel could not build ${where}; ${hint}` : hint)
  ;(error as Any)._where = where
  throw error
}

/** Whether `face` runs straight from `start` (on a circle about `axis` through `center`) by `step`, with the
 * `normal` it has at `start`, all around the axis: a surface of revolution about it whose meridian is
 * straight there (sampled halfway and at the end, at four angles). */
function _straightAround(face: Face, center: Vector, axis: Vector, start: Vector, step: Vector, normal: Vector): boolean {
  const near = 1e-7 * Math.max(start.distanceTo(center), step.length, 1)
  const turned = (v: Vector, quarter: number): Vector => {
    // (by quarter turns about the axis)
    const along = axis.mul(v.dot(axis))
    const across = v.sub(along)
    return along.add(quarter === 0 ? across : quarter === 1 ? axis.cross(across) : quarter === 2 ? across.neg() : axis.cross(across).neg())
  }
  for (let quarter = 0; quarter < 4; quarter++) {
    const n = turned(normal, quarter)
    for (const k of [0.5, 1]) {
      const p = center.add(turned(start.add(step.mul(k)).sub(center), quarter))
      try {
        if (face.distanceTo(p) > near || face.normalAt(p).dot(n) < 1 - 1e-9) return false
      } catch (err) {
        if (!(err instanceof KernelError || _isValueError(err))) throw err
        return false
      }
    }
  }
  return true
}

/** Whether `corners` (of `Part.fillet` or `Part.chamfer`) asks for mitred corners. */
function _cornerStyle(operation: string, corners: string): boolean {
  if (corners !== 'patch' && corners !== 'mitre') throw new RangeError(`${operation}: corners must be "patch" or "mitre", not '${corners}'`)
  return corners === 'mitre'
}

/** The corners `corners: "mitre"` mitres: where three of `edges` meet, all convex, and no other edge
 * (the kernel mitres those only: SmFilletConvexNxNCorner). */
export function _mitredCorners(edges: readonly Edge[]): Vector[] {
  const rounded = new Set(edges.map((e) => e._identity()))
  const seen = new Set<string>()
  const out: Vector[] = []
  for (const e of edges) {
    for (const v of e.vertices()) {
      if (seen.has(v._identity())) continue
      seen.add(v._identity())
      const at = [...v.edges()]
      if (at.length === 3 && at.every((x) => rounded.has(x._identity())) && at.every((x) => x.convexity === 'convex')) out.push(v.point)
    }
  }
  return out
}

/** Throw where `corners: "mitre"` would mitre no corner of the rounded `edges`. */
function _requireMitredCorners(operation: string, edges: readonly Edge[]): void {
  if (!_mitredCorners(edges).length) {
    throw new RangeError(
      `${operation}: corners="mitre" mitres the corners where three rounded convex edges meet and no other edge, and the selection has none (round all three edges of a corner)`,
    )
  }
}

/** The brep of `Face.extended`. */
function _extendedFace(face: Face, distance: number, sides: Edge | Iterable<Edge> | null, continuity: string, what: string): number {
  const d = Number(distance)
  if (!(d > 0 && Number.isFinite(d))) throw new RangeError(`${what}: the distance must be positive, got ${distance}`)
  const kinds: Record<string, number> = { natural: 0, g1: 1, g2: 2 }
  const level = typeof continuity === 'string' ? kinds[continuity.toLowerCase()] : undefined
  if (level === undefined) throw new RangeError(`${what}: continuity is "natural", "G1" or "G2", got '${continuity}'`)
  let edges: Edge[] = []
  if (sides !== null) {
    edges = sides instanceof Edge ? [sides] : Array.from(sides as Iterable<Edge>)
    if (!edges.length || !edges.every((e) => e instanceof Edge)) throw new TypeError(`${what}: sides are edges of the face`)
    const own = new Set(face.edges(true).map((e) => e._identity()))
    if (edges.some((e) => !own.has(e._identity()))) throw new RangeError(`${what}: an edge in sides does not bound the face`)
  }
  try {
    return kernelCall(what, () => ext.extend_face(face._f, d, edges.map((e) => e._e), level), 'try a shorter distance, or continuity G1')
  } catch (e) {
    if (e instanceof RangeError) throw new RangeError(e.message.replace('extend_face:', `${what}:`))
    throw e
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

/** The edges of curves given as edges, wires or lists of them. */
/** `tool` as curves where it is curves (an edge, a wire, or a list of them, none empty), else null (a
 * body, a face, a list of faces, anything else). */
function _asCurves(tool: unknown): Edge | Wire | (Edge | Wire)[] | null {
  if (tool instanceof Edge || tool instanceof Wire) return tool
  if (tool === null || typeof tool !== 'object' || tool instanceof Face || tool instanceof _Body || tool instanceof Vertex) return null
  if (typeof (tool as Any)[Symbol.iterator] !== 'function') return null
  const items = [...(tool as Iterable<unknown>)]
  return items.length && items.every((x) => x instanceof Edge || x instanceof Wire) ? (items as (Edge | Wire)[]) : null
}

export function _curvesOf(items: unknown, what: string): Edge[] {
  if (items instanceof Face || items instanceof _Body || items instanceof Vertex) {
    throw new TypeError(`${what} takes curves (edges or wires), not a ${_typeName(items)}`)
  }
  let edges: Edge[]
  try {
    edges = _flattenEdges(items)
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
    throw new TypeError(`${what} takes curves (edges or wires), not a ${_typeName(items)}`)
  }
  if (!edges.length) throw new RangeError(`${what}: no curves`)
  return edges
}

/** A copy of the body with its faces trimmed by curves that lie on them (ext.trim_with_curves):
 * trimType 0 keeps the side of `point`, 2 splits. */
function _trimWithCurves(body: _Body, edges: readonly Edge[], point: Vector, trimType: number, what: string): number {
  let box = body.bbox()
  for (const e of edges) box = box.union(e.bbox())
  const tol = Math.max(1e-5 * box.diagonal, 1e-7)
  const curves = edges.map((e) => e._copyCurve())
  try {
    return kernelCall(what, () => ext.trim_with_curves(body._brep, curves, point.toArray(), trimType, tol),
      'the curves may cross each other, or run along an edge of the faces')
  } catch (e) {
    if (!(e instanceof RangeError) || !e.message.includes('does not lie')) throw e
    throw new RangeError(`${what}: the curves must lie on the faces (within ${_formatG(tol, 2)}); move them onto them with project()`)
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
}

/** Where curves moved along `d` cross the body's faces: the curves where the surface they sweep
 * meets the body (exact where the kernel's projection, project(), is within 4e-4). */
function _sweptOnto(body: _Body, edges: readonly Edge[], d: Vector): Edge[] {
  const box = body.bbox()
  const out: Edge[] = []
  for (const e of edges) {
    const reach = 2 * (box.diagonal + e.center().sub(box.center).length) + 1
    const sweep = ruled(e, e.translate(d.mul(reach)))
    if (_disjoint(box, sweep.bbox())) continue
    try {
      out.push(...body.intersectionCurves(sweep))
    } catch (err) {
      // (the kernel's intersection fails where there is none)
      if (!(err instanceof KernelError)) throw err
      if (body.distanceTo(sweep) > 1e-7 * reach) continue
      throw err
    }
  }
  return out
}

/** True when a curve on the body is what rays along `d` meet first (at most of three points: a ray
 * can miss a face where it passes a seam). */
function _seenAlong(body: _Body, edge: Edge, d: Vector): boolean {
  const reach = 2 * body.bbox().diagonal + 1
  let seen = 0
  for (const t of [0.25, 0.5, 0.75]) {
    const m = edge.pointAt(t)
    const hits = body.raycast(m.sub(d.mul(reach)), d)
    if (hits.length > 0 && hits[0].point.sub(m).length <= 1e-5 * reach) seen += 1
  }
  return seen >= 2
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
    const job = (): _Job => ({ op: 'shell_brep', bodies: [_smb(this)], tags: [_carried(this._brep)], distance: d, options: { create_solid: true }, faces: [] })
    const b = _isolated('thicken', work, job, hint)
    return _requireSolid(Part._wrap(b, { name: this.name, color: this.color }), 'thicken', hint)
  }

  /**
   * The sheet moved by `distance` along its face normals (a negative distance against them): each face
   * offset, and where faces meet, extended or trimmed to meet again (sharp edges, as `Part.offset`). 0
   * gives an equal copy. Faces that do not share their edges (separate pieces, such as faces copied one
   * by one) move each on its own; join them with `stitch` first.
   *
   * Results the kernel gets wrong (no faces, faces closer to the sheet than `distance`, on its other
   * side, or nowhere at that distance from it) throw a ModelingError; so does an offset beyond the
   * radius of a concave curvature. The kernel step runs in the probe worker, as for `thicken`.
   */
  offset(distance: number): Shell {
    const d = Number(distance)
    if (!Number.isFinite(d)) throw new RangeError('offset: the distance must be a finite number')
    if (d === 0) return this._like(this._copyBrep())
    const hint = 'the kernel cannot offset this sheet by that much (beyond the radius of a concave curvature, or where faces vanish); use a smaller distance'
    // (the kernel's defaults: the extended mode, with self-intersections)
    const work = (): number => kernelCall('offset', () => k.offset_brep(this._brep, d), hint)
    const job = (): _Job => ({ op: 'offset_brep', bodies: [_smb(this)], tags: [_carried(this._brep)], distance: d, options: {} })
    const result = Shell._wrap(_isolated('offset', work, job, hint), { name: this.name, color: this.color })
    const problem = _sheetOffsetProblem(this, result, d)
    if (problem !== null) throw new ModelingError(`offset: the kernel could not offset the sheet by ${_formatG(d)} (it built ${problem}); ${hint}`)
    return result
  }

  /**
   * Cut the sheet along curves that lie on it, and keep one side, or both as faces of their own.
   *
   * @param curves Edges or wires on the sheet: where two sheets meet (`intersectionCurves`), the
   *   long edges of a `surfaceFillet`, curves projected onto the sheet (`project`). A curve may run
   *   across several faces of the sheet. Each one runs from border to border, or closes a loop (a
   *   hole or an outline).
   * @param keep A point on the side to keep, or near it (not on a curve): the faces it reaches
   *   without crossing a curve are kept. `'split'` keeps both sides, as faces of their own.
   * @returns The trimmed sheet (a new one; this one does not change).
   *
   * To cut along a direction instead (a hole through a curved panel), project the outline first:
   * `sheet.trim(sheet.project(Circle(5).edges()[0], [0, 0, -1]), [0, 0, 0])` keeps the disk.
   */
  trim(curves: Edge | Wire | Iterable<Edge | Wire>, keep: VectorLike | string): this {
    const split = typeof keep === 'string'
    if (split && keep !== 'split') throw new RangeError(`trim: keep is a point on the side to keep, or "split"; got '${keep}'`)
    const point = split ? new Vector() : _vec(keep as VectorLike)
    const edges = _curvesOf(curves, 'trim')
    const before = this.area
    const n = this.faces().length
    const out = this._like(_trimWithCurves(this, edges, point, split ? 2 : 0, 'trim'))
    const after = out.faces().length ? out.area : 0
    const tol = 1e-4 * Math.max(before, 1e-12)
    if (split) {
      if (out.faces().length <= n || Math.abs(after - before) > tol) {
        throw new ModelingError('trim: the curves do not split the sheet: each must run across a face from border to border, or close a loop on it')
      }
    } else if (!out.faces().length) {
      throw new ModelingError('trim: nothing is left; the point lies on no side the curves cut off')
    } else if (!(after < before - tol)) {
      throw new ModelingError('trim: the curves do not cut the sheet in two: each must run across a face from border to border, or close a loop on it')
    }
    return out
  }

  /**
   * The sheet turned over: a copy whose faces' normals all point the other way.
   *
   * `thicken` then grows to the other side, and the `sides` of `surfaceFillet` count from the new
   * normals. A sheet that encloses a volume (the face of a whole sphere) faces outward whichever
   * way its surface runs: it cannot be turned over (RangeError).
   */
  flipped(): this {
    const out = this._like(kernelCall('flipped', () => ext.flip_faces(this._brep)))
    const before = this.faces()
    const after = out.faces()
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      const p = before[i].interiorPoint()
      if (!(before[i].normalAt(p).dot(after[i].normalAt(p)) < 0)) {
        throw new RangeError('flipped: the sheet encloses a volume; its faces point out of it whichever way their surfaces run')
      }
    }
    return out
  }

  /**
   * The sheet (of one face) grown past its sides: see `Face.extended`.
   *
   * @param distance How far past each side, measured along the surface.
   * @param options `sides`: edges of the sheet: grow past the sides they lie on only (default: every
   *   side that can grow). `continuity`: `'natural'` (default), `'G1'` or `'G2'`.
   * @returns A new sheet; this one does not change. For a sheet of several faces, extend one of its
   *   faces (`sheet.faces()[i].extended(...)`).
   */
  extend(distance: number, options: { sides?: Edge | Iterable<Edge> | null; continuity?: string } = {}): this {
    _opts('Shell.extend', options)
    const faces = this.faces()
    if (faces.length !== 1) {
      throw new RangeError(`extend: the sheet has ${faces.length} faces; extend one of them with sheet.faces()[i].extended(...)`)
    }
    return this._like(_extendedFace(faces[0], distance, options.sides ?? null, options.continuity ?? 'natural', 'extend'))
  }

  /**
   * The sheet with an edge moved onto a curve: the edge runs along `target` from end to end,
   * exactly, and its face bends to follow, smoothly, near the edge only. To close a gap between two
   * sheets before `stitch`, match one sheet's edge to the other's; to give a sheet a styling line,
   * match it to that curve.
   *
   * @param edge An edge of the sheet, a whole side of its face.
   * @param target The curve to run along (an edge, or a wire whose edges join end to end), either way
   *   round; its ends are where the edge's ends go.
   * @param options `extent`: how far into the face the change reaches: a part of the face's
   *   parameter range across from the edge (above 0, below 1; default 0.25). The face meets the rest
   *   of itself there with continuous derivatives (up to its degree less one).
   *
   * Where the curve's ends are not the edge's, the edge's vertices move to them, the edges next to it
   * bend near those ends, and the faces on the other side of those edges follow them the same way.
   * Every face that changes must be bounded by the four sides of its surface (as `surface`, `loft`,
   * `ruled`, `fill` and `network` make them; no holes, no trimmed borders) and the edge a whole side
   * of it, else RangeError. The faces become B-splines (planes too).
   *
   * @returns A new sheet; this one does not change. A Sketch's comes back as a Shell.
   */
  matchEdge(edge: Edge, target: Edge | Wire, options: { extent?: number } = {}): Shell {
    _opts('Shell.matchEdge', options)
    const b = _matchEdge(this, edge, target, options.extent ?? 0.25)
    return this instanceof Sketch ? Shell._wrap(b, { name: this.name, color: this.color }) : this._like(b)
  }

  /**
   * The sheet with two faces made one: one surface over both, where they share a whole side, such
   * as the halves of a sheet split along a curve of its surface, or patches built through the same
   * curves. The joint's knot goes where the faces meet smoothly enough (within the sheet's
   * tolerance), so a split sheet comes back as it was.
   *
   * @param a A face of the sheet, bounded by the four sides of its surface (no holes, no trimmed
   *   borders).
   * @param b Another such face, sharing one whole side with `a` (and no other).
   *
   * The joined surface must reproduce both faces (within the sheet's tolerance), else RangeError:
   * faces whose parameters run at different speeds along the shared side, or whose normals point to
   * opposite sides, are not merged. The merged face's normal is `a`'s.
   *
   * @returns A new sheet with one face less; this one does not change. A Sketch's comes back as a
   *   Shell.
   */
  mergeFaces(a: Face, b: Face): Shell {
    const out = _mergeFaces(this, a, b)
    return this instanceof Sketch ? Shell._wrap(out._copyBrep(), { name: this.name, color: this.color }) : this._like(out._copyBrep())
  }

  /** Push or pull a face of the sheet at a point: see `Part.push` (`by` as a distance moves along the
   * face's normal). Returns a new sheet; a Sketch's comes back as a Shell. */
  push(face: Face, at: VectorLike, options: PushOptions = {}): Shell {
    _opts('Shell.push', options)
    return _checked(this, _push(this, face, at, options.by ?? null, options.to ?? null, options.normal ?? null, options.radius ?? null,
      options.continuity ?? 'G1'), 'push')
  }

  /** Raise or sink a region of a face of the sheet: see `Part.warp`. Returns a new sheet; a Sketch's
   * comes back as a Shell. */
  warp(face: Face, region: unknown, by: number | VectorLike, options: { continuity?: string } = {}): Shell {
    _opts('Shell.warp', options)
    return _checked(this, _warp(this, face, region, by, options.continuity ?? 'G2'), 'warp')
  }

  /** Press a region of a face of the sheet onto a plane: see `Part.flatten`. Returns a new sheet; a
   * Sketch's comes back as a Shell. */
  flatten(face: Face, region: unknown, plane: Plane | Face, options: { continuity?: string } = {}): Shell {
    _opts('Shell.flatten', options)
    return _checked(this, _flatten(this, face, region, plane, options.continuity ?? 'G2'), 'flatten')
  }

  /** Union with other sheets (Python's `+`). */
  fuse(...others: unknown[]): Shell {
    return this._like(_held(this._copyBrep(), (h) => {
      for (const t of _bodies(others)) kernelCall('fuse', () => _combine(h, t, k.BooleanOp.UNION))
    }))
  }

  /** The sheet trimmed by parts: the pieces outside them (Python's `sheet - part`). */
  cut(...others: unknown[]): Shell {
    return this._trimmed(others, k.BooleanOp.DIFFERENCE, 'cut')
  }

  /** The sheet trimmed by parts: the pieces inside them (Python's `sheet & part`; also
   * `part.intersect(sheet)`). */
  intersect(...others: unknown[]): Shell {
    return this._trimmed(others, k.BooleanOp.INTERSECTION, 'intersect')
  }

  /** The sheet less the pieces inside (or outside) parts. The kernel's Boolean of a sheet and a
   * solid trims the sheet; checked: every face of the result lies on the sheet, and its area is no
   * more than the sheet's. */
  _trimmed(others: unknown, op: number, name: string): Shell {
    const tools = _bodies(others, name)
    if (!tools.length) throw new RangeError(`${name} needs a part`)
    for (const t of tools) {
      if (!(t instanceof Part) || t instanceof Sketch) {
        throw new TypeError(`a sheet is trimmed by parts (sheet - part, sheet & part), not by a ${_typeName(t)}`)
      }
      t._requireValid(name)
    }
    if (k.brep_face_count(this._brep) === 0) return this._like(this._copyBrep())
    const result = this._like(
      _held(this._copyBrep(), (h) => {
        for (const t of tools) {
          if (k.brep_face_count(h.brep) === 0) break
          const [lo, hi] = k.brep_bounding_box(h.brep, false) as [number[], number[]]
          if (_disjoint(new BoundBox(lo, hi), t._looseBox())) {
            if (op === k.BooleanOp.INTERSECTION) h.brep = ext.combine([])
            continue
          }
          kernelCall(name, () => _combine(h, t, op), 'the sheet may only touch the part, or lie in one of its faces')
        }
      }),
    )
    if (k.brep_is_manifold_solid(result._brep)) throw new ModelingError(`${name}: the kernel returned a solid, not a piece of the sheet`)
    const tol = 1e-5 * Math.max(1, this.bbox().diagonal)
    for (const f of result.faces()) {
      if (this.distanceTo(f.interiorPoint()) > tol) throw new ModelingError(`${name}: the kernel returned a face that is not on the sheet`)
    }
    if (k.brep_face_count(result._brep) && result.area > this.area * (1 + 1e-6) + tol) {
      throw new ModelingError(`${name}: the kernel returned more of the sheet (${_formatG(result.area)}) than there is (${_formatG(this.area)})`)
    }
    return result
  }

  override toString(): string {
    return `${_typeName(this)}(${k.brep_face_count(this._brep)} faces, area=${_formatG(this.area)})`
  }
}

/** How `Part.push` and `Shell.push` move the point (see `Part.push`). */
export interface PushOptions {
  /** How far the point moves: a distance along the face's outward normal there, or a vector. */
  by?: number | VectorLike | null
  /** Where the point moves to, instead of `by`. */
  to?: VectorLike | null
  /** The face's normal at the moved point (default: as it was there). */
  normal?: VectorLike | null
  /** How far from the point the face changes (default: up to the face's nearest edge). */
  radius?: number | null
  /** `'G0'`, `'G1'` (default) or `'G2'`: how the face stays joined to its neighbours. */
  continuity?: string
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

  /** The sketch turned over: its faces and its plane face the other way (an extrusion then grows to
   * the other side). */
  override flipped(): this {
    const out = super.flipped()
    out._plane = this._plane.flipped()
    return out
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
  override cut(...others: unknown[]): Sketch {
    return this._boolean2d(others, k.BooleanOp2D.DIFFERENCE, 'cut')
  }

  /** The region common to this and other sketches (Python's `&`). */
  override intersect(...others: unknown[]): Sketch {
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

  /**
   * Area, centroid and second moments of area of the region (a beam's or an extrusion's profile):
   * `ixx`, `iyy` and `ixy` about the centroid in the axes of the sketch plane, the principal
   * moments and axes, the polar moment, the radii of gyration and the section moduli (see
   * `SectionProperties`).
   *
   * Integrated as the mass properties of a thin slab of the region (to `ACCURACY` of the largest
   * moment), less the slab's own thickness term.
   */
  sectionProperties(): SectionProperties {
    if (!this.faces().length) throw new RangeError('sectionProperties: the sketch is empty')
    const pl = this._plane
    const local = new Plane(pl.origin, pl.xDir, pl.zDir)
    const flat = this.moved(local.location.inverse()) // the region in the plane's axes, on z = 0
    const box = flat.bbox()
    const h = 0.1 * Math.max(box.diagonal, 1e-9) // a slab thin against the region, thick enough to integrate
    const mp = flat.extrude(h).massProperties()
    const area = mp.volume / h
    const c = mp.center
    const i = mp.inertia
    const slab = (area * h ** 3) / 12 // the slab's moment about the x and y axes through its middle
    const ixx = (i[0][0] - slab) / h
    const iyy = (i[1][1] - slab) / h
    const ixy = -i[0][1] / h
    const extent: [number, number, number, number] = [box.min.x - c.x, box.max.x - c.x, box.min.y - c.y, box.max.y - c.y]
    const centroid = local.fromLocal([c.x, c.y, 0])
    return new SectionProperties(area, new Plane(centroid, local.xDir, local.zDir), ixx, iyy, ixy, extent)
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
  override offset(distance: number, options: { corners?: string; round?: boolean | null } = {}): Sketch {
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
   * arcs are rounded exactly; next to a spline or an ellipse the arc's center lies at `radius` from
   * both curves (where their offsets meet), and the curves are cut where it touches them. A corner
   * that does not fit, a point that is not a corner, or a smooth corner throws ModelingError.
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
