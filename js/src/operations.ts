// Operations as functions.
//
// Each function is also available as a method (`extrude(sketch, 5)` is `sketch.extrude(5)`). The
// functions read naturally when the target is implied by a selection:
// `fillet(part.edges().parallelTo(Z), 2)` returns the filleted part the edges belong to.

import { ModelingError, _opts, _warn, ext, k, kernelCall } from './kernel.ts'
import { Axis, Plane, Vector, type Matrix, type VectorLike, Z, _direction } from './geometry.ts'
import { spread } from './_linalg.ts'
import { Line } from './curves.ts'
import {
  Edge,
  Face,
  type FilletOptions,
  type FilletRadius,
  Part,
  type Shape,
  ShapeList,
  Shell,
  Sketch,
  Vertex,
  Wire,
  _flattenEdges,
  _requireSolid,
  _revolveAxisAngle,
  _typeName,
} from './shapes.ts'

// biome-ignore lint: shapes of any kind
type Any = any

function _asSketch(profile: unknown): Sketch {
  if (profile instanceof Sketch) return profile
  if (profile instanceof Face) return profile.toSketch()
  if (profile instanceof ShapeList) return _asSketch(profile.one())
  if (profile instanceof Wire || profile instanceof Edge) {
    const w = profile instanceof Wire ? profile : new Wire([profile])
    return w.toSketch()
  }
  throw new TypeError(`expected a sketch, face or closed wire, got ${_typeName(profile)}`)
}

/** The profile as a wire if it is an open curve (which makes surfaces, not solids). */
function _openCurve(profile: unknown): Wire | null {
  if (profile instanceof ShapeList && profile.length && profile.every((e) => e instanceof Edge)) profile = new Wire([...profile] as Edge[])
  if (profile instanceof Edge) return profile.isClosed ? null : new Wire([profile])
  if (profile instanceof Wire) return profile.isClosed ? null : profile
  return null
}

function _curveDirection(w: Wire): Vector {
  const pts: number[][] = []
  for (let i = 0; i <= 16; i++) pts.push(w.pointAt(i / 16).toArray())
  const { values: sv, directions } = spread(pts)
  if (sv[1] > 1e-9 * Math.max(1, sv[0])) {
    const n = new Vector(directions[2])
    return n.z >= 0 ? n : n.neg()
  }
  return new Vector(0, 0, 1)
}

/** How a profile is extruded (see `Sketch.extrude`). */
export interface ExtrudeFunctionOptions {
  both?: boolean
  taper?: number
  direction?: Axis | VectorLike | null
}

/**
 * Extrude a sketch, a planar face or a closed wire into a solid (see `Sketch.extrude`).
 *
 * An open curve extrudes into a surface (a Shell), along `direction` (an axis or a vector) or the
 * normal of the curve's plane.
 */
export function extrude(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, amount: number, options: ExtrudeFunctionOptions = {}): Part | Shell {
  _opts('extrude', options)
  const { both = false, taper = 0, direction = null } = options
  let w = _openCurve(profile)
  if (w !== null) {
    const d = direction != null ? _direction(direction, 'extrude') : _curveDirection(w)
    if (both) {
      w = w.translate(d.mul(-Math.abs(amount)))
      amount = 2 * Math.abs(amount)
    }
    const curves = w._copyCurves()
    const sign = amount > 0 ? 1 : -1
    const b = kernelCall('extrude', () => k.linear_sweep(curves, d.mul(sign).toArray(), Math.abs(Number(amount)), { cap_ends: false }))
    return Shell._wrap(b)
  }
  return _asSketch(profile).extrude(amount, { both, taper, direction })
}

/**
 * Revolve a sketch about an axis into a solid (see `Sketch.revolve`).
 *
 * An open curve revolves into a surface of revolution (a Shell).
 */
export function revolve(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, axis: Axis | null = null, angle = 360): Part | Shell {
  const w = _openCurve(profile)
  if (w !== null) {
    const [ax, a] = _revolveAxisAngle(axis ?? Z, angle)
    const b = kernelCall(
      'revolve',
      () => k.rotational_sweep(w._copyCurves(), ax.origin.toArray(), ax.direction.toArray(), Number(a), { cap_ends: false }),
      'the axis must not cross the curve',
    )
    return Shell._wrap(b)
  }
  return _asSketch(profile).revolve(axis, angle)
}

/** Outer loop and holes of a loft section. */
function _sectionLoops(section: unknown): [Wire, Wire[]] {
  if (section instanceof ShapeList) section = section.one()
  if (section instanceof Sketch) {
    const faces = section.faces()
    if (faces.length !== 1) throw new RangeError('a loft section must be a single region')
    section = faces[0]
  }
  if (section instanceof Face) {
    const loops = section.wires()
    return [loops[0], loops.slice(1).map((w) => w.reversed())] // holes turned like the outline
  }
  if (section instanceof Wire) return [section, []]
  if (section instanceof Edge) return [new Wire([section]), []]
  throw new TypeError(`cannot loft through a ${_typeName(section)}`)
}

function _loftSolid(loops: readonly Wire[], degree: number): Part {
  const counts: number[] = []
  const curves: number[] = []
  for (const w of loops) {
    const c = w._copyCurves()
    curves.push(...c)
    counts.push(c.length)
  }
  const hint = 'sections should be closed, ordered and not intersect each other'
  const b = kernelCall('loft', () => k.create_skin_primitive(counts, curves, degree, true), hint)
  return _requireSolid(Part._wrap(b), 'loft', hint)
}

/**
 * A solid through a sequence of cross sections, or a surface through open curves.
 *
 * @param sections Two or more sections in order: sketches, planar faces or closed wires for a
 *   solid; open edges or wires for a surface (a Shell). Sections with holes make a hollow solid;
 *   every section needs the same number of holes.
 * @param options `ruled`: straight transitions between neighbouring sections. `smooth`: with four
 *   or more sections, pass through them with a cubic surface (`false`: quadratic). Three sections
 *   always give a quadratic one.
 */
export function loft(sections: readonly unknown[], options: { ruled?: boolean; smooth?: boolean } = {}): Part | Shell {
  _opts('loft', options)
  const { ruled = false, smooth = true } = options
  if (sections.length < 2) throw new RangeError('loft needs at least two sections')
  const opened = sections.map(_openCurve)
  if (opened.every((w) => w !== null)) {
    // One skin for single curves and chains alike, so that ruled and smooth hold for both (the
    // kernel's skin surface has no degree). With the default degree it is the same surface as that
    // skin.
    const wires = opened as Wire[]
    const counts = wires.map((w) => w.edges().length)
    const curves = wires.flatMap((w) => w._copyCurves())
    const degree = ruled ? 1 : Math.min(smooth ? 3 : 2, sections.length - 1)
    try {
      return kernelCall('loft', () => Shell._wrap(k.create_skin_primitive(counts, curves, degree, false)), 'curves should run in the same direction')
    } finally {
      for (const c of curves) ext.delete_curve(c)
    }
  }
  if (opened.some((w) => w !== null)) throw new RangeError('loft sections must be all closed (solid) or all open (surface)')
  const loops = sections.map(_sectionLoops)
  const degree = ruled ? 1 : Math.min(smooth ? 3 : 2, sections.length - 1)
  let result = _loftSolid(
    loops.map(([outer]) => outer),
    degree,
  )
  const holes = loops.map(([, h]) => h)
  if (holes.some((h) => h.length)) {
    if (new Set(holes.map((h) => h.length)).size !== 1) {
      throw new RangeError('loft: every section needs the same number of holes (a hole runs through the whole loft)')
    }
    for (const first of holes[0]) {
      const chain = [first]
      for (const hs of holes.slice(1)) {
        // the hole of the next section nearest to this one
        const c = chain[chain.length - 1].center()
        let best = hs[0]
        for (const w of hs.slice(1)) if (w.center().distanceTo(c) < best.center().distanceTo(c)) best = w
        chain.push(best)
      }
      result = result.cut(_loftSolid(chain, degree))
    }
  }
  return result
}

function _pathEdges(path: unknown): Edge[] {
  if (path instanceof Edge) return [path]
  let edges: Edge[]
  if (path instanceof Wire) edges = [...path.edges()]
  else if (path instanceof ShapeList) edges = [...new Wire([...path] as Edge[])._edges]
  else throw new TypeError(`a sweep path is an edge or a wire, got ${_typeName(path)}`)
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i]
    const b = edges[i + 1]
    if (!a.end.isClose(b.start, 1e-6 * Math.max(1, a.length, b.length))) {
      throw new RangeError(`the sweep path is not connected: a gap of ${_g4(a.end.distanceTo(b.start))} between ${a} and ${b}`)
    }
  }
  return edges
}

function _g4(v: number): string {
  return Number(v.toPrecision(4)).toString()
}

/** The sketch turned (by the smallest rotation about its center) to face along `tangent`. */
function _orientedTo(sk: Sketch, tangent: Vector): Sketch {
  let n = sk.plane.zDir
  if (n.dot(tangent) < 0) n = n.neg()
  const angle = n.angleTo(tangent)
  if (angle < 1e-9) return sk
  const axis = n.cross(tangent).normalized()
  return sk.rotate(new Axis(sk.bbox().center, axis), angle)
}

// -- the frame a profile is swept in ------------------------------------------------------------
// The kernel moves a profile to the start of the path by the center of the profile's box along the
// world axes. Turned to face along an oblique path, an asymmetric profile has a box along the world
// axes whose center is not its own: a triangle swept along (1, 1, 1) started 1.6667 before the
// path. So the profile is swept in its own frame, in its plane with its box along the axes there,
// along the path brought into that frame, and the body is placed back. Along a path of several
// edges, each piece starts in the frame the piece before ended in (turned at a corner by the
// smallest rotation from one tangent to the next), not turned afresh from the sketch: a rectangle
// turned by 90 degrees at the joints of a 3D path otherwise.
type V3 = [number, number, number]
/** Three axes, the columns of a rotation: x, y, z. */
type Axes = [V3, V3, V3]

const _dot3 = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const _cross3 = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const _norm3 = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2])
const _unit3 = (a: readonly number[]): V3 => {
  const l = _norm3(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
const _sub3 = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** The rotation that turns direction a into direction b, as a function on vectors: the smallest
 * one, or about `axis` (perpendicular to both) when given, also by half a turn. */
function _turn(a: readonly number[], b: readonly number[], axis: readonly number[] | null = null): (v: readonly number[]) => V3 {
  const ua = _unit3(a)
  const ub = _unit3(b)
  let k: V3
  if (axis === null) {
    k = _cross3(ua, ub)
    if (_norm3(k) < 1e-12) {
      if (_dot3(ua, ub) > 0) return (v) => [v[0], v[1], v[2]]
      k = _cross3(ua, Math.abs(ua[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
    }
  } else {
    k = [axis[0], axis[1], axis[2]]
  }
  k = _unit3(k)
  const angle = Math.atan2(_dot3(_cross3(ua, ub), k), _dot3(ua, ub))
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  // Rodrigues: v cos + (k x v) sin + k (k . v) (1 - cos)
  return (v) => {
    const kv = _cross3(k, v)
    const d = _dot3(k, v) * (1 - c)
    return [v[0] * c + kv[0] * sn + k[0] * d, v[1] * c + kv[1] * sn + k[1] * d, v[2] * c + kv[2] * sn + k[2] * d]
  }
}

function _placement(axes: Axes, origin: readonly number[]): Matrix {
  const m = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m[r * 4 + c] = axes[c][r]
    m[r * 4 + 3] = origin[r]
  }
  m[15] = 1
  return m
}

function _inverse(m: Matrix): Matrix {
  const out = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = m[c * 4 + r]
    out[r * 4 + 3] = -(m[r] * m[3] + m[4 + r] * m[7] + m[8 + r] * m[11])
  }
  out[15] = 1
  return out
}

const _tangent = (edge: Edge, t: number): V3 => _unit3(edge.tangentAt(t).toArray())
const _point = (edge: Edge, t: number): V3 => edge.pointAt(t).toArray() as V3

/** The axes of the profile's plane (x: the world X axis seen in the plane, Y where X is its
 * normal; z: the normal, the way the path starts) and the anchor: the center of the profile's box
 * along them. For a sketch in the XY plane, the center of its bounding box. */
function _profileFrame(sk: Sketch, tangent: V3): [Axes, V3] {
  let n = _unit3(sk.plane.zDir.toArray())
  if (_dot3(n, tangent) < 0) n = [-n[0], -n[1], -n[2]]
  const ref: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const x = _unit3(_sub3(ref, n.map((v) => v * _dot3(ref, n))))
  const axes: Axes = [x, _cross3(n, x), n]
  const origin = sk.plane.origin.toArray()
  const c = sk._transformed(_inverse(_placement(axes, origin))).bbox().center.toArray()
  const anchor: V3 = [0, 1, 2].map((r) => origin[r] + axes[0][r] * c[0] + axes[1][r] * c[1]) as V3
  return [axes, anchor]
}

/** A profile in its own frame (`sk`: in the XY plane, its anchor at the origin) swept along an
 * edge, placed by `placement` at the edge's start. */
function _swept(sk: Sketch, edge: Edge, placement: Matrix, translational: boolean, cap = true): Part | Shell {
  const local = edge._transformed(_inverse(placement))
  const curves = sk.faces().flatMap((f) => f.wires().flatMap((w) => w._copyCurves()))
  const pathCurve = local._copyCurve()
  const hint = "the profile may be too large for the path's curvature"
  let b: number
  try {
    b = kernelCall('sweep', () => ext.curve_sweep(curves, pathCurve, cap, true, false, translational, null, null), hint)
  } finally {
    ext.delete_curve(pathCurve)
    for (const c of curves) ext.delete_curve(c)
  }
  return (cap ? Part._wrap(b) : Shell._wrap(b))._transformed(placement) as Part | Shell
}

/** The axes a sweep along `edge` from `placement` ends with. Along a planar edge they turn about
 * its plane's normal as its tangent does (the kernel's frame keeps the normal); along a twisted
 * path they are read off a ribbon swept the same way (the kernel's frame is not the
 * rotation-minimizing one there: along a helix it turns some 40 degrees a turn). */
function _carried(edge: Edge, placement: Matrix, translational: boolean, size: number): Axes {
  const axes: Axes = [0, 1, 2].map((c) => [placement[c], placement[4 + c], placement[8 + c]]) as Axes
  if (translational) return axes
  const ts = _tangent(edge, 0)
  const te = _tangent(edge, 1)
  const { values, directions } = spread(Array.from({ length: 17 }, (_, i) => _point(edge, i / 16)))
  if (values[2] <= 1e-9 * Math.max(1, values[0])) {
    // planar
    if (values[1] <= 1e-9 * Math.max(1, values[0])) return axes // straight
    const turn = _turn(ts, te, directions[2])
    return axes.map(turn) as Axes
  }
  const local = edge._transformed(_inverse(placement))
  const curves = [Line([0, 0, 0], [size, 0, 0])._copyCurve()]
  const pathCurve = local._copyCurve()
  let ribbon: Shell
  try {
    ribbon = Shell._wrap(kernelCall('sweep', () => ext.curve_sweep(curves, pathCurve, false, true, false, false, null, null)))
  } finally {
    ext.delete_curve(pathCurve)
    ext.delete_curve(curves[0])
  }
  const p0 = _point(local, 0)
  const p1 = _point(local, 1)
  const edges = [...ribbon.edges()]
  const nearest = (p: V3) => edges.reduce((best, e) => (_norm3(_sub3(e.center().toArray(), p)) < _norm3(_sub3(best.center().toArray(), p)) ? e : best))
  const first = nearest(p0)
  const last = nearest(p1)
  // the marker's start at the start of the ribbon, and where the ribbon's side from it ends
  const [s0, s1] = [first.start.toArray(), first.end.toArray()]
  const a = s0[0] <= s1[0] ? s0 : s1
  const ends = [last.start.toArray(), last.end.toArray()]
  const side = edges.find(
    (e) => e !== first && e !== last && Math.min(_norm3(_sub3(e.start.toArray(), a)), _norm3(_sub3(e.end.toArray(), a))) < 1e-6 * Math.max(1, size),
  )!
  const [q0, q1] = [side.start.toArray(), side.end.toArray()]
  const tip = _norm3(_sub3(q0, a)) >= _norm3(_sub3(q1, a)) ? q0 : q1
  const far = _norm3(_sub3(ends[0], tip)) <= _norm3(_sub3(ends[1], tip)) ? 0 : 1
  const d = _sub3(ends[1 - far], ends[far])
  let x: V3 = [0, 1, 2].map((r) => axes[0][r] * d[0] + axes[1][r] * d[1] + axes[2][r] * d[2]) as V3
  x = _unit3(_sub3(x, te.map((v) => v * _dot3(x, te))))
  return [x, _cross3(te, x), te]
}

/** Whether the profile turns into itself about its anchor: circles about it. */
function _round(sk: Sketch, anchor: V3): boolean {
  const edges = sk.edges()
  const tol = 1e-9 * Math.max(1, sk.bbox().diagonal)
  return edges.length > 0 && edges.every((e) => e.geomType === 'circle' && e.isClosed && _norm3(_sub3(e.arcCenter.toArray(), anchor)) <= tol)
}

/** The edges in runs that meet tangentially (within 1e-6 rad); a new run at each corner. */
function _g1Chains(edges: readonly Edge[]): Edge[][] {
  const chains = [[edges[0]]]
  for (const e of edges.slice(1)) {
    const run = chains[chains.length - 1]
    if (_norm3(_sub3(_tangent(run[run.length - 1], 1), _tangent(e, 0))) <= 1e-6) run.push(e)
    else chains.push([e])
  }
  return chains
}

/** A run of edges as one edge (one B-spline curve): swept in one go, it has no joints. */
function _joined(chain: readonly Edge[]): Edge {
  if (chain.length === 1) return chain[0]
  const curves = chain.map((e) => e._copyCurve())
  try {
    return Edge._fromCurve(kernelCall('sweep', () => ext.join_curves(curves)))
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
}

/** How a profile is swept (see `sweep`). */
export interface SweepOptions {
  /** Turn the profile to be perpendicular to the path at its start (default). */
  orient?: boolean
  /** Keep the profile's orientation fixed instead of turning it with the path. */
  translational?: boolean
  /** For paths of several edges: miter the corners of a planar path (default for planar
   * paths); `false` sweeps the path piece by piece (each run of tangent edges in one go) and joins
   * the pieces. */
  sharpCorners?: boolean | null
}

/**
 * Sweep a profile along a path.
 *
 * The profile is moved so that the center of its box (along the axes of its plane) sits at the
 * start of the path and (with `orient`) turned to face along the path, so profiles can be drawn
 * anywhere, usually in the XY plane:
 *
 *     const tube = sweep(Circle(2), Spline([0, 0, 0], [0, 10, 20], [30, 10, 40]))
 *     const rail = sweep(Rectangle(4, 2), Helix(10, 40, 20))
 *
 * Edges of a path that meet tangentially are swept as one; at a corner of a path that is not
 * planar, the profile goes on turned by the smallest rotation from one tangent to the next. Where
 * the kernel cannot sweep an open path of several edges so, each edge is swept on its own, turned
 * to its own start, and the pieces are fused (with a warning unless the profile is round: it turns
 * where the edges meet).
 *
 * @param profile A sketch (holes allowed), a planar face or a closed wire.
 * @param path An edge, or a wire of connected edges.
 */
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options: SweepOptions = {}): Part | Shell {
  _opts('sweep', options)
  const { orient = true, translational = false } = options
  let sharpCorners = options.sharpCorners ?? null
  let edges = _pathEdges(path)
  const w = _openCurve(profile)
  if (w !== null) {
    // an open profile sweeps into a surface (also along a closed edge: only solids come out inside
    // out there)
    if (edges.length !== 1) throw new RangeError('surface sweeps need a single-edge path')
    const pc = edges[0]._copyCurve()
    const curves = w._copyCurves()
    let b: number
    try {
      b = kernelCall('sweep', () => ext.curve_sweep(curves, pc, false, true, orient, translational, null, null))
    } finally {
      ext.delete_curve(pc)
      for (const c of curves) ext.delete_curve(c)
    }
    return Shell._wrap(b)
  }
  const sk = _asSketch(profile)
  const closed = edges[0].start.isClose(edges[edges.length - 1].end, 1e-6 * Math.max(1, edges[0].length))
  const tangentClosure = closed && _norm3(_sub3(_tangent(edges[edges.length - 1], 1), _tangent(edges[0], 0))) <= 1e-6
  const planar = _isPlanarPath(edges)
  const halved = edges.length === 1 && edges[0].isClosed && (planar || !tangentClosure)
  // The kernel sweeps a profile along a closed single-edge path inside out (it caps the ends where
  // they meet); along the same path in two halves it works.
  if (halved) edges = _halves(edges[0])
  if (sharpCorners === null) sharpCorners = planar
  if (sharpCorners && edges.length > 1) {
    if (!planar) throw new RangeError('sharp-cornered sweeps need a planar path')
    const oriented = orient && !translational ? _orientedTo(sk, edges[0].tangentAt(0)) : sk
    const curves = oriented.faces().flatMap((f) => f.wires().flatMap((wire) => wire._copyCurves()))
    const pathCurves = edges.map((e) => e._copyCurve())
    const hint = "the profile may be too large for the path's corners"
    let b: number
    try {
      b = kernelCall('sweep', () => k.sweep_along_planar_path(curves.slice(), pathCurves, { move_profile: true }), hint)
    } finally {
      for (const c of curves) ext.delete_curve(c)
    }
    return _requireSolid(Part._wrap(b), 'sweep', hint)
  }
  const t0 = _tangent(edges[0], 0)
  let [axes, anchor] = _profileFrame(sk, t0)
  const local = sk._transformed(_inverse(_placement(axes, anchor)))
  if (orient && !translational) axes = axes.map(_turn(axes[2], t0)) as Axes
  const hint = "the profile may be too large for the path's curvature"
  try {
    return _carriedSweep(sk, local, edges, axes, anchor, halved, tangentClosure, translational, hint)
  } catch (err) {
    // An open path of several edges the kernel cannot sweep so (a circle along a 3D fillet polyline
    // joined into one curve fails at random) is swept edge by edge, each edge turned afresh, as
    // before the profile was carried along. Not closed paths: fused so, the pieces of kinked loops
    // crashed the kernel (4 of 60 random loops; carried, they raise).
    if (!(err instanceof ModelingError) || closed || edges.length < 2) throw err
    let out: Part
    try {
      out = _afreshSweep(local, edges, axes, orient, translational, hint)
    } catch (e) {
      if (!(e instanceof ModelingError)) throw e
      throw err
    }
    if (!_round(sk, anchor)) {
      _warn(`sweep: the profile could not be carried along the path (${err.message}); each of its ${edges.length} edges was swept turned to its own start instead, so the profile turns where they meet`)
    }
    return out
  }
}

/** A profile carried along a path: tangent edges in one go, the frame carried across corners. */
function _carriedSweep(sk: Sketch, local: Sketch, edges: Edge[], axes: Axes, anchor: V3, halved: boolean, tangentClosure: boolean, translational: boolean, hint: string): Part {
  let runs = halved ? edges.map((e) => [e]) : _g1Chains(edges)
  if (tangentClosure && runs.length === 1 && _round(sk, anchor)) {
    // (a profile that turns into itself, as in two halves before: exact)
    runs = _halves(_joined(edges)).map((e) => [e])
  } else if (tangentClosure && runs.length === 1) {
    // A closed path without a corner: swept in one go and closed where its ends meet (the kernel
    // spreads the turn of its frame around such a path, so they meet; in two halves a rectangle
    // turned by 10 degrees at the halfway point and 44 at the start).
    const chain = _joined(edges)
    const tube = _swept(local, chain, _placement(axes, _point(chain, 0)), translational, false)
    kernelCall('sweep', () => k.stitch_into_solid(tube._brep), hint)
    return _requireSolid(Part._wrap(tube._copyBrep()), 'sweep', hint)
  }
  const chains = runs.map((run) => _joined(run))
  const size = sk.bbox().diagonal
  let out: Part | null = null
  let placement: Matrix = _placement(axes, _point(chains[0], 0))
  chains.forEach((e, i) => {
    if (i) {
      axes = _carried(chains[i - 1], placement, translational, size)
      if (!translational) axes = axes.map(_turn(axes[2], _tangent(e, 0))) as Axes
    }
    placement = _placement(axes, _point(e, 0))
    const piece = _requireSolid(_swept(local, e, placement, translational) as Part, 'sweep', hint)
    out = out === null ? piece : out.fuse(piece)
  })
  return out as unknown as Part
}

/** The pieces swept on their own and fused, each turned afresh: by the smallest rotation from the
 * path's start tangent, either way along it, to the piece's own (the profile does not keep its
 * orientation where they meet; the way pieces were swept before the frame was carried). */
function _afreshSweep(local: Sketch, pieces: Edge[], axes: Axes, orient: boolean, translational: boolean, hint: string): Part {
  const t0 = _tangent(pieces[0], 0)
  let out: Part | null = null
  for (const e of pieces) {
    let turned = axes
    if (orient && !translational) {
      const t = _tangent(e, 0)
      turned = axes.map(_turn(_dot3(t0, t) >= 0 ? t0 : [-t0[0], -t0[1], -t0[2]], t)) as Axes
    }
    const piece = _requireSolid(_swept(local, e, _placement(turned, _point(e, 0)), translational) as Part, 'sweep', hint)
    out = out === null ? piece : out.fuse(piece)
  }
  return out as unknown as Part
}

/** A closed edge as two edges, split halfway along it. */
function _halves(edge: Edge): Edge[] {
  const c = edge._copyCurve()
  try {
    const [t0, t1] = k.curve_parameter_range(c)
    const [u] = ext.curve_parameter_at_length(c, t0, 0.5 * ext.curve_length(c, t0, t1))
    const tm = Number(u)
    return [Edge._fromCurve(ext.trimmed_curve(c, t0, tm)), Edge._fromCurve(ext.trimmed_curve(c, tm, t1))]
  } finally {
    ext.delete_curve(c)
  }
}

// Where a path is tested for lying in a plane: its ends, and 16 points between them off the halves
// and quarters. At 0, 1/4, 1/2 and 3/4 of a closed edge, symmetric 3D loops lie in a plane
// (Spline(...pts, pts[0]) through (20 cos a, 20 sin a, 6 sin 2a)): taken for planar, their halves
// went to the planar-path sweep, which gave no closed solid.
const PLANARITY_SAMPLES = [0, 1, ...Array.from({ length: 16 }, (_, i) => (i + 0.381966) / 16)]

function _isPlanarPath(edges: readonly Edge[]): boolean {
  const pts = edges.flatMap((e) => PLANARITY_SAMPLES.map((t) => e.pointAt(t).toArray() as number[]))
  const s = spread(pts).values
  return s[s.length - 1] <= 1e-7 * Math.max(1, s[0])
}

/** Round edges of the part they belong to (see `Part.fillet`), or corners of the sketch they
 * belong to: `fillet(s.vertices().concave(), 2)` (see `Sketch.fillet`). */
export function fillet(edges: unknown, radius: FilletRadius, options: FilletOptions = {}): Part | Sketch {
  const sk = _ownerSketch(edges)
  if (sk !== null) return sk.fillet(radius as number, edges as Iterable<Vertex>)
  return _ownerPart(edges).fillet(edges, radius, options)
}

/** Bevel edges of the part they belong to (see `Part.chamfer`), or corners of the sketch they
 * belong to (see `Sketch.chamfer`). */
export function chamfer(edges: unknown, length: number): Part | Sketch {
  const sk = _ownerSketch(edges)
  if (sk !== null) return sk.chamfer(length, edges as Iterable<Vertex>)
  return _ownerPart(edges).chamfer(edges, length)
}

/** The sketch that vertices belong to (null if the items are not vertices). */
function _ownerSketch(items: unknown): Sketch | null {
  const flat = items instanceof Vertex ? [items] : Array.isArray(items) ? [...items] : null
  if (!flat || !flat.length || !flat.every((v) => v instanceof Vertex)) return null
  const owner = (flat[0] as Vertex)._owner
  if (!(owner instanceof Sketch) || flat.some((v) => (v as Vertex)._owner !== owner)) {
    throw new RangeError('these vertices do not all belong to one sketch; call sketch.fillet(radius, vertices) or sketch.chamfer(length, vertices)')
  }
  return owner
}

function _ownerPart(items: unknown): Part {
  const flat = items instanceof Face ? [items] : _flattenEdges(items)
  const owner = flat.length ? (flat[0] as Edge | Face)._owner : null
  if (!(owner instanceof Part)) throw new RangeError('these edges do not belong to a part; call part.fillet(edges, ...) instead')
  return owner
}

/** Hollow out a part (see `Part.shell`). */
export function shell(part: Part, thickness: number, openings: unknown = null, options: { outward?: boolean } = {}): Part {
  _opts('shell', options)
  return part.shell(thickness, openings, options)
}

/** Grow or shrink a part or a sketch by `distance` (for a sketch also the option
 * `corners: "round" | "sharp" | "chamfer"`, see `Sketch.offset`). */
export function offset(shape: Part | Sketch, distance: number, options: { corners?: string; round?: boolean | null } = {}): Part | Sketch {
  if (shape instanceof Sketch) return shape.offset(distance, options)
  _opts('Part.offset', options) // (a part's offset takes none)
  return shape.offset(distance)
}

/** A mirrored copy of a shape. */
export function mirror<S extends Shape>(shape: S, plane: Plane | Face | Axis | ShapeList<Face> = Plane.XZ): S {
  return shape.mirror(plane)
}

/** Cut a part with a plane or along a sheet (see `Part.split`). */
export function split(part: Part, plane: Plane | Face | Shell, keep: 'above' | 'below' | 'both' = 'above'): Part | [Part, Part] {
  return keep === 'both' ? part.split(plane, 'both') : part.split(plane, keep)
}

/**
 * Parts as one part made of cells: overlaps become cells of their own, touching cells share their
 * faces (see `Part.merge`; `cells()` gives them as parts).
 */
export function merge(...parts: (Part | Iterable<Part>)[]): Part {
  const flat: unknown[] = []
  for (const p of parts) flat.push(...(p instanceof Part || !(Symbol.iterator in Object(p)) ? [p] : Array.from(p as Iterable<Part>)))
  if (flat.length < 2) throw new RangeError(`merge needs two or more parts, got ${flat.length}`)
  if (!(flat[0] instanceof Part)) throw new TypeError(`merge takes parts, not a ${_typeName(flat[0])}`)
  return flat[0].merge(...flat.slice(1))
}

/** Cross-section of a part (see `Part.section`). */
export function section(part: Part, plane: Plane | Face = Plane.XY): Sketch {
  return part.section(plane)
}

/** Turn a face or sheet into a solid of `thickness`. */
export function thicken(surface: Shell | Face, thickness: number): Part {
  if (surface instanceof Part || !(surface instanceof Shell || surface instanceof Face)) {
    throw new TypeError(`thicken takes a face or a sheet (Shell, Sketch), not a ${_typeName(surface)}; use shell() or offset() for parts`)
  }
  const sh = surface instanceof Face ? surface.toShell() : surface
  return sh.thicken(thickness)
}
