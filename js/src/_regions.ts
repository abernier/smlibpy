// Sketch-level 2D operations on exact lines and arcs.
//
// A sketch's faces are read as loops of _planar.ts segments in the local coordinates of the sketch
// plane (outer loops counterclockwise, holes clockwise), changed there, and built again from exact
// kernel lines and circles. Splines and ellipses travel along as `Curve2` and are handed back
// unchanged.
//
// Also here: the operands of the 2D Booleans, rebuilt from their curves (the kernel's planar
// Boolean is unreliable on bodies that were moved, see ai/plan/2d.md).

import { KernelError, ModelingError, _isRuntimeError, ext, k, kernelCall } from './kernel.ts'
import { Axis, BoundBox, Location, Plane, Vector, _formatG, _isPointLike, _vec, type VectorLike } from './geometry.ts'
import { Line, _arcCurve } from './curves.ts'
import { Edge, Face, Part, Shape, ShapeList, Sketch, Vertex, Wire, _asPlane, _fitPlane, _typeName } from './shapes.ts'
import {
  Arc2,
  Complex,
  Corner,
  Curve2,
  GeometryError,
  J,
  Line2,
  NEG_J,
  NeedBooleans,
  ONE,
  SMOOTH,
  TAU,
  ZERO,
  _Site,
  _lineLine,
  assemble,
  bandPiece,
  convexHull,
  cornerPiece,
  cross,
  cx,
  degrees,
  describe,
  disk,
  distance,
  extent,
  firstCrossing,
  fmt,
  hullSites,
  isSmooth,
  offsetChain,
  orientCcw,
  overlap,
  polygon,
  pymod,
  pysum,
  segmentIntersections,
  signedArea,
  simplify,
  sweepPiece,
  turn,
  unit,
  type Piece,
  type Seg,
} from './_planar.ts'

// biome-ignore lint: kernel results are what their bindings return
type Any = any

/** Per face: the outer loop and the holes. */
export type Loops = [Seg[], Seg[][]][]

// =============================================================================== the frame of a sketch plane
/** A plane with the conversions between world points and local complex numbers. */
export class Frame {
  readonly plane: Plane

  constructor(plane: Plane) {
    this.plane = plane
  }

  local(v: VectorLike): Complex {
    const p = this.plane.toLocal(v)
    return cx(p.x, p.y)
  }

  height(v: VectorLike): number {
    return this.plane.toLocal(v).z
  }

  world(z: Complex): Vector {
    return this.plane.fromLocal([z.re, z.im, 0.0])
  }

  direction(v: Vector): Complex {
    return cx(v.dot(this.plane.xDir), v.dot(this.plane.yDir))
  }

  /** A local point as world coordinates, for messages. */
  fp(z: Complex): string {
    const w = this.world(z)
    if (Math.abs(w.z) < 1e-9) return `(${fmt(w.x)}, ${fmt(w.y)})`
    return `(${fmt(w.x)}, ${fmt(w.y)}, ${fmt(w.z)})`
  }
}

// =============================================================================== edges <-> segments
function _arcFrom(c: Complex, r: number, p0: Complex, p1: Complex, t0: Complex, closed: boolean): Arc2 {
  const sign = cross(p0.sub(c), t0) > 0 ? 1.0 : -1.0
  const a0 = p0.sub(c).phase()
  if (closed) return new Arc2(c, r, a0, sign * TAU)
  let delta = pymod(sign * (p1.sub(c).phase() - a0), TAU)
  if (delta < 1e-12) delta = TAU
  return new Arc2(c, r, a0, sign * delta)
}

function _circumcenter(a: Complex, b: Complex, c: Complex): Complex | null {
  const d = 2.0 * cross(b.sub(a), c.sub(a))
  if (Math.abs(d) < 1e-14 * Math.max(1.0, b.sub(a).abs() * c.sub(a).abs())) return null
  const hab = b.sub(a).abs()
  const hac = c.sub(a).abs()
  const ab = hab * hab
  const ac = hac * hac
  return a.add(cx(c.sub(a).im * ab - b.sub(a).im * ac, b.sub(a).re * ac - c.sub(a).re * ab).divs(d))
}

/** The edge as an exact line or arc in the frame, or as a `Curve2`. Straight and circular
 * B-spline edges (left by a mirror or an offset) become lines and arcs. */
export function segOfEdge(e: Edge, fr: Frame): Seg {
  const p0 = fr.local(e.start)
  const p1 = fr.local(e.end)
  const kind = e.geomType
  if (kind === 'line') return new Line2(p0, p1)
  if (kind === 'circle') {
    const d = e._circle()
    const c = fr.local(new Vector(d.placement.origin))
    return _arcFrom(c, Number(d.radius), p0, p1, fr.direction(e.tangentAt(0.0)), e.isClosed)
  }
  if (kind === 'bspline') {
    if (e._isStraight()) return new Line2(p0, p1)
    const samples: Complex[] = []
    for (let i = 0; i < 9; i++) samples.push(fr.local(e.pointAt(i / 8)))
    const closed = p1.sub(p0).abs() <= 1e-9 * Math.max(1.0, p0.abs())
    const c = closed ? _circumcenter(samples[0], samples[3], samples[6]) : _circumcenter(samples[0], samples[4], samples[8])
    if (c !== null) {
      const r = samples[0].sub(c).abs()
      if (samples.every((s) => Math.abs(s.sub(c).abs() - r) <= 1e-9 * Math.max(1.0, r))) {
        return _arcFrom(c, r, p0, p1, fr.direction(e.tangentAt(0.0)), closed)
      }
    }
  }
  const pts: Complex[] = []
  for (let i = 0; i < 33; i++) pts.push(fr.local(e.pointAt(i / 32)))
  return new Curve2<Edge>(e, p0, p1, unit(fr.direction(e.tangentAt(0.0))), unit(fr.direction(e.tangentAt(1.0))), e.length, pts)
}

/** Fillets and chamfers at corners with curves (splines, ellipses) for `_planar.assemble`, through the
 * kernel: a fillet's center is where the offsets of the two curves toward the inside of the corner
 * meet (`Edge.offset`), its ends the nearest points of the curves to it; a chamfer cuts back the
 * length along each curve. (SMLib's own `SmCurveFilletExecutive` is unused and untested in the
 * kernel and picks its side wrongly.) */
export class CurveCorners {
  readonly fr: Frame
  readonly size: number

  constructor(fr: Frame, size: number) {
    this.fr = fr
    this.size = Math.max(1, size)
  }

  _edge(s: Seg): Edge {
    return s instanceof Curve2 ? (s.edge as unknown as Edge) : Edge._fromCurve(curveOf(s, this.fr))
  }

  /** The part of a curve segment between two lengths from its start. */
  piece(seg: Curve2, s0: number, s1: number): Seg {
    if (s0 <= 0 && s1 >= seg.length) return seg
    return segOfEdge((seg.edge as unknown as Edge).trim(Math.max(s0, 0) / seg.length, Math.min(s1 / seg.length, 1)), this.fr)
  }

  /** The edge's offset toward the corner: of the whole edge, or of its part next to the corner where
   * the edge bends too tightly farther away. */
  _offset(e: Edge, d: number, atEnd: boolean): Edge | null {
    let piece = e
    for (let i = 0; i < 8; i++) {
      try {
        return piece.offset(d, { plane: this.fr.plane })
      } catch (x) {
        if (!(x instanceof ModelingError || x instanceof RangeError)) throw x
        const f = 0.5 ** (i + 1)
        piece = atEnd ? e.trim(1 - f, 1) : e.trim(0, f)
      }
    }
    return null
  }

  corner(kind: string, s1: Seg, s2: Seg, size: number): [number, number, Seg] {
    const [sn, cs] = turn(s1, s2)
    if (Math.abs(sn) < SMOOTH) {
      throw new GeometryError(cs > 0 ? 'the segments meet tangentially there, so there is no corner' : 'the outline turns back on itself there')
    }
    const e1 = this._edge(s1)
    const e2 = this._edge(s2)
    const l1 = e1.length
    const l2 = e2.length
    const fr = this.fr
    if (kind === 'chamfer') { // (a length beyond a segment: assemble reports that it does not fit)
      return [size, size, new Line2(fr.local(e1.pointAt(Math.max(0, 1 - size / l1))), fr.local(e2.pointAt(Math.min(1, size / l2))))]
    }
    const side = sn > 0 ? 1 : -1
    const o1 = this._offset(e1, side * size, true)
    const o2 = this._offset(e2, side * size, false)
    let best: [number, number, Vector, Vector, Vector] | null = null
    if (o1 !== null && o2 !== null) {
      for (const c of o1.intersections(o2)) {
        const f1 = e1.closestPoint(c)
        const f2 = e2.closestPoint(c)
        if (Math.max(Math.abs(f1.distanceTo(c) - size), Math.abs(f2.distanceTo(c) - size)) > 1e-6 * this.size) continue // (a point of an end, not where the arc touches)
        const back = (1 - e1.paramAtPoint(f1)) * l1
        const ahead = e2.paramAtPoint(f2) * l2
        if (best === null || back + ahead < best[0] + best[1]) best = [back, ahead, c, f1, f2]
      }
    }
    if (best === null) throw new GeometryError(`no arc of radius ${fmt(size)} touches both segments`)
    let [, , c, f1, f2] = best
    // Newton on the center: its distances to the two curves become the radius (the offsets are
    // fitted within 1e-6 of the size; the curves' nearest points are exact)
    let cl = fr.local(c)
    for (let it = 0; it < 8; it++) {
      const p1 = fr.local(f1)
      const p2 = fr.local(f2)
      const d1 = cl.sub(p1).abs()
      const d2 = cl.sub(p2).abs()
      if (Math.max(Math.abs(d1 - size), Math.abs(d2 - size)) <= 1e-13 * this.size || d1 === 0 || d2 === 0) break
      const n1 = cl.sub(p1).divs(d1)
      const n2 = cl.sub(p2).divs(d2)
      const det = cross(n1, n2)
      if (Math.abs(det) < 1e-12) break
      const r1 = size - d1
      const r2 = size - d2
      cl = cl.add(cx((r1 * n2.im - r2 * n1.im) / det, (n1.re * r2 - n2.re * r1) / det))
      c = fr.world(cl)
      f1 = e1.closestPoint(c)
      f2 = e2.closestPoint(c)
    }
    const back = (1 - e1.paramAtPoint(f1)) * l1
    const ahead = e2.paramAtPoint(f2) * l2
    const v1 = fr.local(f1).sub(cl)
    const v2 = fr.local(f2).sub(cl)
    let delta = v2.div(v1).phase()
    if (side > 0 && delta < 0) delta += TAU
    if (side < 0 && delta > 0) delta -= TAU
    return [back, ahead, new Arc2(cl, size, v1.phase(), delta)]
  }
}

/** A new kernel curve for a segment (the caller owns it). */
export function curveOf(s: Seg, fr: Frame): number {
  if (s instanceof Line2) {
    return kernelCall('sketch', () => k.create_line_segment(fr.world(s.a).toArray(), fr.world(s.b).toArray()))
  }
  if (s instanceof Arc2) return _arcCurve(new Vector(s.c.re, s.c.im, 0.0), s.r, degrees(s.a0), degrees(s.sweep), fr.plane)
  return ((s as Curve2).edge as Edge)._copyCurve()
}

export function edgesOf(segs: readonly Seg[], fr: Frame): Edge[] {
  return segs.map((s) => Edge._fromCurve(curveOf(s, fr)))
}

function _oriented(loop: Seg[], sign: number): Seg[] {
  if (signedArea(loop) * sign < 0) return loop.map((s) => s.reversed()).reverse()
  return loop
}

/** The faces of a sketch as loops of segments in its plane (outer counterclockwise, holes
 * clockwise). Cached on the sketch, which never changes. */
export function sketchLoops(sk: Sketch): [Frame, Loops] {
  const cached = sk._loops as [Frame, Loops] | null
  if (cached != null) return cached
  const fr = new Frame(sk.plane)
  const faces: Loops = []
  const size = Math.max(1.0, sk._looseBox().diagonal)
  for (const f of sk.faces()) {
    if (f.vertices().some((v) => Math.abs(fr.height(v.point)) > 1e-6 * size)) {
      throw new ModelingError(
        "the sketch's faces do not lie in its plane (a Polygon of 3D points?); draw it with 2D points and place it with .on(plane)",
      )
    }
    const loops = f
      .wires()
      .map((w) => w.edges().map((e) => segOfEdge(e, fr)))
      .filter((lp) => lp.length > 0)
    if (loops.length) faces.push([_oriented(loops[0], 1.0), loops.slice(1).map((h) => _oriented(h, -1.0))])
  }
  sk._loops = [fr, faces]
  return [fr, faces]
}

/** A sketch from loops of segments (outer counterclockwise, holes clockwise). */
export function build(faces: Loops, fr: Frame, like: Sketch | null = null, name = 'sketch'): Sketch {
  const breps: number[] = []
  let brep: number
  try {
    for (const [outer, holes] of faces) {
      const curves: number[] = []
      try {
        for (const s of [...outer, ...holes.flat()]) curves.push(curveOf(s, fr))
        breps.push(kernelCall(name, () => k.create_planar_faces(curves), 'the outline must not cross itself'))
      } catch (e) {
        for (const c of curves) ext.delete_curve(c)
        throw e
      }
    }
    if (!breps.length) {
      if (like === null) throw new ModelingError(`${name}: the result is empty`)
      return kernelCall(name, () => like._like(ext.copy_faces(like._brep, [])))
    }
    if (breps.length === 1) brep = breps.pop()!
    else brep = kernelCall(name, () => ext.combine(breps))
  } finally {
    for (const b of breps) ext.delete_brep(b)
  }
  if (like !== null) return Sketch._wrap(brep, { plane: fr.plane, name: like.name, color: like.color })
  return Sketch._wrap(brep, { plane: fr.plane })
}

export function region(loop: Seg[], fr: Frame): Sketch {
  return build([[orientCcw(loop), []]], fr)
}

function _allSegs(faces: Loops): Seg[] {
  const out: Seg[] = []
  for (const [outer, holes] of faces) for (const lp of [outer, ...holes]) out.push(...lp)
  return out
}

export function hasCurves(faces: Loops): boolean {
  return _allSegs(faces).some((s) => s instanceof Curve2)
}

export function tolOf(faces: Loops): number {
  const segs = _allSegs(faces)
  return segs.length ? 1e-9 * extent(segs) : 1e-9
}

// =============================================================================== corners: convexity, fillets, chamfers
function _cornerPoints(items: unknown, fr: Frame, what: string): Complex[] {
  const out: Complex[] = []
  if (items instanceof Vertex || _isPointLike(items) || (Array.isArray(items) && items.length > 0 && typeof items[0] === 'number')) {
    items = [items]
  }
  for (const it of items as Iterable<unknown>) {
    let p: Vector
    if (it instanceof Vertex) p = it.point
    else if (it instanceof Shape) {
      const name = _typeName(it)
      throw new TypeError(
        `${what}: the corners are given as vertices or points, not as ${'AEIOU'.includes(name[0]) ? 'an' : 'a'} ${name} (use sketch.vertices() and its selectors)`,
      )
    } else p = _vec(it as VectorLike)
    out.push(fr.local(p))
  }
  return out
}

/** "convex", "concave" or "smooth" for the corner of a sketch at `point`. */
export function cornerKind(sk: Sketch, point: VectorLike): string {
  const [fr, faces] = sketchLoops(sk)
  const v = fr.local(point)
  const tol = Math.max(1e-6, tolOf(faces) * 1e3)
  for (const [outer, holes] of faces) {
    for (const lp of [outer, ...holes]) {
      for (let i = 0; i < lp.length; i++) {
        const s = lp[i]
        if (s.start.sub(v).abs() <= tol) {
          if (lp.length === 1) return 'smooth'
          const [sn, cs] = turn(lp.at(i - 1)!, s)
          if (Math.abs(sn) < 1e-9) return cs > 0 ? 'smooth' : 'convex'
          return sn > 0 ? 'convex' : 'concave'
        }
      }
    }
  }
  throw new RangeError(`${fr.fp(v)} is not a corner of this sketch`)
}

/** Fillet (`kind` "fillet", `size` the radius) or chamfer (`size` the length) corners of a
 * sketch: all sharp ones, or those at `vertices`. */
export function roundCorners(sk: Sketch, size: number, vertices: unknown, kind: string): Sketch {
  const what = kind
  const unitName = kind === 'fillet' ? 'radius' : 'length'
  const [fr, faces] = sketchLoops(sk)
  if (!faces.length) throw new ModelingError(`${what}: the sketch is empty`)
  const tol = tolOf(faces)
  const vtol = Math.max(1e-6, tol * 1e3)
  const targets = vertices == null ? null : _cornerPoints(vertices, fr, what)
  if (targets !== null && !targets.length) throw new RangeError(`${what}: no corners given (the selection is empty)`)
  const used = new Array<boolean>(targets ? targets.length : 0).fill(false)
  let count = 0
  const newFaces: Loops = []
  const fp = (z: Complex) => fr.fp(z)
  for (const [outer, holes] of faces) {
    const loops: Seg[][] = []
    for (const lp of [outer, ...holes]) {
      const corners = new Map<number, Corner>()
      const n = lp.length
      for (let i = 0; i < n; i++) {
        const s1 = lp.at(i - 1)!
        const s2 = lp[i]
        const v = s2.start
        if (targets !== null) {
          const hits: number[] = []
          targets.forEach((t, j) => {
            if (t.sub(v).abs() <= vtol) hits.push(j)
          })
          if (!hits.length) continue
          for (const j of hits) used[j] = true
        }
        if (n === 1 || isSmooth(s1, s2)) {
          if (targets !== null) {
            throw new ModelingError(
              `${what}: the corner at ${fr.fp(v)} is smooth (its edges meet tangentially), so there is nothing to ${kind === 'fillet' ? 'round' : 'bevel'}; leave it out (select corners with .vertices().convex() or .concave())`,
            )
          }
          continue
        }
        corners.set(i, new Corner(kind, size, `${unitName} ${fmt(size)}`))
        count += 1
      }
      let created: Seg[]
      let labels: string[]
      try {
        ;[created, labels] = assemble(lp, new Array<string>(n).fill(''), corners, true, tol, (j) => describe(lp[j], fp), fp, new CurveCorners(fr, tol * 1e9))
      } catch (e) {
        if (!(e instanceof GeometryError)) throw e
        throw new ModelingError(`${what}: ${e.message}`)
      }
      ;[created] = simplify(created, labels, true, tol)
      loops.push(created)
    }
    newFaces.push([loops[0], loops.slice(1)])
  }
  if (targets !== null && !used.every((u) => u)) {
    const missing = targets.filter((_, j) => !used[j]).map((t) => fr.fp(t))
    const cornersAt = [...new Set(_allSegs(faces).map((s) => fr.fp(s.start)))].sort()
    const more = cornersAt.length > 12 ? ', ...' : ''
    throw new ModelingError(
      `${what}: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a corner of the sketch; its corners are at ${cornersAt.slice(0, 12).join(', ')}${more}`,
    )
  }
  if (count === 0) throw new ModelingError(`${what}: the sketch has no sharp corners to ${kind === 'fillet' ? 'round' : 'bevel'}`)
  return build(newFaces, fr, sk, what)
}

// =============================================================================== offset
export const CORNER_STYLES: readonly string[] = ['round', 'sharp', 'chamfer']

function _loopsCross(faces: Loops, tol: number): boolean {
  const loops: Seg[][] = []
  for (const [outer, holes] of faces) loops.push(outer, ...holes)
  for (const lp of loops) if (firstCrossing(lp, true, tol) !== null) return true
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      for (const a of loops[i]) {
        for (const b of loops[j]) {
          if (segmentIntersections(a, b, tol).length || overlap(a, b, tol) > tol) return true
        }
      }
    }
  }
  return false
}

export function unionAll(sketches: readonly Sketch[]): Sketch {
  let items = [...sketches]
  while (items.length > 1) {
    const next: Sketch[] = []
    for (let i = 0; i < items.length; i += 2) next.push(i + 1 < items.length ? items[i].fuse(items[i + 1]) : items[i])
    items = next
  }
  return items[0]
}

/**
 * The sketch grown (`distance` > 0) or shrunk, with exact lines and arcs; null when the sketch has
 * curves that are neither (the caller offsets those with the kernel).
 *
 * The offset is built directly from the moved segments where every loop stays a simple loop of
 * its own; otherwise (a part grows into another, a neck closes, an arc collapses) from Booleans
 * of the strips the boundary sweeps. Either result is checked: every edge must lie at the offset
 * distance from the original boundary, on the right side.
 */
export function offsetRegion(sk: Sketch, distance: number, corners: string): Sketch | null {
  const [fr, faces] = sketchLoops(sk)
  if (!faces.length) throw new ModelingError('offset: the sketch is empty')
  if (hasCurves(faces)) return null
  const tol = tolOf(faces)
  const d = Number(distance)
  try {
    const newFaces: Loops = []
    for (const [outer, holes] of faces) {
      const o = offsetChain(outer, -d, corners, true, tol)
      const hs = holes.map((h) => offsetChain(h, -d, corners, true, tol))
      if (signedArea(o) <= 0 || hs.some((h) => signedArea(h) >= 0)) throw new NeedBooleans('a loop turns inside out')
      if (signedArea(o) + pysum(hs.map((h) => signedArea(h))) <= tol * extent(o)) throw new NeedBooleans('a face vanishes')
      newFaces.push([o, hs])
    }
    if (_loopsCross(newFaces, tol)) throw new NeedBooleans('loops cross')
    const result = build(newFaces, fr, sk, 'offset')
    if (_offsetValid(result, sk, faces, d, corners)) return result
  } catch (e) {
    if (!(e instanceof NeedBooleans || e instanceof KernelError)) throw e
    // built from pieces below
  }
  const pieces: Piece[] = []
  for (const [outer, holes] of faces) {
    for (const lp of [outer, ...holes]) {
      for (let i = 0; i < lp.length; i++) {
        const s = lp[i]
        pieces.push(...cornerPiece(lp.at(i - 1)!, s, -d, corners))
        pieces.push(...sweepPiece(s, -d))
      }
    }
  }
  const tool = unionAll(pieces.map((pc) => build([pc], fr, null, 'offset')))
  let result = d > 0 ? sk.fuse(tool) : sk.cut(tool)
  result = Sketch._wrap(result._copyBrep(), { plane: sk.plane, name: sk.name, color: sk.color })
  if (!result.faces().length) throw new ModelingError(`offset: shrinking by ${fmt(-d)} removes the whole region; use a smaller distance`)
  if (!_offsetValid(result, sk, faces, d, corners)) {
    throw new ModelingError(
      `offset: the kernel could not build a reliable offset by ${fmt(d)} of this sketch (an edge of the result is not at that distance from the outline); try a slightly different distance or corners: 'round'`,
    )
  }
  return result
}

/** Every edge of an offset lies at the distance from the original boundary that its corner style
 * allows, on the side the offset moves to. */
function _offsetValid(result: Sketch, original: Sketch, faces: Loops, d: number, corners: string): boolean {
  const [rfr, rfaces] = sketchLoops(result)
  const segs = _allSegs(faces)
  const a = Math.abs(d)
  const size = extent(segs) + a
  const tol = 1e-6 * Math.max(1.0, size)
  let low = a - tol
  if (corners === 'chamfer') {
    let widest = 0.0
    for (const [outer, holes] of faces) {
      for (const lp of [outer, ...holes]) {
        for (let i = 0; i < lp.length; i++) {
          const [sn, cs] = turn(lp.at(i - 1)!, lp[i])
          if (sn * -d < 0 && Math.abs(sn) >= SMOOTH) widest = Math.max(widest, Math.abs(cx(cs, sn).phase()))
        }
      }
    }
    low = a * Math.cos(widest / 2) - tol
  }
  if (!rfaces.length) return false
  for (const [outer, holes] of rfaces) {
    for (const lp of [outer, ...holes]) {
      for (const rs of lp) {
        for (const f of [0.25, 0.5, 0.75]) {
          const q = rs.at(rs.length * f)
          let dist = Infinity
          for (const s of segs) dist = Math.min(dist, distance(s, q))
          if (dist < low || (corners !== 'sharp' && dist > a + tol)) return false
          const inside = original.distanceTo(rfr.world(q)) <= tol
          if (inside !== d < 0) return false
        }
      }
    }
  }
  return true
}

// =============================================================================== mirror
function _mirrorPlane(sk: Sketch, about: unknown): Plane {
  if (about instanceof Axis) {
    const n = sk.plane.zDir
    const d = about.direction
    if (!d.isPerpendicular(n, 1e-6)) {
      throw new RangeError(
        'mirror: the axis must lie in the sketch plane (its direction is not parallel to the plane); pass a Plane to mirror in 3D',
      )
    }
    if (Math.abs(sk.plane.distanceTo(about.origin)) > 1e-6 * Math.max(1.0, sk._looseBox().diagonal)) {
      throw new RangeError(`mirror: the axis does not lie in the sketch plane (its origin is ${fmt(sk.plane.distanceTo(about.origin))} away from it)`)
    }
    return new Plane(about.origin, d, d.cross(n).normalized())
  }
  return _asPlane(about)
}

/** The sketch mirrored in a plane, or about an axis in its own plane. Lines stay lines and arcs
 * stay arcs; the normal is mirrored too, so an axis in the sketch plane leaves the sketch facing
 * the same way (and `mirror` commutes with `extrude`). */
export function mirrorSketch(sk: Sketch, about: unknown): Sketch {
  const mp = _mirrorPlane(sk, about)
  const [, faces] = sketchLoops(sk)
  const n = mp.zDir
  const o = mp.origin
  const reflPoint = (v: Vector) => v.sub(n.mul(2.0 * v.sub(o).dot(n)))
  const reflDir = (v: Vector) => v.sub(n.mul(2.0 * v.dot(n)))
  const p = sk.plane
  const newPlane = new Plane(reflPoint(p.origin), reflDir(p.xDir), reflDir(p.zDir))
  const nf = new Frame(newPlane)
  const m = new Location(_reflectionMatrix(mp))

  const flip = (s: Seg): Seg => {
    if (s instanceof Curve2) {
      const e = (s.edge as Edge).moved(m)
      return new Curve2<Edge>(e, s.start_.conj(), s.end_.conj(), s.t0_.conj(), s.t1_.conj(), s.length_, s.points.map((q) => q.conj()))
    }
    return s.reflected(ZERO, ONE)
  }
  const loop = (lp: Seg[]): Seg[] => [...lp].reverse().map((s) => flip(s).reversed())

  const newFaces: Loops = faces.map(([outer, holes]) => [loop(outer), holes.map(loop)])
  if (!newFaces.length) return Sketch._wrap(sk._copyBrep(), { plane: newPlane, name: sk.name, color: sk.color })
  const out = build(newFaces, nf, null, 'mirror')
  out.name = sk.name
  out.color = sk.color
  return out
}

function _reflectionMatrix(plane: Plane): Float64Array {
  const nn = plane.zDir.toArray()
  const oo = plane.origin.toArray()
  const d = oo[0] * nn[0] + oo[1] * nn[1] + oo[2] * nn[2]
  const mm = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) mm[r * 4 + c] = (r === c ? 1 : 0) - 2.0 * (nn[r] * nn[c])
    mm[r * 4 + 3] = 2.0 * nn[r] * d
  }
  mm[15] = 1
  return mm
}

// =============================================================================== paths: stroke
/** The plane of a planar path: world XY at its height when it is level, else the plane the path
 * lies in. */
export function pathFrame(edges: readonly Edge[]): Frame {
  const pts: Vector[] = []
  for (const e of edges) pts.push(e.start, e.end, e.pointAt(0.5))
  const zs = pts.map((p) => p.z)
  let size = 1.0
  for (const p of pts) for (const c of p) size = Math.max(size, Math.abs(c))
  if (Math.max(...zs) - Math.min(...zs) <= 1e-9 * size) return new Frame(new Plane([0, 0, zs[0]]))
  const pl = _fitPlane(pts, false)
  if (pts.some((p) => Math.abs(pl.distanceTo(p)) > 1e-7 * size)) throw new RangeError('Stroke: the path does not lie in a plane')
  return new Frame(pl)
}

export function pathSegments(path: unknown, what: string): [Frame, Seg[]] {
  let edges: Edge[]
  if (path instanceof Edge) edges = [path]
  else if (path instanceof Wire) edges = [...path.edges()]
  else if (path instanceof ShapeList && path.every((e) => e instanceof Edge)) edges = [...new Wire([...(path as ShapeList<Edge>)]).edges()]
  else {
    const name = _typeName(path)
    const hint = name === 'Profile' ? ' (call .wire() on a Profile)' : ''
    throw new TypeError(`${what}: the path is an Edge or a Wire, not a ${name}${hint}`)
  }
  const fr = pathFrame(edges)
  const segs = edges.map((e) => segOfEdge(e, fr))
  const size = extent(segs)
  for (let i = 1; i < segs.length; i++) {
    const gap = segs[i].start.sub(segs[i - 1].end).abs()
    if (gap > 1e-6 * size) throw new ModelingError(`${what}: the path has a gap of ${fmt(gap)} between edge ${i} and edge ${i + 1}`)
  }
  return [fr, segs]
}

export function stroke(path: unknown, width: number, ends: string, corners: string): Sketch {
  if (!(width > 0)) throw new RangeError(`Stroke: the width must be positive (got ${width})`)
  if (ends !== 'round' && ends !== 'flat') throw new RangeError(`Stroke: ends is 'round' or 'flat', not '${ends}'`)
  if (!CORNER_STYLES.includes(corners)) throw new RangeError(`Stroke: corners is 'round', 'sharp' or 'chamfer', not '${corners}'`)
  const [fr, segs] = pathSegments(path, 'Stroke')
  const h = width / 2.0
  const tol = 1e-9 * extent(segs)
  const closed = segs[segs.length - 1].end.sub(segs[0].start).abs() <= 1e-6 * extent(segs)
  if (closed) {
    const loop = orientCcw([...segs])
    const innerArea = signedArea(loop)
    if (innerArea <= tol) throw new ModelingError('Stroke: the closed path encloses no area')
    const base = region(loop, fr)
    const outer = base.offset(h, { corners })
    let inner: Sketch
    try {
      inner = base.offset(-h, { corners })
    } catch (e) {
      if (!(e instanceof ModelingError)) throw e
      return outer
    }
    return outer.cut(inner)
  }
  if (segs.some((s) => s instanceof Curve2)) return _strokeCurves(segs, fr, h, ends, corners)
  try {
    const right = offsetChain(segs, -h, corners, false, tol)
    const left = offsetChain(segs, h, corners, false, tol)
    const p0 = segs[0].start
    const p1 = segs[segs.length - 1].end
    const t0 = segs[0].t0
    const t1 = segs[segs.length - 1].t1
    let capEnd: Seg
    let capStart: Seg
    if (ends === 'round') {
      capEnd = new Arc2(p1, h, NEG_J.mul(t1).phase(), Math.PI)
      capStart = new Arc2(p0, h, J.mul(t0).phase(), Math.PI)
    } else {
      capEnd = new Line2(right[right.length - 1].end, left[left.length - 1].end)
      capStart = new Line2(left[0].start, right[0].start)
    }
    let loop: Seg[] = [...right, capEnd, ...[...left].reverse().map((s) => s.reversed()), capStart]
    if (firstCrossing(loop, true, tol) !== null || signedArea(loop) <= 0) throw new NeedBooleans('the band crosses itself')
    ;[loop] = simplify(loop, new Array<string>(loop.length).fill(''), true, tol)
    return build([[loop, []]], fr, null, 'Stroke')
  } catch (e) {
    if (!(e instanceof NeedBooleans || e instanceof KernelError)) throw e
    // built from pieces below
  }
  const pieces: Piece[] = []
  segs.forEach((s, i) => {
    if (i) for (const e of [h, -h]) pieces.push(...cornerPiece(segs[i - 1], s, e, corners))
    pieces.push(...bandPiece(s, h))
  })
  if (ends === 'round') pieces.push([disk(segs[0].start, h), []], [disk(segs[segs.length - 1].end, h), []])
  return unionAll(pieces.map((pc) => build([pc], fr, null, 'Stroke')))
}

/** Stroke along an open path with splines or ellipses: the band between the path's offsets to both
 * sides and the end caps; where that band runs into itself, the union of a band per edge, the
 * wedges at the corners and the round ends. */
function _strokeCurves(segs: Seg[], fr: Frame, h: number, ends: string, corners: string): Sketch {
  const size = realSize(segs)
  let problem: unknown
  try {
    const right = offsetCurves(segs, fr, -h, corners, false, size, 'Stroke', h, false)
    const left = offsetCurves(segs, fr, h, corners, false, size, 'Stroke', h, false)
    const p0 = segs[0].start
    const p1 = segs[segs.length - 1].end
    let capEnd: Edge[]
    let capStart: Edge[]
    if (ends === 'round') {
      capEnd = edgesOf([new Arc2(p1, h, NEG_J.mul(segs[segs.length - 1].t1).phase(), Math.PI)], fr)
      capStart = edgesOf([new Arc2(p0, h, J.mul(segs[0].t0).phase(), Math.PI)], fr)
    } else {
      capEnd = edgesOf([new Line2(fr.local(right[right.length - 1].end), fr.local(left[left.length - 1].end))], fr)
      capStart = edgesOf([new Line2(fr.local(left[0].start), fr.local(right[0].start))], fr)
    }
    const loop = [...right, ...capEnd, ...[...left].reverse().map((e) => e.reversed()), ...capStart]
    const hit = chainCrossing(loop, true, size)
    if (hit === null) return build([[orientCcw(loop.map((e) => segOfEdge(e, fr))), []]], fr, null, 'Stroke')
    problem = new ModelingError(`Stroke: the band runs into itself near ${fr.fp(fr.local(hit))}`)
  } catch (e) {
    if (!(e instanceof ModelingError || e instanceof RangeError)) throw e
    problem = e
  }
  try {
    const sketches: Sketch[] = []
    segs.forEach((s, i) => {
      if (i) for (const e of [h, -h]) for (const pc of _cornerWedge(segs[i - 1], s, e, corners)) sketches.push(build([pc], fr, null, 'Stroke'))
      if (s instanceof Curve2) sketches.push(..._curveBands(s.edge as Edge, h, fr, size, i))
      else for (const pc of bandPiece(s, h)) sketches.push(build([pc], fr, null, 'Stroke'))
    })
    if (ends === 'round') {
      sketches.push(build([[disk(segs[0].start, h), []]], fr, null, 'Stroke'), build([[disk(segs[segs.length - 1].end, h), []]], fr, null, 'Stroke'))
    }
    return unionAll(sketches)
  } catch (e) {
    if (!(e instanceof ModelingError || e instanceof RangeError)) throw e
    throw problem
  }
}

/** The band within `h` of a curve, ends cut square: one band where it does not run into itself, else
 * the bands of pieces (the curve cut where it crosses itself, then in halves). */
function _curveBands(edge: Edge, h: number, fr: Frame, size: number, index: number, depth = 0): Sketch[] {
  const r = offsetCurveEdge(edge, -h, fr, 1e-6 * size, 'Stroke', index)
  const lft = offsetCurveEdge(edge, h, fr, 1e-6 * size, 'Stroke', index)
  const ends = edgesOf([new Line2(fr.local(r.end), fr.local(lft.end)), new Line2(fr.local(lft.start), fr.local(r.start))], fr)
  const loop = [r, ends[0], lft.reversed(), ends[1]]
  if (chainCrossing(loop, true, size) === null) return [build([[orientCcw(loop.map((x) => segOfEdge(x, fr))), []]], fr, null, 'Stroke')]
  if (depth >= 6) throw new ModelingError(`Stroke: the band along edge ${index + 1} of the path runs into itself`)
  let pieces = depth === 0 ? _uncrossed(edge, 1e-9 * size) : [edge]
  if (pieces.length === 1) pieces = [...edge.split(0.5)]
  return pieces.flatMap((piece) => _curveBands(piece, h, fr, size, index, depth + 1))
}

/** The edge cut where it crosses itself, into pieces that do not. */
function _uncrossed(edge: Edge, tol: number): Edge[] {
  const [t0, t1] = edge._range()
  const sols = kernelCall('Stroke', () => ext.self_intersections(edge._curve(), t0, t1, tol))
  const all = new Set<number>()
  for (const s of sols) for (const u of s.t) all.add(edge._fraction(Number(u)))
  const cuts = [...all].sort((a, b) => a - b).filter((f) => 1e-9 < f && f < 1.0 - 1e-9)
  if (!cuts.length) return [edge]
  const bounds = [0.0, ...cuts, 1.0]
  const out: Edge[] = []
  for (let i = 0; i + 1 < bounds.length; i++) if (bounds[i + 1] - bounds[i] > 1e-9) out.push(edge.trim(bounds[i], bounds[i + 1]))
  return out
}

/** `cornerPiece` for corners at splines and ellipses: the offsets' ends are the corner moved `e`
 * along the normals of the two tangents there. */
function _cornerWedge(s1: Seg, s2: Seg, e: number, corners: string): Piece[] {
  if (!(s1 instanceof Curve2 || s2 instanceof Curve2)) return cornerPiece(s1, s2, e, corners)
  const [sn, cs] = turn(s1, s2)
  if (Math.abs(sn) < SMOOTH && cs > 0) return []
  if (sn * e >= 0 && Math.abs(sn) >= SMOOTH) return []
  const v = s1.end
  if (Math.abs(sn) < SMOOTH) return [[disk(v, Math.abs(e)), []]]
  const pe = v.add(J.mul(s1.t1).scale(e))
  const qs = v.add(J.mul(s2.t0).scale(e))
  if (corners === 'chamfer') return [[polygon(v, pe, qs), []]]
  if (corners === 'sharp') {
    const hits = _lineLine(pe, s1.t1, qs, s2.t0)
    return hits.length ? [[polygon(v, pe, hits[0], qs), []]] : [[disk(v, Math.abs(e)), []]]
  }
  const d1 = pe.sub(v)
  const d2 = qs.sub(v)
  let sweep = d2.div(d1).phase()
  if (sn > 0 && sweep < 0) sweep += TAU
  if (sn < 0 && sweep > 0) sweep -= TAU
  return [[orientCcw([new Line2(v, pe), new Arc2(v, Math.abs(e), d1.phase(), sweep), new Line2(qs, v)]), []]]
}

// =============================================================================== offsets of wires and edges
const _OFFSET_REASONS: Record<string, string> = {
  'an arc collapses': 'an arc collapses (the distance reaches past its center)',
  'the chain turns back': 'the wire turns back on itself',
  'a segment vanishes': 'an edge vanishes (the corners beside it cut it away)',
  'an arc vanishes': 'an arc vanishes (the corners beside it cut it away)',
  'the offsets do not meet near the corner': 'the edges at a corner no longer meet (an edge there is shorter than the distance)',
  'parallel tangents': 'the sides of a corner run parallel and never meet',
}

function _offsetProblem(what: string, distance: number, reason: string, closed: boolean, where = ''): string {
  const region = closed ? '; the offset of the region it bounds (Sketch.offset) merges and drops parts instead' : ''
  const at = where ? ` at ${where}` : ''
  return `${what}: moved by ${fmt(Math.abs(distance))}, ${_OFFSET_REASONS[reason] ?? reason}${at}; use a smaller distance${region}`
}

/** The plane of a planar wire, its normal telling left from right: `plane` (the wire must lie in a
 * plane parallel to it), else XY at the wire's height for a level wire, else the plane the wire lies
 * in with its normal toward +Z (+Y, then +X, for vertical planes). */
export function wireFrame(edges: readonly Edge[], plane: unknown, what: string): Frame {
  const pts: Vector[] = []
  for (const e of edges) {
    pts.push(e.start, e.end)
    for (let i = 1; i < 8; i++) pts.push(e.pointAt(i / 8))
  }
  let size = 1.0
  for (const p of pts) for (const c of p) size = Math.max(size, Math.abs(c))
  if (plane != null) {
    const pl = _asPlane(plane)
    const hs = pts.map((p) => pl.toLocal(p).z)
    const depth = Math.max(...hs) - Math.min(...hs)
    if (depth > 1e-7 * size) {
      throw new RangeError(`${what}: the wire does not lie in a plane parallel to the plane given (it reaches ${fmt(depth)} along the plane's normal)`)
    }
    return new Frame(pl.offset(hs[0]))
  }
  const zs = pts.map((p) => p.z)
  if (Math.max(...zs) - Math.min(...zs) <= 1e-9 * size) return new Frame(new Plane([0, 0, zs[0]]))
  const a = pts[0]
  let far = pts[0]
  for (const q of pts) if (q.distanceTo(a) > far.distanceTo(a)) far = q
  const u = far.sub(a).normalized()
  if (pts.every((q) => q.sub(a).sub(u.mul(q.sub(a).dot(u))).length <= 1e-9 * size)) {
    throw new RangeError(`${what}: the wire is straight and not level, so it does not say which plane it moves in; pass plane=`)
  }
  let pl = _fitPlane(pts, false)
  if (pts.some((q) => Math.abs(pl.toLocal(q).z) > 1e-7 * size)) throw new RangeError(`${what}: the wire does not lie in a plane`)
  const nz = pl.zDir
  if (nz.z < -1e-9 || (Math.abs(nz.z) <= 1e-9 && (nz.y < -1e-9 || (Math.abs(nz.y) <= 1e-9 && nz.x < 0)))) pl = pl.flipped()
  return new Frame(pl)
}

/** The diagonal of the box around segments (in their plane). */
export function realSize(segs: readonly Seg[]): number {
  const pts = segs.flatMap((s) => s.sample(8))
  const xs = pts.map((p) => p.re)
  const ys = pts.map((p) => p.im)
  return Math.max(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), 1e-300)
}

/** The edges of a planar wire, end to end, moved `distance` sideways: an open wire to its left (seen
 * from the normal of its plane), a closed one outward (see `Wire.offset`). */
export function offsetWire(edges: Edge[], distance: number, corners: string, plane: unknown, what: string): Edge[] {
  const fr = wireFrame(edges, plane, what)
  const segs = edges.map((e) => segOfEdge(e, fr))
  const size = realSize(segs)
  for (let i = 1; i < segs.length; i++) {
    const gap = segs[i].start.sub(segs[i - 1].end).abs()
    if (gap > 1e-6 * Math.max(1.0, size)) throw new ModelingError(`${what}: the wire has a gap of ${fmt(gap)} between edge ${i} and edge ${i + 1}`)
  }
  const closed = segs[segs.length - 1].end.sub(segs[0].start).abs() <= 1e-6 * Math.max(1.0, size)
  let e = distance
  if (closed) {
    const area = signedArea(segs)
    if (Math.abs(area) <= 1e-12 * size * size) throw new ModelingError(`${what}: the closed wire encloses no area, so it has no outside to move to`)
    e = area > 0 ? -distance : distance // outward: to the right of a counterclockwise loop
  }
  if (segs.some((s) => s instanceof Curve2)) return offsetCurves(segs, fr, e, corners, closed, size, what, distance)
  const tol = 1e-9 * Math.max(1.0, size)
  let out: Seg[]
  try {
    out = offsetChain(segs, e, corners, closed, tol)
  } catch (ex) {
    if (!(ex instanceof NeedBooleans)) throw ex
    throw new ModelingError(_offsetProblem(what, distance, ex.message, closed))
  }
  const hit = firstCrossing(out, closed, tol)
  // (a wire that crosses itself: its offset may)
  if (hit !== null && firstCrossing(segs, closed, tol) === null) throw new ModelingError(_crossingProblem(what, distance, fr.fp(hit[2]), closed))
  return edgesOf(out, fr)
}

function _crossingProblem(what: string, distance: number, where: string, closed: boolean): string {
  const region = closed ? '; the offset of the region it bounds (Sketch.offset) merges parts instead' : ''
  return `${what}: moved by ${fmt(Math.abs(distance))}, the wire runs into itself near ${where} (parts of it lie closer together than the ` +
    `distance allows); use a smaller distance${region}`
}

/** An edge (a spline or an ellipse) moved `e` to its left in the frame's plane, by the kernel within
 * `tol`. */
export function offsetCurveEdge(edge: Edge, e: number, fr: Frame, tol: number, what: string, index: number | null): Edge {
  const c = edge._copyCurve()
  let res: Any
  let point: Vector | null = null
  try {
    res = kernelCall(what, () => ext.offset_curve(c, fr.plane.zDir.toArray(), e, tol), 'the curve may have a corner inside; split it there first')
    if (!res[0]) point = new Vector(k.curve_evaluate(c, Number(res[2])))
  } finally {
    ext.delete_curve(c)
  }
  const [curve, dev] = [res[0] as number, Number(res[1])]
  const name = index !== null ? `edge ${index + 1} (${edge.geomType})` : `the ${edge.geomType}`
  if (!curve) {
    const r = edge.minRadius()
    throw new ModelingError(`${what}: ${name} bends more tightly than the distance ${fmt(Math.abs(e))} near ${fr.fp(fr.local(point!))} on the ` +
      `side it moves to (its smallest radius of curvature is ${fmt(r)}), so its offset would fold over itself there; use a smaller distance`)
  }
  const moved = Edge._fromCurve(curve)
  if (!(dev <= 10.0 * tol)) {
    throw new ModelingError(`${what}: the kernel's offset of ${name} is ${_formatG(dev, 3)} off the distance (asked within ${_formatG(tol, 3)})`)
  }
  return moved
}

/** `offsetWire` for wires with splines or ellipses: lines and arcs moved exactly, the curves by the
 * kernel; the corners that open filled (`corners`), those that close cut where the moved edges
 * cross. With `crossing`, checked not to run into itself (unless the wire itself does). */
export function offsetCurves(segs: Seg[], fr: Frame, e: number, corners: string, closed: boolean, size: number, what: string,
  distance: number, crossing = true): Edge[] {
  const approx = 1e-6 * size
  const n = segs.length
  const moved: Edge[] = segs.map((s, i) => {
    if (s instanceof Line2 || s instanceof Arc2) {
      const o = s.offset(e)
      if (o === null) throw new ModelingError(_offsetProblem(what, distance, 'an arc collapses', closed, fr.fp(s.at(s.length / 2))))
      return Edge._fromCurve(curveOf(o, fr))
    }
    return offsetCurveEdge((s as Curve2).edge as Edge, e, fr, approx, what, n > 1 ? i : null)
  })
  const lo = new Array<number>(n).fill(0.0)
  const hi = new Array<number>(n).fill(1.0)
  const startAt: (Complex | null)[] = new Array(n).fill(null)
  const endAt: (Complex | null)[] = new Array(n).fill(null)
  const joins = new Map<number, Edge[]>()
  for (let i = closed ? 0 : 1; i < n; i++) {
    const s1 = segs[(i - 1 + n) % n]
    const s2 = segs[i]
    const [sn, cs] = turn(s1, s2)
    if (Math.abs(sn) < SMOOTH && cs > 0) continue
    const v = s1.end
    if (Math.abs(sn) < SMOOTH) throw new ModelingError(_offsetProblem(what, distance, 'the chain turns back', closed, fr.fp(v)))
    const m1 = moved[(i - 1 + n) % n]
    const m2 = moved[i]
    const p = fr.local(m1.end)
    const q = fr.local(m2.start)
    if (sn * e < 0) {
      // the corner opens: fill it
      if (corners === 'round') {
        const d1 = p.sub(v)
        const d2 = q.sub(v)
        let sweep = d2.div(d1).phase()
        if (sn > 0 && sweep < 0) sweep += TAU
        if (sn < 0 && sweep > 0) sweep -= TAU
        joins.set(i, edgesOf([new Arc2(v, Math.abs(e), d1.phase(), sweep)], fr))
      } else if (corners === 'chamfer') {
        joins.set(i, edgesOf([new Line2(p, q)], fr))
      } else {
        // sharp: the sides go on along their tangents until they meet
        const hits = _lineLine(p, s1.t1, q, s2.t0)
        if (!hits.length) throw new ModelingError(_offsetProblem(what, distance, 'parallel tangents', closed, fr.fp(v)))
        const mpt = hits[0]
        const extra: Seg[] = []
        if (m1.geomType === 'line') endAt[(i - 1 + n) % n] = mpt
        else extra.push(new Line2(p, mpt))
        if (m2.geomType === 'line') startAt[i] = mpt
        else extra.push(new Line2(mpt, q))
        joins.set(i, edgesOf(extra, fr))
      }
    } else {
      // the corner closes: cut both where they cross, nearest the corner
      let [a0, a1] = m1._range()
      let [b0, b1] = m2._range()
      let other = m2._curve()
      if (n === 1) {
        // (a closed edge with a corner where it starts and ends: its end half crosses its start half
        // near the corner; the kernel finds no crossing of a curve with itself)
        a0 = m1._param(0.5)
        b1 = m2._param(0.5)
        other = ext.copy_curve(other)
      }
      let sols: Any
      try {
        sols = kernelCall(what, () => ext.intersect_curves(m1._curve(), a0, a1, other, b0, b1, approx))
      } finally {
        if (n === 1) ext.delete_curve(other)
      }
      const wv = fr.world(v)
      let best: [number, number, number] | null = null
      const prev = (i - 1 + n) % n
      for (const sol of sols) {
        for (const [u1, u2] of sol.end != null ? [sol.t, sol.end] : [sol.t]) {
          const f1 = m1._fraction(Number(u1))
          const f2 = m2._fraction(Number(u2))
          if (f1 <= lo[prev] || f2 >= hi[i]) continue
          const d = new Vector(k.curve_evaluate(m1._curve(), Number(u1))).distanceTo(wv)
          if (best === null || d < best[0]) best = [d, f1, f2]
        }
      }
      if (best === null) throw new ModelingError(_offsetProblem(what, distance, 'the offsets do not meet near the corner', closed, fr.fp(v)))
      hi[prev] = best[1]
      lo[i] = best[2]
    }
  }
  const out: Edge[] = []
  for (let i = 0; i < n; i++) {
    out.push(...(joins.get(i) ?? []))
    const m = moved[i]
    if (hi[i] - lo[i] <= 1e-9) throw new ModelingError(_offsetProblem(what, distance, 'a segment vanishes', closed, fr.fp(segs[i].start)))
    const sa = startAt[i]
    const ea = endAt[i]
    if (m.geomType === 'line' && (sa !== null || ea !== null)) {
      const a = sa !== null ? fr.world(sa) : m.pointAt(lo[i])
      const b = ea !== null ? fr.world(ea) : m.pointAt(hi[i])
      if (b.sub(a).dot(m.end.sub(m.start)) <= 0) throw new ModelingError(_offsetProblem(what, distance, 'a segment vanishes', closed, fr.fp(segs[i].start)))
      out.push(Line(a, b))
    } else if (lo[i] > 0.0 || hi[i] < 1.0) {
      out.push(m.trim(lo[i], hi[i]))
    } else {
      out.push(m)
    }
  }
  if (crossing) {
    const hit = chainCrossing(out, closed, size)
    if (hit !== null && chainCrossing(edgesOf(segs, fr), closed, size) === null) {
      throw new ModelingError(_crossingProblem(what, distance, fr.fp(fr.local(hit)), closed))
    }
  }
  return out
}

/** A point where a chain of edges (end to end) runs into itself, or null. Next to the point where two
 * edges meet, 1e-4 of each is left out (tangent joints touch along a stretch). */
export function chainCrossing(edges: Edge[], closed: boolean, size: number): Vector | null {
  const tol = 1e-9 * Math.max(size, 1e-300)
  const n = edges.length
  const boxes = edges.map((e) => e.bbox())
  const pad = 10 * tol
  const apart = (a: BoundBox, b: BoundBox): boolean => {
    const amin = a.min.toArray()
    const amax = a.max.toArray()
    const bmin = b.min.toArray()
    const bmax = b.max.toArray()
    return [0, 1, 2].some((i) => amax[i] + pad < bmin[i] || bmax[i] + pad < amin[i])
  }
  const meet = (a: Edge, fa: [number, number], b: Edge, fb: [number, number]): Vector[] => {
    const [u0, u1] = [a._param(fa[0]), a._param(fa[1])].sort((x, y) => x - y)
    const [w0, w1] = [b._param(fb[0]), b._param(fb[1])].sort((x, y) => x - y)
    if (!(u1 > u0 && w1 > w0)) return []
    const sols = kernelCall('offset', () => ext.intersect_curves(a._curve(), u0, u1, b._curve(), w0, w1, tol))
    return sols.map((s: Any) => new Vector(s.point))
  }
  const cut = 1e-4
  for (let i = 0; i < n; i++) {
    if (edges[i].geomType !== 'line' && edges[i].geomType !== 'circle') {
      const pts = edges[i].selfIntersections({ tolerance: tol })
      if (pts.length) return pts[0]
    }
    for (let j = i + 1; j < n; j++) {
      if (apart(boxes[i], boxes[j])) continue
      let fa: [number, number] = [0.0, 1.0]
      let fb: [number, number] = [0.0, 1.0]
      if (j === i + 1) {
        fa = [0.0, 1.0 - cut]
        fb = [cut, 1.0]
      }
      if (closed && i === 0 && j === n - 1) {
        fa = [fa[0] + cut, fa[1]]
        fb = [fb[0], fb[1] - cut]
      }
      const pts = meet(edges[i], fa, edges[j], fb)
      if (pts.length) return pts[0]
    }
  }
  return null
}

// =============================================================================== hull
function _flatten(items: Iterable<unknown>): unknown[] {
  const out: unknown[] = []
  for (const it of items) {
    if (Array.isArray(it) && !(it.length && typeof it[0] === 'number')) out.push(..._flatten(it))
    else out.push(it)
  }
  return out
}

export function hull(items: Iterable<unknown>): Sketch {
  try {
    return _hull(items)
  } catch (e) {
    if (!(e instanceof GeometryError)) throw e
    throw new ModelingError(`Hull: ${e.message}`)
  }
}

function _hull(items: Iterable<unknown>): Sketch {
  const flat = _flatten(items)
  if (!flat.length) throw new RangeError('Hull: nothing given; pass points, edges, wires or sketches')
  const planes = flat.filter((it): it is Sketch => it instanceof Sketch).map((it) => it.plane)
  const fr = new Frame(planes.length ? planes[0] : Plane.XY)
  const sites: _Site[] = []
  for (const it of flat) {
    if (it instanceof Part) throw new TypeError('Hull: a Part has no outline in a plane; use part.section(plane) or a face')
    if (it instanceof Sketch) {
      if (!it.plane.isCoplanar(fr.plane, 1e-6 * Math.max(1.0, it._looseBox().diagonal))) throw new RangeError('Hull: the sketches lie in different planes')
      const [f2, faces] = sketchLoops(it)
      for (const [outer] of faces) sites.push(...hullSites(outer.map((s) => _toFrame(s, f2, fr))))
    } else if (it instanceof Face) {
      sites.push(...hullSites(it.outerWire().edges().map((e) => segOfEdge(e, fr))))
    } else if (it instanceof Wire) {
      sites.push(...hullSites(it.edges().map((e) => segOfEdge(e, fr))))
    } else if (it instanceof Edge) {
      sites.push(...hullSites([segOfEdge(it, fr)]))
    } else {
      const p = it instanceof Vertex ? it.point : _vec(it as VectorLike)
      if (Math.abs(fr.height(p)) > 1e-6 * Math.max(1.0, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))) {
        throw new RangeError(`Hull: the point (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) is not in the plane of the hull`)
      }
      sites.push(new _Site(fr.local(p), 0.0))
    }
  }
  let size = 1.0
  for (const s of sites) size = Math.max(size, s.c.abs() + s.r)
  const loop = convexHull(sites, 1e-9 * size)
  return build([[loop, []]], fr, null, 'Hull')
}

/** A segment of frame `a` in the coordinates of frame `b` (coplanar frames). */
function _toFrame(s: Seg, a: Frame, b: Frame): Seg {
  if (a.plane.equals(b.plane)) return s
  const o = b.local(a.world(ZERO))
  const rot = b.local(a.world(ONE)).sub(o)
  if (s instanceof Line2 || s instanceof Arc2) return s.moved(rot.divs(rot.abs()), o)
  throw new GeometryError('hull works on lines and circular arcs')
}

// =============================================================================== operands of the 2D Booleans
/** A new body with the sketch's faces built again from copies of their curves, or null when a
 * face does not rebuild (a loop that touches itself). The kernel's planar Boolean can fail, or
 * return a wrong union, on bodies that were moved; rebuilt ones are reliable. */
export function rebuiltBrep(sk: Sketch): number | null {
  const pieces: number[] = []
  try {
    for (const f of sk.faces()) {
      const curves: number[] = []
      try {
        for (const w of f.wires()) curves.push(...w._copyCurves())
        pieces.push(k.create_planar_faces(curves))
      } catch (e) {
        if (!_isRuntimeError(e)) throw e
        for (const c of curves) ext.delete_curve(c)
        return null
      }
    }
    if (!pieces.length) return null
    if (pieces.length === 1) return pieces.pop()!
    return ext.combine(pieces)
  } finally {
    for (const b of pieces) ext.delete_brep(b)
  }
}
