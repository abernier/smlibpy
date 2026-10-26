// tests/test_lane_C.py: curves (kernel plan, lane C): 2D unions of touching xor sketches (C1),
// trimming, splitting and locating points on edges (C2), ellipse curves (C3), helices of any number
// of turns (C4), curve intersections with a tolerance (C5), extended and joined edges (C6), offsets
// of edges and wires and strokes along splines (C7), curves fitted to points (C8), curvature,
// inflections and exact boxes (C9), curves as lines and arcs (C10), edges from NURBS data (C11),
// projections onto bodies and faces, iso curves and wrapping (C12), splines in linear time and closed
// ones curvature continuous (C13), conic arcs and flat spirals (C14), wire and sketch fillets at
// arcs, splines and ellipses (C15), edges bent through a point or to new ends (C16).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Align, Axis, Box, CenterArc, Circle, ConicArc, Cylinder, Edge, Ellipse, EllipticalArc, FilletPolyline, Helix, HyperbolicArc, Line,
  ModelingError, Nurbs, ParabolicArc, type Part, Plane, Polyline, Rectangle, Sphere, Spiral, Spline, Stroke, ThreePointArc, Vector, Wire,
  Z, fitCurve, fromDxfWires, makeFace, offset, ruled, sweep, toDxf,
} from '../src/index.ts'
import { k } from '../src/kernel.ts'
import { Curve2 } from '../src/_planar.ts'
import { segOfEdge, wireFrame } from '../src/_regions.ts'
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
  const t = s.paramAtPoint(x[0])
  assert.ok(s.pointAt(t).distanceTo(x[0]) < 1e-9)
  approx(t, a.length / s.length, 0, 1e-12)
  near(s.closestPoint([10, 20]), [10, 10, 0])
  approx(s.paramAtPoint([10, 20]), 0.5, 0, 1e-12)
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
  for (const end of ['start', 'end', 'both'] as const) {
    const x = el.extend(5, { end })
    assert.equal(x.geomType, 'ellipse')
    approx(x.length, el.length + (end === 'both' ? 10 : 5), 0, 1e-8)
  }
  assert.throws(() => CenterArc([0, 0], 10, 0, 300).extend(11), /whole circle/)
  assert.throws(() => CenterArc([0, 0], 10, 0, 360).extend(1), /closed edge/)
  const s = Spline([0, 0], [10, 10], [20, 0])
  for (const continuity of ['G1', 'G2', 'natural'] as const) approx(s.extend(5, { continuity }).length, s.length + 5, 0, 1e-8)
  const g1 = s.extend(5, { end: 'both' })
  assert.ok(g1.end.distanceTo(s.end.add(s.tangentAt(1).mul(5))) < 1e-9)
  assert.throws(() => s.extend(1, { continuity: 'C2' as never }), /continuity/)
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
  // (the kernel offsets the fitted curve within 1e-6 of the path's size, 4e-5 here: 1e-4 for the length.
  // Before 0.5.0's fitCurve, the fitted arc happened to pass segOfEdge's test for a circle and was
  // offset as an exact arc, not by the kernel.)
  const exact = arcLikePath(false)
  const fitted = arcLikePath(true)
  assert.ok(segOfEdge(fitted.edges()[1], wireFrame(fitted.edges(), null, 'test')) instanceof Curve2)
  for (const d of [1.5, -1.5]) {
    for (const corners of ['round', 'sharp', 'chamfer'] as const) {
      const a = exact.offset(d, { corners })
      const b = fitted.offset(d, { corners })
      approx(b.length, a.length, 0, 1e-4)
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
    for (const corners of ['round', 'sharp'] as const) approx(lens.offset(d, { corners }).toSketch().area, region.offset(d, { corners }).area, 1e-5)
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
  const fband = 2 * fitted.length * 1e-6 * fitted.bbox().diagonal // (the fitted arc's sides: the kernel's offsets)
  for (const corners of ['round', 'sharp', 'chamfer'] as const) {
    for (const ends of ['round', 'flat'] as const) approx(Stroke(fitted, 3, { ends, corners }).area, Stroke(exact, 3, { ends, corners }).area, 0, fband)
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

// (smlibpy's test_fit_curve_smooths_noisy_points: np.random.default_rng(3).normal(0, 0.15) round the ring
// (30 cos t, 18 sin t, 6 sin 3t), 80 points)
const NOISY_RING: number[][] = [
  [30.306137868207777, -0.38334975469712723, 0.06271482700886682], [29.822354571074648, 1.3443663292846422, 1.3683326086719674],
  [29.327652298482043, 2.7810305140775275, 2.5941610369960397], [29.66954753942703, 4.235884541390485, 3.8437936708298626],
  [28.489502376131902, 5.462098946832711, 4.695829383568917], [27.657765828753405, 6.960593590847633, 5.507494154081715],
  [26.873859531095, 8.141858675951855, 5.929768978332326], [25.81107805830469, 9.486739993290225, 5.905719692056665],
  [24.243083985058764, 10.661213311027737, 5.99660230288575], [22.77173591889964, 11.65353106808144, 5.266188026315907],
  [21.08023444412234, 12.684164026491876, 4.375021532237758], [19.570493952334143, 13.70103488629291, 3.2355070415199654],
  [17.20933322274763, 14.715501921374067, 1.710155252278464], [15.424663965080072, 15.38898982230181, 0.575836307169479],
  [13.552999873833988, 15.8766565593755, -0.9346880652112793], [11.472590874716264, 16.840671310105876, -2.1839893960686356],
  [9.299582178188116, 17.28576227409636, -3.557539971240707], [6.864475979629909, 17.590267313811967, -4.47505503080183],
  [4.6608096145379, 17.660968844017887, -5.311666059348218], [1.9796887300666512, 18.048030722720725, -5.760514283274311],
  [-0.2458285715835714, 18.009203026475724, -6.144614949531186], [-2.2401897151216237, 17.639386916179788, -5.971393703085249],
  [-4.586596953045614, 17.951850287977305, -5.669739952149139], [-7.078066892389855, 17.551861581039564, -4.653818214292666],
  [-9.031913796549949, 16.940333291070097, -3.4735317218118014], [-11.637763798734369, 16.840726026673394, -2.2993482785488757],
  [-13.675552576786496, 15.78038969293073, -0.6863329584813846], [-15.562040152573855, 15.460557534000065, 0.641436763204738],
  [-17.581173582055737, 14.466418907162591, 1.7340657821951677], [-19.603471446809657, 13.892818232000614, 2.9159342081163775],
  [-21.30265886236204, 12.679735473464927, 4.276333540921648], [-22.725876559724753, 11.502700318578977, 4.8563389684336755],
  [-24.27117196614172, 10.76216911505743, 5.8198978066653995], [-25.546857313067772, 9.357400818284479, 6.0254890567688015],
  [-26.76669598851236, 8.294409982385732, 5.806962942737795], [-27.696249983275653, 6.871684762154879, 5.624781103497243],
  [-28.497999710307198, 5.944811094195241, 5.078900179970009], [-28.94658703710252, 3.896090973767103, 3.8456407962757493],
  [-29.721941810241066, 2.8957286107075135, 2.3820890250789786], [-29.73134521014246, 1.5723112197355082, 1.205361554398563],
  [-30.146782279293213, -0.12017580161717503, 0.0064943850424739515], [-29.811374352290418, -1.1050808147976068, -1.4302889976185782],
  [-29.51552483401859, -2.792507699215238, -2.4599540558510355], [-29.059773932748566, -3.9967339817751233, -4.058339568448622],
  [-28.5605315955835, -5.684371762025357, -4.628359855648437], [-27.61773998976594, -6.934073446438242, -5.611147378128279],
  [-26.65749599392003, -8.277053324838773, -6.06571837500265], [-25.50701375678204, -9.035504360071295, -6.01842403550849],
  [-24.353889698367457, -10.755808066368347, -5.90659074140483], [-22.733431482816297, -11.56244441502652, -5.1144647779921835],
  [-21.163317037295, -12.71053457473179, -4.2218424602122075], [-19.71236530779295, -13.756025121757935, -3.11826949215721],
  [-17.75103258585875, -14.633770360328025, -1.9769699932988476], [-15.724981442608224, -15.219556717224892, -0.5317416269654043],
  [-13.642795594215976, -15.916059681474904, 1.0353223223649248], [-11.226221837108765, -16.943404346922446, 2.424629435868994],
  [-9.34285244426439, -17.09881352049008, 3.652369421489696], [-6.840872942323452, -17.34675596361185, 4.585701797261927],
  [-4.451584548754184, -17.8208362647949, 5.324891858169585], [-2.233870193501254, -18.02721786839337, 6.1583554611912446],
  [0.1528809848031878, -17.67366370160694, 5.996011621926633], [2.2963095892961602, -17.91945480687126, 5.944405997776988],
  [4.6049197981758185, -17.721434868666613, 5.3435185032920804], [7.2457131797636105, -17.60206383900331, 4.7193600593595],
  [9.173930300917416, -17.26311242227888, 3.420166599648498], [11.301975091676363, -16.607879031193193, 2.4507897136023344],
  [13.644362223966619, -15.94446866856289, 1.1834329195776638], [15.71546090855528, -15.3182486042292, -0.5120137945610992],
  [17.392321226022496, -14.448345058968844, -2.117571033393568], [19.58134291536309, -13.689455431160647, -2.9659741706741407],
  [21.20303789651985, -12.85140208505151, -4.188954147106398], [22.728143547644695, -11.717208393642586, -5.109560368095247],
  [24.25032737448657, -10.608454882510593, -5.831205846013978], [25.55083486300885, -9.72572525595523, -6.005103816682553],
  [26.550487327761246, -8.003789441759793, -5.73564103147264], [27.42373210826041, -6.866564264016744, -5.562231783392742],
  [28.374688144342475, -5.482557927351708, -4.923355397947893], [28.905957747577308, -4.242018047214838, -3.9189262577261217],
  [29.64661487059035, -3.0005053205340753, -2.6315908593990414], [30.01783857522367, -1.5841378146294578, -1.4995005184829209],
]

test('fitCurve smooths noisy points', () => {
  // 80 points round a ring in space with noise (the worst 0.50 off): a least-squares fit within 0.6 of
  // every point with 15 control points, smooth all round. The kernel's approximation
  // (SmBSplineCurve::ApproximatePoints) needed 31 and followed the noise. (The noise is smlibpy's
  // test's, numpy's generator: its points here.)
  const pts = NOISY_RING
  const c = fitCurve(pts, { tolerance: 0.6, closed: true })
  assert.ok(Math.max(...pts.map((p) => c.distanceTo(p))) <= 0.6 && c.nurbs().points.length <= 20)
  assert.ok(c.isClosed && c.start.distanceTo(pts[0]) <= 0.6) // (near the first point)
  assert.ok(c.tangentAt(0).angleTo(c.tangentAt(1)) < 1e-6)
  // a fitted quarter circle (tight tolerance) leaves its ends along the circle
  const arc = CenterArc([10, 10], 10, -90, 90)
  const f = fitCurve(Array.from({ length: 201 }, (_, i) => arc.pointAt(i / 200)), { tolerance: 1e-6 })
  assert.ok(f.nurbs().points.length < 30)
  for (const u of [0, 1]) assert.ok(f.tangentAt(u).angleTo(arc.tangentAt(u)) < 1e-6)
})

test('splines take a tangent at every point', () => {
  const pts = [[0, 0], [10, 0], [20, 10], [20, 20]]
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1]]
  const s = Spline(...pts, { tangents: dirs })
  pts.forEach((p, i) => {
    const t = s.paramAtPoint(p)
    assert.ok(s.pointAt(t).distanceTo(p) < 1e-9)
    assert.ok(s.tangentAt(t).angleTo(dirs[i]) < 1e-6)
  })
  assert.throws(() => Spline(...pts, { tangents: dirs.slice(0, 3) }), /one per point/)
})

// -- C9 ---------------------------------------------------------------------------------------------
test('curvature, the smallest radius and inflections', () => {
  const s = Spline([0, 0], [10, 5], [20, -3], [30, 4])
  const [r, t] = [s.minRadius(), s.minRadiusAt()]
  approx(r, 3.997484385833472, 1e-9) // OpenCASCADE
  near(s.pointAt(t), [20.778561798465574, -3.1697513165695037, 0], 1e-6)
  approx(s.radiusAt(t), r, 1e-9)
  approx(s.curvatureAt(t), 1 / r, 1e-9)
  const inf = s.inflections()
  assert.equal(inf.length, 1)
  near(s.pointAt(inf[0]), [14.951181948137158, 0.9954275141867979, 0], 1e-6) // OpenCASCADE
  assert.ok(s.curvatureAt(inf[0]) < 1e-9)
  const [rr, tr] = [s.reversed().minRadius(), s.reversed().minRadiusAt()]
  approx(rr, r)
  approx(tr, 1 - t)
  approx(s.reversed().inflections()[0], 1 - inf[0])
  const e = EllipticalArc([0, 0], 20, 10, 0, 180)
  approx(e.minRadius(), 5)
  approx(e.curvatureAt(0.5), 10 / 400)
  assert.deepEqual(e.inflections(), [])
  assert.deepEqual([Line([0, 0], [5, 5]).minRadius(), Line([0, 0], [5, 5]).minRadiusAt()], [Infinity, 0])
  assert.equal(Line([0, 0], [5, 5]).radiusAt(), Infinity)
  approx(CenterArc([0, 0], 7, 0, 90).minRadius(), 7)
  const w = new Wire([Line([0, 0], [10, 0]), Spline([10, 0], [20, 5], [30, 0])])
  const [rw, tw] = [w.minRadius(), w.minRadiusAt()]
  approx(rw, w.edges()[1].minRadius())
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
  assert.throws(() => toDxf(s, { curves: 'lines' as never }), /curves is 'exact' or 'arcs'/)
})

// -- C11 ---------------------------------------------------------------------------------------------
test('Edge.fromNurbs is the inverse of nurbs()', () => {
  for (const e of [CenterArc([0, 0], 10, 0, 90), Spline([0, 0], [10, 5], [20, 0], [30, 8]), Helix(5, 20, 10), Line([0, 0], [5, 5]),
    EllipticalArc([0, 0], 10, 5, 0, 120)]) {
    const f = Edge.fromNurbs(e.nurbs())
    assert.equal(f.geomType, 'bspline')
    assert.ok(f.start.distanceTo(e.start) < 1e-12 && f.end.distanceTo(e.end) < 1e-12)
    approx(f.length, e.length, 1e-12)
    for (let i = 0; i <= 10; i++) assert.ok(f.pointAt(i / 10).distanceTo(e.pointAt(i / 10)) < 1e-9)
  }
  const n = Spline([0, 0], [10, 5], [20, 0], [30, 8]).nurbs()
  const points = [...n.points]
  points[2] = points[2].add([0, 0, 1])
  const moved = Edge.fromNurbs(new Nurbs(n.degree, n.knots, points, n.weights))
  near(moved.start, [0, 0, 0], 0)
  near(moved.end, [30, 8, 0], 1e-12)
  assert.ok(moved.pointAt(0.5).z > 0.3)
  // a uniform cubic B-spline (unclamped knots) starts at (P0 + 4 P1 + P2) / 6
  const u = Edge.fromNurbs({ degree: 3, knots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], points: [[0, 0], [10, 10], [20, 0], [30, 10], [40, 0], [50, 10]], weights: null })
  near(u.start, [10, 20 / 3, 0], 1e-12)
  const q = Edge.fromNurbs(new Nurbs(2, [0, 0, 0, 1, 1, 1], [new Vector(10, 0, 0), new Vector(10, 10, 0), new Vector(0, 10, 0)], [1, Math.SQRT1_2, 1]))
  for (let i = 0; i <= 20; i++) approx(q.pointAt(i / 20).length, 10, 0, 1e-12)
  const six = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 1]]
  assert.throws(() => Edge.fromNurbs({ degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1], points: six }), /take 10 knots/)
  assert.throws(() => Edge.fromNurbs({ degree: 3, knots: [0, 0, 0, 0, 2, 1, 3, 3, 3, 3], points: six }), /must not decrease/)
  assert.throws(() => Edge.fromNurbs({ degree: 2, knots: [0, 0, 0, 1, 1, 1], points: six.slice(0, 3), weights: [1, 0, 1] }), /weights must be positive/)
  assert.throws(() => Edge.fromNurbs({ degree: 2, knots: [0, 0, 0, 1, 1, 1, 2, 2, 2], points: six }), /repeated 3 times/)
  assert.throws(() => Edge.fromNurbs({ degree: 0, knots: [0, 1], points: [[0, 0]] }), /degree is a whole number from 1 to 32/)
  assert.throws(() => Edge.fromNurbs(5 as unknown as Nurbs), { name: 'TypeError', message: /takes a Nurbs/ })
})

// -- C12 ---------------------------------------------------------------------------------------------
const offSphere = (edges: Edge[], r = 10) => {
  let w = 0
  for (const e of edges) for (let i = 0; i <= 100; i++) w = Math.max(w, Math.abs(e.pointAt(i / 100).length - r))
  return w
}

test('project fits within the size and keeps the near side', () => {
  const dome = Sphere(10)
  const circle = CenterArc([0, 0, 30], 5, 0, 360)
  const both = dome.project(circle)
  assert.deepEqual(both.map((e) => Math.round(e.center().z * 1e4) / 1e4).sort((a, b) => a - b), [-8.6603, 8.6603])
  assert.ok(offSphere(both) < 1e-7 * 50)
  const nearest = dome.project(circle, [0, 0, -1], { nearest: true })
  assert.equal(nearest.length, 1)
  approx(nearest[0].center().z, 8.660254, 0, 1e-6)
  const plate = Box(40, 40, 10).cut(Cylinder(5, 20))
  const line = Line([-30, 0, 8], [30, 0, 8])
  assert.equal(plate.project(line).length, 8)
  const seen = plate.project(line, [0, 0, -1], { nearest: true })
  assert.deepEqual(seen.map((e) => [Math.round(e.start.x * 1e6) / 1e6, Math.round(e.end.x * 1e6) / 1e6]).sort((a, b) => a[0] - b[0]), [[-5, -20], [20, 5]])
  const step = Box(40, 20, 10, { align: [Align.MIN, Align.CENTER, Align.MIN] }).fuse(Box(20, 20, 10, { align: [Align.MIN, Align.CENTER, Align.MIN] }).translate(0, 0, 10))
  const low = step.project(Line([0, 0, 40], [50, 0, 40]), [1, 0, -1], { nearest: true })
  assert.equal(low.length, 1)
  near(low[0].start, [30, 0, 10], 1e-6)
  near(low[0].end, [40, 0, 10], 1e-6)
  assert.equal(dome.project(CenterArc([0, 0, 30], 15, 0, 360)).length, 0)
})

test('Face.project is the normal projection', () => {
  const side = Cylinder(10, 40).faces().cylinders()[0]
  const a = new Vector(-30, -15, 5)
  const b = new Vector(30, -15, -5)
  const [e] = side.project(Line(a, b))
  const h = Math.hypot(30, 15)
  near(e.start, [(-30 / h) * 10, (-15 / h) * 10, 5], 1e-6)
  for (let i = 0; i <= 20; i++) {
    const q = e.pointAt(i / 20)
    const p = a.add(b.sub(a).mul((q.z - a.z) / (b.z - a.z)))
    assert.ok(Math.abs(Math.hypot(q.x, q.y) - 10) < 1e-5)
    assert.ok(Math.abs(Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x)) * 10 < 1e-5)
  }
  const top = Box(40, 40, 10).cut(Cylinder(5, 20)).faces().sortBy(Z).at(-1)!
  const pieces = top.project(Line([-30, 0, 9], [30, 0, 9]))
  assert.deepEqual(pieces.map((p) => [Math.round(p.start.x * 1e6) / 1e6, Math.round(p.end.x * 1e6) / 1e6]).sort((x, y) => x[0] - y[0]), [[-20, -5], [5, 20]])
})

test('Face.iso and Face.wrap', () => {
  const side = Cylinder(10, 40).faces().cylinders()[0]
  const [ring] = side.iso({ v: 0.5 })
  approx(ring.length, 20 * Math.PI, 1e-9)
  assert.ok(ring.isClosed)
  const [line] = side.iso({ u: 0.25 })
  approx(line.length, 40, 1e-12)
  assert.equal(Box(40, 40, 10).cut(Cylinder(5, 20)).faces().sortBy(Z).at(-1)!.iso({ u: 0.5 }).length, 2)
  assert.throws(() => side.iso(), /give u or v/)
  assert.throws(() => side.iso({ v: 1.5 }), /from 0 to 1/)
  const w = side.wrap(Line([-20, 0], [20, 0]), [0, -10, 0], { direction: [1, 0, 0] })
  approx(w.reduce((s, e) => s + e.length, 0), 40, 0, 1e-5)
  const ends = [...w.map((e) => e.start), ...w.map((e) => e.end)]
  for (const t of [-Math.PI / 2 - 2, -Math.PI / 2 + 2]) assert.ok(Math.min(...ends.map((p) => p.distanceTo([10 * Math.cos(t), 10 * Math.sin(t), 0]))) < 1e-6)
  const rect = side.wrap(Rectangle(20, 10), [0, -10, 0], { direction: [1, 0, 0] })
  assert.deepEqual(rect.map((e) => Math.round(e.length * 1e5) / 1e5).sort((a, b) => a - b), [10, 10, 20, 20])
  const top = Box(40, 40, 10).cut(Cylinder(5, 20)).faces().sortBy(Z).at(-1)!
  assert.deepEqual(top.wrap(Line([-30, 0], [30, 0])).map((e) => [Math.round(e.start.x * 1e6) / 1e6, Math.round(e.end.x * 1e6) / 1e6]).sort((a, b) => a[0] - b[0]), [[-20, -5], [5, 20]])
  assert.throws(() => side.wrap(Line([0, 0], [1, 0]), [0, 0, 0]), /point of the face's surface/)
  assert.throws(() => side.wrap(Line([0, 0], [1, 0]), [0, -10, 0], { direction: [0, -1, 0] }), /normal to the face/)
})

// -- C13 ---------------------------------------------------------------------------------------------
test('splines of many points: linear time, the same curve; closed ones curvature continuous', () => {
  const pts: number[][] = []
  for (let i = 0; i < 1600; i++) {
    const t = (6 * i) / 1599
    pts.push([Math.cos(t) * 50 + 3 * Math.sin(7 * t), Math.sin(t) * 30])
  }
  const t0 = performance.now()
  const e = Spline(...(pts as [number, number][]))
  assert.ok(performance.now() - t0 < 500)
  approx(e.length, 253.31646562349, 1e-10)
  const p = Spline([0, 0, 0], [10, 5, 3], [20, 0, -2], [30, 8, 1], [31, 9, 7]).nurbs().points
  near(p[1], [3.37902164578829, 3.2869916728601445, 2.2916911737092867], 1e-12)
  const s = Spline([0, 0], [30, -5], [50, 10], [35, 30], [10, 25], [-8, 12], { closed: true })
  assert.ok(s.isClosed && s.tangentAt(0).angleTo(s.tangentAt(1)) < 1e-6)
  approx(s.curvatureAt(0), s.curvatureAt(1), 1e-9)
  approx(s.curvatureAt(0), 0.03247170528591742, 1e-9)
  assert.throws(() => Spline([0, 0], [10, 0], { closed: true }), /at least three points/)
})

// -- C14 ---------------------------------------------------------------------------------------------
test('conic arcs are exact; flat spirals', () => {
  const p = ParabolicArc([0, 0], 10, -20, 20)
  near(p.start, [-20, 10, 0], 0)
  for (let i = 0; i <= 50; i++) {
    const q = p.pointAt(i / 50)
    assert.ok(Math.abs(q.y - (q.x * q.x) / 40) < 1e-12)
  }
  const h = HyperbolicArc([0, 0], 10, 20, -30, 30)
  for (let i = 0; i <= 50; i++) {
    const q = h.pointAt(i / 50)
    assert.ok(Math.abs((q.x * q.x) / 100 - (q.y * q.y) / 400 - 1) < 1e-12)
  }
  const c = ConicArc([10, 0], [10, 10], [0, 10], Math.SQRT2 - 1)
  for (let i = 0; i <= 50; i++) approx(c.pointAt(i / 50).length, 10, 0, 1e-12)
  assert.ok(ConicArc([0, 0], [10, 0], [10, 10]).distanceTo([7.5, 2.5, 0]) < 1e-12)
  assert.throws(() => ConicArc([0, 0], [1, 0], [2, 0]), /on one line/)
  assert.throws(() => ParabolicArc([0, 0], 0, 1, 2), /must not be zero/)
  const s = Spiral(2, 20, 5)
  near(s.start, [2, 0, 0], 0)
  near(s.end, [20, 0, 0], 1e-9)
  for (let i = 0; i <= 200; i++) {
    const q = s.pointAt(i / 200)
    const turned = ((Math.hypot(q.x, q.y) - 2) / 18) * 10 * Math.PI
    const d = (((Math.atan2(q.y, q.x) - turned + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
    assert.ok(Math.abs(d) * (18 / (10 * Math.PI)) < 2e-4 && q.z === 0)
  }
  near(Spiral(0, 20, 5).start, [0, 0, 0], 0)
  near(Spiral(20, 0, 5, Plane.XZ, { clockwise: true }).end, [0, 0, 0], 0)
  near(Spiral(2, 20, 150).end, [20, 0, 0], 1e-6)
  const groove = sweep(Rectangle(0.5, 1), s) as Part
  assert.ok(groove.isValid())
  approx(groove.volume, 0.5 * s.length, 1e-3)
  assert.throws(() => Spiral(5, 5, 3), /must differ/)
  assert.throws(() => Spiral(2, 20, 0.5), /fitCurve through points of the spiral makes it/) // (less than a turn, a large change of radius)
})

// -- C15 ---------------------------------------------------------------------------------------------
test('Wire.fillet rounds corners with arcs and names what it cannot round', () => {
  const w = new Wire([Line([0, 0], [10, 0]), ThreePointArc([10, 0], [13, 5], [10, 10]), Line([10, 10], [0, 10])])
  const f = w.fillet(2)
  assert.deepEqual(f.edges().map((e) => e.geomType), ['line', 'circle', 'circle', 'circle', 'line'])
  const es = f.edges()
  for (let i = 0; i + 1 < es.length; i++) assert.ok(es[i].tangentAt(1).angleTo(es[i + 1].tangentAt(0)) < 1e-6)
  const closed = new Wire([Line([0, 0], [10, 0]), ThreePointArc([10, 0], [13, 5], [10, 10]), Line([10, 10], [0, 10]), Line([0, 10], [0, 0])])
  const region = makeFace(closed)
  approx(makeFace(closed.fillet(1)).area, region.fillet(1, region.vertices()).area, 1e-12)
  assert.throws(() => w.fillet(2, [[55, 55]]), { name: 'ModelingError', message: /\(55, 55\) is not a corner of the wire; its corners are at \(10, 0\)/ })
  assert.throws(() => w.fillet(2, [[0, 0]]), /is an end of the open wire/)
  assert.throws(() => w.fillet(2, []), /selection is empty/)
  assert.throws(() => new Wire([Line([0, 0], [10, 0]), CenterArc([10, 5], 5, -90, 180)]).fillet(1, [[10, 0]]), /is smooth/)
  assert.throws(() => new Wire([Line([0, 0, 0], [10, 0, 0]), Spline([10, 0, 0], [12, 5, 1], [10, 10, 6])]).fillet(1), /not planar/)
  assert.deepEqual(FilletPolyline([0, 0, 0], [30, 0, 0], [30, 20, 10], { radius: 5 }).edges().map((e) => e.geomType), ['line', 'circle', 'line'])
  assert.throws(() => Polyline([0, 0], [20, 0], [20, 10], [0, 10], { close: true }).fillet(5.001), { name: 'RangeError', message: /overlap/ })
})

test('fillets at spline and ellipse corners', () => {
  const w = new Wire([Line([0, 0], [10, 0]), Spline([10, 0], [14, 4], [12, 8], [10, 10]), Line([10, 10], [0, 10])])
  const arcs = w.fillet(2).edges().filter((e) => e.geomType === 'circle')
  // OpenCASCADE (ChFi2d_FilletAPI): centers (9.507884445553, 2) and (9.316103414, 7.99999996)
  near(arcs[0].arcCenter, [9.507884445553, 2, 0], 1e-9)
  near(arcs[0].end, [10.45551014916122, 0.23874887484462426, 0], 1e-9)
  near(arcs[1].arcCenter, [9.316103414, 8, 0], 1e-7)
  for (const a of arcs) approx(w.edges()[1].distanceTo(a.arcCenter), 2, 0, 1e-9)
  const region = makeFace(w.close())
  const rounded = region.fillet(2)
  approx(rounded.area, 124.12092870628695, 1e-9)
  approx(region.chamfer(1.5).area, 122.3254869677154, 1e-9)
  const e = EllipticalArc([10, 0], 10, 5, 180, 300)
  const ell = new Wire([Line([-20, 0], [0, 0]), e, Line(e.end, [20, 10]), Line([20, 10], [-20, 10]), Line([-20, 10], [-20, 0])])
  const r = makeFace(ell).fillet(1)
  assert.ok(r.edges().some((x) => x.geomType === 'ellipse'))
  approx(r.area, 448.215432183746, 1e-9)
  const tight = new Wire([Spline([0, 0], [10, 5], [20, 0], { tangents: [[0, 1], [0, -1]] }), Line([20, 0], [0, 0])])
  near(tight.fillet(2.5, [[20, 0]]).edges().filter((x) => x.geomType === 'circle')[0].arcCenter, [10, 2.5, 0], 1e-6)
  assert.throws(() => tight.fillet(3, [[20, 0]]), /no arc of radius 3 touches both segments/)
})

// -- C16 ---------------------------------------------------------------------------------------------
test('Edge.through and Edge.match', () => {
  const s = Spline([0, 0, 0], [10, 8, 0], [25, 5, 0], [40, 12, 0], [52, 10, 0], [60, 0, 0])
  const e = s.through([25, 8, 3])
  assert.ok(e.distanceTo([25, 8, 3]) < 1e-12)
  assert.ok(e.start.equals(s.start) && e.end.equals(s.end))
  assert.ok(e.tangentAt(0).angleTo(s.tangentAt(0)) < 1e-6 && e.tangentAt(1).angleTo(s.tangentAt(1)) < 1e-6)
  const t = s.through([25, 8, 3], { tangent: [1, 0, 0] })
  assert.ok(t.distanceTo([25, 8, 3]) < 1e-12 && t.tangentAt(t.paramAtPoint([25, 8, 3])).angleTo([1, 0, 0]) < 1e-6)
  assert.ok(s.through([30, 20, 0], { at: 0.5 }).distanceTo([30, 20, 0]) < 1e-12)
  const line = Line([0, 0], [10, 0]).through([5, 2])
  assert.ok(line.distanceTo([5, 2, 0]) < 1e-12 && line.nurbs().degree === 3)
  const arc = CenterArc([0, 0], 10, 0, 90).through([8, 8])
  assert.ok(arc.distanceTo([8, 8, 0]) < 1e-12 && arc.nurbs().weights !== null)
  assert.throws(() => s.through([-5, 0, 0]), /nearest to an end/)
  assert.throws(() => s.through([25, 8, 3], { at: 1 }), /strictly between 0 and 1/)
  const m = s.match({ end: [52, 10, 4], endTangent: [0, 1, 0] })
  assert.ok(m.end.distanceTo([52, 10, 4]) < 1e-12 && m.tangentAt(1).angleTo([0, 1, 0]) < 1e-6)
  assert.ok(m.start.equals(s.start) && m.tangentAt(0).angleTo(s.tangentAt(0)) < 1e-6)
  const moved = Line([0, 0], [10, 0]).match({ start: [0, 1], startTangent: [1, 1] })
  near(moved.start, [0, 1, 0], 0)
  assert.ok(moved.tangentAt(0).angleTo([1, 1, 0]) < 1e-6 && moved.tangentAt(1).angleTo([1, 0, 0]) < 1e-6)
  assert.throws(() => s.match(), /give start, end/)
})


// -- review of 0.5.0 ------------------------------------------------------------------------------
import * as RV from '../src/index.ts'

test('points along long helices take time in proportion to their turns', () => {
  // A point along a helix of 1000 turns took a second: each span of the arc length walk looked the
  // knots of the whole curve up again.
  const h = RV.Helix(0.5, 500, 3)
  const started = performance.now()
  const points = Array.from({ length: 21 }, (_, i) => h.pointAt(i / 20))
  assert.ok(performance.now() - started < 5000)
  assert.ok(Math.abs(points[10].z - 250) < 1e-3 && Math.abs(Math.hypot(points[10].x, points[10].y) - 3) < 1e-3)
})

test('a wire rounds one corner given alone', () => {
  const w = Polyline([0, 0], [20, 0], [20, 20])
  const one = w.fillet(2, [20, 0])
  assert.equal(one.edges().length, 3)
  approx(one.length, 36 + Math.PI)
  approx(w.fillet(2, w.vertices()[1]).length, one.length)
  approx(w.fillet(2, [[20, 0]]).length, one.length)
})

test('a wire offset that collapses says so', () => {
  // (the inside of a strip 2 wide, moved 2 inward: its short sides shrink to nothing)
  assert.throws(() => Polyline([0, 0], [40, 0], [40, 2], [0, 2], { close: true }).offset(-2), /moved by 2, a side of it shrinks to nothing/)
})
