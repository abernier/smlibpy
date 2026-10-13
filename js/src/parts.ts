// 3D primitives and hole tools.
//
// Primitives are centered on the origin by default; `align` changes that per axis. Hole tools
// point down (-Z) from the origin so that `part.cut(Hole(...).on(face))` drills into the face.

import { k, kernelCall } from './kernel.ts'
import { Align, type AlignLike, alignmentOffset } from './align.ts'
import { Plane, _radians } from './geometry.ts'
import { Part } from './shapes.ts'
import { Polygon } from './sketches.ts'

function _aligned(p: Part, align: AlignLike | undefined): Part {
  if (align == null || align === Align.CENTER) return p
  const off = alignmentOffset(p.bbox(), align)
  return off.length > 0 ? p.translate(off) : p
}

/** A box of `length` (X) by `width` (Y) by `height` (Z). */
export function Box(length: number, width: number, height: number, options: { align?: AlignLike } = {}): Part {
  if (Math.min(length, width, height) <= 0) throw new RangeError('box dimensions must be positive')
  const b = kernelCall('Box', () => k.create_box([-length / 2, -width / 2, -height / 2], Number(length), Number(width), Number(height)))
  return _aligned(Part._wrap(b), options.align ?? Align.CENTER)
}

/** A cylinder along Z. */
export function Cylinder(radius: number, height: number, options: { align?: AlignLike } = {}): Part {
  if (radius <= 0 || height <= 0) throw new RangeError('radius and height must be positive')
  const b = kernelCall('Cylinder', () => k.create_cylinder([0, 0, -height / 2], Number(radius), Number(height)))
  return _aligned(Part._wrap(b), options.align ?? Align.CENTER)
}

/** A cone (or frustum) along Z; one of the radii may be zero. */
export function Cone(bottomRadius: number, topRadius: number, height: number, options: { align?: AlignLike } = {}): Part {
  if (height <= 0 || bottomRadius < 0 || topRadius < 0 || (bottomRadius === 0 && topRadius === 0)) throw new RangeError('invalid cone dimensions')
  const b = kernelCall('Cone', () => k.create_cone([0, 0, -height / 2], Number(bottomRadius), Number(topRadius), Number(height)))
  return _aligned(Part._wrap(b), options.align ?? Align.CENTER)
}

/** A sphere. */
export function Sphere(radius: number, options: { align?: AlignLike } = {}): Part {
  if (radius <= 0) throw new RangeError('radius must be positive')
  const b = kernelCall('Sphere', () => k.create_sphere([0, 0, 0], Number(radius)))
  return _aligned(Part._wrap(b), options.align ?? Align.CENTER)
}

/** A torus around Z. */
export function Torus(majorRadius: number, minorRadius: number, options: { align?: AlignLike } = {}): Part {
  if (minorRadius <= 0 || majorRadius <= minorRadius) throw new RangeError('need 0 < minorRadius < majorRadius')
  const b = kernelCall('Torus', () => k.create_torus([0, 0, 0], Number(majorRadius), Number(minorRadius)))
  return _aligned(Part._wrap(b), options.align ?? Align.CENTER)
}

/** A ramp: a `length` (X) by `width` (Y) base whose high side, `height` tall, is the face at
 * x = -length/2; the slope runs down towards +X. `topLength` gives a flat top of that length,
 * measured from the -X end. */
export function Wedge(length: number, width: number, height: number, topLength = 0, options: { align?: AlignLike } = {}): Part {
  if (!(length > 0 && width > 0 && height > 0)) throw new RangeError('wedge length, width and height must be positive')
  if (!(topLength >= 0 && topLength < length)) throw new RangeError('wedge topLength must be at least 0 and less than the length')
  const pts: [number, number][] =
    topLength > 0
      ? [[-length / 2, 0], [length / 2, 0], [-length / 2 + topLength, height], [-length / 2, height]]
      : [[-length / 2, 0], [length / 2, 0], [-length / 2, height]]
  const profile = Polygon(...pts).on(Plane.XZ)
  const part = profile.extrude(width / 2, { both: true }).translate(0, 0, -height / 2)
  return _aligned(part, options.align ?? Align.CENTER)
}

/** A drilling tool: a cylinder from the origin down to `-depth`. */
export function Hole(radius: number, depth: number): Part {
  return Cylinder(radius, depth, { align: [Align.CENTER, Align.CENTER, Align.MAX] })
}

/** A drilling tool with a counterbore at the top. */
export function CounterBoreHole(radius: number, counterBoreRadius: number, counterBoreDepth: number, depth: number): Part {
  return Hole(radius, depth).fuse(Hole(counterBoreRadius, counterBoreDepth))
}

/** A drilling tool with a conical countersink of included `angle` at the top. */
export function CounterSinkHole(radius: number, counterSinkRadius: number, depth: number, angle = 82): Part {
  const h = (counterSinkRadius - radius) / Math.tan(_radians(angle / 2))
  const sink = Cone(radius, counterSinkRadius, h, { align: [Align.CENTER, Align.CENTER, Align.MAX] })
  return Hole(radius, depth).fuse(sink)
}
