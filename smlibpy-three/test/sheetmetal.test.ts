// Sheet metal in three's terms: angles in radians, a sheet lying on the ground (XZ) folds up (+y)
// about a THREE.Ray on its top face, flanges go on edges picked by three's selectors, and flat
// patterns lie on the ground with their sizes along x, y (the thickness) and z. The numbers are
// smlibpy's documented ones.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, Edge, Line, ModelingError, Part, Sketch } from '../src/index.ts'
import { Bend, bendAllowance, bendDeduction, bends, developedLength, FlatPattern, flange, flatPattern, fold, unfold } from '../src/sheetmetal.ts'
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
const X = v(1, 0, 0)
const Z = v(0, 0, 1)

/** smlibpy's blank: a 2 mm sheet, 100 along x and 40 along z, lying on the ground (y 0 to 2). */
const blank = () => new Box(100, 40, 2, { align: { y: 'min' } })
/** smlibpy's bend line, Axis((20, 0, 2), (0, 1, 0)): on the top face at x = 20, across the sheet. */
const line = () => new THREE.Ray(v(20, 2, 0), Z)

test('bend allowance, deduction and developed length, angles in radians', () => {
  close(bendAllowance(Math.PI / 2, { radius: 2, thickness: 2 }), 4.5239, 1e-4) // pi/2 * (2 + 0.44 * 2)
  close(bendAllowance(Math.PI / 2, { radius: 2, thickness: 2, kFactor: 0.5 }), 4.7124, 1e-4)
  close(bendDeduction(Math.PI / 2, { radius: 2, thickness: 2 }), 2 * 4 - 4.523893421169302, 1e-12)
  close(developedLength(60, 40, { radius: 2, thickness: 2 }), 96.5239, 1e-4)
  // an angle per bend
  const two = developedLength(60, 40, 30, { radius: 2, thickness: 2, angle: [Math.PI / 2, Math.PI / 4] })
  close(two, 130 - bendDeduction(Math.PI / 2, { radius: 2, thickness: 2 }) - bendDeduction(Math.PI / 4, { radius: 2, thickness: 2 }), 1e-12)
  // degrees by mistake: the message speaks of radians
  assert.throws(() => bendAllowance(90, { radius: 2, thickness: 2 }), (e: unknown) => e instanceof RangeError && /2π radians/.test(e.message))
  assert.throws(() => bendDeduction(Math.PI, { radius: 2, thickness: 2 }), RangeError)
})

test('fold a plate about a THREE.Ray on its top: the +x end up', () => {
  const bracket = fold(blank(), line(), Math.PI / 2, { radius: 2 })
  assert.ok(bracket instanceof Part)
  // smlibpy's 71.7381 x 40 x 31.7381, with the height along y
  closeVector(bracket.bbox().getSize(new THREE.Vector3()), { x: 71.7381, y: 31.7381, z: 40 }, 1e-4)
  closeBox(bracket.bbox(), box([-50, 0, -20], [21.7381, 31.7381, 20]), 1e-4)
  // the bend faces are exact cylinders of 2 and 4 about an axis along z
  const radii = [...bracket.faces().cylinders()].map((f) => f.radius).sort()
  assert.deepEqual(radii.map((r) => Math.round(r * 1e9) / 1e9), [2, 4])
  const [b] = bends(bracket)
  assert.ok(b instanceof Bend)
  close(b.angle, Math.PI / 2, 1e-9)
  close(b.radius, 2, 1e-9)
  close(b.thickness, 2, 1e-9)
  close(b.kFactor, 0.44, 0)
  close(b.length, 40, 1e-9)
  close(b.allowance, bendAllowance(Math.PI / 2, { radius: 2, thickness: 2 }), 1e-9)
  assert.ok(b.axis instanceof THREE.Ray)
  closeVector({ x: 0, y: 0, z: Math.abs(b.axis!.direction.z) }, Z, 1e-12)
  closeVector(b.axis!.origin.clone().setZ(0), { x: 20 - 4.5239 / 2, y: 4, z: 0 }, 1e-4) // (2 above the top, at the strip's start)
  assert.equal(b.line, null)
  // downward, and the other side staying
  const down = fold(blank(), line(), -Math.PI / 2, { radius: 2 })
  assert.ok(down.bbox().min.y < -20)
  const other = fold(blank(), line(), Math.PI / 2, { radius: 2, fixed: v(40, 0, 0) })
  close(other.bbox().max.x, 50, 1e-6)
  assert.ok(other.bbox().min.x > -10)
  // a hem: folded flat onto itself
  const hem = fold(blank(), new THREE.Ray(v(40, 2, 0), Z), Math.PI, { radius: 1 })
  close(hem.bbox().max.y, 2 + 2 * 1 + 2, 1e-6)
})

test('a flange on an edge picked by selectors; four make a tray', () => {
  const plate = new Box(100, 60, 2, { align: { y: 'min' } }) // 100 along x, 60 along z
  const right = plate.edges().parallelTo(Z).top().right().one() // the top edge at x = 50
  const flanged = flange(plate, right, 20, { radius: 2 })
  // 20 high (outside length from the virtual sharp, under the sheet), its outside at x = 54
  closeBox(flanged.bbox(), box([-50, 0, -30], [54, 20, 30]), 1e-6)
  const tilted = flange(plate, right, 20, { radius: 2, angle: Math.PI / 4 })
  assert.ok(tilted.bbox().max.y < 20)
  // four flanges: smlibpy's tray, 108 x 68 x 20
  let tray: Part = plate
  for (const [axis, last] of [[Z, true], [Z, false], [X, true], [X, false]] as const) {
    const edges = tray.edges().parallelTo(axis).filter((e) => Math.abs(e.center().y - 2) < 1e-6).sortBy(axis === X ? Z : X)
    tray = flange(tray, last ? edges.last : edges.first, 20, { radius: 2 })
  }
  closeVector(tray.bbox().getSize(new THREE.Vector3()), { x: 108, y: 20, z: 68 }, 1e-6)
  assert.equal(bends(tray).length, 4)
  // and its flat pattern: smlibpy's 141.048 x 101.048 x 2, with the thickness along y
  const pattern = flatPattern(tray)
  closeVector(pattern.size, { x: 141.048, y: 2, z: 101.048 }, 1e-3)
  assert.deepEqual(pattern.bends.map((b) => b.direction), ['up', 'up', 'up', 'up'])
})

test('unfold and the flat pattern, on the ground: sizes along x, y (the thickness) and z', () => {
  const bracket = fold(blank(), line(), Math.PI / 2, { radius: 2 })
  // unfolded in place: the blank again
  const flat = unfold(bracket)
  closeBox(flat.bbox(), blank().bbox(), 1e-6)
  close(flat.volume, 8000, 1e-6)
  assert.equal(bends(flat).length, 0)
  const pattern = flatPattern(bracket)
  assert.ok(pattern instanceof FlatPattern)
  closeVector(pattern.size, { x: 100, y: 2, z: 40 }, 1e-9)
  close(pattern.thickness, 2, 0)
  close(pattern.kFactor!, 0.44, 0)
  // seen from above as a sketch is drawn: x from 0 to 100, z from -40 to 0, the bottom at y = 0
  assert.ok(pattern.part instanceof Part)
  closeBox(pattern.part.bbox(), box([0, 0, -40], [100, 2, 0]), 1e-9)
  assert.ok(pattern.outline instanceof Sketch)
  close(pattern.outline.area, 4000, 1e-6)
  closeVector(pattern.outline.plane.normal.clone().set(0, Math.abs(pattern.outline.plane.normal.y), 0), { x: 0, y: 1, z: 0 }, 1e-12)
  // one bend line across the blank, at y = 0, 20 + 50 along x from its corner, folding up
  assert.equal(pattern.bendLines.length, 1)
  const [bendLine] = pattern.bendLines
  assert.ok(bendLine instanceof Edge)
  assert.equal(bendLine, pattern.bends[0].line)
  assert.equal(pattern.bends[0].direction, 'up')
  close(bendLine.length, 40, 1e-9)
  closeVector(bendLine.center(), { x: 70, y: 0, z: -20 }, 1e-9)
  closeVector({ x: 0, y: 0, z: Math.abs(bendLine.tangentAt().z) }, Z, 1e-12)
  assert.match(String(pattern), /FlatPattern\(100 x 40, thickness=2, 1 bends, kFactor=0.44\)/)
})

test('the K-factor goes with the part; tables, rules and functions (angles in radians) override it', () => {
  // smlibpy's: a tight bend at K 0.33, a large one at K 0.45, unfolded to the blank again
  let part = fold(new Box(200, 40, 2, { align: { y: 'min' } }), new THREE.Ray(v(-60, 2, 0), Z), Math.PI / 2, { radius: 1, kFactor: 0.33 })
  part = fold(part, new THREE.Ray(v(60, 2, 0), Z), Math.PI / 2, { radius: 6, kFactor: 0.45 })
  close(flatPattern(part).size.x, 200, 1e-6)
  assert.deepEqual(bends(part).map((b) => b.kFactor), [0.33, 0.45])
  const table = flatPattern(part, { kFactor: [[0.5, 0.33], [3, 0.45]] }) // (r / t, k) pairs
  close(table.size.x, 200, 1e-6)
  assert.equal(table.kFactor, null)
  const din = flatPattern(part, { kFactor: 'din6935' })
  assert.deepEqual(din.bends.map((b) => Math.round(b.kFactor * 1e4) / 1e4), [0.2497, 0.4443])
  const byRadius = bends(part, { kFactor: new Map([[1, 0.3], [6, 0.5]]) })
  assert.deepEqual(byRadius.map((b) => b.kFactor), [0.3, 0.5])
  const angles: number[] = []
  const ruled = flatPattern(part, { kFactor: (radius, thickness, angle) => (angles.push(angle), 0.4) })
  assert.equal(ruled.kFactor, 0.4)
  assert.equal(angles.length, 2)
  for (const a of angles) close(a, Math.PI / 2, 1e-9)
})

test('results are in the frame of the part, with its transform; lines and edges where they are', () => {
  const moved = blank()
  moved.position.set(5, 50, -7)
  moved.rotation.set(0.2, 0.4, 0)
  moved.name = 'blank'
  const reference = fold(blank(), line(), Math.PI / 2, { radius: 2 })
  // a THREE.Ray in the part's frame
  const byRay = fold(moved, line(), Math.PI / 2, { radius: 2 })
  closeVector(byRay.position, moved.position, 0)
  assert.ok(byRay.quaternion.equals(moved.quaternion))
  assert.equal(byRay.name, 'blank')
  closeBox(byRay.bbox(), reference.bbox(), 1e-9)
  // an edge (a curve of its own) where it is: moved with the blank, the same fold
  const edge = new Line(v(20, 2, -30), v(20, 2, 30))
  edge.position.copy(moved.position)
  edge.rotation.copy(moved.rotation)
  const byEdge = fold(moved, edge, Math.PI / 2, { radius: 2 })
  closeBox(byEdge.bbox(), reference.bbox(), 1e-6)
  // the flat pattern and its bend lines have the part's transform
  const pattern = flatPattern(byRay)
  closeVector(pattern.part.position, moved.position, 0)
  closeVector(pattern.outline.position, moved.position, 0)
  closeVector(pattern.bendLines[0].position, moved.position, 0)
  closeBox(pattern.part.bbox(), box([0, 0, -40], [100, 2, 0]), 1e-9)
  // unfold keeps a chosen face in place
  const base = byRay.faces().bottom().one()
  closeBox(unfold(byRay, { fixed: base }).bbox(), blank().bbox(), 1e-6)
})

test("errors speak radians and three's types; the kernel's are the package's own", () => {
  assert.throws(() => fold(blank(), line(), 4, { radius: 2 }), (e: unknown) => e instanceof RangeError && /-π and π radians/.test(e.message))
  assert.throws(() => fold(blank(), v(20, 2, 0) as never, 1, { radius: 2 }), /THREE\.Ray or a straight Edge/)
  assert.throws(() => fold(new Box(1, 1, 1).faces().first as never, line(), 1, { radius: 2 }), /a Part/)
  assert.throws(() => unfold(blank(), { fixed: blank().edges().first as never }), /planar face/)
  // a line that is not on the sheet
  let error: unknown
  try {
    fold(blank(), new THREE.Ray(v(20, 7, 0), Z), Math.PI / 2, { radius: 2 })
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof ModelingError && !(error instanceof sm.ModelingError), String(error))
  assert.equal((error as Error).cause, undefined)
  noKernel(error, 'error')
})

test('nothing of smlibwasm comes out of sheet metal', () => {
  const bracket = fold(blank(), line(), Math.PI / 2, { radius: 2 })
  const plate = new Box(100, 60, 2, { align: { y: 'min' } })
  const pattern = flatPattern(bracket)
  const results: unknown[] = [
    bracket,
    bends(bracket),
    unfold(bracket),
    pattern,
    pattern.bendLines,
    pattern.size,
    flange(plate, plate.edges().parallelTo(Z).top().right().one(), 20, { radius: 2 }),
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
})
