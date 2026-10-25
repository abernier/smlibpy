// three's own curves and 2D shapes as exact kernel curves. Lines, arcs, ellipses and Bézier curves
// become the same curves; a Catmull-Rom spline (THREE.SplineCurve, THREE.CatmullRomCurve3) is a
// cubic Bézier curve between each pair of its points, so it becomes a B-spline that runs exactly
// where three's runs, with the same parameter. Other curves (a subclass of THREE.Curve of an app's
// own) are fitted through points of theirs.
import * as THREE from 'three'
import { call, describe, sm, vec, vec2 } from './kernel.ts'

type V2 = THREE.Vector2
type V3 = THREE.Vector3
type Flags = { [flag: string]: unknown }
const is = (curve: unknown, flag: string): boolean => (curve as Flags | null)?.[flag] === true

/** A 2D outline (a THREE.Shape, THREE.Path or any THREE.Curve<Vector2>) as the kernel's edges on
 * its XY plane: a closed chain, gaps (a moveTo) and its end joined with lines, as three's
 * ShapeGeometry joins them. */
export function outline2(path: THREE.Curve<V2>): sm.Edge[] {
  const pieces = curves2(path)
  const edges: sm.Edge[] = []
  let last: V2 | null = null
  let first: V2 | null = null
  for (const piece of pieces) {
    const a = piece.getPoint(0)
    if (last !== null && a.distanceTo(last) > 1e-9) edges.push(sm.Line(vec2(last), vec2(a)))
    edges.push(...call(() => edges2(piece)))
    first ??= a
    last = piece.getPoint(1)
  }
  if (first !== null && last !== null && first.distanceTo(last) > 1e-9) edges.push(sm.Line(vec2(last), vec2(first)))
  if (!edges.length) throw new RangeError('a sketch outline needs curves (moveTo alone draws nothing)')
  return edges
}

/** The pieces of a 2D curve: a CurvePath's curves, flattened. */
function curves2(curve: THREE.Curve<V2>): THREE.Curve<V2>[] {
  if (is(curve, 'isCurvePath') || Array.isArray((curve as THREE.CurvePath<V2>).curves)) {
    return (curve as THREE.CurvePath<V2>).curves.flatMap((c) => curves2(c))
  }
  return [curve]
}

function edges2(c: THREE.Curve<V2>): sm.Edge[] {
  if (is(c, 'isLineCurve')) {
    const l = c as THREE.LineCurve
    return l.v1.distanceTo(l.v2) > 1e-12 ? [sm.Line(vec2(l.v1), vec2(l.v2))] : []
  }
  if (is(c, 'isQuadraticBezierCurve')) {
    const q = c as THREE.QuadraticBezierCurve
    return [sm.Bezier([vec2(q.v0), vec2(q.v1), vec2(q.v2)])]
  }
  if (is(c, 'isCubicBezierCurve')) {
    const b = c as THREE.CubicBezierCurve
    return [sm.Bezier([vec2(b.v0), vec2(b.v1), vec2(b.v2), vec2(b.v3)])]
  }
  if (is(c, 'isEllipseCurve')) return [ellipse(c as THREE.EllipseCurve)]
  if (is(c, 'isSplineCurve')) {
    const pts = (c as THREE.SplineCurve).points
    if (pts.length < 2) return []
    return [bspline(catmullRom(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)), false, 'uniform-repeat', 0.5), (p) => [p.x, p.y, 0])]
  }
  // any other curve: fitted through its points
  return [fitted(c.getPoints(64).map((p) => new sm.Vector(p.x, p.y, 0)))]
}

/** three's EllipseCurve (and ArcCurve), with its start, its sweep, its direction and its rotation. */
function ellipse(e: THREE.EllipseCurve): sm.Edge {
  // (the sweep as three's getPoint has it)
  const twoPi = Math.PI * 2
  let delta = e.aEndAngle - e.aStartAngle
  const same = Math.abs(delta) < Number.EPSILON
  while (delta < 0) delta += twoPi
  while (delta > twoPi) delta -= twoPi
  if (delta < Number.EPSILON) delta = same ? 0 : twoPi
  if (e.aClockwise && !same) delta = delta === twoPi ? -twoPi : delta - twoPi
  if (delta === 0) throw new RangeError('an EllipseCurve of no length (its start and end angles are the same)')
  const deg = 180 / Math.PI
  const rotation = e.aRotation ?? 0
  if (Math.abs(e.xRadius - e.yRadius) <= 1e-12 * Math.max(e.xRadius, 1)) {
    return sm.CenterArc([e.aX, e.aY], e.xRadius, (e.aStartAngle + rotation) * deg, delta * deg)
  }
  // an ellipse on a plane turned by its rotation, from its start angle the way it runs
  const turned = new sm.Plane([e.aX, e.aY, 0], [Math.cos(rotation), Math.sin(rotation), 0], [0, 0, 1])
  if (Math.abs(delta) >= twoPi - 1e-12) return sm.EllipticalArc([0, 0], e.xRadius, e.yRadius, 0, 360, turned)
  const a0 = e.aStartAngle * deg
  const a1 = (e.aStartAngle + delta) * deg
  return delta > 0 ? sm.EllipticalArc([0, 0], e.xRadius, e.yRadius, a0, a1, turned) : sm.EllipticalArc([0, 0], e.xRadius, e.yRadius, a1, a0, turned).reversed()
}

/** A 3D curve of three's (in a shape's own frame) as the kernel's edges. */
export function edges3(curve: THREE.Curve<V3>): sm.Edge[] {
  if (curve === null || typeof curve !== 'object' || typeof (curve as THREE.Curve<V3>).getPoint !== 'function') {
    throw new TypeError(`a curve is a THREE.Curve (LineCurve3, CatmullRomCurve3, CubicBezierCurve3, CurvePath, ...), not ${describe(curve)}`)
  }
  if (is(curve, 'isCurvePath') || Array.isArray((curve as THREE.CurvePath<V3>).curves)) {
    return (curve as THREE.CurvePath<V3>).curves.flatMap((c) => edges3(c))
  }
  return call(() => {
    if (is(curve, 'isLineCurve3')) {
      const l = curve as THREE.LineCurve3
      return l.v1.distanceTo(l.v2) > 1e-12 ? [sm.Line(vec(l.v1), vec(l.v2))] : []
    }
    if (is(curve, 'isQuadraticBezierCurve3')) {
      const q = curve as THREE.QuadraticBezierCurve3
      return [sm.Bezier([vec(q.v0), vec(q.v1), vec(q.v2)])]
    }
    if (is(curve, 'isCubicBezierCurve3')) {
      const b = curve as THREE.CubicBezierCurve3
      return [sm.Bezier([vec(b.v0), vec(b.v1), vec(b.v2), vec(b.v3)])]
    }
    if (is(curve, 'isCatmullRomCurve3')) {
      const c = curve as THREE.CatmullRomCurve3
      if (c.points.length < 2) return []
      const kind = c.curveType === 'catmullrom' ? 'tension' : c.curveType === 'chordal' ? 'chordal' : 'centripetal'
      return [bspline(catmullRom(c.points, c.closed, kind, c.tension), vec)]
    }
    const pts = curve.getPoints(64)
    if (pts.length && typeof (pts[0] as { z?: unknown }).z !== 'number') {
      throw new TypeError('a 2D curve (THREE.Curve<Vector2>) has no place in space: give it to a Sketch, or use a 3D curve')
    }
    return [fitted(pts.map((p) => vec(p)))]
  })
}

/** Points fitted with one curve through them (a closed one where the ends meet). */
function fitted(points: sm.Vector[]): sm.Edge {
  const closed = points.length > 3 && points[0].distanceTo(points[points.length - 1]) < 1e-9
  const pts = closed ? points.slice(0, -1) : points
  return sm.fitCurve(pts, { closed })
}

type Kind = 'tension' | 'centripetal' | 'chordal' | 'uniform-repeat'

/**
 * The cubic Bézier control points of a Catmull-Rom spline as three evaluates it: one segment
 * between each pair of points (and from the last back to the first if closed). Each segment of
 * three's is a cubic Hermite curve, so its Bézier points are its ends and the ends moved by a
 * third of their tangents. 'uniform-repeat' is THREE.SplineCurve (tension 0.5, the end points
 * repeated); the others are THREE.CatmullRomCurve3's types (its end points extrapolated).
 */
function catmullRom(points: readonly V3[], closed: boolean, kind: Kind, tension: number): V3[] {
  const l = points.length
  const n = closed ? l : l - 1
  const out: V3[] = [points[0].clone()]
  for (let i = 0; i < n; i++) {
    let p0: V3
    let p3: V3
    const p1 = points[i % l]
    const p2 = points[(i + 1) % l]
    if (kind === 'uniform-repeat') {
      p0 = points[i === 0 ? 0 : i - 1]
      p3 = points[i > l - 3 ? l - 1 : i + 2]
    } else {
      p0 = closed || i > 0 ? points[(i - 1 + l) % l] : points[0].clone().multiplyScalar(2).sub(points[1])
      p3 = closed || i + 2 < l ? points[(i + 2) % l] : points[l - 1].clone().multiplyScalar(2).sub(points[l - 2])
    }
    let t1: V3
    let t2: V3
    if (kind === 'tension' || kind === 'uniform-repeat') {
      const s = kind === 'tension' ? tension : 0.5
      t1 = p2.clone().sub(p0).multiplyScalar(s)
      t2 = p3.clone().sub(p1).multiplyScalar(s)
    } else {
      const pow = kind === 'chordal' ? 0.5 : 0.25
      let dt0 = Math.pow(p0.distanceToSquared(p1), pow)
      let dt1 = Math.pow(p1.distanceToSquared(p2), pow)
      let dt2 = Math.pow(p2.distanceToSquared(p3), pow)
      if (dt1 < 1e-4) dt1 = 1
      if (dt0 < 1e-4) dt0 = dt1
      if (dt2 < 1e-4) dt2 = dt1
      // (three's initNonuniformCatmullRom: the tangents for [t1, t2], scaled to [0, 1])
      t1 = p1.clone().sub(p0).divideScalar(dt0).sub(p2.clone().sub(p0).divideScalar(dt0 + dt1)).add(p2.clone().sub(p1).divideScalar(dt1)).multiplyScalar(dt1)
      t2 = p2.clone().sub(p1).divideScalar(dt1).sub(p3.clone().sub(p1).divideScalar(dt1 + dt2)).add(p3.clone().sub(p2).divideScalar(dt2)).multiplyScalar(dt1)
    }
    out.push(p1.clone().addScaledVector(t1, 1 / 3), p2.clone().addScaledVector(t2, -1 / 3), p2.clone())
  }
  return out
}

/** Cubic Bézier segments (shared ends: 3n + 1 points) as one B-spline, the knots of the segments
 * 0, 1, ..., n (so its parameter, divided by n, is three's t). */
function bspline(points: readonly V3[], kernel: (p: V3) => sm.Vector | number[]): sm.Edge {
  const n = (points.length - 1) / 3
  const knots = [0, 0, 0, 0]
  for (let i = 1; i < n; i++) knots.push(i, i, i)
  knots.push(n, n, n, n)
  return sm.Edge.fromNurbs({ degree: 3, knots, points: points.map((p) => kernel(p)) })
}
