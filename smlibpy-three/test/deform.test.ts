// Deformations in three's terms: the default axis is three's y (up), angles are radians, the bend's
// frame is a THREE.Matrix4, points are THREE.Vector3s, a lattice is indexed along x, y (up) and z;
// shapes deform in their own frame and keep their transform.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, CenterArc, Cylinder, Edge, Helix, Line, ModelingError, Part, Rectangle, Shell, Sketch, Wire } from '../src/index.ts'
import { bend, Lattice, taper, twist, unroll } from '../src/deform.ts'
import { box, close, closeBox, closeVector, Y } from './_util.ts'

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

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

test('a bar standing along y twists about y: its volume stays, its top turns a quarter', () => {
  const bar = new Box(30, 10, 100) // 30 along x, 10 along z, 100 high
  const twisted = twist(bar, Math.PI / 2)
  assert.ok(twisted instanceof Part)
  close(twisted.volume, 30 * 10 * 100, 1e-3)
  assert.equal(twisted.faces().length, 6)
  // the bottom stays, the top is turned by a quarter about y: 10 along x, 30 along z
  const bottom = twisted.faces().bottom().one()
  const top = twisted.faces().top().one()
  assert.equal(top.geomType, 'plane')
  closeBox(bottom.bbox(), box([-15, -50, -5], [15, -50, 5]), 1e-6)
  closeBox(top.bbox(), box([-5, 50, -15], [5, 50, 15]), 1e-6)
  // counterclockwise seen from above (+y), as three's rotations about y turn
  const corner = v(15, 50, 5).applyAxisAngle(Y, Math.PI / 2)
  assert.ok(top.vertices().some((x) => x.point.distanceTo(corner) < 1e-6))
  // start and end limit it; what lies beyond end turns as a whole
  const baluster = twist(new Box(16, 16, 200), 2 * Math.PI, { start: -50, end: 50 })
  assert.equal(baluster.faces().length, 14)
})

test('a cylinder standing along y tapers into an exact cone', () => {
  const grip = taper(new Cylinder(10, 50), 0.5)
  close(grip.volume, (Math.PI * 50 * (10 * 10 + 10 * 5 + 5 * 5)) / 3, 1e-6)
  closeBox(grip.bbox(), box([-10, -25, -10], [10, 25, 10]), 1e-9)
  assert.ok(grip.faces().some((f) => f.geomType === 'cone'))
  close(grip.faces().top().one().area, Math.PI * 25, 1e-9)
  // along another axis: a THREE.Ray, in the part's frame
  const wedge = taper(new Box(100, 20, 20), 0.25, { axis: new THREE.Ray(v(0, 0, 0), v(1, 0, 0)) })
  closeBox(wedge.bbox(), box([-50, -10, -10], [50, 10, 10]), 1e-9)
  close(wedge.faces().right().one().area, 5 * 5, 1e-9)
})

test('bend and unroll: a bar bent up into a quarter circle unrolls into the bar again', () => {
  const bar = new Box(100, 10, 10) // along x
  const bent = bend(bar, Math.PI / 2) // the whole bar, up (+y) about an axis along z
  close(bent.volume, 10000, 1e-6)
  const r = 100 / (Math.PI / 2)
  closeBox(bent.bbox(), box([-50, -5, -5], [-50 + r + 5, r, 5]), 1e-4) // (the kernel's box of the bend's faces: within 1e-5)
  const cylinders = bent.faces().cylinders()
  assert.equal(cylinders.length, 2)
  for (const f of cylinders) {
    closeVector(f.axis.origin.clone().setZ(0), { x: -50, y: r, z: 0 }, 1e-9)
    closeVector({ x: 0, y: 0, z: Math.abs(f.axis.direction.z) }, { x: 0, y: 0, z: 1 }, 1e-12)
  }
  // unrolled about that axis, its start line (below the axis) staying: the bar, exactly
  const flat = unroll(bent, { radius: r, axis: new THREE.Ray(v(-50, r, 0), v(0, 0, 1)), start: v(0, -1, 0) })
  closeBox(flat.bbox(), bar.bbox(), 1e-6)
  close(flat.volume, 10000, 1e-6)
  assert.equal(flat.faces().planar().length, 6)
  // a radius bends a piece of the length radius * angle, centered on the frame's origin
  const elbow = bend(new Box(160, 10, 6), Math.PI / 2, { radius: 25 })
  assert.equal(elbow.faces().cylinders().length, 2)
  close(elbow.volume, 160 * 10 * 6, 1e-6)
})

test("the bend's frame is a THREE.Matrix4: x along the part, y toward the inside of the bend", () => {
  // a cylinder standing along y, bent toward +x: x of the frame along y, y of the frame along x
  const frame = new THREE.Matrix4().makeBasis(v(0, 1, 0), v(1, 0, 0), v(0, 0, -1))
  const elbow = bend(new Cylinder(5, 100), Math.PI / 2, { plane: frame })
  const r = 100 / (Math.PI / 2)
  closeBox(elbow.bbox(), box([-5, -50, -5], [r, -50 + r + 5, 5]), 1e-6)
  close(elbow.volume, Math.PI * 25 * 100, 1e-4) // (its round faces fitted within 1e-6)
  // a sketch bends into a curved sheet: a Shell, no longer a sketch
  const sheet = bend(new Rectangle(100, 10), Math.PI / 2)
  assert.ok(sheet instanceof Shell && !(sheet instanceof Sketch))
  close(sheet.area, 1000, 1e-6)
  assert.throws(() => bend(new Box(100, 10, 10), Math.PI / 2, { plane: new THREE.Plane() as never }), /THREE\.Matrix4/)
})

test('a lattice is indexed along x, y (up) and z, and lifts the top of a box along +y', () => {
  const block = new Box(60, 40, 20) // 60 along x, 40 along z, 20 high
  const lattice = new Lattice(block, 3)
  assert.deepEqual(lattice.counts, [3, 3, 3])
  closeBox(lattice.box, block.bbox())
  closeVector(lattice.points[0][0][0], { x: -30, y: -10, z: -20 }, 0)
  closeVector(lattice.points[2][2][2], { x: 30, y: 10, z: 20 }, 0)
  closeVector(lattice.points[1][2][1], { x: 0, y: 10, z: 0 }, 0) // the middle of the top
  closeVector(lattice.points[1][1][2], { x: 0, y: 0, z: 20 }, 0) // the middle of the front
  // the whole top layer up by 8
  lattice.move(lattice.layer('y', -1), v(0, 8, 0))
  const raised = lattice.apply(block)
  assert.ok(raised instanceof Part)
  closeBox(raised.bbox(), box([-30, -10, -20], [30, 18, 20]), 1e-9)
  close(raised.volume, 60 * 40 * 28, 1e-6)
  closeVector(lattice.offsets[0][2][2], { x: 0, y: 8, z: 0 }, 0)
  closeVector(lattice.offsets[0][1][2], { x: 0, y: 0, z: 0 }, 0)
  // one point pulls the whole box: the middle of the top by 8 lifts the top's middle by 2
  const pillow = new Lattice(block, 3).move([1, -1, 1], v(0, 8, 0))
  closeVector(pillow.map(v(0, 10, 0)), { x: 0, y: 12, z: 0 }, 1e-12)
  closeVector(pillow.map(v(30, 10, 20)), { x: 30, y: 10, z: 20 }, 1e-12)
  close(pillow.apply(block).bbox().max.y, 12, 1e-9)
  // the last layer along z is the front (+z), as three's z runs
  const front = new Lattice(block, 3).move([null, null, -1], v(0, 0, 5))
  closeBox(front.apply(block).bbox(), box([-30, -10, -20], [30, 10, 25]), 1e-9)
  // counts per axis of three's
  const uneven = new Lattice(block, [2, 3, 4])
  assert.deepEqual(uneven.counts, [2, 3, 4])
  assert.deepEqual([uneven.points.length, uneven.points[0].length, uneven.points[0][0].length], [2, 3, 4])
  closeVector(uneven.points[0][0][3], { x: -30, y: -10, z: 20 }, 0)
  closeVector(uneven.points[0][2][0], { x: -30, y: 10, z: -20 }, 0)
})

test('a lattice is edited in place: points, scale, rotate, reset, clone and copy', () => {
  const block = new Box(60, 40, 20)
  const lattice = new Lattice(block, 3)
  lattice.points[1][2][1].y += 8 // writable, as smlibpy's points are
  close(lattice.map(v(0, 10, 0)).y, 12, 1e-12)
  // a copy is independent
  const copy = lattice.clone()
  lattice.reset()
  close(lattice.map(v(0, 10, 0)).y, 10, 1e-12)
  close(copy.map(v(0, 10, 0)).y, 12, 1e-12)
  assert.equal(new Lattice(block, 2).copy(copy).counts.join(), '3,3,3')
  // a repeated selection moves its points once
  lattice.move([[0, 0], null, null], v(1, 0, 0))
  closeVector(lattice.offsets[0][1][1], { x: 1, y: 0, z: 0 }, 0)
  lattice.reset()
  // the top layer narrowed along x (one factor per axis of three's), then turned about y
  lattice.scale(lattice.layer('y', -1), v(0.5, 1, 1))
  closeVector(lattice.points[2][2][0], { x: 15, y: 10, z: -20 }, 1e-12)
  lattice.rotate(lattice.layer(Y, -1), new THREE.Ray(v(0, 0, 0), Y), Math.PI / 2)
  closeVector(lattice.points[2][2][0], v(15, 10, -20).applyAxisAngle(Y, Math.PI / 2), 1e-12)
  assert.match(String(lattice), /Lattice\(3 x 3 x 3 points, 8 moved/)
  assert.throws(() => lattice.move([3, 0, 0], v(1, 0, 0)), /out of range for the 3 points along x/)
  assert.throws(() => lattice.layer('w' as never, 0), RangeError)
  assert.throws(() => new Lattice(block, 13), RangeError)
})

test('points and curves deform as the shapes do', () => {
  // points: Vector3s in, Vector3s out (start and end give the range of the part they belong to)
  const [foot, tip] = twist([v(10, 0, 0), { x: 10, y: 100, z: 0 }], Math.PI / 2, { start: 0, end: 100 })
  assert.ok(tip instanceof THREE.Vector3)
  closeVector(foot, { x: 10, y: 0, z: 0 }, 1e-12)
  closeVector(tip, v(10, 100, 0).applyAxisAngle(Y, Math.PI / 2), 1e-9)
  const one = bend(v(100, 0, 0), Math.PI / 2, { start: 0, end: 100 })
  closeVector(one, { x: 200 / Math.PI, y: 200 / Math.PI, z: 0 }, 1e-9)
  assert.deepEqual(twist([], 1), [])
  // a wire bent in its middle: a line, an exact arc and a line
  const path = bend(new Wire([new Line(v(-50, 0, 0), v(50, 0, 0))]), Math.PI / 2, { radius: 10 })
  assert.ok(path instanceof Wire)
  assert.deepEqual([...path.edges()].map((e) => e.geomType), ['line', 'circle', 'line'])
  // an edge stays one edge: a circle tapered halfway is 3/4 its size
  const rim = taper(new CenterArc(v(0, 50, 0), 10), 0.5, { start: 0, end: 100 })
  assert.ok(rim instanceof Edge)
  assert.equal(rim.geomType, 'circle')
  close(rim.radius, 7.5, 1e-9)
  // a helix about y unrolls straight
  assert.equal(unroll(new Helix(100, 40, 10), { radius: 10 }).geomType, 'line')
})

test('shapes deform in their own frame and keep their transform', () => {
  const bar = new Box(30, 10, 100)
  const moved = new Box(30, 10, 100)
  moved.position.set(100, -20, 5)
  moved.rotation.set(0.3, 0.2, 0.1)
  moved.name = 'bar'
  const material = new THREE.MeshStandardMaterial()
  moved.material = material
  const twisted = twist(moved, Math.PI / 2)
  closeBox(twisted.bbox(), twist(bar, Math.PI / 2).bbox(), 1e-9)
  closeVector(twisted.position, moved.position, 0)
  assert.ok(twisted.quaternion.equals(moved.quaternion))
  assert.equal(twisted.name, 'bar')
  assert.equal(twisted.material, material)
  // the input is as it was
  closeBox(moved.bbox(), box([-15, -50, -5], [15, 50, 5]))
  // an edge of a moved body: a curve of its own where the body is, its foot in place, its top turned
  const edge = moved.edges().parallelTo(Y).first
  const turned = twist(edge, Math.PI / 2)
  assert.ok(turned instanceof Edge && turned.owner === null)
  closeVector(turned.position, moved.position, 0)
  const [foot, top] = edge.start.y < edge.end.y ? [edge.start, edge.end] : [edge.end, edge.start]
  const tip = top.applyAxisAngle(Y, Math.PI / 2)
  const ends = [turned.start, turned.end]
  assert.ok(ends.some((p) => p.distanceTo(foot) < 1e-9))
  assert.ok(ends.some((p) => p.distanceTo(tip) < 1e-6))
  // a lattice around a moved part is in its frame
  const lattice = new Lattice(moved, 3)
  const raised = lattice.move(lattice.layer('y', -1), v(0, 8, 0)).apply(moved)
  closeVector(raised.position, moved.position, 0)
  closeBox(raised.bbox(), box([-15, -50, -5], [15, 58, 5]), 1e-9)
})

test("errors speak radians and three's types; the kernel's are the package's own", () => {
  const bar = new Box(100, 10, 10)
  assert.throws(() => twist(bar.faces().first as never, 1), (e: unknown) => e instanceof TypeError && /Part, Shell, Edge, Wire or points/.test(e.message))
  assert.throws(() => bend(bar, 3 * Math.PI), (e: unknown) => e instanceof RangeError && /2π radians/.test(e.message))
  assert.throws(() => twist(bar, Number.NaN), RangeError)
  assert.throws(() => twist(bar, 1, { axis: v(0, 1, 0) as never }), /THREE\.Ray/)
  // the bar reaches 5 from its neutral layer toward an axis only 2 away
  let error: unknown
  try {
    bend(bar, Math.PI / 2, { radius: 2 })
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof ModelingError && !(error instanceof sm.ModelingError), String(error))
  assert.equal((error as Error).cause, undefined)
})

test('nothing of smlibwasm comes out of the deformations', () => {
  const block = new Box(60, 40, 20)
  const lattice = new Lattice(block, 3).move([1, -1, 1], v(0, 8, 0))
  const results: unknown[] = [
    twist(block, 1),
    taper(block, 0.5),
    bend(new Box(100, 10, 10), Math.PI / 2),
    bend(new Rectangle(100, 10), Math.PI / 2),
    twist(block.edges().parallelTo(Y).first, 1),
    bend(new Wire([new Line(v(-50, 0, 0), v(50, 0, 0))]), Math.PI / 2, { radius: 10 }),
    twist(v(10, 0, 0), 1, { start: 0, end: 10 }),
    twist([v(10, 0, 0)], 1, { start: 0, end: 10 }),
    lattice,
    lattice.apply(block),
    lattice.map(v(0, 0, 0)),
    lattice.box,
    lattice.rest,
    lattice.offsets,
    lattice.layer('x', 0),
    lattice.clone(),
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
})
