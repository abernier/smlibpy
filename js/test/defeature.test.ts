// tests/test_defeature.py: fillet and face removal: faces().fillets(), Part.removeFillets,
// Part.removeFaces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelingError, k } from '../src/kernel.ts'
import { _spill, setGuardSeconds } from '../src/defeature.ts'
import { BoundBox, Z } from '../src/geometry.ts'
import { Align } from '../src/align.ts'
import { type Face, Part, type ShapeList } from '../src/shapes.ts'
import { Box, Cylinder } from '../src/parts.ts'
import { Slot } from '../src/sketches.ts'
import { exportStep } from '../src/exporters.ts'
import { importStep } from '../src/step_import.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: test helpers
type Any = any

function exactVolume(part: Part): number {
  return part.massProperties(1, 1e-10).volume
}

function same(a: number, b: number, rel = 1e-9): boolean {
  return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1.0)
}

/** pytest.raises: `fn` throws an instance of `cls` whose message matches. */
function raises(fn: () => unknown, cls: abstract new (...args: Any[]) => Error, match?: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof cls, `expected a ${cls.name}, got ${String(e)}`)
    if (match) assert.match((e as Error).message, match)
    return true
  })
}

// (pytest's module fixtures)
const box = Box(40, 30, 20)
const plate = Box(60, 40, 5, { align: [Align.CENTER, Align.CENTER, Align.MAX] })

// -- finding fillets -------------------------------------------------------------------------
test('fillets found by geometry', () => {
  const rounded = box.fillet(box.edges(), 3) // 12 edge rounds and 8 corner spheres
  const found = rounded.faces().fillets()
  assert.equal(found.length, 20)
  assert.deepEqual([...new Set(found.map((f) => f.geomType))].sort(), ['cylinder', 'sphere'])
  assert.equal(rounded.faces().fillets(3).length, 20)
  assert.equal(rounded.faces().fillets(2.9).length, 0)
  assert.equal(box.faces().fillets().length, 0)
})

test('fillets skip walls and holes', () => {
  const holed = box.cut(Cylinder(5, 40))
  assert.equal(holed.faces().fillets().length, 0)
  // the side of a disc rounded at both ends meets two fillets tangentially but is no fillet
  let disc = Cylinder(10, 8)
  disc = disc.fillet(disc.edges(), 2)
  const found = disc.faces().fillets()
  assert.ok(found.length === 2 && found.every((f) => f.geomType === 'revolution'))
  // the round ends of a slot look like fillets; maxRadius keeps them out
  const slot = Slot(40, 12).extrude(5)
  assert.equal(slot.faces().fillets().length, 2)
  assert.equal(slot.faces().fillets(5).length, 0)
})

test('fillets rejects a bad radius', () => {
  raises(() => box.faces().fillets(0), RangeError)
})

// -- removing fillets ------------------------------------------------------------------------
test('removing vertical fillets gives the box back', () => {
  const rounded = box.fillet(box.edges().parallelTo(Z), 3)
  const sharp = rounded.removeFillets()
  assert.ok(sharp.isValid() && sharp.faces().length === 6)
  assert.ok(sharp.faces().every((f) => f.geomType === 'plane'))
  assert.ok(same(exactVolume(sharp), 24000.0, 1e-12))
  const b = sharp.bbox()
  ;[-20, -15, -10].forEach((x, i) => approx(b.min.toArray()[i], x, 0, 1e-9))
  ;[20, 15, 10].forEach((x, i) => approx(b.max.toArray()[i], x, 0, 1e-9))
  assert.equal(rounded.faces().length, 10) // the input is unchanged
})

test("the kernel's fillet removal", () => {
  // SMLib's own fillet removal needs the face test of SmVertex::GetVertexuseOfFace
  // (third_party/patches/SMLib/src/SmVertex.cpp); without it the kernel removes nothing.
  const brep = box.fillet(box.edges().parallelTo(Z), 3)._copyBrep()
  k.remove_fillet(brep)
  const sharp = Part._wrap(brep)
  assert.ok(sharp.isValid() && sharp.faces().length === 6)
  assert.ok(same(exactVolume(sharp), 24000.0, 1e-12))
})

test('removing all rounds of a box', () => {
  const rounded = box.fillet(box.edges(), 3)
  const sharp = rounded.removeFillets()
  assert.ok(sharp.isValid() && sharp.faces().length === 6)
  assert.ok(same(exactVolume(sharp), 24000.0, 1e-12))
})

test('removing mitred and blend fillets', () => {
  const top = box.fillet(
    box.edges().filter((e) => e.center().z > 9),
    3,
  )
  const variable = box.fillet(box.edges().parallelTo(Z), { start: 2, end: 4 })
  const g2 = box.fillet(box.edges().parallelTo(Z), 3, { continuity: 'G2' })
  for (const rounded of [top, variable, g2]) {
    const sharp = rounded.removeFillets()
    assert.ok(sharp.faces().length === 6 && same(exactVolume(sharp), 24000.0, 1e-12))
  }
})

test('removing fillets between boss and plate', () => {
  const sharp = plate.fuse(Box(20, 16, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }))
  const rounded = sharp.fillet(
    sharp.edges().filter((e) => Math.abs(e.center().z) < 1e-6 && e.convexity === 'concave'),
    2,
  )
  assert.equal(rounded.faces().fillets().length, 8) // 4 fillets, 4 corner patches
  const back = rounded.removeFillets()
  assert.ok(back.isValid() && back.faces().length === sharp.faces().length && sharp.faces().length === 11)
  assert.ok(same(exactVolume(back), 15200.0, 1e-12))
  assert.ok(exactVolume(back) < exactVolume(rounded)) // concave fillets held material
})

test('removing a ring fillet around a boss', () => {
  const sharp = plate.fuse(Cylinder(6, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }))
  const ring = sharp.edges().filter((e) => Math.abs(e.center().z) < 1e-6 && e.geomType === 'circle')
  const rounded = sharp.fillet(ring, 2)
  const back = rounded.removeFillets()
  assert.ok(back.isValid() && back.faces().length === sharp.faces().length)
  assert.ok(same(exactVolume(back), 12000 + Math.PI * 36 * 10, 1e-11))
})

test('removing convex and concave fillets together', () => {
  const sharp = plate.fuse(Cylinder(6, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }))
  let rounded = sharp.fillet(
    sharp.edges().filter((e) => e.geomType === 'circle' && e.center().z > 9),
    2,
  )
  rounded = rounded.fillet(
    rounded.edges().filter((e) => e.geomType === 'circle' && Math.abs(e.center().z) < 1e-6),
    1.5,
  )
  const back = rounded.removeFillets()
  assert.ok(same(exactVolume(back), exactVolume(sharp), 1e-11))
  // only the small concave one
  const some = rounded.removeFillets(null, { maxRadius: 1.5 })
  assert.equal(some.faces().length, rounded.faces().length - 1)
  assert.ok(exactVolume(some) < exactVolume(rounded))
})

test('removing selected fillets only', () => {
  const rounded = box.fillet(box.edges().parallelTo(Z), 3)
  const one = rounded.faces().fillets().sortBy('x')[0]
  const back = rounded.removeFillets(one)
  assert.equal(back.faces().length, 9)
  const gained = exactVolume(back) - exactVolume(rounded) // one round: (r^2 - pi r^2 / 4) * 20
  assert.ok(Math.abs(gained - 20 * (9 - (9 * Math.PI) / 4)) <= 1e-9 * 24000)
})

test('removing fillets after a STEP round trip', () => {
  const rounded = box.fillet(box.edges(), 3)
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-defeature-'))
  exportStep(rounded, join(dir, 'rounded.step'))
  const imported = importStep(join(dir, 'rounded.step')) as Part
  const sharp = imported.removeFillets()
  assert.ok(sharp.isValid() && sharp.faces().length === 6)
  assert.ok(same(exactVolume(sharp), 24000.0, 1e-12))
})

test('removeFillets refuses other faces', () => {
  const rounded = box.fillet(box.edges().parallelTo(Z), 3)
  raises(() => rounded.removeFillets(rounded.faces().top()), ModelingError, /no fillets/)
  raises(() => rounded.removeFillets([]), RangeError)
})

test('removeFillets without fillets returns the part', () => {
  assert.equal(box.removeFillets(), box)
})

// -- removing other faces --------------------------------------------------------------------
for (const name of ['through hole', 'blind hole', 'boss', 'pocket', 'counterbore', 'two holes']) {
  test(`removeFaces closes holes and drops bosses: ${name}`, () => {
    let part: Part
    let faces: ShapeList<Face>
    if (name === 'through hole') {
      part = box.cut(Cylinder(5, 40))
      faces = part.faces().cylinders()
    } else if (name === 'blind hole') {
      part = box.cut(Cylinder(5, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }))
      faces = part.faces().cylinders() // the floor goes with the wall
    } else if (name === 'boss') {
      part = box.fuse(Cylinder(5, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).translate(0, 0, 10))
      faces = part.faces().cylinders() // the top goes with the side
    } else if (name === 'pocket') {
      part = box.cut(Box(10, 8, 6, { align: [Align.CENTER, Align.CENTER, Align.MAX] }).translate(0, 0, 10))
      faces = part.faces().within(new BoundBox([-5.1, -4.1, 3.9], [5.1, 4.1, 10.1]))
      assert.equal(faces.length, 5)
    } else if (name === 'counterbore') {
      part = box.cut(Cylinder(3, 40)).cut(Cylinder(6, 4, { align: [Align.CENTER, Align.CENTER, Align.MAX] }).translate(0, 0, 10))
      faces = part.faces().filter((f) => f.geomType === 'cylinder' || (f.isPlanar && Math.abs(f.center().z - 6) < 1e-9))
    } else {
      part = box.cut(Cylinder(3, 40).translate(-10, 0, 0)).cut(Cylinder(3, 40).translate(10, 0, 0))
      faces = part.faces().cylinders()
    }
    const back = part.removeFaces(faces)
    assert.ok(back.isValid() && back.faces().length === 6)
    assert.ok(same(exactVolume(back), 24000.0, 1e-12))
  })
}

test('removeFaces keeps the face its rounds enclose', () => {
  // The top of a box whose top edges are rounded has only rounds around it, so removeFaces of the
  // rounds took the top along, and the kernel closed the gap at the rounds' lower edges: the box came
  // back 2 lower (3200.0, valid). Likewise the top of a boss with a rounded rim.
  let rounded = Box(20, 20, 10)
  rounded = rounded.fillet(rounded.edges().top(), 2)
  let back = rounded.removeFaces(rounded.faces().fillets())
  assert.ok(back.faces().length === 6 && same(back.volume, 4000.0) && same(back.bbox().max.z, 5.0))
  let boss = box.fuse(Cylinder(5, 10, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).translate(0, 0, 10))
  boss = boss.fillet(boss.edges().filter((e) => e.geomType === 'circle' && Math.abs(e.center().z - 20) < 1e-9), 1)
  back = boss.removeFaces(boss.faces().filter((f) => !['plane', 'cylinder'].includes(f.geomType)))
  assert.ok(same(back.volume, 24000.0 + 250 * Math.PI, 1e-8) && same(back.bbox().max.z, 20.0)) // was 1 lower
  // the floor of a pocket inside its rounds still goes with the pocket's walls (a sharp rim)
  let pocket = box.cut(Box(20, 20, 10, { align: [Align.CENTER, Align.CENTER, Align.MAX] }).translate(0, 0, 10))
  pocket = pocket.fillet(pocket.edges().within(new BoundBox([-10.1, -10.1, -0.1], [10.1, 10.1, 0.1])), 2) // its floor
  const inside = pocket.faces().within(new BoundBox([-10.1, -10.1, -0.1], [10.1, 10.1, 10.1]))
  const walls = inside.filter((f) => !(f.isPlanar && Math.abs(f.center().z) < 1e-9)) // all but the floor
  assert.ok(inside.length === 9 && walls.length === 8)
  back = pocket.removeFaces(walls)
  assert.ok(back.faces().length === 6 && same(back.volume, 24000.0, 1e-12))
})

test('a feature without a direction may not shrink the part', () => {
  const lower = Box(40, 30, 16).translate(0, 0, -2)
  assert.ok(_spill(box, lower, 24000.0, 1e9)!.startsWith('a part that shrank along Z (-10..10 -> -10..6)'))
  assert.ok(_spill(box, lower, 24000.0, 100.0)!.startsWith('a volume change of 4800, more than the faces span (100)'))
  assert.equal(_spill(box, box, 24000.0, 100.0), null)
})

test('removeFaces errors', () => {
  const holed = box.cut(Cylinder(5, 40))
  raises(() => holed.removeFaces([]), RangeError)
  raises(() => holed.removeFaces(holed.faces()), ModelingError, /every face/)
  raises(() => holed.removeFaces(Box(1, 1, 1).translate(100, 0, 0).faces().top()), RangeError)
})

// -- what Python's MCP session test models (the session and the guide search are Python's) ----
test('rounds and a hole taken out, a plane face refused', () => {
  const rounded = box.fillet(box.edges(), 3)
  const sharp = rounded.removeFillets()
  assert.deepEqual([rounded.faces().fillets().length, sharp.faces().length], [20, 6])
  approx(sharp.volume, 24000, 1e-9)
  const holed = box.cut(Cylinder(5, 40))
  const plain = holed.removeFaces(holed.faces().cylinders())
  approx(plain.volume, 24000, 1e-9)
  raises(() => rounded.removeFillets(rounded.faces().top()), ModelingError, /no fillets/)
})

// -- the guard: a probe worker with a time limit (smlibwasm; smlibpy forks its process) ---------
test('a kernel step that does not finish is stopped after GUARD_SECONDS and dropped (smlibwasm)', () => {
  // The kernel's fillet removal loops on the outer bottom round of the enclosure example (it ran
  // for good, at full load, before the guard): in a process of its own, so that a hang fails the
  // test instead of stopping the suite.
  const src = new URL('../src/', import.meta.url).href
  const examples = new URL('../examples/', import.meta.url).href
  const code = `
    import { setGuardSeconds } from '${src}defeature.ts'
    import { model } from '${examples}enclosure.ts'
    setGuardSeconds(1)
    const box = model()[0]
    const round = box.faces().fillets().filter((f) => f.center().z < 2 && f.geomType === 'cylinder').slice(0, 1)
    try {
      box.removeFillets(round)
      console.log('removed')
    } catch (e) {
      console.log(e.name + ': ' + e.message)
    }
    console.log('kept', box.removeFillets(round, { partial: true }).volume === box.volume)
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(run.signal, null, 'the step was not stopped')
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /ModelingError: removeFillets: the kernel could not take out 1 of the 1 fillet faces/)
  assert.match(run.stdout, /kept true/)
})

test('without the guard the kernel steps run directly (smlibwasm)', () => {
  const old = setGuardSeconds(0)
  try {
    const rounded = box.fillet(box.edges(), 3)
    approx(rounded.removeFillets().volume, 24000, 1e-9)
  } finally {
    setGuardSeconds(old)
  }
  raises(() => setGuardSeconds(-1), RangeError)
})
