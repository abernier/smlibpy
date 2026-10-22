// Sheet metal: exact bends with bend radius and K-factor, flanges, and unfolding to a flat pattern.
//
// A sheet metal part is a solid of constant thickness: flat regions joined by bends. A bend has an
// inside radius `radius` and an angle; its neutral fiber, at `kFactor * thickness` from the inside
// surface, keeps its length. In the flat, a bend takes the strip of the bend allowance
//
//     BA = angle_rad * (radius + kFactor * thickness)
//
// and folding turns that strip into exact cylinders (`radius` inside, `radius + thickness`
// outside). Unfolding does the inverse, so a part folded and unfolded with the same K-factor is the
// blank again.
//
//     const blank = Box(100, 40, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] })
//     const bracket = fold(blank, new Axis([20, 0, 2], [0, 1, 0]), 90, { radius: 2 })  // fold the +X end up
//     const pattern = flatPattern(bracket)                                            // the blank, laid on XY
//     pattern.outline, pattern.bendLines
//
// The kernel does the geometry (SMLib's space bend and unbend); see src/cpp/sheetmetal.cpp.

import { BrepHandle, KernelError, ModelingError, _opts, ext, k, kernelCall } from './kernel.ts'
import { Axis, Location, Plane, Vector, type VectorLike, _degrees, _formatG, _radians, _vec } from './geometry.ts'
import { Edge, Face, Part, Shape, ShapeList, Sketch, Vertex, Wire, _list, _mergedLines, _take, _typeName } from './shapes.ts'
import { Line, _mod, _withOptions } from './curves.ts'
import { tessellate } from './mesh.ts'
import { Box } from './parts.ts'
import { type _Spec, _Plan, _imprint, _run } from './deform.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any

const inspect = Symbol.for('nodejs.util.inspect.custom')

/** Default K-factor: the neutral fiber at 0.44 of the thickness from the inside surface. */
export const K_FACTOR = 0.44

/**
 * What `kFactor` of `unfold`, `flatPattern` and `bends` takes: one K-factor for every bend; a
 * function `(radius, thickness, angle) => k`; a mapping from inside radius to K-factor (a `Map`, or
 * an object such as `{ 1: 0.33, 6: 0.45 }`); `[r / t, k]` pairs, interpolated; `'din6935'`; or
 * `null`/left out, the K-factor each bend was folded with (`fold`, `flange`), else `K_FACTOR`.
 */
export type KFactor =
  | number
  | string
  | ((radius: number, thickness: number, angle: number) => number)
  | ReadonlyMap<number, number>
  | Readonly<Record<string, number>>
  | readonly (readonly [number, number])[]
  | null

// =============================================================================== formulas
/** The bend of `bendAllowance` and `bendDeduction`. */
export interface BendAllowanceOptions {
  /** Inside bend radius. */
  radius: number
  /** Sheet thickness. */
  thickness: number
  /** Position of the neutral fiber, 0 (inside) to 1 (outside); default `K_FACTOR`. */
  kFactor?: number
}

/** The bends of `developedLength`. */
export interface DevelopedLengthOptions extends BendAllowanceOptions {
  /** The angle of every bend in degrees, or one angle per bend (default 90). */
  angle?: number | Iterable<number>
}

function _checkValues(what: string, angle: number, radius: number, thickness: number, kFactor: number, maxAngle = 180.0): void {
  if (maxAngle >= 360.0) {
    if (!(0.0 < Number(angle) && Number(angle) < 360.0)) {
      throw new RangeError(`${what}: the angle must be above 0 and below 360 degrees (got ${String(angle)})`)
    }
  } else if (!(0.0 < Number(angle) && Number(angle) <= maxAngle)) {
    throw new RangeError(`${what}: the angle must be above 0 and at most ${_formatG(maxAngle)} degrees (got ${String(angle)})`)
  }
  if (!(Number(radius) > 0.0)) throw new RangeError(`${what}: the radius must be positive (got ${String(radius)})`)
  if (!(Number(thickness) > 0.0)) throw new RangeError(`${what}: the thickness must be positive (got ${String(thickness)})`)
  if (!(0.0 <= Number(kFactor) && Number(kFactor) <= 1.0)) {
    throw new RangeError(`${what}: the K-factor must be between 0 and 1 (got ${String(kFactor)})`)
  }
}

/** Smallest inside radius: the kernel's bend region reaches 0.1 past the sheet on both sides, so
 * unfolding needs a radius above 0.1. */
export const MIN_RADIUS = 0.11

/**
 * The K-factor of DIN 6935 for a bend of inside `radius` in a sheet of `thickness`: the standard
 * puts the neutral fiber at `k * t / 2` from the inside with the correction factor
 * `k = 0.65 + 0.5 * log10(r / t)`, which reaches 1 (the middle of the sheet) at `r / t = 5`. As a
 * K-factor: `k / 2`, from 0 to 0.5.
 */
export function din6935(radius: number, thickness: number): number {
  if (!(radius > 0) || !(thickness > 0)) throw new RangeError('din6935: the radius and the thickness must be positive')
  return Math.min(0.5, Math.max(0.0, (0.65 + 0.5 * Math.log10(radius / thickness)) / 2))
}

type _Rule = (r: number, t: number, a: number) => number

/** `kFactor` as a function (radius, thickness, angle) => K-factor; null for null (each bend's own).
 * Checks what it can before any bend is seen. */
function _kRule(kFactor: KFactor | undefined, what: string): _Rule | null {
  if (kFactor == null) return null
  if (typeof kFactor === 'boolean') throw new TypeError(`${what}: kFactor must be a number, a function, a table or 'din6935', not a boolean`)
  if (typeof kFactor === 'number') {
    if (!(0.0 <= kFactor && kFactor <= 1.0)) throw new RangeError(`${what}: the K-factor must be between 0 and 1 (got ${String(kFactor)})`)
    return () => kFactor
  }
  if (typeof kFactor === 'string') {
    if (['din6935', 'din-6935'].includes(kFactor.toLowerCase().replaceAll(' ', ''))) return (r, t) => din6935(r, t)
    throw new RangeError(`${what}: the only K-factor rule by name is 'din6935', not '${kFactor}'`)
  }
  if (typeof kFactor === 'function') return (r, t, a) => Number(kFactor(r, t, a))
  if (Array.isArray(kFactor)) {
    const pairs = (kFactor as readonly (readonly number[])[]).map((p) => {
      if (!Array.isArray(p) || p.length !== 2) {
        throw new TypeError(`${what}: kFactor must be a number, a function (radius, thickness, angle) => k, a mapping from inside radius to k, [r / t, k] pairs or 'din6935'`)
      }
      return [Number(p[0]), Number(p[1])] as [number, number]
    }).sort((x, y) => x[0] - y[0] || x[1] - y[1])
    if (!pairs.length) throw new RangeError(`${what}: the K-factor table is empty`)
    for (const [rt, kf] of pairs) {
      if (!(rt >= 0) || !(0.0 <= kf && kf <= 1.0)) {
        throw new RangeError(`${what}: the (r / t, k) pairs need ratios of 0 or more and K-factors from 0 to 1; got (${_formatG(rt)}, ${_formatG(kf)})`)
      }
    }
    return (r, t) => {
      const x = r / t
      if (x <= pairs[0][0]) return pairs[0][1]
      for (let i = 0; i + 1 < pairs.length; i++) {
        const [x0, k0] = pairs[i]
        const [x1, k1] = pairs[i + 1]
        if (x <= x1) return x1 > x0 ? k0 + ((k1 - k0) * (x - x0)) / (x1 - x0) : k1
      }
      return pairs[pairs.length - 1][1]
    }
  }
  const entries: [number, number][] = (kFactor instanceof Map ? [...kFactor.entries()] : Object.entries(kFactor as Record<string, number>))
    .map(([r, kf]) => [Number(r), Number(kf)] as [number, number])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
  if (!entries.length) throw new RangeError(`${what}: the K-factor table is empty`)
  for (const [r, kf] of entries) {
    if (!(r > 0) || !(0.0 <= kf && kf <= 1.0)) {
      throw new RangeError(`${what}: the K-factor table maps inside radii (positive) to K-factors (0 to 1); got ${_formatG(r)}: ${_formatG(kf)}`)
    }
  }
  return (r) => {
    for (const [radius, kf] of entries) if (Math.abs(radius - r) <= 1e-6 * Math.max(1.0, r)) return kf
    throw new RangeError(`${what}: the K-factor table has no entry for the inside radius ${_formatG(r)} (it has ${entries.map(([x]) => _formatG(x)).join(', ')})`)
  }
}

function _resolveK(rule: _Rule, radius: number, thickness: number, angle: number, what: string): number {
  const kf = rule(radius, thickness, angle)
  if (!(0.0 <= kf && kf <= 1.0)) {
    throw new RangeError(`${what}: the K-factor for the bend of radius ${_formatG(radius)} and ${_formatG(angle)} degrees is ${String(kf)}; it must be between 0 and 1`)
  }
  return kf
}

/** The K-factor a bend of the part was folded with: of the bends fold() and flange() recorded on the
 * part, the one on the bend's axis with its radius; else the one K-factor of the recorded bends of
 * that radius (the bend may have moved with a later fold). null without a record. */
function _recordedK(part: Part, g: _BendGeom, what: string): number | null {
  const records = part._folds
  if (!records.length) return null
  const tol = _tol(part)
  const same: number[] = []
  for (const [origin, direction, radius, kf] of records) {
    if (Math.abs(radius - g.radius) > tol) continue
    same.push(kf)
    const d = new Vector(direction)
    if (d.isParallel(g.axis, 1e-7) && g.origin.sub(new Vector(origin)).cross(d).length <= tol) return kf
  }
  const kinds = [...new Set(same)].sort((x, y) => x - y)
  if (kinds.length > 1) {
    throw new ModelingError(
      `${what}: the part has bends of inside radius ${_formatG(g.radius)} folded with different K-factors (${kinds.map((x) => _formatG(x)).join(', ')}), and one of them moved with a later fold; give kFactor (a number, a function or a table)`,
    )
  }
  return kinds.length ? kinds[0] : null
}

/** The K-factor of a bend: by the rule given, else as it was folded, else K_FACTOR. */
function _bendK(part: Part, g: _BendGeom, thickness: number, rule: _Rule | null, what: string): number {
  if (rule !== null) return _resolveK(rule, g.radius, thickness, g.angle, what)
  return _recordedK(part, g, what) ?? K_FACTOR
}

/** The one K-factor of all bends, or null where they differ; without bends, the number given
 * (else K_FACTOR). */
function _commonK(ks: readonly number[], kFactor: KFactor | undefined): number | null {
  if (!ks.length) return typeof kFactor === 'number' ? kFactor : K_FACTOR
  return ks.every((x) => x === ks[0]) ? ks[0] : null
}

function _checkRadius(what: string, radius: number, _thickness: number): void {
  if (radius < MIN_RADIUS - 1e-12) {
    throw new ModelingError(
      `${what}: the inside radius ${_formatG(radius)} is too small; the kernel bends and unfolds radii from ${_formatG(MIN_RADIUS)} (its bend region reaches 0.1 past the sheet)`,
    )
  }
}

/**
 * Length of the flat strip that a bend takes: `radians(angle) * (radius + kFactor * thickness)`.
 *
 * `angle` is the bend angle in degrees (90 for an L), `radius` the inside radius.
 */
export function bendAllowance(angle: number, options: BendAllowanceOptions): number {
  _opts('bendAllowance', options)
  const { radius, thickness, kFactor = K_FACTOR } = options
  _checkValues('bendAllowance', angle, radius, thickness, kFactor, 360.0)
  return _radians(angle) * (radius + kFactor * thickness)
}

/**
 * What a bend takes off the sum of the outside leg lengths: `2 * (radius + thickness) *
 * tan(angle / 2) - bendAllowance`. The outside lengths run to the virtual sharp, where the outer
 * faces of the two legs meet (below 180 degrees).
 */
export function bendDeduction(angle: number, options: BendAllowanceOptions): number {
  _opts('bendDeduction', options)
  const { radius, thickness, kFactor = K_FACTOR } = options
  if (!(0.0 < Number(angle) && Number(angle) < 180.0)) {
    throw new RangeError(`bendDeduction: the angle must be above 0 and below 180 degrees (got ${String(angle)})`)
  }
  _checkValues('bendDeduction', angle, radius, thickness, kFactor)
  const setback = (radius + thickness) * Math.tan(_radians(angle) / 2.0)
  return 2.0 * setback - bendAllowance(angle, { radius, thickness, kFactor })
}

/**
 * Length of the flat blank for a strip bent into `legs`:
 * `developedLength(30, 25, { radius: 2, thickness: 2 })`.
 *
 * The legs are outside lengths: from the free end, or from the virtual sharp where the outer
 * faces of two legs meet, to the next virtual sharp (the dimensions on a drawing of the part).
 * `angle` is the angle of every bend, or one angle per bend (`legs.length - 1` of them). The
 * result is `sum(legs) - sum(bend deductions)`.
 */
export function developedLength(...args: [...legs: number[], options: DevelopedLengthOptions]): number {
  const { items: legs, options } = _withOptions<DevelopedLengthOptions>(args)
  _opts('developedLength', options)
  const { angle = 90.0, radius, thickness, kFactor = K_FACTOR } = options
  if (legs.length < 2) throw new RangeError('developedLength: give at least two legs')
  const angles = typeof angle === 'number' ? new Array<number>(legs.length - 1).fill(Number(angle)) : Array.from(angle, Number)
  if (angles.length !== legs.length - 1) {
    throw new RangeError(`developedLength: ${legs.length} legs need ${legs.length - 1} angles, got ${angles.length}`)
  }
  let total = 0.0
  for (const leg of legs) {
    if (!(Number(leg) > 0)) throw new RangeError(`developedLength: the legs must be positive (got ${String(leg)})`)
    total += Number(leg)
  }
  for (const a of angles) total -= bendDeduction(a, { radius, thickness, kFactor })
  return total
}

// =============================================================================== records
/**
 * One bend of a sheet metal part.
 *
 * `angle` in degrees, `radius` the inside radius, `length` the bend's extent along its axis.
 * From `bends`, `axis` is the axis of the bend's cylinders. In a `FlatPattern`, `line` is the bend
 * line (the middle of the bend's strip, at z = 0) and `direction` "up" or "down": where the sheet
 * beyond the line folds to, seen from above (+Z).
 */
export class Bend {
  readonly angle: number
  readonly radius: number
  readonly thickness: number
  readonly kFactor: number
  readonly length: number
  readonly axis: Axis | null
  readonly line: Edge | null
  readonly direction: string | null

  constructor(
    angle: number,
    radius: number,
    thickness: number,
    kFactor: number,
    length: number,
    axis: Axis | null = null,
    line: Edge | null = null,
    direction: string | null = null,
  ) {
    this.angle = angle
    this.radius = radius
    this.thickness = thickness
    this.kFactor = kFactor
    this.length = length
    this.axis = axis
    this.line = line
    this.direction = direction
  }

  /** The bend allowance (the width of the bend's strip in the flat). */
  get allowance(): number {
    return bendAllowance(this.angle, { radius: this.radius, thickness: this.thickness, kFactor: this.kFactor })
  }

  /** Equal fields (Python's dataclass `==`). */
  equals(other: unknown): boolean {
    if (!(other instanceof Bend)) return false
    const same = (a: { equals(o: unknown): boolean } | null, b: unknown) => (a === null ? b === null : a.equals(b))
    return (
      this.angle === other.angle &&
      this.radius === other.radius &&
      this.thickness === other.thickness &&
      this.kFactor === other.kFactor &&
      this.length === other.length &&
      same(this.axis, other.axis) &&
      same(this.line, other.line) &&
      this.direction === other.direction
    )
  }

  toString(): string {
    const extra = this.direction ? `, ${this.direction}` : ''
    return `Bend(angle=${_formatG(this.angle)}, radius=${_formatG(this.radius)}, thickness=${_formatG(this.thickness)}, kFactor=${_formatG(this.kFactor)}, length=${_formatG(this.length)}, allowance=${_formatG(this.allowance)}${extra})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/**
 * The unfolded part, laid on the XY plane: its bottom face at z = 0, the top at z = thickness,
 * the longer side of the smallest rectangle around it along X and its bounding box starting at
 * the origin.
 *
 * `outline` is the cut contour (outer boundary and holes) as a sketch at z = 0; `bends` carry the
 * bend lines (at z = 0) with angle, radius, direction, K-factor and allowance. `kFactor` is the
 * K-factor of every bend, or `null` where the bends have different ones (each `Bend` has its own).
 */
export class FlatPattern {
  readonly part: Part
  readonly outline: Sketch
  readonly bends: Bend[]
  readonly thickness: number
  readonly kFactor: number | null

  constructor(part: Part, outline: Sketch, bends: Bend[], thickness: number, kFactor: number | null) {
    this.part = part
    this.outline = outline
    this.bends = bends
    this.thickness = thickness
    this.kFactor = kFactor
  }

  /** The bend lines (middle of each bend's strip), at z = 0. */
  get bendLines(): ShapeList<Edge> {
    return _list(this.bends.filter((b) => b.line !== null).map((b) => b.line as Edge))
  }

  /** Size of the blank: (length along X, width along Y, thickness). */
  get size(): Vector {
    return this.part.bbox().size
  }

  /** Equal fields (Python's dataclass `==`). */
  equals(other: unknown): boolean {
    return (
      other instanceof FlatPattern &&
      this.part.equals(other.part) &&
      this.outline.equals(other.outline) &&
      this.bends.length === other.bends.length &&
      this.bends.every((b, i) => b.equals(other.bends[i])) &&
      this.thickness === other.thickness &&
      this.kFactor === other.kFactor
    )
  }

  toString(): string {
    const s = this.size
    const kf = this.kFactor === null ? 'per bend' : _formatG(this.kFactor)
    return `FlatPattern(${_formatG(s.x)} x ${_formatG(s.y)}, thickness=${_formatG(this.thickness)}, ${this.bends.length} bends, kFactor=${kf})`
  }

  [inspect](): string {
    return this.toString()
  }
}

// =============================================================================== sheet analysis
type _Plane = [Face, Vector, Vector]

function _tol(part: Part): number {
  return 1e-6 * Math.max(1.0, part._extent())
}

/** (face, a point on it, outward unit normal) of every planar face. */
function _planarFaces(part: Part): _Plane[] {
  const out: _Plane[] = []
  for (const f of part.faces()) {
    if (f.geomType === 'plane') out.push([f, f.interiorPoint(), f.normalAt()])
  }
  return out
}

/** Distance from a face plane to the nearest face behind it that faces the other way. */
function _thicknessBehind(planes: readonly _Plane[], point: Vector, normal: Vector, tol: number): number | null {
  let best: number | null = null
  for (const [, q, m] of planes) {
    if (m.dot(normal) < -1.0 + 1e-9) {
      const d = point.sub(q).dot(normal)
      if (d > tol && (best === null || d < best)) best = d
    }
  }
  return best
}

/**
 * Outward normal of the sheet face a line lies on, the sheet thickness there and the line's
 * point moved exactly onto the face's plane. Of the faces whose plane holds the line (a side face
 * can, along an edge), the sheet face is the one with the nearest face opposite it.
 */
function _sheetFaceAt(planes: readonly _Plane[], p0: Vector, d: Vector, tol: number, what: string): [Vector, number, Vector] {
  let best: [number, Vector, Vector] | null = null
  for (const [, q, n] of planes) {
    if (Math.abs(p0.sub(q).dot(n)) <= tol && Math.abs(d.dot(n)) <= 1e-7) {
      const t = _thicknessBehind(planes, q, n, tol)
      if (t !== null && (best === null || t < best[0] - tol)) best = [t, n, q]
    }
  }
  if (best === null) {
    throw new ModelingError(
      `${what}: the bend line does not lie on a face of the sheet; draw it on the top or bottom face (for a plate on XY from z = 0 to t: new Axis([x, 0, t], [0, 1, 0]))`,
    )
  }
  const [t, n, q] = best
  const pOn = p0.sub(n.mul(p0.sub(q).dot(n))) // onto the plane exactly
  return [n, t, pOn]
}

/** Point, unit direction and segment length (null for an Axis) of a bend line. */
function _asLine(line: unknown, what: string): [Vector, Vector, number | null] {
  if (line instanceof Axis) return [line.origin, line.direction.normalized(), null]
  if (line instanceof Edge) {
    if (line.geomType !== 'line') throw new RangeError(`${what}: the bend line must be straight (an Axis or a Line), not a ${line.geomType}`)
    const p0 = line.start
    const p1 = line.end
    const v = p1.sub(p0)
    return [p0, v.div(v.length), v.length]
  }
  throw new TypeError(`${what}: the bend line must be an Axis or a straight Edge, not a ${_typeName(line)}`)
}

function _pointOf(target: unknown): Vector {
  if (target instanceof Shape && !(target instanceof Vertex)) return target.center()
  if (target instanceof Vertex) return target.point
  return _vec(target as VectorLike)
}

/** The volume for the checks of an operation: measured like `part.volume`, without its warnings
 * (they are for the user's own measures). */
function _volume(part: Part): number {
  return Number(part._props().volume)
}

/**
 * Whether `result` has the `expected` volume.
 *
 * Bending or unbending curved faces (a hole across a bend zone) gives NURBS faces whose trim
 * curves do not quite meet their neighbours': the volume integrated over the faces as they are is
 * then uncertain by up to 1e-4, and the volume of a fine mesh decides, within the mesh's error
 * (curved area times the chord tolerance).
 */
function _volumeAgrees(result: Part, expected: number, scale: number): boolean {
  if (Math.abs(_volume(result) - expected) <= 1e-6 * scale) return true
  const faces = result.faces()
  if (!faces.some((f) => f.geomType === 'bspline')) return false
  const tol = 1e-4 * Math.max(1.0, result.bbox().diagonal)
  let curved = 0
  for (const f of faces) if (f.geomType !== 'plane') curved += f.area
  return Math.abs(tessellate(result, tol).volume - expected) <= curved * tol + 1e-6 * scale
}

function _requirePart(part: unknown, what: string): Part {
  if (!(part instanceof Part)) throw new TypeError(`${what}: expected a Part (a sheet of material), got ${_typeName(part)}`)
  part._requireValid(what)
  return part
}

/** `error` with `cause` (Python's `raise error from cause`). */
function _causedBy<E extends Error>(error: E, cause: unknown): E {
  ;(error as Any).cause = cause
  return error
}

/** The first item with the smallest key (Python's `min(items, key=key)`). */
function _minBy<T>(items: readonly T[], key: (item: T) => number): T {
  let best = items[0]
  let bestKey = key(best)
  for (let i = 1; i < items.length; i++) {
    const v = key(items[i])
    if (v < bestKey) {
      best = items[i]
      bestKey = v
    }
  }
  return best
}

// =============================================================================== bending
/**
 * Area of the sheet in the bend zone (the material the bend takes), from the part inside the
 * kernel's bend region: `width` across the line through `pIn` (on the inside face), `lo` to `hi`
 * along it, through the thickness and 0.1 past it. Throws when the region holds anything but flat
 * sheet (the kernel would build a broken body or crash).
 */
function _zoneMaterial(
  part: Part,
  pIn: Vector,
  across: Vector,
  along: Vector,
  nIn: Vector,
  width: number,
  lo: number,
  hi: number,
  thickness: number,
  what: string,
): number {
  const margin = 0.1 // the kernel's bend region reaches as far past the sheet
  const center = pIn.add(along.mul(0.5 * (lo + hi))).sub(nIn.mul(0.5 * thickness))
  const region = Box(width, hi - lo + 2 * margin, thickness + 2 * margin).moved(new Plane(center, across, nIn).location)
  let common: Part
  try {
    common = Part._wrap(part._runBoolean([region], k.BooleanOp.INTERSECTION, what))
  } catch (e) {
    if (!(e instanceof KernelError)) throw e
    throw _causedBy(
      new ModelingError(`${what}: the material in the bend zone cannot be measured; move the bend line a little (away from edges and features)`),
      e,
    )
  }
  if (k.brep_face_count(common._brep) === 0) {
    throw new ModelingError(`${what}: the bend line does not cross the sheet (there is no material in the bend zone)`)
  }
  const tol = _tol(part)
  const depth = common.moved(new Plane(center, across, nIn).location.inverse()).bbox().size.z
  if (depth > thickness + tol) {
    throw new ModelingError(
      `${what}: the bend zone holds more than the sheet (${_formatG(depth)} deep across it, the sheet is ${_formatG(thickness)} thick): a rib, flange or other bend stands in it; move the line`,
    )
  }
  for (const f of common.faces()) {
    const kind = f.geomType
    if (kind === 'plane') {
      const c = Math.abs(f.normalAt().dot(nIn))
      if (c < 1 - 1e-9 && c > 1e-9) throw new ModelingError(`${what}: the bend zone holds a face inclined to the sheet; move the line`)
    } else if (kind === 'cylinder' && f.axis.direction.isParallel(nIn, 1e-7)) {
      // the wall of a hole or of a rounded corner: bends into NURBS
    } else if (kind === 'cylinder') {
      throw new ModelingError(
        `${what}: the bend zone overlaps another bend; keep the bend line at least half the bend allowance (${_formatG(width / 2, 4)}) away from the flat end of every other bend`,
      )
    } else {
      throw new ModelingError(`${what}: the bend zone holds a ${kind} face; bend only across flat sheet`)
    }
  }
  return Number(common._props(1e-9).volume) / thickness
}

/** Options of `fold`. */
export interface FoldOptions {
  /** Inside bend radius. */
  radius: number
  /** Position of the neutral fiber, 0 (inside) to 1 (outside); default `K_FACTOR`. The part keeps
   * it with the bend: `unfold` and `flatPattern` take it by default. */
  kFactor?: number
  /** A point (or a face, edge or vertex) on the side of the line that stays in place; by default
   * the side that reaches farther from the line stays. */
  fixed?: VectorLike | Shape | null
  /** Bend only along the segment `line` (an Edge), not across the whole sheet. The strip next to
   * the segment must be cut free from the rest of the sheet (relief cuts). */
  partial?: boolean
}

/**
 * Fold a sheet along a line.
 *
 * @param part A sheet: a solid of constant thickness (a plate, or a part bent before).
 * @param line The bend line, an `Axis` or a straight `Edge` lying on the top or bottom face of the
 *   sheet. It is the middle of the bend: the strip of the bend allowance's width centered on it
 *   becomes the bend.
 * @param angle Bend angle in degrees, up to 180. A positive angle folds the sheet towards the side
 *   the face with the line faces (that face ends up inside the bend); a negative angle folds it
 *   the other way.
 * @param options `radius` (the inside bend radius), `kFactor` (the position of the neutral fiber,
 *   0 inside to 1 outside), `fixed` (a point, or a face, edge or vertex, on the side of the line
 *   that stays in place; by default the side that reaches farther from the line stays) and
 *   `partial` (bend only along the segment `line`, an Edge, not across the whole sheet; the strip
 *   next to the segment must be cut free from the rest of the sheet by relief cuts).
 * @returns The bent part: the bend faces are exact cylinders of `radius` and `radius + thickness`.
 */
export function fold(part: Part, line: Axis | Edge, angle: number, options: FoldOptions): Part {
  _opts('fold', options)
  let { radius, kFactor = K_FACTOR } = options
  const { fixed = null, partial = false } = options
  const what = 'bend'
  _requirePart(part, what)
  let [p0, d, seg] = _asLine(line, what)
  if (partial && seg === null) throw new RangeError('bend: partial: true needs the bend line as an Edge (a segment), not an Axis')
  const tol = _tol(part)
  const planes = _planarFaces(part)
  const [nFace, t, pOn] = _sheetFaceAt(planes, p0, d, tol, 'bend')
  p0 = pOn
  d = d.sub(nFace.mul(d.dot(nFace))).normalized()
  const a = Number(angle)
  if (a === 0 || !(Math.abs(a) <= 180.0)) {
    throw new RangeError(`bend: the angle must be between -180 and 180 degrees and not zero (got ${String(angle)})`)
  }
  _checkValues(what, Math.abs(a), radius, t, kFactor)
  radius = Number(radius)
  kFactor = Number(kFactor)
  _checkRadius(what, radius, t)

  // The inside of the bend: the face with the line for a positive angle, else the opposite face.
  const nIn = a > 0 ? nFace : nFace.neg()
  const pIn = a > 0 ? p0 : p0.sub(nFace.mul(t))
  const across = nFace.cross(d).normalized() // in the sheet, perpendicular to the line

  // The side that stays.
  let stay: Vector
  if (fixed != null) {
    const side = _pointOf(fixed).sub(p0).dot(across)
    if (Math.abs(side) <= tol) throw new RangeError('bend: the fixed point lies on the bend line; give a point on the side that stays')
    stay = side > 0 ? across : across.neg()
  } else {
    const reach = part.vertices().map((v) => v.point.sub(p0).dot(across))
    stay = Math.max(...reach) >= -Math.min(...reach) ? across : across.neg()
  }

  // Kernel frame: the side of cross(direction, axis) stays, direction runs from the axis to the sheet.
  const direction = nIn.neg()
  const axisDir = direction.cross(d).dot(stay) > 0 ? d : d.neg()
  const axisLinePoint = pIn.add(nIn.mul(radius))
  let lo: number
  let hi: number
  if (partial) {
    const s0 = p0.sub(axisLinePoint).dot(axisDir)
    const s1 = p0
      .add(d.mul(seg as number))
      .sub(axisLinePoint)
      .dot(axisDir)
    lo = Math.min(s0, s1)
    hi = Math.max(s0, s1)
  } else {
    const [lo3, hi3] = k.brep_bounding_box(part._brep, false)
    const proj: number[] = []
    for (const x of [lo3[0], hi3[0]]) {
      for (const y of [lo3[1], hi3[1]]) {
        for (const z of [lo3[2], hi3[2]]) proj.push(new Vector(x, y, z).sub(axisLinePoint).dot(axisDir))
      }
    }
    lo = Math.min(...proj) - 1.0
    hi = Math.max(...proj) + 1.0
  }
  const allowance = bendAllowance(Math.abs(a), { radius, thickness: t, kFactor })

  const strip = _zoneMaterial(part, pIn, across, axisDir, nIn, allowance, lo, hi, t, what)
  const h = new BrepHandle(part._copyBrep())
  const hint = `the bend zone must lie inside one flat region of the sheet: move the line away from edges, holes and other bends (at least half the bend allowance, ${_formatG(allowance / 2, 4)})`
  try {
    kernelCall(
      'bend',
      () =>
        k.sheetmetal.bend(h.brep, Math.abs(a), radius, kFactor, t, axisLinePoint.add(axisDir.mul(lo)).toArray(), axisDir.toArray(), direction.toArray(), hi - lo),
      hint,
    )
  } catch (e) {
    if (!(e instanceof KernelError)) throw e
    if (e.detail.includes('no material')) {
      throw _causedBy(new ModelingError('bend: the bend line does not cross the sheet (there is no material in the bend zone)'), e)
    }
    if (e.detail.includes('does not cut the body in two')) {
      if (partial) {
        throw _causedBy(
          new ModelingError(
            `bend: the sheet beside the partial bend is not cut free: cut reliefs (slots) from the edge along both ends of the bend line, at least half the bend allowance (${_formatG(allowance / 2, 4)}) past it, so that only the bent strip joins the two sides`,
          ),
          e,
        )
      }
      throw _causedBy(
        new ModelingError(
          `bend: the bend zone does not cut the sheet in two: it reaches past an edge of the sheet or the sheet goes around it; keep the line at least half the bend allowance (${_formatG(allowance / 2, 4)}) away from edges parallel to it (a strip cut free from the rest bends with partial: true)`,
        ),
        e,
      )
    }
    throw e
  }
  const result = part._like(_take(h))
  // the before side stays: the bend's axis ends up over the zone's edge on that side
  const axis = new Axis(axisLinePoint.add(stay.mul(allowance / 2)), axisDir)
  _checkBendResult(result, part, what, strip, radius, t, kFactor, axis, Boolean(partial), hint)
  result._folds = [...part._folds, [axis.origin.toArray(), axis.direction.toArray(), radius, kFactor] as const]
  return result
}

function _checkBendResult(
  result: Part,
  before: Part,
  what: string,
  strip: number,
  radius: number,
  t: number,
  kFactor: number,
  axis: Axis,
  partial: boolean,
  hint: string,
): void {
  const relief = partial ? ' The sheet next to a partial bend must be cut free (relief cuts) so that only the bent strip connects the two sides.' : ''
  const problem = result._solidProblem()
  if (problem !== null) throw new ModelingError(`${what}: the result is not a valid solid (${problem}); ${hint}.${relief}`)
  const tol = _tol(result)
  const onAxis = result
    .faces()
    .filter((f) => f.geomType === 'cylinder' && f.axis.direction.isParallel(axis.direction, 1e-6) && axis.distanceTo(f.axis.origin) <= tol)
  const inner = onAxis.filter((f) => Math.abs(f.radius - radius) <= tol)
  const outer = onAxis.filter((f) => Math.abs(f.radius - radius - t) <= tol)
  if (!inner.length || !outer.length) {
    throw new ModelingError(
      `${what}: the kernel did not build exact bend faces (cylinders of radius ${_formatG(radius)} and ${_formatG(radius + t)}); ${hint}`,
    )
  }
  const v0 = _volume(before)
  const expected = v0 + (strip * t * t * (0.5 - kFactor)) / (radius + kFactor * t)
  if (!_volumeAgrees(result, expected, v0)) {
    throw new ModelingError(
      `${what}: the result has the volume ${_formatG(_volume(result), 9)}, expected ${_formatG(expected, 9)} for the material in the bend zone; ${hint}.${relief}`,
    )
  }
}

/** Options of `flange`. */
export interface FlangeOptions {
  /** Bend angle in degrees, below 180 (default 90). A positive angle folds the flange towards the
   * side the face with the edge faces, a negative one the other way. */
  angle?: number
  /** Inside bend radius. */
  radius: number
  /** Position of the neutral fiber, 0 (inside) to 1 (outside); default `K_FACTOR`. */
  kFactor?: number
}

/**
 * Add a flange along a straight edge of a sheet.
 *
 * The sheet is extended beyond the edge and bent there: the bend starts at the edge (the sheet
 * keeps its size), its inside radius is `radius`.
 *
 * @param part A sheet (a plate, or a part with bends or flanges).
 * @param edge A straight edge where a top or bottom face of the sheet meets a side face (an outer
 *   edge, such as `plate.edges().filterBy(Y).top().right()`).
 * @param length Outside length of the flange: from the virtual sharp, where the outside faces of
 *   the sheet and the flange meet, to the flange's end. For 90 degrees it is the flange's height
 *   over the outside face of the sheet.
 * @param options `angle` (the bend angle in degrees, below 180, default 90: a positive angle folds
 *   the flange towards the side the face with the edge faces, a negative one the other way),
 *   `radius` (the inside bend radius) and `kFactor` (the position of the neutral fiber, 0 inside
 *   to 1 outside).
 */
export function flange(part: Part, edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part {
  _opts('flange', options)
  const { angle = 90.0, kFactor = K_FACTOR } = options
  let { radius } = options
  const what = 'flange'
  _requirePart(part, what)
  if (!(edge instanceof Edge || edge instanceof ShapeList)) throw new TypeError(`flange: expected an edge of the part, got ${_typeName(edge)}`)
  const kedges = part._ownEdges(edge)
  if (kedges.length !== 1) throw new RangeError(`flange: give one edge of the part (got ${kedges.length}); flange edges one at a time`)
  const e = Edge._of(part, kedges[0])
  if (e.geomType !== 'line') throw new RangeError(`flange: the edge must be straight, not a ${e.geomType}`)
  const a = Number(angle)
  if (a === 0 || !(Math.abs(a) < 180.0)) {
    throw new RangeError(`flange: the angle must be between -180 and 180 degrees (exclusive) and not zero (got ${String(angle)})`)
  }
  const tol = _tol(part)
  const planes = _planarFaces(part)
  const faces = e.faces().filter((f) => f.geomType === 'plane')
  if (faces.length !== 2) throw new ModelingError('flange: the edge must lie between two planar faces (a face of the sheet and a side face)')
  const all: [number | null, Face, Vector][] = []
  for (const f of faces) {
    const n = f.normalAt()
    all.push([_thicknessBehind(planes, e.center(), n, tol), f, n])
  }
  const info = all.filter((x): x is [number, Face, Vector] => x[0] !== null)
  if (!info.length) throw new ModelingError('flange: no face opposite the faces at the edge; the part is not a sheet')
  const [t, sheetFace, nFace] = _minBy(info, (x) => x[0])
  const side = faces.filter((f) => f !== sheetFace)[0]
  const out = side.normalAt()
  const d = e.direction
  if (Math.abs(out.dot(nFace)) > 1e-7 || Math.abs(out.dot(d)) > 1e-7) {
    throw new ModelingError('flange: the side face at the edge must be square to the sheet (a straight cut edge)')
  }
  _checkValues(what, Math.abs(a), radius, t, kFactor)
  radius = Number(radius)
  _checkRadius(what, radius, t)
  const setback = (radius + t) * Math.tan(_radians(Math.abs(a)) / 2)
  const leg = Number(length) - setback
  if (!(leg > tol)) {
    throw new ModelingError(
      `flange: the length must be more than the bend's outside setback (radius + thickness) * tan(angle / 2) = ${_formatG(setback)}; got ${String(length)}`,
    )
  }
  const allowance = bendAllowance(Math.abs(a), { radius, thickness: t, kFactor })
  const reach = allowance + leg
  const w = e.length
  const center = e
    .center()
    .add(out.mul(reach / 2))
    .sub(nFace.mul(t / 2))
  const strip = Box(reach, w, t).moved(new Plane(center, out, nFace).location)
  const extended = part.fuse(strip)
  const expected = _volume(part) + reach * w * t
  if (Math.abs(_volume(extended) - expected) > 1e-6 * expected) {
    throw new ModelingError('flange: the strip for the flange overlaps the part; the edge must be an outer edge with nothing beyond it')
  }
  const lineStart = e.start.add(out.mul(allowance / 2))
  const line = Line(lineStart, lineStart.add(d.mul(w)))
  return fold(extended, line, a, { radius, kFactor, fixed: e.center(), partial: true })
}

// =============================================================================== finding bends
/** A bend found in a part: its cylinder faces and where they are. */
class _BendGeom {
  readonly inner: Face[]
  readonly outer: Face[]
  /** On the axis, at the start of the bend along it. */
  readonly origin: Vector
  /** Unit. */
  readonly axis: Vector
  /** Unit, from the axis to the middle of the bend. */
  readonly mid: Vector
  /** Inside. */
  readonly radius: number
  readonly thickness: number
  /** Degrees. */
  readonly angle: number
  /** Along the axis. */
  readonly length: number

  constructor(
    inner: Face[],
    outer: Face[],
    origin: Vector,
    axis: Vector,
    mid: Vector,
    radius: number,
    thickness: number,
    angle: number,
    length: number,
  ) {
    this.inner = inner
    this.outer = outer
    this.origin = origin
    this.axis = axis
    this.mid = mid
    this.radius = radius
    this.thickness = thickness
    this.angle = angle
    this.length = length
  }

  faces(): Face[] {
    return [...this.inner, ...this.outer]
  }
}

/** Angles (about the axis, from x towards y) and axial positions of points on a face's boundary. */
function _anglesOn(face: Face, origin: Vector, axis: Vector, x: Vector, y: Vector): [number[], number[]] {
  const angles: number[] = []
  const along: number[] = []
  for (const e of face.edges()) {
    const n = e.geomType === 'line' ? 1 : 8
    for (let i = 0; i <= n; i++) {
      const p = e.pointAt(i / n).sub(origin)
      along.push(p.dot(axis))
      angles.push(Math.atan2(p.dot(y), p.dot(x)))
    }
  }
  return [angles, along]
}

/** [start, span] of the shortest arc covering all angles (radians). */
function _arcSpan(angles: readonly number[]): [number, number] {
  const a = angles.map((x) => _mod(x, 2 * Math.PI)).sort((p, q) => p - q)
  const gaps = a.map((_, i) => _mod(a[(i + 1) % a.length] - a[i], 2 * Math.PI))
  let i = 0
  for (let j = 1; j < a.length; j++) if (gaps[j] > gaps[i]) i = j
  const start = a[(i + 1) % a.length]
  return [start, a.length > 1 ? 2 * Math.PI - gaps[i] : 0.0]
}

/** The bends of a sheet metal part (pairs of coaxial cylinder faces one thickness apart) and the
 * sheet thickness (null when there is no bend). */
function _findBends(part: Part): [_BendGeom[], number | null] {
  const tol = _tol(part)
  const cylinders = part.faces().filter((f) => f.geomType === 'cylinder')
  const groups: [Vector, Vector, Face[]][] = [] // axis point, axis direction, faces
  for (const f of cylinders) {
    const ax = f.axis
    const z = ax.direction.normalized()
    const o = ax.origin
    const g = groups.find(([go, gz]) => gz.isParallel(z, 1e-7) && o.sub(go).cross(gz).length <= tol)
    if (g) g[2].push(f)
    else groups.push([o, z, [f]])
  }
  const found: _BendGeom[] = []
  let thickness: number | null = null
  for (const [o, z, faces] of groups) {
    const radii: number[] = []
    for (const f of faces) {
      if (!radii.some((r) => Math.abs(f.radius - r) <= tol)) radii.push(f.radius)
    }
    radii.sort((p, q) => p - q)
    if (radii.length < 2) continue // a hole or a round, not a bend
    if (radii.length > 2) {
      throw new ModelingError(
        `the part has coaxial cylinder faces of ${radii.length} radii (${radii.map((r) => _formatG(r)).join(', ')}); it is not a sheet metal part`,
      )
    }
    const [rIn, rOut] = radii
    const t = rOut - rIn
    if (thickness === null) thickness = t
    else if (Math.abs(t - thickness) > tol) {
      throw new ModelingError(`the bends of the part have different thicknesses (${_formatG(thickness)} and ${_formatG(t)})`)
    }
    const x = z.anyPerpendicular().normalized()
    const y = z.cross(x)
    const angles: number[] = []
    const along: number[] = []
    for (const f of faces) {
      const [a, s] = _anglesOn(f, o, z, x, y)
      angles.push(...a)
      along.push(...s)
    }
    const [start, span] = _arcSpan(angles)
    const midAngle = start + span / 2
    const mid = x.mul(Math.cos(midAngle)).add(y.mul(Math.sin(midAngle)))
    const s0 = Math.min(...along)
    const s1 = Math.max(...along)
    const inner = faces.filter((f) => Math.abs(f.radius - rIn) <= tol)
    const outer = faces.filter((f) => Math.abs(f.radius - rOut) <= tol)
    let angle = _degrees(span)
    if (Math.abs(angle - 180.0) <= 1e-6) angle = 180.0 // (a U bend, measured to the rounding of its points)
    found.push(new _BendGeom(inner, outer, o.add(z.mul(s0)), z, mid, rIn, t, angle, s1 - s0))
  }
  return [found, thickness]
}

/** The flat sheet at the two ends of a bend (its start, half the angle before `mid`, and its end):
 * the planar faces tangent to its cylinders along their straight boundary lines there. A free end
 * (an end face across the sheet) has none. */
function _bendEnds(part: Part, g: _BendGeom): [Face[], Face[]] {
  const tol = _tol(part)
  const half = _radians(g.angle) / 2
  const x = g.mid
  const y = g.axis.cross(g.mid)
  const own = new Set(g.faces().map((f) => f._identity()))
  const ends: [Face[], Face[]] = [[], []]
  const seen = new Set<string>()
  for (const f of g.faces()) {
    for (const e of f.edges()) {
      if (e.geomType !== 'line' || !e.end.sub(e.start).isParallel(g.axis, 1e-7)) continue
      const q = e.center().sub(g.origin)
      const a = Math.atan2(q.dot(y), q.dot(x))
      const radius = Math.hypot(q.dot(x), q.dot(y))
      const side = Math.abs(a + half) * radius <= 10 * tol ? 0 : Math.abs(a - half) * radius <= 10 * tol ? 1 : null
      if (side === null) continue
      const radial = x.mul(Math.cos(a)).add(y.mul(Math.sin(a)))
      for (const nb of e.faces()) {
        const key = nb._identity()
        if (own.has(key) || seen.has(key) || nb.geomType !== 'plane') continue
        if (Math.abs(Math.abs(nb.normalAt().dot(radial)) - 1.0) <= 1e-7) {
          seen.add(key)
          ends[side].push(nb)
        }
      }
    }
  }
  return ends
}

/**
 * The bends of a sheet metal part: angle, inside radius, thickness, length and axis of each.
 *
 * A bend is a pair of coaxial cylinder faces one sheet thickness apart (as `fold`, `flange` and
 * `bend` make them, or as imported from a sheet metal part), up to below a full turn. Cylinders
 * without such a partner (holes, rounds) are not bends. `kFactor` is only used for the allowances.
 */
export function bends(part: Part, options: { kFactor?: KFactor } = {}): Bend[] {
  const { kFactor = null } = options
  if (!(part instanceof Part)) throw new TypeError(`bends: expected a Part, got ${_typeName(part)}`)
  const rule = _kRule(kFactor, 'bends')
  const [found] = _findBends(part)
  return found.map((g) => new Bend(_r(g.angle), _r(g.radius), _r(g.thickness), _bendK(part, g, g.thickness, rule, 'bends'), _r(g.length), new Axis(g.origin, g.axis)))
}

/** A measured value without the noise far below the modeling tolerance (90.00000000000051):
 * rounded to 9 decimals (Python's `round(value, 9)`). */
function _r(value: number): number {
  return Number(value.toFixed(9))
}

// =============================================================================== unfolding
/** The face that stays in place: the largest planar face; of faces that large, the one the part
 * stands on (the rest of the part lies behind it). */
function _baseFace(part: Part, planes: readonly _Plane[]): Face {
  if (!planes.length) throw new ModelingError('unfold: the part has no planar face')
  const areas = planes.map(([f]) => f.area)
  const top = Math.max(...areas)
  const center = part.center()
  const candidates = planes.filter((_, i) => areas[i] >= top * (1 - 1e-6))
  return _minBy(candidates, (c) => center.sub(c[1]).dot(c[2]))[0]
}

/** Number of face-to-face steps from the face `start` (kernel face) to every face (by index). */
function _faceDistances(part: Part, start: number): Map<number, number> {
  const dump = ext.brep_dump(part._brep, false)
  const edgeFaces = new Map<number, number[]>()
  dump.faces.forEach((fd: Any, i: number) => {
    for (const use of fd.uses) {
      if (use == null) continue
      for (const loop of use.loops) {
        for (const [e] of loop.edges) {
          let fs = edgeFaces.get(e)
          if (fs === undefined) edgeFaces.set(e, (fs = []))
          fs.push(i)
        }
      }
    }
  })
  const neighbors = new Map<number, Set<number>>()
  for (const fs of edgeFaces.values()) {
    for (const f of fs) {
      let set = neighbors.get(f)
      if (set === undefined) neighbors.set(f, (set = new Set()))
      for (const g of fs) set.add(g)
    }
  }
  const first: number = ext.face_indices(part._brep, [start])[0]
  const dist = new Map<number, number>([[first, 0]])
  let queue = [first]
  while (queue.length) {
    const next: number[] = []
    for (const f of queue) {
      for (const g of neighbors.get(f) ?? []) {
        if (!dist.has(g)) {
          dist.set(g, (dist.get(f) as number) + 1)
          next.push(g)
        }
      }
    }
    queue = next
  }
  return dist
}

interface _Unfolded {
  /** Flat, in place. */
  part: Part
  /** The face that stayed. */
  base: Face
  /** Bend, line start, line direction, inside normal, K-factor. */
  bends: [_BendGeom, Vector, Vector, Vector, number][]
  thickness: number | null
  /** Of every bend (null: they differ). */
  kFactor: number | null
}

function _unfold(part: Part, kFactor: KFactor | undefined, fixed: Face | null, what: string): _Unfolded {
  _requirePart(part, what)
  const rule = _kRule(kFactor, what)
  const planes = _planarFaces(part)
  if (fixed != null) {
    if (!(fixed instanceof Face) || fixed.owner !== part || fixed.geomType !== 'plane') {
      throw new RangeError(`${what}: fixed must be a planar face of the part`)
    }
  }
  const [found, foundThickness] = _findBends(part)
  const thickness = foundThickness
  for (const g of found) _checkRadius(what, g.radius, g.thickness)
  // each bend's K-factor, from the part as it is; an inner face of each, followed into the copy,
  // tells which bend is which as the unbends move them
  const ks = found.map((g) => _bendK(part, g, g.thickness, rule, what))
  const volume = _volume(part)
  let expected = volume
  const hint = 'the part must be a sheet of constant thickness whose bends are separated by flat regions'
  const done: [_BendGeom, Vector, Vector, Vector, number][] = []
  if (found.length === 1 && !_bendEnds(part, found[0]).some((e) => e.length > 0)) {
    // a rolled part: one bend and no flat sheet; it unrolls about the middle of the bend
    if (fixed != null) {
      throw new RangeError(`${what}: the part is rolled (one bend, no flat sheet to keep in place); it unrolls about the middle of its bend: leave fixed out`)
    }
    const g = found[0]
    const kf = ks[0]
    const nr = g.radius + kf * g.thickness
    expected -= (_strip(g, nr) * g.thickness * g.thickness * (0.5 - kf)) / nr
    const spec: _Spec = {
      axis: null,
      tolerance: 1e-6,
      pieces: [{ kind: 'unbend', center: g.origin.toArray(), axis: g.axis.toArray(), mid: g.mid.toArray(), neutral: nr }],
    }
    const work = _deformed(part, spec, [Math.min(1.0, nr / (g.radius + g.thickness)), Math.max(1.0, nr / g.radius)], what, hint)
    const anchor: number = _baseFace(work, _planarFaces(work))._f
    done.push([g, g.origin.add(g.mid.mul(nr)), g.axis, g.mid.neg(), kf])
    return _finish(work, anchor, done, thickness, expected, volume, kFactor, what, hint)
  }
  const base = fixed != null ? fixed : _baseFace(part, planes)
  const [copy, mapped] = ext.copy_with_map(part._brep, [base._f, ...found.map((g) => g.inner[0]._f)], [], [])
  let work = Part._wrap(copy, { name: part.name, color: part.color })
  let anchor: number = mapped[0]
  const tracked: number[] = mapped.slice(1)
  const left = found.map((_, i) => i)
  for (let n = 0; n < found.length; n++) {
    const [current] = _findBends(work)
    if (!current.length) break
    const dist = _faceDistances(work, anchor)
    const index = new Map<_BendGeom, number>()
    for (const c of current) {
      const ids: number[] = ext.face_indices(
        work._brep,
        c.faces().map((f) => f._f),
      )
      let steps = 1 << 30
      for (const i of ids) steps = Math.min(steps, dist.get(i) ?? 1 << 30)
      index.set(c, steps)
    }
    const g = _minBy(current, (c) => index.get(c) as number)
    const sheet = thickness as number // (the part has bends, so their thickness is known)
    let mine = left.filter((i) => g.inner.some((f) => f._f === tracked[i]))
    if (!mine.length) {
      // (its faces were replaced): the bend of the part with its radius, angle and length
      mine = left.filter((i) => Math.abs(found[i].radius - g.radius) <= _tol(part) && Math.abs(found[i].angle - g.angle) <= 1e-6 &&
        Math.abs(found[i].length - g.length) <= _tol(part))
    }
    let kHere: number
    if (mine.length) {
      left.splice(left.indexOf(mine[0]), 1)
      kHere = ks[mine[0]]
    } else {
      kHere = _bendK(part, g, sheet, rule, what)
    }
    const nr = g.radius + kHere * sheet
    expected -= (_strip(g, nr) * sheet * sheet * (0.5 - kHere)) / nr
    const ends = _bendEnds(work, g)
    if (!(ends[0].length && ends[1].length && g.angle <= 180.0 + 1e-9)) {
      // a bend at a free end of the sheet, or over 180 degrees: unrolled with the unbend
      // deformation (the kernel's unbend needs flat sheet on both sides and turns up to 180)
      const [unrolled, kept, start, inside] = _unrollBend(work, g, nr, anchor, ends, what, hint)
      work = unrolled
      anchor = kept
      tracked.fill(-1) // (a new body: the bends left are found by their sizes)
      done.push([g, start, g.axis, inside, kHere])
      continue
    }
    const stayed: number = kernelCall(
      what,
      () => k.sheetmetal.unbend(work._brep, g.angle, g.radius, kHere, sheet, g.origin.toArray(), g.axis.toArray(), g.mid.toArray(), g.length, anchor),
      hint,
    )
    work._h.sound = 0 // changed in place: checked again below
    if (stayed === 0) throw new ModelingError(`${what}: the fixed face is not on either side of a bend; ${hint}`)
    // Where the bend's strip lies now: from the neutral fiber at the end that stayed, half the
    // allowance into the strip. Later unbends (farther from the fixed face) do not move it.
    const half = _radians(g.angle) / 2
    const binormal = g.axis.cross(g.mid)
    let end: Vector
    let into: Vector
    if (stayed < 0) {
      end = g.mid.mul(Math.cos(half)).sub(binormal.mul(Math.sin(half)))
      into = g.axis.cross(end)
    } else {
      end = g.mid.mul(Math.cos(half)).add(binormal.mul(Math.sin(half)))
      into = g.axis.cross(end).neg()
    }
    const allowance = _radians(g.angle) * nr
    const start = g.origin.add(end.mul(nr)).add(into.mul(allowance / 2))
    done.push([g, start, g.axis, end.neg(), kHere])
  }
  return _finish(work, anchor, done, thickness, expected, volume, kFactor, what, hint)
}

/** Area of a bend's strip in the flat (its neutral fiber's length times its length). */
function _strip(g: _BendGeom, nr: number): number {
  let inside = 0
  for (const f of g.inner) inside += f.area
  return (inside * nr) / g.radius
}

/** `part` sent through a deformation (deform.ts), with this module's hint on failure. */
function _deformed(part: Part, spec: _Spec, ratio: [number, number], what: string, hint: string): Part {
  try {
    return _run(new _Plan(part, spec, ratio), what, part) as Part
  } catch (e) {
    if (!(e instanceof ModelingError || e instanceof KernelError)) throw e
    throw new ModelingError(`${what}: unrolling a bend failed (${e.message}); ${hint}`)
  }
}

/** A 3 x 4 row-major matrix [rotation | translation]. */
function _rigid(rotation: readonly (readonly number[])[], translation: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < 3; i++) out.push(rotation[i][0], rotation[i][1], rotation[i][2], translation[i])
  return out
}

/** Rotation matrix (rows) and translation of the turn by `angle` radians about the line through
 * `origin` along `axis`. */
function _turn(origin: Vector, axis: Vector, angle: number): [number[][], number[]] {
  const m = Location.about(new Axis(origin, axis), _degrees(angle))._m
  return [
    [
      [m[0], m[1], m[2]],
      [m[4], m[5], m[6]],
      [m[8], m[9], m[10]],
    ],
    [m[3], m[7], m[11]],
  ]
}

/**
 * Unroll one bend with the unbend deformation: the end of the bend toward the fixed face stays
 * where it is, the strip unrolls at the neutral radius `nr`, and the sheet beyond the other end
 * (if any) moves with it rigidly. The faces go to these three pieces by where they lie (the bend's
 * sector and thickness) and by what they connect to (the fixed side). Returns the unrolled part,
 * its fixed face, and the bend line's start and inside normal.
 */
function _unrollBend(work: Part, g: _BendGeom, nr: number, anchor: number, ends: [Face[], Face[]], what: string, hint: string): [Part, number, Vector, Vector] {
  const half = _radians(g.angle) / 2
  const m = g.mid
  const z = g.axis
  const b = z.cross(m)
  const radial = (a: number) => m.mul(Math.cos(a)).add(b.mul(Math.sin(a)))
  const tangent = (a: number) => z.cross(radial(a))
  let fe: number
  if (ends[0].length && ends[1].length) {
    // the end toward the fixed face stays
    const dist = _faceDistances(work, anchor)
    const reach = (faces: Face[]) => {
      const ids: number[] = ext.face_indices(work._brep, faces.map((f) => f._f))
      return Math.min(...ids.map((i) => dist.get(i) ?? 1 << 30))
    }
    fe = reach(ends[0]) <= reach(ends[1]) ? -half : half
  } else if (ends[0].length || ends[1].length) {
    fe = ends[0].length ? -half : half
  } else {
    throw new ModelingError(`${what}: a bend has flat sheet on neither side, and the part has more than one bend; ${hint}`)
  }
  const ff = -fe
  const keep = new Face(work, anchor)
  const keepPoint = keep.interiorPoint()
  const keepNormal = keep.normalAt()
  // faces across the bend's ends (the sheet's side faces) are split there
  let shape: Part = work
  for (const a of [fe, ff]) shape = _imprint(shape, g.origin.toArray(), tangent(a).toArray()) as Part
  const faces = [...shape.faces()]
  const index: number[] = ext.face_indices(shape._brep, faces.map((f) => f._f))
  const foundFace = (part: Part): Face => {
    const cands = part.faces().filter((f) => f.geomType === 'plane' && f.normalAt().dot(keepNormal) > 1 - 1e-9)
    if (!cands.length) throw new ModelingError(`${what}: the fixed face got lost unrolling a bend; ${hint}`)
    return _minBy([...cands], (f) => f.distanceTo(keepPoint))
  }
  const startFace = foundFace(shape)
  const tol = _tol(shape)
  const piece: number[] = faces.map(() => -1)
  faces.forEach((f, n) => {
    const q = f.interiorPoint().sub(g.origin)
    const a = Math.atan2(q.dot(b), q.dot(m))
    const rho = Math.hypot(q.dot(m), q.dot(b))
    // the bend: within its sector and its thickness
    if (Math.abs(a) <= half + 1e-7 && g.radius - 10 * tol <= rho && rho <= g.radius + g.thickness + 10 * tol) piece[index[n]] = 1
  })
  // the fixed side: faces connected to the fixed face without crossing the bend
  const neighbors = new Map<number, number[]>()
  faces.forEach((f, n) => {
    neighbors.set(index[n], ext.face_indices(shape._brep, [...f.neighbors()].map((x) => x._f)))
  })
  const first: number = ext.face_indices(shape._brep, [startFace._f])[0]
  if (piece[first] === 1) throw new ModelingError(`${what}: the fixed face lies in a bend; ${hint}`)
  piece[first] = 0
  let queue = [first]
  while (queue.length) {
    const next: number[] = []
    for (const i of queue) {
      for (const j of neighbors.get(i) ?? []) {
        if (piece[j] === -1) {
          piece[j] = 0
          next.push(j)
        }
      }
    }
    queue = next
  }
  const pieces = piece.map((p) => (p === -1 ? 2 : p)) // beyond the bend
  // the strip: unbent about the bend's middle, then turned and moved so that its end at fe stays
  const [r1, t1] = _turn(g.origin, z, fe)
  const shift = b.mul(nr * fe).toArray()
  const strip = {
    kind: 'unbend',
    center: g.origin.toArray(),
    axis: z.toArray(),
    mid: m.toArray(),
    neutral: nr,
    matrix: _rigid(r1, [0, 1, 2].map((i) => t1[i] - (r1[i][0] * shift[0] + r1[i][1] * shift[1] + r1[i][2] * shift[2]))),
  }
  // beyond the other end: turned back by the angle between the ends, moved along the strip
  const [r2, t2] = _turn(g.origin, z, fe - ff)
  const along = tangent(fe)
    .mul(nr * (ff - fe))
    .toArray()
  const beyond = { kind: 'rigid', matrix: _rigid(r2, [0, 1, 2].map((i) => t2[i] + along[i])) }
  const spec: _Spec = { axis: null, tolerance: 1e-6, faces: pieces, pieces: [{ kind: 'identity' }, strip, beyond] }
  const ratio: [number, number] = [Math.min(1.0, nr / (g.radius + g.thickness)), Math.max(1.0, nr / g.radius)]
  const result = _deformed(shape, spec, ratio, what, hint)
  const kept = foundFace(result)._f
  // the bend line: from the neutral fiber at the end that stayed, half the strip into it
  const into = tangent(fe).mul(ff > fe ? 1.0 : -1.0)
  const start = g.origin.add(radial(fe).mul(nr)).add(into.mul((_radians(g.angle) * nr) / 2))
  return [result, kept, start, radial(fe).neg()]
}

/** The checks of an unfolded part: no bends left, a sound solid one sheet thick, the volume the
 * unbends give. */
function _finish(
  work: Part,
  anchor: number,
  done: [_BendGeom, Vector, Vector, Vector, number][],
  thicknessFound: number | null,
  expected: number,
  volume: number,
  kFactor: KFactor | undefined,
  what: string,
  hint: string,
): _Unfolded {
  let thickness = thicknessFound
  if (_findBends(work)[0].length) throw new ModelingError(`${what}: not every bend could be unfolded; ${hint}`)
  const problem = work._solidProblem()
  if (problem !== null) throw new ModelingError(`${what}: the unfolded part is not a valid solid (${problem}); ${hint}`)
  const baseFace = new Face(work, anchor)
  if (thickness === null) {
    thickness = _thicknessBehind(_planarFaces(work), baseFace.interiorPoint(), baseFace.normalAt(), _tol(work))
  }
  if (thickness !== null) {
    const pl = baseFace.plane
    const depth = work.moved(new Plane(pl.origin, null, pl.zDir).location.inverse()).bbox().size.z
    if (Math.abs(depth - thickness) > _tol(work)) {
      throw new ModelingError(
        `${what}: the unfolded part is ${_formatG(depth)} deep across the fixed face, the sheet is ${_formatG(thickness)} thick: some of it is not a bend (only pairs of coaxial cylinder faces one thickness apart unfold); ${hint}`,
      )
    }
  }
  if (!_volumeAgrees(work, expected, volume)) {
    throw new ModelingError(`${what}: the unfolded part has the volume ${_formatG(_volume(work), 9)}, expected ${_formatG(expected, 9)}; ${hint}`)
  }
  work._folds = [] // flat: no bends left
  return { part: work, base: baseFace, bends: done, thickness, kFactor: _commonK(done.map((d) => d[4]), kFactor) }
}

/** Split boundary edges into closed loops, each ordered head to tail. */
function _loops(edges: readonly Edge[], tol: number): Edge[][] {
  const rest = [...edges]
  const loops: Edge[][] = []
  while (rest.length) {
    const loop = [rest.shift() as Edge]
    while (!loop[loop.length - 1].end.isClose(loop[0].start, tol)) {
      let joined = false
      for (let i = 0; i < rest.length; i++) {
        const e = rest[i]
        if (e.start.isClose(loop[loop.length - 1].end, tol)) {
          loop.push(rest.splice(i, 1)[0])
          joined = true
          break
        }
        if (e.end.isClose(loop[loop.length - 1].end, tol)) {
          loop.push(rest.splice(i, 1)[0].reversed())
          joined = true
          break
        }
      }
      if (!joined) throw new ModelingError('flatPattern: the outline of the flat part is not closed')
    }
    loops.push(loop)
  }
  return loops
}

/** The cutting contour at z = 0: the edges that only one bottom face of the flat uses (the others
 * are the edges of the bend zones), joined into loops, collinear pieces merged. */
function _cutContour(laid: Part, tol: number): Sketch {
  const count = new Map<string, Edge[]>()
  for (const f of laid.faces()) {
    if (f.geomType === 'plane' && f.normalAt().z < -1 + 1e-9 && Math.abs(f.interiorPoint().z) <= tol) {
      for (const e of f.edges()) {
        const key = e._identity()
        let es = count.get(key)
        if (es === undefined) count.set(key, (es = []))
        es.push(e)
      }
    }
  }
  const boundary = [...count.values()].filter((es) => es.length === 1).map((es) => es[0])
  const wires = _loops(boundary, tol).map((loop) => _mergedLines(Wire._raw(loop)))
  return kernelCall('flatPattern', () => Sketch._fromWires(wires, Plane.XY), 'the outline of the flat part could not be made into a sketch')
}

/** Direction (in `plane`) of the longer side of the smallest rectangle around the flat part. */
function _longSide(flat: Part, plane: Plane): Vector {
  const pts: [number, number][] = []
  for (const e of flat.edges()) {
    const n = e.geomType === 'line' ? 1 : 8
    for (let i = 0; i <= n; i++) {
      const q = plane.toLocal(e.pointAt(i / n))
      pts.push([q.x, q.y])
    }
  }
  const hull = _convexHull(pts)
  let best: [number, [number, number]] | null = null
  for (let i = 0; i < hull.length; i++) {
    const next = hull[(i + 1) % hull.length]
    const ex = next[0] - hull[i][0]
    const ey = next[1] - hull[i][1]
    const length = Math.hypot(ex, ey)
    if (length < 1e-12) continue
    const u: [number, number] = [ex / length, ey / length]
    const v: [number, number] = [-u[1], u[0]]
    const pu = hull.map(([x, y]) => x * u[0] + y * u[1])
    const pv = hull.map(([x, y]) => x * v[0] + y * v[1])
    const w = Math.max(...pu) - Math.min(...pu)
    const h = Math.max(...pv) - Math.min(...pv)
    if (best === null || w * h < best[0] * (1 - 1e-9)) best = [w * h, w >= h - 1e-9 * Math.max(w, h) ? u : v]
  }
  let [ux, uy] = best !== null ? best[1] : [1.0, 0.0]
  if ((Math.abs(ux) >= Math.abs(uy) && ux < 0) || (Math.abs(uy) > Math.abs(ux) && uy < 0)) {
    ux = -ux
    uy = -uy
  }
  return plane.xDir.mul(ux).add(plane.yDir.mul(uy))
}

function _convexHull(points: readonly [number, number][]): [number, number][] {
  // the distinct points (Python's set of tuples), sorted
  const seen = new Set<string>()
  const pts: [number, number][] = []
  for (const p of points) {
    const key = `${p[0]},${p[1]}`
    if (!seen.has(key)) {
      seen.add(key)
      pts.push(p)
    }
  }
  pts.sort((p, q) => (p[0] !== q[0] ? (p[0] < q[0] ? -1 : 1) : p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0))
  if (pts.length <= 2) return pts

  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower: [number, number][] = []
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (const q of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Options of `unfold` and `flatPattern`. */
export interface UnfoldOptions {
  /** The K-factor of each bend (see `KFactor`); default: the one each bend was folded with, else `K_FACTOR`. */
  kFactor?: KFactor
  /** The planar face of the part that stays in place (default: the largest planar face). */
  fixed?: Face | null
}

/**
 * Unfold a sheet metal part: every bend becomes flat again.
 *
 * The face `fixed` (default: the largest planar face) stays where it is; the rest of the sheet
 * unfolds into its plane. With the K-factor the part was bent with, the result is the blank it
 * was bent from: by default each bend takes the K-factor `fold` or `flange` made it with (else
 * `K_FACTOR`, 0.44, as for an imported part). `kFactor` gives other ones: one number for every
 * bend, a function `(radius, thickness, angle) => k`, a mapping from inside radius to K-factor
 * (`{ 1: 0.33, 6: 0.45 }`), `[r / t, k]` pairs to interpolate (a shop's table), or `'din6935'`
 * (see `KFactor`). For the flat pattern on the XY plane, with outline and bend lines, use
 * `flatPattern`.
 *
 * Rolled parts (one bend, no flat sheet: a ring segment), bends at a free end of the sheet (a
 * curl) and bends over 180 degrees unroll at the neutral radius `radius + kFactor * thickness`; a
 * rolled part about the middle of its bend (`fixed` is refused there).
 */
export function unfold(part: Part, options: UnfoldOptions = {}): Part {
  _opts('unfold', options)
  const { kFactor = null, fixed = null } = options
  return _unfold(part, kFactor, fixed, 'unfold').part
}

/**
 * The flat pattern of a sheet metal part, laid on the XY plane (see `FlatPattern`).
 *
 * `kFactor` as for `unfold`: by default each bend's own (from `fold` and `flange`), else `K_FACTOR`.
 * The part is unfolded with `fixed` (default: the largest planar face) staying in place; that
 * face is the bottom of the flat (z = 0) and bends are "up" when the far side of the sheet folds
 * towards +Z. The longer side of the smallest rectangle around the blank runs along X, and the
 * bounding box starts at the origin.
 */
export function flatPattern(part: Part, options: UnfoldOptions = {}): FlatPattern {
  _opts('flatPattern', options)
  const { kFactor = null, fixed = null } = options
  const u = _unfold(part, kFactor, fixed, 'flatPattern')
  const flat = u.part
  const thickness = u.thickness
  const basePlane = u.base.plane
  const nBase = basePlane.zDir
  if (thickness === null) throw new ModelingError('flatPattern: the part is not a sheet (no face opposite the largest face)')
  const frame = new Plane(basePlane.origin, _longSide(flat, new Plane(basePlane.origin, null, nBase)), nBase.neg())
  const toXy = frame.location.inverse()
  let laid = flat.moved(toXy)
  const shift = new Location(laid.bbox().min.neg())
  laid = laid.moved(shift)
  const place = shift.mul(toXy)
  const t = Number(thickness)
  const outline = _cutContour(laid, _tol(laid))
  if (Math.abs(outline.area * t - _volume(laid)) > 1e-6 * _volume(laid)) {
    throw new ModelingError(
      `flatPattern: the outline encloses ${_formatG(outline.area, 9)}, the flat part is ${_formatG(_volume(laid) / t, 9)} in area; the part is not a flat sheet`,
    )
  }
  const patternBends: Bend[] = []
  for (const [g, start, direction, inside, kf] of u.bends) {
    const p0 = place.mul(start)
    const p1 = place.mul(start.add(direction.mul(g.length)))
    const up = place.rotateVector(inside).z > 0
    const line = Line(new Vector(p0.x, p0.y, 0.0), new Vector(p1.x, p1.y, 0.0))
    patternBends.push(new Bend(_r(g.angle), _r(g.radius), _r(t), kf, _r(g.length), null, line, up ? 'up' : 'down'))
  }
  return new FlatPattern(laid, outline, patternBends, _r(t), u.kFactor)
}
