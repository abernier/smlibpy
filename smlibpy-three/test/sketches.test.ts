// Sketches: smlibpy's 2D shapes, Stroke, Hull, makeFace, Text and the Profile pen, lying on the
// ground (three's XZ plane) in their own 2D coordinates, x along x and y along -z, read from above;
// and the fonts Text draws with.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Box, ModelingError, Sketch, Wire } from '../src/index.ts'
import { CenterArc, Line, Polyline, Spline } from '../src/curves.ts'
import {
  ArcSlot,
  Circle,
  Ellipse,
  Hull,
  makeFace,
  Polygon,
  Rectangle,
  RegularPolygon,
  RoundedRectangle,
  Slot,
  Stroke,
  Text,
  Trapezoid,
  Triangle,
} from '../src/sketches.ts'
import { Profile } from '../src/profiles.ts'
import { DEFAULT_FONT, Font, FontError, loadFont } from '../src/font.ts'
import { box, close, closeBox, closeVector, Y } from './_util.ts'

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

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const P = (x: number, y: number) => new THREE.Vector2(x, y)
const DATA = join(import.meta.dirname, '..', '..', 'tests', 'data')
const QUAD = new Uint8Array(readFileSync(join(DATA, 'test-quadratic.ttf'))) // cap height 700: at size 700 a font unit is one unit
const CUBIC = new Uint8Array(readFileSync(join(DATA, 'test-cubic.otf')))

/** The points of a sketch's corners, in three's coordinates. */
const corners = (s: Sketch) => s.vertices().map((v) => v.point)

test('shapes lie on the ground, read from above: their areas and boxes', () => {
  const h = 10 * Math.sin(Math.PI / 3) // (a hexagon's half height)
  const table: [Sketch, number, THREE.Box3][] = [
    [new Rectangle(20, 10), 200, box([-10, 0, -5], [10, 0, 5])],
    [new Rectangle(20, 10, { fillet: 2 }), 200 - (4 - Math.PI) * 4, box([-10, 0, -5], [10, 0, 5])],
    [new Rectangle(20, 10, { chamfer: 2 }), 200 - 8, box([-10, 0, -5], [10, 0, 5])],
    [new Rectangle(20, 10, { rotation: Math.PI / 2 }), 200, box([-5, 0, -10], [5, 0, 10])],
    [new Rectangle(20, 10, { rotation: Math.PI / 6 }), 200, box([-(10 * Math.cos(Math.PI / 6) + 2.5), 0, -(5 + 5 * Math.cos(Math.PI / 6))], [10 * Math.cos(Math.PI / 6) + 2.5, 0, 5 + 5 * Math.cos(Math.PI / 6)])],
    // the sketch's y runs along -z: its 'max' side at the origin puts it on +z
    [new Rectangle(20, 10, { align: { x: 'min', y: 'max' } }), 200, box([0, 0, 0], [20, 0, 10])],
    [new RoundedRectangle(20, 10, 2), 200 - (4 - Math.PI) * 4, box([-10, 0, -5], [10, 0, 5])],
    [new Circle(5), 25 * Math.PI, box([-5, 0, -5], [5, 0, 5])],
    [new Circle(5, { align: 'min' }), 25 * Math.PI, box([0, 0, -10], [10, 0, 0])],
    [new Ellipse(10, 5), 50 * Math.PI, box([-10, 0, -5], [10, 0, 5])],
    [new Ellipse(10, 5, { rotation: Math.PI / 2 }), 50 * Math.PI, box([-5, 0, -10], [5, 0, 10])],
    [new Polygon([P(0, 0), P(10, 0), P(0, 10)]), 50, box([0, 0, -10], [10, 0, 0])],
    [new Polygon([P(0, 0), P(10, 0), P(0, 10)], { align: 'center' }), 50, box([-5, 0, -5], [5, 0, 5])],
    [new Polygon([P(0, 0), P(10, 0), { x: 10, y: 10 }, P(0, 10)], { fillet: 2 }), 100 - (4 - Math.PI) * 4, box([0, 0, -10], [10, 0, 0])],
    [new RegularPolygon(10, 6), 1.5 * Math.sqrt(3) * 100, box([-10, 0, -h], [10, 0, h])],
    [new RegularPolygon(10, 6, { inscribed: true }), 2 * Math.sqrt(3) * 100, box([-10 / Math.cos(Math.PI / 6), 0, -10], [10 / Math.cos(Math.PI / 6), 0, 10])],
    [new Triangle(40, 20), 400, box([-20, 0, -10], [20, 0, 10])],
    [new Triangle(40, 20, { apex: 0 }), 400, box([-20, 0, -10], [20, 0, 10])],
    [new Trapezoid(40, 15, Math.PI / 3), ((80 - 30 / Math.tan(Math.PI / 3)) / 2) * 15, box([-20, 0, -7.5], [20, 0, 7.5])],
    [new Trapezoid(40, 15, Math.PI / 3, Math.PI / 4), ((80 - 15 / Math.tan(Math.PI / 3) - 15) / 2) * 15, box([-20, 0, -7.5], [20, 0, 7.5])],
    // (the options may follow the left angle; a chamfer c at a corner of angle a cuts c² sin(a) / 2)
    [new Trapezoid(40, 15, Math.PI / 3, { chamfer: 1 }), ((80 - 30 / Math.tan(Math.PI / 3)) / 2) * 15 - 2 * Math.sin(Math.PI / 3), box([-19.5, 0, -7.5], [19.5, 0, 7.5])],
    [new Slot(30, 10), 200 + 25 * Math.PI, box([-15, 0, -5], [15, 0, 5])],
    [new ArcSlot(40, 6, Math.PI / 3), 80 * Math.PI + 9 * Math.PI, box([17, 0, -(40 * Math.sin(Math.PI / 3) + 3)], [43, 0, 3])],
  ]
  for (const [sketch, area, bounds] of table) {
    const what = `${sketch.constructor.name}(${JSON.stringify((sketch as { parameters?: object }).parameters)})`
    assert.ok(sketch instanceof Sketch && sketch instanceof THREE.Mesh, what)
    close(sketch.area, area, 1e-9 * area, what)
    closeBox(sketch.bbox(), bounds, 1e-9, what)
    closeVector(sketch.plane.normal, Y, 1e-12, what)
  }
  // turned counterclockwise seen from above: the apex of a right triangle from (-20, 10) to (-10, -20)
  const turned = new Triangle(40, 20, { apex: 0, rotation: Math.PI / 2 })
  for (const expected of [V(10, 0, 20), V(10, 0, -20), V(-10, 0, 20)]) {
    assert.ok(corners(turned).some((p) => p.distanceTo(expected) < 1e-9), `a corner at (${expected.x}, ${expected.z})`)
  }
  // an arc slot from +x towards -z, turned on by its rotation
  const slot = new ArcSlot(40, 6, Math.PI / 3, { rotation: Math.PI / 2 })
  closeBox(slot.bbox(), box([-(40 * Math.sin(Math.PI / 3) + 3), 0, -43], [3, 0, -17]), 1e-9)
  // three's points (THREE.Vector3s) on the ground, where the sketch is drawn
  const ground = new Polygon([V(0, 0, 0), V(10, 0, 0), V(0, 0, -10)])
  close(ground.area, 50, 1e-9)
  closeBox(ground.bbox(), box([0, 0, -10], [10, 0, 0]), 1e-9)
  close(new Polygon([V(0, 0, 0), V(10, 0, 0), V(0, 0, -10)], { fillet: 1 }).area, new Polygon([P(0, 0), P(10, 0), P(0, 10)], { fillet: 1 }).area, 1e-9)
  assert.throws(() => new Polygon([V(0, 0, 0), V(10, 0, 0), V(0, 10, 0)]), (e) => e instanceof RangeError && /\(0, 10, 0\) is off the ground/.test(e.message))
  assert.throws(() => new ArcSlot(40, 6, 2 * Math.PI), RangeError)
  assert.throws(() => new Trapezoid(10, 15, Math.PI / 4), (e) => e instanceof RangeError && /cross/.test(e.message))
})

test('Stroke: the region a pen covers along a curve, where the curve is', () => {
  const line = new Line(V(0, 0, 0), V(30, 0, 0))
  const slot = new Stroke(line, 6)
  close(slot.area, 180 + 9 * Math.PI, 1e-9)
  closeBox(slot.bbox(), box([-3, 0, -3], [33, 0, 3]), 1e-9)
  assert.equal(slot.parameters.path, line)
  const flat = new Stroke(line, 6, { ends: 'flat' })
  close(flat.area, 180, 1e-9)
  closeBox(flat.bbox(), box([0, 0, -3], [30, 0, 3]), 1e-9)
  // a rib along a bent centerline, its outside corner sharp; a groove along a spline; a ring
  const rib = new Stroke(new Polyline([V(0, 0, 0), V(30, 0, 0), V(30, 0, -20)]), 4, { ends: 'flat', corners: 'sharp' })
  close(rib.area, 32 * 4 + 4 * 18, 1e-9)
  closeBox(rib.bbox(), box([0, 0, -20], [32, 0, 2]), 1e-9)
  close(new Stroke(new Spline([V(0, 0, 0), V(20, 0, -8), V(40, 0, 0)]), 4).area, 188.283, 1e-3)
  close(new Stroke(new CenterArc(V(0, 0, 0), 10), 2).area, Math.PI * (11 ** 2 - 9 ** 2), 1e-9)
  // three's own curves (in the stroke's frame) are paths too
  close(new Stroke(new THREE.LineCurve3(V(0, 0, 0), V(30, 0, 0)), 6).area, 180 + 9 * Math.PI, 1e-9)
  // the path where it is: moved up, turned upright
  const lifted = new Line(V(0, 0, 0), V(30, 0, 0))
  lifted.position.set(5, 3, 0)
  closeBox(new Stroke(lifted, 6).bbox(), box([2, 3, -3], [38, 3, 3]), 1e-9)
  const arc = new CenterArc(V(0, 0, 0), 10, 0, Math.PI / 2)
  arc.rotation.x = Math.PI / 2
  arc.updateMatrixWorld()
  const upright = new Stroke(arc, 2)
  close(upright.area, 10 * Math.PI + Math.PI, 1e-9)
  closeBox(upright.bbox(), box([-1, -1, 0], [11, 11, 0]), 1e-9)
  close(Math.abs(upright.plane.normal.z), 1, 1e-12)
})

test('Hull: the convex outline around points and shapes, where they are', () => {
  // a lever: two circles and the tangents between them (arcs exactly)
  const small = new Circle(6)
  small.position.x = 60
  const lever = new Hull(new Circle(10), small)
  const [R, r, d] = [10, 6, 60]
  const a = Math.asin((R - r) / d)
  close(lever.area, (R * R * (Math.PI + 2 * a)) / 2 + (r * r * (Math.PI - 2 * a)) / 2 + (R + r) * Math.sqrt(d * d - (R - r) ** 2), 1e-9)
  closeBox(lever.bbox(), box([-10, 0, -10], [66, 0, 10]), 1e-9)
  assert.ok(lever.edges().some((e) => e.geomType === 'circle'))
  // points: THREE.Vector2s ({ x, y }) of the sketch's coordinates, THREE.Vector3s of three's
  const square = new Hull(P(0, 0), P(10, 0), { x: 0, y: 10 }, V(10, 0, -10), P(5, 5))
  close(square.area, 100, 1e-9)
  closeBox(square.bbox(), box([0, 0, -10], [10, 0, 0]), 1e-9)
  assert.throws(() => new Hull(P(0, 0), P(10, 0), V(5, 3, -5)), (e) => e instanceof RangeError && /\(5, 3, -5\) is not in the plane/.test(e.message))
  // vertices, edges and faces where they are (and lists of them)
  const rect = new Rectangle(10, 10)
  close(new Hull(rect.vertices(), P(20, 0)).area, 100 + 75, 1e-9)
  rect.position.x = 100
  close(new Hull(rect.vertices(), P(20, 0)).area, 100 + 0.5 * 10 * 75, 1e-9)
  const top = new Box(10, 10, 10, { align: { y: 'max' } }).faces().top().one()
  close(new Hull(top, P(20, 0)).area, 175, 1e-9)
  close(new Hull([new Line(V(0, 0, 0), V(10, 0, 0)), [new Line(V(0, 0, -10), V(10, 0, -10))]]).area, 100, 1e-9)
  assert.throws(() => new Hull(new Box(1, 1, 1) as never, P(5, 0)), (e) => e instanceof TypeError && /section/.test(e.message))
  // in the plane of the first sketch: here 7 up
  const c1 = new Circle(5)
  c1.position.y = 7
  const c2 = new Circle(3)
  c2.position.set(20, 7, 0)
  const raised = new Hull(c1, c2)
  closeBox(raised.bbox(), box([-5, 7, -5], [23, 7, 5]), 1e-9)
  const b = Math.asin(2 / 20)
  close(raised.area, (25 * (Math.PI + 2 * b)) / 2 + (9 * (Math.PI - 2 * b)) / 2 + 8 * Math.sqrt(400 - 4), 1e-9)
})

test('makeFace: closed curves made a region, placed as the outer curve', () => {
  const outline = () => new Polyline([V(0, 0, 0), V(20, 0, 0), V(20, 0, -10), V(0, 0, -10)], { close: true })
  const plate = makeFace(outline(), new CenterArc(V(10, 0, -5), 2))
  assert.ok(plate instanceof Sketch)
  close(plate.area, 200 - 4 * Math.PI, 1e-9)
  closeBox(plate.bbox(), box([0, 0, -10], [20, 0, 0]), 1e-9)
  // the result is in the outer curve's frame, with its transform; holes are taken where they are
  const outer = outline()
  outer.position.set(0, 5, 0)
  const hole = new CenterArc(V(10, 0, -5), 2)
  hole.position.set(3, 5, 0)
  const raised = makeFace(outer, hole)
  closeVector(raised.position, V(0, 5, 0), 0)
  closeBox(raised.bbox(), box([0, 0, -10], [20, 0, 0]), 1e-9)
  close(raised.area, 200 - 4 * Math.PI, 1e-9)
  const circle = raised.edges().find((e) => e.geomType === 'circle')!
  closeVector(circle.arcCenter, V(13, 0, -5), 1e-9)
  // an edge is an outline too; a face's outline makes a region of its body's frame and place
  close(makeFace(new CenterArc(V(0, 0, 0), 5)).area, 25 * Math.PI, 1e-9)
  const part = new Box(10, 10, 10)
  part.position.x = 50
  const top = makeFace(part.faces().top().one().outerWire())
  closeVector(top.position, V(50, 0, 0), 0)
  closeBox(top.bbox(), box([-5, 5, -5], [5, 5, 5]), 1e-9)
  close(top.area, 100, 1e-9)
  assert.throws(() => makeFace(new Rectangle(2, 2) as never), TypeError)
})

test('Text: a font of the repository, lines and alignment, lying on the ground', () => {
  // at size 700 one unit of the test font is one unit: its H spans 50..650 and 0..700
  const font = loadFont(QUAD)
  const h = new Text('H', 700, { font, align: null })
  close(h.area, 600 * 700, 1e-6)
  closeBox(h.bbox(), box([50, 0, -700], [650, 0, 0]), 1e-9)
  closeVector(h.plane.normal, Y, 1e-12)
  // the font as bytes; kerning (H O: -50), spacing, lines below each other
  closeBox(new Text('HO', 700, { font: QUAD, align: 'min' }).bbox(), box([50, 0, -700], [700 - 50 + 650, 0, 0]), 1e-9)
  close(new Text('HO', 700, { font: QUAD, align: 'min', kerning: false }).bbox().max.x, 700 + 650, 1e-9)
  close(new Text('HO', 700, { font: QUAD, align: 'min', spacing: 10 }).bbox().max.x, 700 - 50 + 10 + 650, 1e-9)
  closeBox(new Text('HH\nH', 700, { font, align: 'min', lineSpacing: 1.5 }).bbox(), box([50, 0, -(1.5 * 700 + 700)], [1350, 0, 0]), 1e-9)
  // the default font: the size is the height of the capitals, centered
  const label = new Text('H', 10).bbox()
  closeBox(label, box([label.min.x, 0, -5], [label.max.x, 0, 5]), 1e-9)
  assert.ok(label.min.x < -3 && label.max.x > 3)
  assert.equal(new Text('i', 10).faces().length, 2)
  const o = new Text('O', 10) // (one face, its counter a hole: two closed B-splines)
  assert.equal(o.faces().length, 1)
  assert.deepEqual(Array.from(o.edges(), (e) => e.geomType), ['bspline', 'bspline'])
  // cubic outlines (CFF)
  close(new Text('H', 700, { font: CUBIC, align: null }).area, 600 * 700, 1e-6)
  // a character the font lacks, a font that is none
  assert.throws(() => new Text('ж', 5), (e) => e instanceof RangeError && /U\+0436/.test(e.message))
  assert.throws(() => new Text('A', 5, { font: new Uint8Array(8) }), (e) => e instanceof FontError && e instanceof RangeError && !(e instanceof sm.FontError))
})

test('Text along a path: upright letters on a curve on the ground, where the curve is', () => {
  // over the top of a circle, clockwise seen from above: the letters stand outside it
  const arc = new CenterArc(V(0, 0, 0), 30, Math.PI, -Math.PI)
  const along = new Text('H', 4, { path: arc, align: 'center' })
  const straight = new Text('H', 4)
  closeBox(along.bbox(), box([straight.bbox().min.x, 0, -32], [straight.bbox().max.x, 0, -28]), 1e-9)
  close(along.area, straight.area, 1e-9) // (placed, not bent)
  close(new Text('SMLIB', 4, { path: arc }).area, new Text('SMLIB', 4).area, 1e-9)
  assert.equal(along.parameters.path, arc)
  // the path where it is
  arc.position.x = 10
  closeBox(new Text('H', 4, { path: arc, align: 'center' }).bbox(), box([straight.bbox().min.x + 10, 0, -32], [straight.bbox().max.x + 10, 0, -28]), 1e-9)
  // counterclockwise: inside the circle, the baseline on it
  const under = new Text('H', 4, { path: new CenterArc(V(0, 0, 0), 30, Math.PI, Math.PI), align: { x: 'center', y: 'min' } })
  closeBox(under.bbox(), box([straight.bbox().min.x, 0, 26], [straight.bbox().max.x, 0, 30]), 1e-9)
  // a path off the ground, a text longer than its path
  arc.position.set(0, 2, 0)
  assert.throws(() => new Text('H', 4, { path: arc }), (e) => e instanceof RangeError && /ground/.test(e.message))
  assert.throws(() => new Text('A LONG TEXT ON A SHORT ARC', 10, { path: new CenterArc(V(0, 0, 0), 5, 0, 1) }), (e) => e instanceof RangeError && /path only/.test(e.message))
})

test('Profile: lines, arcs, fillets, chamfers and mirrors in the sketch coordinates', () => {
  // a rectangle with one corner rounded: exactly the rectangle less (1 - π/4) r²
  const rounded = new Profile().lineTo(20, 0).lineTo({ y: 10 }).fillet(2).lineTo({ x: 0 }).close()
  assert.ok(rounded instanceof Sketch)
  close(rounded.area, 200 - (1 - Math.PI / 4) * 4, 1e-9)
  closeBox(rounded.bbox(), box([0, 0, -10], [20, 0, 0]), 1e-9)
  // a U-turn (π radians to the left) and a tangent arc to a point: half a circle more
  close(new Profile().lineTo(20, 0).arc(5, Math.PI).lineTo({ x: 0 }).close().area, 200 + (25 * Math.PI) / 2, 1e-9)
  close(new Profile().lineTo(20, 0).arcTo(20, 10).lineTo({ x: 0 }).close().area, 200 + (25 * Math.PI) / 2, 1e-9)
  close(new Profile().lineTo(20, 0).arcTo(0, 0, { through: P(10, 10) }).close().area, 50 * Math.PI, 1e-9)
  close(new Profile().lineTo(P(20, 0)).arcTo(P(0, 0), { through: P(10, 10) }).close().area, 50 * Math.PI, 1e-9)
  close(new Profile().lineTo(20, 0).lineTo({ y: 10 }).chamfer(2).lineTo({ x: 0 }).close().area, 200 - 2, 1e-9)
  // turns and moves along the heading (radians, counterclockwise seen from above)
  const square = new Profile().forward(10).turn(Math.PI / 2).forward(10).turn(Math.PI / 2).forward(10)
  close(square.heading, Math.PI, 1e-12)
  close(square.close().area, 100, 1e-9)
  close(new Profile().lineBy(10, 0).lineBy(P(0, 10)).lineBy(-10, 0).close().area, 100, 1e-9)
  const diagonal = new Profile({ heading: Math.PI / 4 }).forward({ x: 10 })
  assert.ok(diagonal.point instanceof THREE.Vector2)
  closeVector({ ...diagonal.point, z: 0 }, { x: 10, y: 10, z: 0 }, 1e-9)
  close(new Profile().turnTo(-Math.PI / 2).heading, -Math.PI / 2, 1e-12)
  // three's points on the ground (their -z the sketch's y), not off it
  close(new Profile(V(0, 0, 0)).lineTo(V(20, 0, 0)).lineTo(V(20, 0, -10)).lineTo(V(0, 0, -10)).close().area, 200, 1e-9)
  assert.throws(() => new Profile().lineTo(V(20, 5, 0)), (e) => e instanceof RangeError && /ground/.test(e.message))
  const started = new Profile(P(3, 4), { heading: Math.PI / 2 }).forward(6)
  closeVector({ ...started.start, z: 0 }, { x: 3, y: 4, z: 0 }, 0)
  closeVector({ ...started.point, z: 0 }, { x: 3, y: 10, z: 0 }, 1e-9)
  // half a bracket mirrored about the sketch's y axis: the fillet of the half on both halves
  const half = new Profile(P(0, 0)).lineTo(30, 0).lineTo({ y: 6 }).lineTo({ x: 10 }).fillet(4).lineTo({ y: 30 }).arc(10, Math.PI / 2)
  assert.equal(half.length, 5)
  close(half.heading, Math.PI, 1e-12)
  const bracket = half.mirror(P(0, 0), P(0, 1)).close()
  close(bracket.area, 2 * (30 * 6 + 10 * 24 + 25 * Math.PI + (1 - Math.PI / 4) * 16), 1e-9)
  closeBox(bracket.bbox(), box([-30, 0, -40], [30, 0, 0]), 1e-9)
  // every call is a new Profile: one drawing branches
  const base = new Profile().lineTo(20, 0).lineTo(20, 10)
  close(base.lineTo(0, 10).close().area, 200, 1e-9)
  close(base.arcTo(0, 10).close().area, 200 + 50 * Math.PI, 1e-9)
  assert.equal(base.length, 2)
  close(base.heading, Math.PI / 2, 1e-12)
  closeBox(base.lineTo(0, 10).close({ align: 'center' }).bbox(), box([-10, 0, -5], [10, 0, 5]), 1e-9)
  // the open path: a wire on the ground
  const path = new Profile().lineTo(20, 0).fillet(5).lineTo(20, 20).wire()
  assert.ok(path instanceof Wire)
  assert.deepEqual(Array.from(path.edges(), (e) => e.geomType), ['line', 'circle', 'line'])
  close(path.length, 30 + 2.5 * Math.PI, 1e-9)
  closeVector(path.pointAt(1), V(20, 0, -20), 1e-9)
  // errors name the call that drew the segment, and are the package's
  assert.throws(() => new Profile().lineTo(10, 0).fillet(20).lineTo(10, 10).lineTo(0, 10).close(), (e) => e instanceof ModelingError && /fillet\(20\)/.test(e.message))
  assert.throws(() => new Profile().close(), RangeError)
})

test('fonts: metrics, kerning and outlines (THREE.Vector2s), read once', () => {
  // the built-in Lato Regular
  const lato = loadFont()
  assert.ok(DEFAULT_FONT instanceof Uint8Array)
  assert.equal(loadFont(DEFAULT_FONT), lato)
  assert.equal(loadFont(), lato)
  assert.equal(lato.name, 'Lato Regular')
  assert.deepEqual([lato.unitsPerEm, lato.numGlyphs, lato.capHeight, lato.path], [2000, 277, 1433, null])
  const g = (c: string) => lato.glyphIndex(c)!
  assert.deepEqual([...'AVH '].map((c) => lato.advance(g(c))), [1360, 1360, 1512, 386])
  assert.equal(lato.kerningSource, 'GPOS')
  const av = lato.kerning(g('A'), g('V'))
  assert.equal(Object.getPrototypeOf(av), Object.prototype)
  assert.deepEqual(av, { advance1: -136, placement1: 0, advance2: 0, placement2: 0 })
  assert.equal(lato.glyphIndex('ж'), null)
  assert.ok(lato.characters().includes('Ø'))
  // a test font: its H is one contour of four lines, in font units with y up
  const quad = loadFont(QUAD)
  assert.equal(loadFont(QUAD), quad)
  assert.deepEqual([quad.name, quad.unitsPerEm, quad.numGlyphs, quad.capHeight, quad.kerningSource], ['Smlibpy Test Quadratic', 1000, 11, 700, 'kern'])
  assert.equal(quad.kerning(quad.glyphIndex('H')!, quad.glyphIndex('O')!).advance1, -50)
  const [contour, ...more] = quad.outline(quad.glyphIndex('H')!)
  assert.equal(more.length, 0)
  assert.equal(contour.length, 4)
  for (const segment of contour) for (const p of segment) assert.ok(p instanceof THREE.Vector2)
  assert.deepEqual(contour.map((s) => s.map((p) => [p.x, p.y])), [[[50, 0], [50, 700]], [[50, 700], [650, 700]], [[650, 700], [650, 0]], [[650, 0], [50, 0]]])
  // a THREE.Shape of the outline: three's area, the text's
  const shape = new THREE.Shape(contour.map((s) => s[0]))
  close(Math.abs(THREE.ShapeUtils.area(shape.getPoints())), new Text('H', 700, { font: quad }).area, 1e-6)
  assert.equal(quad.outline(quad.glyphIndex(' ')!).length, 0)
  // cubic Béziers in a CFF font, the same font from a WOFF2 file and from a path (Node)
  const cubic = new Font(CUBIC)
  assert.ok(cubic.outline(cubic.glyphIndex('O')!).flat().some((s) => s.length === 4))
  assert.notEqual(new Font(CUBIC), cubic) // (a new font each time; loadFont keeps them)
  const woff2 = loadFont(new Uint8Array(readFileSync(join(DATA, 'test-quadratic.woff2'))))
  assert.deepEqual(woff2.outline(woff2.glyphIndex('R')!), quad.outline(quad.glyphIndex('R')!))
  const file = loadFont(join(DATA, 'test-quadratic.ttf'))
  assert.ok(file.path?.endsWith('test-quadratic.ttf'))
  assert.equal(String(file), 'Font("Smlibpy Test Quadratic", 11 glyphs, 1000 units per em)')
  // data that is no font: the package's FontError, a RangeError
  assert.throws(() => new Font(new Uint8Array(20)), (e) => e instanceof FontError && e instanceof RangeError && e.name === 'FontError' && !(e instanceof sm.FontError))
  assert.throws(() => loadFont(42 as never), TypeError)
})

test('sketches clone as themselves, with their parameters; zero-argument constructors', () => {
  for (const sketch of [new Trapezoid(40, 15, Math.PI / 3, Math.PI / 4), new ArcSlot(40, 6, 1), new Stroke(new Line(V(0, 0, 0), V(5, 0, 0)), 1), new Hull(P(0, 0), P(1, 0), P(0, 1)), new Text('Hi', 5)]) {
    const copy = sketch.clone()
    assert.equal(copy.constructor, sketch.constructor)
    assert.deepEqual(copy.parameters, sketch.parameters)
    close(copy.area, sketch.area, 1e-12)
  }
  const made = [new Rectangle(), new RoundedRectangle(), new Circle(), new Ellipse(), new RegularPolygon(), new Triangle(), new Trapezoid(), new Slot(), new ArcSlot()]
  for (const sketch of made) assert.ok(sketch.area > 0, sketch.constructor.name)
  // without what they are made of, empty ones (as R3F's extend() makes them)
  for (const empty of [new Polygon(), new Stroke(), new Hull(), new Text()]) assert.throws(() => empty.area, /empty/)
})

test('nothing of smlibwasm comes out of the sketches, profiles and fonts', () => {
  const font = loadFont(QUAD)
  const results: unknown[] = [
    new RoundedRectangle(4, 3, 1),
    new Triangle(4, 3),
    new Trapezoid(4, 3, 1.2),
    new ArcSlot(5, 1, 1),
    new Stroke(new Line(V(0, 0, 0), V(5, 0, 0)), 1),
    new Hull(new Circle(2), P(5, 0)),
    makeFace(new CenterArc(V(0, 0, 0), 3)),
    new Text('HO', 700, { font }),
    new Text('H', 4, { path: new CenterArc(V(0, 0, 0), 30, Math.PI, -Math.PI) }),
    new Profile().lineTo(5, 0).arc(2, Math.PI),
    new Profile().lineTo(5, 0).arc(2, Math.PI).close(),
    new Profile().lineTo(5, 0).arc(2, Math.PI).wire(),
    font,
    font.kerning(1, 2),
    font.outline(font.glyphIndex('O')!),
    loadFont(),
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
})
