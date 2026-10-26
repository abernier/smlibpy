// The pen: an outline drawn segment by segment (smlibpy's Profile), in a sketch's own 2D
// coordinates: points are THREE.Vector2s (or { x, y }), x along three's x and y along -z on the
// ground, as a sketch's are (a THREE.Vector3 is a point of three's, on the ground); headings and
// turns are radians, counterclockwise seen from above. Every call returns a new Profile, so one
// drawing branches into variants; close() makes the region (a Sketch), wire() the open path (a
// Wire).
import * as THREE from 'three'
import { align2, call, degrees, describe, radians, sm } from './kernel.ts'
import type { Align2 } from './types.ts'
import { curveOf, wrap, type Sketch, type Wire } from './shapes.ts'

/** The coordinate a line or a forward move goes to, in the sketch's 2D coordinates: `{ x }`,
 * `{ y }` or both. */
export interface Coordinates {
  x?: number | null
  y?: number | null
}

// (the kernel's pen for a Profile a method made)
let incoming: sm.Profile | null = null

/**
 * A pen that draws one outline on the ground, segment by segment: lines and tangent arcs, each from
 * where the last one ended, with the corners it passes rounded or beveled.
 *
 *     const section = new Profile()
 *       .lineTo(12, 0).lineTo({ y: 4 }).fillet(1.5)
 *       .lineTo({ x: 6 }).lineTo({ y: 20 }).chamfer(1)
 *       .lineTo({ x: 0 })
 *       .close() // a Sketch: extrude or revolve it
 *
 * Moves: `lineTo` (to a point, or to an x or y), `lineBy` (by an offset), `forward` (along the
 * heading, or until x or y reaches a value), `arc` (tangent, by radius and angle; a positive angle
 * turns left), `arcTo` (tangent to an end point, or through a point). `turn` and `turnTo` change the
 * heading without drawing. `fillet` and `chamfer` round or bevel the corner at the pen, between the
 * segment before and the one after. `mirror` adds the mirror image of the path drawn so far.
 *
 * Points are THREE.Vector2s of the sketch's 2D coordinates (x along three's x, y along -z), or
 * THREE.Vector3s of three's on the ground; headings are radians counterclockwise from +x, seen from
 * above (π/2 is the sketch's +y, three's -z). Errors name the segment by the call that drew it,
 * with its angles in degrees.
 */
export class Profile {
  readonly #pen: sm.Profile

  /** A pen at `start` (default the origin), heading `heading` radians: `new Profile()`,
   * `new Profile(new THREE.Vector2(0, 5), { heading: Math.PI / 2 })` or `new Profile({ heading })`. */
  constructor(start: THREE.Vector2Like | THREE.Vector3Like | { heading?: number } = new THREE.Vector2(), options: { heading?: number } = {}) {
    if (incoming !== null) {
      this.#pen = incoming
      return
    }
    if (!isPoint(start)) {
      options = start as { heading?: number }
      start = new THREE.Vector2()
    }
    const heading = options.heading === undefined ? 0 : degrees(options.heading)
    const at = penPoint(start, 'Profile')
    this.#pen = call(() => new sm.Profile(at, { heading }))
  }

  /** Where the pen is. */
  get point(): THREE.Vector2 {
    const p = this.#pen.point
    return new THREE.Vector2(p.x, p.y)
  }

  /** Where the drawing started. */
  get start(): THREE.Vector2 {
    const p = this.#pen.start
    return new THREE.Vector2(p.x, p.y)
  }

  /** The direction the pen moves in: radians counterclockwise from +x (-π to π). */
  get heading(): number {
    return radians(this.#pen.heading)
  }

  /** The number of segments drawn. */
  get length(): number {
    return this.#pen.length
  }

  // -- lines ----------------------------------------------------------------------------------
  /** A straight line to a point (`lineTo(30, 5)`, `lineTo(new THREE.Vector2(30, 5))`), or to one
   * coordinate, keeping the other: `lineTo({ x: 30 })` (along x), `lineTo({ y: 5 })` (along y). */
  lineTo(x: number, y: number): Profile
  lineTo(point: THREE.Vector2Like | THREE.Vector3Like | Coordinates): Profile
  lineTo(x: number | THREE.Vector2Like | THREE.Vector3Like | Coordinates, y?: number): Profile {
    if (typeof x === 'number' || typeof y === 'number') {
      const p = point2(x, y, 'lineTo')
      return this.#draw((pen) => pen.lineTo(p))
    }
    if (isPoint(x)) {
      const p = penPoint(x, 'lineTo')
      return this.#draw((pen) => pen.lineTo(p))
    }
    const c = coordinates(x, 'lineTo')
    return this.#draw((pen) => pen.lineTo(c))
  }

  /** A straight line by an offset from the pen: `lineBy(10, -5)` or `lineBy(new THREE.Vector2(10, -5))`. */
  lineBy(dx: number | THREE.Vector2Like | THREE.Vector3Like = 0, dy = 0): Profile {
    const d = typeof dx === 'number' ? [dx, dy] : penPoint(dx, 'lineBy')
    return this.#draw((pen) => pen.lineBy(d))
  }

  /** A straight line along the heading: `length` long (`forward(20)`), or until x or y reaches a
   * value (`forward({ x: 30 })`, `forward({ y: 5 })`). */
  forward(length: number | Coordinates): Profile {
    if (typeof length === 'number') return this.#draw((pen) => pen.forward(length))
    const c = coordinates(length, 'forward')
    return this.#draw((pen) => pen.forward(c))
  }

  /** Turns the heading by `angle` radians (positive: left, counterclockwise seen from above) without
   * drawing: the next segment starts at a corner. */
  turn(angle: number): Profile {
    return this.#draw((pen) => pen.turn(degrees(angle)))
  }

  /** Sets the heading (radians counterclockwise from +x) without drawing. */
  turnTo(heading: number): Profile {
    return this.#draw((pen) => pen.turnTo(degrees(heading)))
  }

  // -- arcs -----------------------------------------------------------------------------------
  /** A tangent arc of `radius` that turns the heading by `angle` radians: positive turns left
   * (counterclockwise seen from above), negative right; `arc(5, Math.PI)` is a U-turn. */
  arc(radius: number, angle: number): Profile {
    return this.#draw((pen) => pen.arc(radius, degrees(angle)))
  }

  /** An arc to an end point, tangent to the heading (`arcTo(20, 10)`), or through a point on the way
   * (`arcTo(20, 10, { through: new THREE.Vector2(15, 12) })`, which need not be tangent). */
  arcTo(x: number, y: number, options?: { through?: THREE.Vector2Like | THREE.Vector3Like | null }): Profile
  arcTo(point: THREE.Vector2Like | THREE.Vector3Like, options?: { through?: THREE.Vector2Like | THREE.Vector3Like | null }): Profile
  arcTo(
    x: number | THREE.Vector2Like | THREE.Vector3Like,
    y?: number | { through?: THREE.Vector2Like | THREE.Vector3Like | null },
    options: { through?: THREE.Vector2Like | THREE.Vector3Like | null } = {},
  ): Profile {
    if (typeof y === 'object' && y !== null) options = y
    const end = typeof x === 'number' ? point2(x, y, 'arcTo') : penPoint(x, 'arcTo')
    const through = options.through == null ? null : penPoint(options.through, 'arcTo')
    return this.#draw((pen) => (through === null ? pen.arcTo(end) : pen.arcTo(end, { through })))
  }

  // -- corners --------------------------------------------------------------------------------
  /** Rounds the corner at the pen with a tangent arc of `radius`: the corner between the segment just
   * drawn and the next one (at the start point: between the closing segment and the first). */
  fillet(radius: number): Profile {
    return this.#draw((pen) => pen.fillet(radius))
  }

  /** Bevels the corner at the pen: cuts back `length` along the segments before and after it and
   * joins the two points with a line. */
  chamfer(length: number): Profile {
    return this.#draw((pen) => pen.chamfer(length))
  }

  // -- symmetry -------------------------------------------------------------------------------
  /**
   * Goes on with the mirror image of the path drawn so far, so that the outline is symmetric about
   * the axis through `origin` along `direction` (both in the sketch's 2D coordinates:
   * `mirror(new THREE.Vector2(0, 0), new THREE.Vector2(0, 1))` is its y axis). Draw half the outline
   * from the axis around to the axis; an end off the axis is joined straight across to its mirror
   * image. Corners rounded on the half are rounded on the mirrored half too.
   */
  mirror(origin: THREE.Vector2Like | THREE.Vector3Like, direction: THREE.Vector2Like | THREE.Vector3Like): Profile {
    const axis = call(() => new sm.Axis(penPoint(origin, 'mirror'), penPoint(direction, 'mirror')))
    return this.#draw((pen) => pen.mirror(axis))
  }

  // -- results --------------------------------------------------------------------------------
  /**
   * The region inside the outline, a Sketch on the ground (a straight line goes back to the start if
   * the pen is not there). `align` moves it ('min', 'center', 'max', per axis of the sketch); null,
   * the default, leaves the outline where it was drawn.
   */
  close(options: { align?: Align2 | null } = {}): Sketch {
    const pen = this.#pen
    const align = options.align == null ? null : align2(options.align)
    return wrap(call(() => pen.close({ align }))) as Sketch
  }

  /** The path as drawn, an open Wire of exact lines and arcs on the ground (a sweep path, or the
   * centerline of a Stroke). */
  wire(): Wire {
    const pen = this.#pen
    return curveOf(call(() => pen.wire())) as Wire
  }

  toString(): string {
    const p = this.point
    return `Profile(${this.length} segments, at (${p.x}, ${p.y}), heading ${this.heading})`
  }

  /** A new Profile: the kernel's pen moved by `draw`. */
  #draw(draw: (pen: sm.Profile) => sm.Profile): Profile {
    const pen = this.#pen
    const moved = call(() => draw(pen))
    incoming = moved
    try {
      return new Profile()
    } finally {
      incoming = null
    }
  }
}

/** A point ({ x, y } numbers), not options. */
function isPoint(v: unknown): v is THREE.Vector2Like {
  const p = v as { x?: unknown; y?: unknown } | null
  return p !== null && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number'
}

/** A point (or offset) of the pen as the kernel's [x, y]: a THREE.Vector2 of the sketch's
 * coordinates, or a THREE.Vector3 of three's on the ground, whose -z is the sketch's y. */
function penPoint(p: unknown, what: string): number[] {
  if (!isPoint(p)) throw new TypeError(`${what}: a point of the pen is a THREE.Vector2 (or { x, y }), not ${describe(p)}`)
  const z = (p as { z?: unknown }).z
  if (typeof z !== 'number') return [p.x, p.y]
  if (Math.abs(p.y) > 1e-9 * Math.max(1, Math.abs(p.x), Math.abs(z))) {
    throw new RangeError(`${what}: the pen draws on the ground (y = 0), and (${p.x}, ${p.y}, ${z}) is off it; give the sketch's 2D coordinates (a THREE.Vector2)`)
  }
  return [p.x, 0 - z]
}

function point2(x: unknown, y: unknown, what: string): number[] {
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new TypeError(`${what}: give the point as ${what}(x, y) or ${what}(new THREE.Vector2(x, y)), not ${describe(x)} and ${describe(y)}`)
  }
  return [x, y]
}

/** `{ x }`, `{ y }` (or both) as the kernel's coordinates. */
function coordinates(c: unknown, what: string): { x?: number | null; y?: number | null } {
  if (c === null || typeof c !== 'object') throw new TypeError(`${what}: give a point, { x: ... } or { y: ... }, not ${describe(c)}`)
  const { x, y } = c as Coordinates
  return { x: x ?? null, y: y ?? null }
}
