// STEP import: neutral B-rep data from step_reader.ts -> kernel bodies.
//
// Each face is rebuilt on an exact kernel surface, each edge as an exact curve spanning exactly that
// edge (lines, circular arcs, ellipses and NURBS keep their types). The topology of the file is
// kept: faces share their edges as they do in the file, so no stitching is needed. Bodies that
// still come out invalid are healed.

import { KernelError, ModelingError, ext, kernelCall } from './kernel.ts'
import type { Matrix } from './geometry.ts'
import { det3 } from './_linalg.ts'
import { Part, Shell, _list, type ShapeList } from './shapes.ts'
import { NotImplementedError, interpret, parse, type BodyData, type FaceData, type LoopData } from './step_reader.ts'
import { _fs } from './exporters.ts'

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
  /** The exact curve of edge `ei` from its start to its end vertex. */
  edgeSpec(ei: number): Any {
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
      const curve = this._freeCurve(s.curve)
      const vec = this.D(s.vector)
      const L2 = _dot(vec, vec)
      const base: V = curve.kind === 'bspline' ? curve.poles[0] : 'p0' in curve ? curve.p0 : curve.center
      const vs = this.facePoints(face).map((p) => _dot(_sub(p, base), vec) / L2)
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
function _largestGap(o: V, z: V, x: V, pts: V[]): V {
  const angs = pts.map((p) => _angleIn(o, z, x, p)).sort((a, b) => a - b)
  const gaps = angs.map((a, i) => _mod(angs[(i + 1) % angs.length] - a, 2 * Math.PI))
  const i = _argmax(gaps)
  const mid = angs[i] + gaps[i] / 2
  return _unit(_add(_mul(x, Math.cos(mid)), _mul(_cross(z, x), Math.sin(mid))))
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
  for (const loop of f.loops) {
    if (!loop.edges?.length) {
      if ('vertex' in loop) points.push(bld.P(bld.b.vertices[loop.vertex as number]))
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

function _buildBody(body: BodyData, m: Matrix, heal: boolean): Part | Shell {
  const bld = new _Builder(body, m)
  const mirrored = det3([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]) < 0
  if (mirrored) throw new ModelingError('mirrored assembly placements are not supported yet')
  const edges = bld.specs
  const faces: Any[] = []
  body.faces.forEach((face, fi) => {
    let f = face
    let loops: Any[] = []
    for (const loop of _outerFirst(bld, f.loops)) {
      if (loop.edges?.length) {
        for (const [ei] of loop.edges) if (!edges.has(ei)) edges.set(ei, bld.edgeSpec(ei))
        loops.push({ edges: loop.edges.map(([ei, fwd]) => [Math.trunc(ei), Boolean(fwd)]) })
      } else if ('vertex' in loop) loops.push({ vertex: bld.P(body.vertices[loop.vertex as number]) })
    }
    const srf = body.surfaces[f.surface]
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
    faces.push({ surface: bld.surfaceSpec(f), same_sense: Boolean(f.same_sense), loops })
  })
  const solid = body.kind === 'solid'
  const parts: (Part | Shell)[] = []
  const hint = 'the file may hold faces the kernel cannot rebuild'
  body.shells.forEach((sh, si) => {
    const closed = solid && Boolean(sh.closed ?? true)
    const shellFaces = sh.faces.map((i) => faces[i])
    // Cavities of a BREP_WITH_VOIDS are built as ordinary solids and subtracted later.
    const reversed = Boolean(sh.reversed) && !(solid && si > 0)
    const brep = kernelCall('import STEP', () => ext.build_brep(shellFaces, _edgeObject(edges), closed, reversed, false), hint)
    let part: Part | Shell = closed ? Part._wrap(brep) : Shell._wrap(brep)
    if (closed && !_positive(part as Part)) {
      const turned = kernelCall('import STEP', () => Part._wrap(ext.build_brep(shellFaces, _edgeObject(edges), closed, !reversed, false)))
      part.dispose()
      part = turned
    }
    if (heal && closed && !_sound(part as Part)) {
      // Only heal what came out broken: the kernel's healer can damage good bodies.
      try {
        const healed = part.heal()
        if (_sound(healed as Part)) {
          part.dispose()
          part = healed
        } else healed.dispose()
      } catch (e) {
        if (!(e instanceof KernelError)) throw e
      }
    }
    parts.push(part)
  })
  if (!parts.length) throw new ModelingError('empty body')
  let result = parts[0]
  if (solid && parts.length > 1) {
    for (const cavity of parts.slice(1)) result = (result as Part).cut(cavity as Part) // BREP_WITH_VOIDS: subtract the cavities
  } else if (parts.length > 1) {
    // a surface model of several shells stays a surface
    result = kernelCall('import STEP', () => Shell._wrap(ext.combine(parts.map((p) => p._brep))))
  }
  if (body.name) result.name = body.name
  if (body.color !== null) result.color = body.color
  return result
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

function _sound(part: Part): boolean {
  try {
    return Boolean(part.isValid()) && part._kernelProps(1e-4).volume > 0
  } catch (e) {
    if (e instanceof KernelError) return false
    throw e
  }
}

function _positive(part: Part): boolean {
  try {
    return part._kernelProps(1e-4).volume > 0
  } catch (e) {
    if (e instanceof KernelError) return false
    throw e
  }
}

/** The text of STEP file contents: bytes are Latin-1, as Python reads the file, and line ends
 * become "\n" (Python's universal newlines). */
function _text(data: string | Uint8Array): string {
  let text: string
  if (typeof data === 'string') text = data
  else if (ArrayBuffer.isView(data) || (data as unknown) instanceof ArrayBuffer) {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data as ArrayBuffer)
    text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  } else throw new TypeError("fromStep takes the file's contents: a string or a Uint8Array")
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Read the solids and surfaces of STEP file contents (AP203, AP214, AP242 B-rep data): the text,
 * or the bytes of the file.
 *
 * Returns a single `Part` (or `Shell`) when the file holds one body, otherwise a `ShapeList` of
 * them. Lengths are converted to millimeters; assembly placements are applied; names and colors
 * are kept. `heal` repairs bodies that come out invalid (valid ones are left alone; default true).
 */
export function fromStep(data: string | Uint8Array, options: { heal?: boolean } = {}): Part | Shell | ShapeList<Part | Shell> {
  const { heal = true } = options
  const sf = parse(_text(data))
  const bodies = interpret(sf)
  if (!bodies.length) throw new ModelingError('the STEP file holds no B-rep solids or surfaces')
  const out = _list(bodies.map(([b, m]) => _buildBody(b, m, heal)))
  return out.length === 1 ? out[0] : out
}

/**
 * Read the solids and surfaces of a STEP file (AP203, AP214, AP242 B-rep data).
 *
 * Returns a single `Part` (or `Shell`) when the file holds one body, otherwise a `ShapeList` of
 * them. Lengths are converted to millimeters; assembly placements are applied; names and colors
 * are kept. `heal` repairs bodies that come out invalid (valid ones are left alone; default true).
 */
export function importStep(path: string, options: { heal?: boolean } = {}): Part | Shell | ShapeList<Part | Shell> {
  return fromStep(_fs().readFileSync(String(path)), options)
}
