// Drawings: the views of parts on the ground (a sheet's (u, v) is three's (u, 0, -v)), seen from
// three's sides (front from +Z, top from +Y), and written as DXF and SVG where the scene shows them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, Cylinder, Edge, Rectangle, type Part } from '../src/index.ts'
import { DrawingView, drawingViews, type ViewName } from '../src/drawing.ts'
import { DXFExporter, DXFLoader, SVGExporter } from '../src/files.ts'
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

/** A box with a hole through its height: hidden lines in the views from the sides. */
const holed = (): Part => new Box(40, 20, 10).cut(new Cylinder(4, 30))

test('the views of a box lie on the ground, laid out as a sheet, seen from three\'s sides', () => {
  const views = drawingViews(new Box(40, 20, 10)) // (40 along x, 20 along z, 10 high)
  assert.deepEqual(views.map((v) => v.name), ['front', 'top', 'left'])
  const [front, top, left] = views
  assert.ok(front instanceof DrawingView)
  assert.ok(front.direction instanceof THREE.Vector3)
  closeVector(front.direction, { x: 0, y: 0, z: 1 }) // (from three's front, towards its default camera)
  closeVector(top.direction, { x: 0, y: 1, z: 0 })
  closeVector(left.direction, { x: -1, y: 0, z: 0 })
  for (const v of views) {
    assert.equal(v.visible.length, 4)
    assert.equal(v.hidden.length, 0)
    for (const e of v.visible) {
      assert.ok(e instanceof Edge && e instanceof THREE.Line && e.owner === null)
      const b = e.bbox()
      close(b.min.y, 0, 1e-12) // (on the ground)
      close(b.max.y, 0, 1e-12)
    }
  }
  // the front view where the box is (its width x, its height up the sheet: -z), the view from above
  // below it (first-angle: towards +z), the view from the left to its right; a fifth of 40 between
  assert.ok(front.bbox() instanceof THREE.Box3)
  closeBox(front.bbox(), box([-20, 0, -5], [20, 0, 5]), 1e-9)
  closeBox(top.bbox(), box([-20, 0, 13], [20, 0, 33]), 1e-9)
  closeBox(left.bbox(), box([28, 0, -5], [48, 0, 5]), 1e-9)
  // third-angle: the view from above above it
  const [, above] = drawingViews(new Box(40, 20, 10), ['front', 'top'], { projection: 'third-angle', gap: 5 })
  closeBox(above.bbox(), box([-20, 0, -30], [20, 0, -10]), 1e-9)
  noKernel(views, 'views')
})

test('every view looks from its side of three\'s axes; hidden lines, tangent edges and gaps', () => {
  const all: ViewName[] = ['front', 'back', 'top', 'bottom', 'left', 'right']
  const views = drawingViews(holed(), all)
  const direction = Object.fromEntries(views.map((v) => [v.name, v.direction.toArray()]))
  assert.deepEqual(direction, { front: [0, 0, 1], back: [0, 0, -1], top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] })
  const by = Object.fromEntries(views.map((v) => [v.name, v]))
  assert.equal(by.front.hidden.length, 2) // (the hole, behind the front face)
  assert.equal(by.right.hidden.length, 2)
  assert.equal(by.top.hidden.length, 0) // (seen from above, the hole is seen)
  assert.ok(by.top.visible.length > 4)
  assert.equal(drawingViews(holed(), 'front', { hidden: false })[0].hidden.length, 0)
  // a rounded box: its fillets' tangent lines only when asked for
  const rounded = new Box(40, 20, 10)
  const round = rounded.fillet(rounded.edges().parallelTo(new THREE.Vector3(0, 1, 0)), 3)
  const plain = drawingViews(round, 'front')[0].visible.length
  assert.ok(drawingViews(round, 'front', { tangentEdges: true })[0].visible.length > plain)
  assert.throws(() => drawingViews(round, 'side' as ViewName), /unknown view 'side'/)
})

test('parts are drawn where the scene shows them, together, each hiding the others', () => {
  // turned a quarter about y, the box shows its 20 wide side in front
  const part = new Box(40, 20, 10)
  part.rotation.y = Math.PI / 2
  part.position.set(100, 3, 0)
  const [front, top] = drawingViews(part, ['front', 'top'])
  closeBox(front.bbox(), box([90, 0, -8], [110, 0, 2]), 1e-9) // (x from 90 to 110; y from -2 to 8 up the sheet: -z)
  closeVector(top.bbox().getSize(new THREE.Vector3()), { x: 20, y: 0, z: 40 }, 1e-9)
  // a group: its visible bodies, together
  const group = new THREE.Group()
  const a = new Box(10, 10, 10)
  const b = new Box(10, 10, 10)
  b.position.x = 20
  const gone = new Box(10, 10, 10)
  gone.position.x = 200
  gone.visible = false
  group.add(a, b, gone)
  const [both] = drawingViews(group, 'front')
  closeBox(both.bbox(), box([-5, 0, -5], [25, 0, 5]), 1e-9)
  assert.equal(both.visible.length, 8)
  closeBox(drawingViews([a, b, gone], 'front')[0].bbox(), box([-5, 0, -5], [205, 0, 5]), 1e-9) // (given: drawn)
  assert.throws(() => drawingViews(new THREE.Group()), /drawingViews: nothing to draw/)
  assert.throws(() => drawingViews([new THREE.Vector3() as never]), /drawingViews draws parts and shells, not a Vector3/)
})

test('SVG: views (hidden lines dashed), sketches, faces and curves, seen from above', () => {
  const svg = new SVGExporter().parse(drawingViews(holed()))
  assert.match(svg, /^<\?xml/)
  assert.match(svg, /class="hidden"[^>]*stroke-dasharray/)
  assert.match(svg, /class="visible"/)
  // a sketch towards the back (-z) is up the sheet (the SVG's y runs down); millimeters, true size
  const sketch = new Rectangle(20, 10)
  sketch.position.z = -10
  const drawn = new SVGExporter().parse(sketch, { margin: 0, stroke: 0.5 })
  assert.match(drawn, /width="20mm" height="10mm" viewBox="-10 -15 20 10"/)
  assert.match(drawn, /stroke-width="0.5"/)
  // a face of a part, where its part is; the part itself is passed over
  const part = new Box(40, 20, 10)
  part.position.x = 50
  assert.match(new SVGExporter().parse(part.faces().top(), { margin: 0 }), /viewBox="30 -10 40 20"/)
  assert.match(new SVGExporter().parse([part, sketch], { margin: 0 }), /viewBox="-10 -15 20 10"/)
  assert.throws(() => new SVGExporter().parse(part), /SVGExporter: nothing to draw.*drawingViews/)
  assert.throws(() => new SVGExporter().parse([], { margin: -1 }), /nothing to draw/)
  assert.throws(() => new SVGExporter().parse(sketch, { margin: -1 }), /SVGExporter: margin must not be negative/)
})

test('DXF of views: the layers VISIBLE and HIDDEN, the lines where the scene shows them', () => {
  const views = drawingViews(holed())
  const text = new DXFExporter().parse(views)
  assert.ok(text.includes('VISIBLE') && text.includes('HIDDEN') && text.includes('DASHED'))
  const lines = new DXFLoader().setOptions({ wires: true }).parse(text) as THREE.Group
  const count = views.reduce((n, v) => n + v.visible.length + v.hidden.length, 0)
  assert.ok(lines.children.length > 0 && lines.children.length <= count)
  const hiddenOnly = new DXFLoader().setOptions({ wires: true, layers: 'HIDDEN' }).parse(text) as THREE.Group
  assert.equal(hiddenOnly.children.length, 4) // (the hole's two lines in the front and left views)
  // a view whose lines were moved (in the scene) is written where they are
  const [front] = drawingViews(new Box(40, 20, 10), 'front')
  for (const e of front.visible) e.position.x = 100
  closeBox(front.bbox(), box([80, 0, -5], [120, 0, 5]), 1e-9)
  const k = sm.fromDxfWires(new DXFExporter().parse(front)).bbox()
  closeVector(k.min, { x: 80, y: -5, z: 0 }, 1e-9)
  closeVector(k.max, { x: 120, y: 5, z: 0 }, 1e-9)
  // an empty view has an empty box
  assert.ok(new DrawingView('front', new THREE.Vector3(0, 0, 1), [], []).bbox().isEmpty())
})
