// Curve constructors: lines, arcs, splines, helices.
//
// All return an Edge (one curve) or a Wire (a chain). Points may be given as [x, y] (z = 0),
// [x, y, z] or Vectors.

import { KernelError, ModelingError, _opts, ext, k, kernelCall } from './kernel.ts'
import { type Axis, Location, Plane, Vector, type VectorLike, _degrees, _direction, _formatG, _radians, _vec } from './geometry.ts'
import { Edge, Shape, Vertex, Wire, _canonicalCurve, _transformCurve, _typeName } from './shapes.ts'
import { type Complex, Corner, GeometryError, type Seg, assemble, describe, fmt, isSmooth } from './_planar.ts'
import { CurveCorners, type Frame, curveOf, realSize, segOfEdge, wireFrame } from './_regions.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any

/** Python's float modulo: the result has the sign of the divisor. */
export function _mod(a: number, b: number): number {
  const r = a % b
  return r !== 0 && r < 0 !== b < 0 ? r + b : r
}

/** The points of a call: `f(p1, p2, ...)`, or `f([p1, p2, ...])` with one list of points. */
export function _pts(points: readonly unknown[]): Vector[] {
  if (points.length === 1 && Array.isArray(points[0]) && points[0].length && typeof points[0][0] !== 'number') {
    points = points[0]
  }
  return points.map((p) => _vec(p as VectorLike))
}

/** A straight edge from `start` to `end`. */
export function Line(start: VectorLike, end: VectorLike): Edge {
  const a = _vec(start)
  const b = _vec(end)
  if (a.isClose(b, 1e-12)) throw new RangeError('a line needs two distinct points')
  return kernelCall('Line', () => Edge._fromCurve(k.create_line_segment(a.toArray(), b.toArray())))
}

/** A line of `length` leaving `start` at `angle` degrees from the plane's X axis. */
export function PolarLine(start: VectorLike, length: number, angle: number, plane: Plane = Plane.XY): Edge {
  const a = _vec(start)
  const d = plane.xDir.mul(Math.cos(_radians(angle))).add(plane.yDir.mul(Math.sin(_radians(angle))))
  return Line(a, a.add(d.mul(length)))
}

/** Straight segments through the points. `close: true` connects the last point to the first:
 * `Polyline([0, 0], [10, 0], [10, 5], { close: true })`. */
export function Polyline(...args: (VectorLike | readonly VectorLike[] | { close?: boolean })[]): Wire {
  const { items, options } = _withOptions<{ close?: boolean }>(args)
  _opts('Polyline', options)
  const pts = _pts(items)
  if (pts.length < 2) throw new RangeError('a polyline needs at least two points')
  if (options.close && !pts[0].isClose(pts[pts.length - 1])) pts.push(pts[0])
  const edges: Edge[] = []
  for (let i = 0; i + 1 < pts.length; i++) if (!pts[i].isClose(pts[i + 1], 1e-12)) edges.push(Line(pts[i], pts[i + 1]))
  return Wire._raw(edges)
}

/** The arguments of a call that ends in an options object: the items and the options. */
export function _withOptions<O extends object>(args: readonly unknown[]): { items: unknown[]; options: O } {
  const last = args[args.length - 1]
  if (last !== null && typeof last === 'object' && !Array.isArray(last) && !ArrayBuffer.isView(last) && !(last instanceof Vector) && Object.getPrototypeOf(last) === Object.prototype) {
    return { items: args.slice(0, -1), options: last as O }
  }
  return { items: args.slice(), options: {} as O }
}

/**
 * An arc around `center` starting at `startAngle` and spanning `arcSize` degrees (angles
 * counterclockwise from the plane's X axis; a negative `arcSize` runs clockwise).
 * `CenterArc(c, r, 0, 360)` is a full circle.
 *
 * `center` is given in plane coordinates.
 */
export function CenterArc(center: VectorLike, radius: number, startAngle: number, arcSize: number, plane: Plane = Plane.XY): Edge {
  if (radius <= 0) throw new RangeError('radius must be positive')
  if (arcSize === 0) throw new RangeError('CenterArc: arcSize must not be zero (360 is a full circle)')
  return Edge._fromCurve(_arcCurve(_vec(center), Number(radius), Number(startAngle), Number(arcSize), plane))
}

/** A new kernel circle, or arc of one, around `center` (in plane coordinates) from `startAngle`
 * over `arcSize` degrees. The caller owns the curve. */
export function _arcCurve(center: Vector, radius: number, startAngle: number, arcSize: number, plane: Plane): number {
  const sweep = Number(arcSize)
  const endAngle = startAngle + sweep
  const curve = kernelCall('CenterArc', () => {
    // A true circle (exact radius/center queries, CIRCLE in STEP), started at the start angle and
    // trimmed at the parameter of the end point. (The parameter of a rational NURBS circle is not
    // proportional to the angle.)
    let c: number = k.create_circle([0, 0, 0], Number(radius))
    const [lo, hi] = k.curve_parameter_range(c)
    const a0 = sweep >= 0 ? startAngle : endAngle
    if (_mod(a0, 360)) k.rotate(c, [0, 0, 0], [0, 0, 1], Number(a0))
    const span = Math.min(Math.abs(sweep), 360)
    if (span < 360 - 1e-9) {
      const a1 = _radians(a0 + span)
      let [, tEnd] = k.curve_closest_point(c, [radius * Math.cos(a1), radius * Math.sin(a1), 0])
      if (tEnd <= lo + 1e-12) tEnd = hi
      const whole = c
      c = ext.trimmed_curve(whole, lo, Number(tEnd))
      ext.delete_curve(whole)
    }
    if (sweep < 0) ext.reverse_curve(c)
    return c
  })
  const loc = plane.location.mul(new Location(center))
  return _transformCurve(curve, loc._m)
}

/** The circular arc from `start` through `through` to `end`. */
export function ThreePointArc(start: VectorLike, through: VectorLike, end: VectorLike): Edge {
  const a = _vec(start)
  const b = _vec(through)
  const c = _vec(end)
  const ab = b.sub(a)
  const ac = c.sub(a)
  let n = ab.cross(ac)
  if (n.length < 1e-12 * Math.max(1, ab.length * ac.length)) throw new RangeError('the three points are collinear')
  n = n.normalized()
  // circumcenter
  const ab2 = ab.dot(ab)
  const ac2 = ac.dot(ac)
  const center = a.add(ab.cross(n).mul(ac2).sub(ac.cross(n).mul(ab2)).div(2 * ab.cross(ac).dot(n)).mul(-1))
  const radius = center.distanceTo(a)
  const x = a.sub(center).normalized()
  const plane = new Plane(center, x, n)
  const endLocal = plane.toLocal(c)
  let ang = _mod(_degrees(Math.atan2(endLocal.y, endLocal.x)), 360)
  if (ang < 1e-9) ang = 360
  return CenterArc([0, 0, 0], radius, 0, ang, plane)
}

/**
 * The shorter arc of `radius` from `start` to `end` in `plane`.
 *
 * A positive radius bulges to the left of the direction start->end, a negative one to the right.
 */
export function RadiusArc(start: VectorLike, end: VectorLike, radius: number, plane: Plane = Plane.XY): Edge {
  const a = _vec(start)
  const b = _vec(end)
  const chord = b.sub(a)
  const half = chord.length / 2
  const r = Math.abs(radius)
  if (r < half - 1e-12) throw new RangeError(`radius ${r} is too small for points ${chord.length} apart`)
  const h = Math.sqrt(Math.max(r * r - half * half, 0))
  const mid = a.add(b).div(2)
  const left = plane.zDir.cross(chord).normalized()
  const sagitta = r - h
  const side = radius > 0 ? left : left.neg()
  return ThreePointArc(a, mid.add(side.mul(sagitta)), b)
}

/** An arc from `start` to `end` whose middle is `sagitta` away from the chord (positive to the
 * left of start->end). */
export function SagittaArc(start: VectorLike, end: VectorLike, sagitta: number, plane: Plane = Plane.XY): Edge {
  const a = _vec(start)
  const b = _vec(end)
  const mid = a.add(b).div(2)
  const left = plane.zDir.cross(b.sub(a)).normalized()
  return ThreePointArc(a, mid.add(left.mul(sagitta)), b)
}

/** An arc from `start` to `end` leaving `start` along `tangent`. */
export function TangentArc(start: VectorLike, end: VectorLike, tangent: VectorLike): Edge {
  const a = _vec(start)
  const b = _vec(end)
  const t = _vec(tangent).normalized()
  const chord = b.sub(a)
  let n = t.cross(chord)
  if (n.length < 1e-12) return Line(a, b)
  n = n.normalized()
  const inward = n.cross(t) // towards the center
  const r = chord.dot(chord) / (2 * chord.dot(inward))
  const center = a.add(inward.mul(r))
  const rr = Math.abs(r)
  let midDir = a.add(b).div(2).sub(center)
  if (midDir.length < 1e-12) midDir = t.mul(r > 0 ? 1 : -1)
  // the arc goes the short or long way depending on the tangent
  const m1 = center.add(midDir.normalized().mul(rr))
  const m2 = center.sub(midDir.normalized().mul(rr))
  const mid = m1.sub(a).dot(t) > 0 || m2.sub(a).dot(t) <= 0 ? m1 : m2
  return ThreePointArc(a, mid, b)
}

/**
 * An ellipse (or elliptical arc) around `center` in `plane`.
 *
 * The angles are ellipse angles in degrees (the point at angle a is
 * `(xRadius cos a, yRadius sin a)`). The arc runs counterclockwise from `startAngle` to
 * `endAngle`, also across 0 (300 to 60 passes through the X axis); equal angles give the whole
 * ellipse.
 */
export function EllipticalArc(center: VectorLike, xRadius: number, yRadius: number, startAngle = 0, endAngle = 360, plane: Plane = Plane.XY): Edge {
  const span = _mod(endAngle - startAngle, 360)
  const curve = kernelCall('EllipticalArc', () => {
    let c: number = k.create_ellipse([0, 0, 0], Number(xRadius), Number(yRadius))
    if (span >= 1e-12 && span < 360 - 1e-12) {
      // A true ellipse over the arc's angles. They may run from -360 to 360, so an arc across 0
      // starts below 0 and stays one curve: the whole ellipse starts at 0 and cannot be trimmed
      // across its start.
      let start = _mod(startAngle, 360)
      if (start + span > 360) start -= 360
      const whole = c
      c = ext.ellipse_arc(whole, Number(start), Number(start + span))
      ext.delete_curve(whole)
    }
    return c
  })
  return Edge._fromCurve(_transformCurve(curve, plane.location.mul(new Location(_vec(center)))._m))
}

// ------------------------------------------------------------------------------- conics
/** The rational quadratic Bezier p0, p1, p2 (plane coordinates) with middle weight w, placed on the
 * plane. */
function _conic(p0: Vector, p1: Vector, p2: Vector, w: number, plane: Plane, what: string): Edge {
  const curve = kernelCall(what, () => _canonicalCurve([p0.toArray(), p1.toArray(), p2.toArray()], [0, 0, 0, 1, 1, 1], 2, w === 1 ? null : [1, w, 1]))
  return _placed(curve, plane)
}

function _placed(curve: number, plane: Plane): Edge {
  return Edge._fromCurve(_transformCurve(curve, plane.location._m))
}

function _finite(what: string, values: Record<string, unknown>): void {
  for (const [name, v] of Object.entries(values)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${what}: ${name} must be a finite number, got ${String(v)}`)
  }
}

/**
 * A piece of the parabola `y = x² / (4 focalLength)`: its vertex at `vertex` (in plane
 * coordinates), opening along the plane's Y axis, from `x = start` to `x = end` (measured from the
 * vertex along the plane's X axis). Exact: a quadratic B-spline. For reflectors, horns and nozzle
 * contours; a negative focal length opens it along -Y.
 *
 * `ParabolicArc([0, 0], 10, -20, 20)` runs from (-20, 10) through (0, 0) to (20, 10); its focus is
 * at (0, 10).
 */
export function ParabolicArc(vertex: VectorLike, focalLength: number, start: number, end: number, plane: Plane = Plane.XY): Edge {
  _finite('ParabolicArc', { focalLength, start, end })
  if (focalLength === 0) throw new RangeError('ParabolicArc: the focal length must not be zero')
  if (start === end) throw new RangeError('ParabolicArc: start and end must differ')
  const v = _vec(vertex)
  const f = Number(focalLength)
  const [x0, x1] = [Number(start), Number(end)]
  return _conic(v.add([x0, (x0 * x0) / (4 * f), 0]), v.add([(x0 + x1) / 2, (x0 * x1) / (4 * f), 0]),
    v.add([x1, (x1 * x1) / (4 * f), 0]), 1, plane, 'ParabolicArc')
}

/**
 * A piece of the hyperbola `x²/xRadius² - y²/yRadius² = 1`, the branch on the +X side of `center`
 * (in plane coordinates), from `y = start` to `y = end` (measured from the center along the plane's
 * Y axis). Exact: a rational quadratic B-spline. Its vertex is at `(xRadius, 0)` from the center and
 * its asymptotes have the slopes `±yRadius / xRadius`.
 *
 * `HyperbolicArc([0, 0], 10, 20, -30, 30)` revolved about the Y axis is a cooling tower with a
 * waist of radius 10.
 */
export function HyperbolicArc(center: VectorLike, xRadius: number, yRadius: number, start: number, end: number, plane: Plane = Plane.XY): Edge {
  _finite('HyperbolicArc', { xRadius, yRadius, start, end })
  if (xRadius <= 0 || yRadius <= 0) throw new RangeError('HyperbolicArc: xRadius and yRadius must be positive')
  if (start === end) throw new RangeError('HyperbolicArc: start and end must differ')
  const [a, b] = [Number(xRadius), Number(yRadius)]
  const t0 = Math.asinh(Number(start) / b)
  const t1 = Math.asinh(Number(end) / b)
  const m = (t0 + t1) / 2
  const d = (t1 - t0) / 2
  const c = _vec(center)
  // the tangents at the ends meet at the middle control point; the weight cosh of half the span
  return _conic(c.add([a * Math.cosh(t0), b * Math.sinh(t0), 0]),
    c.add([(a * Math.cosh(m)) / Math.cosh(d), (b * Math.sinh(m)) / Math.cosh(d), 0]),
    c.add([a * Math.cosh(t1), b * Math.sinh(t1), 0]), Math.cosh(d), plane, 'HyperbolicArc')
}

/**
 * A conic arc from `start` to `end`, tangent there to the lines toward `apex` (the point where the
 * end tangents meet), with the fullness `rho` (0 < rho < 1): the arc passes `rho` of the way from
 * the middle of the chord to the apex. 0.5 is a parabola, less an ellipse (flatter), more a
 * hyperbola (closer to the apex). The rho conic of styling: a corner blend whose shape a single
 * number sets. Exact: a rational quadratic B-spline.
 *
 * `ConicArc([0, 0], [10, 0], [10, 10], 0.4142)` is nearly the quarter circle of radius 10 (exactly
 * for rho = sqrt(2) - 1).
 */
export function ConicArc(start: VectorLike, apex: VectorLike, end: VectorLike, rho = 0.5): Edge {
  _finite('ConicArc', { rho })
  if (!(rho > 0 && rho < 1)) throw new RangeError(`ConicArc: rho is between 0 and 1 (0.5: a parabola), got ${String(rho)}`)
  const a = _vec(start)
  const p = _vec(apex)
  const b = _vec(end)
  if (a.isClose(b, 1e-12) || p.sub(a).cross(b.sub(a)).length <= 1e-12 * Math.max(1, p.sub(a).length * b.sub(a).length)) {
    throw new RangeError('ConicArc: start, apex and end must not lie on one line')
  }
  const w = Number(rho) / (1 - Number(rho))
  return kernelCall('ConicArc', () => Edge._fromCurve(_canonicalCurve([a.toArray(), p.toArray(), b.toArray()], [0, 0, 0, 1, 1, 1], 2, [1, w, 1])))
}

// ------------------------------------------------------------------------------- NURBS curves
/** The index of the knot span that holds `u` (the last span for the end of the range). */
export function _span(knots: readonly number[], p: number, u: number): number {
  const n = knots.length - p - 1
  if (u >= knots[n]) return n - 1
  let lo = p
  let hi = n
  while (hi - lo > 1) { // knots[lo] <= u < knots[hi]
    const mid = (lo + hi) >> 1
    if (u < knots[mid]) hi = mid
    else lo = mid
  }
  return lo
}

/** The p + 1 B-spline basis functions of degree `p` that are not zero in `span` and their
 * derivatives up to the `nd`-th at `u`: `ders[k][j]` is the k-th derivative of the basis function of
 * control point `span - p + j` (Piegl and Tiller, The NURBS Book, A2.3). */
export function _basisDers(knots: readonly number[], p: number, span: number, u: number, nd: number): number[][] {
  const ndu = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0))
  ndu[0][0] = 1
  const left = new Array<number>(p + 1).fill(0)
  const right = new Array<number>(p + 1).fill(0)
  for (let j = 1; j <= p; j++) {
    left[j] = u - knots[span + 1 - j]
    right[j] = knots[span + j] - u
    let saved = 0
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r]
      const temp = ndu[r][j - 1] / ndu[j][r]
      ndu[r][j] = saved + right[r + 1] * temp
      saved = left[j - r] * temp
    }
    ndu[j][j] = saved
  }
  const ders = Array.from({ length: nd + 1 }, () => new Array<number>(p + 1).fill(0))
  for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p]
  for (let r = 0; r <= p; r++) {
    const a = [new Array<number>(p + 1).fill(0), new Array<number>(p + 1).fill(0)]
    let s1 = 0
    let s2 = 1
    a[0][0] = 1
    for (let k = 1; k <= nd; k++) {
      let d = 0
      const rk = r - k
      const pk = p - k
      if (r >= k) {
        a[s2][0] = a[s1][0] / ndu[pk + 1][rk]
        d = a[s2][0] * ndu[rk][pk]
      }
      const j1 = rk >= -1 ? 1 : -rk
      const j2 = r - 1 <= pk ? k - 1 : p - r
      for (let j = j1; j <= j2; j++) {
        a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j]
        d += a[s2][j] * ndu[rk + j][pk]
      }
      if (r <= pk) {
        a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r]
        d += a[s2][k] * ndu[r][pk]
      }
      ders[k][r] = d
      ;[s1, s2] = [s2, s1]
    }
  }
  let f = p
  for (let k = 1; k <= nd; k++) {
    for (let j = 0; j <= p; j++) ders[k][j] *= f
    f *= p - k
  }
  return ders
}

/** The solution of a tridiagonal system (row i: sub[i] x[i-1] + diag[i] x[i] + sup[i] x[i+1] =
 * rhs[i], each rhs a row of numbers). Without pivoting: B-spline collocation matrices are totally
 * positive (de Boor), so elimination in order is stable. */
export function _thomas(sub: readonly number[], diag: readonly number[], sup: readonly number[], rhs: readonly (readonly number[])[]): number[][] {
  const n = diag.length
  const c = new Array<number>(n).fill(0)
  const d = rhs.map((r) => [...r])
  const w = n ? d[0].length : 0
  for (let i = 0; i < n; i++) {
    const m = diag[i] - (i ? sub[i] * c[i - 1] : 0)
    c[i] = i + 1 < n ? sup[i] / m : 0
    for (let q = 0; q < w; q++) d[i][q] = (d[i][q] - (i ? sub[i] * d[i - 1][q] : 0)) / m
  }
  for (let i = n - 2; i >= 0; i--) for (let q = 0; q < w; q++) d[i][q] -= c[i] * d[i + 1][q]
  return d
}

type V3 = [number, number, number]

/** Cubic interpolation through `points`: with end tangent conditions, or, for a closed curve without
 * tangents, periodic (curvature continuous at the seam as everywhere else). Only the basis functions
 * that are not zero at each point are evaluated, and the system is tridiagonal (one row and column
 * more for a closed curve): linear in the number of points. */
export function _interpolate(points: Vector[], t0: Vector | null, t1: Vector | null, closed: boolean): Edge {
  const Q: V3[] = points.map((p) => p.toArray())
  if (closed && !points[0].isClose(points[points.length - 1])) Q.push([...Q[0]])
  const periodic = closed && t0 === null && t1 === null
  if (periodic && Q.length < 4) throw new RangeError('a closed spline needs at least three points')
  const chords = Q.slice(1).map((q, i) => Math.hypot(q[0] - Q[i][0], q[1] - Q[i][1], q[2] - Q[i][2]))
  if (chords.some((c) => c < 1e-12)) throw new RangeError('spline points must be distinct')
  const total = chords.reduce((s, c) => s + c, 0)
  // centripetal parameters reduce overshoot on uneven spacing
  const w = chords.map(Math.sqrt)
  const wsum = w.reduce((s, x) => s + x, 0)
  const u = [0]
  let acc = 0
  for (const x of w.slice(0, -1)) {
    acc += x
    u.push(acc / wsum)
  }
  u.push(1)
  const n = Q.length - 1
  const p = 3
  const knots = [0, 0, 0, 0, ...u.slice(1, -1), 1, 1, 1, 1]
  const m = n + 3 // control points
  const P: (number[] | null)[] = new Array(m).fill(null)
  const end0 = _basisDers(knots, p, p, 0, 2) // control points 0..3
  const end1 = _basisDers(knots, p, m - 1, 1, 2) // control points m-4..m-1
  const rows: number[][] = [] // row i: control points i..i+3
  for (let i = 1; i < n; i++) rows.push(_basisDers(knots, p, i + 3, u[i], 0)[0])
  P[0] = Q[0]
  P[m - 1] = Q[n]

  if (!periodic) {
    // derivative at u[at] of the parabola through three points
    const bessel = (i0: number, i1: number, i2: number, at: number): number[] => {
      const [ua, ub, uc] = [u[i0], u[i1], u[i2]]
      const x = u[at]
      const fa = (2 * x - ub - uc) / ((ua - ub) * (ua - uc))
      const fb = (2 * x - ua - uc) / ((ub - ua) * (ub - uc))
      const fc = (2 * x - ua - ub) / ((uc - ua) * (uc - ub))
      return [0, 1, 2].map((q) => Q[i0][q] * fa + Q[i1][q] * fb + Q[i2][q] * fc)
    }
    const given = (t: Vector): number[] => t.normalized().toArray().map((c) => c * total)
    const chord = [0, 1, 2].map((q) => Q[1][q] - Q[0][q])
    let D0: number[]
    let D1: number[]
    if (n === 1) {
      D0 = t0 === null ? chord : given(t0)
      D1 = t1 === null ? chord : given(t1)
    } else {
      D0 = t0 === null ? bessel(0, 1, 2, 0) : given(t0)
      D1 = t1 === null ? bessel(n - 2, n - 1, n, n) : given(t1)
    }
    // the end derivatives give the second and the second last control points
    const P1 = [0, 1, 2].map((q) => (D0[q] - end0[1][0] * Q[0][q]) / end0[1][1])
    const Pm2 = [0, 1, 2].map((q) => (D1[q] - end1[1][3] * Q[n][q]) / end1[1][2])
    P[1] = P1
    P[m - 2] = Pm2
    // control points 2 .. m-3 from the points 1 .. n-1
    const sub: number[] = []
    const diag: number[] = []
    const sup: number[] = []
    const rhs: number[][] = []
    for (let i = 1; i < n; i++) {
      const N = rows[i - 1]
      let r: number[] = [...Q[i]]
      if (i === 1) r = [0, 1, 2].map((q) => r[q] - N[0] * P1[q])
      if (i === n - 1) r = [0, 1, 2].map((q) => r[q] - N[2] * Pm2[q])
      sub.push(i > 1 ? N[0] : 0)
      diag.push(N[1])
      sup.push(i < n - 1 ? N[2] : 0)
      rhs.push(r)
    }
    if (rhs.length) _thomas(sub, diag, sup, rhs).forEach((x, j) => { P[2 + j] = x })
  } else {
    // Unknowns: control points 1 .. m-2 (y[0] .. y[k]); the first and last are the seam point.
    // Rows: the first and second derivatives equal at both ends of the seam, and the points
    // 1 .. n-1. Ordered as below the matrix is tridiagonal but for corners; the last unknown is
    // eliminated (Schur complement) and the rest solved by two tridiagonal solves.
    const k = m - 3
    const seam = (order: number): [Map<number, number>, number[]] => {
      const row = new Map<number, number>()
      let rhs = [0, 0, 0]
      const terms: [number, number][] = [...[0, 1, 2, 3].map((j): [number, number] => [j, end0[order][j]]),
        ...[0, 1, 2, 3].map((j): [number, number] => [m - 4 + j, -end1[order][j]])]
      for (const [j, cf] of terms) {
        if (j === 0 || j === m - 1) rhs = [0, 1, 2].map((q) => rhs[q] - cf * Q[0][q])
        else if (cf) row.set(j - 1, (row.get(j - 1) ?? 0) + cf)
      }
      return [row, rhs]
    }
    const [first, rFirst] = seam(1) // y[0] and y[k]
    const [last, rLast] = seam(2) // y[0], y[1], y[k-1], y[k]
    const sub = [0]
    const diag = [first.get(0) ?? 0]
    const sup = [0]
    const rhs: number[][] = [rFirst]
    const col = [first.get(k) ?? 0]
    for (let i = 1; i < n; i++) { // row i: y[i-1], y[i], y[i+1]
      const N = rows[i - 1]
      sub.push(N[0])
      diag.push(N[1])
      sup.push(i + 1 < k ? N[2] : 0)
      col.push(i + 1 === k ? N[2] : 0)
      rhs.push([...Q[i]])
    }
    const X = _thomas(sub, diag, sup, rhs)
    const Z = _thomas(sub, diag, sup, col.map((c) => [c]))
    let aBB = last.get(k) ?? 0
    for (const [j, cf] of last) if (j < k) aBB -= cf * Z[j][0]
    if (Math.abs(aBB) < 1e-300) throw new RangeError('Spline: the closed curve through these points cannot be made')
    const yk = [0, 1, 2].map((q) => {
      let r = rLast[q]
      for (const [j, cf] of last) if (j < k) r -= cf * X[j][q]
      return r / aBB
    })
    for (let j = 0; j < k; j++) P[1 + j] = [0, 1, 2].map((q) => X[j][q] - Z[j][0] * yk[q])
    P[m - 2] = yk
  }
  return kernelCall('Spline', () => Edge._fromCurve(_canonicalCurve(P as number[][], knots, p, null)))
}

/**
 * A smooth cubic curve through the points: `Spline([0, 0], [10, 5], [20, 0])`.
 *
 * Options: `tangents`, the `[start, end]` tangent directions (either may be null), or one direction
 * for every point (an array as long as the points: the curve passes through each point in its
 * direction); `closed` makes a closed loop (smooth at the join).
 */
export function Spline(
  ...args: (VectorLike | readonly VectorLike[] | { tangents?: readonly (VectorLike | null)[] | null; closed?: boolean })[]
): Edge {
  const { items, options } = _withOptions<{ tangents?: readonly (VectorLike | null)[] | null; closed?: boolean }>(args)
  _opts('Spline', options)
  const pts = _pts(items)
  const closed = options.closed ?? false
  if (pts.length < 2) throw new RangeError('a spline needs at least two points')
  let t0: Vector | null = null
  let t1: Vector | null = null
  const tangents = options.tangents
  if (tangents != null && tangents.length === pts.length && pts.length > 2) return _throughTangents(pts, [...tangents], closed)
  if (tangents != null) {
    if (tangents.length !== 2) throw new RangeError(`Spline: tangents are (start, end) or one per point (${pts.length}), got ${tangents.length}`)
    t0 = tangents[0] != null ? _vec(tangents[0]) : null
    t1 = tangents[1] != null ? _vec(tangents[1]) : null
  }
  if (pts.length === 2 && t0 === null && t1 === null && !closed) return Line(pts[0], pts[1])
  return _interpolate(pts, t0, t1, closed)
}

/** A cubic B-spline through the points in the direction given at each. */
function _throughTangents(pts: Vector[], tangents: (VectorLike | null)[], closed: boolean): Edge {
  if (tangents.some((x) => x == null)) throw new RangeError('Spline: with a tangent for every point, none of them may be null')
  let dirs = tangents.map((x) => _vec(x as VectorLike))
  dirs.forEach((d, i) => {
    if (!(d.length > 0)) throw new RangeError(`Spline: tangent ${i + 1} has no direction`)
  })
  if (closed && !pts[0].isClose(pts[pts.length - 1])) {
    pts = [...pts, pts[0]]
    dirs = [...dirs, dirs[0]]
  }
  const r = kernelCall('Spline', () => ext.interpolate_tangents(pts.flatMap((p) => p.toArray()), dirs.flatMap((d) => d.toArray()), 3),
    'the points must be distinct')
  return Edge._fromCurve(r[0])
}

/**
 * A smooth curve near many points, with as few control points as keep it within `tolerance` of
 * every one: for scanned or digitized outlines, sampled curves and long polylines, where `Spline`
 * passes through every point, follows every wiggle and needs a control point per point.
 *
 * `points`: the points in order along the curve (2D points lie at z = 0). Options: `tolerance`, the
 * largest distance from any point to the curve (default: 1/1000 of the size of the points);
 * `degree`, the highest degree of the curve, 2 to 9 (the fit starts at 2 and raises it as it
 * needs); `tangents`, optional `[start, end]` directions, either may be null (not for closed
 * curves); `closed`, a closed curve through the first point again and tangent there.
 *
 * Few points (fewer than about six) give the curve through them (`Spline`). Where no fit keeps
 * within the tolerance, a ModelingError gives the distance it reached.
 *
 *     const outline = fitCurve(scanPoints, { tolerance: 0.02 })
 */
export function fitCurve(
  points: Iterable<VectorLike>,
  options: { tolerance?: number | null; degree?: number; tangents?: readonly [VectorLike | null, VectorLike | null] | null; closed?: boolean } = {},
): Edge {
  _opts('fitCurve', options)
  const { tolerance = null, degree = 3, tangents = null, closed = false } = options
  let pts = [...points].map((p) => _vec(p))
  if (pts.length < 2) throw new RangeError('fitCurve needs at least two points')
  if (!pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) {
    throw new RangeError('fitCurve: the points must be finite numbers')
  }
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) {
    const a = p.toArray()
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], a[i])
      hi[i] = Math.max(hi[i], a[i])
    }
  }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  if (size === 0) throw new RangeError('fitCurve: the points all coincide')
  const keep = [pts[0]]
  for (const p of pts.slice(1)) if (p.distanceTo(keep[keep.length - 1]) > 1e-12 * size) keep.push(p)
  if (closed && keep.length > 2 && keep[keep.length - 1].distanceTo(keep[0]) <= 1e-12 * size) keep.pop()
  pts = keep
  const tol = tolerance == null ? 1e-3 * size : tolerance
  if (!(typeof tol === 'number' && Number.isFinite(tol) && tol > 0)) throw new RangeError(`fitCurve: the tolerance must be positive, got ${String(tolerance)}`)
  if (!(Number.isInteger(degree) && degree >= 2 && degree <= 9)) throw new RangeError(`fitCurve: the degree is 2 to 9, got ${String(degree)}`)
  if (tangents != null && tangents.length !== 2) {
    throw new RangeError('fitCurve: tangents are [start, end]; for a direction at every point use Spline(..., { tangents: [...] })')
  }
  if (closed && tangents != null) throw new RangeError('fitCurve: a closed curve takes no end tangents')
  const t0 = tangents != null && tangents[0] != null ? _vec(tangents[0]).toArray() : []
  const t1 = tangents != null && tangents[1] != null ? _vec(tangents[1]).toArray() : []
  let r: Any
  try {
    r = kernelCall('fitCurve', () => ext.approximate_points(pts.flatMap((p) => p.toArray()), degree, tol, t0, t1, closed))
  } catch (e) {
    // too few points for an approximation: the curve through them
    if (!(e instanceof KernelError) || pts.length > 6) throw e
    return Spline(...pts, { tangents, closed })
  }
  const edge = Edge._fromCurve(r[0])
  const dev = Number(r[1])
  if (dev > tol) {
    throw new ModelingError(`fitCurve: the closest fit found passes ${_formatG(dev, 3)} from a point, more than the tolerance ${_formatG(tol)}; ` +
      'use a larger tolerance or a higher degree')
  }
  return edge
}

/** A Bézier curve (rational if `weights` are given) from its control points. */
export function Bezier(...args: (VectorLike | readonly VectorLike[] | { weights?: readonly number[] | null })[]): Edge {
  const { items, options } = _withOptions<{ weights?: readonly number[] | null }>(args)
  _opts('Bezier', options)
  const pts = _pts(items)
  if (pts.length < 2) throw new RangeError('a Bézier curve needs at least two control points')
  const p = pts.length - 1
  const knots = [...new Array(p + 1).fill(0), ...new Array(p + 1).fill(1)]
  return kernelCall('Bezier', () =>
    Edge._fromCurve(_canonicalCurve(pts.map((q) => q.toArray()), knots, p, options.weights != null ? [...options.weights] : null)),
  )
}

/**
 * A helix around `direction` through `center`.
 *
 * `direction` is a vector or an axis (only its direction counts; `center` places the helix).
 * `endRadius` makes a conical helix; `pitch` is the rise per turn. Any number of turns: beyond 120
 * the helix is fitted in pieces of whole turns, joined into one curve.
 */
export function Helix(
  pitch: number,
  height: number,
  radius: number,
  options: { center?: VectorLike; direction?: Axis | VectorLike; endRadius?: number | null; leftHanded?: boolean } = {},
): Edge {
  _opts('Helix', options, arguments.length)
  const { center = [0, 0, 0], direction = [0, 0, 1], endRadius = null, leftHanded = false } = options
  if (pitch <= 0 || height <= 0 || radius <= 0) throw new RangeError('pitch, height and radius must be positive')
  const turns = height / pitch
  const r1 = Number(endRadius ?? radius)
  const curve = kernelCall('Helix', () => _helixCurve(Number(pitch), Number(height), Number(radius), r1, Number(turns), !leftHanded))
  const plane = new Plane(_vec(center), null, _direction(direction, 'Helix'))
  return Edge._fromCurve(_transformCurve(curve, plane.location._m))
}

/**
 * A flat (Archimedean) spiral around the plane's origin: its radius grows (or shrinks) evenly with
 * the angle from `startRadius` to `endRadius` over `turns` turns. It starts on the plane's X axis and
 * turns counterclockwise seen from the plane's normal (`clockwise: true`: the other way). Either
 * radius may be 0 (a spiral from or to the center). For spiral springs, scroll grooves and coils; a
 * B-spline within 1e-4 of the exact spiral, as `Helix`, of any number of turns.
 *
 * `Spiral(2, 20, 5)` runs from (2, 0) to (20, 0) in five turns, 9/5 = 3.6 apart.
 */
export function Spiral(startRadius: number, endRadius: number, turns: number, plane: Plane = Plane.XY, options: { clockwise?: boolean } = {}): Edge {
  _opts('Spiral', options, arguments.length)
  const { clockwise = false } = options
  _finite('Spiral', { startRadius, endRadius, turns })
  if (startRadius < 0 || endRadius < 0) throw new RangeError('Spiral: the radii must not be negative')
  if (startRadius === endRadius) {
    throw new RangeError('Spiral: startRadius and endRadius must differ (equal ones go round one circle again and again; use CenterArc)')
  }
  if (turns <= 0) throw new RangeError('Spiral: turns must be positive')
  // The kernel's helix of a tiny height (at least 1e-7 a piece) flattened onto the plane: its
  // control points moved to z = 0, the exact projection of a curve within the tolerance of the helix,
  // whose projection is the spiral. The kernel takes radii from 1e-7: a spiral from or to the center
  // starts or ends at its first or last control point, moved there.
  const [r0, r1, n] = [Number(startRadius), Number(endRadius), Number(turns)]
  const height = 2e-7 * Math.max(1, n)
  const flat = kernelCall('Spiral', () => {
    const curve = _helixCurve(height / n, height, Math.max(r0, 1e-7), Math.max(r1, 1e-7), n, !clockwise)
    const d = ext.curve_data(curve)
    ext.delete_curve(curve)
    const poles: number[][] = d.poles.map((q: number[]) => [q[0], q[1], 0])
    if (r0 === 0) poles[0] = [0, 0, 0]
    if (r1 === 0) poles[poles.length - 1] = [0, 0, 0]
    return _canonicalCurve(poles, d.knots, d.degree, d.weights)
  })
  return _placed(flat, plane)
}

const _HELIX_PIECE_TURNS = 100 // (the kernel fits at most 124.25 turns in one go)

/** The kernel's helix along +Z from the origin; above 120 turns, pieces of whole turns (each starts
 * where the one before ends, on +X) joined into one B-spline. The caller owns the curve. */
function _helixCurve(pitch: number, height: number, r0: number, r1: number, turns: number, rightHanded: boolean): number {
  if (turns <= 120) return k.create_helix([0, 0, 0], height, r0, r1, turns, { right_handed: rightHanded })
  const counts: number[] = new Array(Math.floor(turns / _HELIX_PIECE_TURNS)).fill(_HELIX_PIECE_TURNS)
  const rest = turns - _HELIX_PIECE_TURNS * counts.length
  if (rest >= 1) counts.push(rest)
  else counts[counts.length - 1] += rest // (no sliver of a turn at the end)
  const pieces: number[] = []
  try {
    let z = 0
    counts.forEach((n, i) => {
      const h = i === counts.length - 1 ? height - z : n * pitch // (the last one ends at the height exactly)
      const ra = r0 + ((r1 - r0) * z) / height
      const rb = r0 + ((r1 - r0) * (z + h)) / height
      pieces.push(k.create_helix([0, 0, z], h, ra, rb, n, { right_handed: rightHanded }))
      z += h
    })
    return ext.join_curves(pieces)
  } finally {
    for (const c of pieces) ext.delete_curve(c)
  }
}

/** A polyline whose corners are rounded with `radius`:
 * `FilletPolyline([0, 0], [10, 0], [10, 10], { radius: 2 })`. */
export function FilletPolyline(...args: (VectorLike | readonly VectorLike[] | { radius: number; close?: boolean })[]): Wire {
  const { items, options } = _withOptions<{ radius: number; close?: boolean }>(args)
  _opts('FilletPolyline', options)
  if (options.radius == null) throw new TypeError("FilletPolyline: missing the option 'radius'")
  return Polyline(...(items as VectorLike[]), { close: options.close ?? false }).fillet(options.radius)
}

// ------------------------------------------------------------------------------- corner rounding
function _fp(v: Vector): string {
  return Math.abs(v.z) < 1e-9 ? `(${fmt(v.x)}, ${fmt(v.y)})` : `(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`
}

/** Round the corners of a wire (Wire.fillet): a planar wire's corners between lines and arcs exactly
 * in its plane (as Sketch.fillet), a wire that is not planar its corners between lines. Corners that
 * cannot be rounded throw, named or not; points that are not corners throw. */
export function _filletWire(wire: Wire, radius: number, vertices: Iterable<VectorLike | Vertex> | null): Wire {
  if (!(radius > 0)) throw new RangeError('fillet: the radius must be positive')
  const edges = [...wire.edges()]
  const n = edges.length
  const closed = wire.isClosed
  let size = 1
  for (const e of edges) for (const q of [e.start, e.end]) size = Math.max(size, Math.abs(q.x), Math.abs(q.y), Math.abs(q.z))
  const vtol = 1e-6 * size
  const joints = Array.from({ length: closed ? n : n - 1 }, (_, i) => i) // corner i: where edges[i] ends and edges[i + 1] starts
  let chosen = new Set(joints)
  if (vertices != null) {
    const targets = [...vertices].map((v) => (v instanceof Vertex ? v.point : _vec(v)))
    if (!targets.length) throw new RangeError('fillet: no corners given (the selection is empty)')
    chosen = new Set()
    const missing: Vector[] = []
    for (const t of targets) {
      const hits = joints.filter((i) => edges[i].end.distanceTo(t) <= vtol)
      if (!hits.length) missing.push(t)
      for (const i of hits) chosen.add(i)
    }
    if (missing.length) {
      const ends = closed ? [] : [wire.start, wire.end].filter((e) => missing.some((t) => e.distanceTo(t) <= vtol))
      if (ends.length) throw new ModelingError(`fillet: ${_fp(ends[0])} is an end of the open wire, not a corner`)
      const cornersAt = joints.map((i) => _fp(edges[i].end))
      const more = cornersAt.length > 12 ? ', ...' : ''
      const listed = cornersAt.length ? `its corners are at ${cornersAt.slice(0, 12).join(', ')}${more}` : 'it has no corners'
      throw new ModelingError(`fillet: ${missing.map(_fp).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a corner of the wire; ${listed}`)
    }
  }
  const named = vertices != null
  const hint = named ? '' : `; name the corners to round: wire.fillet(${fmt(radius)}, [corner points])`
  let fr: Frame | null
  try {
    fr = wireFrame(edges, null, 'fillet')
  } catch (e) {
    if (!(e instanceof RangeError)) throw e
    fr = null // not planar (or straight)
  }

  if (fr !== null) {
    const f = fr
    const fp = (z: Complex) => f.fp(z)
    const segs = edges.map((e) => segOfEdge(e, f))
    const tol = 1e-9 * Math.max(1, realSize(segs))
    const corners = new Map<number, Corner>()
    for (const i of [...chosen].sort((x, y) => x - y)) {
      const j = (i + 1) % n
      const s1 = segs[i]
      const s2 = segs[j]
      if (n === 1 || isSmooth(s1, s2)) {
        if (named) throw new ModelingError(`fillet: the corner at ${f.fp(s2.start)} is smooth (its edges meet tangentially), so there is nothing to round; leave it out`)
        continue
      }
      corners.set(j, new Corner('fillet', radius, `radius ${fmt(radius)}`))
    }
    if (!corners.size) return Wire._raw(edges)
    let created: Seg[]
    try {
      ;[created] = assemble(segs, new Array<string>(n).fill(''), corners, closed, tol, (j) => describe(segs[j], fp), fp, new CurveCorners(f, realSize(segs)))
    } catch (e) {
      if (!(e instanceof GeometryError)) throw e
      throw new RangeError(`fillet: ${e.message}`)
    }
    const kept = new Map<Seg, Edge>(segs.map((sg, i) => [sg, edges[i]]))
    let out = created.map((sg) => kept.get(sg) ?? Edge._fromCurve(curveOf(sg, f)))
    if (closed && corners.has(0)) out = [...out.slice(1), ...out.slice(0, 1)] // (the wire starts where it did: the arc of the corner at its start goes last)
    return Wire._raw(out)
  }

  // A wire that is not planar: corners between lines, each in the plane of its two lines.
  const cornerList: [number, number][] = [] // (index of incoming edge, index of outgoing edge)
  for (const i of [...chosen].sort((x, y) => x - y)) {
    const j = (i + 1) % n
    const a = edges[i]
    const b = edges[j]
    const u = a.tangentAt(1)
    const w = b.tangentAt(0)
    if (u.cross(w).length < 1e-9 && u.dot(w) > 0) {
      if (named) throw new ModelingError(`fillet: the corner at ${_fp(a.end)} is smooth (its edges meet tangentially), so there is nothing to round; leave it out`)
      continue
    }
    if (!a._isStraight() || !b._isStraight()) {
      const other = !a._isStraight() ? a : b
      throw new ModelingError(`fillet: the corner at ${_fp(a.end)} joins a ${other.geomType} edge of a wire that is not planar; fillet rounds the corners of such wires between lines only${hint}`)
    }
    if (u.isParallel(w)) throw new ModelingError(`fillet: the wire turns back on itself at ${_fp(a.end)}, so there is no corner to round`)
    cornerList.push([i, j])
  }

  // Each rounded corner moves the end of its incoming and the start of its outgoing line.
  const setbackEnd = new Array<number>(n).fill(0)
  const setbackStart = new Array<number>(n).fill(0)
  const arcs = new Map<number, Edge>()
  for (const [i, j] of cornerList) {
    const u = edges[i].direction
    const w = edges[j].direction
    const phi = _radians(u.angleTo(w))
    const d = radius * Math.tan(phi / 2)
    const v = edges[i].end
    const p1 = v.sub(u.mul(d))
    const p2 = v.add(w.mul(d))
    const bis = w.sub(u).normalized()
    const center = v.add(bis.mul(radius / Math.cos(phi / 2)))
    const mid = center.add(v.sub(center).normalized().mul(radius))
    setbackEnd[i] = d
    setbackStart[j] = d
    arcs.set(i, ThreePointArc(p1, mid, p2))
  }

  const out: Edge[] = []
  edges.forEach((e, i) => {
    if (setbackStart[i] || setbackEnd[i]) {
      const length = e.length
      if (setbackStart[i] + setbackEnd[i] > length + 1e-9) throw new RangeError(`fillet radius ${_formatG(radius, 12)} is too large for the edge ${e}`)
      if (setbackStart[i] + setbackEnd[i] < length - 1e-9) {
        const d = e.direction
        out.push(Line(e.start.add(d.mul(setbackStart[i])), e.end.sub(d.mul(setbackEnd[i]))))
      }
    } else {
      out.push(e)
    }
    const arc = arcs.get(i)
    if (arc) out.push(arc)
  })
  return Wire._raw(out)
}

/**
 * Copies of the curves as B-splines of one degree and one knot vector, with the same shapes: their
 * control points correspond one to one, as surfaces through the curves (a loft, a skin) need them
 * in other systems. Lines and arcs become B-splines too (arcs rational ones).
 *
 * @param edges Two or more edges (or arrays of them).
 */
export function makeCompatible(...edges: (Edge | Iterable<Edge>)[]): Edge[] {
  const flat: Edge[] = []
  for (const e of edges) flat.push(...(e instanceof Edge || e instanceof Shape ? [e as Edge] : Array.from(e)))
  for (const e of flat) {
    if (!(e instanceof Edge)) {
      const hint = (e as unknown) instanceof Wire ? ' (pass wire.edges())' : ''
      throw new TypeError(`makeCompatible takes edges, not a ${_typeName(e)}${hint}`)
    }
  }
  if (flat.length < 2) throw new RangeError(`makeCompatible needs two or more edges, got ${flat.length}`)
  const curves: number[] = []
  try {
    for (const e of flat) { // every curve a B-spline of its own (a line or an arc is one of its own kind)
      let c = e._copyCurve()
      if (ext.curve_kind(c) !== 'bspline') {
        const d = ext.curve_data(c, true)
        ext.delete_curve(c)
        c = _canonicalCurve(d.poles, d.knots, d.degree, d.weights)
      }
      curves.push(c)
    }
    kernelCall('makeCompatible', () => k.make_curves_compatible(curves))
  } catch (e) {
    for (const c of curves) ext.delete_curve(c)
    throw e
  }
  return curves.map((c) => Edge._fromCurve(c))
}
