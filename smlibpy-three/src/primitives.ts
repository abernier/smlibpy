// smlibpy's solids as Part subclasses, made the way three's geometries are (`new Box(80, 60, 10)`,
// their arguments kept in `parameters`), and standing as smlibpy's do: what smlibpy builds along
// its Z axis (a cylinder, the height of a box) runs along three's Y.
import { align3, call, degrees, sm } from './kernel.ts'
import type { Align3 } from './types.ts'
import { internal, Part, setKernel } from './shapes.ts'

/** Where a solid lies: its 'min' side, 'center' or 'max' side at the origin, per axis of three's
 * ({ y: 'min' } stands it on the XZ plane), or one value for all. */
export interface PlacementOptions {
  align?: Align3
}

/**
 * A box: `length` along x, `width` along z and `height` along y (up), centered on the origin; as
 * smlibpy's Box(length, width, height), whose height is along its Z.
 */
export class Box extends Part {
  declare readonly parameters: { readonly length: number; readonly width: number; readonly height: number; readonly align?: Align3 }

  constructor(length = 1, width = 1, height = 1, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { length, width, height, align: options.align }
    setKernel(this, call(() => sm.Box(length, width, height, { align: align3(options.align) })))
  }
}

/** A cylinder along y (up), centered on the origin; `arcSize` (radians) makes a sector of one. */
export class Cylinder extends Part {
  declare readonly parameters: { readonly radius: number; readonly height: number; readonly arcSize: number; readonly align?: Align3 }

  constructor(radius = 1, height = 1, options: PlacementOptions & { arcSize?: number } = {}) {
    super()
    if (internal(this)) return
    const arcSize = options.arcSize ?? 2 * Math.PI
    this.parameters = { radius, height, arcSize, align: options.align }
    setKernel(this, call(() => sm.Cylinder(radius, height, { arcSize: degrees(arcSize), align: align3(options.align) })))
  }
}

/** A cone (or frustum) along y, `bottomRadius` below, `topRadius` above (0: a point). */
export class Cone extends Part {
  declare readonly parameters: { readonly bottomRadius: number; readonly topRadius: number; readonly height: number; readonly arcSize: number; readonly align?: Align3 }

  constructor(bottomRadius = 1, topRadius = 0, height = 1, options: PlacementOptions & { arcSize?: number } = {}) {
    super()
    if (internal(this)) return
    const arcSize = options.arcSize ?? 2 * Math.PI
    this.parameters = { bottomRadius, topRadius, height, arcSize, align: options.align }
    setKernel(this, call(() => sm.Cone(bottomRadius, topRadius, height, { arcSize: degrees(arcSize), align: align3(options.align) })))
  }
}

/** Options of Sphere: a zone between two latitudes (radians from the equator, the XZ plane,
 * towards +y; from -π/2 to π/2) and a sector of `arcSize3` radians about y. */
export interface SphereOptions extends PlacementOptions {
  arcSize1?: number
  arcSize2?: number
  arcSize3?: number
}

/** A sphere around the origin (or a zone or sector of one). */
export class Sphere extends Part {
  declare readonly parameters: { readonly radius: number } & SphereOptions

  constructor(radius = 1, options: SphereOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { radius, ...options }
    const angle = (a: number | undefined) => (a === undefined ? undefined : degrees(a))
    setKernel(this, call(() => sm.Sphere(radius, { arcSize1: angle(options.arcSize1), arcSize2: angle(options.arcSize2), arcSize3: angle(options.arcSize3), align: align3(options.align) })))
  }
}

/** Options of Torus: a part of the tube's section (from `minorStartAngle` to `minorEndAngle`) and of
 * the ring (`majorAngle`), in radians. */
export interface TorusOptions extends PlacementOptions {
  minorStartAngle?: number
  minorEndAngle?: number
  majorAngle?: number
}

/** A torus around y (lying on the XZ plane). */
export class Torus extends Part {
  declare readonly parameters: { readonly majorRadius: number; readonly minorRadius: number } & TorusOptions

  constructor(majorRadius = 1, minorRadius = 0.25, options: TorusOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { majorRadius, minorRadius, ...options }
    const angle = (a: number | undefined) => (a === undefined ? undefined : degrees(a))
    setKernel(
      this,
      call(() =>
        sm.Torus(majorRadius, minorRadius, {
          minorStartAngle: angle(options.minorStartAngle),
          minorEndAngle: angle(options.minorEndAngle),
          majorAngle: angle(options.majorAngle),
          align: align3(options.align),
        }),
      ),
    )
  }
}

/** A pyramid: a `length` (x) by `width` (z) base, its apex `height` above (+y). */
export class Pyramid extends Part {
  declare readonly parameters: { readonly length: number; readonly width: number; readonly height: number; readonly align?: Align3 }

  constructor(length = 1, width = 1, height = 1, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { length, width, height, align: options.align }
    setKernel(this, call(() => sm.Pyramid(length, width, height, { align: align3(options.align) })))
  }
}

/** A sector of a thick ring around y: from `innerRadius` to `outerRadius`, `height` high, over
 * `arcSize` radians. */
export class AnnularSector extends Part {
  declare readonly parameters: { readonly innerRadius: number; readonly outerRadius: number; readonly height: number; readonly arcSize: number; readonly align?: Align3 }

  constructor(innerRadius = 0.5, outerRadius = 1, height = 1, arcSize = Math.PI / 2, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { innerRadius, outerRadius, height, arcSize, align: options.align }
    setKernel(this, call(() => sm.AnnularSector(innerRadius, outerRadius, height, degrees(arcSize), { align: align3(options.align) })))
  }
}

/** A drilling tool: a cylinder from the origin down to -`depth` (along -y), to cut into a face
 * placed with `at(Locations(face))`. */
export class Hole extends Part {
  declare readonly parameters: { readonly radius: number; readonly depth: number }

  constructor(radius = 1, depth = 1) {
    super()
    if (internal(this)) return
    this.parameters = { radius, depth }
    setKernel(this, call(() => sm.Hole(radius, depth)))
  }
}

/** A drilling tool with a counterbore at the top. */
export class CounterBoreHole extends Part {
  declare readonly parameters: { readonly radius: number; readonly counterBoreRadius: number; readonly counterBoreDepth: number; readonly depth: number }

  constructor(radius = 1, counterBoreRadius = 2, counterBoreDepth = 1, depth = 3) {
    super()
    if (internal(this)) return
    this.parameters = { radius, counterBoreRadius, counterBoreDepth, depth }
    setKernel(this, call(() => sm.CounterBoreHole(radius, counterBoreRadius, counterBoreDepth, depth)))
  }
}

/** A drilling tool with a conical countersink of included `angle` (radians; default 82 degrees) at the top. */
export class CounterSinkHole extends Part {
  declare readonly parameters: { readonly radius: number; readonly counterSinkRadius: number; readonly depth: number; readonly angle: number }

  constructor(radius = 1, counterSinkRadius = 2, depth = 3, angle = (82 * Math.PI) / 180) {
    super()
    if (internal(this)) return
    this.parameters = { radius, counterSinkRadius, depth, angle }
    setKernel(this, call(() => sm.CounterSinkHole(radius, counterSinkRadius, depth, degrees(angle))))
  }
}

/** A wedge: a box whose top (along y) is `topLength` long (0: a ridge). */
export class Wedge extends Part {
  declare readonly parameters: { readonly length: number; readonly width: number; readonly height: number; readonly topLength: number; readonly align?: Align3 }

  constructor(length = 1, width = 1, height = 1, topLength = 0, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { length, width, height, topLength, align: options.align }
    setKernel(this, call(() => sm.Wedge(length, width, height, topLength, { align: align3(options.align) })))
  }
}
