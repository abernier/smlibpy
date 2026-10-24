// IGES (5.3, ASCII) reader: parse the file and interpret its surfaces and solids.
//
// The result is the neutral description of bodies that step_reader.ts gives for STEP (vertices,
// edges with curves, faces with surfaces, shells; millimetres, world coordinates), which
// iges_import.ts turns into kernel topology with the STEP importer's builder.
//
// Read: manifold solid B-rep objects (186, with their shells, faces, loops, edge and vertex lists,
// 514 to 502), trimmed surfaces (144, with their curves on surfaces, 142: the model-space curve, or the
// curve in the parameters of a B-spline surface where the file gives only that), bounded surfaces
// (143, 141), bounded planes (108) and untrimmed B-spline surfaces (128, 114). Their geometry: lines
// (110), circular arcs (100), conic arcs (104), composite curves (102), linear paths (106),
// parametric splines (112) and rational B-spline curves (126); planes (108, 190), cylinders, cones,
// spheres and tori (192 to 198), rational B-spline surfaces (128), parametric spline surfaces
// (114), ruled surfaces (118), surfaces of revolution (120), tabulated cylinders (122) and offset
// surfaces (140); each in its transformation matrix (124). Names come from the name property (406, form 15) or the entity
// label, colors from the color number or definition (314).

import { _identity, _matmul, type Matrix } from './geometry.ts'
import { det3, solve } from './_linalg.ts'
import { BodyData, NotImplementedError, _bodyError, _offsetCurve, _repr } from './step_reader.ts'
import { ext, k, kernelCall } from './kernel.ts'
import { _canonicalCurve } from './shapes.ts'

// biome-ignore lint: curve and surface specs are plain objects of many shapes
type Any = any
type V = number[]
/** A parameter: a number, a string (Hollerith) or null (an empty field). */
export type IgesValue = number | string | null

// -------------------------------------------------------------------------------- parsing
/** One entity: its directory entry and its parameters (pointers are DE numbers). */
export class Entity {
  type: number
  form: number
  /** the sequence number of its first directory line: what pointers to it hold */
  de: number
  params: IgesValue[] = []
  /** DE of its transformation matrix (124), 0: none */
  transform = 0
  /** a color number (1 to 8), or minus the DE of a color definition (314) */
  color = 0
  /** blank status, subordinate switch, entity use flag, hierarchy (2 digits each) */
  status = '00000000'
  label = ''

  constructor(type: number, form: number, de: number) {
    this.type = type
    this.form = form
    this.de = de
  }

  /** 0 independent, 1 physically dependent, 2 logically dependent, 3 both. */
  get subordinate(): number {
    return _int(this.status.slice(2, 4))
  }

  /** 0 geometry, 1 annotation, 2 definition, 3 other, 4 logical, 5 2D parametric, 6 construction. */
  get use(): number {
    return _int(this.status.slice(4, 6))
  }
}

/** The sections of an IGES file: the start text, the global parameters (G1 to G26 by their number)
 * and the entities by DE number. */
export class IgesFile {
  start: string
  globals: Map<number, IgesValue>
  entities: Map<number, Entity>

  constructor(start: string, globals: Map<number, IgesValue>, entities: Map<number, Entity>) {
    this.start = start
    this.globals = globals
    this.entities = entities
  }
}

/** Whether a parameter is a whole number (a pointer, a count, a flag). */
function _whole(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && Number.isInteger(x)
}

function _int(s: string, def = 0): number {
  const t = s.trim()
  if (!t) return def
  if (/^[+-]?\d+$/.test(t)) return Number.parseInt(t, 10)
  const f = Number(t.replace(/[Dd]/g, 'E'))
  return Number.isFinite(f) ? Math.trunc(f) : def
}

function _number(tok: string): number | null {
  const t = tok.trim()
  if (!t) return null
  if (/^[+-]?\d+$/.test(t)) return Number.parseInt(t, 10)
  const f = /^[+-]?(\d+\.?\d*|\.\d+)([EeDd][+-]?\d+)?$/.test(t) ? Number(t.replace(/[Dd]/g, 'E')) : Number.NaN
  if (Number.isNaN(f)) throw new RangeError(`IGES: ${_repr(t)} is not a number`)
  return f
}

const HOLLERITH = / *(\d+)[Hh]/y

/** The values of free-format parameter text up to its record delimiter: numbers, strings
 * (Hollerith, `nH...`) and null for empty fields. */
function _fields(text: string, delim: string, end: string): IgesValue[] {
  const out: IgesValue[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    HOLLERITH.lastIndex = i
    const m = HOLLERITH.exec(text)
    if (m) {
      const start = HOLLERITH.lastIndex
      const k = Number.parseInt(m[1], 10)
      out.push(text.slice(start, start + k))
      i = start + k
      while (i < n && text[i] === ' ') i++
      if (i >= n || text[i] === end) return out
      i++ // the delimiter
      continue
    }
    let j = i
    while (j < n && text[j] !== delim && text[j] !== end) j++
    out.push(_number(text.slice(i, j)))
    if (j >= n || text[j] === end) return out
    i = j + 1
  }
  return out
}

const SECTION = /([SGDPTCsgdptc]) *\d+ *$/

/** The lines of each section (S, G, D, P, T), 80 columns each. */
function _lines(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = { S: [], G: [], D: [], P: [], T: [] }
  text.split(/\r\n|\r|\n/).forEach((raw, k) => {
    let line = raw.replace(/\x1a+$/, '')
    if (!line.trim()) return
    let letter: string
    if (line.length >= 73 && 'SGDPTCB'.includes(line[72].toUpperCase())) letter = line[72].toUpperCase()
    else {
      // (a writer that does not pad its lines: the section letter and number end the line)
      const m = SECTION.exec(line)
      if (!m) throw new RangeError(`not an IGES file (line ${k + 1} has no section letter in column 73)`)
      letter = m[1].toUpperCase()
      line = line.slice(0, m.index).padEnd(72) + letter + line.slice(m.index + 1).trim().padStart(7)
    }
    if ('BC'.includes(letter)) throw new RangeError('IGES: this is a binary or compressed IGES file, which is not read; save it as ASCII IGES')
    sections[letter].push(line.padEnd(80))
  })
  if (!sections.D.length || !sections.G.length) throw new RangeError('not an IGES file (it has no global or directory section)')
  return sections
}

/** The global parameters by number (G1 the parameter, G2 the record delimiter). */
function _globals(text: string): Map<number, IgesValue> {
  let delim = ','
  let end = ';'
  const vals: IgesValue[] = []
  let i = 0
  const result = (): Map<number, IgesValue> => new Map(vals.map((v, k) => [k + 1, v]))
  for (let which = 0; which < 2; which++) {
    // G1, G2: empty (the default) or 1Hc
    HOLLERITH.lastIndex = i
    const m = HOLLERITH.exec(text)
    if (m && Number.parseInt(m[1], 10) === 1 && HOLLERITH.lastIndex < text.length) {
      const c = text[HOLLERITH.lastIndex]
      if (which === 0) delim = c
      else end = c
      vals.push(c)
      i = HOLLERITH.lastIndex + 1
    } else vals.push(null)
    while (i < text.length && text[i] === ' ') i++
    if (i >= text.length || text[i] === end) return result()
    i++ // the delimiter after the field
  }
  vals.push(..._fields(text.slice(i), delim, end))
  const out = result()
  out.set(1, delim)
  out.set(2, end)
  return out
}

/** Parse an IGES file (ASCII, the fixed 80-column format). */
export function parse(text: string): IgesFile {
  const s = _lines(text)
  const g = _globals(s.G.map((l) => l.slice(0, 72)).join(''))
  const delim = g.get(1) as string
  const end = g.get(2) as string
  // parameter lines by their DE pointer (columns 66 to 72), in order
  const pdata = new Map<number, string[]>()
  for (const line of s.P) {
    const de = _int(line.slice(64, 72))
    if (!pdata.has(de)) pdata.set(de, [])
    pdata.get(de)?.push(line.slice(0, 64))
  }
  const entities = new Map<number, Entity>()
  const d = s.D
  for (let k = 0; k + 1 < d.length; k += 2) {
    const l1 = d[k]
    const l2 = d[k + 1]
    const de = _int(l1.slice(73, 80), k + 1)
    const e = new Entity(_int(l1.slice(0, 8)), _int(l2.slice(32, 40)), de)
    e.transform = _int(l1.slice(48, 56))
    e.color = _int(l2.slice(16, 24))
    e.status = l1.slice(64, 72).replace(/ /g, '0')
    e.label = l2.slice(56, 64).trim()
    const lines = pdata.get(de)
    if (lines?.length) e.params = _fields(lines.join(''), delim, end).slice(1)
    entities.set(de, e)
  }
  return new IgesFile(s.S.map((l) => l.slice(0, 72)).join('').trimEnd(), g, entities)
}

// -------------------------------------------------------------------------------- interpretation
/** millimetres per unit of the global unit flag (G14), and of the unit names (G15) */
const UNIT_FLAGS = new Map<number, number>([
  [1, 25.4],
  [2, 1.0],
  [4, 304.8],
  [5, 1609344.0],
  [6, 1000.0],
  [7, 1e6],
  [8, 0.0254],
  [9, 0.001],
  [10, 10.0],
  [11, 2.54e-5],
])
const UNIT_NAMES = new Map<string, number>([
  ['IN', 25.4],
  ['INCH', 25.4],
  ['MM', 1.0],
  ['FT', 304.8],
  ['MI', 1609344.0],
  ['M', 1000.0],
  ['KM', 1e6],
  ['MIL', 0.0254],
  ['UM', 0.001],
  ['CM', 10.0],
  ['UIN', 2.54e-5],
])
/** the standard color numbers (directory field 13) */
const COLORS = new Map<number, number[]>([
  [1, [0, 0, 0]],
  [2, [1, 0, 0]],
  [3, [0, 1, 0]],
  [4, [0, 0, 1]],
  [5, [1, 1, 0]],
  [6, [1, 0, 1]],
  [7, [0, 1, 1]],
  [8, [1, 1, 1]],
])
/** what a message calls the entities a body or face comes from */
const KINDS = new Map<number, string>([
  [186, 'solid'],
  [514, 'shell'],
  [144, 'trimmed surface'],
  [143, 'bounded surface'],
  [108, 'bounded plane'],
  [128, 'surface'],
  [114, 'surface'],
  [408, 'subfigure instance'],
])

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
  if (!(n > 0)) throw new RangeError('IGES: a direction of length 0')
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** The direction a curve of `segments` runs in at its point `p` (at parameter `t` of a B-spline). */
function _tangent(curve: Any, p: V, t: number | undefined): V {
  const kind = curve.kind
  if (kind === 'line') return curve.direction as V
  if (kind === 'circle' || kind === 'ellipse') {
    const [o, z, x] = [curve.origin as V, curve.z as V, curve.x as V]
    const y = _cross(z, x)
    const [r1, r2] = kind === 'circle' ? [curve.radius, curve.radius] : [curve.r1, curve.r2]
    const a = Math.atan2(_dot(_sub(p, o), y) / r2, _dot(_sub(p, o), x) / r1)
    return _add(_mul(x, -r1 * Math.sin(a)), _mul(y, r2 * Math.cos(a)))
  }
  if (kind === 'bspline') {
    const ks: number[] = curve.knots
    const deg: number = curve.degree
    const [lo, hi] = [ks[deg], ks[ks.length - deg - 1]]
    const s = t ?? lo
    const h = 1e-7 * (hi - lo)
    return _sub(bsplinePoint(curve, Math.min(hi, s + h)), bsplinePoint(curve, Math.max(lo, s - h)))
  }
  throw new NotImplementedError(`an offset of a ${kind}`)
}

function _perpendicular(z: V): V {
  return _unit(_cross(z, Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
}

// Python's float %: the sign of the divisor.
function _mod(a: number, b: number): number {
  const m = a % b
  return m !== 0 && m < 0 !== b < 0 ? m + b : m
}

/** The knot span of `t` and the degree + 1 B-spline basis functions that are not 0 there. */
function _basis(knots: number[], degree: number, t: number): [number, number[]] {
  const n = knots.length - degree - 2 // the last control point's index
  t = Math.min(Math.max(t, knots[degree]), knots[n + 1])
  let span = degree
  while (span < n && t >= knots[span + 1]) span++
  const left = new Array(degree + 1).fill(0)
  const right = new Array(degree + 1).fill(0)
  const N = [1, ...new Array(degree).fill(0)]
  for (let j = 1; j <= degree; j++) {
    left[j] = t - knots[span + 1 - j]
    right[j] = knots[span + j] - t
    let saved = 0
    for (let r = 0; r < j; r++) {
      const d = right[r + 1] + left[j - r]
      const tmp = d !== 0 ? N[r] / d : 0
      N[r] = saved + right[r + 1] * tmp
      saved = left[j - r] * tmp
    }
    N[j] = saved
  }
  return [span, N]
}

/** The point of a B-spline curve spec (`degree`, `poles`, `knots`, `weights`) at `t`. */
export function bsplinePoint(spec: Any, t: number): V {
  const p = Math.trunc(spec.degree)
  const [span, N] = _basis(spec.knots, p, t)
  const w: number[] | null = spec.weights
  let num = [0, 0, 0]
  let den = 0
  for (let i = 0; i <= p; i++) {
    const k = span - p + i
    const wi = w === null ? 1 : w[k]
    num = _add(num, _mul(spec.poles[k], N[i] * wi))
    den += N[i] * wi
  }
  return _mul(num, 1 / den)
}

/** Eigenvalues (ascending) and unit eigenvectors (as columns: `vectors[i]` belongs to `values[i]`)
 * of a symmetric 2 x 2 matrix [[a, b], [b, c]]. */
function _eigh2(a: number, b: number, c: number): [number[], number[][]] {
  if (b === 0) return a <= c ? [[a, c], [[1, 0], [0, 1]]] : [[c, a], [[0, 1], [1, 0]]]
  const mean = (a + c) / 2
  const r = Math.hypot((a - c) / 2, b)
  const l0 = mean - r
  const l1 = mean + r
  const v0 = _unit2([b, l0 - a])
  return [
    [l0, l1],
    [v0, [-v0[1], v0[0]]],
  ]
}

function _unit2(v: number[]): number[] {
  const n = Math.hypot(v[0], v[1])
  return [v[0] / n, v[1] / n]
}

function _matrix(rows: number[][]): Matrix {
  const m = new Float64Array(16)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = rows[r][c]
  return m
}

class _Interp {
  f: IgesFile
  mm: number
  resolution: number | null
  root: Matrix

  constructor(f: IgesFile) {
    this.f = f
    const flag = f.globals.get(14)
    const name = f.globals.get(15)
    let mm = _whole(flag) ? UNIT_FLAGS.get(flag) : undefined
    if (mm === undefined && typeof name === 'string') mm = UNIT_NAMES.get(name.trim().toUpperCase())
    this.mm = mm || 1.0
    const res = f.globals.get(19)
    this.resolution = typeof res === 'number' && res > 0 ? res * this.mm : null
    this.root = _matrix([
      [this.mm, 0, 0, 0],
      [0, this.mm, 0, 0],
      [0, 0, this.mm, 0],
      [0, 0, 0, 1],
    ])
  }

  // -- entities and transforms
  get(de: unknown, ...types: number[]): Entity {
    if (!_whole(de) || de <= 0) throw new RangeError(`IGES: ${de === null ? 'None' : String(de)} where a pointer to an entity is expected`)
    const e = this.f.entities.get(de)
    if (e === undefined) throw new RangeError(`IGES: the file has no entity at DE ${de}`)
    if (types.length && !types.includes(e.type)) throw new NotImplementedError(`entity type ${e.type} (DE ${de}) where ${types.join(' or ')} is expected`)
    return e
  }

  /** A transformation matrix (124) into the space of the entity that uses it: its own, then the
   * one its own directory entry names. */
  matrix(de: number, depth = 0): Matrix {
    if (depth > 32) throw new RangeError('IGES: transformation matrices refer to each other in a circle')
    const e = this.get(de, 124)
    const p = this.nums(e, 0, 12)
    const m = _matrix([p.slice(0, 4), p.slice(4, 8), p.slice(8, 12), [0, 0, 0, 1]])
    return e.transform ? _matmul(this.matrix(e.transform, depth + 1), m) : m
  }

  /** The transformation from an entity's definition space to model space (mm). */
  placed(e: Entity, M: Matrix): Matrix {
    return e.transform ? _matmul(M, this.matrix(e.transform)) : M
  }

  static P(M: Matrix, p: V): V {
    return [0, 1, 2].map((r) => M[r * 4] * p[0] + M[r * 4 + 1] * p[1] + M[r * 4 + 2] * p[2] + M[r * 4 + 3])
  }

  static D(M: Matrix, d: V): V {
    return _unit([0, 1, 2].map((r) => M[r * 4] * d[0] + M[r * 4 + 1] * d[1] + M[r * 4 + 2] * d[2]))
  }

  /** The scale of a conformal transformation (a rotation, maybe mirrored, and a scale). */
  static scale(M: Matrix): number {
    const R = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]
    const s = Math.abs(det3(R)) ** (1 / 3)
    let ok = s > 0
    for (let i = 0; i < 3 && ok; i++)
      for (let j = 0; j < 3 && ok; j++) {
        const rtr = R[i] * R[j] + R[3 + i] * R[3 + j] + R[6 + i] * R[6 + j]
        ok = Math.abs(rtr - (i === j ? s * s : 0)) <= 1e-6 * s * s
      }
    if (!ok) throw new NotImplementedError('a transformation matrix that is not a rotation and a uniform scale')
    return s
  }

  /** 1 for a transformation that keeps counterclockwise, -1 for a mirroring one. */
  static handed(M: Matrix): number {
    return det3([M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]) >= 0 ? 1 : -1
  }

  nums(e: Entity, start: number, count: number): number[] {
    const vals = e.params.slice(start, start + count)
    if (vals.length < count || vals.some((v) => typeof v === 'string')) throw new RangeError(`IGES: entity ${e.type} (DE ${e.de}) has too few parameters`)
    return vals.map((v) => (v === null ? 0 : (v as number)))
  }

  ints(e: Entity, start: number, count: number): number[] {
    return this.nums(e, start, count).map((v) => Math.trunc(v))
  }

  // -- names and colors
  /** The name property (406, form 15) among the pointers after an entity's own `own` parameters
   * (and its associativities), else its label. */
  name(e: Entity, own: number | null): string {
    const rest = own !== null ? e.params.slice(own) : []
    if (rest.length && _whole(rest[0]) && rest[0] >= 0 && rest[0] < rest.length - 1 && _whole(rest[rest[0] + 1])) {
      const nv = rest[0]
      const np = rest[nv + 1] as number
      for (const de of rest.slice(nv + 2, nv + 2 + np)) {
        const p = _whole(de) ? this.f.entities.get(de) : undefined
        if (p !== undefined && p.type === 406 && p.form === 15 && p.params.length > 1 && typeof p.params[1] === 'string') return p.params[1].trim()
      }
    }
    return e.label
  }

  color(e: Entity): number[] | null {
    if (e.color > 0) return COLORS.get(e.color) ?? null
    if (e.color < 0) {
      const c = this.f.entities.get(-e.color)
      if (c !== undefined && c.type === 314 && c.params.length >= 3) {
        if (c.params.slice(0, 3).some((x) => typeof x === 'string')) return null
        return c.params.slice(0, 3).map((x) => Math.min(Math.max(((x as number) || 0) / 100, 0), 1))
      }
    }
    return null
  }

  // -- curves
  /** The pieces of a model-space curve: `{curve: spec, p0, p1}`, each running from p0 to p1 (the
   * spec as step_reader's curves; circles and ellipses run counterclockwise about their z). */
  segments(de: number, M: Matrix, depth = 0): Any[] {
    if (depth > 64) throw new RangeError('IGES: composite curves refer to each other in a circle')
    const e = this.get(de)
    M = this.placed(e, M)
    const t = e.type
    const P = _Interp.P
    if (t === 102) {
      const n = this.ints(e, 0, 1)[0]
      const out: Any[] = []
      for (const child of this.ints(e, 1, n)) out.push(...this.segments(child, M, depth + 1))
      return out
    }
    if (t === 110) {
      const v = this.nums(e, 0, 6)
      const p0 = P(M, v.slice(0, 3))
      const p1 = P(M, v.slice(3, 6))
      return [{ curve: { kind: 'line', origin: p0, direction: _sub(p1, p0) }, p0, p1 }]
    }
    if (t === 100) {
      const [zt, x1, y1, x2, y2, x3, y3] = this.nums(e, 0, 7)
      const c = [x1, y1, zt]
      const s0 = [x2, y2, zt]
      const s1 = [x3, y3, zt]
      const r = _norm(_sub(s0, c))
      if (!(r > 0)) throw new RangeError(`IGES: the circular arc at DE ${de} has a radius of 0`)
      const closed = _norm(_sub(s1, s0)) <= 1e-9 * r
      const end = closed ? s0 : _add(c, _mul(_sub(s1, c), r / _norm(_sub(s1, c)))) // (on the circle)
      const o = P(M, c)
      const p0 = P(M, s0)
      const p1 = P(M, end)
      const z = _mul(_Interp.D(M, [0, 0, 1]), _Interp.handed(M))
      const spec = { kind: 'circle', origin: o, z, x: _unit(_sub(p0, o)), radius: r * _Interp.scale(M) }
      return [{ curve: spec, p0, p1: closed ? p0 : p1 }]
    }
    if (t === 104) return [this.conic(e, M)]
    if (t === 126) {
      const [spec, t0, t1] = this.bsplineCurve(e, M)
      return [{ curve: spec, p0: bsplinePoint(spec, t0), p1: bsplinePoint(spec, t1), t0, t1 }]
    }
    if (t === 106 || t === 112) {
      const spec = t === 106 ? this.polyline(e, M) : this.parametricSpline(e, M)
      const ks: number[] = spec.knots
      return [{ curve: spec, p0: spec.poles[0], p1: spec.poles[spec.poles.length - 1], t0: ks[0], t1: ks[ks.length - 1] }]
    }
    if (t === 130) return [this.offsetCurve(e, M, depth)]
    throw new NotImplementedError(`curve entity ${t} (DE ${de})`)
  }

  /** An offset curve (130) at one distance: its base curve moved by it along the base's tangent x the
   * normal of the plane it lies in (as OpenCASCADE reads such files, and its own offset curves; STEP's
   * OFFSET_CURVE_3D offsets the other way round; a mirroring transformation turns the normal round).
   * Lines and circles about the normal stay lines and circles; other curves become the kernel's offset
   * curve, a NURBS. */
  offsetCurve(e: Entity, M: Matrix, depth: number): Any {
    const [baseDe, flag] = this.ints(e, 0, 2)
    if (flag !== 1) throw new NotImplementedError(`an offset curve whose distance varies (DE ${e.de})`)
    const d = this.nums(e, 4, 1)[0] * _Interp.scale(M)
    const normal = _mul(_Interp.D(M, this.nums(e, 8, 3)), _Interp.handed(M))
    const pieces = this.segments(baseDe, M, depth + 1)
    if (pieces.length !== 1) throw new NotImplementedError(`an offset of a composite curve (DE ${e.de})`)
    const b = pieces[0]
    const base = b.curve
    const spec = _offsetCurve(base, d, normal, `DE ${e.de}`, 'import IGES offset curve')
    const closed = _norm(_sub(b.p1, b.p0)) <= 1e-12 * Math.max(1, _norm(b.p0))
    // (an arc's angle is not the parameter of the NURBS its offset becomes)
    if (spec.kind === 'bspline' && base.kind !== 'bspline' && !closed)
      throw new NotImplementedError(`an offset of a ${base.kind} arc out of its plane (DE ${e.de})`)
    const end = (p: V, t: number | undefined): V => _add(p, _mul(_unit(_cross(_tangent(base, p, t), normal)), d))
    const out: Any = { curve: spec, p0: end(b.p0, b.t0), p1: end(b.p1, b.t1) }
    if (spec.kind === 'bspline' && b.t0 !== undefined) {
      // (the kernel's offset keeps its basis's parameters)
      out.t0 = b.t0
      out.t1 = b.t1
    }
    return out
  }

  /** One whole curve (a generatrix, a directrix) as a step_reader curve spec, with its ends `p0`
   * and `p1`. */
  curve(de: number, M: Matrix): Any {
    const segs = this.segments(de, M)
    if (segs.length !== 1) throw new NotImplementedError(`a composite curve (DE ${de}) as the curve of a surface`)
    return { ...segs[0].curve, p0: segs[0].p0, p1: segs[0].p1 }
  }

  /** A rational B-spline curve (126), and the parameters its piece starts and ends at. */
  bsplineCurve(e: Entity, M: Matrix): [Any, number, number] {
    const [k, m] = this.ints(e, 0, 2)
    if (k < 1 || m < 1 || k < m) throw new RangeError(`IGES: the B-spline curve at DE ${e.de} has ${k + 1} control points of degree ${m}`)
    const polynomial = this.ints(e, 4, 1)[0] === 1
    const nk = k + m + 2
    const knots = this.nums(e, 6, nk)
    const weights = this.nums(e, 6 + nk, k + 1)
    const xyz = this.nums(e, 6 + nk + k + 1, 3 * (k + 1))
    let [v0, v1] = this.nums(e, 6 + nk + 4 * (k + 1), 2)
    if (knots.some((a, i) => i > 0 && a < knots[i - 1])) throw new RangeError(`IGES: the knots of the B-spline curve at DE ${e.de} decrease`)
    if (weights.some((w) => !(w > 0))) throw new RangeError(`IGES: the B-spline curve at DE ${e.de} has a weight that is not positive`)
    const poles: V[] = []
    for (let i = 0; i <= k; i++) poles.push(_Interp.P(M, xyz.slice(3 * i, 3 * i + 3)))
    const same = polynomial || weights.every((w) => Math.abs(w - weights[0]) <= 1e-12 * weights[0])
    const lo = knots[m]
    const hi = knots[k + 1]
    if (!(v0 < v1)) {
      v0 = lo
      v1 = hi
    }
    const spec = { kind: 'bspline', degree: m, poles, knots, weights: same ? null : weights }
    return [spec, Math.min(Math.max(v0, lo), hi), Math.min(Math.max(v1, lo), hi)]
  }

  /** A linear path (106, forms 11, 12, 63) as a B-spline of degree 1. */
  polyline(e: Entity, M: Matrix): Any {
    if (![11, 12, 63].includes(e.form)) throw new NotImplementedError(`copious data of form ${e.form} (DE ${e.de}) as a curve`)
    const [ip, n] = this.ints(e, 0, 2)
    if (n < 2) throw new RangeError(`IGES: the linear path at DE ${e.de} has fewer than 2 points`)
    const pts: V[] = []
    if (ip === 1) {
      const zt = this.nums(e, 2, 1)[0]
      const xy = this.nums(e, 3, 2 * n)
      for (let i = 0; i < n; i++) pts.push([xy[2 * i], xy[2 * i + 1], zt])
    } else {
      const step = ip === 2 ? 3 : 6
      const v = this.nums(e, 2, step * n)
      for (let i = 0; i < n; i++) pts.push(v.slice(step * i, step * i + 3))
    }
    const knots = [0, ...Array.from({ length: n }, (_, i) => i), n - 1]
    return { kind: 'bspline', degree: 1, poles: pts.map((p) => _Interp.P(M, p)), knots, weights: null }
  }

  /** A parametric spline curve (112) as the cubic B-spline of its pieces. */
  parametricSpline(e: Entity, M: Matrix): Any {
    const n = this.ints(e, 3, 1)[0]
    if (n < 1) throw new RangeError(`IGES: the parametric spline at DE ${e.de} has no segments`)
    const T = this.nums(e, 4, n + 1)
    const poles: V[] = []
    for (let i = 0; i < n; i++) {
      const c = this.nums(e, 5 + n + 12 * i, 12) // AX BX CX DX AY BY CY DY AZ BZ CZ DZ
      const h = T[i + 1] - T[i]
      const [a, b, cc, d] = [0, 1, 2, 3].map((j) => [c[j], c[4 + j], c[8 + j]])
      if (i === 0) poles.push(a)
      poles.push(
        _add(a, _mul(b, h / 3)),
        _add(_add(a, _mul(b, (h * 2) / 3)), _mul(cc, (h * h) / 3)),
        _add(_add(_add(a, _mul(b, h)), _mul(cc, h * h)), _mul(d, h ** 3)),
      )
    }
    const knots = [...new Array(4).fill(T[0]), ...T.slice(1, -1).flatMap((x) => [x, x, x]), ...new Array(4).fill(T[T.length - 1])]
    return { kind: 'bspline', degree: 3, poles: poles.map((p) => _Interp.P(M, p)), knots, weights: null }
  }

  /** A conic arc (104) from its start to its end point (an ellipse counterclockwise): an ellipse, a
   * hyperbola or a parabola, wherever its equation puts it. */
  conic(e: Entity, M: Matrix): Any {
    const [A, B, C, Dd, E, F, zt, x1, y1, x2, y2] = this.nums(e, 0, 11)
    const L = [Dd, E]
    const s0 = [x1, y1]
    const s1 = [x2, y2]
    const [lam, vecs] = _eigh2(A, B / 2, C)
    const scale = _Interp.scale(M)
    const z = _mul(_Interp.D(M, [0, 0, 1]), _Interp.handed(M))
    const P2 = (p: number[]): V => _Interp.P(M, [p[0], p[1], zt])
    const D2 = (d: number[]): V => _Interp.D(M, [d[0], d[1], 0])
    const dot2 = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1]
    const big = Math.max(Math.abs(lam[0]), Math.abs(lam[1]))
    if (!(big > 0)) throw new RangeError(`IGES: the conic at DE ${e.de} has no quadratic terms`)
    if (Math.min(Math.abs(lam[0]), Math.abs(lam[1])) <= 1e-12 * big) {
      // a parabola
      const i = Math.abs(lam[0]) > Math.abs(lam[1]) ? 0 : 1
      const u = vecs[i] // across its axis
      const w = vecs[1 - i] // along it
      const l1 = lam[i]
      const du = dot2(L, u)
      const dw = dot2(L, w)
      if (Math.abs(dw) <= 1e-14 * (Math.abs(du) + Math.abs(F) + 1)) throw new RangeError(`IGES: the parabola at DE ${e.de} is degenerate`)
      // l1 X^2 + du X + dw Y + F = 0, X along u, Y along w: Y - y0 = opening (X - x0)^2
      const x0 = -du / (2 * l1)
      const y0 = -(F - (du * du) / (4 * l1)) / dw
      const opening = -l1 / dw
      const xdir = opening > 0 ? w : [-w[0], -w[1]]
      const spec = {
        kind: 'parabola',
        origin: P2([u[0] * x0 + w[0] * y0, u[1] * x0 + w[1] * y0]),
        z,
        x: D2(xdir),
        focal: scale / (4 * Math.abs(opening)),
      }
      return { curve: spec, p0: P2(s0), p1: P2(s1) }
    }
    const [[cx], [cy]] = solve(
      [
        [2 * A, B],
        [B, 2 * C],
      ],
      [[-Dd], [-E]],
    )
    const center = [cx, cy]
    const f0 = A * cx * cx + B * cx * cy + C * cy * cy + Dd * cx + E * cy + F
    const a2 = -f0 / lam[0]
    const b2 = -f0 / lam[1]
    if (a2 > 0 && b2 > 0) {
      const i = a2 >= b2 ? 0 : 1 // x along the major axis
      const r1 = Math.sqrt(Math.max(a2, b2))
      const r2 = Math.sqrt(Math.min(a2, b2))
      const spec = { kind: 'ellipse', origin: P2(center), z, x: D2(vecs[i]), r1: r1 * scale, r2: r2 * scale }
      const closed = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) <= 1e-9 * r1
      const p0 = P2(s0)
      return { curve: spec, p0, p1: closed ? p0 : P2(s1) }
    }
    if (!(a2 * b2 < 0)) throw new RangeError(`IGES: the conic at DE ${e.de} is neither an ellipse, a hyperbola nor a parabola`)
    const i = a2 > 0 ? 0 : 1 // x across the branches, toward the one the arc lies on
    const xdir = dot2([s0[0] - cx, s0[1] - cy], vecs[i]) >= 0 ? vecs[i] : [-vecs[i][0], -vecs[i][1]]
    const a = Math.sqrt(Math.abs(i === 0 ? a2 : b2))
    const b = Math.sqrt(Math.abs(i === 0 ? b2 : a2))
    const spec = { kind: 'hyperbola', origin: P2(center), z, x: D2(xdir), a: a * scale, b: b * scale }
    return { curve: spec, p0: P2(s0), p1: P2(s1) }
  }

  // -- surfaces
  /** A surface as a step_reader surface spec, in model space, with `sense`: 1 where the spec's
   * normal is the IGES surface's (the cross product of its derivatives in u and v, which a face
   * and its boundaries are oriented by), -1 where it is the opposite one. */
  surface(de: number, M: Matrix): Any {
    const e = this.get(de)
    M = this.placed(e, M)
    const t = e.type
    if (t === 108) {
      const [a, b, c, d] = this.nums(e, 0, 4)
      const sym = e.params.length >= 8 ? this.nums(e, 5, 3) : [0, 0, 0]
      const n = [a, b, c]
      const nn = _dot(n, n)
      if (!(nn > 0)) throw new RangeError(`IGES: the plane at DE ${de} has no normal`)
      const z = _Interp.D(M, n)
      return {
        kind: 'plane',
        origin: _Interp.P(M, _add(sym, _mul(n, (d - _dot(n, sym)) / nn))),
        z,
        x: _perpendicular(z),
        sense: _Interp.handed(M),
      }
    }
    if ([190, 192, 194, 196, 198].includes(t)) return { ...this.analytic(e, M), sense: _Interp.handed(M) }
    if (t === 128) return { ...this.bsplineSurface(e, M)[0], sense: 1 }
    if (t === 114) return { ...this.splineSurface(e, M), sense: 1 }
    if (t === 118) return this.ruled(e, M)
    if (t === 120) return this.revolution(e, M)
    if (t === 122) return this.tabulated(e, M)
    if (t === 140) {
      const d = this.nums(e, 0, 4)[3]
      const basis = this.surface(this.ints(e, 4, 1)[0], M)
      return { kind: 'offset', basis, distance: d * _Interp.scale(M), sense: basis.sense }
    }
    throw new NotImplementedError(`surface entity ${t} (DE ${de})`)
  }

  point(de: number, M: Matrix): V {
    const e = this.get(de, 116)
    return _Interp.P(this.placed(e, M), this.nums(e, 0, 3))
  }

  direction(de: number, M: Matrix): V {
    const e = this.get(de, 123)
    return _Interp.D(this.placed(e, M), this.nums(e, 0, 3))
  }

  /** A plane, cylinder, cone, sphere or torus (190 to 198): form 1 gives the reference direction
   * (the x axis), form 0 none. */
  analytic(e: Entity, M: Matrix): Any {
    const t = e.type
    const s = _Interp.scale(M)
    const p = e.params
    const ref = (i: number, z: V): V => (e.form === 1 && p.length > i && p[i] ? this.direction(p[i] as number, M) : _perpendicular(z))
    if (t === 190) {
      const o = this.point(p[0] as number, M)
      const z = this.direction(p[1] as number, M)
      return { kind: 'plane', origin: o, z, x: ref(2, z) }
    }
    if (t === 192) {
      const o = this.point(p[0] as number, M)
      const z = this.direction(p[1] as number, M)
      return { kind: 'cylinder', origin: o, z, x: ref(3, z), radius: this.nums(e, 2, 1)[0] * s }
    }
    if (t === 194) {
      const o = this.point(p[0] as number, M)
      const z = this.direction(p[1] as number, M)
      const [r, angle] = this.nums(e, 2, 2)
      return { kind: 'cone', origin: o, z, x: ref(4, z), radius: r * s, semi_angle: (angle * Math.PI) / 180 }
    }
    if (t === 196) {
      const o = this.point(p[0] as number, M)
      const r = this.nums(e, 1, 1)[0]
      let z: V
      let x: V
      if (e.form === 1 && p.length > 3 && p[2] && p[3]) {
        z = this.direction(p[2] as number, M)
        x = this.direction(p[3] as number, M)
      } else {
        z = _Interp.D(M, [0, 0, 1])
        x = _perpendicular(z)
      }
      return { kind: 'sphere', origin: o, z, x, radius: r * s }
    }
    const o = this.point(p[0] as number, M)
    const z = this.direction(p[1] as number, M)
    const [major, minor] = this.nums(e, 2, 2)
    return { kind: 'torus', origin: o, z, x: ref(4, z), major: major * s, minor: minor * s }
  }

  /** A rational B-spline surface (128), and the parameter range the file gives it. */
  bsplineSurface(e: Entity, M: Matrix): [Any, [number, number, number, number]] {
    const [k1, k2, m1, m2] = this.ints(e, 0, 4)
    const polynomial = this.ints(e, 6, 1)[0] === 1
    const n1 = k1 + m1 + 2
    const n2 = k2 + m2 + 2
    const nu = k1 + 1
    const nv = k2 + 1
    if (m1 < 1 || m2 < 1 || nu < m1 + 1 || nv < m2 + 1)
      throw new RangeError(`IGES: the B-spline surface at DE ${e.de} has too few control points for its degree`)
    const uk = this.nums(e, 9, n1)
    const vk = this.nums(e, 9 + n1, n2)
    const at = 9 + n1 + n2
    const w = this.nums(e, at, nu * nv)
    const xyz = this.nums(e, at + nu * nv, 3 * nu * nv)
    const rng = this.nums(e, at + 4 * nu * nv, 4)
    const decreasing = (ks: number[]): boolean => ks.some((x, i) => i > 0 && x < ks[i - 1])
    if (decreasing(uk) || decreasing(vk)) throw new RangeError(`IGES: the knots of the B-spline surface at DE ${e.de} decrease`)
    if (w.some((x) => !(x > 0))) throw new RangeError(`IGES: the B-spline surface at DE ${e.de} has a weight that is not positive`)
    // the file lists the control points with u running fastest, the spec u by u
    const order: number[] = []
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) order.push(j * nu + i)
    const poles = order.map((q) => _Interp.P(M, xyz.slice(3 * q, 3 * q + 3)))
    const weights = order.map((q) => w[q])
    const same = polynomial || weights.every((x) => Math.abs(x - weights[0]) <= 1e-12 * weights[0])
    const spec = { kind: 'bspline', u_degree: m1, v_degree: m2, nu, nv, poles, u_knots: uk, v_knots: vk, weights: same ? null : weights }
    return [spec, [rng[0], rng[1], rng[2], rng[3]]]
  }

  /** A parametric spline surface (114) as the bicubic B-spline of its patches. */
  splineSurface(e: Entity, M: Matrix): Any {
    const [m, n] = this.ints(e, 2, 2)
    if (m < 1 || n < 1) throw new RangeError(`IGES: the parametric spline surface at DE ${e.de} has no patches`)
    const tu = this.nums(e, 4, m + 1)
    const tv = this.nums(e, 5 + m, n + 1)
    const at = 6 + m + n
    const nu = 3 * m + 1
    const nv = 3 * n + 1
    const grid: V[][] = Array.from({ length: nu }, () => Array.from({ length: nv }, () => [0, 0, 0]))
    // the cubic power basis on [0, h] in Bernstein form on [0, 1]
    const bern = (h: number): number[][] => {
      const s = [1, h, h * h, h ** 3]
      const B = [
        [1, 0, 0, 0],
        [1, 1 / 3, 0, 0],
        [1, 2 / 3, 1 / 3, 0],
        [1, 1, 1, 1],
      ]
      return B.map((row) => row.map((x, k) => x * s[k]))
    }
    for (let i = 0; i < m; i++) {
      const Bu = bern(tu[i + 1] - tu[i])
      for (let j = 0; j < n; j++) {
        const Bv = bern(tv[j + 1] - tv[j])
        const c = this.nums(e, at + 48 * (i * (n + 1) + j), 48)
        for (let axis = 0; axis < 3; axis++) {
          // the coefficients of s^k t^l (AX, BX, ..., PX), k running fastest: a[k][l]
          const a = [0, 1, 2, 3].map((k) => [0, 1, 2, 3].map((l) => c[16 * axis + 4 * l + k]))
          for (let r = 0; r < 4; r++)
            for (let q = 0; q < 4; q++) {
              let sum = 0
              for (let k = 0; k < 4; k++) for (let l = 0; l < 4; l++) sum += Bu[r][k] * a[k][l] * Bv[q][l]
              grid[3 * i + r][3 * j + q][axis] = sum
            }
        }
      }
    }
    const poles: V[] = []
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) poles.push(_Interp.P(M, grid[i][j]))
    const knots = (ts: number[]): number[] => [...new Array(4).fill(ts[0]), ...ts.slice(1, -1).flatMap((x) => [x, x, x]), ...new Array(4).fill(ts[ts.length - 1])]
    return { kind: 'bspline', u_degree: 3, v_degree: 3, nu, nv, poles, u_knots: knots(tu), v_knots: knots(tv), weights: null }
  }

  /** A ruled surface (118): straight lines from the first curve (v = 0) to the second (v = 1), between
   * points at equal parameters along them (form 1; form 0, equal arc lengths, is read so too), the
   * second curve run backwards where the entity says so. The curves are lines or B-spline curves. */
  ruled(e: Entity, M: Matrix): Any {
    const [de1, de2, backwards] = this.ints(e, 0, 3)
    const kernelCurves: number[] = []
    let d: Any
    try {
      for (const de of [de1, de2]) {
        const segs = this.segments(de, M)
        if (segs.length !== 1) throw new NotImplementedError(`a composite curve (DE ${de}) as a curve of a ruled surface`)
        const s = segs[0]
        let c = s.curve
        if (c.kind === 'line') c = { kind: 'bspline', degree: 1, poles: [s.p0, s.p1], knots: [0, 0, 1, 1], weights: null }
        else if (c.kind !== 'bspline') throw new NotImplementedError(`a ${c.kind} as a curve of a ruled surface`)
        const ks: number[] = c.knots
        const p = c.degree
        const lo = ks[p]
        const hi = ks[ks.length - p - 1]
        const t0 = s.t0 ?? lo
        const t1 = s.t1 ?? hi
        kernelCall('import IGES', () => {
          const whole = _canonicalCurve(c.poles, ks, p, c.weights)
          kernelCurves.push(whole)
          if (t0 > lo + 1e-12 * (hi - lo) || t1 < hi - 1e-12 * (hi - lo)) {
            // (the piece the entity takes)
            kernelCurves[kernelCurves.length - 1] = ext.trimmed_curve(whole, t0, t1)
            ext.delete_curve(whole)
          }
        })
      }
      if (backwards === 1) kernelCall('import IGES', () => ext.reverse_curve(kernelCurves[1]))
      d = kernelCall('import IGES', () => {
        const srf = k.create_ruled_surface(kernelCurves[0], kernelCurves[1])
        try {
          return ext.surface_data(srf, true)
        } finally {
          ext.delete_surface(srf)
        }
      })
    } finally {
      for (const kc of kernelCurves) ext.delete_curve(kc)
    }
    const uk = Array.from(d.u_knots as Iterable<number>)
    const vk = Array.from(d.v_knots as Iterable<number>)
    return {
      kind: 'bspline',
      u_degree: d.u_degree,
      v_degree: d.v_degree,
      nu: uk.length - d.u_degree - 1,
      nv: vk.length - d.v_degree - 1,
      poles: Array.from(d.poles as Iterable<V>, (q) => [q[0], q[1], q[2]]),
      u_knots: uk,
      v_knots: vk,
      weights: d.weights === null ? null : Array.from(d.weights as Iterable<number>),
      sense: 1,
    }
  }

  /** A surface of revolution (120): a cylinder, cone, plane, sphere or torus where its generatrix
   * is a line or a circle so placed, else the curve revolved.
   *
   * Its parameters are the generatrix's (u) and the angle (v), turning counterclockwise about the
   * axis line in its definition space (clockwise in model space where its transformation mirrors):
   * its normal at a point of the generatrix is the generatrix's direction across the direction the
   * point turns in. */
  revolution(e: Entity, M: Matrix): Any {
    const [axisDe, genDe] = this.ints(e, 0, 2)
    const ax = this.segments(axisDe, M)[0]
    const a0: V = ax.p0
    const ad = _unit(_sub(ax.p1, ax.p0))
    const g = this.curve(genDe, M)
    const [q, tangent] = _pointAndTangent(g)
    const offAxis = (p: V): V => {
      const d = _sub(p, a0)
      return _sub(d, _mul(ad, _dot(d, ad)))
    }
    const normal = _cross(tangent, _cross(_mul(ad, _Interp.handed(M)), offAxis(q)))
    const sense = (outward: V): number => (_dot(normal, outward) >= 0 ? 1 : -1)
    const size = Math.max(1, _norm(_sub(g.p0, a0)), _norm(_sub(g.p1, a0)))
    const tol = 1e-9 * size
    if (g.kind === 'line') {
      const q0: V = g.p0
      const q1: V = g.p1
      const r0 = offAxis(q0)
      const r1 = offAxis(q1)
      const n0 = _norm(r0)
      const n1 = _norm(r1)
      const ref = n0 >= n1 ? r0 : r1
      if (_norm(_cross(_unit(_sub(q1, q0)), ad)) <= 1e-12 && n0 > tol)
        // parallel: a cylinder
        return { kind: 'cylinder', origin: _sub(q0, r0), z: ad, x: _unit(r0), radius: n0, sense: sense(offAxis(q)) }
      if (Math.abs(_dot(_cross(r0, r1), ad)) <= tol * size && Math.max(n0, n1) > tol) {
        // in a plane through the axis
        const h0 = _dot(_sub(q0, a0), ad)
        const h1 = _dot(_sub(q1, a0), ad)
        if (Math.abs(h1 - h0) <= tol)
          // across the axis: a plane
          return { kind: 'plane', origin: _add(a0, _mul(ad, h0)), z: ad, x: _unit(ref), sense: sense(ad) }
        const slope = (n1 - n0) / (h1 - h0) // the radius grows by slope along the axis
        return {
          kind: 'cone',
          origin: _add(a0, _mul(ad, n0 >= n1 ? h0 : h1)),
          z: slope >= 0 ? ad : _mul(ad, -1),
          x: _unit(ref),
          radius: Math.max(n0, n1),
          semi_angle: Math.atan(Math.abs(slope)),
          sense: sense(offAxis(q)),
        }
      }
    }
    if (g.kind === 'circle' && Math.abs(_dot(g.z, ad)) <= 1e-9) {
      // in a plane through the axis
      const rc = offAxis(g.origin)
      const major = _norm(rc)
      if (major <= tol) return { kind: 'sphere', origin: g.origin, z: ad, x: _perpendicular(ad), radius: g.radius, sense: sense(_sub(q, g.origin)) }
      const ring = _add(_sub(g.origin, rc), _mul(_unit(offAxis(q)), major)) // (the middle of the tube at q)
      return { kind: 'torus', origin: _sub(g.origin, rc), z: ad, x: _unit(rc), major, minor: g.radius, sense: sense(_sub(q, ring)) }
    }
    let curve: Any = { ...g }
    delete curve.p0
    delete curve.p1
    if (curve.kind === 'line')
      // (a skew line: a B-spline of degree 1)
      curve = { kind: 'bspline', degree: 1, poles: [g.p0, g.p1], knots: [0, 0, 1, 1], weights: null }
    // (the kernel's revolution turns the curve by its first parameter, the IGES one by its second)
    return { kind: 'revolution', curve, axis_origin: a0, axis: ad, sense: -_Interp.handed(M) }
  }

  /** A tabulated cylinder (122): the directrix (u) moved along the generatrix (v), from the
   * directrix's start to the point the entity gives. Its normal is the directrix's direction across
   * the generatrix's. */
  tabulated(e: Entity, M: Matrix): Any {
    const g = this.curve(this.ints(e, 0, 1)[0], M)
    const vec = _sub(_Interp.P(M, this.nums(e, 1, 3)), g.p0)
    const [q, tangent] = _pointAndTangent(g)
    const normal = _cross(tangent, vec)
    if (g.kind === 'line') return { kind: 'plane', origin: g.p0, z: _unit(normal), x: _unit(_sub(g.p1, g.p0)), sense: 1 }
    if (g.kind === 'circle' && _norm(_cross(_unit(vec), g.z)) <= 1e-12) {
      const radial = _sub(q, g.origin)
      return { kind: 'cylinder', origin: g.origin, z: g.z, x: g.x, radius: g.radius, sense: _dot(normal, radial) >= 0 ? 1 : -1 }
    }
    const curve = { ...g }
    delete curve.p0
    delete curve.p1
    return { kind: 'extrusion', curve, vector: vec, sense: 1 }
  }
}

/** A point halfway along a curve spec with ends (`p0`, `p1`) and its direction there. */
function _pointAndTangent(g: Any): [V, V] {
  const kind = g.kind
  if (kind === 'line') return [_mul(_add(g.p0, g.p1), 0.5), _sub(g.p1, g.p0)]
  if (kind === 'circle' || kind === 'ellipse') {
    const q = _middle(g, g.p0, g.p1)
    const y = _cross(g.z, g.x)
    const [r1, r2] = kind === 'circle' ? [g.radius, g.radius] : [g.r1, g.r2]
    const d = _sub(q, g.origin)
    const a = Math.atan2(_dot(d, y) / r2, _dot(d, g.x) / r1)
    return [q, _add(_mul(g.x, -r1 * Math.sin(a)), _mul(y, r2 * Math.cos(a)))]
  }
  if (kind === 'bspline') {
    const ks: number[] = g.knots
    const p = g.degree
    const lo = ks[p]
    const hi = ks[ks.length - p - 1]
    const t = (lo + hi) / 2
    const h = 1e-6 * (hi - lo)
    return [bsplinePoint(g, t), _sub(bsplinePoint(g, t + h), bsplinePoint(g, t - h))]
  }
  return [_mul(_add(g.p0, g.p1), 0.5), _sub(g.p1, g.p0)]
}

// -------------------------------------------------------------------------------- topology
/** The point halfway along a circle or an ellipse from p0 to p1 (counterclockwise), or a B-spline
 * (its parameters), a line. */
function _middle(curve: Any, p0: V, p1: V): V {
  return _at({ curve, p0, p1 }, 0.5)
}

/** The point a fraction `f` along a piece (of its angle, its parameter): to tell the two pieces of
 * a seam from other pieces. */
function _at(piece: Any, f: number): V {
  const curve = piece.curve
  const p0: V = piece.p0
  const p1: V = piece.p1
  const kind = curve.kind
  if (kind === 'circle' || kind === 'ellipse') {
    const o: V = curve.origin
    const x: V = curve.x
    const y = _cross(curve.z, x)
    const [r1, r2] = kind === 'circle' ? [curve.radius, curve.radius] : [curve.r1, curve.r2]
    const angle = (p: V): number => {
      const d = _sub(p, o)
      return Math.atan2(_dot(d, y) / r2, _dot(d, x) / r1)
    }
    const a0 = angle(p0)
    const a = a0 + f * (_mod(angle(p1) - a0, 2 * Math.PI) || 2 * Math.PI)
    return _add(_add(o, _mul(x, r1 * Math.cos(a))), _mul(y, r2 * Math.sin(a)))
  }
  if (kind === 'bspline') {
    const ks: number[] = curve.knots
    const p = curve.degree
    const t0 = piece.t0 ?? ks[p]
    const t1 = piece.t1 ?? ks[ks.length - p - 1]
    return bsplinePoint(curve, t0 + f * (t1 - t0))
  }
  return _add(p0, _mul(_sub(p1, p0), f))
}

/** Faces bounded by curves of their own (trimmed and bounded surfaces). Each loop's pieces become
 * edges that share their vertices with their neighbours in the loop; a piece the loops run along
 * twice, once each way (the seam of a closed surface), is one edge. */
class _Faces {
  resolution: number | null
  body = new BodyData('sheet', '')
  colors: (number[] | null)[] = []
  names: string[] = []
  /** how a message names each face's entity */
  labels: string[] = []

  constructor(resolution: number | null) {
    this.resolution = resolution
  }

  /** A face of a surface spec bounded by loops of pieces (the outer loop first). False (and
   * nothing added) for a face whose loops are all lines of length 0. */
  add(surface: Any, loops: Any[][], color: number[] | null, name: string, label: string): boolean {
    const b = this.body
    const pts: V[] = loops.flatMap((loop) => loop.flatMap((s) => [s.p0, s.p1]))
    let size = 1
    if (pts.length) {
      const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])))
      const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])))
      size = _norm(_sub(hi, lo))
    }
    let near = 1e-9 * Math.max(size, 1) + (this.resolution || 0)
    // (lines of length 0 are no edges: writers close a degenerate side of a face with them)
    loops = loops.map((loop) => loop.filter((s) => s.curve.kind !== 'line' || _norm(_sub(s.p1, s.p0)) > near)).filter((loop) => loop.length)
    if (!loops.length) return false
    near = 1e-6 * Math.max(size, 1) + (this.resolution || 0)
    // vertices: the ends of the pieces, joined where one piece ends and the next starts
    const parent: number[] = []
    const where: V[] = []
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]]
        i = parent[i]
      }
      return i
    }
    const join = (a: number, c: number): void => {
      a = find(a)
      c = find(c)
      if (a !== c) parent[c] = a
    }
    const fresh = (p: V): number => {
      parent.push(parent.length)
      where.push(p)
      return parent.length - 1
    }
    const uses: [Any, number, number, number, number | null][] = [] // [piece, start, end, loop, seam partner]
    loops.forEach((loop, li) => {
      const first = uses.length
      for (const s of loop) uses.push([s, fresh(s.p0), fresh(s.p1), li, null])
      for (let i = first; i < uses.length; i++) join(uses[i][2], uses[first + ((i - first + 1) % loop.length)][1])
    })
    // seams: a piece that runs back along another one of the face (a closed one, a circle around a
    // torus, back from its start)
    const marks = uses.map((u) => [0.25, 0.5, 0.75].map((f) => _at(u[0], f)))
    const close = (a: V, c: V): boolean => _norm(_sub(a, c)) <= near
    uses.forEach((ui, i) => {
      const si = ui[0]
      const ring = close(si.p0, si.p1)
      for (let j = i + 1; j < uses.length; j++) {
        if (ui[4] !== null) break
        const uj = uses[j]
        const sj = uj[0]
        if (uj[4] !== null || sj.curve.kind !== si.curve.kind) continue
        const same = ring
          ? close(sj.p0, sj.p1) && close(si.p0, sj.p0) && close(marks[i][0], marks[j][2]) && close(marks[i][2], marks[j][0])
          : close(si.p0, sj.p1) && close(si.p1, sj.p0) && close(marks[i][1], marks[j][1])
        if (same) {
          ui[4] = j
          uj[4] = i
          join(ui[1], uj[2])
          join(ui[2], uj[1])
        }
      }
    })
    const ids = new Map<number, number>()
    const groups = new Map<number, V[]>()
    for (let k = 0; k < parent.length; k++) {
      const r = find(k)
      if (!groups.has(r)) groups.set(r, [])
      groups.get(r)?.push(where[k])
    }
    const vertex = (k: number): number => {
      const r = find(k)
      if (!ids.has(r)) {
        ids.set(r, b.vertices.length)
        const g = groups.get(r) as V[]
        b.vertices.push([0, 1, 2].map((c) => g.reduce((acc, p) => acc + p[c], 0) / g.length))
      }
      return ids.get(r) as number
    }
    const edgeOf = new Map<number, number>()
    const out: Any[] = loops.map((_, li) => ({ edges: [], outer: li === 0 }))
    uses.forEach(([s, v0, v1, li, partner], i) => {
      if (partner !== null && edgeOf.has(partner)) {
        out[li].edges.push([edgeOf.get(partner), false])
        return
      }
      b.curves.push(s.curve)
      b.edges.push({ curve: b.curves.length - 1, v0: vertex(v0), v1: vertex(v1), same_sense: true })
      edgeOf.set(i, b.edges.length - 1)
      out[li].edges.push([b.edges.length - 1, true])
    })
    b.surfaces.push(surface)
    // (a face of a trimmed surface faces the way its surface's normal does)
    b.faces.push({ surface: b.surfaces.length - 1, same_sense: (surface.sense ?? 1) > 0, loops: out, name })
    this.colors.push(color)
    this.names.push(name)
    this.labels.push(label)
    return true
  }
}

/** What a file holds that becomes bodies: its solids and shells (186, 514), the faces of its
 * trimmed and bounded surfaces (which share no edges: the importer stitches them) with each face's
 * color, name and label (its entity, for messages), and its untrimmed B-spline surfaces (surface
 * spec, parameter range, color, name, label). */
export class IgesModel {
  solids: BodyData[] = []
  faces = new BodyData('sheet', '')
  faceColors: (number[] | null)[] = []
  faceNames: string[] = []
  faceLabels: string[] = []
  untrimmed: [Any, [number, number, number, number], number[] | null, string, string][] = []
}

/** A shell (514) of a solid into `b`: its faces (510), their loops (508), edges (504) and vertices
 * (502). */
function _shell(it: _Interp, de: number, M: Matrix, b: BodyData, vmap: Map<string, number>, emap: Map<string, number>, reversed: boolean): void {
  const sh = it.get(de, 514)
  const Ms = it.placed(sh, M)
  const n = it.ints(sh, 0, 1)[0]
  const faces: number[] = []
  for (let k = 0; k < n; k++) {
    const [fde, of] = it.ints(sh, 1 + 2 * k, 2)
    const fe = it.get(fde, 510)
    const Mf = it.placed(fe, Ms)
    const [sde, nl, outer] = it.ints(fe, 0, 3)
    const loops: Any[] = []
    it.ints(fe, 3, nl).forEach((lde, li) => {
      const le = it.get(lde, 508)
      const Ml = it.placed(le, Mf)
      let at = 1
      let items: [number, boolean][] = []
      let single: number | null = null
      const count = it.ints(le, 0, 1)[0]
      for (let q = 0; q < count; q++) {
        const [typ, ede, ndx, eof, kk] = it.ints(le, at, 5)
        at += 5 + 2 * kk
        if (typ === 1)
          // a vertex
          single = _vertex(it, ede, ndx, Ml, b, vmap)
        else items.push([_edge(it, ede, ndx, Ml, b, vmap, emap), eof === 1])
      }
      if (items.length) {
        // (a loop runs counterclockwise about the surface's normal; STEP's, which the builder takes,
        // about the face's)
        if (of !== 1) items = items.reverse().map(([ei, fwd]) => [ei, !fwd])
        loops.push({ edges: items, outer: Boolean(outer) && li === 0 })
      } else if (single !== null) loops.push({ vertex: single, outer: false })
    })
    const surface = it.surface(sde, Mf)
    b.surfaces.push(surface)
    faces.push(b.faces.length)
    b.faces.push({ surface: b.surfaces.length - 1, same_sense: (of === 1) === (surface.sense ?? 1) > 0, loops, name: it.name(fe, 3 + nl) })
  }
  b.shells.push({ faces, reversed, closed: sh.form !== 2 })
}

function _vertex(it: _Interp, de: number, ndx: number, M: Matrix, b: BodyData, vmap: Map<string, number>): number {
  const key = `${de}:${ndx}`
  if (!vmap.has(key)) {
    const e = it.get(de, 502)
    const n = it.ints(e, 0, 1)[0]
    if (!(ndx >= 1 && ndx <= n)) throw new RangeError(`IGES: vertex ${ndx} of the vertex list at DE ${de}, which has ${n}`)
    vmap.set(key, b.vertices.length)
    b.vertices.push(_Interp.P(it.placed(e, M), it.nums(e, 1 + 3 * (ndx - 1), 3)))
  }
  return vmap.get(key) as number
}

function _edge(it: _Interp, de: number, ndx: number, M: Matrix, b: BodyData, vmap: Map<string, number>, emap: Map<string, number>): number {
  const key = `${de}:${ndx}`
  if (!emap.has(key)) {
    const e = it.get(de, 504)
    const Me = it.placed(e, M)
    const n = it.ints(e, 0, 1)[0]
    if (!(ndx >= 1 && ndx <= n)) throw new RangeError(`IGES: edge ${ndx} of the edge list at DE ${de}, which has ${n}`)
    const [cde, svp, sv, tvp, tv] = it.ints(e, 1 + 5 * (ndx - 1), 5)
    const segs = it.segments(cde, Me)
    if (segs.length !== 1) throw new NotImplementedError(`a composite curve (DE ${cde}) as the curve of an edge`)
    const v0 = _vertex(it, svp, sv, Me, b, vmap)
    const v1 = _vertex(it, tvp, tv, Me, b, vmap)
    b.curves.push(segs[0].curve)
    emap.set(key, b.edges.length)
    b.edges.push({ curve: b.curves.length - 1, v0, v1, same_sense: true })
  }
  return emap.get(key) as number
}

/** The pieces of a curve on a surface (142): its model-space curve, or where the file gives only the
 * curve in the surface's parameters (on a B-spline surface), that curve on the surface. */
function _onSurface(it: _Interp, de: number, M: Matrix, surface: Any): Any[] {
  const e = it.get(de)
  if (e.type !== 142) return it.segments(de, M) // (some writers point at the curve itself)
  const [bptr, cptr] = it.ints(e, 2, 2)
  if (cptr) return it.segments(cptr, it.placed(e, M))
  if (!bptr) throw new RangeError(`IGES: the curve on a surface at DE ${de} has no curve`)
  if (surface.kind !== 'bspline') throw new NotImplementedError(`a boundary given in the parameters of a ${surface.kind} only (no model-space curve)`)
  const poles: V[] = surface.poles
  const lo = [0, 1, 2].map((c) => Math.min(...poles.map((p) => p[c])))
  const hi = [0, 1, 2].map((c) => Math.max(...poles.map((p) => p[c])))
  const tol = Math.max(it.resolution || 0, 1e-6 * _norm(_sub(hi, lo)))
  const out: Any[] = []
  for (const s of it.segments(bptr, _identity())) {
    // (in the parameters: no units)
    const c = s.curve
    let uv: Any
    if (c.kind === 'line') uv = { degree: 1, poles: [s.p0, s.p1], knots: [0, 0, 1, 1], weights: null }
    else if (c.kind === 'bspline') uv = { ...c, range: [s.t0 ?? 0, s.t1 ?? 0] }
    else throw new NotImplementedError(`a ${c.kind} in the parameters of a surface`)
    const d = kernelCall('import IGES', () => ext.curve_on_surface(surface, uv, tol))
    const spec = { kind: 'bspline', degree: d.degree, poles: Array.from(d.poles as Iterable<V>, (p) => [p[0], p[1], p[2]]), knots: Array.from(d.knots as Iterable<number>), weights: d.weights === null ? null : Array.from(d.weights as Iterable<number>) }
    const ks = spec.knots
    const t0 = ks[spec.degree]
    const t1 = ks[ks.length - spec.degree - 1]
    out.push({ curve: spec, p0: bsplinePoint(spec, t0), p1: bsplinePoint(spec, t1), t0, t1 })
  }
  return out
}

/** The pieces of a boundary (141), each the way the boundary runs. */
function _boundary(it: _Interp, de: number, M: Matrix): Any[] {
  const e = it.get(de, 141)
  const Mb = it.placed(e, M)
  let at = 4
  const out: Any[] = []
  const n = it.ints(e, 3, 1)[0]
  for (let q = 0; q < n; q++) {
    const [cde, sense, k] = it.ints(e, at, 3)
    at += 3 + k
    const segs = it.segments(cde, Mb)
    out.push(...(sense === 2 ? segs.reverse().map(_reversed) : segs))
  }
  return out
}

/** A piece run the other way. */
function _reversed(s: Any): Any {
  let c = s.curve
  if (c.kind === 'line') c = { ...c, origin: s.p1, direction: _sub(s.p0, s.p1) }
  else if (c.kind === 'circle' || c.kind === 'ellipse') c = { ...c, z: _mul(c.z, -1), x: c.x }
  else if (c.kind === 'bspline') {
    const ks: number[] = c.knots
    const lo = ks[0]
    const hi = ks[ks.length - 1]
    c = {
      ...c,
      poles: [...c.poles].reverse(),
      knots: [...ks].reverse().map((k) => lo + hi - k),
      weights: c.weights === null ? null : [...c.weights].reverse(),
    }
  } else throw new NotImplementedError(`a ${c.kind} that a boundary runs along backwards`)
  return { curve: c, p0: s.p1, p1: s.p0 }
}

/** How many parameters of its own an entity has (the property pointers follow them). */
function _own(e: Entity): number | null {
  const p = e.params
  const int = (x: IgesValue | undefined): number => {
    if (typeof x !== 'number') throw new TypeError('not a number')
    return Math.trunc(x)
  }
  try {
    if (e.type === 144) return 4 + int(p[2])
    if (e.type === 143) return 3 + int(p[2])
    if (e.type === 108) return 9
    if (e.type === 186) return 3 + 2 * int(p[2])
    if (e.type === 128) {
      const [k1, k2, m1, m2] = [0, 1, 2, 3].map((i) => int(p[i]))
      return 9 + (k1 + m1 + 2) + (k2 + m2 + 2) + 4 * (k1 + 1) * (k2 + 1) + 4
    }
  } catch {
    return null
  }
  return null
}

/** The entities the containers the reader knows point at (a solid's shells, a shell's faces, the
 * surfaces of faces, the members of subfigures): they are not bodies or faces of their own,
 * whatever their status says. */
function _references(f: IgesFile): Set<number> {
  const refs = new Set<number>()
  const int = (x: IgesValue | undefined): number => {
    if (typeof x !== 'number') throw new TypeError('not a number')
    return Math.trunc(x)
  }
  const every = (p: IgesValue[], start: number, stop: number, step: number): number[] => {
    const out: number[] = []
    for (let i = start; i < Math.min(stop, p.length); i += step) out.push(int(p[i]))
    return out
  }
  for (const e of f.entities.values()) {
    const p = e.params
    try {
      if (e.type === 186) {
        refs.add(int(p[0]))
        for (const x of every(p, 3, 3 + 2 * int(p[2]), 2)) refs.add(x)
      } else if (e.type === 514) for (const x of every(p, 1, 1 + 2 * int(p[0]), 2)) refs.add(x)
      else if (e.type === 510 || e.type === 144 || e.type === 140) refs.add(int(e.type !== 140 ? p[0] : p[4]))
      else if (e.type === 143 || e.type === 142 || e.type === 141) refs.add(int(e.type !== 141 ? p[1] : p[2]))
      else if (e.type === 308) for (const x of every(p, 3, 3 + int(p[2]), 1)) refs.add(x)
      else if (e.type === 408) refs.add(int(p[0]))
    } catch {}
  }
  return refs
}

/** the entities that are bodies or faces (or place them) */
const READ = new Set([186, 514, 144, 143, 108, 128, 114, 408])

/** How a message names an entity: `trimmed surface 'Lid' (DE 25)`. */
export function entityLabel(e: Entity, name: string): string {
  const kind = KINDS.get(e.type) ?? `entity ${e.type}`
  return name ? `${kind} ${_repr(name)} (DE ${e.de})` : `${kind} DE ${e.de}`
}

/** A face that is the whole of a B-spline surface: its spec and the parameter range the file gives
 * (where that is less than its knots). */
function _untrimmed(it: _Interp, e: Entity, M: Matrix, color: number[] | null, name: string, label: string): IgesModel['untrimmed'][number] {
  if (e.type === 128) {
    const [spec, rng] = it.bsplineSurface(e, it.placed(e, M))
    return [spec, rng, color, name, label]
  }
  if (e.type === 114) {
    const spec = it.splineSurface(e, it.placed(e, M))
    const uk: number[] = spec.u_knots
    const vk: number[] = spec.v_knots
    return [spec, [uk[0], uk[uk.length - 1], vk[0], vk[vk.length - 1]], color, name, label]
  }
  throw new NotImplementedError(`a face that is the whole of surface entity ${e.type}`)
}

/** The bodies and faces of the file: its solids, shells, trimmed and bounded surfaces and the
 * B-spline surfaces no face is made of, and those of the subfigures it places (408), each where the
 * instance puts it. (Entities that are parts of others are read as such.)
 *
 * An entity that cannot be read (one the reader does not know, a malformed one) throws, unless an
 * array is given as `skipped`: then it is left out and the array gets `{name, entity, message}` for
 * it. */
export function interpret(f: IgesFile, options: { skipped?: Any[] } = {}): IgesModel {
  const { skipped } = options
  const it = new _Interp(f)
  const model = new IgesModel()
  const faces = new _Faces(it.resolution)
  const refs = _references(f)

  const failed = (e: Entity, name: string, err: unknown): void => {
    if (skipped === undefined) throw err
    const why = err instanceof NotImplementedError ? `${err.message}, which is not supported` : (err instanceof Error && err.message) || String(err)
    skipped.push({ name, entity: e.de, message: `${entityLabel(e, name)}: ${why}` })
  }

  const read = (e: Entity, M: Matrix, depth = 0): void => {
    const name = it.name(e, _own(e))
    try {
      if (e.type === 408) {
        // a subfigure (308) placed: moved by X, Y, Z and scaled by S
        if (depth > 16) throw new RangeError('IGES: subfigures place each other in a circle')
        const sub = it.get(it.ints(e, 0, 1)[0], 308)
        const [x, y, z] = it.nums(e, 1, 3)
        const sc = e.params.length > 4 && e.params[4] !== null && e.params[4] !== 0 ? it.nums(e, 4, 1)[0] : 1
        const Mi = _matmul(
          it.placed(e, M),
          _matrix([
            [sc, 0, 0, x],
            [0, sc, 0, y],
            [0, 0, sc, z],
            [0, 0, 0, 1],
          ]),
        )
        const Ms = it.placed(sub, Mi)
        for (const member of it.ints(sub, 3, it.ints(sub, 2, 1)[0])) {
          const m = f.entities.get(member)
          if (m !== undefined && READ.has(m.type)) read(m, Ms, depth + 1)
        }
        return
      }
      if (e.type === 186 || e.type === 514) {
        const b = new BodyData(e.type === 186 ? 'solid' : 'sheet', name)
        const Mb = it.placed(e, M)
        const vmap = new Map<string, number>()
        const emap = new Map<string, number>()
        if (e.type === 186) {
          const [shellDe, sof, nv] = it.ints(e, 0, 3)
          _shell(it, shellDe, Mb, b, vmap, emap, sof !== 1)
          for (let k = 0; k < nv; k++) {
            const [vde, vof] = it.ints(e, 3 + 2 * k, 2)
            _shell(it, vde, Mb, b, vmap, emap, vof !== 1)
          }
        } else {
          // a shell of no solid: a sheet
          _shell(it, e.de, M, b, vmap, emap, false)
          b.shells[0].closed = false
        }
        b.color = it.color(e)
        b.entity = e.de
        b.uncertainty = it.resolution
        model.solids.push(b)
        return
      }
      const Mf = it.placed(e, M)
      let surface: Any
      let loops: Any[][]
      if (e.type === 144) {
        const [sde, n1, n2, pto] = it.ints(e, 0, 4)
        if (n1 === 0 || !pto) {
          if (n2) throw new NotImplementedError('a trimmed surface with holes in the whole of its surface')
          model.untrimmed.push(_untrimmed(it, it.get(sde), Mf, it.color(e), name, entityLabel(e, name)))
          return
        }
        surface = it.surface(sde, Mf)
        loops = [pto, ...it.ints(e, 4, n2)].map((d) => _onSurface(it, d, Mf, surface))
      } else if (e.type === 143) {
        const [sde, n] = it.ints(e, 1, 2)
        surface = it.surface(sde, Mf)
        loops = it.ints(e, 3, n).map((d) => _boundary(it, d, Mf))
      } else if (e.type === 108) {
        surface = it.surface(e.de, M)
        loops = [it.segments(it.ints(e, 4, 1)[0], Mf)]
      } else {
        // a B-spline surface on its own: a face of all of it
        model.untrimmed.push(_untrimmed(it, e, M, it.color(e), name, entityLabel(e, name)))
        return
      }
      faces.add(surface, loops, it.color(e), name, entityLabel(e, name))
    } catch (err) {
      if (!_bodyError(err)) throw err
      failed(e, name, err)
    }
  }

  for (const e of f.entities.values()) {
    if (refs.has(e.de) || e.use === 5 || !READ.has(e.type)) continue
    if (e.type === 108 && e.form !== 1) continue // (an unbounded plane is construction geometry)
    if ((e.type === 128 || e.type === 114) && e.subordinate !== 0 && e.subordinate !== 2) continue // (a surface of something the reader does not know)
    read(e, it.root)
  }
  faces.body.uncertainty = it.resolution
  model.faces = faces.body
  model.faceColors = faces.colors
  model.faceNames = faces.names
  model.faceLabels = faces.labels
  return model
}
