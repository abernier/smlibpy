// Closed loops to a sketch: nesting, fill rules, holes.
//
// Text and DXF drawings both arrive as closed loops of exact curves. Which loops bound material
// and which bound holes follows a fill rule:
//
// - "nonzero" (fonts): a point is inside where the loops around it do not cancel out, counting
//   each loop by its turning sense;
// - "evenodd" (drawings): a point is inside where an odd number of loops surrounds it, so a loop
//   in a loop is a hole and a loop in a hole an island.
//
// The decisions are made on polygons that follow the curves closely (`plan`); the faces are then
// built from the exact curves (`build`). Loops that do not cross each other go to the kernel in
// one call, which makes the faces and puts the holes in them. Loops that cross are resolved with
// 2D Booleans.
//
// A polygon is an array of [x, y] points (numpy's n x 2 array as rows), closed, without repeating
// the first point.

import { KernelError, ModelingError, ext, k, kernelCall } from './kernel.ts'
import type { Plane } from './geometry.ts'
import { Sketch } from './shapes.ts'

/** A closed polygon: its [x, y] points, the first one not repeated at the end. */
export type PolygonPoints = readonly (readonly number[])[]

/**
 * How to make the region of a set of loops.
 *
 * `kind` is "faces" (the loops in `keep` do not cross: one kernel call makes the faces), "union"
 * (each entry of `components` is an outer loop and its holes; the region is the union of these
 * pieces) or "xor" (every loop is a region, combined by the even-odd rule).
 */
export class Plan {
  kind: string
  keep: number[]
  components: [number, number[]][]

  constructor(kind: string, keep: number[] = [], components: [number, number[]][] = []) {
    this.kind = kind
    this.keep = keep
    this.components = components
  }
}

/** Area of a closed polygon (counterclockwise positive). */
export function signedArea(polygon: PolygonPoints): number {
  const n = polygon.length
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % n]
    s1 += p[0] * q[1]
    s2 += q[0] * p[1]
  }
  return 0.5 * (s1 - s2)
}

/** For each point, whether it lies inside the closed polygon (crossing count). */
export function pointInPolygon(points: PolygonPoints, polygon: PolygonPoints): boolean[] {
  const n = polygon.length
  return points.map((pt) => {
    const px = pt[0]
    const py = pt[1]
    let hits = 0
    for (let i = 0; i < n; i++) {
      const [ax, ay] = polygon[i]
      const [bx, by] = polygon[(i + 1) % n]
      if (ay > py !== by > py && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) hits++
    }
    return hits % 2 === 1
  })
}

function _orient(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px)
}

/** True if the edges of two closed polygons cross or touch. */
export function polygonsCross(a: PolygonPoints, b: PolygonPoints): boolean {
  const [amin, amax] = _box(a)
  const [bmin, bmax] = _box(b)
  const lo = [Math.max(amin[0], bmin[0]), Math.max(amin[1], bmin[1])]
  const hi = [Math.min(amax[0], bmax[0]), Math.min(amax[1], bmax[1])]
  if (lo[0] > hi[0] || lo[1] > hi[1]) return false
  // only the edges inside the common box can meet
  const inBox = (p: readonly number[], q: readonly number[]) =>
    [0, 1].every((c) => Math.min(p[c], q[c]) <= hi[c] && Math.max(p[c], q[c]) >= lo[c])
  const edges = (poly: PolygonPoints): [readonly number[], readonly number[]][] => {
    const out: [readonly number[], readonly number[]][] = []
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      if (inBox(p, q)) out.push([p, q])
    }
    return out
  }
  const ea = edges(a)
  const eb = edges(b)
  if (!ea.length || !eb.length) return false
  for (const [P, Q] of ea) {
    for (const [R, S] of eb) {
      const d1 = _orient(P[0], P[1], Q[0], Q[1], R[0], R[1])
      const d2 = _orient(P[0], P[1], Q[0], Q[1], S[0], S[1])
      const d3 = _orient(R[0], R[1], S[0], S[1], P[0], P[1])
      const d4 = _orient(R[0], R[1], S[0], S[1], Q[0], Q[1])
      let meet: boolean
      if (d1 === 0 && d2 === 0) {
        // edges on one line meet only where their extents overlap
        meet = [0, 1].every(
          (c) => Math.max(Math.min(P[c], Q[c]), Math.min(R[c], S[c])) <= Math.min(Math.max(P[c], Q[c]), Math.max(R[c], S[c])),
        )
      } else {
        meet = d1 * d2 <= 0 && d3 * d4 <= 0
      }
      if (meet) return true
    }
  }
  return false
}

/** The pairs of boxes (by index, `[i, j]` with i < j) that overlap: sorted by their left side and
 * swept, so a drawing of many separate loops is not compared pair by pair. `lo` and `hi` are each
 * box's minimum and maximum ([x, y]). */
export function overlappingBoxes(lo: readonly (readonly number[])[], hi: readonly (readonly number[])[]): [number, number][] {
  const order = lo.map((_, i) => i).sort((i, j) => Number(lo[i][0]) - Number(lo[j][0]))
  const pairs: [number, number][] = []
  const le = (u: readonly number[], v: readonly number[]) => {
    for (let c = 0; c < u.length; c++) if (!(u[c] <= v[c])) return false
    return true
  }
  for (let a = 0; a < order.length; a++) {
    const i = order[a]
    for (const j of order.slice(a + 1)) {
      if (lo[j][0] > hi[i][0]) break
      if (le(lo[i], hi[j]) && le(lo[j], hi[i])) pairs.push(i < j ? [i, j] : [j, i])
    }
  }
  return pairs
}

function _samples(polygon: PolygonPoints, count = 5): PolygonPoints {
  const step = polygon.length / count
  const out: (readonly number[])[] = []
  for (let i = 0; i < count; i++) out.push(polygon[Math.trunc(i * step + 0)])
  return out
}

function _box(p: PolygonPoints): [number[], number[]] {
  const lo = [Infinity, Infinity]
  const hi = [-Infinity, -Infinity]
  for (const q of p) {
    for (let c = 0; c < 2; c++) {
      lo[c] = Math.min(lo[c], q[c])
      hi[c] = Math.max(hi[c], q[c])
    }
  }
  return [lo, hi]
}

/**
 * Decide which loops bound the region (see `Plan`).
 *
 * `polygons` follow the loops (closed, without repeating the first point); `areas` are their
 * signed areas when known exactly (the polygons' areas otherwise).
 */
export function plan(polygons: readonly PolygonPoints[], rule: string, areas: readonly number[] | null = null): Plan {
  const n = polygons.length
  if (rule !== 'nonzero' && rule !== 'evenodd') throw new RangeError(`unknown fill rule '${rule}'`)
  if (n === 0) return new Plan('faces')
  const area = areas != null ? areas.map(Number) : polygons.map(signedArea)
  const boxes = polygons.map(_box)
  const crossing = overlappingBoxes(
    boxes.map((b) => b[0]),
    boxes.map((b) => b[1]),
  ).some(([i, j]) => polygonsCross(polygons[i], polygons[j]))

  const contains = (outer: number, inner: number): boolean => {
    const [olo, ohi] = boxes[outer]
    const [ilo, ihi] = boxes[inner]
    if (!(olo[0] <= ilo[0] && olo[1] <= ilo[1] && ihi[0] <= ohi[0] && ihi[1] <= ohi[1])) return false
    const inside = pointInPolygon(_samples(polygons[inner]), polygons[outer])
    return inside.filter(Boolean).length * 2 > inside.length
  }

  const order = [...Array(n).keys()].sort((i, j) => Math.abs(area[i]) - Math.abs(area[j]))
  if (!crossing) {
    if (rule === 'evenodd') return new Plan('faces', [...Array(n).keys()]) // every loop changes inside and outside
    const parent = new Array<number>(n).fill(-1)
    for (let i = 0; i < n; i++) {
      for (const j of order) {
        // the smallest loop around i is its parent
        if (j !== i && Math.abs(area[j]) > Math.abs(area[i]) && contains(j, i)) {
          parent[i] = j
          break
        }
      }
    }
    const winding = new Map<number, number>([[-1, 0]])
    const wind = (i: number): number => {
      if (!winding.has(i)) winding.set(i, wind(parent[i]) + (area[i] > 0 ? 1 : -1))
      return winding.get(i)!
    }
    const keep = [...Array(n).keys()].filter((i) => (wind(i) !== 0) !== (wind(parent[i]) !== 0))
    return new Plan('faces', keep)
  }
  if (rule === 'evenodd') return new Plan('xor', [...Array(n).keys()])
  // nonzero with crossing loops: outer loops turn like the largest one, holes the other way; a
  // hole belongs to the smallest outer loop around it.
  let big = 0
  for (let i = 1; i < n; i++) if (Math.abs(area[i]) > Math.abs(area[big])) big = i
  const sense = area[big] > 0
  const outers = [...Array(n).keys()].filter((i) => area[i] > 0 === sense)
  const holesOf = new Map<number, number[]>(outers.map((i) => [i, []]))
  const bySize = [...outers].sort((i, j) => Math.abs(area[i]) - Math.abs(area[j]))
  for (let h = 0; h < n; h++) {
    if (holesOf.has(h)) continue
    const around = bySize.filter((o) => Math.abs(area[o]) > Math.abs(area[h]) && contains(o, h))
    if (around.length) holesOf.get(around[0])!.push(h)
    else holesOf.set(h, []) // a loop turned the other way outside every outline is filled as well
  }
  return new Plan('union', [], [...holesOf.entries()])
}

/** The sketch of a plan. `curvesOf(i)` returns new kernel curves of loop `i` (consumed). */
export function build(
  p: Plan,
  curvesOf: (i: number) => number[],
  plane: Plane,
  what: string,
  hint = 'the outlines must be planar and closed',
): Sketch {
  const faces = (indices: readonly number[]): Sketch => {
    const curves: number[] = []
    try {
      for (const i of indices) curves.push(...curvesOf(i))
      return kernelCall(what, () => Sketch._wrap(k.create_planar_faces(curves), { plane }), hint)
    } catch (e) {
      for (const c of curves) {
        // not consumed on failure
        try {
          ext.delete_curve(c)
        } catch {
          // (ignored)
        }
      }
      throw e
    }
  }

  if (p.kind === 'faces') {
    if (!p.keep.length) throw new ModelingError(`${what}: nothing to draw (the outlines enclose no area)`)
    try {
      return faces(p.keep)
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      if (p.keep.length === 1) throw e
      // loops that touch upset the kernel's nesting: build each loop and combine them
      return _combined(p.keep.map((i) => faces([i])))
    }
  }
  if (p.kind === 'xor') {
    let result: Sketch | null = null
    for (const i of p.keep) {
      const piece = faces([i])
      result = result === null ? piece : result.xor(piece)
    }
    return result!
  }
  const pieces = p.components.map(([outer, holes]) => faces([outer, ...holes]))
  let result = pieces[0]
  for (const piece of pieces.slice(1)) result = result.fuse(piece)
  return result
}

/** Even-odd combination of single-loop regions that may touch. */
function _combined(pieces: readonly Sketch[]): Sketch {
  let result = pieces[0]
  for (const piece of pieces.slice(1)) result = result.xor(piece)
  return result
}

/** One sketch holding the faces of sketches that do not overlap (no Booleans). */
export function unionDisjoint(sketches: readonly Sketch[], plane: Plane, what: string): Sketch {
  if (sketches.length === 1) return sketches[0]
  const b = kernelCall(what, () => ext.combine(sketches.map((s) => s._brep)))
  return Sketch._wrap(b, { plane })
}
