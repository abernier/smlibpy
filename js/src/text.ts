// Text: lettering as a sketch with the exact outlines of a font.

import { _opts, k, scope } from './kernel.ts'
import { Align, type AlignLike, _one } from './align.ts'
import { type Contour, type Font, FontError, type Point, type Segment, _repr, loadFont } from './font.ts'
import { Plane, _formatG } from './geometry.ts'
import * as regions from './regions.ts'
import { Edge, type Sketch, Wire, _canonicalCurve, _typeName } from './shapes.ts'

/** A piece of a glyph outline in font units: a line, or a B-spline through on-curve points. */
type Piece = { kind: 'line'; a: Point; b: Point } | { kind: 'spline'; degree: number; poles: Point[]; knots: number[] }

type _Polygon = [number, number][]

const _SAMPLES: Record<number, number> = { 2: 1, 3: 8, 4: 12 } // polygon points per segment (by point count) for nesting tests

/** How `Text` sets the text. */
export interface TextOptions {
  /** A TrueType or OpenType font (.ttf, .otf, .ttc, .woff): the bytes of its file, or its path
   * (Node). Default: the built-in Lato Regular. */
  font?: string | Uint8Array | null
  /** Placement of the text's layout box (from the start to the end of the longest line, and from
   * the baseline of the last line to the cap height of the first). `CENTER` centers it on the
   * origin; `MIN` starts the text at x = 0 with the last baseline on y = 0; `MAX` ends it at
   * x = 0 with the first cap height on y = 0. One value or one per axis; the lines of a block are
   * aligned the same way (left, centered, right). Default: `Align.CENTER`. */
  align?: AlignLike
  /** Extra distance between neighbouring letters in mm (negative: closer). Default 0. */
  spacing?: number
  /** Distance between baselines as a multiple of `size`. Default 1.6. */
  lineSpacing?: number
  /** Apply the font's kerning pairs. Default true. */
  kerning?: boolean
  /** An edge or wire in the XY plane to set one line of text along. Each letter stands upright on
   * the path at the arc length of the middle of its advance, turned with the tangent; the text
   * reads in the direction of the path and stands on its left side. `align` places it along the
   * path (`MIN` at its start) and across it (`MIN`: baseline on the path, `CENTER`: the middle
   * of the capitals, `MAX`: their top). */
  path?: Edge | Wire | null
}

/**
 * Lettering as a sketch in the XY plane, with the exact outlines of the font.
 *
 * `text` is the text; "\n" starts a new line. `size` is the height of the capital letters (H,
 * E, T) in mm, the nominal height of technical lettering: `Text("H", 10)` is 10 mm tall. Round
 * letters overshoot it by a few percent; descenders go below the baseline.
 *
 * Returns a `Sketch` on `Plane.XY`: one face per separate piece of a letter, counters as holes.
 * Outlines are exact: straight segments are lines, curved runs are B-splines through the font's
 * on-curve points.
 *
 * Throws a RangeError for an empty text, a size that is not positive, a character the font does
 * not have, a font that cannot be read, or a path the text does not fit on.
 */
export function Text(text: string, size: number, options: TextOptions = {}): Sketch {
  return scope(() => {
    _opts('Text', options, arguments.length)
    const font = options.font ?? null
    const align: AlignLike = options.align === undefined ? Align.CENTER : options.align
    const spacing = options.spacing ?? 0.0
    const lineSpacing = options.lineSpacing ?? 1.6
    const kerning = options.kerning ?? true
    const path = options.path ?? null
    if (typeof text !== 'string') throw new TypeError(`Text: the text must be a string, not ${_typeName(text)}`)
    if (!(typeof size === 'number' && Number.isFinite(size) && size > 0)) {
      throw new RangeError(`Text: size must be a positive number (the height of capital letters in mm), got ${_reprValue(size)}`)
    }
    if (!(Number.isFinite(lineSpacing) && lineSpacing > 0)) {
      throw new RangeError(`Text: lineSpacing must be positive (a multiple of size), got ${_reprValue(lineSpacing)}`)
    }
    let f: Font
    try {
      f = loadFont(font)
    } catch (e) {
      if (e instanceof FontError) throw new RangeError(`Text: ${e.message}`)
      throw e
    }
    const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
    const chars = [...text]
    const bad = _sortedSet(chars.filter((c) => {
      const o = c.codePointAt(0) as number
      return (o < 32 && c !== '\r' && c !== '\n') || (0x7f <= o && o < 0xa0)
    }))
    if (bad.length) throw new RangeError(`Text: control characters cannot be drawn: ${bad.map((c) => `U+${_hex4(c)}`).join(', ')}`)
    const missing = _sortedSet(chars.filter((c) => c !== '\r' && c !== '\n' && f.glyphIndex(c) === null))
    if (missing.length) {
      const shown = missing
        .slice(0, 8)
        .map((c) => `${_repr(c)} (U+${_hex4(c)})`)
        .join(', ')
      throw new RangeError(
        `Text: the font ${f.name} has no glyph for ${shown}; pass font: with a font that has ${missing.length === 1 ? 'it' : 'them'}`,
      )
    }
    const scale = size / f.capHeight
    const laid = lines.map((line) => _layout(f, line, scale, Number(spacing), Boolean(kerning)))
    if (!laid.some((line) => line.glyphs.some(([g]) => _hasInk(f, g)))) {
      throw new RangeError('Text: nothing to draw: the text is empty or only spaces')
    }
    const [ax, ay] = _alignment(align)
    const placed = path !== null ? _alongPath(f, laid, path, size, ax, ay) : _straight(laid, size, lineSpacing, ax, ay)
    return _sketch(f, placed, scale)
  })
}

// =============================================================================
// Layout
// =============================================================================
interface _Line {
  glyphs: [number, number][] // glyph and the x of its origin in mm
  width: number // from the first origin to the end of the last advance, in mm
}

function _layout(f: Font, line: string, scale: number, spacing: number, kerning: boolean): _Line {
  const gids = [...line].map((c) => f.glyphIndex(c) as number)
  const n = gids.length
  const adv = gids.map((g) => f.advance(g))
  const place = new Array<number>(n).fill(0.0)
  if (kerning) {
    for (let i = 0; i < n - 1; i++) {
      const pa = f.kerning(gids[i], gids[i + 1])
      adv[i] += pa.advance1
      place[i] += pa.placement1
      adv[i + 1] += pa.advance2
      place[i + 1] += pa.placement2
    }
  }
  let x = 0.0
  const glyphs: [number, number][] = []
  for (let i = 0; i < n; i++) {
    glyphs.push([gids[i], x + place[i] * scale])
    x += adv[i] * scale + (i < n - 1 ? spacing : 0.0)
  }
  return { glyphs, width: x }
}

function _alignment(align: AlignLike): [Align | null, Align | null] {
  if (align == null || typeof align === 'string') {
    const a = _one(align)
    return [a, a]
  }
  const items: (Align | string | null)[] = Array.from(align as Iterable<Align | string | null>)
  if (!(1 <= items.length && items.length <= 3)) throw new RangeError('Text: align takes one value or one per axis (x, y)')
  while (items.length < 2) items.push(Align.CENTER)
  return [_one(items[0]), _one(items[1])]
}

interface _Placed {
  glyph: number
  matrix: [number, number, number, number] // font units -> mm: x' = a*x + b*y, y' = c*x + d*y
  offset: [number, number]
}

function _straight(laid: _Line[], size: number, lineSpacing: number, ax: Align | null, ay: Align | null): _Placed[] {
  const top = size
  const bottom = -(laid.length - 1) * lineSpacing * size
  const dy = ay === Align.MIN ? -bottom : ay === Align.MAX ? -top : ay === Align.CENTER ? -(top + bottom) / 2.0 : 0.0
  const out: _Placed[] = []
  laid.forEach((line, row) => {
    const dx = ax === Align.CENTER ? -line.width / 2.0 : ax === Align.MAX ? -line.width : 0.0
    const y = -row * lineSpacing * size + dy
    for (const [g, x] of line.glyphs) out.push({ glyph: g, matrix: [1.0, 0.0, 0.0, 1.0], offset: [x + dx, y] })
  })
  return out
}

function _alongPath(f: Font, laid: _Line[], path: Edge | Wire, size: number, ax: Align | null, ay: Align | null): _Placed[] {
  if (laid.length > 1) throw new RangeError('Text: a text along a path has one line; leave out the line breaks')
  if (!(path instanceof Edge || path instanceof Wire)) throw new TypeError(`Text: path must be an Edge or a Wire, not ${_typeName(path)}`)
  const box = path.bbox()
  const flat = 1e-9 * Math.max(1.0, box.diagonal)
  if (Math.abs(box.min.z) > flat || Math.abs(box.max.z) > flat) {
    throw new RangeError('Text: the path must lie in the XY plane; draw it there and place the text with .on()')
  }
  const line = laid[0]
  const length = path.length
  if (line.width > length * (1 + 1e-9)) {
    throw new RangeError(
      `Text: the text is ${_formatG(line.width)} mm long but the path only ${_formatG(length)} mm; use a smaller size or a longer path`,
    )
  }
  const start = ax === Align.CENTER ? (length - line.width) / 2.0 : ax === Align.MAX ? length - line.width : 0.0
  const lift = ay === Align.CENTER ? -size / 2.0 : ay === Align.MAX ? -size : 0.0
  const out: _Placed[] = []
  for (const [g, x] of line.glyphs) {
    const half = (f.advance(g) * size) / f.capHeight / 2.0
    const s = Math.min(Math.max(start + x + half, 0.0), length)
    const p = path.pointAt(s / length)
    const t = path.tangentAt(s / length)
    let tx = t.x
    let ty = t.y
    const norm = _hypot(tx, ty)
    tx = tx / norm
    ty = ty / norm
    const nx = -ty // left of the direction of travel
    const ny = tx
    // local (u, v) in mm -> p + t*(u - half) + n*(v + lift)
    const ox = p.x - tx * half + nx * lift
    const oy = p.y - ty * half + ny * lift
    out.push({ glyph: g, matrix: [tx, nx, ty, ny], offset: [ox, oy] })
  }
  return out
}

// =============================================================================
// Glyph outlines: exact pieces, nesting plan
// =============================================================================
interface _Glyph {
  pieces: Piece[][] // per contour
  polygons: _Polygon[] // per contour, for nesting and overlap tests
  plan: regions.Plan
  loops: number[] // the contours that make the outline
}

const _glyphs = new WeakMap<Font, Map<number, _Glyph | null>>() // per font, the last 4096 glyphs

function _glyph(f: Font, gid: number): _Glyph | null {
  let cache = _glyphs.get(f)
  if (cache === undefined) {
    cache = new Map()
    _glyphs.set(f, cache)
  }
  if (cache.has(gid)) {
    const hit = cache.get(gid) as _Glyph | null
    cache.delete(gid)
    cache.set(gid, hit)
    return hit
  }
  const made = _makeGlyph(f, gid)
  cache.set(gid, made)
  if (cache.size > 4096) cache.delete(cache.keys().next().value as number)
  return made
}

function _makeGlyph(f: Font, gid: number): _Glyph | null {
  const contours = f.outline(gid).filter((c) => c.length >= 1)
  const pieces: Piece[][] = []
  const polygons: _Polygon[] = []
  const areas: number[] = []
  for (const c of contours) {
    const area = _sum(c.map(_segmentArea))
    const poly = _polygon(c)
    if (poly.length < 3 || Math.abs(area) <= 1e-12 * Math.max(1.0, _extent(poly)) ** 2) continue // a contour without area draws nothing
    pieces.push(_pieces(c))
    polygons.push(poly)
    areas.push(area)
  }
  if (!pieces.length) return null
  const p = regions.plan(polygons, 'nonzero', areas)
  const loops = p.kind === 'faces' ? p.keep : p.components.flatMap(([o, hs]) => [o, ...hs])
  return { pieces, polygons, plan: p, loops }
}

function _hasInk(f: Font, gid: number): boolean {
  return _glyph(f, gid) !== null
}

/** numpy's `ptp(poly, axis=0).max()`: the larger side of the polygon's box. */
function _extent(poly: _Polygon): number {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [x, y] of poly) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return Math.max(x1 - x0, y1 - y0)
}

/** Exact signed area contribution of a segment: 1/2 of the integral of x dy - y dx. */
export function _segmentArea(seg: Segment): number {
  const c = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
  if (seg.length === 2) return 0.5 * c(seg[0], seg[1])
  if (seg.length === 3) {
    const [p0, p1, p2] = seg
    return (2 * c(p0, p1) + 2 * c(p1, p2) + c(p0, p2)) / 6.0
  }
  const [p0, p1, p2, p3] = seg
  return (6 * c(p0, p1) + 3 * c(p0, p2) + c(p0, p3) + 3 * c(p1, p2) + 3 * c(p1, p3) + 6 * c(p2, p3)) / 20.0
}

function _polygon(contour: Contour): _Polygon {
  const pts: _Polygon = []
  for (const seg of contour) {
    const m = _SAMPLES[seg.length]
    if (seg.length === 2) {
      pts.push([seg[0][0], seg[0][1]])
      continue
    }
    const deg = seg.length - 1
    for (let i = 0; i < m; i++) pts.push(_bezier(seg, deg, i / m))
  }
  return pts
}

function _bezier(P: Segment, deg: number, t: number): [number, number] {
  const s = 1.0 - t
  const at = (j: 0 | 1) =>
    deg === 2
      ? s * s * P[0][j] + 2 * s * t * P[1][j] + t * t * P[2][j]
      : s ** 3 * P[0][j] + 3 * s * s * t * P[1][j] + 3 * s * t * t * P[2][j] + t ** 3 * P[3][j]
  return [at(0), at(1)]
}

function _cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function _dist(a: Point, b: Point): number {
  return _hypot(b[0] - a[0], b[1] - a[1])
}

function _same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

/** `p` on the segment from `a` to `b` (within rounding). */
function _onSegment(p: Point, a: Point, b: Point): boolean {
  const ab = _dist(a, b)
  if (ab === 0) return _same(p, a)
  if (Math.abs(_cross(a, b, p)) > 1e-12 * ab * ab) return false
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (ab * ab)
  return -1e-12 <= t && t <= 1 + 1e-12
}

/** A curve whose control points lie on its chord is a straight line. */
function _straightened(seg: Segment): Segment {
  const last = seg[seg.length - 1]
  if (seg.length > 2 && seg.slice(1, -1).every((q) => _onSegment(q, seg[0], last)) && !_same(seg[0], last)) return [seg[0], last]
  return seg
}

/** Where the joint of two curves of one degree divides the line between the control points next
 * to it, if the outline runs on smoothly there (null at a corner). */
function _jointRatio(a: Segment, b: Segment): number | null {
  if (a.length !== b.length || a.length < 3) return null
  const left = a[a.length - 2]
  const joint = a[a.length - 1]
  const right = b[1]
  const u = _dist(left, joint)
  const v = _dist(joint, right)
  if (u === 0 || v === 0) return null
  if (Math.abs(_cross(left, joint, right)) > 1e-12 * u * v) return null
  if ((joint[0] - left[0]) * (right[0] - joint[0]) + (joint[1] - left[1]) * (right[1] - joint[1]) <= 0) return null
  const t = u / (u + v)
  return 1e-3 <= t && t <= 1 - 1e-3 ? t : null
}

/** Lines and B-splines of a closed contour: smooth runs of Béziers become one B-spline that
 * passes through every on-curve point, collinear lines one line. */
function _pieces(contour: Contour): Piece[] {
  let segs = contour.map(_straightened)
  const n = segs.length
  let ratios = segs.map((_, i) => _jointRatio(segs[i], segs[(i + 1) % n]))
  if (ratios.some((r) => r === null)) {
    // start after a corner, so no smooth run is cut in two
    const first = ratios.indexOf(null) + 1
    segs = [...segs.slice(first), ...segs.slice(0, first)]
    ratios = [...ratios.slice(first), ...ratios.slice(0, first)]
  }
  const out: Piece[] = []
  let run: Segment[] = []
  let runRatios: number[] = []
  for (let i = 0; i < n; i++) {
    const seg = segs[i]
    if (seg.length === 2) {
      const prev = out[out.length - 1]
      if (prev !== undefined && prev.kind === 'line' && _same(prev.b, seg[0]) && _continues(prev.a, prev.b, seg[1])) {
        out[out.length - 1] = { kind: 'line', a: prev.a, b: seg[1] }
      } else {
        out.push({ kind: 'line', a: seg[0], b: seg[1] })
      }
      continue
    }
    run.push(seg)
    const r = ratios[i]
    if (r !== null && i < n - 1 && segs[i + 1].length === seg.length) {
      runRatios.push(r)
      continue
    }
    out.push(_spline(run, runRatios))
    run = []
    runRatios = []
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && first.kind === 'line' && last.kind === 'line' && _continues(last.a, last.b, first.b)) {
    out[0] = { kind: 'line', a: last.a, b: first.b }
    out.pop()
  }
  return out
}

/** The line a -> b goes on straight to c. */
function _continues(a: Point, b: Point, c: Point): boolean {
  const ab = _dist(a, b)
  const bc = _dist(b, c)
  if (ab === 0 || bc === 0) return false
  if (Math.abs(_cross(a, b, c)) > 1e-12 * ab * bc) return false
  return (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0
}

/** One B-spline through a smooth run of Béziers of one degree (exactly the same curve). */
function _spline(run: Segment[], ratios: number[]): Piece {
  const deg = run[0].length - 1
  const poles: Point[] = run[0].slice(0, -1)
  for (const seg of run.slice(1)) poles.push(...seg.slice(1, -1))
  poles.push(run[run.length - 1][deg])
  const spans = [1.0]
  for (const t of ratios) spans.push((spans[spans.length - 1] * (1.0 - t)) / t)
  const total = _sum(spans)
  const knots = new Array<number>(deg + 1).fill(0.0)
  let acc = 0.0
  for (const d of spans.slice(0, -1)) {
    acc += d
    for (let j = 0; j < deg - 1; j++) knots.push(acc / total)
  }
  for (let j = 0; j < deg + 1; j++) knots.push(1.0)
  return { kind: 'spline', degree: deg, poles, knots }
}

// =============================================================================
// Building the sketch
// =============================================================================
function _apply(m: readonly number[], o: readonly number[], s: number, p: Point): [number, number, number] {
  const x = p[0] * s
  const y = p[1] * s
  return [m[0] * x + m[1] * y + o[0], m[2] * x + m[3] * y + o[1], 0.0]
}

/** New kernel curves of a contour's pieces, placed (the caller owns them). */
function _curves(pieces: Piece[], m: readonly number[], o: readonly number[], s: number): number[] {
  const out: number[] = []
  try {
    for (const piece of pieces) {
      if (piece.kind === 'line') {
        out.push(k.create_line_segment(_apply(m, o, s, piece.a), _apply(m, o, s, piece.b)))
      } else {
        const P = piece.poles.map((q) => _apply(m, o, s, q))
        out.push(_canonicalCurve(P, piece.knots, piece.degree, null))
      }
    }
  } catch (e) {
    for (const c of out) k.ext.delete_curve(c)
    throw e
  }
  return out
}

/** The glyphs as one sketch: each glyph from its own loops, glyphs that overlap united. */
function _sketch(f: Font, placed: _Placed[], scale: number): Sketch {
  const items: { p: _Placed; g: _Glyph; polys: _Polygon[]; lo: [number, number]; hi: [number, number] }[] = []
  for (const p of placed) {
    const g = _glyph(f, p.glyph)
    if (g === null) continue
    const polys = g.loops.map((i) => _moved(g.polygons[i], p, scale))
    const lo: [number, number] = [Infinity, Infinity]
    const hi: [number, number] = [-Infinity, -Infinity]
    for (const q of polys) {
      for (const [x, y] of q) {
        lo[0] = Math.min(lo[0], x)
        lo[1] = Math.min(lo[1], y)
        hi[0] = Math.max(hi[0], x)
        hi[1] = Math.max(hi[1], y)
      }
    }
    items.push({ p, g, polys, lo, hi })
  }
  const group = items.map((_, i) => i) // union-find over glyphs that overlap
  const root = (i: number): number => {
    while (group[i] !== i) {
      group[i] = group[group[i]]
      i = group[i]
    }
    return i
  }
  for (const [i, j] of regions.overlappingBoxes(
    items.map((it) => it.lo),
    items.map((it) => it.hi),
  )) {
    if (_overlap(items[i].polys, items[j].polys)) group[root(j)] = root(i)
  }
  const hint = "the font's outlines for this glyph could not be built"
  const pieces = new Map<number, Sketch>()
  items.forEach(({ p, g }, i) => {
    const sk = regions.build(g.plan, (c: number) => _curves(g.pieces[c], p.matrix, p.offset, scale), Plane.XY, 'Text', hint)
    const r = root(i)
    const held = pieces.get(r)
    pieces.set(r, held === undefined ? sk : held.fuse(sk))
  })
  return regions.unionDisjoint([...pieces.values()], Plane.XY, 'Text')
}

function _moved(poly: _Polygon, p: _Placed, scale: number): _Polygon {
  const [a, b, c, d] = p.matrix
  return poly.map(([px, py]) => {
    const x = px * scale
    const y = py * scale
    return [a * x + b * y + p.offset[0], c * x + d * y + p.offset[1]]
  })
}

/** Whether the regions of two glyphs (their outline polygons) overlap. */
function _overlap(a: _Polygon[], b: _Polygon[]): boolean {
  for (const pa of a) for (const pb of b) if (regions.polygonsCross(pa, pb)) return true
  const inside = (point: [number, number], polys: _Polygon[]) => {
    let hits = 0
    for (const q of polys) if (regions.pointInPolygon([point], q)[0]) hits++
    return hits % 2 === 1
  }
  return inside(b[0][0], a) || inside(a[0][0], b)
}

// =============================================================================
// Python's arithmetic where JavaScript's differs (knots and areas come out bit for bit as
// smlibpy's)
// =============================================================================
/** Python's sum() of floats: Neumaier's compensated summation (Python 3.12 and later). */
export function _sum(values: Iterable<number>): number {
  let total = 0
  let c = 0.0
  let first = true
  for (const x of values) {
    if (first) {
      total = 0 + x // (the sum starts as the integer 0)
      first = false
      continue
    }
    const t = total + x
    if (Math.abs(total) >= Math.abs(x)) c += total - t + x
    else c += x - t + total
    total = t
  }
  if (c && Number.isFinite(c)) total += c
  return total
}

const _bits = new DataView(new ArrayBuffer(8))

/** The exponent of frexp(x) for a finite x > 0: x = m * 2**e with 0.5 <= m < 1. */
function _frexpExponent(x: number): number {
  _bits.setFloat64(0, x)
  const e = (_bits.getUint32(0) >>> 20) & 0x7ff
  if (e === 0) return _frexpExponent(x * 2 ** 64) - 64 // subnormal
  return e - 1022
}

/** 2**e exactly, for an integer e from -1074 to 1023. */
function _pow2(e: number): number {
  if (e >= -1022) {
    _bits.setUint32(0, (e + 1023) << 20)
    _bits.setUint32(4, 0)
  } else {
    const bit = e + 1074 // in the subnormal mantissa
    _bits.setUint32(0, bit >= 32 ? 2 ** (bit - 32) : 0)
    _bits.setUint32(4, bit >= 32 ? 0 : 2 ** bit)
  }
  return _bits.getFloat64(0)
}

/** x * y as an unevaluated sum hi + lo, exactly (Dekker; Python's dl_mul with fma). */
function _dlMul(x: number, y: number): [number, number] {
  const z = x * y
  const sx = 134217729.0 * x // Veltkamp: 2**27 + 1
  const xh = sx - (sx - x)
  const xl = x - xh
  const sy = 134217729.0 * y
  const yh = sy - (sy - y)
  const yl = y - yh
  return [z, xh * yh - z + xh * yl + xl * yh + xl * yl]
}

/** Python's math.hypot of two numbers (its vector_norm: correctly rounded in nearly all cases;
 * JavaScript's Math.hypot can differ in the last bit). */
export function _hypot(a: number, b: number): number {
  const v = [Math.abs(a), Math.abs(b)]
  let max = 0.0
  let nan = false
  for (const x of v) {
    if (Number.isNaN(x)) nan = true
    if (x > max) max = x
  }
  if (max === Infinity) return max
  if (nan) return Number.NaN
  if (max === 0.0) return max
  const maxE = _frexpExponent(max)
  if (maxE < -1023) {
    const DBL_MIN = 2.2250738585072014e-308 // subnormals to normals
    return DBL_MIN * _hypot(v[0] / DBL_MIN, v[1] / DBL_MIN)
  }
  const scale = _pow2(-maxE)
  let csum = 1.0
  let frac1 = 0.0
  let frac2 = 0.0
  for (let x of v) {
    x *= scale // lossless scaling
    const [hi, lo] = _dlMul(x, x) // lossless squaring
    const sum = csum + hi // lossless addition
    const sumLo = hi - (sum - csum)
    csum = sum
    frac1 += lo // lossy addition
    frac2 += sumLo // lossy addition
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2))
  const [hi, lo] = _dlMul(-h, h)
  const sum = csum + hi
  const sumLo = hi - (sum - csum)
  csum = sum
  frac1 += lo
  frac2 += sumLo
  const x = csum - 1.0 + (frac1 + frac2)
  h += x / (2.0 * h) // differential correction
  return h / scale
}

/** Python's sorted(set(chars)): distinct characters by code point. */
function _sortedSet(chars: string[]): string[] {
  return [...new Set(chars)].sort((a, b) => (a.codePointAt(0) as number) - (b.codePointAt(0) as number))
}

function _hex4(c: string): string {
  return (c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')
}

/** A value as Python's repr shows it, for messages. */
function _reprValue(v: unknown): string {
  if (typeof v === 'string') return _repr(v)
  if (typeof v === 'number') return Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : String(v)
  return String(v)
}
