// Deformations: twist, taper and bend parts, or deform them with a control lattice.
//
// A deformation moves every point of space, and the whole body with it: all faces, edges and
// vertices go through the same map, so the result is again a closed solid with the same faces,
// edges and vertices:
//
//     const bar = Box(20, 20, 100).twist(90)                  // a quarter turn over its length
//     const grip = Cylinder(12, 80).taper(0.7)                // 70 % of the diameter at the top
//     const hook = Box(160, 10, 6).bend(180, { radius: 25 })  // U shape with straight legs
//     const block = Box(60, 40, 20)
//     const lat = new Lattice(block, 3)                       // 3 x 3 x 3 control points around it
//     lat.move([1, 1, -1], [0, 0, 8])                         // lift the middle of the top
//     const pillow = lat.apply(block)
//
// The results are NURBS. Lattices and tapers are polynomial maps of space, so their results are
// exact: every face is the exact image of the original (up to degree `MAX_DEGREE`). Twists and
// bends turn space with sines and cosines, which no NURBS reproduces; their faces are within
// `tolerance` (default 1e-6 mm) of the exact image, except where that image is still polynomial
// (the straight rulings of a twisted face, the turned ends of a twisted bar), which stays exact.
// Every face keeps the parameterization of the original, so the trim curves are the original ones.
//
// The maps are the kernel's volume deformations (SmTwistVolume, SmBendVolume, SmTransform) and a
// Bezier volume for lattices and tapers.

import { KernelError, ModelingError, _opts, k, kernelCall } from './kernel.ts'
import {
  TOLERANCE,
  Axis,
  BoundBox,
  Location,
  Plane,
  Vector,
  type VectorLike,
  X,
  Y,
  Z,
  _degrees,
  _formatG,
  _radians,
  _vec,
} from './geometry.ts'
import { det3, mean3 } from './_linalg.ts'
import { Part, Shell, Sketch, type _Body, _typeName } from './shapes.ts'
import { Box } from './parts.ts'

// biome-ignore lint: the kernel's spec and results are what their bindings take and return
type Any = any

/** Highest degree of an exact result. A face whose exact image would need a higher degree (a
 * sphere in a 4 x 4 x 4 lattice needs 18) is approximated within the tolerance instead. */
export const MAX_DEGREE = 12

/** A part or a shell (sketches deform into shells). */
type Deformable = Part | Shell

// ============================================================================= helpers
// numpy's 3-vectors as [x, y, z], in numpy's order of operations.
type V3 = [number, number, number]

function _add(a: readonly number[], b: readonly number[]): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function _sub(a: readonly number[], b: readonly number[]): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function _mul(s: number, a: readonly number[]): V3 {
  return [s * a[0], s * a[1], s * a[2]]
}

function _dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function _cross(a: readonly number[], b: readonly number[]): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function _norm(a: readonly number[]): number {
  return Math.sqrt(_dot(a, a))
}

/** `r @ a` for a 3 x 3 matrix given as rows. */
function _matVec(r: readonly (readonly number[])[], a: readonly number[]): V3 {
  return [_dot(r[0], a), _dot(r[1], a), _dot(r[2], a)]
}

function _isNumber(x: unknown): x is number {
  return typeof x === 'number'
}

function _checkShape(shape: unknown, what: string): asserts shape is Deformable {
  if (!(shape instanceof Part || shape instanceof Shell)) {
    throw new TypeError(`${what}: expected a Part or a Shell, got ${_typeName(shape)}`)
  }
  if (shape instanceof Part) shape._requireValid(what)
  else if (k.brep_face_count(shape._brep) === 0) throw new ModelingError(`${what}: the shape is empty`)
}

function _tolerance(tolerance: number | null | undefined): number {
  const tol = tolerance == null ? TOLERANCE : Number(tolerance)
  if (!(tol > 0 && Number.isFinite(tol))) throw new RangeError('tolerance must be a positive number of millimeters')
  return tol
}

function _angle(angle: unknown, what: string): number {
  if (!_isNumber(angle)) throw new TypeError(`${what}: angle must be a number of degrees`)
  const a = angle
  if (!Number.isFinite(a)) throw new RangeError(`${what}: angle must be a finite number of degrees`)
  if (a === 0) throw new RangeError(`${what}: angle is 0; nothing to do`)
  return a
}

function _unit(v: VectorLike, what: string): V3 {
  const a = _vec(v).toArray()
  const n = _norm(a)
  if (!(n > 1e-12)) throw new RangeError(`${what} has no direction`)
  return [a[0] / n, a[1] / n, a[2] / n]
}

/** A unit vector perpendicular to `d`. */
function _perpendicular(d: readonly number[]): V3 {
  const helper: V3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const p = _sub(helper, _mul(_dot(helper, d), d))
  const n = _norm(p)
  return [p[0] / n, p[1] / n, p[2] / n]
}

/** The range of `(p - origin) . d` over the shape (tight box in a frame along `d`). */
function _extent(shape: Deformable, origin: V3, d: V3): [number, number] {
  for (let i = 0; i < 3; i++) {
    // a world axis: the tight box directly
    if (Math.abs(Math.abs(d[i]) - 1.0) < 1e-12) {
      const b = shape.bbox()
      const lo = b.min.toArray()[i] - origin[i]
      const hi = b.max.toArray()[i] - origin[i]
      return d[i] > 0 ? [lo, hi] : [-hi, -lo]
    }
  }
  // otherwise turn the shape so that d becomes +Z
  const z: V3 = [0, 0, 1]
  const axis = _cross(d, z)
  const n = _norm(axis)
  const angle = _degrees(Math.atan2(n, _dot(d, z)))
  const m = Location.about(new Axis([0, 0, 0], [axis[0] / n, axis[1] / n, axis[2] / n]), angle)._m
  const b = shape._transformed(m).bbox()
  const oz = m[8] * origin[0] + m[9] * origin[1] + m[10] * origin[2]
  return [b.min.z - oz, b.max.z - oz]
}

/** A 3 x 4 matrix [r | t], row by row. */
function _matrix(r: readonly (readonly number[])[], t: readonly number[]): number[] {
  return [r[0][0], r[0][1], r[0][2], t[0], r[1][0], r[1][1], r[1][2], t[1], r[2][0], r[2][1], r[2][2], t[2]]
}

/** `p -> r p + t`: the turn by `angle` degrees about the line through `origin` along `d`. */
function _rotationAbout(origin: readonly number[], d: readonly number[], angle: number): [V3[], V3] {
  const m = Location.about(new Axis([origin[0], origin[1], origin[2]], [d[0], d[1], d[2]]), angle)._m
  return [
    [
      [m[0], m[1], m[2]],
      [m[4], m[5], m[6]],
      [m[8], m[9], m[10]],
    ],
    [m[3], m[7], m[11]],
  ]
}

/** The shape with the faces it has across a plane split there (nothing added or removed). */
function _imprint(shape: Deformable, origin: V3, normal: V3): Deformable {
  const size = 4.0 * (shape.bbox().diagonal + _norm(origin)) + 10.0
  const plane = new Plane(origin, _perpendicular(normal), normal)
  const tool = Box(size, size, size).translate(0, 0, -size / 2).moved(plane.location)
  const b = kernelCall(
    'deform: split the faces at the end of the range',
    () => k.boolean_with_options(shape._copyBrep(), tool._copyBrep(), { operation: k.BooleanOp.UNION, imprinting: true }),
    'move start or end away from edges and faces of the part, or deform the whole part',
  )
  return shape._like(b)
}

/** What the kernel's map does, as smlibpy's C++ takes it (the kernel's keys). */
export interface _Spec {
  axis: number[] | null
  pieces: Record<string, unknown>[]
  tolerance: number
  max_degree?: number
}

/** What a deformation does: the shape to send (the ends of the range split into its faces), the
 * spec of the kernel map, and the bounds of the volume ratio. */
export class _Plan {
  shape: Deformable
  spec: _Spec
  volumeRatio: [number, number]

  constructor(shape: Deformable, spec: _Spec, volumeRatio: [number, number]) {
    this.shape = shape
    this.spec = spec
    this.volumeRatio = volumeRatio
  }
}

/** Split the faces at range ends inside the part and lay the maps out along the axis: unchanged
 * before `s`, `inside` from `s` to `e`, `after` beyond. */
function _layout(
  shape: Deformable,
  origin: V3,
  d: V3,
  s: number,
  e: number,
  lo: number,
  hi: number,
  inside: Record<string, unknown>,
  after: Record<string, unknown>,
  tol: number,
): [Deformable, _Spec] {
  const eps = 1e-7 * Math.max(1.0, hi - lo)
  const cutStart = s > lo + eps
  const cutEnd = e < hi - eps
  if (cutStart) shape = _imprint(shape, _add(origin, _mul(s, d)), d)
  if (cutEnd) shape = _imprint(shape, _add(origin, _mul(e, d)), d)
  if (!cutStart && !cutEnd) return [shape, { axis: null, pieces: [inside], tolerance: tol }]
  const pieces = [{ kind: 'identity', hi: s }, { ...inside, hi: e }, after]
  return [shape, { axis: [...origin, ...d], pieces, tolerance: tol }]
}

function _range(shape: Deformable, origin: V3, d: V3, start: number | null | undefined, end: number | null | undefined, what: string): [number, number, number, number] {
  const [lo, hi] = _extent(shape, origin, d)
  const s = start == null ? lo : Number(start)
  const e = end == null ? hi : Number(end)
  if (!(Number.isFinite(s) && Number.isFinite(e))) throw new RangeError(`${what}: start and end must be finite numbers`)
  if (!(e > s)) throw new RangeError(`${what}: end (${_formatG(e)}) must lie beyond start (${_formatG(s)})`)
  if (e <= lo || s >= hi) {
    throw new ModelingError(
      `${what}: the range ${_formatG(s)} to ${_formatG(e)} does not reach the part, which spans ${_formatG(lo)} to ${_formatG(hi)} (distances along the axis from its origin)`,
    )
  }
  return [s, e, lo, hi]
}

/** Send the shape through the map; check and return the result. */
function _run(plan: _Plan, what: string, source: Deformable): Deformable {
  const spec: Any = { ...plan.spec }
  if (!('max_degree' in spec)) spec.max_degree = MAX_DEGREE
  const shape = plan.shape
  const [brep, report] = kernelCall(what, () => k.deform.deform_brep(shape._brep, spec), 'deform less, or use a larger tolerance')
  // a deformed sketch is no longer planar
  const result: Deformable = shape instanceof Sketch ? Shell._wrap(brep, { name: shape.name, color: shape.color }) : shape._like(brep)
  if (report.faces_approximated || report.edges_approximated) {
    if (report.max_error > 2 * spec.tolerance) {
      throw new ModelingError(
        `${what}: could not follow the deformation within the tolerance (off by ${_formatG(report.max_error, 2)} mm); use a larger tolerance or deform less`,
      )
    }
  }
  if (result instanceof Part) {
    let problem = result._shapeProblem()
    if (problem === null) {
      let volume: number
      try {
        volume = result._quickVolume() // a check with a margin of 1e-3
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
        volume = Number.NaN
      }
      problem = result._solidProblem(volume)
      if (problem === null) problem = _volumeProblem(source as Part, volume, plan.volumeRatio)
    }
    if (problem !== null) {
      throw new ModelingError(`${what}: the result is not a valid solid (${problem}); the deformation probably folds the part onto itself: deform less`)
    }
  }
  return result
}

/** The volume of a deformed part lies between the smallest and the largest local volume change
 * of the map times the original volume. Catches broken bodies, not small errors. */
function _volumeProblem(source: Part, volume: number, ratio: [number, number]): string | null {
  let v0: number
  try {
    v0 = source._quickVolume()
  } catch (e) {
    if (!(e instanceof KernelError)) throw e
    return null
  }
  const [lo, hi] = ratio
  if (lo * v0 * (1 - 1e-3) <= volume && volume <= hi * v0 * (1 + 1e-3)) return null
  return `its volume ${_formatG(volume)} is outside the possible ${_formatG(lo * v0)} to ${_formatG(hi * v0)}`
}

/** Where a deformation applies along its axis. */
export interface RangeOptions {
  /** Where the deformation begins, as a distance along the axis from its origin. Default: where
   * the part begins along the axis. What lies before `start` stays. */
  start?: number | null
  /** Where the deformation ends, measured the same way. Default: where the part ends. */
  end?: number | null
  /** Largest distance of the deformed faces from the exact map (mm). */
  tolerance?: number | null
}

// ============================================================================= twist
export function _planTwist(shape: Deformable, angle: number, axis: Axis, start: number | null | undefined, end: number | null | undefined, tol: number): _Plan {
  const o = axis.origin.toArray()
  const d = _unit(axis.direction, 'twist: axis')
  const [s, e, lo, hi] = _range(shape, o, d, start, end, 'twist')
  const inside = { kind: 'twist', origin: _add(o, _mul(s, d)), axis: [...d], mid: _perpendicular(d), period: (360.0 * (e - s)) / angle }
  const [r, t] = _rotationAbout(o, d, angle)
  const [work, spec] = _layout(shape, o, d, s, e, lo, hi, inside, { kind: 'rigid', matrix: _matrix(r, t) }, tol)
  return new _Plan(work, spec, [1.0, 1.0])
}

/** How a part is twisted (see `twist`). */
export interface TwistOptions extends RangeOptions {
  /** The line to twist about (default the world Z axis through the origin). */
  axis?: Axis
}

/**
 * Twist a part about an axis by `angle` degrees over its length (or from `start` to `end`).
 *
 * Every cross-section turns by an angle that grows evenly from 0 at `start` to `angle` at `end`.
 *
 * @param shape A Part (or a Shell).
 * @param angle The turn in degrees between `start` and `end`, counterclockwise seen from the tip
 *   of `axis` (right-hand rule, like `rotate`). May exceed 360.
 * @param options `axis`: the line to twist about (default the world Z axis through the origin).
 *   `start`: where the twist begins, as a distance along the axis from `axis.origin`; default:
 *   where the part begins along the axis; what lies before `start` stays. `end`: where the twist
 *   ends, measured the same way; default: where the part ends along the axis; what lies beyond
 *   `end` is turned by the whole `angle`. `tolerance`: largest distance of the twisted faces from
 *   the exact twist (mm).
 *
 * Returns a Part (a Shell for a shell). The volume does not change.
 */
export function twist(shape: Part, angle: number, options?: TwistOptions): Part
export function twist(shape: Shell, angle: number, options?: TwistOptions): Shell
export function twist(shape: Deformable, angle: number, options: TwistOptions = {}): Deformable {
  _opts('twist', options)
  const { axis = Z, start = null, end = null, tolerance = null } = options
  _checkShape(shape, 'twist')
  const a = _angle(angle, 'twist')
  const plan = _planTwist(shape, a, axis, start, end, _tolerance(tolerance))
  return _run(plan, 'twist', shape)
}

// ============================================================================= taper
export function _planTaper(shape: Deformable, scale: number, axis: Axis, start: number | null | undefined, end: number | null | undefined, tol: number): _Plan {
  const o = axis.origin.toArray()
  const d = _unit(axis.direction, 'taper: axis')
  const [s, e, lo, hi] = _range(shape, o, d, start, end, 'taper')
  const e1 = _perpendicular(d)
  const e2 = _cross(d, e1)
  const rho = Math.max(shape.bbox().diagonal + _norm(o), 1.0)
  // a 2 x 2 x 2 lattice (a trilinear map) around the axis is exactly the linear taper
  const pts: number[] = []
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      for (const [kk, f] of [
        [0, 1.0],
        [1, scale],
      ]) {
        pts.push(rho + f * (2 * rho * i - rho), rho + f * (2 * rho * j - rho), (e - s) * kk)
      }
    }
  }
  const inside = {
    kind: 'lattice',
    origin: _sub(_sub(_add(o, _mul(s, d)), _mul(rho, e1)), _mul(rho, e2)),
    x: [...e1],
    y: [...e2],
    z: [...d],
    size: [2 * rho, 2 * rho, e - s],
    counts: [2, 2, 2],
    points: pts,
  }
  // m = d d^T + scale (I - d d^T)
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => d[i] * d[j] + scale * ((i === j ? 1 : 0) - d[i] * d[j])))
  const after = { kind: 'affine', matrix: _matrix(m, _sub(o, _matVec(m, o))) }
  const [work, spec] = _layout(shape, o, d, s, e, lo, hi, inside, after, tol)
  return new _Plan(work, spec, [Math.min(1.0, scale) ** 2, Math.max(1.0, scale) ** 2])
}

/** How a part is tapered (see `taper`). */
export interface TaperOptions extends RangeOptions {
  /** The line the cross-sections shrink toward (default the world Z axis). */
  axis?: Axis
}

/**
 * Taper a part along an axis: its cross-sections scale from 1 to `scale` (exact result).
 *
 * The cross-sections are scaled toward the axis by a factor that changes evenly from 1 at `start`
 * to `scale` at `end`.
 *
 * @param shape A Part (or a Shell).
 * @param scale Size of the cross-section at `end` relative to `start` (> 0): 0.5 halves it, 2
 *   doubles it. Lines along the axis stay straight.
 * @param options `axis`: the line the cross-sections shrink toward (default the world Z axis).
 *   `start`: where the tapered range begins, as a distance along the axis from `axis.origin`;
 *   default: where the part begins; what lies before `start` stays. `end`: where the tapered
 *   range ends, measured the same way; default: where the part ends; what lies beyond `end` is
 *   scaled by `scale` across the axis. `tolerance`: only for faces whose exact image would exceed
 *   `MAX_DEGREE` (mm).
 *
 * The result is exact: a cylinder becomes a cone, a box a frustum of a pyramid.
 */
export function taper(shape: Part, scale: number, options?: TaperOptions): Part
export function taper(shape: Shell, scale: number, options?: TaperOptions): Shell
export function taper(shape: Deformable, scale: number, options: TaperOptions = {}): Deformable {
  _opts('taper', options)
  const { axis = Z, start = null, end = null, tolerance = null } = options
  _checkShape(shape, 'taper')
  if (!_isNumber(scale)) throw new TypeError('taper: scale must be a number')
  const f = scale
  if (!(Number.isFinite(f) && f > 0)) throw new RangeError('taper: scale must be a positive number (1 keeps the size)')
  if (f === 1) throw new RangeError('taper: scale is 1; nothing to do')
  const plan = _planTaper(shape, f, axis, start, end, _tolerance(tolerance))
  return _run(plan, 'taper', shape)
}

// ============================================================================= bend
export function _planBend(
  shape: Deformable,
  angle: number,
  radius: number | null | undefined,
  plane: Plane,
  start: number | null | undefined,
  end: number | null | undefined,
  tol: number,
): _Plan {
  const o = plane.origin.toArray()
  const xd = plane.xDir.toArray()
  const yd = plane.yDir.toArray()
  const zd = plane.zDir.toArray()
  const phi = _radians(Math.abs(angle))
  const [lo, hi] = _extent(shape, o, xd)
  let s: number
  let e: number
  let r: number
  if (radius == null) {
    s = start == null ? lo : Number(start)
    e = end == null ? hi : Number(end)
    if (!(e > s)) throw new RangeError(`bend: end (${_formatG(e)}) must lie beyond start (${_formatG(s)}) along the plane's xDir`)
    r = (e - s) / phi
  } else {
    r = Number(radius)
    const length = r * phi
    if (start == null && end == null) {
      s = -length / 2
      e = length / 2
    } else if (end == null) {
      s = Number(start)
      e = s + length
    } else if (start == null) {
      e = Number(end)
      s = e - length
    } else {
      s = Number(start)
      e = Number(end)
      if (Math.abs(e - s - length) > 1e-9 * Math.max(1.0, length)) {
        throw new RangeError(
          `bend: start and end are ${_formatG(e - s)} apart, but radius ${_formatG(r)} and angle ${_formatG(angle)} need ${_formatG(length)}; give only two of radius, start and end`,
        )
      }
    }
  }
  if (!(Number.isFinite(s) && Number.isFinite(e))) throw new RangeError('bend: start and end must be finite numbers')
  if (e <= lo || s >= hi) {
    throw new ModelingError(
      `bend: the bend (${_formatG(s)} to ${_formatG(e)} along xDir from the plane origin) does not reach the part, which spans ${_formatG(lo)} to ${_formatG(hi)}`,
    )
  }
  const sigma = angle > 0 ? 1.0 : -1.0
  const [ylo, yhi] = _extent(shape, o, yd)
  const inner = sigma > 0 ? yhi : -ylo // how far the part reaches from the neutral layer toward the axis
  const outer = sigma > 0 ? -ylo : yhi
  if (inner >= r) {
    throw new ModelingError(
      `bend: the part reaches ${_formatG(inner)} mm from the neutral layer toward the bend axis, which is only ${_formatG(r)} mm away; bend with a larger radius (or over a longer range), or move the plane origin (the neutral layer) toward the inside of the bend`,
    )
  }
  const center = _add(_add(o, _mul(s, xd)), _mul(sigma * r, yd))
  const inside = { kind: 'bend', center, axis: _mul(sigma, zd), mid: _mul(-sigma, yd), neutral: r }
  // beyond the end the part goes on straight: p -> R (p - L xDir) + t, with R, t the turn by the
  // whole angle about the bend axis and L the length of the bend
  const [rot, t] = _rotationAbout(center, _mul(sigma, zd), _degrees(phi))
  const after = { kind: 'rigid', matrix: _matrix(rot, _sub(t, _matVec(rot, _mul(e - s, xd)))) }
  const [work, spec] = _layout(shape, o, xd, s, e, lo, hi, inside, after, tol)
  // a layer at distance y (toward the axis) changes its length by (r - y) / r
  return new _Plan(work, spec, [Math.min(1.0, (r - inner) / r), Math.max(1.0, (r + outer) / r)])
}

/** How a part is bent (see `bend`). */
export interface BendOptions extends RangeOptions {
  /** The bend radius of the neutral layer. */
  radius?: number | null
  /** Sets the bend: `xDir` along the part, `yDir` toward the inside of the bend (default
   * `Plane.XZ`). */
  plane?: Plane
}

/**
 * Bend a part around an axis by `angle` degrees, like a bar bent over a mandrel.
 *
 * `plane` sets the bend: its `xDir` runs along the part, a positive `angle` bends the part toward
 * `yDir`, and the bend axis is parallel to the plane normal. The layer of the part through
 * `plane.origin` (spanned by `xDir` and the normal) is the neutral layer: it keeps its length;
 * material on the inside of the bend is compressed, material on the outside stretched. With the
 * default `Plane.XZ`, a part lying along X bends up (toward +Z) about an axis parallel to Y.
 *
 * @param shape A Part (or a Shell).
 * @param angle How far the part turns, in degrees (positive: toward `plane.yDir`), less than 360.
 * @param options `radius`: the bend radius of the neutral layer; with `radius` and no `start` or
 *   `end`, the bend (length `radius * angle`) is centered on the plane origin; with one of them,
 *   it starts or ends there. `start`: where the bend begins, as a distance along `xDir` from
 *   `plane.origin`; default: where the part begins; what lies before `start` stays. `end`: where
 *   the bend ends, measured the same way; default: where the part ends, so `bend(part, 90)`
 *   bends the whole part into a quarter circle; what lies beyond `end` goes on straight, turned
 *   by `angle`. Without `radius`, `start` and `end` set it: radius = (end - start) / angle, with
 *   the angle in radians. `tolerance`: largest distance of the bent faces from the exact bend
 *   (mm).
 *
 * The bend axis lies `radius` from the neutral layer on the side the part bends toward; the part
 * must not reach it.
 */
export function bend(shape: Part, angle: number, options?: BendOptions): Part
export function bend(shape: Shell, angle: number, options?: BendOptions): Shell
export function bend(shape: Deformable, angle: number, options: BendOptions = {}): Deformable {
  _opts('bend', options)
  const { radius = null, plane = Plane.XZ, start = null, end = null, tolerance = null } = options
  _checkShape(shape, 'bend')
  const a = _angle(angle, 'bend')
  if (Math.abs(a) >= 360) {
    throw new RangeError('bend: angle must be less than 360 degrees (a full turn would make the part touch itself; revolve a profile for rings)')
  }
  if (radius != null) {
    if (!_isNumber(radius)) throw new TypeError('bend: radius must be a number')
    if (!(Number.isFinite(radius) && radius > 0)) throw new RangeError('bend: radius must be a positive number')
  }
  if (!(plane instanceof Plane)) throw new TypeError('bend: plane must be a Plane (xDir along the part, yDir toward the inside of the bend)')
  const plan = _planBend(shape, a, radius, plane, start, end, _tolerance(tolerance))
  return _run(plan, 'bend', shape)
}

// ============================================================================= lattice
/** Which layers of the lattice along one direction: a number (negative counts from the end),
 * `null` for all of them (Python's `:`), or an array of numbers. */
export type LatticeLayers = number | null | readonly number[]

/** A selection of lattice points: one `LatticeLayers` per direction, `[i, j, k]` along X, Y and
 * Z; the points are every combination. */
export type LatticeIndex = readonly [LatticeLayers, LatticeLayers, LatticeLayers]

function _axisIndex(axis: unknown): number {
  if (typeof axis === 'string' && ['x', 'y', 'z'].includes(axis.toLowerCase())) return 'xyz'.indexOf(axis.toLowerCase())
  if (axis instanceof Axis) {
    const world = [X, Y, Z]
    for (let i = 0; i < 3; i++) if (axis.direction.isParallel(world[i].direction)) return i
  }
  throw new RangeError("axis must be X, Y or Z (or 'x', 'y', 'z')")
}

/** numpy's linspace(0, 1, n). */
function _linspace01(n: number): number[] {
  const step = 1 / (n - 1)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(i * step)
  out[n - 1] = 1
  return out
}

function _deepFreeze<T>(a: T): T {
  if (Array.isArray(a)) {
    for (const x of a) _deepFreeze(x)
    Object.freeze(a)
  }
  return a
}

/** A point of a lattice as three numbers (an array, a typed array or a Vector). */
function _asPoint(p: unknown): V3 {
  if (p instanceof Vector) return p.toArray()
  const a = p as ArrayLike<number>
  return [Number(a[0]), Number(a[1]), Number(a[2])]
}

function _copyPoints(points: readonly (readonly (readonly (readonly number[])[])[])[]): number[][][][] {
  return points.map((a) => a.map((b) => b.map((p) => [Number(p[0]), Number(p[1]), Number(p[2])])))
}

/**
 * A grid of control points around a part for free-form deformation (exact results).
 *
 * The points start evenly spaced over a box (`counts` points per direction, corners included).
 * Move them, then `apply` the lattice to a part: space inside the box moves smoothly with the
 * points (a Bezier volume; space outside the box follows the same polynomial). A lattice whose
 * points were not moved changes nothing.
 *
 * `points` holds the world positions, `points[i][j][k]` = `[x, y, z]`, indexed along X, Y and Z;
 * the arrays are writable: `lat.points[1][1][2][2] += 5` lifts one point. `move`, `scale` and
 * `rotate` take a selection `[i, j, k]` of numbers (negative ones count from the end), `null` for
 * all (Python's `:`) and arrays of numbers, or `layer(...)`; they change the lattice in place and
 * return it.
 */
export class Lattice {
  /** The world positions of the points, `points[i][j][k]` = `[x, y, z]` (writable). */
  points: number[][][][]
  _rest: readonly (readonly (readonly (readonly number[])[])[])[]
  _origin: V3
  _size: V3
  _counts: [number, number, number]

  /**
   * @param box A BoundBox, or a shape whose bounding box is used.
   * @param counts Points per direction, one number or three, 2 to 12. 2 moves the corners only (a
   *   trilinear map), 3 adds the midpoints (default), more give finer control. The degree of the
   *   exact result grows with the counts (see `MAX_DEGREE`).
   * @param options `margin`: grow the box by this much on every side (mm).
   */
  constructor(box: BoundBox | { bbox(): BoundBox }, counts: number | readonly number[] = 3, options: { margin?: number } = {}) {
    _opts('Lattice', options)
    const margin = Number(options.margin ?? 0.0)
    const bb = box instanceof BoundBox ? box : box.bbox()
    const cs = typeof counts === 'number' ? [counts, counts, counts] : Array.from(counts, Number)
    if (cs.length !== 3 || !cs.every((c) => Number.isInteger(c) && 2 <= c && c <= 12)) {
      throw new RangeError('Lattice: counts must be 2 to 12 points per direction (one int or three)')
    }
    const lo = _sub(bb.min.toArray(), [margin, margin, margin])
    const hi = _add(bb.max.toArray(), [margin, margin, margin])
    const size = _sub(hi, lo)
    if (!size.every((x) => x > 1e-9)) {
      throw new RangeError('Lattice: the box must have a size in all three directions (give a margin for flat shapes)')
    }
    this._origin = lo
    this._size = size
    this._counts = [cs[0], cs[1], cs[2]]
    const [gx, gy, gz] = cs.map(_linspace01)
    const rest = gx.map((x) => gy.map((y) => gz.map((z) => [lo[0] + x * size[0], lo[1] + y * size[1], lo[2] + z * size[2]])))
    this._rest = _deepFreeze(rest)
    this.points = _copyPoints(rest)
  }

  // -- properties -----------------------------------------------------------------------------
  /** Points per direction (X, Y, Z). */
  get counts(): [number, number, number] {
    return [...this._counts]
  }

  /** The box the points started on. */
  get box(): BoundBox {
    return new BoundBox(this._origin, _add(this._origin, this._size))
  }

  /** The starting positions (read-only). */
  get rest(): readonly (readonly (readonly (readonly number[])[])[])[] {
    return this._rest
  }

  /** How far each point was moved (`points - rest`). */
  get offsets(): number[][][][] {
    return this.points.map((a, i) => a.map((b, j) => b.map((p, k) => _sub(_asPoint(p), this._rest[i][j][k]))))
  }

  // -- selections -----------------------------------------------------------------------------
  /** The points of one layer across an axis, as a selection: `lat.layer(Z, -1)` is the top
   * layer, `lat.layer(X, 0)` the points at the smallest X. */
  layer(axis: Axis | string, index: number): [LatticeLayers, LatticeLayers, LatticeLayers] {
    const i = _axisIndex(axis)
    const n = this._counts[i]
    if (!(-n <= index && index < n)) throw new RangeError(`Lattice.layer: index ${index} is out of range for ${n} layers`)
    const sel: [LatticeLayers, LatticeLayers, LatticeLayers] = [null, null, null]
    sel[i] = index
    return sel
  }

  static _index(index: unknown): LatticeIndex {
    if (!Array.isArray(index) || index.length !== 3) {
      throw new RangeError('Lattice: select points with three indices [i, j, k], e.g. [1, 1, -1], [null, 0, 2] or lat.layer(Z, 0)')
    }
    return index as unknown as LatticeIndex
  }

  /** The [i, j, k] of the selected points, in numpy's order (repeats included). */
  _cells(index: unknown): [number, number, number][] {
    const sel = Lattice._index(index)
    const layers = [0, 1, 2].map((axis) => {
      const n = this._counts[axis]
      const one = (i: unknown): number => {
        if (typeof i !== 'number' || !Number.isInteger(i)) {
          throw new RangeError('Lattice: an index is a whole number, null (all) or an array of whole numbers')
        }
        if (i < -n || i >= n) throw new RangeError(`index ${i} is out of bounds for axis ${axis} with size ${n}`)
        return i < 0 ? i + n : i
      }
      const s = sel[axis]
      if (s == null) return Array.from({ length: n }, (_, i) => i)
      if (Array.isArray(s)) return s.map(one)
      return [one(s)]
    })
    const out: [number, number, number][] = []
    for (const i of layers[0]) for (const j of layers[1]) for (const kk of layers[2]) out.push([i, j, kk])
    return out
  }

  /** The selected points mapped by `f` (all at once, from their positions before). */
  _update(index: unknown, f: (pts: V3[]) => V3[]): this {
    const cells = this._cells(index)
    const moved = f(cells.map(([i, j, kk]) => _asPoint(this.points[i][j][kk])))
    cells.forEach(([i, j, kk], n) => {
      const p = this.points[i][j][kk]
      if (Array.isArray(p) && p.length === 3) {
        p[0] = moved[n][0]
        p[1] = moved[n][1]
        p[2] = moved[n][2]
      } else {
        this.points[i][j][kk] = moved[n]
      }
    })
    return this
  }

  // -- editing (in place) ---------------------------------------------------------------------
  /** Move the selected points by `offset`. In place; returns the lattice. */
  move(index: LatticeIndex, offset: VectorLike): this {
    Lattice._index(index)
    const o = _vec(offset).toArray()
    return this._update(index, (pts) => pts.map((p) => _add(p, o)))
  }

  /** Scale the selected points about `center` (default: their centroid) by `factor`, one number
   * or three (X, Y, Z). In place; returns the lattice. */
  scale(index: LatticeIndex, factor: number | VectorLike, center: VectorLike | null = null): this {
    Lattice._index(index)
    return this._update(index, (pts) => {
      const c = center == null ? mean3(pts) : _vec(center).toArray()
      const f = typeof factor === 'number' ? [factor, factor, factor] : _vec(factor).toArray()
      return pts.map((p) => {
        const d = _sub(p, c)
        return _add(c, [d[0] * f[0], d[1] * f[1], d[2] * f[2]])
      })
    })
  }

  /** Turn the selected points by `angle` degrees about `axis`. In place; returns the lattice. */
  rotate(index: LatticeIndex, axis: Axis, angle: number): this {
    Lattice._index(index)
    return this._update(index, (pts) => {
      const [r, t] = _rotationAbout(axis.origin.toArray(), _unit(axis.direction, 'Lattice.rotate: axis'), angle)
      return pts.map((p) => _add(_matVec(r, p), t))
    })
  }

  /** Put every point back where it started. In place; returns the lattice. */
  reset(): this {
    return this._update([null, null, null], () => this._rest.flatMap((a) => a.flatMap((b) => b.map((p) => [p[0], p[1], p[2]] as V3))))
  }

  /** An independent copy. */
  copy(): Lattice {
    const out = Object.create(Lattice.prototype) as Lattice
    out._origin = this._origin
    out._size = this._size
    out._counts = this._counts
    out._rest = this._rest
    out.points = this.points.map((a) => a.map((b) => b.map((p) => _asPoint(p))))
    return out
  }

  // -- applying -------------------------------------------------------------------------------
  _spec(): Record<string, unknown> {
    const [nx, ny, nz] = this._counts
    const pts = this.points as unknown
    const isPoint = (p: unknown): boolean =>
      p instanceof Vector || ((Array.isArray(p) || ArrayBuffer.isView(p)) && (p as ArrayLike<unknown>).length === 3)
    const shaped =
      Array.isArray(pts) &&
      pts.length === nx &&
      pts.every((a) => Array.isArray(a) && a.length === ny && a.every((b) => Array.isArray(b) && b.length === nz && b.every(isPoint)))
    const flat: number[] = []
    if (shaped) {
      for (const a of this.points) for (const b of a) for (const p of b) flat.push(..._sub(_asPoint(p), this._origin))
    }
    if (!shaped || !flat.every(Number.isFinite)) throw new RangeError('Lattice: points must stay a finite (nx, ny, nz, 3) array')
    return {
      kind: 'lattice',
      origin: [...this._origin],
      x: [1.0, 0.0, 0.0],
      y: [0.0, 1.0, 0.0],
      z: [0.0, 0.0, 1.0],
      size: [...this._size],
      counts: [...this._counts],
      points: flat,
    }
  }

  /** Where the lattice moves a point. */
  map(point: VectorLike): Vector {
    return new Vector(k.deform.map_points({ pieces: [this._spec()] }, [_vec(point).toArray()])[0])
  }

  _plan(shape: Deformable, tol: number): _Plan {
    return new _Plan(shape, { axis: null, pieces: [this._spec()], tolerance: tol }, [0.0, Infinity])
  }

  /**
   * Deform a part (or a shell) with the lattice; returns the deformed copy.
   *
   * The result is exact unless a face's image needs a degree above `MAX_DEGREE`; such faces are
   * within `tolerance`. Throws a ModelingError when the lattice folds the part onto itself (a
   * point moved past its neighbours).
   */
  apply(shape: Part, options?: { tolerance?: number | null }): Part
  apply(shape: Shell, options?: { tolerance?: number | null }): Shell
  apply(shape: Deformable, options: { tolerance?: number | null } = {}): Deformable {
    _opts('Lattice.apply', options)
    _checkShape(shape, 'lattice')
    const plan = this._plan(shape, _tolerance(options.tolerance))
    _checkFolding(shape, plan.spec.pieces[0])
    return _run(plan, 'lattice', shape)
  }

  toString(): string {
    let moved = 0
    for (const a of this.offsets) for (const b of a) for (const d of b) if (_norm(d) > 0) moved++
    const [nx, ny, nz] = this._counts
    return `Lattice(${nx} x ${ny} x ${nz} points, ${moved} moved, box ${this.box})`
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }
}

/** Refuse a lattice that turns space inside out on the part: the Jacobian determinant of the
 * map, sampled at the part's vertices, edges and faces, must stay positive. */
function _checkFolding(shape: _Body, piece: Record<string, unknown>): void {
  const samples: V3[] = shape.vertices().map((v) => v.point.toArray())
  for (const e of shape.edges()) for (const t of [0.25, 0.5, 0.75]) samples.push(e.pointAt(t).toArray())
  const fractions = [0.1, 0.3, 0.5, 0.7, 0.9]
  for (const f of shape.faces()) {
    // a grid of points inside every face
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(f._f)
    for (const a of fractions) {
      for (const b of fractions) {
        const u = u0 + a * (u1 - u0)
        const v = v0 + b * (v1 - v0)
        if (k.face_classify_uv(f._f, u, v) !== 'outside') {
          const p = k.face_point_at_uv(f._f, u, v)
          samples.push([Number(p[0]), Number(p[1]), Number(p[2])])
        }
      }
    }
  }
  if (!samples.length) return
  const h = 1e-4 * Math.max(shape.bbox().diagonal, 1.0)
  const steps: V3[] = [
    [h, 0, 0],
    [-h, 0, 0],
    [0, h, 0],
    [0, -h, 0],
    [0, 0, h],
    [0, 0, -h],
  ]
  const q: number[][] = k.deform.map_points(
    { pieces: [piece] },
    samples.flatMap((p) => steps.map((s) => _add(p, s))),
  )
  // the Jacobian's columns are the central differences along X, Y and Z (its determinant is that
  // of the matrix with them as rows)
  const det = samples.map((_, n) => {
    const col = (i: number) => _sub(q[n * 6 + i], q[n * 6 + i + 1]).map((x) => x / (2 * h))
    return det3([...col(0), ...col(2), ...col(4)])
  })
  if (det.some((x) => x <= 1e-6)) {
    // numpy's argmin: the first NaN, else the first least
    let at = det.findIndex(Number.isNaN)
    if (at < 0) at = det.reduce((best, x, i) => (x < det[best] ? i : best), 0)
    const w = samples[at]
    throw new ModelingError(
      `lattice: the lattice folds the part onto itself near (${_formatG(w[0], 4)}, ${_formatG(w[1], 4)}, ${_formatG(w[2], 4)}); a point was moved past its neighbours. Move the points less, or use more points for local changes`,
    )
  }
}
