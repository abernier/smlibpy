// The functions a test worker exposes (lane_WN_worker.ts runs them in a worker, lane_WN.test.ts
// calls them): plain smlibwasm functions, as an app's models module has them.

import {
  Axis, BoundBox, Box, Cylinder, GridLocations, Line, Location, ModelingError, Plane, Rectangle, Vector, Z, type Edge, type Face, type Part,
} from '../src/index.ts'
import { k, kernelCall, memoryUsage } from '../src/kernel.ts'
import { setGuardSeconds } from '../src/defeature.ts'
import { model } from '../examples/enclosure.ts'
import type { Mesh } from '../src/mesh.ts'

export function plate(w: number, holes: number, r: number): Part {
  const body = Box(w, 60, 10)
  const rounded = body.fillet(body.edges().parallelTo(Z), r)
  return rounded.cut(GridLocations((w - 20) / Math.max(1, holes - 1), 40, holes, 2).mul(Cylinder(3, 10)))
}

export const volume = (part: Part): number => part.volume

export const filleted = (part: Part, edge: Edge, r: number): Part => part.fillet(edge, r)

/** Whether a face came with its own body (the same object). */
export const sameOwner = (part: Part, face: Face): boolean => face.owner === part

export const echo = (value: unknown): unknown => value

export const named = (part: Part, name: string): Part => part.named(name).colored('steelblue')

export const sketch = () => Rectangle(20, 10, { fillet: 2 }).on(new Plane([0, 0, 5], [0, 1, 0], [1, 0, 0])).named('tab')

export const geometry = () => ({
  vector: new Vector(1, 2, 3),
  location: new Location([10, 20, 30], [15, 25, 35]),
  plane: new Plane([1, 2, 3], [0, 1, 0], [1, 0, 0]),
  axis: new Axis([0, 0, 1], [1, 1, 0]),
  box: new BoundBox([-1, -2, -3], [4, 5, 6]),
  list: [1, 'two', { three: 3 }],
  bytes: new Uint8Array([1, 2, 3]),
})

let kept: Mesh | null = null

/** A mesh this worker keeps: sending it must leave the worker's own arrays as they are. */
export function keptMesh(part: Part): Mesh {
  kept ??= part.mesh(0.05)
  return kept
}

export const keptLength = (): number => kept?.vertices.length ?? -1

export const triangles = (mesh: Mesh): number => mesh.length

export const faces = (part: Part) => part.faces().filter((f) => f.geomType === 'plane')

export const standaloneEdge = (): Edge => Line([0, 0, 0], [1, 0, 0])

export function fail(kind: string): never {
  if (kind === 'modeling') throw new ModelingError('this cannot be done: try something else')
  if (kind === 'kernel') return kernelCall('test step', () => k.create_box([0, 0, 0], -1, 1, 1), 'is the box size positive?') as never
  if (kind === 'type') throw new TypeError('not a part')
  if (kind === 'range') throw new RangeError('too far')
  throw new Error(`failed: ${kind}`)
}

/** Memory that cannot be had (4 GB for an array of pointers): the kernel's out-of-memory error. */
export const outOfMemory = (): unknown => kernelCall('test step', () => k.create_planar_faces({ length: 2 ** 30 - 1 }))

/** A trap of the module, as the kernel crashing makes one. */
export function crash(): never {
  throw new WebAssembly.RuntimeError('memory access out of bounds')
}

/** The kernel step that loops for good (W2's case): the outer bottom round of the enclosure
 * example, taken out without the probe worker, as on a page's main thread. */
export function loopingStep(): number {
  setGuardSeconds(0)
  const box = model()[0]
  const round = box.faces().fillets().filter((f) => f.center().z < 2 && f.geomType === 'cylinder').slice(0, 1)
  return box.removeFillets(round).volume
}

/** Works (without a pause) for `ms` milliseconds; for good when it is negative. */
export function spin(ms: number): number {
  const end = ms < 0 ? Infinity : Date.now() + ms
  let n = 0
  while (Date.now() < end) n++
  return n
}

export const later = (value: number, ms: number): Promise<number> => new Promise((done) => setTimeout(() => done(value), ms))

/** Which worker answers. */
export const thread = (): number => (globalThis as any).process.getBuiltinModule('node:worker_threads').threadId

/** A real trap of the kernel (a read far beyond its memory) whose error the function catches: it
 * returns the crashes its kernel counted (W10). */
export function caughtCrash(): number {
  try {
    k.brep_face_count(0xf0000000)
  } catch {
    // (the crash, caught)
  }
  return memoryUsage().crashes
}

/** The crashes this worker's kernel counted so far (W10). */
export const crashes = (): number => memoryUsage().crashes

/** Two holes whose seams lie tangent to each other: a Boolean the kernel refuses (N6's trace). */
// (a cut the kernel fails: the crossing holes this was named for fuse now, lane BT: B4)
export const crossingHoles = (): Part =>
  Box(20, 20, 20)
    .cut(Cylinder(3, 40).rotate(Axis.Z, 45))
    .cut(Cylinder(2, 40).rotate(Axis.Z, 45).rotate(Axis.X, 90).translate(1, 0, 0))
