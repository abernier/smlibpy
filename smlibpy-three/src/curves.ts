// smlibpy's curves as BrepEdge (THREE.Line) and Wire subclasses, in three's coordinates: points are
// THREE.Vector3s (or any { x, y, z }), angles radians. The curves drawn in a plane (arcs about a
// center, ellipses, conics, polar lines, spirals) lie in the XY plane, as three's EllipseCurve and
// sketches do: in the plane of constant z through their center, angles counterclockwise seen from
// +z, from +x towards +y. Place them elsewhere with their transform. A helix rises along +z, as
// three's HelixCurve (addons) does. Any of three's own curves is a BrepEdge or Wire too:
// `new BrepEdge(new THREE.CatmullRomCurve3(points))`.
import * as THREE from 'three'
import { call, degrees, describe, sm, vec } from './kernel.ts'
import { curveOf, BrepEdge, itemsOf, internal, operand, placedCurve, setCurve, Wire } from './shapes.ts'

const point = (v: THREE.Vector3Like | null | undefined) => (v == null ? null : vec(v))

/** A straight line from `start` to `end` (smlibpy's Line; `THREE.Line` is three's). */
export class Segment extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), end: THREE.Vector3Like = new THREE.Vector3(1, 0, 0)) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.Line(vec(start), vec(end))))
  }
}

/** A line `length` long from `start` in the direction `angle` radians from +x in the XY plane,
 * counterclockwise seen from +z (π/2: along +y). */
export class PolarLine extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), length = 1, angle = 0) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.PolarLine(vec(start), length, degrees(angle))))
  }
}

/** Straight lines through `points` (back to the first with `close`): a wire of one line per pair of
 * neighbouring points. */
export class Polyline extends Wire {
  constructor(points: readonly THREE.Vector3Like[] = [], options: { close?: boolean } = {}) {
    super()
    if (internal(this) || !points.length) return
    setCurve(this, call(() => sm.Polyline(points.map(vec), { close: options.close })))
  }
}

/** Straight lines through `points` with every corner rounded by an arc of `radius` (back to the
 * first with `close`). A polyline in a plane is rounded in its plane; one that is not, at each
 * corner in the plane of the two lines that meet there. */
export class FilletPolyline extends Wire {
  constructor(points: readonly THREE.Vector3Like[] = [], radius = 1, options: { close?: boolean } = {}) {
    super()
    if (internal(this) || !points.length) return
    setCurve(this, call(() => sm.FilletPolyline(points.map(vec), { radius, close: options.close })))
  }
}

/** A circle around `center`, or the arc of it from `startAngle` over `arcSize` (radians, from +x
 * counterclockwise seen from +z; a negative `arcSize` runs clockwise), in the plane of constant z
 * through `center`, as three's ArcCurve. `arcSize` 2π (the default) is the whole circle. */
export class CenterArc extends BrepEdge {
  constructor(center: THREE.Vector3Like = new THREE.Vector3(), radius = 1, startAngle = 0, arcSize = 2 * Math.PI) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.CenterArc(vec(center), radius, degrees(startAngle), degrees(arcSize))))
  }
}

/** The circular arc from `start` through `through` to `end` (in the plane of the three points). */
export class ThreePointArc extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), through: THREE.Vector3Like = new THREE.Vector3(1, 1, 0), end: THREE.Vector3Like = new THREE.Vector3(2, 0, 0)) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.ThreePointArc(vec(start), vec(through), vec(end))))
  }
}

/** Which side an arc between two points bulges to. */
export interface ArcSideOptions {
  /**
   * The direction the arc is seen from (default +z, the front): its left is the left of start to end
   * seen from there, and it lies in the plane through `start` and `end` that faces it. Give one for
   * two points one behind the other, or for an arc in another plane.
   */
  normal?: THREE.Vector3Like
}

/** The plane whose normal says where the left of an arc's chord is (the kernel's arcs take a plane),
 * or a RangeError for a chord along it. */
function sidePlane(start: THREE.Vector3Like, end: THREE.Vector3Like, normal: THREE.Vector3Like | undefined, what: string): sm.Plane | undefined {
  const n = new THREE.Vector3(0, 0, 1)
  if (normal !== undefined) n.set(normal.x, normal.y, normal.z)
  const chord = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z)
  if (chord.length() > 0 && n.length() > 0 && n.clone().cross(chord).length() <= 1e-12 * n.length() * chord.length()) {
    throw new RangeError(`${what}: the chord from start to end runs along the normal (${normal === undefined ? '+z, by default' : 'the one given'}), so it has no left side to bulge to; give a normal across it: { normal }`)
  }
  return normal === undefined ? undefined : call(() => new sm.Plane([0, 0, 0], null, vec(normal)))
}

/**
 * The shorter arc of `radius` from `start` to `end`. A positive radius bulges to the left of start to
 * end seen from +z (going along +x: towards +y), a negative one to the right; `normal` sees it from
 * elsewhere.
 */
export class RadiusArc extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), end: THREE.Vector3Like = new THREE.Vector3(2, 0, 0), radius = 1, options: ArcSideOptions = {}) {
    super()
    if (internal(this)) return
    const plane = sidePlane(start, end, options.normal, 'RadiusArc')
    setCurve(this, call(() => sm.RadiusArc(vec(start), vec(end), radius, plane)))
  }
}

/** The arc from `start` to `end` whose middle is `sagitta` from the middle of the chord: to its left
 * seen from +z for a positive sagitta (`normal` sees it from elsewhere), to its right for a
 * negative one. */
export class SagittaArc extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), end: THREE.Vector3Like = new THREE.Vector3(2, 0, 0), sagitta = 1, options: ArcSideOptions = {}) {
    super()
    if (internal(this)) return
    const plane = sidePlane(start, end, options.normal, 'SagittaArc')
    setCurve(this, call(() => sm.SagittaArc(vec(start), vec(end), sagitta, plane)))
  }
}

/** The arc from `start` to `end` that leaves `start` along `tangent` (a line if `end` lies straight
 * ahead). */
export class TangentArc extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), end: THREE.Vector3Like = new THREE.Vector3(1, 1, 0), tangent: THREE.Vector3Like = new THREE.Vector3(1, 0, 0)) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.TangentArc(vec(start), vec(end), vec(tangent))))
  }
}

/**
 * An ellipse around `center` in the plane of constant z through it, `xRadius` along x and `yRadius`
 * along y, or the arc of it from `startAngle` to `endAngle` (radians counterclockwise seen from +z),
 * as three's EllipseCurve: the point at angle a lies xRadius cos a along x and yRadius sin a along y
 * from the center. The arc runs counterclockwise, also across 0 (from 5π/3 to π/3 it passes +x);
 * equal angles give the whole ellipse.
 */
export class EllipticalArc extends BrepEdge {
  constructor(center: THREE.Vector3Like = new THREE.Vector3(), xRadius = 1, yRadius = 0.5, startAngle = 0, endAngle = 2 * Math.PI) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.EllipticalArc(vec(center), xRadius, yRadius, degrees(startAngle), degrees(endAngle))))
  }
}

/**
 * A piece of a parabola in the plane of constant z through its `vertex`, opening towards +y (a
 * negative `focalLength`: towards -y): the points `x` along x from the vertex and
 * `x² / (4 focalLength)` along +y from it, for `x` from `start` to `end`. Exact (a quadratic
 * B-spline). `new ParabolicArc(new THREE.Vector3(), 10, -20, 20)` runs from (-20, 10, 0) through the
 * vertex to (20, 10, 0); its focus is (0, 10, 0).
 */
export class ParabolicArc extends BrepEdge {
  constructor(vertex: THREE.Vector3Like = new THREE.Vector3(), focalLength = 1, start = -1, end = 1) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.ParabolicArc(vec(vertex), focalLength, start, end)))
  }
}

/**
 * A piece of the branch on the +x side of `center` of the hyperbola x²/xRadius² - y²/yRadius² = 1 in
 * the plane of constant z through `center`: from y = `start` to y = `end`. Its vertex is `xRadius` along x from the center, its asymptotes have
 * the slopes ±yRadius / xRadius. Exact (a rational quadratic B-spline).
 */
export class HyperbolicArc extends BrepEdge {
  constructor(center: THREE.Vector3Like = new THREE.Vector3(), xRadius = 1, yRadius = 1, start = -1, end = 1) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.HyperbolicArc(vec(center), xRadius, yRadius, start, end)))
  }
}

/**
 * A conic arc from `start` to `end`, tangent there to the lines towards `apex` (where the end
 * tangents meet), passing `rho` of the way from the middle of the chord to the apex (0 < rho < 1):
 * 0.5 a parabola, less an ellipse (flatter), more a hyperbola (fuller); √2 - 1 a circular arc for
 * a square corner. Exact (a rational quadratic B-spline).
 */
export class ConicArc extends BrepEdge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), apex: THREE.Vector3Like = new THREE.Vector3(1, 0, 0), end: THREE.Vector3Like = new THREE.Vector3(1, 1, 0), rho = 0.5) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.ConicArc(vec(start), vec(apex), vec(end), rho)))
  }
}

/**
 * A smooth cubic curve through `points`. `tangents`: the directions at the start and the end
 * (`[start, end]`, either may be null), or one at every point (the curve passes through each in its
 * direction); `closed`: a loop back to the first point, as smooth there as everywhere else.
 */
export class Spline extends BrepEdge {
  constructor(points: readonly THREE.Vector3Like[] = [], options: { tangents?: readonly (THREE.Vector3Like | null)[] | null; closed?: boolean } = {}) {
    super()
    if (internal(this) || !points.length) return
    const tangents = options.tangents == null ? options.tangents : options.tangents.map(point)
    setCurve(this, call(() => sm.Spline(points.map(vec), { tangents, closed: options.closed })))
  }
}

/** A Bézier curve of these control points (rational with `weights`, one per point). */
export class Bezier extends BrepEdge {
  constructor(points: readonly THREE.Vector3Like[] = [], options: { weights?: readonly number[] | null } = {}) {
    super()
    if (internal(this) || !points.length) return
    setCurve(this, call(() => sm.Bezier(points.map(vec), { weights: options.weights })))
  }
}

/** Options of Helix. */
export interface HelixOptions {
  /** The center of the circle it starts on (default the origin). */
  center?: THREE.Vector3Like
  /** The direction of its axis, which it rises along (default +z; another one turns where it
   * starts too). */
  direction?: THREE.Vector3Like
  /** The radius at its end: a conical helix (default `radius`). */
  endRadius?: number | null
  /** Turn the other way: clockwise seen from where it rises to (default counterclockwise). */
  leftHanded?: boolean
}

/**
 * A helix `height` high, rising `pitch` per turn, of `radius`: around z from the origin along +z, as
 * three's HelixCurve (addons) rises, starting on +x and turning counterclockwise seen from +z as it
 * rises (right-handed). Any number of turns.
 */
export class Helix extends BrepEdge {
  constructor(pitch = 1, height = 1, radius = 1, options: HelixOptions = {}) {
    super()
    if (internal(this)) return
    const o = { center: point(options.center) ?? undefined, direction: point(options.direction) ?? undefined, endRadius: options.endRadius, leftHanded: options.leftHanded }
    setCurve(this, call(() => sm.Helix(pitch, height, radius, o)))
  }
}

/**
 * A flat (Archimedean) spiral in the XY plane around the origin: its radius grows (or shrinks) evenly
 * with the angle from `startRadius` to `endRadius` over `turns` turns, starting on +x and turning
 * counterclockwise seen from +z (`clockwise`: the other way). Either radius may be 0. A B-spline
 * within 1e-4 of the exact spiral; `new Spiral(2, 20, 5)` runs from (2, 0, 0) to (20, 0, 0).
 */
export class Spiral extends BrepEdge {
  constructor(startRadius = 0, endRadius = 1, turns = 1, options: { clockwise?: boolean } = {}) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.Spiral(startRadius, endRadius, turns, undefined, { clockwise: options.clockwise })))
  }
}

/** Options of fitCurve. */
export interface FitCurveOptions {
  /** The largest distance from any point to the curve (default 1/1000 of the size of the points). */
  tolerance?: number | null
  /** The degree of the curve, 2 to 9 (default 3). */
  degree?: number
  /** Directions at the start and the end (`[start, end]`, either may be null), or one at every point
   * (a cubic curve that leaves each point near its direction); not for closed curves. */
  tangents?: readonly (THREE.Vector3Like | null)[] | null
  /** A closed curve, starting and ending near the first point, as smooth there as elsewhere. */
  closed?: boolean
}

/**
 * A smooth curve near many points (in order along it), with as few control points as keep it within
 * `tolerance` of every one: for scanned or sampled outlines and long polylines, where Spline passes
 * through every point and needs a control point for each. A least-squares B-spline, from the first
 * point to the last; fewer than six points give the Spline through them. A ModelingError says how
 * close the best fit came where none keeps within the tolerance.
 */
export function fitCurve(points: Iterable<THREE.Vector3Like>, options: FitCurveOptions = {}): BrepEdge {
  const pts = [...points].map(vec)
  const tangents = options.tangents == null ? options.tangents : (options.tangents.map(point) as sm.Vector[])
  return curveOf(call(() => sm.fitCurve(pts, { tolerance: options.tolerance, degree: options.degree, tangents, closed: options.closed }))) as BrepEdge
}

/**
 * Copies of the edges as B-splines of one degree and one knot vector, with the same shapes: their
 * control points correspond one to one, as surfaces through the curves need them. Lines and arcs
 * become B-splines too (arcs rational ones). The edges are taken where they are; the copies are
 * placed as the first edge is (in its frame, with its transform).
 */
export function makeCompatible(...edges: (BrepEdge | Iterable<BrepEdge>)[]): BrepEdge[] {
  const list = itemsOf<BrepEdge>(edges)
  for (const e of list as unknown[]) {
    if (!(e instanceof BrepEdge)) {
      throw new TypeError(`makeCompatible takes edges, not ${describe(e)}${e instanceof Wire ? ' (give wire.edges())' : ''}`)
    }
  }
  if (list.length < 2) throw new RangeError(`makeCompatible needs two or more edges, got ${list.length}`)
  const first = list[0]
  const kernel = list.map((e) => operand(e, first, 'makeCompatible') as sm.Edge)
  return call(() => sm.makeCompatible(kernel)).map((e) => placedCurve(e, first) as BrepEdge)
}
