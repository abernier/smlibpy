// Surface modeling: freeform surfaces, stitching surfaces into solids.
//
// Most surface work goes through the regular operations: extruding, revolving, sweeping or
// lofting an *open* curve gives a surface (a Shell) instead of a solid. This module adds surfaces
// through point grids, ruled surfaces and stitching.

import { ext, k, kernelCall } from './kernel.ts'
import { _vec, type VectorLike } from './geometry.ts'
import { Edge, type Face, Part, Shell, Wire, _bodies, _t } from './shapes.ts'
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
 * A freeform NURBS surface from a grid of points.
 *
 * @param points Rows of points, `points[i][j]` (all rows the same length, at least 4 x 4: the
 *   surface is bicubic).
 * @param options `interpolate`: pass through the points (default). `false` uses them as control
 *   points, which gives a smoother surface that only approaches them.
 */
export function surface(points: readonly (readonly VectorLike[])[], options: { interpolate?: boolean } = {}): Shell {
  const interpolate = options.interpolate ?? true
  const grid = Array.from(points, (row) => Array.from(row, (p) => _vec(p).toArray()))
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
