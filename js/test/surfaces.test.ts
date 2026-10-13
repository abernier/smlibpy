// tests/test_surfaces.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Align,
  Axis,
  Box,
  CenterArc,
  Circle,
  Cylinder,
  Helix,
  Line,
  Part,
  Plane,
  Shell,
  Sphere,
  ThreePointArc,
  Torus,
  Vector,
  X,
  Y,
  Z,
  extrude,
  loft,
  revolve,
  stitch,
  surface,
} from '../src/index.ts'
import { approx } from './_approx.ts'
import { KernelError as _KernelError, ModelingError as _ModelingError, Rectangle as _Rectangle, Vector as _Vector, surface as _surface, surfaceFillet as _surfaceFillet } from '../src/index.ts'
import { ext as _ext, k as _k } from '../src/kernel.ts'

const PI = Math.PI

test('open curves make surfaces', () => {
  const arc = ThreePointArc([0, 0, 0], [10, 5, 0], [20, 0, 0])
  const wall = extrude(arc, 10)
  assert.ok(wall instanceof Shell)
  approx(wall.area, arc.length * 10, 1e-6)

  const vase = revolve(Line([5, 0, 0], [5, 0, 10]), Z) as Shell
  approx(vase.area, 2 * PI * 5 * 10, 1e-6)

  const patch = loft([Line([0, 0, 0], [10, 0, 0]), Line([0, 10, 5], [10, 10, 5])]) as Shell
  approx(patch.area, 10 * Math.hypot(10, 5), 1e-6)
})

test('a surface through points, thickened', () => {
  const pts: number[][][] = []
  for (let y = 0; y < 5; y++) {
    const row: number[][] = []
    for (let x = 0; x < 6; x++) row.push([x * 10, y * 10, 3 * Math.sin(x / 2) * Math.cos(y / 2)])
    pts.push(row)
  }
  const s = surface(pts)
  assert.equal(s.faces()[0].geomType, 'bspline')
  for (const row of pts) for (const p of row) assert.ok(s.distanceTo(p) < 1e-6)
  const solid = s.thicken(1)
  assert.ok(solid.isValid())
  approx(solid.volume, s.area, 2e-2)
})

test('stitch faces into a solid', () => {
  const box = Box(10, 10, 10)
  const part = stitch(box.faces().map((f) => f.toShell()))
  assert.ok(part instanceof Part)
  approx(part.volume, 1000)
})

test('queries', () => {
  approx(Sphere(5).silhouette([0, 0, 1])[0].length, 2 * PI * 5, 1e-6)
  const pts = Line([0, 0], [10, 10]).intersections(Line([0, 10], [10, 0]))
  assert.ok(pts.length === 1 && pts[0].equals(new Vector(5, 5, 0)))
  const curves = Box(10, 10, 10).intersectionCurves(Cylinder(3, 20))
  assert.ok(curves.length === 2 && curves.every((c) => c.geomType === 'circle' || c.geomType === 'bspline'))
  approx(Box(10, 10, 10).distanceTo(Box(10, 10, 10).translate(15, 0, 0)), 5)
})

const sortedLengths = (edges: Iterable<{ length: number }>) => [...edges].map((e) => e.length).sort((a, b) => a - b)

test('directions take an axis', () => {
  // An Axis such as Z gives its direction wherever a direction is asked for, as in the selectors;
  // silhouette, project, extrude and Helix took only vectors.
  const torus = Torus(28, 9)
  const a = sortedLengths(torus.silhouette(Z))
  const b = sortedLengths(torus.silhouette([0, 0, 1]))
  a.forEach((x, i) => approx(x, b[i]))
  const box = Box(40, 30, 10)
  const circle = Circle(5).on(Plane.XY.offset(30)).edges()[0]
  const c = sortedLengths(box.project(circle, Z.neg()))
  const d = sortedLengths(box.project(circle, [0, 0, -1]))
  c.forEach((x, i) => approx(x, d[i]))
  const slant = new Axis([5, 5, 5], [0, 1, 2]) // only the direction counts
  approx(Circle(5).extrude(20, { direction: slant }).volume, (PI * 25 * 20 * 2) / Math.sqrt(5))
  approx(extrude(Line([0, 0], [10, 0]), 5, { direction: Y }).area, 50)
  assert.ok(Helix(5, 20, 10, { direction: X }).end.equals(Helix(5, 20, 10, { direction: [1, 0, 0] }).end))
  for (const call of [() => Sphere(5).silhouette([0, 0, 0]), () => box.project(circle, [0, 0, 0])]) {
    assert.throws(call, (e: Error) => e instanceof RangeError && /the direction must not be zero/.test(e.message))
  }
})

test('intersection curves come once where faces lie in one plane', () => {
  // Both bottoms lie in z = 0: the kernel finds the arc there twice (the other way round also the
  // two lines on it). The total length shows any repeat, however the curves are cut.
  const a = Box(60, 44, 28, { align: Align.MIN })
  const b = Cylinder(19, 44, { align: [Align.CENTER, Align.CENTER, Align.MIN] }).translate(56.2, 3.8, 0)
  const line = 3.8 + Math.sqrt(19 ** 2 - 3.8 ** 2) // along x = 60 and y = 0 at z = 0
  const arc = 19 * (PI / 2 + 2 * Math.asin(3.8 / 19)) // the circle inside the box, at z = 0 and 28
  for (const curves of [a.intersectionCurves(b), b.intersectionCurves(a)]) {
    approx(
      curves.reduce((s, e) => s + e.length, 0),
      2 * arc + 2 * 28 + 2 * line,
      1e-6,
    )
  }
  const box = Box(20, 20, 20)
  const shared = box.intersectionCurves(box.translate(20, 0, 0)) // the face x = 10: its 4 sides
  approx(
    shared.reduce((s, e) => s + e.length, 0),
    80,
  )
})

// (CenterArc is used by the guards' thicken tests; keep the import list as Python's)
void CenterArc

// -- surfaces through clouds of points, blends between surfaces -----------------------------
function cloud(count = 2000, seed = 7): number[][] {
  let state = seed
  const rnd = (): number => ((state = (state * 16807) % 2147483647) / 2147483647)
  const out: number[][] = []
  for (let i = 0; i < count; i++) {
    const x = rnd() * 20 - 10
    const y = rnd() * 20 - 10
    out.push([x, y, 0.02 * (x * x - y * y) + 0.5 * Math.sin(x / 2)])
  }
  return out
}

test('surface fitted to a cloud of points', () => {
  const points = cloud()
  const s = _surface(points)
  assert.ok(s instanceof Shell)
  assert.equal(s.faces()[0].geomType, 'bspline')
  assert.ok(Math.max(...points.filter((_, i) => i % 40 === 0).map((p) => s.distanceTo(p))) < 0.005)
  const box = s.bbox() // the smallest rectangle around the points: the cloud's square, not a turned one
  approx(box.min.x, -10, 0, 0.1)
  approx(box.max.x, 10, 0, 0.1)
  approx(box.min.y, -10, 0, 0.1)
  approx(box.max.y, 10, 0, 0.1)
  // noisy points: the surface follows the shape, not the noise (Box-Muller from the same generator)
  let state = 11
  const rnd = (): number => ((state = (state * 16807) % 2147483647) / 2147483647)
  const noisy = points.map(([x, y, z]) => [x, y, z + 0.05 * Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())])
  const smooth = _surface(noisy, { smoothing: 0.01 })
  const deviations = points.filter((_, i) => i % 40 === 0).map((p) => smooth.distanceTo(p))
  assert.ok(deviations.reduce((a, b) => a + b) / deviations.length < 0.02) // (the noise: 0.05)
  // points as vectors; control points by hand (along the longer side first)
  const few = _surface(points.slice(0, 300).map((p) => new _Vector(p)), { controls: [6, 5] })
  assert.equal(_ext.surface_data(_k.face_surface(few.faces()[0]._f), true).poles.length, 30)
})

test('surface cloud checks', () => {
  const points = cloud(100)
  assert.throws(() => _surface([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]), /line/)
  assert.throws(() => _surface([[0, 0, 0], [1, 0, 0], [0, 1, 0]]), /at least 4/)
  assert.throws(() => _surface(points, { controls: 3 }), /controls/)
  assert.throws(() => _surface(points, { smoothing: 2 }), /smoothing/)
  const grid = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => [x, y, 0]))
  assert.throws(() => _surface(grid, { controls: 5 }), /clouds/)
})

test('surface fillet between two sheets', () => {
  const floor = _Rectangle(40, 40).faces()[0] // normal +Z
  const wall = _Rectangle(40, 40).on(Plane.XZ).faces()[0]
  const ny = wall.normalAt().y
  for (const sides of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const blend = _surfaceFillet(floor, wall, 5, { sides })
    approx(blend.area, (Math.PI / 2) * 5 * 40, 1e-6)
    const c = blend.center() // a quarter circle's centroid: 2 r / pi from its centre
    approx(c.z, sides[0] * (5 - 10 / Math.PI), 0, 1e-6)
    approx(c.y, sides[1] * ny * (5 - 10 / Math.PI), 0, 1e-6)
  }
  // the same faces again (the kernel changes the surfaces it blends: copies are blended)
  approx(_surfaceFillet(floor, wall, 5).area, (Math.PI / 2) * 5 * 40, 1e-6)
})

test('surface fillet between crossing pipes', () => {
  const a = Cylinder(5, 60).faces().cylinders()[0]
  const b = Cylinder(4, 60).rotate(Axis.X, 90).faces().cylinders()[0]
  const blend = _surfaceFillet(a, b, 1.5, { sides: [1, 1] })
  assert.equal(blend.faces().length, 2)
  for (const e of blend.edges()) {
    const p = e.pointAt(0.5)
    const onA = Math.abs(Math.hypot(p.x, p.y) - 5)
    const onB = Math.abs(Math.hypot(p.x, p.z) - 4)
    if (e.length > 5) assert.ok(Math.min(onA, onB) < 1e-5) // the rails, along the pipes
  }
})

test('surface fillet checks', () => {
  const floor = _Rectangle(40, 40).faces()[0]
  assert.throws(() => _surfaceFillet(floor, floor, 0), /positive/)
  assert.throws(() => _surfaceFillet(floor, floor, 1, { sides: [1, 0] as any }), /sides/)
  assert.throws(() => _surfaceFillet(Box(1, 1, 1) as any, floor, 1), /faces/)
  assert.throws(() => _surfaceFillet(floor, _Rectangle(40, 40).translate([0, 0, 50]).faces()[0], 1), (e: any) => e instanceof _ModelingError || e instanceof _KernelError)
})

