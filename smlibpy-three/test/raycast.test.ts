// Picking with three's own Raycaster: a body's raycast is three's Mesh.raycast, and each hit
// carries the face that was hit as `brep`; hits on its edge lines carry the edge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Box, Cylinder, BrepEdge, BrepFace, GridLocations, Segment, Ball, Z } from '../src/index.ts'
import { close, closeVector, ray, Y } from './_util.ts'

test('a ray onto the top of a box hits its top face', () => {
  const part = new Box(40, 10, 30) // 40 along x, 10 high (y), 30 along z
  const hits = ray([3, 100, 4], [0, -1, 0]).intersectObject(part)
  assert.equal(hits.length, 1) // (the bottom, seen from inside, is a back face: three culls it for a FrontSide material)
  const [hit] = hits
  assert.equal(hit.object, part)
  assert.ok(hit.brep instanceof BrepFace)
  assert.equal(hit.brep, part.faces().top().one())
  closeVector(hit.point, { x: 3, y: 5, z: 4 }, 1e-9)
  // three's own fields are three's: the triangle, its index, the interpolated normal
  assert.equal(typeof hit.faceIndex, 'number')
  closeVector(hit.face!.normal, Y, 1e-6)
})

test('hits come back as the faces of the body that was hit, wherever it is', () => {
  // (a plate lying in XY, 8 thick along z, with four holes along z at a grid in XY, its corners rounded)
  const hole = new Cylinder(4, 4, 20)
  hole.rotation.x = Math.PI / 2
  const plate = new Box(60, 40, 8).cut(hole.at(GridLocations(40, 20, 2, 2)))
  const part = plate.fillet(plate.edges().parallelTo(Z), 6)
  const scene = new THREE.Scene()
  const group = new THREE.Group()
  group.position.set(200, -30, 50)
  group.rotation.set(0.3, 1.1, -0.4)
  scene.add(group)
  group.add(part)
  part.position.set(-10, 5, 2)
  part.rotation.y = 0.7
  scene.updateMatrixWorld()
  const center = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3())
  // rays at the part from all around (aimed at points of the plate, in its frame): every hit's point
  // lies on the face it names (in the part's frame)
  const random = (() => {
    let seed = 7
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  })()
  let hits = 0
  let faces = new Set<BrepFace>()
  for (let i = 0; i < 300; i++) {
    const from = new THREE.Vector3(random(), random(), random()).normalize().multiplyScalar(150).add(center)
    const to = part.localToWorld(new THREE.Vector3(random() * 25, random() * 25, random() * 4))
    const raycaster = new THREE.Raycaster(from, to.sub(from).normalize())
    const [hit] = raycaster.intersectObject(part, false)
    if (hit === undefined) continue
    hits++
    const face = hit.brep as BrepFace
    assert.equal(face.owner, part)
    faces.add(face)
    const local = part.worldToLocal(hit.point.clone())
    // (within the tessellation's chord height of the exact face)
    assert.ok(face.distanceTo(local) < 0.08, `hit ${i}: ${face.distanceTo(local)} off its face`)
    // and nearer to it than to any other face
    for (const other of part.faces()) if (other !== face) assert.ok(other.distanceTo(local) >= face.distanceTo(local) - 1e-9)
  }
  assert.ok(hits > 200, `${hits} hits`)
  assert.ok(faces.size >= 8, `${faces.size} faces hit`)
})

test('a ray beside an edge hits the edge lines, with the edge', () => {
  const part = new Box(40, 10, 30) // top front edge: y = 5, z = 15
  const raycaster = ray([0, 100, 15.3], [0, -1, 0], 0.5)
  const hits = raycaster.intersectObject(part)
  // (the ray passes beside the bottom front edge too, further on)
  assert.equal(hits.length, 2)
  const [hit, below] = hits
  closeVector((below.brep as BrepEdge).center(), { x: 0, y: -5, z: 15 }, 1e-9)
  assert.equal(hit.object, part.edgeLines)
  assert.ok(hit.brep instanceof BrepEdge)
  assert.equal(hit.brep.owner, part)
  assert.ok(part.edges().includes(hit.brep))
  closeVector(hit.brep.center(), { x: 0, y: 5, z: 15 }, 1e-9)
  // three's threshold: further than it, nothing
  assert.equal(ray([0, 100, 16], [0, -1, 0], 0.5).intersectObject(part).length, 0)
  // a face hit and an edge hit near each other: three sorts them by distance
  const both = ray([0, 100, 14.8], [0, -1, 0], 0.5).intersectObject(part)
  assert.ok(both.some((h) => h.brep instanceof BrepFace) && both.some((h) => h.brep instanceof BrepEdge))
  for (let i = 1; i < both.length; i++) assert.ok(both[i - 1].distance <= both[i].distance)
})

test("three's rules hold: recursion, layers, invisible objects", () => {
  const part = new Box(40, 10, 30)
  const at = () => ray([0, 100, 14.8], [0, -1, 0], 0.5)
  // not recursive: the body's faces only
  assert.ok(at().intersectObject(part, false).every((h) => h.object === part))
  // layers keep the edges out of a raycaster's reach
  part.edgeLines.layers.set(2)
  assert.ok(at().intersectObject(part).every((h) => h.object === part))
  part.edgeLines.layers.set(0)
  // three raycasts invisible objects too (hidden edge lines still pick edges)
  part.edgeLines.visible = false
  assert.ok(at().intersectObject(part).some((h) => h.object === part.edgeLines))
})

test('faces and edges drawn as highlights are not hit again', () => {
  const part = new Ball(10)
  const before = ray([0, 50, 0], [0, -1, 0]).intersectObject(part).length
  for (const f of part.faces()) part.add(f)
  for (const e of part.edges()) part.add(e)
  assert.equal(ray([0, 50, 0], [0, -1, 0]).intersectObject(part).length, before)
})

test('a curve of its own is hit as a line, with itself as brep', () => {
  const line = new Segment(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0))
  line.position.y = 3
  line.updateMatrixWorld()
  const [hit] = ray([2, 3.2, 50], [0, 0, -1], 0.5).intersectObject(line)
  assert.equal(hit.object, line)
  assert.equal(hit.brep, line)
  close(hit.point.x, 2, 1e-9)
})

test('brep survives a spread, as R3F spreads intersections into its events', () => {
  const part = new Box(10, 10, 10)
  const [hit] = ray([0, 50, 0], [0, -1, 0]).intersectObject(part)
  const event = { ...hit, stopPropagation() {} }
  assert.equal(event.brep, part.faces().top().one())
})
