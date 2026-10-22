// 2D constructors. Every sketch is built in the world XY plane, centered on the origin unless
// `align` says otherwise; place it with `.on(...)`, `plane.mul(sketch)` or `Pos(...).mul(sketch)`.
//
// The shapes share their option names: `rotation` (degrees counterclockwise about the shape's
// center), `align`, and for shapes with corners `fillet` (round every corner with this radius) and
// `chamfer` (bevel every corner by this length). Outlines that are awkward as combinations of
// shapes are drawn with `Profile`.

import { _opts, ext, k, kernelCall, scope } from './kernel.ts'
import { Arc2, Complex, Corner, GeometryError, Line2, ONE, assemble, cis, cx, degrees, describe, fmt, radians, signedArea, simplify, type Seg } from './_planar.ts'
import { Align, _one, alignmentOffset, type AlignLike } from './align.ts'
import { CenterArc, Line, Polyline, _pts, _withOptions } from './curves.ts'
import { Location, Plane, Z, type Vector, type VectorLike } from './geometry.ts'
import { Edge, Sketch, Wire, _transformCurve } from './shapes.ts'
import { Frame, build, hull, stroke } from './_regions.ts'

/** Where a new shape sits and how it is turned. */
export interface PlacementOptions {
  /** Degrees counterclockwise about the shape's center. */
  rotation?: number
  /** Alignment relative to the origin (after the rotation). */
  align?: AlignLike
}

/** The corner options of the shapes with corners. */
export interface CornerOptions {
  /** Round every corner with this radius. */
  fillet?: number
  /** Bevel every corner by this length. */
  chamfer?: number
}

function _aligned(s: Sketch, align: AlignLike | undefined, defaultCentered = true): Sketch {
  if (align == null) return s
  if (typeof align === 'string') align = _one(align)
  if (align === Align.CENTER && defaultCentered) return s
  const off = alignmentOffset(s.bbox(), align, 2)
  if (off.length === 0) return s
  return s.translate(off)
}

function _fromCurves(curves: number[], align: AlignLike | undefined = Align.CENTER, defaultCentered = true): Sketch {
  let b: number
  try {
    b = kernelCall('sketch', () => k.create_planar_faces(curves))
  } catch (e) {
    for (const c of curves) ext.delete_curve(c) // (not consumed on failure)
    throw e
  }
  return _aligned(Sketch._wrap(b, { plane: Plane.XY }), align, defaultCentered)
}

function _cornerOptions(what: string, fillet: number, chamfer: number): Corner | null {
  if (fillet && chamfer) throw new RangeError(`${what}: give fillet or chamfer, not both`)
  if (fillet < 0 || chamfer < 0) throw new RangeError(`${what}: fillet and chamfer must not be negative`)
  if (fillet) return new Corner('fillet', Number(fillet), `fillet: ${fmt(fillet)}`)
  if (chamfer) return new Corner('chamfer', Number(chamfer), `chamfer: ${fmt(chamfer)}`)
  return null
}

/** The alignment asked for, or the default when the option is left out (null: none). */
function _align(options: { align?: AlignLike }, fallback: AlignLike): AlignLike {
  return options.align === undefined ? fallback : options.align
}

/** A straight-edged region through `pts` (rotated about the origin), its corners rounded or
 * beveled, with exact lines and arcs. */
function _polygonSketch(what: string, pts: readonly Complex[], options: CornerOptions & { rotation?: number } = {}): Sketch {
  const { fillet = 0.0, chamfer = 0.0, rotation = 0.0 } = options
  const corner = _cornerOptions(what, fillet, chamfer)
  const rot = rotation ? cis(radians(rotation)) : ONE
  const turned = pts.map((p) => p.mul(rot))
  let size = 1.0
  for (const p of turned) size = Math.max(size, p.abs())
  const tol = 1e-9 * size
  const clean = turned.filter((p, i) => p.sub(turned.at(i - 1)!).abs() > tol)
  if (clean.length < 3) throw new RangeError(`${what}: a polygon needs at least three distinct points`)
  let segs: Seg[] = clean.map((a, i) => new Line2(a, clean[(i + 1) % clean.length]))
  ;[segs] = simplify(segs, new Array<string>(segs.length).fill(''), true, tol)
  const area = signedArea(segs)
  if (Math.abs(area) <= tol * size) throw new RangeError(`${what}: the points lie on one line, so the polygon has no area`)
  if (area < 0) segs = segs.map((s) => s.reversed()).reverse()
  if (corner !== null) {
    const corners = new Map(segs.map((_, i) => [i, corner] as [number, Corner]))
    const named = segs
    try {
      ;[segs] = assemble(segs, new Array<string>(segs.length).fill(''), corners, true, tol, (i) => describe(named[i]))
    } catch (e) {
      if (!(e instanceof GeometryError)) throw e
      throw new RangeError(`${what}: ${e.message}`)
    }
    ;[segs] = simplify(segs, new Array<string>(segs.length).fill(''), true, tol)
  }
  return build([[segs, []]], new Frame(Plane.XY), null, what)
}

/**
 * A `width` (X) by `height` (Y) rectangle.
 *
 * `fillet` rounds the four corners with that radius, `chamfer` bevels them by that length (at most
 * half the shorter side). `rotation` turns it about its center (degrees counterclockwise); `align`
 * then works on the turned outline.
 */
export function Rectangle(width: number, height: number, options: CornerOptions & PlacementOptions = {}): Sketch {
  _opts('Rectangle', options, arguments.length)
  const { fillet = 0.0, chamfer = 0.0, rotation = 0.0 } = options
  const align = _align(options, Align.CENTER)
  if (width <= 0 || height <= 0) throw new RangeError('rectangle sides must be positive')
  _cornerOptions('Rectangle', fillet, chamfer)
  const limit = Math.min(width, height) / 2
  for (const [name, value] of [
    ['fillet', fillet],
    ['chamfer', chamfer],
  ] as const) {
    if (value > limit + 1e-12 * Math.max(1.0, limit)) {
      throw new RangeError(`Rectangle: ${name}: ${fmt(value)} is more than half the shorter side (${fmt(limit)})`)
    }
  }
  if (!(fillet || chamfer || rotation)) {
    const curves: number[] = kernelCall('Rectangle', () => k.create_rectangle([0.0, 0.0, 0.0], Number(width), Number(height)))
    return _fromCurves(curves, align)
  }
  const w = width / 2
  const h = height / 2
  const s = _polygonSketch('Rectangle', [cx(-w, -h), cx(w, -h), cx(w, h), cx(-w, h)], {
    fillet: Math.min(fillet, limit),
    chamfer: Math.min(chamfer, limit),
    rotation,
  })
  return _aligned(s, align)
}

/** A rectangle with rounded corners; the same as `Rectangle(width, height, { fillet: radius })`. */
export function RoundedRectangle(width: number, height: number, radius: number, options: { align?: AlignLike } = {}): Sketch {
  _opts('RoundedRectangle', options, arguments.length)
  const align = _align(options, Align.CENTER)
  if (radius <= 0) return Rectangle(width, height, { align })
  if (2 * radius > Math.min(width, height) + 1e-12) throw new RangeError('corner radius is larger than half the shorter side')
  return Rectangle(width, height, { fillet: radius, align })
}

/** A disk of `radius`. */
export function Circle(radius: number, options: { align?: AlignLike } = {}): Sketch {
  _opts('Circle', options, arguments.length)
  const align = _align(options, Align.CENTER)
  if (radius <= 0) throw new RangeError('radius must be positive')
  const c: number = kernelCall('Circle', () => k.create_circle([0.0, 0.0, 0.0], Number(radius)))
  return _fromCurves([c], align)
}

/** An ellipse with semi-axes `xRadius` and `yRadius`, turned by `rotation` degrees about its
 * center. */
export function Ellipse(xRadius: number, yRadius: number, options: PlacementOptions = {}): Sketch {
  _opts('Ellipse', options, arguments.length)
  const { rotation = 0.0 } = options
  const align = _align(options, Align.CENTER)
  if (!(xRadius > 0 && yRadius > 0)) throw new RangeError(`Ellipse: the radii must be positive (got ${xRadius}, ${yRadius})`)
  let c: number = kernelCall('Ellipse', () => k.create_ellipse([0.0, 0.0, 0.0], Number(xRadius), Number(yRadius)))
  if (rotation) c = _transformCurve(c, Location.about(Z, rotation)._m)
  return _fromCurves([c], align)
}

/** The options of `Polygon`: corners, and an alignment (none by default: the points stay where
 * they are). */
export interface PolygonOptions extends CornerOptions {
  align?: AlignLike
}

/**
 * The polygon through the points (closed automatically): `Polygon([0, 0], [40, 0], [0, 30])`, or
 * one list of points. Points stay where they are unless `align` is given. `fillet` rounds every
 * corner with that radius, `chamfer` bevels every corner by that length.
 */
export function Polygon(...args: (VectorLike | readonly VectorLike[] | PolygonOptions)[]): Sketch {
  return scope(() => {
    const { items, options } = _withOptions<PolygonOptions>(args)
    _opts('Polygon', options)
    const { fillet = 0.0, chamfer = 0.0 } = options
    const align = _align(options, null)
    const pts = _pts(items)
    if (pts.length < 3) throw new RangeError('a polygon needs at least three points')
    if (!(fillet || chamfer)) {
      const w = Polyline(...pts, { close: true })
      return _fromCurves(w._copyCurves(), align, false)
    }
    if (pts.some((p: Vector) => Math.abs(p.z) > 1e-9 * Math.max(1.0, Math.abs(p.x), Math.abs(p.y)))) {
      throw new RangeError('Polygon: corner options need 2D points (z = 0); place the sketch with .on(plane)')
    }
    const s = _polygonSketch(
      'Polygon',
      pts.map((p) => cx(p.x, p.y)),
      { fillet, chamfer },
    )
    return _aligned(s, align, false)
  })
}

/**
 * A regular polygon with `sides` corners.
 *
 * `radius` is the distance to the corners, or to the middle of the sides when `inscribed` is true
 * (handy for hexagons measured across flats: `radius = flats / 2`). `fillet` and `chamfer` round
 * or bevel every corner.
 */
export function RegularPolygon(
  radius: number,
  sides: number,
  options: { inscribed?: boolean } & CornerOptions & PlacementOptions = {},
): Sketch {
  return scope(() => {
    _opts('RegularPolygon', options, arguments.length)
    const { inscribed = false, fillet = 0.0, chamfer = 0.0, rotation = 0.0 } = options
    const align = _align(options, Align.CENTER)
    if (sides < 3) throw new RangeError('a polygon needs at least three sides')
    const r = inscribed ? radius / Math.cos(Math.PI / sides) : radius
    const pts: [number, number][] = []
    for (let i = 0; i < sides; i++) {
      pts.push([r * Math.cos(radians(rotation) + (2 * Math.PI * i) / sides), r * Math.sin(radians(rotation) + (2 * Math.PI * i) / sides)])
    }
    if (fillet || chamfer) {
      return _aligned(
        _polygonSketch(
          'RegularPolygon',
          pts.map(([x, y]) => cx(x, y)),
          { fillet, chamfer },
        ),
        align,
      )
    }
    return _aligned(Polygon(...pts), align)
  })
}

/**
 * A triangle with a base of `width` along X and its top corner `height` above it.
 *
 * `apex` is the x position of the top corner measured from the left end of the base: the middle by
 * default (an isosceles triangle), `0` for a right angle at the left end, `width` for one at the
 * right end. The triangle is centered on its bounding box; `fillet` and `chamfer` round or bevel
 * the three corners.
 */
export function Triangle(width: number, height: number, options: { apex?: number | null } & CornerOptions & PlacementOptions = {}): Sketch {
  return scope(() => {
    _opts('Triangle', options, arguments.length)
    const { apex = null, fillet = 0.0, chamfer = 0.0, rotation = 0.0 } = options
    const align = _align(options, Align.CENTER)
    if (!(width > 0 && height > 0)) throw new RangeError(`Triangle: width and height must be positive (got ${width}, ${height})`)
    const a = apex == null ? width / 2 : Number(apex)
    const xs = [0.0, width, a]
    const cx0 = (Math.min(...xs) + Math.max(...xs)) / 2
    const pts = [cx(-cx0, -height / 2), cx(width - cx0, -height / 2), cx(a - cx0, height / 2)]
    return _aligned(_polygonSketch('Triangle', pts, { fillet, chamfer, rotation }), align)
  })
}

/** The options of `Trapezoid`. */
export type TrapezoidOptions = CornerOptions & PlacementOptions

/**
 * A trapezoid with a base of `width`; the side angles are measured inside the base corners
 * (`rightAngle` defaults to `leftAngle`). `fillet` and `chamfer` round or bevel the four corners.
 * The options may follow `leftAngle` directly: `Trapezoid(40, 15, 60, { rotation: 90 })`.
 */
export function Trapezoid(
  width: number,
  height: number,
  leftAngle: number,
  rightAngle: number | null | TrapezoidOptions = null,
  options: TrapezoidOptions = {},
): Sketch {
  return scope(() => {
    if (rightAngle !== null && typeof rightAngle === 'object') {
      options = rightAngle
      rightAngle = null
    }
    _opts('Trapezoid', options, arguments.length)
    const { fillet = 0.0, chamfer = 0.0, rotation = 0.0 } = options
    const align = _align(options, Align.CENTER)
    const ra = rightAngle == null ? leftAngle : rightAngle
    for (const [name, ang] of [
      ['leftAngle', leftAngle],
      ['rightAngle', ra],
    ] as const) {
      if (!(0 < ang && ang < 180)) throw new RangeError(`Trapezoid: ${name} must be between 0 and 180 degrees (got ${ang})`)
    }
    if (!(width > 0 && height > 0)) throw new RangeError(`Trapezoid: width and height must be positive (got ${width}, ${height})`)
    const dl = height / Math.tan(radians(leftAngle))
    const dr = height / Math.tan(radians(ra))
    if (dl + dr >= width) throw new RangeError('the sides cross below the given height')
    const pts: [number, number][] = [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2 - dr, height / 2],
      [-width / 2 + dl, height / 2],
    ]
    if (fillet || chamfer || rotation) {
      return _aligned(
        _polygonSketch(
          'Trapezoid',
          pts.map(([x, y]) => cx(x, y)),
          { fillet, chamfer, rotation },
        ),
        align,
      )
    }
    return _aligned(Polygon(...pts), align)
  })
}

/** An obround slot `length` long overall (round ends included) and `width` wide, along X. For a
 * slot between two centers use `Stroke(Line(a, b), width)`; for one along an arc, `ArcSlot`. */
export function Slot(length: number, width: number, options: PlacementOptions = {}): Sketch {
  return scope(() => {
    _opts('Slot', options, arguments.length)
    const { rotation = 0.0 } = options
    const align = _align(options, Align.CENTER)
    if (length <= width) return Circle(width / 2, { align })
    const r = width / 2
    const a = length / 2 - r
    const edges: Edge[] = [Line([-a, -r], [a, -r]), CenterArc([a, 0], r, -90, 180), Line([a, r], [-a, r]), CenterArc([-a, 0], r, 90, 180)]
    let s = _fromCurves(Wire._raw(edges)._copyCurves(), Align.CENTER)
    if (rotation) s = s.rotate(Z, rotation)
    return _aligned(s, align)
  })
}

/**
 * A slot along an arc around the origin: its centerline has `radius` and runs counterclockwise
 * over `angle` degrees from the X axis (turned by `rotation`); it is `width` wide with round ends.
 * The arc's center stays on the origin unless `align` is given.
 */
export function ArcSlot(radius: number, width: number, angle: number, options: PlacementOptions = {}): Sketch {
  return scope(() => {
    _opts('ArcSlot', options, arguments.length)
    const { rotation = 0.0 } = options
    const align = _align(options, null)
    if (!(radius > 0 && width > 0)) throw new RangeError(`ArcSlot: radius and width must be positive (got ${radius}, ${width})`)
    const h = width / 2
    if (h >= radius) {
      throw new RangeError(`ArcSlot: a slot ${fmt(width)} wide needs a centerline radius above ${fmt(h)} (the inner edge would pass the center)`)
    }
    if (!(0 < angle && angle < 360)) throw new RangeError(`ArcSlot: the angle is between 0 and 360 degrees (got ${angle})`)
    const caps = 2 * degrees(Math.asin(h / radius))
    if (angle + caps >= 360 - 1e-9) {
      throw new RangeError(
        `ArcSlot: at radius ${fmt(radius)} and width ${fmt(width)} the round ends meet for angles above ${fmt(360 - caps)}; use a smaller angle, or a ring: Circle(r + w/2).cut(Circle(r - w/2))`,
      )
    }
    const a0 = radians(rotation)
    const sweep = radians(angle)
    const a1 = a0 + sweep
    const c0 = cis(a0).scale(radius)
    const c1 = cis(a1).scale(radius)
    const origin = cx(0.0, 0.0)
    const loop: Seg[] = [
      new Arc2(origin, radius + h, a0, sweep),
      new Arc2(c1, h, a1, Math.PI),
      new Arc2(origin, radius - h, a1, -sweep),
      new Arc2(c0, h, a0 + Math.PI, Math.PI),
    ]
    return _aligned(build([[loop, []]], new Frame(Plane.XY), null, 'ArcSlot'), align, false)
  })
}

/**
 * The region a pen `width` wide covers along a path of lines and arcs: a slot between two centers
 * (`Stroke(Line(a, b), 6)`), a slot along an arc, a rib from its centerline.
 *
 * `ends`: "round" (half circles, the default) or "flat" (cut square at the end points).
 * `corners`: how the outside of a bend is shaped, "round", "sharp" or "chamfer". A closed path
 * makes a ring. The path stays where it is (in its plane).
 */
export function Stroke(path: Edge | Wire, width: number, options: { ends?: string; corners?: string } = {}): Sketch {
  _opts('Stroke', options, arguments.length)
  const { ends = 'round', corners = 'round' } = options
  return stroke(path, Number(width), ends, corners)
}

/**
 * The convex hull of points and shapes: the smallest convex region around them, as if a string
 * were pulled tight around them. Around circles and arcs the outline follows the arcs exactly,
 * joined by tangent lines.
 *
 * `items`: points ([x, y], Vectors, Vertices), edges, wires, sketches or faces, or lists of them.
 * `Hull(Circle(10), Pos(60, 0).mul(Circle(6)))` is a lever outline.
 */
export function Hull(...items: unknown[]): Sketch {
  return scope(() => {
    return hull(items)
  })
}

/** The planar region inside a closed wire, minus the regions inside `holes`. */
export function makeFace(outer: Wire | Edge, ...holes: (Wire | Edge)[]): Sketch {
  const w = outer instanceof Wire ? outer : new Wire([outer])
  let s = Sketch._fromWires([w])
  for (const h of holes) s = s.cut(Sketch._fromWires([h instanceof Wire ? h : new Wire([h])], s.plane))
  return s
}
