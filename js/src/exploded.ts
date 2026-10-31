// Exploded views of assemblies: each part moved by its offset, the assembly axes between the
// places where the parts touch, numbered balloons and a parts list, drawn in software like
// `render`.
//
// The axes are found, not given: two parts that touch in the assembled model and move by
// different offsets get an axis from where they touch, moved with the one, to the same place
// moved with the other. Where they touch is the centroid of their contact area, measured on the
// tessellated faces with the kernel's point classification. (Python: exploded.py.)

import { _opts, scope } from './kernel.ts'
import { Vector, type VectorLike, _formatG } from './geometry.ts'
import { toRgb } from './colors.ts'
import { Part, _typeName } from './shapes.ts'
import {
  _Camera,
  _Canvas,
  _EDGE,
  _MAX_CANVAS,
  type _Options,
  _Scene,
  _Triangles,
  _WHITE,
  _depthFill,
  _facing,
  _fit,
  _png,
  _rint,
  _screenLines,
  _textWidth,
  _toBytes,
  _vec3,
  _view,
  type Frame,
  Picture,
  type RenderView,
} from './pictures.ts'

// biome-ignore lint: shapes and options of any kind
type Any = any
type Vec3 = [number, number, number]
type RGB = readonly [number, number, number]
type Seg = [number, number, number, number]

const inspect = Symbol.for('nodejs.util.inspect.custom')

const _AXIS_INK: RGB = [85 / 255, 89 / 255, 94 / 255]
const _BALLOON_INK: RGB = [31 / 255, 78 / 255, 121 / 255]
const _QUANTITY_INK: RGB = [100 / 255, 100 / 255, 100 / 255]

/**
 * Where two parts of an assembly touch, and the axis an exploded view draws there (see
 * `assemblyAxes`).
 *
 * - `first`: the index of the one part in the list given.
 * - `second`: the index of the other part (larger than `first`).
 * - `contact`: the centroid of the area where the two parts touch, in the assembled model.
 * - `area`: that area, in square millimeters (0 where the parts touch only along a line or at a
 *   point; `contact` is then a point where they touch).
 * - `start`: `contact` moved by the first part's offset.
 * - `end`: `contact` moved by the second part's offset.
 */
export class AssemblyAxis {
  readonly first: number
  readonly second: number
  readonly contact: Vector
  readonly area: number
  readonly start: Vector
  readonly end: Vector

  constructor(first: number, second: number, contact: Vector, area: number, start: Vector, end: Vector) {
    this.first = first
    this.second = second
    this.contact = contact
    this.area = area
    this.start = start
    this.end = end
  }

  toString(): string {
    return `AssemblyAxis(first=${this.first}, second=${this.second}, contact=${this.contact}, area=${this.area}, start=${this.start}, end=${this.end})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** How far each part moves out: a list of vectors in the order of the parts, or a mapping from
 * part names (a plain object or a Map) or from the parts themselves (a Map) to vectors. */
export type ExplodedOffsets = readonly VectorLike[] | ReadonlyMap<string | Part, VectorLike> | Readonly<Record<string, VectorLike>>

/** The options of `assemblyAxes`. */
export interface AssemblyAxesOptions {
  /** The gap, in millimeters, under which two surfaces count as touching (0.01). */
  tolerance?: number
}

/** The options of `renderExploded`. */
export interface RenderExplodedOptions {
  /** Also write the PNG to this file (Node). */
  path?: string | null
  /** The camera, as for `render`. */
  view?: RenderView
  /** Width and height of the whole picture in pixels, the parts list included. */
  size?: readonly [number, number]
  /** The names in the order they are numbered; every name of the parts once. */
  order?: readonly string[] | null
  /** Draw the assembly axes. */
  axes?: boolean
  /** Draw the balloons and the parts list. */
  balloons?: boolean
  /** Background color. */
  background?: Any
  /** Factor on the scale that fits the moved parts into the space left by the balloons. */
  zoom?: number
  /** As for `render` (1 to 4). */
  supersample?: number
  /** The gap under which two surfaces touch (see `assemblyAxes`). */
  tolerance?: number
}

/**
 * The assembly axes of an exploded view: one for every two parts that touch in the assembled
 * model and move by different offsets.
 *
 * Parts touch where their surfaces come within `tolerance` of each other, or where one reaches
 * into the other. The axis runs from the centroid of the contact area moved by the first part's
 * offset to the same point moved by the second's: the way the two parts come together. Parts that
 * move by the same offset get no axis.
 *
 * - `parts`: the parts, assembled (in their places in the finished model).
 * - `offsets`: how far each part moves out: a list of vectors in the order of the parts, or a
 *   mapping from part names (`Part.named`) or from the parts themselves to vectors. Parts a
 *   mapping leaves out stay where they are.
 * - `tolerance`: the gap, in millimeters, under which two surfaces count as touching.
 *
 * @returns The axes as `AssemblyAxis` values, ordered by `first`, then `second`.
 * @throws TypeError An item is not a part.
 * @throws RangeError Fewer than two parts, an offset list of another length than the parts, a
 *   mapping that names a part that is not there, or a part that touches no other one (an exploded
 *   view starts from the assembled model: move it into place).
 */
export function assemblyAxes(parts: Iterable<Part> | Part, offsets: ExplodedOffsets, options: AssemblyAxesOptions = {}): AssemblyAxis[] {
  _opts('assemblyAxes', options)
  const { tolerance = 0.01 } = options ?? {}
  const [plist, offs] = _inputs(parts, offsets, 'assemblyAxes')
  const tol = _tolerance(tolerance, 'assemblyAxes')
  return scope(() => _axes(plist, offs, tol, 'assemblyAxes'))
}

/**
 * An exploded view of an assembly: each part moved by its offset and rendered as `render` does,
 * the assembly axes dashed, a numbered balloon on each part that shows and a parts list beside
 * the picture.
 *
 * The axes are those of `assemblyAxes`, drawn over the parts; axes on one line that overlap are
 * drawn as one. A balloon points at a pixel near the middle of what shows of its part (a part
 * hidden behind others gets none, and keeps its row in the list). The balloons stand in two
 * columns left and right of the parts, in the order of their targets, swapped while that makes the
 * leaders cross less or run shorter. Parts of the same name share a number; the list gives each
 * name once, with how many parts have it. Text is in the library's own capitals, as in the other
 * pictures.
 *
 * - `parts`: the parts, assembled. Their names are the rows of the list; an unnamed part is
 *   `"part <n>"`.
 * - `offsets`: as for `assemblyAxes`.
 * - options: `path`, `view` (as for `render`), `size` (the whole picture), `order` (the names in
 *   the order they are numbered, every name once; by default the order in which they first come),
 *   `axes`, `balloons` (and the parts list), `background`, `zoom`, `supersample`, `tolerance`.
 *
 * @returns A `Picture`, as `render` gives: the PNG's bytes, `pixels` and `frame` (the frame of the
 *   moved parts' view, the balloons and the list drawn over it).
 * @throws TypeError An item is not a part.
 * @throws RangeError The checks of `assemblyAxes`; an `order` that misses a name of the parts,
 *   names one twice or names one that is not there; balloons that do not fit in the picture's
 *   height (give a larger size).
 */
export function renderExploded(parts: Iterable<Part> | Part, offsets: ExplodedOffsets, options: RenderExplodedOptions = {}): Picture {
  _opts('renderExploded', options)
  const {
    path = null,
    view = 'iso',
    size = [1200, 800],
    order = null,
    axes = true,
    balloons = true,
    background = 'white',
    zoom = 1.0,
    supersample = 2,
    tolerance = 0.01,
  } = options ?? {}
  const [plist, offs] = _inputs(parts, offsets, 'renderExploded')
  const tol = _tolerance(tolerance, 'renderExploded')
  const w = Math.trunc(Number(size[0]))
  const h = Math.trunc(Number(size[1]))
  if (!(w >= 1 && h >= 1)) throw new RangeError(`renderExploded: size must be positive, got [${size}]`)
  let k = Math.trunc(Number(supersample))
  if (!(1 <= k && k <= 4)) throw new RangeError(`renderExploded: supersample must be 1 to 4, got ${supersample}`)
  if (!(Number(zoom) > 0)) throw new RangeError(`renderExploded: zoom must be positive, got ${zoom}`)
  k = Math.max(1, Math.min(k, Math.trunc(Math.sqrt(_MAX_CANVAS / (w * h)))))
  const names = plist.map((p, i) => p.name || `part ${i + 1}`)
  const rows = _rows(names, order)
  const number = new Map(rows.map(([name], n) => [name, n + 1]))

  const bg = toRgb(background)
  const pixels = scope(() => {
    const moved = plist.map((p, i) => p.translate(offs[i]))
    const cam = _Camera.of(view)
    const scene = new _Scene(moved, null, 'native')
    try {
      const lay = new _Layout(w, h, balloons ? rows : [])
      const frame = _fit(scene, cam, Math.max(lay.viewW - 2 * lay.column, 1), h, Number(zoom))
      frame.midX += (w - lay.viewW) / 2 / frame.scale // the parts in the middle of the space left of the list
      const opts: _Options = {
        k,
        bg,
        edges: true,
        lines: false,
        xray: false,
        alpha: 0.42,
        section: null,
        markers: [],
        annotate: false,
        zebra: null,
        curvature: null,
        legend: true,
      }
      const img = _view(scene, cam, w, h, opts, frame)
      const cv = new _Canvas(w, h, k, cam, frame, bg)
      _upsample(img, cv)
      if (axes) {
        const found = _axes(plist, offs, tol, 'renderExploded')
        const segs = found.map((a) => [..._pixel(cv, a.start), ..._pixel(cv, a.end)] as Seg)
        _dashed(cv, _distinct(segs, 4.0 * lay.u), _AXIS_INK, lay)
      }
      if (balloons) {
        const owners = _owners(scene, cam, w, h, frame)
        const targets = _targets(owners, w, h, plist.length, lay.u)
        let x0 = Infinity
        let x1 = -Infinity
        for (let p = 0; p < owners.length; p++) {
          if (owners[p] < 0) continue
          const x = p % w
          if (x < x0) x0 = x
          if (x > x1) x1 = x
        }
        const silhouette: [number, number] = x0 <= x1 ? [x0, x1] : [lay.viewW / 2, lay.viewW / 2]
        const items: _Item[] = []
        targets.forEach((t, i) => {
          if (t !== null) items.push([t, number.get(names[i]) as number])
        })
        _drawBalloons(cv, _place(items, silhouette, lay), lay)
        _drawList(cv, rows, lay)
      }
      return { pixels: _toBytes(cv.finish()), frame }
    } finally {
      scene.dispose()
    }
  })
  const pic = new Picture(_png(pixels.pixels, w, h), { pixels: pixels.pixels, width: w, height: h }, { ...pixels.frame })
  if (path != null) pic.save(path)
  return pic
}

// -------------------------------------------------------------------------------- inputs
function _isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype
}

function _inputs(parts: unknown, offsets: unknown, fn: string): [Part[], Vec3[]] {
  const plist: unknown[] = parts instanceof Part ? [parts] : [...(parts as Iterable<unknown>)]
  for (const p of plist) if (!(p instanceof Part)) throw new TypeError(`${fn} takes parts, not a ${_typeName(p)}`)
  const ps = plist as Part[]
  if (ps.length < 2) throw new RangeError(`${fn}: an exploded view needs two parts or more, got ${ps.length}`)
  if (offsets instanceof Map || _isPlainObject(offsets)) {
    const offs: Vec3[] = ps.map(() => [0, 0, 0])
    const names = ps.map((p) => p.name)
    const entries: [unknown, unknown][] = offsets instanceof Map ? [...offsets.entries()] : Object.entries(offsets)
    for (const [key, value] of entries) {
      let hit: number[]
      if (typeof key === 'string') {
        hit = names.flatMap((n, i) => (n === key ? [i] : []))
        if (!hit.length) {
          const known = [...new Set(names.filter((n) => n).map((n) => `'${n}'`))].sort().join(', ') || 'none'
          throw new RangeError(`${fn}: no part is named '${key}'; the names are ${known}`)
        }
      } else {
        hit = ps.flatMap((p, i) => (p === key ? [i] : []))
        if (!hit.length) {
          throw new RangeError(
            `${fn}: an offset is given for a ${_typeName(key)} that is not one of the parts; key the mapping by the parts given, or by their names`,
          )
        }
      }
      for (const i of hit) offs[i] = _vec3(value)
    }
    return [ps, offs]
  }
  if (typeof offsets === 'string' || offsets == null || typeof (offsets as Any)[Symbol.iterator] !== 'function') {
    throw new TypeError(`${fn}: offsets are a list of vectors, one per part, or a mapping from names or parts to vectors, not a ${_typeName(offsets)}`)
  }
  const items = [...(offsets as Iterable<unknown>)]
  if (items.length !== ps.length) {
    throw new RangeError(`${fn}: ${items.length} offsets for ${ps.length} parts; give one per part, in their order, or a mapping by name`)
  }
  return [ps, items.map((v) => _vec3(v))]
}

function _tolerance(tolerance: number, fn: string): number {
  const tol = Number(tolerance)
  if (!(Number.isFinite(tol) && tol > 0)) throw new RangeError(`${fn}: the tolerance must be positive, got ${tolerance}`)
  return tol
}

const _quoted = (names: readonly string[]): string => names.map((n) => `'${n}'`).join(', ')

/** The parts list: [name, how many parts have it], numbered in this order. */
function _rows(names: string[], order: readonly string[] | null): [string, number][] {
  const count = new Map<string, number>()
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1)
  if (order == null) return [...count.entries()]
  if (typeof order === 'string') throw new TypeError('renderExploded: order is a list of names, not one string')
  const wanted = [...order].map(String)
  const unknown = wanted.filter((n) => !count.has(n))
  if (unknown.length) throw new RangeError(`renderExploded: order names ${_quoted(unknown)}, which no part has; the names are ${_quoted([...count.keys()])}`)
  const twice = [...new Set(wanted.filter((n) => wanted.indexOf(n) !== wanted.lastIndexOf(n)))].sort()
  if (twice.length) throw new RangeError(`renderExploded: order names ${_quoted(twice)} more than once`)
  const missing = [...count.keys()].filter((n) => !wanted.includes(n))
  if (missing.length) throw new RangeError(`renderExploded: order leaves out ${_quoted(missing)}; give every name once`)
  return wanted.map((n) => [n, count.get(n) as number])
}

// -------------------------------------------------------------------------------- contacts and axes
type _Box = [Vec3, Vec3]

function _axes(parts: Part[], offs: Vec3[], tol: number, fn: string): AssemblyAxis[] {
  const boxes = parts.map(_box)
  const touched = parts.map(() => false)
  const out: AssemblyAxis[] = []
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const contact = _contact(parts[i], parts[j], boxes[i], boxes[j], tol)
      if (contact === null) continue
      touched[i] = touched[j] = true
      if (Math.hypot(offs[i][0] - offs[j][0], offs[i][1] - offs[j][1], offs[i][2] - offs[j][2]) <= 1e-9) continue
      const [c, area] = contact
      out.push(
        new AssemblyAxis(
          i,
          j,
          new Vector(c[0], c[1], c[2]),
          area,
          new Vector(c[0] + offs[i][0], c[1] + offs[i][1], c[2] + offs[i][2]),
          new Vector(c[0] + offs[j][0], c[1] + offs[j][1], c[2] + offs[j][2]),
        ),
      )
    }
  }
  const alone = touched.flatMap((t, i) => (t ? [] : [i]))
  if (alone.length) {
    const said = alone.map((i) => (parts[i].name ? `${i} ('${parts[i].name}')` : String(i))).join(', ')
    throw new RangeError(
      `${fn}: part ${said} touches no other part within ${_formatG(tol)} mm; the parts are given assembled and moved by the offsets: put it in its place, or raise the tolerance`,
    )
  }
  return out
}

function _box(part: Any): _Box {
  const b = part.bbox()
  return [b.min.toArray(), b.max.toArray()]
}

/** Where two parts touch: the centroid of the contact area and the area, or null. */
function _contact(a: Part, b: Part, boxA: _Box, boxB: _Box, tol: number): [Vec3, number] | null {
  const lo: Vec3 = [0, 1, 2].map((c) => Math.max(boxA[0][c], boxB[0][c]) - tol) as Vec3
  const hi: Vec3 = [0, 1, 2].map((c) => Math.min(boxA[1][c], boxB[1][c]) + tol) as Vec3
  if (lo.some((v, c) => v > hi[c]) || a.distanceTo(b) > tol) return null
  let best: [Vec3, number] | null = null
  for (const [p, q] of [
    [a, b],
    [b, a],
  ]) {
    const found = _touching(p, q, lo, hi, tol)
    if (found !== null && (best === null || found[1] > best[1])) best = found
  }
  if (best === null) return [a.closestPoints(b).point.toArray(), 0.0] // along a line or at a point
  return best
}

/** The area of p's surface that lies on or in q, and its centroid: the triangles of p's faces (in
 * the box where the two meet) whose corners q classifies as on or inside it. */
function _touching(p: Part, q: Part, lo: Vec3, hi: Vec3, tol: number): [Vec3, number] | null {
  const span = [0, 1, 2].map((c) => hi[c] - lo[c])
  const spanMax = Math.max(...span)
  const big = span.filter((s) => s > 4 * tol).sort((x, y) => x - y)
  const sizes = big.length ? big : [spanMax]
  const edge = Math.max(sizes[0] / 8, 10 * tol)
  const chord = Math.max(tol / 4, spanMax / 4000)
  const tris: number[] = []
  for (const face of p.faces()) {
    const fb = face.bbox()
    const fLo = fb.min.toArray()
    const fHi = fb.max.toArray()
    if ([0, 1, 2].some((c) => fLo[c] > hi[c] || fHi[c] < lo[c])) continue
    // fine where the face is about the size of the contact, at most some 3600 triangles on a large one
    const diag = Math.hypot(fHi[0] - fLo[0], fHi[1] - fLo[1], fHi[2] - fLo[2])
    const m = face.mesh(chord, 15, { maxEdge: Math.max(edge, diag / 60) })
    try {
      const nt = m.triangles.length / 3
      if (!nt) continue
      const v = m.vertices
      const nv = v.length / 3
      const on = new Uint8Array(nv)
      const idx: number[] = []
      for (let i = 0; i < nv; i++) {
        let inside = true
        for (let c = 0; c < 3; c++) if (!(v[i * 3 + c] >= lo[c] && v[i * 3 + c] <= hi[c])) inside = false
        if (inside) idx.push(i)
      }
      if (idx.length) {
        const where = q._classify(
          idx.map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]] as Vec3),
          tol,
        )
        idx.forEach((i, n) => {
          on[i] = where[n][0] !== 'outside' ? 1 : 0
        })
      }
      const t = m.triangles
      for (let i = 0; i < nt; i++) {
        if (!(on[t[i * 3]] && on[t[i * 3 + 1]] && on[t[i * 3 + 2]])) continue
        for (let c = 0; c < 3; c++) {
          const at = t[i * 3 + c] * 3
          tris.push(v[at], v[at + 1], v[at + 2])
        }
      }
    } finally {
      m.dispose()
    }
  }
  if (!tris.length) return null
  let total = 0
  const sum: Vec3 = [0, 0, 0]
  for (let i = 0; i < tris.length; i += 9) {
    const u = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]]
    const w = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]]
    const area = 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
    total += area
    for (let c = 0; c < 3; c++) sum[c] += (area * (tris[i + c] + tris[i + 3 + c] + tris[i + 6 + c])) / 3
  }
  if (!(total > 0)) return null
  return [[sum[0] / total, sum[1] / total, sum[2] / total], total]
}

// -------------------------------------------------------------------------------- drawing
/** Sizes in output pixels: the font scale, the balloons, the parts list at the right. */
class _Layout {
  readonly w: number
  readonly h: number
  readonly u: number
  readonly s: number
  readonly r: number
  readonly column: number
  readonly rowH: number
  readonly listW: number
  readonly viewW: number

  constructor(w: number, h: number, rows: [string, number][]) {
    this.w = w
    this.h = h
    this.u = Math.max(1, _rint(Math.min(w, h) / 600))
    const s = this.u + 1 // the font scale
    this.s = s
    const widest = Math.max(0, ...rows.map((_, n) => _textWidth(String(n + 1), s)))
    this.r = Math.max(7 * s, widest / 2 + 3 * s) // balloon radius
    this.column = rows.length ? 2 * this.r + 10 * s : 0 // kept free beside the parts for the balloons
    this.rowH = 2 * this.r + 3 * s
    if (rows.length) {
      const names = Math.max(...rows.map(([n]) => _textWidth(n.toUpperCase(), s)))
      const counts = Math.max(...rows.map(([, c]) => _textWidth(`×${c}`, s)))
      this.listW = Math.trunc(2 * this.r + 4 * s + names + 10 * s + counts + 8 * s)
    } else this.listW = 0
    this.viewW = w - this.listW
  }
}

/** The output image, k x k times, as the canvas to draw over (finish() averages it back). */
function _upsample(img: { data: ArrayLike<number>; width: number; height: number }, cv: _Canvas): void {
  const { k, W } = cv
  const d = img.data
  for (let y = 0; y < cv.H; y++) {
    const sy = Math.trunc(y / k)
    for (let x = 0; x < W; x++) {
      const from = (sy * img.width + Math.trunc(x / k)) * 3
      const to = (y * W + x) * 3
      cv.img[to] = d[from]
      cv.img[to + 1] = d[from + 1]
      cv.img[to + 2] = d[from + 2]
    }
  }
}

function _pixel(cv: _Canvas, p: Vector): [number, number] {
  const [x, y] = cv.screenPoint(p.toArray())
  return [x / cv.k, y / cv.k]
}

/** The segments without those shorter than `tol`; segments on one line (within `tol`) that
 * overlap or meet become one, so that their dashes do not run into each other. */
function _distinct(segs: Seg[], tol: number): Seg[] {
  const kept: Seg[] = []
  for (let s of segs) {
    if (Math.hypot(s[2] - s[0], s[3] - s[1]) < tol) continue
    let merged = true
    while (merged) {
      merged = false
      for (let n = 0; n < kept.length; n++) {
        const joined = _joined(kept[n], s, tol)
        if (joined !== null) {
          s = joined
          kept.splice(n, 1)
          merged = true
          break
        }
      }
    }
    kept.push(s)
  }
  return kept
}

/** The two segments as one when they lie on one line and overlap or meet, else null. */
function _joined(a: Seg, b: Seg, tol: number): Seg | null {
  const length = Math.hypot(a[2] - a[0], a[3] - a[1])
  const dx = (a[2] - a[0]) / length
  const dy = (a[3] - a[1]) / length
  const off = [
    [b[0], b[1]],
    [b[2], b[3]],
  ].map(([x, y]) => Math.abs((x - a[0]) * dy - (y - a[1]) * dx))
  if (Math.max(...off) > tol) return null
  const tb = [(b[0] - a[0]) * dx + (b[1] - a[1]) * dy, (b[2] - a[0]) * dx + (b[3] - a[1]) * dy].sort((x, y) => x - y)
  if (tb[0] > length + tol || tb[1] < -tol) return null
  const lo = Math.min(0.0, tb[0])
  const hi = Math.max(length, tb[1])
  return [a[0] + dx * lo, a[1] + dy * lo, a[0] + dx * hi, a[1] + dy * hi]
}

function _dashed(cv: _Canvas, segs: Seg[], color: RGB, lay: _Layout): void {
  const dash = 8.0 * lay.u
  const gap = 6.0 * lay.u
  const k = cv.k
  const pieces: Seg[] = []
  for (const [x0, y0, x1, y1] of segs) {
    const length = Math.hypot(x1 - x0, y1 - y0)
    let t = 0.0
    while (t < length) {
      const e = Math.min(t + dash, length)
      pieces.push([
        k * (x0 + ((x1 - x0) * t) / length),
        k * (y0 + ((y1 - y0) * t) / length),
        k * (x0 + ((x1 - x0) * e) / length),
        k * (y0 + ((y1 - y0) * e) / length),
      ])
      t = e + gap
    }
  }
  _screenLines(cv, pieces, color, 0.6 * lay.u * k)
}

/** Per pixel the index of the part seen there, -1 for the background. */
function _owners(scene: _Scene, cam: _Camera, w: number, h: number, frame: Frame): Int32Array {
  const tris: number[] = []
  const norms: number[] = []
  const owner: number[] = []
  scene.bodies.forEach((body, b) => {
    const facing = body.closed ? _facing(body.tris, cam.back as Vec3) : null
    const n = body.tris.length / 9
    for (let t = 0; t < n; t++) {
      if (facing !== null && !(facing[t] >= 0)) continue
      for (let i = 0; i < 9; i++) {
        tris.push(body.tris[t * 9 + i])
        norms.push(body.norms[t * 9 + i])
      }
      owner.push(scene.owners[b])
    }
  })
  const cv = new _Canvas(w, h, 1, cam, frame, [0, 0, 0])
  const out = new Int32Array(w * h).fill(-1)
  if (!owner.length) return out
  const [sx, sy, sz] = cv.screen(Float64Array.from(tris))
  const nt = owner.length
  const tri = new _Triangles(sx, sy, sz, Float64Array.from(norms), null, new Float64Array(nt * 3), new Float64Array(nt).fill(1), cam)
  const tbuf = _depthFill(cv, tri)
  for (let p = 0; p < out.length; p++) if (tbuf[p] >= 0) out[p] = owner[tbuf[p]]
  return out
}

/** Per part a pixel well inside what shows of it, near its middle; null when too little shows. */
function _targets(owners: Int32Array, w: number, h: number, n: number, u: number): ([number, number] | null)[] {
  const out: ([number, number] | null)[] = []
  const m = 2 * u
  for (let i = 0; i < n; i++) {
    const is = (x: number, y: number) => owners[y * w + x] === i
    const xs: number[] = []
    const ys: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!is(x, y)) continue
        if (y >= m && !is(x, y - m)) continue
        if (y < h - m && !is(x, y + m)) continue
        if (x >= m && !is(x - m, y)) continue
        if (x < w - m && !is(x + m, y)) continue
        xs.push(x)
        ys.push(y)
      }
    }
    if (xs.length < 12 * u * u) {
      out.push(null)
      continue
    }
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length
    let j = 0
    let best = Infinity
    for (let t = 0; t < xs.length; t++) {
      const d = (xs[t] - cx) ** 2 + (ys[t] - cy) ** 2
      if (d < best) {
        best = d
        j = t
      }
    }
    out.push([xs[j] + 0.5, ys[j] + 0.5])
  }
  return out
}

type _Pt = [number, number]
type _Item = [_Pt, number]
type _Placed = [_Pt, number, number, number]

/** Whether two segments cross (their ends excluded). */
function _crosses(s: [_Pt, _Pt], t: [_Pt, _Pt]): boolean {
  const [p1, p2] = s
  const [p3, p4] = t
  const orient = (a: _Pt, b: _Pt, c: _Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = orient(p3, p4, p1)
  const d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3)
  const d4 = orient(p1, p2, p4)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** The balloons: [target, number, x, y], in a column left and one right of the parts, spread so
 * that none overlaps another and leaders cross as little as can be had by swapping. */
function _place(items: _Item[], silhouette: [number, number], lay: _Layout): _Placed[] {
  const [x0, x1] = silhouette
  const mid = (x0 + x1) / 2
  const r = lay.r
  const pitch = lay.rowH
  const top = r + 2 * lay.s
  const bottom = lay.h - r - 2 * lay.s
  const room = Math.floor((bottom - top) / pitch) + 1
  type Entry = [_Pt, number, number]
  const sides = new Map<number, Entry[]>([
    [-1, []],
    [1, []],
  ])
  for (const [target, n] of [...items].sort((a, b) => a[0][0] - b[0][0])) {
    ;(sides.get(target[0] > mid ? 1 : -1) as Entry[]).push([target, n, target[1]])
  }
  for (const [a, b] of [
    [-1, 1],
    [1, -1],
  ]) {
    // a column that is too long gives its innermost balloons to the other
    const ca = sides.get(a) as Entry[]
    const cb = sides.get(b) as Entry[]
    while (ca.length > room && cb.length < room) {
      ca.sort((p, q) => p[0][0] - q[0][0])
      cb.push(a < 0 ? (ca.pop() as Entry) : (ca.shift() as Entry))
    }
  }
  if ((sides.get(-1) as Entry[]).length > room || (sides.get(1) as Entry[]).length > room) {
    throw new RangeError(`renderExploded: ${items.length} balloons do not fit beside the parts in a picture ${lay.h} pixels high; give a larger size`)
  }
  const placed: _Placed[] = []
  for (const [side, col] of sides) {
    if (!col.length) continue
    col.sort((p, q) => p[2] - q[2])
    for (let i = 0; i < col.length; i++) col[i][2] = Math.max(col[i][2], i === 0 ? top : col[i - 1][2] + pitch) // push down
    for (let i = col.length - 1; i >= 0; i--) col[i][2] = Math.min(col[i][2], i === col.length - 1 ? bottom : col[i + 1][2] - pitch) // and up again
    let bx = side < 0 ? x0 - r - 5 * lay.s : x1 + r + 5 * lay.s
    bx = Math.min(Math.max(bx, r + 2.0), lay.viewW - r - 2.0)
    const slots = col.map((it) => it[2])
    const cost = (order: number[]): number => {
      const legs = order.map((i, k) => [[bx, slots[k]], col[i][0]] as [_Pt, _Pt])
      let n = 0
      for (let j = 0; j < legs.length; j++) for (let l = j + 1; l < legs.length; l++) if (_crosses(legs[j], legs[l])) n++
      return n * 1e6 + legs.reduce((sum, [p, q]) => sum + Math.hypot(q[0] - p[0], q[1] - p[1]), 0)
    }
    let order = col.map((_, i) => i)
    let best = cost(order)
    let improved = true
    while (improved) {
      // swap two balloons while the leaders cross less, or run shorter
      improved = false
      for (let a = 0; a < order.length; a++) {
        for (let b = a + 1; b < order.length; b++) {
          const trial = [...order]
          ;[trial[a], trial[b]] = [trial[b], trial[a]]
          const c = cost(trial)
          if (c < best - 1e-6) {
            order = trial
            best = c
            improved = true
          }
        }
      }
    }
    order.forEach((i, k) => {
      placed.push([col[i][0], col[i][1], bx, slots[k]])
    })
  }
  return placed
}

/** A filled disc, in output pixels. */
function _fillDisc(cv: _Canvas, x: number, y: number, radius: number, color: RGB): void {
  const k = cv.k
  const cx = x * k
  const cy = y * k
  const rr = radius * k
  const x0 = Math.max(Math.trunc(cx - rr - 1), 0)
  const x1 = Math.min(Math.trunc(cx + rr + 2), cv.W)
  const y0 = Math.max(Math.trunc(cy - rr - 1), 0)
  const y1 = Math.min(Math.trunc(cy + rr + 2), cv.H)
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= rr * rr) cv.img.set(color, (py * cv.W + px) * 3)
    }
  }
}

function _balloon(cv: _Canvas, x: number, y: number, n: number, lay: _Layout): void {
  _fillDisc(cv, x, y, lay.r, _BALLOON_INK)
  _fillDisc(cv, x, y, lay.r - 0.6 * lay.s, _WHITE)
  cv.text(x, y - 3.5 * lay.s, String(n), _BALLOON_INK, lay.s, 'middle')
}

function _drawBalloons(cv: _Canvas, placed: _Placed[], lay: _Layout): void {
  const k = cv.k
  for (const [[tx, ty], , bx, by] of placed) {
    const d = Math.hypot(tx - bx, ty - by) || 1.0
    const sx = bx + ((tx - bx) / d) * lay.r
    const sy = by + ((ty - by) / d) * lay.r
    _screenLines(cv, [[sx * k, sy * k, tx * k, ty * k]], _BALLOON_INK, 0.4 * lay.u * k)
    _fillDisc(cv, tx, ty, 1.5 * lay.u + 1, _BALLOON_INK)
  }
  for (const [, n, bx, by] of placed) _balloon(cv, bx, by, n, lay)
}

function _drawList(cv: _Canvas, rows: [string, number][], lay: _Layout): void {
  const { s, r } = lay
  const x = lay.viewW + 2 * s
  let y = (lay.h - lay.rowH * rows.length) / 2 + lay.rowH / 2
  const right = lay.w - 6 * s
  rows.forEach(([name, count], n) => {
    _balloon(cv, x + r, y, n + 1, lay)
    cv.text(x + 2 * r + 4 * s, y - 3.5 * s, name, _EDGE, s)
    const quantity = `×${count}`
    cv.text(right - _textWidth(quantity, s), y - 3.5 * s, quantity, _QUANTITY_INK, s)
    y += lay.rowH
  })
}
