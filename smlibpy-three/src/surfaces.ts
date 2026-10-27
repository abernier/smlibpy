// Surfaces: freeform sheets through points or from NURBS data (three's NURBSSurface too), ruled sheets
// between curves, blends, bridges and patches, and stitching sheets into solids, in three's terms:
// points are THREE.Vector3s, curves Edges, Wires or three's own curves, and results Shells (meshes
// drawn on both sides), or Parts where stitched pieces close around a volume.
//
//     const terrain = surface(rows)                         // through a grid of THREE.Vector3s
//     const [scan, fit] = surface(cloud, { report: true })  // fitted to a cloud, and how close it came
//     const solid = stitch(box.faces())                      // a box's faces sewn into a Part again
//
// Shapes and curves are taken where they are; a result is in the frame of the first of them, with its
// transform, as results of operations on it are. Sheets made of points alone (surface, nurbsSurface)
// are at the origin, in the coordinates of their points.
import type * as THREE from 'three'
import type { NURBSSurface } from 'three/addons/curves/NURBSSurface.js'
import { call, describe, sm, vec, type SmBody } from './kernel.ts'
import { BrepEdge, isObject3D, kernelOf, kernelOfShape, operand, pathOf, toThree, type Body, type BrepFace, type Part, type Shell, type Wire } from './shapes.ts'

// (this module and shapes.ts import each other: what it takes from shapes.ts is used in calls only,
// never while the module loads)

/** A curve given to a surface: a BrepEdge or Wire (where it is), or one of three's 3D curves (in the
 * frame of the first curve). */
export type CurveLike = BrepEdge | Wire | THREE.Curve<THREE.Vector3>

// ----------------------------------------------------------------------------------- from points
/**
 * How far the points given to `surface` lie from it, each to its closest point on the surface, in
 * model units (`surface(points, { report: true })`).
 */
export class FitReport {
  /** The largest distance of a point from the surface. */
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

/** Options of `surface`. */
export interface SurfaceOptions {
  /** Grids: pass through the points (default); false takes them as control points, for a smoother
   * surface that only approaches them. */
  interpolate?: boolean
  /** Clouds: control points per direction, one number or [along, across] (4 to 64, "along" the
   * longer side of the cloud); default about one per 8 points. */
  controls?: number | readonly [number, number] | null
  /** Clouds: how much the surface resists bending, against how close it comes to the points, 0 to 1
   * (default 0.01); for noisy points raise it (0.1 to 1), or take fewer control points. */
  smoothing?: number
  /** True: `[sheet, report]`, with a FitReport of how far each point lies from the surface. */
  report?: boolean
}

/**
 * A freeform NURBS sheet through a grid of points, or fitted to a cloud of points (THREE.Vector3s, or
 * `{ x, y, z }`), at the origin. A grid is rows of points, `points[i][j]`, all rows the same length
 * and at least 4 x 4 (the surface is bicubic); its normal is (points[i + 1][j] - points[i][j]) ×
 * (points[i][j + 1] - points[i][j]), so rows that follow one another along +z, each running along +x,
 * face up (+y). A cloud is points in any order (at least 4), such as a scan, which the surface
 * approaches; it spans the smallest rectangle around them in their best-fit plane and faces +z where
 * that plane's normal has a z part (a cloud over the XY plane faces +z), else +y, else +x. A cloud
 * must be a height field over its
 * best-fit plane (no overhangs); one that is not gets a surface that misses it, without an error:
 * check the report's `maxDistance`.
 */
export function surface(points: readonly (readonly THREE.Vector3Like[])[] | readonly THREE.Vector3Like[], options: SurfaceOptions & { report: true }): [Shell, FitReport]
export function surface(points: readonly (readonly THREE.Vector3Like[])[] | readonly THREE.Vector3Like[], options?: SurfaceOptions): Shell
export function surface(points: readonly (readonly THREE.Vector3Like[])[] | readonly THREE.Vector3Like[], options: SurfaceOptions = {}): Shell | [Shell, FitReport] {
  if (!Array.isArray(points)) throw new TypeError(`surface: give rows of points (THREE.Vector3s) or a list of points, not ${describe(points)}`)
  const kernel = (points as readonly unknown[]).map((p) => (Array.isArray(p) ? p.map((q: THREE.Vector3Like) => vec(q)) : vec(p as THREE.Vector3Like)))
  const out = call(() => sm.surface(kernel as sm.Vector[], options)) as sm.Shell | [sm.Shell, sm.FitReport]
  if (!Array.isArray(out)) return toThree(out, null) as Shell
  const [sheet, r] = out
  return [toThree(sheet, null) as Shell, new FitReport(r.maxDistance, r.rmsDistance, Array.from(r.distances))]
}

/** A surface's NURBS data, in three's coordinates: its degrees [u, v], its knot vectors [u, v], its
 * control points in rows (`points[i][j]`: i along u, j along v) and a weight for each (null: not
 * rational). */
export interface NurbsSurfaceData {
  readonly degrees: readonly [number, number]
  readonly knots: readonly [readonly number[], readonly number[]]
  readonly points: readonly (readonly THREE.Vector3Like[])[]
  readonly weights?: readonly (readonly number[])[] | null
}

/** three's NURBSSurface as it keeps itself (its declared type has none of it). */
interface ThreeNurbs {
  degree1: number
  degree2: number
  knots1: readonly number[]
  knots2: readonly number[]
  controlPoints: readonly (readonly { x: number; y: number; z: number; w?: number }[])[]
}

/**
 * A sheet of one face from a surface's NURBS data, as other programs, files and papers give it: the
 * control points in rows (`points[i][j]` the point i along u and j along v, THREE.Vector3s; all rows
 * the same length, at least degree + 1 each way), the knot vectors `[uKnots, vKnots]` (each knot as
 * often as its multiplicity, not decreasing; default uniform and clamped, so the surface starts and
 * ends at the corners of the net), the degrees `[u, v]` or one for both (default: from the knots,
 * else 3, less where there are fewer points), and a positive weight per control point in the same
 * rows (null: not rational). Or the data in one object (NurbsSurfaceData: the inverse of
 * `BrepFace.nurbs()`, in the frame of the face's body), or three's NURBSSurface
 * (three/addons/curves/NURBSSurface.js) read as three evaluates it: `degree1` and `knots1` along u
 * (the first index of its control points), and the `w` of each control point its weight (for
 * clamped knots, which three's getPoint assumes, the same surface). The face's normal is along
 * du × dv; the sheet is at the origin.
 */
export function nurbsSurface(
  points: readonly (readonly THREE.Vector3Like[])[] | NurbsSurfaceData | NURBSSurface,
  knots: readonly [readonly number[], readonly number[]] | null = null,
  degrees: number | readonly [number, number] | null = null,
  weights: readonly (readonly number[])[] | null = null,
): Shell {
  let rows = points as readonly (readonly THREE.Vector3Like[])[]
  if (!Array.isArray(points) && points !== null && typeof points === 'object' && knots === null && degrees === null && weights === null) {
    const three = points as unknown as Partial<ThreeNurbs>
    const data = points as Partial<NurbsSurfaceData>
    if (typeof three.degree1 === 'number' && Array.isArray(three.knots1) && Array.isArray(three.controlPoints)) {
      const n = three as ThreeNurbs
      rows = n.controlPoints
      knots = [n.knots1, n.knots2]
      degrees = [n.degree1, n.degree2]
      const w = n.controlPoints.map((row) => row.map((p) => (typeof p.w === 'number' ? p.w : 1)))
      weights = w.some((row) => row.some((x) => x !== 1)) ? w : null
    } else if (Array.isArray(data.points) && data.knots !== undefined && data.degrees !== undefined) {
      rows = data.points
      knots = data.knots
      degrees = data.degrees
      weights = data.weights ?? null
    } else {
      throw new TypeError('nurbsSurface: give control points in rows, the data of a surface ({ degrees, knots, points, weights }) or a NURBSSurface of three')
    }
  }
  if (!Array.isArray(rows) || !rows.every((row) => Array.isArray(row))) throw new RangeError('nurbsSurface: the control points are rows of points, all rows the same length')
  const grid = rows.map((row) => row.map((p) => vec(p)))
  return toThree(call(() => sm.nurbsSurface(grid, knots, degrees, weights)), null) as Shell
}

// ----------------------------------------------------------------------------------- from curves
/**
 * The ruled sheet between two curves (Edges, Wires of one edge, or three's curves): straight lines
 * join matching points of the two. In the frame of `a`, with its transform; `b` is taken where it is.
 */
export function ruled(a: CurveLike, b: CurveLike): Shell {
  const into = isObject3D(a) ? a : null
  const ka = pathOf(a, into)
  const kb = pathOf(b, into)
  return toThree(call(() => sm.ruled(ka, kb)), into) as Shell
}

/** Options of `fill`. */
export interface FillOptions {
  /** True (default): where the curves are border edges of sheets, the patch meets each sheet
   * tangentially along its edge (then every curve must be such an edge, and the sheets must meet one
   * another tangentially where the edges meet); false runs the patch through the curves only. */
  tangent?: boolean
}

/**
 * A sheet that fills a closed loop of curves: a hole in a sheet, or the frame of a patch. The curves
 * (border edges of sheets, `sheet.edges().filter((e) => e.faces().length === 1)`, other Edges, Wires
 * or three's curves) come in any order and direction and are taken where they are; a sheet's edges
 * keep their sheet, so that the patch can meet it tangentially. Four sides make a Coons patch of one
 * face, three or five and more an N-sided fill, one or two closed curves are cut into four sides. The
 * patch is in the frame of the first curve, with its transform; sew it to the sheets with
 * `stitch(sheet, patch)`.
 */
export function fill(boundary: CurveLike | Iterable<CurveLike>, options: FillOptions = {}): Shell {
  const items = curves(boundary, 'fill')
  if (!items.length) throw new RangeError('fill: no curves')
  const into = isObject3D(items[0]) ? items[0] : null
  const moved = new Map<Body, Moved>()
  const kernel = items.map((c) => (c instanceof BrepEdge && c.owner !== null ? bodyEdge(c, into, moved, 'fill') : pathOf(c, into)))
  return toThree(call(() => sm.fill(kernel, options)), into) as Shell
}

/**
 * A sheet through a network of curves (a Gordon surface): `u` curves that each cross every `v` curve
 * once, the outer curves of each set bounding it (Edges, Wires or three's curves, where they are, in
 * any order and direction). It runs through the curves (to 1e-7 of their size); its normal is the
 * first `u` curve's direction crossed with the first `v` curve's, where they cross. In the frame of the
 * first `u` curve, with its transform.
 */
export function network(u: Iterable<CurveLike>, v: Iterable<CurveLike>): Shell {
  const us = curves(u, 'network', true)
  const vs = curves(v, 'network', true)
  const into = us.length && isObject3D(us[0]) ? us[0] : null
  const ku = us.map((c) => pathOf(c, into))
  const kv = vs.map((c) => pathOf(c, into))
  return toThree(call(() => sm.network(ku, kv)), into) as Shell
}

/** The curves of a list of them (or one), each a curve of the package or of three's. */
function curves(items: CurveLike | Iterable<CurveLike>, what: string, list = false): CurveLike[] {
  const one = (x: unknown) => isObject3D(x) || typeof (x as THREE.Curve<THREE.Vector3> | null)?.getPoint === 'function'
  if (one(items)) {
    if (list) throw new TypeError(`${what}: give a list of curves, not one ${describe(items)}`)
    return [items as CurveLike]
  }
  if (items === null || typeof items !== 'object' || typeof (items as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    throw new TypeError(`${what}: give curves (Edges, Wires or three's curves), not ${describe(items)}`)
  }
  return [...(items as Iterable<CurveLike>)]
}

/** A body moved into the frame of an operation, and its edges. */
interface Moved {
  value: SmBody
  edges: sm.Edge[] | null
}

/**
 * The kernel edge of `edge` (an edge of a body) in the frame of `into`, still an edge of its body, so
 * that a sheet's border edge keeps its sheet: the body is moved into the frame (once per operation,
 * `moved`), and the edge taken from it at its place among the body's edges (a moved copy keeps their
 * order).
 */
function bodyEdge(edge: BrepEdge, into: THREE.Object3D | null, moved: Map<Body, Moved>, what: string): sm.Edge {
  const owner = edge.owner!
  let m = moved.get(owner)
  if (m === undefined) {
    m = { value: operand(owner, into, what) as SmBody, edges: null }
    moved.set(owner, m)
  }
  if (m.value === kernelOf(owner)) return kernelOfShape(edge) as sm.Edge
  const value = m.value
  m.edges ??= call(() => [...value.edges()])
  return m.edges[edge.index]
}

// --------------------------------------------------------------------------------------- blends
/** Options of `surfaceFillet`. */
export interface SurfaceFilletOptions {
  /** Chamfers only: a second distance, from `b` (default `radius`). */
  radius2?: number | null
  /** 'round' (default): a circular cross-section; 'chamfer': a flat one, straight across between the
   * lines where the round of the same radius meets the surfaces. */
  shape?: 'round' | 'chamfer'
  /** The side of each face the blend lies on: 1 the side its normal (`normalAt()`) points to, -1 the
   * other (default [1, 1]). Two crossing surfaces leave four places for a ball to roll. */
  sides?: readonly [number, number]
  /** True: both faces cut back to the blend's long edges and sewn to it into one sheet. */
  trim?: boolean
}

/**
 * A round blend between the surfaces of two faces (or sheets of one face), as a sheet: for surfaces
 * that are no faces of one part, such as two sheets that cross (`Part.fillet` rounds a part's edges).
 * A ball of `radius` rolls between the two surfaces, as far as they reach; the blend's long edges lie
 * on them. `b` is taken where it is; the blend is in the frame of `a` (its body's, for a face), with
 * its transform.
 */
export function surfaceFillet(a: BrepFace | Shell, b: BrepFace | Shell, radius: number, options: SurfaceFilletOptions = {}): Shell {
  const ka = operand(a, a, 'surfaceFillet') as sm.Face | sm.Shell
  const kb = operand(b, a, 'surfaceFillet') as sm.Face | sm.Shell
  return toThree(call(() => sm.surfaceFillet(ka, kb, radius, options)), a) as Shell
}

/** Options of `blend`. */
export interface BlendOptions {
  /** How smoothly the blend meets the sheets: 'G1' tangent, 'G2' (default) with the same curvature
   * across the edges too, 'G3' also the same change of curvature. */
  continuity?: 'G1' | 'G2' | 'G3' | number
  /** How far the blend runs on in each sheet's direction before it turns, as a part of the gap
   * (default 1): one number, or one per edge; less is tighter, more bulges. */
  tension?: number | readonly [number, number]
  /** True: the blend sewn to both sheets, one sheet. */
  join?: boolean
}

/**
 * A smooth bridge between border edges of two sheets (edges one face uses:
 * `sheet.edges().filter((e) => e.faces().length === 1)`): a sheet that leaves one sheet across
 * `edgeA` and reaches the other across `edgeB`, tangent to both or smoother. It joins the nearest ends
 * of the two edges, and its normal follows `edgeA`'s sheet; two closed edges (the rims of two tubes)
 * are bridged all round. The sheets are taken where they are; the blend is in the frame of `edgeA`'s
 * sheet, with its transform.
 */
export function blend(edgeA: BrepEdge, edgeB: BrepEdge, options: BlendOptions = {}): Shell {
  for (const [e, name] of [[edgeA, 'edgeA'], [edgeB, 'edgeB']] as const) {
    if (!(e instanceof BrepEdge)) throw new TypeError(`blend: ${name} is an edge of a sheet, not ${describe(e)}`)
  }
  const into = edgeA.owner ?? edgeA
  const moved = new Map<Body, Moved>()
  const ka = edgeA.owner !== null ? bodyEdge(edgeA, into, moved, 'blend') : (operand(edgeA, into, 'blend') as sm.Edge)
  const kb = edgeB.owner !== null ? bodyEdge(edgeB, into, moved, 'blend') : (operand(edgeB, into, 'blend') as sm.Edge)
  return toThree(call(() => sm.blend(ka, kb, options)), edgeA) as Shell
}

// ------------------------------------------------------------------------------------- stitching
/** What `stitch` sewed (`stitch(..., { report: true })`). */
export class StitchReport {
  /** Pairs of free edges sewn into one edge. */
  readonly sewnEdges: number
  /** Free edges left: the border of a sheet, and edges whose partner lies further away than the
   * tolerance. */
  readonly openEdges: number
  /** The widest gap closed, between vertices or edges that were sewn (0 where the pieces met
   * exactly); every gap closed is at most `tolerance`. */
  readonly maxGap: number
  /** Faces turned over so that their normals agree with their neighbours' (on open results; a
   * closed result faces outward anyway). */
  readonly turnedFaces: number
  /** The widest gap looked for: the tolerance given, or its default, or less where every edge was
   * sewn before. */
  readonly tolerance: number

  constructor(sewnEdges: number, openEdges: number, maxGap: number, turnedFaces: number, tolerance: number) {
    this.sewnEdges = sewnEdges
    this.openEdges = openEdges
    this.maxGap = maxGap
    this.turnedFaces = turnedFaces
    this.tolerance = tolerance
  }
}

/** Options of `stitch`. */
export interface StitchOptions {
  /** The widest gap to close (default 1e-4 of the size of all pieces together); edges and vertices
   * further apart stay open. */
  tolerance?: number | null
  /** True: `[body, report]`, with a StitchReport of what was sewn. */
  report?: boolean
}

/** What `stitch` sews: faces, sheets (sketches too) and parts, and lists of them. */
export type StitchPiece = Part | Shell | BrepFace | Iterable<StitchPiece>

/**
 * Faces and sheets sewn along their common edges: `stitch(a, b, c, { tolerance: 0.01 })`, or
 * `stitch(box.faces())`. The pieces are taken where they are. Edges that meet closely are sewn first,
 * looser ones after them, up to the tolerance: a wider gap is never closed silently. A Part where the
 * pieces close around a volume (its faces then point outward), else a Shell whose faces are turned
 * to agree with their neighbours (each connected piece keeps the normal of its first face, in the
 * order given). In the frame of the first piece (its body's, for a face), with its transform.
 */
export function stitch(...args: [...StitchPiece[], StitchOptions & { report: true }]): [Part | Shell, StitchReport]
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell | [Part | Shell, StitchReport] {
  const last = args[args.length - 1] as unknown
  const given = last !== null && typeof last === 'object' && !isObject3D(last) && Object.getPrototypeOf(last) === Object.prototype
  const options = (given ? last : {}) as StitchOptions
  const pieces: unknown[] = []
  const add = (x: unknown): void => {
    if (x !== null && typeof x === 'object' && !isObject3D(x) && typeof (x as Iterable<unknown>)[Symbol.iterator] === 'function') for (const y of x as Iterable<unknown>) add(y)
    else pieces.push(x)
  }
  for (const x of given ? args.slice(0, -1) : args) add(x)
  if (!pieces.length) throw new RangeError('stitch: nothing to stitch')
  const first = pieces[0]
  if (!isObject3D(first)) throw new TypeError(`stitch: give faces, sheets or parts, not ${describe(first)}`)
  const kernel = pieces.map((p) => operand(p, first, 'stitch'))
  const out = call(() => sm.stitch(kernel, options)) as sm.Part | sm.Shell | [sm.Part | sm.Shell, sm.StitchReport]
  if (!Array.isArray(out)) return toThree(out, first) as Part | Shell
  const [body, r] = out
  return [toThree(body, first) as Part | Shell, new StitchReport(r.sewnEdges, r.openEdges, r.maxGap, r.turnedFaces, r.tolerance)]
}
