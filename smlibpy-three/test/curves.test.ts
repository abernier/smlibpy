// Curves: smlibpy's curve constructors as Edges and Wires (THREE.Lines), in three's coordinates.
// What smlibpy draws on its XY plane lies on the ground here (the plane of constant y through the
// curve's center) and turns counterclockwise seen from above: from +x towards -z.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as sm from '@classcad/smlibwasm'
import { Edge, Wire } from '../src/index.ts'
import {
  Bezier,
  CenterArc,
  ConicArc,
  EllipticalArc,
  FilletPolyline,
  Helix,
  HyperbolicArc,
  Line,
  ParabolicArc,
  PolarLine,
  Polyline,
  RadiusArc,
  SagittaArc,
  Spiral,
  Spline,
  TangentArc,
  ThreePointArc,
  fitCurve,
  makeCompatible,
} from '../src/curves.ts'
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

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const S45 = Math.SQRT1_2

/** The curve's start, middle (half way along its length) and end. */
function along(curve: Edge | Wire, start: THREE.Vector3Like, middle: THREE.Vector3Like, end: THREE.Vector3Like, tol = 1e-9, what = curve.constructor.name): void {
  closeVector(curve.pointAt(0), start, tol, `${what} start`)
  closeVector(curve.pointAt(0.5), middle, tol, `${what} middle`)
  closeVector(curve.pointAt(1), end, tol, `${what} end`)
}

/** Points along the curve (fractions of its length). */
const samples = (curve: Edge | Wire, n = 16) => Array.from({ length: n + 1 }, (_, i) => curve.pointAt(i / n))

test('lines: Line, PolarLine at angles from +x towards -z, Polyline open and closed', () => {
  const line = new Line(V(1, 2, 3), V(4, 6, 3))
  assert.ok(line instanceof Edge && line instanceof THREE.Line)
  along(line, V(1, 2, 3), V(2.5, 4, 3), V(4, 6, 3))
  // a polar line on the ground: angle 0 along +x, π/2 along -z (counterclockwise seen from above)
  along(new PolarLine(V(1, 2, 3), 10, Math.PI / 2), V(1, 2, 3), V(1, 2, -2), V(1, 2, -7))
  along(new PolarLine(V(0, 0, 0), 10, 0), V(0, 0, 0), V(5, 0, 0), V(10, 0, 0))
  const diagonal = new PolarLine(V(0, 1, 0), 10, Math.PI / 4)
  closeVector(diagonal.end, V(10 * S45, 1, -10 * S45), 1e-9)
  close(diagonal.length, 10, 1e-12)
  // a polyline is a wire; closed, it ends where it starts
  const open = new Polyline([V(0, 0, 0), V(10, 0, 0), V(10, 0, -10)])
  assert.ok(open instanceof Wire && open instanceof THREE.Line)
  assert.equal(open.isClosed, false)
  close(open.length, 20, 1e-12)
  const loop = new Polyline([V(0, 0, 0), V(10, 0, 0), V(10, 0, -10)], { close: true })
  assert.equal(loop.isClosed, true)
  assert.equal(loop.edges().length, 3)
  const length = 20 + 10 * Math.SQRT2
  close(loop.length, length, 1e-12)
  along(loop, V(0, 0, 0), V(10, 0, -(length / 2 - 10)), V(0, 0, 0))
})

test('arcs about a center lie on the ground through it, counterclockwise seen from above', () => {
  const quarter = new CenterArc(V(0, 2, 0), 5, 0, Math.PI / 2)
  along(quarter, V(5, 2, 0), V(5 * S45, 2, -5 * S45), V(0, 2, -5))
  assert.equal(quarter.geomType, 'circle')
  close(quarter.radius, 5, 1e-12)
  closeVector(quarter.arcCenter, V(0, 2, 0), 1e-12)
  // a negative size runs clockwise: towards +z
  along(new CenterArc(V(0, 2, 0), 5, 0, -Math.PI / 2), V(5, 2, 0), V(5 * S45, 2, 5 * S45), V(0, 2, 5))
  // from π/2 (along -z) over π: through -x to +z
  along(new CenterArc(V(1, 0, 1), 5, Math.PI / 2, Math.PI), V(1, 0, -4), V(-4, 0, 1), V(1, 0, 6))
  // the whole circle (the default size)
  const circle = new CenterArc(V(0, 0, 0), 3)
  assert.equal(circle.isClosed, true)
  close(circle.length, 6 * Math.PI, 1e-9)
  // three points: the arc in their plane, here an upright one
  const upright = new ThreePointArc(V(0, 0, 0), V(5, 5, 0), V(10, 0, 0))
  along(upright, V(0, 0, 0), V(5, 5, 0), V(10, 0, 0))
  close(upright.radius, 5, 1e-9)
  closeVector(upright.arcCenter, V(5, 0, 0), 1e-9)
  assert.throws(() => new ThreePointArc(V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)), RangeError)
})

test('arcs between two points bulge to the left of start to end, seen from above', () => {
  // a positive radius to the left (from +x on: towards -z), a negative one to the right
  along(new RadiusArc(V(0, 0, 0), V(10, 0, 0), 5), V(0, 0, 0), V(5, 0, -5), V(10, 0, 0))
  along(new RadiusArc(V(0, 0, 0), V(10, 0, 0), -5), V(0, 0, 0), V(5, 0, 5), V(10, 0, 0))
  const shallow = new RadiusArc(V(0, 0, 0), V(10, 0, 0), 10)
  closeVector(shallow.pointAt(0.5), V(5, 0, -(10 - Math.sqrt(75))), 1e-9)
  close(shallow.radius, 10, 1e-9)
  // seen from +z instead: its left is up
  along(new RadiusArc(V(0, 0, 0), V(10, 0, 0), 5, { normal: V(0, 0, 1) }), V(0, 0, 0), V(5, 5, 0), V(10, 0, 0))
  // one point above the other has no left seen from above: a normal says where it is
  assert.throws(() => new RadiusArc(V(0, 0, 0), V(0, 10, 0), 5), (e) => e instanceof RangeError && /normal/.test(e.message))
  along(new RadiusArc(V(0, 0, 0), V(0, 10, 0), 5, { normal: V(0, 0, 1) }), V(0, 0, 0), V(-5, 5, 0), V(0, 10, 0))
  // a sagitta: the middle that far from the chord's middle
  along(new SagittaArc(V(0, 0, 0), V(10, 0, 0), 2), V(0, 0, 0), V(5, 0, -2), V(10, 0, 0))
  along(new SagittaArc(V(0, 0, 0), V(10, 0, 0), -2), V(0, 0, 0), V(5, 0, 2), V(10, 0, 0))
  along(new SagittaArc(V(0, 3, 0), V(10, 3, 0), 2, { normal: V(0, 0, -1) }), V(0, 3, 0), V(5, 1, 0), V(10, 3, 0))
  // a tangent arc leaves its start along the tangent: a quarter circle about (0, 0, -10)
  const tangent = new TangentArc(V(0, 0, 0), V(10, 0, -10), V(1, 0, 0))
  along(tangent, V(0, 0, 0), V(10 * S45, 0, -10 + 10 * S45), V(10, 0, -10))
  closeVector(tangent.tangentAt(0), V(1, 0, 0), 1e-9)
  closeVector(tangent.tangentAt(1), V(0, 0, -1), 1e-9)
  closeVector(tangent.arcCenter, V(0, 0, -10), 1e-9)
  // straight ahead: a line
  assert.equal(new TangentArc(V(0, 0, 0), V(10, 0, 0), V(1, 0, 0)).geomType, 'line')
})

test('ellipses and conics lie on the ground, their own y along -z', () => {
  const quarter = new EllipticalArc(V(0, 1, 0), 10, 5, 0, Math.PI / 2)
  closeVector(quarter.start, V(10, 1, 0), 1e-9)
  closeVector(quarter.end, V(0, 1, -5), 1e-9)
  for (const p of samples(quarter)) {
    close(p.y, 1, 1e-9, 'on the plane through the center')
    close((p.x / 10) ** 2 + (p.z / 5) ** 2, 1, 1e-9, 'on the ellipse')
    assert.ok(p.x >= -1e-9 && p.z <= 1e-9, 'counterclockwise seen from above: from +x towards -z')
  }
  // the whole ellipse (the default angles), and an arc across 0 (its middle on +x)
  const whole = new EllipticalArc(V(0, 1, 0), 10, 5)
  assert.equal(whole.isClosed, true)
  const h = (5 / 15) ** 2 // (Ramanujan's second approximation of the perimeter, far closer than 1e-6 here)
  close(whole.length, Math.PI * 15 * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))), 1e-6)
  along(new EllipticalArc(V(0, 0, 0), 10, 5, (5 * Math.PI) / 3, Math.PI / 3), V(5, 0, 5 * Math.sin(Math.PI / 3)), V(10, 0, 0), V(5, 0, -5 * Math.sin(Math.PI / 3)))
  // a parabola opening towards -z: x² / 40 from its vertex, the focus 10 along -z
  const parabola = new ParabolicArc(V(0, 0, 0), 10, -20, 20)
  along(parabola, V(-20, 0, -10), V(0, 0, 0), V(20, 0, -10))
  for (const p of samples(parabola)) close(-p.z, (p.x * p.x) / 40, 1e-9, 'on the parabola')
  along(new ParabolicArc(V(0, 5, 0), -10, -20, 20), V(-20, 5, 10), V(0, 5, 0), V(20, 5, 10))
  // a hyperbola's +x branch, from v = -30 to 30 along -z: its vertex 10 along x
  const hyperbola = new HyperbolicArc(V(0, 0, 0), 10, 20, -30, 30)
  const x30 = 10 * Math.sqrt(1 + (30 / 20) ** 2)
  along(hyperbola, V(x30, 0, 30), V(10, 0, 0), V(x30, 0, -30))
  for (const p of samples(hyperbola)) close((p.x / 10) ** 2 - (p.z / 20) ** 2, 1, 1e-9, 'on the hyperbola')
  // a rho conic: rho of the way from the chord's middle to the apex; √2 - 1 is a quarter circle
  along(new ConicArc(V(0, 0, 0), V(10, 0, 0), V(10, 0, -10), 0.5), V(0, 0, 0), V(7.5, 0, -2.5), V(10, 0, -10))
  const round = new ConicArc(V(0, 0, 0), V(10, 0, 0), V(10, 0, -10), Math.SQRT2 - 1)
  along(round, V(0, 0, 0), V(10 * S45, 0, -10 + 10 * S45), V(10, 0, -10))
  for (const p of samples(round)) close(p.distanceTo(V(0, 0, -10)), 10, 1e-9, 'on the circle')
  assert.throws(() => new ConicArc(V(0, 0, 0), V(10, 0, 0), V(10, 0, -10), 1), RangeError)
})

test('splines and Béziers: through their points, with tangents, closed, rational', () => {
  const points = [V(0, 0, 0), V(10, 5, -5), V(20, 0, 0), V(30, -5, 5)]
  const spline = new Spline(points)
  for (const p of points) assert.ok(spline.distanceTo(p) < 1e-9, `the spline passes (${p.x}, ${p.y}, ${p.z})`)
  closeVector(spline.start, points[0], 1e-12)
  closeVector(spline.end, points[3], 1e-12)
  // tangents at the ends, or at every point
  const bent = new Spline([V(0, 0, 0), V(10, 0, -5), V(20, 0, 0)], { tangents: [V(0, 0, -1), V(0, 0, 1)] })
  closeVector(bent.tangentAt(0), V(0, 0, -1), 1e-9)
  closeVector(bent.tangentAt(1), V(0, 0, 1), 1e-9)
  const ending = new Spline([V(0, 0, 0), V(10, 0, -5), V(20, 0, 0)], { tangents: [null, V(1, 0, 0)] })
  closeVector(ending.tangentAt(1), V(1, 0, 0), 1e-9)
  const every = new Spline([V(0, 0, 0), V(10, 0, 0), V(20, 0, -10)], { tangents: [V(1, 0, 0), V(1, 0, -1), V(0, 0, -1)] })
  closeVector(every.tangentAt(0), V(1, 0, 0), 1e-9)
  closeVector(every.tangentAt(1), V(0, 0, -1), 1e-9)
  assert.ok(every.distanceTo(V(10, 0, 0)) < 1e-9)
  // closed: back to the start, as smooth there as elsewhere
  const loop = new Spline([V(0, 0, 0), V(10, 0, -5), V(20, 0, 0), V(10, 0, 5)], { closed: true })
  assert.equal(loop.isClosed, true)
  closeVector(loop.start, loop.end, 1e-12)
  closeVector(loop.tangentAt(0), loop.tangentAt(1), 1e-9)
  // a Bézier curve of its control points; with weights a rational one (here a quarter circle)
  along(new Bezier([V(0, 0, 0), V(5, 0, -10), V(10, 0, 0)]), V(0, 0, 0), V(5, 0, -5), V(10, 0, 0))
  const arc = new Bezier([V(10, 0, 0), V(10, 0, -10), V(0, 0, -10)], { weights: [1, S45, 1] })
  along(arc, V(10, 0, 0), V(10 * S45, 0, -10 * S45), V(0, 0, -10))
  for (const p of samples(arc)) close(p.length(), 10, 1e-9, 'on the circle')
})

test('helices and spirals turn counterclockwise seen from above', () => {
  // a right-handed helix rises along y: a quarter turn up it is at -z
  const helix = new Helix(2, 10, 3)
  closeVector(helix.start, V(3, 0, 0), 1e-9)
  closeVector(helix.pointAt(0.05), V(0, 0.5, -3), 1e-6)
  closeVector(helix.end, V(3, 10, 0), 1e-9)
  close(helix.length, 5 * Math.hypot(2 * Math.PI * 3, 2), 1e-3) // (a B-spline within 1e-4 of the helix)
  closeVector(new Helix(2, 10, 3, { leftHanded: true }).pointAt(0.05), V(0, 0.5, 3), 1e-6)
  // placed and shaped by its options
  const moved = new Helix(2, 10, 3, { center: V(5, 1, -2) })
  closeVector(moved.start, V(8, 1, -2), 1e-9)
  closeVector(moved.end, V(8, 11, -2), 1e-9)
  closeVector(new Helix(2, 10, 3, { endRadius: 6 }).end, V(6, 10, 0), 1e-9)
  const sideways = new Helix(2, 10, 3, { center: V(5, 1, 0), direction: V(1, 0, 0) })
  close(sideways.end.x - sideways.start.x, 10, 1e-9)
  for (const p of samples(sideways, 40)) close(Math.hypot(p.y - 1, p.z), 3, 1e-4, 'around the axis along x')
  // a flat spiral on the ground, out from radius 2 to 20 in five turns
  const spiral = new Spiral(2, 20, 5)
  closeVector(spiral.start, V(2, 0, 0), 1e-9)
  closeVector(spiral.end, V(20, 0, 0), 1e-9)
  for (const p of samples(spiral, 50)) close(p.y, 0, 1e-12, 'on the ground')
  assert.ok(spiral.tangentAt(0).z < -0.9, 'counterclockwise: from +x towards -z')
  // its middle: half its length along r = 2 + 18 θ / 10π, counterclockwise seen from above
  const radius = (t: number) => 2 + (18 * t) / (10 * Math.PI)
  const speed = (t: number) => Math.hypot(radius(t), 18 / (10 * Math.PI))
  const steps = 20000
  const lengths = [0]
  for (let i = 0; i < steps; i++) {
    const [a, b] = [(i / steps) * 10 * Math.PI, ((i + 1) / steps) * 10 * Math.PI]
    lengths.push(lengths[i] + ((b - a) / 6) * (speed(a) + 4 * speed((a + b) / 2) + speed(b)))
  }
  close(spiral.length, lengths[steps], 1e-3)
  const half = (lengths.findIndex((s) => s >= lengths[steps] / 2) / steps) * 10 * Math.PI
  closeVector(spiral.pointAt(0.5), V(radius(half) * Math.cos(half), 0, -radius(half) * Math.sin(half)), 0.05) // (a B-spline near the spiral)
  assert.ok(new Spiral(2, 20, 5, { clockwise: true }).tangentAt(0).z > 0.9)
  closeVector(new Spiral(0, 10, 2).start, V(0, 0, 0), 1e-12)
})

test('FilletPolyline rounds the corners of a polyline', () => {
  const corner = new FilletPolyline([V(0, 0, 0), V(10, 0, 0), V(10, 0, -10)], 2)
  assert.ok(corner instanceof Wire)
  const edges = corner.edges()
  assert.deepEqual(Array.from(edges, (e) => e.geomType), ['line', 'circle', 'line'])
  close(edges[1].radius, 2, 1e-9)
  closeVector(edges[1].arcCenter, V(8, 0, -2), 1e-9)
  close(corner.length, 16 + Math.PI, 1e-9)
  closeVector(corner.pointAt(0), V(0, 0, 0), 1e-12)
  closeVector(corner.pointAt(1), V(10, 0, -10), 1e-12)
  // closed: every corner, the one at the start too
  const square = new FilletPolyline([V(0, 0, 0), V(10, 0, 0), V(10, 0, -10), V(0, 0, -10)], 2, { close: true })
  assert.equal(square.isClosed, true)
  assert.equal(square.edges().length, 8)
  close(square.length, 40 - 16 + 4 * Math.PI, 1e-9)
})

test('fitCurve: a smooth curve near many points', () => {
  const points = Array.from({ length: 200 }, (_, i) => V(i / 4, 0, -5 * Math.sin(i / 20) + 0.002 * Math.sin(37.3 * i)))
  const fit = fitCurve(points, { tolerance: 0.01 })
  assert.ok(fit instanceof Edge)
  assert.equal(fit.geomType, 'bspline')
  for (const p of points) assert.ok(fit.distanceTo(p) <= 0.01 + 1e-9, `(${p.x}, ${p.z}) is ${fit.distanceTo(p)} off`)
  closeVector(fit.start, points[0], 1e-9)
  closeVector(fit.end, points[points.length - 1], 1e-9)
  // a closed curve near points round a circle; one along given end directions
  const ring = Array.from({ length: 60 }, (_, i) => V(10 * Math.cos((i / 60) * 2 * Math.PI), 3, -10 * Math.sin((i / 60) * 2 * Math.PI)))
  const loop = fitCurve(ring, { tolerance: 1e-3, closed: true })
  assert.equal(loop.isClosed, true)
  for (const p of ring) assert.ok(loop.distanceTo(p) <= 1e-3 + 1e-9)
  const arc = Array.from({ length: 30 }, (_, i) => V(10 * Math.cos((i / 29) * (Math.PI / 2)), 0, -10 * Math.sin((i / 29) * (Math.PI / 2))))
  const directed = fitCurve(arc, { tolerance: 1e-4, tangents: [V(0, 0, -1), V(-1, 0, 0)], degree: 4 })
  closeVector(directed.tangentAt(0), V(0, 0, -1), 1e-9)
  closeVector(directed.tangentAt(1), V(-1, 0, 0), 1e-9)
  // few points: the spline through them
  const few = [V(0, 0, 0), V(5, 0, -3), V(10, 0, 0)]
  for (const p of few) assert.ok(fitCurve(few).distanceTo(p) < 1e-9)
})

test('makeCompatible: the edges where they are, the copies placed like the first', () => {
  const line = new Line(V(0, 0, 0), V(10, 0, 0))
  line.position.set(1, 0, 0)
  const arc = new CenterArc(V(0, 0, 0), 5, 0, Math.PI)
  const group = new THREE.Group()
  group.position.set(0, 3, 0)
  group.rotation.y = Math.PI / 2
  group.add(arc)
  group.updateMatrixWorld()
  const [a, b] = makeCompatible(line, arc)
  assert.ok(a instanceof Edge && b instanceof Edge)
  assert.deepEqual([a.geomType, b.geomType], ['bspline', 'bspline'])
  // both in the first edge's frame, with its transform: drawn where the edges are, the same shapes
  closeVector(a.position, line.position, 0)
  closeVector(b.position, line.position, 0)
  for (const x of [line, a, b]) x.updateMatrixWorld()
  for (let i = 0; i <= 8; i++) {
    closeVector(a.pointAt(i / 8), line.pointAt(i / 8), 1e-9, 'the line')
    closeVector(b.localToWorld(b.pointAt(i / 8)), arc.localToWorld(arc.pointAt(i / 8)), 1e-6, 'the arc')
  }
  // lists of edges are taken too; anything else is not
  assert.equal(makeCompatible([line, arc, new Spline([V(0, 0, 0), V(5, 0, -2), V(10, 0, 0)])]).length, 3)
  assert.throws(() => makeCompatible(line, new Polyline([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)]) as never), (e) => e instanceof TypeError && /wire\.edges/.test(e.message))
  assert.throws(() => makeCompatible(line), RangeError)
})

test('curves are THREE.Lines of their own: zero-argument constructors, clones, their own frame', () => {
  const made = [
    new Line(),
    new PolarLine(),
    new CenterArc(),
    new ThreePointArc(),
    new RadiusArc(),
    new SagittaArc(),
    new TangentArc(),
    new EllipticalArc(),
    new ParabolicArc(),
    new HyperbolicArc(),
    new ConicArc(),
    new Helix(),
    new Spiral(),
  ]
  for (const curve of made) {
    assert.ok(curve instanceof Edge && curve instanceof THREE.Line, curve.constructor.name)
    assert.ok(curve.length > 0, curve.constructor.name)
  }
  // without points, an empty one (as R3F's extend() makes them)
  for (const empty of [new Spline(), new Bezier(), new Polyline(), new FilletPolyline()]) assert.throws(() => empty.length, /empty/)
  // a clone is the same class, sharing the curve
  for (const curve of [new PolarLine(V(1, 0, 0), 5, 1), new Spiral(1, 5, 2), new FilletPolyline([V(0, 0, 0), V(5, 0, 0), V(5, 0, -5)], 1)]) {
    const copy = curve.clone()
    assert.equal(copy.constructor, curve.constructor)
    close(copy.length, curve.length, 1e-12)
    closeVector(copy.pointAt(0.3), curve.pointAt(0.3), 1e-12)
  }
  // queries are in the curve's own frame; its transform places it
  const arc = new CenterArc(V(0, 0, 0), 5, 0, Math.PI / 2)
  arc.position.set(10, 0, 0)
  arc.rotation.y = Math.PI / 2
  arc.updateMatrixWorld()
  closeVector(arc.start, V(5, 0, 0), 1e-12)
  closeVector(arc.localToWorld(arc.start.clone()), V(10, 0, -5), 1e-9)
  // and three draws it: points along the exact curve
  const position = arc.geometry.getAttribute('position')
  assert.ok(position.count > 8)
  for (let i = 0; i < position.count; i++) close(new THREE.Vector3().fromBufferAttribute(position, i).length(), 5, 1e-3)
})

test('nothing of smlibwasm comes out of the curves', () => {
  const results: unknown[] = [
    new PolarLine(V(0, 0, 0), 4, 1),
    new RadiusArc(V(0, 0, 0), V(4, 0, 0), 3),
    new SagittaArc(V(0, 0, 0), V(4, 0, 0), 1),
    new TangentArc(V(0, 0, 0), V(4, 0, -4), V(1, 0, 0)),
    new EllipticalArc(V(0, 0, 0), 4, 2),
    new ParabolicArc(V(0, 0, 0), 2, -3, 3),
    new HyperbolicArc(V(0, 0, 0), 2, 3, -3, 3),
    new ConicArc(V(0, 0, 0), V(4, 0, 0), V(4, 0, -4), 0.3),
    new Spiral(1, 4, 2),
    new FilletPolyline([V(0, 0, 0), V(4, 0, 0), V(4, 0, -4)], 1),
    new FilletPolyline([V(0, 0, 0), V(4, 0, 0), V(4, 0, -4)], 1).edges(),
    fitCurve(Array.from({ length: 20 }, (_, i) => V(i, 0, -Math.sin(i)))),
    makeCompatible(new Line(V(0, 0, 0), V(4, 0, 0)), new CenterArc(V(0, 0, 0), 2, 0, Math.PI)),
    new Spiral(1, 4, 2).curve,
  ]
  for (const [i, r] of results.entries()) noKernel(r, `result ${i}`)
})
