// The boundary to the kernel: the only module that imports smlibwasm. Everything that goes into it
// or comes out of it passes through here, and with it the change of axes: three.js is Y up,
// smlibpy and smlibwasm are Z up. A point (x, y, z) of three's is the point (x, -z, y) of the
// kernel's, so a part the kernel builds standing on its XY plane stands on three's XZ plane, and
// the kernel's top (+Z) is three's top (+Y), its front (-Y) three's front (+Z, towards the default
// camera). The rotation is C (kernel to three) and its inverse; nothing else in the package knows
// about Z up.
//
// The kernel works in degrees, three in radians: angles are converted here too.
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { FontError, KernelError, ModelingError } from './errors.ts'
import type { Align2, Align3, AlignValue } from './types.ts'

export { sm }

export type SmBody = sm.Part | sm.Shell | sm.Sketch
export type SmCurve = sm.Edge | sm.Wire

/** The kernel's frame in three's: (x, y, z) to (x, z, -y). */
export const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
/** three's frame in the kernel's: (x, y, z) to (x, -z, y). */
export const C_INV = C.clone().transpose()

const DEG = 180 / Math.PI

/** Radians to the kernel's degrees. */
export const degrees = (radians: number): number => radians * DEG
/** The kernel's degrees to radians. */
export const radians = (degrees: number): number => degrees / DEG

/** A point or direction of three's as the kernel's vector. */
export function vec(v: THREE.Vector3Like): sm.Vector {
  checkVector(v)
  return new sm.Vector(v.x, 0 - v.z, v.y)
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
  return target.set(v.x, v.z, 0 - v.y)
}

function checkVector(v: unknown): void {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | null
  if (p === null || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') {
    throw new TypeError(`a point or direction is a THREE.Vector3 (or { x, y, z }), not ${describe(v)}`)
  }
}

/** three's transform (any affine matrix: moves, rotations, scales) as the kernel's: C⁻¹ · m · C. */
export function location(m: THREE.Matrix4): sm.Location {
  const k = C_INV.clone().multiply(m).multiply(C)
  // (Matrix4 keeps its elements column by column; the kernel's Location takes rows)
  return new sm.Location(Float64Array.from(k.transpose().elements))
}

/** The kernel's transform as three's: C · l · C⁻¹. */
export function matrix4(l: sm.Location, target: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  const rows = l.matrix
  target.set(...(rows.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
  return target.premultiply(C).multiply(C_INV)
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

/** The kernel's box as three's: C only swaps and turns axes, so the box stays exact. */
export function box3(b: sm.BoundBox, target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
  target.min.set(b.min.x, b.min.z, 0 - b.max.y)
  target.max.set(b.max.x, b.max.z, 0 - b.min.y)
  return target
}

/** three's box as the kernel's. */
export function boundBox(b: THREE.Box3): sm.BoundBox {
  return new sm.BoundBox([b.min.x, -b.max.z, b.min.y], [b.max.x, -b.min.z, b.max.y])
}

/** A per-axis alignment of three's axes ({ x, y, z } or one value for all) as the kernel's
 * [x, y, z]: three's y is the kernel's z, and three's z the kernel's -y (so 'min' and 'max' swap). */
export function align3(align: Align3 | undefined): sm.AlignLike | undefined {
  if (align === undefined) return undefined
  const each = typeof align === 'string' || align === null ? { x: align, y: align, z: align } : align
  const swap = (a: AlignValue | undefined) => (a === 'min' ? 'max' : a === 'max' ? 'min' : a)
  return [each.x ?? 'center', swap(each.z) ?? 'center', each.y ?? 'center']
}


/** A sketch's alignment as the kernel's [x, y]. */
export function align2(align: Align2 | undefined): sm.AlignLike | undefined {
  if (align === undefined) return undefined
  if (typeof align === 'string') return [align, align]
  return [align.x ?? 'center', align.y ?? 'center']
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
  if (e instanceof sm.KernelError) return new KernelError(e.message, { operation: e.operation, status: e.status, hint: e.hint, trace: e.trace })
  if (e instanceof sm.ModelingError) return new ModelingError(e.message)
  if (e instanceof sm.FontError) return new FontError(e.message)
  return e
}

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
