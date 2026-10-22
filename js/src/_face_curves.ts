// Curves on faces: the parts of a projection seen from the curve (`Part.project(..., { nearest:
// true })`) and drawings wrapped onto faces (`Face.wrap`).
//
// A projection onto a body along a direction (SmBrep::CreateParallelProjectionCurves) gives pieces
// on every face the direction meets: the near side, the far side and faces seen edge-on. The near
// ones are what a light along the direction from the curve paints: a point of a piece counts where
// the ray from its point of the curve meets the body there first. Pieces are cut where that changes.
//
// A wrapped drawing keeps its lengths along the two parameter lines of the face through the point
// it is placed at: x is the length along one, y along the other. On planes, cylinders and other
// faces whose parameter lines keep their lengths everywhere (as a label on a can) the drawing keeps
// all its lengths; on a cone or a doubly curved face only along those two lines. The face's own
// parameters are not used as lengths: on analytic faces they are those of the surface's NURBS form,
// whose speed varies (SmSurface::LiftCurve of a line of a cylinder's parameter plane is no helix:
// 0.16 off).

import { ModelingError, ext, k, kernelCall } from './kernel.ts'
import { Vector, type VectorLike, _formatG, _vec } from './geometry.ts'
import { Edge, type Face, ShapeList, Vertex, type _Body } from './shapes.ts'
import { Line, _interpolate } from './curves.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any

// ------------------------------------------------------------------------------- what the projection reaches first
const _SAMPLES = 17

/** The parts of projected pieces (each with its face) that the projection of `source` along `d`
 * reaches first. */
export function visiblePieces(body: _Body, source: Edge, pieces: readonly [Edge, Face][], d: Vector, size: number): Edge[] {
  const tol = 1e-6 * size
  const reach = 4 * size
  const seen = (q: Vector, face: Face): boolean => {
    if (Math.abs(face.normalAt(q).dot(d)) < 1e-9) return false // a face seen edge-on there gets nothing
    const back = Line(q.add(d.mul(tol)), q.sub(d.mul(reach)))
    const ss = source.intersections(back, { tolerance: 10 * tol }).map((c) => q.sub(c).dot(d)).filter((s) => s >= -10 * tol)
    if (!ss.length) return true // (where the point came from is not found: kept)
    const s = Math.min(...ss)
    const c = q.sub(d.mul(s))
    return !body.raycast(c, d).some((h) => h.distance < s - 10 * tol)
  }
  const out: Edge[] = []
  for (const [e, face] of pieces) {
    const fs = Array.from({ length: _SAMPLES }, (_, i) => (i + 0.5) / _SAMPLES)
    const vis = fs.map((f) => seen(e.pointAt(f), face))
    if (vis.every((x) => x)) {
      out.push(e)
      continue
    }
    if (!vis.some((x) => x)) continue
    const cuts = [0]
    const states = [vis[0]]
    for (let i = 0; i + 1 < _SAMPLES; i++) {
      if (vis[i] !== vis[i + 1]) {
        let a = fs[i]
        let b = fs[i + 1]
        for (let it = 0; it < 40; it++) {
          const m = (a + b) / 2
          if (seen(e.pointAt(m), face) === vis[i]) a = m
          else b = m
        }
        cuts.push((a + b) / 2)
        states.push(vis[i + 1])
      }
    }
    cuts.push(1)
    for (let i = 0; i < states.length; i++) {
      const [f0, f1] = [cuts[i], cuts[i + 1]]
      if (states[i] && f1 - f0 > 1e-9) out.push(f0 === 0 && f1 === 1 ? e : e.trim(f0, f1))
    }
  }
  return out
}

// ------------------------------------------------------------------------------- wrapping
const _GAUSS: [number, number][] = [[-0.906179845938664, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889],
  [0.5384693101056831, 0.4786286704993665], [0.906179845938664, 0.2369268850561891]]

function _derivatives(srf: number, uv: readonly [number, number][]): Any {
  return ext.surface_derivatives(srf, uv.flat())
}

const _norm3 = (a: ArrayLike<number>, i: number) => Math.hypot(a[3 * i], a[3 * i + 1], a[3 * i + 2])

function _bisectRight(a: readonly number[], x: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x < a[mid]) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Length along a parameter line of a surface: the parameter at a length from a start (cubic Hermite
 * in the length between 512 nodes; the lengths by 5-point Gauss per interval). */
class _ArcMap {
  readonly srf: number
  readonly alongU: boolean
  readonly fixed: number
  readonly closed: boolean
  t: number[]
  speed: number[]
  length: number[]
  total: number
  s0: number

  constructor(srf: number, alongU: boolean, fixed: number, lo: number, hi: number, start: number, closed: boolean) {
    this.srf = srf
    this.alongU = alongU
    this.fixed = fixed
    this.closed = closed
    const n = 512
    this.t = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n)
    const uv: [number, number][] = []
    for (let i = 0; i < n; i++) {
      const [a, b] = [this.t[i], this.t[i + 1]]
      for (const [x] of _GAUSS) {
        const t = (a + b) / 2 + ((b - a) / 2) * x
        uv.push(alongU ? [t, fixed] : [fixed, t])
      }
    }
    const key = alongU ? 'du' : 'dv'
    const g = _derivatives(srf, uv)[key]
    const nd = _derivatives(srf, this.t.map((t): [number, number] => (alongU ? [t, fixed] : [fixed, t])))[key]
    this.speed = this.t.map((_, i) => _norm3(nd, i))
    this.length = [0]
    for (let i = 0; i < n; i++) {
      const h = (this.t[i + 1] - this.t[i]) / 2
      let s = 0
      _GAUSS.forEach(([, w], j) => { s += w * _norm3(g, 5 * i + j) })
      this.length.push(this.length[i] + h * s)
    }
    this.total = this.length[n]
    this.s0 = this._lengthAt(start)
  }

  _lengthAt(t: number): number {
    const i = Math.min(Math.max(_bisectRight(this.t, t) - 1, 0), this.t.length - 2)
    const a = this.t[i]
    if (t <= a) return this.length[i]
    const uv = _GAUSS.map(([x]): [number, number] => {
      const p = (a + t) / 2 + ((t - a) / 2) * x
      return this.alongU ? [p, this.fixed] : [this.fixed, p]
    })
    const sp = _derivatives(this.srf, uv)[this.alongU ? 'du' : 'dv']
    let s = 0
    _GAUSS.forEach(([, w], j) => { s += w * _norm3(sp, j) })
    return this.length[i] + ((t - a) / 2) * s
  }

  /** The parameter at length `s` from the start (negative: back), null off the surface. */
  param(s: number): number | null {
    let L = this.s0 + s
    if (this.closed && this.total > 0) L = ((L % this.total) + this.total) % this.total
    else if (L < -1e-9 * Math.max(1, this.total) || L > this.total * (1 + 1e-12) + 1e-9) return null
    L = Math.min(Math.max(L, 0), this.total)
    const i = Math.min(Math.max(_bisectRight(this.length, L) - 1, 0), this.length.length - 2)
    const [L0, L1] = [this.length[i], this.length[i + 1]]
    const [t0, t1] = [this.t[i], this.t[i + 1]]
    const h = L1 - L0
    if (h <= 0) return t0
    const x = (L - L0) / h
    const [s0, s1] = [this.speed[i], this.speed[i + 1]]
    if (s0 <= 1e-12 * h || s1 <= 1e-12 * h) return t0 + (t1 - t0) * x // (a pole of the surface: linear there)
    const [m0, m1] = [h / s0, h / s1] // dt/dL, scaled to the interval
    const h00 = 2 * x ** 3 - 3 * x ** 2 + 1
    const h10 = x ** 3 - 2 * x ** 2 + x
    const h01 = -2 * x ** 3 + 3 * x ** 2
    const h11 = x ** 3 - x ** 2
    return h00 * t0 + h10 * m0 + h01 * t1 + h11 * m1
  }
}

/** Whether the surface meets itself across the parameter range (a cylinder around). */
function _closed(srf: number, alongU: boolean, lo: number, hi: number, otherLo: number, otherHi: number, tol: number): boolean {
  const uv: [number, number][] = []
  for (let j = 0; j < 5; j++) {
    const o = otherLo + ((otherHi - otherLo) * j) / 4
    if (alongU) uv.push([lo, o], [hi, o])
    else uv.push([o, lo], [o, hi])
  }
  const p = _derivatives(srf, uv).point
  for (let j = 0; j < 5; j++) {
    if (Math.hypot(p[6 * j] - p[6 * j + 3], p[6 * j + 1] - p[6 * j + 4], p[6 * j + 2] - p[6 * j + 5]) > tol) return false
  }
  return true
}

type Mapped = (xs: readonly number[], ys: readonly number[]) => [number[][], boolean[]]

/** The edges of a drawing on XY wrapped onto the face (see `Face.wrap`). */
export function wrap(face: Face, shape: unknown, at: VectorLike | Vertex | null, direction: VectorLike | null): ShapeList<Edge> {
  let edges: unknown[]
  if (shape instanceof Edge) edges = [shape]
  else if (shape !== null && typeof shape === 'object' && typeof (shape as Any).edges === 'function') edges = [...(shape as Any).edges()]
  else if (shape !== null && typeof shape === 'object' && Symbol.iterator in (shape as object)) {
    edges = [...(shape as Iterable<unknown>)].flatMap((it) => (it instanceof Edge ? [it] : typeof (it as Any)?.edges === 'function' ? [...(it as Any).edges()] : [it]))
  } else edges = []
  if (!edges.length || !edges.every((e) => e instanceof Edge)) {
    throw new TypeError(`wrap takes an edge, a wire, a sketch or a list of edges, not ${shape === null ? 'null' : typeof shape === 'object' ? (shape as object).constructor.name : typeof shape}`)
  }
  const f = face._f
  const srf: number = k.face_surface(f)
  const [[u0, v0], [u1, v1]] = k.face_uv_domain(f)
  const size = Math.max(1, face.bbox().diagonal)
  const tol = 1e-7 * size
  let ua: number
  let va: number
  if (at == null) { // (the middle of the face's parameters: on its surface, maybe in a hole)
    ua = (u0 + u1) / 2
    va = (v0 + v1) / 2
  } else {
    const p = at instanceof Vertex ? at.point : _vec(at)
    const [q, uvs] = k.surface_closest_point(srf, p.toArray())
    const off = _vec(q).distanceTo(p)
    if (off > 1e-6 * size) {
      throw new RangeError(`wrap: at must be a point of the face's surface; (${_formatG(p.x)}, ${_formatG(p.y)}, ${_formatG(p.z)}) is ${_formatG(off)} from it`)
    }
    ;[ua, va] = uvs[0]
  }
  const der = _derivatives(srf, [[ua, va]])
  const su = new Vector(der.du[0], der.du[1], der.du[2])
  const sv = new Vector(der.dv[0], der.dv[1], der.dv[2])
  const n = new Vector(k.face_outward_normal_at_uv(f, ua, va))
  if (su.length <= 1e-12 || sv.length <= 1e-12) {
    throw new ModelingError('wrap: the face has no directions at that point (a pole of its surface); place the drawing elsewhere with at')
  }
  const dd = direction == null ? su : _vec(direction)
  const dt = dd.sub(n.mul(dd.dot(n)))
  if (dt.length <= 1e-9 * dd.length) throw new RangeError('wrap: the direction is normal to the face there; give a direction along the face')
  const xAlongU = Math.abs(dt.dot(su.normalized())) >= Math.abs(dt.dot(sv.normalized()))
  const sx = dt.dot(xAlongU ? su : sv) > 0 ? 1 : -1
  const [ex, ey] = xAlongU ? [su, sv] : [sv, su]
  const sy = ex.mul(sx).cross(ey).dot(n) > 0 ? 1 : -1 // (seen from outside: x right, y up)
  const mu = new _ArcMap(srf, true, va, u0, u1, ua, _closed(srf, true, u0, u1, v0, v1, 1e-9 * size))
  const mv = new _ArcMap(srf, false, ua, v0, v1, va, _closed(srf, false, v0, v1, u0, u1, 1e-9 * size))
  const mapped: Mapped = (xs, ys) => {
    const uv: [number, number][] = []
    const ok: boolean[] = []
    xs.forEach((x, i) => {
      const y = ys[i]
      const [a, b] = xAlongU ? [mu.param(sx * x), mv.param(sy * y)] : [mu.param(sy * y), mv.param(sx * x)]
      ok.push(a !== null && b !== null)
      uv.push([a ?? ua, b ?? va])
    })
    const P = _derivatives(srf, uv).point
    return [uv.map((_, i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]), ok]
  }
  const out = new ShapeList<Edge>()
  for (const e of edges as Edge[]) {
    for (const w of _wrappedEdge(e, mapped, tol)) {
      const pieces: number[] = kernelCall('Face.wrap', () => ext.trim_to_face(f, [w._curve()], 100 * tol))
      for (const c of pieces) out.push(Edge._fromCurve(c))
    }
  }
  return out
}

/** Curves through the mapped points of an edge (split where it leaves the surface, the ends of each
 * part on the surface's border), each within `tol` of the mapping: cubic interpolation through
 * samples, twice as many until the middles between them are within the tolerance. */
function _wrappedEdge(e: Edge, mapped: Mapped, tol: number): Edge[] {
  const curve = e._curve()
  let [t0, t1] = e._range()
  if (e._rev) [t0, t1] = [t1, t0]
  const points = (ts: readonly number[]): [number[][], boolean[]] => {
    const qs = ts.map((t) => k.curve_evaluate(curve, t))
    return mapped(qs.map((q: Any) => q[0]), qs.map((q: Any) => q[1]))
  }
  const border = (good: number, bad: number): number => {
    for (let i = 0; i < 50; i++) {
      const m = (good + bad) / 2
      if (points([m])[1][0]) good = m
      else bad = m
    }
    return good
  }
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  for (let n = 16; ; n *= 2) {
    const ts = Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n)
    const [P, ok] = points(ts)
    const runs: number[][] = []
    ok.forEach((good, i) => {
      const last = runs[runs.length - 1]
      if (good && last && last[last.length - 1] === i - 1) last.push(i)
      else if (good) runs.push([i])
    })
    const parts: [number[], number[][]][] = [] // (parameters, points) of each part on the surface
    for (const run of runs) {
      let us = run.map((i) => ts[i])
      let ps = run.map((i) => P[i])
      if (run[0] > 0) {
        const u = border(ts[run[0]], ts[run[0] - 1])
        us.unshift(u)
        ps.unshift(points([u])[0][0])
      }
      if (run[run.length - 1] < n) {
        const u = border(ts[run[run.length - 1]], ts[run[run.length - 1] + 1])
        us.push(u)
        ps.push(points([u])[0][0])
      }
      const keep = [0, ...ps.map((_, i) => i).filter((i) => i > 0 && dist(ps[i], ps[i - 1]) > 1e-3 * tol)]
      us = keep.map((i) => us[i])
      ps = keep.map((i) => ps[i])
      if (ps.length >= 2) parts.push([us, ps])
    }
    const out: Edge[] = []
    let worst = 0
    for (const [us, ps] of parts) {
      const c = kernelCall('Face.wrap', () =>
        ps.length > 2 ? _interpolate(ps.map((q) => new Vector(q[0], q[1], q[2])), null, null, false) : Edge._fromCurve(k.create_line_segment(ps[0], ps[1])))
      out.push(c)
      const mids = us.slice(1).map((b, i) => (us[i] + b) / 2)
      const [Q, okm] = points(mids)
      Q.forEach((q, i) => {
        if (okm[i]) worst = Math.max(worst, c.distanceTo(q as VectorLike))
      })
    }
    if (worst <= tol) return out
    if (n >= 4096) throw new ModelingError(`wrap: the wrapped curve comes no closer than ${_formatG(worst, 3)} to the face's mapping of ${e}`)
  }
}
