// tests/test_measure.py: measures at the default accuracy, held to what it promises.
//
// ACCURACY (1e-7) promises volumes and areas to 1e-7 of their value, centers to 1e-7 of the
// body's size and the inertia to 1e-7 of its largest principal moment. The solids below have
// closed forms; the spring, the flange and dense free-form bodies are checked against their own
// integration at 1e-10.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCURACY,
  Align,
  Box,
  CenterArc,
  Circle,
  Cone,
  Cylinder,
  Ellipse,
  type Face,
  type Part,
  Plane,
  Rectangle,
  Sphere,
  Spline,
  Text,
  Torus,
  Vector,
  Z,
  setWarningHandler,
  surface,
} from '../src/index.ts'
import { ext } from '../src/kernel.ts'
import { model as flange } from '../examples/flange.ts'
import { model as spring } from '../examples/spring.ts'
import { approx, leggauss } from './_approx.ts'
import { Axis as _Axis, Box as _Box, Cylinder as _Cylinder, Sphere as _Sphere, Vector as _Vector, Vertex as _Vertex, X } from '../src/index.ts'
import { _list } from '../src/shapes.ts'

const PI = Math.PI
type M3 = number[][]

const diag = (a: number, b: number, c: number): M3 => [
  [a, 0, 0],
  [0, b, 0],
  [0, 0, c],
]
const sub3 = (a: M3, b: M3): M3 => a.map((row, i) => row.map((x, j) => x - b[i][j]))
const maxAbs = (a: M3): number => Math.max(...a.flat().map(Math.abs))

function boxInertia(m: number, a: number, b: number, c: number): M3 {
  return diag((m * (b * b + c * c)) / 12, (m * (a * a + c * c)) / 12, (m * (a * a + b * b)) / 12)
}

// polynomials as coefficient lists, lowest power first (numpy.polynomial.polynomial)
function polymul(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0)
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] += x * y)))
  return out
}
const integral = (c: number[], h: number) => c.reduce((s, x, i) => s + (x * h ** (i + 1)) / (i + 1), 0)

/** Volume, centroid height and inertia (about the centroid) of a cone frustum on z = 0. */
function frustum(r1: number, r2: number, h: number): [number, number, M3] {
  const r = [r1, (r2 - r1) / h]
  const rr = polymul(r, r)
  const r4 = polymul(rr, rr)
  const v = PI * integral(rr, h)
  const zc = (PI * integral(polymul(rr, [0, 1]), h)) / v
  const izz = (PI / 2) * integral(r4, h)
  const ixx = (PI / 4) * integral(r4, h) + PI * integral(polymul(rr, [zc * zc, -2 * zc, 1]), h)
  return [v, zc, diag(ixx, ixx, izz)]
}

/** Area and the integrals of x^2 and y^2 of a centered a x b rectangle with corner radius r. */
function roundedRectangle(a: number, b: number, r: number): [number, number, number] {
  const area = a * b - (4 - PI) * r * r
  // a corner's spandrel: the r x r square minus the quarter disc, about the corner's center
  const x0 = a / 2 - r
  const y0 = b / 2 - r
  const second = (c: number) => {
    // integral of x^2 over one spandrel at offset c (x0 or y0)
    const square = (r * ((c + r) ** 3 - c ** 3)) / 3
    const quarter = (c * c * PI * r * r) / 4 + (2 * c * r ** 3) / 3 + (PI * r ** 4) / 16
    return square - quarter
  }
  return [area, (b * a ** 3) / 12 - 4 * second(x0), (a * b ** 3) / 12 - 4 * second(y0)]
}

function closedForms(): [string, () => Part, number, number, [number, number, number], M3 | null][] {
  const out: [string, () => Part, number, number, [number, number, number], M3 | null][] = []
  {
    const [a, b, c] = [10, 20, 30]
    out.push(['box', () => Box(a, b, c).translate(3, -4, 5), a * b * c, 2 * (a * b + b * c + a * c), [3, -4, 5], boxInertia(a * b * c, a, b, c)])
  }
  {
    const r = 10
    const m = (4 / 3) * PI * r ** 3
    out.push(['sphere', () => Sphere(r).translate(1, 2, 3), m, 4 * PI * r * r, [1, 2, 3], diag(0.4 * m * r * r, 0.4 * m * r * r, 0.4 * m * r * r)])
  }
  {
    const [r, h] = [10, 20]
    const m = PI * r * r * h
    const ixx = (m * (3 * r * r + h * h)) / 12
    out.push(['cylinder', () => Cylinder(r, h), m, 2 * PI * r * (h + r), [0, 0, 0], diag(ixx, ixx, (m * r * r) / 2)])
  }
  for (const [r1, r2] of [
    [10, 4],
    [10, 0],
  ]) {
    const h = 15
    const [v, zc, inertia] = frustum(r1, r2, h)
    const area = PI * (r1 + r2) * Math.hypot(h, r1 - r2) + PI * (r1 * r1 + r2 * r2)
    out.push([`cone ${r1}/${r2}`, () => Cone(r1, r2, h, { align: [Align.CENTER, Align.CENTER, Align.MIN] }), v, area, [0, 0, zc], inertia])
  }
  {
    const [big, small] = [20, 5]
    const m = 2 * PI * PI * big * small ** 2
    const ixx = m * (big ** 2 / 2 + (5 * small ** 2) / 8)
    out.push(['torus', () => Torus(big, small), m, 4 * PI * PI * big * small, [0, 0, 0], diag(ixx, ixx, m * (big ** 2 + (3 * small ** 2) / 4))])
  }
  {
    // a box with its four vertical edges rounded: a prism of a rounded rectangle
    const [a, b, c, r] = [30, 20, 10, 3]
    const [area2, x2, y2] = roundedRectangle(a, b, r)
    const m = area2 * c
    out.push([
      'filleted box',
      () => {
        const box = Box(a, b, c)
        return box.fillet(box.edges().parallelTo(Z), r)
      },
      m,
      2 * area2 + (2 * (a + b) - 8 * r + 2 * PI * r) * c,
      [0, 0, 0],
      diag(c * y2 + (area2 * c ** 3) / 12, c * x2 + (area2 * c ** 3) / 12, c * (x2 + y2)),
    ])
  }
  {
    // all edges rounded: a smaller box grown by a ball (cylinders along the edges, spheres at the corners)
    const [a, b, c, r] = [30, 20, 10, 2]
    const [p, q, s] = [a - 2 * r, b - 2 * r, c - 2 * r]
    const v = p * q * s + 2 * (p * q + q * s + s * p) * r + PI * (p + q + s) * r * r + (4 / 3) * PI * r ** 3
    const area = 2 * (p * q + q * s + s * p) + 2 * PI * (p + q + s) * r + 4 * PI * r * r
    out.push(['rounded box', () => Box(a, b, c).fillet(Box(a, b, c).edges(), r), v, area, [0, 0, 0], null])
  }
  {
    // a plate with a through hole
    const [a, b, c, r] = [40, 30, 20, 6]
    const mh = PI * r * r * c
    const hole = diag((mh * (3 * r * r + c * c)) / 12, (mh * (3 * r * r + c * c)) / 12, (mh * r * r) / 2)
    out.push([
      'plate with a hole',
      () => Box(a, b, c).cut(Cylinder(r, 30)),
      a * b * c - mh,
      2 * (a * b - PI * r * r) + 2 * (a + b) * c + 2 * PI * r * c,
      [0, 0, 0],
      sub3(boxInertia(a * b * c, a, b, c), hole),
    ])
  }
  return out
}

for (const [name, make, volume, area, center, inertia] of closedForms()) {
  test(`closed forms at the default accuracy: ${name}`, () => {
    const part = make()
    const mp = part.massProperties()
    const size = part.bbox().diagonal
    assert.ok(Math.abs(mp.volume - volume) <= ACCURACY * volume)
    assert.ok(Math.abs(part.volume - volume) <= ACCURACY * volume)
    assert.ok(Math.abs(mp.area - area) <= ACCURACY * area)
    assert.ok(mp.center.sub(center).length <= ACCURACY * size)
    if (inertia !== null) assert.ok(maxAbs(sub3(mp.inertia, inertia)) <= ACCURACY * maxAbs(inertia))
  })
}

test('faces and sketches at the default accuracy', () => {
  const [r, h] = [10, 20]
  const side = Cylinder(r, h)
    .faces()
    .filterBy((f) => f.geomType === 'cylinder')
    .one()
  assert.ok(Math.abs(side.area - 2 * PI * r * h) <= ACCURACY * 2 * PI * r * h)
  assert.ok(side.center().length <= ACCURACY * Math.hypot(2 * r, 2 * r, h))
  const ball = Sphere(7).faces().one()
  assert.ok(Math.abs(ball.area - 4 * PI * 49) <= ACCURACY * 4 * PI * 49)
  const ring = Circle(10).cut(Circle(4))
  assert.ok(Math.abs(ring.area - PI * 84) <= ACCURACY * PI * 84)
  assert.ok(Math.abs(Ellipse(10, 4).cut(Rectangle(4, 2)).area - (PI * 40 - 8)) <= ACCURACY * (PI * 40 - 8))
})

/** The area inside a planar face's edges by Green's theorem on the edge curves, with a
 * Gauss-Legendre rule exact for polynomial outlines (the curves of a font). */
function outlineArea(face: Face): number {
  const [x, w] = leggauss(16)
  let total = 0
  for (const wire of face.wires()) {
    for (const e of wire.edges()) {
      const c = e._curve()
      const [t0, t1] = e._range()
      const knots = [...new Set<number>(ext.curve_data(c).knots)].filter((kv) => t0 < kv && kv < t1).sort((a, b) => a - b)
      let part = 0
      const ends = [t0, ...knots, t1]
      for (let s = 0; s + 1 < ends.length; s++) {
        const [a, b] = [ends[s], ends[s + 1]]
        for (let i = 0; i < x.length; i++) {
          const [p, d] = ext.curve_eval(c, 0.5 * (a + b) + 0.5 * (b - a) * x[i], 1)
          part += 0.5 * (b - a) * w[i] * (p[0] * d[1] - p[1] * d[0])
        }
      }
      total += e._rev ? -part : part
    }
  }
  return Math.abs(0.5 * total)
}

for (const text of ['@&8', 'Qq%', '(', 'SMLIB 42']) {
  test(`the area of lettering matches its outlines: ${text}`, () => {
    // the kernel's integration was off by up to 1.1e-5 here (Qq%) at the same accuracy
    const sketch = Text(text, 10)
    const exact = sketch.faces().reduce((s: number, f: Face) => s + outlineArea(f), 0)
    assert.ok(Math.abs(sketch.area - exact) <= ACCURACY * exact)
  })
}

for (const [name, make, volume] of [
  ['spring', spring, 2170.0811],
  ['flange', flange, 157979.6668],
] as const) {
  test(`the ${name} example against a tight integration`, () => {
    // the kernel's integration was 2.9e-5 (spring) and 8e-7 (flange) off at the default
    const part = make()
    const mp = part.massProperties()
    const ref = part.named('again').massProperties(1, 1e-10) // a copy: nothing cached
    const size = part.bbox().diagonal
    assert.ok(Math.abs(mp.volume - ref.volume) <= ACCURACY * ref.volume)
    assert.ok(Math.abs(mp.area - ref.area) <= ACCURACY * ref.area)
    assert.ok(mp.center.sub(ref.center).length <= ACCURACY * size)
    assert.ok(maxAbs(sub3(mp.inertia, ref.inertia)) <= ACCURACY * maxAbs(ref.inertia))
    approx(ref.volume, volume, 1e-6)
  })
}

const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))

test('a dense free-form body', () => {
  // A surface through 105 x 105 points, thickened: its offset face has about 200 x 230 knot spans,
  // where the integration spends its time.
  const pts = linspace(0, 100, 105).map((y) => linspace(0, 100, 105).map((x) => [x, y, 3 * Math.sin(x / 7) * Math.cos(y / 9)]))
  const body = surface(pts).thicken(2)
  const t = performance.now()
  const mp = body.massProperties()
  const elapsed = (performance.now() - t) / 1000
  const ref = body.named('again').massProperties(1, 1e-10)
  const size = body.bbox().diagonal
  assert.ok(Math.abs(mp.volume - ref.volume) <= ACCURACY * ref.volume)
  assert.ok(Math.abs(mp.area - ref.area) <= ACCURACY * ref.area)
  assert.ok(mp.center.sub(ref.center).length <= ACCURACY * size)
  assert.ok(maxAbs(sub3(mp.inertia, ref.inertia)) <= ACCURACY * maxAbs(ref.inertia))
  approx(ref.volume, 20730.45218, 1e-6) // the kernel at 1e-11
  assert.ok(body._h.props.evaluations < 10_000_000 && elapsed < 10, `${body._h.props.evaluations} evaluations, ${elapsed} s`)
})

test('a folded face', () => {
  // Thickening this surface folds the offset face over itself in thin strips along one edge (the
  // normal turns over and back): the area element |Su x Sv| has corners there, which the inner
  // integrals take a few bisections to find. The result converges like any other.
  const n = 10
  const pts = linspace(0, 100, n).map((x) => linspace(0, 100, n).map((y) => [x, y, 3 * Math.sin(x / 7) * Math.cos(y / 9)]))
  const slab = surface(pts).thicken(5)
  setWarningHandler((message) => {
    throw new Error(`warned: ${message}`) // no "the integration reached a relative accuracy of ..."
  })
  let mp: ReturnType<Part['massProperties']>
  try {
    mp = slab.massProperties()
  } finally {
    setWarningHandler((message) => console.warn(message))
  }
  assert.ok(slab._h.props.converged) // bisection used to stop at the folds, 1.8e-7 off the face's area
  const ref = slab.named('again').massProperties(1, 1e-10)
  assert.ok(Math.abs(mp.volume - ref.volume) <= ACCURACY * ref.volume)
  assert.ok(Math.abs(mp.area - ref.area) <= ACCURACY * ref.area)
  approx(ref.area, 22733.6, 1e-3) // the kernel's offset body differs a little by platform
})

test('accuracy means what it says', () => {
  const s = spring()
  const ref = s.massProperties(1, 1e-10)
  for (const accuracy of [1e-3, 1e-5]) {
    const mp = s.named('copy').massProperties(1, accuracy)
    assert.ok(Math.abs(mp.volume - ref.volume) <= accuracy * ref.volume)
    assert.ok(Math.abs(mp.area - ref.area) <= accuracy * ref.area)
  }
})

test('measures are kept with the part', () => {
  const part = Sphere(10).cut(Box(10, 10, 10, { align: Align.MIN }))
  const v = part.volume
  assert.ok(part.massProperties().volume === v && part.area === part.massProperties().area)
  assert.equal(part.massProperties(1, 1e-3).volume, v) // the result at 1e-7 serves 1e-3 as well
})

test('an empty part has no center', () => {
  const empty = Box(10, 10, 10).cut(Box(20, 20, 20))
  assert.ok(empty.volume === 0 && empty.area === 0)
  assert.throws(() => empty.center(), RangeError)
})

// -- curve lengths ------------------------------------------------------------------------
test('outline lines have their length', () => {
  // The outline of a cylinder seen from the side: two 60 mm lines (top and bottom) made as
  // quadratic B-splines that start and end with a doubled control point. The kernel's length
  // integration gave up on the first half and reported 30.
  const edges = Cylinder(30, 10).outline(Plane.XZ)
  assert.deepEqual(
    edges.map((e) => Math.round(e.length * 1e9) / 1e9).sort((a, b) => a - b),
    [10, 10, 60, 60],
  )
  for (const e of edges) {
    if (e.length > 20) {
      const [a, b] = [e.start, e.end]
      for (const t of [0.1, 0.25, 0.5, 0.9]) assert.ok(e.pointAt(t).distanceTo(a.add(b.sub(a).mul(t))) < 1e-9)
      approx(e.tangentAt(0.25).dot(b.sub(a).normalized()), 1)
    }
  }
})

test('lengths of curves', () => {
  approx(CenterArc([0, 0], 5, 0, 270).length, 7.5 * PI, 1e-12)
  // the perimeter of an ellipse: 4a times the complete elliptic integral of the second kind
  const [x, w] = leggauss(64)
  let sum = 0
  for (let i = 0; i < x.length; i++) {
    const theta = (PI / 4) * (x[i] + 1)
    sum += w[i] * Math.sqrt(1 - (1 - 0.16) * Math.sin(theta) ** 2)
  }
  const perimeter = ((4 * 10 * PI) / 4) * sum
  approx(Ellipse(10, 4).edges().one().length, perimeter, 1e-10)
  // a spline against its arc length summed with Simpson's rule on a fine grid of parameters
  const spline = Spline([0, 0], [10, 5], [20, -3], [30, 8], [35, 0])
  const c = spline._curve()
  const [t0, t1] = spline._range()
  const ts = linspace(t0, t1, 20001)
  const speed = ts.map((t) => new Vector(ext.curve_eval(c, t, 1)[1]).length)
  const h = ts[1] - ts[0]
  const s = [0]
  for (let i = 0; i + 2 < ts.length; i += 2) s.push(s[s.length - 1] + (h / 3) * (speed[i] + 4 * speed[i + 1] + speed[i + 2]))
  approx(spline.length, s[s.length - 1], 1e-10)
  const ts2 = ts.filter((_, i) => i % 2 === 0)
  const interp = (v: number) => {
    let j = 1
    while (j < s.length - 1 && s[j] < v) j++
    const f = (v - s[j - 1]) / (s[j] - s[j - 1])
    return ts2[j - 1] + f * (ts2[j] - ts2[j - 1])
  }
  for (const f of [0.1, 0.37, 0.5, 0.83]) {
    // pointAt runs proportional to arc length
    const t = interp(f * s[s.length - 1])
    assert.ok(spline.pointAt(f).distanceTo(new Vector(ext.curve_eval(c, t, 0)[0])) < 1e-5)
  }
})

// -- rays -------------------------------------------------------------------------------------
test('raycast finds exact points nearest first', () => {
  const part = _Box(10, 10, 10).cut(_Cylinder(3, 10))
  const hits = part.raycast([-20, 0, 0], [1, 0, 0])
  assert.deepEqual(hits.map((h) => h.point.x).map((x) => Math.round(x * 1e9) / 1e9), [-5, -3, 3, 5])
  hits.forEach((h, i) => approx(h.distance, [15, 17, 23, 25][i], 0, 1e-9))
  assert.deepEqual(hits.map((h) => h.face.geomType), ['plane', 'cylinder', 'cylinder', 'plane'])
  // normals point out of the material: into the hole on its wall
  assert.deepEqual(hits.map((h) => Math.round(h.normal.x)), [-1, 1, -1, 1])
  // an axis is a ray; behind the start nothing counts
  assert.ok(part.raycast(new _Axis([4, 4, 50], [0, 0, -1]))[0].point.equals([4, 4, 5]))
  assert.deepEqual(part.raycast([-20, 0, 0], [-1, 0, 0]), [])
  // from inside the material: an odd number of hits
  assert.equal(part.raycast([0, 4, 0], [0, 0, 1]).length, 1)
})

test('raycast where the kernel finds no crossing', () => {
  const part = _Box(10, 10, 10).cut(_Cylinder(3, 10))
  // down the hole (along the cylinder, parallel to the side faces): nothing
  assert.deepEqual(part.raycast(new _Axis([0, 0, 50], [0, 0, -1])), [])
  // along a face: where the ray enters it
  assert.ok(part.raycast([-20, 5, 0], [1, 0, 0])[0].point.equals([-5, 5, 0]))
  // through corners: one hit each
  const hits = part.raycast([-10, -10, -10], [1, 1, 1])
  const s3 = Math.sqrt(3)
  const want = [5 * s3, (10 - 3 / Math.sqrt(2)) * s3, (10 + 3 / Math.sqrt(2)) * s3, 15 * s3]
  assert.equal(hits.length, 4)
  hits.forEach((h, i) => approx(h.distance, want[i], 0, 1e-6))
})

test('hitBy selects what a ray meets', () => {
  const part = _Box(40, 30, 20).cut(_Cylinder(5, 30))
  const met = part.faces().hitBy([-50, 0, 0], [1, 0, 0])
  assert.deepEqual(met.map((f) => f.geomType), ['plane', 'cylinder', 'plane']) // the hole's wall once
  met.forEach((f, i) => approx(f.center().x, [-20, 0, 20][i], 0, 1e-9))
  // it chains: only the faces in the list count, the others are looked past
  assert.deepEqual(part.faces().planar().hitBy([-50, 0, 0], [1, 0, 0]).map((f) => f.geomType), ['plane', 'plane'])
  assert.ok(part.faces().hitBy(new _Axis([10, 8, 50], [0, 0, -1])).first.center().equals([0, 0, 10]))
  assert.equal(part.faces().hitBy([0, 0, 50], [0, 0, -1]).length, 0) // down the hole
  // through an edge: the faces on both sides
  const box = _Box(10, 10, 10)
  const corners = box.faces().hitBy([-20, -20, 0], [1, 1, 0]).map((f) => f.center().toArray().map((c) => Math.round(c)).join(','))
  assert.deepEqual(corners.slice(0, 2).sort(), ['-5,0,0', '0,-5,0'])
  assert.deepEqual(corners.slice(2).sort(), ['0,5,0', '5,0,0'])
  // bodies: which part of an assembly a ray meets first
  const parts = _list([0, 20, 40].map((x) => _Box(5, 5, 5).translate(x, 0, 0).named(`b${x}`)))
  assert.deepEqual(parts.hitBy([100, 0, 0], [-1, 0, 0]).map((p) => p.name), ['b40', 'b20', 'b0'])
  assert.equal(parts.hitBy([100, 50, 0], [-1, 0, 0]).length, 0)
  assert.throws(() => box.edges().hitBy([0, 0, 50], [0, 0, -1]), /faces and bodies/)
  assert.throws(() => box.faces().hitBy([0, 0, 0]), /axis/)
})

// -- points -----------------------------------------------------------------------------------
test('classify points exactly', () => {
  const part = _Box(40, 30, 20).cut(_Cylinder(5, 30))
  assert.deepEqual(part.classify([10, 8, 0]), ['inside', null])
  assert.deepEqual(part.classify([0, 0, 0]), ['outside', null]) // in the hole
  const [where, face] = part.classify([20, 0, 0]) as [string, Face]
  assert.equal(where, 'on')
  assert.equal(face.geomType, 'plane')
  approx(face.center().x, 20)
  assert.equal((part.classify([20, 15, 0])[1] as any).geomType, 'line') // an edge, not its faces
  assert.ok((part.classify([20, 15, 10])[1] as any).equals(new _Vertex(20, 15, 10))) // a vertex, not its edges
  assert.ok(part.contains([10, 8, 0]) && part.contains([20, 0, 0]) && !part.contains([0, 0, 0]))
  assert.equal(part.classify([20.001, 0, 0])[0], 'outside')
  assert.equal(part.classify([20.001, 0, 0], 0.01)[0], 'on')
  assert.throws(() => part.classify([0, 0, 0], -1), /positive/)
  // where the parity of ray hits is wrong: a ray that grazes the cylinder hits once (odd: "inside");
  // one tangent to a hole's wall from a point in the material hits twice ("outside")
  const cylinder = _Cylinder(5, 20)
  assert.ok(cylinder.raycast([-10, 5, 0], [1, 0, 0]).length === 1 && !cylinder.contains([-10, 5, 0]))
  const holed = _Box(40, 30, 20).cut(_Cylinder(5, 40).rotate(X, 90))
  assert.ok(holed.raycast([5, 0, -8], Z).length === 2 && holed.contains([5, 0, -8]))
  const hollow = _Box(20, 20, 20).cut(_Box(6, 6, 6))
  assert.ok(!hollow.contains([0, 0, 0]) && hollow.contains([8, 0, 0])) // a cavity is outside
})

test('classify does not trust one ray', () => {
  // The kernel takes the region from one ray along +X. After a tight bounding box it found no face
  // along that ray from inside this fused cylinder and torus, and said "outside".
  const part = _Cylinder(2.5, 6).rotate(X, 90).fuse(Torus(8, 4).translate(9.5, 0, -0.5913))
  part.bbox()
  for (const p of [[-2.1123, 2.7923, 1.2387], [-2, 2.9, 1], [-2, -2.9, 1]]) {
    assert.ok(part.contains(p) && part.raycast(p, [0.31, 0.52, 0.79]).length % 2 === 1)
  }
})

test('cellAt names the cell of a merged part', () => {
  const cells = _Box(20, 20, 20).merge(_Cylinder(4, 30))
  approx(cells.cellAt([0, 0, 0])!.volume, PI * 16 * 20)
  approx(cells.cellAt([8, 8, 0])!.volume, 8000 - PI * 16 * 20)
  approx(cells.cellAt([0, 0, 14])!.volume, PI * 16 * 5)
  assert.ok(cells.cellAt([0, 0, 30]) === null && cells.cellAt([4, 0, 0]) === null) // outside, on a face
  const box = _Box(10, 10, 10)
  assert.ok(box.cellAt([0, 0, 0]) === box && box.cellAt([20, 0, 0]) === null)
})

test('raycast on faces and meshes', () => {
  const ball = _Sphere(5)
  const hits = ball.faces()[0].raycast([3, 0, 20], [0, 0, -1])
  assert.ok(hits[0].point.equals([3, 0, 4]) && hits[1].point.equals([3, 0, -4]))
  assert.ok(hits[0].normal.equals([0.6, 0, 0.8]))
  const mesh = ball.mesh(0.01)
  const near = mesh.raycast([3, 0, 20], [0, 0, -1])
  assert.equal(near.length, 2)
  assert.ok(near[0].triangle !== null && near[0].face === null)
  approx(near[0].point.z, 4, 0, 0.02)
  assert.ok(near[0].normal.dot(new _Vector(0.6, 0, 0.8)) > 0.99)
  assert.throws(() => ball.raycast([0, 0, 0]), /axis/)
  assert.throws(() => ball.raycast([0, 0, 0], [0, 0, 0]), /zero/)
})

