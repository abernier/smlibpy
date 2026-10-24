// Draft analysis, parting lines and face drafts, for parts that are molded or cast.
//
// A mold half moves away from the part along the pull direction `d`. A face releases from it when
// it turns towards `d`. The draft angle of a face at a point is the angle between the face and
// `d`: `asin(n . d)` for the outward normal `n`, in degrees. It is +90 where the face looks along
// `d`, 0 on a wall parallel to `d`, and negative where the face turns away from `d` (an undercut
// for that mold half).
//
// The kernel provides the silhouettes of a surface for a direction (where `n . d = 0`) and puts
// curves into faces as edges; the parting line comes from a copy of the part split along them.
//
// A face draft turns faces by an angle about the lines where they meet a neutral plane, whose
// normal is the pull direction. The kernel's SmBrep::LocalOperation rebuilds the part from the new
// surfaces of the drafted faces and the extended surfaces of the faces around them
// (src/cpp/face_draft.cpp); the result is checked, because the kernel can return a closed body
// whose edges leave its faces.

import { ModelingError, _crashOf, _isCrash, ext, k, kernelCall } from './kernel.ts'
import { CenterArc } from './curves.ts'
import { type Axis, Plane, Vector, type VectorLike, _degrees as _toDegrees, _direction, _formatG, _radians } from './geometry.ts'
import { Edge, Face, Part, ShapeList, Shell, Wire, _Body, _asPlane, _flattenFaces, _list } from './shapes.ts'

// biome-ignore lint: the kernel's results are what their bindings return
type Any = any

const inspect = Symbol.for('nodejs.util.inspect.custom')

/** Draft angles (degrees) within this of 0 count as none: such a face is parallel to the pull
 * direction there. */
export const ANGLE_TOLERANCE = 1e-6

const _DR = k.draft
const _GRID = 12 // parameter grid per face before the extremes are refined

/** Least and greatest n . d over a face. */
export function _range(face: Face, d: Vector): [number, number] {
  const r = kernelCall('draft angle', () => _DR.face_draft_range(face._f, d.toArray(), _GRID))
  return [Number(r.min), Number(r.max)]
}

function _degrees(s: number): number {
  return _toDegrees(Math.asin(Math.max(-1.0, Math.min(1.0, s))))
}

/** The draft of one face: the least and the greatest draft angle over it (degrees) and the group
 * it falls in ("positive", "insufficient", "vertical" or "undercut"). */
export class FaceDraft {
  readonly face: Face
  readonly minAngle: number
  readonly maxAngle: number
  readonly kind: string

  constructor(face: Face, minAngle: number, maxAngle: number, kind: string) {
    this.face = face
    this.minAngle = minAngle
    this.maxAngle = maxAngle
    this.kind = kind
    Object.freeze(this)
  }

  equals(other: unknown): boolean {
    return (
      other instanceof FaceDraft &&
      this.face.equals(other.face) &&
      this.minAngle === other.minAngle &&
      this.maxAngle === other.maxAngle &&
      this.kind === other.kind
    )
  }

  toString(): string {
    return `FaceDraft(${this.face.geomType}, ${_formatG(this.minAngle, 4)} to ${_formatG(this.maxAngle, 4)} degrees, ${this.kind})`
  }

  [inspect](): string {
    return this.toString()
  }
}

function _kind(lo: number, hi: number, minAngle: number): string {
  if (Math.abs(lo) <= ANGLE_TOLERANCE && Math.abs(hi) <= ANGLE_TOLERANCE) return 'vertical'
  if (lo < -ANGLE_TOLERANCE) return 'undercut'
  if (lo >= minAngle - ANGLE_TOLERANCE) return 'positive'
  return 'insufficient'
}

/**
 * The draft of every face of a part for one pull direction.
 *
 * The faces fall into four groups, each a ShapeList of faces of the part (usable as a selection,
 * for example for highlighting):
 *
 * - `positive`: at least `minAngle` of draft everywhere; the face releases.
 * - `insufficient`: no negative draft, but less than `minAngle` somewhere.
 * - `vertical`: parallel to the pull direction everywhere (0 degrees).
 * - `undercut`: turns away from the pull direction somewhere (negative draft).
 *
 * `faces` holds one `FaceDraft` per face with its least and greatest angle.
 */
export class DraftAnalysis {
  readonly direction: Vector
  readonly minAngle: number
  readonly faces: readonly FaceDraft[]

  constructor(direction: Vector, minAngle: number, faces: readonly FaceDraft[]) {
    this.direction = direction
    this.minAngle = minAngle
    this.faces = Object.freeze([...faces])
  }

  _group(kind: string): ShapeList<Face> {
    return _list(this.faces.filter((fd) => fd.kind === kind).map((fd) => fd.face))
  }

  /** Faces with at least `minAngle` of draft everywhere. */
  get positive(): ShapeList<Face> {
    return this._group('positive')
  }

  /** Faces with less than `minAngle` of draft somewhere, but nowhere negative. */
  get insufficient(): ShapeList<Face> {
    return this._group('insufficient')
  }

  /** Faces parallel to the pull direction (no draft). */
  get vertical(): ShapeList<Face> {
    return this._group('vertical')
  }

  /** Faces that turn away from the pull direction somewhere (negative draft). */
  get undercut(): ShapeList<Face> {
    return this._group('undercut')
  }

  /** True if every face has at least `minAngle` of draft. */
  get ok(): boolean {
    return this.faces.every((fd) => fd.kind === 'positive')
  }

  /** The least and the greatest draft angle of a face of the part (degrees). */
  angles(face: Face): [number, number] {
    for (const fd of this.faces) if (fd.face.equals(face)) return [fd.minAngle, fd.maxAngle]
    throw new RangeError(`${face} is not a face of the analysed part`)
  }

  [Symbol.iterator](): IterableIterator<FaceDraft> {
    return this.faces[Symbol.iterator]()
  }

  /** The number of faces (Python's `len`). */
  get length(): number {
    return this.faces.length
  }

  toString(): string {
    const d = this.direction
    const g4 = (v: number) => _formatG(v, 4)
    const counts = ['positive', 'insufficient', 'vertical', 'undercut'].map((kd) => `${this._group(kd).length} ${kd}`).join(', ')
    return `DraftAnalysis(direction=(${g4(d.x)}, ${g4(d.y)}, ${g4(d.z)}), minAngle=${_formatG(this.minAngle)}: ${counts})`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** See `Part.draftAnalysis`. */
export function draftAnalysis(part: Part, direction: Axis | VectorLike, options: { minAngle?: number } = {}): DraftAnalysis {
  const d = _direction(direction, 'draftAnalysis')
  const minAngle = Number(options.minAngle ?? 1.0)
  if (!(0.0 <= minAngle && minAngle < 90.0)) throw new RangeError('draftAnalysis: minAngle must be at least 0 and less than 90 degrees')
  part._requireValid('draftAnalysis')
  const records: FaceDraft[] = []
  for (const f of part.faces()) {
    const [lo, hi] = _range(f, d)
    const a = _degrees(lo)
    const b = _degrees(hi)
    records.push(new FaceDraft(f, a, b, _kind(a, b, minAngle)))
  }
  return new DraftAnalysis(d, minAngle, records)
}

// ============================================================================= parting line
const _SIGN = 1e-9 // |n . d| below this counts as 0 when the faces are sorted to a side
const _STRAY = 1e-2 // the most a split face may turn the other way near a traced silhouette (n . d)

/** +1 facing the direction, -1 facing away, 0 parallel, null both ways. */
function _side(lo: number, hi: number, eps: number): number | null {
  if (hi <= eps && lo >= -eps) return 0
  if (lo >= -eps) return 1
  if (hi <= eps) return -1
  return null
}

/** Edges of `body` grouped into chains connected at their vertices. */
function _loops(body: _Body, edges: readonly Edge[]): Edge[][] {
  const parent = edges.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const at = new Map<number, number>()
  edges.forEach((e, i) => {
    const kv = e.vertices().map((v) => v._v)
    for (const key of ext.vertex_indices(body._brep, kv) as number[]) {
      // stable ids: wrappers come and go
      if (at.has(key)) parent[find(i)] = find(at.get(key)!)
      else at.set(key, i)
    }
  })
  const groups = new Map<number, Edge[]>()
  edges.forEach((e, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(e)
  })
  return [...groups.values()]
}

/** See `Part.partingLine`. */
export function partingLine(part: Part, direction: Axis | VectorLike): ShapeList<Wire> {
  const d = _direction(direction, 'partingLine')
  part._requireValid('partingLine')
  const [body, line] = _contour(part, d, 'partingLine')
  const wires: Wire[] = []
  for (const chain of _loops(body, line)) {
    const curves = chain.map((e) => Edge._fromCurve(ext.edge_curve(e._e)))
    wires.push(new Wire(curves))
  }
  const keyed = wires.map((w) => [-w.length, w] as [number, Wire])
  keyed.sort((x, y) => x[0] - y[0])
  return _list(keyed.map(([, w]) => w))
}

/**
 * The edges, with the arcs of one circle that meet end to end joined into one arc (a full circle
 * where they go round): the pieces a contour is split into where it crosses edges or seams of the
 * faces (a sphere's rim at its seam).
 */
export function _joinedArcs(edges: Edge[], tol: number): Edge[] {
  const groups: [Vector, number, Vector, Edge[]][] = []
  const out: Edge[] = []
  for (const e of edges) {
    if (e.geomType !== 'circle') {
      out.push(e)
      continue
    }
    const [c, r, n] = [e.arcCenter, e.radius, e.normal]
    const g = groups.find(([gc, gr, gn]) => gc.sub(c).length <= tol && Math.abs(gr - r) <= tol && gn.cross(n).length <= 1e-9)
    if (g) g[3].push(e)
    else groups.push([c, r, n, [e]])
  }
  const mod = (a: number) => ((a % 360) + 360) % 360
  for (const [c, r, n, members] of groups) {
    if (members.length === 1) {
      out.push(members[0])
      continue
    }
    const x = members[0].start.sub(c).normalized()
    const plane = new Plane(c, x, n)
    const angle = (p: Vector) => {
      const q = plane.toLocal(p)
      return mod((Math.atan2(q.y, q.x) * 180) / Math.PI)
    }
    const spans: [number, number][] = [] // counterclockwise about n: [start, size]
    for (const e of members) {
      const [a0, am, a1] = [angle(e.start), angle(e.pointAt(0.5)), angle(e.end)]
      if (e.isClosed) {
        spans.push([0, 360])
        continue
      }
      const ccw = mod(am - a0) < mod(a1 - a0) || mod(a1 - a0) === 0
      spans.push(ccw ? [a0, mod(a1 - a0)] : [a1, mod(a0 - a1)])
    }
    const eps = ((tol / r) * 180) / Math.PI
    spans.sort((p, q) => p[0] - q[0] || p[1] - q[1])
    const merged: [number, number][] = []
    for (const [a, size] of spans) {
      const last = merged[merged.length - 1]
      if (last && a <= last[0] + last[1] + eps) last[1] = Math.max(last[1], a + size - last[0])
      else merged.push([a, size])
    }
    if (merged.length > 1 && merged[merged.length - 1][0] + merged[merged.length - 1][1] >= merged[0][0] + 360 - eps) {
      const first = merged.shift()! // (across angle 0)
      const last = merged[merged.length - 1]
      last[1] = first[0] + 360 + first[1] - last[0]
    }
    if (merged.length === members.length) {
      out.push(...members)
      continue
    }
    for (const [a, size] of merged) out.push(CenterArc([0, 0], r, size >= 360 - eps ? 0 : a, Math.min(size, 360), plane))
  }
  return out
}

/**
 * A copy of the body (a part, a sheet or a sketch) split along its silhouettes for the unit
 * direction `d`, and its edges between the half that faces along `d` and the half that faces away
 * (faces parallel to `d` go with the half that faces along it, unless they touch only faces of the
 * other half). The copy holds the edges: keep it while they are used.
 */
export function _contour(part: _Body, d: Vector, what: string): [_Body, Edge[]] {
  try {
    return _splitHalves(part, d, d, what)
  } catch (e) {
    if (!(e instanceof ModelingError) || _isCrash(e)) throw _crashOf(e)
    // The kernel traces the silhouettes of a face differently for -d (the same curves): a torus
    // split for -X kept a face that faces both ways, split for +X it splits cleanly.
    try {
      return _splitHalves(part, d, d.neg(), what)
    } catch (e2) {
      if (!(e2 instanceof ModelingError) || _isCrash(e2)) throw _crashOf(e2)
    }
    throw e
  }
}

/** `_contour` with the faces split along the silhouettes traced for `split` (`d` or `-d`). */
function _splitHalves(part: _Body, d: Vector, split: Vector, what: string): [_Body, Edge[]] {
  const size = Math.max(part.bbox().diagonal, 1e-9)
  const tolerance = 1e-6 * size // fit tolerance of traced silhouettes
  const eps = _SIGN
  const straddling: Face[] = []
  for (const f of part.faces()) {
    const [lo, hi] = _range(f, d)
    if (_side(lo, hi, eps) === null) straddling.push(f)
  }
  const res = kernelCall(
    what,
    () => _DR.split_at_silhouettes(part._brep, split.toArray(), tolerance, straddling.map((f) => f._f)),
    'the kernel could not split the faces along their silhouettes',
  )
  const body: _Body = part instanceof Part ? Part._wrap(res.brep) : Shell._wrap(res.brep) // keeps the split copy alive
  if (res.failed.length) {
    const kinds = [...new Set((res.failed as number[]).map((i) => straddling[i].geomType))].sort()
    throw new ModelingError(
      `${what}: the kernel could not find where ${res.failed.length} ${kinds.join('/')} face(s) turn away from the direction; try a direction a little off this one, or heal() an imported part first`,
    )
  }
  // Sides of the faces of the split copy. A face split along a traced silhouette can turn past 0
  // by a little near the line (up to about 0.02 degrees): its side is the way it mostly faces.
  const faces = [...body.faces()]
  const side = new Map<string, number>()
  for (const g of faces) {
    const [lo, hi] = _range(g, d)
    let s = _side(lo, hi, eps)
    if (s === null) {
      if (Math.min(-lo, hi) > _STRAY) {
        throw new ModelingError(`${what}: a face still faces both ways after the split; heal() the part, or try a direction a little off this one`)
      }
      s = hi >= -lo ? 1 : -1
    }
    side.set(g._identity(), s)
  }
  // Walls parallel to the direction go with the half that moves along it, unless they touch only
  // faces of the other half.
  const vertical = faces.filter((g) => side.get(g._identity()) === 0)
  const seen = new Set<string>()
  for (const g of vertical) {
    if (seen.has(g._identity())) continue
    const comp: Face[] = []
    const stack = [g]
    seen.add(g._identity())
    while (stack.length) {
      const x = stack.pop()!
      comp.push(x)
      for (const n of x.neighbors()) {
        if (side.get(n._identity()) === 0 && !seen.has(n._identity())) {
          seen.add(n._identity())
          stack.push(n)
        }
      }
    }
    const touching = new Set<number>()
    for (const x of comp) for (const n of x.neighbors()) touching.add(side.get(n._identity())!)
    touching.delete(0)
    const s = touching.size === 1 && touching.has(-1) ? -1 : 1
    for (const x of comp) side.set(x._identity(), s)
  }
  // The line: edges between the two halves.
  const line: Edge[] = []
  for (const e of body.edges(true)) {
    const fs = e.faces()
    if (fs.length === 2 && side.get(fs[0]._identity()) !== side.get(fs[1]._identity())) line.push(e)
  }
  return [body, line]
}

// ============================================================================= face drafts
const _FD = k.face_draft

/** Angle (degrees) between the normals of two faces along an edge below which the faces meet
 * tangentially. A face that meets a drafted face so must be drafted with it. */
export let TANGENCY = 1.0

/** Sets TANGENCY (for tests, as Python's monkeypatch does); returns the value it had. */
export function _setTangency(value: number): number {
  const old = TANGENCY
  TANGENCY = value
  return old
}

const _STEEPEST = 89.0 // degrees of draft a face may have after the draft (the kernel's limit is 90)

function _draftAngle(angle: unknown): number {
  if (typeof angle !== 'number') throw new TypeError('draft: the angle must be a number of degrees')
  const a = angle
  if (!(Number.isFinite(a) && Math.abs(a) < 90.0)) throw new RangeError(`draft: the angle must be between -90 and 90 degrees (got ${angle})`)
  if (a === 0) throw new RangeError('draft: the angle is 0; nothing to do')
  return a
}

function _neutral(neutralPlane: unknown): Plane {
  try {
    return _asPlane(neutralPlane)
  } catch (e) {
    // a face that is not flat
    if (e instanceof RangeError) throw new RangeError(`draft: the neutral plane must be a Plane or a planar face; ${e.message}`)
    throw e
  }
}

/** Python's round(v, 9) + 0.0 (no -3e-15, no -0). */
function _round9(v: number): number {
  return Math.round(v * 1e9) / 1e9 + 0.0
}

function _where(face: Face): string {
  const c = face.center()
  const [x, y, z] = [c.x, c.y, c.z].map(_round9)
  const g4 = (v: number) => _formatG(v, 4)
  return `${face.geomType} face at (${g4(x)}, ${g4(y)}, ${g4(z)})`
}

/** Whether a face is of a kind the draft turns: a plane that is not parallel to the neutral
 * plane, or a cylinder or cone whose axis runs along its normal. */
function _draftable(face: Face, plane: Plane): boolean {
  if (face.isPlanar) return face.normalAt().cross(plane.zDir).length > 1e-6
  if (face.geomType === 'cylinder' || face.geomType === 'cone') return face.axis.direction.normalized().cross(plane.zDir).length <= 1e-6
  return false
}

/** The message for a face the kernel was not asked to draft, or for a kernel failure. */
function _refusal(res: Any, part: Part, faces: readonly Face[], angle: number, plane: Plane): string {
  const code: string = res.error
  const f = (res.face >= 0 ? faces[res.face] : null) as Face
  if (code === 'tangent') {
    const g = new Face(part, res.other)
    const fix = _draftable(g, plane)
      ? '; add it to the faces'
      : `, but a ${g.geomType} face cannot be drafted about this plane; draft before rounding or blending there, and round afterwards`
    return `draft: the ${_where(g)} meets the drafted ${_where(f)} tangentially, so it must be drafted with it${fix}`
  }
  if (code === 'in_plane') return `draft: the ${_where(f)} lies in the neutral plane; there is no line in it to turn it about`
  if (code === 'parallel') {
    return `draft: the ${_where(f)} is parallel to the neutral plane; only faces that cross the plane's normal at an angle can be drafted (walls, not tops or floors)`
  }
  if (code === 'axis') {
    const tilt = _toDegrees(Math.acos(Math.min(1.0, Math.abs(f.axis.direction.normalized().dot(plane.zDir)))))
    return `draft: the axis of the ${_where(f)} is ${_formatG(tilt, 4)} degrees off the normal of the neutral plane; a cylinder or cone can be drafted only when its axis runs along that normal`
  }
  if (code === 'unsupported') {
    return `draft: the ${_where(f)} cannot be drafted; draft turns planes, and cylinders and cones whose axis runs along the normal of the neutral plane`
  }
  if (code === 'apex') return `draft: the ${_where(f)} is part of a cone that ends in its tip before the neutral plane or on the face`
  if (code === 'tip') return `draft: at ${_formatG(angle)} degrees the ${_where(f)} would narrow to a point; use a smaller angle`
  if (code === 'too_steep') {
    const total = _toDegrees(res.before[res.before.length - 1]) + angle
    return `draft: at ${_formatG(angle)} degrees the ${_where(f)} would have ${_formatG(total, 4)} degrees of draft and lie almost flat; a face can have up to ${_formatG(_STEEPEST)} degrees`
  }
  if (code === 'kernel') return 'draft: the kernel could not rebuild the part around the drafted faces; the angle may be too large for the faces around them'
  if (code === 'open') {
    return 'draft: the drafted faces do not close the part again: at this angle a face around them vanishes, or drafted faces run into each other; use a smaller angle'
  }
  return `draft: the ${_where(f)} could not be prepared for the draft (${code})`
}

/** See `Part.draft`. */
export function draftFaces(part: Part, faces: unknown, angle: number, neutralPlane: Plane | Face): Part {
  const a = _draftAngle(angle)
  const plane = _neutral(neutralPlane)
  part._requireValid('draft')
  if (!_flattenFaces(faces).length) throw new RangeError('draft: no faces selected')
  const sel: Face[] = []
  for (const kf of part._ownFaces(faces)) {
    if (sel.every((f) => kf !== f._f)) sel.push(new Face(part, kf))
  }
  const d = plane.zDir.normalized()
  const res = kernelCall('draft', () =>
    _FD.draft_faces(part._brep, sel.map((f) => f._f), plane.origin.toArray(), d.toArray(), _radians(a), TANGENCY),
  )
  if (res.error !== null) throw new ModelingError(_refusal(res, part, sel, a, plane))
  const result = part._like(res.brep)

  // The kernel may close the part with faces that do not meet: its vertices and edges then leave
  // the faces they bound (by whole millimetres, where a correct draft has 1e-6 or less).
  const gap = Math.max(...res.gaps)
  const limit = Math.max(10.0 * res.tolerance, 10.0 * Math.max(...res.gaps_before))
  if (!(gap <= limit)) {
    throw new ModelingError(
      `draft: the kernel returned a part whose edges leave its faces (by up to ${_formatG(gap, 2)}); a face that meets a drafted face may have to be drafted too, or the angle is too large`,
    )
  }
  if (result.faces().length !== part.faces().length) {
    throw new ModelingError(
      'draft: at this angle the drafted faces change which faces of the part meet (a face vanishes or a drafted face runs into another one); use a smaller angle',
    )
  }
  const problem = result._solidProblem()
  if (problem !== null) throw new ModelingError(`draft: the kernel returned a body that is ${problem}; use a smaller angle`)
  // Each drafted face moves into the material on the side of the neutral plane the normal points
  // to (for a positive angle) and out of it on the other side. (A quick volume, so only a change
  // beyond its error counts.)
  const sides = new Set(sel.map((f) => _sideOf(f, plane)))
  if (sides.size === 1 && !sides.has(0)) {
    const before = part._quickVolume()
    const after = result._quickVolume()
    const shrinks = [...sides][0] * a > 0
    if ((shrinks ? after - before : before - after) > 1e-4 * Math.abs(before)) {
      throw new ModelingError(
        `draft: the kernel returned a body whose volume went the wrong way (${_formatG(before)} -> ${_formatG(after)}); use a smaller angle`,
      )
    }
  }
  return result
}

/** +1 if the face lies on the side of the plane its normal points to, -1 on the other, 0 if it
 * crosses the plane (judged by the corners of its bounding box). */
function _sideOf(face: Face, plane: Plane): number {
  const bb = face.bbox()
  const heights: number[] = []
  for (const x of [bb.min.x, bb.max.x]) {
    for (const y of [bb.min.y, bb.max.y]) {
      for (const z of [bb.min.z, bb.max.z]) heights.push(plane.zDir.dot(new Vector(x, y, z).sub(plane.origin)))
    }
  }
  const tol = 1e-9 * Math.max(1.0, bb.diagonal)
  if (Math.min(...heights) >= -tol) return 1
  if (Math.max(...heights) <= tol) return -1
  return 0
}
