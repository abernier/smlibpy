// The shapes are three.js objects and behave as any other: scenes, transforms, clone and copy,
// toJSON, Box3; operations take their operands where they are and give results that replace
// what they were called on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Body, Box, Cylinder, BrepEdge, EdgeLines, BrepFace, GridLocations, Segment, Part, Polyline, Rectangle, Shell, Sketch, Ball, BrepVertex, Wire } from '../src/index.ts'
import { box, close, closeBox, closeVector, Y } from './_util.ts'

test('bodies are meshes, their edges line segments, faces meshes, curves lines, vertices points', () => {
  const part = new Box(30, 20, 10)
  assert.ok(part instanceof THREE.Mesh && part instanceof Body && part instanceof Part)
  assert.equal(part.isMesh, true)
  assert.equal(part.isBody, true)
  assert.equal(part.isPart, true)
  assert.equal(part.type, 'Mesh')
  assert.ok(part.geometry instanceof THREE.BufferGeometry)
  assert.ok(part.material instanceof THREE.MeshStandardMaterial)
  assert.ok(part.edgeLines instanceof EdgeLines && part.edgeLines instanceof THREE.LineSegments)
  assert.deepEqual(part.children, [part.edgeLines])
  assert.equal(part.edgeLines.body, part)
  assert.ok(part.faces().first instanceof BrepFace && part.faces().first instanceof THREE.Mesh)
  assert.ok(part.edges().first instanceof BrepEdge && part.edges().first instanceof THREE.Line)
  assert.ok(part.vertices().first instanceof BrepVertex && part.vertices().first instanceof THREE.Points)
  assert.ok(new Segment() instanceof THREE.Line)
  assert.ok(new Polyline([new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 1, 0)]) instanceof Wire)
  const sketch = new Rectangle(10, 5)
  assert.ok(sketch instanceof Sketch && sketch instanceof Shell && sketch instanceof THREE.Mesh)
  assert.equal((sketch.material as THREE.Material).side, THREE.DoubleSide)
  assert.equal((part.material as THREE.Material).side, THREE.FrontSide)
})

test('the geometry is the tessellation: split per face, with the exact normals', () => {
  const part = new Ball(10).cut(new Box(30, 30, 30, { align: { y: 'min' } }))
  const g = part.geometry
  const faces = part.faces()
  const triangles = g.getIndex()!.count / 3
  // the faces' own geometries are the body's, cut by face
  let sum = 0
  for (const f of faces) sum += f.geometry.getIndex()!.count / 3
  assert.equal(sum, triangles)
  // the normals are the surfaces' (a sphere's points away from its center, the cut's up)
  const position = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i)
    n.fromBufferAttribute(normal, i)
    if (Math.abs(p.y) < 1e-6 && Math.abs(n.y - 1) < 1e-6) continue // on the flat top
    closeVector(n, p.clone().normalize(), 1e-5, `normal ${i}`)
  }
  // tolerance and angle tessellate again when three next reads the geometry
  const before = g.getIndex()!.count
  part.tolerance = 0.01
  assert.notEqual(part.geometry, g)
  assert.ok(part.geometry.getIndex()!.count > before)
  assert.throws(() => (part.tolerance = -1), RangeError)
})

test('in a scene: added, moved, measured by Box3 as any mesh', () => {
  const scene = new THREE.Scene()
  const group = new THREE.Group()
  group.position.set(100, 0, 0)
  scene.add(group)
  const part = new Box(20, 4, 10)
  part.position.set(0, 50, 0)
  part.rotation.y = Math.PI / 2
  group.add(part)
  assert.equal(part.parent, group)
  scene.updateMatrixWorld()
  // (20 along x, 10 along z, 4 high, turned a quarter about y: 10 along x, 20 along z)
  closeBox(new THREE.Box3().setFromObject(part), box([100 - 5, 48, -10], [100 + 5, 52, 10]), 1e-5)
  // the exact box is the body's own, in its frame
  closeBox(part.bbox(), box([-10, -2, -5], [10, 2, 5]))
  const world = part.bbox().applyMatrix4(part.matrixWorld)
  closeBox(world, new THREE.Box3().setFromObject(part), 1e-5)
  group.remove(part)
  assert.equal(part.parent, null)
})

test('operations take tools where they are and give results where their receiver is', () => {
  const plate = new Box(80, 10, 60) // 80 along x, 10 high (y), 60 along z
  plate.name = 'plate'
  const material = new THREE.MeshPhysicalMaterial({ color: 'steelblue' })
  plate.material = material
  plate.position.set(5, 0, 0)
  // a hole along x through the plate's middle, placed by its transform
  const tool = new Cylinder(2, 2, 200)
  tool.rotation.z = Math.PI / 2
  tool.position.set(5, 0, 10)
  const cut = plate.cut(tool)
  close(cut.volume, 80 * 10 * 60 - Math.PI * 4 * 80, 1e-6)
  // the result replaces the plate: its transform, name and material
  assert.equal(cut.name, 'plate')
  assert.equal(cut.material, material)
  closeVector(cut.position, plate.position, 0)
  // in its frame the hole is where the tool was, relative to the plate
  const hole = cut.faces().cylinders().one()
  closeVector(hole.axis.origin.clone().setX(0), { x: 0, y: 0, z: 10 }, 1e-9)
  // the inputs are as they were
  close(plate.volume, 80 * 10 * 60)
  assert.equal(plate.faces().length, 6)
  // tools in a group: where the group puts them
  const group = new THREE.Group()
  group.position.set(0, 0, -20)
  const pin = new Cylinder(3, 3, 30)
  pin.position.set(5, 0, 0)
  group.add(pin)
  const drilled = plate.cut(pin, tool)
  const pinHole = drilled.faces().cylinders().filter((f) => Math.abs(f.radius - 3) < 1e-9).one()
  closeVector(pinHole.axis.origin.clone().setY(0), { x: 0, y: 0, z: -20 }, 1e-9)
})

test('clone and copy share the body and its tessellation, as three shares geometry', () => {
  const part = new Box(10, 10, 10).cut(new Cylinder(2, 2, 20))
  const child = new THREE.Object3D()
  part.add(child)
  part.position.set(1, 2, 3)
  const geometry = part.geometry
  const c = part.clone()
  assert.ok(c instanceof Part)
  assert.equal(c.geometry, geometry)
  assert.equal(c.material, part.material)
  assert.equal(c.volume, part.volume)
  closeVector(c.position, part.position, 0)
  // its own edge lines, and a clone of the other child
  assert.equal(c.children.filter((x) => x instanceof EdgeLines).length, 1)
  assert.equal(c.children.length, 2)
  assert.notEqual(c.children[1], child)
  assert.equal(c.edgeLines.geometry, part.edgeLines.geometry)
  // a primitive clones as itself, with its parameters
  const b = new Box(4, 5, 6)
  const bc = b.clone()
  assert.ok(bc instanceof Box)
  assert.deepEqual(bc.parameters, b.parameters)
  closeBox(bc.bbox(), b.bbox())
  // copy into an empty part
  const empty = new Part()
  assert.throws(() => empty.volume, /empty Part/)
  empty.copy(b)
  close(empty.volume, 120)
})

test('faces, edges and vertices are one object each, and draw in place as children of their body', () => {
  const part = new Box(20, 20, 20)
  assert.equal(part.faces()[2], part.faces()[2])
  assert.notEqual(part.faces(), part.faces()) // (a new list, of the same objects)
  const face = part.faces().top().one()
  assert.equal(face.owner, part)
  assert.equal(part.faces()[face.index], face)
  part.add(face)
  assert.equal(face.parent, part)
  // its own material: a highlight drawn in front of the body's faces
  const m = face.material as THREE.MeshBasicMaterial
  assert.ok(m.polygonOffset && m.polygonOffsetFactor < 0)
  const edge = face.edges().first
  assert.equal(edge.owner, part)
  assert.ok(part.edges().includes(edge))
  assert.equal(edge.geometry.getAttribute('position').count, 2)
  assert.ok(face.neighbors().every((f) => part.faces().includes(f)))
  assert.equal(face.neighbors().length, 4)
  const corner = part.vertices().first.point
  closeVector({ x: Math.abs(corner.x), y: Math.abs(corner.y), z: Math.abs(corner.z) }, { x: 10, y: 10, z: 10 })
})

test('seams, where a closed surface meets itself, come with { seams: true }, drawn along their curve', () => {
  const pipe = new Cylinder(5, 5, 10) // (along y: its two circles, and the seam of its side)
  const edges = pipe.edges()
  const all = pipe.edges({ seams: true })
  assert.equal(edges.length, 2)
  assert.equal(all.length, 3)
  assert.ok(edges.every((e) => all.includes(e))) // (the same objects)
  assert.equal(pipe.edges({ seams: true })[0], all[0]) // (one object each, as the others)
  const seams = all.filter((e) => e.isSeam)
  assert.equal(seams.length, 1)
  const seam = seams[0]
  assert.equal(seam.owner, pipe)
  assert.equal(seam.index, -1) // (not in edges(), nor in the edge lines)
  close(seam.length, 10, 1e-9)
  // a face's seam: the body's
  const side = pipe.faces().cylinders().one()
  assert.equal(side.edges().length, 2)
  assert.ok(side.edges({ seams: true }).includes(seam))
  assert.equal(seam.faces().one(), side)
  assert.ok(seam.vertices()[0].edges().includes(seam)) // (a vertex's edges, as the kernel gives them: the seam too)
  // drawn on the cylinder, along y, in the body's frame
  const p = seam.geometry.getAttribute('position')
  for (let i = 0; i < p.count; i++) close(Math.hypot(p.getX(i), p.getZ(i)), 5, 1e-6)
  close(Math.abs(p.getY(p.count - 1) - p.getY(0)), 10, 1e-9)
  // smlibwasm's old form, seams by position, is not the package's
  assert.throws(() => pipe.edges(true as never), { name: 'TypeError', message: /^Body\.edges\(\) takes 0 positional arguments/ })
  assert.throws(() => pipe.edges({ seam: true } as never), { name: 'TypeError', message: "Body.edges() got an unexpected option 'seam'; did you mean 'seams'?" })
})

test('selectors work in three axes: top is +y, front is +z', () => {
  const part = new Box(30, 10, 20) // 30 along x, 10 high (y), 20 along z
  closeVector(part.faces().top().one().normalAt(), Y)
  closeVector(part.faces().bottom().one().normalAt(), { x: 0, y: -1, z: 0 })
  closeVector(part.faces().front().one().normalAt(), { x: 0, y: 0, z: 1 })
  closeVector(part.faces().right().one().normalAt(), { x: 1, y: 0, z: 0 })
  assert.equal(part.edges().parallelTo(Y).length, 4)
  for (const e of part.edges().parallelTo(Y)) close(e.length, 10)
  const sorted = part.faces().sortBy(new THREE.Vector3(0, 0, 1))
  closeVector(sorted.last.normalAt(), { x: 0, y: 0, z: 1 })
  // (sorts, groups and maxima go along +y, up, by default)
  closeVector(part.faces().sortBy().last.normalAt(), Y)
  assert.deepEqual(part.faces().groupBy().map((g) => g.length), [1, 4, 1])
  assert.equal(part.faces().maxBy().one(), part.faces().top().one())
  assert.equal(part.faces().minBy().one(), part.faces().bottom().one())
  close(part.faces().largest().area, 30 * 20)
  close(part.faces().nearest(new THREE.Vector3(100, 0, 0)).center().x, 15)
})

test('at() places clones by matrices, as InstancedMesh places instances', () => {
  // (the grid lies in the XY plane, as sketches do: a pin along y, turned to z, at each place)
  const hole = new Cylinder(3, 3, 20)
  hole.rotation.x = Math.PI / 2
  const holes = hole.at(GridLocations(40, 20, 2, 2))
  assert.equal(holes.length, 4)
  for (const h of holes) assert.equal(h.geometry, hole.geometry)
  const plate = new Box(60, 40, 8).cut(holes) // 60 along x, 40 along y, 8 thick (z): lying in XY too
  close(plate.volume, 60 * 8 * 40 - 4 * Math.PI * 9 * 8, 1e-6)
  assert.equal(plate.faces().cylinders().length, 4)
})

test('a Part from a BufferGeometry (a closed mesh, welded)', () => {
  const part = new Part(new THREE.BoxGeometry(10, 20, 30))
  close(part.volume, 6000, 1e-6)
  closeBox(part.bbox(), box([-5, -10, -15], [5, 10, 15]))
  assert.equal(part.faces().length, 6)
  const ico = new Part(new THREE.IcosahedronGeometry(10, 1))
  assert.ok(ico.volume > 0 && ico.isValid())
})

test('toJSON writes plain three objects ObjectLoader reads back', () => {
  const part = new Box(10, 10, 10).cut(new Cylinder(2, 2, 20))
  const json = part.toJSON()
  const back = new THREE.ObjectLoader().parse(json)
  assert.ok(back instanceof THREE.Mesh)
  assert.equal((back as THREE.Mesh).geometry.getAttribute('position').count, part.geometry.getAttribute('position').count)
  assert.ok(back.children[0] instanceof THREE.LineSegments)
})

test('materials: the own one until one is assigned; null gives it back', () => {
  const part = new Box(1, 1, 1)
  const own = part.material
  const mine = new THREE.MeshNormalMaterial()
  part.material = mine
  assert.equal(part.material, mine)
  part.material = null as unknown as THREE.Material
  assert.equal(part.material, own)
  const lines = part.edgeLines.material
  part.edgeLines.material = new THREE.LineBasicMaterial({ color: 'red' })
  // results take over both
  part.material = mine
  const result = part.fuse(new Box(1, 1, 1, { align: 'min' }))
  assert.equal(result.material, mine)
  assert.equal((result.edgeLines.material as THREE.LineBasicMaterial).color.getHexString(), 'ff0000')
  assert.notEqual(result.edgeLines.material, lines)
})

test("a tool's scale goes to the kernel too, also one different per axis", () => {
  const block = new Box(100, 20, 100)
  const pin = new Cylinder(5, 5, 40)
  pin.scale.set(2, 1, 1) // an elliptic pin: 10 by 5
  close(block.cut(pin).volume, 100 * 100 * 20 - Math.PI * 10 * 5 * 20, 1e-6)
  const ball = new Ball(4)
  ball.scale.setScalar(2)
  // (radius 8, cut to 5 above and below: less two caps 3 high)
  const cap = (Math.PI * 3 ** 2 * (3 * 8 - 3)) / 3
  close(new Box(100, 10, 100).intersect(ball).volume, (4 / 3) * Math.PI * 8 ** 3 - 2 * cap, 1e-6)
})

test("three's own exporters write a body's tessellation, as any mesh's", async () => {
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js')
  const part = new Box(10, 10, 10).cut(new Cylinder(2, 2, 20))
  const stl = new STLExporter().parse(part) as string
  // (its edge lines are LineSegments, which STLExporter leaves out)
  assert.equal(stl.match(/facet normal/g)!.length, part.geometry.getIndex()!.count / 3)
})
