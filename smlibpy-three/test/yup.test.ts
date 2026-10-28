// three's coordinates: no axis change. A point of three's is the kernel's as it is; the primitives
// take the arguments of three's geometries and stand as those do (their exact boxes are the boxes of
// three's own geometries, made with many segments, within a segment's chord height); sketches lie in
// the XY plane and extrude along +z, as ShapeGeometry and ExtrudeGeometry do; the selectors go along
// three's directions; and files keep the coordinates they have.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import {
  AnnularSector,
  Ball,
  Box,
  CenterArc,
  Cone,
  Cylinder,
  Helix,
  PolarLocations,
  Polygon,
  Pyramid,
  Rectangle,
  Segment,
  Sketch,
  STEPExporter,
  STEPLoader,
  Text,
  Torus,
  Wedge,
  type BallOptions,
  type Part,
} from '../src/index.ts'
import { kernelOf, kernelOfShape } from '../src/shapes.ts'
import { box, close, closeBox, closeVector, Y } from './_util.ts'

/** The box of one of three's geometries, as three computes it. */
function boxOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox()
  const b = geometry.boundingBox!.clone()
  geometry.dispose()
  return b
}

// three's geometries are made with many segments; their boxes fall short of the exact ones by at
// most a segment's chord height (where a box touches a curve between two of three's points), on up
// to two axes
const SEGMENTS = 256
const chord = (radius: number, step = (2 * Math.PI) / SEGMENTS) => 2 * radius * (1 - Math.cos(step / 2)) + 1e-9

// sectors, from thetaStart over thetaLength radians: quarters, thirds, from a negative start, past a
// whole turn
const SECTORS: [number, number][] = [[0, Math.PI / 2], [Math.PI / 2, Math.PI / 2], [Math.PI / 6, Math.PI / 3], [Math.PI, (3 * Math.PI) / 4], [-Math.PI / 4, Math.PI / 2], [1, 4], [5, 2]]

/** The area of a part's planar faces at height y: its caps there. */
function capArea(part: Part, y: number): number {
  return part.faces().planar().filter((f) => Math.abs(f.getCenter().y - y) < 1e-9).reduce((sum, f) => sum + f.area, 0)
}

test("three's (x, y, z) is the kernel's: points and boxes cross as they are", () => {
  const segment = new Segment(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6))
  const edge = kernelOfShape(segment) as sm.Edge
  closeVector(edge.start, { x: 1, y: 2, z: 3 }, 0)
  closeVector(edge.end, { x: 4, y: 5, z: 6 }, 0)
  // a box 2 wide (x), 4 high (y) and 6 deep (z) is the kernel's so
  const b = (kernelOf(new Box(2, 4, 6)) as sm.Part).bbox()
  closeVector(b.min, { x: -1, y: -2, z: -3 }, 0)
  closeVector(b.max, { x: 1, y: 2, z: 3 }, 0)
  // and what the kernel makes comes back as it is: its box 2 by 4 by 6 along x, y and z, from a STEP file it wrote
  const [read] = new STEPLoader().parse(sm.toStep(sm.Box(2, 4, 6))).children as Part[]
  closeBox(read.bbox(), box([-1, -2, -3], [1, 2, 3]), 1e-9)
})

test("boxes, cylinders, frustums and cones stand as three's geometries of them do (their sectors too), pyramids and wedges as boxes", () => {
  // three's arguments and defaults: width along x, height along y, depth along z, centered
  closeBox(new Box().bbox(), boxOf(new THREE.BoxGeometry()), 1e-12)
  closeBox(new Box(8, 6, 4).bbox(), boxOf(new THREE.BoxGeometry(8, 6, 4)), 1e-12)
  // (align moves a solid by its box, per axis: { y: 'min' } stands it on the XZ plane)
  closeBox(new Box(80, 10, 60, { align: { y: 'min' } }).bbox(), box([-40, 0, -30], [40, 10, 30]))
  closeBox(new Box(8, 1, 6, { align: 'min' }).bbox(), box([0, 0, 0], [8, 1, 6]))
  closeBox(new Cylinder().bbox(), boxOf(new THREE.CylinderGeometry(1, 1, 1, SEGMENTS)), chord(1))
  closeBox(new Cone().bbox(), boxOf(new THREE.ConeGeometry(1, 1, SEGMENTS)), chord(1))
  // along y, centered, radiusTop at the top (+y): different radii a frustum, one of 0 a cone
  for (const [radiusTop, radiusBottom] of [[5, 5], [2, 6], [6, 2], [0, 4], [4, 0]]) {
    const what = `Cylinder(${radiusTop}, ${radiusBottom}, 10)`
    const r = Math.max(radiusTop, radiusBottom)
    const cylinder = new Cylinder(radiusTop, radiusBottom, 10)
    closeBox(cylinder.bbox(), boxOf(new THREE.CylinderGeometry(radiusTop, radiusBottom, 10, SEGMENTS)), chord(r), what)
    close(capArea(cylinder, 5), Math.PI * radiusTop ** 2, 1e-9, `${what} at the top`)
    close(capArea(cylinder, -5), Math.PI * radiusBottom ** 2, 1e-9, `${what} at the bottom`)
    // sectors about +y from +z (theta 0) towards +x (π/2), as three's
    for (const [thetaStart, thetaLength] of SECTORS) {
      const sector = new Cylinder(radiusTop, radiusBottom, 10, { thetaStart, thetaLength })
      const three = boxOf(new THREE.CylinderGeometry(radiusTop, radiusBottom, 10, SEGMENTS, 1, false, thetaStart, thetaLength))
      closeBox(sector.bbox(), three, chord(r, thetaLength / SEGMENTS), `${what} from ${thetaStart} over ${thetaLength}`)
    }
  }
  // a cone's tip at the top (+y), its base at the bottom
  for (const [thetaStart, thetaLength] of [[0, 2 * Math.PI], ...SECTORS]) {
    const cone = new Cone(5, 8, { thetaStart, thetaLength })
    const three = boxOf(new THREE.ConeGeometry(5, 8, SEGMENTS, 1, false, thetaStart, thetaLength))
    closeBox(cone.bbox(), three, chord(5, thetaLength / SEGMENTS), `Cone(5, 8) from ${thetaStart} over ${thetaLength}`)
  }
  close(capArea(new Cone(5, 8), -4), Math.PI * 25, 1e-9)
  close(capArea(new Cone(5, 8), 4), 0, 1e-9)
  // the solids three has none of stand as a box does: a pyramid's apex up, a wedge's high side at -x
  const pyramid = new Pyramid(10, 9, 6)
  closeBox(pyramid.bbox(), boxOf(new THREE.BoxGeometry(10, 9, 6)), 1e-9)
  closeVector(pyramid.vertices().top().one().point, { x: 0, y: 4.5, z: 0 }, 1e-9)
  close(pyramid.faces().bottom().one().area, 10 * 6, 1e-9)
  const wedge = new Wedge(10, 5, 4, 3)
  closeBox(wedge.bbox(), boxOf(new THREE.BoxGeometry(10, 5, 4)), 1e-9)
  close(wedge.faces().left().one().area, 5 * 4, 1e-9) // (the high side, at x = -5)
  closeBox(wedge.faces().top().one().bbox(), box([-5, 2.5, -2], [-2, 2.5, 2]), 1e-9) // (its flat top, 3 wide from there)
})

test("balls, tori and annular sectors lie as three's spheres, tori and rings do", () => {
  // a ball's poles on y, theta down from +y, phi about +y from -x (x = -cos φ sin θ, z = sin φ sin θ)
  const parts: BallOptions[] = [
    {},
    { phiLength: Math.PI / 2 },
    { phiStart: Math.PI / 2, phiLength: Math.PI / 2 },
    { phiStart: 1, phiLength: 2 },
    { phiLength: Math.PI },
    { thetaLength: Math.PI / 2 },
    { thetaStart: Math.PI / 2, thetaLength: Math.PI / 2 },
    { thetaStart: Math.PI / 4, thetaLength: Math.PI / 2 },
    { thetaLength: Math.PI / 3 },
    { thetaStart: 2, thetaLength: Math.PI - 2 },
    { phiStart: 0.5, phiLength: 1.5, thetaLength: 1 },
    { phiStart: 3, phiLength: 2, thetaStart: 2, thetaLength: Math.PI - 2 },
  ]
  closeBox(new Ball().bbox(), boxOf(new THREE.SphereGeometry(1, SEGMENTS, SEGMENTS / 2)), chord(1))
  for (const o of parts) {
    const { phiStart = 0, phiLength = 2 * Math.PI, thetaStart = 0, thetaLength = Math.PI } = o
    const three = boxOf(new THREE.SphereGeometry(10, SEGMENTS, SEGMENTS / 2, phiStart, phiLength, thetaStart, thetaLength))
    closeBox(new Ball(10, o).bbox(), three, chord(10, Math.max(phiLength / SEGMENTS, thetaLength / (SEGMENTS / 2))), `Ball(10, ${JSON.stringify(o)})`)
  }
  // what three leaves open is flat, and the ball's center stays at the origin: a quarter of the
  // ball, its upper half, the zone between the planes y = 5 and y = -5 (60 to 120 degrees from +y)
  const whole = (4 / 3) * Math.PI * 10 ** 3
  close(new Ball(10, { phiLength: Math.PI / 2 }).volume, whole / 4, 1e-6)
  close(new Ball(10, { thetaLength: Math.PI / 2 }).volume, whole / 2, 1e-6)
  close(new Ball(10, { thetaStart: Math.PI / 3, thetaLength: Math.PI / 3 }).volume, Math.PI * (10 ** 2 * 10 - (5 ** 3 + 5 ** 3) / 3), 1e-6)
  // a torus in the XY plane around z, its arc from +x counterclockwise about +z
  closeBox(new Torus().bbox(), boxOf(new THREE.TorusGeometry(1, 0.4, SEGMENTS / 4, SEGMENTS)), chord(1.4))
  for (const arc of [1, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI]) {
    closeBox(new Torus(10, 2, { arc }).bbox(), boxOf(new THREE.TorusGeometry(10, 2, SEGMENTS / 4, SEGMENTS, arc)), chord(12, arc / SEGMENTS), `Torus(10, 2, { arc: ${arc} })`)
  }
  // an annular sector lies in the XY plane as three's ring does, from +x counterclockwise about +z,
  // its height along z
  const ring = (inner: number, outer: number, height: number, thetaStart = 0, thetaLength = 2 * Math.PI) => {
    const b = boxOf(new THREE.RingGeometry(inner, outer, SEGMENTS, 1, thetaStart, thetaLength))
    b.min.z = -height / 2
    b.max.z = height / 2
    return b
  }
  closeBox(new AnnularSector().bbox(), ring(0.5, 1, 1), chord(1))
  for (const [thetaStart, thetaLength] of SECTORS) {
    const sector = new AnnularSector(5, 10, 4, { thetaStart, thetaLength })
    closeBox(sector.bbox(), ring(5, 10, 4, thetaStart, thetaLength), chord(10, thetaLength / SEGMENTS), `AnnularSector(5, 10, 4) from ${thetaStart} over ${thetaLength}`)
  }
})

test('sketches lie in the XY plane facing +z, and extrude along +z, as ShapeGeometry and ExtrudeGeometry do', () => {
  const shape = new THREE.Shape().moveTo(0, 0).lineTo(30, 0).quadraticCurveTo(40, 10, 30, 20).lineTo(0, 20).lineTo(0, 0)
  shape.holes.push(new THREE.Path().absarc(10, 10, 4, 0, Math.PI * 2, false))
  const sketch = new Sketch(shape)
  closeBox(sketch.bbox(), boxOf(new THREE.ShapeGeometry(shape, 64)), 1e-9)
  closeVector(sketch.plane.normal, { x: 0, y: 0, z: 1 })
  const solid = sketch.extrude(7)
  closeBox(solid.bbox(), boxOf(new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false, curveSegments: 64 })), 1e-9)
  const front = solid.faces().front().one()
  closeVector(front.normalAt(), { x: 0, y: 0, z: 1 })
  close(front.getCenter().z, 7, 1e-9)
  close(front.area, sketch.area, 1e-9)
  // a sketch's own (x, y) is three's (x, y)
  const triangle = new Polygon([new THREE.Vector2(0, 0), new THREE.Vector2(10, 0), new THREE.Vector2(0, 10)])
  closeBox(triangle.bbox(), box([0, 0, 0], [10, 10, 0]))
  // revolved about its y axis by default, as LatheGeometry turns its points about y; part of a turn
  // from where the profile lies (+x, three's phi of π/2), turning as phi does
  const points = [new THREE.Vector2(0, -5), new THREE.Vector2(6, -5), new THREE.Vector2(4, 0), new THREE.Vector2(8, 5), new THREE.Vector2(0, 5)]
  const profile = new Polygon(points)
  closeBox(profile.revolve().bbox(), boxOf(new THREE.LatheGeometry(points, SEGMENTS)), chord(8))
  closeBox(profile.revolve(null, Math.PI / 2).bbox(), boxOf(new THREE.LatheGeometry(points, SEGMENTS, Math.PI / 2, Math.PI / 2)), chord(8))
  // text reads from +z, where three's default camera is: x to the right, lines below each other along -y
  const L = new Text('L', 10)
  const b = L.bbox()
  close(b.max.z - b.min.z, 0, 1e-9)
  close(L.distanceTo(new THREE.Vector3(b.min.x + 0.3, b.max.y - 0.3, 0)), 0, 1e-9) // (its stem, on the left)
  close(L.distanceTo(new THREE.Vector3(b.max.x - 0.3, b.min.y + 0.3, 0)), 0, 1e-9) // (its foot, to the right)
  assert.ok(L.distanceTo(new THREE.Vector3(b.max.x - 0.3, b.max.y - 0.3, 0)) > 1) // (nothing at its top right)
  const lines = new Text('L\nLL', 10).faces().groupBy(Y)
  assert.deepEqual(lines.map((g) => g.length), [2, 1]) // (the second line, of two letters, below the first)
  // curves in a plane lie in the plane of constant z through their center, counterclockwise seen
  // from +z, from +x towards +y (as three's EllipseCurve)
  const arc = new CenterArc(new THREE.Vector3(0, 0, 2), 5, 0, Math.PI / 2)
  closeVector(arc.start, { x: 5, y: 0, z: 2 }, 1e-9)
  closeVector(arc.end, { x: 0, y: 5, z: 2 }, 1e-9)
  const ellipse = new THREE.EllipseCurve(0, 0, 5, 5, 0, Math.PI / 2)
  for (const t of [0.25, 0.5, 0.75]) {
    const p = ellipse.getPoint(t)
    close(arc.distanceTo(new THREE.Vector3(p.x, p.y, 2)), 0, 1e-9)
  }
  // patterns lie there too, from +x counterclockwise
  const polar = PolarLocations(10, 4).map((m) => new THREE.Vector3().setFromMatrixPosition(m))
  closeVector(polar[0], { x: 10, y: 0, z: 0 }, 1e-9)
  closeVector(polar[1], { x: 0, y: 10, z: 0 }, 1e-9)
  // turned to lie on the XZ plane (a floor) by its transform, as any three object: it extrudes up
  const floor = new Rectangle(20, 10)
  floor.rotation.x = -Math.PI / 2
  const slab = floor.extrude(3)
  slab.updateMatrixWorld()
  closeBox(new THREE.Box3().setFromObject(slab), box([-10, 0, -5], [10, 3, 5]), 1e-5)
})

test('a sketch of a THREE.Shape revolves about its y axis by default, as LatheGeometry does', () => {
  const points = [new THREE.Vector2(0, -5), new THREE.Vector2(6, -5), new THREE.Vector2(4, 0), new THREE.Vector2(8, 5), new THREE.Vector2(0, 5)]
  closeBox(new Sketch(new THREE.Shape(points)).revolve().bbox(), boxOf(new THREE.LatheGeometry(points, SEGMENTS)), chord(8))
  // (a rectangle beside the axis: a cylinder, as LatheGeometry makes one of its outline)
  close(new Rectangle(4, 10, { align: { x: 'min' } }).revolve().volume, Math.PI * 4 ** 2 * 10, 1e-6)
})

test("a helix rises along +z, as three's HelixCurve (addons) does", async () => {
  const { HelixCurve } = await import('three/addons/curves/CurveExtras.js')
  const three = new HelixCurve() // (30 in radius, 150 high, 5 turns)
  const helix = new Helix(30, 150, 30)
  for (let i = 0; i <= 20; i++) closeVector(helix.pointAt(i / 20), three.getPoint(i / 20), 1e-6, `at ${i / 20}`)
})

test("the selectors go along three's directions: top +y, front +z, right +x", () => {
  const part = new Box(30, 10, 20) // 30 along x, 10 high (y), 20 along z
  const faces = part.faces()
  closeVector(faces.top().one().normalAt(), { x: 0, y: 1, z: 0 })
  closeVector(faces.bottom().one().normalAt(), { x: 0, y: -1, z: 0 })
  closeVector(faces.front().one().normalAt(), { x: 0, y: 0, z: 1 })
  closeVector(faces.back().one().normalAt(), { x: 0, y: 0, z: -1 })
  closeVector(faces.right().one().normalAt(), { x: 1, y: 0, z: 0 })
  closeVector(faces.left().one().normalAt(), { x: -1, y: 0, z: 0 })
  // edges and vertices too, by where they are
  assert.equal(part.edges().top().length, 4)
  for (const e of part.edges().top()) close(e.getCenter().y, 5, 1e-9)
  assert.equal(part.vertices().front().length, 4)
  for (const v of part.vertices().front()) close(v.point.z, 10, 1e-9)
  assert.equal(part.edges().right().length, 4)
  for (const e of part.edges().right()) close(e.getCenter().x, 15, 1e-9)
})

test("transforms are three's: a rotation about y turns a tool as it turns a three mesh", () => {
  const tool = new Box(40, 4, 4)
  tool.rotation.y = Math.PI / 6
  tool.position.set(3, 10, -2)
  tool.updateMatrixWorld()
  const block = new Box(100, 20, 100, { align: { y: 'min' } })
  // the tool lies inside the block: what they share is the tool, where three draws it
  const shared = block.intersect(tool)
  close(shared.volume, 40 * 4 * 4, 1e-6)
  closeBox(shared.bbox(), new THREE.Box3().setFromObject(tool, true), 1e-6)
  close(block.cut(tool).volume, 100 * 100 * 20 - 40 * 4 * 4, 1e-6)
})

test('STEP files keep the coordinates: a part standing along y in three stands along y in the file', () => {
  const tall = new Cylinder(5, 5, 40, { align: { y: 'min' } })
  tall.name = 'pin'
  tall.material = new THREE.MeshStandardMaterial({ color: '#336699' })
  tall.position.set(10, 0, -20)
  const text = new STEPExporter().parse(tall)
  // read by the kernel itself: the part's height along y, placed where the scene shows it
  const read = sm.fromStep(text) as sm.Part
  const b = read.bbox()
  close(b.max.y - b.min.y, 40, 1e-6)
  close(b.min.y, 0, 1e-6)
  close(b.center.x, 10, 1e-6)
  close(b.center.z, -20, 1e-6)
  assert.equal(read.name, 'pin')
  // and back: STEPLoader gives a group of bodies (not turned), standing, named and colored as they were
  const group = new STEPLoader().parse(text)
  assert.ok(group instanceof THREE.Group)
  closeVector(group.rotation, { x: 0, y: 0, z: 0 }, 0)
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
  const text = new STEPExporter().parse([new Box(10, 20, 30), new Cylinder(2, 2, 50)])
  const url = `data:application/step;base64,${Buffer.from(text).toString('base64')}`
  const group = await new STEPLoader().loadAsync(url)
  assert.equal(group.children.length, 2)
  closeBox((group.children[0] as Part).bbox(), box([-5, -10, -15], [5, 10, 15]), 1e-6)
})
