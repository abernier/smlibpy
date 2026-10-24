// tests/test_closeout_R.py: the close-out of the 0.5.0 kernel plan, area R. Drawing views of tori
// (outline raised on the projection's degenerate slivers and took seconds to measure them), D2: a
// twist leaves a cylinder, cone, sphere or torus about its own axis as it was, W9: the methods that
// make intermediates free them at once (Sketch.revolve kept 3 handles a call until the garbage
// collector ran), Text's FontError, the kernel trace of re-raised errors and of docs/kernel.md's
// example, the box check of shell and offset (a face may reach out by its edges' and vertices'
// tolerance: the deform recipe's twisted vase), and the printed numbers of the trim and loft references.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Align,
  Axis,
  Box,
  Circle,
  Cone,
  Cylinder,
  GridLocations,
  KernelError,
  Lattice,
  Line,
  Plane,
  Polygon,
  Rectangle,
  Shell,
  Sphere,
  Spline,
  Text,
  Torus,
  X,
  Y,
  Z,
  bend,
  drawingViews,
  extrude,
  fold,
  flange,
  loft,
  memoryUsage,
  revolve,
  swing,
  taper,
  thicken,
  toStep,
  twist,
  unfold,
  unroll,
  type Part,
} from '../src/index.ts'
import { BoundBox, CenterArc, setGuardSeconds, surface } from '../src/index.ts'
import { ext } from '../src/kernel.ts'
import { _offsetProblem } from '../src/shapes.ts'
import { FontError } from '../src/font.ts'
import { approx } from './_approx.ts'

const PI = Math.PI

// ---------------------------------------------------------------------------------- outline
for (const [R, r, plane, name, edges, length] of [
  [20, 5, Plane.YZ, 'YZ', 8, 4 * 20 + 2 * PI * 5], // 0.5.0: RangeError (a line needs two distinct points)
  [8, 2, Plane.XZ, 'XZ', 5, 4 * 8 + 2 * PI * 2], // 0.5.0: RangeError
  [12, 2, Plane.XZ, 'XZ', 5, 4 * 12 + 2 * PI * 2], // 0.5.0: RangeError (collinear points)
  [20, 5, Plane.XZ, 'XZ', 5, 4 * 20 + 2 * PI * 5],
  [5, 4.5, Plane.YZ, 'YZ', 8, 4 * 5 + 2 * PI * 4.5],
] as const) {
  test(`the outline of Torus(${R}, ${r}) seen from ${name}`, () => {
    const t0 = performance.now()
    const torus = Torus(R, r)
    const seen = torus.outline(plane)
    assert.ok(performance.now() - t0 < 10000) // (the slivers took seconds each to measure)
    assert.equal(seen.length, edges)
    approx(seen.reduce((s, e) => s + e.length, 0), length, 1e-6)
    const tol = 1e-6 * torus.bbox().diagonal
    assert.ok(seen.every((e) => e.bbox().diagonal > tol)) // no specks left
    const [visible, hidden] = torus.outline(plane, { hidden: true })
    assert.ok(visible.length && [...visible, ...hidden].every((e) => e.length > tol))
  })
}

test('outline: a survey of shapes and views', () => {
  const planes = [Plane.XY, Plane.YZ, Plane.XZ, new Plane([0, 0, 0], null, [1, 1, 1]), new Plane([0, 0, 0], null, [0.3, -1, 0.2])]
  const shapes: Part[] = [[10, 3], [15, 4], [30, 5], [20, 8], [6, 1], [40, 3]].map(([R, r]) => Torus(R, r))
  shapes.push(Torus(20, 5).rotate(X, 30), Cone(10, 5, 20), Cone(10, 0, 20), Sphere(7), Cylinder(5, 20).rotate(Y, 90))
  shapes.push(Torus(20, 5).cut(Box(50, 50, 20).translate(25, 0, 0)), Sphere(10).cut(Cylinder(3, 30)))
  for (const s of shapes) {
    const tol = 1e-6 * s.bbox().diagonal
    for (const p of planes) {
      const seen = s.outline(p)
      assert.ok(seen.length && seen.every((e) => e.bbox().diagonal > tol))
      const [visible] = s.outline(p, { hidden: true })
      assert.ok(visible.length)
    }
  }
})

test('outline draws each line once', () => {
  // the projection gave a hole's rim seen edge-on as a second piece of the outline's line (natively)
  for (const [part, plane, edges, length] of [
    [Cylinder(10, 5).cut(Cylinder(8, 5)), Plane.XZ, 4, 50],
    [Cylinder(10, 5).cut(Cylinder(8, 5)), Plane.YZ, 6, 50], // (split at y 0)
    [Cylinder(5, 20).rotate(Y, 90), Plane.XY, 4, 60],
  ] as const) {
    const seen = part.outline(plane)
    assert.equal(seen.length, edges)
    approx(seen.reduce((s, e) => s + e.length, 0), length, 1e-9)
    const [visible] = part.outline(plane, { hidden: true })
    approx(visible.reduce((s, e) => s + e.length, 0), length, 1e-4) // (natively its pieces leave gaps of a few 1e-4)
  }
})

test('drawing views of a torus', () => {
  const views = drawingViews(Torus(20, 5))
  assert.deepEqual(views.map((v) => v.name), ['front', 'top', 'left'])
  assert.ok(views.every((v) => v.visible.length))
  approx(views[2].visible.reduce((s, e) => s + e.length, 0), 4 * 20 + 2 * PI * 5, 1e-6)
})

// ---------------------------------------------------------------------------------- D2
const types = (p: { faces(): Iterable<{ geomType: string }> }) => [...p.faces()].map((f) => f.geomType).sort()

for (const [name, make, kinds, volume] of [
  ['a cylinder', () => twist(Cylinder(5, 40), 90), ['cylinder', 'plane', 'plane'], PI * 25 * 40],
  ['a cylinder twice round', () => twist(Cylinder(5, 40), 720), ['cylinder', 'plane', 'plane'], PI * 25 * 40],
  ['a cone', () => twist(Cone(10, 5, 20), -400), ['cone', 'plane', 'plane'], (PI * 20 * 175) / 3],
  ['a cone with an apex', () => twist(Cone(10, 0, 20), 90), ['cone', 'plane'], (PI * 20 * 100) / 3],
  ['a sphere', () => twist(Sphere(7), 90), ['sphere'], (4 / 3) * PI * 343],
  ['a torus', () => twist(Torus(20, 5), 90), ['torus'], 2 * PI * PI * 20 * 25],
  ['a torus in a range', () => twist(Torus(20, 5), 90, { start: -2, end: 2 }), Array(5).fill('torus'), 2 * PI * PI * 20 * 25],
  ['a tube', () => twist(Cylinder(10, 40).cut(Cylinder(6, 40)), 90), ['cylinder', 'cylinder', 'plane', 'plane'], PI * 64 * 40],
  ['a cylinder in a range', () => twist(Cylinder(5, 40), 90, { start: -10, end: 10 }), ['cylinder', 'cylinder', 'cylinder', 'plane', 'plane'], PI * 25 * 40],
  ['a cylinder about X', () => twist(Cylinder(5, 40).rotate(Y, 90), 90, { axis: Axis.X }), ['cylinder', 'plane', 'plane'], PI * 25 * 40],
] as const) {
  test(`a twist leaves ${name} about its axis as it was (D2)`, () => {
    // 0.5.0: every such face a B-spline (its seam a helix), the volume 1e-9 off
    const part = (make as () => Part)()
    assert.ok(part.isValid() && part.check().length === 0)
    assert.deepEqual(types(part), kinds)
    approx(part.volume, volume as number, 1e-10)
  })
}

test('a twisted cylinder is the cylinder, also in STEP files (D2)', () => {
  const c = twist(Cylinder(5, 40), 90)
  const wall = c.faces().cylinders().one()
  approx(wall.radius, 5, 1e-12)
  assert.ok(wall.axis.direction.isParallel(Z.direction))
  assert.deepEqual([...c.edges()].map((e) => e.geomType).sort(), ['circle', 'circle'])
  const step = toStep(c)
  assert.ok(step.includes('CYLINDRICAL_SURFACE') && !step.includes('B_SPLINE_SURFACE'))
})

test('a twisted bar keeps its bore (D2)', () => {
  const bar = Box(20, 20, 40).cut(Cylinder(4, 40))
  for (const options of [{}, { start: -5, end: 5 }]) {
    const twisted = twist(bar, 90, options)
    assert.ok(twisted.isValid() && twisted.check().length === 0)
    const bore = twisted.faces().cylinders()
    assert.equal(bore.length, 'start' in options ? 3 : 1)
    assert.ok(bore.every((f) => Math.abs(f.radius - 4) < 1e-12))
    assert.equal(types(twisted).filter((t) => t === 'bspline').length, 4) // the sides
    approx(twisted.volume, bar.volume, 1e-8)
  }
})

test('a twisted shaft keeps its turned faces; faces the twist moves are fitted (D2)', () => {
  const profile = Polygon([0, 0], [10, 0], [10, 20], [8, 22], [8, 30], [10, 32], [10, 60], [0, 60]).on(Plane.XZ)
  const shaft = revolve(profile, Axis.Z)
  const twisted = twist(shaft, 45)
  assert.deepEqual(types(twisted), ['cone', 'cone', 'cylinder', 'cylinder', 'cylinder', 'plane', 'plane'])
  approx(twisted.volume, shaft.volume, 1e-12)
  assert.deepEqual(types(twist(Cylinder(3, 40).translate(5, 0, 0), 90)), ['bspline', 'plane', 'plane'])
  assert.deepEqual(types(twist(Torus(20, 5), 90, { axis: Axis.X })), ['bspline'])
  const holed = Cylinder(10, 40).cut(Cylinder(2, 40).translate(5, 0, 0))
  const t = twist(holed, 90)
  assert.deepEqual(types(t), ['bspline', 'cylinder', 'plane', 'plane'])
  approx(t.volume, holed.volume, 1e-8)
  const sheet = twist(Cylinder(5, 40).faces().cylinders()[0].toShell(), 90)
  assert.ok(sheet instanceof Shell && types(sheet).join() === 'cylinder')
  // a half: its straight free edges bound it and turn with the twist (into helices)
  const half = Cylinder(5, 40).intersect(Box(10, 10, 40).translate(5, 0, 0)).faces().cylinders()[0].toShell()
  const turned = twist(half, 90)
  const top = turned.vertices().filter((v) => v.z > 0).map((v) => [Math.round(v.x * 1e6) / 1e6 + 0, Math.round(v.y * 1e6) / 1e6 + 0]).sort((a, b) => a[0] - b[0])
  assert.deepEqual(top, [[-5, 0], [0, 5]]) // (the top turned by 90 degrees: (0, 5) and (5, 0) before)
  approx(turned.faces()[0].area, half.faces()[0].area, 1e-9)
})

// ---------------------------------------------------------------------------------- W9
test('methods that make intermediates free them at once (W9)', () => {
  // (Sketch.revolve kept 3 handles, about 655 KB, a call until the garbage collector ran: +267 MB
  // over 400 synchronous calls)
  const lathe = Rectangle(10, 10, { align: [Align.MIN, Align.MIN] }).translate(5, 0).cut(Circle(2).translate(10, 5)).on(Plane.XZ)
  const sk = Rectangle(20, 10).cut(Circle(2))
  const box = Box(30, 20, 10)
  const holed = Box(30, 20, 10).cut(Cylinder(4, 20))
  const torus = Torus(20, 5)
  const plate = Box(100, 20, 4)
  const sheet = Box(60, 20, 2)
  const ring = Cylinder(52, 40).cut(Cylinder(50, 50)).cut(Box(60, 60, 50, { align: [Align.MIN, Align.MIN, Align.CENTER] }))
  const face = Rectangle(10, 10).faces()[0]
  const profile = Rectangle(5, 10, { align: [Align.MIN, Align.MIN] }).on(Plane.XZ)
  const outline = Rectangle(20, 14)
  const top = Circle(4).on(Plane.XY.offset(10))
  const pin = Cylinder(2, 5)
  const folded = fold(sheet, new Axis([0, 0, 1], [0, 1, 0]), 90, { radius: 2 })
  const edge = sheet.edges().filter((e) => e.geomType === 'line' && Math.abs(e.center().x - 30) < 1e-6 && e.center().z > 0.5)[0]
  const lattice = new Lattice(box, 2)
  lattice.move([1, 1, 1], [0, 0, 2])
  const steps: [string, () => unknown][] = [
    ['Sketch.revolve', () => lathe.revolve(Z, 90)],
    ['revolve', () => revolve(lathe, Z, 90)],
    ['Sketch.extrude with a taper', () => sk.extrude(5, { taper: 5 })],
    ['extrude with a taper', () => extrude(sk, 5, { taper: -5 })],
    ['Sketch.extrude both ways', () => sk.extrude(5, { both: true })],
    ['Sketch.extrude along a direction', () => sk.extrude(5, { direction: [0.3, 0, 1] })],
    ['Face.extrude', () => box.faces().top().one().extrude(5)],
    ['Sketch.swing', () => profile.swing(outline)],
    ['swing', () => swing(profile, outline)],
    ['outline', () => holed.outline(Plane.XZ)],
    ['outline with hidden lines', () => holed.outline(Plane.XZ, { hidden: true })],
    ['outline of a torus', () => torus.outline(Plane.YZ)],
    ['drawingViews', () => drawingViews(holed)],
    ['intersectionCurves of a plane', () => holed.intersectionCurves(Plane.XY.offset(1))],
    ['twist in a range', () => twist(box, 30, { start: 2, end: 8 })],
    ['taper in a range', () => taper(box, 0.8, { start: 2, end: 8 })],
    ['bend', () => bend(plate, 90, { radius: 20 })],
    ['unroll', () => unroll(ring, { radius: 51 })],
    ['Lattice.apply', () => lattice.apply(box)],
    ['thicken', () => thicken(face, 1)],
    ['thicken both ways', () => thicken(face, 1, { both: true })],
    ['fold', () => fold(sheet, new Axis([0, 0, 1], [0, 1, 0]), 90, { radius: 2 })],
    ['flange', () => flange(sheet, edge, 10, { radius: 2 })],
    ['unfold', () => unfold(folded)],
    ['loft', () => loft([outline, top])],
    ['a pattern', () => GridLocations(10, 10, 2, 2).mul(pin)],
  ]
  const free = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x) || Symbol.iterator in (x as object)) for (const y of x as Iterable<unknown>) free(y)
    else if (typeof (x as { dispose?: unknown }).dispose === 'function') (x as { dispose(): void }).dispose()
    else for (const y of Object.values(x as object)) free(y)
  }
  for (const [name, step] of steps) {
    free(step()) // (first calls fill caches)
    const before = memoryUsage().handles
    for (let i = 0; i < 3; i++) free(step())
    assert.equal(memoryUsage().handles - before, 0, `${name} leaves handles until the garbage collector runs`)
  }
})

test('synchronous revolves keep the kernel memory flat (W9)', () => {
  const lathe = Rectangle(10, 10, { align: [Align.MIN, Align.MIN] }).translate(5, 0).cut(Circle(2).translate(10, 5)).on(Plane.XZ)
  for (let i = 0; i < 5; i++) lathe.revolve(Z, 90).dispose()
  const before = memoryUsage()
  for (let i = 0; i < 200; i++) lathe.revolve(Z, 90).dispose()
  const after = memoryUsage()
  assert.equal(after.handles, before.handles)
  assert.ok(after.used - before.used < 4 * 1048576, `${(after.used - before.used) / 1048576} MB`) // (it grew by 130 MB)
})

// ---------------------------------------------------------------------------------- shell and offset
const starVase = (): Part => {
  const pts: [number, number][] = []
  for (let i = 0, a = 0; a < 360; a += 30, i++) {
    const r = i % 2 === 0 ? 30 : 24
    pts.push([r * Math.cos((a * PI) / 180), r * Math.sin((a * PI) / 180)])
  }
  return twist(Polygon(...pts).extrude(120), 90) as Part
}

test('the twisted vase of the deform recipe shells', () => {
  // (natively it raised in about 2 of 5 runs: the extended mode's walls were refused as reaching 1.3e-3
  // above the rim, where the kernel's tight box of the inner wall took in a point of its surface off the
  // face, 1.4e-3 from a rim vertex of tolerance 1.8e-3)
  const vase = starVase()
  const guard = setGuardSeconds(120) // (a step takes 2 to 5 s; on a loaded machine longer than 20)
  try {
    for (let i = 0; i < 2; i++) {
      const shelled = vase.shell(2.5, vase.faces().sortBy(Z).at(-1))
      assert.ok(shelled.isValid())
      assert.equal(shelled.faces().length, 27)
      approx(shelled.volume, 56361.5, 1e-6)
      assert.ok(shelled.bbox().max.z < 120 + 2e-3)
    }
  } finally {
    setGuardSeconds(guard)
  }
})

test('a body reaches out of its box only beyond its edges\' tolerance', () => {
  const body = Box(10, 10, 10)
  const out = 'a body that reaches out of the box it must fit in'
  const lower = new BoundBox([-5, -5, -5], [5, 5, 4.999]) // the top face lies 1e-3 above it
  assert.equal(_offsetProblem(body, lower, 1e-6, 2000, true), out)
  const real = ext.edge_tolerance
  try {
    ext.edge_tolerance = () => 2e-3 // the top's edges are that tolerant
    assert.equal(_offsetProblem(body, lower, 1e-6, 2000, true), null)
    ext.edge_tolerance = () => 1 // (at most 1e-4 of the box's size: 1.7e-3 here)
    assert.equal(_offsetProblem(body, new BoundBox([-5, -5, -5], [5, 5, 4.99]), 1e-6, 2000, true), out)
  } finally {
    ext.edge_tolerance = real
  }
})

// ---------------------------------------------------------------------------------- documented numbers
test('the printed numbers of the trim and loft references', () => {
  const f = (x: number, y: number) => 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
  const grid: [number, number, number][][] = []
  for (let x = 0; x <= 40; x += 5) {
    const row: [number, number, number][] = []
    for (let y = 0; y <= 30; y += 5) row.push([x, y, f(x, y)])
    grid.push(row)
  }
  const saddle = surface(grid)
  const outline = saddle.project(CenterArc([20, 15, 50], 5, 0, 360), [0, 0, -1])
  const panel = saddle.trim(outline, [2, 2, 0])
  assert.equal(Math.round(panel.area * 1000) / 1000, 1169.871) // (skill surfaces/trim said 1169.877)
  const cone = loft([Circle(10), Circle(5).translate(0, 0, 20)]) as Part
  assert.equal(Math.round(cone.volume * 1000) / 1000, 3665.191) // (skill features/loft said 3665.192)
})

// ---------------------------------------------------------------------------------- errors
test('Text with a font it cannot read throws a FontError (a RangeError)', () => {
  const bad = join(mkdtempSync(join(tmpdir(), 'closeout-r-')), 'bad.woff')
  writeFileSync(bad, new Uint8Array([0x77, 0x4f, 0x46, 0x46, ...new Array(60).fill(0)]))
  assert.throws(() => Text('A', 5, { font: bad }), (e: unknown) => e instanceof FontError && e instanceof RangeError && e.message.startsWith('Text: '))
})

test('errors raised again with a hint keep the kernel trace (section)', () => {
  assert.throws(
    () => Box(20, 20, 10).cut(Cylinder(3, 20)).section(Plane.XZ.offset(3)),
    (e: unknown) => e instanceof KernelError && /move the plane a little/.test(e.message) && e.trace.length > 0 && /\(SmApiCreatePlanarFaces\)$/.test(e.trace[e.trace.length - 1]),
  )
})

test("docs/kernel.md's trace example fails in the kernel, as natively", () => {
  assert.throws(
    () => Box(20, 20, 20).cut(Cylinder(3, 40).rotate(Z, 45)).cut(Cylinder(2, 40).rotate(Z, 45).rotate(X, 90).translate(1, 0, 0)),
    (e: unknown) =>
      e instanceof KernelError &&
      e.status === 'SM_ERR' &&
      e.trace.slice(-3).map((t) => t.split(' ').pop()).join() === '(MakeFaceuse),(ManifoldBoolean),(SmApiBoolean)',
  )
})
