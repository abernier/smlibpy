// Operations as functions.
//
// Each function is also available as a method (`extrude(sketch, 5)` is `sketch.extrude(5)`). The
// functions read naturally when the target is implied by a selection:
// `fillet(part.edges().parallelTo(Z), 2)` returns the filleted part the edges belong to.

import { KernelError, ModelingError, _crashOf, _isCrash, _opts, _warn, ext, k, kernelCall, scope } from './kernel.ts'
import { _traced } from './_errors.ts'
import { Axis, Plane, Vector, type Matrix, type VectorLike, Z, _direction, _formatG, _vec } from './geometry.ts'
import { solve, spread } from './_linalg.ts'
import { Line, Spline, _basis } from './curves.ts'
import {
  Edge,
  type EdgesLike,
  Face,
  type ChamferOptions,
  type FacesLike,
  type FilletOptions,
  type FilletRadius,
  Part,
  type Shape,
  ShapeList,
  Shell,
  Sketch,
  Vertex,
  type WallsLike,
  Wire,
  _analyticRevolve,
  _canonicalCurve,
  _flattenEdges,
  _freed,
  _requireSolid,
  _revolveAxisAngle,
  _typeName,
  _withCurves,
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
  corners?: 'sharp' | 'round'
}

/**
 * Extrude a sketch, a planar face or a closed wire into a solid (see `Sketch.extrude`).
 *
 * An open curve extrudes into a surface (a Shell), along `direction` (an axis or a vector) or the
 * normal of the curve's plane; it takes no `taper` (RangeError).
 */
export function extrude(profile: Sketch | Face | ShapeList<Sketch | Face>, amount: number, options?: ExtrudeFunctionOptions): Part
export function extrude(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, amount: number, options?: ExtrudeFunctionOptions): Part | Shell
export function extrude(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, amount: number, options: ExtrudeFunctionOptions = {}): Part | Shell {
  _opts('extrude', options)
  const { both = false, taper = 0, direction = null, corners = 'sharp' } = options
  let w = _openCurve(profile)
  if (w !== null) {
    if (taper) {
      // (it was ignored before 0.5.0)
      throw new RangeError('extrude: an open curve extrudes into a surface without a taper; taper= needs a region (a sketch, a planar face or a closed wire)')
    }
    const d = direction != null ? _direction(direction, 'extrude') : _curveDirection(w)
    if (both) {
      w = w.translate(d.mul(-Math.abs(amount)))
      amount = 2 * Math.abs(amount)
    }
    const sign = amount > 0 ? 1 : -1
    const b = kernelCall('extrude', () =>
      _freed((w as Wire)._copyCurves(), (curves) => k.linear_sweep(curves, d.mul(sign).toArray(), Math.abs(Number(amount)), { cap_ends: false })),
    )
    return Shell._wrap(b)
  }
  return _asSketch(profile).extrude(amount, { both, taper, direction, corners })
}

/**
 * Revolve a sketch about an axis into a solid (see `Sketch.revolve`).
 *
 * An open curve revolves into a surface of revolution (a Shell).
 */
export function revolve(profile: Sketch | Face | ShapeList<Sketch | Face>, axis?: Axis | null, angle?: number): Part
export function revolve(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, axis?: Axis | null, angle?: number): Part | Shell
export function revolve(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, axis: Axis | null = null, angle = 360): Part | Shell {
  return scope(() => {
    const w = _openCurve(profile)
    if (w !== null) {
      const [ax, a] = _revolveAxisAngle(axis ?? Z, angle)
      const b = kernelCall(
        'revolve',
        () => _freed(w._copyCurves(), (curves) => k.rotational_sweep(curves, ax.origin.toArray(), ax.direction.toArray(), Number(a), { cap_ends: false })),
        'the axis must not cross the curve',
      )
      return _analyticRevolve<Shell>(b, Shell)
    }
    return _asSketch(profile).revolve(axis, angle)
  })
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

function _loftSolid(loops: readonly Wire[], degree: number, ends: _LoftEnds | null = null): Part {
  const counts: number[] = []
  const curves: number[] = []
  for (const w of loops) {
    const c = w._copyCurves()
    curves.push(...c)
    counts.push(c.length)
  }
  const hint = 'sections should be closed, ordered and not intersect each other'
  if (ends !== null) return _requireSolid(_freed(curves, () => ends.skin(curves, counts, degree, true, hint)) as Part, 'loft', hint)
  const b = kernelCall('loft', () => _freed(curves, () => k.create_skin_primitive(counts, curves, degree, true)), hint)
  return _requireSolid(Part._wrap(b), 'loft', hint)
}

// How far (radians) a loft may run off the asked-for tangent at its ends: a direction, a face.
const TANGENT_ANGLE = 1e-6
const FACE_ANGLE = 1e-3

/** How a loft meets its ends (`ext.skin`): the directions it leaves the first section in and reaches
 * the last in (unit vectors, faces that end there to continue, or null), or closed (from the last
 * section on to the first). */
class _LoftEnds {
  readonly start: Vector | Face | null
  readonly end: Vector | Face | null
  readonly closed: boolean

  constructor(start: Vector | Face | null, end: Vector | Face | null, closed: boolean) {
    this.start = start
    this.end = end
    this.closed = closed
  }

  /** The degree of the skin through `n` sections: each tangent is one more condition (two sections
   * and both tangents: cubic), a closed one runs through n + 1. */
  degree(n: number, ruled: boolean, smooth: boolean): number {
    if (ruled) return 1
    const conditions = n + (this.closed ? 1 : 0) + (this.start !== null ? 1 : 0) + (this.end !== null ? 1 : 0)
    return Math.min(smooth ? 3 : 2, conditions - 1)
  }

  /** The skin through the sections (kernel curves, `counts` each), checked: the kernel drops the
   * tangents silently where it cannot meet them. */
  skin(curves: number[], counts: number[], degree: number, cap: boolean, hint: string): Part | Shell {
    const start = this.start instanceof Vector ? this.start.toArray() : []
    const end = this.end instanceof Vector ? this.end.toArray() : []
    const startFace = this.start instanceof Face ? this.start._f : null
    const endFace = this.end instanceof Face ? this.end._f : null
    const [b, d0, d1] = kernelCall('loft', () => ext.skin(curves, counts, degree, start, end, this.closed, cap, startFace, endFace), hint) as [
      number,
      number,
      number,
    ]
    const body = cap ? Part._wrap(b) : Shell._wrap(b)
    for (const [which, dev, given] of [
      ['leave the first section along startTangent', d0, this.start],
      ['reach the last section along endTangent', d1, this.end],
    ] as [string, number, unknown][]) {
      // (tangent to a face whose direction across the section is no affine map of the point there, a
      // freeform face, the strip follows it at the section's control points only)
      if (dev > (given instanceof Face ? FACE_ANGLE : TANGENT_ANGLE)) {
        throw new ModelingError(
          `loft: the kernel cannot ${which} (it runs ${_formatG((dev * 180) / Math.PI, 3)} degrees off it there); turn the tangent more across the section, or add a section`,
        )
      }
    }
    return body
  }
}

/** The ends `startTangent`, `endTangent` and `closed` ask for (null for none). */
function _loftEnds(sections: readonly unknown[], startTangent: unknown, endTangent: unknown, closed: boolean, ruled: boolean): _LoftEnds | null {
  if (startTangent == null && endTangent == null && !closed) return null
  if (closed && (startTangent != null || endTangent != null)) {
    throw new RangeError('loft: a closed loft has no ends; startTangent and endTangent need closed false')
  }
  if (closed && sections.length < 3) throw new RangeError('loft: a closed loft needs three sections or more')
  if (ruled && !closed) throw new RangeError('loft: a ruled loft runs straight to its ends; startTangent and endTangent need ruled false')
  const dirs: (Vector | Face | null)[] = []
  for (const [name, given, section] of [
    ['startTangent', startTangent, sections[0]],
    ['endTangent', endTangent, sections[sections.length - 1]],
  ] as [string, unknown, unknown][]) {
    let value = given
    if (value == null) {
      dirs.push(null)
      continue
    }
    if (value instanceof ShapeList && value.length === 1 && value[0] instanceof Face) value = value[0]
    if (value instanceof Face) {
      // (the loft continues the face, which ends at the section: the section lies on it)
      const loop = _openCurve(section) ?? _sectionLoops(section)[0]
      const size = Math.max(1, loop.bbox().diagonal, value.bbox().diagonal)
      let off = 0
      for (let i = 0; i <= 16; i++) off = Math.max(off, value.distanceTo(loop.pointAt(i / 16)))
      if (off > 1e-6 * size) {
        throw new RangeError(`loft: ${name} is a face the loft continues, so the section must lie on it (where the face ends); it lies ${_formatG(off, 3)} off the face`)
      }
      dirs.push(value)
      continue
    }
    const d = _direction(value as Axis | VectorLike, `loft: ${name}`)
    const normal = _sectionNormal(section)
    if (normal !== null && Math.abs(d.dot(normal)) <= 1e-9) throw new RangeError(`loft: ${name} lies in the plane of the section; it must run across it`)
    dirs.push(d)
  }
  return new _LoftEnds(dirs[0], dirs[1], closed)
}

/** The unit normal of a planar section (null where it does not lie in a plane, or is straight). */
function _sectionNormal(section: unknown): Vector | null {
  const w = _openCurve(section) ?? _sectionLoops(section)[0]
  const pts: number[][] = []
  for (let i = 0; i <= 32; i++) pts.push(w.pointAt(i / 32).toArray())
  const { values: sv, directions } = spread(pts)
  if (sv[1] <= 1e-9 * Math.max(1, sv[0]) || sv[2] > 1e-9 * Math.max(1, sv[0])) return null
  return new Vector(directions[2])
}

/** Options of `loft`. */
export type LoftOptions = {
  ruled?: boolean
  smooth?: boolean
  startTangent?: Axis | VectorLike | Face | ShapeList<Face> | null
  endTangent?: Axis | VectorLike | Face | ShapeList<Face> | null
  closed?: boolean
  rails?: Edge | Wire | readonly (Edge | Wire)[] | null
}

/**
 * A solid through a sequence of cross sections, or a surface through open curves.
 *
 * @param sections Two or more sections in order: sketches, planar faces or closed wires for a
 *   solid; open edges or wires for a surface (a Shell). Sections with holes make a hollow solid;
 *   every section needs the same number of holes.
 * `startTangent` and `endTangent` set the direction the loft leaves its first section in and reaches its
 * last in, so that it meets the bodies there smoothly; a face there (one that ends at the section) makes
 * the loft continue it:
 *
 *     const neck = loft([Circle(10), Circle(4).moved(new Location([0, 0, 30]))], { startTangent: Z, endTangent: Z })
 *     const cap = loft([topRim, Circle(4).moved(new Location([0, 0, 30]))], { startTangent: can.faces().cylinders()[0] })
 *
 * `rails` are curves a loft of open sections runs along from its first section to its last, through
 * every section (guide curves): the surface passes through them as through the sections:
 *
 *     const panel = loft([s0, s1, s2], { rails: [keel, chine] })
 *
 * @param options `ruled`: straight transitions between neighbouring sections. `smooth`: with four
 *   or more sections, pass through them with a cubic surface (`false`: quadratic). Three sections
 *   always give a quadratic one. `startTangent`: the direction (an axis or a vector) the loft leaves the
 *   first section in: across it, usually along its normal (`Z` for a section in the XY plane, as an
 *   extrusion of it leaves it); only the direction counts, and the loft is cubic then. Or a face that ends
 *   at the first section (the section lies on it, usually along its edge): the loft leaves the section
 *   continuing the face, tangent to it all along the section (within 1e-6 radians where the face is a
 *   plane, a cylinder, a cone or a sphere about the section, 1e-3 on others). `endTangent`: the
 *   direction the loft reaches the last section in, or a face that ends at the last section, which the
 *   loft runs into tangentially. `closed`: run on from the last section through the first again,
 *   smoothly (three sections or more): a ring without ends. `rails`: a curve (an edge or a wire) or a
 *   list of them that run from the first section to the last and cross every section once, for open
 *   sections (a surface): the loft passes through them exactly, as through the sections (a Gordon
 *   surface through the sections and the rails, cubic or as near as the counts allow). Where no rail
 *   runs along the sections' starts or their ends, the loft's border there runs smoothly through them.
 *   Sections and rails must be smooth curves (each is joined into one). Not with `ruled`, the tangents
 *   or `closed`; closed sections along rails are not supported.
 */
export function loft(sections: readonly (Sketch | Face | ShapeList<Sketch | Face>)[], options?: LoftOptions): Part
export function loft(sections: readonly (Sketch | Face | Wire | Edge | ShapeList<Any>)[], options?: LoftOptions): Part | Shell
export function loft(sections: readonly (Sketch | Face | Wire | Edge | ShapeList<Any>)[], options: LoftOptions = {}): Part | Shell {
  return scope(() => {
    _opts('loft', options)
    const { ruled = false, smooth = true, startTangent = null, endTangent = null, closed = false, rails = null } = options
    if (sections.length < 2) throw new RangeError('loft needs at least two sections')
    if (rails != null) {
      if (ruled || closed || startTangent != null || endTangent != null) {
        throw new RangeError('loft: rails makes the loft run through the rails; it takes no ruled, closed, startTangent or endTangent')
      }
      return _railLoft(sections, rails)
    }
    const ends = _loftEnds(sections, startTangent, endTangent, closed, ruled)
    const opened = sections.map(_openCurve)
    if (opened.every((w) => w !== null) && ends !== null) {
      const wires = opened as Wire[]
      const counts = wires.map((w) => w.edges().length)
      const curves = wires.flatMap((w) => w._copyCurves())
      return _freed(curves, () => ends.skin(curves, counts, ends.degree(sections.length, ruled, smooth), false, 'curves should run in the same direction'))
    }
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
    const degree = ends !== null ? ends.degree(sections.length, ruled, smooth) : ruled ? 1 : Math.min(smooth ? 3 : 2, sections.length - 1)
    let result = _loftSolid(
      loops.map(([outer]) => outer),
      degree,
      ends,
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
        result = result.cut(_loftSolid(chain, degree, ends))
      }
    }
    return result
  })
}

// -- lofts along rails and two-rail sweeps (Gordon surfaces) -----------------------------------------
// The kernel's own rails (SmBSplineSurface::CreateSkinnedSurface) need as many sections as the rails
// have control points, and its two-rail sweep (CreateSweepSurface) misses its rails (0.31 with its
// default 4 control points between profiles, 1.6e-4 with 1024). A Gordon surface (NLib's
// N_CreateGordonSrf) passes through a whole network of curves: the sections one way, the rails the
// other. It is open both ways: through closed sections it had a crease where they are joined round
// (22 degrees), so rails take open sections (surfaces) only.

/** An edge, or a wire (or the outline of a sketch or face) joined into one edge. */
function _oneEdge(x: unknown, what: string): Edge {
  if (x instanceof ShapeList) x = x.length === 1 ? x.one() : new Wire([...x] as Edge[])
  if (x instanceof Sketch || x instanceof Face) x = _sectionLoops(x)[0]
  if (x instanceof Wire) return x.toEdge()
  if (x instanceof Edge) return x
  throw new TypeError(`${what} is an edge or a wire, got ${_typeName(x)}`)
}

/** The fraction of `a`'s length where `b` crosses it (the one crossing; RangeError where there is none). */
function _crossedAt(a: Edge, b: Edge, tol: number, what: string): number {
  const params = a.intersectionParams(b, { tolerance: tol })
  if (!params.length) throw new RangeError(`${what}: the curves do not cross (within ${_formatG(tol, 3)})`)
  return params[0]
}

// How close (a fraction of the network's size) the curves a Gordon surface is made of follow the
// sections and rails, and how far they may stay off (a corner in a section or a rail: no smooth curve
// follows it).
const NETWORK_FIT = 1e-8
const NETWORK_OFF = 1e-6

/** Cubic B-splines (kernel curves, parameters 0 to 1, one knot vector for all) along the edges, each at
 * its edge's fraction `marks[e][k]` of its length at the parameter `targets[k]` (both increasing, from 0
 * to 1), smoothly between (a monotone cubic of the parameter): fitted through points at common
 * parameters, more of them until each is within 1e-8 of `size` of its edge (ModelingError where 512
 * leave one more than 1e-6 of it off: a corner). */
function _reparametrized(edges: readonly Edge[], marks: readonly (readonly number[])[], targets: readonly number[], size: number, what: string): number[] {
  const maps = marks.map((m) => _monotoneCubic(targets.map((t, i) => [t, m[i]] as [number, number])))
  const clamp = (f: number): number => Math.min(1, Math.max(0, f))
  let n = 32
  let poles: number[][][] = []
  let knots: number[] = []
  let worst = 0
  for (;;) {
    const ts = Array.from({ length: n + 1 }, (_, i) => i / n)
    knots = [0, 0, 0, 0]
    for (let j = 0; j < ts.length - 4; j++) knots.push((ts[j + 1] + ts[j + 2] + ts[j + 3]) / 3)
    knots.push(1, 1, 1, 1)
    const a = ts.map((t) => _basis(knots, 3, t))
    const mids = Array.from({ length: n }, (_, k) => _basis(knots, 3, 0.5 * (ts[k] + ts[k + 1])))
    poles = []
    worst = 0
    edges.forEach((e, ei) => {
      const f = maps[ei]
      const q = ts.map((t) => e.pointAt(clamp(f(t))).toArray())
      const p = solve(a, q)
      poles.push(p)
      for (let k = 0; k < n; k++) {
        const g = e.pointAt(clamp(f(0.5 * (ts[k] + ts[k + 1])))).toArray()
        const m = [0, 0, 0]
        mids[k].forEach((b, j) => {
          for (let r = 0; r < 3; r++) m[r] += b * p[j][r]
        })
        worst = Math.max(worst, Math.hypot(m[0] - g[0], m[1] - g[1], m[2] - g[2]))
      }
    })
    if (worst <= NETWORK_FIT * size || n >= 512) break
    n *= 2
  }
  if (worst > NETWORK_OFF * size) {
    throw new ModelingError(
      `${what}: the sections and rails must be smooth curves; a smooth curve stays ${_formatG(worst, 3)} off one of them (a corner: loft the parts between corners on their own)`,
    )
  }
  const out: number[] = []
  try {
    for (const p of poles) out.push(kernelCall(what, () => _canonicalCurve(p, knots, 3, null)))
  } catch (err) {
    for (const c of out) ext.delete_curve(c)
    throw err
  }
  return out
}

/** The sheet through a network of curves (`ext.gordon`): the sections `us` one way and the rails `vs`
 * the other, the first and last of each its borders, every section crossing every rail once
 * (`vMarks`: where, as fractions of each rail's length, where known). The curves are made to cross at
 * common parameters first: section i at the same parameter of every rail, rail j at the same of every
 * section (their means; smoothly between). The kernel's own adjustment (CreateGordonSurface) left a
 * rail 0.29 off the surface between sections. */
function _gordon(us: readonly Edge[], vs: readonly Edge[], size: number, what: string, vMarks: number[][] | null = null): Shell {
  const tol = 1e-6 * size
  const marks = (a: Edge, others: readonly Edge[]): number[] =>
    others.map((b, j) => (j === 0 ? 0 : j === others.length - 1 ? 1 : _crossedAt(a, b, tol, `${what}: a section and a rail`)))
  const uMarks = us.map((u) => marks(u, vs)) // (where each section crosses the rails)
  const vm = vMarks ?? vs.map((v) => marks(v, us)) // (where each rail crosses the sections)
  for (const [name, ms] of [
    ['rails along a section', uMarks],
    ['sections along a rail', vm],
  ] as [string, number[][]][]) {
    if (ms.some((m) => m.slice(1).some((b, i) => !(b > m[i])))) throw new RangeError(`${what}: the ${name} must follow each other in the same order on every one`)
  }
  const uAt = vs.map((_, j) => uMarks.reduce((acc, m) => acc + m[j], 0) / us.length)
  const vAt = us.map((_, i) => vm.reduce((acc, m) => acc + m[i], 0) / vs.length)
  const curvesU = _reparametrized(us, uMarks, uAt, size, what)
  return _freed(curvesU, () => {
    const curvesV = _reparametrized(vs, vm, vAt, size, what)
    return _freed(curvesV, () =>
      kernelCall(what, () => Shell._wrap(ext.gordon(curvesU, vAt, curvesV, uAt)), 'every section must cross every rail once, and the sections and rails must run in order'),
    )
  })
}

/** `loft` along `rails`: a Gordon surface through the open sections and the rails. */
function _railLoft(sections: readonly unknown[], rails: unknown): Shell {
  const given = rails instanceof Edge || rails instanceof Wire ? [rails] : [...(rails as Iterable<unknown>)]
  if (!given.length) throw new RangeError('loft: rails needs one curve or more')
  const opened = sections.map(_openCurve)
  if (!opened.every((w) => w !== null)) {
    throw new RangeError('loft: rails takes open sections (edges or wires: a surface through them and the rails); closed sections along rails are not supported')
  }
  const secs = (opened as Wire[]).map((w) => _oneEdge(w, 'a section'))
  const rs = given.map((r) => _oneEdge(r, 'a rail'))
  const size = Math.max(1, ...[...secs, ...rs].map((e) => e.bbox().diagonal))
  const tol = 1e-6 * size
  // each rail from its crossing with the first section to that with the last (it may run on beyond)
  const trimmed = rs.map((r0, i) => {
    let r = r0
    let a = _crossedAt(r, secs[0], tol, `loft: rail ${i + 1} and section 1`)
    let b = _crossedAt(r, secs[secs.length - 1], tol, `loft: rail ${i + 1} and section ${secs.length}`)
    if (a > b) {
      r = r.reversed()
      a = 1 - a
      b = 1 - b
    }
    secs.slice(1, -1).forEach((sec, j) => _crossedAt(r, sec, tol, `loft: rail ${i + 1} and section ${j + 2}`))
    return a <= 1e-12 && b >= 1 - 1e-12 ? r : r.trim(a, b)
  })
  // the rails in their order across the sections; the borders through the sections' ends where no rail
  // runs along them
  const at = trimmed.map((r, i) => [_crossedAt(secs[0], r, tol, `loft: section 1 and rail ${i + 1}`), r] as [number, Edge])
  at.sort((x, y) => x[0] - y[0])
  const ordered = at.map(([, r]) => r)
  if (at[0][0] > 1e-9) ordered.unshift(Spline(...secs.map((s) => s.start)))
  if (at[at.length - 1][0] < 1 - 1e-9) ordered.push(Spline(...secs.map((s) => s.end)))
  return _gordon(secs, ordered, size, 'loft')
}

// The fewest and most profiles placed along the rails of a two-rail sweep (`_railSweep`), and how close
// (a fraction of the size) the surface through them passes the profile placed half way between two of
// them.
const RAIL_PROFILES: [number, number] = [8, 256]
const RAIL_FIT = 1e-6

/** `sweep` along the path and a second rail (`rails`): the open profile, which runs from the path to the
 * rail, moved, turned and scaled (the same in every direction) so that its ends stay on both, the frame
 * turning with the line from the path to the rail and the rails' mean direction; the surface through it
 * placed at evenly spaced fractions of the rails' lengths (more of them until the profile placed half
 * way between two lies on the surface within 1e-6 of the size) and through the two rails. */
function _railSweep(w: Wire, edges: readonly Edge[], rails: unknown): Shell {
  const rs = rails instanceof Edge || rails instanceof Wire ? [rails] : [...(rails as Iterable<unknown>)]
  if (rs.length !== 1) throw new RangeError('sweep: rails is the second rail, one curve (the path is the first)')
  let path = _oneEdge(edges.length > 1 ? Wire._raw([...edges]) : edges[0], 'sweep: the path')
  let rail = _oneEdge(rs[0], 'sweep: the rail')
  let prof = _oneEdge(w, 'sweep: the profile')
  const size = Math.max(1, path.bbox().diagonal, rail.bbox().diagonal, prof.bbox().diagonal)
  const tol = 1e-6 * size
  if (!(path.distanceTo(prof.start) <= tol && rail.distanceTo(prof.end) <= tol)) {
    if (path.distanceTo(prof.end) <= tol && rail.distanceTo(prof.start) <= tol) prof = prof.reversed()
    else throw new RangeError('sweep: with rails the profile runs from the path to the rail: its start on the path and its end on the rail (or the other way round)')
  }
  const a = path.paramAtPoint(prof.start)
  const b = rail.paramAtPoint(prof.end)
  if (a > 1e-12) path = path.trim(a, 1)
  if (b > 1e-12) rail = rail.trim(b, 1)
  const frame = (f: number): [Axes, V3, number] => {
    const p = path.pointAt(f).toArray() as V3
    const q = rail.pointAt(f).toArray()
    const chord = _sub3(q, p)
    const reach = _norm3(chord)
    const tp = _unit3(path.tangentAt(f).toArray())
    const tr = _unit3(rail.tangentAt(f).toArray())
    const m = [tp[0] + tr[0], tp[1] + tr[1], tp[2] + tr[2]]
    const x: V3 = [chord[0] / Math.max(reach, 1e-300), chord[1] / Math.max(reach, 1e-300), chord[2] / Math.max(reach, 1e-300)]
    const along = _dot3(m, x)
    const z0 = [m[0] - along * x[0], m[1] - along * x[1], m[2] - along * x[2]]
    if (!(reach > tol) || !(_norm3(z0) > 1e-9)) {
      throw new RangeError(
        `sweep: at ${_formatG(f, 4)} of the rails' lengths the path and the rail meet, or the line between them runs along them; the rails must stay apart, across the way they run`,
      )
    }
    const z = _unit3(z0)
    return [[x, _cross3(z, x), z], p, reach]
  }
  const [axes0, p0, reach0] = frame(0)
  const local = prof._transformed(_inverse(_placement(axes0, p0)))
  const placed = (f: number): Edge => {
    const [axes, p, reach] = frame(f)
    const m = _placement(axes, p)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 4 + c] *= reach / reach0
    return local._transformed(m)
  }
  let n = RAIL_PROFILES[0]
  for (;;) {
    const fs = Array.from({ length: n + 1 }, (_, i) => i / n)
    const sheet = _gordon(
      fs.map((f) => placed(f)),
      [path, rail],
      size,
      'sweep',
      [fs, fs],
    )
    const face = sheet.faces()[0]
    let off = 0
    for (let i = 0; i < n; i++) {
      const e = placed((i + 0.5) / n)
      for (let j = 1; j < 8; j++) off = Math.max(off, face.distanceTo(e.pointAt(j / 8)))
    }
    if (off <= RAIL_FIT * size) return sheet
    if (n >= RAIL_PROFILES[1]) {
      throw new ModelingError(
        `sweep: the surface along the rails stays ${_formatG(off, 3)} off the profile between the ${n + 1} places it was put at; the rails turn too fast for it`,
      )
    }
    n *= 2
  }
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
 * normal; z: the normal, the way the path starts) and the anchor (`anchor` of `sweep`): by default the
 * center of the profile's box along them (for a sketch in the XY plane, the center of its bounding
 * box). */
function _profileFrame(sk: Sketch, tangent: V3, anchor: unknown = null): [Axes, V3] {
  let n = _unit3(sk.plane.zDir.toArray())
  if (_dot3(n, tangent) < 0) n = [-n[0], -n[1], -n[2]]
  const ref: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const x = _unit3(_sub3(ref, n.map((v) => v * _dot3(ref, n))))
  const axes: Axes = [x, _cross3(n, x), n]
  const origin = sk.plane.origin.toArray()
  if (anchor != null && anchor !== 'center') {
    const given = anchor === 'origin' ? (origin as V3) : null
    return [axes, _anchorPoint(anchor, given, origin as V3, n, sk.bbox().diagonal)]
  }
  const c = sk._transformed(_inverse(_placement(axes, origin))).bbox().center.toArray()
  const at: V3 = [0, 1, 2].map((r) => origin[r] + axes[0][r] * c[0] + axes[1][r] * c[1]) as V3
  return [axes, at]
}

/** The point `anchor` names ('origin': `given`, the plane's origin; else a point, which must lie in
 * the profile's plane through `origin` with `normal`). */
function _anchorPoint(anchor: unknown, given: V3 | null, origin: V3, normal: V3, size: number): V3 {
  let p = given
  if (p === null) {
    if (typeof anchor === 'string') throw new RangeError(`sweep: anchor is 'center', 'origin' or a point, got '${anchor}'`)
    try {
      p = (anchor instanceof Vertex ? anchor.point : _vec(anchor as VectorLike)).toArray() as V3
    } catch {
      throw new TypeError(`sweep: anchor is 'center', 'origin' or a point, got ${_typeName(anchor)}`)
    }
  }
  const off = _dot3(_sub3(p, origin), normal)
  if (Math.abs(off) > 1e-6 * Math.max(1, size, _norm3(_sub3(p, origin)))) {
    throw new RangeError(
      `sweep: the anchor ${_fmt(p)} lies ${_formatG(Math.abs(off), 6)} off the profile's plane; it is a point of that plane (the point of the profile that goes on the path)`,
    )
  }
  return _sub3(p, _scale3(normal, off))
}

/** The point of a profile in its own frame that goes on the path (`ext.curve_sweep`'s reference). */
const AT_ORIGIN = [0, 0, 0]

/** A profile in its own frame (`sk`: in the XY plane, its anchor at the origin; a sketch, or an open
 * wire for a surface) swept along an edge, placed by `placement` at the edge's start. With `law` the
 * profile's x axis follows it along the edge (`span`: where the edge lies along the whole path, as
 * fractions of its length). */
function _swept(
  sk: Sketch | Wire,
  edge: Edge,
  placement: Matrix,
  translational: boolean,
  cap = true,
  law: _Law | null = null,
  span: [number, number] = [0, 1],
  scale: ((f: number) => number) | null = null,
): Part | Shell {
  const local = edge._transformed(_inverse(placement))
  let s0 = 1
  if (scale !== null) {
    s0 = scale(span[0])
    sk = sk.scale(s0) // (the kernel's scale law starts at 1)
  }
  const curves = sk instanceof Sketch ? sk.faces().flatMap((f) => f.wires().flatMap((w) => w._copyCurves())) : sk._copyCurves()
  const pathCurve = local._copyCurve()
  const hint = "the profile may be too large for the path's curvature"
  let b: number
  try {
    // (the profile's anchor, the origin of its frame, on the path: the kernel put the middle of the box of
    // the profile curves' control points there, a little beside it for arcs that do not span whole
    // quadrants)
    if (law === null && scale === null) {
      b = kernelCall('sweep', () => ext.curve_sweep(curves, pathCurve, cap, true, false, translational, null, null, AT_ORIGIN), hint)
    } else if (law === null) {
      const grow = scale as (f: number) => number
      const [reference, rule] = _scaleCurves(pathCurve, span, (f) => grow(f) / s0)
      b = _freed([reference, rule], () =>
        kernelCall('sweep', () => ext.curve_sweep(curves, pathCurve, cap, true, false, translational, reference, rule, AT_ORIGIN), hint),
      )
    } else {
      const [ts, xs] = law.axes(pathCurve, placement, span)
      const scales = scale === null ? null : _fractions(pathCurve, ts, span).map((f) => scale(f) / s0)
      b = kernelCall('sweep', () => ext.oriented_sweep(curves, pathCurve, ts, xs.flat(), cap, scales), hint)
    }
  } finally {
    ext.delete_curve(pathCurve)
    for (const c of curves) ext.delete_curve(c)
  }
  return (cap ? Part._wrap(b) : Shell._wrap(b))._transformed(placement) as Part | Shell
}

/** The axes (columns) of a placement. */
const _axesOf = (m: Matrix): Axes => [0, 1, 2].map((c) => [m[c], m[4 + c], m[8 + c]]) as Axes
/** rot v, rot^T v for axes (the columns of a rotation). */
const _rotate = (rot: Axes, v: readonly number[]): V3 => [0, 1, 2].map((r) => rot[0][r] * v[0] + rot[1][r] * v[1] + rot[2][r] * v[2]) as V3
const _unrotate = (rot: Axes, v: readonly number[]): V3 => [_dot3(rot[0], v), _dot3(rot[1], v), _dot3(rot[2], v)]
const _scale3 = (a: readonly number[], f: number): V3 => [a[0] * f, a[1] * f, a[2] * f]

// -- the profile's attitude along the path (up, twist, helices) ------------------------------------
// The kernel's sweep carries its frame along the path from one point to the next by the smallest turn
// (a rotation-minimizing frame): along a planar path the profile keeps its attitude to the plane, but
// along a helix it rolls about the path by some 30 degrees a turn (ai/todo/features.md, 10). A frame
// law gives the profile's x axis at every point instead (`ext.oriented_sweep`): kept at its angle to
// `up` (the component of `up` across the path), to the path's principal normal ('frenet'), or carried
// by the smallest turn as the kernel does, each turned on by `twist` along the path's length. Along a
// helix the default is its axis as `up`.

/** How often the samples of a frame law are doubled where the profile's x axis turns by more than 1/64
 * of a turn between two of them (64 a piece of the path at least, so 16384 then). */
const REFINE = 8

/** How the profile's x axis runs along a path: `mode` 'up' (at a fixed angle to `up` made
 * perpendicular to the path), 'frenet' (to the principal normal) or 'rmf' (carried by the smallest
 * turn), turned on by `twist(s)` radians at the fraction `s` of the path's length. `explicit`: asked
 * for (an implicit law, a helix's axis, falls back to the kernel's frame). */
class _Law {
  /** ('up', 'frenet') the profile's angle to the base direction */
  theta0: number | null = null
  /** (world) the x axis where the last piece swept ended */
  endX: V3 | null = null

  readonly mode: 'up' | 'frenet' | 'rmf'
  readonly up: V3 | null
  readonly twist: (s: number) => number
  readonly explicit: boolean
  /** (an implicit law that makes the profile meet itself round a loop with corners) */
  readonly closing: boolean

  constructor(mode: 'up' | 'frenet' | 'rmf', up: V3 | null, twist: (s: number) => number, explicit: boolean, closing = false) {
    this.mode = mode
    this.up = up
    this.twist = twist
    this.explicit = explicit
    this.closing = closing
  }

  /** The base direction (across the path) at a point of it: `d` the point and its first two
   * derivatives, `up` in the same frame, `size` the path's (`place`: the frame's placement in the
   * world, for messages). */
  _base(d: V3[], tangent: V3, up: V3 | null, size: number, place: Matrix | null = null): V3 {
    const where = () => _fmt(place === null ? d[0] : _rotate(_axesOf(place), d[0]).map((v, r) => v + place[r * 4 + 3]))
    if (this.mode === 'up') {
      const b = _sub3(up as V3, _scale3(tangent, _dot3(up as V3, tangent)))
      if (!(_norm3(b) > 1e-9)) {
        throw new RangeError(`sweep: the path runs along up at ${where()}; the profile's attitude to it is not defined there (pick another up, or twist alone)`)
      }
      return _unit3(b)
    }
    const b = _sub3(d[2], _scale3(tangent, _dot3(d[2], tangent))) // (frenet: towards the center of curvature)
    if (!(_norm3(b) > (1e-9 * _dot3(d[1], d[1])) / Math.max(size, 1e-300))) {
      throw new RangeError(`sweep: the path runs straight at ${where()}; up 'frenet' needs a path that bends everywhere (pick up a direction)`)
    }
    return _unit3(b)
  }

  /** The parameters of the kernel curve `c` (a piece of the path in the profile's frame at its start:
   * the x axis there is (1, 0, 0), `place` puts that frame in the world) at which the profile's x axis
   * is given, and the x axes there. Records the x axis at the end (world). */
  axes(c: number, place: Matrix, span: [number, number]): [number[], V3[]] {
    let ts = _sampleParameters(c)
    const theta0 = this.theta0
    let xs: V3[] = []
    for (let round = 0; round <= REFINE; round++) {
      this.theta0 = theta0
      xs = this._axes(c, ts, place, span)
      // (more samples where the x axis turns by more than 1/64 of a turn from one to the next)
      const far: number[] = []
      for (let i = 0; i + 1 < ts.length; i++) if (_dot3(xs[i], xs[i + 1]) < Math.cos(Math.PI / 32)) far.push(i)
      if (!far.length) break
      if (round === REFINE) throw this._spin(c, ts, xs, far, place)
      ts = [...ts, ...far.map((i) => 0.5 * (ts[i] + ts[i + 1]))].sort((a, b) => a - b)
    }
    this.endX = _rotate(_axesOf(place), xs[xs.length - 1])
    return [ts, xs]
  }

  /** The error for an x axis that turns faster than samples 2 ** REFINE times as dense as the first
   * follow it (half a turn within a ten-thousandth of the path, where 'frenet' passes a point at which
   * the path nearly straightens, or 'up' one at which it nearly runs along up). */
  _spin(c: number, ts: number[], xs: V3[], far: number[], place: Matrix): RangeError {
    const turn = (j: number) => Math.acos(Math.max(-1, Math.min(1, _dot3(xs[j], xs[j + 1]))))
    const i = far.reduce((best, j) => (turn(j) > turn(best) ? j : best), far[0])
    const angle = (turn(i) * 180) / Math.PI
    const q = (ext.curve_eval(c, 0.5 * (ts[i] + ts[i + 1]), 0) as number[][])[0]
    const p = _rotate(_axesOf(place), q).map((v, r) => v + place[r * 4 + 3])
    const step = ext.curve_length(c, ts[i], ts[i + 1]) as number
    const why = {
      frenet: "the path nearly straightens there, and up 'frenet' follows its principal normal round; pick up a direction",
      up: 'the path nearly runs along up there, and the profile keeps its attitude to it; pick up a direction the path does not run along',
      rmf: 'twist turns it that fast; twist it more slowly',
    }[this.mode]
    return new RangeError(`sweep: the profile would spin about the path at ${_fmt(p)}: it turns by ${_formatG(angle, 3)} degrees within ${_formatG(step, 3)} of it (${why})`)
  }

  _axes(c: number, ts: number[], place: Matrix, span: [number, number]): V3[] {
    const d = ts.map((t) => (ext.curve_eval(c, t, 2) as number[][]).map((v) => [v[0], v[1], v[2]] as V3))
    const tangents = d.map((x) => _unit3(x[1]))
    const speed = d.map((x) => _norm3(x[1]))
    const run = [0]
    for (let i = 1; i < ts.length; i++) run.push(run[i - 1] + 0.5 * (speed[i] + speed[i - 1]) * (ts[i] - ts[i - 1]))
    const total = run[run.length - 1]
    const s = run.map((r) => span[0] + ((span[1] - span[0]) * r) / total)
    const x0: V3 = [1, 0, 0]
    const points = d.map((x) => x[0])
    let size = 0
    for (let j = 0; j < 3; j++) size = Math.max(size, Math.max(...points.map((p) => p[j])) - Math.min(...points.map((p) => p[j])))
    size = Math.max(size, 1e-300)
    let base: V3[]
    let angles: number[]
    if (this.mode === 'rmf') {
      base = _rotationMinimizing(points, tangents, x0)
      if (_closes(points, tangents)) {
        // (closed without a corner: the turn the frame gains around the loop spread along it, as the
        // kernel spreads it, so that the ends meet)
        const gain = _signedAngle(base[base.length - 1], base[0], tangents[0])
        base = base.map((b, i) => _turned(b, tangents[i], (gain * run[i]) / total))
      }
      angles = s.map((si) => this.twist(si) - this.twist(span[0]))
    } else {
      const up = this.up !== null ? _unrotate(_axesOf(place), this.up) : null
      base = d.map((x, i) => this._base(x, tangents[i], up, size, place))
      if (this.theta0 === null) this.theta0 = _signedAngle(base[0], x0, tangents[0]) - this.twist(span[0])
      const theta0 = this.theta0
      angles = s.map((si) => theta0 + this.twist(si))
    }
    return base.map((b, i) => _turned(b, tangents[i], angles[i]))
  }

  /** ('up', 'frenet') The profile's axes at the start of the edge (world): x as the law gives it. */
  startAxes(e: Edge, s: number): Axes {
    const c = e._copyCurve()
    let d: V3[]
    try {
      d = (ext.curve_eval(c, k.curve_parameter_range(c)[0], 2) as number[][]).map((v) => [v[0], v[1], v[2]] as V3)
    } finally {
      ext.delete_curve(c)
    }
    const tangent = _unit3(d[1])
    const b = this._base(d, tangent, this.up, Math.max(e.length, 1e-300))
    const x = _turned(b, tangent, (this.theta0 ?? 0) + this.twist(s))
    return [x, _cross3(tangent, x), tangent]
  }
}

const _fmt = (p: readonly number[]): string => `(${[...p].map((v) => _formatG(v)).join(', ')})`

/** `v` (perpendicular to the unit `axis`) turned about it by `angle` (radians). */
const _turned = (v: V3, axis: V3, angle: number): V3 => {
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  const kv = _cross3(axis, v)
  return [c * v[0] + sn * kv[0], c * v[1] + sn * kv[1], c * v[2] + sn * kv[2]]
}

/** The angle (radians) that turns a into b about `axis`. */
const _signedAngle = (a: V3, b: V3, axis: V3): number => Math.atan2(_dot3(_cross3(a, b), axis), _dot3(a, b))

/** Parameters of a kernel curve to give the profile's x axis at: four (at least) in each knot span,
 * 64 at least in all (a helix of the kernel has about 32 spans a turn). */
function _sampleParameters(c: number): number[] {
  const [t0, t1] = k.curve_parameter_range(c) as [number, number]
  const knots = [...new Set((ext.curve_data(c, true).knots as number[]).filter((v) => t0 < v && v < t1))].sort((a, b) => a - b)
  const bounds = [t0, ...knots, t1]
  const per = Math.max(4, Math.ceil(64 / (bounds.length - 1)))
  const ts: number[] = []
  for (let i = 0; i + 1 < bounds.length; i++) for (let j = 0; j < per; j++) ts.push(bounds[i] + ((bounds[i + 1] - bounds[i]) * j) / per)
  ts.push(t1)
  return ts
}

/** The x axes of a frame carried along points with tangents by the smallest turns (the double
 * reflection method of Wang, Juettler, Zheng and Liu 2008), from `x0`. */
function _rotationMinimizing(points: V3[], tangents: V3[], x0: V3): V3[] {
  const out: V3[] = [_unit3(_sub3(x0, _scale3(tangents[0], _dot3(x0, tangents[0]))))]
  for (let i = 0; i + 1 < points.length; i++) {
    const v1 = _sub3(points[i + 1], points[i])
    const c1 = _dot3(v1, v1)
    let r = out[out.length - 1]
    if (c1 > 0) {
      const rL = _sub3(r, _scale3(v1, (2 / c1) * _dot3(v1, r)))
      const tL = _sub3(tangents[i], _scale3(v1, (2 / c1) * _dot3(v1, tangents[i])))
      const v2 = _sub3(tangents[i + 1], tL)
      const c2 = _dot3(v2, v2)
      r = c2 > 0 ? _sub3(rL, _scale3(v2, (2 / c2) * _dot3(v2, rL))) : rL
    }
    const t = tangents[i + 1]
    out.push(_unit3(_sub3(r, _scale3(t, _dot3(r, t)))))
  }
  return out
}

/** Whether samples of a curve end where they start, in the same direction. */
function _closes(points: V3[], tangents: V3[]): boolean {
  let size = 0
  for (let j = 0; j < 3; j++) size = Math.max(size, Math.max(...points.map((p) => p[j])) - Math.min(...points.map((p) => p[j])))
  return (
    _norm3(_sub3(points[points.length - 1], points[0])) <= 1e-6 * Math.max(1, size) &&
    _norm3(_sub3(tangents[tangents.length - 1], tangents[0])) <= 1e-6
  )
}

// -- the profile's scale along the path (scale) -------------------------------------------------------
// The kernel's curve sweep scales the profile by a law it reads off two curves (the distance of a scale
// curve from a reference curve, divided by that at the start, at the path's parameters; sampled at 30
// points at least and interpolated cubically), ext.oriented_sweep by values at the path's parameters.
// The law is given along the path's length, so it is sampled by arc length.

/** The scale `scale` asks for as a function of the fraction of the path's length (null for none):
 * `[start, end]` changes evenly along the length, `[[t, s], ...]` passes through the points (a piecewise
 * cubic that does not overshoot them), a function is called. */
function _scaleLaw(scale: unknown): ((s: number) => number) | null {
  if (scale === null || scale === undefined) return null
  let f: (s: number) => number
  if (typeof scale === 'function') {
    f = (s) => Number((scale as (s: number) => number)(s))
  } else {
    const what = `sweep: scale is [start, end], [[t, s], ...] or a function of the fraction of the path's length, got ${_typeName(scale)}`
    if (!Array.isArray(scale)) throw new TypeError(what)
    if (scale.length === 2 && scale.every((v) => typeof v === 'number')) {
      const [a, b] = scale as [number, number]
      f = (s) => a + (b - a) * s
    } else {
      if (!scale.every((p) => Array.isArray(p) && p.length === 2 && p.every((v: unknown) => typeof v === 'number'))) throw new TypeError(what)
      const pts = (scale as [number, number][]).map(([t, v]) => [t, v] as [number, number])
      if (pts.length < 2 || pts[0][0] !== 0 || pts[pts.length - 1][0] !== 1 || pts.some((p, i) => i > 0 && !(p[0] > pts[i - 1][0]))) {
        throw new RangeError('sweep: the points of a scale run from t = 0 to t = 1, t increasing')
      }
      f = _monotoneCubic(pts)
    }
  }
  for (let i = 0; i <= 64; i++) {
    const v = f(i / 64)
    if (!(Number.isFinite(v) && v > 0)) {
      throw new RangeError(`sweep: the scale must be positive along the whole path; it is ${_formatG(v)} at ${_formatG(i / 64)} of its length`)
    }
  }
  return f
}

/** The piecewise cubic through the points [t, s] whose slopes keep it between neighbouring points
 * (Fritsch and Carlson 1980, the end slopes as scipy's PCHIP takes them): it does not overshoot, so a
 * scale through positive points stays positive. */
function _monotoneCubic(pts: [number, number][]): (s: number) => number {
  const t = pts.map((p) => p[0])
  const y = pts.map((p) => p[1])
  const n = pts.length
  const h = t.slice(1).map((v, i) => v - t[i])
  const d = h.map((hi, i) => (y[i + 1] - y[i]) / hi)
  const m = new Array<number>(n).fill(d[0])
  if (n > 2) {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0
      else {
        const w1 = 2 * h[i] + h[i - 1]
        const w2 = h[i] + 2 * h[i - 1]
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
      }
    }
    const end = (h0: number, h1: number, d0: number, d1: number): number => {
      const v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
      if (v * d0 <= 0) return 0
      if (d0 * d1 <= 0 && Math.abs(v) > 3 * Math.abs(d0)) return 3 * d0
      return v
    }
    m[0] = end(h[0], h[1], d[0], d[1])
    m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3])
  }
  return (s) => {
    let i = n - 2
    for (let j = 0; j < n - 1; j++) {
      if (s < t[j + 1]) {
        i = j
        break
      }
    }
    i = Math.max(0, Math.min(n - 2, i))
    const u = (s - t[i]) / h[i]
    const h00 = (1 + 2 * u) * (1 - u) ** 2
    const h10 = u * (1 - u) ** 2
    const h01 = u * u * (3 - 2 * u)
    const h11 = u * u * (u - 1)
    return h00 * y[i] + h10 * h[i] * m[i] + h01 * y[i + 1] + h11 * h[i] * m[i + 1]
  }
}

/** The fractions of the whole path's length at the parameters `ts` (increasing, from the start of the
 * kernel curve `c` to its end) of a piece of it that lies at `span` of the path. */
function _fractions(c: number, ts: number[], span: [number, number]): number[] {
  const t0 = ts[0]
  const total: number = ext.curve_length(c, t0, ts[ts.length - 1])
  return ts.map((t) => span[0] + (span[1] - span[0]) * (t > t0 ? ext.curve_length(c, t0, t) / total : 0))
}

/** The reference and scale curves (kernel curves, the caller deletes them) that make the kernel's sweep
 * along the kernel curve `c` (a piece of the path at `span`) scale the profile by `ratio` (a function
 * of the fraction of the path's length, 1 at the start of the piece): the Z axis from -1 to 2, and a
 * cubic through (ratio, 0, z) at parameters evenly apart along the length, z running from 0 to 1 with
 * the parameter (its distance from the Z axis is the ratio). 65 such points, twice as many (up to 257)
 * while the cubic between them is more than 1e-7 of the scale off the law: the kernel reads the law at
 * the path's parameters, which run unevenly along the length of most paths (a spline with points
 * unevenly apart: 1.4e-3 off near its start with 65). */
function _scaleCurves(c: number, span: [number, number], ratio: (f: number) => number): [number, number] {
  const [t0, t1] = k.curve_parameter_range(c) as [number, number]
  const length: number = ext.curve_length(c, t0, t1)
  const fraction = (x: number): number => span[0] + (span[1] - span[0]) * (x > t0 ? (ext.curve_length(c, t0, x) as number) / length : 0)
  const fit = (n: number): [number[], number[][]] => {
    const u = [t0]
    for (let i = 1; i < n; i++) u.push(Number((ext.curve_parameter_at_length(c, t0, (length * i) / n) as number[])[0]))
    u.push(t1)
    const q = u.map((ui, i) => [ratio(span[0] + ((span[1] - span[0]) * i) / n), 0, (ui - t0) / (t1 - t0)])
    const knots = [t0, t0, t0, t0, ...u.slice(1, -1), t1, t1, t1, t1]
    // (the slope of the parabola through three points)
    const slope = (i0: number, i1: number, i2: number, at: number): number[] => {
      const [ua, ub, uc, x] = [u[i0], u[i1], u[i2], u[at]]
      const a = (2 * x - ub - uc) / ((ua - ub) * (ua - uc))
      const b = (2 * x - ua - uc) / ((ub - ua) * (ub - uc))
      const cc = (2 * x - ua - ub) / ((uc - ua) * (uc - ub))
      return [0, 1, 2].map((j) => q[i0][j] * a + q[i1][j] * b + q[i2][j] * cc)
    }
    const A: number[][] = []
    const B: number[][] = []
    A.push(_basis(knots, 3, u[0]))
    B.push(q[0])
    A.push(_basis(knots, 3, u[0], 1))
    B.push(slope(0, 1, 2, 0))
    for (let i = 1; i < n; i++) {
      A.push(_basis(knots, 3, u[i]))
      B.push(q[i])
    }
    A.push(_basis(knots, 3, u[n], 1))
    B.push(slope(n - 2, n - 1, n, n))
    A.push(_basis(knots, 3, u[n]))
    B.push(q[n])
    return [knots, solve(A, B)]
  }
  let n = 64
  let [knots, poles] = fit(n)
  while (n < SCALE_SAMPLES) {
    // the cubic's ratio half way between its points (by parameter) against the law there
    const top = Math.max(...poles.map((p) => Math.abs(p[0])))
    let off = 0
    for (let i = 3; i + 4 < knots.length; i++) {
      const m = 0.5 * (knots[i] + knots[i + 1])
      const b = _basis(knots, 3, m)
      const value = b.reduce((acc, w, j) => acc + w * poles[j][0], 0)
      off = Math.max(off, Math.abs(value - ratio(fraction(m))))
    }
    if (off <= 1e-7 * Math.max(top, 1e-300)) break
    n *= 2
    ;[knots, poles] = fit(n)
  }
  return kernelCall('sweep', () => {
    const rule = _canonicalCurve(poles, knots, 3, null)
    try {
      return [_canonicalCurve([[0, 0, -1], [0, 0, 2]], [0, 0, 1, 1], 1, null), rule]
    } catch (e) {
      ext.delete_curve(rule)
      throw e
    }
  })
}

/** The most points (+ 1) a scale law is read at for the kernel's sweep (`_scaleCurves`): it samples the
 * scale curve 10 times a knot, and its sweep with 513 took 60 times as long as with 257. */
const SCALE_SAMPLES = 256

/** The frame law `up` and `twist` ask for (null for neither). */
function _frameLaw(up: unknown, twist: unknown, orient: boolean, translational: boolean): _Law | null {
  let lawTwist: ((s: number) => number) | null
  if (typeof twist === 'function') {
    lawTwist = (s) => (Number((twist as (s: number) => number)(s)) * Math.PI) / 180
  } else {
    if (typeof twist !== 'number') {
      throw new TypeError(`sweep: twist is an angle in degrees or a function of the fraction of the path's length, got ${_typeName(twist)}`)
    }
    if (!Number.isFinite(twist)) throw new RangeError('sweep: twist must be a finite angle (degrees)')
    const total = twist
    lawTwist = total ? (s) => ((total * Math.PI) / 180) * s : null
  }
  if ((up === null || up === undefined) && lawTwist === null) return null
  if (translational || !orient) throw new RangeError('sweep: up and twist turn the profile along the path; they need orient true and translational false')
  let mode: 'up' | 'frenet' | 'rmf'
  let vec: V3 | null = null
  if (up === null || up === undefined) mode = 'rmf'
  else if (typeof up === 'string') {
    if (up !== 'frenet') throw new RangeError(`sweep: up is an axis, a vector or 'frenet', got '${up}'`)
    mode = 'frenet'
  } else {
    mode = 'up'
    vec = _direction(up as Axis | VectorLike, 'sweep: up').toArray() as V3
  }
  return new _Law(mode, vec, lawTwist ?? (() => 0), true)
}

/** For an open profile: the axes of its plane (z its normal, the way the path starts `t0`; a straight
 * profile: the normal of the plane that holds it and `t0`) and its anchor (`anchor` of `sweep`: by
 * default the center of its box along those axes). */
function _openFrame(w: Wire, t0: V3, anchor: unknown = null): [Axes, V3] {
  const pts = Array.from({ length: 33 }, (_, i) => w.pointAt(i / 32).toArray() as V3)
  const { values, directions } = spread(pts)
  let n: V3
  if (values[1] > 1e-9 * Math.max(1, values[0])) n = _unit3(directions[2])
  else {
    // (straight)
    const d = _unit3(directions[0])
    n = _sub3(t0, _scale3(d, _dot3(t0, d)))
    if (!(_norm3(n) > 1e-9)) throw new RangeError('sweep: an open straight profile that runs along the path\'s start makes no surface')
    n = _unit3(n)
  }
  if (_dot3(n, t0) < 0) n = _scale3(n, -1)
  const ref: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const x = _unit3(_sub3(ref, _scale3(n, _dot3(ref, n))))
  const axes: Axes = [x, _cross3(n, x), n]
  const origin = pts[0]
  if (anchor != null && anchor !== 'center') {
    const given: V3 | null = anchor === 'origin' ? [0, 0, 0] : null
    return [axes, _anchorPoint(anchor, given, origin, n, w.bbox().diagonal)]
  }
  const center = w._transformed(_inverse(_placement(axes, origin))).bbox().center.toArray()
  return [axes, _rotate(axes, center).map((v, r) => v + origin[r]) as V3]
}

/** An open profile swept along one edge into a surface, its attitude given by `law`: turned by the
 * smallest rotation from the normal of its plane to the path's start (a straight profile: from the
 * normal of the plane that holds it and the path's start tangent), its anchor on the path. */
function _framedSurface(w: Wire, edge: Edge, law: _Law, scale: ((f: number) => number) | null = null, anchor: unknown = null): Shell {
  const t0 = _tangent(edge, 0)
  let [axes, at] = _openFrame(w, t0, anchor)
  const local = w._transformed(_inverse(_placement(axes, at)))
  axes = axes.map(_turn(axes[2], t0)) as Axes
  law.theta0 = null
  return _swept(local, edge, _placement(axes, _point(edge, 0)), false, false, law, [0, 1], scale) as Shell
}

/** Whether the profile (about its anchor at the origin) turned by `turn` degrees is itself again (the
 * ends of a closed path meet). */
function _comesRound(local: Sketch, turn: number): boolean {
  const r = ((turn % 360) + 360) % 360
  if (Math.min(r, 360 - r) < 1e-6) return true
  const turned = local.rotate(new Axis([0, 0, 0], [0, 0, 1]), turn)
  return local.xor(turned).area <= 1e-9 * local.area
}

/** The angle (radians, about the path's start) by which a profile's x axis comes back turned round a
 * closed path of `chains` (runs of tangent edges, corners between them) when it is carried along it by
 * the smallest turns from `axes` (its axes at the start): the turn that `twist` must add along the
 * path for the ends to meet. */
function _closingGain(chains: Edge[][], axes: Axes): number {
  const t0 = _tangent(chains[0][0], 0)
  let x: V3 = axes[0]
  let tPrev = t0
  for (const chain of chains) {
    for (const e of chain) {
      const c = e._copyCurve()
      let d: V3[][]
      try {
        d = _sampleParameters(c).map((t) => (ext.curve_eval(c, t, 1) as number[][]).map((v) => [v[0], v[1], v[2]] as V3))
      } finally {
        ext.delete_curve(c)
      }
      const tangents = d.map((q) => _unit3(q[1]))
      x = _turn(tPrev, tangents[0])(x) // (at a corner, the smallest turn)
      const carried = _rotationMinimizing(
        d.map((q) => q[0]),
        tangents,
        x,
      )
      x = carried[carried.length - 1]
      tPrev = tangents[tangents.length - 1]
    }
  }
  x = _turn(tPrev, t0)(x)
  return _signedAngle(x, axes[0], t0)
}

/** The direction of the axis a path winds about at a constant pitch (a helix, also a conical one), or
 * null (`ext.helix_axis`: the curves' points to within 1e-5 of their size). */
function _helixAxis(edges: readonly Edge[]): V3 | null {
  const curves = edges.map((e) => e._copyCurve())
  let found: number[][] | null
  try {
    found = ext.helix_axis(curves, 1e-5)
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
  return found === null ? null : _unit3(found[1])
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
  // The kernel's frame carries the marker (the profile's x axis) from the start to the end; with the
  // tangent there, that is the turn the whole profile takes (also one not square to the path, as with
  // orient false: its axes are turned as they are, not made square to the path).
  const b = _unit3(_rotate(axes, _sub3(ends[1 - far], ends[far])))
  const c = _dot3(axes[0], ts)
  if (Math.abs(c) > 1 - 1e-9) return axes.map(_turn(ts, te)) as Axes // (the x axis along the path: no turn about it is seen)
  const m0 = _unit3(_sub3(axes[0], _scale3(ts, c)))
  let m1 = _sub3(b, _scale3(te, c))
  m1 = _unit3(_sub3(m1, _scale3(te, _dot3(m1, te))))
  const f0: Axes = [m0, _cross3(ts, m0), ts]
  const f1: Axes = [m1, _cross3(te, m1), te]
  // f1 f0^T v for each axis v
  return axes.map((v) => _rotate(f1, _unrotate(f0, v))) as Axes
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
  /** An axis or a direction the profile keeps its attitude to: along the whole path it stands at the
   * angle it starts at to `up` made perpendicular to the path (the path must not run along `up`).
   * `'frenet'`: to the path's principal normal (towards the center of its curvature; the path must
   * bend everywhere). Default: the axis of a helical path, the smallest turn on others. */
  up?: Axis | VectorLike | string | null
  /** Degrees the profile turns about the path on top of that, spread evenly along its length; or a
   * function of the fraction of the length (0 at the start, 1 at the end) that gives the angle in
   * degrees there (the profile starts turned by `twist(0)`). Along a closed path the profile must come
   * round into itself (a whole number of turns, or of its symmetry). */
  twist?: number | ((s: number) => number)
  /** The profile's scale along the path, about the point of it that sits on the path: `[start, end]`
   * changes evenly along the length; `[[t, s], ...]` passes through the scales `s` at the fractions `t`
   * of the length (from 0 to 1; a smooth curve that does not overshoot them); a function of the
   * fraction gives it. Positive everywhere; along a closed path the same at both ends. Planar paths of
   * several edges are then swept piece by piece (`sharpCorners: false`). */
  scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null
  /** The point of the profile that goes on the path (and that `scale` scales about): `'center'` (the
   * default: the center of its box along the axes of its plane), `'origin'` (the origin of the sketch's
   * plane, `Sketch.plane`: [0, 0] of a `Polygon` or `Profile` drawn on XY, the middle of a centered
   * shape such as `Circle`, moved with it; for a face, a wire or an edge the point [0, 0, 0]), or a
   * point (a vector or a vertex) of the profile's plane. */
  anchor?: 'center' | 'origin' | VectorLike | Vertex
  /** A second rail (an edge or a wire; the path is the first) for an open profile that runs from the
   * path to it: the profile is moved, turned and scaled (the same in every direction) so that its ends
   * stay on both, and the surface (a `Shell`) passes through both rails exactly. The profile's frame
   * turns with the line from the path to the rail and with the rails' mean direction; the rails are
   * matched by the fraction of their lengths, from where the profile meets them to their ends. Not with
   * `orient`, `translational`, `sharpCorners`, `up`, `twist`, `scale` or `anchor`, which the rails decide:
   *
   *     const hood = sweep(ThreePointArc([0, 0, 0], [10, 0, 4], [20, 0, 0]), left, { rails: right }) */
  rails?: Edge | Wire | null
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
 * `anchor` puts another point of the profile on the path: `'origin'` (the origin of the sketch's
 * plane) or a point of the profile's plane:
 *
 *     const lip = sweep(Rectangle(4, 2, { align: [Align.MIN, Align.MIN] }), rim, { anchor: [0, 0] }) // its corner
 *
 * Edges of a path that meet tangentially are swept as one; at a corner of a path that is not
 * planar, the profile goes on turned by the smallest rotation from one tangent to the next. Where
 * the kernel cannot sweep an open path of several edges so, each edge is swept on its own, turned
 * to its own start, and the pieces are fused (with a warning unless the profile is round: it turns
 * where the edges meet). A closed path it cannot sweep so (the fuse where the halves of a loop
 * closed with a kink cross) is swept in pieces as before 0.5.0, where that puts the profile on the
 * path. Faces without area that a fuse leaves are taken out (or the sweep throws `ModelingError`).
 * The corners of a planar path of several edges are mitered, the profile placed as on any other
 * path; where they cannot be (arcs that meet at a corner), the path is swept piece by piece, with a
 * warning.
 *
 * Along the path the profile turns as little as it can (a rotation-minimizing frame: on a planar path
 * it keeps its attitude to the plane), except along a helix (also a conical one), where it keeps its
 * attitude to the helix's axis, as a thread or a flat spring wire does. `up` and `twist` set the
 * attitude instead:
 *
 *     const rail = sweep(Rectangle(4, 2), path, { up: Z })  // stays upright: its angle to Z kept
 *     const bar = sweep(Rectangle(10, 2), Line([0, 0, 0], [0, 0, 100]), { twist: 180 })  // a half turn
 *
 * `scale` grows or shrinks the profile along the path, about the point that sits on it:
 *
 *     const horn = sweep(Circle(2), Spline([0, 0, 0], [0, 10, 20], [30, 10, 40]), { scale: [1, 3] })
 *     const spring = sweep(Circle(1), Helix(8, 40, 15), { scale: [[0, 1], [0.5, 1.5], [1, 1]] })
 *
 * A single line or arc is swept as an extrusion or a revolve (planes, cylinders, cones, spheres and
 * tori, not B-spline surfaces); a profile that reaches across the axis of an arc throws `ModelingError`
 * (it would sweep through itself).
 *
 * @param profile A sketch (holes allowed), a planar face or a closed wire.
 * @param path An edge, or a wire of connected edges.
 */
export function sweep(profile: Sketch | Face | ShapeList<Sketch | Face>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part | Shell
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options: SweepOptions = {}): Part | Shell {
  return scope(() => {
    _opts('sweep', options)
    const { orient = true, translational = false } = options
    let anchor: unknown = options.anchor ?? 'center'
    if (typeof anchor === 'string' && anchor !== 'center' && anchor !== 'origin') {
      throw new RangeError(`sweep: anchor is 'center', 'origin' or a point, got '${anchor}'`)
    }
    let sharpCorners = options.sharpCorners ?? null
    let edges = _pathEdges(path)
    if (options.rails != null) {
      const w = _openCurve(profile)
      if (w === null) {
        throw new RangeError(
          'sweep: rails sweeps an open profile (an edge or a wire from the path to the rail) into a surface; closed profiles along two rails are not supported',
        )
      }
      const twist = options.twist ?? 0
      if (
        !orient ||
        translational ||
        sharpCorners !== null ||
        options.up != null ||
        options.scale != null ||
        anchor !== 'center' ||
        typeof twist === 'function' ||
        Number(twist) !== 0
      ) {
        throw new RangeError(
          'sweep: with rails the path and the rail hold the profile\'s ends, which sets its attitude, size and place; it takes no orient, translational, sharpCorners, up, twist, scale or anchor',
        )
      }
      return _railSweep(w, edges, options.rails)
    }
    let law = _frameLaw(options.up ?? null, options.twist ?? 0, orient, translational)
    const grow = _scaleLaw(options.scale ?? null)
    const planar = _isPlanarPath(edges)
    if ((law === null || law.mode === 'rmf') && orient && !translational && !planar) {
      // (along a helix the profile keeps its attitude to the axis: the base of a twist too)
      const axis = _helixAxis(edges)
      if (axis !== null) law = new _Law('up', axis, law !== null ? law.twist : () => 0, law !== null)
    }
    const w = _openCurve(profile)
    if (w !== null) {
      // an open profile sweeps into a surface (also along a closed edge: only solids come out inside
      // out there)
      if (edges.length !== 1) throw new RangeError('surface sweeps need a single-edge path')
      if (law !== null) return _framedSurface(w, edges[0], law, grow, anchor)
      const at = _openFrame(w, _tangent(edges[0], 0), anchor)[1]
      // (about its anchor, which goes on the path)
      const open = grow === null ? w : w.scale(grow(0), new Vector(...at))
      const pc = edges[0]._copyCurve()
      const curves = open._copyCurves()
      let b: number
      try {
        const rules = grow === null ? [] : _scaleCurves(pc, [0, 1], (f) => grow(f) / grow(0))
        b = _freed(rules, () =>
          kernelCall('sweep', () => ext.curve_sweep(curves, pc, false, true, orient, translational, rules[0] ?? null, rules[1] ?? null, at)),
        )
      } finally {
        ext.delete_curve(pc)
        for (const c of curves) ext.delete_curve(c)
      }
      return Shell._wrap(b)
    }
    const sk = _asSketch(profile)
    if (anchor === 'origin' && !(profile instanceof Sketch)) anchor = [0, 0, 0] // (a face, a wire or an edge: the point [0, 0, 0])
    if (edges.length === 1 && law === null && grow === null) {
      const out = _analyticSweep(sk, edges[0], orient && !translational, anchor)
      if (out !== null) return out
    }
    const closed = edges[0].start.isClose(edges[edges.length - 1].end, 1e-6 * Math.max(1, edges[0].length))
    const tangentClosure = closed && _norm3(_sub3(_tangent(edges[edges.length - 1], 1), _tangent(edges[0], 0))) <= 1e-6
    // the pieces a path was swept in before 0.5.0: its edges, or the halves of a closed edge
    const whole = edges.length === 1 && edges[0].isClosed ? edges[0] : null
    const pieces = whole !== null ? _halves(whole) : edges
    const halved = edges.length === 1 && edges[0].isClosed && (planar || !tangentClosure)
    // The kernel sweeps a profile along a closed single-edge path inside out (it caps the ends where
    // they meet); along the same path in two halves it works.
    if (halved) edges = pieces
    const asked = sharpCorners
    if (sharpCorners === null) sharpCorners = planar && law === null && grow === null
    let mitreError: ModelingError | null = null
    if (sharpCorners && edges.length > 1) {
      if (!planar) throw new RangeError('sharp-cornered sweeps need a planar path')
      if (law !== null) throw new RangeError("sweep: mitered corners keep the profile square to the path's plane; up and twist need sharpCorners false")
      if (grow !== null) throw new RangeError("sweep: mitered corners keep the profile's size; scale needs sharpCorners false")
      try {
        return _mitredSweep(sk, edges, closed, orient && !translational, anchor)
      } catch (err) {
        if (!(err instanceof ModelingError) || asked || _isCrash(err)) throw _crashOf(err)
        mitreError = err // (arcs that meet at a corner: the kernel's planar-path sweep gives no solid)
      }
    }
    const t0 = _tangent(edges[0], 0)
    let [axes, own] = _profileFrame(sk, t0, anchor)
    const local = sk._transformed(_inverse(_placement(axes, own)))
    if (orient && !translational) axes = axes.map(_turn(axes[2], t0)) as Axes
    if (law !== null && closed) {
      const turn = ((law.twist(1) - law.twist(0)) * 180) / Math.PI
      if (!_comesRound(local, turn)) {
        throw new RangeError(
          `sweep: along a closed path the profile must come round into itself; twisted by ${_formatG(turn)} degrees it does not (twist by whole turns, or by a turn of its symmetry)`,
        )
      }
    }
    if (grow !== null && closed && !(Math.abs(grow(0) - grow(1)) <= 1e-9 * Math.max(Math.abs(grow(0)), Math.abs(grow(1))))) {
      throw new RangeError(
        `sweep: along a closed path the profile must come round into itself; scaled from ${_formatG(grow(0))} to ${_formatG(grow(1))} it does not (end with the scale it starts with)`,
      )
    }
    if (closed && !tangentClosure && !planar && orient && !translational && (law === null || law.mode === 'rmf') && !_round(sk, own)) {
      // Round a loop with a corner that is not planar, the frame carried by the smallest turns comes back
      // turned about the path (as the earth's axis turns round a loop of latitude): the profile did not
      // meet itself where the loop closes. The turn is spread along the length, as along a closed path
      // without a corner.
      const gain = _closingGain(halved ? edges.map((e) => [e]) : _g1Chains(edges), axes)
      if (Math.abs(gain) > 1e-9) {
        const base = law !== null ? law.twist : () => 0
        law = new _Law('rmf', null, (s) => base(s) + gain * s, law !== null ? law.explicit : false, true)
      }
    }
    const hint = "the profile may be too large for the path's curvature"
    let out: Part
    try {
      out = _carriedSweep(sk, local, edges, axes, own, halved, tangentClosure, translational, hint, law, grow)
    } catch (err) {
      if (!(err instanceof ModelingError) || _isCrash(err)) throw _crashOf(err)
      if (mitreError !== null) throw mitreError
      if (law !== null && law.explicit) throw err
      if (law !== null) {
        if (law.closing && halved && whole !== null) {
          // (the halves of a loop closed with a kink fuse where they meet tangentially: elsewhere than
          // halfway too, the same body)
          for (const at of [0.4, 0.6]) {
            try {
              return _carriedSweep(sk, local, _halves(whole, at), axes, own, halved, tangentClosure, translational, hint, law, grow)
            } catch (e) {
              if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
            }
          }
        }
        // (an implicit law, a helix's axis or the turn that closes a loop, that the kernel cannot sweep: its
        // own frame, as before 0.5.0)
        let back: Part
        try {
          back = _carriedSweep(sk, local, edges, axes, own, halved, tangentClosure, translational, hint, null, grow)
        } catch (e) {
          if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
          throw err
        }
        if (law.closing) {
          _warn(`sweep: the profile could not be made to meet itself where the loop closes (${err.message}); it turns about the path as the kernel's frame turns it`)
        } else if (!_round(sk, own)) {
          _warn(`sweep: the profile could not keep its attitude to the helix's axis (${err.message}); it turns about the path as the kernel's frame turns it`)
        }
        return back
      }
      if (pieces.length < 2) {
        const split = closed ? null : _splitSweep(sk, local, edges[0], axes, own, translational, hint, grow)
        if (split !== null) return split
        throw _bendError(err, local, edges, hint)
      }
      if (closed) {
        // A closed path the kernel cannot sweep carried along (the fuse where the halves of a loop
        // closed with a kink cross fails for some loops) is swept as before 0.5.0; a round profile
        // also turned about its center (the same profile, its seam elsewhere: the fuse goes for most
        // loops where it failed with the seam where it was).
        let out: Part | null = null
        try {
          out = grow !== null ? null : _formerSweep(sk, own, pieces, orient, translational, hint)
        } catch (e) {
          if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
        }
        if (out === null && _round(sk, own)) {
          const tries: [Edge[] | number, number][] = SEAM_TURNS.map((angle) => [edges, angle])
          // (a loop closed with a kink also split elsewhere than halfway, the profile's seam turned too:
          // the same body)
          if (halved && !tangentClosure && whole !== null) for (const at of SEAM_SPLITS) for (const angle of [0, 45, -45]) tries.push([at, angle])
          for (const [split, angle] of tries) {
            try {
              const turned = angle ? local.rotate(new Axis([0, 0, 0], [0, 0, 1]), angle) : local
              const pieces = typeof split === 'number' ? _halves(whole as Edge, split) : split
              out = _carriedSweep(sk, turned, pieces, axes, own, halved, tangentClosure, translational, hint, null, grow)
              break
            } catch (e) {
              if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
            }
          }
        }
        if (out === null) throw _bendError(err, local, edges, hint)
        return out
      }
      // An open path of several edges the kernel cannot sweep so (a circle along a 3D fillet polyline
      // joined into one curve fails at random) is swept edge by edge, each edge turned afresh, as
      // before the profile was carried along.
      let out: Part
      try {
        out = _afreshSweep(local, edges, axes, orient, translational, hint, grow)
      } catch (e) {
        if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
        throw _bendError(err, local, edges, hint)
      }
      if (!_round(sk, own)) {
        _warn(`sweep: the profile could not be carried along the path (${err.message}); each of its ${edges.length} edges was swept turned to its own start instead, so the profile turns where they meet`)
      }
      return out
    }
    if (mitreError !== null) {
      _warn(`sweep: the corners of this planar path cannot be mitered (${mitreError.message}); it was swept piece by piece instead, as with sharpCorners false`)
    }
    return out
  })
}

/** A profile swept along a single line as an extrusion, along a single arc (or circle) as a revolve:
 * planes, cylinders, cones, spheres and tori, where the kernel's curve sweep makes B-spline surfaces
 * (that a path split into several edges did not: the type of the faces depended on how the path was
 * split). The profile placed as on any other path (`turn`: turned to face along the path). Null for
 * other edges, an arc without `turn`, and where the kernel cannot make it. Throws where the profile
 * reaches across the arc's axis (it would sweep through itself). */
function _analyticSweep(sk: Sketch, edge: Edge, turn: boolean, anchor: unknown = null): Part | null {
  const kind = edge.geomType
  if ((kind !== 'line' && kind !== 'circle') || (kind === 'circle' && !turn)) return null
  const t0 = _tangent(edge, 0)
  let [axes, own] = _profileFrame(sk, t0, anchor)
  const local = sk._transformed(_inverse(_placement(axes, own)))
  if (turn) axes = axes.map(_turn(axes[2], t0)) as Axes
  else if (Math.abs(_dot3(axes[2], t0)) <= 1e-9) return null // (the profile's plane along the path)
  const start = _point(edge, 0)
  const placed = local._transformed(_placement(axes, start)) as Sketch
  let axis: Axis | null = null
  if (kind === 'circle') {
    const center = edge.arcCenter.toArray()
    axis = new Axis(center, _unit3(_cross3(_sub3(start, center), t0)))
    try {
      placed._checkAxisBeside(axis, false)
    } catch (e) {
      if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
      throw new ModelingError(
        `sweep: the profile reaches across the axis of the arc (radius ${_formatG(edge.radius)}), so it would sweep through itself; use a smaller profile or a larger radius`,
      )
    }
  }
  let out: Part
  try {
    if (axis === null) out = placed.extrude(edge.length, { direction: new Vector(t0) })
    else out = placed.revolve(axis, edge.isClosed ? 360 : ((edge.length / edge.radius) * 180) / Math.PI)
  } catch (e) {
    if (!(e instanceof ModelingError || e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
    return null
  }
  out.name = null
  out.color = null
  return out
}

// How far a round profile is turned about its center (degrees) where a closed path fails with it as
// it is: with its seam turned by one of these (or the loop split elsewhere), most random loops
// closed with a kink that failed go (circles of radius 1.5 along 60 random loops: all 60, 37 before
// 0.5.0).
const SEAM_TURNS = [20, -20, 45, -45, 70, -70, 100, -100, 135, -135]
// Where else (fractions of its length) a loop closed with a kink is split into the two pieces that are
// fused, each with the round profile's seam as it is and turned by 45 degrees either way: 2 more of 30
// hard loops go, in both builds. (Which tries go depends on rounding: the native build and smlibwasm
// differ on 4 of 60 such loops, also with fused multiply-adds turned off natively.)
const SEAM_SPLITS = [0.4, 0.6, 0.3, 0.7]

/** A sweep's error about the path's curvature with the numbers: where the path bends most tightly and
 * how far the profile reaches from it (the same error where that is not known). */
function _bendError(err: ModelingError, local: Sketch, edges: Edge[], hint: string): ModelingError {
  if (!err.message.includes(hint)) return err
  let r = Infinity
  let t = 0
  let e: Edge = edges[0]
  let reach = 0
  try {
    for (const x of edges) {
      const [rx, tx] = x._minRadius()
      if (rx < r) [r, t, e] = [rx, tx, x]
    }
    for (const q of local.edges()) for (let i = 0; i <= 16; i++) reach = Math.max(reach, q.pointAt(i / 16).length)
  } catch (ex) {
    if (!(ex instanceof ModelingError || ex instanceof RangeError) || _isCrash(ex)) throw _crashOf(ex)
    return err
  }
  if (!Number.isFinite(r)) return err
  const p = e.pointAt(t)
  const g = (v: number) => _formatG(v, 4)
  const detail = `the path bends with a radius of ${g(r)} at (${g(p.x)}, ${g(p.y)}, ${g(p.z)}) (Edge.minRadius), and the profile reaches ${g(reach)} from the path`
  if (err instanceof KernelError) return _traced(new KernelError(err.operation, err.detail, err.status, err.hint ? `${err.hint}: ${detail}` : detail), err.trace)
  return new ModelingError(`${err.message}: ${detail}`)
}

/** A profile carried along a path: tangent edges in one go, the frame carried across corners (or,
 * with `law`, given by it). */
function _carriedSweep(
  sk: Sketch,
  local: Sketch,
  edges: Edge[],
  axes: Axes,
  anchor: V3,
  halved: boolean,
  tangentClosure: boolean,
  translational: boolean,
  hint: string,
  law: _Law | null = null,
  scale: ((f: number) => number) | null = null,
): Part {
  let runs = halved ? edges.map((e) => [e]) : _g1Chains(edges)
  if (tangentClosure && edges.length === 1 && _round(sk, anchor)) {
    // A profile that turns into itself along a smooth closed edge: in two halves, as before (exact;
    // swept in one go and closed, a circle came out up to 5e-5 short). Not the halves of edges
    // joined into one curve: the kernel cannot sweep a circle along most halves of a closed 3D
    // fillet polyline (SM_ERR), and in one go it can.
    runs = _halves(edges[0]).map((e) => [e])
  } else if (tangentClosure && runs.length === 1) {
    // A closed path without a corner: swept in one go and closed where its ends meet (the kernel
    // spreads the turn of its frame around such a path, so they meet; in two halves a rectangle
    // turned by 10 degrees at the halfway point and 44 at the start).
    const chain = _joined(edges)
    if (law !== null) law.theta0 = null
    const tube = _swept(local, chain, _placement(axes, _point(chain, 0)), translational, false, law, [0, 1], scale)
    kernelCall('sweep', () => k.stitch_into_solid(tube._brep), hint)
    return _sound(Part._wrap(tube._copyBrep()), hint)
  }
  const chains = runs.map((run) => _joined(run))
  const size = sk.bbox().diagonal
  const lengths = chains.map((e) => e.length)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const total = sum(lengths)
  if (law !== null) law.theta0 = null
  let out: Part | null = null
  let placement: Matrix = _placement(axes, _point(chains[0], 0))
  chains.forEach((e, i) => {
    const span: [number, number] = [sum(lengths.slice(0, i)) / total, sum(lengths.slice(0, i + 1)) / total]
    if (i && law !== null && law.mode !== 'rmf') {
      axes = law.startAxes(e, span[0]) // (the law's own attitude, also after a corner)
    } else if (i) {
      if (law !== null) {
        // (carried as the kernel carries it, the twist on top)
        const te = _tangent(chains[i - 1], 1)
        const x = law.endX as V3
        axes = [x, _cross3(te, x), te]
      } else {
        axes = _carried(chains[i - 1], placement, translational, size)
      }
      // (at a corner, the smallest turn from one tangent to the next)
      if (!translational) axes = axes.map(_turn(_tangent(chains[i - 1], 1), _tangent(e, 0))) as Axes
    }
    placement = _placement(axes, _point(e, 0))
    const piece = _requireSolid(_swept(local, e, placement, translational, true, law, span, scale) as Part, 'sweep', hint)
    out = out === null ? piece : out.fuse(piece)
  })
  return chains.length < 2 ? (out as unknown as Part) : _sound(out as unknown as Part, hint)
}

/** A long edge that the kernel cannot sweep in one go with its own frame: in 2, 4 or 8 pieces, the
 * frame carried from one to the next (they meet tangentially, so the profile does not turn there),
 * fused. NLib places at most about 1000 sections along a path (the kernel's own frame, as orient false
 * keeps it, failed along more than some 60 turns of a helix). Null where the profile does not fit the
 * path's curvature (that is what the failure says then) or no split goes. */
function _splitSweep(
  sk: Sketch,
  local: Sketch,
  edge: Edge,
  axes: Axes,
  own: V3,
  translational: boolean,
  hint: string,
  scale: ((f: number) => number) | null,
): Part | null {
  let r: number
  let reach = 0
  try {
    r = edge._minRadius()[0]
    for (const q of local.edges()) for (let i = 0; i <= 16; i++) reach = Math.max(reach, q.pointAt(i / 16).length)
  } catch (ex) {
    if (!(ex instanceof ModelingError || ex instanceof RangeError) || _isCrash(ex)) throw _crashOf(ex)
    return null
  }
  if (!(Number.isFinite(r) && r > reach)) return null
  for (const n of [2, 4, 8]) {
    try {
      return _carriedSweep(sk, local, _split(edge, n), axes, own, true, false, translational, hint, null, scale)
    } catch (e) {
      if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
    }
  }
  return null
}

/** An edge as `n` edges of equal length, end to end. */
function _split(edge: Edge, n: number): Edge[] {
  const c = edge._copyCurve()
  try {
    const [t0, t1] = k.curve_parameter_range(c)
    const total = ext.curve_length(c, t0, t1) as number
    const ts = [t0, ...Array.from({ length: n - 1 }, (_, i) => Number(ext.curve_parameter_at_length(c, t0, (total * (i + 1)) / n)[0])), t1]
    return ts.slice(1).map((b, i) => Edge._fromCurve(ext.trimmed_curve(c, ts[i], b)))
  } finally {
    ext.delete_curve(c)
  }
}

/** The pieces swept on their own and fused, each turned afresh: by the smallest rotation from the
 * path's start tangent, either way along it, to the piece's own (the profile does not keep its
 * orientation where they meet; the way pieces were swept before the frame was carried). */
function _afreshSweep(
  local: Sketch,
  pieces: Edge[],
  axes: Axes,
  orient: boolean,
  translational: boolean,
  hint: string,
  scale: ((f: number) => number) | null = null,
): Part {
  const t0 = _tangent(pieces[0], 0)
  const lengths = pieces.map((e) => e.length)
  const total = lengths.reduce((a, b) => a + b, 0)
  let out: Part | null = null
  let before = 0
  for (const [i, e] of pieces.entries()) {
    let turned = axes
    if (orient && !translational) {
      const t = _tangent(e, 0)
      turned = axes.map(_turn(_dot3(t0, t) >= 0 ? t0 : [-t0[0], -t0[1], -t0[2]], t)) as Axes
    }
    const span: [number, number] = [before / total, (before + lengths[i]) / total]
    before += lengths[i]
    const piece = _requireSolid(_swept(local, e, _placement(turned, _point(e, 0)), translational, true, null, span, scale) as Part, 'sweep', hint)
    out = out === null ? piece : out.fuse(piece)
  }
  return _sound(out as unknown as Part, hint)
}

/** The pieces swept as before 0.5.0, with the same kernel calls: the sketch turned to the path's
 * start (by the smallest rotation, about the center of its box), turned from there to each piece's
 * start and swept with the kernel's anchor (the center of the turned profile's box along the world
 * axes), the pieces fused. Null where that anchor is not the profile's own (a profile not symmetric
 * about it, turned off the axes): the profile went beside the path there. */
function _formerSweep(sk: Sketch, anchor: V3, pieces: Edge[], orient: boolean, translational: boolean, hint: string): Part | null {
  // the sketch turned to the start of e as _orientedTo turns it, and the point own with it
  const turned = (s: Sketch, own: V3, e: Edge): [Sketch, V3] => {
    if (!orient || translational) return [s, own]
    const n = _unit3(s.plane.zDir.toArray())
    const t = _tangent(e, 0)
    const center = s.bbox().center.toArray()
    const rot = _turn(_dot3(n, t) >= 0 ? n : [-n[0], -n[1], -n[2]], t)
    const moved = rot(_sub3(own, center))
    return [_orientedTo(s, e.tangentAt(0)), [center[0] + moved[0], center[1] + moved[1], center[2] + moved[2]]]
  }
  const tol = 1e-6 * Math.max(1, sk.bbox().diagonal)
  const [start, startAnchor] = turned(sk, anchor, pieces[0])
  const swept: Part[] = []
  for (const e of pieces) {
    const [s, own] = turned(start, startAnchor, e)
    if (_norm3(_sub3(s.bbox().center.toArray(), own)) > tol) return null
    const curves = s.faces().flatMap((f) => f.wires().flatMap((w) => w._copyCurves()))
    const pathCurve = e._copyCurve()
    let b: number
    try {
      b = kernelCall('sweep', () => ext.curve_sweep(curves, pathCurve, true, true, false, translational, null, null), hint)
    } finally {
      ext.delete_curve(pathCurve)
      for (const c of curves) ext.delete_curve(c)
    }
    swept.push(_requireSolid(Part._wrap(b), 'sweep', hint))
  }
  let out = swept[0]
  for (const p of swept.slice(1)) out = out.fuse(p)
  return _sound(out, hint)
}

// A face of a fused sweep encloses no area when its area is below this times the square of the
// body's size.
const SLIVER_AREA = 1e-9

/** The non-infinite regions of a body and their shells (ext.brep_dump). */
const _regions = (part: Part): { shells: number[] }[] =>
  (ext.brep_dump(part._brep, false).regions as { infinite: boolean; shells: number[] }[]).filter((r) => !r.infinite)

/** A sweep that was fused or stitched from pieces, checked as `isValid()` checks it (the gaps
 * between its faces measured), and without faces that enclose no area: the fuse of the halves of a
 * loop closed with a kink left such faces where the loop closes (where the end caps of the halves
 * and the surfaces of both tubes meet at a point), in 25 of about 100 random loops, and some of
 * them a shell of their own inside the solid, which STEP writes as a void (and OpenCASCADE then
 * reads the body inside out). They are taken out and the faces around them stitched together
 * again; where that fails the sweep throws `ModelingError`. */
function _sound(part: Part, hint: string): Part {
  const problem = part._solidProblem(null, true)
  if (problem !== null) throw new ModelingError(`sweep: the kernel returned a body that is ${problem}; ${hint}`)
  const size = part._extent()
  let regions = _regions(part)
  let slivers: Face[]
  try {
    slivers = [...part.faces()].filter((f) => !(f.area > SLIVER_AREA * size ** 2))
  } catch (err) {
    if (!(err instanceof ModelingError) || _isCrash(err)) throw _crashOf(err)
    throw new ModelingError(`sweep: a face of the fused pieces cannot be measured (${err.message}); ${hint}`)
  }
  if (slivers.length === 0 && regions.length === 1 && regions[0].shells.length === 1) return part
  const what = slivers.length ? `${slivers.length} face(s) that enclose no area` : `${regions.reduce((n, r) => n + r.shells.length, 0)} shells`
  if (slivers.length === 0) throw new ModelingError(`sweep: the fused pieces came out as a body of ${what}; ${hint}`)
  const reach = Math.max(10 * Math.max(...slivers.map((f) => f.bbox().diagonal)), 1e-7 * size)
  let out: Part
  try {
    out = Part._wrap(kernelCall('remove slivers', () => ext.remove_slivers(part._brep, slivers.map((f) => f._f), reach)))
    if (out._solidProblem(null, true) !== null) throw new ModelingError('not a valid solid')
    regions = _regions(out)
    if (regions.length !== 1 || regions[0].shells.length !== 1) throw new ModelingError('not one shell')
    if (Math.abs(out.volume - part.volume) > 1e-6 * part.volume) throw new ModelingError('another volume')
    if ([...out.faces()].some((f) => !(f.area > SLIVER_AREA * size ** 2))) throw new ModelingError('faces without area left')
  } catch (err) {
    if (!(err instanceof ModelingError) || _isCrash(err)) throw _crashOf(err)
    throw new ModelingError(`sweep: the fused pieces have ${what}, and they cannot be taken out (${err.message}); ${hint}`)
  }
  return out
}

// -- planar paths with mitered corners -----------------------------------------------------------
// The kernel's sweep along a planar path of several edges (SmApiCreateSweepAlongPlanarPath) puts
// the profile on each edge in a frame made from the world's axes: x along the edge, y the world Z
// axis crossed with the edge (the world Y axis where the edge runs mostly along Z). Only in a
// horizontal plane do those frames turn about the path's normal from edge to edge, so that the
// mitered pieces meet: on a path in the YZ plane, and with a triangle on a path in the XZ plane
// that turns back, it returned no closed solid. So the path is swept in a frame of its own (its plane
// horizontal, its start along X) with the profile turned as on any other path, and the body is placed
// back. The kernel moved the profile by the middle of its box (of its curves' control points) along
// the world axes, so an asymmetric profile turned off them went beside the path (and an arc that does
// not span whole quadrants a little); the profile's anchor is given to it instead (kernel patch:
// `ext.planar_path_sweep`'s reference).

/** The normal of a planar path's plane: up (or towards +Y, +X) where that is not ambiguous. */
function _pathNormal(edges: readonly Edge[]): V3 {
  const pts = edges.flatMap((e) => PLANARITY_SAMPLES.map((t) => e.pointAt(t).toArray() as number[]))
  const n = _unit3(spread(pts).directions[2])
  for (const i of [2, 1, 0]) {
    if (Math.abs(n[i]) > 1e-9) return n[i] > 0 ? n : [-n[0], -n[1], -n[2]]
  }
  return n
}

/** The columns of `axes` seen in the frame `frame` (frame^T axes). */
const _seenIn = (frame: Axes, axes: Axes): Axes => axes.map((c) => [_dot3(frame[0], c), _dot3(frame[1], c), _dot3(frame[2], c)]) as Axes

/** A profile swept along a planar path of several edges with mitered corners. */
function _mitredSweep(sk: Sketch, edges: Edge[], closed: boolean, turn: boolean, anchor: unknown = null): Part {
  void closed
  const hint = "the profile may be too large for the path's corners"
  const t0 = _tangent(edges[0], 0)
  const normal = _pathNormal(edges)
  const frame: Axes = [t0, _cross3(normal, t0), normal] // the path's own: start along x, plane xy
  const start = _point(edges[0], 0)
  const toPath = _inverse(_placement(frame, start))
  const path = edges.map((e) => e._transformed(toPath))
  const [axes, own] = _profileFrame(sk, t0, anchor)
  const local = sk._transformed(_inverse(_placement(axes, own)))
  let rot: Axes
  if (turn) {
    rot = _seenIn(frame, axes.map(_turn(axes[2], t0)) as Axes)
    // (the kernel turns a profile to face the way the path starts: half a turn about the path's
    // normal, as it did in the world's frame)
    if (local.plane.zDir.z < 0) rot = rot.map((c) => [-c[0], -c[1], c[2]]) as Axes
  } else {
    // (the kernel turns the profile itself, also with orient false or translational true: as it
    // did in the world's frame)
    rot = _seenIn(frame, axes.map(_kernelTurn(_unit3(sk.plane.zDir.toArray()), t0)) as Axes)
  }
  const placed = local._transformed(_placement(rot, [0, 0, 0])) // (its anchor at the origin)
  const curves = placed.faces().flatMap((f) => f.wires().flatMap((w) => w._copyCurves()))
  const b = _freed(curves, () =>
    _freed(
      path.map((e) => e._copyCurve()),
      (pathCurves) => kernelCall('sweep', () => ext.planar_path_sweep(curves.slice(), pathCurves, AT_ORIGIN), hint),
    ),
  )
  return _requireSolid(Part._wrap(b), 'sweep', hint)._transformed(_placement(frame, start)) as Part
}

/** How the kernel's planar-path sweep turns a profile of this normal in the world's frame
 * (PositionProfileCurves): by the smallest rotation to X, then X to the path's start `t0` with Y to
 * the world Z crossed with it (to Y where it runs mostly along Z). */
function _kernelTurn(normal: V3, t0: V3): (v: readonly number[]) => V3 {
  const x = _unit3(t0)
  const ref: V3 = Math.abs(x[2]) > Math.abs(x[0]) && Math.abs(x[2]) > Math.abs(x[1]) ? [0, 1, 0] : _cross3([0, 0, 1], x)
  const y = _unit3(_sub3(ref, x.map((c) => c * _dot3(ref, x))))
  const z = _cross3(x, y)
  const toX = _turn(normal, [1, 0, 0])
  return (v) => {
    const w = toX(v)
    return [x[0] * w[0] + y[0] * w[1] + z[0] * w[2], x[1] * w[0] + y[1] * w[1] + z[1] * w[2], x[2] * w[0] + y[2] * w[1] + z[2] * w[2]]
  }
}

/** A closed edge as two edges, split halfway along it (or at the fraction `at` of its length). */
function _halves(edge: Edge, at = 0.5): Edge[] {
  const c = edge._copyCurve()
  try {
    const [t0, t1] = k.curve_parameter_range(c)
    const [u] = ext.curve_parameter_at_length(c, t0, at * ext.curve_length(c, t0, t1))
    const tm = Number(u)
    return [Edge._fromCurve(ext.trimmed_curve(c, t0, tm)), Edge._fromCurve(ext.trimmed_curve(c, tm, t1))]
  } finally {
    ext.delete_curve(c)
  }
}

// Where a planar path's plane is fitted: its ends, and 16 points between them off the halves and
// quarters.
const PLANARITY_SAMPLES = [0, 1, ...Array.from({ length: 16 }, (_, i) => (i + 0.381966) / 16)]

/** Whether the path lies in a plane: its curves' control points do (a NURBS curve lies in a plane
 * exactly where its control points do). Points sampled along it lie in a plane for 3D paths too: a
 * chain of helices with an even number of turns each (8 or 16 between samples) was taken for planar
 * and went to the mitered sweep, which gave no closed solid for other profiles than circles. */
function _isPlanarPath(edges: readonly Edge[]): boolean {
  const poles: number[][] = []
  for (const e of edges) {
    const c = e._copyCurve()
    try {
      for (const p of ext.curve_data(c, true).poles as number[][]) poles.push([p[0], p[1], p[2]])
    } finally {
      ext.delete_curve(c)
    }
  }
  const s = spread(poles).values
  return s[s.length - 1] <= 1e-7 * Math.max(1, s[0])
}

/**
 * Swing a profile around an outline: a revolve about Z whose circle is the outline.
 *
 * At each height the section is the outline scaled about the Z axis so that it passes through the
 * profile's point on the +X side: the cut of the result by the XZ plane on the +X side is the
 * profile. A circle around the origin gives the revolve. The faces are exact (NURBS products of the
 * two curves).
 *
 * @param profile Drawn as for a lathe (see `revolve`): in the XZ plane (`Plane.front`), x the
 *   distance from the Z axis (at least 0), z the height. A region (a sketch, a planar face or a closed
 *   wire) gives a solid; its edges on the Z axis swing to nothing and are left out, its holes are swung
 *   and cut out. An open curve gives a surface (a Shell).
 * @param outline A closed curve around the Z axis in a plane parallel to XY (its height does not
 *   matter), such as `Ellipse(30, 20)` or a `RoundedRectangle`: a single region or a closed wire or
 *   edge. Every ray from the Z axis must cross it once.
 */
export function swing(profile: Sketch | Face, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part
export function swing(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part | Shell
export function swing(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part | Shell {
  // (in a scope: the outline's loop, the swung loops and the holes are freed at once, kernel plan W9)
  return scope(() => {
    const [loop, reach] = _swingOutline(outline)
    const w = _openCurve(profile)
    if (w !== null) {
      const b = _swung(w, loop, reach, 'swing', 'the profile and outline curves must be B-splines (lines, arcs, splines)')
      kernelCall('swing', () => k.stitch_into_solid(b._brep))
      return b
    }
    const sk = _asSketch(profile)
    const hint = 'the outline must go around the Z axis once and the profile lie beside it (x >= 0) in the XZ plane'
    let result: Part | null = null
    for (const f of sk.faces()) {
      const loops = f.wires()
      let piece = _swungSolid(loops[0], loop, reach, hint)
      for (const h of loops.slice(1)) piece = piece.cut(_swungSolid(h, loop, reach, hint))
      result = result === null ? piece : result.fuse(piece)
    }
    if (result === null) throw new RangeError('swing: the sketch is empty')
    _requireSolid(result, 'swing', hint)
    result.name = sk.name
    result.color = sk.color
    return result
  })
}

function _swingSamples(e: Edge): number[] {
  if (e.geomType === 'line') return [0, 1]
  const ts: number[] = []
  for (let i = 0; i <= 48; i++) ts.push(i / 48)
  return ts
}

/** The outline as a closed wire, and how far from the Z axis it crosses the +X axis. Throws where it is
 * not a closed curve in a plane parallel to XY that every ray from the Z axis crosses once. */
function _swingOutline(outline: unknown): [Wire, number] {
  if (outline instanceof ShapeList) outline = outline.one()
  if (outline instanceof Sketch) {
    const faces = outline.faces()
    if (faces.length !== 1) throw new RangeError(`swing: the outline must be one closed curve, got a sketch of ${faces.length} regions`)
    outline = faces[0]
  }
  let w: Wire
  if (outline instanceof Face) {
    const loops = outline.wires()
    if (loops.length !== 1) throw new RangeError('swing: the outline must be one closed curve, got a region with holes')
    w = loops[0]
  } else if (outline instanceof Edge) w = new Wire([outline])
  else if (outline instanceof Wire) w = outline
  else throw new TypeError(`swing: the outline is a sketch, face, wire or edge, got ${_typeName(outline)}`)
  if (!w.isClosed) throw new RangeError('swing: the outline must be a closed curve')
  const box = w.bbox()
  const tol = 1e-7 * Math.max(1, box.diagonal)
  if (box.size.z > tol) throw new RangeError('swing: the outline must lie in a plane parallel to XY')
  let turn = 0
  let reach: number | null = null
  const steps: number[] = []
  for (const e of w.edges()) {
    const ts = _swingSamples(e)
    const pts = ts.map((t) => e.pointAt(t))
    for (let i = 0; i + 1 < ts.length; i++) {
      const p0 = pts[i]
      const p1 = pts[i + 1]
      if (Math.hypot(p0.x, p0.y) <= tol || Math.hypot(p1.x, p1.y) <= tol) throw new RangeError('swing: the outline must go around the Z axis, not through it')
      const step = Math.atan2(p0.x * p1.y - p0.y * p1.x, p0.x * p1.x + p0.y * p1.y)
      steps.push(step)
      turn += step
      if (reach === null && p0.y < 0 !== p1.y < 0) {
        const x = _crossing(e, ts[i], ts[i + 1])
        reach = x > 0 ? x : null
      }
    }
  }
  if (Math.abs(Math.abs(turn) - 2 * Math.PI) > 1e-6) throw new RangeError('swing: the outline must go once around the Z axis')
  if (steps.some((step) => step * turn <= 0)) {
    throw new RangeError('swing: every ray from the Z axis must cross the outline once (it turns back around the axis, or runs straight away from it)')
  }
  if (reach === null || !(reach > tol)) throw new RangeError('swing: the outline must cross the +X axis')
  return [w, reach]
}

/** x where the edge crosses y = 0 between fractions t0 and t1 (where y changes sign). */
function _crossing(e: Edge, t0: number, t1: number): number {
  const below = e.pointAt(t0).y < 0
  for (let i = 0; i < 64; i++) {
    const tm = 0.5 * (t0 + t1)
    if (e.pointAt(tm).y < 0 === below) t0 = tm
    else t1 = tm
  }
  return e.pointAt(0.5 * (t0 + t1)).x
}

/** The edges of a profile loop or curve that do not lie on the Z axis; throws where it is not in the XZ
 * plane beside the axis. */
function _swingProfile(loop: Wire, what: string): Edge[] {
  const box = loop.bbox()
  const tol = 1e-7 * Math.max(1, box.diagonal)
  if (box.size.y > tol || Math.abs(box.min.y) > tol) {
    throw new RangeError(
      `${what}: the profile must lie in the XZ plane (draw it in XY, x the distance from the Z axis and y the height, and place it with .on(Plane.front))`,
    )
  }
  if (box.min.x < -tol) throw new RangeError(`${what}: the profile must lie beside the Z axis (x >= 0), it reaches x = ${_formatG(box.min.x)}`)
  const edges = loop.edges().filter((e) => [..._swingSamples(e), 0.5].some((t) => Math.abs(e.pointAt(t).x) > tol))
  if (!edges.length) throw new RangeError(`${what}: the profile lies on the Z axis`)
  return edges
}

/** The swung faces of a profile curve around the outline, not stitched. */
function _swung(profile: Wire, outline: Wire, reach: number, what: string, hint: string): Shell {
  const edges = _swingProfile(profile, what)
  const b = kernelCall(
    what,
    () =>
      _freed(
        edges.map((e) => e._copyCurve()),
        (pc) => _freed(outline._copyCurves(), (oc) => ext.swung(pc, oc, 1 / reach)),
      ),
    hint,
  )
  return Shell._wrap(b)
}

function _swungSolid(loop: Wire, outline: Wire, reach: number, hint: string): Part {
  const shell = _swung(loop, outline, reach, 'swing', hint)
  const [, isSolid] = kernelCall('swing', () => k.stitch_into_solid(shell._brep), hint)
  if (!isSolid) throw new ModelingError(`swing: the swung faces do not close into a solid; ${hint}`)
  return _requireSolid(Part._wrap(shell._copyBrep()), 'swing', hint)
}

/** Round edges of the part they belong to (see `Part.fillet`), or corners of the sketch they
 * belong to: `fillet(s.vertices().concave(), 2)` (see `Sketch.fillet`). */
export function fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part
export function fillet(vertices: Vertex | readonly Vertex[], radius: number): Sketch
export function fillet(edges: EdgesLike | Vertex | readonly Vertex[], radius: FilletRadius, options?: FilletOptions): Part | Sketch
export function fillet(edges: EdgesLike | Vertex | readonly Vertex[], radius: FilletRadius, options: FilletOptions = {}): Part | Sketch {
  const sk = _ownerSketch(edges)
  if (sk !== null) return sk.fillet(radius as number, edges as Iterable<Vertex>)
  return _ownerPart(edges).fillet(edges as EdgesLike, radius, options)
}

/** Bevel edges of the part they belong to (see `Part.chamfer`), or corners of the sketch they
 * belong to (see `Sketch.chamfer`). */
export function chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part
export function chamfer(vertices: Vertex | readonly Vertex[], length: number): Sketch
export function chamfer(edges: EdgesLike | Vertex | readonly Vertex[], length: number, options?: ChamferOptions): Part | Sketch
export function chamfer(edges: EdgesLike | Vertex | readonly Vertex[], length: number, options: ChamferOptions = {}): Part | Sketch {
  const sk = _ownerSketch(edges)
  if (sk !== null) return sk.chamfer(length, edges as Iterable<Vertex>)
  return _ownerPart(edges).chamfer(edges as EdgesLike, length, options)
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
export function shell(
  part: Part,
  thickness: number,
  openings: FacesLike | null = null,
  options: { outward?: boolean; corners?: string | null; walls?: WallsLike | null } = {},
): Part {
  _opts('shell', options)
  return part.shell(thickness, openings, options)
}

/** Options of the function `offset`: `corners` for a part, a sketch or a wire, `plane` for a wire or an edge. */
export type OffsetFunctionOptions = { corners?: string; round?: boolean | null; plane?: Plane | null }
/** Grow or shrink a part or a sketch by `distance` (also the option `corners`: for a part
 * `"sharp" | "round"`, see `Part.offset`; for a sketch `"round" | "sharp" | "chamfer"`, see
 * `Sketch.offset`), move a sheet or a face along its normals (`Shell.offset`, `Face.offset`: a
 * sheet), or move a wire or an edge sideways (`Wire.offset`, `Edge.offset`). */
export function offset(shape: Part, distance: number, options?: OffsetFunctionOptions): Part
export function offset(shape: Sketch, distance: number, options?: OffsetFunctionOptions): Sketch
export function offset(shape: Shell | Face, distance: number, options?: OffsetFunctionOptions): Shell
export function offset(shape: Wire, distance: number, options?: OffsetFunctionOptions): Wire
export function offset(shape: Edge, distance: number, options?: OffsetFunctionOptions): Edge
export function offset(shape: Part | Sketch | Shell | Face | Wire | Edge, distance: number, options?: OffsetFunctionOptions): Part | Sketch | Shell | Wire | Edge
export function offset(shape: Part | Sketch | Shell | Face | Wire | Edge, distance: number, options: OffsetFunctionOptions = {}): Part | Sketch | Shell | Wire | Edge {
  if (shape instanceof Sketch) return shape.offset(distance, options)
  if (shape instanceof Part) return shape.offset(distance, options)
  if (shape instanceof Wire) return shape.offset(distance, options)
  if (shape instanceof Edge) return shape.offset(distance, options)
  if (typeof (shape as Any)?.offset !== 'function') {
    throw new TypeError(`offset takes a part, a sketch, a sheet (Shell), a face, a wire or an edge, not a ${_typeName(shape)}`)
  }
  _opts('Shell.offset', options) // (the offset of a sheet or a face takes none)
  return shape.offset(distance)
}

/** A mirrored copy of a shape. */
export function mirror<S extends Shape>(shape: S, plane: Plane | Face | Axis | ShapeList<Face> = Plane.XZ): S {
  return shape.mirror(plane)
}

/** Cut a part with a plane or along a sheet (see `Part.split`). */
export function split(part: Part, plane: Plane | Face | Shell, keep: 'both'): [Part, Part]
export function split(part: Part, plane: Plane | Face | Shell, keep?: 'above' | 'below'): Part
export function split(part: Part, plane: Plane | Face | Shell, keep?: 'above' | 'below' | 'both'): Part | [Part, Part]
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
  return flat[0].merge(...(flat.slice(1) as Part[])) // (Part.merge checks them)
}

/** Cross-section of a part (see `Part.section`). */
export function section(part: Part, plane: Plane | Face = Plane.XY): Sketch {
  return part.section(plane)
}

/** Turn a face or sheet into a solid of `thickness` (`both`: half of it to each side; see
 * `Shell.thicken`). */
export function thicken(surface: Shell | Face, thickness: number, options: { both?: boolean } = {}): Part {
  _opts('thicken', options)
  if (surface instanceof Part || !(surface instanceof Shell || surface instanceof Face)) {
    throw new TypeError(`thicken takes a face or a sheet (Shell, Sketch), not a ${_typeName(surface)}; use shell() or offset() for parts`)
  }
  // (in a scope: a face's sheet is freed at once)
  return scope(() => (surface instanceof Face ? surface.toShell() : surface).thicken(thickness, { both: options.both ?? false }))
}
