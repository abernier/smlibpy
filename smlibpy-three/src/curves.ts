// smlibpy's curves as Edge (THREE.Line) and Wire subclasses, in three's coordinates: points are
// THREE.Vector3s, angles radians, arcs lie on a plane of constant y (the ground, as smlibpy's lie
// on XY) and turn counterclockwise seen from above. Any of three's own curves is an Edge or Wire
// too: `new Edge(new THREE.CatmullRomCurve3(points))`.
import * as THREE from 'three'
import { call, degrees, sm, vec } from './kernel.ts'
import { Edge, internal, setCurve, Wire } from './shapes.ts'

/** A straight line from `start` to `end`. */
export class Line extends Edge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), end: THREE.Vector3Like = new THREE.Vector3(1, 0, 0)) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.Line(vec(start), vec(end))))
  }
}

/** A smooth curve through `points` (with tangents at some of them; `closed`: back to the first). */
export class Spline extends Edge {
  constructor(points: readonly THREE.Vector3Like[] = [], options: { tangents?: readonly (THREE.Vector3Like | null)[] | null; closed?: boolean } = {}) {
    super()
    if (internal(this) || !points.length) return
    const tangents = options.tangents == null ? options.tangents : options.tangents.map((t) => (t === null ? null : vec(t)))
    setCurve(this, call(() => sm.Spline(points.map(vec), { tangents, closed: options.closed })))
  }
}

/** A Bézier curve of these control points (rational with `weights`). */
export class Bezier extends Edge {
  constructor(points: readonly THREE.Vector3Like[] = [], options: { weights?: readonly number[] | null } = {}) {
    super()
    if (internal(this) || !points.length) return
    setCurve(this, call(() => sm.Bezier(points.map(vec), { weights: options.weights })))
  }
}

/** A circle around `center`, or the arc of it from `startAngle` over `arcSize` (radians, negative:
 * clockwise seen from above), on the plane of constant y through `center`. Angles start at +x. */
export class CenterArc extends Edge {
  constructor(center: THREE.Vector3Like = new THREE.Vector3(), radius = 1, startAngle = 0, arcSize = 2 * Math.PI) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.CenterArc(vec(center), radius, degrees(startAngle), degrees(arcSize))))
  }
}

/** The circular arc from `start` through `through` to `end`. */
export class ThreePointArc extends Edge {
  constructor(start: THREE.Vector3Like = new THREE.Vector3(), through: THREE.Vector3Like = new THREE.Vector3(1, 1, 0), end: THREE.Vector3Like = new THREE.Vector3(2, 0, 0)) {
    super()
    if (internal(this)) return
    setCurve(this, call(() => sm.ThreePointArc(vec(start), vec(through), vec(end))))
  }
}

/** A helix around y (up) from y = 0 to `height`, `pitch` apart per turn (`leftHanded` the other way). */
export class Helix extends Edge {
  constructor(pitch = 1, height = 1, radius = 1, options: { center?: THREE.Vector3Like; direction?: THREE.Vector3Like; endRadius?: number | null; leftHanded?: boolean } = {}) {
    super()
    if (internal(this)) return
    setCurve(
      this,
      call(() =>
        sm.Helix(pitch, height, radius, {
          center: options.center === undefined ? undefined : vec(options.center),
          direction: options.direction === undefined ? undefined : vec(options.direction),
          endRadius: options.endRadius,
          leftHanded: options.leftHanded,
        }),
      ),
    )
  }
}

/** Straight lines through `points` (back to the first with `close`). */
export class Polyline extends Wire {
  constructor(points: readonly THREE.Vector3Like[] = [], options: { close?: boolean } = {}) {
    super()
    if (internal(this) || !points.length) return
    setCurve(this, call(() => sm.Polyline(points.map(vec), { close: options.close })))
  }
}
