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

/** A sphere around the origin. */
export class Sphere extends Part {
  declare readonly parameters: { readonly radius: number; readonly align?: Align3 }

  constructor(radius = 1, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { radius, align: options.align }
    setKernel(this, call(() => sm.Sphere(radius, { align: align3(options.align) })))
  }
}

/** A torus around y (lying on the XZ plane). */
export class Torus extends Part {
  declare readonly parameters: { readonly majorRadius: number; readonly minorRadius: number; readonly align?: Align3 }

  constructor(majorRadius = 1, minorRadius = 0.25, options: PlacementOptions = {}) {
    super()
    if (internal(this)) return
    this.parameters = { majorRadius, minorRadius, align: options.align }
    setKernel(this, call(() => sm.Torus(majorRadius, minorRadius, { align: align3(options.align) })))
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
