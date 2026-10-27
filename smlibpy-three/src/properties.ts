// What measurements and checks give: smlibpy's records, in three's types (Vector3, Plane, Ray,
// Matrix3) and axes, angles in radians, faces and edges as the package's objects. Each is in the
// frame of the shape it was measured on.
import * as THREE from 'three'
import { axis as toAxis, radians, sm, threePlane, vec, vector3 } from './kernel.ts'
import { toThree, type Body, type BrepEdge, type BrepFace, type ShapeList, type BrepVertex } from './shapes.ts'

function matrix3(rows: readonly (readonly number[])[]): THREE.Matrix3 {
  return new THREE.Matrix3().set(...(rows.flat() as [number, number, number, number, number, number, number, number, number]))
}

/**
 * Mass, volume, area, center of mass and inertia of a part for a density (smlibpy's
 * MassProperties), in the part's frame: the inertia tensor about the center of mass, in three's
 * axes.
 */
export class MassProperties {
  readonly mass: number
  readonly volume: number
  readonly area: number
  readonly density: number
  readonly center: THREE.Vector3
  /** The inertia tensor about the center of mass (three's axes). */
  readonly inertia: THREE.Matrix3
  readonly #k: sm.MassProperties

  /** @internal */
  constructor(k: sm.MassProperties) {
    this.#k = k
    this.mass = k.mass
    this.volume = k.volume
    this.area = k.area
    this.density = k.density
    this.center = vector3(k.center)
    this.inertia = matrix3(k.inertia)
  }

  /** The principal moments of inertia, smallest first. */
  get principalMoments(): [number, number, number] {
    return this.#k.principalMoments
  }

  /** The principal axes (unit directions, in the order of the moments). */
  get principalAxes(): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
    return this.#k.principalAxes.map((a) => vector3(a)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
  }

  /** The radii of gyration about the principal axes. */
  get radiiOfGyration(): [number, number, number] {
    return this.#k.radiiOfGyration
  }

  /** The inertia tensor about another point (three's axes). */
  inertiaAbout(point: THREE.Vector3Like): THREE.Matrix3 {
    return matrix3(this.#k.inertiaAbout(vec(point)))
  }

  /** The moment of inertia about an axis. */
  momentAbout(axis: THREE.Ray): number {
    return this.#k.momentAbout(toAxis(axis))
  }
}

/**
 * Area, centroid and second moments of a sketch's region (smlibpy's SectionProperties), about the
 * centroid, in the region's plane: `ixx` about the in-plane axis `xAxis`, `iyy` about `yAxis`.
 */
export class SectionProperties {
  readonly area: number
  readonly centroid: THREE.Vector3
  /** The plane of the region, in the sketch's frame. */
  readonly plane: THREE.Plane
  /** The in-plane axes the moments are taken about (through the centroid). */
  readonly xAxis: THREE.Vector3
  readonly yAxis: THREE.Vector3
  readonly ixx: number
  readonly iyy: number
  readonly ixy: number
  readonly #k: sm.SectionProperties

  /** @internal */
  constructor(k: sm.SectionProperties) {
    this.#k = k
    this.area = k.area
    this.centroid = vector3(k.centroid)
    this.plane = threePlane(k.plane)
    this.xAxis = vector3(k.plane.xDir)
    this.yAxis = vector3(k.plane.yDir)
    this.ixx = k.ixx
    this.iyy = k.iyy
    this.ixy = k.ixy
  }

  /** The polar moment, ixx + iyy. */
  get polar(): number {
    return this.#k.polar
  }

  /** The principal moments, largest first. */
  get principalMoments(): [number, number] {
    return this.#k.principalMoments
  }

  /** The principal axes (in-plane unit directions). */
  get principalAxes(): [THREE.Vector3, THREE.Vector3] {
    return this.#k.principalAxes.map((a) => vector3(a)) as [THREE.Vector3, THREE.Vector3]
  }

  get radiiOfGyration(): [number, number] {
    return this.#k.radiiOfGyration
  }

  /** The elastic section moduli [ixx / c_y, iyy / c_x]. */
  get sectionModuli(): [number, number] {
    return this.#k.sectionModuli
  }
}

/** The nearest points of two shapes (smlibpy's ClosestPoints), in the frame of the first. */
export interface ClosestPoints {
  readonly point: THREE.Vector3
  readonly otherPoint: THREE.Vector3
  readonly distance: number
  /** The faces the points lie on, where they lie on faces. */
  readonly face: BrepFace | null
  readonly otherFace: BrepFace | null
}

/** @internal
 * `otherFace` gives the other shape's own face for a face of the kernel's (moved) copy of it. */
export function closestPointsOf(k: sm.ClosestPoints, like: Body, otherFace: (k: sm.Face) => BrepFace | null): ClosestPoints {
  return Object.freeze({
    point: vector3(k.point),
    otherPoint: vector3(k.otherPoint),
    distance: k.distance,
    face: k.face === null ? null : (toThree(k.face, like) as BrepFace),
    otherFace: k.otherFace === null ? null : otherFace(k.otherFace),
  })
}

/** The curvature of a face at a point (smlibpy's Curvature): principal curvatures and directions. */
export interface Curvature {
  /** The principal curvatures (1 / radius; positive where the face bends away from its normal). */
  readonly k1: number
  readonly k2: number
  readonly dir1: THREE.Vector3
  readonly dir2: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly point: THREE.Vector3
  /** (k1 + k2) / 2 */
  readonly mean: number
  /** k1 · k2 */
  readonly gaussian: number
}

/** @internal */
export function curvatureOf(k: sm.Curvature): Curvature {
  return Object.freeze({ k1: k.k1, k2: k.k2, dir1: vector3(k.dir1), dir2: vector3(k.dir2), normal: vector3(k.normal), point: vector3(k.point), mean: k.mean, gaussian: k.gaussian })
}

/** How smoothly two faces (or the edges of a wire) meet (smlibpy's Continuity). */
export interface Continuity {
  /** "G0", "G1", "G2" or "G3"; null where they leave a gap. */
  readonly level: string | null
  readonly gap: number
  /** The largest angle between their normals (or tangents), in radians. */
  readonly angle: number
  readonly curvatureJump: number
  /** Where the worst of it is. */
  readonly point: THREE.Vector3
}

/** @internal */
export function continuityOf(k: sm.Continuity): Continuity {
  return Object.freeze({ level: k.level, gap: k.gap, angle: radians(k.angle), curvatureJump: k.curvatureJump, point: vector3(k.point) })
}

/** An exact hit of a ray on a shape's surface (the kernel's ray cast, not the tessellation's). */
export interface RayHit {
  readonly point: THREE.Vector3
  readonly distance: number
  /** The face's outward normal there. */
  readonly normal: THREE.Vector3
  readonly face: BrepFace | null
}

/** @internal */
export function rayHitOf(k: sm.Hit, like: THREE.Object3D): RayHit {
  return Object.freeze({ point: vector3(k.point), distance: k.distance, normal: vector3(k.normal), face: k.face === null ? null : (toThree(k.face, like) as BrepFace) })
}

/** A defect the kernel's check found (smlibpy's Problem). */
export interface Problem {
  readonly shape: Body | BrepFace | BrepEdge | BrepVertex
  readonly message: string
  readonly value: number | null
  readonly tolerance: number | null
  readonly category: string
  readonly test: string
  readonly other: Body | BrepFace | BrepEdge | BrepVertex | null
}

/** @internal */
export function problemOf(k: sm.Problem, like: Body): Problem {
  return Object.freeze({
    shape: toThree(k.shape, like) as Body | BrepFace | BrepEdge | BrepVertex,
    message: k.message,
    value: k.value,
    tolerance: k.tolerance,
    category: k.category,
    test: k.test,
    other: k.other === null ? null : (toThree(k.other, like) as Body | BrepFace | BrepEdge | BrepVertex),
  })
}

/** How a face drafts for a mold pulled along a direction (smlibpy's FaceDraft). */
export interface FaceDraft {
  readonly face: BrepFace
  /** The smallest and largest draft angle over the face, in radians (negative: an undercut). */
  readonly minAngle: number
  readonly maxAngle: number
  /** "positive", "insufficient", "vertical" or "undercut". */
  readonly kind: string
}

/** The draft of every face of a part for a pull direction (smlibpy's DraftAnalysis). */
export class DraftAnalysis {
  /** The pull direction, in the part's frame. */
  readonly direction: THREE.Vector3
  /** The draft a face needs, in radians. */
  readonly minAngle: number
  readonly faces: readonly FaceDraft[]
  readonly #list: (faces: BrepFace[]) => ShapeList<BrepFace>

  /** @internal */
  constructor(k: sm.DraftAnalysis, like: Body, list: (faces: BrepFace[]) => ShapeList<BrepFace>) {
    this.direction = vector3(k.direction)
    this.minAngle = radians(k.minAngle)
    this.faces = Object.freeze(k.faces.map((fd) => Object.freeze({ face: toThree(fd.face, like) as BrepFace, minAngle: radians(fd.minAngle), maxAngle: radians(fd.maxAngle), kind: fd.kind })))
    this.#list = list
  }

  #kind(kind: string): ShapeList<BrepFace> {
    return this.#list(this.faces.filter((f) => f.kind === kind).map((f) => f.face))
  }

  /** Faces drafted at least `minAngle`. */
  get positive(): ShapeList<BrepFace> {
    return this.#kind('positive')
  }

  /** Faces drafted less than `minAngle`. */
  get insufficient(): ShapeList<BrepFace> {
    return this.#kind('insufficient')
  }

  /** Faces along the pull direction. */
  get vertical(): ShapeList<BrepFace> {
    return this.#kind('vertical')
  }

  /** Faces that hold the mold back. */
  get undercut(): ShapeList<BrepFace> {
    return this.#kind('undercut')
  }

  /** True when no face is insufficient, vertical or an undercut. */
  get ok(): boolean {
    return this.faces.every((f) => f.kind === 'positive')
  }

  /** A face's smallest and largest draft, in radians. */
  angles(face: BrepFace): [number, number] {
    const f = this.faces.find((x) => x.face === face)
    if (f === undefined) throw new RangeError('angles: the face is not one of the analysis')
    return [f.minAngle, f.maxAngle]
  }

  get length(): number {
    return this.faces.length
  }
}

/** The summary of a body (smlibpy's info()). */
export interface BodyInfo {
  readonly type: string
  readonly faces: number
  readonly edges: number
  readonly vertices: number
  readonly bbox: THREE.Box3
  readonly corners?: string
  readonly solids?: number
  readonly voids?: number
}

/** @internal */
export function infoOf(k: { type: string; faces: number; edges: number; vertices: number; bbox: [number[], number[]]; corners?: string; solids?: number; voids?: number }): BodyInfo {
  const box = toThree(new sm.BoundBox(k.bbox[0], k.bbox[1]), null) as THREE.Box3
  return Object.freeze({ ...k, bbox: box })
}
