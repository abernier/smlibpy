// The worker entry: functions of smlibpy-three run in a worker (here a Node worker thread) and take
// and give the package's objects. Bodies cross with their transform, name and settings (and coming
// back with their tessellation, made in the worker: the calling thread only draws it), faces and
// edges as their body and their place in it, curves with their transform, three's values as
// three's, groups with their children; materials stay, as their color; errors arrive as the
// package's; a call that takes too long ends with its worker, and the next call gets a new one.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, Cylinder, BrepEdge, BrepFace, FontError, KernelError, Segment, ModelingError, Part, Polyline, Rectangle, STEPExporter, ShapeList, Sketch, Spline, TriangleMesh, Wire } from '../src/index.ts'
import { kernelOf } from '../src/shapes.ts'
import { counts } from '../src/tessellation.ts'
import { KernelWorker, expose, type Crossed } from '../src/worker.ts'
import type * as Models from './_worker_models.ts'
import { plate } from './_worker_models.ts'
import { close, closeBox, closeVector, noKernel, Y } from './_util.ts'

// (what a value's type is once it has crossed: the classes of the package's results; checked by tsc)
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const crossed: [
  Equal<Crossed<Box>, Part>,
  Equal<Crossed<Segment>, BrepEdge>,
  Equal<Crossed<Polyline>, Wire>,
  Equal<Crossed<Rectangle>, Sketch>,
  Equal<Crossed<{ part: Box; n: number }>, { part: Part; n: number }>,
  Equal<Crossed<[Box, Segment, string]>, [Part, BrepEdge, string]>,
  Equal<Crossed<Box[]>, Part[]>,
  Equal<Crossed<Map<string, Box>>, Map<string, Part>>,
  Equal<Crossed<ShapeList<BrepFace>>, ShapeList<BrepFace>>,
  Equal<Crossed<THREE.Vector3>, THREE.Vector3>,
  Equal<Crossed<THREE.Group>, THREE.Group>,
  Equal<Crossed<TriangleMesh>, TriangleMesh>,
] = [true, true, true, true, true, true, true, true, true, true, true, true]
void crossed

const WORKER = new URL('./_worker.ts', import.meta.url)
const cad = new KernelWorker<typeof Models>(WORKER)
after(() => cad.terminate())

/** The vertical edge of `part` nearest to (x, z) in its frame. */
const verticalEdge = (part: Part, x: number, z: number): BrepEdge => part.edges().parallelTo(Y).nearest(new THREE.Vector3(x, 0, z))

/** Fails unless two arrays (a geometry's) have the same length and items within `tol`. */
function closeArrays(actual: ArrayLike<number>, expected: ArrayLike<number>, tol: number, what: string): void {
  assert.equal(actual.length, expected.length, `${what}: length`)
  let worst = 0
  for (let i = 0; i < actual.length; i++) worst = Math.max(worst, Math.abs(actual[i] - expected[i]))
  assert.ok(worst <= tol, `${what}: ${worst} apart`)
}

test('a part made in the worker arrives as a Part, with its transform and name, exact', async () => {
  const part = await cad.call('plate', [80])
  assert.ok(part instanceof Part && part.isPart)
  const here = plate(80)
  // (the same body: its volume may differ in the last digits, as the copy's faces are met in another order)
  close(part.volume, here.volume, 1e-9 * here.volume, 'volume')
  assert.equal(part.faces().length, here.faces().length)
  closeBox(part.bbox(), here.bbox(), 1e-9, 'bbox')
  assert.equal(part.name, 'plate')
  closeVector(part.position, { x: 10, y: 20, z: 30 }, 0)
  assert.ok(part.quaternion.equals(here.quaternion))
  assert.equal(part.rotation.y, here.rotation.y)
  assert.equal(part.parent, null)
  // drawn, raycast and measured here as any part
  assert.ok(part.geometry.getAttribute('position').count > 0)
  await noKernel(part)
  // and back into the worker: the same body
  assert.equal(await cad.call('volume', [part]), part.volume)
})

test('a body from the worker brings its tessellation, made there: drawn and raycast here, it is not tessellated again', async () => {
  const before = counts.tessellated
  const part = await cad.call('plate', [80])
  // drawn: its faces and the lines of its edges, a face and an edge by themselves
  const drawn = part.geometry
  assert.ok(drawn.getAttribute('position').count > 0)
  assert.ok(part.edgeLines.geometry.getAttribute('position').count > 0)
  assert.ok(part.faces()[0].geometry.getAttribute('position').count > 0)
  assert.ok(part.edges()[0].geometry.getAttribute('position').count > 0)
  // raycast with three's Raycaster: down onto its top (+z in its frame), the face hit as `brep`
  part.updateMatrixWorld()
  const down = new THREE.Raycaster(new THREE.Vector3(0, 0, 50).applyMatrix4(part.matrixWorld), new THREE.Vector3(0, 0, -1).transformDirection(part.matrixWorld))
  const [hit] = down.intersectObject(part, false)
  assert.equal(hit.brep, part.faces().front().one())
  close(hit.distance, 45, 1e-4)
  assert.equal(counts.tessellated, before)
  // the same body made here is tessellated here, when three first reads its geometry
  const here = plate(80)
  const mine = here.geometry
  assert.equal(counts.tessellated, before + 1)
  // three draws the same of both (the same settings): the same triangles, positions within float
  // precision, and the same ranges of each face and edge, which raycasts find their faces by
  closeArrays(drawn.getAttribute('position').array, mine.getAttribute('position').array, 1e-5, 'positions')
  closeArrays(drawn.getAttribute('normal').array, mine.getAttribute('normal').array, 1e-6, 'normals')
  assert.deepEqual([...drawn.getIndex()!.array], [...mine.getIndex()!.array])
  const counted = (body: Part) => [...body.faces()].map((f) => f.geometry.getAttribute('position').count)
  assert.deepEqual(counted(part), counted(here))
  closeArrays(part.edgeLines.geometry.getAttribute('position').array, here.edgeLines.geometry.getAttribute('position').array, 1e-5, 'edge lines')
  here.updateMatrixWorld()
  const [mineHit] = down.intersectObject(here, false)
  close(hit.distance, mineHit.distance, 1e-5)
  assert.equal(hit.brep.index, (mineHit.brep as BrepFace).index)
  assert.equal(counts.tessellated, before + 1)
  // its settings changed here (finer than the 15 degrees between normals), it is tessellated here
  const triangles = drawn.getIndex()!.count / 3
  part.tolerance = 0.01
  assert.ok(part.geometry.getIndex()!.count / 3 > triangles)
  assert.equal(counts.tessellated, before + 2)
})

test('an edge picked here is rounded there; a face and a vertex cross as their body and their place in it', async () => {
  const part = new Box(60, 10, 40).cut(new Cylinder(5, 5, 20)) // (10 high, a hole down through it)
  part.position.set(-5, 2, 7)
  part.name = 'block'
  const edge = verticalEdge(part, 30, 20)
  const rounded = await cad.call('round', [part, edge, 4])
  assert.ok(rounded instanceof Part)
  close(rounded.volume, part.fillet(edge, 4).volume, 1e-9 * part.volume, 'volume')
  // the result has its receiver's transform and name, as here
  assert.ok(rounded.position.equals(part.position))
  assert.equal(rounded.name, 'block')
  // a face of the part: the same face of the same body there
  const top = part.faces().top().one()
  const info = await cad.call('faceInfo', [part, top])
  assert.equal(info.same, true)
  assert.equal(info.index, top.index)
  closeVector(info.center, top.center(), 1e-9)
  assert.ok(info.center instanceof THREE.Vector3)
  const vertex = part.vertices()[3]
  const sub = await cad.call('subInfo', [part, vertex, edge])
  assert.equal(sub.same, true)
  closeVector(sub.point, vertex.point, 1e-12)
  close(sub.length, edge.length, 1e-12)
  // a boundary loop of a face: the part's edges there, so the part rounds it
  const loop = top.outerWire()
  const rim = await cad.call('round', [part, loop, 1])
  close(rim.volume, part.fillet(loop, 1).volume, 1e-9 * part.volume, 'loop')
})

test('a seam crosses as its body and its place among the edges with the seams', async () => {
  const pipe = new Cylinder(5, 5, 10)
  const seam = pipe.edges({ seams: true }).filter((e) => e.isSeam)[0]
  const there = await cad.call('seamInfo', [pipe, seam])
  assert.equal(there.same, true)
  assert.equal(there.isSeam, true)
  assert.equal(there.index, -1)
  close(there.length, 10, 1e-9)
  const back = await cad.call('seam', [pipe])
  assert.equal(back.seam.owner, back.part)
  assert.ok(back.seam.isSeam)
  assert.ok(back.part.edges({ seams: true }).includes(back.seam))
})

test('operands are taken where they are in the world: a tool in another group cuts there as here', async () => {
  const a = new THREE.Group()
  a.position.set(50, 0, 0)
  a.rotation.y = 0.3
  const b = new THREE.Group()
  b.position.set(0, 0, 10)
  const part = new Box(40, 20, 30)
  part.position.set(-50, 0, 0)
  a.add(part)
  const tool = new Cylinder(6, 6, 50)
  tool.position.set(5, 0, -10)
  tool.rotation.x = Math.PI / 2 // (along z)
  b.add(tool)
  // over there each is where it is here in the world (in a stand-in of its parent)
  const worlds = await cad.call('worlds', [part, tool])
  for (const [i, o] of [part, tool].entries()) {
    o.updateWorldMatrix(true, false)
    worlds[i].elements.forEach((e, j) => close(e, o.matrixWorld.elements[j], 1e-12, `matrixWorld ${i}`))
  }
  const here = part.cut(tool)
  const there = await cad.call('cut', [part, tool])
  close(there.volume, here.volume, 1e-9 * here.volume, 'volume')
  closeBox(there.bbox(), here.bbox(), 1e-9, 'bbox')
  // (the result takes its receiver's place: its own transform, no parent)
  assert.ok(there.position.equals(part.position) && there.quaternion.equals(part.quaternion))
  assert.equal(there.parent, null)
  // parts that share a body arrive as clones: two objects, one body, each with its material
  const clone = part.clone()
  clone.position.x += 100
  const mine = new THREE.MeshStandardMaterial()
  clone.material = mine
  const [p, q] = (await cad.call('echo', [[part, clone]])) as Part[]
  assert.notEqual(p, q)
  assert.equal(kernelOf(p), kernelOf(q))
  assert.equal(q.position.x, clone.position.x)
  assert.equal(p.material, part.material)
  assert.equal(q.material, mine)
  // (made over there: clones in materials of their own colors)
  const [r, t] = (await cad.call('clones', [])) as Part[]
  assert.equal(kernelOf(r), kernelOf(t))
  assert.equal((r.material as THREE.MeshStandardMaterial).color.getHex(), 0x0000ff)
  assert.equal((t.material as THREE.MeshStandardMaterial).color.getHex(), 0xffff00)
})

test("three's values cross as three's: Vector3, Matrix4, Plane, Ray, Box3, Color and the others", async () => {
  const p = await cad.call('moved', [new THREE.Vector3(1, 2, 3), new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 0)])
  assert.ok(p instanceof THREE.Vector3)
  closeVector(p, new THREE.Vector3(1, 2, 3).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 0)), 1e-12)
  const v = await cad.call('values', [])
  assert.ok(v.v2 instanceof THREE.Vector2 && v.v2.equals(new THREE.Vector2(1, 2)))
  assert.ok(v.v3 instanceof THREE.Vector3 && v.v3.equals(new THREE.Vector3(1, 2, 3)))
  assert.ok(v.v4 instanceof THREE.Vector4 && v.v4.equals(new THREE.Vector4(1, 2, 3, 4)))
  assert.ok(v.q instanceof THREE.Quaternion && v.q.equals(new THREE.Quaternion().setFromAxisAngle(Y, 0.5)))
  assert.ok(v.e instanceof THREE.Euler && v.e.equals(new THREE.Euler(0.1, 0.2, 0.3, 'ZXY')))
  assert.ok(v.m3 instanceof THREE.Matrix3 && v.m3.equals(new THREE.Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9)))
  assert.ok(v.m4 instanceof THREE.Matrix4 && v.m4.equals(new THREE.Matrix4().makeRotationY(0.5).setPosition(1, 2, 3)))
  assert.ok(v.color instanceof THREE.Color && v.color.equals(new THREE.Color(0.25, 0.5, 0.75)))
  assert.ok(v.plane instanceof THREE.Plane && v.plane.equals(new THREE.Plane(new THREE.Vector3(0, 1, 0), -4)))
  assert.ok(v.ray instanceof THREE.Ray && v.ray.equals(new THREE.Ray(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0, 1))))
  assert.ok(v.box2 instanceof THREE.Box2 && v.box2.equals(new THREE.Box2(new THREE.Vector2(-1, -2), new THREE.Vector2(3, 4))))
  assert.ok(v.box3 instanceof THREE.Box3 && v.box3.equals(new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(4, 5, 6))))
  assert.ok(v.sphere instanceof THREE.Sphere && v.sphere.equals(new THREE.Sphere(new THREE.Vector3(1, 2, 3), 4)))
  assert.ok(v.line3 instanceof THREE.Line3 && v.line3.equals(new THREE.Line3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))))
  assert.ok(v.geometry instanceof THREE.BufferGeometry)
  const box = new THREE.BoxGeometry(2, 3, 4)
  assert.deepEqual([...v.geometry.getAttribute('position').array], [...box.getAttribute('position').array])
  assert.deepEqual([...v.geometry.getIndex()!.array], [...box.getIndex()!.array])
  assert.equal(v.geometry.groups.length, 6)
  // plain data as itself, Maps and Sets item by item, also with the package's objects in them
  const part = new Box(1, 2, 3)
  const sent = { n: 1, s: 'two', list: [null, true, undefined], when: new Date(0), bytes: new Uint8Array([1, 2]), map: new Map([['part', part]]), set: new Set([Y]), point: { x: 1, y: 2, z: 3 }, tagged: { '$smlibpy-three': 'Body', body: 0 } }
  const back = (await cad.call('echo', [sent])) as typeof sent
  assert.deepEqual({ ...back, map: null, set: null, when: null }, { ...sent, map: null, set: null, when: null })
  assert.equal(back.when.getTime(), 0)
  assert.ok(back.map.get('part') instanceof Part && Math.abs(back.map.get('part')!.volume - 6) < 1e-12)
  assert.ok([...back.set][0] instanceof THREE.Vector3)
  // (a plain { x, y, z } stays a plain object, and one that looks like the package's message too)
  assert.equal(Object.getPrototypeOf(back.point), Object.prototype)
  assert.deepEqual(back.tagged, { '$smlibpy-three': 'Body', body: 0 })
})

test('sketches, curves of their own and the curves of a body cross with their transform', async () => {
  const sketch = new Rectangle(20, 10).on(new THREE.Plane(new THREE.Vector3(0, 0, 1), -5))
  const solid = await cad.call('extrude', [sketch, 4])
  close(solid.volume, 800, 1e-9)
  const tab = (await cad.call('echo', [sketch])) as Sketch
  assert.ok(tab instanceof Sketch)
  closeVector(tab.plane.normal, sketch.plane.normal, 1e-12)
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 5, 2), new THREE.Vector3(20, -3, 8)]
  const spline = new Spline(points)
  spline.position.set(1, 2, 3)
  const info = await cad.call('curveInfo', [spline])
  assert.equal(info.type, 'bspline')
  close(info.length, spline.length, 1e-9)
  assert.deepEqual(info.position, [1, 2, 3])
  const back = (await cad.call('echo', [spline])) as BrepEdge
  assert.ok(back instanceof BrepEdge && back.owner === null)
  assert.ok(back.position.equals(spline.position))
  closeVector(back.pointAt(0.3), spline.pointAt(0.3), 1e-9)
  const path = new Polyline([new THREE.Vector3(), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 10, 0)])
  const wire = (await cad.call('echo', [path])) as Wire
  assert.ok(wire instanceof Wire)
  close(wire.length, 20, 1e-12)
  // the curves where a plane cuts a part: curves in the part's frame, which come with the part
  const part = new Box(20, 20, 20)
  const [ring] = part.intersectionCurves(new THREE.Plane(Y, 0))
  const owned = await cad.call('curveInfo', [ring, part])
  assert.equal(owned.owned, true)
  close(owned.length, ring.length, 1e-9)
})

test('groups cross with their children; materials stay, their colors cross, and results made from a body get its material again', async () => {
  const { line, group } = await cad.call('assembly', [])
  assert.ok(line instanceof BrepEdge && line.geomType === 'line')
  assert.equal(line.name, 'axis')
  assert.equal(line.position.y, 5)
  closeVector(line.end, { x: 10, y: 0, z: 0 }, 1e-12)
  assert.ok(group instanceof THREE.Group)
  assert.equal(group.position.x, 100)
  assert.deepEqual(group.children.map((c) => c.name), ['base', 'pin'])
  const [base, pin] = group.children as Part[]
  assert.ok(base instanceof Part && pin instanceof Part)
  assert.equal(pin.position.y, 20)
  // (a material made over there: the part's own material here, in its color)
  assert.equal((pin.material as THREE.MeshStandardMaterial).color.getHex(), 0xff0000)
  assert.equal((base.material as THREE.MeshStandardMaterial).color.getHex(), (new Box(1, 1, 1).material as THREE.MeshStandardMaterial).color.getHex())
  // a material from here: over there in its color; on what comes back made from its body, itself
  const part = new Box(30, 10, 20)
  const mine = new THREE.MeshPhysicalMaterial({ color: 0x3366ff, name: 'blue' })
  part.material = mine
  assert.deepEqual(await cad.call('materialOf', [part]), { name: 'blue', color: 0x3366ff })
  const rounded = await cad.call('round', [part, verticalEdge(part, 15, 10), 2])
  assert.equal(rounded.material, mine)
  // a STEP file read over there: a group of its parts, named and colored as the file has them
  const exported = new Box(10, 20, 30)
  exported.name = 'brick'
  exported.material = new THREE.MeshStandardMaterial({ color: 0x00ff00 })
  const step = await cad.call('readStep', [new STEPExporter().parse(exported)])
  assert.ok(step instanceof THREE.Group && step.children.length === 1)
  const brick = step.children[0] as Part
  assert.equal(brick.name, 'brick')
  close(brick.volume, 6000, 1e-6)
  assert.equal((brick.material as THREE.MeshStandardMaterial).color.getHex(), 0x00ff00)
  await noKernel([line, group, rounded, step])
})

test('triangle meshes cross as their triangles, both ways; the sender keeps its own', async () => {
  const part = new Box(30, 10, 20).cut(new Cylinder(4, 4, 20))
  const mesh = await cad.call('meshOf', [part, 0.05])
  assert.ok(mesh instanceof TriangleMesh)
  const here = new TriangleMesh(part, null, { tolerance: 0.05 })
  assert.equal(mesh.triangleCount, here.triangleCount)
  close(mesh.volume, here.volume, 1e-9 * here.volume, 'volume')
  assert.ok(mesh.position.equals(new THREE.Vector3(1, 2, 3)))
  assert.equal(mesh.name, 'mesh')
  assert.ok(mesh.geometry.getAttribute('position').count > 0)
  // and to the worker: the same triangles there, and still here
  const info = await cad.call('meshInfo', [mesh])
  assert.equal(info.triangles, mesh.triangleCount)
  close(info.volume, mesh.volume, 1e-9 * mesh.volume)
  assert.deepEqual(info.position, [1, 2, 3])
  assert.equal(mesh.triangleCount, here.triangleCount)
  await noKernel(mesh)
})

test("errors arrive as the package's ModelingError and KernelError; values that cannot cross are a TypeError", async () => {
  await assert.rejects(cad.call('fail', ['modeling']), (e: unknown) => {
    assert.ok(e instanceof ModelingError && !(e instanceof KernelError), String(e))
    assert.ok(!(e instanceof sm.ModelingError))
    assert.equal(e.message, 'this cannot be done: try something else')
    assert.match(e.stack ?? '', /in the worker:\n[^]*_worker_models/)
    assert.equal(e.cause, undefined)
    return true
  })
  // (the kernel refuses the fillet: the package's error, as the same call here gives it)
  let here: unknown
  try {
    const box = new Box(10, 10, 10)
    box.fillet(box.edges(), 20)
  } catch (e) {
    here = e
  }
  await assert.rejects(cad.call('fail', ['fillet']), (e: unknown) => {
    assert.ok(e instanceof ModelingError && !(e instanceof sm.ModelingError), String(e))
    assert.equal(e.constructor, (here as Error).constructor)
    assert.equal(e.message, (here as Error).message)
    if (e instanceof KernelError) {
      assert.equal(e.operation, (here as KernelError).operation)
      assert.equal(e.status, (here as KernelError).status)
      assert.deepEqual(e.trace, (here as KernelError).trace)
    }
    return true
  })
  await assert.rejects(cad.call('fail', ['kernel']), (e: unknown) => {
    assert.ok(e instanceof KernelError && !(e instanceof sm.KernelError), String(e))
    assert.equal(e.message, 'a message of its own')
    assert.equal(e.operation, 'step')
    assert.equal(e.status, 'SM_ERR_INVALID_INPUT')
    assert.equal(e.hint, 'is it positive?')
    assert.deepEqual(e.trace, ['SM_ERR at Step.cpp:12 (Run)'])
    assert.equal(e.cause, undefined)
    return true
  })
  await assert.rejects(cad.call('fail', ['raw']), (e: unknown) => {
    assert.ok(e instanceof KernelError && !(e instanceof sm.KernelError), String(e))
    assert.equal(e.message, 'raw step failed (SM_ERR_FAILURE)')
    assert.equal(e.status, 'SM_ERR_FAILURE')
    return true
  })
  await assert.rejects(cad.call('fail', ['type']), (e: unknown) => e instanceof TypeError && e.message === 'not a part')
  await assert.rejects(cad.call('fail', ['range']), RangeError)
  await assert.rejects(cad.call('fail', ['font']), (e: unknown) => e instanceof FontError && e.message === 'not a font')
  await assert.rejects(cad.call('nothing' as never, []), { name: 'TypeError', message: /the worker has no function 'nothing' \(it has: .*plate/ })
  await assert.rejects(cad.call('echo', [new THREE.Mesh()]), { name: 'TypeError', message: /a Mesh cannot go to or come from a worker/ })
  await assert.rejects(cad.call('echo', [() => 1]), { name: 'TypeError', message: /a function cannot go/ })
  const disposed = new Box(1, 1, 1)
  disposed.dispose()
  await assert.rejects(cad.call('volume', [disposed]), { name: 'TypeError', message: /was disposed/ })
  // (the worker is fine after all of them)
  assert.equal(await cad.call('later', [5, 1]), 5)
})

test('calls run in the order they were made, also while a part of one is converted', async () => {
  const part = new Box(10, 10, 10)
  const ticks = await Promise.all([cad.call('tick', [part]), cad.call('tick', []), cad.call('tick', [part.faces()]), cad.call('tick', [1])])
  assert.deepEqual(ticks.map((t) => t - ticks[0]), [0, 1, 2, 3])
  const list = await cad.call('echo', [part.faces().planar()])
  assert.ok(list instanceof ShapeList && list.length === 6)
})

test('a call that runs too long ends with its worker, and the next call gets a new one', async () => {
  const cad = new KernelWorker<typeof Models>(WORKER, { timeout: 60_000 })
  try {
    const first = await cad.call('thread', [])
    const started = Date.now()
    await assert.rejects(cad.call('spin', [-1], { timeout: 300 }), (e: unknown) => {
      assert.ok(e instanceof DOMException)
      assert.equal(e.name, 'TimeoutError')
      assert.equal(e.message, 'spin did not finish within 300 ms; its worker was terminated')
      return true
    })
    assert.ok(Date.now() - started < 5000)
    const second = await cad.call('thread', [])
    assert.notEqual(second, first)
    // a kernel that crashed or ran out of memory is replaced too; one that failed as usual is not
    await assert.rejects(cad.call('fail', ['kernel']), KernelError)
    assert.equal(await cad.call('thread', []), second)
    await assert.rejects(cad.call('fail', ['memory']), (e: unknown) => e instanceof KernelError && e.status === 'SM_ERR_OUT_OF_MEMORY')
    const third = await cad.call('thread', [])
    assert.notEqual(third, second)
    await assert.rejects(cad.call('fail', ['crash']), (e: unknown) => e instanceof WebAssembly.RuntimeError && /out of bounds/.test(e.message))
    assert.notEqual(await cad.call('thread', []), third)
    const part = await cad.functions.plate(60)
    close(part.volume, plate(60).volume, 1e-9 * part.volume)
    // an AbortSignal drops a call that waits, and stops one that runs
    const running = new AbortController()
    const spinning = cad.call('spin', [-1], { signal: running.signal })
    const waiting = new AbortController()
    const dropped = cad.call('later', [1, 1], { signal: waiting.signal })
    waiting.abort(new Error('not needed'))
    await assert.rejects(dropped, { message: 'not needed' })
    setTimeout(() => running.abort(), 100)
    await assert.rejects(spinning, { name: 'AbortError' })
    assert.equal(await cad.call('later', [7, 1]), 7)
    // terminate() rejects the calls that wait or run; the next call starts a new worker
    const names = await cad.start()
    assert.ok(names.includes('plate') && names.includes('spin'))
    const a = cad.call('spin', [-1])
    const b = cad.call('volume', [new Box(1, 1, 1)])
    assert.equal(cad.pending, 2)
    await new Promise((done) => setTimeout(done, 50))
    cad.terminate()
    await assert.rejects(a, { name: 'AbortError' })
    await assert.rejects(b, { name: 'AbortError' })
    assert.equal(cad.pending, 0)
    assert.equal(await cad.functions.later(4, 1), 4)
  } finally {
    cad.terminate()
  }
})

test('options and arguments are checked; expose() answers a KernelWorker only in a worker', async () => {
  assert.throws(() => new KernelWorker(WORKER, { timout: 1 } as never), { name: 'TypeError', message: /unexpected option 'timout'/ })
  assert.throws(() => new KernelWorker(WORKER, { timeout: -1 }), RangeError)
  assert.throws(() => new KernelWorker(42 as never), TypeError)
  await assert.rejects(cad.call('later', [1, 1], { timeout: 'soon' as never }), RangeError)
  await assert.rejects(cad.call('later', 1 as never), { name: 'TypeError', message: /the arguments must be an array/ })
  await assert.rejects(cad.call(7 as never, []), { name: 'TypeError', message: /the name of a function, not number/ })
  assert.throws(() => expose({}), /call it in a Web Worker or a Node worker thread/)
  assert.equal(await cad.call('later', [2, 1]), 2)
})

test('the calling thread loads no kernel for plain results, and loads it for a part', () => {
  const src = (name: string) => JSON.stringify(new URL(`../src/${name}`, import.meta.url).href)
  const code = `
    import { registerHooks } from 'node:module'
    const loaded = []
    registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context) } })
    const kernel = () => loaded.some((url) => /smlibwasm\\.mjs$|\\/src\\/kernel\\.ts$|\\/src\\/shapes\\.ts$/.test(url))
    const { KernelWorker } = await import(${src('worker.ts')})
    const cad = new KernelWorker(new URL(${JSON.stringify(WORKER.href)}))
    const out = {}
    out.value = await cad.call('later', [6, 1])
    out.box = (await cad.call('values', [])).box3.max.toArray()
    out.kernelBefore = kernel()
    const part = await cad.call('plate', [80])
    out.volume = Math.round(part.volume)
    out.kernelAfter = kernel()
    cad.terminate()
    console.log(JSON.stringify(out))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
  const out = JSON.parse(run.stdout.trim().split('\n').at(-1) as string)
  assert.deepEqual(out, { value: 6, box: [4, 5, 6], kernelBefore: false, volume: Math.round(plate(80).volume), kernelAfter: true })
})
