// tests/test_lane_C.py: curves (kernel plan, lane C): 2D unions of touching xor sketches (C1),
// trimming, splitting and locating points on edges (C2), ellipse curves (C3), helices of any number
// of turns (C4), curve intersections with a tolerance (C5), extended and joined edges (C6), offsets
// of edges and wires and strokes along splines (C7), curves fitted to points (C8), curvature,
// inflections and exact boxes (C9), curves as lines and arcs (C10).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Axis, Box, CenterArc, Circle, Cylinder, Ellipse, EllipticalArc, FilletPolyline, Helix, Line, ModelingError, type Part, Plane, Polyline,
  Rectangle, Spline, Stroke, Vector, Wire, fitCurve, fromDxfWires, offset, ruled, sweep, toDxf,
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

// -- C7 ---------------------------------------------------------------------------------------------
/** A line, a quarter circle and a line with corners; the arc exact or a cubic B-spline fitted to it
 * within 1e-6 (an edge that is offset by the kernel, not as an arc). */
function arcLikePath(fitted: boolean): Wire {
  let arc = CenterArc([10, 10], 10, -90, 90)
  if (fitted) {
    const pts: Vector[] = []
    for (let i = 0; i <= 200; i++) pts.push(arc.pointAt(i / 200))
    arc = fitCurve(pts, { tolerance: 1e-6 })
    assert.equal(arc.geomType, 'bspline')
  }
  return new Wire([Line([0, -5], [10, 0]), arc, Line([20, 10], [30, 10])])
}

test('offsets of lines and arcs stay exact', () => {
  const w = Polyline([0, 0], [40, 0], [40, 30])
  const inner = w.offset(2)
  assert.deepEqual(inner.edges().map((e) => e.geomType), ['line', 'line'])
  approx(inner.length, 66, 0, 1e-12)
  const outer = w.offset(-2)
  assert.deepEqual(outer.edges().map((e) => e.geomType), ['line', 'circle', 'line'])
  approx(outer.length, 70 + Math.PI, 0, 1e-12)
  const sharp = w.offset(-2, { corners: 'sharp' })
  approx(sharp.length, 74, 0, 1e-12)
  near(sharp.end, [42, 30, 0])
  approx(w.offset(-2, { corners: 'chamfer' }).length, 70 + 2 * Math.SQRT2, 0, 1e-12)
  const rect = Rectangle(20, 10).wires()[0]
  approx(rect.offset(2).length, 60 + 4 * Math.PI, 0, 1e-12)
  approx(rect.reversed().offset(2).length, 60 + 4 * Math.PI, 0, 1e-12)
  approx(rect.offset(-2).length, 44, 0, 1e-12)
  const circle = CenterArc([0, 0], 5, 0, 360)
  approx(circle.offset(1).radius, 6)
  approx(circle.offset(-1).radius, 4)
  near(offset(Line([0, 0], [10, 0]), 2).start, [0, 2, 0])
})

test('spline offsets are parallel within their size', () => {
  const s = Spline([0, 0], [10, 5], [20, -3], [30, 4])
  for (const d of [2, -2]) {
    const o = s.offset(d)
    let worst = 0
    for (let i = 0; i <= 200; i++) worst = Math.max(worst, Math.abs(s.distanceTo(o.pointAt(i / 200)) - Math.abs(d)))
    assert.ok(worst <= 1e-6 * s.bbox().diagonal, String(worst))
    const t0 = s.tangentAt(0)
    assert.ok(o.start.distanceTo(s.start.add(new Vector(-t0.y, t0.x, 0).mul(d))) < 1e-9)
  }
  assert.ok(s.offset(2).pointAt(0.5).y > s.pointAt(0.5).y)
  assert.throws(() => s.offset(5), (e: unknown) => e instanceof ModelingError && /bends more tightly than the distance 5.*radius of curvature is 3.9975/.test(e.message))
  const ring = Spline([0, 0], [10, 5], [20, 0], [10, -5], { closed: true })
  approx(ring.offset(1).length, ring.length + 2 * Math.PI, 1e-6)
  approx(ring.offset(-1).length, ring.length - 2 * Math.PI, 1e-6)
  const v = Spline([0, 0, 0], [10, 0, 5], [20, 0, 0])
  near(v.offset(1).start, [Math.SQRT1_2, 0, -Math.SQRT1_2])
  near(v.offset(1, { plane: Plane.XZ }).start, [-Math.SQRT1_2, 0, Math.SQRT1_2])
  assert.throws(() => Line([0, 0, 0], [10, 0, 10]).offset(1), /pass plane=/)
})

test('offsets of paths with curves match the exact path', () => {
  const exact = arcLikePath(false)
  const fitted = arcLikePath(true)
  for (const d of [1.5, -1.5]) {
    for (const corners of ['round', 'sharp', 'chamfer']) {
      const a = exact.offset(d, { corners })
      const b = fitted.offset(d, { corners })
      approx(b.length, a.length, 0, 1e-5)
      assert.ok(b.start.distanceTo(a.start) < 1e-9 && b.end.distanceTo(a.end) < 1e-9)
      const es = b.edges()
      for (let i = 0; i + 1 < es.length; i++) assert.ok(es[i].end.distanceTo(es[i + 1].start) < 1e-9)
    }
  }
})

test('closed wires with splines offset like their region', () => {
  const lens = new Wire([Spline([0, 0], [10, 6], [20, 0]), Spline([20, 0], [10, -6], [0, 0])])
  const region = lens.toSketch()
  for (const d of [1, -1, 2]) {
    for (const corners of ['round', 'sharp']) approx(lens.offset(d, { corners }).toSketch().area, region.offset(d, { corners }).area, 1e-5)
  }
  const u = new Wire([Line([0, 0], [0, 20]), Line([0, 20], [8, 20]), Line([8, 20], [8, 0])])
  approx(u.offset(-3).length, 36)
  assert.throws(() => u.offset(-5), /moved by 5/)
})

test('strokes follow splines', () => {
  const s = Spline([0, 0], [10, 5], [20, 0])
  const band = 2 * s.length * 1e-6 * s.bbox().diagonal
  approx(Stroke(s, 2).area, 2 * s.length + Math.PI, 0, band)
  approx(Stroke(s, 2, { ends: 'flat' }).area, 2 * s.length, 0, band)
  const ring = Spline([0, 0], [10, 5], [20, 0], [10, -5], { closed: true })
  approx(Stroke(ring, 1).area, ring.length, 0, 2 * ring.length * 1e-6 * ring.bbox().diagonal)
  const exact = arcLikePath(false)
  const fitted = arcLikePath(true)
  for (const corners of ['round', 'sharp', 'chamfer']) {
    for (const ends of ['round', 'flat']) approx(Stroke(fitted, 3, { ends, corners }).area, Stroke(exact, 3, { ends, corners }).area, 1e-6)
  }
  const loop = Spline([0, 0], [20, 0], [20, 10], [10, 10], [10, -10])
  const st = Stroke(loop, 1)
  assert.equal(st.faces().length, 1)
  assert.equal(st.faces()[0].wires().length, 2)
  assert.ok(st.area < loop.length + Math.PI / 4)
})

// -- C8 ---------------------------------------------------------------------------------------------
test('fitCurve keeps within the tolerance with few control points', () => {
  const pts: number[][] = []
  for (let i = 0; i < 200; i++) {
    const x = (20 * i) / 199
    pts.push([x, 5 * Math.sin(x / 3) + 0.003 * Math.sin(7 * x)])
  }
  const e = fitCurve(pts, { tolerance: 0.01 })
  assert.ok(Math.max(...pts.map((p) => e.distanceTo(p))) <= 0.01)
  assert.ok(e.nurbs().points.length < 40)
  assert.ok(e.start.length < 1e-12 && e.end.distanceTo(pts[pts.length - 1]) < 1e-9)
  const a = fitCurve(pts, { tangents: [[1, 0], [0, 1]], tolerance: 0.05 })
  near(a.tangentAt(0), [1, 0, 0])
  near(a.tangentAt(1), [0, 1, 0])
  assert.ok(Math.max(...pts.map((p) => a.distanceTo(p))) <= 0.05)
  const ring: number[][] = []
  for (let i = 0; i < 60; i++) ring.push([10 * Math.cos((2 * Math.PI * i) / 60), 6 * Math.sin((2 * Math.PI * i) / 60)])
  const c = fitCurve(ring, { tolerance: 0.01, closed: true })
  assert.ok(c.isClosed && c.tangentAt(0).angleTo(c.tangentAt(1)) < 1e-6)
  assert.ok(Math.max(...ring.map((p) => c.distanceTo(p))) <= 0.01)
  const few = fitCurve([[0, 0], [1, 1], [2, 0]])
  for (const p of [[0, 0], [1, 1], [2, 0]]) assert.ok(few.distanceTo(p) < 1e-9)
  assert.throws(() => fitCurve(pts, { degree: 1 }), /degree/)
  assert.throws(() => fitCurve(ring, { closed: true, tangents: [[1, 0], null] }), /closed curve takes no end tangents/)
})

test('splines take a tangent at every point', () => {
  const pts = [[0, 0], [10, 0], [20, 10], [20, 20]]
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1]]
  const s = Spline(...pts, { tangents: dirs })
  pts.forEach((p, i) => {
    const t = s.paramAt(p)
    assert.ok(s.pointAt(t).distanceTo(p) < 1e-9)
    assert.ok(s.tangentAt(t).angleTo(dirs[i]) < 1e-6)
  })
  assert.throws(() => Spline(...pts, { tangents: dirs.slice(0, 3) }), /one per point/)
})

// -- C9 ---------------------------------------------------------------------------------------------
test('curvature, the smallest radius and inflections', () => {
  const s = Spline([0, 0], [10, 5], [20, -3], [30, 4])
  const [r, t] = s.minRadius()
  approx(r, 3.997484385833472, 1e-9) // OpenCASCADE
  near(s.pointAt(t), [20.778561798465574, -3.1697513165695037, 0], 1e-6)
  approx(s.radiusAt(t), r, 1e-9)
  approx(s.curvatureAt(t), 1 / r, 1e-9)
  const inf = s.inflections()
  assert.equal(inf.length, 1)
  near(s.pointAt(inf[0]), [14.951181948137158, 0.9954275141867979, 0], 1e-6) // OpenCASCADE
  assert.ok(s.curvatureAt(inf[0]) < 1e-9)
  const [rr, tr] = s.reversed().minRadius()
  approx(rr, r)
  approx(tr, 1 - t)
  approx(s.reversed().inflections()[0], 1 - inf[0])
  const e = EllipticalArc([0, 0], 20, 10, 0, 180)
  approx(e.minRadius()[0], 5)
  approx(e.curvatureAt(0.5), 10 / 400)
  assert.deepEqual(e.inflections(), [])
  assert.deepEqual(Line([0, 0], [5, 5]).minRadius(), [Infinity, 0])
  assert.equal(Line([0, 0], [5, 5]).radiusAt(), Infinity)
  approx(CenterArc([0, 0], 7, 0, 90).minRadius()[0], 7)
  const w = new Wire([Line([0, 0], [10, 0]), Spline([10, 0], [20, 5], [30, 0])])
  const [rw, tw] = w.minRadius()
  approx(rw, w.edges()[1].minRadius()[0])
  assert.ok(10 / w.length < tw && tw < 1)
})

test('free curves have exact boxes', () => {
  const b = Spline([0, 0], [1, 1], [2, 0], [30, 0]).bbox()
  approx(b.max.y, 1.0069069109354301, 0, 1e-12) // OpenCASCADE (sampled before: 0.7998)
  approx(b.min.y, -1.1436479595277323, 0, 1e-12)
})

test('sweep errors name the tightest bend', () => {
  const path = Spline([0, 0, 0], [10, 0, 5], [10, 10, 10], [0, 10, 15])
  assert.throws(() => sweep(Rectangle(10, 5), path), /bends with a radius of 4\.556 .*reaches 5\.59 from the path/)
})

// -- C10 --------------------------------------------------------------------------------------------
test('toArcs keeps within the tolerance', () => {
  const s = Spline([0, 0], [10, 5], [20, -3], [30, 4])
  for (const tol of [0.01, 0.001]) {
    const w = s.toArcs(tol)
    const es = w.edges()
    assert.ok(es.every((e) => e.geomType === 'line' || e.geomType === 'circle'))
    let worst = 0
    for (const e of es) for (let i = 0; i <= 8; i++) worst = Math.max(worst, s.distanceTo(e.pointAt(i / 8)))
    for (let i = 0; i <= 400; i++) worst = Math.max(worst, w.distanceTo(s.pointAt(i / 400)))
    assert.ok(worst <= tol, String(worst))
    assert.ok(w.start.distanceTo(s.start) < 1e-9 && w.end.distanceTo(s.end) < 1e-9)
    for (let i = 0; i + 1 < es.length; i++) assert.ok(es[i].tangentAt(1).angleTo(es[i + 1].tangentAt(0)) < 1e-4)
  }
  assert.equal(s.toArcs(0.01).edges().length, 26)
  const e = EllipticalArc([0, 0], 20, 10, 0, 300)
  const w = e.toArcs(0.01)
  let worst = 0
  for (let i = 0; i <= 400; i++) worst = Math.max(worst, w.distanceTo(e.pointAt(i / 400)))
  assert.ok(worst <= 0.01)
  const line = Line([0, 0], [1, 1])
  assert.equal(line.toArcs().edges()[0], line)
  approx(new Wire([line, Line([1, 1], [2, 0])]).toArcs().length, 2 * Math.SQRT2)
})

test('DXF with lines and arcs only', () => {
  const s = Spline([0, 0], [10, 5], [20, -3], [30, 4])
  const region = Ellipse(20, 10).cut(Circle(3))
  const text = toDxf([s, region], { curves: 'arcs', tolerance: 0.01 })
  const lines = text.split(/\r?\n/)
  const kinds = new Set(lines.filter((_, i) => i > 0 && lines[i - 1].trim() === '0').map((x) => x.trim()))
  assert.ok(!kinds.has('SPLINE') && !kinds.has('ELLIPSE') && kinds.has('ARC') && kinds.has('CIRCLE'))
  const back = fromDxfWires(text)
  approx(back.reduce((a, w) => a + w.length, 0), s.length + region.edges()[0].length + 6 * Math.PI, 1e-4)
  assert.throws(() => toDxf(s, { curves: 'lines' }), /curves is 'exact' or 'arcs'/)
})
