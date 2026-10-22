// smlibpy/shaping.py: local edits of a face: push a point of it, warp or flatten a region of it.
//
// `Part.push`, `Part.warp`, `Part.flatten` and the same methods of `Shell` call these. The face's
// surface gets a change added to it, exactly: a B-spline that is zero away from the edit, so the face's
// edges stay where they are (the edit is refused where it would move one). The change comes from NLib's
// shaping routines; see src/cpp/shape_edit.cpp.
import { ModelingError, ext, k, kernelCall } from './kernel.ts'
import { Plane, Vector, type VectorLike, _vec } from './geometry.ts'
import { Edge, Face, Part, Shell, Sketch, Wire, _asPlane, type _Body } from './shapes.ts'

const PUSH_CONTINUITY: Record<string, number> = { g0: 0, g1: 1, g2: 2 }
const REGION_CONTINUITY: Record<string, number> = { crease: 0, g1: 1, g2: 2 }

function _level(continuity: unknown, table: Record<string, number>, what: string): number {
  const level = typeof continuity === 'string' ? table[continuity.toLowerCase()] : undefined
  if (level === undefined) {
    const names = Object.keys(table).map((n) => `"${n === 'crease' ? n : n.toUpperCase()}"`).join(', ')
    throw new RangeError(`${what}: continuity is one of ${names}, got ${JSON.stringify(continuity)}`)
  }
  return level
}

/** The body's face for `face`: itself, or the face of the body in its place (a face of an earlier
 * version of the body, matched by an interior point and the area). */
function _ownFace(body: _Body, face: unknown, what: string): Face {
  if (!(face instanceof Face)) throw new TypeError(`${what}: face must be a Face, got ${face === null ? 'null' : typeof face === 'object' ? (face as object).constructor.name : typeof face}`)
  if (face._owner !== null && face._owner._h === body._h) return face
  const tol = 1e-6 * Math.max(1, body.bbox().diagonal)
  const p = face.interiorPoint()
  const area = face.area
  for (const g of body.faces()) {
    if (g.distanceTo(p) <= tol && Math.abs(g.area - area) <= 1e-6 * Math.max(1, area)) return g
  }
  throw new RangeError(`${what}: ${face} is not a face of this ${body instanceof Part ? 'part' : 'shell'}`)
}

/** The point of the face nearest to `point`. */
function _onFace(face: Face, point: VectorLike): Vector {
  const [q] = k.face_closest_point(face._f, _vec(point).toArray()) as [VectorLike, number]
  return _vec(q)
}

/** The Brep of `body.push(...)` (see `Part.push`). */
export function _push(body: _Body, face: unknown, at: VectorLike, by: number | VectorLike | null, to: VectorLike | null,
  normal: VectorLike | null, radius: number | null, continuity: string): number {
  const what = 'push'
  const f = _ownFace(body, face, what)
  const level = _level(continuity, PUSH_CONTINUITY, what)
  const q = _onFace(f, at)
  if (by != null && to != null) throw new RangeError('push: give the move as by or as to, not both')
  let move: Vector
  if (to != null) move = _vec(to).sub(q)
  else if (by == null) {
    if (normal == null) throw new RangeError("push: give the move: by (a distance along the face's normal, or a vector) or to (a point)")
    move = new Vector(0, 0, 0)
  } else if (typeof by === 'number') move = f.normalAt(q).mul(by)
  else move = _vec(by)
  let n: number[] = []
  if (normal != null) {
    const nv = _vec(normal)
    if (nv.length === 0) throw new RangeError('push: the normal must not be zero')
    if (!(nv.dot(f.normalAt(q)) > 1e-9 * nv.length)) {
      throw new RangeError("push: the normal must point to the side the face's normal points to (it tilts by less than 90 degrees)")
    }
    n = nv.toArray()
  }
  const size = Math.max(1, f.bbox().diagonal)
  let r: number
  let shrink: boolean
  if (radius == null) {
    // as far as the nearest edge of the face; smaller where that would still move one
    r = Math.min(...f.edges(true).map((e) => e.distanceTo(q)))
    if (!(r > 1e-9 * size)) throw new RangeError('push: the point lies on an edge of the face, which stays where it is: push a point inside the face')
    shrink = true
  } else {
    r = Number(radius)
    if (!(r > 0)) throw new RangeError(`push: the radius must be positive, got ${radius}`)
    shrink = false
  }
  return kernelCall(what, () => ext.push_face(body._brep, f._f, q.toArray(), move.toArray(), n, r, level, shrink))
}

/** The region as points of a closed polygon, x, y, z, x, y, z, ...: a closed wire, a face's or a
 * sketch's outline, or points. */
function _regionPoints(region: unknown, what: string): number[] {
  if (region instanceof Sketch) {
    const faces = region.faces()
    if (faces.length !== 1) throw new RangeError(`${what}: the region sketch has ${faces.length} regions; give one`)
    region = faces[0].outerWire()
  } else if (region instanceof Face) region = region.outerWire()
  else if (region instanceof Edge) region = new Wire([region])
  let pts: Vector[] = []
  if (region instanceof Wire) {
    if (!region.isClosed) throw new RangeError(`${what}: the region's wire is not closed`)
    for (const e of region.edges()) {
      const n = e.geomType === 'line' ? 1 : 32
      for (let i = 0; i < n; i++) pts.push(e.pointAt(i / n))
    }
  } else {
    if (region == null || typeof (region as Iterable<unknown>)[Symbol.iterator] !== 'function' || typeof region === 'string') {
      throw new TypeError(`${what}: the region is a closed Wire, a Face or a Sketch on the face, or a list of points, got ${region === null ? 'null' : typeof region}`)
    }
    pts = [...(region as Iterable<VectorLike>)].map((p) => _vec(p))
  }
  if (pts.length < 3) throw new RangeError(`${what}: the region needs three points or more`)
  return pts.flatMap((p) => p.toArray())
}

/** The Brep of `body.warp(...)` (see `Part.warp`). */
export function _warp(body: _Body, face: unknown, region: unknown, by: number | VectorLike, continuity: string): number {
  const what = 'warp'
  const f = _ownFace(body, face, what)
  const level = _level(continuity, REGION_CONTINUITY, what)
  const pts = _regionPoints(region, what)
  let move: Vector
  if (typeof by === 'number') {
    const m = pts.length / 3
    let x = 0, y = 0, z = 0
    for (let i = 0; i < pts.length; i += 3) x += pts[i], y += pts[i + 1], z += pts[i + 2]
    move = f.normalAt(_onFace(f, [x / m, y / m, z / m])).mul(by)
  } else move = _vec(by)
  return kernelCall(what, () => ext.warp_face(body._brep, f._f, pts, move.toArray(), level))
}

/** The Brep of `body.flatten(...)` (see `Part.flatten`). */
export function _flatten(body: _Body, face: unknown, region: unknown, plane: Plane | Face, continuity: string): number {
  const what = 'flatten'
  const f = _ownFace(body, face, what)
  const level = _level(continuity, REGION_CONTINUITY, what)
  const pts = _regionPoints(region, what)
  const pl = _asPlane(plane)
  return kernelCall(what, () => ext.flatten_face(body._brep, f._f, pts, pl.origin.toArray(), pl.zDir.toArray(), level))
}

/** The result of an edit as a body like `body`: a Part must still be a sound solid; a sketch becomes a
 * shell (an edited face no longer lies in its plane). */
export function _checked(body: Part, brep: number, what: string): Part
export function _checked(body: Shell, brep: number, what: string): Shell
export function _checked(body: Part | Shell, brep: number, what: string): Part | Shell {
  if (body instanceof Part) {
    const out = body._like(brep)
    const problem = out._solidProblem()
    if (problem !== null) throw new ModelingError(`${what}: the kernel returned a body that is ${problem}`)
    return out
  }
  if (body instanceof Sketch) return Shell._wrap(brep, { name: body.name, color: body.color })
  return body._like(brep)
}
