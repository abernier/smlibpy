// Machining setups: a part laid on the machine for a 3-axis router, its features sorted into the
// layers a CNC shop reads.
//
// A setup is one clamping of the workpiece: the part rests on one face, the tool comes from the
// opposite side. What a 3-axis machine cuts in that setup lies along the tool's axis: the outline
// of the part (a through cut), the holes through it, and the pockets that open on the top face,
// each to its depth. What it cannot cut is reported, so that it goes to another setup, a jig or a
// hand tool: pockets that open on the underside or on an edge, voids, and faces that do not run
// along the tool. (Python: machining.py.)

import { KernelError, _crashOf, _isCrash, _opts, scope } from './kernel.ts'
import { Axis, Plane, Vector, type VectorLike, _vec } from './geometry.ts'
import { eigh3 } from './_linalg.ts'
import { Align } from './align.ts'
import { type Edge, Face, Part, ShapeList, type Sketch, type Wire, _list, _typeName } from './shapes.ts'
import { Polygon, Rectangle, makeFace } from './sketches.ts'
import { Text } from './text.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

const OUTLINE = 'OUTLINE'
const THROUGH = 'THROUGH'
const LABEL = 'LABEL'
const POCKET = 'POCKET_D'
const BELOW = 'opens below'
const SIDE = 'opens at the side'
const ENCLOSED = 'enclosed'
const NOT_PRISM = 'not a prism along the tool'
const Z_AXIS = new Vector(0, 0, 1)

/** Why a setup leaves a feature to another one (see `MachiningSetup.elsewhere`). */
export type MachiningReason = 'opens below' | 'opens at the side' | 'enclosed' | 'not a prism along the tool'

/** What a setup leaves to another one: why, the direction a tool must come from instead (or
 * `null`), and the faces. */
export type MachiningLeft = [why: MachiningReason, direction: Vector | null, faces: ShapeList<Face>]

/**
 * One setup of a part on a 3-axis machine (see `machiningSetup`).
 *
 * - `part`: the part in the setup's frame: resting on z = 0, the face the tool works from at
 *   z = `thickness`, its footprint in the positive quadrant.
 * - `plane`: the setup's frame in the model: its origin is the drawing's origin, its x and y the
 *   drawing's, its normal the direction the tool comes from.
 * - `thickness`: the part's extent along the tool, in mm: the stock's finished thickness.
 * - `layers`: sketches in the XY plane, one per layer, named as `exportDxf` writes them: `OUTLINE`
 *   (the footprint's outer contours, the through cut), `THROUGH` (the holes through the part),
 *   `POCKET_D<depth>` (the pockets open on the top face, by depth from it, in mm: `POCKET_D15`,
 *   `POCKET_D7_5`) and `LABEL` (the label and the grain arrow, when a label is given).
 * - `elsewhere`: what this setup cannot cut, as `[why, direction, faces]` triples: why, the
 *   direction (in the setup's frame) a tool must come from instead, and the faces (in that frame).
 *   `'opens below'` (a pocket of the other face: turn the part over, direction `(0, 0, -1)`, the
 *   faces its floors), `'opens at the side'` (a mortise in an edge: an edge setup, the direction
 *   the normal of the face it opens through, the faces the whole feature), `'enclosed'` (a void; no
 *   direction) or `'not a prism along the tool'` (a face a vertical cutter cannot follow: a slope, a
 *   cove, an undercut; no direction).
 */
export class MachiningSetup {
  readonly part: Part
  readonly plane: Plane
  readonly thickness: number
  readonly layers: Sketch[]
  readonly elsewhere: MachiningLeft[]

  constructor(part: Part, plane: Plane, thickness: number, layers: Sketch[], elsewhere: MachiningLeft[]) {
    this.part = part
    this.plane = plane
    this.thickness = thickness
    this.layers = layers
    this.elsewhere = elsewhere
  }

  /** The sketch of one layer, or `null` when the setup has none of that name. */
  layer(name: string): Sketch | null {
    for (const s of this.layers) if (s.name === name) return s
    return null
  }

  toString(): string {
    return `MachiningSetup(thickness=${this.thickness}, layers=[${this.layers.map((s) => `'${s.name}'`).join(', ')}], ${this.elsewhere.length} elsewhere)`
  }

  [inspect](): string {
    return this.toString()
  }
}

/** The options of `machiningSetup`. */
export interface MachiningSetupOptions {
  /** The model direction that becomes the drawing's x. Default: the footprint's longest straight
   * edge, laid along x at the bottom of the drawing (a board's long side, with its grain); a
   * footprint without one (a curved rail) lies along its principal axis. */
  xDir?: Axis | VectorLike | null
  /** A text for the `LABEL` layer, at the footprint's centroid, with a grain arrow along x below
   * it; default none. */
  label?: string | null
  /** The label's capital height in mm; default a sixth of the footprint's shorter extent, between
   * 2 and 20. */
  labelSize?: number | null
}

/**
 * Lay a part on a 3-axis machine and sort its features into the layers of a machining drawing.
 *
 * - `part`: a `Part` of one solid.
 * - `direction`: where the tool comes from: a planar `Face` of the part (the part rests on the
 *   opposite side and that face is worked), an `Axis` or a vector (from the part towards the tool).
 *   Default: from above, the part as it stands.
 * - `xDir`, `label`, `labelSize`: see `MachiningSetupOptions`.
 *
 * Returns a `MachiningSetup`: the part laid flat, the drawing plane, the thickness, the layers
 * (write them with `exportDxf(setup.layers, path, { curves: 'arcs' })`) and what the setup leaves
 * for another one.
 *
 * The footprint is the union of the part's cross-sections between its horizontal faces and of the
 * shadows of its sloping planar faces: exact for the parts a router cuts from flat stock. Every
 * face that is neither the top, the bottom nor a wall of the footprint belongs to a feature; the
 * faces of one feature are joined along their edges. A feature whose floor faces the tool and is
 * open to it is a pocket, written at each of its floors (a stepped pocket on several layers), its
 * contour the floor's outline with the islands that rise from it; the depth is measured from the
 * top face. A pocket open to the side (a rabbet, a tenon cheek) is written as it is, its contour on
 * the outline.
 *
 * Throws a TypeError for anything but a Part, and a RangeError for a part of several solids, a
 * curved face as the direction, an `xDir` along the tool or a `labelSize` that is not positive.
 */
export function machiningSetup(
  part: Part | ShapeList<Part>,
  direction: Face | ShapeList<Face> | Axis | VectorLike = [0, 0, 1],
  options: MachiningSetupOptions = {},
): MachiningSetup {
  _opts('machiningSetup', options)
  const xDir = options.xDir ?? null
  const label = options.label ?? null
  const labelSize = options.labelSize ?? null
  if (part instanceof ShapeList) part = part.length === 1 ? part.one() : part
  if (!(part instanceof Part)) throw new TypeError(`machiningSetup lays out a Part, not a ${_typeName(part)}`)
  const body: Part = part
  return scope(() => {
    const solids = body.solids()
    if (solids.length !== 1) {
      throw new RangeError(`machiningSetup: one solid at a time, this part has ${solids.length}; lay out its solids()`)
    }
    const up = _direction(direction)
    let x: Vector
    if (xDir !== null) {
      x = xDir instanceof Axis ? xDir.direction : _vec(xDir)
      x = x.sub(up.mul(x.dot(up)))
      if (x.length < 1e-9) throw new RangeError('machiningSetup: xDir is along the tool; give a direction across the part')
      x = x.normalized()
    } else {
      x = _longAxis(body, up)
    }
    if (labelSize !== null && !(labelSize > 0)) throw new RangeError('machiningSetup: labelSize must be positive')
    const frame = new Plane([0, 0, 0], x, up)
    let laid = body.moved(frame.location.inverse())
    const box = laid.bbox()
    laid = laid.translate(-box.min.x, -box.min.y, -box.min.z)
    const plane = new Plane(frame.fromLocal(box.min), x, up)
    const thickness = box.size.z
    const tol = 1e-6 * Math.max(box.diagonal, 1.0)

    const footprint = _footprint(laid, thickness, tol)
    let outer: Sketch | null = null
    let holes: Sketch | null = null
    for (const f of footprint.faces()) {
      outer = _fused(outer, makeFace(f.outerWire()))
      for (const w of f.innerWires()) holes = _fused(holes, makeFace(w))
    }
    if (outer === null) throw new Error('machiningSetup: the footprint has no face')
    const layers: Sketch[] = [outer.named(OUTLINE)]
    if (holes !== null) layers.push(holes.named(THROUGH))

    const pockets = new Map<number, Sketch>()
    const elsewhere: MachiningLeft[] = []
    const boundary: Edge[] = []
    for (const f of footprint.faces()) for (const w of f.wires()) for (const e of w.edges()) boundary.push(e)
    const roles = laid.faces().map((f) => [f, _role(f, thickness, boundary, tol)] as const)
    const rim = roles.filter(([, role]) => role === 'rim').map(([f]) => f)
    if (rim.length) elsewhere.push([NOT_PRISM, null, _list(rim)])
    for (const feature of _components(roles.filter(([, role]) => role === 'feature').map(([f]) => f), tol)) {
      const [floors, left] = _sorted(laid, feature, tol)
      for (const [why, d, faces] of left) elsewhere.push([why, d, _list(faces)])
      for (const floor of floors) {
        const islands = floor.innerWires().filter((w) => _rises(w, feature, floor, tol))
        const z = floor.center().z
        const depth = _round(thickness - z, 3)
        pockets.set(depth, _fused(pockets.get(depth) ?? null, makeFace(floor.outerWire(), ...islands).translate(0, 0, -z)))
      }
    }
    for (const depth of [...pockets.keys()].sort((a, b) => a - b)) layers.push((pockets.get(depth) as Sketch).named(_pocketLayer(depth)))
    if (label !== null) layers.push(_label(outer, String(label), labelSize))
    return new MachiningSetup(laid, plane, thickness, layers, elsewhere)
  })
}

/** Python's round(x, digits). */
function _round(x: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

/** The unit vector from the part towards the tool. */
function _direction(direction: Face | ShapeList<Face> | Axis | VectorLike): Vector {
  if (direction instanceof ShapeList) direction = direction.one()
  if (direction instanceof Face) {
    if (!direction.isPlanar) throw new RangeError(`machiningSetup: the face is a ${direction.geomType}; the tool comes from a planar face`)
    return direction.normalAt()
  }
  if (direction instanceof Axis) return direction.direction
  const v = _vec(direction)
  if (v.length < 1e-12) throw new RangeError('machiningSetup: the direction has no length')
  return v.normalized()
}

/** The direction across the tool that becomes x: the footprint's longest straight edge where it
 * has one (a board's long side, laid at the bottom of the drawing), else its principal axis, else
 * a world axis. */
function _longAxis(part: Part, up: Vector): Vector {
  const provisional = new Plane([0, 0, 0], null, up)
  let laid = part.moved(provisional.location.inverse())
  const box = laid.bbox()
  laid = laid.translate(-box.min.x, -box.min.y, -box.min.z)
  const footprint = _footprint(laid, box.size.z, 1e-6 * Math.max(box.diagonal, 1.0))
  const centroid = footprint.center()
  const edges: Edge[] = []
  for (const f of footprint.faces()) for (const e of f.outerWire().edges()) if (e.geomType === 'line') edges.push(e)
  let along: Vector | null = null
  if (edges.length) {
    // the longest; of equal ones the lowest, then the leftmost, so that the choice is the same every time
    const key = (e: Edge): number[] => {
      const m = e.pointAt(0.5)
      return [-_round(e.length, 6), _round(m.y, 6), _round(m.x, 6)]
    }
    let longest = edges[0]
    let best = key(longest)
    for (const e of edges.slice(1)) {
      const k = key(e)
      if (k[0] < best[0] || (k[0] === best[0] && (k[1] < best[1] || (k[1] === best[1] && k[2] < best[2])))) {
        longest = e
        best = k
      }
    }
    if (longest.length >= 0.5 * footprint.bbox().diagonal) {
      const a = longest.start
      const b = longest.end
      let d = b.sub(a).normalized()
      const m = a.add(b).mul(0.5)
      if (d.x * (centroid.y - m.y) - d.y * (centroid.x - m.x) < 0) d = d.neg() // (the part lies on the left of the edge: above it in the drawing)
      along = d
    }
  }
  if (along === null) {
    const sp = footprint.sectionProperties()
    // the covariance of the area in the plane's axes: ∫x² = iyy, ∫y² = ixx, ∫xy = ixy (numpy's eigh
    // of the 2 x 2 matrix: the two eigenpairs in the plane of eigh3's of the matrix bordered by 0)
    const { values: all, vectors: allVectors } = eigh3([sp.iyy, sp.ixy, 0, sp.ixy, sp.ixx, 0, 0, 0, 0])
    const pairs = [0, 1, 2].filter((i) => Math.abs(allVectors[i][2]) < 0.5)
    const values = pairs.map((i) => all[i])
    const vectors = pairs.map((i) => allVectors[i])
    if (values[1] - values[0] <= 1e-6 * Math.max(values[1], 1e-12)) return provisional.xDir // (a square, a disc: no long direction)
    let major = [vectors[1][0], vectors[1][1]]
    if (major[0] < 0 || (Math.abs(major[0]) < 1e-12 && major[1] < 0)) major = [-major[0], -major[1]] // (the same axis, pointing along +x when it can)
    along = sp.plane.xDir.mul(major[0]).add(sp.plane.yDir.mul(major[1]))
  }
  return provisional.xDir.mul(along.x).add(provisional.yDir.mul(along.y)).normalized()
}

/** The part's shadow along the tool, in the XY plane: the union of its sections between its
 * horizontal faces, and of the shadows of its sloping planar faces. */
function _footprint(laid: Part, thickness: number, tol: number): Sketch {
  const faces = laid.faces()
  const levels = [...new Set([0.0, thickness, ...faces.filter((f) => _horizontal(f)).map((f) => _round(f.center().z, 6))])].sort(
    (a, b) => a - b,
  )
  const eps = Math.min(0.01, thickness / 1000)
  const zs = [eps, thickness - eps]
  for (let i = 0; i + 1 < levels.length; i++) {
    const [a, b] = [levels[i], levels[i + 1]]
    if (b - a > 4 * eps) zs.push((a + b) / 2)
  }
  let footprint: Sketch | null = null
  for (const z of [...new Set(zs)].sort((a, b) => a - b)) {
    try {
      footprint = _fused(footprint, _slice(laid, z, eps))
    } catch (e) {
      if (!(e instanceof RangeError)) throw e
      // (the plane misses the part: a section between separate lumps)
    }
  }
  for (const f of faces) {
    if (f.isPlanar && !(_horizontal(f) || _vertical(f))) {
      const shadow = f
        .toSketch()
        .extrude(3 * thickness, { direction: [0, 0, -1] })
        .translate(0, 0, thickness)
      footprint = _fused(footprint, _slice(shadow, thickness / 2))
    }
  }
  if (footprint === null) throw new RangeError('machiningSetup: the part has no section across the tool')
  return footprint
}

/** The body's section at height z, brought down to the XY plane. A plane that meets an edge or
 * touches a face inside the body can fail in the kernel: the section is then taken a little above
 * or below, within `nudge`. */
function _slice(body: Part, z: number, nudge = 0.0): Sketch {
  const steps = !nudge ? [0.0] : [0.0, nudge, -nudge, 2 * nudge, -2 * nudge]
  for (const step of steps) {
    try {
      return body.section(Plane.XY.offset(z + step)).translate(0, 0, -(z + step))
    } catch (e) {
      if (!(e instanceof KernelError) || _isCrash(e)) throw _crashOf(e)
      if (step === steps[steps.length - 1]) throw e
    }
  }
  throw new Error('unreachable')
}

function _fused(a: Sketch | null, b: Sketch): Sketch {
  return a === null ? b : (a.fuse(b) as Sketch)
}

function _horizontal(face: Face): boolean {
  return face.isPlanar && face.plane.zDir.isParallel(Z_AXIS)
}

function _vertical(face: Face): boolean {
  return face.isPlanar && face.plane.zDir.isPerpendicular(Z_AXIS)
}

/** Whether a vertical cutter can make the face: a plane along or across the tool, or a cylinder
 * around it. */
function _along(face: Face): boolean {
  if (face.isPlanar) return _horizontal(face) || _vertical(face)
  return face.geomType === 'cylinder' && face.axis.direction.isParallel(Z_AXIS)
}

/** `'skin'` for the faces the outline cut leaves (the top, the bottom, the walls standing on the
 * footprint's contours), `'rim'` for a face that does not run along the tool and meets a contour (a
 * chamfer or a slope on the outline: shaped, not pocketed), `'feature'` otherwise. */
function _role(face: Face, thickness: number, boundary: readonly Edge[], tol: number): 'skin' | 'rim' | 'feature' {
  if (_horizontal(face)) {
    const z = face.center().z
    return z > thickness - tol || z < tol ? 'skin' : 'feature'
  }
  const onContour: boolean[] = []
  for (const e of face.edges()) {
    const m = e.pointAt(0.5)
    const flat = new Vector(m.x, m.y, 0)
    onContour.push(boundary.some((b) => b.distanceTo(flat) < 100 * tol))
  }
  if (_along(face)) return onContour.every(Boolean) ? 'skin' : 'feature'
  return onContour.some(Boolean) ? 'rim' : 'feature'
}

/** The edges as keys: two faces that share an edge share a key. */
function _edgeKeys(edges: Iterable<Edge>, tol: number): Set<string> {
  const scale = 1.0 / Math.max(100 * tol, 1e-9)
  const out = new Set<string>()
  for (const e of edges) {
    const m = e.pointAt(0.5)
    out.add(`${Math.round(m.x * scale)},${Math.round(m.y * scale)},${Math.round(m.z * scale)},${Math.round(e.length * scale)}`)
  }
  return out
}

/** The faces grouped into features: faces that share an edge belong together. */
function _components(faces: Face[], tol: number): Face[][] {
  const keys = faces.map((f) => _edgeKeys(f.edges(), tol))
  const parent = faces.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const byEdge = new Map<string, number>()
  keys.forEach((ks, i) => {
    for (const k of ks) {
      const j = byEdge.get(k)
      if (j !== undefined) parent[root(i)] = root(j)
      else byEdge.set(k, i)
    }
  })
  const groups = new Map<number, Face[]>()
  faces.forEach((f, i) => {
    const r = root(i)
    const g = groups.get(r)
    if (g) g.push(f)
    else groups.set(r, [f])
  })
  return [...groups.values()]
}

/** Whether a tool coming from `towards` reaches the whole face: rays from outside, at the face's
 * centroid and between it and the corners, meet this face first. */
function _exposed(laid: Part, face: Face, towards: Vector, tol: number): boolean {
  const reach = laid.bbox().diagonal + 1.0
  let samples: Vector[]
  if (face.isPlanar) {
    const c = face.center()
    samples = [c, ...face.outerWire().vertices().map((v) => c.add(v.center()).mul(0.5))]
  } else {
    samples = []
    for (const u of [0.5, 0.2, 0.8]) for (const v of [0.5, 0.2, 0.8]) samples.push(face.positionAt(u, v))
  }
  let seen = false
  for (const p of samples) {
    if (face.distanceTo(p) > 100 * tol) continue // (the centroid of an L lies off the face)
    seen = true
    const hits = laid.raycast(p.add(towards.mul(reach)), towards.neg())
    if (!hits.length || face.distanceTo(hits[0].point) > 100 * tol) return false
  }
  return seen
}

/** The floors of a feature this setup pockets, and what it leaves: `[why, direction, faces]`. */
function _sorted(laid: Part, feature: Face[], tol: number): [Face[], [MachiningReason, Vector | null, Face[]][]] {
  if (!feature.every((f) => _along(f))) return [[], [[NOT_PRISM, null, feature]]]
  const ups = feature.filter((f) => _horizontal(f) && f.plane.zDir.z > 0)
  const exposed = ups.filter((f) => _exposed(laid, f, Z_AXIS, tol))
  const hidden = ups.filter((f) => !exposed.includes(f))
  const downs = feature.filter((f) => _horizontal(f) && f.plane.zDir.z < 0 && _exposed(laid, f, Z_AXIS.neg(), tol))
  const left: [MachiningReason, Vector | null, Face[]][] = []
  if (downs.length) left.push([BELOW, Z_AXIS.neg(), downs])
  if (!exposed.length && !downs.length) {
    const openSides = feature.filter((f) => _vertical(f) && _exposed(laid, f, f.plane.zDir, tol))
    if (openSides.length) {
      // (a slot open at its end too: through its long side)
      let widest = openSides[0]
      for (const f of openSides.slice(1)) if (f.area > widest.area) widest = f
      left.push([SIDE, widest.plane.zDir, feature])
    } else {
      left.push([ENCLOSED, null, feature])
    }
  } else if (hidden.length) {
    left.push([NOT_PRISM, null, hidden]) // (a floor under an overhang: an undercut)
  }
  return [exposed, left]
}

/** Whether the material inside an inner wire of a floor stands above the floor (an island the
 * pocket goes around) rather than below it (a step the pocket goes down to). */
function _rises(wire: Wire, feature: readonly Face[], floor: Face, tol: number): boolean {
  const keys = _edgeKeys(wire.edges(), tol)
  const z = floor.center().z
  for (const f of feature) {
    if (f === floor) continue
    const theirs = _edgeKeys(f.edges(), tol)
    if (![...keys].some((k) => theirs.has(k))) continue
    return f.bbox().max.z > z + tol
  }
  return true
}

function _pocketLayer(depth: number): string {
  const text = depth.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return POCKET + text.replace('.', '_')
}

/** The label and a grain arrow along x, at the footprint's centroid. */
function _label(outline: Sketch, label: string, size: number | null): Sketch {
  const box = outline.bbox()
  if (size === null) size = Math.min(20.0, Math.max(2.0, Math.min(box.size.x, box.size.y) / 6))
  const c = outline.center()
  const text = Text(label, size).translate(c.x, c.y + 0.7 * size, 0)
  const length = 4 * size
  const stroke = 0.12 * size
  const shaft = Rectangle(length - size, stroke, { align: [Align.MIN, Align.CENTER] })
  const head = Polygon([length - size, -0.35 * size], [length, 0], [length - size, 0.35 * size])
  const arrow = (shaft.fuse(head) as Sketch).translate(c.x - length / 2, c.y - 0.9 * size, 0)
  return (text.fuse(arrow) as Sketch).named(LABEL)
}
