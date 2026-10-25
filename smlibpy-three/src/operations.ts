// smlibpy's free functions and patterns. The functions take their first shape as smlibpy's
// methods take `self`: the result is in its frame and has its transform; the other shapes are taken
// where they are. Patterns are THREE.Matrix4s, on the ground (XZ) as smlibpy's lie on XY: give
// them to `shape.at(locations)` for copies there.
import * as THREE from 'three'
import { call, degrees, matrix4, sm } from './kernel.ts'
import { adopt, operand, wrap, type Edge, type ExtrudeOptions, type Face, type Part, type Sketch, type SweepOptions, type Wire } from './shapes.ts'

/** A solid: the sketch (or face) moved `amount` along its normal. */
export function extrude(profile: Sketch | Face, amount: number, options: ExtrudeOptions = {}): Part {
  return profile.extrude(amount, options)
}

/** A solid of revolution of the sketch about `axis` (in its frame) through `angle` radians. */
export function revolve(profile: Sketch, axis: THREE.Ray | null = null, angle = 2 * Math.PI): Part {
  return profile.revolve(axis, angle)
}

/** A solid: the sketch swept along `path`. */
export function sweep(profile: Sketch, path: Edge | Wire | THREE.Curve<THREE.Vector3>, options: SweepOptions = {}): Part {
  return profile.sweep(path, options)
}

/** Options of lofts. */
export interface LoftOptions {
  /** Straight between the sections (default: smooth through them). */
  ruled?: boolean
  /** Back from the last section to the first: a ring. */
  closed?: boolean
}

/**
 * A solid through `sections` (sketches, each where it is: place them with their transforms), in
 * the frame of the first one.
 */
export function loft(sections: readonly Sketch[], options: LoftOptions = {}): Part {
  if (sections.length < 2) throw new RangeError('loft: give two sections or more')
  const first = sections[0]
  const kernel = sections.map((s) => operand(s, first, 'loft') as sm.Sketch)
  return adopt(wrap(call(() => sm.loft(kernel, options))) as Part, first)
}

const matrices = (locations: Iterable<sm.Location>) => [...locations].map((l) => matrix4(l))

/** A grid on the ground: `xCount` places `xSpacing` apart along x, `zCount` places `zSpacing`
 * apart along z (smlibpy's GridLocations on XY), centered unless `centered` is false. */
export function GridLocations(xSpacing: number, zSpacing: number, xCount: number, zCount: number, options: { centered?: boolean } = {}): THREE.Matrix4[] {
  return matrices(call(() => sm.GridLocations(xSpacing, zSpacing, xCount, zCount, options)))
}

/** `count` places on a circle of `radius` around y, from `startAngle` over `angularRange`
 * (radians), each turned to face outward unless `rotate` is false. */
export function PolarLocations(radius: number, count: number, options: { startAngle?: number; angularRange?: number; rotate?: boolean } = {}): THREE.Matrix4[] {
  const o = {
    startAngle: options.startAngle === undefined ? undefined : degrees(options.startAngle),
    angularRange: options.angularRange === undefined ? undefined : degrees(options.angularRange),
    rotate: options.rotate,
  }
  return matrices(call(() => sm.PolarLocations(radius, count, o)))
}

/** A hexagonal grid on the ground, `spacing` apart. */
export function HexLocations(spacing: number, xCount: number, zCount: number, options: { centered?: boolean } = {}): THREE.Matrix4[] {
  return matrices(call(() => sm.HexLocations(spacing, xCount, zCount, options)))
}

