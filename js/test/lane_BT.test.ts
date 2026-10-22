// Booleans along seams and beside earlier holes (kernel plan B6, B4 and B10); empty Boolean results
// checked without the kernel's brep_relationship (B13); parts split along sheets and sheets trimmed
// by parts (B12); imprints (B14); where faces and edges came from (T3); the kernel's validity checks
// (T4); the cells of a merged part named after their parts (B15); solids() separating a body in a
// cavity (B16); the edges where two bodies meet (B17); sections by planes that only touch (B18);
// error hints from what the operands show (B19); colors and names of single faces (T5); analytic
// faces after scales that differ between the axes (T6); shells, cavities and the cells a face bounds
// (T7); named() and colored() sharing the Brep (T8). Ported from tests/test_lane_BT.py. Exact volumes come from integrating the overlaps of the operands (the cross
// sections of two cylinders, a sphere and a cylinder), not from the kernel; OpenCASCADE's volume is
// given where it differs from that by more than 1e-6.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import {
  Box,
  Circle,
  Cylinder,
  Edge,
  Face,
  GridLocations,
  KernelError,
  Line,
  ModelingError,
  Part,
  Plane,
  Problem,
  Rectangle,
  ShapeList,
  Shell,
  Sphere,
  Torus,
  Vector,
  Vertex,
  X,
  Y,
  Z,
  fromStep,
  merge,
  render,
  split,
  stitch,
  surface,
  toGltf,
  toStep,
  toUsd,
} from '../src/index.ts'
import { toRgb } from '../src/colors.ts'
import { ext, k, module } from '../src/kernel.ts'
import { _classifiedEmpty, _crashNote, _parallelRounds } from '../src/shapes.ts'
import { GUARD_SECONDS, setGuardSeconds } from '../src/defeature.ts'

// biome-ignore lint: wrong types on purpose, for the errors
type Any = any
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


// -- B13: empty results are checked without brep_relationship -----------------------------
function withoutRelationship(f: () => void): void {
  const relationship = k.brep_relationship
  k.brep_relationship = () => {
    throw new Error('brep_relationship was asked')
  }
  try {
    f()
  } finally {
    k.brep_relationship = relationship
  }
}

test('an empty intersection of touching boxes is right wherever they are', () => {
  // brep_relationship called these "touching" at the origin and "interpenetrating" moved, so the same
  // right empty intersection raised there
  withoutRelationship(() => {
    const a = Box(10, 12, 12)
    const b = Box(4, 20, 12).rotate(X, 90).translate(7, 0, 4)
    for (const move of [[0, 0, 0], [101.3, -57.9, 33.1]] as const) {
      assert.equal(a.translate(...move).intersect(b.translate(...move)).faces().length, 0)
    }
  })
})

test('empty intersections and cuts that are right', () => {
  withoutRelationship(() => {
    const cases: (() => Part)[] = [
      () => Sphere(5).intersect(Sphere(5).translate(10.5, 0, 0)), // apart
      () => Sphere(5).intersect(Sphere(5).translate(10, 0, 0)), // touching at a point
      () => Box(20, 20, 10).intersect(Cylinder(3, 20).rotate(X, 90).translate(0, 0, 8)), // along a line
      () => Box(30, 30, 30).cut(Sphere(8)).intersect(Sphere(8)), // a ball in its cavity (the mesh Booleans fail)
      () => Box(10, 10, 10).cut(Box(10, 10, 10)),
      () => Box(10, 10, 10).cut(Sphere(9)), // the corners at 8.66 inside the sphere
      () => Cylinder(5, 10).cut(Cylinder(5, 10)),
      () => Box(10, 10, 10).cut([Box(6, 12, 12).translate(-2.5, 0, 0), Box(6, 12, 12).translate(2.5, 0, 0)]),
    ]
    for (const make of cases) assert.equal(make().faces().length, 0)
  })
})

test('an empty intersection of plates apart is quick', () => {
  // brep_relationship took 10 s for these two plates of 168 faces, 3 apart (the Boolean 0.13 s)
  const holes: Part[] = []
  for (let x = -180; x <= 180; x += 20) for (let y = -80; y <= 80; y += 20) holes.push(Cylinder(2, 20).translate(x, y, 0))
  const plate = Box(400, 200, 10).cut(holes)
  const other = plate.translate(0, 0, 13)
  const t = performance.now()
  assert.equal(plate.intersect(other).faces().length, 0)
  assert.ok(performance.now() - t < 3000)
})

test('a wrong empty result is refused', () => {
  // The kernel returning nothing for bodies that overlap: brep_relationship calls the spheres
  // "touching" (18.6 in common), which accepted the empty intersection
  const a = Sphere(7)
  const b = Sphere(2).translate(6, 3, 0)
  assert.equal(k.brep_relationship(a._brep, b._brep).relationship, 'touching')
  approx(a.intersect(b).volume, 18.6016, 1e-4)
  const run = Part.prototype._runBoolean
  Part.prototype._runBoolean = () => ext.combine([])
  try {
    assert.throws(() => a.intersect(b), (e: unknown) => e instanceof ModelingError && /empty/.test(e.message))
    // the tool covers the box's box and volume, not its corners
    assert.throws(() => Box(10, 10, 10).cut(Sphere(8.6)), (e: unknown) => e instanceof ModelingError && /empty/.test(e.message))
  } finally {
    Part.prototype._runBoolean = run
  }
})

test('the empty checks classify points where the mesh Booleans fail', () => {
  const a = Sphere(7)
  assert.ok(!_classifiedEmpty(a, [Sphere(2).translate(6, 3, 0)], k.BooleanOp.INTERSECTION))
  assert.ok(_classifiedEmpty(a, [Sphere(2).translate(9.5, 0, 0)], k.BooleanOp.INTERSECTION))
  assert.ok(!_classifiedEmpty(Box(10, 10, 10), [Sphere(8.6)], k.BooleanOp.DIFFERENCE))
  assert.ok(_classifiedEmpty(Box(10, 10, 10), [Sphere(9)], k.BooleanOp.DIFFERENCE))
})

// -- B12: parts split along sheets, sheets trimmed by parts -------------------------------
const linspace = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
// z = 2 + 3 sin(x / 6), odd about x = 0 apart from its mean: a box of 20 splits 3200 / 4800
const wave = (span = 15, width = 15): Shell =>
  surface(linspace(-span, span, 13).map((x) => linspace(-width, width, 7).map((y) => [x, y, 2 + 3 * Math.sin(x / 6)] as [number, number, number])))

test('split along a sheet', () => {
  const box = Box(20, 20, 20)
  const s = wave()
  assert.ok(s.faces()[0].normalAt().z > 0) // "above" is the side the normals point to
  const [above, below] = box.split(s, 'both')
  approx(above.volume, 3200)
  approx(below.volume, 4800)
  assert.ok(above.isValid() && below.isValid())
  assert.equal(above.faces().length, 6)
  approx(box.split(s).volume, 3200)
  approx(box.split(s, 'below').volume, 4800)
  approx(box.split(s.faces()[0], 'below').volume, 4800) // a face of it
  approx((split(box, s) as Part).volume, 3200)
  assert.throws(() => box.split(s, 'middle' as 'above'), /keep/)
})

test('split extends a free-form sheet that ends inside', () => {
  const [above, below] = Box(20, 20, 20).split(wave(15, 5), 'both') // 10 wide in y, in a box 20 wide
  approx(above.volume, 3200)
  approx(below.volume, 4800)
})

test('split along a curved face of a part', () => {
  const wall = Cylinder(5, 40).faces().filter((f) => f.geomType === 'cylinder').one()
  const [outside, inside] = Box(20, 20, 20).split(wall, 'both') // its normals point out of the cylinder
  approx(inside.volume, 500 * PI)
  approx(outside.volume, 8000 - 500 * PI)
})

test('split by a sheet that does not cut through', () => {
  const box = Box(20, 20, 20)
  assert.throws(() => box.split(wave().translate(0, 0, 50)), /does not cut through/) // misses the part
  const inside = Box(4, 4, 4).faces().top().one().toShell() // a plane sheet within the part: not extended
  assert.throws(() => box.split(inside), /does not cut through/)
})

test('sheets trimmed by parts', () => {
  const s = wave()
  const cyl = Cylinder(5, 30)
  const outside = s.cut(cyl)
  const inside = s.intersect(cyl)
  assert.ok(outside.constructor === Shell && inside.constructor === Shell)
  approx(outside.area + inside.area, s.area)
  approx(inside.area, 86.43, 1e-3)
  approx(cyl.intersect(s).area, inside.area, 1e-9) // also part & sheet
  approx(stitch(cyl.intersect(s)).area, inside.area, 1e-9) // the old workaround still works
  assert.equal(s.intersect(cyl.translate(100, 0, 0)).faces().length, 0)
  approx(s.cut(cyl.translate(100, 0, 0)).area, s.area, 1e-9)
  assert.equal(s.cut(Box(100, 100, 100)).faces().length, 0)
  assert.throws(() => s.cut(Rectangle(4, 4)), /trimmed by parts/)
})

test('a part and a sheet do not fuse or cut', () => {
  // they returned invalid "Parts" (the sheet imprinted, 11 faces, volume 8000)
  const box = Box(20, 20, 20)
  const s = wave()
  for (const op of [() => box.fuse(s as Any), () => box.cut(s as Any), () => box.fuse(s.faces()[0] as Any), () => box.cut([Box(1, 1, 1), s as Any])]) {
    assert.throws(op, (e: unknown) => e instanceof TypeError && /split/.test(e.message))
  }
})

// -- B14: imprints ----------------------------------------------------------------------
test('imprint a sketch on a face', () => {
  const box = Box(20, 20, 10)
  for (const [sketch, patch] of [[Rectangle(8, 6), 48], [Circle(4), 16 * PI]] as const) {
    const sk = sketch.on(Plane.XY.offset(5))
    const r = box.imprint(sk)
    assert.ok(r.isValid())
    approx(r.volume, 4000, 1e-9)
    assert.equal(r.faces().length, 7)
    const areas = r.faces().top().map((f) => f.area).sort((a, b) => a - b)
    const want = [patch, 400 - patch].sort((a, b) => a - b)
    areas.forEach((a, i) => approx(a, want[i]))
    const patches = r.faces().derivedFrom(sk)
    assert.equal(patches.length, 1)
    approx(patches[0].area, patch)
  }
  const square = box.faces().top().one().toSketch().scale(0.5, [0, 0, 5]) // a sketch from a face, 10 x 10
  const areas = box.imprint(square).faces().top().map((f) => f.area).sort((a, b) => a - b)
  approx(areas[0], 100)
  approx(areas[1], 300)
})

test('imprint a part and a sheet', () => {
  const box = Box(20, 20, 10)
  const pin = Cylinder(3, 30).rotate(Y, 90)
  const r = box.imprint(pin)
  approx(r.volume, 4000, 1e-9)
  assert.equal(r.faces().length, 8)
  const patches = r.faces().derivedFrom(pin)
  assert.equal(patches.length, 2)
  for (const f of patches) approx(f.area, 9 * PI)
  const sheet = surface(linspace(-15, 15, 7).map((x) => linspace(-15, 15, 5).map((y) => [x, y, 1 + 0.02 * x * x] as [number, number, number])))
  const s = box.imprint(sheet)
  approx(s.volume, 4000, 1e-9)
  assert.ok(s.faces().length > 6 && s.isValid())
  const later = box.imprint(Rectangle(8, 6).on(Plane.XY.offset(5))).cut(Cylinder(2, 30).translate(7, 7, 0))
  assert.equal(later.faces().length, 8) // the split line stays through a later cut
})

test('imprint refuses a tool that crosses nothing', () => {
  const box = Box(20, 20, 10)
  for (const tool of [Cylinder(3, 30).translate(100, 0, 0), Box(2, 2, 2)]) {
    assert.throws(() => box.imprint(tool), (e: unknown) => e instanceof ModelingError && /crosses no face/.test(e.message))
  }
  assert.throws(() => box.imprint(new Vector(1, 2, 3) as Any), TypeError)
})

// -- T3: where faces and edges came from --------------------------------------------------
test('new edges and faces of a Boolean', () => {
  const plate = Box(30, 20, 5)
  const boss = Cylinder(4, 10).translate(0, 0, 5)
  const r = plate.fuse(boss)
  const added = r.edges().newSince([plate, boss])
  assert.equal(added.length, 1)
  assert.equal(added[0].geomType, 'circle')
  approx(added[0].radius, 4)
  approx(added[0].center().z, 2.5)
  assert.equal(r.faces().newSince([plate, boss]).length, 0)
  assert.equal(r.edges().newSince(plate).length, 2) // and the boss's top circle (its seam is no edge here)
})

test('faces derived from tools and split faces', () => {
  const plate = Box(30, 20, 5)
  const holes = [-10, 10].map((x) => Cylinder(2, 10).translate(x, 0, 0))
  const r = plate.cut(holes)
  const walls = r.faces().derivedFrom(holes)
  assert.equal(walls.length, 2)
  assert.ok(walls.every((f) => f.geomType === 'cylinder'))
  const first = r.faces().derivedFrom(holes[0])
  assert.equal(first.length, 1)
  approx(first[0].center().x, -10)
  const pattern = GridLocations(10, 10, 2, 1).mul(Cylinder(2, 10)) // moved copies have marks of their own
  const cut = Box(30, 30, 5).cut(pattern)
  assert.deepEqual([...pattern].map((c) => cut.faces().derivedFrom(c).length), [1, 1])
  const box = Box(40, 30, 10)
  const slotted = box.cut(Box(5, 40, 4).translate(0, 0, 4))
  const top = slotted.edges().derivedFrom(box.edges().top())
  assert.equal(top.length, 6)
  approx(top.reduce((sum, e) => sum + e.length, 0), 2 * 30 + 4 * 17.5)
  const left = Box(30, 20, 5)
  const right = Box(30, 20, 5).translate(30, 0, 0)
  const merged = left.fuse(right)
  for (const half of [left, right]) assert.equal(merged.faces().derivedFrom(half).length, 5) // top, bottom, front and back merged, and an end
})

test('a selection from before an edit', () => {
  // "Edge(line, (-20, 15, 10) -> (20, 15, 10)) is not an edge of this part" before
  const box = Box(40, 30, 10)
  const top = box.edges().top()
  const cut = box.cut(Box(5, 40, 4).translate(0, 0, 4))
  const rounded = cut.fillet(top, 1)
  assert.ok(rounded.isValid() && rounded.volume < cut.volume)
  const rounds = rounded.faces().newSince(cut)
  assert.equal(rounds.length, 6)
  for (const f of rounds) {
    assert.equal(f.geomType, 'cylinder')
    approx(f.radius, 1)
  }
  const shelled = cut.shell(-2, box.faces().top()) // both halves of the top face open
  assert.ok(shelled.isValid())
  approx(shelled.volume, cut.shell(-2, cut.faces().top()).volume, 1e-9)
})

test('old selections are measured as the edges they stand for', () => {
  // the fillet's checks measure the pieces and merged edges, not the edges as selected (a merged
  // edge of 80 checked as the 40 selected was "a wrong body", at most 18.885 for 34.336)
  const box = Box(40, 30, 10)
  const joined = box.fuse(Box(40, 30, 10).translate(40, 0, 0))
  const long = joined.fillet(box.edges().top().parallelTo(X), 1)
  assert.ok(long.isValid())
  approx(long.volume, 24000 - 160 * (1 - PI / 4))
  const top = box.edges().top()
  const cut = box.cut(Box(5, 40, 4).translate(0, 0, 4))
  const perEdge = cut.fillet(top, [1, 1.5, 1, 1.5]) // each piece takes its edge's radius
  assert.ok(perEdge.isValid())
  assert.equal(perEdge.faces().newSince(cut).length, 6)
  assert.ok(cut.chamfer(top, 1).isValid())
  const sheet = Box(40, 30, 2)
  const edge = sheet.edges().top().maxBy(Y)
  assert.throws(() => sheet.cut(Box(4, 4, 4).translate(5, 15, 0)).flange(edge, 10, { radius: 2 }), /got 2/)
})

test('history comes back from the kernel steps in the probe worker', () => {
  const box = Box(40, 30, 10)
  const cut = box.cut(Box(5, 40, 4).translate(0, 0, 4))
  const probed = cut.shell(-2, cut.faces().top())
  const guard = GUARD_SECONDS
  setGuardSeconds(0)
  let here: Part
  try {
    here = cut.shell(-2, cut.faces().top())
  } finally {
    setGuardSeconds(guard)
  }
  const n = probed.faces().newSince(cut).length
  assert.equal(n, here.faces().newSince(cut).length)
  assert.ok(n < here.faces().length)
  const floors = probed.faces().derivedFrom(cut.faces().bottom()) // the bottom, and the floor inside offset from it
  assert.deepEqual(floors.map((f) => Math.round(f.center().z * 1e9) / 1e9).sort((a, b) => a - b), [-5, -3])
})

test('history takes faces and edges', () => {
  const box = Box(10, 10, 10)
  assert.throws(() => box.vertices().newSince(box), (e: unknown) => e instanceof TypeError && /faces and edges/.test(e.message))
  assert.throws(() => box.faces().derivedFrom(new Vector(1, 2, 3)), (e: unknown) => e instanceof TypeError && /bodies, faces and edges/.test(e.message))
  const top = box.faces().derivedFrom(box.faces().top())
  assert.equal(top.length, 1)
  assert.ok(top[0].equals(box.faces().top()[0]))
  assert.equal(box.edges().newSince(box).length, 0)
  assert.equal(Line([0, 0, 0], [1, 0, 0]).edges().newSince(box).length, 1)
})

test('tags reach no file', () => {
  const part = Box(10, 10, 10).cut(Cylinder(2, 20))
  const copy = k.brep_copy(part._brep)
  ext.untag_topology(copy)
  const read = (b: number, name: string): Uint8Array => {
    k.brep_write_to_file(b, name, true)
    try {
      return module.FS.readFile(name)
    } finally {
      module.FS.unlink(name)
    }
  }
  const a = read(part._brep, '/tmp/lane-bt-a.smb')
  const b = read(copy, '/tmp/lane-bt-b.smb')
  ext.delete_brep(copy)
  assert.deepEqual(a, b)
  assert.deepEqual(part.check(), []) // (the tags' attributes in the kernel's own context)
})

// -- T4: the kernel's validity checks -----------------------------------------------------
// a box whose top face lies 0.002 above its walls, stitched within 0.01: valid for isValid()
const lifted = (): Part =>
  stitch(
    Box(20, 20, 20)
      .faces()
      .map((f) => f.toShell().translate(0, 0, f.normalAt().z > 0.5 ? 0.002 : 0)),
    { tolerance: 0.01 },
  ) as Part

test('check names the problem', () => {
  const part = lifted()
  assert.ok(part instanceof Part && part.isValid())
  const problems = part.check()
  assert.equal(problems.length, 4)
  assert.ok(problems.every((p) => p instanceof Problem))
  const p = problems[0]
  assert.equal(p.test, 'Bad Vertex Gap')
  assert.equal(p.category, 'geometric')
  assert.ok(p.shape instanceof Vertex)
  approx(p.shape.z, 10, 1e-9, 1e-9)
  approx(p.value!, 0.002)
  approx(p.tolerance!, 2e-5)
  assert.match(p.message, /0\.002/)
  assert.ok(!part.isValid({ strict: true }))
  approx(Math.max(...part.edges().map((e) => e.tolerance)), 0.004)
  assert.throws(() => part.check(3), /level/)
  assert.throws(() => part.isValid({ strictly: true } as Any), TypeError)
})

test('check finds nothing on generated parts', () => {
  const base = Box(30, 20, 10).cut(Cylinder(4, 20))
  const part = base.fillet(base.edges().top(), 1)
  for (const x of [part, part.shell(-1, part.faces().bottom()), Box(10, 10, 10).scale([1, 2, 3]), Torus(10, 3)]) {
    assert.deepEqual(x.check(), [])
    assert.deepEqual(x.check(0), [])
    assert.ok(x.isValid({ strict: true }))
  }
  approx(Box(10, 10, 10).edges()[0].tolerance, 1e-5)
  approx(Box(10, 10, 10).vertices()[0].tolerance, 1e-5)
  assert.throws(() => Line([0, 0, 0], [1, 0, 0]).tolerance, /no body/)
  assert.throws(() => new Vertex(1, 2, 3).tolerance, /no body/)
})

// the faces of a box moved apart by up to 0.1
const SHIFTS: [number, number, number][] = [
  [-0.0524, 0.0088, -0.026], [0.0208, 0.0251, -0.0869], [-0.0974, 0.0675, -0.0481],
  [-0.0531, 0.0991, -0.0059], [0.0673, -0.0047, 0.0278], [-0.0699, 0.027, 0.0736],
]

test('a healed closed sheet is a part', () => {
  const faces = Box(20, 20, 20).faces()
  const sheet = stitch(faces.map((f, i) => f.toShell().translate(...SHIFTS[i])), { tolerance: 0.5 })
  assert.equal(sheet.constructor, Shell)
  const healed = sheet.heal()
  assert.ok(healed instanceof Part && healed.isValid())
  approx((healed as Part).volume, 8000, 2e-2)
  assert.ok(healed.check().length > 0) // its edges are far from tight
  assert.equal(wave().heal().constructor, Shell)
})


// -- B15: the cells of a merged part know the parts they lie in ---------------------------------
const steelAndBrass = (): [Part, Part] => [Box(40, 40, 20).named('steel').colored('gray'), Cylinder(6, 30).named('brass').colored('gold')]

test('cells are named after the parts they lie in', () => {
  // Every cell was named and colored as the first part: 4 cells, all "steel", "gray".
  const [steel, brass] = steelAndBrass()
  const m = merge(steel, brass)
  const cells = [...m.cells()].sort((a, b) => b.volume - a.volume || a.center().z - b.center().z)
  const insert = PI * 36 * 20
  ;[32000 - insert, insert, insert / 4, insert / 4].forEach((v, i) => approx(cells[i].volume, v))
  assert.deepEqual(
    cells.map((c) => [c.name, c.color]),
    [['steel', 'gray'], ['steel&brass', 'gold'], ['brass', 'gold'], ['brass', 'gold']],
  )
  assert.deepEqual(
    cells.map((c) => c.sources.map((s) => s.name)),
    [['steel'], ['steel', 'brass'], ['brass'], ['brass']],
  )
  assert.ok(cells[1].sources[0] === steel && cells[1].sources[1] === brass)
  assert.equal(m.cellAt([0, 0, 12])!.name, 'brass')
  assert.equal(m.cellAt([10, 10, 0])!.name, 'steel')
  assert.deepEqual(Box(1, 1, 1).sources, [])
})

test('cells of moved, renamed and chained merges', () => {
  const [steel, brass] = steelAndBrass()
  const m = merge(steel, brass)
  const key = (c: Part, f = 1) => `${c.name} ${(c.volume * f).toFixed(1)}`
  const moved = m.translate(100, 0, 0).rotate(Z, 30).scale(2).named('assembly')
  assert.deepEqual(moved.cells().map((c) => key(c)).sort(), m.cells().map((c) => key(c, 8)).sort())
  const pinPart = Cylinder(2, 50).rotate(X, 90).named('pin').colored('red')
  const chained = m.merge(pinPart)
  assert.deepEqual(new Set(chained.cells().map((c) => c.name)), new Set(['steel', 'brass', 'pin', 'steel&brass', 'steel&pin', 'steel&brass&pin']))
  assert.ok(chained.cells().filter((c) => c.name!.includes('pin')).every((c) => c.color === 'red'))
  // parts without names: the merged part's name and color, as before
  const plain = Box(10, 10, 10).merge(Box(10, 10, 10).translate(5, 0, 0)).named('x').colored('blue')
  assert.ok(plain.cells().every((c) => c.name === 'x' && c.color === 'blue'))
  assert.deepEqual(plain.cells().map((c) => c.sources.length).sort(), [1, 1, 2])
})

test('STEP writes the cells with their names and colors', () => {
  const [steel, brass] = steelAndBrass()
  const text = toStep(merge(steel, brass))
  assert.deepEqual([...text.matchAll(/MANIFOLD_SOLID_BREP\('([^']*)'/g)].map((x) => x[1]).sort(), ['brass', 'brass', 'steel', 'steel&brass'])
  const back = fromStep(text) as Any
  const got = [...back].map((b: Part) => `${b.name} ${(b.color as number[]).map((x) => x.toFixed(4))} ${b.volume.toFixed(1)}`).sort()
  const want = merge(steel, brass).cells().map((c) => `${c.name} ${toRgb(c.color as string).map((x) => x.toFixed(4))} ${c.volume.toFixed(1)}`).sort()
  assert.deepEqual(got, want)
  assert.ok(toStep(merge(steel, brass), { unit: 'cm' }).includes('steel&brass'))
})

// -- B16: solids() separates a body inside a cavity ---------------------------------------------
test('solids separates a body in a cavity', () => {
  const caged = Box(20, 20, 20).cut(Box(10, 10, 10)).fuse(Box(4, 4, 4)) // was one solid of 7064
  const solids = caged.solids()
  assert.equal(solids.length, 2)
  approx(solids[0].volume, 7000)
  approx(solids[1].volume, 64)
  assert.ok(solids.every((s) => s.isValid()))
  const nested = Sphere(20).cut(Sphere(15)).fuse(Sphere(10).cut(Sphere(6))).fuse(Sphere(3))
  const a = nested.solids().map((s) => s.volume).sort((x, y) => x - y)
  const b = nested.cells().map((s) => s.volume).sort((x, y) => x - y)
  assert.equal(a.length, 3)
  a.forEach((v, i) => approx(v, b[i]))
  const touching = Box(10, 10, 10).merge(Box(10, 10, 10).translate(10, 0, 0)).solids()
  assert.equal(touching.length, 1)
  approx(touching[0].volume, 2000)
  const cage = Box(30, 30, 30).cut(Box(20, 20, 20))
  const inside = merge(cage, Box(6, 6, 6), Box(6, 6, 6).translate(6, 0, 0)).solids().map((s) => s.volume).sort((x, y) => x - y)
  assert.equal(inside.length, 2)
  approx(inside[0], 432)
  approx(inside[1], 19000)
})

// -- B17: the edges where two bodies meet --------------------------------------------------------
test('edges joining two bodies', () => {
  const plate = Box(40, 40, 10)
  const standing = Cylinder(5, 10).translate(0, 0, 10) // its bottom face on the plate's top
  const joined = plate.fuse(standing)
  assert.equal(joined.edges().newSince([plate, standing]).length, 0) // the circle is the boss's own edge
  const rim = joined.edges().joining(plate, standing)
  assert.equal(rim.length, 1)
  assert.equal(rim[0].geomType, 'circle')
  approx(rim[0].length, 10 * PI)
  const rounded = joined.fillet(rim, 2)
  assert.ok(rounded.isValid() && rounded.volume > joined.volume)
  const through = Cylinder(5, 20).translate(0, 0, 10)
  assert.equal(plate.fuse(through).edges().joining(plate, through).length, 1)
  const hole = Cylinder(5, 40).rotate(X, 30)
  const rims = plate.cut(hole).edges().joining(plate, hole)
  assert.deepEqual(rims.map((e) => e.length.toFixed(4)).sort(), ['25.4172', '25.4172', '8.4724', '8.4724'])
  assert.ok(rims.every((e) => e.geomType === 'ellipse'))
  const [a, b] = [Box(10, 10, 10), Box(10, 10, 10).translate(10, 0, 0)]
  assert.equal(a.fuse(b).edges().joining(a, b).length, 0)
  const step = Box(10, 10, 5).translate(5, 0, -2.5)
  const corner = a.fuse(step).edges().joining(a, step)
  assert.equal(corner.length, 1)
  approx(corner[0].length, 10)
  const holes = [-10, 0, 10].map((x) => Cylinder(2, 20).translate(x, 0, 0))
  assert.equal(plate.cut(holes).edges().joining(plate, holes).length, 6)
  assert.throws(() => (joined.faces() as Any).joining(plate, standing), /selects edges/)
  assert.throws(() => joined.edges().joining(plate, [1, 2, 3]), /takes bodies/)
})

// -- B18: sections by planes that only touch -----------------------------------------------------
const touchingPlanes: [string, () => Part, Plane][] = [
  ['cylinder', () => Cylinder(5, 20), Plane.XZ.offset(5)], // was KernelError: section failed (SM_ERR)
  ['cylinder below', () => Cylinder(5, 20), Plane.XZ.offset(-5)],
  ['box edge', () => Box(10, 10, 10).rotate(Z, 45), Plane.YZ.offset(50 ** 0.5)], // through an edge
  ['torus top', () => Torus(10, 2), Plane.XY.offset(2)], // was a disc of 314.159 that is not in the torus
  ['two cylinders', () => Cylinder(5, 20).merge(Cylinder(5, 20).translate(20, 0, 0)), Plane.XZ.offset(5)],
]
for (const [name, make, plane] of touchingPlanes) {
  test(`a plane that only touches has no section: ${name}`, () => {
    assert.throws(() => make().section(plane), (e: Error) => e instanceof RangeError && /only touches the part/.test(e.message))
  })
}

test('sections by planes on faces and inside', () => {
  approx(Box(10, 10, 10).section(Plane.XY.offset(5)).area, 100) // a plane on a face: that face
  approx(Cylinder(5, 20).section(Plane.XZ).area, 200)
  assert.throws(() => Cylinder(5, 20).section(Plane.XZ.offset(6)), /does not cut/)
  // tangent to the wall of a hole inside the part: the kernel fails; the hint says to move the plane
  assert.throws(() => Box(20, 20, 10).cut(Cylinder(3, 20)).section(Plane.XZ.offset(3)), (e: Error) => e instanceof KernelError && /move the plane a little/.test(e.message))
})

// -- B19: error hints from what the operands show ------------------------------------------------
test('Boolean hints say what the operands show', () => {
  // In 830 fuzz cases every Boolean error advised combining tools, though each had one tool.
  assert.throws(
    () => Cylinder(5, 20).fuse(Cylinder(5, 20).translate(10, 0, 0)),
    (e: Error) => e instanceof ModelingError && /touch only along an edge/.test(e.message) && !/combine/.test(e.message),
  )
  // a cylinder flush with a side face and with the top: both found, nothing about combining
  assert.throws(
    () => Box(6, 16, 4).cut(Cylinder(1.5, 30).translate(-1.5, 0, -13)),
    (e: Error) =>
      /touches a face of the part tangentially \(near \(-3,/.test(e.message) && /\(at z = 2\)/.test(e.message) && !/combine/.test(e.message) && !/touch only/.test(e.message),
  )
  // beside an earlier parallel hole, where the NURBS retry does not help either
  const proto = Part.prototype as Any
  const retry = proto._nurbsRetry
  proto._nurbsRetry = () => null
  try {
    assert.throws(
      () => Box(40, 40, 10).cut(Cylinder(6, 30)).cut(Cylinder(3, 30).translate(8, 0, 0)),
      (e: Error) => e instanceof KernelError && /combine the tools first/.test(e.message) && !/tangentially/.test(e.message),
    )
  } finally {
    proto._nurbsRetry = retry
  }
  // a flat end cap tangent to a sphere: a trap in the wasm before the kernel patch, now an error that says so
  assert.throws(
    () => Sphere(1.5).rotate(Y, 90).cut(Cylinder(4, 10).rotate(X, 90).translate(0, -3.5, -2.504)),
    (e: Error) => e instanceof ModelingError && /touches a face of the part tangentially/.test(e.message),
  )
})

test('crashes and null pointers are not blamed on sizes', () => {
  assert.equal(_crashNote(new KernelError('cut', 'SM_ERR_NULL_POINTER', 'SM_ERR_NULL_POINTER', 'x'), 'cut'), 'the kernel failed inside the cut (it met a null pointer of its own)')
  assert.equal(_crashNote(new KernelError('fillet', 'the kernel crashed (table index is out of bounds)', null, 'x'), 'fillet'), 'the kernel crashed in the fillet (table index is out of bounds)')
  assert.equal(_crashNote(new KernelError('cut', 'SM_ERR', 'SM_ERR'), 'cut'), null)
  // fuzz case fillet-7-161: a radius of 0.4956 that fits, and "the radius may be too large"
  const part = Torus(8, 1.5).cut(Sphere(2.5).translate(7, 7, -2.8573))
  try {
    part.fillet(part.edges(), 0.495553)
  } catch (e) {
    assert.ok(e instanceof KernelError)
    if (e.status === 'SM_ERR_NULL_POINTER') assert.ok(/says nothing about the radius/.test(e.message) && !/too large/.test(e.message))
  }
})

test('shell and cells hints name the place', () => {
  const holed = Box(30, 30, 10).cut(Cylinder(1, 20))
  assert.throws(() => holed.shell(2, null, { outward: true }), /the hole or inside round at \(.*\) has a radius of 1, less than the wall of 2/)
  const slab = Box(40, 40, 5)
  const hint = slab._shellHint([], 2, slab._inwardRays([]), false)
  assert.ok(hint.startsWith('the part is 5 thick across the face at (') && hint.includes('two walls of 2'), hint)
  const cube = Box(40, 40, 40)
  assert.equal(cube._shellHint([], 2, cube._inwardRays([]), false), 'the wall may be thicker than the part allows')
  assert.throws(
    () => Box(20, 20, 20).merge(Cylinder(4, 10).translate(6, 0, 0)).cells(),
    (e: Error) => /the insert at \(6, .*\) touches the part around it/.test(e.message) && !/combine|tool/.test(e.message),
  )
})

test('hints and empty checks avoid the crashing mesh Boolean', () => {
  // The kernel's Boolean of the meshes of these cylinders, tangent inside each other, kills the
  // Python process at a tenth of tessellate's tolerance (also on origin/next).
  const a = Cylinder(4, 8).rotate(X, 90)
  const b = Cylinder(1.5, 4).rotate(X, 90).translate(-2.5, 2, 0)
  assert.throws(() => a.cut(b), (e: Error) => e instanceof ModelingError && /tangentially/.test(e.message))
})

test('classified empty sees long triangles', () => {
  // The side of the cylinder is a few triangles from end to end, whose corners and middles all lie
  // outside the box: the overlap was missed, and the cut above was said to only touch.
  assert.equal(_classifiedEmpty(Box(6, 16, 4), [Cylinder(1.5, 30).translate(-1.5, 0, -13)], k.BooleanOp.INTERSECTION), false)
})

// -- T5: colors and names of single faces ------------------------------------------------------
const RED = toRgb('red')
const GOLD = toRgb('gold')

function painted(): Part {
  let tool = Cylinder(5, 20)
  tool = tool.colored('red', { faces: tool.faces().cylinders() }) // the hole walls it will cut
  let plate = Box(60, 40, 8).cut(tool).colored('steelblue')
  plate = plate.colored('gold', { faces: plate.faces().top() }).named('seal', { faces: plate.faces().bottom() })
  return plate
}

/** [color, name] of the faces that have either, sorted. */
const own = (part: Part): string[] =>
  part
    .faces()
    .filter((f) => f.color !== null || f.name !== null)
    .map((f) => JSON.stringify([f.color, f.name]))
    .sort()

test('T5: faces keep their colors and names through operations', () => {
  const plate = painted()
  assert.equal(plate.color, 'steelblue') // the body's own stay
  assert.equal(plate.name, null)
  assert.deepEqual(own(plate), [JSON.stringify([RED, null]), JSON.stringify([GOLD, null]), JSON.stringify([null, 'seal'])].sort())
  assert.deepEqual(plate.faces().cylinders()[0].color, RED)
  assert.equal(plate.faces().bottom()[0].name, 'seal')
  assert.deepEqual(plate.check(), [])
  approx(plate.volume, 60 * 40 * 8 - PI * 25 * 8, 1e-12)
  // a fillet keeps the faces' (its rounds have none), so do moves, mirrors and other scales
  assert.deepEqual(own(plate.fillet(plate.edges().top(), 1)), own(plate))
  for (const moved of [plate.translate(10, 0, 0).rotate(Z, 30), plate.mirror(Plane.YZ), plate.scale(2), plate.scale([1, 2, 1])]) {
    assert.deepEqual(own(moved as Part), own(plate))
  }
  // a Boolean splits the top: both pieces keep the color
  const split = plate.cut(Box(10, 50, 20))
  assert.deepEqual(split.faces().top().map((f) => f.color), [GOLD, GOLD])
  // a shell (in a probe worker) carries them back; the offsets of colored faces keep theirs
  const shelled = plate.shell(-1, plate.faces().bottom())
  assert.equal(shelled.faces().filter((f) => JSON.stringify(f.color) === JSON.stringify(GOLD)).length, 2)
  assert.equal(shelled.faces().filter((f) => JSON.stringify(f.color) === JSON.stringify(RED)).length, 2)
  approx(shelled.volume, plate.volume - (58 * 38 * 7 - PI * 36 * 7), 1e-6)
  // null takes them off; faces of an earlier version stand for their pieces (T3)
  const plain = split.colored(null, { faces: plate.faces().top() })
  assert.deepEqual(plain.faces().top().map((f) => f.color), [null, null])
  assert.equal(plain.named(null, { faces: plain.faces().bottom() }).faces().bottom()[0].name, null)
  assert.throws(() => plate.colored('red', { faces: [] }), /no faces selected/)
  assert.throws(() => plate.colored('red', { faces: Box(5, 5, 5).translate(100, 0, 0).faces() }), /is not a face of this part/)
  assert.throws(() => plate.named(3 as Any, { faces: plate.faces().top() }), /a name is a string/)
  assert.throws(() => plate.colored('red', { face: plate.faces() } as Any), /_Body\.colored\(\) got an unexpected option 'face'; did you mean 'faces'\?/)
})

test('T5: face colors and names in files', () => {
  const part = painted()
  const text = toStep(part)
  assert.equal(text.split('STYLED_ITEM(').length - 1, 3) // the body, the top, the hole
  assert.ok(text.includes("ADVANCED_FACE('seal',"))
  const back = fromStep(text) as Part
  assert.deepEqual(own(back), own(part))
  // the faces of a cavity (a BREP_WITH_VOIDS) too
  let hollow = Box(40, 30, 10).cut(Box(10, 10, 4))
  hollow = hollow.colored('lime', { faces: hollow.faces().derivedFrom(hollow.shells()[1]) })
  const lime = JSON.stringify(toRgb('lime'))
  const walls = (fromStep(toStep(hollow)) as Part).faces().filter((f) => JSON.stringify(f.color) === lime)
  assert.deepEqual(walls.map((f) => Math.round(f.area * 1e6) / 1e6).sort((a, b) => a - b), [40, 40, 40, 40, 100, 100])
  // glTF: a primitive per color (the body's, red, gold) and the edges
  const doc = JSON.parse(toGltf(part))
  const colors = doc.materials.map((m: Any) => m.pbrMetallicRoughness.baseColorFactor.slice(0, 3))
  assert.deepEqual(colors.slice(0, 3), [toRgb('steelblue'), RED, GOLD])
  assert.deepEqual(doc.meshes[0].primitives.map((p: Any) => p.mode), [4, 4, 4, 1])
  // USD: a color per triangle of the mesh
  const usd = toUsd(part)
  const mesh = usd.slice(usd.indexOf('def Mesh "body_mesh"'))
  assert.ok(mesh.includes('interpolation = "uniform"') && mesh.includes('(1, 0, 0)'))
  const triangles = mesh.slice(mesh.indexOf('faceVertexCounts = [')).split(']')[0].split('3').length - 1
  const perFace = mesh.slice(mesh.indexOf('displayColor = [')).split('] (')[0].split('(').length - 1
  assert.equal(perFace, triangles)
  // pictures: the top red, the sides blue, also cut open by a section
  let slab = Box(20, 20, 4).colored('blue')
  slab = slab.colored('red', { faces: slab.faces().top() })
  const top = render(slab, { view: 'top', size: [160, 120], edges: false })
  const at = (60 * top.width + 80) * 3
  const [r, g, b] = [top.pixels[at], top.pixels[at + 1], top.pixels[at + 2]]
  assert.ok(r > 120 && g < 60 && b < 60, `${[r, g, b]}`)
  const cut = render(slab, { size: [160, 120], edges: false, section: Plane.XZ }).pixels
  let red = 0
  let blue = 0
  for (let i = 0; i < cut.length; i += 3) {
    if (cut[i] > 150 && cut[i + 1] < 60 && cut[i + 2] < 60) red++
    if (cut[i + 2] > 100 && cut[i] < 100) blue++
  }
  assert.ok(red > 800 && blue > 300, `${red} ${blue}`) // the top, and the sides and the cut
})

test('T5: face colors of other writers', () => {
  // A STYLED_ITEM on one ADVANCED_FACE of a file (as SolidWorks, NX and OpenCASCADE write them)
  const text = toStep(Box(10, 10, 10))
  const face = /#(\d+)=ADVANCED_FACE\(/.exec(text)![1]
  const ctx = /#(\d+)=\(GEOMETRIC_REPRESENTATION_CONTEXT/.exec(text)![1]
  const styled =
    "#9001=COLOUR_RGB('',0.,0.,1.);\n#9002=FILL_AREA_STYLE_COLOUR('',#9001);\n#9003=FILL_AREA_STYLE('',(#9002));\n" +
    "#9004=SURFACE_STYLE_FILL_AREA(#9003);\n#9005=SURFACE_SIDE_STYLE('',(#9004));\n" +
    "#9006=SURFACE_STYLE_USAGE(.BOTH.,#9005);\n#9007=PRESENTATION_STYLE_ASSIGNMENT((#9006));\n" +
    `#9008=OVER_RIDING_STYLED_ITEM('color',(#9007),#${face},#${face});\n` +
    `#9009=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#9008),#${ctx});\n`
  const back = fromStep(text.replace('ENDSEC;\nEND-ISO', `${styled}ENDSEC;\nEND-ISO`)) as Part
  assert.deepEqual(back.faces().filter((f) => f.color !== null).map((f) => f.color), [[0, 0, 1]])
  assert.equal(back.color, null)
})

// -- T6: analytic faces after a scale that differs between the axes --------------------------
test('T6: scales along the axes keep planes and cylinders', () => {
  const box = Box(10, 10, 10).scale([2, 1, 1]) as Part
  assert.deepEqual(box.faces().map((f) => f.geomType), new Array(6).fill('plane'))
  assert.deepEqual([...new Set(box.edges().map((e) => e.geomType))], ['line'])
  approx(box.volume, 2000, 1e-14)
  assert.deepEqual(box.check(), [])
  const tall = Cylinder(5, 10).scale([1, 1, 2]) as Part // was 3 B-spline faces, volume -6.8e-7 off
  assert.deepEqual(tall.faces().map((f) => f.geomType), ['cylinder', 'plane', 'plane'])
  approx(tall.faces().cylinders()[0].radius, 5, 1e-12)
  approx(tall.volume, PI * 25 * 20, 1e-12)
  assert.deepEqual(tall.check(), [])
  const flat = Cylinder(5, 10).scale([2, 1, 1]) as Part // an elliptic cylinder: a surface of extrusion
  assert.deepEqual(flat.faces().map((f) => f.geomType), ['extrusion', 'plane', 'plane'])
  approx(flat.volume, PI * 10 * 5 * 10, 1e-12)
  const egg = Sphere(5).scale([1, 1, 2]) as Part
  assert.deepEqual(egg.faces().map((f) => f.geomType), ['revolution'])
  approx(egg.volume, (4 / 3) * PI * 250, 1e-12)
  const holed = Box(20, 20, 10).cut(Cylinder(3, 20)).scale([1.5, 1, 1]) as Part
  assert.deepEqual(holed.faces().map((f) => f.geomType).sort(), ['extrusion', ...new Array(6).fill('plane')])
  approx(holed.volume, 1.5 * (4000 - PI * 90), 1e-12)
  // STEP files get the analytic surfaces
  const text = toStep(tall)
  assert.ok(text.includes('CYLINDRICAL_SURFACE') && !text.includes('B_SPLINE_SURFACE'))
  approx((fromStep(text) as Part).volume, PI * 500, 1e-12)
  // a body with nothing to recognize is left as it is
  const plain = Box(1, 1, 1)
  assert.equal(ext.recognize_analytics(plain._brep, 1e-9), null)
  const ellipsoid = Sphere(5).scale([2, 1, 1]) as Part // no analytic surface: a B-spline, as before
  assert.deepEqual(ellipsoid.faces().map((f) => f.geomType), ['bspline'])
  approx(ellipsoid.volume, (4 / 3) * PI * 250, 1e-12)
})

// -- T7: shells, cavities and the cells a face bounds ------------------------------------------
test('T7: shells, voids and the cells of faces', () => {
  const hollow = Box(20, 20, 20).cut(Box(6, 6, 6))
  assert.equal(hollow.info().solids, 1)
  assert.equal(hollow.info().voids, 1)
  const [outside, wall] = hollow.shells()
  assert.ok(wall instanceof Shell)
  assert.equal(outside.faces().length, 6)
  approx(wall.area, 216)
  assert.equal(wall.edges().length, 12) // joined: closed sheets
  assert.equal(outside.edges().length, 12)
  assert.deepEqual(hollow.voids().map((v) => Math.round(v.volume * 1e6) / 1e6), [216])
  approx(hollow.volume + hollow.voids().reduce((s, v) => s + v.volume, 0), 8000)
  const walls = hollow.faces().derivedFrom(wall) // the cavity's faces of the part itself
  assert.equal(walls.length, 6)
  assert.ok(walls.every((f) => f.owner === hollow))
  assert.deepEqual([...new Set(hollow.faces().map((f) => JSON.stringify(f.cells)))], ['[0]'])
  // a body floating in the cavity: two solids, the cavity less the body
  const caged = Box(20, 20, 20).cut(Box(10, 10, 10)).fuse(Box(4, 4, 4))
  assert.equal(caged.info().solids, 2)
  assert.equal(caged.solids().length, 2)
  assert.equal(caged.info().voids, 1)
  approx(caged.voids()[0].volume, 936)
  assert.equal(caged.shells().length, 3)
  const nested = Sphere(10).cut(Sphere(8)).fuse(Sphere(5)).cut(Sphere(3))
  const cavities = nested.voids().map((v) => v.volume).sort((a, b) => a - b)
  approx(cavities[0], (4 / 3) * PI * 27)
  approx(cavities[1], (4 / 3) * PI * (512 - 125))
  assert.equal(nested.info().solids, 2)
  // the faces between two cells of a merged part
  const m = merge(Box(40, 40, 20), Cylinder(6, 30))
  const shared = m.faces().shared()
  assert.deepEqual(shared.map((f) => f.geomType).sort(), ['cylinder', 'plane', 'plane'])
  assert.deepEqual(shared.map((f) => JSON.stringify(f.cells)).sort(), ['[0,1]', '[1,2]', '[1,3]'])
  assert.equal(m.cells().length, 4)
  assert.equal(m.info().solids, 1)
  assert.equal(m.info().voids, 0)
  assert.equal(m.shells().length, 1)
  assert.equal(Box(10, 10, 10).fuse(Box(10, 10, 10).translate(30, 0, 0)).info().solids, 2)
  assert.equal(Box(10, 10, 10).voids().length, 0)
  assert.deepEqual(Box(10, 10, 10).faces()[0].toShell().faces()[0].cells, [])
  assert.throws(() => m.edges().shared(), /shared selects faces/)
  assert.ok(!('solids' in Rectangle(4, 4).info()))
})

// -- T8: named() and colored() share the Brep ------------------------------------------------
test('T8: named and colored share the Brep, not the identity', () => {
  const part = Box(40, 30, 20).cut(Cylinder(5, 50))
  const volume = part.volume
  const named = part.named('block').colored('red')
  assert.ok(named._h === part._h && named._h.props === part._h.props) // no copy, measures kept
  assert.equal(named.volume, volume)
  assert.equal(named.name, 'block')
  assert.equal(part.name, null)
  assert.equal(part.color, null)
  assert.ok(!named.equals(part))
  assert.notEqual(named._identity(), part._identity())
  assert.equal(new ShapeList(part, named).difference([part]).length, 1)
  assert.ok(named.faces()[0].equals(part.faces()[0])) // the same kernel faces
  assert.ok(named.fillet(part.edges().top(), 1).isValid())
  // dispose() of one lets go of the Brep; the last one frees it
  const other = part.named('other')
  other.dispose()
  assert.throws(() => other.volume, /disposed/)
  approx(part.faces().length, 7)
  named.dispose()
  approx(part.volume, volume, 1e-15)
  part.dispose()
  assert.equal(named._h.alive, false)
  assert.equal(part._h.alive, false)
  // a sketch keeps its plane
  const s = Rectangle(10, 4).on(Plane.XZ).named('r')
  assert.ok(s.plane.zDir.equals(Plane.XZ.zDir))
})
