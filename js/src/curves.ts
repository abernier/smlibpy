// Curve constructors: lines, arcs, splines, helices.
//
// All return an Edge (one curve) or a Wire (a chain). Points may be given as [x, y] (z = 0),
// [x, y, z] or Vectors.

import { _opts, ext, k, kernelCall } from './kernel.ts'
import { type Axis, Location, Plane, Vector, type VectorLike, _degrees, _direction, _formatG, _radians, _vec } from './geometry.ts'
import { solve } from './_linalg.ts'
import { Edge, Shape, Vertex, Wire, _canonicalCurve, _transformCurve, _typeName } from './shapes.ts'

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

// ------------------------------------------------------------------------------- NURBS curves
/** Values (or derivatives) of all B-spline basis functions of degree `p` at `u`. */
export function _basis(knots: readonly number[], p: number, u: number, deriv = 0): number[] {
  const n = knots.length - p - 1
  let span: number
  if (u >= knots[n]) span = n - 1
  else {
    let right = 0 // numpy's searchsorted(knots, u, side="right")
    while (right < knots.length && knots[right] <= u) right++
    span = Math.max(p, Math.min(right - 1, n - 1))
  }
  let N = new Array<number>(knots.length - 1).fill(0)
  N[span] = 1
  let out: number[] | null = null
  for (let d = 1; d <= p; d++) {
    const nn = new Array<number>(knots.length - 1 - d).fill(0)
    for (let i = 0; i < nn.length; i++) {
      let a = 0
      let den = knots[i + d] - knots[i]
      if (den > 0) a += (deriv && d === p ? d / den : (u - knots[i]) / den) * N[i]
      den = knots[i + d + 1] - knots[i + 1]
      if (den > 0) a += (deriv && d === p ? -d / den : (knots[i + d + 1] - u) / den) * N[i + 1]
      nn[i] = a
    }
    N = nn
    out = N
  }
  if (out === null) throw new Error('degree 0 basis')
  return out.slice(0, n)
}

type V3 = [number, number, number]

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]

/** Cubic interpolation through `points` with end tangent conditions. */
function _interpolate(points: Vector[], t0: Vector | null, t1: Vector | null, closed: boolean): Edge {
  const Q: V3[] = points.map((p) => p.toArray())
  if (closed) {
    if (!points[0].isClose(points[points.length - 1])) Q.push(Q[0])
    if (t0 === null && t1 === null) {
      const d = sub3(Q[1], Q[Q.length - 2])
      t0 = t1 = new Vector(d)
    }
  }
  const chords = Q.slice(1).map((q, i) => Math.hypot(...sub3(q, Q[i])))
  if (chords.some((c) => c < 1e-12)) throw new RangeError('spline points must be distinct')
  const total = chords.reduce((s, c) => s + c, 0)
  // centripetal parameters reduce overshoot on uneven spacing
  const w = chords.map(Math.sqrt)
  const wsum = w.reduce((s, x) => s + x, 0)
  const u = [0]
  let acc = 0
  for (const x of w) {
    acc += x
    u.push(acc / wsum)
  }
  const n = Q.length - 1

  // derivative at u[at] of the parabola through three points
  const bessel = (i0: number, i1: number, i2: number, at: number): V3 => {
    const [ua, ub, uc] = [u[i0], u[i1], u[i2]]
    const [A, B, C] = [Q[i0], Q[i1], Q[i2]]
    const x = u[at]
    return add3(
      add3(mul3(A, (2 * x - ub - uc) / ((ua - ub) * (ua - uc))), mul3(B, (2 * x - ua - uc) / ((ub - ua) * (ub - uc)))),
      mul3(C, (2 * x - ua - ub) / ((uc - ua) * (uc - ub))),
    )
  }

  let D0: V3
  let D1: V3
  if (n === 1) {
    D0 = t0 === null ? sub3(Q[1], Q[0]) : mul3(t0.normalized().toArray(), total)
    D1 = t1 === null ? sub3(Q[1], Q[0]) : mul3(t1.normalized().toArray(), total)
  } else {
    D0 = t0 === null ? bessel(0, 1, 2, 0) : mul3(t0.normalized().toArray(), total)
    D1 = t1 === null ? bessel(n - 2, n - 1, n, n) : mul3(t1.normalized().toArray(), total)
  }
  const p = 3
  const knots = [0, 0, 0, 0, ...u.slice(1, -1), 1, 1, 1, 1]
  const A: number[][] = []
  const B: number[][] = []
  A.push(_basis(knots, p, 0))
  B.push(Q[0])
  A.push(_basis(knots, p, 0, 1))
  B.push(D0)
  for (let i = 1; i < n; i++) {
    A.push(_basis(knots, p, u[i]))
    B.push(Q[i])
  }
  A.push(_basis(knots, p, 1, 1))
  B.push(D1)
  A.push(_basis(knots, p, 1))
  B.push(Q[n])
  const P = solve(A, B)
  return kernelCall('Spline', () => Edge._fromCurve(_canonicalCurve(P, knots, p, null)))
}

/**
 * A smooth cubic curve through the points: `Spline([0, 0], [10, 5], [20, 0])`.
 *
 * Options: `tangents`, the `[start, end]` tangent directions (either may be null); `closed`
 * makes a closed loop (smooth at the join).
 */
export function Spline(
  ...args: (VectorLike | readonly VectorLike[] | { tangents?: readonly [VectorLike | null, VectorLike | null] | null; closed?: boolean })[]
): Edge {
  const { items, options } = _withOptions<{ tangents?: readonly [VectorLike | null, VectorLike | null] | null; closed?: boolean }>(args)
  _opts('Spline', options)
  const pts = _pts(items)
  const closed = options.closed ?? false
  if (pts.length < 2) throw new RangeError('a spline needs at least two points')
  let t0: Vector | null = null
  let t1: Vector | null = null
  if (options.tangents != null) {
    t0 = options.tangents[0] != null ? _vec(options.tangents[0]) : null
    t1 = options.tangents[1] != null ? _vec(options.tangents[1]) : null
  }
  if (pts.length === 2 && t0 === null && t1 === null && !closed) return Line(pts[0], pts[1])
  return _interpolate(pts, t0, t1, closed)
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
 * `endRadius` makes a conical helix; `pitch` is the rise per turn.
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
  const curve = kernelCall('Helix', () =>
    k.create_helix([0, 0, 0], Number(height), Number(radius), Number(endRadius ?? radius), Number(turns), { right_handed: !leftHanded }),
  )
  const plane = new Plane(_vec(center), null, _direction(direction, 'Helix'))
  return Edge._fromCurve(_transformCurve(curve, plane.location._m))
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
export function _filletWire(wire: Wire, radius: number, vertices: Iterable<VectorLike | Vertex> | null): Wire {
  if (!(radius > 0)) throw new RangeError('fillet: the radius must be positive')
  const edges = [...wire.edges()]
  const n = edges.length
  const closed = wire.isClosed
  const targets = vertices != null ? [...vertices].map((v) => (v instanceof Vertex ? v.point : _vec(v))) : null

  const corners: [number, number][] = [] // (index of incoming edge, index of outgoing edge)
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n
    const a = edges[i]
    const b = edges[j]
    if (!a._isStraight() || !b._isStraight()) continue
    const corner = a.end
    if (targets !== null && !targets.some((t) => corner.isClose(t, 1e-6))) continue
    if (a.direction.isParallel(b.direction)) continue
    corners.push([i, j])
  }

  // Each rounded corner moves the end of its incoming and the start of its outgoing line.
  const setbackEnd = new Array<number>(n).fill(0)
  const setbackStart = new Array<number>(n).fill(0)
  const arcs = new Map<number, Edge>()
  for (const [i, j] of corners) {
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
