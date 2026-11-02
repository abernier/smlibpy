// tests/test_exploded.py: exploded views: assembly axes found where parts touch, and the picture
// that draws them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssemblyAxis, Box, Cylinder, type Part, Pos, Sphere, Vector, assemblyAxes, renderExploded } from '../src/index.ts'
import { approx } from './_approx.ts'

// a 40 x 30 x 10 box standing on a 100 x 60 x 20 one: the contact is the small box's bottom,
// 1200 mm^2 centered at (10, 5, 10)
function boxOnBox(): [Part, Part] {
  const base = Box(100, 60, 20).named('base')
  const top = Pos(10, 5, 15).mul(Box(40, 30, 10).named('top')) as Part
  return [base, top]
}

// a peg of radius 5 in a blind hole 15 deep: the contact is the bore (150 pi mm^2, its centroid at
// z = 12.5) and the bottom (25 pi mm^2 at z = 5): 175 pi in all, at z = (150 * 12.5 + 25 * 5) / 175
function pegInHole(): [Part, Part] {
  const block = Box(60, 60, 40)
    .cut(Pos(0, 0, 12.5).mul(Cylinder(5, 15)) as Part)
    .named('block')
  const peg = Pos(0, 0, 20).mul(Cylinder(5, 30).named('peg')) as Part
  return [block, peg]
}

const close3 = (v: Vector, expected: [number, number, number], abs = 1e-6) => {
  const a = v.toArray()
  for (let c = 0; c < 3; c++) approx(a[c], expected[c], 0, abs)
}

test('box on box: the axis from the centroid of the contact', () => {
  const [base, top] = boxOnBox()
  const axes = assemblyAxes([base, top], [
    [0, 0, 0],
    [0, 0, 50],
  ])
  assert.equal(axes.length, 1)
  assert.ok(axes[0] instanceof AssemblyAxis)
  const a = axes[0]
  assert.deepEqual([a.first, a.second], [0, 1])
  close3(a.contact, [10, 5, 10])
  approx(a.area, 1200, 1e-6)
  close3(a.start, [10, 5, 10])
  close3(a.end, [10, 5, 60])
})

test('peg in hole: the axis on the bore axis', () => {
  const [block, peg] = pegInHole()
  const axes = assemblyAxes([block, peg], { peg: [0, 0, 60] })
  assert.equal(axes.length, 1)
  const a = axes[0]
  approx(a.contact.x, 0, 0, 1e-3)
  approx(a.contact.y, 0, 0, 1e-3)
  approx(a.contact.z, 2000 / 175, 1e-3) // 11.428571
  approx(a.area, 175 * Math.PI, 1e-3) // 549.78; the tessellation gives 549.70
  approx(a.end.z - a.start.z, 60)
})

test('offsets by part, and parts that move together', () => {
  const [base, top] = boxOnBox()
  const lid = Pos(10, 5, 22.5).mul(Box(40, 30, 5).named('lid')) as Part // on the top box
  // base and top move together: no axis between them; lid moves alone: an axis to the top box
  const axes = assemblyAxes([base, top, lid], new Map([[lid, [0, 0, 30]]]))
  assert.deepEqual(
    axes.map((a) => [a.first, a.second]),
    [[1, 2]],
  )
  close3(axes[0].contact, [10, 5, 20])
  approx(axes[0].area, 1200, 1e-6)
})

test('assemblyAxes refuses', () => {
  const [base, top] = boxOnBox()
  const far = Pos(500, 0, 0).mul(Sphere(5).named('ball')) as Part
  const three: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  assert.throws(() => assemblyAxes([base, top, far], three), {
    name: 'RangeError',
    message: /part 2 \('ball'\) touches no other part within 0.01 mm/,
  })
  assert.throws(() => assemblyAxes([base, top], { lid: [0, 0, 1] }), /no part is named 'lid'; the names are 'base', 'top'/)
  assert.throws(() => assemblyAxes([base, top], [[0, 0, 1]]), /1 offsets for 2 parts/)
  assert.throws(() => assemblyAxes([base], [[0, 0, 1]]), /needs two parts or more/)
  assert.throws(() => assemblyAxes([base, new Vector(0, 0, 0) as unknown as Part], three.slice(1)), {
    name: 'TypeError',
    message: /assemblyAxes takes parts, not a Vector/,
  })
  assert.throws(() => assemblyAxes([base, top], three.slice(1), { tolerance: 0 }), /the tolerance must be positive/)
})

test('renderExploded draws the axis where the view puts it', () => {
  // The front view looks along +Y: screen x is world x, screen up is world z. The moved parts span
  // x -50..50 and z -10..70, so without balloons the scale is min(800 * 0.88 / 100, 600 * 0.88 / 80)
  // = 6.6 px/mm and the middle (0, 30). The axis from (10, 5, 10) to (10, 5, 60) is the column
  // x = 400 + 10 * 6.6 = 466, from y = 300 + 20 * 6.6 = 432 up to 300 - 30 * 6.6 = 102.
  const [base, top] = boxOnBox()
  const pic = renderExploded([base, top], { top: [0, 0, 50] }, { view: 'front', size: [800, 600], balloons: false })
  const f = pic.frame
  assert.ok(f !== null)
  approx(f.scale, 6.6)
  approx(f.midX, 0, 1e-6, 1e-9)
  approx(f.midY, 30)
  const drawnColumns = (p: Uint8Array) => {
    const cols: number[] = []
    for (let x = 0; x < 800; x++) {
      for (let y = 110; y < 425; y++) {
        const at = (y * 800 + x) * 3
        if (765 - p[at] - p[at + 1] - p[at + 2] > 30) {
          cols.push(x)
          break
        }
      }
    }
    return cols
  }
  assert.deepEqual(drawnColumns(pic.pixels), [465, 466])
  const plain = renderExploded([base, top], { top: [0, 0, 50] }, { view: 'front', size: [800, 600], balloons: false, axes: false })
  assert.deepEqual(drawnColumns(plain.pixels), [])
})

test('renderExploded: balloons and the parts list', () => {
  const [base, top] = boxOnBox()
  const path = join(mkdtempSync(join(tmpdir(), 'exploded-')), 'exploded.png')
  const pic = renderExploded([base, top], { top: [0, 0, 50] }, { order: ['top', 'base'], size: [900, 600], path })
  assert.ok(existsSync(path))
  assert.deepEqual(new Uint8Array(readFileSync(path)), pic.data)
  assert.deepEqual([pic.width, pic.height], [900, 600])
  const inked = (p: Uint8Array, x0: number) => {
    for (let y = 0; y < 600; y++) {
      for (let x = x0; x < 900; x++) {
        const at = (y * 900 + x) * 3
        if (Math.abs(p[at] - 31) + Math.abs(p[at + 1] - 78) + Math.abs(p[at + 2] - 121) < 30) return true
      }
    }
    return false
  }
  // the parts list stands right of the parts: two rows of a balloon, a name and a count
  assert.ok(inked(pic.pixels, 780))
  // without balloons nothing is drawn in the balloons' color
  const plain = renderExploded([base, top], { top: [0, 0, 50] }, { size: [900, 600], balloons: false })
  assert.ok(!inked(plain.pixels, 0))
})

test('renderExploded refuses', () => {
  const [base, top] = boxOnBox()
  const offsets = { top: [0, 0, 50] as [number, number, number] }
  assert.throws(() => renderExploded([base, top], offsets, { order: ['base', 'top', 'lid'] }), /order names 'lid', which no part has/)
  assert.throws(() => renderExploded([base, top], offsets, { order: ['base'] }), /order leaves out 'top'/)
  assert.throws(() => renderExploded([base, top], offsets, { order: ['base', 'top', 'base'] }), /order names 'base' more than once/)
  assert.throws(() => renderExploded([base, top], offsets, { supersample: 5 }), /supersample must be 1 to 4/)
  const boxes = Array.from({ length: 12 }, (_, i) => Pos(10 * i, 0, 0).mul(Box(10, 10, 10).named(`b${i}`)) as Part)
  assert.throws(
    () =>
      renderExploded(
        boxes,
        boxes.map((_, i) => [0, 0, 5 * i] as [number, number, number]),
        { size: [400, 120] },
      ),
    /balloons do not fit/,
  )
})
