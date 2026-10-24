// Closeout of the kernel plan's Booleans, cells and topology area (K1): the defects the 0.5.0 notes
// left open there. Ported from tests/test_closeout_K1.py (the raw boolean_with_curves of Python's
// _core has no smlibwasm binding). Reference volumes are OpenCASCADE's where it agrees with the
// invariants, else integrals of the shapes as noted.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Box, Circle, Cone, Cylinder, KernelError, ModelingError, Rectangle, Sphere, Torus, X, Y, fromStep, toStep } from '../src/index.ts'
import type { Part } from '../src/index.ts'
import { ext } from '../src/kernel.ts'
import { approx } from './_approx.ts'

function throwsMatching(fn: () => unknown, kind: new (...a: never[]) => Error, re: RegExp): void {
  assert.throws(fn, (e: unknown) => e instanceof kind && re.test((e as Error).message))
}

// -- the trap of a torus touching a plate (kernel patch: SmTopologyIntersector::DeleteFaces)

test('a torus touching a plate at a point no longer traps', () => {
  const plate = Box(20, 16, 4).cut(Sphere(6).rotate(X, 90).translate(1.4007, 0, -1.5863))
  const ring = Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)
  const plateVolume = 1280 - Math.PI * (36 * 4 - (3.5863 ** 3 + 0.4137 ** 3) / 3)
  const ringVolume = 2 * Math.PI ** 2 * 6 * 2.5 ** 2
  assert.equal(plate.intersect(ring).faces().length, 0) // they touch at a point: nothing in common
  assert.equal(ring.intersect(plate).faces().length, 0)
  approx(plate.fuse(ring).volume, plateVolume + ringVolume, 1e-7)
  approx(plate.cut(ring).volume, plateVolume, 1e-7)
  approx(ring.cut(plate).volume, ringVolume, 1e-9)
})

// -- unions and cuts that left an operand out

test('a union that gives back one operand is caught and done again', () => {
  // fuzz csg-11-132: the kernel returned the first operand with two vertices imprinted (1358.54)
  const a = Cylinder(5, 5).fuse(Box(20, 4, 16).rotate(X, 90).translate(0, -3, -0.5))
  const b = Cylinder(2, 12).translate(2, -2.3693, 3.5)
  const u = a.fuse(b)
  approx(u.volume, 1446.612107, 1e-7) // OpenCASCADE 1446.612107
  assert.ok(u.isValid())
  approx(u.bbox().max.z, 9.5)
})

test('a cut that reaches out of the part raises', () => {
  // fuzz csg-8-110 D: a body of no volume reaching to x = 16, out of the part (x <= 2), returned
  const a = Cylinder(2, 12)
  const b = Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)
  throwsMatching(() => a.cut(b), ModelingError, /partly outside the part/)
})

test('an intersection the other way round', () => {
  const part = Box(30, 30, 30).cut(Cylinder(2.278, 60).translate(0.968, 1.638, 0))
  const ring = Torus(3.566, 1.783).rotate(Y, 90).translate(3.246, 6.987, 7.278)
  const common = part.intersect(ring)
  approx(common.volume, 213.187445, 1e-6) // OpenCASCADE 213.187445; it raised before
  assert.ok(common.isValid())
})

// -- seams of bodies that are no bodies of revolution, and seams of B-spline faces (B6)

const HOLES: [number, number, number, number, () => ReturnType<typeof Sphere>, number, number, number][] = [
  [20, 3.174, -2.051, -2.981, () => Sphere(3.159).translate(1.123, 0.178, 2.221), 7387.872204, 111.192087, 7255.822483],
  [30, 3.598, -1.684, 2.985, () => Sphere(1.273).translate(1.914, 4.258, 0.143), 25782.865515, 5.681248, 25774.224319],
  [30, 3.194, 0.834, 0.654, () => Cylinder(3.288, 60).rotate(Y, 90).translate(0, 3.942, -5.207), 27134.631179, 941.702215, 25096.816244],
  [20, 3.187, 2.812, 0.475, () => Sphere(3.244).translate(5.999, 3.719, 0.422), 7383.815903, 121.001303, 7240.817513],
]

for (const [n, [size, r, x, y, tool, union, common, rest]] of HOLES.entries()) {
  test(`a tool tangent to the seam of an earlier hole (${n})`, () => {
    // The hole's seam touches the tool where their faces cross; the part is no body of revolution:
    // the hole's wall is filled and cut again turned. Before: the union of the first 7492.16.
    const part = Box(size, size, size).cut(Cylinder(r, 2 * size).translate(x, y, 0))
    const t = tool()
    assert.ok(ext.seam_contacts(part._brep, t._brep).length > 0)
    approx(part.fuse(t).volume, union, 1e-7)
    approx(part.intersect(t).volume, common, 1e-6)
    approx(part.cut(t).volume, rest, 1e-7)
    assert.ok(part.cut(t).isValid())
  })
}

test('seams on B-spline faces and tangent to B-spline faces', () => {
  // the groove pin of B6 with B-spline faces (24656.15 and 24461.48 before); exact 24299.258668
  const pin = Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
  const part = Box(30, 30, 30).cut(Cylinder(5, 60))
  approx(part.toNurbs().cut(pin).volume, 24299.258668, 1e-7)
  approx(part.cut(pin.toNurbs()).volume, 24299.258668, 1e-7)
  approx(part.toNurbs().cut(pin.toNurbs()).volume, 24299.258668, 1e-7)
})

test('merging into a merged part turns the new part\'s seam', () => {
  const part = Box(30, 30, 30).cut(Cylinder(5, 60))
  const pin = Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
  const cells = part.merge(Box(4, 4, 4).translate(0, 0, 40)).merge(pin).cells()
  approx(cells.reduce((s, c) => s + c.volume, 0), part.fuse(pin).volume + 64, 1e-9)
  approx(Math.max(...cells.map((c) => c.volume)), 24299.258668, 1e-9)
})

// -- 2D Booleans of faces far apart (C1)

test('a lattice of unit squares beside a far square', () => {
  // A unit square fused to its neighbour at a corner, with a square 1000 away, became a sliver of
  // 0.2778 without an error (12 of 60 random lattices in smlibwasm; 43 more raised).
  const lattices: [number, number][][] = [
    [[1, 2], [2, 1], [2, 2], [0, 4], [1, 1], [0, 1]],
    [[3, 0], [1, 3], [4, 1], [3, 1], [2, 1], [0, 4]],
    [[0, 2], [1, 1], [0, 4], [1, 4], [1, 2], [3, 0]],
    [[3, 1], [2, 1], [3, 3], [0, 0], [1, 2], [4, 1]],
  ]
  for (const cells of lattices) {
    let squares = Rectangle(1, 1).translate(1000.5, 0.5)
    for (const [i, j] of cells) squares = squares.fuse(Rectangle(1, 1).translate(i + 0.5, j + 0.5))
    approx(squares.area, 7)
    assert.ok(squares.faces().every((f) => f.area > 1 - 1e-9))
  }
})

test('far pieces on both sides', () => {
  const a = Rectangle(1, 1).translate(1000.5, 0.5).fuse(Rectangle(2, 2).translate(1, 1)).fuse(Circle(1).translate(-500, 0))
  const b = Rectangle(2, 2).translate(2, 2).fuse(Rectangle(1, 1).translate(1000.5, 1.0)).fuse(Circle(0.5).translate(300, 300))
  const [areaA, areaB, common] = [5 + Math.PI, 5 + Math.PI / 4, 1.5]
  approx(a.fuse(b).area, areaA + areaB - common) // before: 9.419
  approx(a.cut(b).area, areaA - common)
  approx(a.intersect(b).area, common)
  approx(a.xor(b).area, areaA + areaB - 2 * common)
  approx(a.fuse(b).extrude(1).volume, areaA + areaB - common)
})

// -- split along a sheet of one analytic face that ends inside the part (B12)

test('split along a cylindrical face that ends inside the part', () => {
  const box = Box(20, 20, 20)
  const face = Cylinder(30, 8).translate(0, -25, 0).faces().cylinders()[0]
  const [outside, inside] = box.split(face.toShell(), 'both')
  const area = 2 * (5 * Math.sqrt(800) + 450 * Math.asin(1 / 3)) - 300
  approx(inside.volume, 20 * area, 1e-6)
  approx(outside.volume + inside.volume, 8000, 1e-7)
  assert.ok(inside.faces().cylinders().length > 0)
})

test('split along a plane face that ends inside the part', () => {
  const box = Box(20, 20, 20)
  const face = Box(8, 8, 1).rotate(X, 20).faces().sortBy(Y).at(-1)!
  const [above, below] = box.split(face.toShell(), 'both')
  approx(above.volume, 4000 - (4 * 20 * 20) / Math.cos((20 * Math.PI) / 180), 1e-9)
  approx(above.volume + below.volume, 8000, 1e-9)
})

// -- circular rims after a scale along the axis (T6)

test('rims of parts scaled along their axis are circles', () => {
  const tall = Cylinder(5, 10).scale([1, 1, 2]) as Part
  assert.deepEqual(tall.edges().map((e) => e.geomType), ['circle', 'circle'])
  for (const e of tall.edges().circles()) approx(e.radius, 5, 1e-12)
  approx(tall.volume, Math.PI * 25 * 20, 1e-13)
  assert.deepEqual(tall.check(), [])
  const cone = Cone(5, 2, 10).scale([1, 1, 3]) as Part
  assert.deepEqual(cone.edges().circles().map((e) => Math.round(e.radius * 1e9) / 1e9).sort(), [2, 5])
  const holed = Box(20, 20, 10).cut(Cylinder(3, 20)).scale([1, 1, 1.5]) as Part
  assert.equal(holed.edges().circles().length, 2)
  assert.deepEqual(holed.check(), [])
  approx(holed.volume, 1.5 * (4000 - Math.PI * 90), 1e-13)
  assert.ok(holed.fillet(holed.edges().circles(), 1).isValid())
  const cut = Box(20, 20, 20).cut(Sphere(5).translate(0, 0, 10)).scale([1, 1, 2]) as Part
  assert.equal(cut.edges().circles().length, 1)
  assert.deepEqual([...new Set((Cylinder(5, 10).scale([2, 1, 1]) as Part).edges().map((e) => e.geomType))], ['bspline'])
  const text = toStep(tall)
  assert.ok(text.includes('CIRCLE(') && !text.includes('B_SPLINE_CURVE'))
  approx((fromStep(text) as Part).volume, Math.PI * 500, 1e-13)
})

// -- a fillet the kernel fails inside names what it could not build (B19 with F8)

test('a fillet that fails inside the kernel names the round it could not build', () => {
  // fuzz case fillet-7-161: SM_ERR_NULL_POINTER, with the fillet executive's record of the round (the
  // message left the record out in smlibwasm)
  const part = Torus(8, 1.5).cut(Sphere(2.5).translate(7, 7, -2.8573))
  let error: KernelError | undefined
  try {
    part.fillet(part.edges(), 0.495553)
  } catch (e) {
    error = e as KernelError
  }
  assert.ok(error instanceof KernelError && error.status === 'SM_ERR_NULL_POINTER')
  assert.ok(!error.message.includes('may be too large'))
  assert.ok(error.message.includes('the kernel failed inside the fillet') && error.message.includes('which says nothing about the radius'))
  assert.ok(error.message.includes('it could not build the round of the closed edge through (6.18121, 5.0668, -1.49998)'))
})
