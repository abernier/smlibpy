// Vectors, axes, planes and locations.
//
// These are plain value types: they never touch the kernel, are immutable and cheap to create.
// Angles are in degrees everywhere.

/** Geometric tolerance used for comparisons (model units). */
export const TOLERANCE = 1e-6

/** A point or direction: a Vector, or two or three numbers ([x, y] lies at z = 0). */
export type VectorLike = Vector | ArrayLike<number>

const inspect = Symbol.for('nodejs.util.inspect.custom')

/** A 4x4 matrix, row by row (`m[r * 4 + c]`), column-vector convention. */
export type Matrix = Float64Array

/**
 * An immutable 3D vector or point.
 *
 * `new Vector(1, 2)`, `new Vector(1, 2, 3)`, `new Vector([1, 2, 3])` and `new Vector(other)` are
 * all accepted. Vectors have `add`, `sub`, `mul` (by a number), `div`, `neg`, `length` and
 * iterate over their coordinates.
 */
export class Vector {
  readonly x: number
  readonly y: number
  readonly z: number

  constructor(x?: number | VectorLike, y?: number, z?: number) {
    let cx: number, cy: number, cz: number
    if (x === undefined) {
      cx = cy = cz = 0
    } else if (typeof x === 'number') {
      cx = x
      cy = y ?? 0
      cz = z ?? 0
      if (y === undefined) throw new RangeError('Vector takes two or three coordinates')
    } else if (x instanceof Vector) {
      cx = x.x
      cy = x.y
      cz = x.z
    } else {
      const n = x.length
      if (n !== 2 && n !== 3) throw new RangeError(`expected 2 or 3 coordinates, got ${n}`)
      cx = x[0]
      cy = x[1]
      cz = n === 3 ? x[2] : 0
    }
    this.x = Number(cx)
    this.y = Number(cy)
    this.z = Number(cz)
  }

  // -- access -------------------------------------------------------------------------------
  /** `[x, y, z]` */
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z]
  }

  *[Symbol.iterator](): IterableIterator<number> {
    yield this.x
    yield this.y
    yield this.z
  }

  // -- arithmetic ---------------------------------------------------------------------------
  add(other: VectorLike): Vector {
    const o = _vec(other)
    return new Vector(this.x + o.x, this.y + o.y, this.z + o.z)
  }

  sub(other: VectorLike): Vector {
    const o = _vec(other)
    return new Vector(this.x - o.x, this.y - o.y, this.z - o.z)
  }

  /** This vector scaled by a number (`dot` and `cross` multiply two vectors). */
  mul(s: number): Vector {
    if (typeof s !== 'number') throw new TypeError('use .dot() or .cross() to multiply two vectors')
    return new Vector(this.x * s, this.y * s, this.z * s)
  }

  div(s: number): Vector {
    return new Vector(this.x / s, this.y / s, this.z / s)
  }

  neg(): Vector {
    return new Vector(-this.x, -this.y, -this.z)
  }

  /** Equal within TOLERANCE. */
  equals(other: unknown): boolean {
    let o: Vector
    try {
      o = _vec(other as VectorLike)
    } catch {
      return false
    }
    return this.isClose(o)
  }

  /** A key equal for vectors equal to 6 decimals (for maps and sets). */
  _key(): string {
    return `${_round6(this.x)},${_round6(this.y)},${_round6(this.z)}`
  }

  toString(): string {
    return `Vector(${_fmt(this.x)}, ${_fmt(this.y)}, ${_fmt(this.z)})`
  }

  [inspect](): string {
    return this.toString()
  }

  // -- vector algebra -----------------------------------------------------------------------
  get length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
  }

  dot(other: VectorLike): number {
    const o = _vec(other)
    return this.x * o.x + this.y * o.y + this.z * o.z
  }

  cross(other: VectorLike): Vector {
    const o = _vec(other)
    return new Vector(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x)
  }

  normalized(): Vector {
    const n = this.length
    if (n < 1e-300) throw new RangeError('cannot normalize a zero-length vector')
    return this.div(n)
  }

  distanceTo(other: VectorLike): number {
    return this.sub(other).length
  }

  /** Angle to another vector in degrees (0..180). */
  angleTo(other: VectorLike): number {
    const o = _vec(other)
    const d = this.length * o.length
    if (d < 1e-300) throw new RangeError('angle with a zero-length vector')
    const c = Math.max(-1, Math.min(1, this.dot(o) / d))
    return _degrees(Math.acos(c))
  }

  isClose(other: VectorLike, tol: number = TOLERANCE): boolean {
    return this.sub(other).length <= tol
  }

  /** True if both vectors point along the same line (either sense). */
  isParallel(other: VectorLike, angleTol = 1e-4): boolean {
    const a = this.angleTo(other)
    return a <= angleTol || a >= 180 - angleTol
  }

  isPerpendicular(other: VectorLike, angleTol = 1e-4): boolean {
    return Math.abs(this.angleTo(other) - 90) <= angleTol
  }

  /** Rotate this point about an axis (through the origin for a plain vector). */
  rotate(axis: Axis | VectorLike, angle: number): Vector {
    const ax = axis instanceof Axis ? axis : new Axis([0, 0, 0], axis)
    return Location.about(ax, angle).mul(this)
  }

  /** Orthogonal projection of this point onto a plane. */
  projectTo(plane: Plane): Vector {
    const d = this.sub(plane.origin).dot(plane.zDir)
    return this.sub(plane.zDir.mul(d))
  }

  /** A unit vector perpendicular to this one. */
  anyPerpendicular(): Vector {
    const v = this.normalized()
    const helper = Math.abs(v.x) < 0.9 ? new Vector(1, 0, 0) : new Vector(0, 1, 0)
    return v.cross(helper).normalized()
  }
}

// -------------------------------------------------------------------------------- formatting
// Python's "{:.6g}": six significant digits, trailing zeros dropped, exponent form outside
// 1e-4 .. 1e6.
export function _formatG(v: number, precision = 6): string {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  if (v === 0) return Object.is(v, -0) ? '-0' : '0'
  const [mantissa, exponent] = v.toExponential(precision - 1).split('e')
  const e = Number(exponent)
  if (e < -4 || e >= precision) {
    const m = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa
    const sign = e < 0 ? '-' : '+'
    return `${m}e${sign}${String(Math.abs(e)).padStart(2, '0')}`
  }
  let s = v.toFixed(Math.max(0, precision - 1 - e))
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  return s
}

// Python's "{:.Ne}": N digits after the point, the exponent with a sign and two digits at least.
export function _formatE(v: number, digits: number): string {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  const [mantissa, exponent] = v.toExponential(digits).split('e')
  const e = Number(exponent)
  return `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
}

export function _fmt(v: number): string {
  if (Math.abs(v) < 5e-13) v = 0
  return _formatG(v, 6)
}

export function _fmtF(v: number): number {
  return Number(_fmt(v))
}

function _round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return r === 0 ? 0 : r
}

export function _degrees(rad: number): number {
  return (rad * 180) / Math.PI
}

export function _radians(deg: number): number {
  return (deg * Math.PI) / 180
}

export function _vec(v: VectorLike): Vector {
  return v instanceof Vector ? v : new Vector(v)
}

/** A point given as `[x, y]` or `[x, y, z]` numbers (not a shape, not a list of points). */
export function _isPointLike(v: unknown): v is VectorLike {
  if (v instanceof Vector) return true
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = v as ArrayLike<unknown>
    if (a.length !== 2 && a.length !== 3) return false
    for (let i = 0; i < a.length; i++) if (typeof a[i] !== 'number') return false
    return true
  }
  return false
}

// -------------------------------------------------------------------------------- Axis
/**
 * An infinite line through `origin` along `direction`.
 *
 * `Axis.X`, `Axis.Y` and `Axis.Z` (also exported as `X`, `Y`, `Z`) are the world axes. Axes are
 * used to rotate, revolve, mirror, and to sort or filter shapes.
 */
export class Axis {
  static X: Axis
  static Y: Axis
  static Z: Axis

  readonly origin: Vector
  readonly direction: Vector

  constructor(origin: VectorLike = [0, 0, 0], direction: VectorLike = [0, 0, 1]) {
    this.origin = _vec(origin)
    this.direction = _vec(direction).normalized()
  }

  neg(): Axis {
    return this.reversed()
  }

  reversed(): Axis {
    return new Axis(this.origin, this.direction.neg())
  }

  moved(loc: Location): Axis {
    return new Axis(loc.mul(this.origin), loc.rotateVector(this.direction))
  }

  /** The same direction through another point. */
  at(origin: VectorLike): Axis {
    return new Axis(origin, this.direction)
  }

  isParallel(other: Axis | VectorLike, angleTol = 1e-4): boolean {
    const d = other instanceof Axis ? other.direction : _vec(other)
    return this.direction.isParallel(d, angleTol)
  }

  distanceTo(point: VectorLike): number {
    const p = _vec(point).sub(this.origin)
    return p.sub(this.direction.mul(p.dot(this.direction))).length
  }

  project(point: VectorLike): Vector {
    const p = _vec(point)
    return this.origin.add(this.direction.mul(p.sub(this.origin).dot(this.direction)))
  }

  /** Signed coordinate of `point` along this axis. */
  positionAlong(point: VectorLike): number {
    return _vec(point).sub(this.origin).dot(this.direction)
  }

  equals(other: unknown): boolean {
    if (!(other instanceof Axis)) return false
    return this.direction.isClose(other.direction) && other.distanceTo(this.origin) < TOLERANCE
  }

  toString(): string {
    const names: [VectorLike, string][] = [[[1, 0, 0], 'X'], [[0, 1, 0], 'Y'], [[0, 0, 1], 'Z']]
    if (this.origin.isClose([0, 0, 0])) {
      for (const [t, n] of names) if (this.direction.isClose(t)) return `Axis.${n}`
    }
    const o = this.origin.toArray().map(_fmt).join(', ')
    const d = this.direction.toArray().map(_fmt).join(', ')
    return `Axis(origin=(${o}), direction=(${d}))`
  }

  [inspect](): string {
    return this.toString()
  }
}

Axis.X = new Axis([0, 0, 0], [1, 0, 0])
Axis.Y = new Axis([0, 0, 0], [0, 1, 0])
Axis.Z = new Axis([0, 0, 0], [0, 0, 1])
export const X = Axis.X
export const Y = Axis.Y
export const Z = Axis.Z

/** The unit vector of a direction given as an axis (its direction) or as a vector. */
export function _direction(direction: Axis | VectorLike, what: string): Vector {
  const d = direction instanceof Axis ? direction.direction : _vec(direction)
  if (!(d.length > 0) || ![d.x, d.y, d.z].every(Number.isFinite)) throw new RangeError(`${what}: the direction must not be zero`)
  return d.normalized()
}

// -------------------------------------------------------------------------------- matrices
export function _identity(): Matrix {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function _matmul(a: Matrix, b: Matrix): Matrix {
  const m = new Float64Array(16)
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]
      m[r * 4 + c] = s
    }
  return m
}

/** The point `p` moved by the matrix (rotation and translation). */
export function _apply(m: Matrix, p: Vector): Vector {
  return new Vector(
    m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
    m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
    m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
  )
}

/** The direction `v` turned by the matrix (no translation). */
export function _applyVector(m: Matrix, v: Vector): Vector {
  return new Vector(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[4] * v.x + m[5] * v.y + m[6] * v.z,
    m[8] * v.x + m[9] * v.y + m[10] * v.z,
  )
}

/** The 3x3 rotation of `angle` degrees about `axis`, row by row. */
function _rotAxis(axis: Vector, angle: number): number[] {
  const a = _radians(angle)
  const { x, y, z } = axis.normalized()
  const c = Math.cos(a)
  const s = Math.sin(a)
  const C = 1 - c
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ]
}

function _mul3(a: number[], b: number[]): number[] {
  const m = new Array<number>(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return m
}

function _rotXYZ(rx: number, ry: number, rz: number): number[] {
  return _mul3(_mul3(_rotAxis(new Vector(0, 0, 1), rz), _rotAxis(new Vector(0, 1, 0), ry)), _rotAxis(new Vector(1, 0, 0), rx))
}

function _setRotation(m: Matrix, r: number[]): void {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 4 + j] = r[i * 3 + j]
}

function _setColumn(m: Matrix, c: number, v: Vector): void {
  m[c] = v.x
  m[4 + c] = v.y
  m[8 + c] = v.z
}

function _isMatrix(v: unknown): v is Matrix | number[][] {
  if (v instanceof Float64Array) return v.length === 16
  return Array.isArray(v) && v.length === 4 && v.every((row) => Array.isArray(row) && row.length === 4)
}

// -------------------------------------------------------------------------------- Location
/** Anything with a `moved(location)`: shapes, lists of shapes, patterns. */
export interface Movable<T> {
  moved(location: Location): T
}

/**
 * A rigid placement (rotation + translation), stored as a 4x4 matrix.
 *
 * Build them with `Pos` and `Rot` and combine with `mul`. Applying a location to a shape moves
 * the shape: `Pos(10, 0, 0).mul(Rot(0, 0, 45)).mul(Box(1, 1, 1))` first rotates the box about the
 * world Z axis, then moves it 10 along X.
 */
export class Location {
  readonly _m: Matrix

  constructor(position?: VectorLike | Plane | Location | Matrix | number[][] | null, rotation?: VectorLike | null) {
    if (position instanceof Location) {
      this._m = position._m
      return
    }
    if (position instanceof Plane) {
      this._m = position.location._m
      return
    }
    let m: Matrix
    if (_isMatrix(position)) {
      m = position instanceof Float64Array ? Float64Array.from(position) : Float64Array.from(position.flat())
    } else {
      m = _identity()
      if (rotation != null) {
        const r = _vec(rotation)
        _setRotation(m, _rotXYZ(r.x, r.y, r.z))
      }
      if (position != null) _setColumn(m, 3, _vec(position as VectorLike))
    }
    this._m = m
  }

  /** Rotation by `angle` degrees about an arbitrary axis. */
  static about(axis: Axis, angle: number): Location {
    const r = _rotAxis(axis.direction, angle)
    const m = _identity()
    _setRotation(m, r)
    const o = axis.origin
    _setColumn(m, 3, o.sub(new Vector(r[0] * o.x + r[1] * o.y + r[2] * o.z, r[3] * o.x + r[4] * o.y + r[5] * o.z, r[6] * o.x + r[7] * o.y + r[8] * o.z)))
    return new Location(m)
  }

  // -- properties ---------------------------------------------------------------------------
  /** The 4x4 homogeneous matrix (column-vector convention), row by row. */
  get matrix(): number[][] {
    const m = this._m
    return [0, 1, 2, 3].map((r) => [m[r * 4], m[r * 4 + 1], m[r * 4 + 2], m[r * 4 + 3]])
  }

  get position(): Vector {
    return new Vector(this._m[3], this._m[7], this._m[11])
  }

  /** Rotation as X, Y, Z angles in degrees (applied in that order about world axes). */
  get rotation(): Vector {
    const m = this._m
    const r = (i: number, j: number) => m[i * 4 + j]
    const sy = Math.max(-1, Math.min(1, -r(2, 0)))
    const y = Math.asin(sy)
    let x: number
    let z: number
    if (Math.abs(sy) < 1 - 1e-12) {
      x = Math.atan2(r(2, 1), r(2, 2))
      z = Math.atan2(r(1, 0), r(0, 0))
    } else {
      // gimbal lock
      x = Math.atan2(-r(1, 2), r(1, 1))
      z = 0
    }
    return new Vector(_degrees(x), _degrees(y), _degrees(z))
  }

  get xDir(): Vector {
    return new Vector(this._m[0], this._m[4], this._m[8])
  }

  get yDir(): Vector {
    return new Vector(this._m[1], this._m[5], this._m[9])
  }

  get zDir(): Vector {
    return new Vector(this._m[2], this._m[6], this._m[10])
  }

  /** The XY plane moved by this location. */
  get plane(): Plane {
    return new Plane(this.position, this.xDir, this.zDir)
  }

  inverse(): Location {
    const a = this._m
    const m = _identity()
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 4 + j] = a[j * 4 + i]
    const t = new Vector(a[3], a[7], a[11])
    _setColumn(m, 3, _applyVector(m, t).neg())
    return new Location(m)
  }

  rotateVector(v: VectorLike): Vector {
    return _applyVector(this._m, _vec(v))
  }

  // -- composition --------------------------------------------------------------------------
  /**
   * This location applied to something: another location (composed), a point (moved), an axis,
   * a plane, a shape or a list of them (moved; a pattern or a selection keeps its type).
   */
  mul(other: Location): Location
  mul(other: VectorLike): Vector
  mul(other: Axis): Axis
  mul(other: Plane): Plane
  mul<T>(other: Movable<T>): T
  mul<T>(other: readonly T[]): unknown[]
  mul(other: unknown): unknown {
    if (other instanceof Location) return new Location(_matmul(this._m, other._m))
    if (_isPointLike(other)) return _apply(this._m, _vec(other))
    if (other instanceof Axis || other instanceof Plane) return other.moved(this)
    const moved = (other as Partial<Movable<unknown>> | null)?.moved
    if (typeof moved === 'function') return moved.call(other, this)
    if (Array.isArray(other)) return other.map((o) => this.mul(o))
    throw new TypeError(`cannot apply a Location to ${String(other)}`)
  }

  equals(other: unknown): boolean {
    if (!(other instanceof Location)) return false
    for (let i = 0; i < 16; i++) if (Math.abs(this._m[i] - other._m[i]) > TOLERANCE + 1e-5 * Math.abs(other._m[i])) return false
    return true
  }

  toString(): string {
    const p = this.position
    const r = this.rotation
    if (r.isClose([0, 0, 0])) return `Pos(${_fmt(p.x)}, ${_fmt(p.y)}, ${_fmt(p.z)})`
    return `Location(position=(${_fmt(p.x)}, ${_fmt(p.y)}, ${_fmt(p.z)}), rotation=(${_fmt(r.x)}, ${_fmt(r.y)}, ${_fmt(r.z)}))`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** Coordinates by name, for `Pos({ z: 5 })` and `Rot({ z: 45 })`. */
export interface XYZ {
  x?: number
  y?: number
  z?: number
}

function _xyz(x: number | VectorLike | XYZ, y: number, z: number): [number, number, number] {
  if (typeof x === 'number') return [x, y, z]
  if (x instanceof Vector || Array.isArray(x) || ArrayBuffer.isView(x)) return _vec(x as VectorLike).toArray()
  const o = x as XYZ
  return [o.x ?? 0, o.y ?? 0, o.z ?? 0]
}

/** A translation. `Pos(10, 0, 5)`, `Pos([10, 0, 5])`, `Pos(vector)` or `Pos({ z: 5 })`. */
export function Pos(x: number | VectorLike | XYZ = 0, y = 0, z = 0): Location {
  return new Location(_xyz(x, y, z))
}

/** A rotation in degrees about the world X, then Y, then Z axis: `Rot(0, 0, 45)` or `Rot({ z: 45 })`. */
export function Rot(x: number | VectorLike | XYZ = 0, y = 0, z = 0): Location {
  return new Location(null, _xyz(x, y, z))
}

// -------------------------------------------------------------------------------- Plane
/** What a planar face gives: its plane (see Face). */
interface HasFacePlane {
  _planeOfFace(): Plane
}

/**
 * A coordinate system: an origin, an x direction and a normal (`zDir`).
 *
 * Planes are where sketches live and where parts are placed. Named planes: `Plane.XY`
 * (= `Plane.top`), `Plane.XZ` (= `Plane.front`), `Plane.YZ` (= `Plane.right`), plus `back`, `left`
 * and `bottom`. Their local Y axis points up (world +Z) for the side views, so a sketch drawn
 * "upwards" stands up on the front plane.
 *
 * A planar Face converts to a plane at its center with its outward normal: `new Plane(face)` or
 * `face.plane`.
 */
export class Plane {
  static XY: Plane
  static YZ: Plane
  static ZX: Plane
  static XZ: Plane
  static YX: Plane
  static ZY: Plane
  static top: Plane
  static bottom: Plane
  static front: Plane
  static back: Plane
  static left: Plane
  static right: Plane

  readonly origin: Vector
  readonly xDir: Vector
  readonly yDir: Vector
  /** The plane normal. */
  readonly zDir: Vector

  constructor(origin: VectorLike | Plane | Location | HasFacePlane = [0, 0, 0], xDir?: VectorLike | null, zDir: VectorLike = [0, 0, 1]) {
    let p: Plane | null = null
    if (origin instanceof Plane) p = origin
    else if (origin instanceof Location) p = origin.plane
    else if (typeof (origin as Partial<HasFacePlane>)._planeOfFace === 'function') p = (origin as HasFacePlane)._planeOfFace()
    if (p) {
      this.origin = p.origin
      this.xDir = p.xDir
      this.yDir = p.yDir
      this.zDir = p.zDir
      return
    }
    const z = _vec(zDir).normalized()
    let x: Vector
    if (xDir == null) {
      x = _defaultXDir(z)
    } else {
      x = _vec(xDir)
      x = x.sub(z.mul(x.dot(z)))
      if (x.length < 1e-12) throw new RangeError('xDir is parallel to the plane normal')
      x = x.normalized()
    }
    this.origin = _vec(origin as VectorLike)
    this.xDir = x
    this.zDir = z
    this.yDir = z.cross(x)
  }

  /** The plane normal (`zDir`). */
  get normal(): Vector {
    return this.zDir
  }

  /** The location that maps the world XY plane onto this plane. */
  get location(): Location {
    const m = _identity()
    _setColumn(m, 0, this.xDir)
    _setColumn(m, 1, this.yDir)
    _setColumn(m, 2, this.zDir)
    _setColumn(m, 3, this.origin)
    return new Location(m)
  }

  // -- derived planes -----------------------------------------------------------------------
  /** This plane moved `distance` along its normal. */
  offset(distance: number): Plane {
    return new Plane(this.origin.add(this.zDir.mul(distance)), this.xDir, this.zDir)
  }

  /** This plane moved within its own coordinates. */
  shifted(x = 0, y = 0, z = 0): Plane {
    return new Plane(this.fromLocal([x, y, z]), this.xDir, this.zDir)
  }

  /** The same plane seen from the other side (normal reversed, x kept). */
  flipped(): Plane {
    return new Plane(this.origin, this.xDir, this.zDir.neg())
  }

  /** Rotate about the plane's own X, then Y, then Z axis (degrees). */
  rotated(x: number | XYZ = 0, y = 0, z = 0): Plane {
    return new Plane(this.location.mul(Rot(x, y, z)))
  }

  moved(loc: Location): Plane {
    return new Plane(loc.mul(this.origin), loc.rotateVector(this.xDir), loc.rotateVector(this.zDir))
  }

  /** The same orientation through another origin. */
  at(origin: VectorLike): Plane {
    return new Plane(origin, this.xDir, this.zDir)
  }

  // -- coordinates --------------------------------------------------------------------------
  toLocal(point: VectorLike): Vector {
    const d = _vec(point).sub(this.origin)
    return new Vector(d.dot(this.xDir), d.dot(this.yDir), d.dot(this.zDir))
  }

  fromLocal(point: VectorLike): Vector {
    const p = _vec(point)
    return this.origin.add(this.xDir.mul(p.x)).add(this.yDir.mul(p.y)).add(this.zDir.mul(p.z))
  }

  contains(point: VectorLike, tol: number = TOLERANCE): boolean {
    return Math.abs(this.toLocal(point).z) <= tol
  }

  /** Signed distance of a point above the plane. */
  distanceTo(point: VectorLike): number {
    return this.toLocal(point).z
  }

  project(point: VectorLike): Vector {
    return _vec(point).projectTo(this)
  }

  isCoplanar(other: Plane, tol: number = TOLERANCE): boolean {
    return this.zDir.isParallel(other.zDir) && Math.abs(this.distanceTo(other.origin)) <= tol
  }

  // -- placement ----------------------------------------------------------------------------
  /**
   * `plane.mul(shape)` places a shape (usually a sketch drawn on XY) onto this plane;
   * `plane.mul(location)` gives the plane's location composed with the location.
   */
  mul(other: Location): Location
  mul(other: VectorLike): Vector
  mul<T>(other: Movable<T>): T
  mul(other: unknown): unknown {
    return (this.location.mul as (o: unknown) => unknown)(other)
  }

  equals(other: unknown): boolean {
    if (!(other instanceof Plane)) return false
    return this.origin.isClose(other.origin) && this.xDir.isClose(other.xDir) && this.zDir.isClose(other.zDir)
  }

  toString(): string {
    const named = ['XY', 'XZ', 'YZ', 'ZX', 'YX', 'ZY', 'back', 'left', 'bottom'] as const
    for (const name of named) if (this.equals(Plane[name])) return `Plane.${name}`
    const f = (v: Vector) => `(${_fmt(v.x)}, ${_fmt(v.y)}, ${_fmt(v.z)})`
    return `Plane(origin=${f(this.origin)}, xDir=${f(this.xDir)}, zDir=${f(this.zDir)})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/**
 * The x direction a plane gets when none is given.
 *
 * Vertical planes keep their local Y pointing up (world +Z), so sketches placed on side faces
 * stand upright. Other planes take the projection of world X (world Y when the normal is close
 * to X).
 */
export function _defaultXDir(z: Vector): Vector {
  if (Math.abs(z.z) < 1e-9) return new Vector(0, 0, 1).cross(z).normalized()
  const ref = Math.abs(z.x) < 0.999 ? new Vector(1, 0, 0) : new Vector(0, 1, 0)
  return ref.sub(z.mul(ref.dot(z))).normalized()
}

Plane.XY = new Plane([0, 0, 0], [1, 0, 0], [0, 0, 1])
Plane.YZ = new Plane([0, 0, 0], [0, 1, 0], [1, 0, 0])
Plane.ZX = new Plane([0, 0, 0], [0, 0, 1], [0, 1, 0])
Plane.XZ = new Plane([0, 0, 0], [1, 0, 0], [0, -1, 0])
Plane.YX = new Plane([0, 0, 0], [0, 1, 0], [0, 0, -1])
Plane.ZY = new Plane([0, 0, 0], [0, 0, 1], [-1, 0, 0])
Plane.top = Plane.XY
Plane.bottom = new Plane([0, 0, 0], [1, 0, 0], [0, 0, -1])
Plane.front = Plane.XZ
Plane.back = new Plane([0, 0, 0], [-1, 0, 0], [0, 1, 0])
Plane.right = Plane.YZ
Plane.left = new Plane([0, 0, 0], [0, -1, 0], [-1, 0, 0])

// -------------------------------------------------------------------------------- BoundBox
/** An axis-aligned bounding box. */
export class BoundBox {
  min: Vector
  max: Vector

  constructor(min: VectorLike, max: VectorLike) {
    this.min = _vec(min)
    this.max = _vec(max)
  }

  static ofPoints(points: Iterable<VectorLike>): BoundBox {
    let lo = [Infinity, Infinity, Infinity]
    let hi = [-Infinity, -Infinity, -Infinity]
    let n = 0
    for (const p of points) {
      const v = _vec(p)
      lo = [Math.min(lo[0], v.x), Math.min(lo[1], v.y), Math.min(lo[2], v.z)]
      hi = [Math.max(hi[0], v.x), Math.max(hi[1], v.y), Math.max(hi[2], v.z)]
      n++
    }
    if (n === 0) throw new RangeError('a bounding box of no points')
    return new BoundBox(lo, hi)
  }

  get size(): Vector {
    return this.max.sub(this.min)
  }

  get center(): Vector {
    return this.min.add(this.max).mul(0.5)
  }

  get diagonal(): number {
    return this.size.length
  }

  union(other: BoundBox): BoundBox {
    return new BoundBox(
      [Math.min(this.min.x, other.min.x), Math.min(this.min.y, other.min.y), Math.min(this.min.z, other.min.z)],
      [Math.max(this.max.x, other.max.x), Math.max(this.max.y, other.max.y), Math.max(this.max.z, other.max.z)],
    )
  }

  contains(point: VectorLike, tol: number = TOLERANCE): boolean {
    const p = _vec(point)
    const lo = this.min
    const hi = this.max
    return lo.x - tol <= p.x && p.x <= hi.x + tol && lo.y - tol <= p.y && p.y <= hi.y + tol && lo.z - tol <= p.z && p.z <= hi.z + tol
  }

  *[Symbol.iterator](): IterableIterator<Vector> {
    yield this.min
    yield this.max
  }

  toString(): string {
    const f = (v: Vector) => `(${v.toArray().map(_fmt).join(', ')})`
    return `BoundBox(min=${f(this.min)}, max=${f(this.max)})`
  }

  [inspect](): string {
    return this.toString()
  }
}
