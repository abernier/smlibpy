// smlibpy's solids as Part subclasses, made the way three's geometries are: `new Box(80, 10, 60)` as
// `new THREE.BoxGeometry(80, 10, 60)`, their arguments kept in `parameters`. A solid three has a
// geometry of takes that geometry's arguments (without its segment counts: the solid is exact; its
// tessellation is set by `tolerance` and `angle`), with three's defaults, and stands as it does:
// cylinders and cones along y, a ball's poles on y, a torus in the XY plane, each centered on the
// origin as three centers it. The solids three has none of stand along y as a box does (Pyramid,
// Wedge), lie in the XY plane as a ring does (AnnularSector), or drill along -z into a face their
// frame lies on (the holes). `align` moves a solid by its bounding box.
import * as THREE from 'three'
import { align3, alignment, box3, call, degrees, describe, location, sm } from './kernel.ts'
import type { Align3 } from './types.ts'
import { internal, Part, setKernel } from './shapes.ts'

/** Where a solid lies: its 'min' side, 'center' or 'max' side at the origin, per axis ({ y: 'min' }
 * stands it on the XZ plane, x and z as they are), or one value for all. Without it a solid lies as
 * three's geometry of it does. */
export interface PlacementOptions {
  align?: Align3
}

/** Options of the solids that are sectors about their axis as three's are: from `thetaStart` over
 * `thetaLength` radians. */
export interface SectorOptions extends PlacementOptions {
  thetaStart?: number
  thetaLength?: number
}

/**
 * A box: `width` along x, `height` along y and `depth` along z, centered on the origin, as
 * `THREE.BoxGeometry(width, height, depth)`.
 */
export class Box extends Part {
  declare readonly parameters: { readonly width: number; readonly height: number; readonly depth: number; readonly align?: Align3 }

  constructor(width = 1, height = 1, depth = 1, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Box', 'THREE.BoxGeometry(width, height, depth)', [width, height, depth])
    checkOptions('Box', options, 4, 'widthSegments')
    this.parameters = { width, height, depth, align: options.align }
    setKernel(this, call(() => sm.Box(width, height, depth, { align: align3(options.align) })))
  }
}

/**
 * A cylinder along y, centered on the origin, as `THREE.CylinderGeometry(radiusTop, radiusBottom,
 * height)`: `radiusTop` at the top (+y), `radiusBottom` at the bottom (a frustum where they differ,
 * a cone where one is 0). A sector of one runs from `thetaStart` over `thetaLength` radians about
 * +y, from +z (at 0) towards +x (at π/2), as three's does.
 */
export class Cylinder extends Part {
  declare readonly parameters: {
    readonly radiusTop: number
    readonly radiusBottom: number
    readonly height: number
    readonly thetaStart: number
    readonly thetaLength: number
    readonly align?: Align3
  }

  constructor(radiusTop = 1, radiusBottom = 1, height = 1, options: SectorOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Cylinder', 'THREE.CylinderGeometry(radiusTop, radiusBottom, height)', [radiusTop, radiusBottom, height])
    checkOptions('Cylinder', options, 4, 'radialSegments')
    const { thetaStart = 0, thetaLength = 2 * Math.PI } = options
    this.parameters = { radiusTop, radiusBottom, height, thetaStart, thetaLength, align: options.align }
    setKernel(this, standing(radiusTop, radiusBottom, height, thetaStart, thetaLength, options.align, 'Cylinder'))
  }
}

/**
 * A cone along y, centered on the origin, its tip at the top (+y), as `THREE.ConeGeometry(radius,
 * height)` (a Cylinder of `radiusTop` 0). `thetaStart` and `thetaLength` make a sector, as for
 * Cylinder.
 */
export class Cone extends Part {
  declare readonly parameters: { readonly radius: number; readonly height: number; readonly thetaStart: number; readonly thetaLength: number; readonly align?: Align3 }

  constructor(radius = 1, height = 1, options: SectorOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Cone', 'THREE.ConeGeometry(radius, height)', [radius, height])
    checkOptions('Cone', options, 3, 'radialSegments')
    const { thetaStart = 0, thetaLength = 2 * Math.PI } = options
    this.parameters = { radius, height, thetaStart, thetaLength, align: options.align }
    setKernel(this, standing(0, radius, height, thetaStart, thetaLength, options.align, 'Cone'))
  }
}

/** Options of Ball: the part of the sphere three's SphereGeometry makes of its angles (radians):
 * `phiStart` and `phiLength` about +y, `thetaStart` and `thetaLength` down from the pole at +y. */
export interface BallOptions extends PlacementOptions {
  phiStart?: number
  phiLength?: number
  thetaStart?: number
  thetaLength?: number
}

/**
 * A solid sphere around the origin, its poles on y, as `THREE.SphereGeometry(radius)`; or the part
 * of one its angles keep (see BallOptions), with flat sides where three's leaves it open. (smlibpy's
 * Sphere; a ball is the solid a sphere bounds, and `THREE.Sphere` is three's.)
 */
export class Ball extends Part {
  declare readonly parameters: {
    readonly radius: number
    readonly phiStart: number
    readonly phiLength: number
    readonly thetaStart: number
    readonly thetaLength: number
    readonly align?: Align3
  }

  constructor(radius = 1, options: BallOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Ball', 'THREE.SphereGeometry(radius)', [radius])
    checkOptions('Ball', options, 2, 'widthSegments')
    const { phiStart = 0, phiLength = 2 * Math.PI, thetaStart = 0, thetaLength = Math.PI } = options
    this.parameters = { radius, phiStart, phiLength, thetaStart, thetaLength, align: options.align }
    const end = Math.min(thetaStart + thetaLength, Math.PI)
    if (!(thetaStart >= 0 && thetaStart < end)) throw new RangeError(`Ball: need 0 <= thetaStart < thetaStart + thetaLength (radians from the pole at +y), got ${thetaStart} and ${thetaLength}`)
    // the kernel's sphere has its poles on z, its latitudes up from the equator and its longitude
    // from +x about +z; three's poles are on y, theta runs down from +y and phi about +y from -x
    const k = call(() =>
      sm.Sphere(radius, {
        arcSize1: 90 - degrees(end),
        arcSize2: 90 - degrees(thetaStart),
        arcSize3: Math.min(degrees(phiLength), 360),
        align: null,
      }),
    )
    setKernel(this, placed(k, turnY(phiStart + Math.PI).multiply(UPRIGHT), options.align))
  }
}

/** Options of Torus: the part of the ring (`arc` radians from +x about +z, as three's) and of the
 * tube's section (from `minorStartAngle` to `minorEndAngle`: radians from the side away from the
 * axis, 0, towards +z, π/2), each a whole turn by default. */
export interface TorusOptions extends PlacementOptions {
  arc?: number
  minorStartAngle?: number
  minorEndAngle?: number
}

/**
 * A torus in the XY plane around z, centered on the origin, as `THREE.TorusGeometry(radius, tube)`:
 * `radius` from the center to the middle of the tube, `tube` the tube's radius.
 */
export class Torus extends Part {
  declare readonly parameters: { readonly radius: number; readonly tube: number } & TorusOptions

  constructor(radius = 1, tube = 0.4, options: TorusOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Torus', 'THREE.TorusGeometry(radius, tube)', [radius, tube])
    checkOptions('Torus', options, 3, 'radialSegments')
    this.parameters = { radius, tube, ...options }
    if (options.arc !== undefined && !(options.arc > 0)) throw new RangeError(`Torus: arc must be more than 0 radians, got ${options.arc}`)
    const angle = (a: number | undefined) => (a === undefined ? undefined : degrees(a))
    const k = call(() =>
      sm.Torus(radius, tube, {
        majorAngle: options.arc === undefined ? undefined : Math.min(degrees(options.arc), 360),
        minorStartAngle: angle(options.minorStartAngle),
        minorEndAngle: angle(options.minorEndAngle),
        align: null,
      }),
    )
    setKernel(this, placed(k, null, options.align))
  }
}

/** A pyramid: a `width` (x) by `depth` (z) base, its apex `height` above (+y), centered on its
 * bounding box. */
export class Pyramid extends Part {
  declare readonly parameters: { readonly width: number; readonly height: number; readonly depth: number; readonly align?: Align3 }

  constructor(width = 1, height = 1, depth = 1, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Pyramid', 'a box: (width, height, depth)', [width, height, depth])
    checkOptions('Pyramid', options, 4)
    this.parameters = { width, height, depth, align: options.align }
    // (the kernel's apex is up its z: turned to y)
    setKernel(this, placed(call(() => sm.Pyramid(width, depth, height)), UPRIGHT, options.align))
  }
}

/** A ramp: a `width` (x) by `depth` (z) base whose high side, `height` tall (y), is at x =
 * -width/2, the slope running down towards +x; `topWidth` gives it a flat top of that width from
 * the high side. Centered on its bounding box. */
export class Wedge extends Part {
  declare readonly parameters: { readonly width: number; readonly height: number; readonly depth: number; readonly topWidth: number; readonly align?: Align3 }

  constructor(width = 1, height = 1, depth = 1, topWidth = 0, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('Wedge', 'a box and a top: (width, height, depth, topWidth)', [width, height, depth, topWidth])
    checkOptions('Wedge', options, 5)
    this.parameters = { width, height, depth, topWidth, align: options.align }
    // (the kernel's height is along its z: turned to y)
    setKernel(this, placed(call(() => sm.Wedge(width, depth, height, topWidth)), UPRIGHT, options.align))
  }
}

/**
 * A sector of a thick ring in the XY plane, as `THREE.RingGeometry(innerRadius, outerRadius)` with
 * a thickness: between `innerRadius` and `outerRadius` from the z axis, `height` along z (centered
 * on z = 0), from `thetaStart` over `thetaLength` radians about +z from +x (a whole ring by
 * default), as three's ring runs. An `innerRadius` of 0 gives a sector of a cylinder along z.
 */
export class AnnularSector extends Part {
  declare readonly parameters: {
    readonly innerRadius: number
    readonly outerRadius: number
    readonly height: number
    readonly thetaStart: number
    readonly thetaLength: number
    readonly align?: Align3
  }

  constructor(innerRadius = 0.5, outerRadius = 1, height = 1, options: SectorOptions = {}) {
    super()
    if (internal(this)) return
    checkNumbers('AnnularSector', 'THREE.RingGeometry(innerRadius, outerRadius) and a height', [innerRadius, outerRadius, height])
    checkOptions('AnnularSector', options, 4, 'thetaSegments')
    const { thetaStart = 0, thetaLength = 2 * Math.PI } = options
    this.parameters = { innerRadius, outerRadius, height, thetaStart, thetaLength, align: options.align }
    if (!(thetaLength > 0)) throw new RangeError(`AnnularSector: thetaLength must be more than 0 radians, got ${thetaLength}`)
    const k = call(() => sm.AnnularSector(innerRadius, outerRadius, height, Math.min(degrees(thetaLength), 360), { align: null }))
    setKernel(this, placed(k, thetaStart === 0 ? null : turnZ(thetaStart), options.align))
  }
}

/** A drilling tool: a cylinder from the origin down to -`depth` along -z, to cut into a face its
 * frame lies on (`at(Locations(face))`, whose z is the face's normal). */
export class Hole extends Part {
  declare readonly parameters: { readonly radius: number; readonly depth: number }

  constructor(radius = 1, depth = 1) {
    super()
    if (internal(this)) return
    this.parameters = { radius, depth }
    setKernel(this, call(() => sm.Hole(radius, depth)))
  }
}

/** A drilling tool with a counterbore at the top (z = 0), drilling along -z as Hole. */
export class CounterBoreHole extends Part {
  declare readonly parameters: { readonly radius: number; readonly counterBoreRadius: number; readonly counterBoreDepth: number; readonly depth: number }

  constructor(radius = 1, counterBoreRadius = 2, counterBoreDepth = 1, depth = 3) {
    super()
    if (internal(this)) return
    this.parameters = { radius, counterBoreRadius, counterBoreDepth, depth }
    setKernel(this, call(() => sm.CounterBoreHole(radius, counterBoreRadius, counterBoreDepth, depth)))
  }
}

/** A drilling tool with a conical countersink of included `angle` (radians; default 82 degrees) at
 * the top (z = 0), drilling along -z as Hole. */
export class CounterSinkHole extends Part {
  declare readonly parameters: { readonly radius: number; readonly counterSinkRadius: number; readonly depth: number; readonly angle: number }

  constructor(radius = 1, counterSinkRadius = 2, depth = 3, angle = (82 * Math.PI) / 180) {
    super()
    if (internal(this)) return
    this.parameters = { radius, counterSinkRadius, depth, angle }
    setKernel(this, call(() => sm.CounterSinkHole(radius, counterSinkRadius, depth, degrees(angle))))
  }
}

// ------------------------------------------------------------------------------------- helpers
/** The kernel's z turned to y (and its y to -z): what the kernel builds along z stands along y. */
const UPRIGHT = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)

/** (cos and sin, exact at the quarter turns) */
function cosSin(angle: number): [number, number] {
  const snap = (v: number) => (Math.abs(v) < 1e-15 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-15 ? Math.sign(v) : v)
  return [snap(Math.cos(angle)), snap(Math.sin(angle))]
}

/** A turn about +y. */
function turnY(angle: number): THREE.Matrix4 {
  const [c, s] = cosSin(angle)
  return new THREE.Matrix4().set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1)
}

/** A turn about +z. */
function turnZ(angle: number): THREE.Matrix4 {
  const [c, s] = cosSin(angle)
  return new THREE.Matrix4().set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
}

/** The kernel's solid moved by `m` (null: as made), then aligned by its box as `align` says. */
function placed(k: sm.Part, m: THREE.Matrix4 | null, align: Align3 | undefined): sm.Part {
  let body = m === null ? k : call(() => k.moved(location(m)))
  if (align !== undefined) {
    const offset = alignment(box3(call(() => body.bbox())), align)
    if (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) body = call(() => body.moved(location(new THREE.Matrix4().makeTranslation(offset))))
  }
  return body
}

/** A cylinder, frustum or cone along y as three's CylinderGeometry makes it: the kernel's along z
 * (its sector from +x about +z), stood up and turned so that the sector starts at `thetaStart`
 * (three's 0 is +z, towards +x at π/2). */
function standing(radiusTop: number, radiusBottom: number, height: number, thetaStart: number, thetaLength: number, align: Align3 | undefined, what: string): sm.Part {
  if (!(thetaLength > 0)) throw new RangeError(`${what}: thetaLength must be more than 0, got ${thetaLength}`)
  const arcSize = Math.min(degrees(thetaLength), 360)
  const k = call(() =>
    radiusTop === radiusBottom
      ? sm.Cylinder(radiusTop, height, { arcSize, align: null })
      : sm.Cone(radiusBottom, radiusTop, height, { arcSize, align: null }),
  )
  return placed(k, turnY(thetaStart - Math.PI / 2).multiply(UPRIGHT), align)
}

/** A solid's dimensions are numbers, in the order of three's geometry of it: an object where one
 * goes is most likely an argument list of smlibpy's (`Cylinder(radius, height, options)`). */
function checkNumbers(what: string, as: string, values: readonly unknown[]): void {
  for (const v of values) {
    if (typeof v !== 'number') throw new TypeError(`${what}: its dimensions are numbers, as ${as} takes them, not ${describe(v)}`)
  }
}

/** Options are an object: three's segment counts (where three's geometry has them) are not taken,
 * as the solid is exact. */
function checkOptions(what: string, options: unknown, position: number, segments?: string): void {
  if (options !== null && typeof options === 'object' && !Array.isArray(options)) return
  const why = segments === undefined ? '' : ` (${what} is exact: it takes no ${segments}; its tessellation is set by \`tolerance\` and \`angle\`)`
  throw new TypeError(`${what}: argument ${position} is the options object, not ${describe(options)}${why}`)
}
