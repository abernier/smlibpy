// STEP (ISO 10303-21, AP214) writer for exact B-rep geometry.
//
// Planes, cylinders, cones, spheres, tori, lines, circles and ellipses are written as their
// analytic STEP entities, everything else as (rational) B-spline curves and surfaces with the
// kernel's exact control points and knots. Solids become MANIFOLD_SOLID_BREPs (BREP_WITH_VOIDS for
// hollow ones), sheets become open shells.

import { ext, k } from './kernel.ts'
import { toRgb } from './colors.ts'
import { Part, _Body, _typeName, type ColorLike } from './shapes.ts'
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
function _s(text: string | null | undefined): string {
  let t = ''
  for (const ch of text || '') t += (ch.codePointAt(0) as number) < 128 ? ch : '?'
  return `'${t.replaceAll("'", "''")}'`
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

class _NeedsNurbs extends Error {}

/** Writes the topology of one kernel Brep. */
class _BodyWriter {
  w: _Writer
  brep: number
  dump: Any
  kfaces: number[]
  kedges: number[]
  vertexIds = new Map<number, number>()
  edgeIds = new Map<number, number>()

  constructor(w: _Writer, brep: number) {
    this.w = w
    this.brep = brep
    this.dump = ext.brep_dump(brep, true)
    for (const f of this.dump.faces) {
      const srf = f.surface
      if (!['plane', 'cone', 'sphere', 'torus'].includes(srf.kind) && !('poles' in srf)) throw new _NeedsNurbs()
    }
    this.kfaces = k.brep_faces(brep)
    this.kedges = k.brep_edges(brep)
  }

  // -- geometry -----------------------------------------------------------------------------
  bsplineCurve(c: Any): number {
    const w = this.w
    const pts = (c.poles as V3[]).map((p) => `#${w.point(p)}`).join(',')
    const [uniq, mult] = _mults(c.knots)
    const deg = c.degree
    if (c.weights == null) {
      return w.add(`B_SPLINE_CURVE_WITH_KNOTS('',${deg},(${pts}),.UNSPECIFIED.,.F.,.F.,${_ints(mult)},${_reals(uniq)},.UNSPECIFIED.)`)
    }
    return w.add(
      `(BOUNDED_CURVE() B_SPLINE_CURVE(${deg},(${pts}),.UNSPECIFIED.,.F.,.F.) ` +
        `B_SPLINE_CURVE_WITH_KNOTS(${_ints(mult)},${_reals(uniq)},.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() ` +
        `RATIONAL_B_SPLINE_CURVE(${_reals(c.weights)}) REPRESENTATION_ITEM(''))`,
    )
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

  /** STEP surface for face `idx` and, for analytic surfaces, how its STEP normal runs. */
  surface(idx: number): [number, NormalOf] {
    const s = this.dump.faces[idx].surface
    const w = this.w
    const kind = s.kind
    const pl = s.placement
    if (kind === 'plane') {
      const [z, x] = _orthonormal(pl.z_dir, pl.x_dir)
      return [w.add(`PLANE('',#${w.axis2(pl.origin, z, x)})`), { kind: 'plane', z }]
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
    const [srf, normalOf] = this.surface(idx)
    const bounds: string[] = []
    for (const loop of use.loops) {
      let lp: number
      if (loop.vertex !== null && !loop.edges.length) lp = w.add(`VERTEX_LOOP('',#${this.vertex(loop.vertex)})`)
      else {
        const oes: string[] = []
        for (const [eidx, forward] of loop.edges) {
          const flag = forward ? '.T.' : '.F.'
          const oe = w.add(`ORIENTED_EDGE('',*,*,#${this.edge(eidx)},${flag})`)
          oes.push(`#${oe}`)
        }
        lp = w.add(`EDGE_LOOP('',(${oes.join(',')}))`)
      }
      const kind = loop.outer ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'
      const bound = w.add(`${kind}('',#${lp},.T.)`)
      bounds.push(`#${bound}`)
    }
    const same = this._sameSense(idx, use, normalOf)
    return w.add(`ADVANCED_FACE('',(${bounds.join(',')}),#${srf},${same ? '.T.' : '.F.'})`)
  }

  _sameSense(idx: number, use: Any, normalOf: NormalOf): boolean {
    // The faceuse normal is the kernel's natural normal when the faceuse is SAME.
    if (normalOf === null) return Boolean(use.same) // exported with the kernel's own parameterisation
    const kf = this.kfaces[idx]
    let p = _vec(k.face_interior_point(kf))
    const [, uvs] = k.surface_closest_point(k.face_surface(kf), p)
    let [u, v] = uvs[0] as [number, number]
    if (normalOf.kind === 'cone' || normalOf.kind === 'torus') {
      const { o, z } = normalOf
      const d = _sub(p, o)
      if (_norm(_sub(d, _mul(z, _dot(d, z)))) < 1e-9 * Math.max(1.0, _norm(d))) {
        // The point is on the axis (the apex of a cone): no radial direction there. The sense is
        // a property of the whole surface, so any other point will do.
        const [[u0, v0], [u1, v1]] = k.face_uv_domain(kf)
        u = 0.5 * (u0 + u1)
        v = 0.5 * (v0 + v1)
        p = _vec(k.face_point_at_uv(kf, u, v))
      }
    }
    const nKernel = _vec(k.face_normal_at_uv(kf, u, v))
    const nFace = use.same ? nKernel : _mul(nKernel, -1)
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
    return _dot(nFace, nStep) > 0
  }

  /** MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS items, one per material region. */
  solids(name: string): number[] {
    const d = this.dump
    const items: number[] = []
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
      const shells: number[] = []
      for (const si of region.shells) {
        const faces = (shellFaces.get(si) ?? []).map(([fi, mate]) => this.face(fi, mate))
        shells.push(this.w.add(`CLOSED_SHELL('',(${faces.map((x) => `#${x}`).join(',')}))`))
      }
      if (!shells.length) continue
      if (shells.length === 1) items.push(this.w.add(`MANIFOLD_SOLID_BREP(${_s(name)},#${shells[0]})`))
      else {
        const voids = shells.slice(1).map((s) => this.w.add(`ORIENTED_CLOSED_SHELL('',*,#${s},.F.)`))
        items.push(this.w.add(`BREP_WITH_VOIDS(${_s(name)},#${shells[0]},(${voids.map((v) => `#${v}`).join(',')}))`))
      }
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
  unit?: string
  name?: string | null
  author?: string
  organization?: string
}

/**
 * The text of a STEP file of bodies (parts and sheets). `path` is the file's path, which names
 * the file in the header and the product unless `name` does ('' for a text without a file).
 *
 * The model is in millimeters; with another `unit` the coordinates are converted to it, so the
 * file holds the same part measured in that unit.
 */
export function _stepText(bodies: readonly unknown[], path: string, options: StepOptions = {}): string {
  const { unit = 'mm', name = null, author = '', organization = '' } = options
  const perUnit = _MM_PER_UNIT.get(unit)
  if (perUnit === undefined) throw new RangeError(`unknown unit '${unit}'; use mm, cm, m, um or inch`)
  if (perUnit !== 1.0) {
    const f = 1.0 / perUnit
    bodies = bodies.map((b) => (b instanceof _Body ? b.scale(f) : b))
  }
  const w = new _Writer()
  const product = name || _productName(path)
  const app = w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`)
  const pctx = w.add(`PRODUCT_CONTEXT('',#${app},'mechanical')`)
  const prod = w.add(`PRODUCT(${_s(product)},${_s(product)},'',(#${pctx}))`)
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`)
  const form = w.add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`)
  const dctx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`)
  const pdef = w.add(`PRODUCT_DEFINITION('design','',#${form},#${dctx})`)
  const pshape = w.add(`PRODUCT_DEFINITION_SHAPE('','',#${pdef})`)

  let length: number
  if (unit === 'inch' || unit === 'in') {
    const mm = w.add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))')
    const lm = w.add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${_r(_INCH)}),#${mm})`)
    const dim = w.add('DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)')
    length = w.add(`(CONVERSION_BASED_UNIT('INCH',#${lm}) LENGTH_UNIT() NAMED_UNIT(#${dim}))`)
  } else if (Object.hasOwn(_UNITS, unit)) length = w.add(_UNITS[unit])
  else throw new RangeError(`unknown unit '${unit}'; use mm, cm, m, um or inch`)
  const angle = w.add('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))')
  const solidAngle = w.add('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())')
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${length},'distance_accuracy_value','confusion accuracy')`)
  const ctx = w.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${length},#${angle},#${solidAngle})) ` +
      `REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  )

  const origin = w.axis2([0, 0, 0], [0, 0, 1], [1, 0, 0])
  const solidItems: number[] = []
  const sheetItems: number[] = []
  const styled: [number, [number, number, number]][] = []
  bodies.forEach((body, i) => {
    if (!(body instanceof _Body)) throw new TypeError(`cannot write a ${_typeName(body)} to STEP`)
    const label = body.name || (bodies.length === 1 ? product : `${product}_${i + 1}`)
    let items: number[]
    try {
      const bw = new _BodyWriter(w, body._brep)
      items = body instanceof Part ? bw.solids(label) : bw.sheets(label)
    } catch (e) {
      if (!(e instanceof _NeedsNurbs)) throw e
      const nb = body.toNurbs()
      const bw = new _BodyWriter(w, nb._brep)
      items = body instanceof Part ? bw.solids(label) : bw.sheets(label)
    }
    if (body instanceof Part) solidItems.push(...items)
    else sheetItems.push(...items)
    const rgb = _color(body.color)
    if (rgb !== null) for (const it of items) styled.push([it, rgb])
  })

  const reps: number[] = []
  const list = (ids: number[]) => ids.map((x) => `#${x}`).join(',')
  if (solidItems.length) reps.push(w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${_s(product)},(#${origin},${list(solidItems)}),#${ctx})`))
  if (sheetItems.length) reps.push(w.add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION(${_s(product)},(#${origin},${list(sheetItems)}),#${ctx})`))
  if (!reps.length) throw new RangeError('nothing to write')
  w.add(`SHAPE_DEFINITION_REPRESENTATION(#${pshape},#${reps[0]})`)
  for (const extra of reps.slice(1)) w.add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',#${reps[0]},#${extra})`)

  if (styled.length) {
    const styleIds: number[] = []
    for (const [item, [r, g, b]] of styled) {
      const col = w.add(`COLOUR_RGB('',${_r(r)},${_r(g)},${_r(b)})`)
      const fill = w.add(`FILL_AREA_STYLE_COLOUR('',#${col})`)
      const fas = w.add(`FILL_AREA_STYLE('',(#${fill}))`)
      const ssfa = w.add(`SURFACE_STYLE_FILL_AREA(#${fas})`)
      const sss = w.add(`SURFACE_SIDE_STYLE('',(#${ssfa}))`)
      const ssu = w.add(`SURFACE_STYLE_USAGE(.BOTH.,#${sss})`)
      const psa = w.add(`PRESENTATION_STYLE_ASSIGNMENT((#${ssu}))`)
      styleIds.push(w.add(`STYLED_ITEM('color',(#${psa}),#${item})`))
    }
    w.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${list(styleIds)}),#${ctx})`)
  }

  const header = [
    "FILE_DESCRIPTION(('smlibwasm model'),'2;1');",
    `FILE_NAME(${_s(path.split('/').pop())},${_s(_stamp())},(${_s(author)}),(${_s(organization)}),` + "'smlibwasm','smlibwasm (SMLib kernel)','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
  ]
  return w.text(header)
}

/**
 * Write bodies (parts and sheets) to a STEP file (Node).
 *
 * The model is in millimeters; with another `unit` the coordinates are converted to it, so the
 * file holds the same part measured in that unit.
 */
export function writeStep(bodies: readonly unknown[], path: string, options: StepOptions = {}): void {
  const fs = _fs()
  fs.writeFileSync(path, _stepText(bodies, path, options))
}

/** The local time without its fraction of a second (Python's datetime.now().isoformat()). */
function _stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function _productName(path: string): string {
  const base = path.replaceAll('\\', '/').split('/').pop() as string
  const dot = base.lastIndexOf('.')
  return (dot >= 0 ? base.slice(0, dot) : base) || 'part'
}
