// Deformations: twist, taper, bend and unroll parts, sheets, edges, wires and points, or deform them
// with a lattice of control points, in three's terms: angles in radians, axes THREE.Rays (by
// default three's y axis, up, through the origin, along which cylinders stand), the frame of a bend
// a THREE.Matrix4, points THREE.Vector3s, and a Lattice whose points are indexed along x, y and z.
//
//     const column = twist(new Box(20, 120, 20), Math.PI / 2)          // a quarter turn over its height
//     const grip = taper(new Cylinder(12, 12, 80), 0.7)                // 70 % of the diameter at the top
//     const hook = bend(new Box(160, 6, 10), Math.PI, { radius: 25 })  // a U, bent up, with straight legs
//     const lattice = new Lattice(block, 3)                             // 3 x 3 x 3 points around it
//     lattice.move([1, -1, 1], new THREE.Vector3(0, 8, 0))              // the top layer's middle point up by 8
//     const pillow = lattice.apply(block)
//
// A deformation is a map of space in the frame of the shape it deforms: its axes, frames, ranges and
// lattices are in that frame, and so is the result, which has the shape's transform (an edge or wire
// of a body comes back as a curve of its own, where the body is). Points are mapped as they are, in
// the coordinates the axis is given in.
import * as THREE from 'three'
import { axis as toAxis, boundBox, box3, call, degrees, describe, sm, vec, vector3, type SmBody } from './kernel.ts'
import { adopt, Body, BrepEdge, isObject3D, isRay, kernelOf, kernelOfShape, placedCurve, wrap, Wire, type Part, type Shell } from './shapes.ts'

// (this module and shapes.ts import each other: what it takes from shapes.ts is used in calls only,
// never while the module loads)

/** Where a deformation applies along its axis: distances along the axis from its origin. */
export interface RangeOptions {
  /** Where the deformation begins (default: where the shape begins along the axis). What lies
   * before it stays. */
  start?: number | null
  /** Where it ends (default: where the shape ends along the axis). What lies beyond it moves as the
   * end does. */
  end?: number | null
  /** The largest distance of the deformed faces and edges from the exact map, in model units
   * (default 1e-6). */
  tolerance?: number | null
}

/** Options of twists. */
export interface TwistOptions extends RangeOptions {
  /** The line to twist about, in the shape's frame (default: its y axis, through the origin). */
  axis?: THREE.Ray | null
}

/** Options of tapers. */
export interface TaperOptions extends RangeOptions {
  /** The line the cross-sections shrink toward, in the shape's frame (default: its y axis, through
   * the origin). */
  axis?: THREE.Ray | null
}

/** Options of bends. */
export interface BendOptions extends RangeOptions {
  /** The bend radius of the neutral layer. With `radius` and neither `start` nor `end`, the bend
   * (`radius * angle` long) is centered on the frame's origin; with one of them it begins or ends
   * there. Without it, `start` and `end` set it: radius = (end - start) / angle. */
  radius?: number | null
  /**
   * The frame of the bend, in the shape's frame: its x axis runs along the part, a positive angle
   * bends the part toward its y axis, the bend axis is parallel to x × y, and the layer through its
   * origin spanned by x and x × y is the neutral layer, which keeps its length. Default: the
   * identity (a part lying along x bends up, toward +y, about an axis along z). (smlibpy's `plane`:
   * a frame, which a THREE.Plane is not.)
   */
  frame?: THREE.Matrix4 | null
}

/** Options of unrolls. */
export interface UnrollOptions {
  /** The radius of the neutral layer, the one that keeps its length (> 0). */
  radius: number
  /** The axis the shape is rolled about, in its frame (default: its y axis, through the origin). */
  axis?: THREE.Ray | null
  /** A direction across the axis, in the shape's frame: the line (at every distance from the axis)
   * that stays in place. Default: the middle of the shape's angle about the axis. */
  start?: THREE.Vector3Like | null
  /** The largest distance of fitted faces from the exact unroll, in model units (default 1e-6). */
  tolerance?: number | null
}

/** What a deformation takes: a body, a curve, a point or points. */
type Input = Part | Shell | BrepEdge | Wire | THREE.Vector3Like | readonly THREE.Vector3Like[]
type Output = Part | Shell | BrepEdge | Wire | THREE.Vector3 | THREE.Vector3[]

/**
 * The shape twisted about an axis by `angle` radians over its length (or from `start` to `end`):
 * every cross-section turns by an angle that grows evenly from 0 at `start` to `angle` at `end`,
 * counterclockwise seen from the tip of the axis (the right-hand rule, as three's rotations turn);
 * what lies beyond `end` turns by the whole angle. The volume stays. A cylinder, cone, sphere or
 * torus about the axis stays the exact face it was, the turned ends stay planes, the other faces
 * become NURBS within `tolerance`.
 *
 * A Part gives a Part and a Shell (or Sketch) a Shell, in the shape's frame with its transform; an
 * BrepEdge gives a BrepEdge and a Wire a Wire, curves of their own where the shape is; a point (a
 * THREE.Vector3 or `{ x, y, z }`) gives the THREE.Vector3 the twist moves it to, an array of points
 * an array. Give points `start` and `end` (the range of the part they belong to): a point has no
 * length along the axis. An edge's or wire's default range is its own; give it the part's `start`
 * and `end` to deform it as the part deforms.
 */
export function twist(shape: Part, angle: number, options?: TwistOptions): Part
export function twist(shape: Shell, angle: number, options?: TwistOptions): Shell
export function twist(shape: BrepEdge, angle: number, options?: TwistOptions): BrepEdge
export function twist(shape: Wire, angle: number, options?: TwistOptions): Wire
export function twist(point: THREE.Vector3Like, angle: number, options?: TwistOptions): THREE.Vector3
export function twist(points: readonly THREE.Vector3Like[], angle: number, options?: TwistOptions): THREE.Vector3[]
export function twist(shape: Input, angle: number, options: TwistOptions = {}): Output {
  const a = degrees(checkAngle(angle, 'twist'))
  const o = { ...options, axis: axisOf(options.axis) }
  return deformed(shape, 'twist', (k) => sm.twist(k as sm.Part, a, o))
}

/**
 * The shape tapered along an axis: its cross-sections scale toward the axis by a factor that
 * changes evenly from 1 at `start` to `scale` at `end` (0.5 halves them, 2 doubles them); what lies
 * beyond `end` is scaled by `scale` across the axis. The result is exact: a cylinder becomes a cone,
 * a box a frustum of a pyramid, and lines along the axis stay straight. Shapes, curves and points as
 * for `twist`.
 */
export function taper(shape: Part, scale: number, options?: TaperOptions): Part
export function taper(shape: Shell, scale: number, options?: TaperOptions): Shell
export function taper(shape: BrepEdge, scale: number, options?: TaperOptions): BrepEdge
export function taper(shape: Wire, scale: number, options?: TaperOptions): Wire
export function taper(point: THREE.Vector3Like, scale: number, options?: TaperOptions): THREE.Vector3
export function taper(points: readonly THREE.Vector3Like[], scale: number, options?: TaperOptions): THREE.Vector3[]
export function taper(shape: Input, scale: number, options: TaperOptions = {}): Output {
  const o = { ...options, axis: axisOf(options.axis) }
  return deformed(shape, 'taper', (k) => sm.taper(k as sm.Part, scale, o))
}

/**
 * The shape bent around an axis by `angle` radians (less than a full turn; positive: toward the y
 * axis of `frame`), like a bar over a mandrel. Material on the inside of the neutral layer is
 * compressed, on the outside stretched. The bend axis lies `radius` from the neutral layer on the
 * side the part bends toward, and the part must not reach it. `start` and `end` are distances along
 * the frame's x axis from its origin (default: where the part begins and ends along it, so
 * `bend(part, Math.PI / 2)` bends the whole part into a quarter circle); what lies before `start`
 * stays, what lies beyond `end` goes on straight, turned by `angle`.
 *
 * Plane faces across the bend become exact cylinders about the bend axis and lines across it exact
 * arcs, so a bent plate is sheet metal to `bends` and `unfold`. A Wire comes back with every piece an
 * edge of its own (a straight path bent in its middle: line, arc, line), a BrepEdge as one edge. Shapes,
 * curves and points otherwise as for `twist`.
 */
export function bend(shape: Part, angle: number, options?: BendOptions): Part
export function bend(shape: Shell, angle: number, options?: BendOptions): Shell
export function bend(shape: BrepEdge, angle: number, options?: BendOptions): BrepEdge
export function bend(shape: Wire, angle: number, options?: BendOptions): Wire
export function bend(point: THREE.Vector3Like, angle: number, options?: BendOptions): THREE.Vector3
export function bend(points: readonly THREE.Vector3Like[], angle: number, options?: BendOptions): THREE.Vector3[]
export function bend(shape: Input, angle: number, options: BendOptions = {}): Output {
  if (Math.abs(checkAngle(angle, 'bend')) >= 2 * Math.PI) {
    throw new RangeError(`bend: the angle must be less than a full turn (2π radians; a full turn would make the part touch itself), not ${angle}`)
  }
  const a = degrees(angle)
  if ('plane' in options) throw new TypeError("bend: the bend's frame is the option `frame` (a THREE.Matrix4), not `plane`")
  const { frame, ...rest } = options
  const o = { ...rest, plane: bendPlane(frame ?? new THREE.Matrix4()) }
  return deformed(shape, 'bend', (k) => sm.bend(k as sm.Part, a, o))
}

/**
 * The shape wrapped around an axis laid out flat: the inverse of a bend of the whole shape. A point at
 * distance r from the axis and at the angle a (radians, about the axis) from `start` goes to distance
 * r from the axis along `start` and `radius * a` across it, so the layer at `radius` keeps its length,
 * material inside it gets longer and outside it shorter. Cylinders about the axis become planes and
 * circles about it lines (a helix about it a line). The shape must not reach the axis, must cover less
 * than a full turn about it, and must not reach the half-plane opposite `start`, where it would
 * tear. Shapes, curves and points as for `twist`.
 */
export function unroll(shape: Part, options: UnrollOptions): Part
export function unroll(shape: Shell, options: UnrollOptions): Shell
export function unroll(shape: BrepEdge, options: UnrollOptions): BrepEdge
export function unroll(shape: Wire, options: UnrollOptions): Wire
export function unroll(point: THREE.Vector3Like, options: UnrollOptions): THREE.Vector3
export function unroll(points: readonly THREE.Vector3Like[], options: UnrollOptions): THREE.Vector3[]
export function unroll(shape: Input, options: UnrollOptions = {} as UnrollOptions): Output {
  const o = { ...options, axis: axisOf(options.axis), start: options.start == null ? undefined : vec(options.start) }
  return deformed(shape, 'unroll', (k) => sm.unroll(k as sm.Part, o))
}

/**
 * `shape` sent through a deformation: a body or curve as its kernel value in its own frame (the
 * result in that frame, with its transform), points as the kernel's vectors.
 */
function deformed(shape: unknown, what: string, run: (value: unknown) => unknown): Output {
  if (shape instanceof Body) {
    const value = kernelOf(shape)
    // (a deformed sketch is no longer planar: a Shell)
    return adopt(wrap(call(() => run(value)) as SmBody), shape) as Part | Shell
  }
  if (shape instanceof BrepEdge || shape instanceof Wire) {
    const value = kernelOfShape(shape)
    return placedCurve(call(() => run(value)) as sm.Edge | sm.Wire, shape)
  }
  if (Array.isArray(shape)) {
    if (!shape.length) return []
    const points = shape.map((p: unknown) => pointOf(p, what))
    return (call(() => run(points)) as sm.Vector[]).map((v) => vector3(v))
  }
  return vector3(call(() => run(pointOf(shape, what))) as sm.Vector)
}

function pointOf(p: unknown, what: string): sm.Vector {
  const v = p as { x?: unknown; y?: unknown; z?: unknown } | null
  if (v === null || typeof v !== 'object' || isObject3D(v) || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') {
    throw new TypeError(`${what}: give a Part, Shell, BrepEdge, Wire or points (THREE.Vector3s), not ${describe(p)}`)
  }
  return vec(v as THREE.Vector3Like)
}

/** An angle in radians, checked here so that the message speaks of radians. */
function checkAngle(angle: unknown, what: string): number {
  if (typeof angle !== 'number') throw new TypeError(`${what}: the angle is a number of radians, not ${describe(angle)}`)
  if (!Number.isFinite(angle)) throw new RangeError(`${what}: the angle must be a finite number of radians, not ${angle}`)
  return angle
}

/** An axis given, or three's y axis through the origin (the kernel's default is its z axis). */
function axisOf(r: THREE.Ray | null | undefined): sm.Axis {
  return r == null ? call(() => new sm.Axis([0, 0, 0], [0, 1, 0])) : toAxis(r)
}

/** The frame of a bend (a THREE.Matrix4: x along the part, y toward the inside of the bend) as the
 * kernel's plane: origin, x direction and normal x × y. */
function bendPlane(m: THREE.Matrix4): sm.Plane {
  if ((m as { isMatrix4?: boolean } | null)?.isMatrix4 !== true) {
    throw new TypeError(`bend: frame is a THREE.Matrix4 (its x axis along the part, its y axis toward the inside of the bend), not ${describe(m)}`)
  }
  const x = new THREE.Vector3()
  const y = new THREE.Vector3()
  m.extractBasis(x, y, new THREE.Vector3())
  const normal = new THREE.Vector3().crossVectors(x, y)
  if (!(normal.length() > 1e-12 * Math.max(x.length() * y.length(), 1e-300))) {
    throw new RangeError('bend: the x and y axes of frame must point in different directions')
  }
  const origin = new THREE.Vector3().setFromMatrixPosition(m)
  return call(() => new sm.Plane(vec(origin), vec(x.normalize()), vec(normal.normalize())))
}

// ---------------------------------------------------------------------------------- the lattice
/** Which layers of a lattice along one axis: a number (negative ones count from the end), null for
 * all of them, or an array of numbers. */
export type LatticeLayers = number | null | readonly number[]

/** A selection of points of a lattice: `[i, j, k]` along x, y (up) and z, each a
 * `LatticeLayers`; the points are every combination (`[1, -1, 1]` is the middle of the top layer of
 * a 3 x 3 x 3 lattice, `[null, -1, null]` the whole top layer). */
export type LatticeIndex = readonly [LatticeLayers, LatticeLayers, LatticeLayers]

/** One of three's axes, for `Lattice.layer`: 'x', 'y' or 'z', or a direction (or THREE.Ray) along one. */
export type LatticeAxis = 'x' | 'y' | 'z' | THREE.Vector3Like | THREE.Ray

/**
 * A grid of control points around a shape, for free-form deformation with exact results: the points
 * start evenly spaced over a box (`counts` per axis, corners included); move them, then `apply` the
 * lattice to a shape, and space inside the box moves smoothly with them (a Bezier volume; space
 * outside follows the same polynomial). A lattice whose points were not moved changes nothing.
 *
 * Its points are indexed along x, y (up) and z: `points[i][j][k]` is the point i along x, j
 * along y and k along z, a THREE.Vector3 in the frame of the shapes the lattice is applied to (the
 * frame of the shape whose box it was made around, as a plane given to a method is). `move`, `scale`
 * and `rotate` take a selection `[i, j, k]` (see `LatticeIndex`, or `layer()`), change the lattice in
 * place and return it.
 *
 * A lattice is a global map, for the overall shape: every point pulls the whole box, most near
 * itself (by Bernstein polynomials), so one moved point changes every face it does not leave in place;
 * the middle point of the top layer of a 3 x 3 x 3 lattice moved up by 8 lifts the middle of the top
 * by 2.
 */
export class Lattice {
  /** Where the points are, `points[i][j][k]` along x, y (up) and z, in the frame of the
   * shapes the lattice is applied to. Writable: `lattice.points[1][2][1].y += 5` lifts one point. */
  points: THREE.Vector3[][][]
  // the kernel's lattice: its box, its counts and its points along x, y and z
  #lattice: sm.Lattice
  #rest: THREE.Vector3[][][]

  /**
   * @param box A THREE.Box3, or a shape (anything with `bbox()`: a Part, Shell, BrepFace, BrepEdge or Wire),
   *   whose bounding box (in its frame) is used.
   * @param counts Points per axis, one number for all or three ([x, y, z]), 2 to 12: 2 moves the
   *   corners only (a trilinear map), 3 adds the middles (default). More points concentrate a
   *   point's pull nearer to it without confining it; the degree of the exact result grows with them.
   * @param options `margin`: the box grown by this much on every side (for flat shapes).
   */
  constructor(box: THREE.Box3 | { bbox(): THREE.Box3 }, counts: number | readonly number[] = 3, options: { margin?: number } = {}) {
    const b = (box as THREE.Box3 | null)?.isBox3 === true ? (box as THREE.Box3) : typeof (box as { bbox?: unknown } | null)?.bbox === 'function' ? (box as { bbox(): THREE.Box3 }).bbox() : null
    if (b === null) throw new TypeError(`Lattice: give a THREE.Box3, or a shape whose box to take, not ${describe(box)}`)
    const c = typeof counts === 'number' ? [counts, counts, counts] : Array.from(counts)
    if (c.length !== 3) throw new RangeError('Lattice: counts are one number, or three ([x, y, z])')
    this.#lattice = call(() => new sm.Lattice(boundBox(b), [c[0], c[1], c[2]], options))
    this.#rest = fromKernel(this.#lattice.rest)
    this.points = copyGrid(this.#rest)
  }

  /** Points per axis: [x, y, z]. */
  get counts(): [number, number, number] {
    const [x, y, z] = this.#lattice.counts
    return [x, y, z]
  }

  /** The box the points started on (a new THREE.Box3). */
  get box(): THREE.Box3 {
    return box3(this.#lattice.box)
  }

  /** Where the points started, indexed as `points` (new THREE.Vector3s). */
  get rest(): THREE.Vector3[][][] {
    return copyGrid(this.#rest)
  }

  /** How far each point was moved (`points - rest`), indexed as `points`. */
  get offsets(): THREE.Vector3[][][] {
    return this.points.map((a, i) => a.map((b, j) => b.map((p, k) => new THREE.Vector3(p.x, p.y, p.z).sub(this.#rest[i][j][k]))))
  }

  /**
   * The points of one layer across an axis, as a selection: `layer('y', -1)` is the top layer,
   * `layer('x', 0)` the points at the smallest x.
   */
  layer(axis: LatticeAxis, index: number): [LatticeLayers, LatticeLayers, LatticeLayers] {
    const i = axisIndex(axis)
    const n = this.counts[i]
    if (!Number.isInteger(index) || index < -n || index >= n) {
      throw new RangeError(`Lattice.layer: index ${index} is out of range for the ${n} layers along ${'xyz'[i]}`)
    }
    const selection: [LatticeLayers, LatticeLayers, LatticeLayers] = [null, null, null]
    selection[i] = index
    return selection
  }

  /** Moves the selected points by `offset`. In place; returns the lattice. */
  move(index: LatticeIndex, offset: THREE.Vector3Like): this {
    const d = vector(offset, 'Lattice.move')
    return this.#update(index, 'Lattice.move', (points) => points.map((p) => p.add(d)))
  }

  /** Scales the selected points about `center` (default: their centroid) by `factor`: one number, or
   * one per axis of three's (a THREE.Vector3). In place; returns the lattice. */
  scale(index: LatticeIndex, factor: number | THREE.Vector3Like, center: THREE.Vector3Like | null = null): this {
    const f = typeof factor === 'number' ? new THREE.Vector3(factor, factor, factor) : vector(factor, 'Lattice.scale')
    return this.#update(index, 'Lattice.scale', (points) => {
      const c = center === null ? points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length) : vector(center, 'Lattice.scale')
      return points.map((p) => p.sub(c).multiply(f).add(c))
    })
  }

  /** Turns the selected points by `angle` radians about `axis` (a THREE.Ray; the right-hand rule).
   * In place; returns the lattice. */
  rotate(index: LatticeIndex, axis: THREE.Ray, angle: number): this {
    if (!isRay(axis)) throw new TypeError(`Lattice.rotate: the axis is a THREE.Ray, not ${describe(axis)}`)
    const d = new THREE.Vector3(axis.direction.x, axis.direction.y, axis.direction.z)
    if (!(d.length() > 1e-12)) throw new RangeError('Lattice.rotate: the axis has no direction')
    d.normalize()
    const o = new THREE.Vector3(axis.origin.x, axis.origin.y, axis.origin.z)
    const a = checkAngle(angle, 'Lattice.rotate')
    return this.#update(index, 'Lattice.rotate', (points) => points.map((p) => p.sub(o).applyAxisAngle(d, a).add(o)))
  }

  /** Puts every point back where it started. In place; returns the lattice. */
  reset(): this {
    if (!this.#shaped()) {
      this.points = copyGrid(this.#rest)
      return this
    }
    return this.#update([null, null, null], 'Lattice.reset', () => this.#rest.flat(2).map((p) => p.clone()))
  }

  /** An independent copy (smlibpy's `copy()`, named as three's math types name it). */
  clone(): Lattice {
    return new Lattice(this.box, this.counts).copy(this)
  }

  /** Makes this lattice a copy of `source`: its box, counts and points (as three's `copy`). */
  copy(source: Lattice): this {
    if (!(source instanceof Lattice)) throw new TypeError(`Lattice.copy: give a Lattice, not ${describe(source)}`)
    this.#lattice = source.#lattice.copy()
    this.#rest = source.#rest
    this.points = copyGrid(source.points)
    return this
  }

  /** Where the lattice moves `point` (in the frame the lattice is in). */
  map(point: THREE.Vector3Like, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const lattice = this.#kernel()
    const p = vec(point)
    return vector3(call(() => lattice.map(p)), target)
  }

  /**
   * The shape deformed by the lattice, which is in the shape's frame: a Part gives a Part and a Shell
   * (or Sketch) a Shell, in the shape's frame with its transform; a BrepEdge a BrepEdge and a Wire a Wire
   * (exact B-splines; lines and arcs it only moves stay lines and arcs), curves of their own where
   * the shape is; points their THREE.Vector3s (as `map`). The result is exact, unless a face's image
   * needs a degree above 12: such faces are within `tolerance`. A lattice that folds a part onto
   * itself (a point moved past its neighbours) is refused with a ModelingError; curves and points are
   * not checked for that.
   */
  apply(shape: Part, options?: { tolerance?: number | null }): Part
  apply(shape: Shell, options?: { tolerance?: number | null }): Shell
  apply(shape: BrepEdge, options?: { tolerance?: number | null }): BrepEdge
  apply(shape: Wire, options?: { tolerance?: number | null }): Wire
  apply(point: THREE.Vector3Like, options?: { tolerance?: number | null }): THREE.Vector3
  apply(points: readonly THREE.Vector3Like[], options?: { tolerance?: number | null }): THREE.Vector3[]
  apply(shape: Input, options: { tolerance?: number | null } = {}): Output {
    const lattice = this.#kernel()
    return deformed(shape, 'lattice', (k) => lattice.apply(k as sm.Part, options))
  }

  /** A summary: the counts, how many points were moved, the box. */
  toString(): string {
    const [x, y, z] = this.counts
    let moved = 0
    for (const a of this.offsets) for (const b of a) for (const d of b) if (d.lengthSq() > 0) moved++
    const b = this.box
    const f = (v: THREE.Vector3) => `(${+v.x.toPrecision(6)}, ${+v.y.toPrecision(6)}, ${+v.z.toPrecision(6)})`
    return `Lattice(${x} x ${y} x ${z} points, ${moved} moved, box ${f(b.min)} to ${f(b.max)})`
  }

  /** True while `points` is still a grid of the lattice's counts. */
  #shaped(): boolean {
    const [nx, ny, nz] = this.counts
    const p = this.points as unknown
    return Array.isArray(p) && p.length === nx && p.every((a) => Array.isArray(a) && a.length === ny && a.every((b) => Array.isArray(b) && b.length === nz))
  }

  /** The selected points (copies, in the order of their selection, repeats included) mapped by `f`
   * all at once, from where they were, and set. */
  #update(index: LatticeIndex, what: string, f: (points: THREE.Vector3[]) => THREE.Vector3[]): this {
    if (!this.#shaped()) throw new RangeError(`${what}: points must stay a ${this.counts.join(' x ')} grid of THREE.Vector3s`)
    const cells = this.#cells(index, what)
    const moved = f(cells.map(([i, j, k]) => vector(this.points[i][j][k], what)))
    cells.forEach(([i, j, k], n) => {
      const p = this.points[i][j][k]
      if ((p as { isVector3?: boolean } | null)?.isVector3 === true) p.copy(moved[n])
      else this.points[i][j][k] = moved[n].clone()
    })
    return this
  }

  /** The [i, j, k] of the selected points, in the order of the selection (repeats included). */
  #cells(index: LatticeIndex, what: string): [number, number, number][] {
    if (!Array.isArray(index) || index.length !== 3) {
      throw new RangeError(`${what}: select points with three indices [i, j, k] along x, y and z, e.g. [1, -1, 1], [null, 0, null] or lattice.layer('y', -1)`)
    }
    const layers = this.counts.map((n, axis) => {
      const one = (i: unknown): number => {
        if (typeof i !== 'number' || !Number.isInteger(i)) throw new RangeError(`${what}: an index is a whole number, null (all) or an array of whole numbers, not ${describe(i)}`)
        if (i < -n || i >= n) throw new RangeError(`${what}: index ${i} is out of range for the ${n} points along ${'xyz'[axis]}`)
        return i < 0 ? i + n : i
      }
      const s = index[axis] as unknown
      if (s == null) return Array.from({ length: n }, (_, i) => i)
      if (Array.isArray(s)) return s.map(one)
      return [one(s)]
    })
    const out: [number, number, number][] = []
    for (const i of layers[0]) for (const j of layers[1]) for (const k of layers[2]) out.push([i, j, k])
    return out
  }

  /** The kernel's lattice, with this one's points. */
  #kernel(): sm.Lattice {
    if (!this.#shaped()) throw new RangeError(`Lattice: points must stay a ${this.counts.join(' x ')} grid of THREE.Vector3s`)
    const [nx, ny, nz] = this.counts
    const points = this.#lattice.points
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let k = 0; k < nz; k++) {
          const p = vec(this.points[i][j][k])
          if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) throw new RangeError('Lattice: the points must be finite')
          points[i][j][k] = [p.x, p.y, p.z]
        }
      }
    }
    return this.#lattice
  }
}

/** The kernel's grid of points as THREE.Vector3s. */
function fromKernel(grid: readonly (readonly (readonly (readonly number[])[])[])[]): THREE.Vector3[][][] {
  return grid.map((plane) => plane.map((row) => row.map((p) => new THREE.Vector3(p[0], p[1], p[2]))))
}

function copyGrid(grid: readonly (readonly (readonly THREE.Vector3Like[])[])[]): THREE.Vector3[][][] {
  return grid.map((a) => a.map((b) => b.map((p) => new THREE.Vector3(p.x, p.y, p.z))))
}

function vector(v: unknown, what: string): THREE.Vector3 {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | null
  if (p === null || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') {
    throw new TypeError(`${what}: a point or offset is a THREE.Vector3 (or { x, y, z }), not ${describe(v)}`)
  }
  return new THREE.Vector3(p.x, p.y, p.z)
}

/** 0, 1 or 2 for one of three's axes (by name, or a direction along one). */
function axisIndex(axis: LatticeAxis): number {
  if (typeof axis === 'string') {
    const i = 'xyz'.indexOf(axis.toLowerCase())
    if (axis.length === 1 && i >= 0) return i
  } else if (axis !== null && typeof axis === 'object') {
    const d = isRay(axis) ? axis.direction : (axis as THREE.Vector3Like)
    if (typeof d.x === 'number' && typeof d.y === 'number' && typeof d.z === 'number') {
      const c = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)]
      const length = Math.hypot(c[0], c[1], c[2])
      const i = c.findIndex((x) => length > 0 && x >= length * (1 - 1e-12))
      if (i >= 0) return i
    }
  }
  throw new RangeError(`Lattice.layer: the axis is 'x', 'y' or 'z' (or a direction along one of them), not ${typeof axis === 'string' ? `'${axis}'` : describe(axis)}`)
}
