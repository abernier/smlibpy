// Files: every format smlibwasm reads and writes exactly, the three.js way (loaders with load,
// loadAsync and parse; exporters with parse). Files are read and written as they are, as three's
// STLLoader takes a file: objects are written where the scene shows them, a file's coordinates are
// three's, and what a loader gives is not turned. USD says which way is up: USDBrepExporter writes a
// Z-up stage turned from three's, and USDBrepLoader turns its group back, as three's USDLoader turns
// a Z-up stage. 2D drawings (DXF, SVG) lie in the XY plane: a drawing's (x, y) is three's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Body, Box, Circle, Cylinder, BrepEdge, Ellipse, Segment, ModelingError, Part, Polyline, Rectangle, Shell, Sketch, Ball, BrepVertex, Wire } from '../src/index.ts'
import {
  BREPExporter,
  BREPLoader,
  DXFExporter,
  DXFLoader,
  IGESLoader,
  SMBExporter,
  SMBLoader,
  SMPExporter,
  SMPLoader,
  STEPExporter,
  STEPLoader,
  SVGExporter,
  USDBrepExporter,
  USDBrepLoader,
} from '../src/files.ts'
import { box, close, closeBox, closeVector } from './_util.ts'

// (three's FileLoader reports progress with ProgressEvent, which browsers have and Node has not)
const g = globalThis as { ProgressEvent?: unknown }
g.ProgressEvent ??= class extends Event {
  constructor(type: string, init: object = {}) {
    super(type)
    Object.assign(this, init)
  }
}

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

const dataUrl = (contents: string | Uint8Array, type = 'application/octet-stream') => `data:${type};base64,${Buffer.from(contents).toString('base64')}`
const hex = (o: THREE.Object3D) => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()
const IGES = new URL('../../tests/data/iges/', import.meta.url)
const Z = new THREE.Vector3(0, 0, 1)

/** Runs `fn` with the kernel's warnings (console.warn) caught, and gives them. */
function warnings(fn: () => void): string[] {
  const caught: string[] = []
  const warn = console.warn
  console.warn = (message: unknown) => caught.push(String(message))
  try {
    fn()
  } finally {
    console.warn = warn
  }
  return caught
}

/** The exact box around the bodies under `o` (and `o` itself) in the world: each body's box
 * through its matrixWorld. */
function worldBox(o: THREE.Object3D): THREE.Box3 {
  o.updateWorldMatrix(true, true)
  const out = new THREE.Box3()
  o.traverse((x) => {
    if (x instanceof Body) out.union(x.bbox().applyMatrix4(x.matrixWorld))
  })
  return out
}

/** The box of what the kernel itself read from a file (a body, or a list of them). */
function kernelBox(read: unknown): THREE.Box3 {
  const out = new THREE.Box3()
  for (const body of (Array.isArray(read) ? read : [read]) as { bbox(): sm.BoundBox }[]) {
    const b = body.bbox()
    out.union(new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z)))
  }
  return out
}

/** Fails unless `o` lies in its parent's frame as it is: not moved, turned or scaled. */
function unmoved(o: THREE.Object3D, what = o.name || o.type): void {
  o.updateMatrix()
  assert.ok(o.matrix.equals(new THREE.Matrix4()), `${what} is moved or turned: [${o.matrix.elements.join(', ')}]`)
}

/** The one sketch of a drawing DXFLoader read (a THREE.Group of it). */
function sketchOf(group: THREE.Group): Sketch {
  assert.ok(group instanceof THREE.Group)
  assert.equal(group.children.length, 1)
  const sketch = group.children[0]
  assert.ok(sketch instanceof Sketch)
  return sketch
}

// ------------------------------------------------------------------------------------ as they are
test('files are read and written as they are: a part comes back where the scene showed it, not turned', () => {
  // a part placed by its transform and its group's: written where the scene shows it
  const part = new Box(10, 30, 20).cut(new Cylinder(3, 3, 40)) // (30 high, bored along y)
  part.name = 'block'
  part.position.set(5, 15, -10)
  part.rotation.set(0.3, 0, 0.2)
  const scene = new THREE.Group()
  scene.position.set(0, 2, 0)
  scene.rotation.y = Math.PI / 6
  scene.add(part)
  const where = worldBox(part)
  const center = part.getCenter().applyMatrix4(part.matrixWorld)
  const step = new STEPExporter().parse(scene)
  const brep = new BREPExporter().parse(scene)
  const smb = new SMBExporter().parse(scene)
  const smp = new SMPExporter().parse(scene)
  // the files hold three's world coordinates, as the kernel reads them itself
  const kernel: [string, unknown][] = [
    ['STEP', sm.fromStepModel(step).bodies],
    ['BREP', sm.fromBrep(brep)],
    ['SMB', sm.fromSmb(smb)],
    ['SMP', sm.fromSmp(smp)],
  ]
  for (const [format, read] of kernel) closeBox(kernelBox(read), where, 1e-9, format)
  // and the loaders give them so: nothing moved or turned, the part where the scene showed it
  const loaded: [string, THREE.Object3D][] = [
    ['STEP', new STEPLoader().parse(step)],
    ['BREP', new BREPLoader().parse(brep)],
    ['SMB', new SMBLoader().parse(smb)],
    ['SMP', new SMPLoader().parse(smp)],
  ]
  for (const [format, result] of loaded) {
    const body = result instanceof Body ? result : result.children[0]
    assert.ok(body instanceof Part, format)
    unmoved(result, format)
    unmoved(body, format)
    closeBox(worldBox(result), where, 1e-9, format)
    closeVector(body.getCenter().applyMatrix4(body.matrixWorld), center, 1e-9, format)
    close(body.volume, part.volume, 1e-6, format)
  }
})

// ------------------------------------------------------------------------------------------- STEP
test('STEP: bodies, curves, points and coordinate systems, as they are, named and colored', () => {
  const scene = new THREE.Group()
  scene.position.set(0, 2, 0) // (everything is written where the scene shows it)
  const pin = new Cylinder(5, 5, 40, { align: { y: 'min' } }) // (40 high, standing on its base)
  pin.name = 'pin'
  pin.material = new THREE.MeshStandardMaterial({ color: '#336699' })
  pin.position.set(10, 0, -20)
  const axis = new Segment(new THREE.Vector3(10, 0, -20), new THREE.Vector3(10, 30, -20))
  axis.name = 'axis'
  axis.material = new THREE.LineBasicMaterial({ color: '#ff0000' })
  const path = new Polyline([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 0, -10)])
  path.name = 'path'
  const refs = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1, 2, 3), new THREE.Vector3(-4, 5, 6)]), new THREE.PointsMaterial({ color: '#00ff00' }))
  refs.name = 'refs'
  // a coordinate system: an empty, its axes the frame's (its +Z along three's +X, its +X along -Z)
  const mcs = new THREE.Object3D()
  mcs.name = 'MCS'
  mcs.position.set(5, 10, 15)
  mcs.rotation.y = Math.PI / 2
  mcs.userData.color = '#0000ff'
  scene.add(pin, axis, path, refs, mcs)
  const text = new STEPExporter().parse(scene)

  // read by the kernel itself: three's coordinates, everything where the scene shows it
  const model = sm.fromStepModel(text)
  assert.equal(model.bodies.length, 1)
  closeBox(kernelBox(model.bodies[0]), box([5, 2, -25], [15, 42, -15]), 1e-6)
  const frame = model.frames.find((f) => f.name === 'MCS')!
  closeVector(frame.plane.origin, { x: 5, y: 12, z: 15 }, 1e-9)
  closeVector(frame.plane.zDir, { x: 1, y: 0, z: 0 }, 1e-9) // (the empty's +Z)
  closeVector(frame.plane.xDir, { x: 0, y: 0, z: -1 }, 1e-9) // (its +X)
  assert.deepEqual(frame.color, [0, 0, 1])
  const line = model.curves.find((c) => c.name === 'axis')!
  assert.ok(line.shape instanceof sm.Edge)
  closeVector(line.shape.start, { x: 10, y: 2, z: -20 }, 1e-9)
  closeVector(line.shape.end, { x: 10, y: 32, z: -20 }, 1e-9)
  assert.deepEqual(line.color, [1, 0, 0])
  assert.deepEqual(model.points.map((p) => [p.name, p.point.toArray()]), [
    ['refs', [1, 4, 3]],
    ['refs', [-4, 7, 6]],
  ])

  // and back: a group of what the file holds, nothing turned, named and colored as it was
  const group = new STEPLoader().parse(text)
  assert.ok(group instanceof THREE.Group)
  unmoved(group)
  assert.deepEqual(group.userData.skipped, [])
  const [part] = group.children.filter((o) => o instanceof Part) as Part[]
  assert.equal(part.name, 'pin')
  assert.equal(hex(part), '336699')
  unmoved(part)
  closeBox(part.bbox(), box([5, 2, -25], [15, 42, -15]), 1e-6)
  closeBox(part.bbox(), worldBox(pin), 1e-6)
  close(part.volume, Math.PI * 25 * 40, 1e-6)
  const edge = group.getObjectByName('axis') as BrepEdge
  assert.ok(edge instanceof BrepEdge && edge.owner === null)
  closeVector(edge.start, { x: 10, y: 2, z: -20 }, 1e-9)
  closeVector(edge.end, { x: 10, y: 32, z: -20 }, 1e-9)
  assert.equal(hex(edge), 'ff0000')
  const wire = group.getObjectByName('path') as Wire
  assert.ok(wire instanceof Wire)
  close(wire.length, 20, 1e-9)
  closeBox(wire.bbox(), box([0, 2, -10], [10, 2, 0]), 1e-9)
  const points = group.children.filter((o) => o instanceof BrepVertex) as BrepVertex[]
  assert.deepEqual(points.map((p) => p.name), ['refs', 'refs'])
  closeVector(points[0].point, { x: 1, y: 4, z: 3 }, 1e-9)
  closeVector(points[1].point, { x: -4, y: 7, z: 6 }, 1e-9)
  assert.equal(hex(points[0]), '00ff00')
  const empty = group.getObjectByName('MCS')!
  assert.equal(Object.getPrototypeOf(empty), THREE.Object3D.prototype)
  group.updateMatrixWorld()
  scene.updateMatrixWorld()
  empty.matrixWorld.elements.forEach((e, i) => close(e, mcs.matrixWorld.elements[i], 1e-9, `matrix[${i}]`))
  assert.equal(empty.userData.color, '#0000ff')
  // a sketch on the coordinate system lies in its XY plane: its normal is the frame's +Z
  const on = new Rectangle(20, 10).on(empty.matrixWorld)
  closeVector(on.plane.normal, { x: 1, y: 0, z: 0 }, 1e-9)
  // the same file again from what was read
  const again = sm.fromStepModel(new STEPExporter().parse(group))
  assert.equal(String(again), String(model))
  noKernel(group, 'group')
})

test('STEPLoader: bodies that cannot be read are left out and listed (strict throws); heal', () => {
  const box10 = new Box(10, 10, 10)
  box10.name = 'box'
  const cyl = new Cylinder(3, 3, 10)
  cyl.name = 'cyl'
  cyl.position.x = 20
  const text = new STEPExporter().parse([box10, cyl, new Segment(new THREE.Vector3(), new THREE.Vector3(1, 0, 0))])
  const broken = text.replace(/CIRCLE\(/g, 'CLOTHOID(') // (a curve smlibwasm does not read)
  let group!: THREE.Group
  const warned = warnings(() => {
    group = new STEPLoader().parse(broken)
  })
  assert.deepEqual(group.children.filter((o) => o instanceof Part).map((o) => o.name), ['box'])
  assert.equal(group.children.filter((o) => o instanceof BrepEdge).length, 1)
  assert.equal(group.userData.skipped.length, 1)
  assert.match(group.userData.skipped[0], /'cyl'.*CLOTHOID/)
  assert.ok(warned.some((w) => /cyl/.test(w)))
  assert.throws(() => new STEPLoader().setOptions({ strict: true }).parse(broken), (e: unknown) => e instanceof ModelingError && /cyl/.test((e as Error).message))
  assert.equal(new STEPLoader().setOptions({ heal: false }).parse(text).children.length, 3)
  // a file of which nothing can be read
  assert.throws(() => warnings(() => new STEPLoader().parse(new STEPExporter().parse(cyl).replace(/CIRCLE\(/g, 'CLOTHOID('))), (e: unknown) => e instanceof ModelingError && /nothing in the file could be read/.test((e as Error).message))
  assert.throws(() => new STEPLoader().setOptions({ heel: true } as never), /unknown option 'heel'/)
})

test('STEPExporter: units, assemblies, empties and invisible objects', () => {
  const part = new Box(10, 20, 30)
  part.name = 'block'
  const hidden = new Box(5, 5, 5)
  hidden.visible = false
  const pivot = new THREE.Object3D()
  pivot.add(part, hidden)
  const cm = new STEPExporter().parse(pivot, { unit: 'cm' })
  assert.ok(cm.includes('.CENTI.'))
  const model = sm.fromStepModel(cm)
  assert.equal(model.bodies.length, 1) // (the invisible box left out)
  assert.equal(model.frames.length, 0) // (an unnamed empty is a pivot)
  pivot.name = 'origin'
  assert.equal(sm.fromStepModel(new STEPExporter().parse(pivot)).frames.length, 1) // (a named one a coordinate system)
  const b = model.bodies[0].bbox() // (read back in millimeters, as it lies: 10 along x, 20 along y, 30 along z)
  close(b.max.x - b.min.x, 10, 1e-9)
  close(b.max.y - b.min.y, 20, 1e-9)
  close(b.max.z - b.min.z, 30, 1e-9)
  assert.equal(sm.fromStepModel(new STEPExporter().parse(pivot, { frames: false })).frames.length, 0)
  assert.equal(sm.fromStepModel(new STEPExporter().parse(pivot, { onlyVisible: false })).bodies.length, 2)
  const assembly = new STEPExporter().parse(pivot, { assembly: true, name: 'kit' })
  assert.ok(assembly.includes("'kit'") && assembly.includes("'block'"))
  // a coordinate system in the product of a body (userData.product), and back in it
  const mcs = new THREE.Object3D()
  mcs.name = 'MCS'
  mcs.userData.product = 'block'
  pivot.add(mcs)
  const products = new STEPLoader().parse(new STEPExporter().parse(pivot, { assembly: true, name: 'kit' }))
  assert.deepEqual(products.children.filter((o) => o.name === 'MCS').map((o) => o.userData.product), ['block'])
  assert.deepEqual(products.children.filter((o) => o.name === 'origin').map((o) => o.userData.product), ['kit']) // (the pivot's: the root's)
  pivot.remove(mcs)
  assert.throws(() => new STEPExporter().parse(new THREE.Group()), /STEPExporter: nothing to write/)
  // a face, edge or vertex of a body is written where it is given, not as a highlight child
  const plate = new Box(40, 4, 30) // (a plate lying flat: its top face, towards +y, 40 by 30)
  plate.add(plate.faces().top().one())
  assert.equal(sm.fromStepModel(new STEPExporter().parse(plate)).bodies.length, 1)
  const top = sm.fromStepModel(new STEPExporter().parse(plate.faces().top()))
  assert.equal(top.bodies.length, 1)
  assert.ok(top.bodies[0] instanceof sm.Shell)
  assert.equal(sm.fromStepModel(new STEPExporter().parse(plate.edges())).curves.length, 12)
})

// ------------------------------------------------------------------------------------------- IGES
test('IGES: a solid as the file has it, in millimeters; loadAsync from a URL', async () => {
  const bytes = readFileSync(new URL('block_brep.igs', IGES))
  const group = new IGESLoader().parse(bytes)
  assert.equal(group.children.length, 1)
  const part = group.children[0] as Part
  assert.ok(part instanceof Part && part.isValid())
  close(part.volume, 4000 - Math.PI * 160, 1e-9)
  // the file's coordinates are three's: nothing turned, 10 high along the file's z, the bore along z
  unmoved(group)
  unmoved(part)
  closeBox(part.bbox(), box([-10, -10, -5], [10, 10, 5]), 1e-9)
  closeBox(part.bbox(), kernelBox(sm.fromIges(bytes)), 1e-12) // (as the kernel reads the file itself)
  close(Math.abs(part.faces().cylinders().one().axis.direction.z), 1, 1e-9)
  noKernel(group, 'group')
  // the trimmed surfaces of an inch file, stitched into the same solid
  const inch = new IGESLoader().setOptions({ heal: true, strict: true }).parse(readFileSync(new URL('block_faces_inch.igs', IGES)).toString('latin1'))
  close((inch.children[0] as Part).volume, 4000 - Math.PI * 160, 4000e-8)
  const loaded = await new IGESLoader().loadAsync(dataUrl(bytes))
  closeBox((loaded.children[0] as Part).bbox(), part.bbox(), 1e-9)
})

// -------------------------------------------------------------------------------------------- DXF
test("DXF: sketches out and in, in the XY plane: the drawing's (x, y) is three's (x, y)", () => {
  const hole = new Circle(5)
  hole.position.x = 10
  const plate = new Rectangle(40, 20).cut(hole)
  plate.name = 'plate'
  plate.position.set(5, 10, 0)
  const text = new DXFExporter().parse(plate)
  assert.ok(text.includes('plate')) // (its layer)
  // the drawing's (x, y) is three's (x, y): the hole's circle around (15, 10)
  assert.match(text, /\nCIRCLE\n[\s\S]*?\n10\n15(?:\.0*)?\n20\n10(?:\.0*)?\n30\n0(?:\.0*)?\n40\n5(?:\.0*)?\n/)
  const k = sm.fromDxf(text).bbox()
  closeVector(k.min, { x: -15, y: 0, z: 0 }, 1e-9)
  closeVector(k.max, { x: 25, y: 20, z: 0 }, 1e-9)
  // read back: a group of one sketch, in the XY plane as drawn
  const group = new DXFLoader().parse(text)
  const sketch = sketchOf(group)
  unmoved(group)
  closeBox(sketch.bbox(), box([-15, 0, 0], [25, 20, 0]), 1e-9)
  close(sketch.area, 800 - 25 * Math.PI, 1e-6)
  closeVector(sketch.plane.normal, Z, 1e-9) // (facing +z: it extrudes along +z, as THREE.ExtrudeGeometry)
  closeBox(sketch.extrude(5).bbox(), box([-15, 0, 0], [25, 20, 5]), 1e-9)
  noKernel(group, 'group')
  // every chain of curves as a wire
  const wires = new DXFLoader().setOptions({ wires: true }).parse(text)
  assert.ok(wires instanceof THREE.Group)
  assert.equal(wires.children.length, 2)
  const lengths = (wires.children as Wire[]).map((w) => (assert.ok(w instanceof Wire && w.isClosed), w.length)).sort((a, b) => a - b)
  close(lengths[0], 10 * Math.PI, 1e-9)
  close(lengths[1], 120, 1e-9)
  noKernel(wires, 'wires')
  // DXF is 2D: a sketch in front of the XY plane comes back in it
  const lifted = new Rectangle(10, 10)
  lifted.position.z = 7
  closeBox(sketchOf(new DXFLoader().parse(new DXFExporter().parse(lifted))).bbox(), box([-5, -5, 0], [5, 5, 0]), 1e-9)
  // a drawing written by hand: a circle of radius 5 around (10, 20)
  const circle = ['0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', '0', '10', '10', '20', '20', '30', '0', '40', '5', '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
  closeBox(sketchOf(new DXFLoader().parse(circle)).bbox(), box([5, 15, 0], [15, 25, 0]), 1e-9)
})

test("DXF options: layers, units, arcs, the drawing's frame; parts are passed over", () => {
  const a = new Rectangle(10, 10)
  a.name = 'A'
  const b = new Circle(3)
  b.name = 'B'
  b.position.x = 20
  const two = new DXFExporter().parse([a, b])
  close(sketchOf(new DXFLoader().setOptions({ layers: ['A'] }).parse(two)).area, 100, 1e-9)
  close(sketchOf(new DXFLoader().setOptions({ layers: 'b' }).parse(two)).area, 9 * Math.PI, 1e-9)
  close(sketchOf(new DXFLoader().parse(two)).area, 100 + 9 * Math.PI, 1e-9)
  // units: the file in centimeters reads back the same size, unless told it is millimeters
  const plate = new Rectangle(40, 20)
  const cm = new DXFExporter().parse(plate, { unit: 'cm' })
  closeBox(sketchOf(new DXFLoader().parse(cm)).bbox(), box([-20, -10, 0], [20, 10, 0]), 1e-9)
  closeBox(sketchOf(new DXFLoader().setOptions({ unit: 'mm' }).parse(cm)).bbox(), box([-2, -1, 0], [2, 1, 0]), 1e-9)
  // lines and arcs only
  const ellipse = new Ellipse(10, 5)
  const arcs = new DXFExporter().parse(ellipse, { curves: 'arcs', tolerance: 0.01 })
  assert.ok(!/\nELLIPSE\n/.test(arcs) && /\nARC\n/.test(arcs))
  close(sketchOf(new DXFLoader().parse(arcs)).area, 50 * Math.PI, 0.1)
  assert.ok(/\nELLIPSE\n/.test(new DXFExporter().parse(ellipse)))
  // a sketch turned out of the XY plane is drawn in its own plane (its own x and y), or in the frame given
  const standing = new Rectangle(20, 10)
  standing.rotation.x = Math.PI / 2 // (in the XZ plane, its y along +z)
  standing.position.y = 3
  for (const options of [{}, { frame: standing.matrixWorld }]) {
    standing.updateMatrixWorld()
    const s = sketchOf(new DXFLoader().parse(new DXFExporter().parse(standing, options)))
    close(s.area, 200, 1e-9)
    closeBox(s.bbox(), box([-10, -5, 0], [10, 5, 0]), 1e-9)
  }
  // (a frame of the XZ plane, its origin at (4, 0, 2): the drawing's (x, y) is the frame's)
  const frame = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(4, 0, 2)
  closeBox(sketchOf(new DXFLoader().parse(new DXFExporter().parse(standing, { frame }))).bbox(), box([-14, -7, 0], [6, 3, 0]), 1e-9)
  assert.throws(() => new DXFExporter().parse(standing, { frame: new THREE.Matrix4() }), /not parallel/)
  assert.throws(() => new DXFExporter().parse(new Segment(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))), /^RangeError: DXFExporter: .*parallel to XY.*pass frame:/)
  assert.throws(() => new DXFExporter().parse(standing, { frame: new THREE.Plane() as never }), /^TypeError: DXFExporter: frame .*THREE\.Matrix4/)
  assert.throws(() => new DXFExporter().parse(standing, { plane: standing.matrixWorld } as never), /unknown option 'plane'.*frame/) // (`plane` is now `frame`)
  // parts are passed over, curves are drawn
  const part = new Box(10, 10, 10)
  const line = new Segment(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 40, 0))
  const drawing = new DXFLoader().setOptions({ wires: true }).parse(new DXFExporter().parse([part, line]))
  assert.equal(drawing.children.length, 1)
  close((drawing.children[0] as Wire).length, 50, 1e-9)
  closeBox((drawing.children[0] as Wire).bbox(), box([0, 0, 0], [30, 40, 0]), 1e-9)
  assert.throws(() => new DXFExporter().parse(part), /DXFExporter: nothing to write.*drawingViews/)
  // a drawing that does not close says where, in the loader's terms
  assert.throws(() => new DXFLoader().parse(new DXFExporter().parse(line)), (e: unknown) => e instanceof ModelingError && /^DXFLoader: .*wires: true/.test((e as Error).message))
})

// -------------------------------------------------------------------------------------------- SVG
test("SVG: 2D shapes seen from +z: a sketch's (x, y) is the drawing's, in millimeters", () => {
  const plate = new Rectangle(40, 20)
  plate.position.set(25, 10, 0) // (x from 5 to 45, y from 0 to 20)
  const svg = new SVGExporter().parse(plate, { margin: 0, stroke: 0.5 })
  // true size; the drawing's y up is the SVG's -y (its y runs down)
  assert.match(svg, /width="40mm" height="20mm" viewBox="5 -20 40 20"/)
  assert.match(svg, /d="M5 0 L45 0 M45 0 L45 -20 M45 -20 L5 -20 M5 -20 L5 0"/)
  // in front of the XY plane, drawn as seen from +z
  plate.position.z = 7
  assert.equal(new SVGExporter().parse(plate, { margin: 0, stroke: 0.5 }), svg)
  // a segment from the origin to the right and up
  assert.match(new SVGExporter().parse(new Segment(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 40, 0)), { margin: 0 }), /viewBox="0 -40 30 40"[\s\S]*d="M0 0 L30 -40"/)
})

// -------------------------------------------------------------------------------------------- USD
test('USD: exact bodies out and in, a Z-up stage turned from three and turned back, named and colored', () => {
  const block = new Box(10, 30, 20) // (30 high)
  block.name = 'blk'
  block.material = new THREE.MeshStandardMaterial({ color: '#336699' })
  block.position.set(0, 15, 0) // (standing on the XZ plane)
  const pin = new Cylinder(2, 2, 50)
  pin.name = 'pin'
  pin.rotation.z = Math.PI / 2 // (lying along x)
  pin.position.set(0, 0, 40)
  const text = new USDBrepExporter().parse([block, pin])
  assert.match(text, /upAxis = "Z"/)
  assert.match(text, /metersPerUnit = 0.001/)
  // read by the kernel: three's (x, y, z) is the stage's (x, -z, y), the block's height (three's y) along z
  const k = sm.fromUsd(text) as sm.ShapeList<sm.Part>
  const kb = k.find((p) => p.name === 'blk')!.bbox()
  closeVector(kb.min, { x: -5, y: -10, z: 0 }, 1e-9)
  closeVector(kb.max, { x: 5, y: 10, z: 30 }, 1e-9)
  // read back: the bodies keep the stage's coordinates, and the group is turned to stand the stage
  // up, as three's USDLoader turns a Z-up stage
  const group = new USDBrepLoader().parse(text)
  assert.deepEqual(group.rotation.toArray(), [-Math.PI / 2, 0, 0, 'XYZ'])
  closeVector(group.position, { x: 0, y: 0, z: 0 }, 0)
  assert.deepEqual(group.children.map((o) => o.name), ['blk', 'pin'])
  const [b, p] = group.children as Part[]
  unmoved(b)
  unmoved(p)
  closeBox(b.bbox(), box([-5, -10, 0], [5, 10, 30]), 1e-9)
  closeBox(p.bbox(), box([-25, -42, -2], [25, -38, 2]), 1e-9)
  // in the world (through the group's turn): where the scene showed them
  closeBox(worldBox(b), box([-5, 0, -10], [5, 30, 10]), 1e-9)
  closeBox(worldBox(p), box([-25, -2, 38], [25, 2, 42]), 1e-9)
  assert.equal(hex(b), '336699')
  close(p.volume, Math.PI * 4 * 50, 1e-6)
  noKernel(group, 'group')
  // without placement: nothing turned, the bodies where their prims have them
  const flat = new USDBrepLoader().setOptions({ placement: false }).parse(text)
  unmoved(flat)
  closeBox(worldBox(flat.children[0]), box([-5, -10, 0], [5, 10, 30]), 1e-9)
})

test('USD: USDBrepLoader gives what USDBrepExporter wrote where the scene showed it; a Y-up stage stands as written', () => {
  // any placement: through the group's turn, the same world coordinates
  const part = new Box(10, 30, 20).cut(new Cylinder(3, 3, 40))
  part.position.set(5, 15, -10)
  part.rotation.set(0.3, 0, 0.2)
  const scene = new THREE.Group()
  scene.position.set(0, 2, 0)
  scene.rotation.y = Math.PI / 6
  scene.add(part)
  const group = new USDBrepLoader().parse(new USDBrepExporter().parse(scene, { mesh: false }))
  const body = group.children[0] as Part
  closeBox(worldBox(body), worldBox(part), 1e-9)
  closeVector(body.getCenter().applyMatrix4(body.matrixWorld), part.getCenter().applyMatrix4(part.matrixWorld), 1e-9)
  close(body.volume, part.volume, 1e-6)
  // a stage written Y up: one of the kernel's (which writes its coordinates as they are, Z up), its
  // upAxis set to "Y" by hand, with a block 30 high along y, standing on y = 0
  const written = sm.toUsd(sm.Box(10, 30, 20, { align: ['center', 'min', 'center'] }), { mesh: false })
  const yUp = written.replace('upAxis = "Z"', 'upAxis = "Y"')
  assert.match(yUp, /upAxis = "Y"/)
  closeBox(kernelBox(sm.fromUsd(yUp, { placement: false })), box([-5, 0, -10], [5, 30, 10]), 1e-9) // (the numbers it holds)
  // (as three's USDLoader: a Y-up stage is not turned, and its bodies keep the stage's coordinates)
  const yGroup = new USDBrepLoader().parse(yUp)
  assert.equal(yGroup.rotation.x, 0)
  closeBox((yGroup.children[0] as Part).bbox(), box([-5, 0, -10], [5, 30, 10]), 1e-9)
  closeBox(worldBox(yGroup), box([-5, 0, -10], [5, 30, 10]), 1e-9)
  // (the same numbers Z up: the bodies keep them, and the group is turned: the stage's y along
  // three's -z, its z up)
  const zGroup = new USDBrepLoader().parse(written)
  assert.equal(zGroup.rotation.x, -Math.PI / 2)
  closeBox((zGroup.children[0] as Part).bbox(), box([-5, 0, -10], [5, 30, 10]), 1e-9)
  closeBox(worldBox(zGroup), box([-5, -10, -30], [5, 10, 0]), 1e-9)
})

test('USD options: meshes, angles in radians, materials, units, layers', async () => {
  const ball = new Ball(10)
  const fine = new USDBrepExporter().parse(ball, { angle: Math.PI / 36 })
  const coarse = new USDBrepExporter().parse(ball, { angle: Math.PI / 6 })
  const exact = new USDBrepExporter().parse(ball, { mesh: false })
  assert.ok(fine.length > coarse.length && coarse.length > exact.length)
  assert.ok(!/def Mesh/.test(exact) && /def Mesh/.test(coarse))
  assert.match(new USDBrepExporter().parse(ball, { materials: true }), /UsdPreviewSurface/)
  const block = new Box(10, 20, 30)
  block.name = 'blk'
  const parts = new USDBrepExporter().parse(block)
  // (a stage read as centimeters: ten times the block, where it was)
  closeBox(worldBox(new USDBrepLoader().setOptions({ units: 'cm' }).parse(parts)), box([-50, -100, -150], [50, 100, 150]), 1e-9)
  // a stage of layers: given by `resolve`, or loaded relative to the file's URL
  const stage = '#usda 1.0\n(\n    subLayers = [\n        @./layers/parts.usda@\n    ]\n)\n'
  const asked: string[][] = []
  const resolve = (asset: string, from: string) => (asked.push([asset, from]), asset === './layers/parts.usda' ? parts : null)
  const viaResolve = new USDBrepLoader().setOptions({ resolve }).parse(stage)
  assert.deepEqual(asked, [['./layers/parts.usda', '']])
  assert.equal(viaResolve.children[0].name, 'blk')
  const files: Record<string, string> = { 'models/stage.usda': stage, 'models/layers/parts.usda': parts }
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => (url in files ? dataUrl(files[url], 'text/plain') : url))
  const loaded = await new USDBrepLoader(manager).loadAsync('models/stage.usda')
  assert.equal(loaded.children.length, 1)
  assert.equal(loaded.children[0].name, 'blk')
  // (its root layer says no upAxis, so USD's fallback, Y up, holds: as three's USDLoader, the group is
  // not turned, and the block lies in the stage's coordinates, as the Z-up layer has it)
  assert.equal(loaded.rotation.x, 0)
  closeBox(worldBox(loaded), box([-5, -15, -10], [5, 15, 10]), 1e-9)
  // without them: the stage's own bodies, and a warning that names the layer
  const alone = `${parts.slice(0, parts.indexOf('\n'))}\n(\n    subLayers = [\n        @missing.usda@\n    ]\n)\n${parts.slice(parts.indexOf('def Xform'))}`
  let partial!: THREE.Group
  const warned = warnings(() => {
    partial = new USDBrepLoader().parse(alone)
  })
  assert.equal(partial.children.length, 1)
  assert.ok(warned.some((w) => /missing\.usda/.test(w)))
  assert.throws(() => new USDBrepLoader().parse(stage), /USDBrepLoader: |no BrepArray/)
})

// ------------------------------------------------------------------------------------------- BREP
test('BREP: OpenCASCADE bodies out and in, where the scene shows them', async () => {
  const block = new Box(10, 20, 30)
  block.position.set(5, 0, 0)
  const ball = new Ball(5)
  ball.position.set(30, 0, 0)
  const group = new THREE.Group()
  group.rotation.y = Math.PI / 2 // (turned: +x goes to -z)
  group.add(block, ball)
  const text = new BREPExporter().parse(group)
  closeBox(kernelBox(sm.fromBrep(text)), worldBox(group), 1e-6) // (three's coordinates, as the kernel reads them)
  const read = new BREPLoader().setOptions({ check: true }).parse(text)
  assert.equal(read.children.length, 2)
  unmoved(read)
  const [b, s] = read.children as Part[]
  closeBox(b.bbox(), box([-15, -10, -10], [15, 10, 0]), 1e-6)
  closeBox(s.bbox(), box([-5, -5, -35], [5, 5, -25]), 1e-6)
  close(s.volume, (4 / 3) * Math.PI * 125, 1e-3)
  assert.equal(b.name, '')
  const loaded = await new BREPLoader().loadAsync(dataUrl(text))
  closeBox((loaded.children[1] as Part).bbox(), s.bbox(), 1e-9)
  noKernel(read, 'group')
})

// ------------------------------------------------------------------------------------------ SMLib
test('SMB: one body, exact, ASCII or binary', async () => {
  const part = new Box(10, 20, 30).cut(new Cylinder(3, 3, 40)) // (bored along y)
  part.rotation.x = Math.PI / 2 // (lying: its y, and its bore, along z)
  part.position.y = 15
  for (const ascii of [true, false]) {
    const bytes = new SMBExporter().parse(part, { ascii })
    assert.ok(bytes instanceof Uint8Array)
    closeBox(kernelBox(sm.fromSmb(bytes)), worldBox(part), 1e-9) // (three's coordinates, as the kernel reads them)
    const body = new SMBLoader().parse(bytes)
    assert.ok(body instanceof Part)
    unmoved(body)
    closeBox(body.bbox(), new THREE.Box3().setFromObject(part, true), 1e-6)
    close(body.volume, part.volume, 1e-6)
  }
  const loaded = await new SMBLoader().loadAsync(dataUrl(new SMBExporter().parse(part)))
  close((loaded as Part).volume, part.volume, 1e-6)
  noKernel(loaded, 'body')
  assert.throws(() => new SMBExporter().parse([part, new Box(1, 1, 1)]), /SMBExporter: an \.smb file holds one body, not 2/)
})

test('SMP: bodies with names and colors, and curves, in order', async () => {
  const block = new Box(10, 20, 30)
  block.name = 'blk'
  block.material = new THREE.MeshStandardMaterial({ color: '#336699' })
  block.position.x = -20
  const edge = new Segment(new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 5, 5))
  const wire = new Polyline([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 1, 0)])
  const sketch = new Rectangle(3, 4)
  sketch.name = 'sk'
  sketch.position.z = 10
  const bytes = new SMPExporter().parse([block, edge, wire, sketch])
  const group = await new SMPLoader().loadAsync(dataUrl(bytes))
  unmoved(group)
  const [b, e, w, s] = group.children
  assert.ok(b instanceof Part && e instanceof BrepEdge && w instanceof Wire && s instanceof Shell)
  assert.equal(b.name, 'blk')
  assert.equal(hex(b), '336699')
  closeBox(b.bbox(), box([-25, -10, -15], [-15, 10, 15]), 1e-9)
  closeVector(e.end, { x: 5, y: 5, z: 5 }, 1e-9)
  close(w.length, 2, 1e-9)
  assert.equal(s.name, 'sk')
  closeBox(s.bbox(), box([-1.5, -2, 10], [1.5, 2, 10]), 1e-9)
  noKernel(group, 'group')
  assert.equal(new SMPLoader().parse(new SMPExporter().parse(block, { ascii: false })).children.length, 1)
})

// ----------------------------------------------------------------------------------------- loaders
test('loaders load as three loaders load: loadAsync from data: URLs, errors through onError', async () => {
  const part = new Box(10, 20, 30)
  part.name = 'p'
  const urls: [THREE.Loader<unknown>, string][] = [
    [new STEPLoader(), dataUrl(new STEPExporter().parse(part))],
    [new USDBrepLoader(), dataUrl(new USDBrepExporter().parse(part))],
    [new BREPLoader(), dataUrl(new BREPExporter().parse(part))],
    [new SMPLoader(), dataUrl(new SMPExporter().parse(part))],
    [new DXFLoader(), dataUrl(new DXFExporter().parse(new Rectangle(10, 30)))],
  ]
  for (const [loader, url] of urls) {
    const result = (await loader.loadAsync(url)) as THREE.Object3D
    assert.ok(result instanceof THREE.Group, loader.constructor.name)
    assert.ok(result.children[0] instanceof Body, loader.constructor.name)
    // (where the part was in the world; the sketch in the XY plane)
    closeBox(worldBox(result), loader instanceof DXFLoader ? box([-5, -15, 0], [5, 15, 0]) : box([-5, -10, -15], [5, 10, 15]), 1e-9, loader.constructor.name)
    noKernel(result, loader.constructor.name)
  }
  // a file that is not one: the loader's onError, with the package's message
  const error = await new Promise((resolve) => new STEPLoader().load(dataUrl('not a step file'), () => resolve(null), undefined, resolve))
  assert.ok(error instanceof Error, String(error))
  await assert.rejects(new SMBLoader().loadAsync(dataUrl('nothing')))
})
