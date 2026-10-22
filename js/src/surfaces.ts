// Surface modeling: freeform surfaces, stitching surfaces into solids.
//
// Most surface work goes through the regular operations: extruding, revolving, sweeping or
// lofting an *open* curve gives a surface (a Shell) instead of a solid. This module adds surfaces
// through point grids, ruled surfaces and stitching.

import { ModelingError, _opts, ext, k, kernelCall } from './kernel.ts'
import { Vector, _vec, type VectorLike } from './geometry.ts'
import { Edge, Face, Part, Shell, Wire, _bodies, _continuity, _t, _typeName } from './shapes.ts'
import { _guarded, _smb } from './defeature.ts'
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
 *   control points.
 *
 * A cloud must be a height field over its best-fit plane (no overhangs, nothing folded over). The
 * surface spans the smallest rectangle around the points in that plane; where there are no
 * points, the smoothing shapes it. Its normal points up (+Z); for a cloud that stands upright, to
 * +Y, else to +X.
 */
export function surface(
  points: readonly (readonly VectorLike[])[] | readonly VectorLike[],
  options: { interpolate?: boolean; controls?: number | readonly [number, number] | null; smoothing?: number } = {},
): Shell {
  _opts('surface', options)
  if (_isCloud(points)) return _fit(points as readonly VectorLike[], options.controls ?? null, options.smoothing ?? 1e-2)
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

/**
 * Sew faces and sheets along their common edges: `stitch(a, b, c, { tolerance: 0.01 })`.
 *
 * Returns a Part when the result encloses a volume, otherwise a Shell. `tolerance` is the
 * largest gap to close (default: 1e-4 of the model size).
 */
export function stitch(...args: (Shell | Face | Part | Iterable<unknown> | { tolerance?: number | null })[]): Part | Shell {
  const { items, options } = _withOptions<{ tolerance?: number | null }>(args)
  _opts('stitch', options)
  const bodies = _bodies(items)
  if (!bodies.length) throw new RangeError('nothing to stitch')
  const b = kernelCall('stitch', () => ext.combine(bodies.map((x) => x._brep)))
  const shell = Shell._wrap(b)
  const size = shell.bbox().diagonal
  const gap = options.tolerance ?? Math.max(size * 1e-4, 1e-7)
  kernelCall(
    'stitch',
    () => {
      const [, isSolid] = k.stitch_into_solid(shell._brep)
      if (!isSolid) k.stitch_into_shell(shell._brep, gap)
    },
    'the pieces may not meet within the tolerance',
  )
  const part = Part._wrap(shell._copyBrep())
  if (part._solidProblem() === null) return part
  return shell
}

/**
 * A round blend between the surfaces of two faces, as a sheet: for surfaces that are not the
 * faces of one part, such as two sheets that cross (`fillet` rounds the edges of a part).
 *
 * @param a The first face (or a sheet of one face). Its surface is blended, as far as it reaches:
 *   the blend may run past the face.
 * @param b The second face.
 * @param radius The radius of the blend: of the ball that rolls between the two surfaces.
 * @param options `sides`: the side of each face the blend lies on: 1 the side its normal
 *   (`normalAt()`) points to, -1 the other. Two crossing surfaces leave four places for a ball to
 *   roll, one per combination. Default `[1, 1]`. `trim`: `true` cuts both faces back to the blend's
 *   long edges and sews the three into one sheet; the blend's edges must run across both faces,
 *   from border to border.
 * @returns The blend, a sheet whose edges along its length lie on the two surfaces; with `trim` the
 *   two faces, cut back, and the blend between them as one sheet.
 */
export function surfaceFillet(a: Face | Shell, b: Face | Shell, radius: number, options: { sides?: readonly [number, number]; trim?: boolean } = {}): Shell {
  _opts('surfaceFillet', options)
  const sides = options.sides ?? [1, 1]
  const fa = _oneFace(a, 'a')
  const fb = _oneFace(b, 'b')
  if (!(radius > 0) || !Number.isFinite(radius)) throw new RangeError(`surfaceFillet: the radius must be positive, got ${radius}`)
  if (sides.length !== 2 || sides.some((x) => x !== 1 && x !== -1)) throw new RangeError(`surfaceFillet: sides must be two of 1 and -1, got ${JSON.stringify(sides)}`)
  // (the kernel's sides are those of each surface's own normal, which a face may turn around)
  const r1 = radius * sides[0] * (fa._naturalIsOutward() ? 1 : -1)
  const r2 = radius * sides[1] * (fb._naturalIsOutward() ? 1 : -1)
  const size = Math.max(fa.bbox().union(fb.bbox()).diagonal, radius)
  const tolerance = Math.max(1e-7 * size, 1e-9)
  const hint = 'the surfaces may not meet, or not leave room for the radius on those sides'
  // (on copies: the kernel changes the surfaces it blends, and a second blend of the same surfaces
  // then fails)
  const ca = fa.toShell()
  const cb = fb.toShell()
  const sa = k.face_surface(ca.faces()[0]._f)
  const sb = k.face_surface(cb.faces()[0]._f)
  const kw = { radius1: r1, radius2: r2, tolerance, xsect_type: 2 }
  const brep: number = kernelCall('surfaceFillet', () =>
    _guarded('surfaceFillet', () => k.surface_surface_fillet(sa, sb, kw), () => ({ op: 'surface_fillet', bodies: [_smb(ca), _smb(cb)], options: kw })), hint)
  if (!brep) throw new ModelingError(`surfaceFillet: the kernel made no blend; ${hint}`)
  const shell = Shell._wrap(brep)
  if (!shell.faces().length) throw new ModelingError(`surfaceFillet: the kernel made no blend; ${hint}`)
  if (options.trim) return _trimmedFillet(fa, fb, shell, Math.max(1e-5 * size, 1e-7))
  return shell
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
 * follows `edgeA`'s sheet. Closed edges (a full circle) cannot be bridged: split the sheet so that
 * the edge has two ends.
 *
 * @returns The blend, a sheet of one face (with `join`, the two sheets and the blend sewn into one).
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
  if (_freeEdges(joined) !== sheets.reduce((n, x) => n + _freeEdges(x), 0)) {
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
