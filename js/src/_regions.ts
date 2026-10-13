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
import { Axis, Location, Plane, Vector, _isPointLike, _vec, type VectorLike } from './geometry.ts'
import { _arcCurve } from './curves.ts'
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
        for (const s of [s1, s2]) {
          if (s instanceof Curve2) {
            if (targets === null) {
              throw new ModelingError(
                `${what}: the corner at ${fr.fp(v)} joins ${describe(s, fp)}; ${what} works on corners between lines and arcs. Pass the corners to change: sketch.${what}(${fmt(size)}, sketch.vertices().filter(...))`,
              )
            }
            throw new ModelingError(`${what}: the corner at ${fr.fp(v)} joins ${describe(s, fp)}; ${what} works on corners between lines and arcs`)
          }
        }
        corners.set(i, new Corner(kind, size, `${unitName} ${fmt(size)}`))
        count += 1
      }
      let created: Seg[]
      let labels: string[]
      try {
        ;[created, labels] = assemble(lp, new Array<string>(n).fill(''), corners, true, tol, (j) => describe(lp[j], fp), fp)
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
  segs.forEach((s, i) => {
    if (s instanceof Curve2) {
      throw new ModelingError(`${what}: edge ${i + 1} of the path is a ${(s.edge as Edge).geomType}; ${what} works on paths of lines and arcs`)
    }
  })
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
