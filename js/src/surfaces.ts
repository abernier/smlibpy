// Surface modeling: freeform surfaces, stitching surfaces into solids.
//
// Most surface work goes through the regular operations: extruding, revolving, sweeping or
// lofting an *open* curve gives a surface (a Shell) instead of a solid. This module adds surfaces
// through point grids, ruled surfaces and stitching.

import { KernelError, ModelingError, _isRuntimeError, _opts, ext, k, kernelCall, scope } from './kernel.ts'
import { Vector, _vec, type VectorLike } from './geometry.ts'
import { Edge, Face, Part, Shell, Wire, _bodies, _continuity, _curvesOf, _t, _typeName } from './shapes.ts'
import { _isolatedValue, _smb } from './defeature.ts'
import { _withOptions } from './curves.ts'

export function _shellOfSurface(srf: number): Shell {
  let b: number
  try {
    b = kernelCall('surface', () => ext.face_from_surface(srf))
  } finally {
    ext.delete_surface(srf)
  }
  return Shell._wrap(b)
}

/**
 * How far the points given to `surface` lie from the surface (`surface(points, { report: true })`).
 *
 * The distances are true ones, to each point's closest point on the surface. (A fit's own
 * residuals, at the parameters it gave the points, overstate how far a cloud that is not a height
 * field lies from its surface: 18.3 where the worst point lies 7.4 from it.)
 */
export class FitReport {
  /** The largest distance of a point from the surface, to its closest point on it. */
  readonly maxDistance: number
  /** The root mean square of the distances. */
  readonly rmsDistance: number
  /** The distance of each point, in the order given (a grid's rows one after the other). */
  readonly distances: number[]

  constructor(maxDistance: number, rmsDistance: number, distances: number[]) {
    this.maxDistance = maxDistance
    this.rmsDistance = rmsDistance
    this.distances = distances
  }
}

type SurfaceOptions = { interpolate?: boolean; controls?: number | readonly [number, number] | null; smoothing?: number; report?: boolean }

/**
 * A freeform NURBS surface through a grid of points, or fitted to a cloud of points.
 *
 * @param points Rows of points, `points[i][j]` (a grid: all rows the same length, at least 4 x 4:
 *   the surface is bicubic). Or a cloud: points in any order (at least 4), such as a scan; the
 *   surface approximates them.
 * @param options `interpolate` (grids): pass through the points (default); `false` uses them as
 *   control points, which gives a smoother surface that only approaches them. `controls`
 *   (clouds): control points of the surface per direction, a number or `[along, across]` (4 to
 *   64), "along" the longer side of the cloud; default about one per 8 points, shaped like the
 *   cloud. `smoothing` (clouds): how much the surface resists bending, against how close it comes
 *   to the points: 0 to 1, default 1e-2; for noisy points raise it (0.1 to 1), or take fewer
 *   control points. `report`: `true` returns `[sheet, report]`, a `FitReport`: how far each point
 *   lies from the surface (to its closest point), the largest and the rms distance; a few
 *   milliseconds for thousands of points.
 *
 * A cloud must be a height field over its best-fit plane (no overhangs, nothing folded over). The
 * surface spans the smallest rectangle around the points in that plane; where there are no
 * points, the smoothing shapes it. Its normal points up (+Z); for a cloud that stands upright, to
 * +Y, else to +X. A cloud that is not a height field gets a surface that misses it by millimetres,
 * without an error: check `report.maxDistance` against the noise you expect.
 */
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options: SurfaceOptions & { report: true }): [Shell, FitReport]
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options?: SurfaceOptions): Shell
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options: SurfaceOptions = {}): Shell | [Shell, FitReport] {
  _opts('surface', options)
  if (_isCloud(points)) {
    const sheet = _fit(points as readonly VectorLike[], options.controls ?? null, options.smoothing ?? 1e-2)
    if (!options.report) return sheet
    return [sheet, _fitReport(sheet, Array.from(points as readonly VectorLike[], (p) => _vec(p).toArray()).flat())]
  }
  if (options.controls != null) throw new RangeError('surface: controls are for clouds of points; a grid sets its own')
  const interpolate = options.interpolate ?? true
  const grid = Array.from(points as readonly (readonly VectorLike[])[], (row) => Array.from(row, (p) => _vec(p).toArray()))
  const cols = grid.length ? grid[0].length : 0
  const isGrid = grid.length > 0 && grid.every((row) => row.length === cols)
  if (!isGrid || grid.length < 4 || cols < 4) {
    const shape = isGrid ? `${grid.length}x${cols}` : 'not a grid'
    throw new RangeError(`surface needs a grid of at least 4 x 4 points (bicubic), got ${shape}; for a four-sided patch use ruled() between two lines`)
  }
  if (!grid.every((row) => row.every((p) => p.every(Number.isFinite)))) throw new RangeError('surface: the points must be finite numbers')
  const rows = grid.length
  const flat = grid.flat().map(_t)
  const srf = kernelCall('surface', () =>
    interpolate ? k.create_surface_from_ordered_points(flat, rows, cols) : k.create_surface_from_points(flat, rows, cols),
  )
  const sheet = _shellOfSurface(srf)
  if (!options.report) return sheet
  return [sheet, _fitReport(sheet, grid.flat(2))]
}

/** How far the points (x, y, z flat) lie from the sheet's one surface. */
function _fitReport(sheet: Shell, points: number[]): FitReport {
  const d: number[] = Array.from(kernelCall('surface', () => ext.surface_distances(k.face_surface(sheet.faces()[0]._f), points)) as Float64Array)
  let max = 0
  let sum = 0
  for (const x of d) {
    max = Math.max(max, x)
    sum += x * x
  }
  return new FitReport(max, Math.sqrt(sum / d.length), d)
}

/** A surface's NURBS data, as `Face.nurbs()` gives it. */
type NurbsSurfaceData = {
  readonly degrees: readonly [number, number]
  readonly knots: readonly [readonly number[], readonly number[]]
  readonly points: readonly (readonly VectorLike[])[]
  readonly weights: readonly (readonly number[])[] | null
}

/**
 * A surface from its NURBS data: control points, knots, degrees and weights, as other programs,
 * files or papers give them (also rational surfaces, other degrees than 3, knots that are not
 * uniform). The inverse of `Face.nurbs()`.
 *
 * @param points The control points in rows, `points[i][j]` the point `i` along u and `j` along v
 *   (all rows the same length, at least `degree + 1` each way); or a `NurbsSurface`
 *   (`Face.nurbs()`: its degrees, knots, points and weights), with nothing else given.
 * @param knots The knot vectors `[uKnots, vKnots]`, every knot as often as its multiplicity:
 *   `rows + uDegree + 1` and `row length + vDegree + 1` knots, not decreasing. The ends need not
 *   repeat: the surface spans `knots[degree]` to `knots[length - degree - 1]` each way (inside the
 *   control net where they do not). Default: uniform and clamped (the surface starts and ends at
 *   the net's corner points).
 * @param degrees The degrees `[u, v]` (1 to 32), or one for both. Default: from the knots
 *   (`knots.length - points.length - 1`), or 3 (less where there are fewer than 4 points).
 * @param weights A positive weight per control point, in the same rows; `null` for a non-rational
 *   surface.
 * @returns A sheet of one face over the whole surface, its normal along `du x dv`.
 */
export function nurbsSurface(
  points: readonly (readonly VectorLike[])[] | NurbsSurfaceData,
  knots: readonly [readonly number[], readonly number[]] | null = null,
  degrees: number | readonly [number, number] | null = null,
  weights: readonly (readonly number[])[] | null = null,
): Shell {
  if (knots === null && degrees === null && weights === null && !Array.isArray(points) && points != null &&
    typeof points === 'object' && 'degrees' in points && 'knots' in points && 'points' in points) {
    const n = points as NurbsSurfaceData
    ;[degrees, knots, weights] = [n.degrees, n.knots, n.weights]
    points = n.points
  }
  const rows = points as readonly (readonly VectorLike[])[]
  let grid: number[][][]
  try {
    grid = Array.from(rows, (row) => Array.from(row, (p) => _vec(p).toArray()))
  } catch {
    throw new RangeError('nurbsSurface: the control points are rows of points, all rows the same length')
  }
  const nu = grid.length
  const nv = nu ? grid[0].length : 0
  if (nu < 2 || nv < 2 || !grid.every((row) => row.length === nv)) {
    throw new RangeError('nurbsSurface: the control points are rows of points (at least 2 x 2), all rows the same length')
  }
  if (!grid.every((row) => row.every((p) => p.every(Number.isFinite)))) throw new RangeError('nurbsSurface: the control points must be finite numbers')
  let du: number
  let dv: number
  if (degrees === null) {
    if (knots === null) [du, dv] = [Math.min(3, nu - 1), Math.min(3, nv - 1)]
    else [du, dv] = [knots[0].length - nu - 1, knots[1].length - nv - 1]
  } else if (typeof degrees === 'number') {
    du = dv = Math.trunc(degrees)
  } else {
    ;[du, dv] = [Math.trunc(degrees[0]), Math.trunc(degrees[1])]
  }
  for (const [name, d, n] of [['u', du, nu], ['v', dv, nv]] as const) {
    if (!(d >= 1 && d <= 32)) throw new RangeError(`nurbsSurface: the ${name} degree must be 1 to 32, got ${d}`)
    if (n < d + 1) throw new RangeError(`nurbsSurface: degree ${d} needs at least ${d + 1} control points along ${name}, got ${n}`)
  }
  let ku: number[]
  let kv: number[]
  if (knots === null) {
    const uniform = (n: number, d: number) => [...Array(d + 1).fill(0), ...Array.from({ length: n - d - 1 }, (_, i) => (i + 1) / (n - d)), ...Array(d + 1).fill(1)]
    ;[ku, kv] = [uniform(nu, du), uniform(nv, dv)]
  } else {
    if (knots.length !== 2) throw new RangeError('nurbsSurface: knots are two knot vectors, [uKnots, vKnots]')
    ;[ku, kv] = [Array.from(knots[0], Number), Array.from(knots[1], Number)]
  }
  for (const [name, kn, d, n] of [['u', ku, du, nu], ['v', kv, dv, nv]] as const) {
    if (kn.length !== n + d + 1) {
      throw new RangeError(`nurbsSurface: ${n} control points of degree ${d} along ${name} need ${n + d + 1} knots (control points + degree + 1), got ${kn.length}`)
    }
    if (!kn.every(Number.isFinite) || kn.some((x, i) => i > 0 && x < kn[i - 1])) throw new RangeError(`nurbsSurface: the ${name} knots must be finite and not decrease`)
  }
  let w: number[] = []
  if (weights !== null) {
    const wa = Array.from(weights, (row) => Array.from(row, Number))
    if (wa.length !== nu || !wa.every((row) => row.length === nv)) {
      throw new RangeError(`nurbsSurface: weights are rows like the control points (${nu} x ${nv})`)
    }
    w = wa.flat()
    if (!w.every((x) => Number.isFinite(x) && x > 0)) throw new RangeError('nurbsSurface: the weights must be positive numbers')
  }
  const srf = kernelCall('nurbsSurface', () => ext.nurbs_surface(du, dv, nu, nv, grid.flat(2), ku, kv, w))
  return _shellOfSurface(srf)
}

/** Points in any order (a list of points) rather than rows of points. */
function _isCloud(points: readonly unknown[]): boolean {
  if (!points.length) throw new RangeError('surface needs points')
  const first = points[0] as any
  if (first instanceof Vector) return true
  return first != null && typeof first !== 'string' && typeof first.length === 'number' && Array.from(first as ArrayLike<unknown>).every((x) => typeof x === 'number')
}

function _fit(points: readonly VectorLike[], controls: number | readonly [number, number] | null, smoothing: number): Shell {
  const cloud = Array.from(points, (p) => _vec(p).toArray())
  if (cloud.length < 4) throw new RangeError(`surface needs at least 4 points to fit, got ${cloud.length}`)
  if (!cloud.every((p) => p.every(Number.isFinite))) throw new RangeError('surface: the points must be finite numbers')
  let nu = 0
  let nv = 0
  if (controls != null) {
    ;[nu, nv] = typeof controls === 'number' ? [controls, controls] : controls
    if (!(nu >= 4 && nu <= 64 && nv >= 4 && nv <= 64)) throw new RangeError(`surface: controls must be 4 to 64 per direction, got ${JSON.stringify(controls)}`)
  }
  if (!(smoothing >= 0 && smoothing <= 1)) throw new RangeError(`surface: smoothing must be 0 to 1, got ${smoothing}`)
  const [srf] = kernelCall('surface', () => ext.fit_surface(cloud.flat(), Math.trunc(nu), Math.trunc(nv), smoothing),
    'the points may lie on a line, or be too few for the control points')
  return _shellOfSurface(srf)
}

/** The ruled surface between two curves (straight lines join matching points). */
export function ruled(a: Edge | Wire, b: Edge | Wire): Shell {
  const ca = a instanceof Edge ? a : _single(a)
  const cb = b instanceof Edge ? b : _single(b)
  const c1 = ca._copyCurve()
  const c2 = cb._copyCurve()
  let srf: number
  try {
    srf = kernelCall('ruled', () => k.create_ruled_surface(c1, c2))
  } finally {
    ext.delete_curve(c1)
    ext.delete_curve(c2)
  }
  return _shellOfSurface(srf)
}

function _single(w: Wire): Edge {
  const edges = w.edges()
  if (edges.length !== 1) throw new RangeError("expected a single curve; join the wire's edges into one spline first")
  return edges[0]
}

/** What `stitch` sewed (`stitch(..., { report: true })`). */
export class StitchReport {
  /** Pairs of free edges sewn into one edge. */
  readonly sewnEdges: number
  /** Free edges left: the border of a sheet, and edges whose partner lies further away than the
   * tolerance. */
  readonly openEdges: number
  /** The widest gap closed, between vertices or edges that were sewn (0 where the pieces met
   * exactly). Every gap closed is at most `tolerance`. */
  readonly maxGap: number
  /** Faces turned over so that their normals agree with their neighbours' (on open results; a
   * closed result faces outward anyway). */
  readonly turnedFaces: number
  /** The widest gap stitch looked for: the `tolerance` given, or its default, or less where every
   * edge was sewn before. */
  readonly tolerance: number

  constructor(sewnEdges: number, openEdges: number, maxGap: number, turnedFaces: number, tolerance: number) {
    this.sewnEdges = sewnEdges
    this.openEdges = openEdges
    this.maxGap = maxGap
    this.turnedFaces = turnedFaces
    this.tolerance = tolerance
  }
}

type StitchOptions = { tolerance?: number | null; report?: boolean }
type StitchPiece = Shell | Face | Part | Iterable<unknown>

/**
 * Sew faces and sheets along their common edges: `stitch(a, b, c, { tolerance: 0.01 })`.
 *
 * @param args Faces, sheets, sketches or parts, and arrays of them; last, the options:
 *   `tolerance`: the widest gap to close (default: 1e-4 of the size of all pieces together).
 *   Edges and vertices further apart stay open: a gap is never closed silently. Edges that meet
 *   closely are sewn first, looser ones after them, up to the tolerance. `report`: `true` returns
 *   `[body, report]`, a `StitchReport`: the edges sewn, the free edges left and the widest gap
 *   closed.
 * @returns A Part when the pieces close around a volume (its faces then point outward), otherwise
 *   a Shell. The faces of an open result are turned to agree with their neighbours; each connected
 *   piece keeps the normal of its first face (in the order given), so that the sheet thickens.
 */
export function stitch(...args: [...StitchPiece[], StitchOptions & { report: true }]): [Part | Shell, StitchReport]
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell | [Part | Shell, StitchReport] {
  return scope(() => {
    const { items, options } = _withOptions<StitchOptions>(args)
    _opts('stitch', options)
    const bodies = _bodies(items)
    if (!bodies.length) throw new RangeError('nothing to stitch')
    const tolerance = options.tolerance ?? null
    if (tolerance !== null && !(tolerance > 0 && Number.isFinite(tolerance))) {
      throw new RangeError(`stitch: the tolerance must be a positive distance, got ${tolerance}`)
    }
    const b = kernelCall('stitch', () => ext.combine(bodies.map((x) => x._brep)))
    const shell = Shell._wrap(b)
    const size = shell.bbox().diagonal
    const gap = tolerance !== null ? Number(tolerance) : Math.max(size * 1e-4, 1e-7)
    const r = kernelCall('stitch', () => ext.stitch_faces(shell._brep, gap), 'the pieces may not meet within the tolerance')
    let body: Part | Shell = shell
    if (r.open === 0) {
      const part = Part._wrap(shell._copyBrep())
      if (part._solidProblem() === null) body = part
    }
    if (!options.report) return body
    return [body, new StitchReport(r.sewn, r.open, Math.max(r.vertex_gap, r.edge_gap), r.turned, r.tolerance)]
  })
}

/**
 * A round blend between the surfaces of two faces, as a sheet: for surfaces that are not the
 * faces of one part, such as two sheets that cross (`fillet` rounds the edges of a part). Or a flat
 * one, a chamfer, between the same lines.
 *
 * @param a The first face (or a sheet of one face). Its surface is blended, as far as it reaches:
 *   the blend may run past the face.
 * @param b The second face.
 * @param radius The radius of the blend: of the ball that rolls between the two surfaces.
 * @param options `radius2`: chamfers only: a second distance, from `b`; the chamfer then runs
 *   between the lines below where `a`'s surface moved out by `radius` and `b`'s moved out by
 *   `radius2` cross: for faces at right angles its edge on `b` lies `radius` from `a`, its edge on
 *   `a` `radius2` from `b` (default `radius`). `shape`: `'round'` (default): a circular
 *   cross-section; `'chamfer'`: a flat one, straight across between the lines where the round of
 *   the same radius meets the two surfaces (on faces at right angles, legs of `radius`).
 *   `sides`: the side of each face the blend lies on: 1 the side its normal
 *   (`normalAt()`) points to, -1 the other. Two crossing surfaces leave four places for a ball to
 *   roll, one per combination. Default `[1, 1]`. `trim`: `true` cuts both faces back to the blend's
 *   long edges and sews the three into one sheet; the blend's edges must run across both faces,
 *   from border to border.
 * @returns The blend, a sheet whose edges along its length lie on the two surfaces; with `trim` the
 *   two faces, cut back, and the blend between them as one sheet.
 */
export function surfaceFillet(
  a: Face | Shell,
  b: Face | Shell,
  radius: number,
  options: { radius2?: number | null; shape?: string; sides?: readonly [number, number]; trim?: boolean } = {},
): Shell {
  return scope(() => {
    _opts('surfaceFillet', options)
    const sides = options.sides ?? [1, 1]
    const shape = options.shape ?? 'round'
    const radius2 = options.radius2 ?? null
    const fa = _oneFace(a, 'a')
    const fb = _oneFace(b, 'b')
    if (!(radius > 0) || !Number.isFinite(radius)) throw new RangeError(`surfaceFillet: the radius must be positive, got ${radius}`)
    if (shape !== 'round' && shape !== 'chamfer') throw new RangeError(`surfaceFillet: shape is "round" or "chamfer", got ${JSON.stringify(shape)}`)
    if (radius2 !== null) {
      if (shape !== 'chamfer') throw new RangeError('surfaceFillet: radius2 is for chamfers (shape: "chamfer"); a round blend has one radius')
      if (!(radius2 > 0) || !Number.isFinite(radius2)) throw new RangeError(`surfaceFillet: radius2 must be positive, got ${radius2}`)
    }
    if (sides.length !== 2 || sides.some((x) => x !== 1 && x !== -1)) throw new RangeError(`surfaceFillet: sides must be two of 1 and -1, got ${JSON.stringify(sides)}`)
    // (the kernel's sides are those of each surface's own normal, which a face may turn around)
    const r1 = radius * sides[0] * (fa._naturalIsOutward() ? 1 : -1)
    const r2 = (radius2 ?? radius) * sides[1] * (fb._naturalIsOutward() ? 1 : -1)
    const size = Math.max(fa.bbox().union(fb.bbox()).diagonal, radius, radius2 ?? 0)
    const tolerance = Math.max(1e-7 * size, 1e-9)
    const hint = 'the surfaces may not meet, or not leave room for the radius on those sides'
    // (on copies: the kernel changes the surfaces it blends, and a second blend of the same surfaces
    // then fails)
    const ca = fa.toShell()
    const cb = fb.toShell()
    const kw = { radius1: r1, radius2: r2, tolerance, xsect_type: shape === 'round' ? 2 : 0 }
    // (in the probe worker: the kernel's blend code can crash or loop)
    const brep: number = kernelCall(
      'surfaceFillet',
      () =>
        _isolatedValue(
          'surfaceFillet',
          () => k.surface_surface_fillet(k.face_surface(ca.faces()[0]._f), k.face_surface(cb.faces()[0]._f), kw),
          () => ({ op: 'surface_fillet', bodies: [_smb(ca), _smb(cb)], options: kw }),
          { trap: true },
        ),
      hint,
    )
    if (!brep) throw new ModelingError(`surfaceFillet: the kernel made no blend; ${hint}`)
    const shell = Shell._wrap(brep)
    if (!shell.faces().length) throw new ModelingError(`surfaceFillet: the kernel made no blend; ${hint}`)
    if (options.trim) return _trimmedFillet(fa, fb, shell, Math.max(1e-5 * size, 1e-7))
    return shell
  })
}

/** The faces of a surface fillet cut back to its long edges, sewn to it into one sheet. */
function _trimmedFillet(fa: Face, fb: Face, blend: Shell, tol: number): Shell {
  const railA = _railOn(blend, fa, tol)
  const railB = _railOn(blend, fb, tol)
  if (railA === null || railB === null || railA.equals(railB)) {
    throw new ModelingError("surfaceFillet: the blend's long edges do not lie on the faces; trim them yourself")
  }
  const pieces: Shell[] = []
  for (const [f, rail, other] of [[fa, railA, railB], [fb, railB, railA]] as const) {
    // keep the side away from the blend: the blend leaves the face toward the other edge
    const m = rail.pointAt(0.5)
    const n = f.normalAt(m)
    let v = other.pointAt(0.5).sub(m)
    v = v.sub(n.mul(v.dot(n)))
    if (!(v.length > 0)) throw new ModelingError('surfaceFillet: the blend leaves a face along its normal; trim the faces yourself')
    const sheet = f.toShell()
    try {
      pieces.push(sheet.trim(rail, m.sub(v.normalized().mul(Math.max(1e-3 * sheet.bbox().diagonal, 10 * tol)))))
    } catch (e) {
      if (!(e instanceof ModelingError || e instanceof RangeError)) throw e
      throw new ModelingError(`surfaceFillet: the blend does not cut a face back (its long edges must run across both faces, from border to border): ${e.message}`)
    }
  }
  const joined = stitch(pieces[0], blend, pieces[1])
  if (_freeEdges(joined) !== _freeEdges(pieces[0]) + _freeEdges(pieces[1])) {
    throw new ModelingError('surfaceFillet: the blend could not be sewn to the faces cut back; join them with stitch(..., { tolerance })')
  }
  return joined as Shell
}

/** The edge of the blend that lies on the face's surface (null if none does). */
function _railOn(blend: Shell, f: Face, tol: number): Edge | null {
  const srf = k.face_surface(f._f)
  const edges = blend.edges()
  let best = -1
  let bestGap = Number.POSITIVE_INFINITY
  edges.forEach((e, i) => {
    const gap = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((t) => k.surface_closest_point(srf, e.pointAt(t).toArray())[2] as number))
    if (gap < bestGap) [best, bestGap] = [i, gap]
  })
  return best >= 0 && bestGap <= tol ? edges[best] : null
}

function _freeEdges(body: Shell | Part): number {
  return body.edges().filter((e) => e.faces().length === 1).length
}

/**
 * A smooth bridge between free edges of two sheets: a sheet that leaves one sheet across one edge
 * and reaches the other across the other, tangent to both (or curvature-continuous).
 *
 * @param edgeA An edge on the border of a sheet (one face uses it), such as
 *   `sheet.edges().filter((e) => e.faces().length === 1)`.
 * @param edgeB An edge on the border of another sheet (or of the same one).
 * @param options `continuity`: how smoothly the blend meets the sheets: `'G1'` tangent, `'G2'` with
 *   the same curvature across the edges too (default), `'G3'` also the same change of curvature.
 *   `tension`: how far the blend runs on in each sheet's direction before it turns: its take-off at
 *   `edgeA` and `edgeB` as a part of the gap between the edges (default 1); one number for both, or
 *   a pair; less is tighter, more bulges. `join`: `true` sews the blend to both sheets (`stitch`)
 *   and returns the one sheet.
 *
 * The blend joins the nearest ends of the two edges (its side edges never cross), and its normal
 * follows `edgeA`'s sheet. Two closed edges (the rims of two tubes, full circles or closed loops) are
 * bridged all round: each point of `edgeA` is joined to the point of `edgeB` at the same fraction of
 * its length, counted from its point nearest `edgeA`'s start and running the same way round. Such a
 * blend is two faces sewn along two seams (the kernel offsets no face that closes around), as smooth
 * across them as elsewhere. A closed edge and an open one cannot be bridged.
 *
 * @returns The blend, a sheet of one face, of two between closed edges (with `join`, the two sheets
 *   and the blend sewn into one).
 */
export function blend(
  edgeA: Edge,
  edgeB: Edge,
  options: { continuity?: string | number; tension?: number | readonly [number, number]; join?: boolean } = {},
): Shell {
  _opts('blend', options)
  const fa = _freeFace(edgeA, 'edgeA')
  const fb = _freeFace(edgeB, 'edgeB')
  const continuity = options.continuity ?? 'G2'
  let level: number | null
  try {
    level = _continuity(continuity)
  } catch (e) {
    if (!(e instanceof RangeError || e instanceof TypeError)) throw e
    level = null
  }
  if (level === null) throw new RangeError(`blend: continuity must be G1, G2 or G3, got ${JSON.stringify(continuity)}`)
  const tension = options.tension ?? [1, 1]
  let ta: number
  let tb: number
  if (typeof tension === 'number') {
    ta = tb = tension
  } else {
    if (tension.length !== 2) throw new RangeError(`blend: tension is one number or a pair, got ${JSON.stringify(tension)}`)
    ;[ta, tb] = tension.map(Number)
  }
  if (!(ta > 0 && tb > 0 && Number.isFinite(ta) && Number.isFinite(tb))) {
    throw new RangeError(`blend: the tension must be positive, got ${JSON.stringify(tension)}`)
  }
  if (edgeA.equals(edgeB)) throw new RangeError('blend: edgeA and edgeB are the same edge')
  let b: number
  try {
    b = kernelCall('blend', () => ext.edge_blend(fa._f, edgeA._e, fb._f, edgeB._e, level, ta, tb),
      'the edges may touch or cross, or a sheet may not lead toward the other edge')
  } catch (e) {
    if (!(e instanceof RangeError)) throw e
    throw new RangeError(e.message.replace('edge_blend:', 'blend:'))
  }
  const sheet = Shell._wrap(b)
  if (!options.join) return sheet
  const aBody = edgeA._owner as Shell
  const bBody = edgeB._owner as Shell
  const sheets = aBody === bBody ? [aBody] : [aBody, bBody]
  const joined = stitch(...sheets, sheet)
  // sewn along both edges: no free edge of the result left on either (a closed blend comes in two
  // halves, so the count of free edges says nothing)
  const tol = 1e-6 * Math.max(1.0, joined._looseBox().diagonal)
  const loose = joined.edges().filter((e) => e.faces().length === 1)
  if (loose.some((e) => Math.min(edgeA.distanceTo(e.center()), edgeB.distanceTo(e.center())) <= tol)) {
    throw new ModelingError('blend: the blend could not be sewn to the sheets; join them with stitch(..., { tolerance })')
  }
  return joined as Shell
}

/** The one face of a border edge of a sheet. */
function _freeFace(e: unknown, name: string): Face {
  if (!(e instanceof Edge)) throw new TypeError(`blend takes edges of sheets, not a ${_typeName(e)}`)
  const faces = e.faces()
  if (!faces.length) throw new TypeError(`blend: ${name} is a curve, not an edge of a sheet; make a sheet with it first (extrude, ruled)`)
  if (faces.length !== 1 || e._owner instanceof Part) {
    throw new RangeError(`blend: ${name} lies between two faces; take an edge on a sheet's border (used by one face)`)
  }
  return faces[0]
}

function _oneFace(x: unknown, name: string): Face {
  if (x instanceof Face) return x
  if (x instanceof Shell && !(x instanceof Part)) {
    const faces = x.faces()
    if (faces.length === 1) return faces[0]
    throw new RangeError(`surfaceFillet: ${name} is a sheet of ${faces.length} faces; pass one of them`)
  }
  throw new TypeError(`surfaceFillet takes faces (or sheets of one face), not a ${_typeName(x)}`)
}

/**
 * A surface that fills a closed loop of curves: a hole in a sheet, or the frame of a patch.
 *
 * @param boundary The curves around the hole, in any order and direction: edges on the border of
 *   sheets (`sheet.edges().filter((e) => e.faces().length === 1)`), curves (`Spline`,
 *   `ThreePointArc`, ...) or wires. One closed curve (the round edge of a hole), or two, is cut into
 *   four sides.
 * @param options `tangent`: `true` (default): where the curves are edges of sheets, the patch meets
 *   each sheet tangentially along its edge; then every curve must be such an edge, and the sheets
 *   must meet each other tangentially where the edges meet (a hole in one smooth sheet, a corner
 *   between three rounds). `false` runs the patch through the curves only.
 *
 * Four sides make a Coons patch, of one face (through curves only, it is bilinear: straight across
 * between opposite sides, in the middle the sum of both). Five sides and more make an N-sided fill
 * of one face per side, sewn, meeting in the middle. Three sides make an N-sided fill of three faces
 * through curves only; tangent to sheets, a Coons patch whose fourth side shrinks to a point at one
 * corner (a pole there: thickening such a patch fails).
 *
 * @returns The patch, a sheet. Its normal follows the sheets it is tangent to; through curves only,
 *   it follows the right-hand rule around the loop in the direction of the first curve given. Sew it
 *   to the sheets with `stitch` (`stitch(sheet, patch)`).
 * @throws RangeError The curves do not close into one loop (the message names the gap), or some
 *   curves are edges of sheets and others not while `tangent` is true.
 * @throws ModelingError The patch misses its curves, meets a sheet at an angle, or folds back over
 *   the sheets.
 */
export function fill(boundary: Edge | Wire | Iterable<Edge | Wire>, options: { tangent?: boolean } = {}): Shell {
  _opts('fill', options)
  const tangent = options.tangent ?? true
  const edges = _curvesOf(boundary, 'fill')
  const sides: [Edge, Face | null][] = []
  for (const e of edges) {
    const faces = e.faces()
    if (faces.length > 1 || e._owner instanceof Part) {
      throw new RangeError('fill: an edge lies between two faces; take edges on the border of a sheet (used by one face), or curves')
    }
    sides.push([e, faces.length && tangent ? faces[0] : null])
  }
  const first = sides.length ? sides[0][1] : null
  if (tangent && first !== null && first.isPlanar && sides.every(([, f]) => f !== null && f.equals(first))) {
    // The outline of a planar face (a sketch's region): the patch would cover the face it is to be
    // tangent to, and fold back over it. The curves are taken as they are.
    const outline = new Set(first.outerWire().edges().map((x) => x._identity()))
    if (sides.length === outline.size && sides.every(([e]) => outline.has(e._identity()))) {
      for (const s of sides) s[1] = null
    }
  }
  let box = edges[0].bbox()
  for (const e of edges.slice(1)) box = box.union(e.bbox())
  const size = Math.max(box.diagonal, 1e-9)
  const curves = edges.map((e) => e._copyCurve())
  let b: number
  try {
    b = ext.fill_loop(curves, sides.map(([, f]) => (f !== null ? f._f : 0)), sides.map(([e, f]) => (f !== null ? e._e : 0)), 1e-4 * size)
  } catch (e) {
    if (!_isRuntimeError(e) || e instanceof KernelError) throw e
    if (e.message.startsWith('fill:')) throw new ModelingError(e.message) // (the checks of the patch)
    throw new KernelError('fill', e.message, null,
      'tangent sheets must meet each other tangentially where their edges meet; a steep sheet (a wall standing up from the loop) may not leave room for a patch')
  } finally {
    for (const c of curves) ext.delete_curve(c)
  }
  let patch: Shell | Part = Shell._wrap(b)
  if (patch.faces().length > 1) patch = stitch(patch, { tolerance: 1e-5 * size })
  return patch as Shell
}

/**
 * A surface through a network of curves: `u` curves that each cross every `v` curve.
 *
 * @param u Two or more curves running one way, in any order and direction (splines, arcs, edges; a
 *   wire is joined into one curve).
 * @param v Two or more curves running across them: each crosses every `u` curve once. The outer
 *   curves of each set bound the surface: every curve ends on them.
 *
 * The curves are made to cross at common parameters first (a Gordon surface needs that: the
 * kernel's own missed its curves by 4e-2 on a 10 mm patch otherwise), and the surface is measured
 * against the curves as given.
 *
 * @returns A sheet of one face through every curve. Its normal is the first `u` curve's direction
 *   crossed with the first `v` curve's, where they cross.
 * @throws RangeError Curves that do not cross (within 1e-4 of the network's size), that cross out of
 *   order, or that run on past the outer curves of the other set.
 * @throws ModelingError The surface misses a curve by more than 1e-4 of the network's size (a very
 *   uneven network: curves of more even spacing, or more of them, help).
 */
export function network(u: Iterable<Edge | Wire>, v: Iterable<Edge | Wire>): Shell {
  const ucs = _networkCurves(u, 'u')
  let vcs: [number, number[][]][]
  try {
    vcs = _networkCurves(v, 'v')
  } catch (e) {
    for (const [c] of ucs) ext.delete_curve(c)
    throw e
  }
  const pts = [...ucs, ...vcs].flatMap(([, p]) => p)
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])))
  const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])))
  const size = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1e-9)
  let b: number
  let deviation: number
  try {
    ;[b, deviation] = ext.network_surface(ucs.map(([c]) => c), vcs.map(([c]) => c), 1e-4 * size)
  } catch (e) {
    if (!_isRuntimeError(e) || e instanceof KernelError) throw e
    if (e.message.startsWith('network:')) throw new ModelingError(e.message)
    throw new KernelError('network', e.message, null, 'the curves must cross, each u curve every v curve, once')
  } finally {
    for (const [c] of [...ucs, ...vcs]) ext.delete_curve(c)
  }
  const sheet = Shell._wrap(b)
  if (!(deviation <= 1e-4 * size)) {
    throw new ModelingError(`network: the surface misses the curves by ${_g3(deviation)} (more than 1e-4 of the network's size); curves of more even spacing, or more of them, help`)
  }
  return sheet
}

function _g3(x: number): string {
  return Number(x.toPrecision(3)).toString()
}

/** Standalone kernel curves (one per item, wires joined) and a few points of each. */
function _networkCurves(items: unknown, name: string): [number, number[][]][] {
  if (items instanceof Edge || items instanceof Wire || items == null || typeof (items as any)[Symbol.iterator] !== 'function') {
    throw new TypeError(`network: ${name} is a list of curves`)
  }
  const out: [number, number[][]][] = []
  for (const it of items as Iterable<unknown>) {
    let edges: Edge[]
    if (it instanceof Edge) edges = [it]
    else if (it instanceof Wire) edges = Array.from(it.edges())
    else {
      for (const [c] of out) ext.delete_curve(c)
      throw new TypeError(`network: ${name} holds curves (edges or wires), not a ${_typeName(it)}`)
    }
    const pts = edges.flatMap((e) => [0, 0.5, 1].map((t) => e.pointAt(t).toArray()))
    let c: number
    if (edges.length === 1) c = edges[0]._copyCurve()
    else {
      const parts = edges.map((e) => e._copyCurve())
      try {
        c = kernelCall('network', () => ext.join_curves(parts), "a wire's edges must follow one another")
      } finally {
        for (const p of parts) ext.delete_curve(p)
      }
    }
    out.push([c, pts])
  }
  return out
}
