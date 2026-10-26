// The pen: draw an outline segment by segment.
//
// A `Profile` draws one outline in the XY plane with lines and arcs, moving like a pen: to a
// point, by an offset, forward along its heading, with tangent arcs, and with the corners it passes
// rounded or beveled. `close()` turns the outline into a Sketch, `wire()` gives the open path as a
// Wire. Every call returns a new Profile, so one drawing can branch into variants.

import { ModelingError, _opts } from './kernel.ts'
import {
  Arc2,
  type Complex,
  Corner,
  GeometryError,
  J,
  Line2,
  TAU,
  assemble,
  cis,
  cross,
  cx,
  degrees,
  dot,
  extent,
  firstCrossing,
  fmt,
  fmtPt,
  pymod,
  radians,
  reflect,
  runsBack,
  signedArea,
  simplify,
  unit,
  type Seg,
} from './_planar.ts'
import { type AlignLike, alignmentOffset } from './align.ts'
import { Axis, Plane, Vector, _vec, type VectorLike } from './geometry.ts'
import { Sketch, Wire, _typeName } from './shapes.ts'
import { Frame, build, edgesOf } from './_regions.ts'
import { _withOptions } from './curves.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

function _num(v: unknown): v is number {
  return typeof v === 'number'
}

function _pt2(v: unknown, what: string): Complex {
  const p = _vec(v as VectorLike)
  if (Math.abs(p.z) > 1e-9 * Math.max(1.0, Math.abs(p.x), Math.abs(p.y))) {
    throw new RangeError(
      `${what}: the pen draws in the XY plane, so the point needs z = 0 (got z = ${fmt(p.z)}); place the finished sketch with .on(plane)`,
    )
  }
  return cx(p.x, p.y)
}

function _normDeg(a: number): number {
  let d = pymod(degrees(a), 360.0)
  if (d > 180.0 + 1e-12) d -= 360.0
  return Math.abs(d) < 1e-12 ? 0.0 : d
}

function _isOptions(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
}

/** The coordinate a line or a forward move goes to: `{ x }`, `{ y }` or both. */
export interface Coordinates {
  x?: number | null
  y?: number | null
}

/**
 * A pen that draws an outline in the XY plane, segment by segment.
 *
 * Start it at a point with a heading (degrees counterclockwise from +X), then move:
 *
 *     const section = new Profile([0, 0])
 *       .lineTo(12, 0).lineTo({ y: 4 }).fillet(1.5)
 *       .lineTo({ x: 6 }).lineTo({ y: 20 }).chamfer(1)
 *       .lineTo({ x: 0 })
 *       .close()                  // a Sketch: extrude or revolve it
 *
 * Moves: `lineTo` (to a point, or to an x or y), `lineBy` (by an offset), `forward` (along the
 * heading, or until x or y reaches a value), `arc` (tangent, by radius and angle; a positive angle
 * turns left), `arcTo` (tangent to an end point, or through a point). `turn`/`turnTo` change the
 * heading without drawing. `fillet` and `chamfer` round or bevel the corner at the pen, between the
 * segment before and the segment after. `mirror(axis)` adds the mirror image of the path drawn so
 * far. `close()` makes the region, `wire()` the open path.
 *
 * Each call returns a new Profile; `point` and `heading` tell where the pen is. Errors name the
 * segment (the call that drew it) and the numbers that do not fit.
 */
export class Profile {
  _start!: Complex
  _segs!: readonly Seg[]
  _labels!: readonly string[]
  _corners!: readonly (readonly [number, Corner])[]
  _heading!: number

  /** `new Profile(start = [0, 0], { heading })`; the start may be left out:
   * `new Profile({ heading: 90 })`. */
  constructor(start: VectorLike | { heading?: number } = [0, 0], options: { heading?: number } = {}) {
    if (!guarded) _guardShapeMembers()
    if (_isOptions(start)) {
      options = start as { heading?: number }
      start = [0, 0]
    }
    _opts('Profile', options)
    const { heading = 0.0 } = options
    this._start = _pt2(start, 'Profile')
    this._segs = []
    this._labels = []
    this._corners = []
    this._heading = radians(Number(heading))
  }

  // -- state --------------------------------------------------------------------------------
  _new(
    changes: {
      segs?: readonly Seg[]
      labels?: readonly string[]
      corners?: readonly (readonly [number, Corner])[]
      heading?: number
    } = {},
  ): Profile {
    const p = Object.create(Profile.prototype) as Profile
    p._start = this._start
    p._segs = changes.segs ?? this._segs
    p._labels = changes.labels ?? this._labels
    p._corners = changes.corners ?? this._corners
    p._heading = changes.heading ?? this._heading
    return p
  }

  get _cur(): Complex {
    return this._segs.length ? this._segs[this._segs.length - 1].end : this._start
  }

  /** Where the pen is. */
  get point(): Vector {
    const c = this._cur
    return new Vector(c.re, c.im, 0.0)
  }

  /** Where the drawing started. */
  get start(): Vector {
    return new Vector(this._start.re, this._start.im, 0.0)
  }

  /** The direction the pen moves in, degrees counterclockwise from +X (-180 to 180). */
  get heading(): number {
    return _normDeg(this._heading)
  }

  /** The number of segments drawn (Python's `len(profile)`). */
  get length(): number {
    return this._segs.length
  }

  _scale(...pts: Complex[]): number {
    return Math.max(1.0, this._start.abs(), this._cur.abs(), ...pts.map((p) => p.abs()))
  }

  _add(seg: Seg, call: string): Profile {
    if (seg.length <= 1e-12 * this._scale(seg.start, seg.end)) {
      throw new RangeError(`${call}: the segment has no length (the pen is already at ${fmtPt(this._cur)})`)
    }
    const label = `segment ${this._segs.length + 1}, ${call}`
    return this._new({ segs: [...this._segs, seg], labels: [...this._labels, label], heading: seg.t1.phase() })
  }

  // -- lines --------------------------------------------------------------------------------
  /** A straight line to a point: `lineTo(30, 5)` or `lineTo([30, 5])`; or to a coordinate, keeping
   * the other one: `lineTo({ x: 30 })` (horizontal), `lineTo({ y: 5 })` (vertical). */
  lineTo(...args: (number | VectorLike | Coordinates)[]): Profile {
    const { items: point, options } = _withOptions<Coordinates>(args)
    _opts('Profile.lineTo', options)
    const x = options.x ?? null
    const y = options.y ?? null
    const cur = this._cur
    let target: Complex
    let call: string
    if (point.length) {
      if (x !== null || y !== null) throw new TypeError('lineTo: give a point, or { x: ... } and/or { y: ... }, not both')
      target = Profile._point(point, 'lineTo')
      call = `lineTo(${fmt(target.re)}, ${fmt(target.im)})`
    } else {
      if (x === null && y === null) {
        throw new TypeError('lineTo: give a point, lineTo(x, y), or one coordinate, lineTo({ x: ... }) or lineTo({ y: ... })')
      }
      target = cx(x === null ? cur.re : Number(x), y === null ? cur.im : Number(y))
      const parts: string[] = []
      if (x !== null) parts.push(`x: ${fmt(x)}`)
      if (y !== null) parts.push(`y: ${fmt(y)}`)
      call = `lineTo({ ${parts.join(', ')} })`
    }
    return this._add(new Line2(cur, target), call)
  }

  static _point(args: readonly unknown[], what: string): Complex {
    if (args.length === 2 && args.every(_num)) return cx(Number(args[0]), Number(args[1]))
    if (args.length === 1 && !_num(args[0])) return _pt2(args[0], what)
    throw new TypeError(
      `${what}: give the point as ${what}(x, y) or ${what}([x, y])` +
        (what === 'lineTo' ? `; for a line to one coordinate use ${what}({ x: ... }) or ${what}({ y: ... })` : ''),
    )
  }

  /** A straight line by an offset from the pen: `lineBy(10, -5)` or `lineBy([10, -5])`. */
  lineBy(dx: number | VectorLike = 0.0, dy = 0.0): Profile {
    const d = !_num(dx) ? _pt2(dx, 'lineBy') : cx(Number(dx), Number(dy))
    return this._add(new Line2(this._cur, this._cur.add(d)), `lineBy(${fmt(d.re)}, ${fmt(d.im)})`)
  }

  /** A straight line along the heading: `length` long (`forward(20)`), or until x reaches a value
   * (`forward({ x: 30 })`, or y: `forward({ y: 5 })`). */
  forward(length: number | null | Coordinates = null, options: Coordinates = {}): Profile {
    if (_isOptions(length)) {
      options = length as Coordinates
      length = null
    }
    _opts('Profile.forward', options)
    const len = length as number | null
    const x = options.x ?? null
    const y = options.y ?? null
    const given = [len, x, y].filter((v) => v !== null && v !== undefined).length
    if (given !== 1) throw new TypeError('forward: give exactly one of length, { x: ... } or { y: ... }')
    const cur = this._cur
    const t = cis(this._heading)
    const h = fmt(this.heading)
    if (len !== null && len !== undefined) {
      if (!(len > 0)) throw new RangeError(`forward: the length must be positive (got ${fmt(len)}); turn(180) to go back`)
      return this._add(new Line2(cur, cur.add(t.scale(Number(len)))), `forward(${fmt(len)})`)
    }
    const [name, value, comp, now] = x !== null ? (['x', x, t.re, cur.re] as const) : (['y', y as number, t.im, cur.im] as const)
    const call = `forward({ ${name}: ${fmt(value)} })`
    if (Math.abs(comp) < 1e-12) {
      throw new ModelingError(
        `${call}: the heading ${h} degrees runs parallel to the ${name === 'x' ? 'Y' : 'X'} axis, so ${name} never changes; turn first, or use lineTo({ ${name}: ... })`,
      )
    }
    const s = (Number(value) - now) / comp
    if (s <= 1e-12 * this._scale()) {
      throw new ModelingError(
        `${call}: ${name} = ${fmt(value)} lies behind the pen (it is at ${name} = ${fmt(now)}, heading ${h} degrees); turn first, or use lineTo`,
      )
    }
    return this._add(new Line2(cur, cur.add(t.scale(s))), call)
  }

  /** Turn the heading by `angle` degrees (positive: left) without drawing; the next segment starts
   * at a corner. */
  turn(angle: number): Profile {
    return this._new({ heading: this._heading + radians(Number(angle)) })
  }

  /** Set the heading (degrees counterclockwise from +X) without drawing. */
  turnTo(heading: number): Profile {
    return this._new({ heading: radians(Number(heading)) })
  }

  // -- arcs ---------------------------------------------------------------------------------
  /** A tangent arc of `radius` that turns the heading by `angle` degrees: positive turns left
   * (counterclockwise), negative right. `arc(5, 180)` is a U-turn. */
  arc(radius: number, angle: number): Profile {
    const call = `arc(${fmt(radius)}, ${fmt(angle)})`
    if (!(radius > 0)) throw new RangeError(`${call}: the radius must be positive; the sign of the angle sets the direction`)
    if (angle === 0 || Math.abs(angle) > 360) throw new RangeError(`${call}: the angle must be between -360 and 360 and not 0`)
    const cur = this._cur
    const t = cis(this._heading)
    const side = angle > 0 ? 1.0 : -1.0
    const c = cur.add(J.mul(t).scale(side).scale(Number(radius)))
    return this._add(new Arc2(c, Number(radius), cur.sub(c).phase(), radians(Number(angle))), call)
  }

  /** An arc to an end point: tangent to the heading (`arcTo(20, 10)`), or through a point
   * (`arcTo(20, 10, { through: [15, 12] })`, which need not be tangent). */
  arcTo(...args: (number | VectorLike | { through?: VectorLike | null })[]): Profile {
    const { items: point, options } = _withOptions<{ through?: VectorLike | null }>(args)
    _opts('Profile.arcTo', options)
    const through = options.through ?? null
    const end = Profile._point(point, 'arcTo')
    const cur = this._cur
    let call: string
    let c: Complex
    let side: number
    if (through === null) {
      call = `arcTo(${fmt(end.re)}, ${fmt(end.im)})`
      const d = end.sub(cur)
      if (d.abs() <= 1e-12 * this._scale(end)) throw new RangeError(`${call}: the end point is where the pen is`)
      const t = cis(this._heading)
      const cr = cross(t, d)
      const h = fmt(this.heading)
      if (Math.abs(cr) <= 1e-12 * d.abs()) {
        if (dot(t, d) > 0) {
          throw new ModelingError(
            `${call}: the point lies straight ahead on the heading ${h} degrees, so the tangent arc would be a straight line; use lineTo, or arcTo(..., { through: ... })`,
          )
        }
        throw new ModelingError(
          `${call}: the point lies straight behind the pen (heading ${h} degrees); no arc that leaves along the heading reaches it. turn first, or give { through: ... }`,
        )
      }
      const ad = d.abs()
      const s = (ad * ad) / (2.0 * cr) // signed distance from the pen to the center, to the left
      c = cur.add(J.mul(t).scale(s))
      side = s > 0 ? 1.0 : -1.0
    } else {
      const m = _pt2(through, 'arcTo')
      call = `arcTo(${fmt(end.re)}, ${fmt(end.im)}, { through: [${fmt(m.re)}, ${fmt(m.im)}] })`
      const den = 2.0 * cross(m.sub(cur), end.sub(cur))
      if (Math.abs(den) <= 1e-12 * Math.max(1.0, m.sub(cur).abs() * end.sub(cur).abs())) {
        throw new ModelingError(
          `${call}: the pen, the through point and the end lie on one line (or two of them coincide), so there is no arc; use lineTo`,
        )
      }
      const hab = m.sub(cur).abs()
      const hac = end.sub(cur).abs()
      const ab = hab * hab
      const ac = hac * hac
      c = cur.add(
        cx(end.sub(cur).im * ab - m.sub(cur).im * ac, m.sub(cur).re * ac - end.sub(cur).re * ab).divs(den),
      )
      side = cross(m.sub(cur), end.sub(m)) > 0 ? 1.0 : -1.0
    }
    const a0 = cur.sub(c).phase()
    let delta = end.sub(c).div(cur.sub(c)).phase()
    if (side > 0 && delta <= 0) delta += TAU
    if (side < 0 && delta >= 0) delta -= TAU
    return this._add(new Arc2(c, cur.sub(c).abs(), a0, delta), call)
  }

  // -- corners ------------------------------------------------------------------------------
  _corner(c: Corner): Profile {
    const k = this._segs.length
    for (const [i, other] of this._corners) {
      if (i === k) throw new RangeError(`${c.label}: the corner at ${fmtPt(this._cur)} already has ${other.label}`)
    }
    return this._new({ corners: [...this._corners, [k, c]] })
  }

  /** Round the corner at the pen with a tangent arc of `radius`: the corner between the segment
   * just drawn and the next one (at the start point: between the closing segment and the first
   * one). */
  fillet(radius: number): Profile {
    if (!(radius > 0)) throw new RangeError(`fillet(${fmt(radius)}): the radius must be positive`)
    return this._corner(new Corner('fillet', Number(radius), `fillet(${fmt(radius)})`))
  }

  /** Bevel the corner at the pen: cut back `length` along the segment before and the segment after
   * (measured along them) and join the two points with a line. */
  chamfer(length: number): Profile {
    if (!(length > 0)) throw new RangeError(`chamfer(${fmt(length)}): the length must be positive`)
    return this._corner(new Corner('chamfer', Number(length), `chamfer(${fmt(length)})`))
  }

  // -- symmetry -----------------------------------------------------------------------------
  /**
   * Continue with the mirror image of the path drawn so far, so that the whole outline is
   * symmetric about `axis` (an axis in the XY plane: `X`, `Y` or `new Axis([x, y], direction)`).
   * Draw half the outline from the axis back to the axis; an end that is off the axis is joined
   * straight across to its mirror image. Corners rounded on the half are rounded on the mirrored
   * half too.
   */
  mirror(axis: Axis): Profile {
    if (!(axis instanceof Axis)) {
      throw new TypeError(
        `mirror: give the mirror axis as an Axis, e.g. mirror(Y) or mirror(new Axis([0, 5], [1, 0])), not a ${_typeName(axis)}`,
      )
    }
    const d = axis.direction
    const o = axis.origin
    if (Math.abs(d.z) > 1e-9 || Math.abs(o.z) > 1e-9) throw new RangeError('mirror: the axis must lie in the XY plane')
    if (!this._segs.length) throw new RangeError('mirror: nothing is drawn yet; draw half of the outline first')
    const u = unit(cx(d.x, d.y))
    const oc = cx(o.x, o.y)
    const u2 = u.mul(u)
    const cur = this._cur
    const scale = 1e-9 * extent(this._segs)
    if (cur.sub(this._start).abs() <= scale) {
      throw new ModelingError('mirror: the outline is already closed; mirror draws the other half of an open half outline')
    }
    const onAxis = (p: Complex) => Math.abs(cross(u, p.sub(oc))) <= Math.max(scale, 1e-9)
    for (const [seg, which] of [
      [this._segs[this._segs.length - 1], 'last'],
      [this._segs[0], 'first'],
    ] as const) {
      if (seg instanceof Line2 && onAxis(seg.a) && onAxis(seg.b)) {
        throw new ModelingError(
          `mirror: the ${which} segment runs along the mirror axis; draw the half outline from where it meets the axis to where it meets it again`,
        )
      }
    }
    const segs = [...this._segs]
    const labels = [...this._labels]
    const n = segs.length
    const newSegs: Seg[] = []
    const newLabels: string[] = []
    const joined = !onAxis(cur)
    if (joined) {
      newSegs.push(new Line2(cur, reflect(cur, oc, u2)))
      newLabels.push(`segment ${n + 1}, the line across the mirror axis from ${fmtPt(cur)}`)
    }
    for (let i = n - 1; i >= 0; i--) {
      newSegs.push(segs[i].reflected(oc, u2).reversed())
      const lab = labels[i]
      const at = lab.indexOf(', ')
      newLabels.push(`segment ${n + newSegs.length}, the mirror image of ${at >= 0 ? lab.slice(at + 2) : lab}`)
    }
    const j = joined ? 1 : 0
    const corners: (readonly [number, Corner])[] = [...this._corners]
    for (const [k, c] of this._corners) {
      const mk = 2 * n + j - k
      if (mk === k || (k === 0 && onAxis(this._start))) continue
      corners.push([mk, c])
    }
    return this._new({
      segs: [...segs, ...newSegs],
      labels: [...labels, ...newLabels],
      corners,
      heading: newSegs[newSegs.length - 1].t1.phase(),
    })
  }

  // -- results ------------------------------------------------------------------------------
  _resolve(closed: boolean): Seg[] {
    const segs = [...this._segs]
    const labels = [...this._labels]
    if (!segs.length) throw new RangeError(`${closed ? 'close' : 'wire'}: nothing is drawn yet`)
    const tol = 1e-9 * extent([...segs, new Line2(this._start, this._start)])
    const cornerMap = new Map<number, Corner>()
    const n = segs.length
    if (closed) {
      if (this._cur.sub(this._start).abs() > Math.max(tol * 1e3, 1e-9)) {
        segs.push(new Line2(this._cur, this._start))
        labels.push(`segment ${n + 1}, the closing line to ${fmtPt(this._start)}`)
      } else if (segs[segs.length - 1] instanceof Line2) {
        segs[segs.length - 1] = new Line2((segs[segs.length - 1] as Line2).a, this._start) // snap the last point onto the start
      }
      const total = segs.length
      for (const [k, c] of this._corners) {
        const idx = k % total
        if (cornerMap.has(idx)) {
          throw new RangeError(`${c.label} and ${cornerMap.get(idx)!.label} are both at the start corner ${fmtPt(this._start)}; keep one`)
        }
        cornerMap.set(idx, c)
      }
      if (total === 1 && !(segs[0] instanceof Arc2 && segs[0].closed)) throw new ModelingError('close: a single segment encloses no area')
    } else {
      for (const [k, c] of this._corners) {
        if (k === 0 || k === n) {
          throw new ModelingError(
            `${c.label} at ${fmtPt(k === 0 ? this._start : this._cur)}: the ${k === 0 ? 'start' : 'end'} of an open path is not a corner; close() the outline, or leave it out`,
          )
        }
        cornerMap.set(k, c)
      }
    }
    let out: Seg[]
    let labs: string[]
    try {
      ;[out, labs] = assemble(segs, labels, cornerMap, closed, tol, (i) => labels[i])
    } catch (e) {
      if (!(e instanceof GeometryError)) throw e
      throw new ModelingError(`Profile: ${e.message}`)
    }
    ;[out, labs] = simplify(out, labs, closed, tol)
    if (closed) {
      const hit = firstCrossing(out, true, tol)
      if (hit !== null) {
        const [i, j, p] = hit
        if (out.length === 2 && runsBack(out, i, j, tol)) {
          throw new ModelingError('Profile: the outline encloses no area (it runs straight back to the start); draw at least two sides before close()')
        }
        if (runsBack(out, i, j, tol)) {
          throw new ModelingError(
            `Profile: the outline runs back over itself at ${fmtPt(p)}: ${labs[i]} and ${labs[j]} overlap; change the moves so that the outline does not double back`,
          )
        }
        throw new ModelingError(
          `Profile: the outline crosses or touches itself at ${fmtPt(p)}: ${labs[i]} meets ${labs[j]}; change the moves so that the outline does not cross itself`,
        )
      }
      const area = signedArea(out)
      if (Math.abs(area) <= tol * extent(out)) throw new ModelingError('Profile: the outline encloses no area')
      if (area < 0) out = out.map((s) => s.reversed()).reverse()
    }
    return out
  }

  /** The region inside the outline, as a Sketch on XY: a straight line goes back to the start if
   * the pen is not there. `align` moves the result (null, the default, leaves the outline where it
   * was drawn). */
  close(options: { align?: AlignLike } = {}): Sketch {
    _opts('Profile.close', options)
    const align = options.align ?? null
    const loop = this._resolve(true)
    let s = build([[loop, []]], new Frame(Plane.XY), null, 'Profile')
    if (align !== null) {
      const off = alignmentOffset(s.bbox(), align, 2)
      if (off.length) s = s.translate(off)
    }
    return s
  }

  /** The path as drawn, as an open Wire of exact lines and arcs (a sweep path, or a centerline for
   * Stroke). */
  wire(): Wire {
    return Wire._raw(edgesOf(this._resolve(false), new Frame(Plane.XY)))
  }

  toString(): string {
    const c = this._cur
    return `Profile(${this._segs.length} segments, at (${fmt(c.re)}, ${fmt(c.im)}), heading ${fmt(this.heading)})`
  }

  [inspect](): string {
    return this.toString()
  }
}

// Python's Profile answers any other attribute with an error that says what to do: a Profile is a
// drawing, not a shape. Here the members of Sketch and Wire that a Profile lacks throw that error
// (installed with the first Profile, once shapes.ts is loaded).
let guarded = false

function _guardShapeMembers(): void {
  guarded = true
  const names = new Set<string>()
  for (const cls of [Sketch, Wire]) {
    for (let proto = cls.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name)
    }
  }
  for (const name of names) {
    if (name.startsWith('_') || name === 'constructor' || name === 'equals' || name in Profile.prototype) continue
    Object.defineProperty(Profile.prototype, name, {
      configurable: true,
      get() {
        throw new TypeError(
          `'Profile' object has no attribute '${name}': a Profile is a drawing in progress. Call .close() for the region (a Sketch) or .wire() for the open path, and use .${name} on that`,
        )
      },
    })
  }
}
