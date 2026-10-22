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
import { fromSmb, toSmb } from '../src/exporters.ts'
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

test('loft of open curves takes ruled and smooth', () => {
  // Lofts of single open curves ignored both: three lines, z = 0, 10 (8 higher in y) and 20, passed
  // y = 6.0 at z = 5 with ruled: true, as by default (area 800.2232).
  const lines = [Line([0, 0, 0], [30, 0, 0]), Line([0, 8, 10], [30, 8, 10]), Line([0, 0, 20], [30, 0, 20])]
  const yAt = (s: Shell, z: number) => s.raycast([15, -50, z], [0, 1, 0])[0].point.y
  const byDefault = loft(lines) as Shell
  approx(byDefault.area, 800.2232, 0, 1e-4)
  approx(yAt(byDefault, 5), 6)
  const ruled = loft(lines, { ruled: true }) as Shell
  assert.equal(ruled.faces().length, 2)
  approx(yAt(ruled, 5), 4)
  approx(ruled.area, 2 * 30 * Math.hypot(8, 10))
  const four = [...lines, Line([0, 8, 30], [30, 8, 30])]
  approx(yAt(loft(four) as Shell, 5), 8) // cubic, as before
  approx(yAt(loft(four, { smooth: false }) as Shell, 5), 20 / 3) // quadratic
})

test('B-spline faces with a bump stay curved', () => {
  // A cubic sheet parameterized like a plane (control points at 60 times their Greville abscissae)
  // with one control point raised between the 13 parameters the kernel's plane test looked at:
  // every copy that adds analytic surfaces made it a plane (kernel patch K7).
  const n = 21
  const t = [0, 0, 0, 0, ...Array.from({ length: n - 4 }, (_, i) => (i + 1) / (n - 3)), 1, 1, 1, 1]
  const g = Array.from({ length: n }, (_, i) => (t[i + 1] + t[i + 2] + t[i + 3]) / 3)
  const grid = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => [60 * g[i], 60 * g[j], i === 16 && j === 9 ? 5 : 0]))
  const sheet = surface(grid, { interpolate: false }) as Shell
  approx(sheet.area, 3607.471, 0, 1e-3)
  approx(sheet.bbox().max.z, 2.2222, 0, 1e-4)
  const copy = sheet.faces()[0].toShell() // was a plane of 3600.0
  assert.equal(copy.faces()[0].geomType, 'bspline')
  approx(copy.area, sheet.area, 1e-9)
  approx((fromSmb(toSmb(sheet)) as Shell).bbox().max.z, 2.2222, 0, 1e-4) // was flat, zmax 0.0
  approx(sheet.thicken(2).volume, 7212.841, 0, 1e-2) // was 7200.0
  const v = sheet.mesh(0.01).vertices
  let top = -Infinity
  for (let i = 2; i < v.length; i += 3) top = Math.max(top, v[i])
  assert.ok(top > 2.2) // was 0.0
  // B-spline faces that are planes still come back from .smb as planes
  assert.deepEqual([...new Set((fromSmb(toSmb(Box(10, 20, 30).toNurbs())) as Part).faces().map((f) => f.geomType))], ['plane'])
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

test('surface of a cloud faces up', () => {
  let state = 3
  const rnd = (): number => ((state = (state * 16807) % 2147483647) / 2147483647)
  const bump: number[][] = [] // a bump: up at its top
  for (let i = 0; i < 500; i++) {
    const x = rnd() * 20 - 10
    const y = rnd() * 20 - 10
    bump.push([x, y, 2 * Math.exp(-(x * x + y * y) / 50)])
  }
  const cases: [number[][], number[]][] = [
    [bump, [0, 0, 1]],
    [bump.map(([x, y, z]) => [x, y, -z]), [0, 0, 1]],
    [bump.map(([x, y, z]) => [x, -z, y]), [0, 1, 0]], // (standing in XZ)
    [bump.map(([x, y, z]) => [-x, z, -y]), [0, 1, 0]],
    [bump.map(([x, y, z]) => [z, y, -x]), [1, 0, 0]], // (in YZ)
    [bump.map(([x, y, z]) => [-z, -y, x]), [1, 0, 0]],
  ]
  for (const [points, up] of cases) {
    const f = _surface(points).faces()[0]
    const dot = (p: number[]): number => p[0] * up[0] + p[1] * up[1] + p[2] * up[2]
    const top = points.reduce((a, b) => (Math.abs(dot(b)) > Math.abs(dot(a)) ? b : a)) // (the point of the bump)
    assert.ok(f.normalAt(top).dot(up) > 0.99)
  }
})

test('surface of a sparse noisy cloud neither folds nor overshoots', () => {
  let state = 4
  const rnd = (): number => ((state = (state * 16807) % 2147483647) / 2147483647)
  const wave = (x: number, y: number): number => 7 * Math.sin(x / 11) * Math.cos(y / 13) + 0.004 * x * x
  const noisy: number[][] = []
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 60 - 30
    const y = rnd() * 40 - 20
    noisy.push([x, y, wave(x, y) + 0.6 * Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())])
  }
  const f = _surface(noisy).faces()[0]
  const grid: number[][] = []
  for (let i = 0; i < 24; i++) for (let j = 0; j < 16; j++) {
    const x = -29 + (58 * i) / 23
    const y = -19 + (38 * j) / 15
    grid.push([x, y, wave(x, y)])
  }
  assert.ok(Math.min(...grid.map((p) => f.normalAt(p).z)) > 0.5) // no fold: the normal stays up everywhere
  const zs = grid.map((p) => p[2])
  assert.ok(f.bbox().max.z < Math.max(...zs) + 1 && f.bbox().min.z > Math.min(...zs) - 1)
  assert.ok(grid.reduce((a, p) => a + f.distanceTo(p), 0) / grid.length < 0.35)
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

