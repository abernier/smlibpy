// Y up: what smlibpy builds along its Z axis stands along three's Y, sketches lie on three's
// ground (XZ) and extrude up, and files (Z up, as smlibpy's are) keep parts standing: the axis
// change happens at the kernel's boundary, once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import {
  Box,
  CenterArc,
  Cone,
  Cylinder,
  Helix,
  Polygon,
  PolarLocations,
  Rectangle,
  STEPExporter,
  STEPLoader,
  Text,
  Torus,
  type Part,
} from '../src/index.ts'
import { box, close, closeBox, closeVector, Y } from './_util.ts'

test("smlibpy's up is three's up: cylinders, cones, tori and heights run along y", () => {
  closeBox(new Cylinder(5, 30).bbox(), box([-5, -15, -5], [5, 15, 5]))
  for (const f of new Cylinder(5, 30).faces().planar()) closeVector({ x: 0, y: Math.abs(f.normalAt().y), z: 0 }, Y)
  // (three's own CylinderGeometry and ConeGeometry stand the same way)
  closeBox(new Cylinder(5, 30).bbox(), new THREE.Box3().setFromObject(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 30, 64))), 0.01)
  const cone = new Cone(6, 0, 12)
  closeBox(cone.bbox(), box([-6, -6, -6], [6, 6, 6]))
  assert.ok(cone.center().y < 0) // the apex is up
  closeBox(new Torus(10, 2).bbox(), box([-12, -2, -12], [12, 2, 12]))
  // Box(length, width, height): x, z, and y up
  closeBox(new Box(80, 60, 10).bbox(), box([-40, -5, -30], [40, 5, 30]))
  closeBox(new Box(80, 60, 10, { align: { y: 'min' } }).bbox(), box([-40, 0, -30], [40, 10, 30]))
  closeBox(new Box(8, 6, 1, { align: 'min' }).bbox(), box([0, 0, 0], [8, 1, 6]))
  closeVector(new Helix(2, 10, 3).end, { x: 3, y: 10, z: 0 }, 1e-9)
})

test('sketches lie on the ground, read from above, and extrude up', () => {
  const rect = new Rectangle(20, 10)
  closeBox(rect.bbox(), box([-10, 0, -5], [10, 0, 5]))
  closeVector(rect.plane.normal, Y)
  const plate = rect.extrude(3)
  closeBox(plate.bbox(), box([-10, 0, -5], [10, 3, 5]))
  closeVector(plate.faces().top().one().normalAt(), Y)
  // a sketch's own y runs along -z (a top view shows it as drawn: x right, y up the screen)
  const tri = new Polygon([new THREE.Vector2(0, 0), new THREE.Vector2(10, 0), new THREE.Vector2(0, 10)])
  closeBox(tri.bbox(), box([0, 0, -10], [10, 0, 0]))
  // text too: lying, readable from above
  const text = new Text('L', 10)
  const t = text.bbox()
  close(t.max.y - t.min.y, 0, 1e-9)
  assert.ok(t.max.z - t.min.z > 5)
  // an arc on the ground, counterclockwise seen from above: from +x towards -z
  const arc = new CenterArc(new THREE.Vector3(0, 2, 0), 5, 0, Math.PI / 2)
  closeVector(arc.start, { x: 5, y: 2, z: 0 }, 1e-9)
  closeVector(arc.end, { x: 0, y: 2, z: -5 }, 1e-9)
  // a sketch turned to three's XY plane (as ShapeGeometry's) extrudes towards +z
  const front = new Rectangle(20, 10)
  front.rotation.x = Math.PI / 2
  const slab = front.extrude(3)
  slab.updateMatrixWorld()
  closeBox(new THREE.Box3().setFromObject(slab), box([-10, -5, 0], [10, 5, 3]), 1e-5)
  for (const m of PolarLocations(10, 5)) close(new THREE.Vector3().setFromMatrixPosition(m).y, 0, 1e-12)
})

test("transforms are three's: a rotation about y turns a tool as it turns a three mesh", () => {
  const tool = new Box(40, 4, 4)
  tool.rotation.y = Math.PI / 6
  tool.position.set(3, 10, -2)
  tool.updateMatrixWorld()
  const block = new Box(100, 100, 20, { align: { y: 'min' } })
  // the tool lies inside the block: what they share is the tool, where three draws it
  const shared = block.intersect(tool)
  close(shared.volume, 40 * 4 * 4, 1e-6)
  closeBox(shared.bbox(), new THREE.Box3().setFromObject(tool, true), 1e-6)
  close(block.cut(tool).volume, 100 * 100 * 20 - 40 * 4 * 4, 1e-6)
})

test('STEP files are Z up: a part standing in three stands in the file', () => {
  const tall = new Cylinder(5, 40, { align: { y: 'min' } })
  tall.name = 'pin'
  tall.material = new THREE.MeshStandardMaterial({ color: '#336699' })
  tall.position.set(10, 0, -20)
  const text = new STEPExporter().parse(tall)
  // read by the kernel itself: Z up, the part's height along z, placed where the scene shows it
  const read = sm.fromStep(text) as sm.Part
  const b = read.bbox()
  close(b.max.z - b.min.z, 40, 1e-6)
  close(b.min.z, 0, 1e-6)
  close(b.center.x, 10, 1e-6)
  close(b.center.y, 20, 1e-6) // (three's -z is the kernel's y)
  assert.equal(read.name, 'pin')
  // and back: STEPLoader gives a group of bodies, standing, named and colored as they were
  const group = new STEPLoader().parse(text)
  assert.ok(group instanceof THREE.Group)
  const [pin] = group.children as Part[]
  assert.equal(pin.name, 'pin')
  closeBox(pin.bbox(), box([5, 0, -25], [15, 40, -15]), 1e-6)
  close(pin.volume, Math.PI * 25 * 40, 1e-6)
  assert.equal((pin.material as THREE.MeshStandardMaterial).color.getHexString(), '336699')
})

test('STEPLoader loads as three loaders load: loadAsync from a URL', async () => {
  // (three's FileLoader reports progress with ProgressEvent, which browsers have and Node has not)
  const g = globalThis as { ProgressEvent?: unknown }
  g.ProgressEvent ??= class extends Event {
    constructor(type: string, init: object = {}) {
      super(type)
      Object.assign(this, init)
    }
  }
  const text = new STEPExporter().parse([new Box(10, 20, 30), new Cylinder(2, 50)])
  const url = `data:application/step;base64,${Buffer.from(text).toString('base64')}`
  const group = await new STEPLoader().loadAsync(url)
  assert.equal(group.children.length, 2)
  closeBox((group.children[0] as Part).bbox(), box([-5, -15, -10], [5, 15, 10]), 1e-6)
})
