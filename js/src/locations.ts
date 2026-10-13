// Patterns of locations. Multiply a pattern with a shape to get one copy per location:
//
//     const holes = GridLocations(20, 20, 3, 2).mul(Circle(2))        // six circles
//     const bolts = PolarLocations(30, 6).mul(Cylinder(3, 10))        // six cylinders on a circle
//     part = part.cut(GridLocations(40, 30, 2, 2).mul(Hole(3, 10)).on(topFace))

import { Location, Plane, Pos, Rot, type Vector, _isPointLike, _radians, _vec, type VectorLike } from './geometry.ts'
import { Face, Shape, ShapeList, Vertex, _asPlane } from './shapes.ts'

const inspect = Symbol.for('nodejs.util.inspect.custom')

/**
 * A list of locations. `new Locations([0, 0], [10, 5], ...)` takes points, locations, planes,
 * faces (their center planes) or vertices.
 */
export class Locations extends Array<Location> {
  // (map, filter and slice give plain arrays)
  static override get [Symbol.species](): ArrayConstructor {
    return Array
  }

  constructor(...items: unknown[]) {
    super()
    for (const it of items) {
      if (it instanceof Location) this.push(it)
      else if (it instanceof Plane) this.push(it.location)
      else if (it instanceof Locations) this.push(...it)
      else if (it instanceof ShapeList) for (const f of it) this.push(_asPlane(f).location)
      else if (it instanceof Face) this.push(it.plane.location)
      else if (it instanceof Vertex) this.push(Pos(it.point))
      else this.push(Pos(_vec(it as VectorLike)))
    }
  }

  /**
   * Each location applied to something: a location (each composed with it), another pattern
   * (every pair), a shape or a list of shapes (one copy per location; a ShapeList).
   */
  mul(other: Location | Locations): Locations
  mul<T>(other: Shape | Iterable<T>): ShapeList<Any>
  mul(other: unknown): unknown {
    if (other instanceof Location) return new Locations(...this.map((l) => l.mul(other)))
    if (other instanceof Locations) return new Locations(...this.flatMap((a) => other.map((b) => a.mul(b))))
    if (other instanceof Shape) return ShapeList.from(this.map((l) => l.mul(other))) as ShapeList<Any>
    if (other != null && typeof (other as Any)[Symbol.iterator] === 'function' && !_isPointLike(other)) {
      const items = [...(other as Iterable<unknown>)]
      return ShapeList.from(this.flatMap((l) => items.map((o) => (l.mul as (x: unknown) => unknown)(o)))) as ShapeList<Any>
    }
    throw new TypeError('a pattern applies to locations, shapes and lists of shapes')
  }

  /** The pattern moved by a location (`location.mul(pattern)`). */
  moved(location: Location): Locations {
    return new Locations(...this.map((l) => location.mul(l)))
  }

  /** The pattern placed onto a plane or face. */
  on(target: unknown): Locations {
    return this.moved(_asPlane(target).location)
  }

  get points(): Vector[] {
    return this.map((l) => l.position)
  }

  override toString(): string {
    return `Locations(${this.length} locations)`
  }

  [inspect](): string {
    return this.toString()
  }
}

// biome-ignore lint: shapes of any kind
type Any = any

/** A rectangular grid in the XY plane, centered on the origin unless `centered: false`. */
export function GridLocations(xSpacing: number, ySpacing: number, xCount: number, yCount: number, options: { centered?: boolean } = {}): Locations {
  const centered = options.centered ?? true
  if (xCount < 1 || yCount < 1) throw new RangeError('counts must be at least 1')
  const x0 = centered ? (-xSpacing * (xCount - 1)) / 2 : 0
  const y0 = centered ? (-ySpacing * (yCount - 1)) / 2 : 0
  const locs: Location[] = []
  for (let j = 0; j < yCount; j++) for (let i = 0; i < xCount; i++) locs.push(Pos(x0 + i * xSpacing, y0 + j * ySpacing))
  return new Locations(...locs)
}

/**
 * `count` locations on a circle of `radius` in the XY plane.
 *
 * With `rotate` the copies turn with the pattern (their X axis points outward). A full circle
 * (`angularRange: 360`) spaces them evenly without repeating the start.
 */
export function PolarLocations(
  radius: number,
  count: number,
  options: { startAngle?: number; angularRange?: number; rotate?: boolean } = {},
): Locations {
  const { startAngle = 0, angularRange = 360, rotate = true } = options
  if (count < 1) throw new RangeError('count must be at least 1')
  const full = Math.abs(Math.abs(angularRange) - 360) < 1e-9
  const step = full ? angularRange / count : count > 1 ? angularRange / (count - 1) : 0
  const locs: Location[] = []
  for (let i = 0; i < count; i++) {
    const a = startAngle + i * step
    const p = Pos(radius * Math.cos(_radians(a)), radius * Math.sin(_radians(a)))
    locs.push(rotate ? p.mul(Rot(0, 0, a)) : p)
  }
  return new Locations(...locs)
}

/** A honeycomb pattern: rows `spacing` apart along X, every other row shifted by half. */
export function HexLocations(spacing: number, xCount: number, yCount: number, options: { centered?: boolean } = {}): Locations {
  const centered = options.centered ?? true
  const dy = (spacing * Math.sqrt(3)) / 2
  let pts: [number, number][] = []
  for (let j = 0; j < yCount; j++) for (let i = 0; i < xCount; i++) pts.push([i * spacing + (j % 2 ? spacing / 2 : 0), j * dy])
  if (centered && pts.length) {
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    pts = pts.map(([x, y]) => [x - cx, y - cy])
  }
  return new Locations(...pts)
}
