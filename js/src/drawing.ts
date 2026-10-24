// 2D drawings of parts: views with visible and hidden lines, as DXF or SVG.
//
// A view is what `Part.outline` gives with `hidden: true` (the lines seen from one side, and the
// ones behind the part), laid out in the drawing's plane (world XY) next to the other views, as
// projections are arranged on a sheet: first-angle (ISO, Europe: the view from above goes below
// the front view, the view from the left to its right) or third-angle (ASME, America: the view
// from above goes above it, the view from the left to its left).

import { _opts, ext, kernelCall, scope } from './kernel.ts'
import { BoundBox, Location, Plane, Vector } from './geometry.ts'
import { Edge, Face, Part, Shell, ShapeList, Wire, _Body, _list, _typeName } from './shapes.ts'
import { _edgePoints, _entity, _samplesFor } from './dxf.ts'
import { _fs } from './exporters.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

/**
 * One view of a drawing (see `drawingViews`): its `name` (`'front'`, `'back'`, `'top'`,
 * `'bottom'`, `'left'` or `'right'`), the `direction` it looks from (from the part towards the
 * viewer), and its `visible` and `hidden` lines (drawn dashed): standalone edges in the drawing's
 * plane (world XY).
 */
export class DrawingView {
  readonly name: string
  readonly direction: Vector
  readonly visible: ShapeList<Edge>
  readonly hidden: ShapeList<Edge>

  constructor(name: string, direction: Vector, visible: ShapeList<Edge>, hidden: ShapeList<Edge>) {
    this.name = name
    this.direction = direction
    this.visible = visible
    this.hidden = hidden
  }

  /** The box around the view's lines. */
  bbox(): BoundBox {
    return _list([...this.visible, ...this.hidden]).bbox()
  }

  toString(): string {
    return `DrawingView(name='${this.name}', ${this.visible.length} visible, ${this.hidden.length} hidden)`
  }

  [inspect](): string {
    return this.toString()
  }
}

type V3 = [number, number, number]

// name -> [direction towards the viewer, the drawing's x in the model, its y in the model]
const _VIEWS: Record<string, [V3, V3, V3]> = {
  front: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  back: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  top: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  bottom: [[0, 0, -1], [1, 0, 0], [0, -1, 0]],
  left: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  right: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
}

// where each view goes next to the front view: [column, row], for first-angle projection; the
// third-angle projection swaps the sides (the back view stays at the far right)
const _PLACES: Record<string, [number, number]> = { front: [0, 0], top: [0, -1], bottom: [0, 1], left: [1, 0], right: [-1, 0], back: [2, 0] }

/** How `drawingViews` draws: see there. */
export interface DrawingViewsOptions {
  projection?: string
  hidden?: boolean
  tangentEdges?: boolean
  gap?: number | null
}

/**
 * The views of a part for a 2D drawing, laid out in the world XY plane.
 *
 * - `part`: a part (or a shell), or a list of them (an assembly): drawn together, each body hiding
 *   the lines of the others behind it (bodies that overlap are not cut where they meet).
 * - `views`: the views, by where they look from: `'front'` (from -Y; the drawing's x is the model's
 *   X, its y the model's Z), `'back'` (from +Y), `'top'` (from +Z: X and Y), `'bottom'` (from -Z),
 *   `'left'` (from -X: -Y and Z) and `'right'` (from +X: Y and Z).
 * - `projection`: `'first-angle'` (ISO: the top view below the front view, the left view to its
 *   right) or `'third-angle'` (ASME: the top view above it, the left view to its left). The back
 *   view goes at the far right.
 * - `hidden`: draw the hidden lines (`DrawingView.hidden`, dashed in DXF and SVG); `false` leaves
 *   them empty.
 * - `tangentEdges`: draw the edges between faces that meet tangentially (fillet tangent lines).
 * - `gap`: space between the views. Default: a fifth of the part's largest extent.
 *
 * The views of the front row share its height (the model's Z), the views of its column the front
 * view's x (the model's X). Write them with `exportDxf`/`toDxf` (layers VISIBLE and HIDDEN, the
 * hidden lines dashed) or `exportSvg`/`toSvg`.
 */
export function drawingViews(part: Part | Shell | Iterable<Part | Shell>, views: string | readonly string[] = ['front', 'top', 'left'], options: DrawingViewsOptions = {}): DrawingView[] {
  _opts('drawingViews', options)
  if (part instanceof _Body) return _drawingViews(part, views, options)
  // several bodies side by side in one (the kernel's hidden lines see them all)
  const bodies = [...(part as Iterable<unknown>)]
  for (const b of bodies) if (!(b instanceof _Body)) throw new TypeError(`drawingViews draws parts and shells, not a ${_typeName(b)}`)
  if (!bodies.length) throw new RangeError('drawingViews: nothing to draw')
  if (bodies.length === 1) return _drawingViews(bodies[0] as _Body, views, options)
  const all = kernelCall('drawingViews', () => Shell._wrap(ext.combine(bodies.map((b) => (b as _Body)._brep))))
  try {
    return _drawingViews(all, views, options)
  } finally {
    all.dispose()
  }
}

function _drawingViews(part: _Body, views: string | readonly string[], options: DrawingViewsOptions): DrawingView[] {
  const { projection = 'first-angle', hidden = true, tangentEdges = false } = options
  let gap = options.gap ?? null
  if (projection !== 'first-angle' && projection !== 'third-angle') {
    throw new RangeError(`drawingViews: projection must be 'first-angle' or 'third-angle', not '${projection}'`)
  }
  const names = typeof views === 'string' ? [views] : [...views]
  if (!names.length) throw new RangeError('drawingViews: name at least one view')
  for (const n of names) if (!(n in _VIEWS)) throw new RangeError(`drawingViews: unknown view '${n}'; use ${Object.keys(_VIEWS).join(', ')}`)
  if (new Set(names).size !== names.length) throw new RangeError('drawingViews: every view once')
  const size = part.bbox().size
  if (gap === null) gap = 0.2 * Math.max(size.x, size.y, size.z, 1e-9)
  if (!(gap >= 0)) throw new RangeError('drawingViews: gap must not be negative')
  const flip = projection === 'third-angle' ? -1 : 1
  // (in a scope: the outlines at the model's coordinates are freed once the views are moved apart,
  // kernel plan W9)
  return scope(() => {
    // the views in the drawing's plane, at the model's coordinates
    const raw = new Map<string, [ShapeList<Edge>, ShapeList<Edge>]>()
    for (const n of names) {
      const [d, x] = _VIEWS[n]
      const plane = new Plane([0, 0, 0], x, d)
      let seen: ShapeList<Edge>
      let behind: ShapeList<Edge>
      if (hidden) [seen, behind] = part.outline(plane, { hidden: true, tangentEdges })
      else [seen, behind] = [part.outline(plane, { tangentEdges }), new ShapeList<Edge>()]
      const toXy = plane.location.inverse()
      raw.set(n, [seen.moved(toXy), behind.moved(toXy)])
    }
    const boxes = new Map<string, BoundBox | null>()
    for (const n of names) {
      const [a, b] = raw.get(n)!
      boxes.set(n, a.length + b.length ? _list([...a, ...b]).bbox() : null)
    }
    // the front view stays where it is; the others move beside it, along the row or the column
    const front = boxes.get('front') ?? _boxOf(part, 'front')
    let rowExtent = [front.min.x, front.max.x]
    const out: DrawingView[] = []
    const nearFirst = [...names].sort((p, q) => Math.abs(_PLACES[p][0]) - Math.abs(_PLACES[q][0]) || Math.abs(_PLACES[p][1]) - Math.abs(_PLACES[q][1]))
    for (const n of nearFirst) {
      let [col, row] = _PLACES[n]
      if (n !== 'back') {
        col *= flip
        row *= flip
      }
      const b = boxes.get(n) ?? _boxOf(part, n)
      let dx = 0
      let dy = 0
      if (col > 0) dx = rowExtent[1] + gap - b.min.x
      else if (col < 0) dx = rowExtent[0] - gap - b.max.x
      if (row > 0) dy = front.max.y + gap - b.min.y
      else if (row < 0) dy = front.min.y - gap - b.max.y
      if (col !== 0) rowExtent = [Math.min(rowExtent[0], b.min.x + dx), Math.max(rowExtent[1], b.max.x + dx)]
      const place = new Location([dx, dy, 0])
      const [seen, behind] = raw.get(n)!
      out.push(new DrawingView(n, new Vector(_VIEWS[n][0]), seen.moved(place), behind.moved(place)))
    }
    return names.map((n) => out.find((v) => v.name === n)!)
  })
}

/** The box of a view of the part's bounding box (for a view without lines). */
function _boxOf(part: _Body, name: string): BoundBox {
  const b = part.bbox()
  const [, x, y] = _VIEWS[name]
  const us: number[] = []
  const vs: number[] = []
  for (const px of [b.min.x, b.max.x]) for (const py of [b.min.y, b.max.y]) for (const pz of [b.min.z, b.max.z]) {
    us.push(px * x[0] + py * x[1] + pz * x[2])
    vs.push(px * y[0] + py * y[1] + pz * y[2])
  }
  return new BoundBox([Math.min(...us), Math.min(...vs), 0], [Math.max(...us), Math.max(...vs), 0])
}

// ------------------------------------------------------------------------------------------ SVG
/** What `toSvg` and `exportSvg` draw: drawing views, edges, wires, faces, sheets and sketches, or
 * lists of them (a Part is drawn through `drawingViews` or `outline`). */
export type SvgItemsLike = DrawingView | Edge | Wire | Face | Shell | readonly SvgItemsLike[]

/** [kind, edge] for each edge to draw: `'visible'` or `'hidden'`. */
function _lines(shapes: unknown): ['visible' | 'hidden', Edge][] {
  const out: ['visible' | 'hidden', Edge][] = []
  const add = (s: unknown): void => {
    if (s instanceof Part) throw new TypeError('exportSvg draws 2D shapes, not a Part; draw drawingViews(part) or the edges of part.outline(plane)')
    if (s instanceof DrawingView) {
      for (const e of s.visible) out.push(['visible', e])
      for (const e of s.hidden) out.push(['hidden', e])
    } else if (s instanceof Edge) out.push(['visible', s])
    else if (s instanceof Wire || s instanceof Face || s instanceof _Body) for (const e of s.edges()) out.push(['visible', e])
    else if (Array.isArray(s)) for (const t of s) add(t)
    else throw new TypeError(`exportSvg cannot draw a ${_typeName(s)}`)
  }
  add(shapes)
  return out
}

/** Python's "{:.6f}" without trailing zeros. */
function _num(v: number): string {
  let s = v.toFixed(6)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' || s === '' ? '0' : s
}

/** SVG path data of an edge in the XY plane (y up in the model, down in the SVG): lines and
 * circular arcs exactly (as the DXF writer finds them), other curves as polylines; and the points
 * it runs through (for the drawing's box). */
function _path(e: Edge): [string, number[][]] {
  const pt = (p: ArrayLike<number>) => `${_num(p[0])} ${_num(-p[1])}`
  const ent = _entity(e, (p) => [p[0], p[1]], [0, 0, 1], 1)
  const d = ent.data
  if (ent.kind === 'LINE') return [`M${pt(d.a)} L${pt(d.b)}`, [d.a, d.b]]
  if (ent.kind === 'CIRCLE' || ent.kind === 'ARC') {
    const [cx, cy] = d.c
    const r: number = d.r
    const box = [[cx - r, cy - r], [cx + r, cy + r]]
    if (ent.kind === 'CIRCLE') {
      // (two halves: an SVG arc cannot close on itself)
      const a = [cx + r, cy]
      const b = [cx - r, cy]
      return [`M${pt(a)} A${_num(r)} ${_num(r)} 0 1 0 ${pt(b)} A${_num(r)} ${_num(r)} 0 1 0 ${pt(a)}`, box]
    }
    const a0 = (d.a0 * Math.PI) / 180
    const a1 = (d.a1 * Math.PI) / 180
    const a = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]
    const b = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)]
    const large = (((d.a1 - d.a0) % 360) + 360) % 360 > 180 ? 1 : 0
    // (counterclockwise in the model: the SVG's negative direction, its y running down)
    return [`M${pt(a)} A${_num(r)} ${_num(r)} 0 ${large} 0 ${pt(b)}`, box]
  }
  const p = _edgePoints(e, Math.max(_samplesFor(e), 32))
  return [`M${p.map((q) => pt(q)).join(' L')}`, p.map((q) => [q[0], q[1]])]
}

/** How `toSvg` draws: the space around the lines and the width of the visible lines. */
export interface SvgOptions {
  margin?: number | null
  stroke?: number | null
}

/**
 * An SVG drawing of drawing views (dashed hidden lines), edges, wires and the edges of faces and
 * sketches, seen from +Z (their x and y; the SVG's y runs down). Lines and circular arcs are exact,
 * other curves polylines. Lengths are in millimeters: the drawing prints at its true size.
 *
 * - `shapes`: `DrawingView`, `Edge`, `Wire`, `Face`, `Sketch` or an array of them.
 * - `margin`: space around the lines. Default: 5 % of the drawing's size.
 * - `stroke`: width of the visible lines (the hidden ones are 0.7 of it, dashed). Default: 0.35 mm,
 *   or 1/500 of the drawing's size where that is smaller.
 */
export function toSvg(shapes: SvgItemsLike, options: SvgOptions = {}): string {
  _opts('toSvg', options)
  const lines = _lines(shapes)
  if (!lines.length) throw new RangeError('exportSvg: nothing to draw')
  const paths = lines.map(([kind, e]) => [kind, ..._path(e)] as const)
  const lo = [Infinity, Infinity]
  const hi = [-Infinity, -Infinity]
  for (const [, , pts] of paths) {
    for (const p of pts) {
      for (let j = 0; j < 2; j++) {
        lo[j] = Math.min(lo[j], p[j])
        hi[j] = Math.max(hi[j], p[j])
      }
    }
  }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-9)
  const margin = options.margin ?? 0.05 * extent
  const stroke = options.stroke ?? Math.min(0.35, extent / 500)
  if (!(margin >= 0 && stroke > 0)) throw new RangeError('exportSvg: margin must not be negative, stroke must be positive')
  const x0 = lo[0] - margin
  const y0 = -(hi[1] + margin)
  const w = hi[0] - lo[0] + 2 * margin
  const h = hi[1] - lo[1] + 2 * margin
  const dash = 6 * stroke
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${_num(w)}mm" height="${_num(h)}mm" viewBox="${_num(x0)} ${_num(y0)} ${_num(w)} ${_num(h)}">`,
    '<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">',
  ]
  for (const kind of ['hidden', 'visible']) {
    const ds = paths.filter(([k]) => k === kind).map(([, d]) => d)
    if (!ds.length) continue
    const style = kind === 'visible' ? `stroke-width="${_num(stroke)}"` : `stroke-width="${_num(0.7 * stroke)}" stroke-dasharray="${_num(dash)} ${_num(dash / 2)}"`
    out.push(`<path class="${kind}" ${style} d="${ds.join(' ')}"/>`)
  }
  out.push('</g>', '</svg>')
  return `${out.join('\n')}\n`
}

/** Write `toSvg` of the shapes to a file (Node). */
export function exportSvg(shapes: SvgItemsLike, path: string, options: SvgOptions = {}): void {
  _opts('exportSvg', options)
  _fs().writeFileSync(String(path), toSvg(shapes, options))
}
