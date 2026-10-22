// smlibpy/sheet_edit.py: editing sheets face by face: an edge matched to a curve, two faces merged
// into one.
//
// `Shell.matchEdge` and `Shell.mergeFaces` call these; see src/cpp/sheet_edit.cpp.
import { ModelingError, ext, kernelCall } from './kernel.ts'
import { Edge, Face, Shell, Wire } from './shapes.ts'
import { _ownFace } from './shaping.ts'
import { stitch } from './surfaces.ts'

/** The sheet's edge for `edge`: itself, or the edge of the sheet in its place (an edge of an earlier
 * version of the sheet, matched by its ends and middle). */
function _ownEdge(body: Shell, edge: unknown, what: string): Edge {
  if (!(edge instanceof Edge)) {
    throw new TypeError(`${what}: edge must be an Edge, got ${edge === null ? 'null' : typeof edge === 'object' ? (edge as object).constructor.name : typeof edge}`)
  }
  if (edge._ke !== 0 && edge._owner !== null && edge._owner._h === body._h) return edge
  const tol = 1e-6 * Math.max(1, body.bbox().diagonal)
  const [a, b] = [edge.start, edge.end]
  const m = edge.pointAt(0.5)
  for (const g of body.edges()) {
    if (g.pointAt(0.5).sub(m).length <= tol &&
      Math.min(g.start.sub(a).length + g.end.sub(b).length, g.start.sub(b).length + g.end.sub(a).length) <= 2 * tol) return g
  }
  throw new RangeError(`${what}: ${edge} is not an edge of this sheet`)
}

/** A new kernel curve along an edge or a wire (a wire's edges joined into one). */
function _targetCurve(target: unknown): number {
  if (target instanceof Edge) return target._copyCurve()
  if (target instanceof Wire) {
    const edges = target.edges()
    if (edges.length === 1) return edges[0]._copyCurve()
    if (target.isClosed) throw new RangeError('matchEdge: the curve is a closed wire; an edge runs between two ends')
    const curves = edges.map((e) => e._copyCurve())
    try {
      return kernelCall('matchEdge', () => ext.join_curves(curves), "the wire's edges must join end to end")
    } finally {
      for (const c of curves) ext.delete_curve(c)
    }
  }
  throw new TypeError(`matchEdge: the curve is an Edge or a Wire, got ${target === null ? 'null' : typeof target === 'object' ? (target as object).constructor.name : typeof target}`)
}

/** The Brep of `body.matchEdge(...)` (see `Shell.matchEdge`). */
export function _matchEdge(body: Shell, edge: unknown, target: Edge | Wire, extent: number): number {
  const what = 'matchEdge'
  const e = _ownEdge(body, edge, what)
  if (!(typeof extent === 'number' && extent > 0 && extent < 1)) {
    throw new RangeError(`matchEdge: the extent is a part of the face across from the edge, above 0 and below 1; got ${extent}`)
  }
  const c = _targetCurve(target)
  try {
    return kernelCall(what, () => ext.match_edge(body._brep, e._e, c, extent),
      'the faces must be bounded by the four sides of their surfaces (as surface(), loft, ruled, fill and network make them), the edge one whole side of its face')
  } finally {
    ext.delete_curve(c)
  }
}

/** `body.mergeFaces(a, b)` (see `Shell.mergeFaces`): a Shell. */
export function _mergeFaces(body: Shell, a: unknown, b: unknown): Shell {
  const what = 'mergeFaces'
  const fa = _ownFace(body, a, what)
  const fb = _ownFace(body, b, what)
  if (fa.equals(fb)) throw new RangeError('mergeFaces: a and b are the same face')
  const merged = Shell._wrap(kernelCall(what, () => ext.merge_faces(fa._f, fb._f),
    'the faces must be bounded by the four sides of their surfaces and share one whole side'))
  const faces = body.faces()
  const others = faces.filter((f: Face) => !f.equals(fa) && !f.equals(fb))
  if (!others.length) return merged
  const rest = Shell._wrap(kernelCall(what, () => ext.copy_faces(body._brep, others.map((f: Face) => f._f))))
  const size = body.bbox().diagonal
  const joined = stitch(rest, merged, { tolerance: Math.max(1e-5 * size, 1e-7) })
  // the same border: free edges as long as before, and one face less
  const before = _freeLength(body)
  const after = _freeLength(joined)
  if (joined.faces().length !== faces.length - 1 || Math.abs(before - after) > Math.max(1e-6 * Math.max(Math.abs(before), Math.abs(after)), 1e-6 * size)) {
    throw new ModelingError(`mergeFaces: the merged face could not be sewn to the sheet's other faces (free edges ${before.toPrecision(6)} long before, ${after.toPrecision(6)} after)`)
  }
  return joined as Shell
}

function _freeLength(body: { edges(): Edge[] }): number {
  let total = 0
  for (const e of body.edges()) if (e.faces().length === 1) total += e.length
  return total
}
