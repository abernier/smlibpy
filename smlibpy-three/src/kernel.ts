// The boundary to the kernel: the only module that imports smlibwasm. Everything that goes into it
// or comes out of it passes through here. The kernel works in three's coordinates: a point (x, y, z)
// of three's is the kernel's (x, y, z), so values cross as they are, converted from three's types to
// the kernel's and back. Where smlibpy assumes Z up (its cylinders stand along Z, its `top()` is
// +Z), the package follows three's geometries instead; that is the modules' business, not this one's.
//
// The kernel works in degrees, three in radians: angles are converted here too.
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { FontError, KernelError, ModelingError } from './errors.ts'
import type { Align2, Align3, AlignValue } from './types.ts'

export { sm }

export type SmBody = sm.Part | sm.Shell | sm.Sketch
export type SmCurve = sm.Edge | sm.Wire

const DEG = 180 / Math.PI

/** Radians to the kernel's degrees. */
export const degrees = (radians: number): number => radians * DEG
/** The kernel's degrees to radians. */
export const radians = (degrees: number): number => degrees / DEG

/** A point or direction of three's as the kernel's vector. */
export function vec(v: THREE.Vector3Like): sm.Vector {
  checkVector(v)
  return new sm.Vector(v.x, v.y, v.z)
}

/** A point of a sketch (its own 2D coordinates) as the kernel's vector on its XY plane. */
export function vec2(v: THREE.Vector2Like): sm.Vector {
  if (v === null || typeof v !== 'object' || typeof v.x !== 'number' || typeof v.y !== 'number') {
    throw new TypeError(`a point of a sketch is a THREE.Vector2 (or { x, y }), not ${describe(v)}`)
  }
  return new sm.Vector(v.x, v.y, 0)
}

/** The kernel's vector as three's. */
export function vector3(v: sm.Vector, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return target.set(v.x, v.y, v.z)
}

function checkVector(v: unknown): void {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | null
  if (p === null || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') {
    throw new TypeError(`a point or direction is a THREE.Vector3 (or { x, y, z }), not ${describe(v)}`)
  }
}

/** three's transform (any affine matrix: moves, rotations, scales) as the kernel's. */
export function location(m: THREE.Matrix4): sm.Location {
  // (Matrix4 keeps its elements column by column; the kernel's Location takes rows)
  const e = m.elements
  return new sm.Location(Float64Array.of(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], e[3], e[7], e[11], e[15]))
}

/** The kernel's transform as three's. */
export function matrix4(l: sm.Location, target: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  const rows = l.matrix
  return target.set(...(rows.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
}

/**
 * three's plane as the kernel's: its point nearest the origin, its normal. A THREE.Plane keeps
 * the points on the side its normal points to, as three's clipping does; so does the kernel's
 * `split(plane)` by default ('above').
 */
export function plane(p: THREE.Plane): sm.Plane {
  if (!(p as { isPlane?: boolean })?.isPlane) throw new TypeError(`a plane is a THREE.Plane, not ${describe(p)}`)
  const o = p.coplanarPoint(new THREE.Vector3())
  return new sm.Plane(vec(o), null, vec(p.normal))
}

/** The kernel's plane as three's. */
export function threePlane(p: sm.Plane, target: THREE.Plane = new THREE.Plane()): THREE.Plane {
  return target.setFromNormalAndCoplanarPoint(vector3(p.zDir), vector3(p.origin))
}

/** three's ray as the kernel's axis. */
export function axis(r: THREE.Ray): sm.Axis {
  if (r === null || typeof r !== 'object' || typeof r.origin?.x !== 'number' || typeof r.direction?.x !== 'number') {
    throw new TypeError(`an axis is a THREE.Ray (origin and direction), not ${describe(r)}`)
  }
  return new sm.Axis(vec(r.origin), vec(r.direction))
}

/** The kernel's axis as three's ray. */
export function ray(a: sm.Axis, target: THREE.Ray = new THREE.Ray()): THREE.Ray {
  vector3(a.origin, target.origin)
  vector3(a.direction, target.direction)
  return target
}

/** The kernel's box as three's. */
export function box3(b: sm.BoundBox, target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
  target.min.set(b.min.x, b.min.y, b.min.z)
  target.max.set(b.max.x, b.max.y, b.max.z)
  return target
}

/** three's box as the kernel's. */
export function boundBox(b: THREE.Box3): sm.BoundBox {
  return new sm.BoundBox([b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z])
}

/** A per-axis alignment ({ x, y, z } or one value for all) as the kernel's [x, y, z] (an axis not
 * named is left as it is: null). */
export function align3(align: Align3 | undefined): sm.AlignLike | undefined {
  if (align === undefined) return undefined
  const each = typeof align === 'string' || align === null ? { x: align, y: align, z: align } : align
  return [each.x ?? null, each.y ?? null, each.z ?? null]
}

/** The offset that aligns a box as `align` says ({ x, y, z } or one value for all): per axis, its
 * 'min' side, 'center' or 'max' side to the origin; an axis not named stays as it is. */
export function alignment(box: THREE.Box3, align: Align3, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const each = typeof align === 'string' ? { x: align, y: align, z: align } : align
  const at = (a: AlignValue | undefined, lo: number, hi: number) => (a === 'min' ? -lo : a === 'max' ? -hi : a === 'center' ? -(lo + hi) / 2 : 0)
  return target.set(at(each.x, box.min.x, box.max.x), at(each.y, box.min.y, box.max.y), at(each.z, box.min.z, box.max.z))
}

/** A sketch's alignment as the kernel's [x, y] (an axis not named is left as it is: null). */
export function align2(align: Align2 | undefined): sm.AlignLike | undefined {
  if (align === undefined) return undefined
  if (typeof align === 'string') return [align, align]
  return [align.x ?? null, align.y ?? null]
}

// ---------------------------------------------------------------------------------------- errors
/** Runs a kernel call, and gives its errors as this package's. */
export function call<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    throw translate(e)
  }
}

export function translate(e: unknown): unknown {
  // (the kernel's errors are not passed on as causes: nothing of smlibwasm's leaves the package)
  if (e instanceof sm.KernelError) {
    return new KernelError(words(e.message), { operation: e.operation, status: e.status, hint: e.hint === null ? null : words(e.hint), trace: e.trace })
  }
  if (e instanceof sm.ModelingError) return new ModelingError(words(e.message))
  if (e instanceof sm.FontError) return new FontError(words(e.message))
  if (e instanceof RangeError || e instanceof TypeError) {
    const message = words(e.message)
    if (message !== e.message) return e instanceof RangeError ? new RangeError(message) : new TypeError(message)
  }
  return e
}

/**
 * An option smlibwasm renamed is not the package's (smlibwasm takes the old name for a release,
 * with a warning that names smlibwasm): a TypeError, as for an option it does not have. `renamed`
 * maps the old names to the new.
 */
export function refuseRenamed(name: string, options: unknown, renamed: Record<string, string>): void {
  if (options == null || typeof options !== 'object') return
  for (const [old, now] of Object.entries(renamed)) {
    if (Object.prototype.hasOwnProperty.call(options, old)) throw new TypeError(`${name}() got an unexpected option '${old}'; did you mean '${now}'?`)
  }
}

/**
 * The option `option` given where the options go is not the package's (smlibwasm takes it by
 * position for a release, with a warning that names smlibwasm): a TypeError, as for an argument
 * too many.
 */
export function refusePositional(name: string, options: unknown, option: string): void {
  if (options == null || (typeof options === 'object' && !Array.isArray(options))) return
  const method = name.slice(name.indexOf('.') + 1)
  throw new TypeError(`${name}() takes 0 positional arguments but 1 was given (${option} is an option: ${method}({ ${option}: ${JSON.stringify(options)} }))`)
}

/**
 * A message of the kernel's in the package's terms: its classes by the package's names (BrepFace,
 * Segment, Ball, ...) and three's types for its values, `on()` for its planes, and its angles in
 * radians. (Coordinates and axes need nothing: the kernel's are three's.)
 */
export function words(message: string): string {
  let m = message
  for (const [word, by] of NAMES) m = m.replace(word, by)
  if (!/degree|°/.test(m)) return m
  // angles: ranges first, then single values, then what they are said in; the value a message got,
  // where it speaks of degrees, was one too
  const angle = '(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)'
  m = m.replace(new RegExp(`\\b(between|from) ${angle} (and|to) ${angle} degrees`, 'g'), (_, w, a, and, b) => `${w} ${angleText(+a)} ${and} ${angleText(+b)} radians`)
  m = m.replace(new RegExp(`not tangentially \\(at most ${angle}\\)`, 'g'), (_, a) => `not tangentially (at most ${angleText(+a)} radians)`)
  m = m.replace(new RegExp(`${angle} ?degrees\\b`, 'g'), (_, a) => `${angleText(+a)} radians`)
  m = m.replace(new RegExp(`${angle}°`, 'g'), (_, a) => `${angleText(+a)} rad`)
  m = m.replace(/\b(a number of|a finite number of|an angle in|angles? in|latitudes in) degrees\b/g, '$1 radians').replace(/\(degrees\)/g, '(radians)')
  m = m.replace(new RegExp(`\\bgot ${angle}(?=\\)|,|$| and)`, 'g'), (_, a) => `got ${angleText(+a)}`)
  m = m.replace(new RegExp(`\\band ${angle}(?=\\))`, 'g'), (_, a) => `and ${angleText(+a)}`)
  return m
}

/** Kernel words and the package's: class names, value types, placements. */
const NAMES: readonly [RegExp, string][] = [
  [/(?<!THREE\.|Brep)\b(Face|Edge|Vertex)\b/g, 'Brep$1'],
  [/(?<!THREE\.)\bLine\b/g, 'Segment'],
  [/(?<!THREE\.)\bSphere\b/g, 'Ball'],
  [/(?<!THREE\.)\bTriangle\b/g, 'TriangleSketch'],
  [/(?<!THREE\.)\bFont\b/g, 'OpenTypeFont'],
  [/\b_Body\b/g, 'Body'],
  [/\ban Axis\b/g, 'a THREE.Ray'],
  [/\ba Plane\b/g, 'a THREE.Plane'],
  [/\ba Location\b/g, 'a THREE.Matrix4'],
  [/\ba Vector\b/g, 'a THREE.Vector3'],
  [/\.on\(Plane\.front\)/g, '.on(new THREE.Matrix4().makeRotationX(Math.PI / 2))'],
  [/\bnew Axis\(\[([^\]]*)\], \[([^\]]*)\]\)/g, 'new THREE.Ray(new THREE.Vector3($1), new THREE.Vector3($2))'],
  [/(?:with )?\.on\(plane\)/g, 'with its transform or on()'],
  [/\bpass plane:/g, 'pass frame:'],
  [/\braycast\b/g, 'intersectRay'],
  [/\bmajorAngle\b/g, 'arc'],
  [/\b([Aa])n (?=Brep|Segment|Ball|TriangleSketch)/g, '$1 '],
  [/\b([Aa]) (?=OpenTypeFont)/g, '$1n '],
]

/** An angle given in degrees, in radians: a multiple of π by name (π/2, 2π, -3π/4), else four digits. */
function angleText(deg: number): string {
  const r = deg / 180
  for (const n of [1, 2, 3, 4, 6, 8, 12]) {
    const k = Math.round(r * n)
    if (Math.abs(r * n - k) < 1e-9) {
      if (k === 0) return '0'
      const a = Math.abs(k)
      return `${k < 0 ? '-' : ''}${a === 1 ? '' : a}π${n === 1 ? '' : `/${n}`}`
    }
  }
  return String(+((deg * Math.PI) / 180).toPrecision(4))
}

/** @internal
 * Sends the kernel's warnings, in the package's words, to `handler` (null: console.warn). */
export function warnTo(handler: ((message: string) => void) | null): void {
  sm.setWarningHandler(handler === null ? (message: string) => console.warn(words(message)) : (message: string) => handler(words(message)))
}
warnTo(null)

// ----------------------------------------------------------------------------------- messages
/** `a Part`, `a number`, `null` for messages. */
export function describe(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'object' || typeof v === 'function') {
    const name = (v as { constructor?: { name?: string } }).constructor?.name || 'object'
    return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`
  }
  return `a ${typeof v}`
}
