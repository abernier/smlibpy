// Surface modeling: freeform surfaces, stitching surfaces into solids.
//
// Most surface work goes through the regular operations: extruding, revolving, sweeping or
// lofting an *open* curve gives a surface (a Shell) instead of a solid. This module adds surfaces
// through point grids, ruled surfaces and stitching.

import { ModelingError, ext, k, kernelCall } from './kernel.ts'
import { Vector, _vec, type VectorLike } from './geometry.ts'
import { Edge, Face, Part, Shell, Wire, _bodies, _t, _typeName } from './shapes.ts'
import { _guarded } from './defeature.ts'
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
 *   to the points: 0 to 1, default 1e-3; raise it for noisy points.
 *
 * A cloud must be a height field over its best-fit plane (no overhangs, nothing folded over). The
 * surface spans the smallest rectangle around the points in that plane; where there are no
 * points, the smoothing shapes it.
 */
export function surface(
  points: readonly (readonly VectorLike[])[] | readonly VectorLike[],
  options: { interpolate?: boolean; controls?: number | readonly [number, number] | null; smoothing?: number } = {},
): Shell {
  if (_isCloud(points)) return _fit(points as readonly VectorLike[], options.controls ?? null, options.smoothing ?? 1e-3)
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
  if (part.isValid()) return part
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
 *   roll, one per combination. Default `[1, 1]`.
 * @returns The blend, a sheet whose edges along its length lie on the two surfaces.
 */
export function surfaceFillet(a: Face | Shell, b: Face | Shell, radius: number, options: { sides?: readonly [number, number] } = {}): Shell {
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
  const brep: number = kernelCall('surfaceFillet', () =>
    _guarded('surfaceFillet', () => k.surface_surface_fillet(sa, sb, { radius1: r1, radius2: r2, tolerance, xsect_type: 2 })), hint)
  if (!brep) throw new ModelingError(`surfaceFillet: the kernel made no blend; ${hint}`)
  const shell = Shell._wrap(brep)
  if (!shell.faces().length) throw new ModelingError(`surfaceFillet: the kernel made no blend; ${hint}`)
  return shell
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
