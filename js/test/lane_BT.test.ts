// Booleans along seams and beside earlier holes (kernel plan B6, B4 and B10); ported from
// tests/test_lane_BT.py. Exact volumes come from integrating the overlaps of the operands (the cross
// sections of two cylinders, a sphere and a cylinder), not from the kernel; OpenCASCADE's volume is
// given where it differs from that by more than 1e-6.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import { Box, Cylinder, Edge, Face, KernelError, Part, Sphere, Vector, X, Y, Z } from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'
import { _parallelRounds } from '../src/shapes.ts'
import { approx } from './_approx.ts'

const PI = Math.PI
const PIN = 24299.258668 // (Box(30, 30, 30) - Cylinder(5, 60)) less a pin of radius 2 tangent to the bore
const CROSS = 6931.747603 // Box(20, 20, 20) less two holes of radius 3 whose axes are 3 apart
const HOLES = 62.720958 // the common volume of those two holes (OpenCASCADE: 62.7209)

const pin = (y = 5, turn = 0): Part => Cylinder(2, 60).rotate(Z, turn).rotate(Y, 90).translate(0, y, 0)
const bored = (): Part => Box(30, 30, 30).cut(Cylinder(5, 60))

// -- B6: seams tangent to the other operand --------------------------------------------------
const seamCases: [string, () => Part, number][] = [
  ['groove pin', () => bored().cut(pin(5)), PIN], // was 24364.1472, valid
  ['groove pin below', () => bored().cut(pin(-5)), PIN],
  ['pin turned by hand', () => bored().cut(pin(5, 45)), PIN], // as it was
  ['cross holes', () => Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 90).translate(0, 3, 0)).cut(Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)), CROSS],
  ['pin and bore', () => pin(5).intersect(Cylinder(5, 60)), 32.444276],
  ['pin less bore', () => pin(5).cut(Cylinder(5, 60)), 721.537961],
  ['bore less pin', () => Cylinder(5, 60).cut(pin(5)), 4679.944704],
  // a sphere whose seam lies in the plane tangent to the cylinder's top line: was 81.7551, more than
  // the sphere (33.51)
  ['sphere seam', () => Cylinder(2.5, 30).rotate(Y, 90).intersect(Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5)), 13.625852],
  // a sphere's seam tangent to a cylinder through its centre (OpenCASCADE: 462.4602)
  ['sphere seam fused', () => Cylinder(2.5, 20).rotate(Y, 90).fuse(Sphere(3).translate(0, 2.5, 0)), 462.398702],
]
for (const [name, make, exact] of seamCases) {
  test(`seams tangent to the other operand: ${name}`, () => {
    const part = make()
    assert.ok(part.isValid())
    approx(part.volume, exact, 1e-6)
  })
}

test('crossing holes compute in both builds', () => {
  // B4: natively the kernel's Boolean of these raises SM_ERR_BAD_INTERSECTIONS where its seams lie
  // tangent to the other hole (here it found the intersection only); with the second hole turned
  // about its axis both builds get all of them.
  const h1 = Cylinder(3, 40).translate(0, 3, 0)
  for (const z of [3, 3.1]) {
    const h2 = Cylinder(3, 40).rotate(Y, 90).translate(0, 0, z)
    approx(h1.intersect(h2).volume, HOLES, 1e-6)
    approx(h1.fuse(h2).volume, 2 * PI * 9 * 40 - HOLES, 1e-7)
    approx(h1.cut(h2).volume, PI * 9 * 40 - HOLES, 1e-7)
    approx(Box(20, 20, 20).cut(h1).cut(h2).volume, CROSS, 1e-8)
    approx(Box(20, 20, 20).cut([h1, h2]).volume, CROSS, 1e-8)
    const cells = h1.merge(h2).cells().map((c) => c.volume).sort((a, b) => a - b)
    approx(cells[0], HOLES, 1e-6)
    approx(cells[1], 1068.252397, 1e-6)
    approx(cells[2], 1068.252397, 1e-6)
    // the kernel's own Boolean, seams as they are
    assert.throws(() => k.boolean(h1._copyBrep(), h2._copyBrep(), { operation: k.BooleanOp.UNION }), /SM_ERR/)
  }
})

test('seam contacts', () => {
  const b = bored()
  const p = pin(5)
  const contacts = ext.seam_contacts(p._brep, b._brep)
  assert.equal(contacts.length, 1)
  const [edge, face, point] = contacts[0]
  assert.ok(Array.from(ext.seam_edges(p._brep) as ArrayLike<number>).includes(edge))
  approx(new Face(b, k.brep_faces(b._brep)[face]).radius, 5, 1e-12) // the bore
  assert.ok(new Vector(point).distanceTo([0, 5, -2]) < 1e-6) // the pin's seam (t, 5, -2) touches the bore
  assert.deepEqual(ext.seam_contacts(pin(5, 45)._brep, b._brep), [])
  assert.deepEqual(ext.seam_contacts(b._brep, p._brep), []) // the bore's seam lies away from the pin
  // Where the faces touch (the seam is the line along which they touch) it is no contact: a cylinder
  // tangent to a flat face along its seam, a cylinder touching a hole at a point of its seam.
  assert.deepEqual(ext.seam_contacts(Cylinder(3, 40).translate(7, 0, 0)._brep, Box(20, 20, 20)._brep), [])
  const holed = Box(20, 20, 20).cut(Cylinder(3, 40))
  const inside = Cylinder(2, 40).rotate(X, 90).translate(1, 0, 0) // its seam (3, t, 0) touches the hole at (3, 0, 0)
  assert.deepEqual(ext.seam_contacts(inside._brep, holed._brep), [])
})

test('seams are turned only where they touch', () => {
  // A tool whose seam touches nothing keeps it where it is: (r, 0, z) before it is placed.
  const plain = Box(30, 30, 30).cut(pin(5))
  const edges: number[] = k.brep_edges(plain._brep)
  const seams = Array.from(ext.seam_edges(plain._brep) as ArrayLike<number>).map((i) => Edge._of(plain, edges[i], true))
  assert.ok(seams.some((e) => Math.abs(e.center().y - 5) < 1e-9 && Math.abs(e.center().z + 2) < 1e-9))
  // Beside the bore, where that seam would touch it, the pin went in turned about its axis: its seam
  // lies off the plane y = 5 that touches the bore.
  const grooved = bored().cut(pin(5))
  const gedges: number[] = k.brep_edges(grooved._brep)
  const pinSeams = Array.from(ext.seam_edges(grooved._brep) as ArrayLike<number>).filter(
    (i) => Math.abs(new Face(grooved, k.edge_faces(gedges[i])[0]).radius - 2) < 1e-9,
  )
  assert.ok(pinSeams.length > 0)
  for (const i of pinSeams) assert.ok(Math.abs(Edge._of(grooved, gedges[i], true).center().y - 5) > 0.1)
})

test('a turn whose result cannot be right is passed over', () => {
  // A cylinder whose axis touches another one's surface: turned by 45 degrees the kernel's union is
  // the first cylinder alone (113.0973, valid), less than the second; the volume check passes it
  // over, and the next angle that clears the seam gives the union. Before, the union was invalid.
  const a = Cylinder(1.5, 16)
  const b = Cylinder(3, 6).rotate(Y, 90).translate(0, -1.5, 1.1887)
  const union = a.fuse(b)
  assert.ok(union.isValid())
  approx(union.volume, 248.435398, 1e-6)
  approx(a.cut(b).volume, 78.789394, 1e-6)
})

// -- B10: a tool beside an earlier parallel hole ---------------------------------------------
/** The area two circles of radii r1 and r2, d apart, have in common. */
function lens(r1: number, r2: number, d: number): number {
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1))
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2))
  return a + b - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))
}
const KEY = PI * 9 - lens(6, 3, 8) // the part of a hole of radius 3 at 8 outside one of radius 6

const besideCases: [string, () => Part, number][] = [
  ['box', () => Box(40, 40, 10).cut(Cylinder(6, 30)).cut(Cylinder(3, 30).translate(8, 0, 0)), 16000 - 360 * PI - 10 * KEY],
  ['cylinder', () => Cylinder(20, 40).cut(Cylinder(6, 60)).cut(Cylinder(3, 60).translate(8, 0, 0)), 40 * (400 * PI - 36 * PI - KEY)],
  ['large box', () => Box(60, 60, 20).cut(Cylinder(10, 40)).cut(Cylinder(4, 40).translate(12, 0, 0)), 72000 - 2000 * PI - 20 * (16 * PI - lens(10, 4, 12))],
  ['boss', () => Box(40, 40, 10).fuse(Cylinder(6, 20).translate(0, 0, 10)).fuse(Cylinder(3, 20).translate(8, 0, 10)), 16000 + 36 * PI * 15 + 15 * KEY],
  ['intersection', () => Box(40, 40, 10).cut(Cylinder(6, 30)).intersect(Cylinder(3, 30).translate(8, 0, 0)), 10 * KEY],
  ['sphere', () => Sphere(20).cut(Cylinder(6, 60)).cut(Cylinder(3, 60).translate(8, 0, 0)), 28160.608174],
  ['sphere intersection', () => Sphere(20).cut(Cylinder(6, 60)).intersect(Cylinder(3, 60).translate(8, 0, 0)), 929.188],
]
for (const [name, make, exact] of besideCases) {
  test(`a tool beside an earlier parallel hole: ${name}`, () => {
    // These threw KernelError (the box, the cylinder, the boss, the intersection) or ModelingError (the
    // sphere: the kernel's cut was empty, its intersection the whole part); a NURBS copy of the tool
    // gets them right.
    const part = make()
    assert.ok(part.isValid())
    approx(part.volume, exact, 1e-5)
  })
}

test('the NURBS retry keeps the faces analytic', () => {
  const part = Box(40, 40, 10).cut(Cylinder(6, 30)).cut(Cylinder(3, 30).translate(8, 0, 0))
  const rounds = part.faces().filter((f) => f.geomType !== 'plane').map((f) => `${f.geomType} ${f.radius.toFixed(9)}`).sort()
  assert.deepEqual(rounds, ['cylinder 3.000000000', 'cylinder 3.000000000', 'cylinder 6.000000000'])
  // Several tools at once are combined first, as before (exact: the tools stay analytic).
  const both = Box(40, 40, 10).cut([Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)])
  approx(both.volume, 16000 - 360 * PI - 10 * KEY, 1e-10)
})

test('the NURBS retry only for parallel rounds', () => {
  const holed = Box(40, 40, 10).cut(Cylinder(6, 30))
  assert.ok(_parallelRounds(holed, Cylinder(3, 30).translate(8, 0, 0)))
  assert.ok(!_parallelRounds(holed, Cylinder(3, 30))) // on its axis
  assert.ok(!_parallelRounds(holed, Cylinder(3, 60).rotate(X, 90)))
  assert.ok(!_parallelRounds(holed, Cylinder(3, 30).translate(30, 0, 0)))
  const retry = Part.prototype._nurbsRetry
  let tried = 0
  Part.prototype._nurbsRetry = function (this: Part, ...args: Parameters<Part['_nurbsRetry']>) {
    tried++
    return retry.apply(this, args)
  }
  try {
    // the hint's case for a failure the retry does not address
    assert.throws(() => Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 45)).cut(Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)), KernelError)
  } finally {
    Part.prototype._nurbsRetry = retry
  }
  assert.equal(tried, 1)
})

test('Booleans that turn a seam free their copies', () => {
  // A turned Boolean runs on copies of the operands and deletes the operands it was given; 100 groove
  // pins grow the process by as little as cuts that turn nothing. In a process of its own.
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { Box, Cylinder, Y } from '${src}index.ts'
    const bored = Box(30, 30, 30).cut(Cylinder(5, 60))
    const pin = Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        globalThis.gc()
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    for (let i = 0; i < 10; i++) bored.cut(pin).volume
    await settle()
    const before = process.memoryUsage().rss
    for (let i = 0; i < 100; i++) {
      bored.cut(pin).volume
      if (i % 10 === 9) await settle()
    }
    await settle()
    console.log(Math.round((process.memoryUsage().rss - before) / 1048576))
  `
  const run = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  const grown = Number(run.stdout.trim())
  assert.ok(grown < 10, `100 turned cuts took ${grown} MB`) // 0.4 MB each if the operands stayed
})
