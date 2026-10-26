// Sheet metal: bends with an inside radius and a K-factor, flanges, and the flat pattern, in three's
// terms: angles in radians, bend lines THREE.Rays (or straight Edges), and a sheet lying on the
// ground (three's XZ plane) bending up (+Y), as smlibpy's lies on XY and bends up (+Z).
//
//     const blank = new Box(100, 40, 2, { align: { y: 'min' } }) // 100 along x, 40 along z, 2 thick
//     const line = new THREE.Ray(new THREE.Vector3(20, 2, 0), new THREE.Vector3(0, 0, 1)) // on its top
//     const bracket = fold(blank, line, Math.PI / 2, { radius: 2 }) // the +x end folded up
//     const pattern = flatPattern(bracket) // the blank again, with its outline and bend lines
//
// A bend takes the strip of the bend allowance, angle * (radius + kFactor * thickness), of the flat
// and turns it into exact cylinders (`radius` inside, `radius + thickness` outside); unfolding with
// the same K-factor gives the blank back. Results are in the frame of the part they are made from,
// with its transform, as results of operations on it are.
import * as THREE from 'three'
import { axis as toAxis, call, degrees, describe, radians, ray, sm, vec } from './kernel.ts'
import { adopt, Edge, Face, isObject3D, isRay, kernelOf, kernelOfShape, operand, placedCurve, ShapeList, wrap, Part, type Body, type Sketch, type Vertex, type Wire } from './shapes.ts'

// (this module and shapes.ts import each other: what it takes from shapes.ts is used in calls only,
// never while the module loads)

/**
 * The K-factors of `unfold`, `flatPattern` and `bends`, as smlibpy takes them: one number (0, the
 * inside of the sheet, to 1, its outside) for every bend; a function `(radius, thickness, angle) => k`
 * of each bend (its angle in radians); a mapping from inside radius to K-factor (a Map, or an object
 * such as `{ 1: 0.33, 6: 0.45 }`); `[r / t, k]` pairs, interpolated (a shop's table, its ends held);
 * `'din6935'`; or null: the K-factor each bend was folded with (`fold`, `flange`), else 0.44.
 */
export type KFactor =
  | number
  | string
  | ((radius: number, thickness: number, angle: number) => number)
  | ReadonlyMap<number, number>
  | Readonly<Record<string, number>>
  | readonly (readonly [number, number])[]
  | null

/** The bend of `bendAllowance` and `bendDeduction`. */
export interface BendAllowanceOptions {
  /** The inside bend radius. */
  radius: number
  /** The sheet's thickness. */
  thickness: number
  /** Where the neutral fiber lies, 0 (inside) to 1 (outside); default 0.44. */
  kFactor?: number
}

/** The bends of `developedLength`. */
export interface DevelopedLengthOptions extends BendAllowanceOptions {
  /** The angle of every bend in radians, or one per bend (default π / 2). */
  angle?: number | Iterable<number>
}

/**
 * The length of the flat strip a bend takes, `angle * (radius + kFactor * thickness)`: `angle` the
 * bend angle in radians (π / 2 for an L; above 0 and below 2π), `radius` the inside radius.
 */
export function bendAllowance(angle: number, options: BendAllowanceOptions): number {
  checkAngle(angle, 'bendAllowance', 2 * Math.PI, '2π')
  return call(() => sm.bendAllowance(degrees(angle), options))
}

/**
 * What a bend takes off the sum of the outside lengths of its legs:
 * `2 * (radius + thickness) * tan(angle / 2) - bendAllowance`, the outside lengths running to the
 * virtual sharp, where the outer faces of the two legs meet (`angle` in radians, above 0 and below π).
 */
export function bendDeduction(angle: number, options: BendAllowanceOptions): number {
  checkAngle(angle, 'bendDeduction', Math.PI, 'π')
  return call(() => sm.bendDeduction(degrees(angle), options))
}

/**
 * The length of the flat blank for a strip bent into `legs`: `developedLength(60, 40, { radius: 2,
 * thickness: 2 })`. The legs are outside lengths, from a free end or a virtual sharp (where the outer
 * faces of two legs meet) to the next, as a drawing gives them; `angle` is the angle of every bend in
 * radians (default π / 2), or one per bend. The result is the sum of the legs less a bend deduction
 * per bend.
 */
export function developedLength(...args: [...legs: number[], options: DevelopedLengthOptions]): number {
  const last = args[args.length - 1] as unknown
  const given = last !== null && typeof last === 'object'
  const options = (given ? last : {}) as DevelopedLengthOptions
  const legs = (given ? args.slice(0, -1) : args) as number[]
  const angles = options.angle === undefined ? undefined : typeof options.angle === 'number' ? [options.angle] : Array.from(options.angle)
  for (const a of angles ?? []) checkAngle(a, 'developedLength', Math.PI, 'π')
  const angle = angles === undefined ? undefined : typeof options.angle === 'number' ? degrees(angles[0]) : angles.map(degrees)
  return call(() => sm.developedLength(...legs, { ...options, angle }))
}

/** An angle in radians, above 0 and below `max` (checked here so that the message speaks of radians). */
function checkAngle(angle: unknown, what: string, max: number, name: string): void {
  if (typeof angle !== 'number') throw new TypeError(`${what}: the angle is a number of radians, not ${describe(angle)}`)
  if (!(angle > 0 && angle < max)) throw new RangeError(`${what}: the angle must be above 0 and below ${name} radians (got ${angle})`)
}

/** A KFactor for the kernel: a function's angle in its degrees, as radians. */
function kFactorOf(k: KFactor | undefined): KFactor | undefined {
  if (typeof k !== 'function') return k
  return (radius: number, thickness: number, angle: number) => k(radius, thickness, radians(angle))
}

// ------------------------------------------------------------------------------------- records
/** One bend of a sheet metal part, as `bends` finds it (with its axis) or a FlatPattern lays it out
 * (with its bend line and direction). */
export class Bend {
  /** The bend angle, in radians. */
  readonly angle: number
  /** The inside bend radius. */
  readonly radius: number
  /** The sheet's thickness. */
  readonly thickness: number
  /** Where its neutral fiber lies, 0 (inside) to 1 (outside). */
  readonly kFactor: number
  /** Its extent along its axis. */
  readonly length: number
  /** From `bends`: the axis of its cylinders, a THREE.Ray in the part's frame (else null). */
  readonly axis: THREE.Ray | null
  /** In a FlatPattern: the bend line, the middle of its strip on the bottom of the flat (an Edge with
   * the pattern's transform; else null). */
  readonly line: Edge | null
  /** In a FlatPattern: 'up' where the sheet beyond the line folds up (+Y), else 'down' (else null). */
  readonly direction: 'up' | 'down' | null

  constructor(
    angle: number,
    radius: number,
    thickness: number,
    kFactor: number,
    length: number,
    axis: THREE.Ray | null = null,
    line: Edge | null = null,
    direction: 'up' | 'down' | null = null,
  ) {
    this.angle = angle
    this.radius = radius
    this.thickness = thickness
    this.kFactor = kFactor
    this.length = length
    this.axis = axis
    this.line = line
    this.direction = direction
  }

  /** The bend allowance, the width of the bend's strip in the flat: `angle * (radius + kFactor * thickness)`. */
  get allowance(): number {
    return this.angle * (this.radius + this.kFactor * this.thickness)
  }

  /** A summary of the bend (its angle in radians). */
  toString(): string {
    const g = (x: number) => +x.toPrecision(6)
    const direction = this.direction ? `, ${this.direction}` : ''
    return `Bend(angle=${g(this.angle)} rad, radius=${g(this.radius)}, thickness=${g(this.thickness)}, kFactor=${g(this.kFactor)}, length=${g(this.length)}, allowance=${g(this.allowance)}${direction})`
  }
}

/**
 * The unfolded part, laid on the ground of the part's frame (three's XZ plane, as smlibpy lays it on
 * XY) and with the part's transform: its bottom face at y = 0 and its top at y = thickness, the
 * longer side of the smallest rectangle around it along x, and, seen from above as a sketch is
 * drawn, its corner at the origin: x from 0 to its length, z from minus its width to 0.
 */
export class FlatPattern {
  /** The flat part. */
  readonly part: Part
  /** The cut contour (outer boundary and holes) as a sketch at y = 0. */
  readonly outline: Sketch
  /** The bends, each with its bend line, angle, radius, direction and K-factor. */
  readonly bends: Bend[]
  /** The sheet's thickness. */
  readonly thickness: number
  /** The K-factor of every bend, or null where the bends have different ones (each Bend has its own). */
  readonly kFactor: number | null

  constructor(part: Part, outline: Sketch, bends: Bend[], thickness: number, kFactor: number | null) {
    this.part = part
    this.outline = outline
    this.bends = bends
    this.thickness = thickness
    this.kFactor = kFactor
  }

  /** The bend lines (each bend's `line`), at y = 0. */
  get bendLines(): ShapeList<Edge> {
    return ShapeList.from(this.bends.flatMap((b) => (b.line === null ? [] : [b.line]))) as ShapeList<Edge>
  }

  /** The size of the blank: its length along x, its thickness along y and its width along z,
   * measured on its edges (a new THREE.Vector3). */
  get size(): THREE.Vector3 {
    // (on the edges: the surface of a fitted face, a hole's wall that crossed a bend, may reach past
    // them)
    const box = new THREE.Box3()
    for (const e of this.part.edges()) box.union(e.bbox())
    return box.getSize(new THREE.Vector3())
  }

  /** A summary: the size of the blank (length x width), its thickness and bends. */
  toString(): string {
    const s = this.size
    const g = (x: number) => +x.toPrecision(6)
    return `FlatPattern(${g(s.x)} x ${g(s.z)}, thickness=${g(this.thickness)}, ${this.bends.length} bends, kFactor=${this.kFactor === null ? 'per bend' : g(this.kFactor)})`
  }
}

/** A Bend of the kernel's, of a part (or the flat pattern) made from `like`. */
function bendOf(b: sm.Bend, like: Part): Bend {
  return new Bend(
    radians(b.angle),
    b.radius,
    b.thickness,
    b.kFactor,
    b.length,
    b.axis === null ? null : ray(b.axis),
    b.line === null ? null : (placedCurve(b.line, like) as Edge),
    b.direction as 'up' | 'down' | null,
  )
}

// ------------------------------------------------------------------------------------- bending
/** Options of folds. */
export interface FoldOptions {
  /** The inside bend radius (from 0.11). */
  radius: number
  /** Where the neutral fiber lies, 0 (inside) to 1 (outside); default 0.44. The part keeps it with
   * the bend: `unfold` and `flatPattern` take it by default. */
  kFactor?: number
  /** A point on the side of the line that stays in place (in the part's frame), or a shape there
   * (where it is: its center; a vertex's point). By default the side that reaches farther from the
   * line stays. */
  fixed?: THREE.Vector3Like | Body | Face | Edge | Wire | Vertex | null
  /** Bend only along the segment `line` (an Edge), not across the whole sheet; the strip next to the
   * segment must be cut free from the rest of the sheet (relief cuts). */
  partial?: boolean
}

/**
 * The part (a sheet of constant thickness: a plate, or a part bent before) folded along a line by
 * `angle` radians, up to π (a hem): the strip of the bend allowance centered on the line becomes the
 * bend, exact cylinders of `radius` and `radius + thickness`. The line lies on the top or bottom face
 * of the sheet: a THREE.Ray in the part's frame, or a straight Edge (where it is). A positive angle
 * folds the sheet toward the side the face with the line faces (a line on the top folds it up), a
 * negative one the other way.
 */
export function fold(part: Part, line: THREE.Ray | Edge, angle: number, options: FoldOptions): Part {
  const value = sheet(part, 'fold')
  let l: sm.Axis | sm.Edge
  if (line instanceof Edge) l = operand(line, part, 'fold') as sm.Edge
  else if (isRay(line)) l = toAxis(line)
  else throw new TypeError(`fold: the bend line is a THREE.Ray or a straight Edge, not ${describe(line)}`)
  if (typeof angle !== 'number') throw new TypeError(`fold: the angle is a number of radians, not ${describe(angle)}`)
  if (angle === 0 || !(Math.abs(angle) <= Math.PI)) throw new RangeError(`fold: the angle must be between -π and π radians and not 0 (got ${angle})`)
  const fixed = options?.fixed
  const o = { ...options, fixed: fixed == null ? fixed : isObject3D(fixed) ? operand(fixed, part, 'fold') : vec(fixed) }
  return adopt(wrap(call(() => sm.fold(value, l, degrees(angle), o))) as Part, part)
}

/** Options of flanges. */
export interface FlangeOptions {
  /** The bend angle in radians, below π (default π / 2): a positive angle folds the flange toward the
   * side the face with the edge faces, a negative one the other way. */
  angle?: number
  /** The inside bend radius (from 0.11). */
  radius: number
  /** Where the neutral fiber lies, 0 (inside) to 1 (outside); default 0.44. */
  kFactor?: number
}

/**
 * The part with a flange along a straight edge of the sheet, where a top or bottom face meets a side
 * face square to it (an edge of the part, picked by selectors: `plate.edges().parallelTo(Z).top().right()`):
 * the sheet extended beyond the edge and bent there, so the sheet keeps its size. `length` is the
 * flange's outside length, from the virtual sharp (where the outside faces of sheet and flange meet)
 * to its end: for a right angle, its height over the outside face of the sheet.
 */
export function flange(part: Part, edge: Edge | Iterable<Edge>, length: number, options: FlangeOptions): Part {
  const value = sheet(part, 'flange')
  const edges = isObject3D(edge) ? [edge] : [...(edge as Iterable<Edge>)]
  const own = edges.map((e) => {
    if (!(e instanceof Edge)) throw new TypeError(`flange: give an edge of the part, not ${describe(e)}`)
    // (an edge of the part or of a clone of it as it is; another body's, where it is, for the edge of
    // the part in its place)
    return e.owner !== null && kernelOf(e.owner) === value ? (kernelOfShape(e) as sm.Edge) : (operand(e, part, 'flange') as sm.Edge)
  })
  const k = own.length === 1 ? own[0] : (sm.ShapeList.from(own) as sm.ShapeList<sm.Edge>)
  const o = { ...options, angle: options?.angle === undefined ? undefined : degrees(options.angle) }
  return adopt(wrap(call(() => sm.flange(value, k, length, o))) as Part, part)
}

/**
 * The bends of a sheet metal part: pairs of coaxial cylinder faces one thickness apart (as fold,
 * flange and bend make them, or as a file has them), up to below a full turn; cylinders without such a
 * partner (holes, rounds) are none. Each with its angle, inside radius, thickness, length and axis (a
 * THREE.Ray in the part's frame); `kFactor` (see KFactor) sets their K-factors only.
 */
export function bends(part: Part, options: { kFactor?: KFactor } = {}): Bend[] {
  const value = sheet(part, 'bends')
  return call(() => value.bends({ ...options, kFactor: kFactorOf(options.kFactor) })).map((b) => bendOf(b, part))
}

// ----------------------------------------------------------------------------------- unfolding
/** Options of `unfold` and `flatPattern`. */
export interface UnfoldOptions {
  /** The K-factor of each bend (see KFactor); default: the one each bend was folded with, else 0.44. */
  kFactor?: KFactor
  /** The planar face of the part that stays in place (default: the largest planar face). */
  fixed?: Face | null
}

/**
 * The sheet metal part with every bend flat again: the face `fixed` (default: the largest planar face)
 * stays where it is, the rest of the sheet unfolds into its plane. With the K-factor the part was bent
 * with (by default each bend's own, from fold and flange, else 0.44), it is the blank it was bent from.
 * Rolled parts (one bend, no flat sheet), bends at a free end of the sheet (a curl) and bends over π
 * unroll at the neutral radius `radius + kFactor * thickness`. For the flat pattern on the ground, with
 * its outline and bend lines, see `flatPattern`.
 */
export function unfold(part: Part, options: UnfoldOptions = {}): Part {
  const value = sheet(part, 'unfold')
  const o = unfoldOptions(options, 'unfold')
  return adopt(wrap(call(() => sm.unfold(value, o))) as Part, part)
}

/**
 * The flat pattern of a sheet metal part (see FlatPattern): the part unfolded with `fixed` (default:
 * the largest planar face) as its bottom, laid on the ground of the part's frame with the longer side
 * along x, its cut contour as a sketch, and its bends with their bend lines; a bend is 'up' where the
 * sheet beyond its line folds up (+Y). `kFactor` as for `unfold`.
 */
export function flatPattern(part: Part, options: UnfoldOptions = {}): FlatPattern {
  const value = sheet(part, 'flatPattern')
  const o = unfoldOptions(options, 'flatPattern')
  const p = call(() => sm.flatPattern(value, o))
  const flat = adopt(wrap(p.part) as Part, part)
  const outline = adopt(wrap(p.outline) as Sketch, part)
  return new FlatPattern(flat, outline, p.bends.map((b) => bendOf(b, part)), p.thickness, p.kFactor)
}

function unfoldOptions(options: UnfoldOptions, what: string): sm.UnfoldOptions {
  const fixed = options?.fixed
  if (fixed != null && !(fixed instanceof Face)) throw new TypeError(`${what}: fixed is a planar face of the part, not ${describe(fixed)}`)
  return { ...options, kFactor: kFactorOf(options?.kFactor) as sm.KFactor | undefined, fixed: fixed == null ? fixed : (kernelOfShape(fixed) as sm.Face) }
}

/** The kernel value of a part given to an operation of sheet metal. */
function sheet(part: unknown, what: string): sm.Part {
  if (!(part instanceof Part)) throw new TypeError(`${what}: give a Part (a sheet of material), not ${describe(part)}`)
  return kernelOf(part) as sm.Part
}
