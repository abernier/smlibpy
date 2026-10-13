// Operations as functions.
//
// Each function is also available as a method (`extrude(sketch, 5)` is `sketch.extrude(5)`). The
// functions read naturally when the target is implied by a selection:
// `fillet(part.edges().parallelTo(Z), 2)` returns the filleted part the edges belong to.

import { ext, k, kernelCall } from './kernel.ts'
import { Axis, Plane, Vector, type VectorLike, Z, _direction } from './geometry.ts'
import { spread } from './_linalg.ts'
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
import { _shellOfSurface } from './surfaces.ts'

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
  const { ruled = false, smooth = true } = options
  if (sections.length < 2) throw new RangeError('loft needs at least two sections')
  const opened = sections.map(_openCurve)
  if (opened.every((w) => w !== null)) {
    const wires = opened as Wire[]
    if (wires.every((w) => w.edges().length === 1)) {
      const curves = wires.map((w) => w.edges()[0]._copyCurve())
      let srf: number
      try {
        srf = kernelCall('loft', () => k.create_skin_surface(curves), 'curves should run in the same direction')
      } finally {
        for (const c of curves) ext.delete_curve(c)
      }
      return _shellOfSurface(srf)
    }
    const counts = wires.map((w) => w.edges().length)
    const curves = wires.flatMap((w) => w._copyCurves())
    const degree = ruled ? 1 : Math.min(smooth ? 3 : 2, sections.length - 1)
    return kernelCall('loft', () => Shell._wrap(k.create_skin_primitive(counts, curves, degree, false)))
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

/** How a profile is swept (see `sweep`). */
export interface SweepOptions {
  /** Turn the profile to be perpendicular to the path at its start (default). */
  orient?: boolean
  /** Keep the profile's orientation fixed instead of turning it with the path. */
  translational?: boolean
  /** For paths of several edges: miter the corners of a planar path (default for planar
   * paths); `false` sweeps each edge on its own and joins the pieces. */
  sharpCorners?: boolean | null
}

/**
 * Sweep a profile along a path.
 *
 * The profile is moved so that its center sits at the start of the path and (with `orient`)
 * turned to face along the path, so profiles can be drawn anywhere, usually in the XY plane:
 *
 *     const tube = sweep(Circle(2), Spline([0, 0, 0], [0, 10, 20], [30, 10, 40]))
 *     const rail = sweep(Rectangle(4, 2), Helix(10, 40, 20))
 *
 * @param profile A sketch (holes allowed), a planar face or a closed wire.
 * @param path An edge, or a wire of connected edges.
 */
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options: SweepOptions = {}): Part | Shell {
  const { orient = true, translational = false } = options
  let sharpCorners = options.sharpCorners ?? null
  let edges = _pathEdges(path)
  if (edges.length === 1 && edges[0].isClosed && _openCurve(profile) === null) {
    // The kernel sweeps a profile along a closed single-edge path inside out; along the same path
    // in two halves it works.
    edges = _halves(edges[0])
  }
  const w = _openCurve(profile)
  if (w !== null) {
    // an open profile sweeps into a surface
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
  let sk = _asSketch(profile)
  if (orient && !translational) sk = _orientedTo(sk, edges[0].tangentAt(0))
  const curves = sk.faces().flatMap((f) => f.wires().flatMap((wire) => wire._copyCurves()))
  try {
    if (edges.length === 1) {
      const pathCurve = edges[0]._copyCurve()
      const hint = "the profile may be too large for the path's curvature"
      let b: number
      try {
        b = kernelCall('sweep', () => ext.curve_sweep(curves, pathCurve, true, true, false, translational, null, null), hint)
      } finally {
        ext.delete_curve(pathCurve)
      }
      return _requireSolid(Part._wrap(b), 'sweep', hint)
    }
    const planar = _isPlanarPath(edges)
    if (sharpCorners === null) sharpCorners = planar
    if (sharpCorners) {
      if (!planar) throw new RangeError('sharp-cornered sweeps need a planar path')
      const pathCurves = edges.map((e) => e._copyCurve())
      const hint = "the profile may be too large for the path's corners"
      const b = kernelCall('sweep', () => k.sweep_along_planar_path(curves.slice(), pathCurves, { move_profile: true }), hint)
      return _requireSolid(Part._wrap(b), 'sweep', hint)
    }
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
  // (a sketch sweeps into solids)
  const pieces = edges.map((e) => sweep(sk, e, { orient, translational }) as Part)
  let out = pieces[0]
  for (const p of pieces.slice(1)) out = out.fuse(p)
  return out
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

function _isPlanarPath(edges: readonly Edge[]): boolean {
  const pts = edges.flatMap((e) => [0, 0.25, 0.5, 0.75, 1].map((t) => e.pointAt(t).toArray() as number[]))
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
  return part.shell(thickness, openings, options)
}

/** Grow or shrink a part or a sketch by `distance` (for a sketch also the option
 * `corners: "round" | "sharp" | "chamfer"`, see `Sketch.offset`). */
export function offset(shape: Part | Sketch, distance: number, options: { corners?: string; round?: boolean | null } = {}): Part | Sketch {
  return shape instanceof Sketch ? shape.offset(distance, options) : shape.offset(distance)
}

/** A mirrored copy of a shape. */
export function mirror<S extends Shape>(shape: S, plane: Plane | Face | Axis | ShapeList<Face> = Plane.XZ): S {
  return shape.mirror(plane)
}

/** Cut a part with a plane (see `Part.split`). */
export function split(part: Part, plane: Plane | Face, keep: 'above' | 'below' | 'both' = 'above'): Part | [Part, Part] {
  return keep === 'both' ? part.split(plane, 'both') : part.split(plane, keep)
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
