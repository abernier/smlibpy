// The proposed Part and Shell methods (delegating to deform.ts and sheetmetal.ts), through index.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Box, Cylinder, Lattice, Part, Rectangle, Shell, Sketch } from '../src/index.ts'
import { box, close, closeBox } from './_util.ts'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

test('Part and Shell deform by their methods', () => {
  const twisted = new Box(30, 10, 100).twist(Math.PI / 2)
  assert.ok(twisted instanceof Part)
  closeBox(twisted.faces().top().one().bbox(), box([-5, 50, -15], [5, 50, 15]), 1e-6)
  close(new Cylinder(10, 50).taper(0.5).volume, (Math.PI * 50 * 175) / 3, 1e-6)
  const r = 100 / (Math.PI / 2)
  const bent = new Box(100, 10, 10).bend(Math.PI / 2)
  closeBox(bent.unroll({ radius: r, axis: new THREE.Ray(v(-50, r, 0), v(0, 0, 1)), start: v(0, -1, 0) }).bbox(), box([-50, -5, -5], [50, 5, 5]), 1e-6)
  const block = new Box(60, 40, 20)
  const lattice = new Lattice(block, 3)
  lattice.move(lattice.layer('y', -1), v(0, 8, 0))
  close(block.deform(lattice).bbox().max.y, 18, 1e-9)
  const sheet = new Rectangle(100, 10).bend(Math.PI / 2)
  assert.ok(sheet instanceof Shell && !(sheet instanceof Sketch))
  assert.ok(sheet.twist(0.2) instanceof Shell)
  assert.ok(sheet.deform(new Lattice(sheet, 2)) instanceof Shell)
})

test('Part folds, flanges, finds its bends, unfolds and lays out its flat pattern by its methods', () => {
  const blank = new Box(100, 40, 2, { align: { y: 'min' } })
  const bracket = blank.fold(new THREE.Ray(v(20, 2, 0), v(0, 0, 1)), Math.PI / 2, { radius: 2 })
  assert.equal(bracket.bends().length, 1)
  closeBox(bracket.unfold().bbox(), blank.bbox(), 1e-6)
  close(bracket.flatPattern().size.x, 100, 1e-9)
  const plate = new Box(100, 60, 2, { align: { y: 'min' } })
  const flanged = plate.flange(plate.edges().parallelTo(v(0, 0, 1)).top().right().one(), 20, { radius: 2 })
  closeBox(flanged.bbox(), box([-50, 0, -30], [54, 20, 30]), 1e-6)
})
