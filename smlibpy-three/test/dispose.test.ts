// Disposal the three way: dispose() frees what the object made (its tessellation, once no clone
// draws it; its own materials; its kernel body, once no clone holds it) and fires three's
// 'dispose'; what the app assigned (a material) is the app's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { memoryUsage } from '@classcad/smlibwasm'
import { Box, Cylinder, Segment, Part, Ball } from '../src/index.ts'

/** Counts 'dispose' events of an object (a geometry, a material, an Object3D). */
function disposals(target: THREE.EventDispatcher<{ dispose: object }>): { count: number } {
  const seen = { count: 0 }
  target.addEventListener('dispose', () => seen.count++)
  return seen
}

test('dispose() frees the tessellation and the own materials, never an assigned material', () => {
  const part = new Box(20, 20, 20).cut(new Cylinder(5, 5, 30))
  const geometry = disposals(part.geometry)
  const lines = disposals(part.edgeLines.geometry)
  const own = disposals(part.edgeLines.material as THREE.Material)
  const mine = new THREE.MeshStandardMaterial()
  part.material = mine
  const assigned = disposals(mine)
  const object = disposals(part as unknown as THREE.EventDispatcher<{ dispose: object }>)
  part.dispose()
  assert.equal(geometry.count, 1)
  assert.equal(lines.count, 1)
  assert.equal(own.count, 1)
  assert.equal(assigned.count, 0)
  assert.equal(object.count, 1) // (three's Object3D 'dispose')
})

test('a disposed body still draws as it was; operations on it throw', () => {
  const part = new Ball(5)
  const geometry = part.geometry
  part.dispose()
  // (three uploads a disposed geometry again when it draws it)
  assert.equal(part.geometry, geometry)
  assert.ok(part.geometry.getAttribute('position').count > 0)
  assert.throws(() => part.volume, /disposed/)
  assert.throws(() => part.cut(new Box(1, 1, 1)), /disposed/)
  assert.throws(() => new Box(10, 10, 10).cut(part), /disposed/)
})

test('clones keep the body and its tessellation until the last one is disposed', () => {
  const part = new Box(10, 10, 10).cut(new Cylinder(2, 2, 20))
  const clone = part.clone()
  const geometry = disposals(part.geometry)
  assert.equal(clone.geometry, part.geometry)
  part.dispose()
  assert.equal(geometry.count, 0)
  assert.ok(clone.volume > 0)
  clone.dispose()
  assert.equal(geometry.count, 1)
  assert.throws(() => clone.volume, /disposed/)
})

test("dispose() frees the kernel's body at once", () => {
  const before = memoryUsage().handles
  const parts = Array.from({ length: 20 }, (_, i) => new Box(10 + i, 10, 10).cut(new Cylinder(2, 2, 20)))
  for (const p of parts) p.geometry // (tessellated, as when drawn)
  const made = memoryUsage().handles
  assert.ok(made >= before + 20)
  for (const p of parts) p.dispose()
  // (the operands of the cuts are left to the garbage collector; the results are freed now)
  assert.ok(memoryUsage().handles <= made - 20, `${memoryUsage().handles} handles after, ${made} before`)
})

test('faces, edges and curves free what they made', () => {
  const part = new Box(10, 10, 10)
  const face = part.faces().first
  part.add(face)
  const faceGeometry = disposals(face.geometry)
  const faceMaterial = disposals(face.material as THREE.Material)
  face.dispose()
  assert.equal(faceGeometry.count, 1)
  assert.equal(faceMaterial.count, 1)
  assert.ok(part.volume > 0) // (the body is its body's)
  const line = new Segment(new THREE.Vector3(), new THREE.Vector3(1, 2, 3))
  const lineGeometry = disposals(line.geometry)
  line.dispose()
  assert.equal(lineGeometry.count, 1)
  assert.throws(() => line.length, /disposed|no geometry/)
})

test('an empty or disposed body in a scene draws nothing and raycasts as three does, without throwing', () => {
  const scene = new THREE.Scene()
  const empty = new Part()
  const disposed = new Box(10, 10, 10)
  disposed.dispose() // (before it was ever drawn)
  scene.add(empty, disposed)
  for (const b of [empty, disposed]) {
    assert.equal(b.geometry.getAttribute('position').count, 0)
    assert.equal(b.edgeLines.geometry.getAttribute('position').count, 0)
  }
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0))
  assert.deepEqual(raycaster.intersectObject(scene), [])
  // a disposed body that was drawn keeps what it drew, and hits on it name no face
  const drawn = new Box(10, 10, 10)
  drawn.geometry
  drawn.dispose()
  const hits = raycaster.intersectObject(drawn)
  assert.ok(hits.length > 0 && hits.every((h) => h.brep === undefined))
})

test('dispose() twice frees once: a clone keeps what they share', () => {
  const part = new Box(10, 10, 10)
  const clone = part.clone()
  const geometry = disposals(part.geometry)
  assert.equal(clone.geometry, part.geometry) // (both draw it)
  part.dispose()
  part.dispose()
  assert.equal(geometry.count, 0)
  assert.ok(clone.volume > 0)
  assert.ok(clone.geometry.getAttribute('position').count > 0)
})
