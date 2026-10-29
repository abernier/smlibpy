// tests/test_machining.py: machiningSetup: a part laid on a 3-axis machine, its features sorted into
// DXF layers.
//
// The numbers are worked out by hand: areas of rectangles and circles, volumes of boxes, and the
// closed form of a band between two arcs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Align,
  Box,
  Circle,
  Cone,
  Cylinder,
  type MachiningSetup,
  type Part,
  Plane,
  Pos,
  Rectangle,
  Rot,
  type Sketch,
  chamfer,
  exportDxf,
  importDxf,
  machiningSetup,
  toSvg,
} from '../src/index.ts'
import { approx } from './_approx.ts'

const MIN = { align: [Align.MIN, Align.MIN, Align.MIN] as const }

function close(actual: ArrayLike<number>, expected: readonly number[], rel = 1e-6, abs = 1e-12): void {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) approx(actual[i], expected[i], rel, abs)
}

/** A 100 x 60 x 20 block with one feature of every kind. */
function block(): Part {
  let b = Box(100, 60, 20, MIN)
  b = b.cut(Box(30, 20, 8, { align: [Align.MIN, Align.MIN, Align.MAX] }).translate(20, 20, 20)) // a pocket, 8 deep
  b = b.cut(Cylinder(5, 50).translate(80, 40, 0)) // a hole through
  b = b.cut(Box(20, 60, 5, { align: [Align.MAX, Align.MIN, Align.MAX] }).translate(100, 0, 20)) // a rabbet at the end, 5 deep
  b = b.cut(Box(10, 10, 5, MIN).translate(60, 10, 0)) // a pocket from below
  b = b.cut(Box(15, 8, 8, { align: [Align.MIN, Align.CENTER, Align.CENTER] }).translate(0, 30, 10)) // a mortise in the end
  return b.cut(Box(10, 10, 10).translate(60, 45, 10)) // a void
}

function byName(setup: MachiningSetup): Record<string, number> {
  return Object.fromEntries(setup.layers.map((s) => [s.name as string, s.area]))
}

function layer(setup: MachiningSetup, name: string): Sketch {
  const s = setup.layer(name)
  assert.ok(s !== null, `no layer ${name}`)
  return s
}

test('the layers of a block seen from above', () => {
  const setup = machiningSetup(block(), [0, 0, 1], { label: 'A1' })
  const areas = byName(setup)
  approx(setup.thickness, 20)
  assert.ok(setup.plane.equals(Plane.XY)) // (the block as it stands: its long edge along x, the corner at the origin)
  assert.deepEqual(
    setup.layers.map((s) => s.name),
    ['OUTLINE', 'THROUGH', 'POCKET_D5', 'POCKET_D8', 'LABEL'],
  )
  approx(areas.OUTLINE, 6000) // the footprint, holes filled
  approx(areas.THROUGH, Math.PI * 25)
  approx(areas.POCKET_D8, 30 * 20)
  approx(areas.POCKET_D5, 20 * 60 - (Math.PI * 25) / 2) // the rabbet, less the half of the hole in it
  const pocket = layer(setup, 'POCKET_D8').bbox()
  close([pocket.min.x, pocket.min.y, pocket.max.x, pocket.max.y], [20, 20, 50, 40])
  const label = layer(setup, 'LABEL')
  const lc = label.center()
  assert.ok(label.faces().length === 3 && lc.x > 25 && lc.x < 75 && lc.y > 15 && lc.y < 45) // A, 1 and the arrow
  const left = setup.elsewhere.map(([why, , faces]) => [why, faces.length] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
  assert.deepEqual(left, [
    ['enclosed', 6],
    ['opens at the side', 5],
    ['opens below', 1],
  ]) // a void; a mortise; a floor
  const side = setup.elsewhere.find(([why]) => why === 'opens at the side')
  assert.ok(side?.[1])
  close(side[1].toArray(), [-1, 0, 0]) // the mortise opens through the x = 0 end
  const below = setup.elsewhere.find(([why]) => why === 'opens below')
  assert.ok(below?.[1])
  close(below[1].toArray(), [0, 0, -1])
  for (const s of setup.layers) {
    approx(s.bbox().min.z, 0) // all in the XY plane
    approx(s.bbox().max.z, 0)
  }
})

test('the same block tilted in space gives the same drawing', () => {
  const loc = Pos(50, -20, 30).mul(Rot({ x: 30, y: -20, z: 70 }))
  const tilted = loc.mul(block()) as Part
  const top = tilted
    .faces()
    .facing(loc.plane.zDir)
    .sortBy((f) => f.area)
    .at(-1)
  assert.ok(top)
  const setup = machiningSetup(tilted, top)
  const areas = byName(setup)
  approx(setup.thickness, 20)
  approx(areas.OUTLINE, 6000)
  approx(areas.POCKET_D8, 600)
  approx(areas.THROUGH, Math.PI * 25)
  close(layer(setup, 'OUTLINE').bbox().size.toArray(), [100, 60, 0])
  close(setup.plane.origin.toArray(), [50, -20, 30], 1e-6, 1e-6) // the block's corner, where loc put it
  close(setup.plane.zDir.toArray(), loc.plane.zDir.toArray())
  assert.deepEqual(setup.elsewhere.map(([why]) => why).sort(), ['enclosed', 'opens at the side', 'opens below'])
})

test('the other face and an edge are setups of their own', () => {
  const b = block()
  const below = machiningSetup(b, [0, 0, -1])
  approx(byName(below).POCKET_D5, 100) // the pocket from below, 10 x 10
  assert.deepEqual(below.elsewhere.map(([why]) => why).sort(), ['enclosed', 'opens at the side', 'opens below', 'opens below'])
  const end = machiningSetup(b, [-1, 0, 0]) // the tool comes from the x = 0 end
  approx(end.thickness, 100)
  const areas = byName(end)
  assert.deepEqual(Object.keys(areas), ['OUTLINE', 'POCKET_D15'])
  approx(areas.OUTLINE, 60 * 20)
  approx(areas.POCKET_D15, 8 * 8)
  const mortise = layer(end, 'POCKET_D15').bbox()
  close([mortise.min.x, mortise.min.y, mortise.max.x, mortise.max.y], [26, 6, 34, 14])
  // the hole's wall runs across the tool (a shaped rim); the rabbet is a pocket of the far end, the void a void
  assert.deepEqual(end.elsewhere.map(([why]) => why).sort(), [
    'enclosed',
    'not a prism along the tool',
    'opens at the side',
    'opens at the side',
    'opens below',
  ])
})

function curvedBand(r: number, a: number): Sketch {
  let band = Circle(r + 15)
    .cut(Circle(r - 15))
    .translate(0, -r, 0)
  band = band.intersect(Rectangle(2 * a, 3 * r, { align: [Align.CENTER, Align.MIN] }).translate(0, -r, 0))
  return band
}

test('a curved rail keeps its arcs through the dxf', () => {
  const r = 1000.0
  const a = 200.0
  const band = curvedBand(r, a)
  const rail = band
    .extrude(35)
    .cut(Box(10, 10, 8, { align: [Align.MIN, Align.CENTER, Align.MAX] }).translate(-a, band.bbox().min.y + 15, 35))
  const setup = machiningSetup(rail)
  const under = (radius: number) => a * Math.sqrt(radius ** 2 - a ** 2) + radius ** 2 * Math.asin(a / radius) // the integral of sqrt(radius^2 - x^2) from -a to a
  const areas = byName(setup)
  assert.deepEqual(Object.keys(areas), ['OUTLINE', 'POCKET_D8'])
  approx(areas.OUTLINE, under(r + 15) - under(r - 15))
  approx(areas.POCKET_D8, 100)
  approx(layer(setup, 'OUTLINE').bbox().size.x, 2 * a) // the chord along x
  assert.deepEqual(setup.elsewhere, [])
})

test('the dxf of a setup reads back layer by layer', () => {
  const setup = machiningSetup(block(), [0, 0, 1], { label: 'A1' })
  const path = join(mkdtempSync(join(tmpdir(), 'machining-')), 'block.dxf')
  exportDxf(setup.layers, path, { curves: 'arcs' })
  const text = readFileSync(path, 'utf8')
  for (const name of ['OUTLINE', 'THROUGH', 'POCKET_D5', 'POCKET_D8', 'LABEL']) assert.ok(text.includes(name))
  approx(importDxf(path, { layers: ['OUTLINE'] }).area, 6000)
  approx(importDxf(path, { layers: ['POCKET_D8'] }).area, 600)
  approx(importDxf(path, { layers: ['THROUGH'] }).area, Math.PI * 25, 1e-6)
})

test('walls that do not run along the tool are left to another method', () => {
  const oblique = Box(100, 60, 20, MIN).cut((Rot({ y: 20 }).mul(Box(10, 10, 30)) as Part).translate(50, 30, 15))
  let setup = machiningSetup(oblique)
  assert.deepEqual(
    setup.layers.map((s) => s.name),
    ['OUTLINE', 'THROUGH'],
  ) // where the slanted hole shows through, seen along z
  assert.deepEqual([...new Set(setup.elsewhere.map(([why]) => why))], ['not a prism along the tool'])
  const cove = Box(100, 60, 20, MIN).cut(Cone(10, 0, 10).translate(50, 30, 20))
  setup = machiningSetup(cove)
  assert.deepEqual(
    setup.layers.map((s) => s.name),
    ['OUTLINE'],
  )
  assert.deepEqual(
    setup.elsewhere.map(([why]) => why),
    ['not a prism along the tool'],
  )
})

test('xDir turns the drawing and the pocket names their depth', () => {
  const b = Box(100, 60, 20, MIN).cut(Box(10, 10, 7.5, { align: [Align.MIN, Align.MIN, Align.MAX] }).translate(10, 10, 20))
  const turned = machiningSetup(b, [0, 0, 1], { xDir: [0, 1, 0] })
  close(layer(turned, 'OUTLINE').bbox().size.toArray(), [60, 100, 0])
  assert.deepEqual(
    turned.layers.map((s) => s.name),
    ['OUTLINE', 'POCKET_D7_5'],
  )
  approx(layer(turned, 'POCKET_D7_5').area, 100)
  close(turned.plane.xDir.toArray(), [0, 1, 0])
})

test('what machiningSetup refuses', () => {
  const b = Box(100, 60, 20, MIN)
  assert.throws(() => machiningSetup(Rectangle(10, 10) as never), { name: 'TypeError', message: /Part/ })
  assert.throws(() => machiningSetup(b.fuse(b.translate(200, 0, 0))), { name: 'RangeError', message: /one solid/ })
  const curved = Cylinder(10, 20)
    .faces()
    .filter((f) => !f.isPlanar)
    .one()
  assert.throws(() => machiningSetup(Cylinder(10, 20), curved), { name: 'RangeError', message: /planar/ })
  assert.throws(() => machiningSetup(b, [0, 0, 1], { xDir: [0, 0, 1] }), { name: 'RangeError', message: /xDir/ })
  assert.throws(() => machiningSetup(b, [0, 0, 1], { label: 'A', labelSize: 0 }), { name: 'RangeError', message: /labelSize/ })
  assert.throws(() => machiningSetup(b, [0, 0, 1], { tolerance: 1 } as never), TypeError)
})

test('a shaped edge is reported apart from the pockets', () => {
  let b = Box(100, 60, 20, MIN).cut(Box(30, 20, 8, { align: [Align.MIN, Align.MIN, Align.MAX] }).translate(20, 20, 20))
  const topFront = b
    .edges()
    .filter((e) => e.geomType === 'line' && Math.abs(e.center().y) < 1e-9 && Math.abs(e.center().z - 20) < 1e-9)
  b = chamfer(topFront, 5)
  const setup = machiningSetup(b)
  const areas = byName(setup)
  assert.deepEqual(Object.keys(areas), ['OUTLINE', 'POCKET_D8']) // the pocket is still a pocket
  approx(areas.OUTLINE, 6000)
  approx(areas.POCKET_D8, 600)
  assert.deepEqual(
    setup.elsewhere.map(([why, , faces]) => [why, faces.length]),
    [['not a prism along the tool', 1]],
  ) // the chamfer
})

test('the svg of a curved part is the size of the part', () => {
  const r = 1000.0
  const a = 200.0
  const svg = toSvg(machiningSetup(curvedBand(r, a).extrude(35)).layers)
  const m = /width="([\d.]+)mm"/.exec(svg)
  assert.ok(m)
  approx(Number(m[1]), 2 * a * 1.1, 0.01) // the chord with its 5 % margins, not the arcs' circle of 2000
})
