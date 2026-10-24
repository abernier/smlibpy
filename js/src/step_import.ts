// STEP import: neutral B-rep data from step_reader.ts -> kernel bodies.
//
// Each face is rebuilt on an exact kernel surface, each edge as an exact curve spanning exactly that
// edge (lines, circular arcs, ellipses and NURBS keep their types). The topology of the file is
// kept: faces share their edges as they do in the file, so no stitching is needed. Bodies that
// still come out invalid are healed, and stitched where their faces do not share their edges. A
// body that cannot be read is left out with a warning; the instances of a product in an assembly
// are built once and placed.

import { BrepHandle, KernelError, ModelingError, _crashOf, _isCrash, _opts, _warn, ext, k, kernelCall } from './kernel.ts'
import { type Location, type Matrix, Plane, Vector, _matmul } from './geometry.ts'
import { solve } from './_linalg.ts'
import { CenterArc, EllipticalArc, Line } from './curves.ts'
import { Edge, Part, Shell, Wire, _canonicalCurve, _list, _putFaceAttrs, _take, type ShapeList } from './shapes.ts'
import {
  NotImplementedError,
  _bodyError,
  _bodyLabel,
  _failure,
  _repr,
  analyticOffset,
  interpret,
  interpretExtras,
  parse,
  type BodyData,
  type FaceData,
  type LoopData,
  type StepFile,
} from './step_reader.ts'
import { _fs } from './exporters.ts'
import { type BytesLike, _asBytes } from './_bytes.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

// biome-ignore lint: curve and surface specs are plain objects of many shapes
type Any = any
type V = number[]

// -------------------------------------------------------------------------------- vectors
// (numpy's arithmetic, in its order)
function _add(a: V, b: V): V {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function _sub(a: V, b: V): V {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function _mul(a: V, s: number): V {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function _neg(a: V): V {
  return [-a[0], -a[1], -a[2]]
}

function _dot(a: V, b: V): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function _cross(a: V, b: V): V {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function _norm(a: V): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

function _unit(v: V): V {
  const n = _norm(v)
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** `a` less its part along the unit vector `z`. */
function _off(a: V, z: V): V {
  return _sub(a, _mul(z, _dot(a, z)))
}

// Python's float %: the sign of the divisor.
function _mod(a: number, b: number): number {
  let m = a % b
  if (m) {
    if (b < 0 !== m < 0) m += b
  } else m = b < 0 ? -0 : 0
  return m
}

// Python's math.degrees and max/min (the first of equal ones; a NaN is passed over as Python
// does).
function _degrees(rad: number): number {
  return rad * (180.0 / Math.PI)
}

function _max(xs: number[]): number {
  if (!xs.length) throw new RangeError('max() arg is an empty sequence')
  let m = xs[0]
  for (const x of xs) if (x > m) m = x
  return m
}

function _min(xs: number[]): number {
  if (!xs.length) throw new RangeError('min() arg is an empty sequence')
  let m = xs[0]
  for (const x of xs) if (x < m) m = x
  return m
}

// Python's round (half to even; a NaN or infinity cannot be an integer)
function _round(x: number): number {
  if (Number.isNaN(x)) throw new RangeError('cannot convert float NaN to integer')
  if (!Number.isFinite(x)) throw new RangeError('cannot convert float infinity to integer')
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

// Python's `x or y` of numbers (0 is false, a NaN is true)
function _or(x: number, y: number): number {
  return x === 0 ? y : x
}

// numpy's min and max of an array (a NaN wins)
function _npMin(xs: number[]): number {
  if (!xs.length) throw new RangeError('zero-size array to reduction operation minimum which has no identity')
  return xs.reduce((m, x) => Math.min(m, x))
}

function _npMax(xs: number[]): number {
  if (!xs.length) throw new RangeError('zero-size array to reduction operation maximum which has no identity')
  return xs.reduce((m, x) => Math.max(m, x))
}

/** numpy's argmax: the first largest (the first NaN if there is one). */
function _argmax(xs: number[]): number {
  let best = 0
  for (let i = 1; i < xs.length; i++) {
    if (Number.isNaN(xs[best])) break
    if (xs[i] > xs[best] || Number.isNaN(xs[i])) best = i
  }
  return best
}

function _angleIn(o: V, z: V, x: V, p: V): number {
  const y = _cross(z, x)
  const d = _sub(p, o)
  return Math.atan2(_dot(d, y), _dot(d, x))
}

// -------------------------------------------------------------------------------- builder
class _Builder {
  b: BodyData
  m: Matrix
  R: number[]
  t: V
  /** curve specs of the edges, filled while the faces are read (added seams included) */
  specs = new Map<number, Any>()
  /** closed edges whose start point must stay where it is: their vertex is shared with other
   * edges, or an added seam already ends there */
  pinned: Set<number>

  constructor(body: BodyData, m: Matrix) {
    this.b = body
    this.m = m
    this.R = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
    this.t = [m[3], m[7], m[11]]
    const uses = new Map<number, number>()
    for (const e of body.edges) for (const v of new Set([e.v0, e.v1])) uses.set(v, (uses.get(v) ?? 0) + 1)
    this.pinned = new Set<number>()
    body.edges.forEach((e, i) => {
      if ((uses.get(e.v0) as number) > 1) this.pinned.add(i)
    })
  }

  // -- transforms ---------------------------------------------------------------------------
  P(p: ArrayLike<number>): V {
    const R = this.R
    const t = this.t
    return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]]
  }

  D(d: ArrayLike<number>): V {
    const R = this.R
    return [R[0] * d[0] + R[1] * d[1] + R[2] * d[2], R[3] * d[0] + R[4] * d[1] + R[5] * d[2], R[6] * d[0] + R[7] * d[1] + R[8] * d[2]]
  }

  // -- edges --------------------------------------------------------------------------------
  /** The exact curve of edge `ei` from its start to its end vertex, with the ids of those vertices
   * (`v0`, `v1`: build_brep makes one kernel vertex per file vertex). */
  edgeSpec(ei: number): Any {
    const e = this.b.edges[ei]
    return { ...this._edgeCurve(ei), v0: Math.trunc(e.v0), v1: Math.trunc(e.v1) }
  }

  _edgeCurve(ei: number): Any {
    const e = this.b.edges[ei]
    const c = this.b.curves[e.curve]
    const p0 = this.P(this.b.vertices[e.v0])
    const p1 = this.P(this.b.vertices[e.v1])
    const closed = e.v0 === e.v1
    const kind = c.kind
    if (kind === 'line') return { kind: 'line', p0, p1 }
    if (kind === 'circle') {
      const o = this.P(c.origin)
      let z = _unit(this.D(c.z))
      if (!e.same_sense) z = _neg(z)
      const x = _unit(_off(_sub(p0, o), z))
      let sweep: number
      if (closed) sweep = 360.0
      else {
        const a = _mod(_degrees(_angleIn(o, z, x, p1)), 360.0)
        sweep = a > 1e-9 ? a : 360.0
      }
      return { kind: 'circle', center: o, z, x, radius: c.radius, sweep }
    }
    if (kind === 'ellipse') {
      const o = this.P(c.origin)
      const z = _unit(this.D(c.z))
      const xa = _unit(this.D(c.x))
      return { kind: 'ellipse', center: o, z, x: xa, r1: c.r1, r2: c.r2, p0, p1, forward: e.same_sense, closed }
    }
    if (kind === 'hyperbola' || kind === 'parabola') return _conicArc(c, this.P(c.origin), _unit(this.D(c.z)), _unit(this.D(c.x)), p0, p1)
    // NURBS
    const poles = (c.poles as V[]).map((p) => this.P(p))
    return { kind: 'bspline', degree: c.degree, poles, knots: [...c.knots], weights: c.weights, p0, p1, forward: e.same_sense, closed }
  }

  // -- surfaces -----------------------------------------------------------------------------
  /** Points along a loop in its direction. */
  loopPoints(loop: LoopData, n = 16): V[] {
    const out: V[] = []
    for (const [ei, fwd] of loop.edges as [number, boolean][]) {
      const p = _sample(this.specs.get(ei) ?? this.edgeSpec(ei), n)
      out.push(...(fwd ? p : p.reverse()))
    }
    return out
  }

  facePoints(face: FaceData): V[] {
    const pts: V[] = []
    for (const loop of face.loops) {
      if ('vertex' in loop && loop.edges == null) {
        pts.push(this.P(this.b.vertices[loop.vertex as number]))
        continue
      }
      for (const [ei] of loop.edges as [number, boolean][]) pts.push(..._sample(this.specs.get(ei) ?? this.edgeSpec(ei)))
    }
    return pts
  }

  surfaceSpec(face: FaceData): Any {
    const s = this.b.surfaces[face.surface]
    const kind = s.kind
    if (kind === 'plane' || kind === 'cylinder' || kind === 'cone' || kind === 'sphere' || kind === 'torus') {
      const o = this.P(s.origin)
      const z = _unit(this.D(s.z))
      const x = _unit(this.D(s.x))
      const spec: Any = { kind, origin: o, z, x }
      const pts = this.facePoints(face)
      if (kind === 'plane') {
        const y = _cross(z, x)
        const us = pts.map((p) => _dot(_sub(p, o), x))
        const vs = pts.map((p) => _dot(_sub(p, o), y))
        const lo = [_npMin(us), _npMin(vs)]
        const hi = [_npMax(us), _npMax(vs)]
        const pad = 0.05 * _max([hi[0] - lo[0], hi[1] - lo[1], 1e-6]) + 1e-6
        spec.domain = [lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad]
        return spec
      }
      // The surface's own seam (where its angle parameter starts) has to lie on the face's seam
      // edge, or, for a face without one, outside the face.
      if (face.frame != null) {
        // a seam was added to the face
        ;[spec.z, spec.x] = face.frame
      } else if (face.loops.some((loop) => loop.edges?.length && _isSeamLoop(loop))) {
        const seam = this.seamDirection(face, o, z)
        if (seam !== null) spec.x = seam
      } else if (pts.length) spec.x = _largestGap(o, z, x, pts)
      if (kind === 'cylinder' || kind === 'cone') {
        const h = pts.map((p) => _dot(_sub(p, o), z))
        const pad = 0.05 * _max([_max(h) - _min(h), 1e-6]) + 1e-6
        let lo = _min(h) - pad
        let hi = _max(h) + pad
        spec.radius = s.radius
        if (kind === 'cone') {
          let semi: number = s.semi_angle
          if (semi < 0) {
            // same cone with the axis reversed
            ;[semi, spec.z, lo, hi] = [-semi, _neg(spec.z), -hi, -lo]
          }
          const apex = semi > 1e-12 ? -s.radius / Math.tan(semi) : -Infinity
          lo = _max([lo, apex]) // the face cannot reach past the apex
          spec.semi_angle = semi
        }
        spec.height = [lo, hi]
      } else if (kind === 'sphere') spec.radius = s.radius
      else {
        spec.major = s.major
        spec.minor = s.minor
        // The seam around the tube (v = 0 on the outer equator) cannot be turned with the frame:
        // move the torus' v window so that it starts at the face's seam edge along the torus, or
        // else outside the face. A face that runs all the way around the tube without such an
        // edge gets one added later.
        const to: V = spec.origin
        const tz: V = spec.z
        const tubeAngle = (p: V): number => {
          const d = _sub(p, to)
          const h = _dot(d, tz)
          return Math.atan2(h, _norm(_sub(d, _mul(tz, h))) - s.major)
        }
        const loops = face.loops.filter((l) => l.edges?.length).map((l) => this.loopPoints(l))
        const seam = this.tubeSeam(face, tubeAngle)
        if (seam !== null || (pts.length && !loops.some((l) => _winding(l, tubeAngle)))) {
          const v0 = _degrees(seam !== null ? seam : _largestGapOf(pts.map(tubeAngle).sort((a, b) => a - b)))
          spec.v_start = _tubeWindowStart(v0)
        }
      }
      return spec
    }
    if (kind === 'bspline') {
      return {
        kind: 'bspline',
        u_degree: s.u_degree,
        v_degree: s.v_degree,
        nu: s.nu,
        nv: s.nv,
        poles: (s.poles as V[]).map((p) => this.P(p)),
        u_knots: s.u_knots,
        v_knots: s.v_knots,
        weights: s.weights,
      }
    }
    if (kind === 'extrusion') {
      let curve = this._freeCurve(s.curve)
      const vec = this.D(s.vector)
      const pts = this.facePoints(face)
      let vs: number[]
      if ((curve.kind === 'circle' || curve.kind === 'ellipse') && Math.abs(_dot(vec, curve.z)) > 1e-9 * _norm(vec)) {
        // a point of the surface lies v * vec above its generator's plane
        const { center, z: cz } = curve
        vs = pts.map((p) => _dot(_sub(p, center), cz) / _dot(vec, cz))
        curve = this._startOutside(curve, face, vec, pts)
      } else if (curve.kind === 'line') {
        // p = p0 + t (p1 - p0) + v vec
        const { p0, p1 } = curve
        vs = pts.map((p) => _lstsq2(_sub(p1, p0), vec, _sub(p, p0))[1])
      } else {
        // p = C(u) + v vec: v is p's height along vec less that of the generator's point, which
        // lies between the heights of the generator's poles
        const L2 = _dot(vec, vec)
        const gen: V[] = curve.kind === 'bspline' ? curve.poles : [curve.center]
        const g = gen.map((q) => _dot(_sub(q, gen[0]), vec) / L2)
        const heights = pts.map((p) => _dot(_sub(p, gen[0]), vec) / L2)
        vs = [_min(heights) - _npMax(g), _max(heights) - _npMin(g)]
      }
      const pad = 0.05 * _max([_max(vs) - _min(vs), 1e-6]) + 1e-6
      return { kind: 'extrusion', curve, vector: vec, v_range: [_min(vs) - pad, _max(vs) + pad] }
    }
    if (kind === 'revolution') {
      let curve = this._freeCurve(s.curve)
      const ao = this.P(s.axis_origin)
      const ad = _unit(this.D(s.axis))
      let target: V | null
      if (face.loops.some((loop) => loop.edges?.length && _isSeamLoop(loop))) target = this.seamDirection(face, ao, ad)
      else {
        const pts = this.facePoints(face)
        target = pts.length ? _largestGap(ao, ad, _generatorDirection(curve, ao, ad), pts) : null
      }
      if (target !== null) curve = _rotateGenerator(curve, ao, ad, target)
      return { kind: 'revolution', curve, axis_origin: ao, axis: ad }
    }
    if (kind === 'offset') return { kind: 'offset', basis: this._surfaceFrom(s.basis, face), distance: s.distance }
    throw new NotImplementedError(`surface ${kind}`)
  }

  /** Direction from the axis to the face's seam: an edge that a loop uses twice and that keeps one
   * angle about the axis (a ruling or a meridian). */
  seamDirection(face: FaceData, o: V, z: V): V | null {
    for (const loop of face.loops) {
      if (!loop.edges?.length) continue
      const uses = new Map<number, number>()
      for (const [ei] of loop.edges) uses.set(ei, (uses.get(ei) ?? 0) + 1)
      for (const [ei, n] of uses) {
        if (n < 2) continue
        const dirs: V[] = []
        for (const p of _sample(this.specs.get(ei) ?? this.edgeSpec(ei), 8)) {
          const r = _off(_sub(p, o), z)
          if (_norm(r) > 1e-9 * Math.max(1.0, _norm(_sub(p, o)))) dirs.push(_unit(r))
        }
        if (dirs.length && dirs.every((d) => _norm(_sub(d, dirs[0])) < 1e-3)) return dirs[Math.floor(dirs.length / 2)]
      }
    }
    return null
  }

  /** The angle around the tube of a torus face's seam edge that runs along the torus (an edge a
   * loop uses twice and that keeps one angle around the tube), or null. */
  tubeSeam(face: FaceData, tubeAngle: (p: V) => number): number | null {
    for (const loop of face.loops) {
      if (!loop.edges?.length) continue
      const edges = loop.edges
      // (Python goes through a set of these; a face has one at most)
      const twice = new Set(edges.map(([e]) => e).filter((e) => edges.filter(([x]) => x === e).length > 1))
      for (const ei of twice) {
        const angles = _sample(this.specs.get(ei) ?? this.edgeSpec(ei), 8).map(tubeAngle)
        if (angles.every((a) => Math.abs(_mod(a - angles[0] + Math.PI, 2 * Math.PI) - Math.PI) < 1e-6)) return angles[0]
      }
    }
    return null
  }

  /** A whole circle or ellipse, the generator of an extrusion, turned to start on the face's seam
   * edge, or where the face does not reach: the surface's seam is there. */
  _startOutside(curve: Any, face: FaceData, vec: V, pts: V[]): Any {
    const o: V = curve.center
    const z: V = curve.z
    const x: V = curve.x
    const y = _cross(z, x)
    const [r1, r2]: number[] = curve.kind === 'ellipse' ? [curve.r1, curve.r2] : [curve.radius, curve.radius]
    const param = (p: V): number => {
      let d = _sub(p, o)
      d = _sub(d, _mul(vec, _dot(d, z) / _dot(vec, z))) // along the extrusion into the generator's plane
      return Math.atan2(_dot(d, y) / r2, _dot(d, x) / r1)
    }
    let seam: number | null = null
    search: for (const loop of face.loops) {
      if (!loop.edges?.length) continue
      for (const [ei] of loop.edges) {
        if ((loop.edges as [number, boolean][]).filter(([e]) => e === ei).length > 1) {
          seam = ei
          break search
        }
      }
    }
    let t: number
    if (seam !== null) t = param(_sample(this.specs.get(seam) ?? this.edgeSpec(seam), 2)[0])
    else if (pts.length) t = _largestGapOf(pts.map(param).sort((a, b) => a - b))
    else return curve
    if (curve.kind === 'circle') return { ...curve, x: _unit(_add(_mul(x, Math.cos(t)), _mul(y, Math.sin(t)))) }
    const start = _add(_add(o, _mul(_mul(x, r1), Math.cos(t))), _mul(_mul(y, r2), Math.sin(t)))
    return { ...curve, p0: start, p1: start }
  }

  _surfaceFrom(s: Any, face: FaceData): Any {
    const saved = this.b.surfaces
    try {
      this.b.surfaces = [s]
      return this.surfaceSpec({ ...face, surface: 0 })
    } finally {
      this.b.surfaces = saved
    }
  }

  /** A whole curve (generator of an extrusion/revolution), as a bounded NURBS or line. */
  _freeCurve(c: Any): Any {
    const kind = c.kind
    if (kind === 'bspline') {
      return { kind: 'bspline', degree: c.degree, poles: (c.poles as V[]).map((p) => this.P(p)), knots: [...c.knots], weights: c.weights, whole: true }
    }
    if (kind === 'line') {
      const o = this.P(c.origin)
      const d = this.D(c.direction)
      return { kind: 'line', p0: _sub(o, _mul(d, 1e3)), p1: _add(o, _mul(d, 1e3)) }
    }
    if (kind === 'circle') {
      return { kind: 'circle', center: this.P(c.origin), z: _unit(this.D(c.z)), x: _unit(this.D(c.x)), radius: c.radius, sweep: 360.0 }
    }
    if (kind === 'ellipse') {
      // NX writes small roundings as extruded ellipses
      const o = this.P(c.origin)
      const x = _unit(this.D(c.x))
      const start = _add(o, _mul(x, c.r1))
      return { kind: 'ellipse', center: o, z: _unit(this.D(c.z)), x, r1: c.r1, r2: c.r2, p0: start, p1: start, forward: true, closed: true }
    }
    throw new NotImplementedError(`generator curve ${kind}`)
  }
}

/** The rotation by `angle` (radians) about the unit `axis`, row by row. */
function _rotation(axis: V, angle: number): number[][] {
  const [x, y, z] = axis
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const C = 1 - Math.cos(angle)
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ]
}

/** numpy's least squares solution (by the singular values, the small ones cut off) of
 * a s0 + b s1 = r for three-component columns a and b. */
function _lstsq2(a: V, b: V, r: V): [number, number] {
  // one-sided Jacobi: turn the columns until they are orthogonal
  let u = a.slice()
  let w = b.slice()
  let v = [1, 0, 0, 1] // the right singular vectors, column by column
  for (let sweep = 0; sweep < 32; sweep++) {
    const alpha = _dot(u, u)
    const beta = _dot(w, w)
    const gamma = _dot(u, w)
    if (gamma === 0 || Math.abs(gamma) <= 1e-17 * Math.sqrt(alpha * beta)) break
    const zeta = (beta - alpha) / (2 * gamma)
    const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta))
    const cs = 1 / Math.sqrt(1 + t * t)
    const sn = cs * t
    ;[u, w] = [_sub(_mul(u, cs), _mul(w, sn)), _add(_mul(u, sn), _mul(w, cs))]
    v = [v[0] * cs - v[2] * sn, v[1] * cs - v[3] * sn, v[0] * sn + v[2] * cs, v[1] * sn + v[3] * cs]
  }
  const s1 = _norm(u)
  const s2 = _norm(w)
  const cut = 2.220446049250313e-16 * 3 * Math.max(s1, s2)
  // s = V diag(1 / sigma) U^T r, without the singular values at or below the cut
  let x0 = 0
  let x1 = 0
  if (s1 > cut) {
    const k = _dot(u, r) / (s1 * s1)
    x0 += v[0] * k
    x1 += v[1] * k
  }
  if (s2 > cut) {
    const k = _dot(w, r) / (s2 * s2)
    x0 += v[2] * k
    x1 += v[3] * k
  }
  return [x0, x1]
}

/** The piece of a hyperbola or parabola between two of its points, as the exact (rational)
 * quadratic Bezier curve. */
function _conicArc(c: Any, o: V, z: V, x: V, p0: V, p1: V): Any {
  const y = _cross(z, x)
  let d0: V
  let d1: V
  let w: number
  if (c.kind === 'hyperbola') {
    // o + a cosh(t) x + b sinh(t) y
    const { a, b } = c
    const [t0, t1] = [p0, p1].map((p) => Math.asinh(_dot(_sub(p, o), y) / b))
    d0 = _add(_mul(_mul(x, a), Math.sinh(t0)), _mul(_mul(y, b), Math.cosh(t0)))
    d1 = _add(_mul(_mul(x, a), Math.sinh(t1)), _mul(_mul(y, b), Math.cosh(t1)))
    w = Math.cosh((t1 - t0) / 2)
  } else {
    // o + f t^2 x + 2 f t y
    const f = c.focal
    const [t0, t1] = [p0, p1].map((p) => _dot(_sub(p, o), y) / (2 * f))
    d0 = _add(_mul(_mul(_mul(x, 2), f), t0), _mul(_mul(y, 2), f))
    d1 = _add(_mul(_mul(_mul(x, 2), f), t1), _mul(_mul(y, 2), f))
    w = 1.0
  }
  // the middle pole is where the end tangents meet
  const [s] = _lstsq2(d0, _neg(d1), _sub(p1, p0))
  const mid = _add(p0, _mul(d0, s))
  return { kind: 'bspline', degree: 2, poles: [p0, mid, p1], knots: [0.0, 0.0, 0.0, 1.0, 1.0, 1.0], weights: [1.0, w, 1.0], p0, p1, forward: true, closed: false }
}

/** The direction about the axis in the middle of the largest angular gap between the points
 * (where a face without a seam edge does not reach). */
/** Where a torus' window around the tube starts (degrees, in [-360, 0]) for a seam at `v0`
 * (degrees, from atan2). A seam on the outer equator comes out of atan2 as a rounding error either
 * side of 0 (OpenCASCADE's O-rings: +6e-15), and 6e-15 - 360 is a window the kernel refuses: that
 * seam starts the window at 0. */
function _tubeWindowStart(v0: number): number {
  if (Math.abs(v0) < 1e-9) return 0.0
  return v0 > 0 ? v0 - 360.0 : v0
}

function _largestGap(o: V, z: V, x: V, pts: V[]): V {
  const mid = _largestGapOf(pts.map((p) => _angleIn(o, z, x, p)).sort((a, b) => a - b))
  return _unit(_add(_mul(x, Math.cos(mid)), _mul(_cross(z, x), Math.sin(mid))))
}

/** The angle in the middle of the largest gap between sorted angles (radians). */
function _largestGapOf(angs: number[]): number {
  let gaps = angs.map((a, i) => _mod(angs[(i + 1) % angs.length] - a, 2 * Math.PI))
  if (angs.length === 1) gaps = [2 * Math.PI]
  if (!gaps.length) throw new RangeError('attempt to get argmax of an empty sequence')
  const i = _argmax(gaps)
  return angs[i] + gaps[i] / 2
}

/** How many times a closed run of points goes around in the angle `angle(p)`. */
function _winding(pts: V[], angle: (p: V) => number): number {
  if (pts.length < 2) return 0
  const a = pts.map(angle)
  let turn = 0
  for (let i = 0; i < a.length; i++) turn += _mod(a[(i + 1) % a.length] - a[i] + Math.PI, 2 * Math.PI) - Math.PI
  return _round(turn / (2 * Math.PI))
}

/** Direction from the axis to a revolution's generator curve. */
function _generatorDirection(curve: Any, o: V, z: V): V {
  const pts: V[] = curve.kind === 'bspline' ? curve.poles : _sample(curve, 8)
  const r = pts.map((p) => _off(_sub(p, o), z))
  let ref = r[_argmax(r.map(_norm))]
  if (_norm(ref) < 1e-12) ref = _cross(z, Math.abs(z[0]) < 0.9 ? [1.0, 0.0, 0.0] : [0.0, 1.0, 0.0])
  return _unit(ref)
}

/** Turn a revolution's generator about the axis to `target`, where the surface's seam has to be.
 * The surface stays the same. */
function _rotateGenerator(curve: Any, o: V, z: V, target: V): Any {
  if (curve.kind !== 'bspline') return curve
  const x = _generatorDirection(curve, o, z)
  const angle = Math.atan2(_dot(_cross(x, target), z), _dot(x, target))
  const R = _rotation(z, angle)
  const poles = (curve.poles as V[]).map((p) => {
    const d = _sub(p, o)
    return [0, 1, 2].map((j) => d[0] * R[j][0] + d[1] * R[j][1] + d[2] * R[j][2] + o[j])
  })
  return { ...curve, poles }
}

function _circlePoint(spec: Any): V {
  return _add(spec.center, _mul(spec.x, spec.radius))
}

/** Circular arc around `center` from `a` to `b` that leaves `a` along `startDir`. */
function _arcSpec(center: V, a: V, b: V, startDir: V): Any {
  const x = _unit(_sub(a, center))
  const z = _unit(_cross(x, startDir))
  const y = _cross(z, x)
  const d = _sub(b, center)
  const ang = _mod(_degrees(Math.atan2(_dot(d, y), _dot(d, x))), 360.0)
  return { kind: 'circle', center, z, x, radius: _norm(_sub(a, center)), sweep: ang > 1e-9 ? ang : 360.0 }
}

/**
 * Faces on periodic surfaces bounded without a seam edge (NX writes a cylinder band as two
 * circles, a cone tip as a circle and a vertex): SMLib wants the seam, so add one along the
 * surface where the circles start. Returns the new loops and the frame (axis, seam direction) the
 * surface has to use, or null if the face needs none.
 */
function _addSeams(bld: _Builder, f: FaceData, srf: Any, seamId: number): [LoopData[], [V, V]] | null {
  const kind = srf.kind
  if (kind !== 'cylinder' && kind !== 'cone' && kind !== 'sphere' && kind !== 'torus') return null
  const specs = bld.specs
  const circles: [number, boolean][] = []
  const points: V[] = []
  const pointIds: number[] = []
  for (const loop of f.loops) {
    if (!loop.edges?.length) {
      if ('vertex' in loop) {
        points.push(bld.P(bld.b.vertices[loop.vertex as number]))
        pointIds.push(Math.trunc(loop.vertex as number))
      }
      continue
    }
    if (loop.edges.length !== 1) return null
    const [ei, fwd] = loop.edges[0]
    const s = specs.get(ei)
    if (s.kind !== 'circle' || s.sweep < 360.0 - 1e-9) return null
    circles.push([ei, fwd])
  }
  if (!circles.length || circles.length + points.length > 2) return null
  const o = bld.P(srf.origin)
  let z = _unit(bld.D(srf.z))
  if (kind === 'sphere') z = specs.get(circles[0][0]).z // any axis through the centre will do
  for (const [ei] of circles) {
    const c = specs.get(ei)
    const d = _sub(c.center, o)
    if (Math.abs(Math.abs(_dot(c.z, z)) - 1.0) > 1e-6 || _norm(_off(d, z)) > 1e-6 * _max([1.0, c.radius])) {
      return null // the circle does not run around the axis
    }
  }
  // the seam starts where a circle with a fixed start begins, else where the first one does
  const anchor = circles.find(([ei]) => bld.pinned.has(ei))?.[0] ?? circles[0][0]
  const r0 = _sub(_circlePoint(specs.get(anchor)), o)
  let sdir = _off(r0, z)
  if (_norm(sdir) < 1e-12) return null
  sdir = _unit(sdir)
  const moved = new Map<number, Any>()
  for (const [ei] of circles) {
    const c = specs.get(ei)
    const x = _unit(_off(sdir, c.z))
    if (!bld.pinned.has(ei)) moved.set(ei, { ...c, x })
    else if (_norm(_sub(x, c.x)) > 1e-9) return null // two circles fixed at different angles: no straight seam joins them
  }

  const spec = (ei: number): Any => moved.get(ei) ?? specs.get(ei)

  const normal = (p: V): V => {
    const r = _sub(p, o)
    const radial = _unit(_off(r, z))
    let n: V
    if (kind === 'sphere') n = r
    else if (kind === 'torus') n = _sub(p, _add(o, _mul(radial, srf.major)))
    else if (kind === 'cone') n = _sub(_mul(radial, Math.cos(srf.semi_angle)), _mul(z, Math.sin(srf.semi_angle)))
    else n = radial
    n = _unit(n)
    return f.same_sense ? n : _neg(n)
  }

  const [ea, fa] = circles[0]
  const pa = _circlePoint(spec(ea))
  const tangent = _mul(_cross(spec(ea).z, spec(ea).x), fa ? 1.0 : -1.0)
  const into = _cross(normal(pa), tangent) // the face lies left of its boundary
  let pb: V
  if (circles.length === 2) pb = _circlePoint(spec(circles[1][0]))
  else if (points.length) pb = points[0] // apex or pole
  else if (kind === 'cone' && Math.abs(srf.semi_angle) > 1e-12) pb = _sub(o, _mul(z, srf.radius / Math.tan(srf.semi_angle)))
  else if (kind === 'sphere') pb = _add(o, _mul(z, _dot(into, z) > 0 ? srf.radius : -srf.radius))
  else return null
  let seam: Any
  if (kind === 'cylinder' || kind === 'cone') seam = { kind: 'line', p0: pa, p1: pb }
  else seam = _arcSpec(kind === 'sphere' ? o : _add(o, _mul(sdir, srf.major)), pa, pb, into)
  // the seam runs between the vertices of the circles (or the apex or pole) it joins
  seam.v0 = Math.trunc(bld.b.edges[ea].v0)
  if (circles.length === 2) seam.v1 = Math.trunc(bld.b.edges[circles[1][0]].v0)
  else if (points.length) seam.v1 = pointIds[0]
  for (const [ei, c] of moved) specs.set(ei, c)
  specs.set(seamId, seam)
  for (const [ei] of circles) bld.pinned.add(ei)
  const edges: [number, boolean][] = [[ea, fa], [seamId, true], ...(circles.length === 2 ? [circles[1]] : []), [seamId, false]]
  return [[{ edges, outer: true }], [z, sdir]]
}

function _isSeamLoop(loop: LoopData): boolean {
  const seen = new Map<number, number>()
  for (const [ei] of loop.edges as [number, boolean][]) seen.set(ei, (seen.get(ei) ?? 0) + 1)
  for (const n of seen.values()) if (n > 1) return true
  return false
}

function _sample(spec: Any, n = 16): V[] {
  const kind = spec.kind
  if (kind === 'line') return [spec.p0, spec.p1]
  if (kind === 'circle') {
    const { center: o, z, x, radius: r } = spec
    const y = _cross(z, x)
    const out: V[] = []
    for (let i = 0; i <= n; i++) {
      const a = (spec.sweep * (Math.PI / 180) * i) / n
      out.push(_add(o, _mul(_add(_mul(x, Math.cos(a)), _mul(y, Math.sin(a))), r)))
    }
    return out
  }
  if (kind === 'ellipse') {
    const { center: o, z, x: xa, r1, r2 } = spec
    const y = _cross(z, xa)
    const param = (p: V): number => {
      const d = _sub(p, o)
      return Math.atan2(_dot(d, y) / r2, _dot(d, xa) / r1)
    }
    const t0 = param(spec.p0)
    let span = spec.closed ? 2 * Math.PI : _mod(param(spec.p1) - t0, 2 * Math.PI)
    if (!spec.forward) span = span ? span - 2 * Math.PI : -2 * Math.PI
    const out: V[] = []
    for (let i = 0; i <= n; i++) {
      const t = t0 + (span * i) / n
      out.push(_add(_add(o, _mul(_mul(xa, r1), Math.cos(t))), _mul(_mul(y, r2), Math.sin(t))))
    }
    return out
  }
  if (kind === 'bspline') return [...spec.poles] // the control polygon bounds the curve
  return []
}

/** The specs as the kernel takes them: an object keyed by edge number. */
function _edgeObject(specs: Map<number, Any>): Record<string, Any> {
  const out: Record<string, Any> = {}
  for (const [id, spec] of specs) out[String(id)] = spec
  return out
}

/** What the builder's messages call the import it builds for: "STEP", or "IGES" (iges_import.ts
 * builds its solids with it). */
let _source = 'STEP'

/** Runs `fn` with the builder's messages naming `source` (a format). */
export function _reading<T>(source: string, fn: () => T): T {
  const saved = _source
  _source = source
  try {
    return fn()
  } finally {
    _source = saved
  }
}

/** The operation a message of the builder names: `import STEP`, `import IGES: stitch`. */
function _op(rest = ''): string {
  return `import ${_source}${rest}`
}

/** How a message of the builder names a body (an IGES body by its directory entry). */
export function _label(body: BodyData): string {
  if (_source === 'IGES') {
    const kind = body.kind === 'solid' ? 'solid' : 'shell'
    return body.name ? `${kind} ${_repr(body.name)} (DE ${body.entity})` : `${kind} DE ${body.entity}`
  }
  return _bodyLabel(body.entity, body.name, body.product)
}

export function _buildBody(body: BodyData, m: Matrix, heal: boolean): Part | Shell {
  const bld = new _Builder(body, m)
  // (_bodies builds such a body unplaced and moves it whole)
  if (!_rigid(m)) throw new ModelingError('a placement that mirrors or scales cannot be built into a body')
  const edges = bld.specs
  const faceSpec = (fi: number, face: FaceData, srf: Any): Any => {
    let f = face
    let loops: Any[] = []
    for (const loop of _outerFirst(bld, f.loops)) {
      if (loop.edges?.length) {
        for (const [ei] of loop.edges) if (!edges.has(ei)) edges.set(ei, bld.edgeSpec(ei))
        loops.push({ edges: loop.edges.map(([ei, fwd]) => [Math.trunc(ei), Boolean(fwd)]) })
      } else if ('vertex' in loop) loops.push({ vertex: bld.P(body.vertices[loop.vertex as number]) })
    }
    const seamed = _addSeams(bld, f, srf, -1_000_000 - fi)
    if (seamed !== null) {
      const [newLoops, frame] = seamed
      f = { ...f, loops: newLoops, frame }
      loops = newLoops.map((l) => ({ edges: l.edges }))
    } else if (!loops.some((l) => 'edges' in l) && srf.kind === 'sphere') {
      // A whole sphere written with a point (or nothing) as its boundary: give it the
      // pole-to-pole seam that kernel spheres have, and drop the pole points.
      const seam = -1 - fi
      const o = bld.P(srf.origin)
      const z = _unit(bld.D(srf.z))
      const x = _unit(bld.D(srf.x))
      const y = _cross(z, x)
      edges.set(seam, { kind: 'circle', center: o, z: _neg(y), x: _neg(z), radius: srf.radius, sweep: 180.0 })
      loops = [
        {
          edges: [
            [seam, false],
            [seam, true],
          ],
        },
      ]
      f = { ...f, loops, frame: [z, x] }
    }
    // a face on a closed B-spline surface without a seam edge of its own may lie across the
    // surface's seam; build_brep moves the seam off it
    const freeSeam = srf.kind === 'bspline' && !loops.some((l) => l.edges?.length && _isSeamLoop(l))
    return { surface: bld._surfaceFrom(srf, f), same_sense: Boolean(f.same_sense), loops, free_seam: freeSeam, color: f.color ?? null, name: f.name || null }
  }
  const agreed = _agreeingLoops(body)
  const faces: Any[] = agreed.map((f, fi) => faceSpec(fi, f, body.surfaces[f.surface]))
  const solid = body.kind === 'solid'
  const parts: (Part | Shell)[] = []
  const built: [Any[], boolean][] = [] // the faces and orientation each shell was built with in the end
  const broken: string[] = [] // what is wrong with the closed shells heal and stitching could not repair
  const hint = 'the file may hold faces the kernel cannot rebuild'
  const buildShell = (shellFaces: Any[], closed: boolean, given: boolean): [Part | Shell, number | null, boolean] => {
    let reversed = given
    const brep = kernelCall(
      _op(),
      () => {
        let b = _attributed(ext.build_brep(shellFaces, _edgeObject(edges), closed, reversed, false), shellFaces)
        // A few writers flip a face's same_sense flag against its loops (which agree with the
        // loops of its neighbours): the loops decide.
        // (Faces that lack their seam have loops that do not close in the parameter plane, and no
        // sense to read.)
        let inverted = [...(ext.inverted_faces(b) as Iterable<number>)]
        if (inverted.length) {
          const unseamed = new Set((ext.seam_problems(b, { only: inverted }) as { face: number }[]).map((d) => d.face))
          inverted = inverted.filter((i) => !unseamed.has(i))
        }
        if (inverted.length && 2 * inverted.length < shellFaces.length) {
          for (const i of inverted) shellFaces[i] = { ...shellFaces[i], same_sense: !shellFaces[i].same_sense }
          ext.delete_brep(b)
          b = _attributed(ext.build_brep(shellFaces, _edgeObject(edges), closed, reversed, false), shellFaces)
        }
        return b
      },
      hint,
    )
    let [part, volume] = _withSeams<Part | Shell>(closed ? Part._wrap(brep) : Shell._wrap(brep))
    if (closed) {
      // (the kernel's coarse volume, integrated once per shell: its sign says which way round the
      // shell was built, and the checks below take it)
      if (volume === null) volume = _kernelVolume(part as Part)
      if (!(volume !== null && volume > 0)) {
        reversed = !reversed
        const [turned, v] = kernelCall(_op(), () =>
          _withSeams(Part._wrap(_attributed(ext.build_brep(shellFaces, _edgeObject(edges), closed, reversed, false), shellFaces))),
        )
        part.dispose()
        part = turned
        volume = v
      }
    }
    return [part, volume, reversed]
  }
  body.shells.forEach((sh, si) => {
    const closed = solid && Boolean(sh.closed ?? true)
    let shellFaces = sh.faces.map((i) => faces[i])
    // Cavities of a BREP_WITH_VOIDS are built as ordinary solids and subtracted later.
    const given = Boolean(sh.reversed) && !(solid && si > 0)
    let [part, volume, reversed] = buildShell(shellFaces, closed, given)
    // An offset of a plane, sphere, cylinder, cone or torus is a surface of that kind: where the kernel
    // cannot close a solid with such faces as offsets (an offset of a whole sphere, whose face has the
    // sphere's seam and poles: no solid, or one of another volume, 0 natively and a quarter in smlibwasm),
    // they are built on the surface they are.
    const plain = closed ? sh.faces.map((i) => analyticOffset(body.surfaces[agreed[i].surface])) : []
    if (plain.some((s) => s !== null)) {
      const retry = sh.faces.map((i, k) => (plain[k] !== null ? faceSpec(i, agreed[i], plain[k]) : { ...faces[i] }))
      let again: [Part | Shell, number | null, boolean] | null = null
      try {
        again = buildShell(retry, closed, given)
      } catch (e) {
        if (!(e instanceof KernelError || e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
      }
      let taken = false
      if (again !== null && _sound(again[0] as Part, again[1])) {
        const v = again[1] ?? _kernelVolume(again[0] as Part)
        const mine = volume ?? _kernelVolume(part as Part)
        // (the kernel's volumes to 1e-4: the same solid both ways agrees to far better than 1e-3)
        if (!_sound(part as Part, mine) || mine === null || v === null || Math.abs(mine - v) > 1e-3 * Math.abs(v)) {
          part.dispose()
          part = again[0]
          volume = v
          reversed = again[2]
          shellFaces = retry
          taken = true
        }
      }
      if (!taken) again?.[0].dispose()
    }
    built.push([shellFaces, reversed])
    if (heal && closed && !_sound(part as Part, volume)) {
      // Only repair what came out broken: the kernel's healer can damage good bodies.
      const [repaired, problem] = _repaired(part as Part, body)
      if (repaired !== part) part.dispose()
      part = repaired
      if (problem !== null) broken.push(problem)
    } else if (heal && !closed && _apart(body, sh.faces)) {
      const sewn = _sewn(part as Shell, body)
      if (sewn !== part) part.dispose()
      part = sewn
    }
    parts.push(part)
  })
  if (!parts.length) throw new ModelingError('empty body')
  let result = parts[0]
  if (solid && parts.length > 1) {
    // BREP_WITH_VOIDS
    result = _withCavities(result as Part, parts.slice(1) as Part[], built, edges)
  } else if (parts.length > 1) {
    // a surface model of several shells stays a surface
    result = kernelCall(_op(), () => Shell._wrap(ext.combine(parts.map((p) => p._brep))))
  }
  if (broken.length)
    _warn(`${_op()}: ${_label(body)} is not a valid solid (${broken[0]}); heal and stitching could not repair it`)
  if (body.name) result.name = body.name
  if (body.color !== null) result.color = body.color
  result._h.imported = true // (read from a file: its fillets run in the probe worker)
  return result
}

/** The Brep `ext.build_brep` built from `faces`, with their colors and names (the faces of the file,
 * in its order; kernel plan T5): the kernel carries them on through healing and seams. */
function _attributed(brep: number, faces: readonly Any[]): number {
  _putFaceAttrs(
    brep,
    faces.map((f) => f.color ?? null),
    faces.map((f) => f.name ?? null),
  )
  return brep
}

/** A solid with cavities (BREP_WITH_VOIDS), each built as a void region inside the solid, as the
 * file has it. The Boolean difference is the fallback; it fails where a cavity's faces come close
 * to the solid's (a ModelingError: the import names the body). */
function _withCavities(outer: Part, cavities: Part[], built: [Any[], boolean][], edges: Map<number, Any>): Part {
  // The volumes as smlibwasm integrates them, with the gaps between their faces: where faces do not
  // meet exactly (a cavity of two faces 1e-5 mm3 large, gaps of 1e-2 of a volume) the void region's
  // volume differs from the solid's less its cavities' by up to the gaps.
  const pieces = [outer._props(), ...cavities.map((c) => c._props())]
  const expected = pieces[0].volume - pieces.slice(1).reduce((sum, p) => sum + p.volume, 0)
  const tol = Math.max(1e-6 * Math.max(Math.abs(pieces[0].volume), 1.0), 2 * pieces.reduce((sum, p) => sum + p.gaps * Math.abs(p.volume), 0))
  // A cavity turned the wrong way adds its volume instead: a build is the right one when it is
  // within the tolerance and closer to the right volume than to that.
  const apart = pieces.slice(1).reduce((sum, p) => sum + Math.abs(p.volume), 0)
  const [faces, rev] = built[0]
  // The cavity's faces as when it was built as a solid of its own; the constructor's comments say
  // the other way round, so that is tried as well. The volume decides.
  for (const flip of [false, true]) {
    const voids = built.slice(1).map(([f, r]) => [f, r !== flip])
    let part: Part | null = null
    try {
      part = kernelCall(_op(': cavities'), () =>
        _withSeams(Part._wrap(_attributed(ext.build_brep(faces, _edgeObject(edges), true, rev, false, voids), [...faces, ...voids.flatMap(([f]) => f as Any[])])))[0],
      )
      if (part._solidProblem() === null) {
        const off = Math.abs(part._props().volume - expected)
        if (off <= tol && off < apart) return part
      }
    } catch (e) {
      if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e) // (a KernelError is one)
    }
    part?.dispose()
  }
  let result = outer
  try {
    for (const cavity of cavities) result = result.cut(cavity)
  } catch (e) {
    if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
    throw new ModelingError(`its cavities could not be built, neither as void regions nor by subtracting them (${e.message})`)
  }
  return result
}

const _SWEPT = ['cylinder', 'cone', 'sphere', 'torus', 'revolution', 'extrusion']

/**
 * The body with the seams its faces lack. A face on a cylinder, cone, revolution or extrusion
 * around which its loops run (NX writes the shank of a drill as the circle at one end and the
 * outline of its flat at the other) needs an edge along the surface's seam: without it the kernel
 * can neither mesh nor integrate the face. The kernel adds them; a solid that would come out
 * broken keeps its faces as they are. (The body given is disposed when the one returned is new.)
 * Returns the body and the kernel's coarse volume where that was integrated to check it (else
 * null).
 */
function _withSeams<B extends Part | Shell>(body: B): [B, number | null] {
  const faces = body.faces()
  const problems = ext.seam_problems(body._brep) as { face: number; missing: string }[]
  const lacking = problems.filter((d) => _SWEPT.includes(faces[d.face].geomType)).map((d) => d.face)
  // B-spline surfaces closed on themselves read right as written, unless a face runs all the way
  // around one without a seam edge (the hub of an impeller): the kernel cannot mesh it, and it
  // needs the seam as the others do. (The kernel says the same of small faces at a pole, which
  // mesh as they are and break when split.)
  const spline = problems.filter((d) => faces[d.face].geomType === 'bspline' && d.missing).map((d) => d.face)
  if (spline.length) {
    const unmeshed = _unmeshed(body)
    lacking.push(...[...new Set(spline)].filter((i) => unmeshed.has(i)).sort((a, b) => a - b))
  }
  if (!lacking.length) return [body, null]
  let fixed: B | null = null
  try {
    const copy = body._like(body._copyBrep()) as B
    fixed = copy
    kernelCall(_op(': seams'), () => ext.seam_problems(copy._brep, { fix: true, only: lacking }))
    // (a sheet cannot be checked for closure: it takes the kernel's seams)
    if (!(copy instanceof Part)) {
      body.dispose()
      return [copy, null]
    }
    const volume = _kernelVolume(copy)
    if (volume !== null && volume > 0 && copy._solidProblem(volume) === null) {
      body.dispose()
      return [copy, volume]
    }
  } catch (e) {
    if (!(e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
  }
  fixed?.dispose()
  return [body, null]
}

/** Indices of the faces the kernel's tessellation fails on (all of them if it fails as a whole). */
function _unmeshed(body: Part | Shell): Set<number> {
  try {
    const tol = Math.max(body.bbox().diagonal * 1e-3, 1e-6)
    const [mesh, failures] = ext.tessellate(body._brep, { chord_height_tolerance: tol, allow_partial: true, return_failures: true })
    if (mesh) ext.delete_polybrep(mesh)
    return new Set((failures as { face_index: number }[]).map((f) => Math.trunc(Number(f.face_index))))
  } catch {
    return new Set(Array.from({ length: body.faces().length }, (_, i) => i))
  }
}

/** Loops with the outer one first. Files that do not mark the outer bound get the loop with the
 * largest extent as outer loop (holes lie inside it). */
function _outerFirst(bld: _Builder, loops: LoopData[]): LoopData[] {
  if (loops.length < 2 || loops.some((l) => l.outer)) return [...loops].sort((p, q) => Number(!p.outer) - Number(!q.outer))
  const extent = (loop: LoopData): number => {
    if (!loop.edges?.length) return -1.0
    const pts = loop.edges.flatMap(([ei]) => _sample(bld.edgeSpec(ei), 8))
    const span = [0, 1, 2].map((j) => _npMax(pts.map((p) => p[j])) - _npMin(pts.map((p) => p[j])))
    return _norm(span)
  }
  const keyed = loops.map((loop) => [extent(loop), loop] as const)
  return keyed.sort((p, q) => q[0] - p[0]).map(([, loop]) => loop)
}

/** The faces of a solid with every loop running the way its neighbours say: in a closed shell each
 * edge between two faces is used once in each direction. A few writers flag a face's bound reversed
 * (fillets on tori, around holes and bosses); its loop then runs the wrong way round, and on a
 * surface closed on itself it bounds the rest of the surface instead. Of the two
 * ways to make the loops of a shell agree, the one that turns fewer loops round wins. A shell whose
 * loops cannot agree, or that would turn as many either way, stays as the file has it. */
function _agreeingLoops(body: BodyData): FaceData[] {
  const faces = body.faces
  if (body.kind !== 'solid') return faces
  const turn = new Set<string>() // "face,loop"
  for (const sh of body.shells) {
    if (!(sh.closed ?? true)) continue
    const nodes: [number, number][] = []
    for (const fi of sh.faces)
      faces[fi].loops.forEach((loop, li) => {
        if (loop.edges?.length) nodes.push([fi, li])
      })
    const uses = new Map<number, [number, boolean][]>()
    nodes.forEach(([fi, li], n) => {
      for (const [ei, fwd] of faces[fi].loops[li].edges as [number, boolean][]) {
        if (!uses.has(ei)) uses.set(ei, [])
        uses.get(ei)?.push([n, Boolean(fwd)])
      }
    })
    const links = new Map<number, [number, boolean][]>() // loop -> [(neighbour, same direction)]
    for (const us of uses.values()) {
      // (seams, edges along a gap in the shell and edges of more than two faces say nothing)
      if (us.length !== 2 || nodes[us[0][0]][0] === nodes[us[1][0]][0]) continue
      const [[a, fa], [b, fb]] = us
      if (!links.has(a)) links.set(a, [])
      if (!links.has(b)) links.set(b, [])
      links.get(a)?.push([b, fa === fb])
      links.get(b)?.push([a, fa === fb])
    }
    if ([...links.values()].some((near) => near.some(([, same]) => same))) {
      const turned = _turned(links)
      if (turned !== null) for (const n of turned) turn.add(`${nodes[n][0]},${nodes[n][1]}`)
    }
  }
  if (!turn.size) return faces
  return faces.map((f, fi) => {
    if (!f.loops.some((_, li) => turn.has(`${fi},${li}`))) return f
    return {
      ...f,
      loops: f.loops.map((loop, li) =>
        turn.has(`${fi},${li}`)
          ? { ...loop, edges: [...(loop.edges as [number, boolean][])].reverse().map(([ei, fwd]) => [ei, !fwd] as [number, boolean]) }
          : loop,
      ),
    }
  })
}

/** The loops to turn round so that every link joins two loops running opposite ways, in each
 * connected group the fewer of the two choices (none where both are as many); null if no choice
 * makes them all agree. */
function _turned(links: Map<number, [number, boolean][]>): number[] | null {
  const flip = new Map<number, boolean>()
  const out: number[] = []
  for (const start of links.keys()) {
    if (flip.has(start)) continue
    flip.set(start, false)
    const group = [start]
    const todo = [start]
    while (todo.length) {
      const a = todo.pop() as number
      for (const [b, same] of links.get(a) as [number, boolean][]) {
        const want = flip.get(a) !== same // used the same way: one of the two turns round
        if (!flip.has(b)) {
          flip.set(b, want)
          group.push(b)
          todo.push(b)
        } else if (flip.get(b) !== want) return null
      }
    }
    const turned = group.filter((n) => flip.get(n))
    if (2 * turned.length < group.length) out.push(...turned)
    else if (2 * turned.length > group.length) out.push(...group.filter((n) => !flip.get(n)))
  }
  return out
}

/** The kernel's coarse volume of a built shell (1e-4), null where it cannot be integrated.
 * (Integrated once per shell: on a part of 2079 faces each integration takes 0.3 s, and the checks
 * of a shell asked for it three or four times.) */
export function _kernelVolume(part: Part): number | null {
  try {
    return Number(part._kernelProps(1e-4).volume)
  } catch (e) {
    if ((e instanceof KernelError) && !_isCrash(e)) return null
    throw e
  }
}

/** A closed, manifold solid of positive volume (`volume`: its kernel volume, if known). */
function _sound(part: Part, volume: number | null = null): boolean {
  try {
    if (part._shapeProblem() !== null) return false
    const v = volume ?? _kernelVolume(part)
    // (an integration over broken faces can come out a hair above 0: 1e-10 for an offset of a whole sphere
    // of radius 10 in smlibwasm)
    return v !== null && v > 1e-12 * part._looseBox().diagonal ** 3 && part._solidProblem(v) === null
  } catch (e) {
    if ((e instanceof KernelError) && !_isCrash(e)) return false
    throw e
  }
}

/** A broken solid repaired: healed, else stitched (faces that do not share their edges, edges
 * with gaps between them), each kept only if it gives a sound solid. Returns the part (the one
 * given if nothing helped) and what is still wrong with it (null: nothing). */
function _repaired(part: Part, body: BodyData): [Part, string | null] {
  try {
    const healed = part.heal()
    if (_sound(healed)) return [healed, null]
    healed.dispose()
  } catch (e) {
    if (!(e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
  }
  const stitched = _stitched(part, body)
  if (stitched !== null) {
    const [fixed, gap] = stitched
    _warn(
      `${_op()}: the faces of ${_label(body)} did not share their edges; stitched them, closing gaps of up to ${_g2(gap)} mm`,
    )
    return [fixed, null]
  }
  try {
    return [part, part._solidProblem() ?? 'not a sound solid']
  } catch (e) {
    if ((e instanceof KernelError) && !_isCrash(e)) return [part, 'a body whose volume cannot be integrated']
    throw e
  }
}

/** Python's `:.2g`. */
function _g2(x: number): string {
  if (x === 0) return '0'
  const e = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(2)))))
  if (e < -4 || e >= 2) {
    const [m, p] = x.toExponential(1).split('e')
    const exp = Number(p)
    return `${Number(m)}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
  }
  return String(Number(x.toPrecision(2)))
}

/** A broken closed shell sewn into a valid solid, with the largest gap closed; null if no stitch
 * gives one. The kernel's stitch first (it widens its own tolerance); then explicit tolerances,
 * doubling from the larger of the file's declared uncertainty and the gaps the kernel measured, up
 * to 1e-3 of the body's size. (The declared uncertainty alone is no guide: smlibwasm writes 1e-7
 * into files whose gaps reach 1e-3.) Each stitched body is healed where it needs to be (a seam the
 * stitch joined from two edges of the file lacks its face's seam), and kept only if it is a valid
 * solid, its faces' gaps measured too. */
function _stitched(part: Part, body: BodyData): [Part, number] | null {
  let measured = 0.0
  const attempt = (stitch: (brep: number) => void): Part | null => {
    const h = new BrepHandle(part._copyBrep())
    try {
      kernelCall(_op(': stitch'), () => stitch(h.brep))
      return _validOrHealed(Part._wrap(_take(h)))
    } catch (e) {
      if (!(e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
      return null
    } finally {
      h.dispose() // (nothing left to free once taken)
    }
  }
  const first = attempt((brep) => {
    const [, , , vgap, egap] = k.stitch_into_solid(brep)
    measured = Math.max(Number(vgap), Number(egap))
  })
  if (first !== null) return [first, measured]
  let tol = Math.max(body.uncertainty ?? 0.0, measured, 1e-7)
  const cap = 1e-3 * part._extent()
  while (tol <= cap) {
    const t = tol
    const candidate = attempt((brep) => k.stitch_advanced(brep, t))
    if (candidate !== null) return [candidate, tol]
    tol *= 2
  }
  return null
}

/** The part if it is a valid solid (`isValid()`: its faces' gaps measured too), else it healed if
 * that is one, else null. (A part not returned is disposed.) */
function _validOrHealed(part: Part): Part | null {
  const valid = (p: Part): boolean => _sound(p) && p._solidProblem(null, true) === null
  if (valid(part)) return part
  if (part._shapeProblem() === null) {
    // closed: the healer may mend its seams and gaps
    try {
      const healed = part.heal()
      if (valid(healed)) {
        part.dispose()
        return healed
      }
      healed.dispose()
    } catch (e) {
      if (!(e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
    }
  }
  part.dispose()
  return null
}

/** Whether some faces of a shell share no edge with the others (in the file): the shell falls
 * apart into pieces that only stitching joins. */
function _apart(body: BodyData, faces: number[]): boolean {
  if (faces.length < 2) return false
  const group = new Map<number, number>(faces.map((fi) => [fi, fi]))
  const root = (f: number): number => {
    while (group.get(f) !== f) {
      group.set(f, group.get(group.get(f) as number) as number)
      f = group.get(f) as number
    }
    return f
  }
  const first = new Map<number, number>() // edge -> a face using it
  for (const fi of faces)
    for (const loop of body.faces[fi].loops)
      for (const [ei] of loop.edges ?? []) {
        if (first.has(ei)) group.set(root(fi), root(first.get(ei) as number))
        else first.set(ei, fi)
      }
  return new Set(faces.map(root)).size > 1
}

/** A sheet whose faces share no edges with each other in the file, sewn along the edges that meet
 * within 1e-3 of its size (kept if anything was sewn). */
function _sewn(sheet: Shell, body: BodyData): Shell {
  const h = new BrepHandle(sheet._copyBrep())
  try {
    const tol = Math.max(body.uncertainty ?? 0.0, 1e-3 * sheet._looseBox().diagonal)
    const [, , stitched, vgap, egap] = kernelCall(_op(': stitch'), () => k.stitch_into_shell(h.brep, tol))
    if (Math.trunc(Number(stitched)) > 0) {
      _warn(
        `${_op()}: the faces of ${_label(body)} did not share their edges; stitched ${Math.trunc(Number(stitched))} edges, closing gaps of up to ${_g2(Math.max(Number(vgap), Number(egap)))} mm`,
      )
      return Shell._wrap(_take(h))
    }
  } catch (e) {
    if (!(e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
  } finally {
    h.dispose()
  }
  return sheet
}

/** Whether a placement only turns and moves (no mirror, no scale). */
function _rigid(m: Matrix): boolean {
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let d = 0
      for (let k = 0; k < 3; k++) d += m[k * 4 + i] * m[k * 4 + j]
      if (Math.abs(d - (i === j ? 1 : 0)) > 1e-9) return false
    }
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])
  return det > 0
}

function _identity4(): Matrix {
  return Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/** numpy's linalg.inv of a 4 x 4 matrix. */
function _inv4(m: Matrix): Matrix {
  const rows = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[r * 4 + c]))
  const eye = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (r === c ? 1 : 0)))
  return Float64Array.from(solve(rows, eye).flat())
}


/**
 * The bodies of a parsed file in file order, and what was left out (one message per body that
 * could not be read, with the number of its instances). `strict` throws a ModelingError for the
 * first body that cannot be read instead.
 *
 * An assembly lists a product once per instance, all with the same data: each is built once, at
 * its first placement, and its other instances are placed copies of it (a robot of 1472 instances
 * of 714 bodies built 135,856 faces for 53,293).
 */
function _bodies(sf: StepFile, heal: boolean, strict: boolean): [(Part | Shell)[], string[]] {
  const skipped: Any[] = []
  const found = interpret(sf, { skipped })
  if (strict && skipped.length) throw new ModelingError(`import STEP: ${skipped[0].message}`)
  const out: (Part | Shell)[] = []
  const built = new Map<BodyData, [Part | Shell, Matrix]>() // body -> (body, the placement it was built at)
  const failed = new Map<BodyData, [string, number]>() // body -> [message, instances]
  for (const [body, m] of found) {
    const fail = failed.get(body)
    if (fail !== undefined) {
      fail[1] += 1
      continue
    }
    try {
      let first = built.get(body)
      if (first === undefined) {
        // (a placement that mirrors or scales: the body is built where it is defined and moved there
        // whole, as Shape.mirror and Shape.scale move a body)
        const at = _rigid(m) ? m : _identity4()
        first = [_buildBody(body, at, heal), at]
        built.set(body, first)
        if (at === m) {
          out.push(first[0])
          continue
        }
      }
      out.push(first[0]._transformed(_matmul(m, _inv4(first[1]))) as Part | Shell)
    } catch (e) {
      if (!_bodyError(e) || _isCrash(e)) throw _crashOf(e)
      const message = `${_bodyLabel(body.entity, body.name, body.product)}: ${_failure(e)}`
      if (strict) throw new ModelingError(`import STEP: ${message}`)
      failed.set(body, [message, 1])
    }
  }
  const notes = skipped.map((s) => String(s.message))
  for (const [message, n] of failed.values()) notes.push(message + (n > 1 ? ` (${n} instances)` : ''))
  for (const note of notes) _warn(`import STEP: left out ${note}`)
  return [out, notes]
}

// -------------------------------------------------------------------------------- readStep
/** Python's == of the fields of its dataclasses: shapes, planes and vectors by `equals`, colors
 * component by component. */
function _same(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => _same(x, b[i]))
  const eq = (a as { equals?: (o: unknown) => boolean }).equals
  return typeof eq === 'function' ? eq.call(a, b) : a === b
}

/** A coordinate system of a STEP file (a named `AXIS2_PLACEMENT_3D`) at its place in the
 * assembly. `product` names the part or assembly it belongs to. */
export class StepFrame {
  readonly name: string
  readonly plane: Plane
  readonly product: string
  /** [r, g, b] from 0 to 1, or null */
  readonly color: readonly number[] | null

  constructor(name: string, plane: Plane, product = '', color: readonly number[] | null = null) {
    this.name = name
    this.plane = plane
    this.product = product
    this.color = color
    Object.freeze(this)
  }

  /** The placement that moves the world origin onto this coordinate system. */
  get location(): Location {
    return this.plane.location
  }

  equals(other: unknown): boolean {
    return (
      other instanceof StepFrame &&
      this.name === other.name &&
      _same(this.plane, other.plane) &&
      this.product === other.product &&
      _same(this.color, other.color)
    )
  }

  toString(): string {
    return `StepFrame(${_repr(this.name)}, product=${_repr(this.product)}, ${this.plane})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** A curve of a STEP file that belongs to no body (wireframe geometry, contours), at its place in
 * the assembly: an `Edge`, or a `Wire` for a composite curve. */
export class StepCurve {
  readonly name: string
  readonly shape: Edge | Wire
  readonly product: string
  /** [r, g, b] from 0 to 1, or null */
  readonly color: readonly number[] | null

  constructor(name: string, shape: Edge | Wire, product = '', color: readonly number[] | null = null) {
    this.name = name
    this.shape = shape
    this.product = product
    this.color = color
    Object.freeze(this)
  }

  equals(other: unknown): boolean {
    return (
      other instanceof StepCurve &&
      this.name === other.name &&
      _same(this.shape, other.shape) &&
      this.product === other.product &&
      _same(this.color, other.color)
    )
  }

  toString(): string {
    return `StepCurve(${_repr(this.name)}, product=${_repr(this.product)}, ${this.shape})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** A point of a STEP file that belongs to no body, at its place in the assembly. */
export class StepPoint {
  readonly name: string
  readonly point: Vector
  readonly product: string
  /** [r, g, b] from 0 to 1, or null */
  readonly color: readonly number[] | null

  constructor(name: string, point: Vector, product = '', color: readonly number[] | null = null) {
    this.name = name
    this.point = point
    this.product = product
    this.color = color
    Object.freeze(this)
  }

  equals(other: unknown): boolean {
    return (
      other instanceof StepPoint &&
      this.name === other.name &&
      _same(this.point, other.point) &&
      this.product === other.product &&
      _same(this.color, other.color)
    )
  }

  toString(): string {
    return `StepPoint(${_repr(this.name)}, product=${_repr(this.product)}, ${this.point})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** Everything `readStep` reads from a STEP file: the bodies (what `importStep` returns, always as
 * a list), and the coordinate systems, curves and points that belong to no body. `skipped` says
 * which bodies could not be read, and why (`"body 'b' (#99): curve type CLOTHOID (#203),
 * which is not supported"`). */
export class StepModel {
  readonly bodies: ShapeList<Part | Shell>
  readonly frames: StepFrame[]
  readonly curves: StepCurve[]
  readonly points: StepPoint[]
  readonly skipped: string[]

  constructor(
    bodies: ShapeList<Part | Shell>,
    frames: StepFrame[] = [],
    curves: StepCurve[] = [],
    points: StepPoint[] = [],
    skipped: string[] = [],
  ) {
    this.bodies = bodies
    this.frames = frames
    this.curves = curves
    this.points = points
    this.skipped = skipped
    Object.freeze(this)
  }

  /** The coordinate system called `name` as a `Plane`. Where several have that name (each part of
   * a tool assembly has its own `MCS`), `product` picks the one of the product whose name is or
   * begins with it. */
  frame(name: string, product: string | null = null): Plane {
    const found = this.frames.filter((f) => f.name === name && (product === null || f.product.startsWith(product)))
    if (found.length === 1) return found[0].plane
    if (!found.length) {
      const names = [...new Set(this.frames.map((f) => f.name))].sort()
      throw new RangeError(
        `no coordinate system ${_repr(name)}${product ? ` in product ${_repr(product)}` : ''}${
          names.length ? `; there are ${names.map(_repr).join(', ')}` : '; the file has none'
        }`,
      )
    }
    throw new RangeError(
      `${found.length} coordinate systems are called ${_repr(name)}, in ${found.map((f) => _repr(f.product)).join(', ')}: choose one with frame(name, product)`,
    )
  }

  equals(other: unknown): boolean {
    return (
      other instanceof StepModel &&
      _same(this.bodies, other.bodies) &&
      _same(this.frames, other.frames) &&
      _same(this.curves, other.curves) &&
      _same(this.points, other.points) &&
      _same(this.skipped, other.skipped)
    )
  }

  toString(): string {
    return `StepModel(${this.bodies.length} bodies, ${this.frames.length} frames, ${this.curves.length} curves, ${this.points.length} points${
      this.skipped.length ? `, ${this.skipped.length} skipped` : ''
    })`
  }

  [inspect](): string {
    return this.toString()
  }
}

/**
 * Read everything STEP file contents hold that smlibwasm can use (the text, or the bytes of the
 * file): its bodies, and the coordinate systems, curves and points that belong to no body.
 *
 * `readStep` for the contents in memory (in the browser too); see `readStep`.
 */
export function fromStepModel(data: string | BytesLike, options: { heal?: boolean; strict?: boolean } = {}): StepModel {
  _opts('fromStepModel', options)
  const { heal = true, strict = false } = options
  const sf = parse(_text(data, 'fromStepModel'))
  const [found, skipped] = _bodies(sf, heal, strict)
  const bodies = _list(found)
  const frames: StepFrame[] = []
  const curves: StepCurve[] = []
  const points: StepPoint[] = []
  for (const item of interpretExtras(sf)) {
    const { name, product, color } = item
    if (item.kind === 'frame') frames.push(new StepFrame(name, new Plane(item.origin, item.x, item.z), product, color))
    else if (item.kind === 'point') points.push(new StepPoint(name, new Vector(item.point), product, color))
    else {
      let shape: Edge | Wire | null
      try {
        shape = _curveShape(item.curve)
      } catch (e) {
        if (!(e instanceof KernelError || e instanceof RangeError) || _isCrash(e)) throw _crashOf(e)
        shape = null
      }
      if (shape !== null) curves.push(new StepCurve(name, shape, product, color))
    }
  }
  return new StepModel(bodies, frames, curves, points, skipped)
}

/**
 * Read everything a STEP file holds that smlibwasm can use: its bodies, and the coordinate systems,
 * curves and points that belong to no body.
 *
 * The bodies are those of `importStep`, as a `ShapeList` also when there is one. Coordinate
 * systems are the placements of supplemental geometry (as NX, CATIA and tool catalogs write
 * `MCS`, `PCS` or `CSW`) and the named placements of shape representations; curves and points are
 * the wireframe geometry (contours such as a tool's cutting edge line, curve sets, reference
 * points). Each carries its name and the product it belongs to, at its place in the assembly, in
 * millimeters. Items on hidden layers are left out. A file with no bodies gives an empty
 * `bodies`. `heal` as for `importStep` (default true). A body that cannot be read is left out with
 * a warning and listed in `skipped` (`strict: true` throws instead), as `importStep` does.
 */
export function readStep(path: string, options: { heal?: boolean; strict?: boolean } = {}): StepModel {
  _opts('readStep', options)
  return fromStepModel(_fs().readFileSync(String(path)), options)
}

/** An edge (a wire for a composite curve) from a curve of `interpretExtras`; null for one that
 * cannot be drawn. */
function _curveShape(c: Any): Edge | Wire | null {
  const kind = c.kind
  if (kind === 'composite') {
    const edges: Edge[] = []
    for (const [segment, same] of c.segments as [Any, boolean][]) {
      const s = _curveShape(segment)
      if (s === null) return null
      const parts = s instanceof Wire ? [...s.edges()] : [s]
      edges.push(...(same ? parts : parts.reverse().map((e) => e.reversed())))
    }
    return edges.length > 1 ? Wire._raw(edges) : edges.length ? edges[0] : null
  }
  if (kind === 'trimmed') return _trimmedEdge(c.basis, c.trims, c.sense)
  if (kind === 'bspline') return Edge._fromCurve(_bsplineCurve(c))
  if (kind === 'circle' || kind === 'ellipse') return _conicEdge(c, 0.0, 2 * Math.PI)
  return null
}

function _bsplineCurve(c: Any): number {
  return kernelCall('read STEP curve', () => _canonicalCurve(c.poles, c.knots, c.degree, c.weights))
}

/** A circle or ellipse from angle `t0` to `t1` (radians, the direction they say). */
function _conicEdge(c: Any, t0: number, t1: number): Edge {
  const plane = new Plane(c.origin, c.x, c.z)
  const a0 = _degrees(t0)
  let span = _degrees(t1 - t0)
  if (Math.abs(span) < 1e-12 || Math.abs(span) >= 360.0 - 1e-9) span = span >= 0 ? 360.0 : -360.0
  if (c.kind === 'circle') return CenterArc([0, 0], c.radius, a0, span, plane)
  const [lo, hi] = span > 0 ? [a0, a0 + span] : [a0 + span, a0]
  const e = EllipticalArc([0, 0], c.r1, c.r2, lo, Math.abs(span) < 360.0 ? hi : lo, plane)
  return span > 0 ? e : e.reversed()
}

function _trimmedEdge(basis: Any, trims: Any[], sense: boolean): Edge | null {
  const kind = basis.kind

  const param = (trim: Any): number => {
    if ('param' in trim) return trim.param
    const d = _sub(trim.point, basis.origin ?? [0, 0, 0])
    if (kind === 'line') {
      const v: V = basis.direction
      return _dot(d, v) / _dot(v, v)
    }
    if (kind === 'circle' || kind === 'ellipse') {
      const { x, z } = basis
      const y = _cross(z, x)
      const [r1, r2]: number[] = kind === 'circle' ? [basis.radius, basis.radius] : [basis.r1, basis.r2]
      return Math.atan2(_dot(d, y) / r2, _dot(d, x) / r1)
    }
    throw new RangeError('no parameter')
  }

  if (kind === 'line') {
    const { origin: o, direction: v } = basis
    return Line(_add(o, _mul(v, param(trims[0]))), _add(o, _mul(v, param(trims[1]))))
  }
  if (kind === 'circle' || kind === 'ellipse') {
    const t0 = param(trims[0])
    let t1 = param(trims[1])
    const turn = 2 * Math.PI
    t1 = sense ? t0 + _or(_mod(t1 - t0, turn), turn) : t0 - _or(_mod(t0 - t1, turn), turn)
    return _conicEdge(basis, t0, t1)
  }
  if (kind === 'bspline') {
    const curve = _bsplineCurve(basis)
    const ts: number[] = []
    let part: number | null
    try {
      for (const trim of trims) {
        if ('param' in trim) ts.push(trim.param)
        else {
          const [, t] = k.curve_closest_point(curve, [...trim.point])
          ts.push(Number(t))
        }
      }
      const lo = _min(ts)
      const hi = _max(ts)
      part = kernelCall('read STEP curve', () => (hi - lo > 1e-12 ? (ext.trimmed_curve(curve, lo, hi) as number) : null))
    } finally {
      ext.delete_curve(curve)
    }
    if (part === null) return null
    const e = Edge._fromCurve(part)
    return ts[0] <= ts[1] === sense ? e : e.reversed()
  }
  return null
}

// -------------------------------------------------------------------------------- importStep
/** The text of STEP file contents: bytes are Latin-1, as Python reads the file, and line ends
 * become "\n" (Python's universal newlines). */
export function _text(data: string | BytesLike, caller = 'fromStep'): string {
  let text: string
  const bytes = _asBytes(data)
  if (typeof data === 'string') text = data
  else if (bytes !== null) {
    text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  } else throw new TypeError(`${caller} takes the file's contents: a string or bytes (a Uint8Array or an ArrayBuffer)`)
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Read the solids and surfaces of STEP file contents (AP203, AP214, AP242 B-rep data): the text,
 * or the bytes of the file.
 *
 * Returns a single `Part` (or `Shell`) when the file holds one body, otherwise a `ShapeList` of
 * them. Lengths are converted to millimeters; assembly placements are applied; names and colors
 * are kept. `heal` repairs bodies that come out invalid (valid ones are left alone; default
 * true): the kernel's healer, then stitching where faces do not share their edges,
 * each with a warning when it changed the body or could not repair it.
 *
 * A body that cannot be read (an entity smlibwasm does not read, one the kernel cannot build) is
 * left out with a warning that names it, its entity and the reason; the other bodies are read.
 * `strict: true` throws a `ModelingError` for it instead. A file none of whose bodies can be read
 * throws.
 */
export function fromStep(data: string | BytesLike, options: { heal?: boolean; strict?: boolean } = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('fromStep', options)
  const { heal = true, strict = false } = options
  const sf = parse(_text(data))
  const [found, skipped] = _bodies(sf, heal, strict)
  if (!found.length) {
    if (skipped.length)
      throw new ModelingError(`import STEP: no body of the file could be read: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; ...' : ''}`)
    throw new ModelingError('the STEP file holds no B-rep solids or surfaces')
  }
  const out = _list(found)
  return out.length === 1 ? out[0] : out
}

/**
 * Read the solids and surfaces of a STEP file (AP203, AP214, AP242 B-rep data).
 *
 * Returns a single `Part` (or `Shell`) when the file holds one body, otherwise a `ShapeList` of
 * them. Lengths are converted to millimeters; assembly placements are applied; names and colors
 * are kept. `heal` repairs bodies that come out invalid (valid ones are left alone; default true);
 * `strict` as for `fromStep`.
 */
export function importStep(path: string, options: { heal?: boolean; strict?: boolean } = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('importStep', options)
  return fromStep(_fs().readFileSync(String(path)), options)
}
