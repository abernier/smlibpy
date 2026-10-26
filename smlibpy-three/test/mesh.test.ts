// Triangle meshes: a TriangleMesh is a THREE.Mesh whose geometry is its triangles (Y up), placed by
// its transform as a body is; its operations take other meshes where they are and give results
// where it is, with its transform, name and material.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, Cylinder, MassProperties, ModelingError, Part, Sphere, Wire } from '../src/index.ts'
import { TriangleMesh, tessellate } from '../src/mesh.ts'
import { box, close, closeBox, closeVector, ray, Y } from './_util.ts'

// every class smlibwasm exports, to find any of them in what the package gives
const KERNEL_CLASSES = (Object.values(sm) as unknown[]).filter((v): v is new () => object => typeof v === 'function' && /^[A-Z]/.test(v.name))

/** Fails if `value`, or anything reachable through its enumerable properties, is one of smlibwasm's. */
function noKernel(value: unknown, path = 'value', seen = new Set<unknown>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const cls of KERNEL_CLASSES) assert.ok(!(value instanceof cls), `${path} is smlibwasm's ${cls.name}`)
  if (ArrayBuffer.isView(value)) return
  for (const [key, v] of Object.entries(value)) noKernel(v, `${path}.${key}`, seen)
}

/** Counts 'dispose' events of an object (a geometry, a material, an Object3D). */
function disposals(target: unknown): { count: number } {
  const seen = { count: 0 }
  ;(target as THREE.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => seen.count++)
  return seen
}

/** A box's moment of inertia about its center, about the axis across sides `a` and `b`. */
const ixxOf = (mass: number, a: number, b: number) => (mass * (a ** 2 + b ** 2)) / 12

/** The volume a geometry of triangles encloses (the divergence theorem, in three's own numbers). */
function volumeOf(geometry: THREE.BufferGeometry): number {
  const g = geometry.index === null ? geometry : geometry.toNonIndexed()
  const p = g.getAttribute('position')
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  let sum = 0
  for (let i = 0; i < p.count; i += 3) sum += a.fromBufferAttribute(p, i).dot(b.fromBufferAttribute(p, i + 1).cross(c.fromBufferAttribute(p, i + 2)))
  return sum / 6
}

test("a box's TriangleMesh: a THREE.Mesh of its triangles in three's axes, closed, measured", () => {
  const part = new Box(10, 20, 30) // 10 along x, 20 along z, 30 high
  const mesh = new TriangleMesh(part)
  assert.ok(mesh instanceof THREE.Mesh && mesh instanceof TriangleMesh)
  assert.equal(mesh.isMesh, true)
  assert.equal(mesh.isTriangleMesh, true)
  assert.equal(mesh.type, 'Mesh')
  assert.equal(mesh.triangleCount, 12)
  close(mesh.volume, 6000, 1e-9)
  close(mesh.area, 2 * (10 * 20 + 10 * 30 + 20 * 30), 1e-9)
  closeBox(mesh.bbox(), box([-5, -15, -10], [5, 15, 10]), 1e-12)
  assert.ok(mesh.isClosed())
  closeVector(mesh.center(), { x: 0, y: 0, z: 0 }, 1e-12)
  closeVector(mesh.centroid, { x: 0, y: 0, z: 0 }, 1e-9)
  // the geometry: the triangles in the kernel's order, a point split where the faces' normals
  // differ (24 points, as BoxGeometry has), the triangles' normals pointing out
  const g = mesh.geometry
  assert.ok(g instanceof THREE.BufferGeometry)
  assert.equal(g.getIndex()!.count, 36)
  assert.equal(g.getAttribute('position').count, 24)
  const normals = mesh.triangleNormals
  assert.ok(normals instanceof Float32Array && normals.length === 36)
  const index = g.getIndex()!
  const position = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const [p, n, mid] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  for (let t = 0; t < 12; t++) {
    const own = new THREE.Vector3(normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2])
    mid.set(0, 0, 0)
    for (let c = 0; c < 3; c++) {
      closeVector(n.fromBufferAttribute(normal, index.getX(t * 3 + c)), own, 1e-6, `triangle ${t}`)
      mid.add(p.fromBufferAttribute(position, index.getX(t * 3 + c)))
    }
    assert.ok(mid.dot(own) > 0, `triangle ${t} faces in`)
  }
  // mass properties: the inertia in three's axes (the box is 30 along y, 20 along z)
  const mp = mesh.massProperties(2)
  assert.ok(mp instanceof MassProperties)
  close(mp.mass, 12000, 1e-6)
  close(mp.volume, 6000, 1e-9)
  assert.ok(mp.center instanceof THREE.Vector3 && mp.inertia instanceof THREE.Matrix3)
  // (principal moments as the kernel gives them)
  assert.deepEqual([...mp.principalMoments].map((m) => Math.round(m)), [ixxOf(12000, 10, 20), ixxOf(12000, 10, 30), ixxOf(12000, 30, 20)].map(Math.round).sort((a, b) => a - b))
  const [ixx, , , , iyy, , , , izz] = mp.inertia.elements
  close(ixx, (12000 * (30 ** 2 + 20 ** 2)) / 12, 1e-3)
  close(iyy, (12000 * (10 ** 2 + 20 ** 2)) / 12, 1e-3)
  close(izz, (12000 * (10 ** 2 + 30 ** 2)) / 12, 1e-3)
  // bodies are taken where they are in the world
  const moved = new Box(10, 20, 30)
  moved.position.set(100, 0, 0)
  closeBox(new TriangleMesh(moved).bbox(), box([95, -15, -10], [105, 15, 10]), 1e-9)
})

test('tessellate: bodies where they are, in the frame of the first, with its transform and material', () => {
  const a = new Box(10, 10, 10)
  a.position.set(50, 0, 0)
  a.name = 'a'
  const material = new THREE.MeshStandardMaterial({ color: 'tomato' })
  a.material = material
  const b = new Sphere(5)
  b.position.set(50, 20, 0)
  const mesh = tessellate([a, b], 0.01)
  assert.ok(mesh instanceof TriangleMesh)
  closeVector(mesh.position, a.position, 0)
  assert.equal(mesh.name, 'a')
  assert.equal(mesh.material, material)
  // in a's frame: a around its origin, b 20 above it
  closeBox(mesh.bbox(), box([-5, -5, -5], [5, 25, 5]), 0.02)
  closeBox(new THREE.Box3().setFromObject(mesh), box([45, -5, -5], [55, 25, 5]), 0.02)
  const ball = (4 / 3) * Math.PI * 125
  close(mesh.volume, 1000 + ball, ball * 1e-2)
  // the constructor takes them into the world's frame
  const world = new TriangleMesh([a, b], null, { tolerance: 0.01 })
  closeVector(world.position, { x: 0, y: 0, z: 0 }, 0)
  closeBox(world.bbox(), box([45, -5, -5], [55, 25, 5]), 0.02)
  // the angle in radians, maxEdge
  const coarse = tessellate(new Cylinder(10, 10), 100, Math.PI / 4)
  const fine = tessellate(new Cylinder(10, 10), 100, Math.PI / 36)
  assert.ok(fine.triangleCount > 3 * coarse.triangleCount, `${fine.triangleCount} and ${coarse.triangleCount} triangles`)
  const plate = tessellate(new Box(100, 100, 10), null, undefined, { maxEdge: 10 })
  assert.ok(plate.triangleCount > 100, `${plate.triangleCount} triangles`)
  // a face: in its body's frame
  const face = a.faces().top().one()
  const top = tessellate(face)
  closeVector(top.position, a.position, 0)
  closeBox(top.bbox(), box([-5, 5, -5], [5, 5, 5]), 1e-9)
  close(top.area, 100, 1e-9)
  assert.throws(() => tessellate([]), TypeError)
  assert.throws(() => new TriangleMesh(new THREE.Mesh() as never), /BufferGeometry/)
})

// (Body.toMesh is proposed for shapes.ts: this runs once it is there)
type ToMesh = { toMesh(options?: { tolerance?: number | null; angle?: number; maxEdge?: number | null }): TriangleMesh }
test('Body.toMesh: in its frame, with its transform and material, as finely as its geometry', { skip: !('toMesh' in Part.prototype) }, () => {
  const part = new Box(10, 20, 30).cut(new Cylinder(3, 40))
  part.position.set(5, 6, 7)
  part.tolerance = 0.01
  const mesh = (part as unknown as ToMesh).toMesh()
  assert.ok(mesh instanceof TriangleMesh)
  assert.equal(mesh.material, part.material)
  closeVector(mesh.position, part.position, 0)
  assert.equal(mesh.triangleCount, part.geometry.getIndex()!.count / 3)
  close(mesh.volume, part.volume, 1e-3 * part.volume)
  assert.ok((part as unknown as ToMesh).toMesh({ tolerance: 1, angle: Math.PI / 4 }).triangleCount < mesh.triangleCount)
})

test('a BufferGeometry is welded by position into one mesh, its normals kept', () => {
  const g = new THREE.BoxGeometry(10, 20, 30) // three's: 10 wide, 20 high, 30 deep, split per face
  const mesh = new TriangleMesh(g)
  assert.ok(mesh.isClosed())
  assert.equal(mesh.triangleCount, 12)
  close(mesh.volume, 6000, 1e-9)
  closeBox(mesh.bbox(), box([-5, -10, -15], [5, 10, 15]), 1e-12)
  // drawn as BoxGeometry is: 24 points with the faces' normals
  assert.equal(mesh.geometry.getAttribute('position').count, 24)
  // an icosphere (not indexed, its normals smooth): 42 points, each normal the point's direction
  const ico = new THREE.IcosahedronGeometry(10, 1)
  const sphere = new TriangleMesh(ico)
  assert.equal(sphere.triangleCount, 80)
  assert.ok(sphere.isClosed())
  close(sphere.volume, volumeOf(ico), 1e-6)
  const position = sphere.geometry.getAttribute('position')
  const normal = sphere.geometry.getAttribute('normal')
  assert.equal(position.count, 42)
  const [p, n] = [new THREE.Vector3(), new THREE.Vector3()]
  for (let i = 0; i < position.count; i++) closeVector(n.fromBufferAttribute(normal, i), p.fromBufferAttribute(position, i).normalize(), 1e-6)
  // without normals: each triangle's own (no two triangles of it lie in one plane)
  const bare = ico.clone()
  bare.deleteAttribute('normal')
  assert.equal(new TriangleMesh(bare).geometry.getAttribute('position').count, 240)
  // an empty mesh, and a geometry without points
  const empty = new TriangleMesh()
  assert.equal(empty.triangleCount, 0)
  close(empty.volume, 0)
  assert.throws(() => empty.bbox(), RangeError)
  assert.equal(empty.geometry.getAttribute('position').count, 0)
  assert.deepEqual(ray([0, 50, 0], [0, -1, 0]).intersectObject(empty), [])
  assert.throws(() => new TriangleMesh(new THREE.BufferGeometry()), /no positions/)
})

test('mesh Booleans take the other meshes where they are, and give results where the receiver is', () => {
  const a = new TriangleMesh(new THREE.BoxGeometry(20, 20, 20))
  a.position.set(0, 5, 0)
  a.name = 'a'
  const material = new THREE.MeshStandardMaterial({ color: 'teal' })
  a.material = material
  const b = new TriangleMesh(new THREE.BoxGeometry(20, 20, 20))
  b.position.set(10, 5, 0) // half of it in a
  const fused = a.fuse(b)
  const cut = a.cut(b)
  const common = a.intersect(b)
  close(fused.volume, 12000, 1e-6)
  close(cut.volume, 4000, 1e-6)
  close(common.volume, 4000, 1e-6)
  // in a's frame
  closeBox(fused.bbox(), box([-10, -10, -10], [20, 10, 10]), 1e-9)
  closeBox(cut.bbox(), box([-10, -10, -10], [0, 10, 10]), 1e-9)
  closeBox(common.bbox(), box([0, -10, -10], [10, 10, 10]), 1e-9)
  // results replace the receiver: its transform, name and material
  for (const r of [fused, cut, common]) {
    assert.ok(r instanceof TriangleMesh && r.isClosed())
    closeVector(r.position, a.position, 0)
    assert.equal(r.name, 'a')
    assert.equal(r.material, material)
  }
  // the inputs are as they were
  close(a.volume, 8000, 1e-9)
  closeBox(b.bbox(), box([-10, -10, -10], [10, 10, 10]), 1e-12)
  // an operand turned in a group: a bar along z through a's middle (4 by 4)
  const group = new THREE.Group()
  group.position.set(0, 5, 10)
  group.rotation.y = Math.PI / 2
  const bar = new TriangleMesh(new THREE.BoxGeometry(40, 4, 4))
  group.add(bar)
  close(a.cut(bar).volume, 8000 - 4 * 4 * 20, 1e-6)
  // several at once: a, b and the bar where it sticks out of them (z from 10 to 30)
  close(a.fuse(b, bar).volume, 12000 + 4 * 4 * 20, 1e-6)
  assert.throws(() => a.fuse(), RangeError)
  assert.throws(() => a.fuse(new Box(1, 1, 1) as never), /TriangleMesh/)
  // mirrored in a plane of its frame: still facing out
  const right = new TriangleMesh(new THREE.BoxGeometry(10, 10, 10).translate(5, 0, 0))
  const left = right.mirror(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0))
  closeBox(left.bbox(), box([-10, -5, -5], [0, 5, 5]), 1e-12)
  close(left.volume, 1000, 1e-9)
})

test('section and slices cut a Y-up mesh: horizontal loops, layers from the bottom up', () => {
  const mesh = new TriangleMesh(new Cylinder(10, 40), null, { tolerance: 0.001 }) // y from -20 to 20
  mesh.position.set(0, 100, 0)
  const loops = mesh.section(new THREE.Plane(Y, -5)) // y = 5, in the mesh's frame
  assert.equal(loops.length, 1)
  const [loop] = loops
  assert.ok(loop instanceof Wire && loop.isClosed)
  // at y = 5 in the mesh's frame, placed where the mesh is
  const b = loop.bbox()
  close(b.min.y, 5, 1e-9)
  close(b.max.y, 5, 1e-9)
  close(b.max.x, 10, 1e-3)
  close(b.min.z, -10, 1e-3)
  closeVector(loop.position, mesh.position, 0)
  // counterclockwise seen from the plane's normal (+y), as smlibpy's sections run
  const turn = new THREE.Vector3()
  for (const e of loop.edges()) turn.add(e.start.cross(e.end))
  assert.ok(turn.y > 0 && Math.abs(turn.x) < 1e-6 * turn.y && Math.abs(turn.z) < 1e-6 * turn.y)
  // a region of it: the circle's
  close(loop.toSketch().area, Math.PI * 100, 0.5)
  // layers 10 thick from the bottom up, each cut in its middle: y = -15, -5, 5, 15
  const layers = mesh.slices(10)
  assert.equal(layers.length, 4)
  layers.forEach((wires, i) => {
    assert.equal(wires.length, 1)
    close(wires[0].bbox().min.y, -15 + 10 * i, 1e-9)
    close(wires[0].bbox().max.y, -15 + 10 * i, 1e-9)
  })
  // across x
  const across = mesh.slices(5, new THREE.Vector3(1, 0, 0))
  assert.equal(across.length, 4)
  for (const [w] of across) close(w.bbox().min.x, w.bbox().max.x, 1e-9)
  // a plane that misses it
  assert.equal(mesh.section(new THREE.Plane(Y, -50)).length, 0)
})

test('decimate thins a mesh out; fillHoles and repaired close one', () => {
  const sphere = new TriangleMesh(new Sphere(10), null, { tolerance: 0.02 })
  sphere.position.x = 7
  const n = sphere.triangleCount
  const half = sphere.decimate(0.5)
  assert.ok(half.triangleCount > 0.4 * n && half.triangleCount < 0.6 * n, `${half.triangleCount} of ${n}`)
  assert.ok(half.isClosed())
  close(half.volume, sphere.volume, sphere.volume * 1e-2)
  closeVector(half.position, sphere.position, 0)
  const few = sphere.decimate(null, { triangles: 500 })
  assert.ok(Math.abs(few.triangleCount - 500) < 50, `${few.triangleCount} triangles`)
  const near = sphere.decimate(null, { tolerance: 0.1, featureAngle: Math.PI / 4 })
  assert.ok(near.triangleCount < n && near.isClosed())
  assert.throws(() => sphere.decimate(0.5, { triangles: 10 }), TypeError)
  // a box without one of its triangles: open; filled or repaired, closed again
  const g = new THREE.BoxGeometry(10, 10, 10)
  g.setIndex(Array.from(g.getIndex()!.array).slice(3))
  const open = new TriangleMesh(g)
  assert.equal(open.isClosed(), false)
  assert.throws(() => open.massProperties(), ModelingError)
  const filled = open.fillHoles()
  assert.ok(filled.isClosed())
  close(filled.volume, 1000, 1e-9)
  const [repaired, report] = open.repaired()
  assert.ok(repaired instanceof TriangleMesh && repaired.isClosed())
  close(repaired.volume, 1000, 1e-9)
  assert.equal(report.filledHoles, 1)
  assert.equal(report.openEdges, 0)
  assert.equal(report.openHoles, 0)
})

test('toPart: a faceted part of a closed mesh, where the mesh is', () => {
  const mesh = new TriangleMesh(new THREE.BoxGeometry(10, 20, 30))
  mesh.position.set(1, 2, 3)
  mesh.name = 'block'
  const part = mesh.toPart()
  assert.ok(part instanceof Part)
  close(part.volume, 6000, 1e-6)
  assert.equal(part.faces().length, 6)
  closeBox(part.bbox(), box([-5, -10, -15], [5, 10, 15]), 1e-9)
  closeVector(part.position, mesh.position, 0)
  assert.equal(part.name, 'block')
  // a part's own material, unless the app gave the mesh one
  assert.notEqual(part.material, mesh.material)
  const mine = new THREE.MeshPhongMaterial()
  mesh.material = mine
  assert.equal(mesh.toPart().material, mine)
  // too many faces for fast Booleans: decimate first
  const ball = new TriangleMesh(new Sphere(10), null, { tolerance: 0.05 })
  assert.throws(() => ball.toPart(100), ModelingError)
})

test('clone and copy share the kernel mesh and the geometry; dispose frees them with the last one', () => {
  const mesh = new TriangleMesh(new Sphere(5))
  mesh.position.set(1, 2, 3)
  const clone = mesh.clone()
  assert.ok(clone instanceof TriangleMesh)
  assert.equal(clone.geometry, mesh.geometry)
  assert.equal(clone.material, mesh.material)
  closeVector(clone.position, mesh.position, 0)
  assert.equal(clone.volume, mesh.volume)
  const geometry = disposals(mesh.geometry)
  const own = disposals(mesh.material)
  const object = disposals(mesh)
  mesh.dispose()
  assert.equal(geometry.count, 0) // (the clone draws it)
  assert.equal(own.count, 1)
  assert.equal(object.count, 1)
  assert.throws(() => mesh.volume, /disposed/)
  assert.throws(() => clone.cut(mesh), /disposed/)
  assert.ok(clone.volume > 0)
  // a disposed mesh draws what it drew (three uploads a disposed geometry again)
  assert.ok(mesh.geometry.getAttribute('position').count > 0)
  clone.dispose()
  clone.dispose()
  assert.equal(geometry.count, 1)
  // an assigned material is the app's; an assigned geometry changes what is drawn, not the mesh
  const mine = new THREE.MeshBasicMaterial()
  const cube = new TriangleMesh(new THREE.BoxGeometry(1, 1, 1), mine)
  const drawn = cube.geometry
  const other = new THREE.SphereGeometry(1)
  cube.geometry = other
  assert.equal(cube.geometry, other)
  close(cube.volume, 1, 1e-12)
  cube.geometry = null as never
  assert.equal(cube.geometry, drawn)
  const assigned = disposals(mine)
  cube.dispose()
  assert.equal(assigned.count, 0)
  // copy into an empty mesh
  const empty = new TriangleMesh()
  empty.copy(new TriangleMesh(new THREE.BoxGeometry(2, 2, 2)))
  close(empty.volume, 8, 1e-12)
})

test("intersectRay: the kernel's cast on the triangles, in the mesh's frame; three's Raycaster agrees", () => {
  const mesh = new TriangleMesh(new THREE.BoxGeometry(10, 10, 10))
  mesh.position.set(100, 0, 0)
  mesh.rotation.y = Math.PI / 4
  mesh.updateMatrixWorld()
  const down = new THREE.Ray(new THREE.Vector3(1, 50, 2), new THREE.Vector3(0, -1, 0)) // in the mesh's frame
  const hits = mesh.intersectRay(down)
  assert.equal(hits.length, 2)
  closeVector(hits[0].point, { x: 1, y: 5, z: 2 }, 1e-9)
  close(hits[0].distance, 45, 1e-9)
  closeVector(hits[0].normal, Y, 1e-9)
  closeVector(hits[1].point, { x: 1, y: -5, z: 2 }, 1e-9)
  closeVector(hits[1].normal, { x: 0, y: -1, z: 0 }, 1e-9)
  assert.equal(hits[0].face, null) // (a RayHit on no face: on a triangle)
  // the same ray in the world, cast by three's Raycaster (both sides: its material is double sided)
  const world = down.clone().applyMatrix4(mesh.matrixWorld)
  const three = new THREE.Raycaster(world.origin, world.direction).intersectObject(mesh)
  assert.equal(three.length, 2)
  assert.equal(three[0].object, mesh)
  closeVector(mesh.worldToLocal(three[0].point.clone()), hits[0].point, 1e-5)
  // three's faceIndex is the kernel's triangle
  assert.equal(three[0].faceIndex, hits[0].triangle)
  assert.equal(three[1].faceIndex, hits[1].triangle)
  // many rays at once: the first hit of each, null where one misses
  const many = mesh.intersectRays([down, new THREE.Ray(new THREE.Vector3(50, 50, 0), new THREE.Vector3(0, -1, 0))])
  assert.equal(many.length, 2)
  closeVector(many[0]!.point, hits[0].point, 1e-9)
  assert.equal(many[0]!.triangle, hits[0].triangle)
  assert.equal(many[1], null)
  assert.deepEqual(mesh.intersectRays([]), [])
})

test('a mesh for three: Box3, toJSON, exporters', async () => {
  const mesh = new TriangleMesh(new Cylinder(5, 10))
  mesh.position.y = 20
  mesh.updateMatrixWorld()
  closeBox(new THREE.Box3().setFromObject(mesh), box([-5, 15, -5], [5, 25, 5]), 1e-5)
  const back = new THREE.ObjectLoader().parse(mesh.toJSON())
  assert.ok(back instanceof THREE.Mesh && !(back instanceof TriangleMesh))
  assert.equal((back as THREE.Mesh).geometry.getAttribute('position').count, mesh.geometry.getAttribute('position').count)
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js')
  const stl = new STLExporter().parse(mesh) as string
  assert.equal(stl.match(/facet normal/g)!.length, mesh.triangleCount)
})

test('nothing of smlibwasm comes out', () => {
  const mesh = new TriangleMesh(new Box(20, 20, 20).cut(new Cylinder(4, 30)), null, { tolerance: 0.05 })
  const other = new TriangleMesh(new THREE.BoxGeometry(10, 10, 10))
  other.position.set(10, 10, 10)
  const results: unknown[] = [
    mesh,
    mesh.geometry,
    mesh.bbox(),
    mesh.center(),
    mesh.centroid,
    mesh.massProperties(),
    mesh.triangleNormals,
    mesh.section(new THREE.Plane(Y, 0)),
    mesh.slices(5),
    mesh.intersectRay(new THREE.Ray(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0))),
    mesh.intersectRays([new THREE.Ray(new THREE.Vector3(6, 50, 0), new THREE.Vector3(0, -1, 0))]),
    mesh.decimate(0.3),
    mesh.fillHoles(),
    mesh.repaired(),
    mesh.toPart(),
    mesh.fuse(other),
    mesh.mirror(new THREE.Plane(Y, 0)),
    mesh.clone(),
    tessellate(new Sphere(3)),
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
  // and its errors are the package's
  let error: unknown
  try {
    new TriangleMesh(new THREE.PlaneGeometry(1, 1)).massProperties() // (open: it encloses nothing)
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof ModelingError, String(error))
  assert.ok(!(error instanceof sm.ModelingError))
  noKernel(error, 'error')
})
