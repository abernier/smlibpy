// 3D primitives and hole tools.
//
// Primitives are centered on the origin by default; `align` changes that per axis. Hole tools
// point down (-Z) from the origin so that `part.cut(Hole(...).on(face))` drills into the face.

import { _opts, k, kernelCall, scope } from './kernel.ts'
import { Align, type AlignLike, alignmentOffset } from './align.ts'
import { Plane, Z, _radians } from './geometry.ts'
import { Line, ThreePointArc } from './curves.ts'
import { type Edge, Part, WHOLE_TURN, Wire } from './shapes.ts'
import { Circle, Polygon, makeFace } from './sketches.ts'

/** `p` aligned by its bounding box. The whole primitives are made centered; a `partial` one (a
 * sector) is made as the sector of the centered whole one, and centered by its own box. */
function _aligned(p: Part, align: AlignLike | undefined, partial = false): Part {
  if (align == null || (!partial && align === Align.CENTER)) return p
  const off = alignmentOffset(p.bbox(), align)
  return off.length > 0 ? p.translate(off) : p
}

/** The angle of a sector (degrees), null for a whole turn: within 0.01 degrees of 360 (as revolve:
 * the kernel's sectors between 359.99 and 360 are not closed solids). */
function _arc(arcSize: number, what: string, name = 'arcSize'): number | null {
  const a = Number(arcSize)
  if (!(a > 0 && a <= 360 + 1e-9)) throw new RangeError(`${what}: ${name} must be more than 0 and at most 360 degrees, got ${arcSize}`)
  return a > 360 - WHOLE_TURN ? null : a
}

// `align` as given: null keeps the frame it is made in, undefined is the default (centered).
function _align(options: { align?: AlignLike }): AlignLike | undefined {
  return options.align === undefined ? Align.CENTER : (options.align ?? undefined)
}

/** A box of `length` (X) by `width` (Y) by `height` (Z). */
export function Box(length: number, width: number, height: number, options: { align?: AlignLike } = {}): Part {
  return scope(() => {
    _opts('Box', options, arguments.length)
    if (Math.min(length, width, height) <= 0) throw new RangeError('box dimensions must be positive')
    const b = kernelCall('Box', () => k.create_box([-length / 2, -width / 2, -height / 2], Number(length), Number(width), Number(height)))
    return _aligned(Part._wrap(b), options.align ?? Align.CENTER)
  })
}

/**
 * A cylinder along Z.
 *
 * `arcSize` (degrees, at most 360) makes a sector: the part of the cylinder from the +X axis
 * counter-clockwise about +Z (planes on its two sides). Like every primitive it is centered by its
 * bounding box, so a sector's axis moves off Z; `align: null` keeps it on Z (the sector of the
 * centered cylinder).
 */
export function Cylinder(radius: number, height: number, options: { arcSize?: number; align?: AlignLike } = {}): Part {
  return scope(() => {
    _opts('Cylinder', options, arguments.length)
    if (radius <= 0 || height <= 0) throw new RangeError('radius and height must be positive')
    const a = _arc(options.arcSize ?? 360, 'Cylinder')
    const b = kernelCall('Cylinder', () =>
      a === null
        ? k.create_cylinder([0, 0, -height / 2], Number(radius), Number(height))
        : k.create_partial_cylinder([0, 0, -height / 2], Number(radius), Number(height), 0, a),
    )
    return _aligned(Part._wrap(b), _align(options), a !== null)
  })
}

/** A cone (or frustum) along Z; one of the radii may be zero. `arcSize` makes a sector, as for
 * `Cylinder`. */
export function Cone(
  bottomRadius: number,
  topRadius: number,
  height: number,
  options: { arcSize?: number; align?: AlignLike } = {},
): Part {
  return scope(() => {
    _opts('Cone', options, arguments.length)
    if (height <= 0 || bottomRadius < 0 || topRadius < 0 || (bottomRadius === 0 && topRadius === 0)) throw new RangeError('invalid cone dimensions')
    const a = _arc(options.arcSize ?? 360, 'Cone')
    const b = kernelCall('Cone', () =>
      a === null
        ? k.create_cone([0, 0, -height / 2], Number(bottomRadius), Number(topRadius), Number(height))
        : k.create_partial_cone([0, 0, -height / 2], Number(bottomRadius), Number(topRadius), Number(height), 0, a),
    )
    return _aligned(Part._wrap(b), _align(options), a !== null)
  })
}

/**
 * A sphere, or a part of one.
 *
 * `arcSize1` and `arcSize2` are the latitudes (degrees, -90 at the bottom pole to 90 at the top) it
 * reaches from and to: planes parallel to XY cut it there. `arcSize3` (at most 360) is the longitude
 * it spans, from the +X axis counter-clockwise about +Z (planes through the Z axis on its sides). A
 * part of a sphere is centered by its bounding box; `align: null` keeps the sphere's center at the
 * origin.
 */
export function Sphere(
  radius: number,
  options: { arcSize1?: number; arcSize2?: number; arcSize3?: number; align?: AlignLike } = {},
): Part {
  return scope(() => {
    _opts('Sphere', options, arguments.length)
    if (radius <= 0) throw new RangeError('radius must be positive')
    const lo = Number(options.arcSize1 ?? -90)
    const hi = Number(options.arcSize2 ?? 90)
    if (!(-90 <= lo && lo < hi && hi <= 90)) {
      throw new RangeError(`Sphere: need -90 <= arcSize1 < arcSize2 <= 90 (latitudes in degrees), got ${options.arcSize1 ?? -90} and ${options.arcSize2 ?? 90}`)
    }
    const a = _arc(options.arcSize3 ?? 360, 'Sphere', 'arcSize3')
    if (lo > -90 || hi < 90) return _aligned(_zone(Number(radius), lo, hi, a), _align(options), true)
    const b = kernelCall('Sphere', () =>
      a === null ? k.create_sphere([0, 0, 0], Number(radius)) : k.create_partial_sphere([0, 0, 0], Number(radius), 0, a),
    )
    return _aligned(Part._wrap(b), _align(options), a !== null)
  })
}

/** The part of a sphere between two latitudes (degrees), over `arc` of longitude (null: all of it):
 * its section on the +X side of the XZ plane revolved about Z (a sphere, planar ends). */
function _zone(radius: number, lo: number, hi: number, arc: number | null): Part {
  const at = (deg: number): [number, number] => {
    if (deg <= -90) return [0, -radius]
    if (deg >= 90) return [0, radius]
    const t = _radians(deg)
    return [radius * Math.cos(t), radius * Math.sin(t)]
  }
  const [x0, z0] = at(lo)
  const [x1, z1] = at(hi)
  const edges: Edge[] = [ThreePointArc([x0, z0], at((lo + hi) / 2), [x1, z1])]
  if (x1 > 0) edges.push(Line([x1, z1], [0, z1]))
  edges.push(Line([0, z1], [0, z0]))
  if (x0 > 0) edges.push(Line([0, z0], [x0, z0]))
  return makeFace(new Wire(edges)).on(Plane.XZ).revolve(Z, arc ?? 360)
}

/** A torus around Z. `majorAngle` (degrees, at most 360) makes a sector of it, from the +X axis
 * counter-clockwise about +Z, with round ends; it is centered by its bounding box (`align: null`
 * keeps the torus's center at the origin). */
export function Torus(majorRadius: number, minorRadius: number, options: { majorAngle?: number; align?: AlignLike } = {}): Part {
  return scope(() => {
    _opts('Torus', options, arguments.length)
    if (minorRadius <= 0 || majorRadius <= minorRadius) throw new RangeError('need 0 < minorRadius < majorRadius')
    const a = _arc(options.majorAngle ?? 360, 'Torus', 'majorAngle')
    if (a !== null) {
      // (the kernel's partial torus is a surface of revolution; the revolve gives a torus)
      const part = Circle(Number(minorRadius)).translate(Number(majorRadius), 0).on(Plane.XZ).revolve(Z, a)
      return _aligned(part, _align(options), true)
    }
    const b = kernelCall('Torus', () => k.create_torus([0, 0, 0], Number(majorRadius), Number(minorRadius)))
    return _aligned(Part._wrap(b), _align(options))
  })
}

/** A ramp: a `length` (X) by `width` (Y) base whose high side, `height` tall, is the face at
 * x = -length/2; the slope runs down towards +X. `topLength` gives a flat top of that length,
 * measured from the -X end. */
export function Wedge(length: number, width: number, height: number, topLength = 0, options: { align?: AlignLike } = {}): Part {
  return scope(() => {
    _opts('Wedge', options, arguments.length)
    if (!(length > 0 && width > 0 && height > 0)) throw new RangeError('wedge length, width and height must be positive')
    if (!(topLength >= 0 && topLength < length)) throw new RangeError('wedge topLength must be at least 0 and less than the length')
    const pts: [number, number][] =
      topLength > 0
        ? [[-length / 2, 0], [length / 2, 0], [-length / 2 + topLength, height], [-length / 2, height]]
        : [[-length / 2, 0], [length / 2, 0], [-length / 2, height]]
    const profile = Polygon(...pts).on(Plane.XZ)
    const part = profile.extrude(width / 2, { both: true }).translate(0, 0, -height / 2)
    return _aligned(part, options.align ?? Align.CENTER)
  })
}

/** A sector of a tube along Z: between `innerRadius` and `outerRadius` from the Z axis, `height`
 * tall, `arcSize` degrees (at most 360: a whole tube) from the +X axis counter-clockwise about +Z. An
 * `innerRadius` of 0 gives a sector of a cylinder. Centered by its bounding box; `align: null` keeps
 * the axis on Z (z from -height/2 to height/2). */
export function AnnularSector(
  innerRadius: number,
  outerRadius: number,
  height: number,
  arcSize: number,
  options: { align?: AlignLike } = {},
): Part {
  return scope(() => {
    _opts('AnnularSector', options, arguments.length)
    if (!(innerRadius >= 0 && innerRadius < outerRadius && height > 0)) {
      throw new RangeError('AnnularSector: need 0 <= innerRadius < outerRadius and a positive height')
    }
    const a = _arc(arcSize, 'AnnularSector')
    if (innerRadius === 0) return Cylinder(outerRadius, height, { arcSize, align: options.align })
    // The section revolved (cylinders and planes). The kernel's cylindrical box makes the same body, but
    // does not return for a whole turn, and its cylinders (SmCylinder) go to STEP files as B-splines.
    const h = height / 2
    const section = Polygon([innerRadius, -h], [outerRadius, -h], [outerRadius, h], [innerRadius, h]).on(Plane.XZ)
    return _aligned(section.revolve(Z, a ?? 360), _align(options), a !== null)
  })
}

/** A drilling tool: a cylinder from the origin down to `-depth`. */
export function Hole(radius: number, depth: number): Part {
  return scope(() => {
    return Cylinder(radius, depth, { align: [Align.CENTER, Align.CENTER, Align.MAX] })
  })
}

/** A drilling tool with a counterbore at the top. */
export function CounterBoreHole(radius: number, counterBoreRadius: number, counterBoreDepth: number, depth: number): Part {
  return scope(() => {
    return Hole(radius, depth).fuse(Hole(counterBoreRadius, counterBoreDepth))
  })
}

/** A drilling tool with a conical countersink of included `angle` at the top. */
export function CounterSinkHole(radius: number, counterSinkRadius: number, depth: number, angle = 82): Part {
  return scope(() => {
    const h = (counterSinkRadius - radius) / Math.tan(_radians(angle / 2))
    const sink = Cone(radius, counterSinkRadius, h, { align: [Align.CENTER, Align.CENTER, Align.MAX] })
    return Hole(radius, depth).fuse(sink)
  })
}
