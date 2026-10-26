// Surfaces in three's terms: points are THREE.Vector3s (a grid's normal by the right-hand rule, a
// cloud's up, +y), three's NURBSSurface reads as it evaluates, curves are Edges, Wires or three's
// curves, and the pieces of ruled, stitch, fill, blend and surfaceFillet are taken where they are.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { NURBSSurface } from 'three/addons/curves/NURBSSurface.js'
import * as sm from '@classcad/smlibwasm'
import { Box, Line, ModelingError, Part, Rectangle, Shell, Sphere, Spline } from '../src/index.ts'
import { blend, FitReport, fill, network, nurbsSurface, ruled, StitchReport, stitch, surface, surfaceFillet } from '../src/surfaces.ts'
import { box, close, closeBox, closeVector } from './_util.ts'

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
/** A point of smlibpy's docs (Z up) in three's coordinates. */
const zUp = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y)

/** Rows of points that follow one another along +z, each running along +x: a terrain. */
function terrainRows(): THREE.Vector3[][] {
  const rows: THREE.Vector3[][] = []
  for (let z = 0; z <= 40; z += 10) {
    const row: THREE.Vector3[] = []
    for (let x = 0; x <= 60; x += 10) row.push(v(x, 5 * Math.sin(x / 12) * Math.cos(z / 12), z))
    rows.push(row)
  }
  return rows
}

test('a surface through a grid of points faces up, and reports how close it came', () => {
  const rows = terrainRows()
  const terrain = surface(rows)
  assert.ok(terrain instanceof Shell)
  assert.equal(terrain.faces().length, 1)
  // through every point
  for (const row of rows) for (const p of row) assert.ok(terrain.distanceTo(p) < 1e-9)
  // rows along +z of points along +x: (along the rows) x (along a row) is +y
  assert.ok(terrain.faces()[0].normalAt().y > 0.9)
  closeBox(terrain.bbox(), box([0, -5.05, 0], [60, 5, 40]), 0.05)
  const [again, fit] = surface(rows, { report: true })
  assert.ok(again instanceof Shell && fit instanceof FitReport)
  assert.equal(fit.distances.length, 35)
  assert.ok(fit.maxDistance < 1e-9 && fit.rmsDistance <= fit.maxDistance)
  // as control points: smoother, near the points only
  const [, loose] = surface(rows, { interpolate: false, report: true })
  assert.ok(loose.maxDistance > 1e-3)
  // a cloud of points in any order: fitted, facing up
  let seed = 1
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const cloud: THREE.Vector3[] = []
  for (let i = 0; i < 500; i++) {
    const x = random() * 60 - 30
    const z = random() * 60 - 30
    cloud.push(v(x, 6 * Math.exp(-(x * x + z * z) / 300), z))
  }
  const [scan, report] = surface(cloud, { report: true })
  assert.ok(scan.faces()[0].normalAt().y > 0.99)
  assert.ok(report.maxDistance < 0.2 && report.rmsDistance < 0.05, `${report.maxDistance} ${report.rmsDistance}`)
  assert.throws(() => surface(rows.slice(0, 3)), RangeError)
})

test("nurbsSurface takes NURBS data, and three's NURBSSurface as three evaluates it", () => {
  // smlibpy's dome: a 3 x 3 net of degree 2 whose middle weight pulls less, up 18/7 (in three: y)
  const net = [
    [v(0, 0, 0), v(0, 0, 10), v(0, 0, 20)],
    [v(10, 5, 0), v(10, 8, 10), v(10, 5, 20)],
    [v(20, 0, 0), v(20, 0, 10), v(20, 0, 20)],
  ]
  const weights = [
    [1, 1, 1],
    [1, 0.5, 1],
    [1, 1, 1],
  ]
  const dome = nurbsSurface(net, null, 2, weights)
  assert.ok(dome instanceof Shell)
  close(dome.bbox().max.y, 18 / 7, 1e-9)
  // the data in one object, as Face.nurbs() gives it: its inverse
  const same = nurbsSurface({ degrees: [2, 2], knots: [[0, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1]], points: net, weights })
  close(same.bbox().max.y, 18 / 7, 1e-9)
  const again = nurbsSurface(surface(terrainRows()).faces()[0].nurbs())
  for (const row of terrainRows()) for (const q of row) assert.ok(again.distanceTo(q) < 1e-9)
  // three's NURBSSurface: control points as Vector4s with their weights in w, degree1 and knots1
  // along the first index (here degree 2 by 3, 3 x 4 points)
  const points: THREE.Vector4[][] = []
  for (let i = 0; i < 3; i++) {
    const row: THREE.Vector4[] = []
    for (let j = 0; j < 4; j++) row.push(new THREE.Vector4(i * 10, Math.sin(i + j) * 3, j * 7, 1 + 0.3 * ((i + j) % 2)))
    points.push(row)
  }
  const nurbs = new NURBSSurface(2, 3, [0, 0, 0, 1, 1, 1], [0, 0, 0, 0, 1, 1, 1, 1], points)
  const sheet = nurbsSurface(nurbs)
  const p = new THREE.Vector3()
  for (let s = 0; s <= 4; s++) {
    for (let t = 0; t <= 4; t++) {
      nurbs.getPoint(s / 4, t / 4, p)
      assert.ok(sheet.distanceTo(p) < 1e-9, `(${s / 4}, ${t / 4}): ${sheet.distanceTo(p)}`)
    }
  }
  assert.throws(() => nurbsSurface({ points: net } as never), TypeError)
})

test('ruled sheets between curves, in the frame of the first', () => {
  const sheet = ruled(new Line(v(0, 0, 0), v(20, 0, 0)), new Line(v(0, 0, -20), v(20, 0, -20)))
  assert.ok(sheet instanceof Shell)
  close(sheet.area, 400, 1e-9)
  closeVector(sheet.faces()[0].normalAt(), { x: 0, y: 1, z: 0 }, 1e-12)
  // a twisted one, between a curve of three's and an edge
  const twisted = ruled(new THREE.LineCurve3(v(0, 0, 0), v(20, 0, 0)), new Line(zUp(0, 20, 10), zUp(20, 20, -10)))
  assert.ok(twisted.area > 400)
  // the first curve moved: the sheet has its transform, the second is taken where it is
  const a = new Line(v(0, 0, 0), v(20, 0, 0))
  a.position.set(0, 5, 0)
  const b = new Line(v(0, 5, -20), v(20, 5, -20))
  const placed = ruled(a, b)
  closeVector(placed.position, a.position, 0)
  closeBox(placed.bbox(), box([0, 0, -20], [20, 0, 0]), 1e-9)
})

test('stitch: the six faces of a box sew into a Part, pieces taken where they are', () => {
  const block = new Box(10, 20, 30) // 10 along x, 20 along z, 30 high
  block.position.set(5, 0, -3)
  const [solid, report] = stitch(block.faces(), { report: true })
  assert.ok(solid instanceof Part)
  close(solid.volume, 6000, 1e-6)
  assert.ok(report instanceof StitchReport)
  assert.equal(report.sewnEdges, 12)
  assert.equal(report.openEdges, 0)
  assert.equal(report.maxGap, 0)
  // in the frame of the first piece (its body's), with its transform
  closeVector(solid.position, block.position, 0)
  closeBox(solid.bbox(), block.bbox(), 1e-9)
  // an open box closed by the bottom face of a lid that stands on it: the lid's face where it is
  const lid = new Box(10, 20, 30)
  lid.position.set(5, 30, -3)
  const cup = block.faces().filter((f) => f.normalAt().y < 0.5)
  const closed = stitch(cup, lid.faces().bottom().one())
  assert.ok(closed instanceof Part)
  close(closed.volume, 6000, 1e-6)
  // pieces that do not close: a sheet
  const open = stitch(cup)
  assert.ok(open instanceof Shell)
  assert.throws(() => stitch(), RangeError)
})

test('fill closes a hole tangent to its sheet, and four curves with a Coons patch', () => {
  // a sphere cut off above y = 8: its round face, a sheet with a hole, closed by a tangent cap
  const cutter = new Box(30, 30, 30)
  cutter.position.y = 23
  const cut = new Sphere(10).cut(cutter)
  const dome = stitch(cut.faces().filter((f) => f.geomType === 'sphere'))
  assert.ok(dome instanceof Shell)
  const cap = fill(dome.edges().filter((e) => e.faces().length === 1))
  assert.ok(cap instanceof Shell)
  const ball = stitch(dome, cap)
  assert.ok(ball instanceof Part)
  close(ball.volume, 4141.52, 0.01) // (smlibpy's)
  // four splines, in any order: smlibpy's Coons patch
  const sides = [
    new Spline([zUp(0, 0, 0), zUp(5, 0, 2), zUp(10, 0, 0)]),
    new Spline([zUp(10, 0, 0), zUp(10, 5, 1), zUp(10, 10, 0)]),
    new Spline([zUp(10, 10, 0), zUp(5, 10, 2), zUp(0, 10, 0)]),
    new Spline([zUp(0, 10, 0), zUp(0, 5, 1), zUp(0, 0, 0)]),
  ]
  close(fill(sides).area, 112.2176, 1e-4)
  close(fill([sides[2], sides[0], sides[3], sides[1]]).area, 112.2176, 1e-4)
  // the sheet moved: the cap is in its frame and still meets it
  dome.position.set(0, 40, 0)
  const moved = fill(dome.edges().filter((e) => e.faces().length === 1))
  closeVector(moved.position, dome.position, 0)
  closeBox(moved.bbox(), cap.bbox(), 1e-9)
})

test('blend bridges border edges of two sheets, each where it is', () => {
  // smlibpy's bridge: two 20 x 20 sheets, the second 10 higher and 40 along x
  const low = new Rectangle(20, 20)
  low.position.x = -20
  const high = new Rectangle(20, 20)
  high.position.set(20, 10, 0)
  const lowEdge = low.edges().filter((e) => Math.abs(e.center().x - 10) < 1e-9).one() // (at world x -10)
  const highEdge = high.edges().filter((e) => Math.abs(e.center().x + 10) < 1e-9).one() // (at world x 10)
  const bridge = blend(lowEdge, highEdge)
  assert.ok(bridge instanceof Shell)
  close(bridge.area, 466.054, 1e-3) // (smlibpy's)
  // in the frame of the first edge's sheet: from its edge to the other, 10 up
  closeVector(bridge.position, low.position, 0)
  closeBox(bridge.bbox(), box([10, 0, -10], [30, 10, 10]), 1e-6)
  const step = blend(lowEdge, highEdge, { tension: [0.5, 2], join: true })
  assert.equal(step.faces().length, 3)
  assert.ok(step.thicken(1).isValid())
  assert.throws(() => blend(lowEdge, new Line() as never), /edge/)
})

test('surfaceFillet rounds between two faces, the second where it is', () => {
  const floor = new Rectangle(40, 40) // on the ground, facing up
  const wall = new Rectangle(40, 40)
  wall.rotation.x = Math.PI / 2 // standing in three's XY plane, facing +z
  const rounding = surfaceFillet(floor.faces()[0], wall.faces()[0], 5)
  assert.ok(rounding instanceof Shell)
  close(rounding.area, (Math.PI / 2) * 5 * 40, 1e-6) // a quarter circle, 40 long
  // above the floor, on the side of the wall its normal points to
  closeBox(rounding.bbox(), box([-20, 0, 0], [20, 5, 5]), 1e-6)
  const bevel = surfaceFillet(floor.faces()[0], wall.faces()[0], 5, { shape: 'chamfer' })
  close(bevel.area, 40 * 5 * Math.SQRT2, 1e-6)
  const one = surfaceFillet(floor.faces()[0], wall.faces()[0], 5, { trim: true })
  assert.equal(one.faces().length, 3)
})

test('network: a sheet through crossing curves', () => {
  const h = (x: number, y: number) => Math.sin((Math.PI * x) / 10) * (1 + 0.03 * y) + 0.5 * Math.sin((Math.PI * y) / 10)
  const us = [0, 5, 10].map((y) => new Spline([0, 2, 5, 7.5, 10].map((x) => zUp(x, y, h(x, y)))))
  const vs = [0, 5, 10].map((x) => new Spline([0, 3, 5, 8, 10].map((y) => zUp(x, y, h(x, y)))))
  const skin = network(us, vs)
  assert.ok(skin instanceof Shell)
  for (const c of [...us, ...vs]) for (const t of [0.1, 0.37, 0.8]) assert.ok(skin.distanceTo(c.pointAt(t)) < 2e-6)
  assert.throws(() => network(us[0] as never, vs), TypeError)
})

test("the kernel's errors are the package's own", () => {
  // two parallel sheets 100 apart leave no room for a ball of 5
  const a = new Rectangle(10, 10)
  const b = new Rectangle(10, 10)
  b.position.y = 100
  let error: unknown
  try {
    surfaceFillet(a.faces()[0], b.faces()[0], 5)
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof ModelingError && !(error instanceof sm.ModelingError), String(error))
  assert.equal((error as Error).cause, undefined)
  noKernel(error, 'error')
  // curves that do not close, or do not cross: RangeErrors, as smlibpy's ValueErrors
  assert.throws(() => fill([new Line(v(0, 0, 0), v(10, 0, 0)), new Line(v(10, 0, 0), v(10, 0, 10)), new Line(v(10, 0, 10), v(0, 0, 12))]), RangeError)
  assert.throws(() => network([new Line(v(0, 0, 0), v(10, 0, 0)), new Line(v(0, 0, 10), v(10, 0, 10))], [new Line(v(50, 0, 0), v(50, 0, 10)), new Line(v(60, 0, 0), v(60, 0, 10))]), RangeError)
})

test('nothing of smlibwasm comes out of the surfaces', () => {
  const rows = terrainRows()
  const block = new Box(10, 20, 30)
  const low = new Rectangle(20, 20)
  low.position.x = -20
  const high = new Rectangle(20, 20)
  high.position.set(20, 10, 0)
  const floor = new Rectangle(40, 40)
  const wall = new Rectangle(40, 40)
  wall.rotation.x = Math.PI / 2
  const results: unknown[] = [
    surface(rows),
    surface(rows, { report: true }),
    nurbsSurface(rows.slice(0, 4).map((r) => r.slice(0, 4))),
    ruled(new Line(v(0, 0, 0), v(20, 0, 0)), new Line(v(0, 0, -20), v(20, 0, -20))),
    stitch(block.faces(), { report: true }),
    blend(low.edges().filter((e) => Math.abs(e.center().x - 10) < 1e-9).one(), high.edges().filter((e) => Math.abs(e.center().x + 10) < 1e-9).one()),
    surfaceFillet(floor.faces()[0], wall.faces()[0], 5),
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
})
