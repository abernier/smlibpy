// DXF drawings in and out (ASCII DXF).
//
// Reading turns the curves of a drawing into exact edges: lines, circular and elliptical arcs,
// NURBS splines, polylines with bulges, and the contents of inserted blocks. The curves are
// joined end to end into loops, and the loops become the regions of a sketch by the even-odd rule
// (a loop inside a loop is a hole, a loop inside a hole an island).
//
// Writing produces an AutoCAD 2000 (AC1015) DXF with exact entities: LINE, ARC, CIRCLE, ELLIPSE
// and SPLINE.
//
// In memory everywhere: toDxf (a string), fromDxf and fromDxfWires (a string or the file's
// bytes). With file paths in Node: exportDxf, importDxf and importDxfWires.

import { ModelingError, _opts, _warn, ext, k, scope } from './kernel.ts'
import { type Matrix, Plane, _formatG, _identity, _matmul } from './geometry.ts'
import { solve } from './_linalg.ts'
import { CenterArc, EllipticalArc, Line, Spline } from './curves.ts'
import { Mesh } from './mesh.ts'
import * as regions from './regions.ts'
import type { ShapesLike } from './exporters.ts'
import { type BytesLike, _asBytes } from './_bytes.ts'
import { Edge, Face, Part, type ShapeList, Sketch, Vertex, Wire, _Body, _canonicalCurve, _list, _typeName } from './shapes.ts'
import { DrawingView } from './drawing.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any

type V3 = [number, number, number]
type P2 = [number, number]
type M3 = number[] // 3x3, row by row

/** Millimeters per drawing unit, by the code of `$INSUNITS` (0 is unitless). */
const _INSUNITS_MM = new Map<number, number>([
  [1, 25.4], [2, 304.8], [3, 1_609_344.0], [4, 1.0], [5, 10.0], [6, 1000.0], [7, 1e6], [8, 25.4e-6], [9, 0.0254],
  [10, 914.4], [11, 1e-7], [12, 1e-6], [13, 1e-3], [14, 100.0], [15, 1e4], [16, 1e5], [17, 1e12],
  [18, 1.495978707e14], [19, 9.4607304725808e18], [20, 3.0856775814913673e19],
  [21, (1200.0 / 3937.0) * 1000.0], [22, 1000.0 / 39.37], [23, (3600.0 / 3937.0) * 1000.0], [24, (6336.0 / 3937.0) * 1e6],
])
/** Unit names for `unit`: millimeters per unit and the `$INSUNITS` code. */
const _UNITS = new Map<string, [number, number]>([
  ['mm', [1.0, 4]], ['cm', [10.0, 5]], ['m', [1000.0, 6]], ['um', [0.001, 13]], ['inch', [25.4, 1]],
  ['in', [25.4, 1]], ['ft', [304.8, 2]],
])
const _UNIT_NAMES = 'mm, cm, m, um, inch or ft'

const _TWO_PI = 2.0 * Math.PI
const _SKIPPED_SILENTLY = new Set(['SEQEND', 'VERTEX', 'ATTRIB', 'ATTDEF', 'VIEWPORT', 'ENDBLK', 'BLOCK'])

/** How a drawing is read. */
export interface DxfReadOptions {
  /** Read only these layers (names in any letter case). */
  layers?: Iterable<string> | string | null
  /** The unit of the drawing ("mm", "cm", "m", "um", "inch", "ft"), instead of the file's
   * `$INSUNITS`. A file without a unit is read as mm. */
  unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft' | null
  /** Ends closer than this (mm) are joined. Default: 1e-7 of the drawing's size. */
  tolerance?: number | null
}

/** How a drawing is written. */
export interface DxfWriteOptions {
  /** Unit of the file: "mm" (default), "cm", "m", "um", "inch" or "ft". The model (in mm) is
   * converted to it and `$INSUNITS` says so. */
  unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft'
  /** The plane of the drawing; the shapes are written in its coordinates and must lie in planes
   * parallel to it. Default: the world XY plane when the shapes are parallel to it, otherwise the
   * plane of the first sketch (a section in `Plane.XZ` is drawn in that plane's coordinates). */
  plane?: Plane | null
  /** 'exact' (default) writes splines and ellipses as SPLINE and ELLIPSE; 'arcs' writes them as LINE
   * and ARC within `tolerance` (`Edge.toArcs`), for CNC, laser and plasma software that reads only
   * lines and arcs. */
  curves?: 'exact' | 'arcs'
  /** For `curves: 'arcs'`: the largest distance between a curve and its lines and arcs, in
   * millimeters (the model's unit; default 0.01). */
  tolerance?: number
}

// =============================================================================
// Low level: group codes, sections, entities
// =============================================================================
/** The text of a DXF file: UTF-8 (without a byte order mark), else code page 1252, else latin-1 (as smlibpy
 * decodes it). */
function _readText(data: Uint8Array, label: string): string {
  if (_startsWith(data, 'AutoCAD Binary DXF')) throw new RangeError(`${label}: a binary DXF; save the drawing as ASCII DXF`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data) // (a byte order mark is no part of the drawing)
  } catch {
    // not UTF-8
  }
  return _cp1252(data) ?? _latin1(data)
}

function _startsWith(data: Uint8Array, prefix: string): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix.charCodeAt(i)) return false
  return true
}

function _pairs(text: string): [number, string][] {
  const lines = _splitlines(text)
  const out: [number, string][] = []
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = _strip(lines[i])
    if (!code) continue
    const v = _int10(code)
    if (v === null) throw new RangeError(`not a DXF file (line ${i + 1}: ${_repr([...code].slice(0, 40).join(''))} is not a group code)`)
    out.push([v, _strip(lines[i + 1])])
  }
  return out
}

function _sections(pairs: [number, string][]): Map<string, [number, string][]> {
  const out = new Map<string, [number, string][]>()
  let i = 0
  const n = pairs.length
  while (i < n) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && i + 1 < n && pairs[i + 1][0] === 2) {
      const name = pairs[i + 1][1].toUpperCase()
      let j = i + 2
      while (j < n && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j += 1
      out.set(name, pairs.slice(i + 2, j))
      i = j + 1
    } else {
      i += 1
    }
  }
  if (!out.size && pairs.length && pairs[0][0] === 0) out.set('ENTITIES', pairs) // a bare list of entities
  return out
}

class _Entity {
  readonly kind: string
  readonly tags: [number, string][]
  readonly children: _Entity[] = [] // VERTEX entities of a POLYLINE

  constructor(kind: string, tags: [number, string][]) {
    this.kind = kind
    this.tags = tags
  }

  get(code: number): string | null {
    for (const [c, v] of this.tags) if (c === code) return v
    return null
  }

  num(code: number, fallback = 0.0): number {
    const v = this.get(code)
    return v !== null ? _float(v) : fallback
  }

  integer(code: number, fallback = 0): number {
    const v = this.get(code)
    return v !== null ? _int(_float(v)) : fallback
  }

  point(code: number, fallback: readonly number[] = [0.0, 0.0, 0.0]): V3 {
    return [this.num(code, fallback[0]), this.num(code + 10, fallback[1]), this.num(code + 20, fallback[2])]
  }

  get layer(): string {
    return this.get(8) ?? '0'
  }

  get extrusion(): V3 {
    return this.point(210, [0.0, 0.0, 1.0])
  }
}

function _entities(pairs: [number, string][]): _Entity[] {
  const out: _Entity[] = []
  let current: _Entity | null = null
  for (const [code, value] of pairs) {
    if (code === 0) {
      current = new _Entity(value.toUpperCase(), [])
      out.push(current)
    } else if (current !== null) {
      current.tags.push([code, value])
    }
  }
  // VERTEX ... SEQEND belong to the POLYLINE before them
  const grouped: _Entity[] = []
  let owner: _Entity | null = null
  for (const e of out) {
    if (e.kind === 'POLYLINE') {
      owner = e
      grouped.push(e)
    } else if (e.kind === 'VERTEX' && owner !== null) {
      owner.children.push(e)
    } else if (e.kind === 'SEQEND') {
      owner = null
    } else {
      grouped.push(e)
    }
  }
  return grouped
}

function _blocks(pairs: [number, string][]): Map<string, [V3, _Entity[]]> {
  const out = new Map<string, [V3, _Entity[]]>()
  let name: string | null = null
  let base: V3 = [0, 0, 0]
  let body: _Entity[] = []
  for (const e of _entities(pairs)) {
    if (e.kind === 'BLOCK') {
      name = e.get(2) ?? ''
      base = e.point(10)
      body = []
    } else if (e.kind === 'ENDBLK') {
      if (name !== null) out.set(name.toUpperCase(), [base, body])
      name = null
    } else if (name !== null) {
      body.push(e)
    }
  }
  return out
}

// =============================================================================
// Curves of the drawing (exact, before they become kernel edges)
// =============================================================================
/** 3x3 matrix from object coordinates to world coordinates (the arbitrary axis algorithm). */
function _ocs(normal: V3): M3 {
  const n = _div(normal, _norm(normal))
  let ax = Math.abs(n[0]) < 1.0 / 64.0 && Math.abs(n[1]) < 1.0 / 64.0 ? _cross([0.0, 1.0, 0.0], n) : _cross([0.0, 0.0, 1.0], n)
  ax = _div(ax, _norm(ax))
  let ay = _cross(n, ax)
  ay = _div(ay, _norm(ay))
  return [ax[0], ay[0], n[0], ax[1], ay[1], n[1], ax[2], ay[2], n[2]]
}

type _LineData = [V3, V3]
type _ConicData = [V3, V3, V3, number, number] // center, u, v, t0, t1
type _SplineData = [number, number[], V3[], number[] | null] // degree, knots, poles, weights

/**
 * One curve of the drawing in millimeters: a line `[a, b]`, a conic `[center, u, v, t0, t1]`
 * with points `center + u cos t + v sin t` (circles, ellipses and their affine images), or a
 * spline `[degree, knots, poles, weights]`.
 */
class _Curve {
  readonly kind: 'line' | 'conic' | 'spline'
  readonly data: _LineData | _ConicData | _SplineData
  readonly layer: string

  constructor(kind: 'line', data: _LineData, layer: string)
  constructor(kind: 'conic', data: _ConicData, layer: string)
  constructor(kind: 'spline', data: _SplineData, layer: string)
  constructor(kind: 'line' | 'conic' | 'spline', data: _LineData | _ConicData | _SplineData, layer: string) {
    this.kind = kind
    this.data = data
    this.layer = layer
  }

  get line(): _LineData {
    return this.data as _LineData
  }

  get conic(): _ConicData {
    return this.data as _ConicData
  }

  get spline(): _SplineData {
    return this.data as _SplineData
  }

  start(): V3 {
    if (this.kind === 'line') return this.line[0]
    if (this.kind === 'conic') {
      const [c, u, v, t0] = this.conic
      return _conicPoint(c, u, v, t0)
    }
    return this.spline[2][0]
  }

  end(): V3 {
    if (this.kind === 'line') return this.line[1]
    if (this.kind === 'conic') {
      const [c, u, v, , t1] = this.conic
      return _conicPoint(c, u, v, t1)
    }
    const poles = this.spline[2]
    return poles[poles.length - 1]
  }

  get closed(): boolean {
    if (this.kind === 'conic') return this.conic[4] - this.conic[3] >= _TWO_PI - 1e-12
    return false
  }

  transformed(m: Matrix): _Curve {
    if (this.kind === 'line') return new _Curve('line', [_xfPoint(m, this.line[0]), _xfPoint(m, this.line[1])], this.layer)
    if (this.kind === 'conic') {
      const [c, u, v, t0, t1] = this.conic
      return new _Curve('conic', [_xfPoint(m, c), _xfVector(m, u), _xfVector(m, v), t0, t1], this.layer)
    }
    const [deg, knots, poles, weights] = this.spline
    return new _Curve('spline', [deg, knots, poles.map((p) => _xfPoint(m, p)), weights], this.layer)
  }

  scaled(f: number): _Curve {
    const m = _identity()
    m[0] = m[5] = m[10] = f
    return this.transformed(m)
  }
}

function _conicPoint(c: V3, u: V3, v: V3, t: number): V3 {
  const cs = Math.cos(t)
  const sn = Math.sin(t)
  return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]
}

/** A circular arc in object coordinates (angles in radians, counterclockwise). */
function _arcCurve(centerOcs: V3, radius: number, a0: number, a1: number, normal: V3, layer: string, full = false): _Curve {
  const m = _ocs(normal)
  const c = _mv(m, centerOcs)
  const u = _mul(_col(m, 0), radius)
  const v = _mul(_col(m, 1), radius)
  if (full) return new _Curve('conic', [c, u, v, 0.0, _TWO_PI], layer)
  while (a1 <= a0) a1 += _TWO_PI
  return new _Curve('conic', [c, u, v, a0, a1], layer)
}

/** The arc between two polyline vertices (object coordinates) with a bulge (tan of a quarter of
 * the included angle, positive counterclockwise). */
function _bulgeArc(p0: V3, p1: V3, bulge: number, m: M3, layer: string): _Curve {
  const chord: P2 = [p1[0] - p0[0], p1[1] - p0[1]]
  const d = Math.hypot(chord[0], chord[1])
  const theta = 4.0 * Math.atan(bulge) // signed included angle
  const r = d / (2.0 * Math.sin(Math.abs(theta) / 2.0))
  const mid: P2 = [(p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0]
  // the center lies on the chord's bisector, left of the chord for a counterclockwise arc of
  // less than 180 degrees
  const left: P2 = [-chord[1] / d, chord[0] / d]
  const h = r * Math.cos(Math.abs(theta) / 2.0) // negative beyond a half circle: the center is on the other side
  const side = bulge > 0 ? 1.0 : -1.0
  const center: P2 = [mid[0] + left[0] * h * side, mid[1] + left[1] * h * side]
  let a0 = Math.atan2(p0[1] - center[1], p0[0] - center[0])
  let a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0])
  const z = p0[2]
  const c = _mv(m, [center[0], center[1], z])
  const u = _mul(_col(m, 0), r)
  const v = _mul(_col(m, 1), r)
  if (bulge > 0) {
    while (a1 <= a0) a1 += _TWO_PI
    return new _Curve('conic', [c, u, v, a0, a1], layer)
  }
  // clockwise from p0 to p1: the angle decreases; with v mirrored the parameter -angle increases
  while (a0 <= a1) a0 += _TWO_PI
  return new _Curve('conic', [c, u, _neg(v), -a0, -a1], layer)
}

function _polyline(vertices: [V3, number][], closed: boolean, m: M3, layer: string): _Curve[] {
  const out: _Curve[] = []
  const n = vertices.length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, bulge] = vertices[i]
    const [p1] = vertices[(i + 1) % n]
    if (Math.abs(p0[0] - p1[0]) <= 1e-12 && Math.abs(p0[1] - p1[1]) <= 1e-12) continue
    if (Math.abs(bulge) > 1e-12) out.push(_bulgeArc(p0, p1, bulge, m, layer))
    else out.push(new _Curve('line', [_mv(m, p0), _mv(m, p1)], layer))
  }
  return out
}

function _splineCurve(e: _Entity, layer: string): _Curve | null {
  const flags = e.integer(70)
  const deg = e.integer(71, 3)
  const knots: number[] = []
  const weights: number[] = []
  const poles: V3[] = []
  const fit: V3[] = []
  const tangents = new Map<number, V3>()
  for (const [code, value] of e.tags) {
    if (code === 40) knots.push(_float(value))
    else if (code === 41) weights.push(_float(value))
    else if (code === 10) poles.push([_float(value), 0.0, 0.0])
    else if (code === 20 && poles.length) poles[poles.length - 1][1] = _float(value)
    else if (code === 30 && poles.length) poles[poles.length - 1][2] = _float(value)
    else if (code === 11) fit.push([_float(value), 0.0, 0.0])
    else if (code === 21 && fit.length) fit[fit.length - 1][1] = _float(value)
    else if (code === 31 && fit.length) fit[fit.length - 1][2] = _float(value)
    else if (code === 12 || code === 13) tangents.set(code, [_float(value), 0.0, 0.0])
    else if ((code === 22 || code === 23 || code === 32 || code === 33) && tangents.has(10 + (code % 10))) {
      // (as smlibpy: the tangents are kept under 12 and 13, so their y and z never arrive here)
      ;(tangents.get(10 + (code % 10)) as V3)[code < 30 ? 1 : 2] = _float(value)
    }
  }
  if (poles.length) {
    if (knots.length !== poles.length + deg + 1) {
      throw new RangeError(`a SPLINE has ${knots.length} knots for ${poles.length} control points of degree ${deg}`)
    }
    let P = poles
    let K = knots
    let W: number[] | null = weights.length && weights.length === P.length && _ptp(weights) > 0 ? weights : null
    if (flags & 2 || K[deg] !== K[0] || K[K.length - deg - 1] !== K[K.length - 1]) [P, K, W] = _clamped(P, K, deg, W)
    return new _Curve('spline', [deg, K, P, W], layer)
  }
  if (fit.length >= 2) {
    // only fit points: interpolate them (the drawing program's own fit may differ)
    const t = tangents.size ? ([tangents.get(12) ?? null, tangents.get(13) ?? null] as const) : null
    const edge = Spline(...fit, { tangents: t, closed: Boolean(flags & 1) && fit.length > 2 })
    const d = ext.curve_data(edge._curve())
    return new _Curve(
      'spline',
      [Math.trunc(d.degree), (d.knots as number[]).map(Number), (d.poles as number[][]).map(_v3), d.weights == null ? null : (d.weights as number[]).map(Number)],
      layer,
    )
  }
  return null
}

/** The same curve with a clamped knot vector: knots are inserted at both ends of the domain until
 * they have full multiplicity, and what lies outside the domain is dropped. */
function _clamped(P: V3[], knots: number[], deg: number, W: number[] | null): [V3[], number[], number[] | null] {
  let H: number[][] = W !== null ? P.map((p, i) => [p[0] * W[i], p[1] * W[i], p[2] * W[i], W[i]]) : P.map((p) => [...p])
  const lo = knots[deg]
  const hi = knots[knots.length - deg - 1]
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-14 * Math.max(1.0, Math.abs(b))
  const count = (u: number) => knots.filter((x) => same(x, u)).length
  for (const u of [lo, hi]) {
    while (count(u) < deg) [H, knots] = _insertKnot(H, knots, deg, u)
  }
  const first = knots.findIndex((x) => same(x, lo))
  const m = count(lo)
  const s = first + m - 1 - deg // the point at a knot of full multiplicity is this control point
  const inner = knots.filter((x) => lo < x && x < hi && !same(x, lo) && !same(x, hi))
  const newKnots = [...new Array<number>(deg + 1).fill(lo), ...inner, ...new Array<number>(deg + 1).fill(hi)]
  H = H.slice(s, s + newKnots.length - deg - 1)
  if (W !== null) return [H.map((h) => [h[0] / h[3], h[1] / h[3], h[2] / h[3]]), newKnots, H.map((h) => h[3])]
  return [H.map((h) => [h[0], h[1], h[2]]), newKnots, null]
}

function _insertKnot(H: number[][], knots: number[], deg: number, u: number): [number[][], number[]] {
  let kk = -1
  for (let i = 0; i < knots.length - 1; i++) if (knots[i] <= u) kk = i
  if (kk < 0) throw new RangeError('max() arg is an empty sequence')
  kk = Math.min(kk, H.length - 1)
  const Q: number[][] = []
  for (let i = 0; i < H.length + 1; i++) {
    if (i <= kk - deg) {
      Q.push([...H[i]])
    } else if (i > kk) {
      Q.push([...H[i - 1]])
    } else {
      const den = knots[i + deg] - knots[i]
      if (den === 0) throw new RangeError('float division by zero')
      const a = (u - knots[i]) / den
      const before = H.at(i - 1) as number[]
      Q.push(H[i].map((x, j) => (1 - a) * before[j] + a * x))
    }
  }
  return [Q, [...knots.slice(0, kk + 1), u, ...knots.slice(kk + 1)]]
}

interface _Drawing {
  curves: _Curve[] // in millimeters
  skipped: Map<string, number> // entities that are not curves, by type
  layers: Set<string>
}

function _read(text: string, unit: string | null, what: string): _Drawing {
  const sections = _sections(_pairs(text))
  const header = sections.get('HEADER') ?? []
  let insunits = 0
  header.forEach(([code, value], i) => {
    if (code === 9 && value.toUpperCase() === '$INSUNITS' && i + 1 < header.length) insunits = _int(_float(header[i + 1][1]))
  })
  let mm: number
  if (unit != null) {
    const u = _UNITS.get(unit)
    if (u === undefined) throw new RangeError(`unknown unit ${_reprValue(unit)}; use ${_UNIT_NAMES}`)
    mm = u[0]
  } else {
    mm = _INSUNITS_MM.get(insunits) ?? 1.0 // unitless: millimeters
  }
  const layers = new Set<string>()
  for (const e of _entities(sections.get('TABLES') ?? [])) {
    const name = e.get(2)
    if (e.kind === 'LAYER' && name !== null) layers.add(name)
  }
  const blocks = _blocks(sections.get('BLOCKS') ?? [])
  const skipped = new Map<string, number>()
  let curves: _Curve[] = []
  _collect(_entities(sections.get('ENTITIES') ?? []), _identity(), null, blocks, curves, skipped, layers, 0, what)
  if (mm !== 1.0) curves = curves.map((c) => c.scaled(mm))
  return { curves, skipped, layers }
}

function _collect(
  entities: _Entity[],
  m: Matrix,
  insertLayer: string | null,
  blocks: Map<string, [V3, _Entity[]]>,
  out: _Curve[],
  skipped: Map<string, number>,
  layers: Set<string>,
  depth: number,
  what: string,
): void {
  for (const e of entities) {
    if (e.integer(67) === 1) continue // paper space
    let layer = e.layer
    if (insertLayer !== null && layer === '0') layer = insertLayer // entities of a block on layer 0 take the layer of the insert
    layers.add(layer)
    const found = _curvesOf(e, layer)
    if (found !== null) {
      for (const c of found) out.push(depth === 0 ? c : c.transformed(m))
      continue
    }
    if (e.kind === 'INSERT') {
      const name = (e.get(2) ?? '').toUpperCase()
      const block = blocks.get(name)
      if (block === undefined) {
        _count(skipped, 'INSERT of a missing block')
        continue
      }
      if (depth > 16) throw new ModelingError(`${what}: blocks nested more than 16 deep (a block that inserts itself?)`)
      const [base, body] = block
      for (const im of _insertMatrices(e, base)) _collect(body, _matmul(m, im), layer, blocks, out, skipped, layers, depth + 1, what)
      continue
    }
    if (!_SKIPPED_SILENTLY.has(e.kind)) _count(skipped, e.kind)
  }
}

function _count(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function* _insertMatrices(e: _Entity, base: V3): Generator<Matrix> {
  const ins = e.point(10)
  const sx = e.num(41, 1.0)
  const sy = e.num(42, 1.0)
  const sz = e.num(43, 1.0)
  const rot = _radians(e.num(50))
  const cols = Math.max(1, e.integer(70, 1))
  const rows = Math.max(1, e.integer(71, 1))
  const dc = e.num(44)
  const dr = e.num(45)
  const ocs = _identity()
  const o = _ocs(e.extrusion)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ocs[r * 4 + c] = o[r * 3 + c]
  const rz = _identity()
  rz[0] = Math.cos(rot)
  rz[1] = -Math.sin(rot)
  rz[4] = Math.sin(rot)
  rz[5] = Math.cos(rot)
  const s = _identity()
  s[0] = sx
  s[5] = sy
  s[10] = sz
  const toBase = _identity()
  toBase[3] = -base[0]
  toBase[7] = -base[1]
  toBase[11] = -base[2]
  const at = _identity()
  at[3] = ins[0]
  at[7] = ins[1]
  at[11] = ins[2]
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const grid = _identity()
      grid[3] = i * dc
      grid[7] = j * dr
      yield _matmul(_matmul(_matmul(_matmul(_matmul(ocs, at), rz), grid), s), toBase)
    }
  }
}

/** The curves of one entity, or null if it is not a curve entity. */
function _curvesOf(e: _Entity, layer: string): _Curve[] | null {
  const kind = e.kind
  if (kind === 'LINE') {
    const a = e.point(10)
    const b = e.point(11)
    return a.every((x, i) => Math.abs(x - b[i]) <= 1e-12) ? [] : [new _Curve('line', [a, b], layer)]
  }
  if (kind === 'CIRCLE' || kind === 'ARC') {
    const r = e.num(40)
    if (!(r > 0)) return [] // a circle without size draws nothing
    if (kind === 'CIRCLE') return [_arcCurve(e.point(10), r, 0.0, _TWO_PI, e.extrusion, layer, true)]
    return [_arcCurve(e.point(10), r, _radians(e.num(50)), _radians(e.num(51)), e.extrusion, layer)]
  }
  if (kind === 'ELLIPSE') {
    const c = e.point(10)
    const major = e.point(11)
    const n = e.extrusion
    const ratio = e.num(40, 1.0)
    let t0 = e.num(41, 0.0)
    let t1 = e.num(42, _TWO_PI)
    const minor = _mul(_cross(_div(n, _norm(n)), major), ratio)
    const full = Math.abs(t1 - t0 - _TWO_PI) < 1e-9 || Math.abs(t1 - t0) < 1e-12
    if (full) {
      t0 = 0.0
      t1 = _TWO_PI
    }
    while (t1 <= t0) t1 += _TWO_PI
    return [new _Curve('conic', [c, major, minor, t0, t1], layer)]
  }
  if (kind === 'LWPOLYLINE') {
    const verts: [V3, number][] = []
    const z = e.num(38)
    for (const [code, value] of e.tags) {
      if (code === 10) verts.push([[_float(value), 0.0, z], 0.0])
      else if (code === 20 && verts.length) verts[verts.length - 1][0][1] = _float(value)
      else if (code === 42 && verts.length) verts[verts.length - 1] = [verts[verts.length - 1][0], _float(value)]
    }
    return _polyline(verts, Boolean(e.integer(70) & 1), _ocs(e.extrusion), layer)
  }
  if (kind === 'POLYLINE') {
    const flags = e.integer(70)
    if (flags & (16 | 64)) return null // polygon meshes and polyface meshes are surfaces
    const is3d = Boolean(flags & 8)
    const z = e.num(30)
    const verts: [V3, number][] = []
    for (const v of e.children) {
      if (v.integer(70) & 16) continue // spline frame control points
      const p = v.point(10)
      if (!is3d) p[2] = z
      verts.push([p, is3d ? 0.0 : v.num(42)])
    }
    const m = is3d ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : _ocs(e.extrusion)
    return _polyline(verts, Boolean(flags & 1), m, layer)
  }
  if (kind === 'SPLINE') {
    const c = _splineCurve(e, layer)
    return c !== null ? [c] : []
  }
  return null
}

// =============================================================================
// Chains and loops
// =============================================================================
interface _Chain {
  curves: [number, boolean][] // curve index, reversed
  closed: boolean
}

type _Ends = Map<number, [number, number][]> // per node, the curve ends (curve, 0 = start / 1 = end) meeting there

/** Join curves end to end. Returns the chains, the node points and, per node, the curve ends
 * meeting there. */
function _chains(curves: _Curve[], tol: number): [_Chain[], V3[], _Ends] {
  const nodes: V3[] = []
  const grid = new Map<string, number[]>()
  const cell = Math.max(tol, 1e-12)

  const nodeOf = (p: V3): number => {
    const key = p.map((c) => Math.floor(c / cell))
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        for (const dz of [-1, 0, 1]) {
          for (const i of grid.get(`${key[0] + dx},${key[1] + dy},${key[2] + dz}`) ?? []) {
            if (_norm(_sub(nodes[i], p)) <= tol) return i
          }
        }
      }
    }
    nodes.push([p[0], p[1], p[2]])
    const k0 = `${key[0]},${key[1]},${key[2]}`
    const list = grid.get(k0)
    if (list) list.push(nodes.length - 1)
    else grid.set(k0, [nodes.length - 1])
    return nodes.length - 1
  }

  const ends: _Ends = new Map()
  const addEnd = (node: number, end: [number, number]) => {
    const list = ends.get(node)
    if (list) list.push(end)
    else ends.set(node, [end])
  }
  const at: [number, number][] = []
  curves.forEach((c, i) => {
    if (c.closed) {
      at.push([-1, -1])
      return
    }
    const a = nodeOf(c.start())
    const b = nodeOf(c.end())
    at.push([a, b])
    addEnd(a, [i, 0])
    addEnd(b, [i, 1])
  })
  const chains: _Chain[] = []
  const used = curves.map(() => false)
  curves.forEach((c, i) => {
    if (c.closed) {
      chains.push({ curves: [[i, false]], closed: true })
      used[i] = true
    }
  })
  // open chains start at loose ends and at branching points
  const starts = [...ends].filter(([, e]) => e.length !== 2).map(([n]) => n)
  for (const n of starts) {
    for (const [i, which] of ends.get(n) as [number, number][]) {
      if (used[i]) continue
      chains.push(_walk(i, which === 1, at, ends, used))
    }
  }
  for (let i = 0; i < curves.length; i++) if (!used[i]) chains.push(_walk(i, false, at, ends, used))
  return [chains, nodes, ends]
}

/** Follow curves from curve `i` (reversed or not) until the chain closes, ends or branches. */
function _walk(i: number, rev: boolean, at: [number, number][], ends: _Ends, used: boolean[]): _Chain {
  const firstNode = rev ? at[i][1] : at[i][0]
  const out: [number, boolean][] = []
  while (true) {
    used[i] = true
    out.push([i, rev])
    const node = rev ? at[i][0] : at[i][1]
    if (node === firstNode) return { curves: out, closed: true }
    const here = ends.get(node) as [number, number][]
    if (here.length !== 2) return { curves: out, closed: false }
    const leaving = rev ? 0 : 1
    const nxt = here.filter(([j, w]) => !(j === i && w === leaving))
    if (!nxt.length || used[nxt[0][0]]) return { curves: out, closed: false }
    const which = nxt[0][1]
    i = nxt[0][0]
    rev = which === 1
  }
}

/** Move the ends of lines and splines onto one point per node, preferring the exact end of an
 * arc; arcs keep their circle and only slide their end angle to the node. */
function _snap(curves: _Curve[], ends: _Ends): _Curve[] {
  const point = new Map<number, V3>()
  for (const [n, items] of ends) {
    const conic = items.filter(([i]) => curves[i].kind === 'conic')
    if (conic.length) {
      const [i, w] = conic[0]
      point.set(n, w ? curves[i].end() : curves[i].start())
    } else {
      const sum: V3 = [0, 0, 0]
      for (const [i, w] of items) {
        const p = w ? curves[i].end() : curves[i].start()
        sum[0] += p[0]
        sum[1] += p[1]
        sum[2] += p[2]
      }
      point.set(n, [sum[0] / items.length, sum[1] / items.length, sum[2] / items.length])
    }
  }
  const nodeAt = new Map<string, number>()
  for (const [n, items] of ends) for (const [i, w] of items) nodeAt.set(`${i},${w}`, n)
  return curves.map((c, i) => {
    if (c.closed) return c
    const a = point.get(nodeAt.get(`${i},0`) as number) as V3
    const b = point.get(nodeAt.get(`${i},1`) as number) as V3
    if (c.kind === 'line') return new _Curve('line', [a, b], c.layer)
    if (c.kind === 'spline') {
      const [deg, knots, poles, weights] = c.spline
      const moved = poles.slice()
      moved[0] = a
      moved[moved.length - 1] = b
      return new _Curve('spline', [deg, knots, moved, weights], c.layer)
    }
    const [cc, u, v, t0, t1] = c.conic
    return new _Curve('conic', [cc, u, v, _conicParam(c, a, t0), _conicParam(c, b, t1)], c.layer)
  })
}

/** The parameter of the point of a conic closest in angle to `p`, near `near`. */
function _conicParam(c: _Curve, p: V3, near: number): number {
  const [cc, u, v] = c.conic
  const [cs, sn] = _lstsq2(u, v, _sub(p, cc))
  const t = Math.atan2(sn, cs)
  return t + _TWO_PI * _round((near - t) / _TWO_PI)
}

// =============================================================================
// Kernel edges
// =============================================================================
function _edge(c: _Curve): Edge {
  if (c.kind === 'line') return Line(c.line[0], c.line[1])
  if (c.kind === 'spline') {
    const [deg, knots, poles, weights] = c.spline
    return Edge._fromCurve(_canonicalCurve(poles, knots, Math.trunc(deg), weights))
  }
  const [center, u, v, t0, t1] = c.conic
  const ru = _norm(u)
  const rv = _norm(v)
  const normal = _cross(u, v)
  const sweep = t1 - t0
  const full = sweep >= _TWO_PI - 1e-12
  if (Math.abs(ru - rv) <= 1e-12 * Math.max(ru, rv) && Math.abs(_dot(u, v)) <= 1e-12 * ru * rv) {
    const plane = new Plane(center, u, normal)
    if (full) return CenterArc([0, 0], ru, 0.0, 360.0, plane)
    return CenterArc([0, 0], ru, _degrees(t0), _degrees(sweep), plane)
  }
  // principal axes of the ellipse from its conjugate half diameters u, v
  let ts = 0.5 * Math.atan2(2.0 * _dot(u, v), _dot(u, u) - _dot(v, v))
  let a = _add(_mul(u, Math.cos(ts)), _mul(v, Math.sin(ts)))
  let b = _add(_mul(_neg(u), Math.sin(ts)), _mul(v, Math.cos(ts)))
  if (_norm(a) < _norm(b)) {
    ;[a, b, ts] = [b, _neg(a), ts + Math.PI / 2.0]
  }
  const plane = new Plane(center, a, _cross(a, b))
  if (full) return EllipticalArc([0, 0], _norm(a), _norm(b), 0.0, 360.0, plane)
  return EllipticalArc([0, 0], _norm(a), _norm(b), _degrees(t0 - ts), _degrees(t1 - ts), plane)
}

/** Points along an edge in its direction (uniform in the kernel parameter). */
export function _edgePoints(e: Edge, n: number): V3[] {
  const [t0, t1] = e._range()
  const cv = e._curve()
  const pts = _linspace(t0, t1, n + 1).map((t) => _v3(k.curve_evaluate(cv, t)))
  return e._rev ? pts.reverse() : pts
}

export function _samplesFor(e: Edge): number {
  const kind = e.geomType
  if (kind === 'line') return 1
  if (kind === 'circle' || kind === 'ellipse') return 64
  try {
    const d = ext.curve_data(e._curve())
    return Math.max(16, 8 * (d.poles.length - d.degree) * Math.max(1, d.degree))
  } catch {
    return 64
  }
}

// =============================================================================
// importDxf, importDxfWires (and fromDxf, fromDxfWires in memory)
// =============================================================================
function _layered(drawing: _Drawing, layers: Iterable<string> | string | null, what: string): _Curve[] {
  let curves = drawing.curves
  if (layers != null) {
    const wanted = new Set(typeof layers === 'string' ? [layers.toUpperCase()] : Array.from(layers, (x) => String(x).toUpperCase()))
    const known = new Set([...drawing.layers].map((x) => x.toUpperCase()))
    const unknown = [...wanted].filter((x) => !known.has(x)).sort(_compare)
    if (unknown.length) {
      const all = [...drawing.layers].sort((a, b) => _compare(a.toUpperCase(), b.toUpperCase()))
      throw new RangeError(`${what}: the drawing has no layer ${unknown.map(_repr).join(', ')}; its layers are ${all.join(', ')}`)
    }
    curves = curves.filter((c) => wanted.has(c.layer.toUpperCase()))
  }
  if (drawing.skipped.size) {
    const left = [...drawing.skipped].sort((a, b) => _compare(a[0], b[0])).map(([kind, n]) => `${n} ${kind}`)
    _warn(`${what}: left out what is not a curve: ${left.join(', ')}`)
  }
  if (!curves.length) {
    throw new ModelingError(
      `${what}: the drawing has no curves${layers != null ? ' on these layers' : ''} (lines, arcs, circles, ellipses, polylines, splines or blocks of them)`,
    )
  }
  return curves
}

function _defaultTolerance(curves: _Curve[]): number {
  const pts = curves.flatMap((c) => [c.start(), c.end()])
  let size = pts.length ? Math.max(..._ptp3(pts)) : 1.0
  for (const c of curves) {
    if (c.kind === 'conic') size = Math.max(size, 2.0 * _norm(c.conic[1]), 2.0 * _norm(c.conic[2]))
  }
  return Math.max(1e-7 * size, 1e-9)
}

function _fmt(p: V3): string {
  const values = Math.abs(p[2]) < 1e-9 ? p.slice(0, 2) : p
  return `(${values.map((v) => _formatG(v)).join(', ')})`
}

function _prepared(text: string, options: DxfReadOptions, what: string): [_Curve[], _Chain[], V3[], _Ends, number] {
  const drawing = _read(text, options.unit ?? null, what)
  let curves = _layered(drawing, options.layers ?? null, what)
  const tol = options.tolerance != null ? Number(options.tolerance) : _defaultTolerance(curves)
  if (!(tol > 0)) throw new RangeError(`${what}: tolerance must be positive`)
  curves = _dedupe(curves, tol)
  const [chains, nodes, ends] = _chains(curves, tol)
  curves = _snap(curves, ends)
  return [curves, chains, nodes, ends, tol]
}

/** Leave out curves drawn twice (same kind, same ends, same middle). */
function _dedupe(curves: _Curve[], tol: number): _Curve[] {
  const buckets = new Map<string, _Curve[]>()
  const out: _Curve[] = []
  const cell = 10.0 * tol
  for (const c of curves) {
    const a = c.start().map((x) => _rint(x / cell))
    const b = c.end().map((x) => _rint(x / cell))
    const key = _compareNumbers(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`
    const mid = _middle(c)
    let twins = buckets.get(key)
    if (twins === undefined) {
      twins = []
      buckets.set(key, twins)
    }
    if (twins.some((t) => t.kind === c.kind && _norm(_sub(_middle(t), mid)) <= tol)) continue
    twins.push(c)
    out.push(c)
  }
  return out
}

function _middle(c: _Curve): V3 {
  if (c.kind === 'line') {
    const [a, b] = c.line
    return [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, (a[2] + b[2]) / 2.0]
  }
  if (c.kind === 'conic') {
    const [cc, u, v, t0, t1] = c.conic
    return _conicPoint(cc, u, v, (t0 + t1) / 2.0)
  }
  const [deg, knots, poles, weights] = c.spline
  return _deBoor(poles, weights, knots, deg, (knots[0] + knots[knots.length - 1]) / 2.0)
}

function _deBoor(poles: V3[], weights: number[] | null, knots: number[], deg: number, u: number): V3 {
  const H: number[][] = weights !== null ? poles.map((p, i) => [p[0] * weights[i], p[1] * weights[i], p[2] * weights[i], weights[i]]) : poles
  const n = H.length - 1
  let kk = _bisectRight(knots, u) - 1
  kk = Math.min(Math.max(kk, deg), n)
  const d: number[][] = []
  for (let j = 0; j <= deg; j++) d.push([...H[j + kk - deg]])
  for (let r = 1; r <= deg; r++) {
    for (let j = deg; j > r - 1; j--) {
      const den = knots[j + 1 + kk - r] - knots[j + kk - deg]
      const a = den === 0 ? 0.0 : (u - knots[j + kk - deg]) / den
      const prev = d[j - 1]
      d[j] = d[j].map((x, i) => (1 - a) * prev[i] + a * x)
    }
  }
  const out = d[deg]
  return weights !== null ? [out[0] / out[3], out[1] / out[3], out[2] / out[3]] : [out[0], out[1], out[2]]
}

/** The drawing's text: a string as it is, the bytes of a file decoded. */
function _text(data: string | BytesLike, what: string): string {
  if (typeof data === 'string') {
    if (data.startsWith('AutoCAD Binary DXF')) throw new RangeError(`${what}: a binary DXF; save the drawing as ASCII DXF`)
    return data
  }
  const bytes = _asBytes(data)
  if (bytes !== null) return _readText(bytes, what)
  throw new TypeError(`${what} reads a DXF drawing as a string or bytes (a Uint8Array or an ArrayBuffer), not ${_typeName(data)}`)
}

function _fileText(path: string, what: string): string {
  const data: Uint8Array = _fs(what).readFileSync(path)
  return _readText(data, path)
}

/**
 * Every chain of curves of a DXF drawing (a path; Node) as a `Wire`, open or closed.
 *
 * The curves are read and joined like in `importDxf`; chains also stop where three or more
 * curve ends meet. Closed chains come first, then open ones, each in drawing order.
 */
export function importDxfWires(path: string, options: DxfReadOptions = {}): ShapeList<Wire> {
  _opts('importDxfWires', options)
  return _wires(_fileText(path, 'importDxfWires'), options, 'importDxfWires')
}

/** `importDxfWires` of a drawing in memory: the text of a DXF file, or its bytes (a Uint8Array or
 * an ArrayBuffer). */
export function fromDxfWires(data: string | BytesLike, options: DxfReadOptions = {}): ShapeList<Wire> {
  _opts('fromDxfWires', options)
  return _wires(_text(data, 'fromDxfWires'), options, 'fromDxfWires')
}

function _wires(text: string, options: DxfReadOptions, what: string): ShapeList<Wire> {
  const [curves, chains] = _prepared(text, options, what)
  const edges = curves.map(_edge)
  const wires = chains.map((ch) => Wire._raw(ch.curves.map(([i, r]) => (r ? edges[i].reversed() : edges[i]))))
  const closed = wires.filter((_, i) => chains[i].closed)
  return _list([...closed, ...wires.filter((_, i) => !chains[i].closed)])
}

/**
 * Read the outlines of a DXF drawing (an ASCII DXF file's path; Node) as a sketch.
 *
 * Lines, arcs, circles, ellipses, polylines (bulges become exact arcs), splines (exact NURBS)
 * and inserted blocks are joined end to end into closed loops. Loops nest by the even-odd rule:
 * a loop inside a loop is a hole, a loop inside a hole an island. The result keeps the drawing's
 * coordinates, converted to millimeters.
 *
 * Throws ModelingError for curves that do not close into loops (with their ends and layers),
 * or outlines that branch.
 */
export function importDxf(path: string, options: DxfReadOptions = {}): Sketch {
  return scope(() => {
    _opts('importDxf', options)
    return _sketch(_fileText(path, 'importDxf'), options, 'importDxf', 'importDxfWires')
  })
}

/** `importDxf` of a drawing in memory: the text of a DXF file, or its bytes (a Uint8Array or an
 * ArrayBuffer). */
export function fromDxf(data: string | BytesLike, options: DxfReadOptions = {}): Sketch {
  return scope(() => {
    _opts('fromDxf', options)
    return _sketch(_text(data, 'fromDxf'), options, 'fromDxf', 'fromDxfWires')
  })
}

function _sketch(text: string, options: DxfReadOptions, what: string, wiresName: string): Sketch {
  const [curves, chains, nodes, ends, tol] = _prepared(text, options, what)
  const branches = [...ends].filter(([, items]) => items.length > 2).map(([n]) => n)
  if (branches.length) {
    const where = branches
      .slice(0, 5)
      .map((n) => `${(ends.get(n) as [number, number][]).length} curve ends at ${_fmt(nodes[n])}`)
      .join('; ')
    throw new ModelingError(
      `${what}: the outline branches (${where}); a loop needs exactly two curve ends at each corner. Pick the layers of the outline with layers: [...], or read every curve with ${wiresName}()`,
    )
  }
  const openChains = chains.filter((ch) => !ch.closed)
  if (openChains.length) {
    const loose = [...ends].filter(([, items]) => items.length === 1).map(([n]) => n)
    const parts: string[] = []
    for (const ch of openChains.slice(0, 5)) {
      const [i0, r0] = ch.curves[0]
      const [i1, r1] = ch.curves[ch.curves.length - 1]
      const a = r0 ? curves[i0].end() : curves[i0].start()
      const b = r1 ? curves[i1].start() : curves[i1].end()
      const layer = curves[i0].layer
      let gap: number | null = null
      for (const m of loose) {
        const dist = _norm(_sub(nodes[m], a))
        if (dist > tol && (gap === null || dist < gap)) gap = dist
      }
      const count = ch.curves.length
      parts.push(
        `${count} curve${count > 1 ? 's' : ''} from ${_fmt(a)} to ${_fmt(b)} on layer ${_repr(layer)}` +
          (gap ? ` (the nearest other loose end is ${_formatG(gap, 3)} mm away)` : ''),
      )
    }
    const more = openChains.length > 5 ? ` and ${openChains.length - 5} more` : ''
    const count = openChains.length === 1 ? '1 chain of curves does' : `${openChains.length} chains of curves do`
    throw new ModelingError(
      `${what}: ${count} not close: ${parts.join('; ')}${more}. Pick the layers of the outline with layers: [...], join small gaps with tolerance: ..., or read every curve with ${wiresName}()`,
    )
  }
  const edges = curves.map(_edge)
  const loops = chains.map((ch) => ch.curves.map(([i, r]) => (r ? edges[i].reversed() : edges[i])))
  const polys: P2[][] = []
  const zs: number[] = []
  for (const loop of loops) {
    const pts = loop.flatMap((e) => _edgePoints(e, _samplesFor(e)).slice(0, -1))
    polys.push(pts.map((p) => [p[0], p[1]]))
    for (const p of pts) zs.push(p[2])
  }
  let zMin = Infinity
  let zMax = -Infinity
  for (const z of zs) {
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
  }
  const span = zMax - zMin
  let lo: P2 = [Infinity, Infinity]
  let hi: P2 = [-Infinity, -Infinity]
  for (const poly of polys) {
    for (const [x, y] of poly) {
      lo = [Math.min(lo[0], x), Math.min(lo[1], y)]
      hi = [Math.max(hi[0], x), Math.max(hi[1], y)]
    }
  }
  const size = Math.max(Math.max(hi[0] - lo[0], hi[1] - lo[1]), 1e-9)
  if (span > 1e-7 * size) {
    throw new ModelingError(
      `${what}: the outlines are not in one plane parallel to XY (z from ${_formatG(zMin)} to ${_formatG(zMax)}); a sketch needs a flat drawing`,
    )
  }
  const zMean = _npSum(zs) / zs.length
  const plane = Math.abs(zMean) <= 1e-9 * size ? Plane.XY : Plane.XY.offset(zMean)
  const p = regions.plan(polys, 'evenodd')
  return regions.build(p, (i: number) => loops[i].map((e) => e._copyCurve()), plane, what, 'the loops must not cross themselves')
}

// =============================================================================
// exportDxf (and toDxf in memory)
// =============================================================================
/** What a DXF file can hold, as `exportDxf` and `toDxf` take it: shapes, the views of
 * `drawingViews`, or lists of them. */
export type DxfShapesLike = ShapesLike | DrawingView | (Iterable<DxfShapesLike> & object)

/**
 * Write sketches, faces, wires and edges to a DXF drawing (AutoCAD 2000, AC1015) at `path`
 * (Node). See `toDxf`.
 */
export function exportDxf(shapes: DxfShapesLike, path: string, options: DxfWriteOptions = {}): void {
  _opts('exportDxf', options)
  const text = _dxf(shapes, options, 'exportDxf')
  _fs('exportDxf').writeFileSync(path, text, 'utf8')
}

/**
 * Sketches, faces, wires and edges as the text of a DXF drawing (AutoCAD 2000, AC1015).
 *
 * Every curve is written exactly: LINE, ARC, CIRCLE, ELLIPSE, or SPLINE with the kernel's control
 * points, knots and weights. Circular B-splines (the edges of sections) are written as ARC and
 * CIRCLE, straight ones as LINE. A shape's name becomes its layer. `curves: 'arcs'` writes splines
 * and ellipses as LINE and ARC within `tolerance` (`Edge.toArcs`), for software that reads only
 * lines and arcs. The views of `drawingViews` go on the layers VISIBLE and HIDDEN, the hidden lines
 * dashed (the linetype DASHED: 3 mm dashes, 1.5 mm gaps).
 *
 * `shapes` is a `Sketch`, `Face`, `Wire`, `Edge`, `DrawingView` or an array of them.
 */
export function toDxf(shapes: DxfShapesLike, options: DxfWriteOptions = {}): string {
  _opts('toDxf', options)
  return _dxf(shapes, options, 'toDxf')
}

function _dxf(shapes: unknown, options: DxfWriteOptions, what: string): string {
  const unit = options.unit ?? 'mm'
  const units = _UNITS.get(unit)
  if (units === undefined) throw new RangeError(`unknown unit ${_reprValue(unit)}; use ${_UNIT_NAMES}`)
  const curves = options.curves ?? 'exact'
  const tolerance = options.tolerance ?? 0.01
  if (curves !== 'exact' && curves !== 'arcs') throw new RangeError(`${what}: curves is 'exact' or 'arcs', not ${_reprValue(curves)}`)
  if (!(typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance > 0)) {
    throw new RangeError(`${what}: the tolerance must be positive, got ${String(tolerance)}`)
  }
  const [mmPerUnit, code] = units
  const items = _drawable(shapes, what)
  if (!items.length) throw new RangeError(`${what}: nothing to write`)
  const frame = _frame(items, options.plane ?? null, what)
  const o = frame.origin.toArray()
  const xDir = frame.xDir.toArray()
  const yDir = frame.yDir.toArray()
  const n = frame.zDir.toArray()
  const f = 1.0 / mmPerUnit
  const local = (p: ArrayLike<number>): P2 => {
    const d: V3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]
    return [_dot(d, xDir) * f, _dot(d, yDir) * f]
  }
  const w = new _Writer()
  w.dash = [3.0 * f, 1.5 * f]
  for (const item of items) {
    for (let loop of item.loops) {
      if (curves === 'arcs') loop = loop.flatMap((e) => _asArcs(e, tolerance))
      for (const ent of _mergeArcs(loop.map((e) => _entity(e, local, n, f)))) w.entity(item.layer, ent, item.linetype)
    }
  }
  return w.text(code, !['inch', 'in', 'ft'].includes(unit))
}

/** The edge as lines and arcs: itself where it is one (circular and straight B-splines too). */
function _asArcs(e: Edge, tolerance: number): Edge[] {
  if (e.geomType === 'line' || e.geomType === 'circle' || _circleOf(e) !== null) return [e]
  return [...e.toArcs(tolerance).edges()]
}

interface _Item {
  layer: string
  loops: Edge[][]
  plane: Plane | null // the plane of a sketch or face
  linetype?: string
}

function _drawable(shapes: unknown, what: string): _Item[] {
  const out: _Item[] = []
  const loopsOf = (faces: Face[]) => faces.flatMap((f) => [...f.wires()].map((w) => [...w.edges()]))
  const add = (s: unknown): void => {
    if (s instanceof DrawingView) {
      out.push({ layer: 'VISIBLE', loops: [...s.visible].map((e) => [e]), plane: Plane.XY })
      out.push({ layer: 'HIDDEN', loops: [...s.hidden].map((e) => [e]), plane: Plane.XY, linetype: 'DASHED' })
      return
    }
    if (s instanceof Part) {
      throw new TypeError(
        `${what} writes 2D shapes, not a Part; write part.section(plane) for a cross-section or the edges of part.outline(plane) for a view`,
      )
    }
    if (s instanceof Mesh) throw new TypeError(`${what} cannot write a Mesh`)
    if (s instanceof Vertex) throw new TypeError(`${what} writes curves; a Vertex has none`)
    if (s instanceof Sketch) {
      out.push({ layer: _layerName(s.name), loops: loopsOf([...s.faces()]), plane: s.plane })
    } else if (s instanceof _Body) {
      const faces = [...s.faces()]
      if (!faces.every((f) => f.isPlanar)) throw new TypeError(`${what} writes planar shapes; this surface is curved`)
      out.push({ layer: _layerName(s.name), loops: loopsOf(faces), plane: faces.length ? faces[0].plane : null })
    } else if (s instanceof Face) {
      if (!s.isPlanar) throw new TypeError(`${what} writes planar faces; this face is curved`)
      out.push({ layer: _layerName(s.owner?.name ?? null), loops: loopsOf([s]), plane: s.plane })
    } else if (s instanceof Wire) {
      out.push({ layer: '0', loops: [[...s.edges()]], plane: null })
    } else if (s instanceof Edge) {
      out.push({ layer: '0', loops: [[s]], plane: null })
    } else if (Array.isArray(s)) {
      for (const t of s) add(t)
    } else {
      throw new TypeError(`${what} cannot write a ${_typeName(s)}`)
    }
  }
  add(shapes)
  return out.filter((it) => it.loops.length)
}

/** A layer name DXF readers of every version take: ASCII letters, digits, `-_$` and spaces (an
 * AC1015 file is read as code page text, so other characters become `_`). */
function _layerName(name: string | null | undefined): string {
  if (!name) return '0'
  let clean = ''
  for (const c of String(name)) clean += /^[A-Za-z0-9\-_$ ]$/.test(c) ? c : '_'
  clean = clean.replace(/^ +| +$/g, '')
  return clean || '0'
}

/** The drawing plane (see `toDxf`). */
function _frame(items: _Item[], plane: Plane | null, what: string): Plane {
  const samples: V3[][] = []
  for (const it of items) {
    for (const loop of it.loops) samples.push(loop.flatMap((e) => _edgePoints(e, Math.min(_samplesFor(e), 16))))
  }
  const tol = 1e-9 * Math.max(Math.max(..._ptp3(samples.flat())), 1.0)
  const parallel = (pl: Plane) => {
    const nrm = pl.zDir.toArray()
    return samples.every((pts) => _ptp(pts.map((p) => _dot(p, nrm))) <= tol)
  }
  if (plane !== null) {
    if (!parallel(plane)) throw new RangeError(`${what}: the shapes are not parallel to the drawing plane; pass the plane they lie in`)
    return plane
  }
  if (parallel(Plane.XY)) return Plane.XY
  for (const it of items) if (it.plane !== null && parallel(it.plane)) return it.plane
  throw new RangeError(`${what}: the shapes are neither in planes parallel to XY nor in one sketch's plane; pass plane: ...`)
}

// -- entities -----------------------------------------------------------------
interface _Ent {
  kind: 'LINE' | 'ARC' | 'CIRCLE' | 'ELLIPSE' | 'SPLINE'
  data: Any
}

export function _entity(e: Edge, local: (p: ArrayLike<number>) => P2, n: V3, f: number): _Ent {
  const kind = e.geomType
  if (kind === 'line') return { kind: 'LINE', data: { a: local(e.start.toArray()), b: local(e.end.toArray()) } }
  if (kind === 'circle') {
    const d = ext.curve_data(e._curve(), false)
    const pl = d.placement
    return _arc(local(pl.origin), Number(d.radius) * f, e, local, _dot(pl.z_dir, n) > 0)
  }
  if (kind === 'ellipse') return _ellipse(ext.curve_data(e._curve(), false), e, local, n)
  const circle = _circleOf(e)
  if (circle !== null) {
    const [center, radius, axis] = circle
    return _arc(local(center), radius * f, e, local, _dot(axis, n) > 0)
  }
  const curve = e._copyCurve() // the extent and direction of the edge
  let d: Any
  try {
    d = ext.curve_data(curve)
  } finally {
    ext.delete_curve(curve)
  }
  const poles = (d.poles as number[][]).map(_v3)
  if (_straight(poles)) return { kind: 'LINE', data: { a: local(e.start.toArray()), b: local(e.end.toArray()) } }
  const weights = d.weights as number[] | null
  return {
    kind: 'SPLINE',
    data: {
      degree: Math.trunc(d.degree),
      knots: (d.knots as number[]).map(Number),
      poles: poles.map(local),
      weights: weights == null ? null : weights.map(Number),
    },
  }
}

/** ARC or CIRCLE of a circular edge; `ccw` says whether the curve (in its own direction) runs
 * counterclockwise in the drawing. */
function _arc(center: P2, radius: number, e: Edge, local: (p: ArrayLike<number>) => P2, ccw: boolean): _Ent {
  if (e.isClosed) return { kind: 'CIRCLE', data: { c: center, r: radius } }
  const [t0, t1] = e._range()
  const cv = e._curve()
  let a = local(k.curve_evaluate(cv, t0))
  let b = local(k.curve_evaluate(cv, t1))
  if (!ccw) [a, b] = [b, a]
  const a0 = _pyMod(_degrees(Math.atan2(a[1] - center[1], a[0] - center[0])), 360.0)
  const a1 = _pyMod(_degrees(Math.atan2(b[1] - center[1], b[0] - center[0])), 360.0)
  return { kind: 'ARC', data: { c: center, r: radius, a0, a1 } }
}

function _ellipse(d: Any, e: Edge, local: (p: ArrayLike<number>) => P2, n: V3): _Ent {
  const pl = d.placement
  const r1 = Number(d.radius1)
  const r2 = Number(d.radius2)
  const xd = _v3(pl.x_dir)
  const yd = _v3(pl.y_dir)
  const [major3, ratio] = r1 >= r2 ? [_mul(xd, r1), r2 / r1] : [_mul(yd, r2), r1 / r2]
  const c3 = _v3(pl.origin)
  const c = local(c3)
  const tip = local(_add(c3, major3))
  const m: P2 = [tip[0] - c[0], tip[1] - c[1]] // the major half axis in the drawing
  if (e.isClosed) return { kind: 'ELLIPSE', data: { c, major: m, ratio, t0: 0.0, t1: _TWO_PI } }
  const aLen = Math.sqrt(m[0] * m[0] + m[1] * m[1])
  const mu: P2 = [m[0] / aLen, m[1] / aLen]
  const nu: P2 = [-mu[1], mu[0]] // a DXF ellipse's minor axis is counterclockwise from its major axis
  const param = (p: P2): number => {
    const q: P2 = [p[0] - c[0], p[1] - c[1]]
    return _pyMod(Math.atan2((q[0] * nu[0] + q[1] * nu[1]) / (aLen * ratio), (q[0] * mu[0] + q[1] * mu[1]) / aLen), _TWO_PI)
  }
  const [t0, t1] = e._range()
  const cv = e._curve()
  let s = param(local(k.curve_evaluate(cv, t0)))
  let t = param(local(k.curve_evaluate(cv, t1)))
  if (_dot(_v3(pl.z_dir), n) < 0) [s, t] = [t, s] // the curve runs clockwise in the drawing
  if (t <= s) t += _TWO_PI
  return { kind: 'ELLIPSE', data: { c, major: m, ratio, t0: s, t1: t } }
}

/** Control points on one line, in order: the curve is that segment. */
function _straight(poles: V3[]): boolean {
  const a = poles[0]
  const b = poles[poles.length - 1]
  const L = _norm(_sub(b, a))
  if (poles.length < 2 || L === 0) return false
  const u = _div(_sub(b, a), L)
  const rel = poles.map((p) => _sub(p, a))
  const along = rel.map((r) => _dot(r, u))
  let off = -Infinity
  rel.forEach((r, i) => {
    off = Math.max(off, _norm(_sub(r, _mul(u, along[i]))))
  })
  if (off > 1e-12 * L) return false
  for (let i = 1; i < along.length; i++) if (!(along[i] - along[i - 1] >= -1e-12 * L)) return false
  return true
}

/** Center, radius and axis (counterclockwise in the curve's direction) of a rational degree-2
 * B-spline edge that is a circular arc. Each span of such a curve is a conic, and a conic with
 * five points on a circle is that circle; seven points per span are tested. */
export function _circleOf(e: Edge): [V3, number, V3] | null {
  const cv = e._curve()
  const d = ext.curve_data(cv)
  if (Math.trunc(d.degree) !== 2 || d.weights == null) return null
  const [t0, t1] = e._range()
  const allKnots = (d.knots as number[]).map(Number)
  const knots = [...new Set(allKnots)].sort((x, y) => x - y)
  const pts: V3[] = []
  for (let i = 0; i + 1 < knots.length; i++) {
    const lo = Math.max(knots[i], t0)
    const hi = Math.min(knots[i + 1], t1)
    if (hi > lo) for (const t of _linspace(lo, hi, 7)) pts.push(_v3(k.curve_evaluate(cv, t)))
  }
  if (pts.length < 5) return null
  const poles = (d.poles as number[][]).map(_v3)
  const [q0, q1, q2] = poles
  let axis = _cross(_sub(q1, q0), _sub(q2, q1))
  if (_norm(axis) <= 1e-12 * _norm(_sub(q1, q0)) * _norm(_sub(q2, q1))) return null
  axis = _div(axis, _norm(axis))
  // The first span's end tangents point at its middle control point, so the center is where the
  // normals at both ends meet (exact from the control points, not from evaluated points).
  if (knots.length > 2 && allKnots.filter((x) => Math.abs(x - knots[1]) <= 1e-14 * Math.max(1.0, Math.abs(knots[1]))).length < 2) {
    return null // the first three poles are not the first span's Bézier points
  }
  const n0 = _cross(axis, _sub(q1, q0))
  const n2 = _cross(axis, _sub(q2, q1))
  const A = [
    [_dot(n0, n0), -_dot(n0, n2)],
    [_dot(n0, n2), -_dot(n2, n2)],
  ]
  const q20 = _sub(q2, q0)
  let s: number
  try {
    s = solve(A, [[_dot(q20, n0)], [_dot(q20, n2)]])[0][0]
  } catch (err) {
    if (err instanceof RangeError) return null // a singular matrix
    throw err
  }
  const center = _add(q0, _mul(n0, s))
  const r = 0.5 * (_norm(_sub(q0, center)) + _norm(_sub(q2, center)))
  if (!pts.every((p) => Math.abs(_norm(_sub(p, center)) - r) <= 1e-9 * r)) return null
  if (!pts.every((p) => Math.abs(_dot(_sub(p, center), axis)) <= 1e-9 * r)) return null
  let turn = 0
  for (let i = 0; i < pts.length - 1; i++) turn += _dot(_cross(_sub(pts[i], center), _sub(pts[i + 1], center)), axis)
  return [center, r, turn >= 0 ? axis : _neg(axis)]
}

/** Join consecutive arcs of one circle (as the pieces of a section's holes come). */
function _mergeArcs(ents: _Ent[]): _Ent[] {
  const out: _Ent[] = []
  for (const ent of ents) {
    if (out.length && _join(out[out.length - 1], ent)) continue
    out.push(ent)
  }
  if (out.length > 1 && _join(out[0], out[out.length - 1])) out.pop()
  return out.map((x) =>
    x.kind === 'ARC' && Math.abs(_angleGap(x.data.a1, x.data.a0)) <= 1e-9 ? { kind: 'CIRCLE', data: { c: x.data.c, r: x.data.r } } : x,
  )
}

/** Extend arc `a` by arc `b` when they continue each other on one circle. */
function _join(a: _Ent, b: _Ent): boolean {
  if (a.kind !== 'ARC' || b.kind !== 'ARC') return false
  const r = Math.max(a.data.r, b.data.r)
  const dx = a.data.c[0] - b.data.c[0]
  const dy = a.data.c[1] - b.data.c[1]
  const dc = Math.sqrt(dx * dx + dy * dy)
  if (Math.abs(a.data.r - b.data.r) > 1e-9 * r || dc > 1e-9 * r) return false
  if (Math.abs(_angleGap(a.data.a1, b.data.a0)) <= 1e-9) {
    a.data.a1 = b.data.a1
    return true
  }
  if (Math.abs(_angleGap(b.data.a1, a.data.a0)) <= 1e-9) {
    a.data.a0 = b.data.a0
    return true
  }
  return false
}

/** Difference of two angles in degrees, in (-180, 180]. */
function _angleGap(a: number, b: number): number {
  const d = _pyMod(a - b, 360.0)
  return d > 180.0 ? d - 360.0 : d
}

// -- the file ---------------------------------------------------------------------
function _num(v: number): string {
  v = Number(v)
  return Math.abs(v) < 1e-13 ? '0.0' : _reprFloat(v)
}

// Fixed handles of the tables, blocks and dictionaries; entities and layers get handles from 0x100.
const _H: Record<string, string> = {
  BLOCK_RECORD: '1', LAYER: '2', STYLE: '3', LTYPE: '5', VIEW: '6', UCS: '7', VPORT: '8',
  APPID: '9', DIMSTYLE: 'A', ROOT: 'C', GROUPS: 'D', STYLE_STANDARD: '11', APPID_ACAD: '12',
  LT_BYBLOCK: '14', LT_BYLAYER: '15', LT_CONTINUOUS: '16', MODEL: '1F', PAPER: '1B',
  MODEL_BLOCK: '20', MODEL_END: '21', PAPER_BLOCK: '1C', PAPER_END: '1D', DIMSTYLE_STANDARD: '27',
  VPORT_ACTIVE: '29',
}

/** An AutoCAD 2000 DXF: header, tables, blocks, entities and objects, with handles. */
class _Writer {
  handle = 0xff
  layers = new Map<string, string>() // name -> linetype
  dash: [number, number] = [3.0, 1.5] // the DASHED linetype: dash and gap, in the file's unit
  readonly entities: string[] = []
  lo: P2 = [Infinity, Infinity]
  hi: P2 = [-Infinity, -Infinity]

  _next(): string {
    this.handle += 1
    return this.handle.toString(16).toUpperCase()
  }

  _grow(lo: P2, hi: P2): void {
    this.lo = [Math.min(this.lo[0], lo[0]), Math.min(this.lo[1], lo[1])]
    this.hi = [Math.max(this.hi[0], hi[0]), Math.max(this.hi[1], hi[1])]
  }

  entity(layer: string, ent: _Ent, linetype = 'Continuous'): void {
    if (!this.layers.has(layer)) this.layers.set(layer, linetype)
    const d = ent.data
    const tags = ['0', ent.kind, '5', this._next(), '330', _H.MODEL, '100', 'AcDbEntity', '8', layer]
    if (ent.kind === 'LINE') {
      tags.push('100', 'AcDbLine', ..._xy(10, d.a), ..._xy(11, d.b))
      this._grow([Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1])], [Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])])
    } else if (ent.kind === 'CIRCLE' || ent.kind === 'ARC') {
      tags.push('100', 'AcDbCircle', ..._xy(10, d.c), '40', _num(d.r))
      if (ent.kind === 'ARC') tags.push('100', 'AcDbArc', '50', _num(d.a0), '51', _num(d.a1))
      this._grow([d.c[0] - d.r, d.c[1] - d.r], [d.c[0] + d.r, d.c[1] + d.r])
    } else if (ent.kind === 'ELLIPSE') {
      tags.push('100', 'AcDbEllipse', ..._xy(10, d.c), ..._xy(11, d.major), '210', '0.0', '220', '0.0', '230', '1.0')
      tags.push('40', _num(d.ratio), '41', _num(d.t0), '42', _num(d.t1))
      const r = Math.sqrt(d.major[0] * d.major[0] + d.major[1] * d.major[1])
      this._grow([d.c[0] - r, d.c[1] - r], [d.c[0] + r, d.c[1] + r])
    } else {
      // SPLINE: planar, rational when it has weights
      const rational = d.weights !== null
      tags.push('100', 'AcDbSpline', '210', '0.0', '220', '0.0', '230', '1.0', '70', String(8 | (rational ? 4 : 0)))
      tags.push('71', String(d.degree), '72', String(d.knots.length), '73', String(d.poles.length), '74', '0', '42', '1e-10', '43', '1e-10')
      for (const kv of d.knots) tags.push('40', _num(kv))
      for (const wv of d.weights ?? []) tags.push('41', _num(wv))
      for (const q of d.poles) tags.push(..._xy(10, q))
      const P = d.poles as P2[]
      this._grow([Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1]))], [Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))])
    }
    this.entities.push(tags.join('\n'))
  }

  /** The file's text. */
  text(insunits: number, metric: boolean): string {
    const ok = Number.isFinite(this.lo[0]) && Number.isFinite(this.lo[1])
    const [lo, hi]: [P2, P2] = ok ? [this.lo, this.hi] : [[0, 0], [0, 0]]
    if (!this.layers.has('0')) this.layers = new Map([['0', 'Continuous'], ...this.layers])
    const layerTags: string[] = []
    for (const [name, linetype] of this.layers) {
      layerTags.push('0', 'LAYER', '5', this._next(), '330', _H.LAYER, '100', 'AcDbSymbolTableRecord')
      layerTags.push('100', 'AcDbLayerTableRecord', '2', name, '70', '0', '62', '7', '6', linetype || 'Continuous')
    }
    const dashed = [...this.layers.values()].includes('DASHED') ? this._next() : null
    const seed = (this.handle + 1).toString(16).toUpperCase()
    const center: P2 = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0]
    const height = Math.max(hi[1] - lo[1], (hi[0] - lo[0]) / 1.5, 1.0) * 1.1
    const lt: string[] = []
    for (const [key, name, text] of [
      ['LT_BYBLOCK', 'ByBlock', ''],
      ['LT_BYLAYER', 'ByLayer', ''],
      ['LT_CONTINUOUS', 'Continuous', 'Solid line'],
    ]) {
      lt.push('0', 'LTYPE', '5', _H[key], '330', _H.LTYPE, '100', 'AcDbSymbolTableRecord')
      lt.push('100', 'AcDbLinetypeTableRecord', '2', name, '70', '0', '3', text, '72', '65', '73', '0', '40', '0.0')
    }
    if (dashed !== null) {
      const [dash, gap] = this.dash
      lt.push('0', 'LTYPE', '5', dashed, '330', _H.LTYPE, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord')
      lt.push('2', 'DASHED', '70', '0', '3', 'Dashed __ __ __', '72', '65', '73', '2', '40', _num(dash + gap))
      lt.push('49', _num(dash), '74', '0', '49', _num(-gap), '74', '0')
    }
    const parts = [
      _section('HEADER', [
        '9', '$ACADVER', '1', 'AC1015',
        '9', '$HANDSEED', '5', seed,
        '9', '$INSUNITS', '70', String(insunits),
        '9', '$MEASUREMENT', '70', metric ? '1' : '0',
        '9', '$EXTMIN', '10', _num(lo[0]), '20', _num(lo[1]), '30', '0.0',
        '9', '$EXTMAX', '10', _num(hi[0]), '20', _num(hi[1]), '30', '0.0',
      ]),
      _section('CLASSES', []),
      _section('TABLES', [
        ..._table('VPORT', 1, [
          '0', 'VPORT', '5', _H.VPORT_ACTIVE, '330', _H.VPORT, '100', 'AcDbSymbolTableRecord',
          '100', 'AcDbViewportTableRecord', '2', '*Active', '70', '0', '10', '0.0', '20', '0.0',
          '11', '1.0', '21', '1.0', '12', _num(center[0]), '22', _num(center[1]), '13', '0.0', '23', '0.0',
          '14', '10.0', '24', '10.0', '15', '10.0', '25', '10.0', '16', '0.0', '26', '0.0', '36', '1.0',
          '17', '0.0', '27', '0.0', '37', '0.0', '40', _num(height), '41', '1.5', '42', '50.0',
          '43', '0.0', '44', '0.0', '50', '0.0', '51', '0.0', '71', '0', '72', '100', '73', '1', '74', '3',
          '75', '0', '76', '0', '77', '0', '78', '0',
        ]),
        ..._table('LTYPE', dashed === null ? 3 : 4, lt),
        ..._table('LAYER', this.layers.size, layerTags),
        ..._table('STYLE', 1, [
          '0', 'STYLE', '5', _H.STYLE_STANDARD, '330', _H.STYLE, '100', 'AcDbSymbolTableRecord',
          '100', 'AcDbTextStyleTableRecord', '2', 'Standard', '70', '0', '40', '0.0', '41', '1.0',
          '50', '0.0', '71', '0', '42', '2.5', '3', 'txt', '4', '',
        ]),
        ..._table('VIEW', 0, []),
        ..._table('UCS', 0, []),
        ..._table('APPID', 1, [
          '0', 'APPID', '5', _H.APPID_ACAD, '330', _H.APPID, '100', 'AcDbSymbolTableRecord',
          '100', 'AcDbRegAppTableRecord', '2', 'ACAD', '70', '0',
        ]),
        ..._table(
          'DIMSTYLE',
          1,
          [
            '0', 'DIMSTYLE', '105', _H.DIMSTYLE_STANDARD, '330', _H.DIMSTYLE, '100',
            'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '2', 'Standard', '70', '0',
          ],
          'AcDbDimStyleTable',
        ),
        ..._table('BLOCK_RECORD', 2, [
          '0', 'BLOCK_RECORD', '5', _H.MODEL, '330', _H.BLOCK_RECORD, '100', 'AcDbSymbolTableRecord',
          '100', 'AcDbBlockTableRecord', '2', '*Model_Space',
          '0', 'BLOCK_RECORD', '5', _H.PAPER, '330', _H.BLOCK_RECORD, '100', 'AcDbSymbolTableRecord',
          '100', 'AcDbBlockTableRecord', '2', '*Paper_Space',
        ]),
      ]),
      _section('BLOCKS', [
        '0', 'BLOCK', '5', _H.MODEL_BLOCK, '330', _H.MODEL, '100', 'AcDbEntity', '8', '0',
        '100', 'AcDbBlockBegin', '2', '*Model_Space', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0',
        '3', '*Model_Space', '1', '',
        '0', 'ENDBLK', '5', _H.MODEL_END, '330', _H.MODEL, '100', 'AcDbEntity', '8', '0',
        '100', 'AcDbBlockEnd',
        '0', 'BLOCK', '5', _H.PAPER_BLOCK, '330', _H.PAPER, '100', 'AcDbEntity', '67', '1', '8', '0',
        '100', 'AcDbBlockBegin', '2', '*Paper_Space', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0',
        '3', '*Paper_Space', '1', '',
        '0', 'ENDBLK', '5', _H.PAPER_END, '330', _H.PAPER, '100', 'AcDbEntity', '67', '1', '8', '0',
        '100', 'AcDbBlockEnd',
      ]),
      _section('ENTITIES', this.entities),
      _section('OBJECTS', [
        '0', 'DICTIONARY', '5', _H.ROOT, '330', '0', '100', 'AcDbDictionary', '281', '1',
        '3', 'ACAD_GROUP', '350', _H.GROUPS,
        '0', 'DICTIONARY', '5', _H.GROUPS, '330', _H.ROOT, '100', 'AcDbDictionary', '281', '1',
      ]),
      '0\nEOF\n',
    ]
    return parts.join('\n')
  }
}

function _xy(code: number, p: P2): string[] {
  return [String(code), _num(p[0]), String(code + 10), _num(p[1]), String(code + 20), '0.0']
}

function _section(name: string, body: string[]): string {
  return ['0', 'SECTION', '2', name, ...body, '0', 'ENDSEC'].join('\n')
}

function _table(name: string, count: number, records: string[], subclass: string | null = null): string[] {
  return ['0', 'TABLE', '2', name, '5', _H[name], '330', '0', '100', 'AcDbSymbolTable', '70', String(count), ...(subclass ? ['100', subclass] : []), ...records, '0', 'ENDTAB']
}

// =============================================================================
// Small vector algebra (numpy's, on [x, y, z] arrays)
// =============================================================================
function _v3(p: ArrayLike<number>): V3 {
  return [Number(p[0]), Number(p[1]), Number(p[2])]
}

function _add(a: readonly number[], b: readonly number[]): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function _sub(a: readonly number[], b: readonly number[]): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function _mul(a: readonly number[], s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function _div(a: readonly number[], s: number): V3 {
  return [a[0] / s, a[1] / s, a[2] / s]
}

function _neg(a: readonly number[]): V3 {
  return [-a[0], -a[1], -a[2]]
}

function _dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function _cross(a: readonly number[], b: readonly number[]): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function _norm(a: readonly number[]): number {
  return Math.sqrt(_dot(a, a))
}

/** A 3x3 matrix times a vector. */
function _mv(m: M3, v: readonly number[]): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

/** Column `j` of a 3x3 matrix. */
function _col(m: M3, j: number): V3 {
  return [m[j], m[3 + j], m[6 + j]]
}

/** A point moved by a 4x4 matrix. */
function _xfPoint(m: Matrix, p: readonly number[]): V3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ]
}

/** A direction turned by a 4x4 matrix (no translation). */
function _xfVector(m: Matrix, v: readonly number[]): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]]
}

/** numpy's ptp: largest less smallest. */
function _ptp(values: readonly number[]): number {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi - lo
}

/** numpy's ptp(points, axis=0) of [x, y, z] points. */
function _ptp3(points: readonly V3[]): V3 {
  return [0, 1, 2].map((i) => _ptp(points.map((p) => p[i]))) as V3
}

/** numpy's linspace(start, stop, num): i * step + start, the last one exactly stop. */
function _linspace(start: number, stop: number, num: number): number[] {
  const div = num - 1
  if (div <= 0) return num === 1 ? [start] : []
  const delta = stop - start
  const step = delta / div
  const out: number[] = []
  for (let i = 0; i < num; i++) out.push(step === 0 ? (i / div) * delta + start : i * step + start)
  out[num - 1] = stop
  return out
}

/** numpy's sum of a 1-D array (pairwise, in blocks of eight). */
function _npSum(values: readonly number[]): number {
  const pairwise = (i: number, n: number): number => {
    if (n < 8) {
      let res = 0.0
      for (let j = 0; j < n; j++) res += values[i + j]
      return res
    }
    if (n <= 128) {
      const r = values.slice(i, i + 8)
      let j = 8
      for (; j < n - (n % 8); j += 8) for (let q = 0; q < 8; q++) r[q] += values[i + j + q]
      let res = (r[0] + r[1] + (r[2] + r[3])) + (r[4] + r[5] + (r[6] + r[7])) // ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7))
      for (; j < n; j++) res += values[i + j]
      return res
    }
    let n2 = Math.floor(n / 2)
    n2 -= n2 % 8
    return pairwise(i, n2) + pairwise(i + n2, n - n2)
  }
  return 0.0 + pairwise(0, values.length)
}

/** Least squares `x` of `[u v] x = b` (3x2; numpy's lstsq for a full rank). */
function _lstsq2(u: V3, v: V3, b: V3): [number, number] {
  const r11 = _norm(u)
  const q1 = _div(u, r11)
  const r12 = _dot(q1, v)
  const w = _sub(v, _mul(q1, r12))
  const r22 = _norm(w)
  if (r22 === 0) return [_dot(q1, b) / r11, 0]
  const q2 = _div(w, r22)
  const x2 = _dot(q2, b) / r22
  return [(_dot(q1, b) - r12 * x2) / r11, x2]
}

/** numpy's searchsorted(sorted, u, side="right"). */
function _bisectRight(sorted: readonly number[], u: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (u < sorted[mid]) hi = mid
    else lo = mid + 1
  }
  return lo
}

// =============================================================================
// Python's semantics where they differ from JavaScript's
// =============================================================================
const _RAD_TO_DEG = 180.0 / Math.PI
const _DEG_TO_RAD = Math.PI / 180.0

/** Python's math.degrees. */
function _degrees(x: number): number {
  return x * _RAD_TO_DEG
}

/** Python's math.radians. */
function _radians(x: number): number {
  return x * _DEG_TO_RAD
}

/** Python's float modulo: the sign of the divisor. */
function _pyMod(a: number, b: number): number {
  const m = a % b
  if (m) return b < 0 !== m < 0 ? m + b : m
  return b < 0 ? -0.0 : 0.0
}

/** Python's round() of a float to an integer: halves to even. */
function _round(x: number): number {
  return Math.abs(x - Math.trunc(x)) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x)
}

/** numpy's rint: halves to even. */
function _rint(x: number): number {
  return _round(x)
}

/** Python's int() of a float: toward zero; infinities and NaN throw. */
function _int(x: number): number {
  if (Number.isNaN(x)) throw new RangeError('cannot convert float NaN to integer')
  if (!Number.isFinite(x)) throw new RangeError('cannot convert float infinity to integer')
  return Math.trunc(x) + 0
}

/** Python's int() of a decimal string, or null when it is none. */
function _int10(s: string): number | null {
  return /^[+-]?\d(?:_?\d)*$/.test(s) ? Number(s.replaceAll('_', '')) : null
}

// Python's float() of a string: decimal literals with optional underscores between digits,
// inf, infinity and nan; anything else is a ValueError.
const _FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/
const _SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i

function _float(text: string): number {
  const s = _strip(text)
  if (_FLOAT_RE.test(s)) return Number(s.replaceAll('_', ''))
  const m = _SPECIAL_RE.exec(s)
  if (m) return m[2].toLowerCase() === 'nan' ? Number.NaN : m[1] === '-' ? -Infinity : Infinity
  throw new RangeError(`could not convert string to float: ${_repr(text)}`)
}

/** Python's repr() of a float: the shortest digits that read back, with ".0" on whole numbers
 * and an exponent below 1e-4 and from 1e16 on. */
function _reprFloat(v: number): string {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0'
  const [mantissa, exponent] = Math.abs(v).toExponential().split('e')
  const digits = mantissa.replace('.', '')
  const exp = Number(exponent)
  const point = exp + 1 // digits before the decimal point
  let s: string
  if (point <= -4 || point > 16) {
    s = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
  } else if (point <= 0) {
    s = `0.${'0'.repeat(-point)}${digits}`
  } else if (point >= digits.length) {
    s = `${digits}${'0'.repeat(point - digits.length)}.0`
  } else {
    s = `${digits.slice(0, point)}.${digits.slice(point)}`
  }
  return v < 0 ? `-${s}` : s
}

// Python's str.splitlines() and str.strip()
const _LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/
const _SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const _STRIP = new RegExp(`^${_SPACE}+|${_SPACE}+$`, 'g')

function _splitlines(text: string): string[] {
  const lines = text.split(_LINE_BREAK)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function _strip(s: string): string {
  return s.replace(_STRIP, '')
}

/** Strings in Python's order (by code point). */
function _compare(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i].codePointAt(0) as number) - (y[i].codePointAt(0) as number)
    if (d) return d
  }
  return x.length - y.length
}

function _compareNumbers(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length - b.length
}

// code page 1252, bytes 0x80 to 0x9F (\0: not defined, as Python's codec has it)
const _CP1252 =
  '\u20ac\0\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\0\u017d\0' +
  '\0\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\0\u017e\u0178'

function _cp1252(data: Uint8Array): string | null {
  const parts: string[] = []
  const codes: number[] = []
  for (const b of data) {
    if (b >= 0x80 && b < 0xa0) {
      const c = _CP1252.charCodeAt(b - 0x80)
      if (c === 0) return null
      codes.push(c)
    } else {
      codes.push(b)
    }
    if (codes.length === 8192) {
      parts.push(String.fromCharCode(...codes))
      codes.length = 0
    }
  }
  parts.push(String.fromCharCode(...codes))
  return parts.join('')
}

function _latin1(data: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < data.length; i += 8192) parts.push(String.fromCharCode(...data.subarray(i, i + 8192)))
  return parts.join('')
}

// characters str.isprintable() rejects (other than the space)
const _UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u

/** Python's repr() of a string. */
function _repr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = quote
  for (const c of s) {
    const cp = c.codePointAt(0) as number
    if (c === quote || c === '\\') out += `\\${c}`
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else if (c !== ' ' && (cp < 0x20 || cp === 0x7f || _UNPRINTABLE.test(c))) {
      if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`
      else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`
      else out += `\\U${cp.toString(16).padStart(8, '0')}`
    } else out += c
  }
  return out + quote
}

/** A value as Python's repr shows it, for messages. */
function _reprValue(v: unknown): string {
  return typeof v === 'string' ? _repr(v) : String(v)
}

/** Node's file system (node:fs), looked up when needed (`process.getBuiltinModule`), so bundles for
 * the browser carry no `node:` import; outside Node it throws. */
function _fs(what: string): Any {
  const proc = (globalThis as Any).process
  const fs = typeof proc?.getBuiltinModule === 'function' ? proc.getBuiltinModule('node:fs') : undefined
  if (!fs) {
    const inMemory = what.startsWith('export') ? 'toDxf' : what.replace('import', 'from')
    throw new Error(`${what}: reading and writing files needs Node.js (22.3 or later); elsewhere use ${inMemory}, which works in memory`)
  }
  return fs
}
