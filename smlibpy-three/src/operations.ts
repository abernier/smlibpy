// smlibpy's functions, patterns and constants. Every operation of a body is a method and a function,
// as smlibpy's are: the function takes the body first, as the method takes `this`, and gives what the
// method gives (in the body's frame, with its transform); the other shapes are taken where they are.
// Sweeps of profiles (extrude, revolve, sweep, swing) and what makes a shape of several (loft,
// merge) are here too. Patterns are THREE.Matrix4s in the XY plane, where sketches lie: give them to
// `shape.at(locations)` for copies there.
import * as THREE from 'three'
import { call, degrees, describe, matrix4, sm, vec } from './kernel.ts'
import { TriangleMesh, kernelMesh, meshResult } from './mesh.ts'
import {
  Body,
  BrepEdge,
  BrepFace,
  Part,
  Shell,
  Sketch,
  BrepVertex,
  Wire,
  adopt,
  frameOf,
  isObject3D,
  kernelOf,
  kernelOfShape,
  operand,
  pathOf,
  placedCurve,
  toKernel,
  toThree,
  wrap,
  type ShapeList,
  type ChamferOptions,
  type EdgesLike,
  type ExtrudeOptions,
  type FacesLike,
  type FilletOptions,
  type FilletRadius,
  type PushOptions,
  type RegionLike,
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
export type ProfileLike = Sketch | BrepFace | Wire | BrepEdge

/** The kernel's value of a profile, and the object whose frame the result is in. */
function profileOf(profile: ProfileLike, what: string): [sm.Sketch | sm.Face | sm.Wire | sm.Edge, Body | BrepEdge | Wire] {
  if (profile instanceof Sketch) return [kernelOf(profile) as sm.Sketch, profile]
  if (profile instanceof BrepFace) return [kernelOfShape(profile) as sm.Face, frameOf(profile) as Body]
  if (profile instanceof BrepEdge || profile instanceof Wire) return [kernelOfShape(profile) as sm.Edge | sm.Wire, profile]
  throw new TypeError(`${what}: give a Sketch, BrepFace, Wire or BrepEdge`)
}

/** The result of a free function: a body in the frame of `like`, with its transform. */
function result<T extends Part | Shell | Sketch>(value: sm.Part | sm.Shell, like: THREE.Object3D): T {
  return (like instanceof Body ? adopt(wrap(value), like) : toThree(value, like)) as T
}

/** A solid of a sketch or face moved `amount` along its normal (or `direction`); a sheet of a curve. */
export function extrude(profile: Sketch | BrepFace, amount: number, options?: ExtrudeOptions): Part
export function extrude(profile: ProfileLike, amount: number, options?: ExtrudeOptions): Part | Shell
export function extrude(profile: ProfileLike, amount: number, options: ExtrudeOptions = {}): Part | Shell {
  if (profile instanceof Sketch || profile instanceof BrepFace) return profile.extrude(amount, options)
  const [value, like] = profileOf(profile, 'extrude')
  const o = { ...options, taper: options.taper === undefined ? undefined : degrees(options.taper), direction: options.direction == null ? options.direction : vec(options.direction) }
  return result(call(() => sm.extrude(value, amount, o)), like)
}

/** A solid of revolution of a sketch about `axis` (a THREE.Ray in its frame; default its frame's y
 * axis, as THREE.LatheGeometry revolves) through `angle` radians; a sheet of a curve. */
export function revolve(profile: Sketch, axis?: THREE.Ray | null, angle?: number): Part
export function revolve(profile: ProfileLike, axis?: THREE.Ray | null, angle?: number): Part | Shell
export function revolve(profile: ProfileLike, axis: THREE.Ray | null = null, angle = 2 * Math.PI): Part | Shell {
  if (profile instanceof Sketch) return profile.revolve(axis, angle)
  const [value, like] = profileOf(profile, 'revolve')
  return result(call(() => sm.revolve(value, axis === null ? null : (toKernel(axis, like) as sm.Axis), degrees(angle))), like)
}

/** A solid along `path` (a BrepEdge or Wire where it is, or a THREE.Curve in the profile's frame); a
 * sheet of a curve. `orient` turns the profile to face along the path, `translational` keeps it as
 * it is; `rails` a curve the profile's ends follow. */
export function sweep(profile: Sketch | BrepFace, path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions & { orient?: boolean; translational?: boolean; rails?: BrepEdge | Wire | null }): Part
export function sweep(profile: ProfileLike, path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions & { orient?: boolean; translational?: boolean; rails?: BrepEdge | Wire | null }): Part | Shell
export function sweep(profile: ProfileLike, path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options: SweepOptions & { orient?: boolean; translational?: boolean; rails?: BrepEdge | Wire | null } = {}): Part | Shell {
  const [value, like] = profileOf(profile, 'sweep')
  const p = pathOf(path, like)
  const twist = options.twist
  const anchor = options.anchor
  const o = {
    ...options,
    twist: twist === undefined ? undefined : typeof twist === 'function' ? (s: number) => degrees(twist(s)) : degrees(twist),
    up: options.up == null || typeof options.up === 'string' ? options.up : vec(options.up),
    anchor: anchor === undefined || typeof anchor === 'string' ? anchor : anchor instanceof BrepVertex ? kernelOfShape(anchor) : [anchor.x, anchor.y],
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
  startTangent?: THREE.Vector3Like | BrepFace | Iterable<BrepFace> | null
  /** Arrive at the last section so. */
  endTangent?: THREE.Vector3Like | BrepFace | Iterable<BrepFace> | null
  /** Back from the last section to the first: a ring. */
  closed?: boolean
  /** Curves (where they are) the sections' corners follow. */
  rails?: BrepEdge | Wire | readonly (BrepEdge | Wire)[] | null
}

/** A solid through sketches (or a sheet through curves), each where it is, in the frame of the first. */
export function loft(sections: readonly (Sketch | BrepFace)[], options?: LoftOptions): Part
export function loft(sections: readonly ProfileLike[], options?: LoftOptions): Part | Shell
export function loft(sections: readonly ProfileLike[], options: LoftOptions = {}): Part | Shell {
  if (sections.length < 2) throw new RangeError('loft: give two sections or more')
  const like = frameOf(sections[0])
  const kernel = sections.map((s) => operand(s, like, 'loft') as sm.Sketch)
  const tangent = (t: LoftOptions['startTangent']) => (t == null ? t : isObject3D(t) ? toKernel(t, like) : (t as THREE.Vector3Like).x !== undefined ? vec(t as THREE.Vector3Like) : toKernel([...(t as Iterable<BrepFace>)], like))
  const o = { ...options, startTangent: tangent(options.startTangent), endTangent: tangent(options.endTangent), rails: options.rails == null ? options.rails : toKernel(options.rails, like) }
  return result(call(() => sm.loft(kernel, o as never)), like)
}

/** A solid of a profile swung around an outline (a sketch, face or curve, where it is), as a rim or
 * a frame is; a sheet of a curve. */
export function swing(profile: Sketch | BrepFace, outline: Sketch | BrepFace | Wire | BrepEdge): Part
export function swing(profile: ProfileLike, outline: Sketch | BrepFace | Wire | BrepEdge): Part | Shell
export function swing(profile: ProfileLike, outline: Sketch | BrepFace | Wire | BrepEdge): Part | Shell {
  const [value, like] = profileOf(profile, 'swing')
  const o = operand(outline, like, 'swing') as sm.Sketch | sm.Face | sm.Wire | sm.Edge
  return result(call(() => sm.swing(value, o)), like)
}

/** The part with these edges (of one part) rounded; a sketch with the corners at these vertices rounded. */
export function fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part
export function fillet(vertices: BrepVertex | readonly BrepVertex[], radius: number): Sketch
export function fillet(items: EdgesLike | BrepVertex | readonly BrepVertex[], radius: FilletRadius, options: FilletOptions = {}): Part | Sketch {
  const [first, list] = firstOf(items)
  if (first instanceof BrepVertex) return (ownerOf(first, 'fillet') as Sketch).fillet(radius as number, list as BrepVertex[])
  return (ownerOf(first, 'fillet') as Part).fillet(list as EdgesLike, radius, options)
}

/** The part with these edges (of one part) bevelled; a sketch with the corners at these vertices cut. */
export function chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part
export function chamfer(vertices: BrepVertex | readonly BrepVertex[], length: number): Sketch
export function chamfer(items: EdgesLike | BrepVertex | readonly BrepVertex[], length: number, options: ChamferOptions = {}): Part | Sketch {
  const [first, list] = firstOf(items)
  if (first instanceof BrepVertex) return (ownerOf(first, 'chamfer') as Sketch).chamfer(length, list as BrepVertex[])
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

// ------------------------------------------------------------ every operation of a body, as a function
// Each is its method's function form, as smlibpy's are: the same name and parameters, the body first
// (fillet, chamfer and filletPreview take the edges and find their part). The method does the work;
// the function delegates, and a shape it does not take is a TypeError that says what it takes.

/** `shape` if it is one of `kinds`, else a TypeError that says what `what` takes. */
function shapeOf<T>(shape: unknown, kinds: readonly Function[], what: string, takes: string): T {
  if (kinds.some((k) => shape instanceof k)) return shape as T
  throw new TypeError(`${what} takes ${takes} first, not ${describe(shape)}`)
}

/** A hollow part: `Part.shell`. */
export function shell(part: Part, thickness: number, openings: FacesLike | null = null, options: Parameters<Part['shell']>[2] = {}): Part {
  return shapeOf<Part>(part, [Part], 'shell', 'a Part').shell(thickness, openings, options)
}

/** A shape grown (or shrunk) by `distance`: a part all round (`Part.offset`), a sketch's region in its
 * plane (`Sketch.offset`), a sheet or face along its normals, a curve in its plane (`Wire.offset`,
 * `BrepEdge.offset`). */
export function offset(shape: Part, distance: number, options?: { corners?: 'round' | 'sharp' }): Part
export function offset(shape: Sketch, distance: number, options?: { corners?: 'round' | 'sharp' | 'chamfer' }): Sketch
export function offset(shape: Shell | BrepFace, distance: number): Shell
export function offset(shape: Wire, distance: number, options?: { corners?: 'round' | 'sharp' | 'chamfer'; plane?: THREE.Plane | null }): Wire
export function offset(shape: BrepEdge, distance: number, options?: { plane?: THREE.Plane | null }): BrepEdge
export function offset(shape: Part | Sketch | Shell | BrepFace | Wire | BrepEdge, distance: number, options: { corners?: 'round' | 'sharp' | 'chamfer'; plane?: THREE.Plane | null } = {}): Part | Sketch | Shell | Wire | BrepEdge {
  const s = shapeOf<Part | Shell | BrepFace | Wire | BrepEdge>(shape, [Part, Shell, BrepFace, Wire, BrepEdge], 'offset', 'a Part, Sketch, Shell, BrepFace, Wire or BrepEdge')
  if (s instanceof Sketch) return s.offset(distance, options as { corners?: 'round' | 'sharp' | 'chamfer' })
  if (s instanceof Part) return s.offset(distance, options as { corners?: 'round' | 'sharp' })
  if (s instanceof Shell || s instanceof BrepFace) return s.offset(distance)
  return s instanceof Wire ? s.offset(distance, options) : s.offset(distance, options)
}

/** A shape mirrored in `plane` (in its frame): `mirror` of a Part, Shell, Sketch, BrepEdge or Wire. */
export function mirror<S extends Part | Shell | Sketch | BrepEdge | Wire>(shape: S, plane: THREE.Plane): S {
  return (shapeOf(shape, [Part, Shell, BrepEdge, Wire], 'mirror', 'a Part, Shell, Sketch, BrepEdge or Wire') as unknown as { mirror(p: THREE.Plane): S }).mirror(plane)
}

/** The part split by a plane, a face or a sheet: `Part.split`. */
export function split(part: Part, plane: THREE.Plane | BrepFace | Shell, keep: 'both'): [Part, Part]
export function split(part: Part, plane: THREE.Plane | BrepFace | Shell, keep?: 'above' | 'below'): Part
export function split(part: Part, plane: THREE.Plane | BrepFace | Shell, keep: 'above' | 'below' | 'both' = 'above'): Part | [Part, Part] {
  return shapeOf<Part>(part, [Part], 'split', 'a Part').split(plane, keep as 'both')
}

/** A part of several cells, of these parts (each where it is), in the frame of the first: `Part.merge`. */
export function merge(...parts: (Part | Iterable<Part>)[]): Part {
  const list: unknown[] = []
  for (const p of parts) {
    if (isObject3D(p)) list.push(p)
    else list.push(...(p as Iterable<Part>))
  }
  if (!list.length) throw new RangeError('merge: give at least one part')
  return shapeOf<Part>(list[0], [Part], 'merge', 'Parts').merge(...(list.slice(1) as Part[]))
}

/** The section of a part by a plane (in its frame): `Part.section`. */
export function section(part: Part, plane: THREE.Plane): Sketch {
  return shapeOf<Part>(part, [Part], 'section', 'a Part').section(plane)
}

/** A solid of a sheet or face grown by `thickness` (`both`: half to each side): `Shell.thicken`. */
export function thicken(surface: Shell | BrepFace, thickness: number, options: { both?: boolean } = {}): Part {
  const s = shapeOf<Shell | BrepFace>(surface, [Shell, BrepFace], 'thicken', 'a Shell or BrepFace')
  return s instanceof BrepFace ? s.toShell().thicken(thickness, options) : s.thicken(thickness, options)
}

/** The shape and the others (each where it is) fused: `fuse` of a Part, Shell or Sketch. */
export function fuse(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch
export function fuse(shape: Shell, ...others: (Shell | Part | BrepFace | Iterable<Shell | Part | BrepFace>)[]): Shell
export function fuse(shape: Part, ...others: (Part | Iterable<Part>)[]): Part
export function fuse(shape: Part | Shell, ...others: unknown[]): Part | Shell {
  return shapeOf<Part>(shape, [Part, Shell], 'fuse', 'a Part, Shell or Sketch').fuse(...(others as Part[]))
}

/** The shape with the others (each where it is) cut away: `cut` of a Part, Shell or Sketch. */
export function cut(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch
export function cut(shape: Shell, ...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell
export function cut(shape: Part, ...others: (Part | Iterable<Part>)[]): Part
export function cut(shape: Part | Shell, ...others: unknown[]): Part | Shell {
  return shapeOf<Part>(shape, [Part, Shell], 'cut', 'a Part, Shell or Sketch').cut(...(others as Part[]))
}

/** What the shape and the others (each where it is) share: `intersect` of a Part, Shell or Sketch
 * (a part and a sheet: the sheet's part inside the part). */
export function intersect(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch
export function intersect(shape: Shell, ...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell
export function intersect(shape: Part, sheet: Shell | BrepFace): Shell
export function intersect(shape: Part, ...others: (Part | Iterable<Part>)[]): Part
export function intersect(shape: Part | Shell, ...others: unknown[]): Part | Shell {
  return shapeOf<Part>(shape, [Part, Shell], 'intersect', 'a Part, Shell or Sketch').intersect(...(others as Part[]))
}

/** The regions the sketch or the others cover, but not both: `Sketch.xor`. */
export function xor(sketch: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch {
  return shapeOf<Sketch>(sketch, [Sketch], 'xor', 'a Sketch').xor(...others)
}

/** The part with a tool's outline imprinted on its faces: `Part.imprint`. */
export function imprint(part: Part, tool: Body | BrepFace | BrepEdge | Wire | Iterable<BrepFace | BrepEdge | Wire>, direction: THREE.Vector3Like | null = null, options: { nearest?: boolean } = {}): Part {
  return shapeOf<Part>(part, [Part], 'imprint', 'a Part').imprint(tool, direction, options)
}

/** The faces a fillet of these edges (of one part) would add, as sheets: `Part.filletPreview`. */
export function filletPreview(edges: EdgesLike, radius: number, options: { propagate?: boolean } = {}): ShapeList<Shell> {
  const [first, list] = firstOf(edges)
  return (ownerOf(first, 'filletPreview') as Part).filletPreview(list as EdgesLike, radius, options)
}

/** The part with these faces drafted by `angle` radians from a neutral plane or face: `Part.draft`. */
export function draft(part: Part, faces: FacesLike, angle: number, neutralPlane: THREE.Plane | BrepFace): Part {
  return shapeOf<Part>(part, [Part], 'draft', 'a Part').draft(faces, angle, neutralPlane)
}

/** The part with these faces moved, the faces around them following: `Part.moveFaces`. */
export function moveFaces(part: Part, faces: FacesLike, by: THREE.Matrix4 | THREE.Vector3Like): Part {
  return shapeOf<Part>(part, [Part], 'moveFaces', 'a Part').moveFaces(faces, by)
}

/** The part with these faces moved `distance` along their normals: `Part.offsetFaces`. */
export function offsetFaces(part: Part, faces: FacesLike, distance: number): Part {
  return shapeOf<Part>(part, [Part], 'offsetFaces', 'a Part').offsetFaces(faces, distance)
}

/** The part without these faces, the faces around them closing the gap: `Part.removeFaces`. */
export function removeFaces(part: Part, faces: FacesLike, options: { partial?: boolean } = {}): Part {
  return shapeOf<Part>(part, [Part], 'removeFaces', 'a Part').removeFaces(faces, options)
}

/** The part without its fillets (or these of them): `Part.removeFillets`. */
export function removeFillets(part: Part, faces: FacesLike | null = null, options: { maxRadius?: number | null; partial?: boolean } = {}): Part {
  return shapeOf<Part>(part, [Part], 'removeFillets', 'a Part').removeFillets(faces, options)
}

/** The body with a region of a face pushed, the face bending smoothly around it: `push` of a Part or
 * Shell. */
export function push(shape: Part, face: BrepFace, at: THREE.Vector3Like, options?: PushOptions): Part
export function push(shape: Shell, face: BrepFace, at: THREE.Vector3Like, options?: PushOptions): Shell
export function push(shape: Part | Shell, face: BrepFace, at: THREE.Vector3Like, options: PushOptions = {}): Part | Shell {
  return (shapeOf<Part | Shell>(shape, [Part, Shell], 'push', 'a Part or Shell') as Part).push(face, at, options)
}

/** The body with a region of a face moved by `by`, the face bending smoothly around it: `warp` of a
 * Part or Shell. */
export function warp(shape: Part, face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options?: { continuity?: 'crease' | 'G1' | 'G2' }): Part
export function warp(shape: Shell, face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options?: { continuity?: 'crease' | 'G1' | 'G2' }): Shell
export function warp(shape: Part | Shell, face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options: { continuity?: 'crease' | 'G1' | 'G2' } = {}): Part | Shell {
  return (shapeOf<Part | Shell>(shape, [Part, Shell], 'warp', 'a Part or Shell') as Part).warp(face, region, by, options)
}

/** The body with a region of a face pressed flat onto a plane or face: `flatten` of a Part or Shell. */
export function flatten(shape: Part, face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options?: { continuity?: 'crease' | 'G1' | 'G2' }): Part
export function flatten(shape: Shell, face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options?: { continuity?: 'crease' | 'G1' | 'G2' }): Shell
export function flatten(shape: Part | Shell, face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options: { continuity?: 'crease' | 'G1' | 'G2' } = {}): Part | Shell {
  return (shapeOf<Part | Shell>(shape, [Part, Shell], 'flatten', 'a Part or Shell') as Part).flatten(face, region, plane, options)
}

/** A curve made longer (`BrepEdge.extend`), or a sheet or face extended past its edges
 * (`Shell.extend`, `BrepFace.extend`). */
export function extend(shape: BrepEdge, distance: number, options?: { end?: 'start' | 'end' | 'both'; continuity?: 'G1' | 'G2' | 'natural' }): BrepEdge
export function extend(shape: Shell | BrepFace, distance: number, options?: { sides?: BrepEdge | Iterable<BrepEdge> | null; continuity?: 'natural' | 'G1' | 'G2' }): Shell
export function extend(shape: BrepEdge | Shell | BrepFace, distance: number, options: Record<string, unknown> = {}): BrepEdge | Shell {
  const s = shapeOf<BrepEdge | Shell | BrepFace>(shape, [BrepEdge, Shell, BrepFace], 'extend', 'a BrepEdge, Shell or BrepFace')
  return (s as BrepEdge).extend(distance, options as never)
}

/** A sheet trimmed by curves on it (`Shell.trim`), or a curve trimmed to a part of it (`BrepEdge.trim`,
 * `Wire.trim`). */
export function trim(shape: Shell, curves: BrepEdge | Wire | Iterable<BrepEdge | Wire>, keep: THREE.Vector3Like | 'split'): Shell
export function trim(shape: BrepEdge, start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): BrepEdge
export function trim(shape: Wire, start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): Wire
export function trim(shape: Shell | BrepEdge | Wire, a: unknown, b: unknown): Shell | BrepEdge | Wire {
  return shapeOf<Shell>(shape, [Shell, BrepEdge, Wire], 'trim', 'a Shell, BrepEdge or Wire').trim(a as never, b as never)
}

/** The sheet with one of its free edges moved onto a curve, the sheet following: `Shell.matchEdge`. */
export function matchEdge(sheet: Shell, edge: BrepEdge, target: BrepEdge | Wire, options: { extent?: number } = {}): Shell {
  return shapeOf<Shell>(sheet, [Shell], 'matchEdge', 'a Shell').matchEdge(edge, target, options)
}

/** The sheet with two neighbouring faces made one: `Shell.mergeFaces`. */
export function mergeFaces(sheet: Shell, a: BrepFace, b: BrepFace): Shell {
  return shapeOf<Shell>(sheet, [Shell], 'mergeFaces', 'a Shell').mergeFaces(a, b)
}

/** A curve projected onto a face (`BrepFace.project`) or onto a body along a direction
 * (`Body.project`). */
export function project(shape: BrepFace, curve: BrepEdge | Wire): ShapeList<BrepEdge>
export function project(shape: Part | Shell, curve: BrepEdge | Wire, direction?: THREE.Vector3Like, options?: { nearest?: boolean }): ShapeList<BrepEdge>
export function project(shape: Part | Shell | BrepFace, curve: BrepEdge | Wire, direction?: THREE.Vector3Like, options: { nearest?: boolean } = {}): ShapeList<BrepEdge> {
  const s = shapeOf<Part | Shell | BrepFace>(shape, [Part, Shell, BrepFace], 'project', 'a Part, Shell or BrepFace')
  return s instanceof BrepFace ? s.project(curve) : s.project(curve, direction, options)
}

/** The body's contour seen along a direction: `Body.silhouette`. */
export function silhouette(shape: Part | Shell, direction?: THREE.Vector3Like): ShapeList<BrepEdge> {
  return shapeOf<Part | Shell>(shape, [Part, Shell], 'silhouette', 'a Part or Shell').silhouette(direction)
}

/** The curves where the body meets another body, a face or a plane: `Body.intersectionCurves`. */
export function intersectionCurves(shape: Part | Shell, other: Part | Shell | BrepFace | THREE.Plane): ShapeList<BrepEdge> {
  return shapeOf<Part | Shell>(shape, [Part, Shell], 'intersectionCurves', 'a Part or Shell').intersectionCurves(other)
}

/** The line a mold parts along, seen along `direction`: `Part.partingLine`. */
export function partingLine(part: Part, direction: THREE.Vector3Like): ShapeList<Wire> {
  return shapeOf<Part>(part, [Part], 'partingLine', 'a Part').partingLine(direction)
}

/** Sections `step` apart along `axis`: a part's as sketches (`Part.slices`), a triangle mesh's as
 * wires (`TriangleMesh.slices`). */
export function slices(shape: Part, step: number, axis?: THREE.Vector3Like): Sketch[]
export function slices(shape: TriangleMesh, step: number, axis?: THREE.Vector3Like): ShapeList<Wire>[]
export function slices(shape: Part | TriangleMesh, step: number, axis?: THREE.Vector3Like): Sketch[] | ShapeList<Wire>[] {
  const s = shapeOf<Part | TriangleMesh>(shape, [Part, TriangleMesh], 'slices', 'a Part or TriangleMesh')
  return s instanceof Part ? s.slices(step, axis) : s.slices(step, axis)
}

/**
 * A copy of the shape scaled by `factor` (a number, or one per axis: a THREE.Vector3; none zero)
 * about `center` (in its frame; default its origin), in its frame with its transform: the body (or
 * curve, or triangle mesh) itself scaled, where its `scale` (three's, the object's transform) only
 * places it so. A factor different per axis makes B-splines of round faces. (A function only: the
 * method's name is three's.)
 */
export function scale<S extends Part | Shell | Sketch | BrepEdge | Wire | TriangleMesh>(shape: S, factor: number | THREE.Vector3Like, center: THREE.Vector3Like = new THREE.Vector3()): S {
  const s = shapeOf<Body | BrepEdge | Wire | TriangleMesh>(shape, [Body, BrepEdge, Wire, TriangleMesh], 'scale', 'a Part, Shell, Sketch, BrepEdge, Wire or TriangleMesh')
  const f = typeof factor === 'number' ? factor : vec(factor)
  const c = vec(center)
  if (s instanceof Body) return adopt(wrap(call(() => kernelOf(s).scale(f, c))), s) as S
  if (s instanceof TriangleMesh) return meshResult(call(() => kernelMesh(s).scale(f, c)), s) as S
  return placedCurve(call(() => (kernelOfShape(s) as sm.Edge | sm.Wire).scale(f, c)), s) as S
}

const matrices = (locations: Iterable<sm.Location>) => [...locations].map((l) => matrix4(l))

/** A grid in the XY plane: `xCount` places `xSpacing` apart along x, `yCount` places `ySpacing`
 * apart along y, centered on the origin unless `centered` is false. */
export function GridLocations(xSpacing: number, ySpacing: number, xCount: number, yCount: number, options: { centered?: boolean } = {}): THREE.Matrix4[] {
  return matrices(call(() => sm.GridLocations(xSpacing, ySpacing, xCount, yCount, options)))
}

/** `count` places on a circle of `radius` around z in the XY plane, from `startAngle` over
 * `angularRange` (radians from +x, counterclockwise seen from +z), each turned about z to face
 * outward (its x away from the center) unless `rotate` is false. */
export function PolarLocations(radius: number, count: number, options: { startAngle?: number; angularRange?: number; rotate?: boolean } = {}): THREE.Matrix4[] {
  const o = {
    startAngle: options.startAngle === undefined ? undefined : degrees(options.startAngle),
    angularRange: options.angularRange === undefined ? undefined : degrees(options.angularRange),
    rotate: options.rotate,
  }
  return matrices(call(() => sm.PolarLocations(radius, count, o)))
}

/** A hexagonal grid in the XY plane, `spacing` apart: `xCount` places along x in each of `yCount`
 * rows. */
export function HexLocations(spacing: number, xCount: number, yCount: number, options: { centered?: boolean } = {}): THREE.Matrix4[] {
  return matrices(call(() => sm.HexLocations(spacing, xCount, yCount, options)))
}

/**
 * Places in the world (smlibpy's Locations): at a face's center with its z axis along the face's
 * normal (as a sketch on the face lies: a Hole placed there drills into the face; a cylinder, along
 * its y, stands on it once turned, `cylinder.rotation.x = Math.PI / 2`), at a vertex, at a point, or
 * a matrix as it is; faces and vertices where their body is.
 */
export function Locations(...items: (BrepFace | BrepVertex | THREE.Vector3Like | THREE.Matrix4 | Iterable<BrepFace | BrepVertex | THREE.Vector3Like | THREE.Matrix4>)[]): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  const add = (item: unknown) => {
    if ((item as { isMatrix4?: boolean }).isMatrix4) out.push((item as THREE.Matrix4).clone())
    else if (item instanceof BrepFace || item instanceof BrepVertex) {
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
