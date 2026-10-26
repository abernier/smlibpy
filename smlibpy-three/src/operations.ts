// smlibpy's free functions, patterns and constants. The functions take their first shape as
// smlibpy's methods take `self`: the result is in its frame and has its transform; the other
// shapes are taken where they are. Patterns are THREE.Matrix4s, on the ground (XZ) as smlibpy's lie
// on XY: give them to `shape.at(locations)` for copies there.
import * as THREE from 'three'
import { call, degrees, matrix4, sm, vec } from './kernel.ts'
import {
  Body,
  Edge,
  Face,
  Part,
  Shell,
  Sketch,
  Vertex,
  Wire,
  adopt,
  frameOf,
  isObject3D,
  kernelOf,
  kernelOfShape,
  operand,
  pathOf,
  toKernel,
  toThree,
  wrap,
  type ChamferOptions,
  type EdgesLike,
  type ExtrudeOptions,
  type FacesLike,
  type FilletOptions,
  type FilletRadius,
  type SweepOptions,
} from './shapes.ts'

/** The kernel's tolerance of lengths (smlibpy's TOLERANCE). */
export const TOLERANCE: number = sm.TOLERANCE
/** The relative accuracy of the kernel's measurements (smlibpy's ACCURACY). */
export const ACCURACY: number = sm.ACCURACY

/** three's axes as directions: x, y (up) and z. Frozen: copy one to change it. */
export const X: Readonly<THREE.Vector3> = Object.freeze(new THREE.Vector3(1, 0, 0))
export const Y: Readonly<THREE.Vector3> = Object.freeze(new THREE.Vector3(0, 1, 0))
export const Z: Readonly<THREE.Vector3> = Object.freeze(new THREE.Vector3(0, 0, 1))

/** What extrude, revolve, sweep, loft and swing take: a sketch or face (a solid comes of it), or a
 * curve (a sheet comes of it). */
export type ProfileLike = Sketch | Face | Wire | Edge

/** The kernel's value of a profile, and the object whose frame the result is in. */
function profileOf(profile: ProfileLike, what: string): [sm.Sketch | sm.Face | sm.Wire | sm.Edge, Body | Edge | Wire] {
  if (profile instanceof Sketch) return [kernelOf(profile) as sm.Sketch, profile]
  if (profile instanceof Face) return [kernelOfShape(profile) as sm.Face, frameOf(profile) as Body]
  if (profile instanceof Edge || profile instanceof Wire) return [kernelOfShape(profile) as sm.Edge | sm.Wire, profile]
  throw new TypeError(`${what}: give a Sketch, Face, Wire or Edge`)
}

/** The result of a free function: a body in the frame of `like`, with its transform. */
function result<T extends Part | Shell | Sketch>(value: sm.Part | sm.Shell, like: THREE.Object3D): T {
  return (like instanceof Body ? adopt(wrap(value), like) : toThree(value, like)) as T
}

/** A solid of a sketch or face moved `amount` along its normal (or `direction`); a sheet of a curve. */
export function extrude(profile: Sketch | Face, amount: number, options?: ExtrudeOptions): Part
export function extrude(profile: ProfileLike, amount: number, options?: ExtrudeOptions): Part | Shell
export function extrude(profile: ProfileLike, amount: number, options: ExtrudeOptions = {}): Part | Shell {
  if (profile instanceof Sketch || profile instanceof Face) return profile.extrude(amount, options)
  const [value, like] = profileOf(profile, 'extrude')
  const o = { ...options, taper: options.taper === undefined ? undefined : degrees(options.taper), direction: options.direction == null ? options.direction : vec(options.direction) }
  return result(call(() => sm.extrude(value, amount, o)), like)
}

/** A solid of revolution of a sketch about `axis` (a THREE.Ray in its frame; default its y axis)
 * through `angle` radians; a sheet of a curve. */
export function revolve(profile: Sketch, axis?: THREE.Ray | null, angle?: number): Part
export function revolve(profile: ProfileLike, axis?: THREE.Ray | null, angle?: number): Part | Shell
export function revolve(profile: ProfileLike, axis: THREE.Ray | null = null, angle = 2 * Math.PI): Part | Shell {
  if (profile instanceof Sketch) return profile.revolve(axis, angle)
  const [value, like] = profileOf(profile, 'revolve')
  return result(call(() => sm.revolve(value, axis === null ? null : (toKernel(axis, like) as sm.Axis), degrees(angle))), like)
}

/** A solid along `path` (an Edge or Wire where it is, or a THREE.Curve in the profile's frame); a
 * sheet of a curve. `orient` turns the profile to face along the path, `translational` keeps it as
 * it is; `rails` a curve the profile's ends follow. */
export function sweep(profile: Sketch | Face, path: Edge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions & { orient?: boolean; translational?: boolean; rails?: Edge | Wire | null }): Part
export function sweep(profile: ProfileLike, path: Edge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions & { orient?: boolean; translational?: boolean; rails?: Edge | Wire | null }): Part | Shell
export function sweep(profile: ProfileLike, path: Edge | Wire | THREE.Curve<THREE.Vector3>, options: SweepOptions & { orient?: boolean; translational?: boolean; rails?: Edge | Wire | null } = {}): Part | Shell {
  const [value, like] = profileOf(profile, 'sweep')
  const p = pathOf(path, like)
  const twist = options.twist
  const anchor = options.anchor
  const o = {
    ...options,
    twist: twist === undefined ? undefined : typeof twist === 'function' ? (s: number) => degrees(twist(s)) : degrees(twist),
    up: options.up == null || typeof options.up === 'string' ? options.up : vec(options.up),
    anchor: anchor === undefined || typeof anchor === 'string' ? anchor : anchor instanceof Vertex ? kernelOfShape(anchor) : [anchor.x, anchor.y],
    rails: options.rails == null ? options.rails : toKernel(options.rails, like),
  }
  return result(call(() => sm.sweep(value, p, o as never)), like)
}

/** Options of lofts (smlibpy's). */
export interface LoftOptions {
  /** Straight between the sections (default: smooth through them). */
  ruled?: boolean
  /** Through three sections or more with a cubic surface (false: quadratic). */
  smooth?: boolean
  /** Leave the first section along a direction (a Vector3 in the first section's frame) or tangent to faces (where they are). */
  startTangent?: THREE.Vector3Like | Face | Iterable<Face> | null
  /** Arrive at the last section so. */
  endTangent?: THREE.Vector3Like | Face | Iterable<Face> | null
  /** Back from the last section to the first: a ring. */
  closed?: boolean
  /** Curves (where they are) the sections' corners follow. */
  rails?: Edge | Wire | readonly (Edge | Wire)[] | null
}

/** A solid through sketches (or a sheet through curves), each where it is, in the frame of the first. */
export function loft(sections: readonly (Sketch | Face)[], options?: LoftOptions): Part
export function loft(sections: readonly ProfileLike[], options?: LoftOptions): Part | Shell
export function loft(sections: readonly ProfileLike[], options: LoftOptions = {}): Part | Shell {
  if (sections.length < 2) throw new RangeError('loft: give two sections or more')
  const like = frameOf(sections[0])
  const kernel = sections.map((s) => operand(s, like, 'loft') as sm.Sketch)
  const tangent = (t: LoftOptions['startTangent']) => (t == null ? t : isObject3D(t) ? toKernel(t, like) : (t as THREE.Vector3Like).x !== undefined ? vec(t as THREE.Vector3Like) : toKernel([...(t as Iterable<Face>)], like))
  const o = { ...options, startTangent: tangent(options.startTangent), endTangent: tangent(options.endTangent), rails: options.rails == null ? options.rails : toKernel(options.rails, like) }
  return result(call(() => sm.loft(kernel, o as never)), like)
}

/** A solid of a profile swung around an outline (a sketch, face or curve, where it is), as a rim or
 * a frame is; a sheet of a curve. */
export function swing(profile: Sketch | Face, outline: Sketch | Face | Wire | Edge): Part
export function swing(profile: ProfileLike, outline: Sketch | Face | Wire | Edge): Part | Shell
export function swing(profile: ProfileLike, outline: Sketch | Face | Wire | Edge): Part | Shell {
  const [value, like] = profileOf(profile, 'swing')
  const o = operand(outline, like, 'swing') as sm.Sketch | sm.Face | sm.Wire | sm.Edge
  return result(call(() => sm.swing(value, o)), like)
}

/** The part with these edges (of one part) rounded; a sketch with the corners at these vertices rounded. */
export function fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part
export function fillet(vertices: Vertex | readonly Vertex[], radius: number): Sketch
export function fillet(items: EdgesLike | Vertex | readonly Vertex[], radius: FilletRadius, options: FilletOptions = {}): Part | Sketch {
  const [first, list] = firstOf(items)
  if (first instanceof Vertex) return (ownerOf(first, 'fillet') as Sketch).fillet(radius as number, list as Vertex[])
  return (ownerOf(first, 'fillet') as Part).fillet(list as EdgesLike, radius, options)
}

/** The part with these edges (of one part) bevelled; a sketch with the corners at these vertices cut. */
export function chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part
export function chamfer(vertices: Vertex | readonly Vertex[], length: number): Sketch
export function chamfer(items: EdgesLike | Vertex | readonly Vertex[], length: number, options: ChamferOptions = {}): Part | Sketch {
  const [first, list] = firstOf(items)
  if (first instanceof Vertex) return (ownerOf(first, 'chamfer') as Sketch).chamfer(length, list as Vertex[])
  return (ownerOf(first, 'chamfer') as Part).chamfer(list as EdgesLike, length, options)
}

function firstOf(items: unknown): [unknown, unknown[]] {
  const list = isObject3D(items) ? [items] : [...(items as Iterable<unknown>)]
  if (!list.length) throw new RangeError('give at least one edge, face or vertex')
  return [list[0], list]
}

function ownerOf(x: unknown, what: string): Body {
  const owner = (x as { owner?: Body | null }).owner
  if (!(owner instanceof Body)) throw new TypeError(`${what}: give edges or faces of a part, or vertices of a sketch`)
  return owner
}

/** A hollow part (see Part.shell). */
export function shell(part: Part, thickness: number, openings: FacesLike | null = null, options: Parameters<Part['shell']>[2] = {}): Part {
  return part.shell(thickness, openings, options)
}

/** A shape grown (or shrunk) by `distance`: a part all round, a sketch's region in its plane, a sheet
 * or face along its normals, a curve in its plane. */
export function offset(shape: Part, distance: number, options?: { corners?: string }): Part
export function offset(shape: Sketch, distance: number, options?: { corners?: string; round?: boolean | null }): Sketch
export function offset(shape: Shell | Face, distance: number): Shell
export function offset(shape: Wire, distance: number, options?: { corners?: string; plane?: THREE.Plane | null }): Wire
export function offset(shape: Edge, distance: number, options?: { plane?: THREE.Plane | null }): Edge
export function offset(shape: Part | Sketch | Shell | Face | Wire | Edge, distance: number, options: { corners?: string; round?: boolean | null; plane?: THREE.Plane | null } = {}): Part | Sketch | Shell | Wire | Edge {
  if (shape instanceof Sketch) return shape.offset(distance, options)
  if (shape instanceof Part) return shape.offset(distance, options)
  if (shape instanceof Shell || shape instanceof Face) return shape.offset(distance)
  return shape.offset(distance, options)
}

/** A shape mirrored in `plane` (in its frame). */
export function mirror<S extends Part | Shell | Sketch | Edge | Wire>(shape: S, plane: THREE.Plane): S {
  return (shape as unknown as { mirror(p: THREE.Plane): S }).mirror(plane)
}

/** The part split by a plane (see Part.split). */
export function split(part: Part, plane: THREE.Plane | Face | Shell, keep: 'both'): [Part, Part]
export function split(part: Part, plane: THREE.Plane | Face | Shell, keep?: 'above' | 'below'): Part
export function split(part: Part, plane: THREE.Plane | Face | Shell, keep: 'above' | 'below' | 'both' = 'above'): Part | [Part, Part] {
  return part.split(plane, keep as 'both')
}

/** A part of several cells, of these parts (each where it is), in the frame of the first. */
export function merge(...parts: (Part | Iterable<Part>)[]): Part {
  const list = parts.flatMap((p) => (p instanceof Part ? [p] : [...p]))
  if (!list.length) throw new RangeError('merge: give at least one part')
  return list[0].merge(...list.slice(1))
}

/** The section of a part by a plane (in its frame). */
export function section(part: Part, plane: THREE.Plane): Sketch {
  return part.section(plane)
}

/** A solid of a sheet or face grown by `thickness` (`both`: half to each side). */
export function thicken(surface: Shell | Face, thickness: number, options: { both?: boolean } = {}): Part {
  return surface instanceof Face ? surface.toShell().thicken(thickness, options) : surface.thicken(thickness, options)
}

const matrices = (locations: Iterable<sm.Location>) => [...locations].map((l) => matrix4(l))

/** A grid on the ground: `xCount` places `xSpacing` apart along x, `zCount` places `zSpacing`
 * apart along z (smlibpy's GridLocations on XY), centered unless `centered` is false. */
export function GridLocations(xSpacing: number, zSpacing: number, xCount: number, zCount: number, options: { centered?: boolean } = {}): THREE.Matrix4[] {
  return matrices(call(() => sm.GridLocations(xSpacing, zSpacing, xCount, zCount, options)))
}

/** `count` places on a circle of `radius` around y, from `startAngle` over `angularRange`
 * (radians), each turned to face outward unless `rotate` is false. */
export function PolarLocations(radius: number, count: number, options: { startAngle?: number; angularRange?: number; rotate?: boolean } = {}): THREE.Matrix4[] {
  const o = {
    startAngle: options.startAngle === undefined ? undefined : degrees(options.startAngle),
    angularRange: options.angularRange === undefined ? undefined : degrees(options.angularRange),
    rotate: options.rotate,
  }
  return matrices(call(() => sm.PolarLocations(radius, count, o)))
}

/** A hexagonal grid on the ground, `spacing` apart. */
export function HexLocations(spacing: number, xCount: number, zCount: number, options: { centered?: boolean } = {}): THREE.Matrix4[] {
  return matrices(call(() => sm.HexLocations(spacing, xCount, zCount, options)))
}

/**
 * Places in the world (smlibpy's Locations): at a face's center with its y axis along the face's
 * normal (so a cylinder or hole placed there stands on the face), at a vertex, at a point, or a
 * matrix as it is; faces and vertices where their body is.
 */
export function Locations(...items: (Face | Vertex | THREE.Vector3Like | THREE.Matrix4 | Iterable<Face | Vertex | THREE.Vector3Like | THREE.Matrix4>)[]): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  const add = (item: unknown) => {
    if ((item as { isMatrix4?: boolean }).isMatrix4) out.push((item as THREE.Matrix4).clone())
    else if (item instanceof Face || item instanceof Vertex) {
      const body = frameOf(item)
      body.updateWorldMatrix(true, false)
      for (const l of call(() => new sm.Locations(kernelOfShape(item) as sm.Face | sm.Vertex))) out.push(matrix4(l).premultiply(body.matrixWorld))
    } else if (typeof (item as THREE.Vector3Like).x === 'number' && typeof (item as THREE.Vector3Like).z === 'number') {
      out.push(new THREE.Matrix4().setPosition((item as THREE.Vector3Like).x, (item as THREE.Vector3Like).y, (item as THREE.Vector3Like).z))
    } else for (const x of item as Iterable<unknown>) add(x)
  }
  for (const item of items) add(item)
  return out
}
