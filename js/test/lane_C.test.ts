// tests/test_lane_C.py: curves (kernel plan, lane C): 2D unions of touching xor sketches (C1),
// trimming, splitting and locating points on edges (C2), ellipse curves (C3), helices of any number
// of turns (C4), curve intersections with a tolerance (C5), extended and joined edges (C6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Axis, Box, CenterArc, Circle, Cylinder, EllipticalArc, FilletPolyline, Helix, Line, type Part, Plane, Polyline, Spline, Wire, ruled, sweep,
} from '../src/index.ts'
import { k } from '../src/kernel.ts'
import { approx } from './_approx.ts'

const near = (v: { x: number; y: number; z: number }, e: number[], tol = 1e-9) =>
  [v.x, v.y, v.z].forEach((c, i) => approx(c, e[i], 0, tol))

// -- C1 ---------------------------------------------------------------------------------------------
test('the union of exclusive-or sketches whose faces touch at points is right', () => {
  // natively the kernel's planar Boolean read a missing face through a null pointer here and killed
  // the process now and then (the patch makes it fail; the checked route takes its next way)
  const xor3 = (a: number[], b: number[], c: number[]) =>
    Circle(5).translate(a[0], a[1]).xor(Circle(5).translate(b[0], b[1])).xor(Circle(5).translate(c[0], c[1]))
  const A = xor3([-2.182942041700211, -0.021197750386068748], [6.022573704823237, 2.0923218298214277], [3.2673065691056404, 6.700000911073089])
  const B = xor3([-1.339224018669533, -1.9852265367137176], [3.703896707505808, -1.34902306233055], [0.2844822629196706, 3.4839088044709605])
    .translate(1.5088026988484238, -0.07349559615725632)
  const u = A.fuse(B)
  approx(u.area, 219.190363897, 1e-7) // OpenCASCADE
  near(u.center(), [2.171761, 1.680177, 0], 1e-5)
})

// -- C2 ---------------------------------------------------------------------------------------------
test('split a spline where it crosses a line', () => {
  const s = Spline([0, 0], [10, 10], [20, 0])
  const x = s.intersections(Line([0, 4], [20, 4]))
  assert.equal(x.length, 2)
  near(x[0], [10 - Math.sqrt(60), 4, 0])
  const [a, b] = s.split(x[0])
  approx(a.length + b.length, s.length, 0, 1e-12)
  assert.ok(a.end.distanceTo(x[0]) < 1e-9 && b.start.distanceTo(x[0]) < 1e-9)
  const middle = s.trim(x[0], x[1])
  approx(middle.length, s.length - 2 * a.length, 0, 1e-9)
  const t = s.paramAt(x[0])
  assert.ok(s.pointAt(t).distanceTo(x[0]) < 1e-9)
  approx(t, a.length / s.length, 0, 1e-12)
  near(s.closestPoint([10, 20]), [10, 10, 0])
  approx(s.paramAt([10, 20]), 0.5, 0, 1e-12)
})

test('trimmed arcs stay arcs', () => {
  const arc = CenterArc([0, 0], 10, 0, 180).trim(0.25, 0.75)
  assert.equal(arc.geomType, 'circle')
  approx(arc.radius, 10)
  approx(arc.length, 5 * Math.PI, 0, 1e-12)
  near(arc.start, [Math.sqrt(50), Math.sqrt(50), 0])
  const rim = Cylinder(10, 20).edges().filter((e) => e.geomType === 'circle')[0]
  const q = rim.trim(0.25, 0.5)
  assert.equal(q.geomType, 'circle')
  approx(q.length, 5 * Math.PI, 0, 1e-12)
})

test('reversed edges split and trim along their direction; errors', () => {
  const r = Line([0, 0], [10, 0]).reversed()
  const [a, b] = r.split(0.3)
  near(a.start, [10, 0, 0])
  near(a.end, [7, 0, 0])
  near(b.end, [0, 0, 0])
  const t = r.trim(0.2, 0.5)
  approx(t.start.x, 8)
  approx(t.end.x, 5)
  const e = Line([0, 0], [10, 0])
  assert.throws(() => e.split(0), /end of the edge/)
  assert.throws(() => e.split([5, 1]), (err: Error) => err instanceof RangeError && /lies 1 off the edge/.test(err.message))
  assert.throws(() => e.trim(0.6, 0.2), /start must come before the end/)
  assert.throws(() => e.split(1.5), /runs from 0 to 1/)
})

test('wires split and trim', () => {
  const w = Polyline([0, 0], [10, 0], [10, 10])
  let [a, b] = w.split(0.25)
  approx(a.length, 5)
  approx(b.length, 15)
  ;[a, b] = w.split([10, 0])
  assert.equal(a.edges().length, 1)
  assert.equal(b.edges().length, 1)
  const m = w.trim([5, 0], [10, 5])
  approx(m.length, 10)
  near(m.end, [10, 5, 0])
  assert.throws(() => w.split(0), /end of the wire/)
})

// -- C3 ---------------------------------------------------------------------------------------------
test('ellipses are paths, projected and ruled', () => {
  const ea = EllipticalArc([0, 0], 30, 20, 0, 90)
  const tube = sweep(Circle(2), ea) as Part
  assert.ok(tube.isValid())
  approx(tube.volume, 4 * Math.PI * ea.length, 1e-5)
  const up = EllipticalArc([0, 0, 20], 30, 20, 0, 90)
  const pieces = Box(100, 100, 10).project(up, [0, 0, -1])
  assert.equal(pieces.length, 2)
  for (const p of pieces) approx(p.length, ea.length, 1e-4)
  approx(ruled(up, up.translate(0, 0, 10)).area, 10 * ea.length, 1e-6)
})

// -- C4 ---------------------------------------------------------------------------------------------
test('helices of many turns', () => {
  for (const [turns, radius] of [[80, 20], [124, 50], [200, 20], [350.5, 5]]) {
    const h = Helix(2, 2 * turns, radius)
    assert.equal(h.geomType, 'bspline')
    near(h.start, [radius, 0, 0])
    const end = 2 * Math.PI * turns
    near(h.end, [radius * Math.cos(end), radius * Math.sin(end), 2 * turns], 1e-6)
    approx(h.length, turns * Math.hypot(2 * Math.PI * radius, 2), 5e-6)
    const [t0, t1] = h._range()
    for (let i = 0; i <= 500; i++) {
      const [x, y] = k.curve_evaluate(h._curve(), t0 + ((t1 - t0) * i) / 500)
      assert.ok(Math.abs(Math.hypot(x, y) - radius) < 1.2e-4)
    }
  }
  const lh = Helix(2, 2 * 150.5, 5, { endRadius: 15, leftHanded: true })
  near(lh.end, [-15, 0, 301], 1e-4)
})

// -- C5 ---------------------------------------------------------------------------------------------
test('intersections have a size-relative tolerance and return [] for none', () => {
  const a = Line([0, 0, 0], [10, 0, 0])
  assert.deepEqual(a.intersections(Line([5, -5, 0.0005], [5, 5, 0.0005])), [])
  near(a.intersections(Line([5, -5, 0.0005], [5, 5, 0.0005]), { tolerance: 1e-3 })[0], [5, 0, 0])
  assert.deepEqual(Line([0, 0], [0.01, 0]).intersections(Line([0, 0.0005], [0.01, 0.0005])), [])
  assert.deepEqual(a.intersections(Line([0, 5], [10, 5])), [])
  assert.deepEqual(a.intersectionParams(Line([5, -5, 0], [5, 5, 0])), [0.5])
  assert.deepEqual(Line([0, 0], [10, 0]).intersections(Line([5, 0], [15, 0])).map((p) => p.x), [5, 10])
  assert.deepEqual(CenterArc([0, 0], 5, 0, 360).intersections(Line([-30, 0], [30, 0])).map((p) => Math.round(p.x)).sort(), [-5, 5])
  const e = Line([0, 0], [1, 1])
  assert.throws(() => e.intersections(e), /selfIntersections/)
})

test('intersections with wires, faces and bodies', () => {
  const z = Line([0, 0, -20], [0, 0, 20])
  const box = Box(10, 10, 10)
  assert.deepEqual(z.intersections(box).map((p) => p.z), [-5, 5])
  assert.deepEqual(z.intersectionParams(box), [0.375, 0.625])
  assert.deepEqual(z.intersections(box.faces().sortBy(Axis.Z).at(-1)!).map((p) => p.z), [5])
  const plate = Box(20, 20, 2).cut(Cylinder(4, 4))
  Line([-20, 0, 1], [20, 0, 1]).intersections(plate).forEach((p, i) => approx(p.x, [-10, -4, 4, 10][i], 0, 1e-9))
  assert.deepEqual(Line([-20, 5, 0], [20, 5, 0]).intersections(box).map((p) => p.x), [-5, 5])
  const w = Polyline([0, -5], [10, 5], [20, -5])
  Line([-5, 0], [25, 0]).intersections(w).forEach((p, i) => approx(p.x, [5, 15][i]))
  w.intersections(Line([-5, 0], [25, 0])).forEach((p, i) => approx(p.x, [5, 15][i]))
  assert.equal(Line([10, -5], [10, 10]).intersections(w).length, 1)
  const loop = Spline([0, 0], [10, 10], [10, 0], [0, 10])
  const self = loop.selfIntersections()
  assert.equal(self.length, 1)
  approx(self[0].y, 5, 0, 1e-9)
})

// -- C6 ---------------------------------------------------------------------------------------------
test('extend lines, arcs, ellipses and splines by the distance', () => {
  const e = Line([0, 0], [10, 0]).extend(2, { end: 'both' })
  near(e.start, [-2, 0, 0])
  near(e.end, [12, 0, 0])
  const arc = CenterArc([0, 0], 10, 0, 90).extend((Math.PI * 10) / 4)
  assert.equal(arc.geomType, 'circle')
  approx(arc.length, 7.5 * Math.PI)
  near(arc.end, [-Math.sqrt(50), Math.sqrt(50), 0])
  const el = EllipticalArc([0, 0], 20, 10, 0, 90)
  for (const end of ['start', 'end', 'both']) {
    const x = el.extend(5, { end })
    assert.equal(x.geomType, 'ellipse')
    approx(x.length, el.length + (end === 'both' ? 10 : 5), 0, 1e-8)
  }
  assert.throws(() => CenterArc([0, 0], 10, 0, 300).extend(11), /whole circle/)
  assert.throws(() => CenterArc([0, 0], 10, 0, 360).extend(1), /closed edge/)
  const s = Spline([0, 0], [10, 10], [20, 0])
  for (const continuity of ['G1', 'G2', 'natural']) approx(s.extend(5, { continuity }).length, s.length + 5, 0, 1e-8)
  const g1 = s.extend(5, { end: 'both' })
  assert.ok(g1.end.distanceTo(s.end.add(s.tangentAt(1).mul(5))) < 1e-9)
  assert.throws(() => s.extend(1, { continuity: 'C2' }), /continuity/)
})

test('wires join into one edge', () => {
  const fp = FilletPolyline([0, 0], [30, 0], [30, 20], { radius: 5 })
  const e = fp.toEdge()
  assert.equal(e.geomType, 'bspline')
  approx(e.length, fp.length, 0, 1e-9)
  near(e.end, [30, 20, 0])
  const path = FilletPolyline([0, 0, 0], [30, 0, 0], [30, 20, 10], { radius: 5 })
  const pipe = sweep(Circle(1), path.toEdge()) as Part
  assert.ok(pipe.isValid())
  approx(pipe.volume, Math.PI * path.length, 1e-4)
  const one = Line([0, 0], [1, 0])
  assert.equal(new Wire([one]).toEdge(), one)
  assert.throws(() => new Wire([Line([0, 0], [1, 0]), Line([1, 0.1], [2, 0])], { sort: false }).toEdge(), /a gap of 0.1/)
})

test('an ellipse edge of a body is a sweep path', () => {
  const half = Cylinder(10, 40).split(new Plane([0, 0, 0], null, [0, 1, 1]))
  const rim = half.edges().filter((e) => e.geomType === 'ellipse')[0]
  assert.ok((sweep(Circle(1), rim) as Part).isValid())
})
