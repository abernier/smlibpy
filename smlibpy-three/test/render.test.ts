// Pictures without a GPU: render draws objects where the scene shows them, in their materials'
// colors, and takes its options in three's terms (Y up: 'top' looks down -Y, 'front' from +Z, 'right'
// from +X; radians; THREE.Plane sections that keep what three's clipping keeps; three's colors).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, Cylinder, Segment, Part, Rectangle } from '../src/index.ts'
import { TriangleMesh } from '../src/mesh.ts'
import { ImageDiff, Picture, VIEWS, diffImages, render } from '../src/render.ts'
import { close, closeVector } from './_util.ts'

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

/** Width and height from a PNG file's header (its IHDR chunk). */
function pngSize(data: Uint8Array): [number, number] {
  assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(String.fromCharCode(...data.subarray(12, 16)), 'IHDR')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

/** The pixels of a picture that pass `test` (red, green, blue): how many, their box [x0, y0, x1, y1]
 * (rows count down) and their mean row. */
function pixels(p: Picture, test: (r: number, g: number, b: number) => boolean = (r, g, b) => r + g + b < 3 * 250) {
  let count = 0
  let rows = 0
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 3
      if (!test(p.pixels[i], p.pixels[i + 1], p.pixels[i + 2])) continue
      count++
      rows += y
      box[0] = Math.min(box[0], x)
      box[1] = Math.min(box[1], y)
      box[2] = Math.max(box[2], x)
      box[3] = Math.max(box[3], y)
    }
  }
  return { count, box, row: rows / count }
}

const red = (r: number, g: number, b: number) => r > g + 60 && r > b + 60
const blue = (r: number, g: number, b: number) => b > r + 60 && b > g + 30

test('render draws a part to a PNG, where the scene shows it', () => {
  const part = new Box(60, 20, 10) // (as THREE.BoxGeometry: 60 wide along x, 20 high along y, 10 deep along z)
  const picture = render(part, { size: [320, 200] })
  assert.ok(picture instanceof Picture)
  assert.deepEqual(pngSize(picture.data), [320, 200])
  assert.equal(picture.width, 320)
  assert.equal(picture.height, 200)
  assert.equal(picture.pixels.length, 320 * 200 * 3)
  assert.ok(picture.frame !== null && picture.frame.scale > 0)
  // moved: in the same frame, +x is to the right in the front view, +y up
  const front = render(part, { view: 'front', size: [320, 200], zoom: 0.5 })
  const at = pixels(front).box
  const px = 10 * front.frame!.scale
  const moved = part.clone()
  moved.position.x = 10
  const right = pixels(render(moved, { view: 'front', size: [320, 200], frame: front })).box
  close(right[0] - at[0], px, 1.5)
  close(right[2] - at[2], px, 1.5)
  close(right[1], at[1], 1)
  moved.position.set(0, 10, 0)
  const up = pixels(render(moved, { view: 'front', size: [320, 200], frame: front })).box
  close(at[1] - up[1], px, 1.5)
  close(up[0], at[0], 1)
  // z is depth in the front view
  moved.position.set(0, 0, 30)
  assert.equal(diffImages(front, render(moved, { view: 'front', size: [320, 200], frame: front })).changed, 0)
  // a group's transform counts, as three draws it
  const group = new THREE.Group()
  group.position.x = 10
  group.add(part.clone())
  moved.position.set(10, 0, 0)
  assert.equal(diffImages(render(group, { view: 'front', size: [320, 200], frame: front }), render(moved, { view: 'front', size: [320, 200], frame: front })).changed, 0)
})

test("'top' looks down -Y, 'front' from +Z, 'right' from +X: the footprints show it", () => {
  const part = new Box(60, 20, 10) // (60 wide along x, 20 high along y, 10 deep along z)
  const aspect = (view: 'top' | 'front' | 'right') => {
    const [x0, y0, x1, y1] = pixels(render(part, { view, size: [400, 400] })).box
    return (x1 - x0 + 1) / (y1 - y0 + 1)
  }
  close(aspect('top'), 6, 0.3) // (x across, z up the picture: 60 by 10)
  close(aspect('front'), 3, 0.1) // (x across, y up: 60 by 20)
  close(aspect('right'), 0.5, 0.025) // (z across, y up: 10 by 20)
  // the camera above, looking down three's -Y, is the top view; so is +Y towards the camera
  const top = render(part, { view: 'top', size: [200, 150] })
  assert.equal(diffImages(top, render(part, { view: { direction: new THREE.Vector3(0, -1, 0) }, size: [200, 150] })).changed, 0)
  assert.equal(diffImages(top, render(part, { view: new THREE.Vector3(0, 1, 0), size: [200, 150] })).changed, 0)
  // azimuth and elevation in radians
  assert.equal(diffImages(render(part, { view: 'right', size: [200, 150] }), render(part, { view: { azimuth: Math.PI / 2 }, size: [200, 150] })).changed, 0)
  assert.equal(diffImages(top, render(part, { view: { elevation: Math.PI / 2 }, size: [200, 150] })).changed, 0)
  // seen from above, the front (+z) is at the bottom of the picture and +x to the right
  part.material = new THREE.MeshStandardMaterial({ color: 'red' })
  const near = new Box(20, 20, 10)
  near.material = new THREE.MeshStandardMaterial({ color: 'blue' })
  near.position.set(20, 0, 40)
  const both = render([part, near], { view: 'top', size: [300, 300] })
  const r = pixels(both, red)
  const b = pixels(both, blue)
  assert.ok(r.count > 100 && b.count > 100)
  assert.ok(b.row > r.row + 50, `blue at row ${b.row}, red at ${r.row}`)
  assert.ok(b.box[0] > (r.box[0] + r.box[2]) / 2)
  // (as a camera above sees them, looking down -y and turned to have -z up the picture)
  assert.equal(diffImages(both, render([part, near], { view: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1) }, size: [300, 300] })).changed, 0)
  // and from the front, both stand on one line, as three's default camera sees them (at +z, looking
  // down -z, +y up)
  const fromFront = render([part, near], { view: 'front', size: [300, 300] })
  close(pixels(fromFront, blue).box[3], pixels(fromFront, red).box[3], 1.5)
  const camera = new THREE.PerspectiveCamera()
  assert.equal(diffImages(fromFront, render([part, near], { view: { direction: camera.getWorldDirection(new THREE.Vector3()), up: camera.up }, size: [300, 300] })).changed, 0)
  // from the right (+x), the front (+z) is to the left of the picture
  const fromRight = render([part, near], { view: 'right', size: [300, 300] })
  const [rr, rb] = [pixels(fromRight, red), pixels(fromRight, blue)]
  assert.ok(rr.count > 100 && rb.count > 100)
  assert.ok(rb.box[2] < rr.box[0], `blue up to column ${rb.box[2]}, red from ${rr.box[0]}`)
  close(rb.box[3], rr.box[3], 1.5)
})

test("objects are drawn in their materials' colors: bodies, TriangleMeshes and curves", () => {
  const part = new Box(20, 20, 20)
  part.material = new THREE.MeshStandardMaterial({ color: 0xff0000 })
  const shaded = render(part, { view: 'top', size: [100, 100], edges: false })
  assert.ok(pixels(shaded, red).count > 0.9 * pixels(shaded).count)
  // 'distinct': the palette's
  const palette = render(part, { view: 'top', size: [100, 100], edges: false, colors: 'distinct' })
  assert.equal(pixels(palette, red).count, 0)
  // a mesh and a curve of its own, each in its color
  const ball = new TriangleMesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 'blue' }))
  ball.position.x = 30
  const line = new Segment(new THREE.Vector3(-10, 30, 0), new THREE.Vector3(40, 30, 0))
  line.material = new THREE.LineBasicMaterial({ color: '#00ff00' })
  const picture = render([part, ball, line], { view: 'front', size: [300, 200] })
  assert.ok(pixels(picture, red).count > 100)
  assert.ok(pixels(picture, blue).count > 100)
  assert.ok(pixels(picture, (r, g, b) => g > r + 60 && g > b + 60).count > 20)
  // a background of three's colors
  const dark = render(part, { size: [50, 50], background: new THREE.Color(0x000000) })
  assert.deepEqual([...dark.pixels.subarray(0, 3)], [0, 0, 0])
})

test('a section keeps the side three clipping with its plane keeps', () => {
  const part = new Box(20, 20, 20)
  const whole = render(part, { view: 'front', size: [200, 200] })
  const [x0, y0, x1, y1] = pixels(whole).box
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) // y = 0: keeps y >= 0
  const upper = pixels(render(part, { view: 'front', size: [200, 200], section: plane, frame: whole })).box
  close(upper[0], x0, 1)
  close(upper[2], x1, 1)
  close(upper[1], y0, 1)
  close(upper[3], (y0 + y1) / 2, 2)
  const lower = pixels(render(part, { view: 'front', size: [200, 200], section: plane.clone().negate(), frame: whole })).box
  close(lower[1], (y0 + y1) / 2, 2)
  close(lower[3], y1, 1)
  // a plane across the view direction: the cut face is capped (hatched) where the front was
  const cut = render(part, { view: 'front', size: [200, 200], section: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), frame: whole })
  assert.ok(diffImages(whole, cut).changed > 0)
  close(pixels(cut).count, pixels(whole).count, 0.02 * pixels(whole).count)
})

test('highlights: faces added to their body, and the highlight option; markers on top', () => {
  const part = new Box(30, 20, 10).cut(new Cylinder(4, 4, 30)) // (a hole along y, through its height)
  part.position.set(5, 0, 0)
  const orange = (r: number, g: number, b: number) => r > 200 && g > 70 && g < 170 && b < 60
  const plain = render(part, { view: 'top', size: [200, 200] })
  assert.equal(pixels(plain, orange).count, 0)
  const top = part.faces().top().one()
  part.add(top) // (as three draws a highlight)
  const lit = render(part, { view: 'top', size: [200, 200], frame: plain })
  assert.ok(pixels(lit, orange).count > 1000)
  part.remove(top)
  assert.equal(diffImages(lit, render(part, { view: 'top', size: [200, 200], frame: plain, highlight: top })).changed, 0)
  // edges in red, a list of them
  const edges = render(part, { view: 'top', size: [200, 200], frame: plain, highlight: part.edges().circles() })
  assert.ok(pixels(edges, red).count > 50)
  // the face nearest to a point in the world (on the top face, beside the hole)
  assert.ok(pixels(render(part, { view: 'top', size: [200, 200], frame: plain, highlightAt: new THREE.Vector3(-5, 10, 0) }), orange).count > 1000)
  // markers at points in the world, or at objects
  const marked = render(part, { view: 'top', size: [200, 200], frame: plain, markers: [{ position: new THREE.Vector3(-5, 10, 0), label: 'A', color: 'blue' }, part] })
  assert.ok(pixels(marked, blue).count > 10)
  assert.ok(pixels(marked, red).count > 10)
})

test("lookAt, frames, drawings and sheets, in three's axes", () => {
  const part = new Box(60, 20, 10)
  const front = render(part, { view: 'front', size: [300, 200] })
  // a point lands in the middle: the right end of the box
  const end = pixels(render(part, { view: 'front', size: [300, 200], lookAt: new THREE.Vector3(30, 0, 0) })).box
  close(end[2], 150, 2)
  // z is depth here: looking at a point in front is looking at the middle
  assert.equal(diffImages(front, render(part, { view: 'front', size: [300, 200], lookAt: new THREE.Vector3(0, 0, 50) })).changed, 0)
  // a box as the point: its center
  const shifted = render(part, { view: 'front', size: [300, 200], lookAt: new THREE.Box3(new THREE.Vector3(20, -5, 0), new THREE.Vector3(40, 5, 0)) })
  assert.equal(diffImages(shifted, render(part, { view: 'front', size: [300, 200], lookAt: new THREE.Vector3(30, 0, 0) })).changed, 0)
  // a frame as a picture or its frame
  assert.equal(diffImages(render(part, { view: 'front', size: [300, 200], frame: front }), render(part, { view: 'front', size: [300, 200], frame: front.frame })).changed, 0)
  // drawings and sheets have no frame
  const drawing = render(part, { view: 'sheet', size: [400, 300] })
  assert.equal(drawing.frame, null)
  assert.deepEqual(pngSize(drawing.data), [400, 300])
  assert.equal(diffImages(drawing, render(part, { drawing: 'first-angle', size: [400, 300] })).changed, 0)
  const sheet = render(part, { sheet: ['top', VIEWS.iso], size: [400, 200] })
  assert.equal(sheet.frame, null)
  assert.throws(() => render(part, { frame: sheet }), /no frame/)
  // the other options pass through
  for (const options of [{ lines: true }, { xray: true, xrayAlpha: 0.3 }, { zebra: { direction: new THREE.Vector3(0, 1, 0) } }, { curvature: 'mean' as const }, { supersample: 1, edges: false }]) {
    assert.deepEqual(pngSize(render(new Cylinder(5, 5, 10), { ...options, size: [120, 90] }).data), [120, 90])
  }
})

test("VIEWS are the named views' directions towards the camera, in three's axes", () => {
  closeVector(VIEWS.top, { x: 0, y: 1, z: 0 }, 1e-12)
  closeVector(VIEWS.bottom, { x: 0, y: -1, z: 0 }, 1e-12)
  closeVector(VIEWS.front, { x: 0, y: 0, z: 1 }, 1e-12)
  closeVector(VIEWS.back, { x: 0, y: 0, z: -1 }, 1e-12)
  closeVector(VIEWS.right, { x: 1, y: 0, z: 0 }, 1e-12)
  closeVector(VIEWS.left, { x: -1, y: 0, z: 0 }, 1e-12)
  closeVector(VIEWS.iso, new THREE.Vector3(1, 1, 1).normalize(), 1e-12)
  assert.ok(VIEWS.iso instanceof THREE.Vector3)
  assert.ok(Object.isFrozen(VIEWS) && Object.isFrozen(VIEWS.iso))
  // each draws its named view
  const part = new Box(30, 20, 10).cut(new Cylinder(4, 4, 30))
  for (const name of ['iso', 'front', 'right', 'top'] as const) {
    assert.equal(diffImages(render(part, { view: name, size: [160, 120] }), render(part, { view: VIEWS[name], size: [160, 120] })).changed, 0, name)
  }
})

test('diffImages compares pictures, PNG bytes and pixels', () => {
  const part = new Box(20, 20, 20)
  const a = render(part, { size: [120, 90] })
  const same = diffImages(a, a.data)
  assert.ok(same instanceof ImageDiff)
  assert.equal(same.changed, 0)
  assert.equal(same.total, 120 * 90)
  assert.equal(same.bbox, null)
  assert.ok(same.picture instanceof Picture)
  const bigger = part.clone()
  bigger.scale.setScalar(1.2)
  const b = render(bigger, { size: [120, 90], frame: a })
  const d = diffImages(a, b)
  assert.ok(d.changed > 0 && d.bbox !== null)
  close(d.fraction, d.changed / d.total, 1e-12)
  assert.deepEqual(pngSize(d.picture.data), [120, 90])
  // the pixels of a canvas (RGBA), and the bytes of a file
  const rgba = new Uint8ClampedArray(120 * 90 * 4)
  for (let i = 0; i < 120 * 90; i++) rgba.set([a.pixels[i * 3], a.pixels[i * 3 + 1], a.pixels[i * 3 + 2], 255], i * 4)
  assert.equal(diffImages({ width: 120, height: 90, data: rgba }, a).changed, 0)
  assert.equal(diffImages(a.data.slice().buffer, b, 255).changed, 0)
  assert.throws(() => diffImages(a, render(part, { size: [100, 90] })), RangeError)
  assert.throws(() => diffImages(a, 'a.png' as never), TypeError)
})

test("what is drawn: the package's objects where they are, visible ones; options checked", () => {
  const part = new Box(20, 20, 20)
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(), new THREE.Mesh(new THREE.BoxGeometry(500, 1, 500)), part)
  // (lights and plain meshes are left out)
  assert.equal(diffImages(render(scene, { size: [120, 90] }), render(part, { size: [120, 90] })).changed, 0)
  part.visible = false
  assert.throws(() => render(scene), /nothing to draw/)
  part.visible = true
  // empty and disposed objects are left out (three draws nothing of an empty one)
  const gone = new TriangleMesh(new THREE.BoxGeometry(100, 100, 100))
  gone.dispose()
  scene.add(new Part(), gone)
  assert.equal(diffImages(render(scene, { size: [120, 90] }), render(part, { size: [120, 90] })).changed, 0)
  // a sketch alone is filled in its material's color; with solids, its outline is drawn on top in blue
  // (here in front of the box, facing the front view's camera, +z)
  const sketch = new Rectangle(30, 30)
  sketch.material = new THREE.MeshBasicMaterial({ color: 'red', side: THREE.DoubleSide })
  sketch.position.z = 15
  assert.ok(pixels(render(sketch, { view: 'front', size: [100, 100] }), red).count > 1000)
  const over = render([part, sketch], { view: 'front', size: [100, 100] })
  assert.equal(pixels(over, red).count, 0)
  assert.ok(pixels(over, blue).count > 50)
  assert.throws(() => render(part, { annotate: true } as never), /unexpected option 'annotate'/)
  assert.throws(() => render([{}] as never), TypeError)
  // faces and edges on their own are drawn where their body is
  part.position.set(50, 0, 0)
  const face = part.faces().top().one()
  const alone = pixels(render([face, new Box(1, 1, 1)], { view: 'top', size: [200, 100] })).box
  assert.ok(alone[2] - alone[0] > 50, `${alone}`)
})

test('nothing of smlibwasm comes out', () => {
  const part = new Box(20, 20, 20)
  const a = render(part, { size: [60, 40] })
  const d = diffImages(a, render(part, { size: [60, 40], view: 'top' }))
  for (const [i, r] of [a, d, d.picture, a.frame, VIEWS].entries()) noKernel(r, `result ${i}`)
  let error: unknown
  try {
    render(part, { view: 'sideways' as never })
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof RangeError, String(error))
  noKernel(error, 'error')
})
