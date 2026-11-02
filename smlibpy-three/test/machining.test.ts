// Machining setups: a part laid on a 3-axis router as the scene stands it (from above: three's +Y),
// its layers sketches in the XY plane named for DXFExporter, its frame a matrix that puts the laid
// part back where the scene shows it. (smlibpy: tests/test_machining.py.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Box, BrepFace, Part, Sketch, Rectangle } from '../src/index.ts'
import { MachiningSetup, machiningSetup } from '../src/machining.ts'
import { DXFExporter } from '../src/files.ts'
import { box, close, closeBox } from './_util.ts'

/** A board 100 wide (x), 20 high (y) and 60 deep (z), with a pocket 30 x 20, 8 deep, in its top. */
function board(): Part {
  const pocket = new Box(30, 8, 20)
  pocket.position.set(0, 6, 0)
  const b = new Box(100, 20, 60).cut(pocket)
  b.position.set(10, 5, -3)
  b.updateMatrixWorld()
  return b
}

test('a board as the scene stands it: from above, its pocket on a layer of its depth', () => {
  const part = board()
  const setup = machiningSetup(part, undefined, { label: 'A1' })
  assert.ok(setup instanceof MachiningSetup)
  close(setup.thickness, 20)
  assert.deepEqual(
    setup.layers.map((s) => s.name),
    ['OUTLINE', 'POCKET_D8', 'LABEL'],
  )
  for (const s of setup.layers) {
    assert.ok(s instanceof Sketch)
    const b = s.bbox()
    close(b.min.z, 0, 1e-9) // (in the XY plane)
    close(b.max.z, 0, 1e-9)
  }
  close(setup.layer('OUTLINE')!.area, 6000)
  close(setup.layer('POCKET_D8')!.area, 600)
  assert.equal(setup.layer('THROUGH'), null)
  assert.deepEqual(setup.elsewhere, [])
  // the part laid flat on z = 0, its footprint in the positive quadrant; the matrix puts it back
  assert.ok(setup.part instanceof Part)
  closeBox(setup.part.bbox(), box([0, 0, 0], [100, 60, 20]), 1e-6)
  const back = setup.part.bbox().applyMatrix4(setup.matrix)
  closeBox(back, part.bbox().applyMatrix4(part.matrixWorld), 1e-6)
  const dxf = new DXFExporter().parse(setup.layers)
  for (const name of ['OUTLINE', 'POCKET_D8', 'LABEL']) assert.ok(dxf.includes(name), name)
})

test('a face of the part or a direction of the scene is where the tool comes from', () => {
  const part = board()
  const front = [...part.faces()].filter((f) => f.normalAt().z > 0.99).sort((a, b) => b.area - a.area)[0] // (not the pocket's wall)
  const fromFront = machiningSetup(part, front) // the tool from three's front (+z): the board 60 deep
  close(fromFront.thickness, 60)
  close(fromFront.layer('OUTLINE')!.area, 100 * 20)
  // the pocket opens at the top: a feature of another setup, its direction in the setup's frame, its
  // faces the laid part's
  assert.deepEqual(
    fromFront.elsewhere.map(([why]) => why),
    ['opens at the side'],
  )
  const [, d, faces] = fromFront.elsewhere[0]
  assert.ok(d instanceof THREE.Vector3)
  for (const f of faces) assert.ok(f instanceof BrepFace && f.owner === fromFront.part)
  const below = machiningSetup(part, new THREE.Vector3(0, -1, 0)) // from below: the pocket opens on the other side
  assert.deepEqual(
    below.elsewhere.map(([why]) => why),
    ['opens below'],
  )
  const turned = machiningSetup(part, undefined, { xDir: new THREE.Vector3(0, 0, 1) })
  closeBox(turned.layer('OUTLINE')!.bbox(), box([0, 0, 0], [60, 100, 0]), 1e-6)
})

test('what machiningSetup refuses', () => {
  assert.throws(() => machiningSetup(new Rectangle(10, 10) as unknown as Part), TypeError)
  assert.throws(() => machiningSetup(board(), undefined, { labelSize: 0, label: 'A' }), RangeError)
  assert.throws(() => machiningSetup(board(), undefined, { xDir: new THREE.Vector3(0, 1, 0) }), RangeError)
})
