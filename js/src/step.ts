// STEP (ISO 10303-21, AP214) writer for exact B-rep geometry.
//
// Planes, cylinders, cones, spheres, tori, lines, circles and ellipses are written as their
// analytic STEP entities, offset surfaces as OFFSET_SURFACEs of their basis, everything else as
// (rational) B-spline curves and surfaces with the kernel's exact control points and knots. Solids
// become MANIFOLD_SOLID_BREPs (BREP_WITH_VOIDS for hollow ones), sheets become open shells, curves
// and points a GEOMETRIC_CURVE_SET of wireframe geometry, coordinate systems named placements of
// supplemental geometry (CONSTRUCTIVE_GEOMETRY_REPRESENTATION). All of it goes into one product,
// or, as an assembly, each body into a product of its own under a root product.

import { ModelingError, _crashOf, _isCrash, _isRuntimeError, _warn, ext, k, kernelCall } from './kernel.ts'
import { toRgb } from './colors.ts'
import { Plane, Vector } from './geometry.ts'
import { Edge, Face, Part, Vertex, Wire, _Body, _cellSources, _sourceLabel, _typeName, type ColorLike } from './shapes.ts'
import { StepCurve, StepFrame, StepModel, StepPoint } from './step_import.ts'
import { _fs } from './exporters.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any
type V3 = number[]

const _UNITS: Record<string, string> = {
  mm: '(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))',
  m: '(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.))',
  cm: '(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.))',
  um: '(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MICRO.,.METRE.))',
}
const _INCH = 25.4
/** millimeters per declared unit */
export const _MM_PER_UNIT = new Map<string, number>([
  ['mm', 1.0],
  ['cm', 10.0],
  ['m', 1000.0],
  ['um', 0.001],
  ['inch', _INCH],
  ['in', _INCH],
])
/** the length uncertainty a file declares, in millimeters (written in the file's unit) */
const _UNCERTAINTY_MM = 1e-7

/** Python's repr of a float: the shortest digits that read back as `v`, in exponent form below
 * 1e-4 and from 1e16 on. */
export function _pyRepr(v: number): string {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0'
  // the shortest digits (JavaScript's own) and the position of the decimal point
  const s = String(Math.abs(v))
  const e = s.indexOf('e')
  const mantissa = e >= 0 ? s.slice(0, e) : s
  const exponent = e >= 0 ? Number(s.slice(e + 1)) : 0
  const dot = mantissa.indexOf('.')
  const whole = dot >= 0 ? mantissa.slice(0, dot) : mantissa
  let digits = whole + (dot >= 0 ? mantissa.slice(dot + 1) : '')
  let point = whole.length + exponent
  const lead = digits.length - digits.replace(/^0+/, '').length
  digits = digits.slice(lead).replace(/0+$/, '')
  point -= lead
  const sign = v < 0 ? '-' : ''
  if (point <= -4 || point > 16) {
    const x = point - 1
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
    return `${sign}${m}e${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(2, '0')}`
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/** A STEP REAL literal. */
function _r(value: number): string {
  const v = Number(value)
  if (!Number.isFinite(v)) throw new RangeError('non-finite number in STEP output')
  if (v === 0) return '0.'
  const s = _pyRepr(v)
  if (s.includes('e') || s.includes('E')) {
    const [m, exp] = s.split(/[eE]/)
    const mant = m.includes('.') ? m : `${m}.`
    return `${mant}E${Number.parseInt(exp, 10)}`
  }
  return s.includes('.') ? s : `${s}.`
}

/** A STEP STRING literal (ASCII; quotes doubled). */
/** A STEP STRING literal: quotes doubled, backslashes too, and characters outside printable ASCII
 * in ISO 10303-21's `\X2\...\X0\` (`\X4\` beyond the 16-bit range). */
function _s(text: string | null | undefined): string {
  let out = ''
  let run = '' // hex digits of the characters encoded so far, and their encoding
  let kind = ''
  for (const ch of `${text || ''}'`) {
    // (the closing quote ends the last run)
    const c = ch.codePointAt(0) as number
    const enc = c >= 0x20 && c <= 0x7e ? '' : c <= 0xffff ? 'X2' : 'X4'
    if (run && enc !== kind) {
      out += `\\${kind}\\${run}\\X0\\`
      run = ''
    }
    if (enc) {
      run += c.toString(16).toUpperCase().padStart(enc === 'X2' ? 4 : 8, '0')
      kind = enc
    } else out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch
  }
  return `'${out.slice(0, -2)}'`
}

function _color(c: ColorLike | null | undefined): [number, number, number] | null {
  if (c == null) return null
  return toRgb(c)
}

function _norm(v: V3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function _dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function _cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function _sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function _mul(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function _vec(p: ArrayLike<number>): V3 {
  return [Number(p[0]), Number(p[1]), Number(p[2])]
}

class _Writer {
  lines: string[] = []
  _points = new Map<string, number>()
  _dirs = new Map<string, number>()

  add(text: string): number {
    this.lines.push(text)
    return this.lines.length
  }

  point(p: ArrayLike<number>): number {
    const key = _vec(p)
    const id = key.join(',') // (-0 and 0 are one key, as in Python)
    let n = this._points.get(id)
    if (n === undefined) {
      n = this.add(`CARTESIAN_POINT('',(${_r(key[0])},${_r(key[1])},${_r(key[2])}))`)
      this._points.set(id, n)
    }
    return n
  }

  direction(d: ArrayLike<number>): number {
    let v = _vec(d)
    const len = _norm(v)
    v = [v[0] / len, v[1] / len, v[2] / len]
    const id = v.join(',')
    let n = this._dirs.get(id)
    if (n === undefined) {
      n = this.add(`DIRECTION('',(${_r(v[0])},${_r(v[1])},${_r(v[2])}))`)
      this._dirs.set(id, n)
    }
    return n
  }

  axis2(origin: ArrayLike<number>, z: ArrayLike<number>, x: ArrayLike<number>): number {
    return this.add(`AXIS2_PLACEMENT_3D('',#${this.point(origin)},#${this.direction(z)},#${this.direction(x)})`)
  }

  text(header: string[]): string {
    const out = ['ISO-10303-21;', 'HEADER;', ...header, 'ENDSEC;', 'DATA;']
    this.lines.forEach((line, i) => out.push(`#${i + 1}=${line};`))
    out.push('ENDSEC;', 'END-ISO-10303-21;', '')
    return out.join('\n')
  }
}

function _mults(knots: ArrayLike<number>): [number[], number[]] {
  const uniq: number[] = []
  const mult: number[] = []
  for (let i = 0; i < knots.length; i++) {
    const kv = knots[i]
    if (uniq.length && Math.abs(kv - uniq[uniq.length - 1]) <= 1e-14 * Math.max(1.0, Math.abs(kv))) mult[mult.length - 1] += 1
    else {
      uniq.push(Number(kv))
      mult.push(1)
    }
  }
  return [uniq, mult]
}

function _ints(v: Iterable<number>): string {
  return `(${Array.from(v, (x) => String(Math.trunc(x))).join(',')})`
}

function _reals(v: Iterable<number>): string {
  return `(${Array.from(v, _r).join(',')})`
}

function _orthonormal(z: ArrayLike<number>, x: ArrayLike<number>): [V3, V3] {
  let zz = _vec(z)
  const zn = _norm(zz)
  zz = [zz[0] / zn, zz[1] / zn, zz[2] / zn]
  let xx = _vec(x)
  const d = _dot(xx, zz)
  xx = [xx[0] - zz[0] * d, xx[1] - zz[1] * d, xx[2] - zz[2] * d]
  const xn = _norm(xx)
  xx = [xx[0] / xn, xx[1] / xn, xx[2] / xn]
  return [zz, xx]
}

/** How the STEP normal of an analytic surface runs (the kernel's parameterisation decides for the
 * others). */
type NormalOf =
  | { kind: 'plane'; z: V3 }
  | { kind: 'cylinder'; o: V3; z: V3 }
  | { kind: 'cone'; o: V3; z: V3; r: number; ang: number }
  | { kind: 'sphere'; o: V3 }
  | { kind: 'torus'; o: V3; z: V3; R: number }
  | null

/** The edgeuses of a loop (`[edge, forward]`) as loops that pass no vertex twice: a loop that touches
 * itself at a vertex (a thin hole that reaches the face's border there, as where the pieces of a sweep
 * meet at a corner) is split into the loops between. OpenCASCADE walks such a loop's wire the wrong way at
 * that vertex and takes it for open, the face for invalid. A loop with a closed edge or an edge used twice
 * (a seam) stays as it is. */
function _simpleLoops(items: [number, boolean][], edges: Any[]): [number, boolean][][] {
  if (items.length < 3 || new Set(items.map(([e]) => e)).size !== items.length) return [items]
  const starts: unknown[] = []
  for (const [e, forward] of items) {
    const { v0, v1 } = edges[e]
    if (v0 === null || v0 === undefined || v0 === v1) return [items]
    starts.push(forward ? v0 : v1)
  }
  if (new Set(starts).size === starts.length) return [items]
  const loops: [number, boolean][][] = []
  const path: [[number, boolean], unknown][] = []
  items.forEach((item, i) => {
    const at = path.findIndex(([, u]) => u === starts[i])
    if (at >= 0) loops.push(path.splice(at).map(([x]) => x)) // (back at a vertex: the edgeuses since are a loop of their own)
    path.push([item, starts[i]])
  })
  loops.push(path.map(([x]) => x))
  return loops
}

/** A body has faces the writer cannot write exactly (the message says which). */
class _NeedsNurbs extends Error {}

/** A surface of the dump the writer writes exactly: an analytic one, or one with control points. */
function _writable(s: Any): boolean {
  return ['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(s.kind) || 'poles' in s
}

/** The basis an offset face is written on: the kernel's, or the extension of it the kernel
 * evaluates where the face reaches past the basis; null where neither holds the face or can be
 * written. */
function _offsetBasis(f: Any): Any {
  const s = f.surface
  const [[fu0, fv0], [fu1, fv1]] = f.uv_domain
  for (const basis of [s.basis, s.extended]) {
    if (basis == null || !_writable(basis)) continue
    const [[u0, v0], [u1, v1]] = basis.uv_domain
    const tol = 1e-9 * Math.max(1.0, u1 - u0, v1 - v0)
    if (u0 - tol <= fu0 && fu1 <= u1 + tol && v0 - tol <= fv0 && fv1 <= v1 + tol) return basis
  }
  return null
}

/** Why the writer cannot write a face of the dump exactly, or null. */
function _inexact(f: Any): string | null {
  const s = f.surface
  if (s.kind === 'offset') {
    if (_offsetBasis(f) !== null) return null
    const basis = s.basis
    if (basis == null || !_writable(basis)) return `an offset of a surface of kind '${basis ? basis.kind : 'unknown'}'`
    return 'an offset surface that reaches past its basis'
  }
  return _writable(s) ? null : `a surface of kind '${s.kind}'`
}

/** A (rational) B-spline curve of the kernel's control points and knots. */
function _bsplineCurve(w: _Writer, c: Any, name = ''): number {
  const pts = (c.poles as V3[]).map((p) => `#${w.point(p)}`).join(',')
  const [uniq, mult] = _mults(c.knots)
  const deg = c.degree
  if (c.weights == null) {
    return w.add(`B_SPLINE_CURVE_WITH_KNOTS(${_s(name)},${deg},(${pts}),.UNSPECIFIED.,.F.,.F.,${_ints(mult)},${_reals(uniq)},.UNSPECIFIED.)`)
  }
  return w.add(
    `(BOUNDED_CURVE() B_SPLINE_CURVE(${deg},(${pts}),.UNSPECIFIED.,.F.,.F.) ` +
      `B_SPLINE_CURVE_WITH_KNOTS(${_ints(mult)},${_reals(uniq)},.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() ` +
      `RATIONAL_B_SPLINE_CURVE(${_reals(c.weights)}) REPRESENTATION_ITEM(${_s(name)}))`,
  )
}

/** Writes the topology of one kernel Brep. */
class _BodyWriter {
  w: _Writer
  brep: number
  dump: Any
  kfaces: number[]
  kedges: number[]
  vertexIds = new Map<number, number>()
  edgeIds = new Map<number, number>()
  // the faces' own colors and names, and the ADVANCED_FACE items written for each face (a face
  // between two cells of a merged part is written in each) (kernel plan T5)
  faceColors: (number[] | null)[]
  faceNames: (string | null)[]
  faceItems = new Map<number, number[]>()

  constructor(w: _Writer, brep: number) {
    this.w = w
    this.brep = brep
    this.dump = ext.brep_dump(brep, true)
    const inexact = (this.dump.faces as Any[]).map(_inexact).filter((why): why is string => why !== null)
    if (inexact.length) {
      throw new _NeedsNurbs(`${inexact.length} ${inexact.length === 1 ? 'face' : 'faces'} on ${[...new Set(inexact)].sort().join('; ')}`)
    }
    this.kfaces = k.brep_faces(brep)
    this.kedges = k.brep_edges(brep)
    ;[this.faceColors, this.faceNames] = ext.face_attrs(brep)
  }

  // -- geometry -----------------------------------------------------------------------------
  bsplineCurve(c: Any): number {
    return _bsplineCurve(this.w, c)
  }

  /** STEP curve for edge `idx` and whether the edge runs along its parameterisation. */
  curve(idx: number): [number, boolean] {
    const e = this.dump.edges[idx]
    const c = e.curve
    const w = this.w
    const kind = c.kind
    const [t0, t1] = e.interval
    if (kind === 'line') {
      const ke = this.kedges[idx]
      const a = _vec(k.curve_evaluate(k.edge_curve(ke), t0))
      const b = _vec(k.curve_evaluate(k.edge_curve(ke), t1))
      const d = _sub(b, a)
      const L = _norm(d)
      const vec = w.add(`VECTOR('',#${w.direction([d[0] / L, d[1] / L, d[2] / L])},${_r(L)})`)
      return [w.add(`LINE('',#${w.point(a)},#${vec})`), true]
    }
    if (kind === 'circle' || kind === 'ellipse') {
      const pl = c.placement
      const [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      let ax = w.axis2(pl.origin, z, x)
      let ent: number
      if (kind === 'circle') ent = w.add(`CIRCLE('',#${ax},${_r(c.radius)})`)
      else {
        const r1 = c.radius1
        const r2 = c.radius2
        if (r1 >= r2) ent = w.add(`ELLIPSE('',#${ax},${_r(r1)},${_r(r2)})`)
        else {
          // STEP wants semi_axis_1 >= semi_axis_2: rotate the frame by 90 degrees
          const y = _cross(z, x)
          ax = w.axis2(pl.origin, z, y)
          ent = w.add(`ELLIPSE('',#${ax},${_r(r2)},${_r(r1)})`)
        }
      }
      // sense: STEP conics run counterclockwise about their axis
      const ke = this.kedges[idx]
      const tm = 0.5 * (t0 + t1)
      const [p, dp] = ext.curve_eval(k.edge_curve(ke), tm, 1)
      const ccw = _cross(z, _sub(_vec(p), _vec(pl.origin)))
      return [ent, _dot(_vec(dp), ccw) > 0]
    }
    return [this.bsplineCurve(c), true]
  }

  /** STEP surface for face `idx` and whether its STEP normal runs along the kernel's natural normal
   * of the face's surface. */
  surface(idx: number): [number, boolean] {
    const f = this.dump.faces[idx]
    const s = f.surface
    if (s.kind === 'offset') {
      // OFFSET_SURFACE moves its basis along the basis's STEP normal, the kernel along the basis's
      // natural normal; an offset surface's normal is its basis's in both.
      const [ent, normalOf] = this._surface(_offsetBasis(f)) // (checked in the constructor)
      const agrees = this._agrees(idx, normalOf)
      const distance = agrees ? Number(s.distance) : -Number(s.distance)
      return [this.w.add(`OFFSET_SURFACE('',#${ent},${_r(distance)},.F.)`), agrees]
    }
    const [ent, normalOf] = this._surface(s)
    return [ent, this._agrees(idx, normalOf)]
  }

  /** STEP surface for a surface of the dump and, for analytic surfaces, how its STEP normal runs. */
  _surface(s: Any): [number, NormalOf] {
    const w = this.w
    const kind = s.kind
    const pl = s.placement
    if (kind === 'plane') {
      const [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      return [w.add(`PLANE('',#${w.axis2(pl.origin, z, x)})`), { kind: 'plane', z }]
    }
    if (kind === 'cylinder') {
      // (SMLib's own cylinders are cones of angle 0; imported ones are these)
      const [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      const o = _vec(pl.origin)
      return [w.add(`CYLINDRICAL_SURFACE('',#${w.axis2(o, z, x)},${_r(s.radius)})`), { kind: 'cylinder', o, z }]
    }
    if (kind === 'cone') {
      let [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      let semi = 'semi_angle_deg' in s ? Number(s.semi_angle_deg) : 0.0
      const o = _vec(pl.origin)
      const r = Number(s.radius)
      if (Math.abs(semi) < 1e-12) return [w.add(`CYLINDRICAL_SURFACE('',#${w.axis2(o, z, x)},${_r(r)})`), { kind: 'cylinder', o, z }]
      if (semi < 0) {
        z = [-z[0], -z[1], -z[2]]
        semi = -semi
      }
      const ang = semi * (Math.PI / 180) // (Python's math.radians)
      return [w.add(`CONICAL_SURFACE('',#${w.axis2(o, z, x)},${_r(r)},${_r(ang)})`), { kind: 'cone', o, z, r, ang }]
    }
    if (kind === 'sphere') {
      const [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      const o = _vec(pl.origin)
      return [w.add(`SPHERICAL_SURFACE('',#${w.axis2(o, z, x)},${_r(s.radius)})`), { kind: 'sphere', o }]
    }
    if (kind === 'torus') {
      const [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      const o = _vec(pl.origin)
      const R = Number(s.major_radius)
      const r = Number(s.minor_radius)
      return [w.add(`TOROIDAL_SURFACE('',#${w.axis2(o, z, x)},${_r(R)},${_r(r)})`), { kind: 'torus', o, z, R }]
    }
    return [this.bsplineSurface(s), null]
  }

  bsplineSurface(s: Any): number {
    const w = this.w
    const [uu, um] = _mults(s.u_knots)
    const [vu, vm] = _mults(s.v_knots)
    const nu = s.u_knots.length - s.u_degree - 1
    const nv = s.v_knots.length - s.v_degree - 1
    const poles: V3[] = s.poles
    const rows: string[] = []
    for (let i = 0; i < nu; i++) {
      const row: string[] = []
      for (let j = 0; j < nv; j++) row.push(`#${w.point(poles[i * nv + j])}`)
      rows.push(`(${row.join(',')})`)
    }
    const net = `(${rows.join(',')})`
    if (s.weights == null) {
      return w.add(
        `B_SPLINE_SURFACE_WITH_KNOTS('',${s.u_degree},${s.v_degree},${net},.UNSPECIFIED.,` +
          `.F.,.F.,.F.,${_ints(um)},${_ints(vm)},${_reals(uu)},${_reals(vu)},.UNSPECIFIED.)`,
      )
    }
    const wts: number[] = s.weights
    const wrows: string[] = []
    for (let i = 0; i < nu; i++) {
      const row: string[] = []
      for (let j = 0; j < nv; j++) row.push(_r(wts[i * nv + j]))
      wrows.push(`(${row.join(',')})`)
    }
    return w.add(
      `(BOUNDED_SURFACE() B_SPLINE_SURFACE(${s.u_degree},${s.v_degree},${net},.UNSPECIFIED.,.F.,.F.,.F.) ` +
        `B_SPLINE_SURFACE_WITH_KNOTS(${_ints(um)},${_ints(vm)},${_reals(uu)},${_reals(vu)},.UNSPECIFIED.) ` +
        `GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE((${wrows.join(',')})) REPRESENTATION_ITEM('') SURFACE())`,
    )
  }

  // -- topology -----------------------------------------------------------------------------
  vertex(idx: number): number {
    let n = this.vertexIds.get(idx)
    if (n === undefined) {
      n = this.w.add(`VERTEX_POINT('',#${this.w.point(this.dump.vertices[idx])})`)
      this.vertexIds.set(idx, n)
    }
    return n
  }

  edge(idx: number): number {
    let n = this.edgeIds.get(idx)
    if (n === undefined) {
      const e = this.dump.edges[idx]
      const [crv, sense] = this.curve(idx)
      const v0 = this.vertex(e.v0)
      const v1 = this.vertex(e.v1)
      n = this.w.add(`EDGE_CURVE('',#${v0},#${v1},#${crv},${sense ? '.T.' : '.F.'})`)
      this.edgeIds.set(idx, n)
    }
    return n
  }

  /** ADVANCED_FACE for face `idx` seen from faceuse `use` (its normal is the face normal). */
  face(idx: number, use: Any): number {
    const w = this.w
    const [srf, agrees] = this.surface(idx)
    const bounds: string[] = []
    for (const loop of use.loops) {
      const parts: number[] = []
      if (loop.vertex !== null && !loop.edges.length) parts.push(w.add(`VERTEX_LOOP('',#${this.vertex(loop.vertex)})`))
      else {
        for (const items of _simpleLoops(loop.edges, this.dump.edges)) {
          const oes: string[] = []
          for (const [eidx, forward] of items) {
            const flag = forward ? '.T.' : '.F.'
            const oe = w.add(`ORIENTED_EDGE('',*,*,#${this.edge(eidx)},${flag})`)
            oes.push(`#${oe}`)
          }
          parts.push(w.add(`EDGE_LOOP('',(${oes.join(',')}))`))
        }
      }
      // (a loop split into several: none of them marked as the outer one)
      const kind = loop.outer && parts.length === 1 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'
      for (const lp of parts) {
        const bound = w.add(`${kind}('',#${lp},.T.)`)
        bounds.push(`#${bound}`)
      }
    }
    // The faceuse normal is the kernel's natural normal when the faceuse is SAME.
    const same = Boolean(use.same) === agrees
    const item = w.add(`ADVANCED_FACE(${_s(this.faceNames[idx])},(${bounds.join(',')}),#${srf},${same ? '.T.' : '.F.'})`)
    this.faceItems.set(idx, [...(this.faceItems.get(idx) ?? []), item])
    return item
  }

  /** Whether the STEP normal of an analytic surface (`normalOf`) runs along the kernel's natural
   * normal of face `idx`'s surface. (B-splines are written with the kernel's own parameterisation,
   * so their normals agree.) The analytic normals are those of the whole family of parallel
   * surfaces, so they hold on an offset of the surface too. */
  _agrees(idx: number, normalOf: NormalOf): boolean {
    if (normalOf === null) return true
    const kf = this.kfaces[idx]
    const middle = (): [number, number, V3] => {
      const [[u0, v0], [u1, v1]] = k.face_uv_domain(kf)
      const [um, vm] = [0.5 * (u0 + u1), 0.5 * (v0 + v1)]
      return [um, vm, _vec(k.face_point_at_uv(kf, um, vm))]
    }
    const [u, v, p] = kernelCall('export STEP', (): [number, number, V3] => {
      let p: V3
      let u: number
      let v: number
      try {
        p = _vec(k.face_interior_point(kf))
        const [, uvs] = k.surface_closest_point(k.face_surface(kf), p)
        ;[u, v] = uvs[0] as [number, number]
      } catch (e) {
        if (!_isRuntimeError(e) || _isCrash(e)) throw _crashOf(e)
        // The kernel finds no point inside the face (it searches the face's parameter domain
        // along 20 lines, and a narrow strip can lie between them). The sense is a property of
        // the whole surface: the middle of the domain will do.
        ;[u, v, p] = middle()
      }
      if (normalOf.kind === 'cone' || normalOf.kind === 'torus') {
        const { o, z } = normalOf
        const d = _sub(p, o)
        // The point is on the axis (the apex of a cone): no radial direction there. The sense is
        // a property of the whole surface, so any other point will do.
        if (_norm(_sub(d, _mul(z, _dot(d, z)))) < 1e-9 * Math.max(1.0, _norm(d))) [u, v, p] = middle()
      }
      return [u, v, p]
    })
    const nKernel = _vec(kernelCall('export STEP', () => k.face_normal_at_uv(kf, u, v)))
    let nStep: V3
    if (normalOf.kind === 'plane') nStep = normalOf.z
    else if (normalOf.kind === 'cylinder') {
      const d = _sub(p, normalOf.o)
      nStep = _sub(d, _mul(normalOf.z, _dot(d, normalOf.z)))
    } else if (normalOf.kind === 'cone') {
      const { o, z, ang } = normalOf
      const d = _sub(p, o)
      let radial = _sub(d, _mul(z, _dot(d, z)))
      const n = _norm(radial)
      radial = [radial[0] / n, radial[1] / n, radial[2] / n]
      nStep = _sub(_mul(radial, Math.cos(ang)), _mul(z, Math.sin(ang)))
    } else if (normalOf.kind === 'sphere') nStep = _sub(p, normalOf.o)
    else {
      // torus
      const { o, z, R } = normalOf
      const d = _sub(p, o)
      let radial = _sub(d, _mul(z, _dot(d, z)))
      const n = _norm(radial)
      radial = [radial[0] / n, radial[1] / n, radial[2] / n]
      nStep = _sub(p, [o[0] + radial[0] * R, o[1] + radial[1] * R, o[2] + radial[2] * R])
    }
    return _dot(nKernel, nStep) > 0
  }

  /** The region each item of `solids` is of (counting the regions that are not cavities). */
  cells: number[] = []

  /** MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS items, one per material region, named `name` or, per
   * region, `names` (the cells of a merged part); `cells` holds the region each item is of. */
  solids(name: string, names: readonly (string | null)[] | null = null): number[] {
    const d = this.dump
    const items: number[] = []
    this.cells = []
    let cell = -1
    const shellFaces = new Map<number, [number, Any][]>()
    d.faces.forEach((f: Any, fi: number) => {
      f.uses.forEach((use: Any, ui: number) => {
        if (use == null || use.shell == null) return
        // The faceuse in a region's shell faces into that region; its mate faces out.
        const mate = f.uses[1 - ui]
        const list = shellFaces.get(use.shell)
        if (list) list.push([fi, mate])
        else shellFaces.set(use.shell, [[fi, mate]])
      })
    })
    for (const region of d.regions) {
      if (region.infinite || region.void) continue
      cell += 1
      const label = (names !== null && cell < names.length && names[cell]) || name
      const shells: number[] = []
      for (const si of region.shells) {
        const faces = (shellFaces.get(si) ?? []).map(([fi, mate]) => this.face(fi, mate))
        shells.push(this.w.add(`CLOSED_SHELL('',(${faces.map((x) => `#${x}`).join(',')}))`))
      }
      if (!shells.length) continue
      if (shells.length === 1) items.push(this.w.add(`MANIFOLD_SOLID_BREP(${_s(label)},#${shells[0]})`))
      else {
        const voids = shells.slice(1).map((s) => this.w.add(`ORIENTED_CLOSED_SHELL('',*,#${s},.F.)`))
        items.push(this.w.add(`BREP_WITH_VOIDS(${_s(label)},#${shells[0]},(${voids.map((v) => `#${v}`).join(',')}))`))
      }
      this.cells.push(cell)
    }
    return items
  }

  /** An OPEN_SHELL of all faces (seen from their natural side). */
  sheets(name: string): number[] {
    const faces: number[] = this.dump.faces.map((f: Any, fi: number) => this.face(fi, f.uses[0]))
    if (!faces.length) return []
    const shell = this.w.add(`OPEN_SHELL('',(${faces.map((x) => `#${x}`).join(',')}))`)
    return [this.w.add(`SHELL_BASED_SURFACE_MODEL(${_s(name)},(#${shell}))`)]
  }
}

/** How a STEP file is written: `unit` the length unit of the file ("mm", "cm", "m", "um" or
 * "inch"), `name` the product's name (the file's name by default), `author` and `organization`
 * for the header. */
export interface StepOptions {
  unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in'
  name?: string | null
  author?: string
  organization?: string
  assembly?: boolean
}

/** A curve, point or coordinate system written with the bodies. */
type _Extra = StepCurve | StepPoint | StepFrame

function _isExtra(x: unknown): x is _Extra {
  return x instanceof StepCurve || x instanceof StepPoint || x instanceof StepFrame
}

/** What `exportStep` writes, in order: bodies (a face as a sheet), and curves, points and coordinate
 * systems as `StepCurve`, `StepPoint` and `StepFrame` (an edge or wire is an unnamed curve, a vertex
 * or Vector an unnamed point, a Plane an unnamed coordinate system, a StepModel its bodies,
 * coordinate systems, curves and points). Anything else is left for `_stepText` to refuse. */
export function _stepItems(shapes: unknown): unknown[] {
  if (shapes instanceof _Body || _isExtra(shapes)) return [shapes]
  if (shapes instanceof Face) return [shapes.toShell()]
  if (shapes instanceof Edge || shapes instanceof Wire) return [new StepCurve('', shapes)]
  if (shapes instanceof Vertex) return [new StepPoint('', shapes.point)]
  if (shapes instanceof Vector) return [new StepPoint('', shapes)]
  if (shapes instanceof Plane) return [new StepFrame('', shapes)]
  if (shapes instanceof StepModel) return [...shapes.bodies, ...shapes.frames, ...shapes.curves, ...shapes.points]
  if (shapes == null || typeof shapes === 'string' || typeof (shapes as Any)[Symbol.iterator] !== 'function') return [shapes]
  const out: unknown[] = []
  for (const s of shapes as Iterable<unknown>) out.push(..._stepItems(s))
  return out
}

/** A bounded STEP curve along an edge, from its start to its end: a TRIMMED_CURVE of a line, circle
 * or ellipse (its trims in length units and radians), or a B-spline (other curves approximated
 * within 1e-7, as `Edge.nurbs` does). `scale`: file units per mm. */
function _edgeCurve(w: _Writer, edge: Edge, name = '', scale = 1.0): number {
  const kind = edge.geomType
  const a = _mul(edge.start.toArray(), scale)
  const b = _mul(edge.end.toArray(), scale)
  const trimmed = (basis: number, t0: number, t1: number, ends = true): number => {
    const lo = ends ? `(#${w.point(a)},PARAMETER_VALUE(${_r(t0)}))` : `(PARAMETER_VALUE(${_r(t0)}))`
    const hi = ends ? `(#${w.point(b)},PARAMETER_VALUE(${_r(t1)}))` : `(PARAMETER_VALUE(${_r(t1)}))`
    return w.add(`TRIMMED_CURVE(${_s(name)},#${basis},${lo},${hi},.T.,.PARAMETER.)`)
  }
  if (kind === 'line') {
    const d = _sub(b, a)
    const L = _norm(d)
    if (!(L > 0)) throw new RangeError('cannot write a line of length 0 to STEP')
    const vec = w.add(`VECTOR('',#${w.direction([d[0] / L, d[1] / L, d[2] / L])},1.)`) // (parameters are lengths along it)
    return trimmed(w.add(`LINE('',#${w.point(a)},#${vec})`), 0.0, L)
  }
  if (kind === 'circle' || kind === 'ellipse') {
    const c = ext.curve_data(edge._curve(), false)
    const pl = c.placement
    const o = _mul(_vec(pl.origin), scale)
    let [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
    // STEP's conics run counterclockwise about their axis: this one along the edge
    if (_dot(edge.tangentAt(0.5).toArray(), _cross(z, _sub(_mul(edge.pointAt(0.5).toArray(), scale), o))) < 0) z = _mul(z, -1)
    let [r1, r2] = kind === 'circle' ? [Number(c.radius), Number(c.radius)] : [Number(c.radius1), Number(c.radius2)]
    r1 *= scale
    r2 *= scale
    if (r1 < r2) [x, r1, r2] = [_cross(z, x), r2, r1] // STEP wants semi_axis_1 >= semi_axis_2: turn the frame by 90 degrees
    const y = _cross(z, x)
    const angle = (p: V3): number => {
      const d = _sub(p, o)
      return Math.atan2(_dot(d, y) / r2, _dot(d, x) / r1)
    }
    const t0 = angle(a)
    const turn = 2 * Math.PI
    let span = (((angle(b) - t0) % turn) + turn) % turn // (Python's modulo)
    if (edge.isClosed || span < 1e-12) span = turn
    const ax = w.axis2(o, z, x)
    const basis = w.add(kind === 'circle' ? `CIRCLE('',#${ax},${_r(r1)})` : `ELLIPSE('',#${ax},${_r(r1)},${_r(r2)})`)
    return trimmed(basis, t0, t0 + span)
  }
  const crv = edge._copyCurve()
  let c: Any
  try {
    c = kernelCall('export STEP', () => ext.curve_data(crv, true))
  } finally {
    ext.delete_curve(crv)
  }
  c = { ...c, poles: (c.poles as V3[]).map((p) => _mul(_vec(p), scale)) }
  const [lo, hi] = (c.interval as number[]).map(Number)
  const knots: number[] = c.knots
  const deg = Number(c.degree)
  const tol = 1e-12 * Math.max(1.0, Math.abs(lo), Math.abs(hi))
  if (Math.abs(knots[deg] - lo) <= tol && Math.abs(knots[knots.length - deg - 1] - hi) <= tol) return _bsplineCurve(w, c, name)
  return trimmed(_bsplineCurve(w, c), lo, hi, false) // (the edge uses part of the curve)
}

/** The representations of curves, points and coordinate systems: a GEOMETRICALLY_BOUNDED_
 * WIREFRAME_SHAPE_REPRESENTATION of one GEOMETRIC_CURVE_SET (curves, a wire as a composite curve,
 * named points) and a CONSTRUCTIVE_GEOMETRY_REPRESENTATION of the coordinate systems (CAx-IF's
 * supplemental geometry), as `[representation, isConstructive]`. The second list holds what is
 * colored, as `[item, rgb, style]`. `scale`: file units per mm. */
function _wireframe(
  w: _Writer,
  ctx: number,
  label: string,
  extras: readonly _Extra[],
  scale = 1.0,
): [[number, boolean][], [number, ColorLike, string][]] {
  const elements: number[] = []
  const frames: number[] = []
  const styled: [number, ColorLike, string][] = []
  const ids = (xs: number[]) => xs.map((x) => `#${x}`).join(',')
  for (const item of extras) {
    if (item instanceof StepCurve) {
      let ent: number
      if (item.shape instanceof Wire) {
        const edges = [...item.shape.edges()]
        const closed = item.shape.isClosed
        const segments = edges.map((e, i) => {
          const code = i === edges.length - 1 && !closed ? '.DISCONTINUOUS.' : '.CONTINUOUS.'
          return w.add(`COMPOSITE_CURVE_SEGMENT(${code},.T.,#${_edgeCurve(w, e, '', scale)})`)
        })
        ent = w.add(`COMPOSITE_CURVE(${_s(item.name)},(${ids(segments)}),.U.)`)
      } else ent = _edgeCurve(w, item.shape, item.name, scale)
      elements.push(ent)
      if (item.color !== null) styled.push([ent, item.color as ColorLike, 'curve'])
    } else if (item instanceof StepPoint) {
      const p = item.point.mul(scale)
      const ent = w.add(`CARTESIAN_POINT(${_s(item.name)},(${_r(p.x)},${_r(p.y)},${_r(p.z)}))`)
      elements.push(ent)
      if (item.color !== null) styled.push([ent, item.color as ColorLike, 'point'])
    } else {
      const pl = item.plane
      const [o, z, x] = [w.point(pl.origin.mul(scale).toArray()), w.direction(pl.zDir.toArray()), w.direction(pl.xDir.toArray())]
      const ent = w.add(`AXIS2_PLACEMENT_3D(${_s(item.name)},#${o},#${z},#${x})`)
      frames.push(ent)
      if (item.color !== null) styled.push([ent, item.color as ColorLike, 'curve']) // (as NX colors its coordinate systems)
    }
  }
  const reps: [number, boolean][] = []
  if (elements.length) {
    const gcs = w.add(`GEOMETRIC_CURVE_SET('',(${ids(elements)}))`)
    reps.push([w.add(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION(${_s(label)},(#${gcs}),#${ctx})`), false])
  }
  if (frames.length) reps.push([w.add(`CONSTRUCTIVE_GEOMETRY_REPRESENTATION('supplemental geometry',(${ids(frames)}),#${ctx})`), true])
  return [reps, styled]
}

/**
 * The text of a STEP file of bodies (parts and sheets), curves, points and coordinate systems
 * (`StepCurve`, `StepPoint`, `StepFrame`). `path` is the file's path, which names the file in the
 * header and the product unless `name` does ('' for a text without a file).
 *
 * The model is in millimeters; with another `unit` the coordinates are converted to it, so the
 * file holds the same part measured in that unit. With `assembly` each body is a product of its
 * own (named as the body) in a root product called `name`; a body listed more than once is written
 * once and placed as often. Curves, points and coordinate systems belong to the product: in an
 * assembly to the body's whose name is their `product`, the others to the root.
 */
export function _stepText(items: readonly unknown[], path: string, options: StepOptions = {}): string {
  const { unit = 'mm', name = null, author = '', organization = '', assembly = false } = options
  const perUnit = _MM_PER_UNIT.get(unit)
  if (perUnit === undefined) throw new RangeError(`unknown unit '${unit}'; use mm, cm, m, um or inch`)
  for (const item of items) if (!(item instanceof _Body || _isExtra(item))) throw new TypeError(`cannot write a ${_typeName(item)} to STEP`)
  let list = items.filter((x): x is _Body => x instanceof _Body)
  const extras = items.filter(_isExtra)
  for (const b of list) {
    // (a body without faces would be left out)
    if (k.brep_face_count(b._brep) === 0) {
      const what = path ? 'exportStep' : 'toStep'
      const label = b.name ? ` '${b.name}'` : ''
      const hint = k.brep_edge_count(b._brep) ? '; its edges() are curves, which it writes as such' : ' (a Boolean that left nothing?)'
      throw new RangeError(`${what}: the ${_typeName(b)}${label} is empty: it has no faces to write${hint}`)
    }
  }
  if (perUnit !== 1.0) {
    const f = 1.0 / perUnit
    const scaled = new Map<unknown, _Body>() // (a body listed twice stays one body)
    for (const b of list) if (!scaled.has(b._h)) scaled.set(b._h, b.scale(f))
    list = list.map((b) => scaled.get(b._h) as _Body)
  }
  const w = new _Writer()
  const product = name || _productName(path)
  const app = w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`)
  const pctx = w.add(`PRODUCT_CONTEXT('',#${app},'mechanical')`)
  let dctx = 0
  /** A PRODUCT with its definition: [PRODUCT_DEFINITION, PRODUCT_DEFINITION_SHAPE]. */
  const newProduct = (label: string): [number, number] => {
    const prod = w.add(`PRODUCT(${_s(label)},${_s(label)},'',(#${pctx}))`)
    w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`)
    const form = w.add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`)
    if (!dctx) dctx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`)
    const pdef = w.add(`PRODUCT_DEFINITION('design','',#${form},#${dctx})`)
    return [pdef, w.add(`PRODUCT_DEFINITION_SHAPE('','',#${pdef})`)]
  }
  const [pdef, pshape] = newProduct(product)

  let length: number
  if (unit === 'inch' || unit === 'in') {
    const mm = w.add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))')
    const lm = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${_r(_INCH)}),#${mm})`)
    const dim = w.add('DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)')
    length = w.add(`(CONVERSION_BASED_UNIT('INCH',#${lm}) LENGTH_UNIT() NAMED_UNIT(#${dim}))`)
  } else length = w.add(_UNITS[unit])
  const angle = w.add('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))')
  const solidAngle = w.add('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())')
  // (the same uncertainty in any unit: 1e-7 mm, to 15 digits in the file's unit)
  const uncertainty = Number((_UNCERTAINTY_MM / perUnit).toPrecision(15))
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${_r(uncertainty)}),#${length},'distance_accuracy_value','confusion accuracy')`)
  const ctx = w.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${length},#${angle},#${solidAngle})) ` +
      `REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  )

  const origin = w.axis2([0, 0, 0], [0, 0, 1], [1, 0, 0])
  const styled: [number, ColorLike, string][] = [] // [item, color, "surface" | "curve" | "point"]
  const ids = (xs: number[]) => xs.map((x) => `#${x}`).join(',')
  /** The solids (or the sheet) of one body, colored as the body: a merged part's cells named and
   * colored after the parts they lie in (kernel plan B15), faces of a color of their own styled each
   * (T5). */
  const itemsOf = (body: _Body, label: string): number[] => {
    const cells = body instanceof Part ? _cellLabels(body, label) : null
    const names = cells ? cells.map(([n]) => n) : null
    let bw: _BodyWriter
    let nurbs: _Body | null = null
    try {
      bw = new _BodyWriter(w, body._brep)
    } catch (e) {
      if (!(e instanceof _NeedsNurbs)) throw e
      _warn(
        `export STEP: '${label}' has ${e.message}, which STEP cannot hold as the kernel does: the body is written ` +
          'converted to NURBS (toNurbs), which approximates them',
      )
      nurbs = body.toNurbs()
      bw = new _BodyWriter(w, nurbs._brep)
    }
    try {
      const items = body instanceof Part ? bw.solids(label, names) : bw.sheets(label)
      if (cells) {
        // a merged part: each cell in the color of the parts it lies in
        items.forEach((it, j) => {
          const c = bw.cells[j] < cells.length ? cells[bw.cells[j]][1] : body.color
          if (_color(c) !== null) styled.push([it, c as ColorLike, 'surface'])
        })
      } else if (body.color != null) for (const it of items) styled.push([it, body.color, 'surface'])
      // faces of their own color: a STYLED_ITEM of the face, over the body's
      for (const fi of [...bw.faceItems.keys()].sort((a, b) => a - b)) {
        const own = bw.faceColors[fi]
        if (own !== null) for (const it of bw.faceItems.get(fi)!) styled.push([it, [Number(own[0]), Number(own[1]), Number(own[2])], 'surface'])
      }
      return items
    } finally {
      nurbs?.dispose()
    }
  }
  const representation = (kind: string, label: string, axis: number, items: number[]): number =>
    w.add(`${kind}(${_s(label)},(#${axis},${ids(items)}),#${ctx})`)
  /** Representations that belong to the same product as `main` (its wireframe geometry, its
   * coordinate systems). */
  const relate = (main: number, others: [number, boolean][]): void => {
    for (const [rep, constructive] of others) {
      if (constructive) w.add(`CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP('supplemental geometry','',#${main},#${rep})`)
      else w.add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',#${main},#${rep})`)
    }
  }
  const wireframe = (label: string, items: readonly _Extra[]): [number, boolean][] => {
    const [reps, colored] = _wireframe(w, ctx, label, items, 1.0 / perUnit)
    styled.push(...colored)
    return reps
  }

  if (!assembly) {
    const solidItems: number[] = []
    const sheetItems: number[] = []
    list.forEach((body, i) => {
      const label = body.name || (list.length === 1 ? product : `${product}_${i + 1}`)
      ;(body instanceof Part ? solidItems : sheetItems).push(...itemsOf(body, label))
    })
    const reps: [number, boolean][] = []
    if (solidItems.length) reps.push([representation('ADVANCED_BREP_SHAPE_REPRESENTATION', product, origin, solidItems), false])
    if (sheetItems.length) reps.push([representation('MANIFOLD_SURFACE_SHAPE_REPRESENTATION', product, origin, sheetItems), false])
    reps.push(...wireframe(product, extras))
    if (!reps.length) throw new RangeError(`${path ? 'exportStep' : 'toStep'}: nothing to write`)
    // (coordinate systems alone: supplemental geometry of a shape that has no items)
    if (reps[0][1]) reps.unshift([w.add(`SHAPE_REPRESENTATION(${_s(product)},(#${origin}),#${ctx})`), false])
    w.add(`SHAPE_DEFINITION_REPRESENTATION(#${pshape},#${reps[0][0]})`)
    relate(reps[0][0], reps.slice(1))
  } else {
    // One product per body, its shape in its own representation around its own origin, and one
    // NEXT_ASSEMBLY_USAGE_OCCURRENCE per place it has in the root product (CAx-IF's recommended
    // practices for assemblies): the placement, an ITEM_DEFINED_TRANSFORMATION from the part's
    // origin to an axis in the root's representation, and the shape relationship that carries it.
    // Bodies keep their coordinates: they are placed at the root's origin.
    const parts = new Map<unknown, [number, number, number, string]>() // handle -> [definition, rep, origin, name]
    const places: [unknown, number][] = [] // [handle, the axis it is placed at in the root]
    list.forEach((body, i) => {
      const key = body._h
      if (!parts.has(key)) {
        const label = body.name || `${product}_${i + 1}`
        const items = itemsOf(body, label)
        if (!items.length) return
        const [partDef, partShape] = newProduct(label)
        const at = w.axis2([0, 0, 0], [0, 0, 1], [1, 0, 0])
        const kind = body instanceof Part ? 'ADVANCED_BREP_SHAPE_REPRESENTATION' : 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION'
        const rep = representation(kind, label, at, items)
        w.add(`SHAPE_DEFINITION_REPRESENTATION(#${partShape},#${rep})`)
        parts.set(key, [partDef, rep, at, label])
      }
      places.push([key, w.axis2([0, 0, 0], [0, 0, 1], [1, 0, 0])])
    })
    if (!parts.size && !extras.length) throw new RangeError(`${path ? 'exportStep' : 'toStep'}: nothing to write`)
    const root = w.add(`SHAPE_REPRESENTATION(${_s(product)},(${ids([origin, ...places.map(([, a]) => a)])}),#${ctx})`)
    w.add(`SHAPE_DEFINITION_REPRESENTATION(#${pshape},#${root})`)
    places.forEach(([key, place], n) => {
      const [partDef, rep, at, label] = parts.get(key) as [number, number, number, string]
      const idt = w.add(`ITEM_DEFINED_TRANSFORMATION('','',#${at},#${place})`)
      const rel = w.add(
        `(REPRESENTATION_RELATIONSHIP('','',#${rep},#${root}) ` +
          `REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt}) SHAPE_REPRESENTATION_RELATIONSHIP())`,
      )
      const nauo = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${n + 1}',${_s(label)},'',#${pdef},#${partDef},$)`)
      const occurrence = w.add(`PRODUCT_DEFINITION_SHAPE(${_s(label)},'',#${nauo})`)
      w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rel},#${occurrence})`)
    })
    // curves, points and coordinate systems: with the part their product names, or the root's
    const byLabel = new Map<string, number>()
    for (const [, rep, , label] of parts.values()) byLabel.set(label, rep)
    const groups = new Map<number, _Extra[]>()
    for (const item of extras) {
      const rep = byLabel.get(item.product) ?? root
      const group = groups.get(rep)
      if (group) group.push(item)
      else groups.set(rep, [item])
    }
    for (const [rep, group] of groups) {
      const label = [...byLabel].find(([, r]) => r === rep)?.[0] ?? product
      relate(rep, wireframe(label, group))
    }
  }

  if (styled.length) {
    const styleIds: number[] = []
    let font = 0
    for (const [item, color, kind] of styled) {
      const [r, g, b] = _color(color) as [number, number, number]
      const col = w.add(`COLOUR_RGB('',${_r(r)},${_r(g)},${_r(b)})`)
      let style: number
      if (kind === 'curve') {
        if (!font) font = w.add("DRAUGHTING_PRE_DEFINED_CURVE_FONT('continuous')")
        style = w.add(`CURVE_STYLE('',#${font},POSITIVE_LENGTH_MEASURE(0.1),#${col})`)
      } else if (kind === 'point') style = w.add(`POINT_STYLE('',MARKER_TYPE(.DOT.),POSITIVE_LENGTH_MEASURE(1.),#${col})`)
      else {
        const fill = w.add(`FILL_AREA_STYLE_COLOUR('',#${col})`)
        const fas = w.add(`FILL_AREA_STYLE('',(#${fill}))`)
        const ssfa = w.add(`SURFACE_STYLE_FILL_AREA(#${fas})`)
        const sss = w.add(`SURFACE_SIDE_STYLE('',(#${ssfa}))`)
        style = w.add(`SURFACE_STYLE_USAGE(.BOTH.,#${sss})`)
      }
      const psa = w.add(`PRESENTATION_STYLE_ASSIGNMENT((#${style}))`)
      styleIds.push(w.add(`STYLED_ITEM('color',(#${psa}),#${item})`))
    }
    w.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${ids(styleIds)}),#${ctx})`)
  }

  const header = [
    "FILE_DESCRIPTION(('smlibwasm model'),'2;1');",
    `FILE_NAME(${_s(path.split('/').pop())},${_s(_stamp())},(${_s(author)}),(${_s(organization)}),` + "'smlibwasm','smlibwasm (SMLib kernel)','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
  ]
  return w.text(header)
}

/**
 * Write bodies (parts and sheets), curves, points and coordinate systems to a STEP file (Node).
 *
 * The model is in millimeters; with another `unit` the coordinates are converted to it, so the
 * file holds the same part measured in that unit.
 */
export function writeStep(items: readonly unknown[], path: string, options: StepOptions = {}): void {
  const fs = _fs()
  fs.writeFileSync(path, _stepText(items, path, options))
}

/** The local time without its fraction of a second (Python's datetime.now().isoformat()). */
function _stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Per cell of a merged part (as `Part.cells` names them, without building them): the name and
 * color of the parts it lies in, else `label` and the part's color; null for a part that does not
 * come from a merge, or where the cells' parts cannot be found (kernel plan B15). */
function _cellLabels(body: Part, label: string): [string | null, ColorLike | null][] | null {
  let sources: Part[][] | null
  try {
    sources = _cellSources(body)
  } catch (e) {
    if (!(e instanceof ModelingError) && !(e instanceof RangeError) || _isCrash(e)) throw _crashOf(e)
    return null
  }
  if (!sources || !sources.length) return null
  return sources.map((s) => _sourceLabel(s, label, body.color))
}

function _productName(path: string): string {
  const base = path.replaceAll('\\', '/').split('/').pop() as string
  const dot = base.lastIndexOf('.')
  return (dot >= 0 ? base.slice(0, dot) : base) || 'part'
}
