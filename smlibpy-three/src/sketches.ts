// smlibpy's sketch shapes as Sketch subclasses. They are drawn in the sketch's own 2D coordinates
// (x, y), which lie on the ground of the sketch's frame (three's XZ plane, its y along -z), as
// smlibpy's lie on its XY plane; angles are in radians. Any outline three can draw (a THREE.Shape
// with holes) is a Sketch too: `new Sketch(shape)`.
import type * as THREE from 'three'
import { align2, call, degrees, sm, vec2 } from './kernel.ts'
import type { Align2 } from './types.ts'
import { internal, setKernel, Sketch } from './shapes.ts'

/** Corners rounded (`fillet`, a radius) or cut (`chamfer`, a length). */
export interface CornerOptions {
  fillet?: number
  chamfer?: number
}

/** Where the shape lies (per axis of the sketch, or one value for both) and how it is turned (radians). */
export interface SketchPlacement {
  align?: Align2
  rotation?: number
}

const turned = (o: SketchPlacement) => ({ align: align2(o.align), rotation: o.rotation === undefined ? undefined : degrees(o.rotation) })

/** A rectangle, `width` along x and `height` along y, centered. */
export class Rectangle extends Sketch {
  declare readonly parameters: { readonly width: number; readonly height: number } & CornerOptions & SketchPlacement

  constructor(width = 1, height = 1, options: CornerOptions & SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { width, height, ...options }
    setKernel(this, call(() => sm.Rectangle(width, height, { fillet: options.fillet, chamfer: options.chamfer, ...turned(options) })))
  }
}

/** A circle around the origin. */
export class Circle extends Sketch {
  declare readonly parameters: { readonly radius: number; readonly align?: Align2 }

  constructor(radius = 1, options: { align?: Align2 } = {}) {
    super()
    if (internal(this)) return
    this.parameters = { radius, align: options.align }
    setKernel(this, call(() => sm.Circle(radius, { align: align2(options.align) })))
  }
}

/** An ellipse around the origin, `xRadius` along x. */
export class Ellipse extends Sketch {
  declare readonly parameters: { readonly xRadius: number; readonly yRadius: number } & SketchPlacement

  constructor(xRadius = 1, yRadius = 0.5, options: SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { xRadius, yRadius, ...options }
    setKernel(this, call(() => sm.Ellipse(xRadius, yRadius, turned(options))))
  }
}

/** A polygon through `points` (the sketch's 2D coordinates; closed by itself). */
export class Polygon extends Sketch {
  declare readonly parameters: { readonly points: readonly THREE.Vector2Like[] } & CornerOptions & { readonly align?: Align2 }

  constructor(points: readonly THREE.Vector2Like[] = [], options: CornerOptions & { align?: Align2 } = {}) {
    super()
    if (internal(this) || !points.length) return
    this.parameters = { points: points.map((p) => ({ x: p.x, y: p.y })), ...options }
    setKernel(this, call(() => sm.Polygon(points.map(vec2), { fillet: options.fillet, chamfer: options.chamfer, align: align2(options.align) })))
  }
}

/** A regular polygon of `sides` sides around a circle of `radius` (its corners on it; `inscribed:
 * false`: its sides touch it). */
export class RegularPolygon extends Sketch {
  declare readonly parameters: { readonly radius: number; readonly sides: number; readonly inscribed?: boolean } & CornerOptions & SketchPlacement

  constructor(radius = 1, sides = 6, options: { inscribed?: boolean } & CornerOptions & SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { radius, sides, ...options }
    setKernel(this, call(() => sm.RegularPolygon(radius, sides, { inscribed: options.inscribed, fillet: options.fillet, chamfer: options.chamfer, ...turned(options) })))
  }
}

/** A slot: `length` overall along x, `width` across, with round ends. */
export class Slot extends Sketch {
  declare readonly parameters: { readonly length: number; readonly width: number } & SketchPlacement

  constructor(length = 2, width = 1, options: SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { length, width, ...options }
    setKernel(this, call(() => sm.Slot(length, width, turned(options))))
  }
}

/** Options of Text. */
export interface TextOptions {
  /** A font file's contents (TTF, OTF, WOFF, WOFF2); default: the kernel's own font. */
  font?: ArrayBuffer | Uint8Array | null
  align?: Align2
  /** Extra space between letters, in units of the size. */
  spacing?: number
  lineSpacing?: number
  kerning?: boolean
}

/** Text as a sketch: its letters' outlines, `size` high, along x. */
export class Text extends Sketch {
  declare readonly parameters: { readonly text: string; readonly size: number } & TextOptions

  constructor(text = '', size = 10, options: TextOptions = {}) {
    super()
    if (internal(this) || !text) return
    this.parameters = { text, size, ...options }
    const font = options.font instanceof ArrayBuffer ? new Uint8Array(options.font) : options.font
    setKernel(this, call(() => sm.Text(text, size, { font, align: align2(options.align), spacing: options.spacing, lineSpacing: options.lineSpacing, kerning: options.kerning })))
  }
}
