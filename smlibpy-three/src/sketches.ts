// smlibpy's sketch shapes as Sketch subclasses. They are drawn in the sketch's own 2D coordinates
// (x, y), which lie on the ground of the sketch's frame (three's XZ plane, its y along -z), as
// smlibpy's lie on its XY plane; angles are radians, counterclockwise seen from above. Shapes made
// from other shapes (Stroke, Hull, makeFace, Text along a path) take them where they are. Any
// outline three can draw (a THREE.Shape with holes) is a Sketch too: `new Sketch(shape)`; an outline
// drawn segment by segment is a Profile's.
import type * as THREE from 'three'
import { align2, call, degrees, describe, sm, vec, vec2 } from './kernel.ts'
import type { Align2 } from './types.ts'
import { Body, Edge, Face, internal, isObject3D, operand, pathOf, setKernel, Sketch, toThree, Vertex, Wire } from './shapes.ts'
import { Font, kernelFont } from './font.ts'

/** Corners rounded (`fillet`, a radius) or cut (`chamfer`, a length along each side); not both. */
export interface CornerOptions {
  fillet?: number
  chamfer?: number
}

/** Where the shape lies and how it is turned: `rotation`, radians counterclockwise (seen from above)
 * about its center; then `align`, its 'min' side, 'center' or 'max' side at the origin, per axis of
 * the sketch ({ x, y }) or one value for both. */
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

/** A rectangle with its corners rounded by `radius`, `width` along x and `height` along y, centered:
 * the same as `new Rectangle(width, height, { fillet: radius })`. */
export class RoundedRectangle extends Sketch {
  declare readonly parameters: { readonly width: number; readonly height: number; readonly radius: number; readonly align?: Align2 }

  constructor(width = 1, height = 1, radius = 0.25, options: { align?: Align2 } = {}) {
    super()
    if (internal(this)) return
    this.parameters = { width, height, radius, align: options.align }
    setKernel(this, call(() => sm.RoundedRectangle(width, height, radius, { align: align2(options.align) })))
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

/** An ellipse around the origin, `xRadius` along x and `yRadius` along y. */
export class Ellipse extends Sketch {
  declare readonly parameters: { readonly xRadius: number; readonly yRadius: number } & SketchPlacement

  constructor(xRadius = 1, yRadius = 0.5, options: SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { xRadius, yRadius, ...options }
    setKernel(this, call(() => sm.Ellipse(xRadius, yRadius, turned(options))))
  }
}

/** A point of a sketch: a THREE.Vector2 (or { x, y }) of its own 2D coordinates on the ground, or a
 * THREE.Vector3 (or { x, y, z }) of three's. */
export type SketchPoint = THREE.Vector2Like | THREE.Vector3Like

const isPoint3 = (p: unknown): p is THREE.Vector3Like => typeof (p as { z?: unknown } | null)?.z === 'number'

/** A sketch's point as the kernel's: its 2D coordinates on the kernel's XY plane, or three's point. */
const sketchPoint = (p: SketchPoint): sm.Vector => (isPoint3(p) ? vec(p) : vec2(p))

/** A point of a sketch drawn on the ground as the kernel's on its XY plane (a THREE.Vector3 must lie
 * on the ground: its -z is the sketch's y). */
function groundPoint(p: SketchPoint, what: string): sm.Vector {
  if (!isPoint3(p)) return vec2(p)
  if (Math.abs(p.y) > 1e-9 * Math.max(1, Math.abs(p.x), Math.abs(p.z))) {
    throw new RangeError(`${what}: the point (${p.x}, ${p.y}, ${p.z}) is off the ground (y = 0), where the sketch is drawn; place the sketch with its transform or on()`)
  }
  return vec2({ x: p.x, y: 0 - p.z })
}

/** A polygon through `points` (closed by itself): THREE.Vector2s of the sketch's 2D coordinates, or
 * THREE.Vector3s of three's on the ground. The points stay where they are unless `align` is given. */
export class Polygon extends Sketch {
  declare readonly parameters: { readonly points: readonly SketchPoint[] } & CornerOptions & { readonly align?: Align2 }

  constructor(points: readonly SketchPoint[] = [], options: CornerOptions & { align?: Align2 } = {}) {
    super()
    if (internal(this) || !points.length) return
    this.parameters = { points: points.map((p) => (isPoint3(p) ? { x: p.x, y: p.y, z: p.z } : { x: p.x, y: p.y })), ...options }
    const pts = points.map((p) => groundPoint(p, 'Polygon'))
    setKernel(this, call(() => sm.Polygon(pts, { fillet: options.fillet, chamfer: options.chamfer, align: align2(options.align) })))
  }
}

/** A regular polygon of `sides` sides around the origin, its corners on a circle of `radius`
 * (`inscribed`: the middles of its sides on it, so that `radius` is half the width across flats). */
export class RegularPolygon extends Sketch {
  declare readonly parameters: { readonly radius: number; readonly sides: number; readonly inscribed?: boolean } & CornerOptions & SketchPlacement

  constructor(radius = 1, sides = 6, options: { inscribed?: boolean } & CornerOptions & SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { radius, sides, ...options }
    setKernel(this, call(() => sm.RegularPolygon(radius, sides, { inscribed: options.inscribed, fillet: options.fillet, chamfer: options.chamfer, ...turned(options) })))
  }
}

/** A triangle: a base `width` long along x and its top corner `height` above it along y, centered
 * on its bounding box. `apex` is the top corner's x from the left end of the base: the middle by
 * default (an isosceles triangle), 0 for a right angle at the left end, `width` for one at the right. */
export class Triangle extends Sketch {
  declare readonly parameters: { readonly width: number; readonly height: number; readonly apex?: number | null } & CornerOptions & SketchPlacement

  constructor(width = 1, height = 1, options: { apex?: number | null } & CornerOptions & SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { width, height, ...options }
    setKernel(this, call(() => sm.Triangle(width, height, { apex: options.apex, fillet: options.fillet, chamfer: options.chamfer, ...turned(options) })))
  }
}

/** Options of Trapezoid. */
export type TrapezoidOptions = CornerOptions & SketchPlacement

/**
 * A trapezoid, centered: a base `width` long along x, `height` high along y, its sides at
 * `leftAngle` and `rightAngle` to the base (radians, inside the base's corners; `rightAngle` is
 * `leftAngle` unless given). The options may follow `leftAngle`:
 * `new Trapezoid(40, 15, Math.PI / 3, { fillet: 2 })`.
 */
export class Trapezoid extends Sketch {
  declare readonly parameters: { readonly width: number; readonly height: number; readonly leftAngle: number; readonly rightAngle: number | null } & TrapezoidOptions

  constructor(width = 2, height = 1, leftAngle = Math.PI / 3, rightAngle: number | null | TrapezoidOptions = null, options: TrapezoidOptions = {}) {
    super()
    if (internal(this)) return
    if (rightAngle !== null && typeof rightAngle === 'object') {
      options = rightAngle
      rightAngle = null
    }
    this.parameters = { width, height, leftAngle, rightAngle, ...options }
    const right = rightAngle === null ? null : degrees(rightAngle)
    setKernel(this, call(() => sm.Trapezoid(width, height, degrees(leftAngle), right, { fillet: options.fillet, chamfer: options.chamfer, ...turned(options) })))
  }
}

/** A slot: `length` overall along x (round ends included), `width` across, centered. For a slot
 * between two centers use `new Stroke(new Line(a, b), width)`; along an arc, ArcSlot. */
export class Slot extends Sketch {
  declare readonly parameters: { readonly length: number; readonly width: number } & SketchPlacement

  constructor(length = 2, width = 1, options: SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { length, width, ...options }
    setKernel(this, call(() => sm.Slot(length, width, turned(options))))
  }
}

/** A slot along an arc around the origin: its centerline, of `radius`, runs over `angle` radians from
 * +x (turned by `rotation`), counterclockwise seen from above; `width` wide, with round ends. The
 * arc's center stays on the origin unless `align` is given. */
export class ArcSlot extends Sketch {
  declare readonly parameters: { readonly radius: number; readonly width: number; readonly angle: number } & SketchPlacement

  constructor(radius = 1, width = 0.25, angle = Math.PI / 2, options: SketchPlacement = {}) {
    super()
    if (internal(this)) return
    this.parameters = { radius, width, angle, ...options }
    setKernel(this, call(() => sm.ArcSlot(radius, width, degrees(angle), turned(options))))
  }
}

/** Options of Stroke. */
export interface StrokeOptions {
  /** The ends of an open path: 'round' (half circles, the default) or 'flat' (cut square at its ends). */
  ends?: 'round' | 'flat'
  /** The outside of its bends: 'round' (the default), 'sharp' or 'chamfer'. */
  corners?: 'round' | 'sharp' | 'chamfer'
}

/**
 * The region a pen `width` wide covers along `path`: a slot between two centers
 * (`new Stroke(new Line(a, b), 6)`), a slot along an arc, a rib from its centerline, a groove along a
 * spline; a ring along a closed path. The path is an Edge or Wire, taken where it is, or a
 * THREE.Curve in the stroke's frame; it lies in a plane, and so does the region. Lines and arcs give
 * exact lines and arcs, splines and ellipses their offsets (within 1e-6 of the path's size).
 */
export class Stroke extends Sketch {
  declare readonly parameters: { readonly path: Edge | Wire | THREE.Curve<THREE.Vector3>; readonly width: number } & StrokeOptions

  constructor(path: Edge | Wire | THREE.Curve<THREE.Vector3> | null = null, width = 1, options: StrokeOptions = {}) {
    super()
    if (internal(this) || path === null) return
    this.parameters = { path, width, ...options }
    const p = pathOf(path, null)
    setKernel(this, call(() => sm.Stroke(p, width, { ends: options.ends, corners: options.corners })))
  }
}

/** What Hull takes: points (THREE.Vector2s of the sketch's 2D coordinates on the ground, or
 * THREE.Vector3s of three's), vertices, edges, wires, sketches and faces, or lists of them. */
export type HullItem = SketchPoint | Vertex | Edge | Wire | Sketch | Face | Iterable<HullItem>

/**
 * The convex hull of points and shapes: the smallest convex region around them, as a string pulled
 * tight around them; around circles and arcs it follows the arcs exactly, joined by tangent lines
 * (`new Hull(new Circle(10), movedCircle)` is a lever's outline). Shapes are taken where they are.
 * The hull lies in the plane of the first sketch among them, else on the ground (y = 0): edges,
 * wires and faces off that plane are projected onto it, points must lie in it.
 */
export class Hull extends Sketch {
  declare readonly parameters: { readonly items: readonly HullItem[] }

  constructor(...items: HullItem[]) {
    super()
    if (internal(this) || !items.length) return
    this.parameters = { items }
    const given: unknown[] = []
    const add = (list: Iterable<unknown>) => {
      for (const it of list) {
        if (!isObject3D(it) && !isPoint(it) && it !== null && typeof it === 'object' && Symbol.iterator in it) add(it as Iterable<unknown>)
        else given.push(it)
      }
    }
    add(items)
    const kernel = given.map(hullItem)
    // (points off the hull's plane, named in three's coordinates)
    const sketch = kernel.find((k): k is sm.Sketch => k instanceof sm.Sketch)
    const plane = sketch?.plane ?? sm.Plane.XY
    kernel.forEach((k, i) => {
      if (!(k instanceof sm.Vector)) return
      if (Math.abs(plane.distanceTo(k)) > 1e-6 * Math.max(1, Math.abs(k.x), Math.abs(k.y), Math.abs(k.z))) {
        const p = given[i] as SketchPoint
        const at = isPoint3(p) ? `(${p.x}, ${p.y}, ${p.z})` : `(${p.x}, ${p.y}) of the ground`
        throw new RangeError(`Hull: the point ${at} is not in the plane of the hull (${sketch ? "the first sketch's" : 'the ground, y = 0'})`)
      }
    })
    setKernel(this, call(() => sm.Hull(...(kernel as sm.HullItem[]))))
  }
}

/** A point of a sketch ({ x, y }) or of three's ({ x, y, z }). */
function isPoint(v: unknown): boolean {
  const p = v as { x?: unknown; y?: unknown } | null
  return p !== null && typeof p === 'object' && !isObject3D(p) && typeof p.x === 'number' && typeof p.y === 'number'
}

function hullItem(item: unknown): unknown {
  if (item instanceof Sketch || item instanceof Face || item instanceof Edge || item instanceof Wire || item instanceof Vertex) return operand(item, null, 'Hull')
  if (isPoint(item)) return sketchPoint(item as SketchPoint)
  if (item instanceof Body) throw new TypeError(`Hull: ${describe(item)} has no outline in a plane; give a section of it (part.section(plane)) or one of its faces`)
  throw new TypeError(`Hull: give points, vertices, edges, wires, sketches or faces, not ${describe(item)}`)
}

/**
 * The planar region inside a closed wire or edge (`outer`), less the regions inside `holes`: closed
 * curves made a sketch (a Polyline with `close`, a closed Spline, a face's outline). The holes are
 * taken where they are; the result is in `outer`'s frame and placed as it is, as `wire.toSketch()`.
 */
export function makeFace(outer: Wire | Edge, ...holes: (Wire | Edge)[]): Sketch {
  for (const c of [outer, ...holes]) {
    if (!(c instanceof Wire || c instanceof Edge)) throw new TypeError(`makeFace: give closed wires or edges, not ${describe(c)}`)
  }
  const o = operand(outer, outer, 'makeFace') as sm.Wire | sm.Edge
  const h = holes.map((x) => operand(x, outer, 'makeFace') as sm.Wire | sm.Edge)
  return toThree(call(() => sm.makeFace(o, ...h)), outer) as Sketch
}

/** Options of Text. */
export interface TextOptions {
  /** The font: a Font (`loadFont(bytes)`), or the bytes of a font file (TTF, OTF, TTC, WOFF, WOFF2:
   * an ArrayBuffer or a Uint8Array). Default: the built-in Lato Regular. */
  font?: Font | ArrayBuffer | ArrayBufferView | null
  /**
   * Where the text's layout box goes (from the start to the end of the longest line, from the last
   * baseline to the cap height of the first line), per axis of the sketch or one value for both:
   * 'center' (the default) centers it on the origin; 'min' starts the text at x = 0 with the last
   * baseline on y = 0; 'max' ends it at x = 0 with the first cap height on y = 0; null starts it at
   * the origin, on the first baseline. A block's lines are aligned alike (left, centered, right).
   * Along a `path`, x places the text along it ('min': at its start) and y across it ('min': the
   * baseline on the path, 'center': the middle of the capitals, 'max': their top).
   */
  align?: Align2 | null
  /** Extra distance between neighbouring letters, in model units (negative: closer). Default 0. */
  spacing?: number
  /** The distance between baselines, as a multiple of `size`. Default 1.6. */
  lineSpacing?: number
  /** Apply the font's kerning pairs (default true). */
  kerning?: boolean
  /**
   * A curve on the ground (y = 0) to set one line of text along: an Edge or Wire, taken where it is,
   * or a THREE.Curve in the text's frame. Each letter stands upright on it at the middle of its
   * advance, turned with its tangent (not bent): the text reads along the path and stands on its
   * left, seen from above, so a clockwise arc carries it over the top of a circle.
   */
  path?: Edge | Wire | THREE.Curve<THREE.Vector3> | null
}

/**
 * Text as a sketch: the exact outlines of a font's letters, lying on the ground and read from above
 * (along x, lines below each other along y). `size` is the height of the capital letters (H, E, T);
 * round letters overshoot it a little, descenders go below the baseline. "\n" starts a new line.
 * Straight parts are lines, curved runs B-splines through the font's own points; counters are holes
 * (an o is one face with a hole, an i two faces). A character the font lacks is a RangeError, a font
 * that cannot be read a FontError.
 */
export class Text extends Sketch {
  declare readonly parameters: { readonly text: string; readonly size: number } & TextOptions

  constructor(text = '', size = 10, options: TextOptions = {}) {
    super()
    if (internal(this) || !text) return
    this.parameters = { text, size, ...options }
    const f = options.font
    const font = f == null ? null : f instanceof Font ? kernelFont(f) : f
    const path = options.path == null ? null : onGround(pathOf(options.path, null))
    const align = options.align === undefined ? undefined : options.align === null ? null : align2(options.align)
    const o = { font, align, spacing: options.spacing, lineSpacing: options.lineSpacing, kerning: options.kerning, path }
    setKernel(this, call(() => sm.Text(text, size, o)))
  }
}

/** A text's path, if it lies on the ground of the text's frame (the kernel's XY plane). */
function onGround(path: sm.Edge | sm.Wire): sm.Edge | sm.Wire {
  const b = call(() => path.bbox())
  const flat = 1e-9 * Math.max(1, b.diagonal)
  if (Math.abs(b.min.z) > flat || Math.abs(b.max.z) > flat) {
    throw new RangeError("Text: the path must lie on the ground (y = 0) of the text's frame; draw it there, and place the text with its transform or on()")
  }
  return path
}
