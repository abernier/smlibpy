// The functions the test worker exposes (_worker.ts runs them in a worker, worker.test.ts calls
// them): plain smlibpy-three, as an app's models module has them.
import * as THREE from 'three'
import { Box, Cylinder, BrepEdge, BrepFace, FontError, GridLocations, KernelError, Segment, ModelingError, Part, STEPLoader, TriangleMesh, BrepVertex, Wire, type Sketch } from '../src/index.ts'
import { sm } from '../src/kernel.ts'

const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

/** A plate with rounded corners and four holes, named and placed: lying in the XY plane, 10 thick
 * along z (as a sketch extruded), its holes on a grid in the XY plane, along z. */
export function plate(width: number): Part {
  const box = new Box(width, 60, 10)
  const hole = new Cylinder(3, 3, 20)
  hole.rotation.x = Math.PI / 2 // (a cylinder stands along y: turned along z)
  const part = box.fillet(box.edges().parallelTo(Z), 6).cut(hole.at(GridLocations(width - 20, 40, 2, 2)))
  part.name = 'plate'
  part.position.set(10, 20, 30)
  part.rotation.set(0.1, 0.5, 0)
  return part
}

export const volume = (part: Part): number => part.volume

export const round = (part: Part, edge: BrepEdge | Wire, radius: number): Part => part.fillet(edge, radius)

export const cut = (part: Part, tool: Part): Part => part.cut(tool)

export const extrude = (sketch: Sketch, amount: number): Part => sketch.extrude(amount)

/** What a face is over there: whether it came with its own body (the same object), its place and
 * its center (in its body's frame). */
export const faceInfo = (part: Part, face: BrepFace) => ({ same: face.owner === part, index: face.index, center: face.center(), area: face.area })

/** What a vertex and an edge are over there. */
export const subInfo = (part: Part, vertex: BrepVertex, edge: BrepEdge) => ({
  same: vertex.owner === part && edge.owner === part,
  point: vertex.point,
  length: edge.length,
})

/** A curve over there: its kind, length and owner. */
export const curveInfo = (curve: BrepEdge | Wire, part: Part | null = null) => ({
  type: curve instanceof BrepEdge ? curve.geomType : 'wire',
  length: curve.length,
  owned: part !== null && curve.owner === part,
  position: curve.position.toArray(),
})

export const echo = (value: unknown): unknown => value

/** A point moved by a matrix: three's values, used over there. */
export const moved = (point: THREE.Vector3, matrix: THREE.Matrix4): THREE.Vector3 => point.clone().applyMatrix4(matrix)

/** three's values made over there. */
export const values = () => ({
  v2: new THREE.Vector2(1, 2),
  v3: new THREE.Vector3(1, 2, 3),
  v4: new THREE.Vector4(1, 2, 3, 4),
  q: new THREE.Quaternion().setFromAxisAngle(Y, 0.5),
  e: new THREE.Euler(0.1, 0.2, 0.3, 'ZXY'),
  m3: new THREE.Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9),
  m4: new THREE.Matrix4().makeRotationY(0.5).setPosition(1, 2, 3),
  color: new THREE.Color(0.25, 0.5, 0.75),
  plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -4),
  ray: new THREE.Ray(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0, 1)),
  box2: new THREE.Box2(new THREE.Vector2(-1, -2), new THREE.Vector2(3, 4)),
  box3: new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(4, 5, 6)),
  sphere: new THREE.Sphere(new THREE.Vector3(1, 2, 3), 4),
  line3: new THREE.Line3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)),
  geometry: new THREE.BoxGeometry(2, 3, 4),
})

/** A curve of its own and a group of parts, one of them in a material of its own. */
export function assembly() {
  const line = new Segment(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0))
  line.position.y = 5
  line.name = 'axis'
  const group = new THREE.Group()
  group.name = 'assembly'
  group.position.x = 100
  const base = new Box(40, 10, 40) // (10 high)
  base.name = 'base'
  const pin = new Cylinder(4, 4, 30) // (standing on the base)
  pin.name = 'pin'
  pin.position.y = 20
  pin.material = new THREE.MeshStandardMaterial({ color: 'red' })
  group.add(base, pin)
  return { line, group }
}

/** The color and name of a body's material over there. */
export const materialOf = (part: Part) => {
  const m = part.material as THREE.MeshStandardMaterial
  return { name: m.name, color: m.color.getHex() }
}

/** A STEP file's bodies, read over there. */
export const readStep = (text: string): THREE.Group => new STEPLoader().parse(text)

export function fail(kind: string): unknown {
  if (kind === 'modeling') throw new ModelingError('this cannot be done: try something else')
  if (kind === 'fillet') {
    const box = new Box(10, 10, 10)
    return box.fillet(box.edges(), 20)
  }
  if (kind === 'type') throw new TypeError('not a part')
  if (kind === 'range') throw new RangeError('too far')
  if (kind === 'font') throw new FontError('not a font')
  if (kind === 'kernel') {
    throw new KernelError('a message of its own', { operation: 'step', status: 'SM_ERR_INVALID_INPUT', hint: 'is it positive?', trace: ['SM_ERR at Step.cpp:12 (Run)'] })
  }
  // (one of smlibwasm's own, as none should get this far: the package's there)
  if (kind === 'raw') throw new sm.KernelError('raw step', 'what the kernel said', 'SM_ERR_FAILURE', null)
  if (kind === 'memory') throw new KernelError('step failed (SM_ERR_OUT_OF_MEMORY)', { operation: 'step', status: 'SM_ERR_OUT_OF_MEMORY', hint: null, trace: [] })
  if (kind === 'crash') throw new WebAssembly.RuntimeError('memory access out of bounds')
  throw new Error(`failed: ${kind}`)
}

/** Works (without a pause) for `ms` milliseconds; for good when it is negative. */
export function spin(ms: number): number {
  const end = ms < 0 ? Infinity : Date.now() + ms
  let n = 0
  while (Date.now() < end) n++
  return n
}

export const later = (value: number, ms: number): Promise<number> => new Promise((done) => setTimeout(() => done(value), ms))

let ticks = 0

/** Counts the calls that reach it (whatever they bring), in the order they come. */
export const tick = (..._: unknown[]): number => ++ticks

/** Which worker answers. */
export const thread = (): number => (globalThis as { process: { getBuiltinModule(name: string): { threadId: number } } }).process.getBuiltinModule('node:worker_threads').threadId

/** Where objects are in the world over there. */
export const worlds = (...objects: THREE.Object3D[]): THREE.Matrix4[] =>
  objects.map((o) => {
    o.updateWorldMatrix(true, false)
    return o.matrixWorld.clone()
  })

/** A part's triangles, made over there, placed. */
export function meshOf(part: Part, tolerance: number): TriangleMesh {
  const mesh = new TriangleMesh(part, null, { tolerance })
  mesh.position.set(1, 2, 3)
  mesh.name = 'mesh'
  return mesh
}

/** What a triangle mesh is over there. */
export const meshInfo = (mesh: TriangleMesh) => ({ triangles: mesh.triangleCount, volume: mesh.volume, position: mesh.position.toArray() })

/** A part and its clone, in materials of two colors. */
export function clones(): Part[] {
  const part = new Box(10, 10, 10)
  part.material = new THREE.MeshStandardMaterial({ color: 0x0000ff })
  const clone = part.clone()
  clone.material = new THREE.MeshStandardMaterial({ color: 0xffff00 })
  return [part, clone]
}
