// Exact planar geometry: lines and circular arcs in the local coordinates of a sketch plane.
//
// Points and directions are complex numbers (`Complex`, Python's `complex`: x + yi). Everything
// here is plain TypeScript and exact up to floating point: lines stay lines and arcs stay
// circles. The pen (Profile), corner fillets and chamfers, offsets, strokes, hulls and mirrors of
// sketches are built from these pieces and hand exact lines and circles to the kernel (see
// _regions.ts).
//
// Conventions: a loop is a list of segments, each starting where the previous one ends. A closed
// loop that bounds a region runs counterclockwise around it (the region on the left); holes run
// clockwise. Offsets are positive to the left of the direction of travel.
//
// The arithmetic is Python's own (CPython 3.12): complex products and quotients, a real number
// combined with a complex one as the complex (x, 0), float modulo with the sign of the divisor,
// round half to even, `sum` with Neumaier's compensation, `math.degrees`/`radians`. So the
// results follow smlibpy's to the last bit wherever the platform's sqrt, sin, cos and atan2 agree.

export const TAU = 2.0 * Math.PI
/** Turns smaller than this (the sine of the angle between two tangents) count as smooth. */
export const SMOOTH = 1e-9

/** A planar construction that cannot be made. The message names what does not fit. */
export class GeometryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeometryError'
  }
}

/** A direct construction (offset, stroke) that does not resolve locally; the caller falls back
 * to the construction from pieces and Booleans. */
export class NeedBooleans extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NeedBooleans'
  }
}

// =============================================================================== Python numbers
const DEG_TO_RAD = Math.PI / 180.0
const RAD_TO_DEG = 180.0 / Math.PI

/** Python's `math.radians`. */
export function radians(d: number): number {
  return d * DEG_TO_RAD
}

/** Python's `math.degrees`. */
export function degrees(r: number): number {
  return r * RAD_TO_DEG
}

/** Python's float modulo `a % b`: the result has the sign of the divisor. */
export function pymod(a: number, b: number): number {
  const m = a % b
  if (m !== 0) return m < 0 !== b < 0 ? m + b : m
  return b < 0 ? -0 : 0
}

/** Python's integer modulo for an index (`i % n`, never negative for n > 0). */
export function imod(i: number, n: number): number {
  return ((i % n) + n) % n
}

/** Python's `round(x)`: to the nearest integer, a tie to the even one. */
export function pyround(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** Python's `sum()` of floats (CPython 3.12: Neumaier's compensated summation). */
export function pysum(values: Iterable<number>): number {
  let first = true
  let s = 0
  let c = 0
  for (const x of values) {
    if (first) {
      s = 0 + x
      first = false
      continue
    }
    const t = s + x
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x
    else c += x - t + s
    s = t
  }
  if (c !== 0 && Number.isFinite(c)) s += c
  return s
}

/** The first item with the smallest key (Python's `min(items, key=...)`). */
export function minBy<T>(items: readonly T[], key: (item: T) => number): T {
  let best = items[0]
  let bestKey = key(best)
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i])
    if (k < bestKey) {
      best = items[i]
      bestKey = k
    }
  }
  return best
}

// =============================================================================== complex numbers
/**
 * A complex number `re + im i`: a point or a direction in the plane. Immutable; the operations
 * are CPython's (a real operand counts as `(x, 0)`, as Python 3.12 has it).
 */
export class Complex {
  readonly re: number
  readonly im: number

  constructor(re: number, im: number) {
    this.re = re
    this.im = im
  }

  /** `this + b` */
  add(b: Complex): Complex {
    return new Complex(this.re + b.re, this.im + b.im)
  }

  /** `this - b` */
  sub(b: Complex): Complex {
    return new Complex(this.re - b.re, this.im - b.im)
  }

  /** `this * b` */
  mul(b: Complex): Complex {
    return new Complex(this.re * b.re - this.im * b.im, this.re * b.im + this.im * b.re)
  }

  /** `this * f` (and `f * this`) for a real `f`. */
  scale(f: number): Complex {
    return new Complex(this.re * f - this.im * 0, this.re * 0 + this.im * f)
  }

  /** `this / b` (CPython's quotient, Smith's method). */
  div(b: Complex): Complex {
    const ar = Math.abs(b.re)
    const ai = Math.abs(b.im)
    if (ar >= ai) {
      if (ar === 0) throw new RangeError('complex division by zero')
      const ratio = b.im / b.re
      const denom = b.re + b.im * ratio
      return new Complex((this.re + this.im * ratio) / denom, (this.im - this.re * ratio) / denom)
    }
    if (ai >= ar) {
      const ratio = b.re / b.im
      const denom = b.re * ratio + b.im
      return new Complex((this.re * ratio + this.im) / denom, (this.im * ratio - this.re) / denom)
    }
    return new Complex(Number.NaN, Number.NaN)
  }

  /** `this / f` for a real `f`. */
  divs(f: number): Complex {
    if (f === 0) throw new RangeError('complex division by zero')
    const ratio = 0 / f
    const denom = f + 0 * ratio
    return new Complex((this.re + this.im * ratio) / denom, (this.im - this.re * ratio) / denom)
  }

  /** `-this` */
  neg(): Complex {
    return new Complex(-this.re, -this.im)
  }

  /** `this.conjugate()` */
  conj(): Complex {
    return new Complex(this.re, -this.im)
  }

  /** `abs(this)`: the length. */
  abs(): number {
    const s = this.re * this.re + this.im * this.im
    return s > 1e-280 && s < 1e280 ? Math.sqrt(s) : Math.hypot(this.re, this.im)
  }

  /** `cmath.phase(this)`: the angle from +X, -pi to pi. */
  phase(): number {
    return Math.atan2(this.im, this.re)
  }

  /** `this == b` */
  equals(b: Complex): boolean {
    return this.re === b.re && this.im === b.im
  }

  toString(): string {
    return `(${this.re}${this.im < 0 || Object.is(this.im, -0) ? '-' : '+'}${Math.abs(this.im)}j)`
  }
}

/** `complex(re, im)` */
export function cx(re: number, im = 0.0): Complex {
  return new Complex(re, im)
}

/** `0j` */
export const ZERO = new Complex(0.0, 0.0)
/** `1 + 0j` */
export const ONE = new Complex(1.0, 0.0)
/** `1j` */
export const J = new Complex(0.0, 1.0)
/** `-1j` */
export const NEG_J = new Complex(-0.0, -1.0)

// =============================================================================== small helpers
export function cross(a: Complex, b: Complex): number {
  return a.re * b.im - a.im * b.re
}

export function dot(a: Complex, b: Complex): number {
  return a.re * b.re + a.im * b.im
}

export function unit(z: Complex): Complex {
  const n = z.abs()
  if (n === 0.0) throw new GeometryError('a direction of length zero')
  return z.divs(n)
}

export function cis(angle: number): Complex {
  return new Complex(Math.cos(angle), Math.sin(angle))
}

// Python's '{:.4f}': correctly rounded, an exact tie to the even digit (toFixed rounds a tie away
// from zero). A tie at 4 decimals is an odd multiple of 1/32.
function _fixed4(v: number): string {
  const t = v * 32
  if (Number.isInteger(t) && t % 2 !== 0 && Math.abs(v) < 2 ** 40) {
    const n = v * 10000 // exact: an odd multiple of 312.5
    let m = Math.floor(n)
    if (m % 2 !== 0) m += 1
    return (m / 10000).toFixed(4)
  }
  return v.toFixed(4)
}

/** A number for messages: up to 4 decimals, no trailing zeros. */
export function fmt(v: number): string {
  if (Math.abs(v) < 5e-5) return '0'
  const s = _fixed4(v).replace(/0+$/, '').replace(/\.+$/, '')
  return s === '-0' || s === '' ? '0' : s
}

export function fmtPt(p: Complex): string {
  return `(${fmt(p.re)}, ${fmt(p.im)})`
}

export function deg(a: number): string {
  return fmt(degrees(a))
}

/** `p` mirrored in the line through `o` whose direction squared is `u2`. */
export function reflect(p: Complex, o: Complex, u2: Complex): Complex {
  return o.add(u2.mul(p.sub(o).conj()))
}

// =============================================================================== segments
/** A line or arc in the plane (or another curve, `Curve2`, that is passed through). */
export abstract class Seg {
  abstract readonly kind: string
  abstract get start(): Complex
  abstract get end(): Complex
  abstract get length(): number
  /** Unit tangent at the start. */
  abstract get t0(): Complex
  /** Unit tangent at the end. */
  abstract get t1(): Complex

  abstract at(s: number): Complex

  /** Arc length from the start to the point of the carrier nearest `p` (negative before the
   * start, beyond `length` after the end). */
  position(_p: Complex): number {
    throw new Error(`${this.kind}: no position`)
  }

  piece(_s0: number, _s1: number): Seg {
    throw new Error(`${this.kind}: no piece`)
  }

  offset(_e: number): Seg | null {
    throw new GeometryError(`a ${this.kind} cannot be offset exactly`)
  }

  abstract reversed(): Seg

  reflected(_o: Complex, _u2: Complex): Seg {
    throw new Error(`${this.kind}: no reflection`)
  }

  moved(_rot: Complex, _shift: Complex): Seg {
    throw new Error(`${this.kind}: cannot be moved`)
  }

  abstract areaTerm(): number

  sample(n: number): Complex[] {
    const out: Complex[] = []
    for (let i = 0; i <= n; i++) out.push(this.at((this.length * i) / n))
    return out
  }
}

/** A straight segment from `a` to `b`. */
export class Line2 extends Seg {
  readonly kind = 'line'
  readonly a: Complex
  readonly b: Complex
  private _d: Complex | null = null

  constructor(a: Complex, b: Complex) {
    super()
    this.a = a
    this.b = b
  }

  get start(): Complex {
    return this.a
  }

  get end(): Complex {
    return this.b
  }

  get length(): number {
    return this.b.sub(this.a).abs()
  }

  get direction(): Complex {
    return (this._d ??= unit(this.b.sub(this.a)))
  }

  get t0(): Complex {
    return this.direction
  }

  get t1(): Complex {
    return this.direction
  }

  at(s: number): Complex {
    return this.a.add(this.direction.scale(s))
  }

  tangent(_s: number): Complex {
    return this.direction
  }

  override position(p: Complex): number {
    return dot(p.sub(this.a), this.direction)
  }

  override piece(s0: number, s1: number): Line2 {
    return new Line2(this.at(s0), this.at(s1))
  }

  override offset(e: number): Line2 {
    const n = J.mul(this.direction).scale(e)
    return new Line2(this.a.add(n), this.b.add(n))
  }

  reversed(): Line2 {
    return new Line2(this.b, this.a)
  }

  override reflected(o: Complex, u2: Complex): Line2 {
    return new Line2(reflect(this.a, o, u2), reflect(this.b, o, u2))
  }

  override moved(rot: Complex, shift: Complex): Line2 {
    return new Line2(this.a.mul(rot).add(shift), this.b.mul(rot).add(shift))
  }

  areaTerm(): number {
    return 0.5 * cross(this.a, this.b)
  }

  override sample(_n: number): Complex[] {
    return [this.a, this.b]
  }

  override toString(): string {
    return `Line2${fmtPt(this.a)}->${fmtPt(this.b)}`
  }
}

/** A circular arc around `c` of radius `r`, from the angle `a0` (radians) over `sweep` (signed:
 * positive counterclockwise). */
export class Arc2 extends Seg {
  readonly kind = 'arc'
  readonly c: Complex
  readonly r: number
  readonly a0: number
  readonly sweep: number
  private _start: Complex | null = null
  private _end: Complex | null = null

  constructor(c: Complex, r: number, a0: number, sweep: number) {
    super()
    this.c = c
    this.r = r
    this.a0 = a0
    this.sweep = sweep
  }

  get sign(): number {
    return this.sweep > 0 ? 1.0 : -1.0
  }

  get start(): Complex {
    return (this._start ??= this.c.add(cis(this.a0).scale(this.r)))
  }

  get end(): Complex {
    return (this._end ??= this.c.add(cis(this.a0 + this.sweep).scale(this.r)))
  }

  get length(): number {
    return this.r * Math.abs(this.sweep)
  }

  get closed(): boolean {
    return Math.abs(Math.abs(this.sweep) - TAU) < 1e-12
  }

  angleAt(s: number): number {
    return this.a0 + (this.sign * s) / this.r
  }

  at(s: number): Complex {
    return this.c.add(cis(this.angleAt(s)).scale(this.r))
  }

  tangent(s: number): Complex {
    return J.scale(this.sign).mul(cis(this.angleAt(s)))
  }

  get t0(): Complex {
    return J.scale(this.sign).mul(cis(this.a0))
  }

  get t1(): Complex {
    return J.scale(this.sign).mul(cis(this.a0 + this.sweep))
  }

  override position(p: Complex): number {
    if (p.equals(this.c)) return 0.0
    const delta = pymod(this.sign * (p.sub(this.c).phase() - this.a0), TAU)
    const span = Math.abs(this.sweep)
    if (delta <= span + 1e-12) return this.r * delta
    const after = delta - span
    const before = TAU - delta
    return after <= before ? this.r * delta : -this.r * before
  }

  override piece(s0: number, s1: number): Arc2 {
    return new Arc2(this.c, this.r, this.angleAt(s0), (this.sign * (s1 - s0)) / this.r)
  }

  override offset(e: number): Arc2 | null {
    const rr = this.r - this.sign * e
    if (rr <= 1e-12 * Math.max(1.0, this.r)) return null
    return new Arc2(this.c, rr, this.a0, this.sweep)
  }

  reversed(): Arc2 {
    return new Arc2(this.c, this.r, this.a0 + this.sweep, -this.sweep)
  }

  override reflected(o: Complex, u2: Complex): Arc2 {
    return new Arc2(reflect(this.c, o, u2), this.r, u2.phase() - this.a0, -this.sweep)
  }

  override moved(rot: Complex, shift: Complex): Arc2 {
    return new Arc2(this.c.mul(rot).add(shift), this.r, this.a0 + rot.phase(), this.sweep)
  }

  areaTerm(): number {
    return 0.5 * (this.r * this.r * this.sweep + cross(this.c, this.end.sub(this.start)))
  }

  override sample(_n: number): Complex[] {
    const k = Math.max(2, Math.ceil(Math.abs(this.sweep) / (Math.PI / 8)))
    const out: Complex[] = []
    for (let i = 0; i <= k; i++) out.push(this.at((this.length * i) / k))
    return out
  }

  override toString(): string {
    return `Arc2(c=${fmtPt(this.c)}, r=${fmt(this.r)}, ${deg(this.a0)}°${this.sweep > 0 ? '+' : ''}${deg(this.sweep)}°)`
  }
}

/** The world edge a `Curve2` passes through (an Edge of shapes.ts). */
export interface CurveEdge {
  readonly geomType: string
  reversed(): CurveEdge
}

/**
 * Another curve (spline, ellipse) of a sketch, passed through unchanged. `edge` is the world edge
 * in the direction of the loop; the other fields are local to the plane.
 */
export class Curve2<E extends CurveEdge = CurveEdge> extends Seg {
  readonly kind = 'curve'
  readonly edge: E
  readonly start_: Complex
  readonly end_: Complex
  readonly t0_: Complex
  readonly t1_: Complex
  readonly length_: number
  /** Samples along the curve (for areas and crossing checks). */
  readonly points: readonly Complex[]

  constructor(edge: E, start: Complex, end: Complex, t0: Complex, t1: Complex, length: number, points: readonly Complex[]) {
    super()
    this.edge = edge
    this.start_ = start
    this.end_ = end
    this.t0_ = t0
    this.t1_ = t1
    this.length_ = length
    this.points = points
  }

  get start(): Complex {
    return this.start_
  }

  get end(): Complex {
    return this.end_
  }

  get length(): number {
    return this.length_
  }

  get t0(): Complex {
    return this.t0_
  }

  get t1(): Complex {
    return this.t1_
  }

  at(s: number): Complex {
    const n = this.points.length
    const i = this.length_ ? Math.min(pyround((s / this.length_) * (n - 1)), n - 1) : 0
    return this.points[Math.max(i, 0)]
  }

  reversed(): Curve2<E> {
    return new Curve2(this.edge.reversed() as E, this.end_, this.start_, this.t1_.neg(), this.t0_.neg(), this.length_, [...this.points].reverse())
  }

  areaTerm(): number {
    const p = this.points
    const terms: number[] = []
    for (let i = 0; i + 1 < p.length; i++) terms.push(cross(p[i], p[i + 1]))
    return 0.5 * pysum(terms)
  }

  override sample(_n: number): Complex[] {
    return [...this.points]
  }

  override toString(): string {
    return `Curve2(${fmtPt(this.start_)}->${fmtPt(this.end_)})`
  }
}

/** The segment in words, for messages (`fp` formats a point). */
export function describe(s: Seg, fp: (p: Complex) => string = fmtPt): string {
  if (s instanceof Line2) return `the line ${fp(s.a)} -> ${fp(s.b)}`
  if (s instanceof Arc2) return `the arc of radius ${fmt(s.r)} from ${fp(s.start)} to ${fp(s.end)}`
  const edge = (s as Partial<Curve2>).edge
  return `the ${(edge && edge.geomType) || 'curve'} ${fp(s.start)} -> ${fp(s.end)}`
}

// =============================================================================== intersections
function _lineLine(a1: Complex, d1: Complex, a2: Complex, d2: Complex): Complex[] {
  const den = cross(d1, d2)
  if (Math.abs(den) < 1e-14) return []
  const s = cross(a2.sub(a1), d2) / den
  return [a1.add(d1.scale(s))]
}

function _lineCircle(a: Complex, d: Complex, c: Complex, r: number): Complex[] {
  // |a + d s - c|^2 = r^2 with |d| = 1
  const w = a.sub(c)
  const b = dot(w, d)
  const aw = w.abs()
  const q = aw * aw - r * r
  const disc = b * b - q
  if (disc < -1e-12 * Math.max(1.0, r * r)) return []
  if (disc <= 1e-12 * Math.max(1.0, r * r)) return [a.sub(d.scale(b))]
  const rt = Math.sqrt(disc)
  return [a.add(d.scale(-b - rt)), a.add(d.scale(-b + rt))]
}

function _circleCircle(c1: Complex, r1: number, c2: Complex, r2: number): Complex[] {
  const d = c2.sub(c1).abs()
  if (d < 1e-14) return []
  if (d > r1 + r2 + 1e-12 * Math.max(1.0, r1 + r2) || d < Math.abs(r1 - r2) - 1e-12 * Math.max(1.0, r1 + r2)) return []
  const x = (d * d + r1 * r1 - r2 * r2) / (2.0 * d)
  const h2 = r1 * r1 - x * x
  const u = c2.sub(c1).divs(d)
  const base = c1.add(u.scale(x))
  if (h2 <= 1e-12 * Math.max(1.0, r1 * r1)) return [base]
  const h = Math.sqrt(h2)
  return [base.add(J.mul(u).scale(h)), base.sub(J.mul(u).scale(h))]
}

/** Points where the carriers (infinite line, full circle) of two segments meet. */
export function carrierIntersections(s1: Seg, s2: Seg): Complex[] {
  if (s1 instanceof Line2 && s2 instanceof Line2) return _lineLine(s1.a, s1.direction, s2.a, s2.direction)
  if (s1 instanceof Line2 && s2 instanceof Arc2) return _lineCircle(s1.a, s1.direction, s2.c, s2.r)
  if (s1 instanceof Arc2 && s2 instanceof Line2) return _lineCircle(s2.a, s2.direction, s1.c, s1.r)
  if (s1 instanceof Arc2 && s2 instanceof Arc2) return _circleCircle(s1.c, s1.r, s2.c, s2.r)
  throw new GeometryError('only lines and arcs can be intersected exactly')
}

/** The point of the carrier of `s` nearest `p`. */
export function foot(s: Seg, p: Complex): Complex {
  if (s instanceof Line2) return s.a.add(s.direction.scale(dot(p.sub(s.a), s.direction)))
  if (s instanceof Arc2) {
    if (p.equals(s.c)) return s.start
    return s.c.add(unit(p.sub(s.c)).scale(s.r))
  }
  throw new GeometryError('only lines and arcs')
}

function _on(s: Seg, p: Complex, tol: number): boolean {
  const pos = s.position(p)
  return -tol <= pos && pos <= s.length + tol && s.at(Math.min(Math.max(pos, 0.0), s.length)).sub(p).abs() <= tol * 10
}

/** Length of the stretch two segments share (collinear lines or arcs of one circle). */
export function overlap(s1: Seg, s2: Seg, tol: number): number {
  if (s1 instanceof Line2 && s2 instanceof Line2) {
    const d = s1.direction
    if (Math.abs(cross(d, s2.direction)) > 1e-9) return 0.0
    if (Math.abs(cross(d, s2.a.sub(s1.a))) > tol) return 0.0
    const qa = s1.position(s2.a)
    const qb = s1.position(s2.b)
    const p0 = Math.min(qa, qb)
    const p1 = Math.max(qa, qb)
    return Math.max(0.0, Math.min(p1, s1.length) - Math.max(p0, 0.0))
  }
  if (s1 instanceof Arc2 && s2 instanceof Arc2) {
    if (s1.c.sub(s2.c).abs() > tol || Math.abs(s1.r - s2.r) > tol) return 0.0
    let inside = 0
    for (let i = 0; i < 17; i++) {
      const pos = s1.position(s2.at((s2.length * i) / 16))
      if (0.0 < pos && pos < s1.length) inside++
    }
    return inside > 1 ? (s2.length * inside) / 17.0 : 0.0
  }
  return 0.0
}

/** Points where two segments meet (not counting an overlap; see `overlap`). */
export function segmentIntersections(s1: Seg, s2: Seg, tol: number): Complex[] {
  if (s1 instanceof Curve2 || s2 instanceof Curve2) return _polylineIntersections(s1.sample(48), s2.sample(48))
  const out: Complex[] = []
  for (const p of carrierIntersections(s1, s2)) if (_on(s1, p, tol) && _on(s2, p, tol)) out.push(p)
  return out
}

function _polylineIntersections(pa: readonly Complex[], pb: readonly Complex[]): Complex[] {
  const out: Complex[] = []
  for (let i = 0; i + 1 < pa.length; i++) {
    const a0 = pa[i]
    const da = pa[i + 1].sub(a0)
    for (let j = 0; j + 1 < pb.length; j++) {
      const b0 = pb[j]
      const db = pb[j + 1].sub(b0)
      const den = cross(da, db)
      if (Math.abs(den) < 1e-15) continue
      const s = cross(b0.sub(a0), db) / den
      const t = cross(b0.sub(a0), da) / den
      if (-1e-9 <= s && s <= 1 + 1e-9 && -1e-9 <= t && t <= 1 + 1e-9) out.push(a0.add(da.scale(s)))
    }
  }
  return out
}

// =============================================================================== loops: area, simplification, crossings
export function signedArea(loop: readonly Seg[]): number {
  return pysum(loop.map((s) => s.areaTerm()))
}

export function extent(segs: readonly Seg[]): number {
  const pts: Complex[] = []
  for (const s of segs) pts.push(s.start, s.end)
  for (const s of segs) if (s instanceof Arc2) pts.push(s.c)
  if (!pts.length) return 1.0
  let xlo = Infinity
  let xhi = -Infinity
  let ylo = Infinity
  let yhi = -Infinity
  let xa = 0
  let ya = 0
  for (const p of pts) {
    xlo = Math.min(xlo, p.re)
    xhi = Math.max(xhi, p.re)
    ylo = Math.min(ylo, p.im)
    yhi = Math.max(yhi, p.im)
    xa = Math.max(xa, Math.abs(p.re))
    ya = Math.max(ya, Math.abs(p.im))
  }
  return Math.max(1.0, xhi - xlo, yhi - ylo, xa, ya)
}

export function tolerance(segs: readonly Seg[]): number {
  return 1e-9 * extent(segs)
}

function _mergeable(a: Seg, b: Seg, tol: number): Seg | null {
  if (a.end.sub(b.start).abs() > tol) return null
  if (a instanceof Line2 && b instanceof Line2) {
    if (a.length > 0 && b.length > 0 && Math.abs(cross(a.direction, b.direction)) < 1e-12 && dot(a.direction, b.direction) > 0) {
      return new Line2(a.a, b.b)
    }
    return null
  }
  if (a instanceof Arc2 && b instanceof Arc2) {
    if (a.c.sub(b.c).abs() <= tol && Math.abs(a.r - b.r) <= tol && a.sign === b.sign && Math.abs(a.sweep + b.sweep) <= TAU + 1e-12) {
      return new Arc2(a.c, a.r, a.a0, a.sweep + b.sweep)
    }
  }
  return null
}

/** Join consecutive collinear lines and consecutive arcs of one circle; drop pieces of no
 * length. */
export function simplify(segs: readonly Seg[], labels: readonly string[], closed: boolean, tol: number): [Seg[], string[]] {
  const out: Seg[] = []
  const labs: string[] = []
  const n = Math.min(segs.length, labels.length)
  for (let i = 0; i < n; i++) {
    const s = segs[i]
    const lab = labels[i]
    if (s.length <= tol) continue
    const m = out.length ? _mergeable(out[out.length - 1], s, tol) : null
    if (m !== null) {
      out[out.length - 1] = m
      if (!labs[labs.length - 1].includes(lab)) labs[labs.length - 1] = `${labs[labs.length - 1]} + ${lab}`
    } else {
      out.push(s)
      labs.push(lab)
    }
  }
  if (closed && out.length > 2) {
    const m = _mergeable(out[out.length - 1], out[0], tol)
    if (m !== null) {
      out[0] = m
      labs[0] = labs[labs.length - 1].includes(labs[0]) ? labs[labs.length - 1] : `${labs[labs.length - 1]} + ${labs[0]}`
      out.pop()
      labs.pop()
    }
  }
  return [out, labs]
}

/** The first pair of segments that cross, touch or run over each other: `[i, j, point]` (see
 * `runsBack` to tell the last case). */
export function firstCrossing(segs: readonly Seg[], closed: boolean, tol: number): [number, number, Complex] | null {
  const n = segs.length
  const near = Math.max(tol * 1e3, 1e-7 * extent(segs)) // how close to a shared end point still counts as the joint
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (closed && i === 0 && j === n - 1 && n > 2)
      const ov = overlap(segs[i], segs[j], tol)
      if (ov > tol) return [i, j, j === i + 1 ? segs[j].start : segs[i].start]
      let pts = segmentIntersections(segs[i], segs[j], tol)
      if (adjacent) {
        const joint = j === i + 1 ? segs[i].end : segs[i].start
        pts = pts.filter((p) => p.sub(joint).abs() > near)
        if (n === 2) {
          // the two segments of a two-segment loop meet at both ends
          const s0 = segs[i].start
          pts = pts.filter((p) => p.sub(s0).abs() > near)
        }
      }
      if (pts.length) return [i, j, pts[0]]
    }
  }
  return null
}

/** True if segments `i` and `j` share a stretch (the outline runs back over itself). */
export function runsBack(segs: readonly Seg[], i: number, j: number, tol: number): boolean {
  return overlap(segs[i], segs[j], tol) > tol
}

// =============================================================================== corners
/** [sine, cosine] of the turn from the end of `s1` to the start of `s2`. */
export function turn(s1: Seg, s2: Seg): [number, number] {
  return [cross(s1.t1, s2.t0), dot(s1.t1, s2.t0)]
}

export function isSmooth(s1: Seg, s2: Seg): boolean {
  const [sn, cs] = turn(s1, s2)
  return Math.abs(sn) < SMOOTH && cs > 0
}

/**
 * Round the corner where `s1` ends and `s2` starts with a tangent arc of radius `r`.
 *
 * Returns how far the arc cuts back along `s1` (from its end), how far along `s2` (from its
 * start), and the arc. The cut-backs are not checked against the lengths; see `assemble`.
 */
export function filletCorner(s1: Seg, s2: Seg, r: number): [number, number, Arc2] {
  if (!((s1 instanceof Line2 || s1 instanceof Arc2) && (s2 instanceof Line2 || s2 instanceof Arc2))) {
    throw new GeometryError('it joins a curve that is not a line or an arc')
  }
  const [sn, cs] = turn(s1, s2)
  if (Math.abs(sn) < SMOOTH) {
    throw new GeometryError(cs > 0 ? 'the segments meet tangentially there, so there is no corner' : 'the outline turns back on itself there')
  }
  const side = sn > 0 ? 1.0 : -1.0
  const o1 = s1.offset(side * r)
  const o2 = s2.offset(side * r)
  if (o1 === null || o2 === null) {
    const small = (o1 === null ? s1 : s2) as Arc2
    throw new GeometryError(`the radius ${fmt(r)} is larger than the radius ${fmt(small.r)} of ${describe(small)}`)
  }
  const v = s1.end
  const cands = carrierIntersections(o1, o2)
  if (!cands.length) throw new GeometryError(`no arc of radius ${fmt(r)} touches both segments`)
  const c = minBy(cands, (z) => z.sub(v).abs())
  const f1 = foot(s1, c)
  const f2 = foot(s2, c)
  const back = s1.length - s1.position(f1)
  const ahead = s2.position(f2)
  const v1 = f1.sub(c)
  const v2 = f2.sub(c)
  let delta = v2.div(v1).phase()
  if (side > 0 && delta < 0) delta += TAU
  if (side < 0 && delta > 0) delta -= TAU
  return [back, ahead, new Arc2(c, r, v1.phase(), delta)]
}

/** Bevel the corner where `s1` ends and `s2` starts: cut back `length` along each (measured
 * along the segment) and join the two points with a line. */
export function chamferCorner(s1: Seg, s2: Seg, length: number): [number, number, Line2] {
  if (!((s1 instanceof Line2 || s1 instanceof Arc2) && (s2 instanceof Line2 || s2 instanceof Arc2))) {
    throw new GeometryError('it joins a curve that is not a line or an arc')
  }
  const [sn, cs] = turn(s1, s2)
  if (Math.abs(sn) < SMOOTH) {
    throw new GeometryError(cs > 0 ? 'the segments meet tangentially there, so there is no corner' : 'the outline turns back on itself there')
  }
  const p1 = s1.at(s1.length - length)
  const p2 = s2.at(length)
  return [length, length, new Line2(p1, p2)]
}

/** A corner to round ("fillet", `size` the radius) or bevel ("chamfer", `size` the length);
 * `label` is how the user asked for it, for messages. */
export class Corner {
  readonly kind: string
  readonly size: number
  readonly label: string

  constructor(kind: string, size: number, label: string) {
    this.kind = kind
    this.size = size
    this.label = label
  }
}

/**
 * Apply corner fillets and chamfers. `corners.get(i)` rounds the corner where `segs[i - 1]` ends
 * and `segs[i]` starts (`i = 0`: the corner between the last and the first segment of a closed
 * loop). `what(i)` names segment `i` and `fp` formats points in messages.
 */
export function assemble(
  segs: readonly Seg[],
  labels: readonly string[],
  corners: ReadonlyMap<number, Corner>,
  closed: boolean,
  tol: number,
  what: ((i: number) => string) | null = null,
  fp: (p: Complex) => string = fmtPt,
): [Seg[], string[]] {
  const n = segs.length
  const name = what ?? ((i: number) => `segment ${i + 1} (${labels[i]})`)
  const cutStart = new Array<number>(n).fill(0.0)
  const cutEnd = new Array<number>(n).fill(0.0)
  const ownerStart = new Array<Corner | null>(n).fill(null)
  const ownerEnd = new Array<Corner | null>(n).fill(null)
  const inserts = new Map<number, Seg>()
  const insertLabels = new Map<number, string>()
  for (const i of [...corners.keys()].sort((a, b) => a - b)) {
    const cn = corners.get(i)!
    if (!closed && (i <= 0 || i >= n)) {
      throw new GeometryError(`${cn.label}: the ${i <= 0 ? 'start' : 'end'} of an open path is not a corner`)
    }
    const s1 = segs[imod(i - 1, n)]
    const s2 = segs[imod(i, n)]
    const smaller = cn.kind === 'fillet' ? 'use a smaller radius' : 'use a shorter length'
    let back: number
    let ahead: number
    let piece: Seg
    try {
      if (cn.kind === 'fillet') [back, ahead, piece] = filletCorner(s1, s2, cn.size)
      else [back, ahead, piece] = chamferCorner(s1, s2, cn.size)
    } catch (e) {
      if (!(e instanceof GeometryError)) throw e
      const text = e.message
      const hint = text.includes('no corner') || text.includes('turns back') ? `; leave the ${cn.kind} out` : `; ${smaller}`
      throw new GeometryError(`${cn.label} at ${fp(s1.end)}: ${text}${hint}`)
    }
    for (const [amount, segI] of [
      [back, i - 1],
      [ahead, imod(i, n)],
    ] as const) {
      const seg = segs[imod(segI, n)]
      if (amount < -tol || amount > seg.length + tol) {
        throw new GeometryError(
          `${cn.label} at ${fp(s1.end)} does not fit: it needs ${fmt(Math.max(amount, 0.0))} along ${name(imod(segI, n))}, which is ${fmt(seg.length)} long; ${smaller}`,
        )
      }
    }
    cutEnd[imod(i - 1, n)] = Math.max(back, 0.0)
    ownerEnd[imod(i - 1, n)] = cn
    cutStart[imod(i, n)] = Math.max(ahead, 0.0)
    ownerStart[imod(i, n)] = cn
    inserts.set(imod(i, n), piece)
    insertLabels.set(imod(i, n), `${cn.label} at ${fp(s1.end)}`)
  }
  const out: Seg[] = []
  const labs: string[] = []
  for (let j = 0; j < n; j++) {
    const seg = segs[j]
    if (cutStart[j] + cutEnd[j] > seg.length + tol) {
      const a = ownerStart[j]
      const b = ownerEnd[j]
      throw new GeometryError(
        `${a ? a.label : ''} at ${fp(seg.start)} and ${b ? b.label : ''} at ${fp(seg.end)} overlap on ${name(j)}: they need ${fmt(cutStart[j])} + ${fmt(cutEnd[j])} of its ${fmt(seg.length)}; use smaller corners`,
      )
    }
    if (inserts.has(j)) {
      out.push(inserts.get(j)!)
      labs.push(insertLabels.get(j)!)
    }
    if (cutStart[j] || cutEnd[j]) {
      if (seg.length - cutStart[j] - cutEnd[j] > tol) {
        if (seg instanceof Curve2) throw new GeometryError(`cannot shorten ${name(j)}: it is not a line or an arc`)
        out.push(seg.piece(cutStart[j], seg.length - cutEnd[j]))
        labs.push(labels[j])
      }
    } else {
      out.push(seg)
      labs.push(labels[j])
    }
  }
  return [out, labs]
}

// =============================================================================== offsets of chains
/** The segment with its end (or start) moved to `p`, a point of its carrier. */
function _extendTo(seg: Seg, p: Complex, atEnd: boolean): Seg {
  if (seg instanceof Line2) return atEnd ? new Line2(seg.a, p) : new Line2(p, seg.b)
  const pos = seg.position(p)
  return atEnd ? seg.piece(0.0, pos) : seg.piece(pos, seg.length)
}

/**
 * The chain moved `e` to the left (negative: to the right), with the gaps at corners that open
 * filled (`corners`: "round", "sharp" or "chamfer") and the overlaps at corners that close
 * trimmed. Throws `NeedBooleans` when the result does not follow from the neighbouring segments
 * alone (a segment that vanishes, an arc that collapses).
 */
export function offsetChain(segs: readonly Seg[], e: number, corners: string, closed: boolean, tol: number): Seg[] {
  const n = segs.length
  const moved: Seg[] = []
  for (const s of segs) {
    if (!(s instanceof Line2 || s instanceof Arc2)) throw new GeometryError('only lines and arcs can be offset exactly')
    const o = s.offset(e)
    if (o === null) throw new NeedBooleans('an arc collapses')
    moved.push(o)
  }
  const joins = new Map<number, Seg[]>()
  for (let i = closed ? 0 : 1; i < n; i++) {
    const s1 = segs[imod(i - 1, n)]
    const s2 = segs[i]
    let m1 = moved[imod(i - 1, n)]
    let m2 = moved[i]
    const [sn, cs] = turn(s1, s2)
    if (Math.abs(sn) < SMOOTH && cs > 0) continue // smooth: the offsets meet
    if (Math.abs(sn) < SMOOTH) throw new NeedBooleans('the chain turns back')
    const opening = sn * e < 0 // the offset side is the outside of the turn
    if (opening) {
      const v = s1.end
      const p = m1.end
      const q = m2.start
      if (corners === 'round') {
        const d1 = p.sub(v)
        const d2 = q.sub(v)
        let sweep = d2.div(d1).phase()
        if (sn > 0 && sweep < 0) sweep += TAU
        if (sn < 0 && sweep > 0) sweep -= TAU
        joins.set(i, [new Arc2(v, Math.abs(e), d1.phase(), sweep)])
      } else if (corners === 'chamfer') {
        joins.set(i, [new Line2(p, q)])
      } else {
        // sharp: extend the tangents to their intersection
        const hits = _lineLine(p, m1.t1, q, m2.t0)
        if (!hits.length) throw new NeedBooleans('parallel tangents')
        const mpt = hits[0]
        let first: Seg[]
        let second: Seg[]
        if (m1 instanceof Line2) {
          m1 = new Line2(m1.a, mpt)
          first = []
        } else {
          first = [new Line2(p, mpt)]
        }
        if (m2 instanceof Line2) {
          m2 = new Line2(mpt, m2.b)
          second = []
        } else {
          second = [new Line2(mpt, q)]
        }
        moved[imod(i - 1, n)] = m1
        moved[i] = m2
        joins.set(i, [...first, ...second])
      }
    } else {
      // the offsets overlap: trim both at their intersection nearest the corner
      const cands = carrierIntersections(m1, m2)
      const v = s1.end
      const a = m1
      const b = m2
      const good = cands.filter((c) => a.position(c) > -tol && b.position(c) < b.length + tol && a.position(c) <= a.length + tol && b.position(c) >= -tol)
      if (!good.length) throw new NeedBooleans('the offsets do not meet near the corner')
      const c = minBy(good, (z) => z.sub(v).abs())
      moved[imod(i - 1, n)] = _extendTo(m1, c, true)
      moved[i] = _extendTo(m2, c, false)
    }
  }
  const out: Seg[] = []
  for (let i = 0; i < n; i++) {
    const join = joins.get(i)
    if (join) out.push(...join)
    const m = moved[i]
    // a trimmed piece must keep its direction and length
    if (m instanceof Line2) {
      const orig = segs[i]
      if (m.length <= tol || dot(m.b.sub(m.a), orig instanceof Line2 ? orig.t0 : m.b.sub(m.a)) <= 0) {
        throw new NeedBooleans('a segment vanishes')
      }
    } else if (m instanceof Arc2) {
      if (Math.abs(m.sweep) <= 1e-12 || m.sweep > 0 !== (segs[i] as Arc2).sweep > 0) throw new NeedBooleans('an arc vanishes')
    }
    out.push(m)
  }
  return out
}

// =============================================================================== pieces for the Boolean constructions
/** A region: outer loop (counterclockwise) and holes. */
export type Piece = [Seg[], Seg[][]]

/** The region a segment covers when it moves `e` to its left (negative: right). An arc that
 * would pass its center stops there (a pie slice); a full circle gives a ring. */
export function sweepPiece(s: Seg, e: number): Piece[] {
  if (s instanceof Line2) {
    const m = s.offset(e)
    return [[orientCcw([s, new Line2(s.b, m.b), m.reversed(), new Line2(m.a, s.a)]), []]]
  }
  if (!(s instanceof Arc2)) throw new GeometryError('only lines and arcs')
  const m = s.offset(e)
  if (s.closed) {
    if (m === null) return [[disk(s.c, s.r), []]]
    const lo = Math.min(s.r, m.r)
    const hi = Math.max(s.r, m.r)
    return [[[new Arc2(s.c, hi, 0.0, TAU)], [[new Arc2(s.c, lo, 0.0, -TAU)]]]]
  }
  if (m === null) return [[orientCcw([s, new Line2(s.end, s.c), new Line2(s.c, s.start)]), []]]
  return [[orientCcw([s, new Line2(s.end, m.end), m.reversed(), new Line2(m.start, s.start)]), []]]
}

/** The region within `half` of a segment on both sides, ends cut square. */
export function bandPiece(s: Seg, half: number): Piece[] {
  if (s instanceof Line2) {
    const lo = s.offset(-half)
    const hi = s.offset(half)
    return [[orientCcw([lo, new Line2(lo.b, hi.b), hi.reversed(), new Line2(hi.a, lo.a)]), []]]
  }
  const a = s as Arc2
  const outer = new Arc2(a.c, a.r + half, a.a0, a.sweep)
  if (a.r - half > 1e-12 * Math.max(1.0, a.r)) {
    const inner = new Arc2(a.c, a.r - half, a.a0, a.sweep)
    return [[orientCcw([inner, new Line2(inner.end, outer.end), outer.reversed(), new Line2(outer.start, inner.start)]), []]]
  }
  return [[orientCcw([new Line2(a.c, outer.start), outer, new Line2(outer.end, a.c)]), []]]
}

export function disk(c: Complex, r: number): Seg[] {
  return [new Arc2(c, r, 0.0, TAU)]
}

export function polygon(...pts: Complex[]): Seg[] {
  const out: Seg[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (b.sub(a).abs() > 0) out.push(new Line2(a, b))
  }
  return orientCcw(out)
}

/**
 * The gap between the offsets of two segments at a corner that the offset `e` (to the left) pulls
 * apart; nothing where the corner does not open on that side. The piece shares its straight
 * sides with the pieces of the two segments, so the Booleans meet edges, not tangencies.
 */
export function cornerPiece(s1: Seg, s2: Seg, e: number, corners: string): Piece[] {
  const [sn, cs] = turn(s1, s2)
  if (Math.abs(sn) < SMOOTH && cs > 0) return []
  if (sn * e >= 0 && Math.abs(sn) >= SMOOTH) return []
  const v = s1.end
  const p = s1.offset(e)
  const q = s2.offset(e)
  if (p === null || q === null || Math.abs(sn) < SMOOTH) return [[disk(v, Math.abs(e)), []]]
  const pe = p.end
  const qs = q.start
  if (corners === 'chamfer') return [[polygon(v, pe, qs), []]]
  if (corners === 'sharp') {
    const hits = _lineLine(pe, s1.t1, qs, s2.t0)
    if (hits.length) return [[polygon(v, pe, hits[0], qs), []]]
    return [[disk(v, Math.abs(e)), []]]
  }
  const d1 = pe.sub(v)
  const d2 = qs.sub(v)
  let sweep = d2.div(d1).phase()
  if (sn > 0 && sweep < 0) sweep += TAU
  if (sn < 0 && sweep > 0) sweep -= TAU
  return [[orientCcw([new Line2(v, pe), new Arc2(v, Math.abs(e), d1.phase(), sweep), new Line2(qs, v)]), []]]
}

/** Distance from a point to a line or arc segment. */
export function distance(s: Seg, p: Complex): number {
  if (s instanceof Line2) {
    const pos = s.position(p)
    return p.sub(s.at(Math.min(Math.max(pos, 0.0), s.length))).abs()
  }
  if (s instanceof Arc2) {
    if (!p.equals(s.c)) {
      const pos = s.position(p)
      if (0.0 <= pos && pos <= s.length) return Math.abs(p.sub(s.c).abs() - s.r)
    }
    return Math.min(p.sub(s.start).abs(), p.sub(s.end).abs())
  }
  let best = Infinity
  for (const q of s.sample(64)) best = Math.min(best, p.sub(q).abs())
  return best
}

export function orientCcw(loop: Seg[]): Seg[] {
  if (signedArea(loop) < 0) return loop.map((s) => s.reversed()).reverse()
  return loop
}

// =============================================================================== convex hull of points and circular arcs
/** A site of the hull: a point (`r` 0) or an arc of a circle, which supports the hull for the
 * outward normal directions `lo` .. `lo + span` (counterclockwise). */
export class _Site {
  readonly c: Complex
  readonly r: number
  readonly lo: number
  readonly span: number

  constructor(c: Complex, r: number, lo = 0.0, span = TAU) {
    this.c = c
    this.r = r
    this.lo = lo
    this.span = span
  }

  covers(phi: number): boolean {
    return this.r === 0.0 || this.span >= TAU - 1e-12 || pymod(phi - this.lo, TAU) <= this.span + 1e-12
  }

  support(phi: number): number {
    return dot(this.c, cis(phi)) + this.r
  }

  point(phi: number): Complex {
    return this.c.add(cis(phi).scale(this.r))
  }
}

export function hullSites(segs: readonly Seg[]): _Site[] {
  const sites: _Site[] = []
  for (const s of segs) {
    if (s instanceof Line2) {
      sites.push(new _Site(s.a, 0.0), new _Site(s.b, 0.0))
    } else if (s instanceof Arc2) {
      const ccw = s.sweep > 0 ? s : s.reversed()
      if (!s.closed) sites.push(new _Site(s.start, 0.0), new _Site(s.end, 0.0)) // the seam point of a full circle adds nothing
      sites.push(new _Site(s.c, s.r, pymod(ccw.a0, TAU), Math.min(Math.abs(s.sweep), TAU)))
    } else {
      throw new GeometryError(
        `${describe(s)} is neither a line nor a circular arc; Hull works on points, lines and arcs (for a convex outline of other curves, hull points along them)`,
      )
    }
  }
  return sites
}

/** The first direction after `phi` (less than a turn later) at which site `b` takes over the
 * support of the hull from site `a`, going counterclockwise; null if it never does. */
function _transition(a: _Site, b: _Site, phi: number): number | null {
  const d = b.c.sub(a.c)
  const dist = d.abs()
  if (dist < 1e-14) return null
  const ratio = (a.r - b.r) / dist
  if (ratio >= 1.0 - 1e-12) return null // b lies inside a (or touches it from inside): it never rises above a
  if (ratio < -1.0 - 1e-9) return null // b contains a: it takes over where its span starts, through its end point
  const t = d.phase() - Math.acos(Math.max(-1.0, Math.min(1.0, ratio)))
  let delta = pymod(t - phi, TAU)
  if (delta < 1e-12) delta = TAU
  return phi + delta
}

/** The direction the hull walk starts from: a generic one, so that no two sites tie there. */
const _HULL_START = -Math.PI / 2 + 0.3183098861837907

/**
 * The boundary of the convex hull of points and arcs, counterclockwise, as lines and arcs.
 *
 * The walk follows the outward normal direction once around: on an arc site the boundary runs
 * along the arc, and where another site takes over the support the boundary jumps to it along
 * their common tangent line.
 */
export function convexHull(sites: readonly _Site[], tol: number): Seg[] {
  const n = sites.length
  if (n === 0) throw new GeometryError('nothing to hull')

  const best = (phi: number): number => {
    const vals = sites.map((s) => (s.covers(pymod(phi, TAU)) ? s.support(phi) : -Infinity))
    let top = vals[0]
    for (const v of vals) if (v > top) top = v
    let pick = -1
    for (let i = 0; i < n; i++) {
      if (!(vals[i] >= top - tol)) continue
      // the largest radius, then the first site
      if (pick < 0 || sites[i].r > sites[pick].r) pick = i
    }
    return pick
  }

  let phi = _HULL_START
  const stop = phi + TAU
  let cur = best(phi)
  const walk: [number, number, number][] = [] // [site, from direction, to direction]
  let traced = false
  for (let step = 0; step < 4 * n + 8; step++) {
    const s = sites[cur]
    let at = stop
    if (s.r > 0 && s.span < TAU - 1e-12) at = Math.min(at, phi + pymod(s.lo + s.span - phi, TAU))
    let nxt: number | null = null
    for (let j = 0; j < n; j++) {
      if (j === cur) continue
      const other = sites[j]
      const t = _transition(s, other, phi)
      if (t === null || t > at + 1e-12 || !other.covers(pymod(t, TAU))) continue
      if (nxt === null || t < at - 1e-12 || other.point(t).sub(s.point(t)).abs() > sites[nxt].point(t).sub(s.point(t)).abs()) {
        nxt = j
        at = Math.min(t, stop)
      }
    }
    walk.push([cur, phi, at])
    if (at >= stop - 1e-12) {
      traced = true
      break
    }
    if (nxt === null) nxt = best(at + 1e-9) // the arc's span ends; its end point (or another site) goes on
    cur = nxt
    phi = at
  }
  if (!traced) throw new GeometryError('the hull could not be traced around (please report the input)')
  let out: Seg[] = []
  for (let k = 0; k < walk.length; k++) {
    const [i, a, b] = walk[k]
    const s = sites[i]
    if (s.r > 0 && b - a > 1e-12) out.push(new Arc2(s.c, s.r, a, b - a))
    const j = walk[(k + 1) % walk.length][0]
    const p = s.point(b)
    const q = sites[j].point(b)
    if (q.sub(p).abs() > tol) out.push(new Line2(p, q))
  }
  ;[out] = simplify(out, new Array<string>(out.length).fill(''), true, tol)
  const closedCircle = out.length === 1 && out[0] instanceof Arc2 && out[0].closed
  if (!closedCircle && ((out.length < 3 && !out.some((s) => s instanceof Arc2)) || Math.abs(signedArea(out)) <= tol * extent(out))) {
    throw new GeometryError('the hull has no area: all the points lie on one line')
  }
  return out
}
